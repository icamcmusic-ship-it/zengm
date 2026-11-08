// usage: node setup.cjs <profileDir> <port> <numSeasonsToAdd> [existingLid]
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { install } = require("./route.cjs");
const BUILD = process.env.BUILD;
const [profile, port, N0, lid0] = process.argv.slice(2);
const BASE = `http://localhost:3001`;
(async () => {
	const browser = await chromium.launchPersistentContext(profile, {
		executablePath: process.env.CHROME,
		viewport: { width: 1280, height: 900 },
	});
	await install(browser, BUILD + "/build");
	const page = browser.pages()[0] || (await browser.newPage());
	const errors = [];
	page.on("pageerror", (e) => errors.push(String(e)));
	let lid = lid0;
	if (!lid) {
		await page.goto(BASE + "/new_league");
		await page.waitForTimeout(5000);
		await page.locator("button[type=submit]").first().click();
		await page.waitForURL(/\/l\/\d+/, { timeout: 180000 });
		lid = page.url().match(/\/l\/(\d+)/)[1];
	} else {
		await page.goto(BASE + `/l/${lid}`);
	}
	console.log("lid", lid);
	await page.waitForTimeout(4000);
	const N = Number(N0);
	await page.evaluate(() => {
		const el = [...document.querySelectorAll("a,button")].find(
			(e) => e.textContent.trim() === "Auto Play",
		);
		el.click();
	});
	await page.waitForTimeout(1500);
	const season0 = Number(
		(await page.innerText(".navbar")).match(/(20\d\d)/)[1],
	);
	await page
		.locator(".modal input.form-control")
		.first()
		.fill(String(season0 + N));
	await page.locator(".modal .btn-primary").click();
	const target = season0 + N;
	const t0 = Date.now();
	while (Date.now() - t0 < 7200000) {
		await page.waitForTimeout(15000);
		const t = await page.innerText(".navbar").catch(() => "");
		const m = t.match(
			/(20\d\d) (preseason|regular season|playoffs|draft|free agency|after playoffs|expansion draft|re-signing)/i,
		);
		console.log(
			Math.round((Date.now() - t0) / 1000),
			m && m[0],
			"errs",
			errors.length,
		);
		if (m && Number(m[1]) >= target) {
			break;
		}
	}
	await page.waitForTimeout(3000);
	console.log("errors", JSON.stringify(errors.slice(0, 10)));
	console.log("LID=" + lid);
	await browser.close();
})();
