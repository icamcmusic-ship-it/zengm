// usage: BUILD=... node outputs.cjs <profile> <label> : opens each page once in one session and dumps what the views returned
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { install } = require("./route.cjs");
const fs = require("node:fs");
(async () => {
	const [profile, label] = process.argv.slice(2);
	const ctx = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROME, viewport: { width: 1280, height: 900 } });
	await install(ctx, process.env.BUILD + "/build");
	const page = ctx.pages()[0] || (await ctx.newPage());
	page.setDefaultTimeout(900000);
	await page.goto("http://localhost:3001/l/1");
	await page.waitForSelector(".navbar");
	await page.waitForTimeout(3000);
	const w = page.workers()[0];
	await w.evaluate(() => { self.__wperfOn = true; });
	const go = async (path, sel) => {
		await page.evaluate((u) => { const a = document.createElement("a"); a.href = u; document.body.append(a); a.click(); }, "/l/1" + path);
		await page.waitForSelector(sel);
		await page.waitForTimeout(500);
	};
	for (const [path, sel] of [["/wrapped/season", ".wrapped-slide"], ["/wrapped/team", ".wrapped-slide"], ["/wrapped/player", ".wrapped-slide"], ["/wrapped/all", ".wrapped-slide"], ["/storylines", ".card.h-100 .card-title"]]) {
		await go("/standings", ".navbar");
		await page.waitForTimeout(1000);
		await go(path, sel);
	}
	const out = await w.evaluate(() => Object.assign({}, self.__wperfOut));
	for (const [k, v] of Object.entries(out)) {fs.writeFileSync(`dump/${label}-${k}.json`, v);}
	console.log(label, Object.keys(out).join(","), Object.values(out).map((v) => v.length).join(","));
	await ctx.close();
})();
