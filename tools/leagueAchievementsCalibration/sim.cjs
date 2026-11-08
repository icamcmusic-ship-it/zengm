// Sims a new random-players basketball league season by season in a headless browser and records the League achievements tally (bbgm.leagueAchievementsTally, see src/worker/util/leagueAchievements.ts) after every completed season. The output is the input of calibrate.ts.
//
//   node --run dev   (a dev server, basketball, on PORT)
//   PORT=3000 CHROME=/path/to/chrome PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
//     node tools/leagueAchievementsCalibration/sim.cjs <out.json> <seasons> [seed label]
//
// Box scores of every season are kept (saveOldBoxScores: all), so game-based tiers are measured on every season.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs");

const [out, N0, label = "league"] = process.argv.slice(2);
const N = Number(N0);
const BASE = `http://localhost:${process.env.PORT || 3000}`;

const log = (...a) =>
	console.log(new Date().toISOString().slice(11, 19), label, ...a);

(async () => {
	const browser = await chromium.launch({
		executablePath: process.env.CHROME,
		args: ["--disable-dev-shm-usage"],
	});
	const ctx = await browser.newContext({
		viewport: { width: 1280, height: 900 },
	});
	// A dedicated worker, so its global (bbgm) can be reached
	await ctx.addInitScript(() => {
		delete window.SharedWorker;
	});
	const page = await ctx.newPage();
	page.setDefaultTimeout(600000);
	const errors = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	await page.goto(BASE + "/new_league/random");
	await page.waitForTimeout(4000);
	await page.locator("button[type=submit]").first().click();
	await page.waitForURL(/\/l\/\d+/, { timeout: 300000 });
	await page.waitForTimeout(3000);
	const worker = page.workers()[0];
	const w = (fn, arg) => worker.evaluate(fn, arg);
	await w(async () => {
		await self.bbgm.league.setGameAttributes({
			saveOldBoxScores: {
				pastSeasons: "all",
				pastSeasonsType: "all",
				note: "all",
			},
		});
	});
	const start = await w(() => self.bbgm.g.get("season"));
	log("start", start);
	const seasons = [];
	for (let i = 0; i < N; i++) {
		const target = start + i + 1;
		const t0 = Date.now();
		await w(
			(target) =>
				new Promise((resolve, reject) => {
					self.bbgm.local.autoPlayUntil = {
						resolve,
						reject,
						season: target,
						phase: 0,
						start: Date.now(),
					};
					self.bbgm.league.autoPlay({});
				}),
			target,
		);
		const t1 = Date.now();
		const tally = await w(() => self.bbgm.leagueAchievementsTally());
		seasons.push({ season: target - 1, tally });
		const unlocked = Object.values(tally.tiers).filter(
			(x) => x.s === "u",
		).length;
		log(
			`season ${target - 1} done: sim ${Math.round((t1 - t0) / 1000)}s, engine ${Math.round((Date.now() - t1) / 1000)}s, ${unlocked} unlocked, errors ${errors.length}`,
		);
		fs.writeFileSync(
			out,
			JSON.stringify({ label, start, seasons, errors: errors.slice(0, 20) }),
		);
	}
	await browser.close();
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
