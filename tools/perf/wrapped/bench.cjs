// Benchmark for the Wrapped and Storylines pages. A league is made once, in a persistent browser profile, then every build to compare is served from its own build directory at the same origin (route.cjs), so one profile (and its IndexedDB) can be opened by both.
//
//   export PLAYWRIGHT_MODULE=/path/to/node_modules/playwright CHROME=/path/to/chrome   (both optional if playwright is installed and has a browser)
//   BUILD=<worktree with a built build/ dir> node tools/perf/wrapped/setup.cjs <profile dir> 3001 30     make a league and sim 30 seasons with Auto Play
//   BUILD=<worktree> node tools/perf/wrapped/inflate.cjs <profile dir> 7 1                              optional: add 7 copies of every player and box scores for every season, for a very big league
//   BUILD=<worktree> [DUMP=<dir>] [SETTLE=ms] node tools/perf/wrapped/bench.cjs <profile dir> 3001 <label> <out.json>
//       times click -> first slide / first story (and -> the placeholder) for a first ever open, a new session, a second page in a session and reopening, and prints the worker's timing marks (src/worker/util/wrappedPerf.ts). SETTLE is how long to leave the first session open so that what it saves can finish.
//   BUILD=<worktree> node tools/perf/wrapped/outputs.cjs <profile dir> <label>; node tools/perf/wrapped/cmp.cjs <label a> <label b>
//       dumps what the views return for every page (DUMP dir) and checks two builds or sessions return exactly the same.
//
// usage: node bench.cjs <profileDir> <port> <label> [outJson]
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");
const { install } = require("./route.cjs");
const BUILD = process.env.BUILD;
const [profile, port, label, outFile] = process.argv.slice(2);
const BASE = `http://localhost:3001/l/1`;
const SLIDE = ".wrapped-slide";
const STORY = ".card.h-100 .card-title, [data-story]";
(async () => {
	const results = [];
	const launch = async () => {
		const ctx = await chromium.launchPersistentContext(profile, {
			executablePath: process.env.CHROME,
			viewport: { width: 1280, height: 900 },
		});
		await install(ctx, BUILD + "/build");
		const page = ctx.pages()[0] || (await ctx.newPage());
		page.setDefaultTimeout(600000);
		return { ctx, page };
	};
	const workerMarks = async (page, clear) => {
		for (const w of page.workers()) {
			try {
				const m = await w.evaluate((clear) => {
					const a = self.__wperf;
					if (!a) {
						return null;
					}
					const out = a.slice();
					if (clear) {
						a.length = 0;
					}
					return out;
				}, clear);
				if (m) {
					return m;
				}
			} catch {}
		}
		return [];
	};
	const setOn = async (page) => {
		for (const w of page.workers()) {
			try {
				await w.evaluate(() => {
					self.__wperfOn = true;
				});
			} catch {}
		}
	};
	const nav = async (page, path, sel) => {
		await setOn(page);
		await workerMarks(page, true);
		// Timed in the page, polling every few ms, since waitForSelector polls every 500 ms once it has waited a while
		const r = await page.evaluate(
			({ url, sel }) =>
				new Promise((resolve) => {
					const t0 = performance.now();
					let first;
					const a = document.createElement("a");
					a.href = url;
					document.body.append(a);
					a.click();
					a.remove();
					const iv = setInterval(() => {
						const now = performance.now() - t0;
						if (
							first === undefined &&
							document.querySelector("[data-loading]")
						) {
							first = now;
						}
						if (document.querySelector(sel)) {
							clearInterval(iv);
							resolve({ ms: now, first: first ?? now });
						}
					}, 4);
				}),
			{ url: BASE + path, sel },
		);
		const ms = Math.round(r.ms);
		const first = Math.round(r.first);
		await page.waitForTimeout(300);
		const marks = (await workerMarks(page, true)).map(
			(m) => `${m.name}=${Math.round(m.ms)}`,
		);
		if (process.env.DUMP) {
			for (const w of page.workers()) {
				try {
					const out = await w.evaluate(() =>
						self.__wperfOut ? Object.assign({}, self.__wperfOut) : null,
					);
					if (out) {
						for (const [k, v] of Object.entries(out)) {
							fs.writeFileSync(`${process.env.DUMP}/${label}-${k}.json`, v);
						}
					}
				} catch (error) {
					console.log("dump err", String(error).slice(0, 200));
				}
			}
		}
		return { ms, first, marks };
	};
	const scenarios = [
		["season", "/wrapped/season", SLIDE],
		["team", "/wrapped/team", SLIDE],
		["player", "/wrapped/player", SLIDE],
		["all", "/wrapped/all", SLIDE],
		["storylines", "/storylines", STORY],
	];
	const SETTLE = Number(process.env.SETTLE || 2500);
	// First ever: nothing in memory, nothing persisted
	{
		const { ctx, page } = await launch();
		await page.goto(BASE);
		await page.waitForSelector(".navbar");
		await page.waitForTimeout(4000);
		await page.evaluate(
			() =>
				new Promise((res) => {
					const r = indexedDB.deleteDatabase("wrapped-cache");
					r.onsuccess = r.onerror = r.onblocked = () => res();
				}),
		);
		const r = await nav(page, "/wrapped/season", SLIDE);
		results.push({ label, kind: "first-ever", name: "season", ...r });
		console.log(
			label,
			"first-ever",
			"season",
			r.ms,
			"feedback",
			r.first,
			r.marks.join(" "),
		);
		await page.waitForTimeout(SETTLE);
		await ctx.close();
	}
	// Cold: fresh browser (fresh worker, nothing in memory) for each page
	for (const [name, path, sel] of scenarios) {
		const { ctx, page } = await launch();
		await page.goto(BASE);
		await page.waitForSelector(".navbar");
		await page.waitForTimeout(4000);
		const r = await nav(page, path, sel);
		results.push({ label, kind: "cold", name, ...r });
		console.log(
			label,
			"cold",
			name,
			r.ms,
			"feedback",
			r.first,
			r.marks.join(" "),
		);
		await ctx.close();
	}
	// Warm: one session, open everything then re-open
	{
		const { ctx, page } = await launch();
		await page.goto(BASE);
		await page.waitForSelector(".navbar");
		await page.waitForTimeout(4000);
		for (const [name, path, sel] of [
			...scenarios,
			["season", "/wrapped/season", SLIDE],
			["team", "/wrapped/team", SLIDE],
			["all", "/wrapped/all", SLIDE],
			["storylines", "/storylines", STORY],
		]) {
			// navigate away first so the same route re-opens
			await page.evaluate((url) => {
				const a = document.createElement("a");
				a.href = url;
				document.body.append(a);
				a.click();
				a.remove();
			}, BASE + "/standings");
			await page.waitForTimeout(1500);
			const r = await nav(page, path, sel);
			results.push({ label, kind: "session", name, ...r });
			console.log(
				label,
				"session",
				name,
				r.ms,
				"feedback",
				r.first,
				r.marks.join(" "),
			);
		}
		await ctx.close();
	}
	if (outFile) {
		fs.writeFileSync(outFile, JSON.stringify(results, null, 1));
	}
})();
