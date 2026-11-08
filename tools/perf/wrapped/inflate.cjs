// usage: node inflate.cjs <profile> <playerCopies> <gameCopiesPerKeptGame(0 = none)>
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { install } = require("./route.cjs");
(async () => {
	const [profile, pc, gc] = process.argv.slice(2);
	const ctx = await chromium.launchPersistentContext(profile, {
		executablePath: process.env.CHROME,
	});
	await install(ctx, process.env.BUILD + "/build");
	const page = ctx.pages()[0] || (await ctx.newPage());
	page.setDefaultTimeout(3000000);
	await page.goto("http://localhost:3001/l/1");
	await page.waitForSelector(".navbar");
	await page.waitForTimeout(3000);
	const res = await page.evaluate(
		async ({ pc, gc }) => {
			const db = await new Promise((res, rej) => {
				const r = indexedDB.open("league1");
				r.onsuccess = () => res(r.result);
				r.onerror = () => rej(r.error);
			});
			const req = (r) =>
				new Promise((res, rej) => {
					r.onsuccess = () => res(r.result);
					r.onerror = () => rej(r.error);
				});
			const tx0 = db.transaction(["players", "games"]);
			const players = await req(tx0.objectStore("players").getAll());
			const gamesIdx = tx0.objectStore("games");
			const games = await req(gamesIdx.getAll());
			const maxPid = Math.max(...players.map((p) => p.pid));
			let maxGid = Math.max(...games.map((g) => g.gid));
			const seasons = [...new Set(games.map((g) => g.season))].sort(
				(a, b) => a - b,
			);
			const first = Math.min(
				...players.flatMap((p) => p.stats.map((s) => s.season)),
			);
			let np = 0,
				ng = 0;
			for (let k = 1; k <= pc; k++) {
				for (let i = 0; i < players.length; i += 500) {
					const tx = db.transaction("players", "readwrite");
					const st = tx.objectStore("players");
					for (const p of players.slice(i, i + 500)) {
						const c = structuredClone(p);
						c.pid = maxPid + (k - 1) * (maxPid + 1) + p.pid + 1;
						c.firstName = p.firstName + String.fromCharCode(96 + k);
						c.tid = -3;
						c.retiredYear = Math.min(
							p.retiredYear === Infinity ? 99999 : p.retiredYear,
							Math.max(...c.stats.map((s) => s.season), 0),
						);
						delete c.contract?.exp;
						st.put(c);
						np++;
					}
					await new Promise((res, rej) => {
						tx.oncomplete = res;
						tx.onerror = () => rej(tx.error);
					});
				}
			}
			if (gc > 0) {
				const target = [];
				for (let s = first; s < seasons[0]; s++) {
					target.push(s);
				}
				for (const s of target) {
					for (let i = 0; i < games.length; i += 300) {
						const tx = db.transaction("games", "readwrite");
						const st = tx.objectStore("games");
						for (const g of games.slice(i, i + 300)) {
							if (g.season !== seasons.at(-2)) {
								continue;
							}
							const c = structuredClone(g);
							c.gid = ++maxGid;
							c.season = s;
							st.put(c);
							ng++;
						}
						await new Promise((res, rej) => {
							tx.oncomplete = res;
							tx.onerror = () => rej(tx.error);
						});
					}
				}
			}
			return { np, ng, seasons, first };
		},
		{ pc: Number(pc), gc: Number(gc) },
	);
	console.log(JSON.stringify(res));
	await ctx.close();
})();
