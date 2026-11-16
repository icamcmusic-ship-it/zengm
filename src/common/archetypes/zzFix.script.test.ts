// @ts-nocheck
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { ARCHETYPES, classify, defaultNorms, scoreAll } from "./classify.ts";
import { isGenericBuild } from "./generic.ts";
import { realData, realNorms, realPlayer } from "./real.testutil.ts";
import { sampleLeague } from "./sample.testutil.ts";
import { positionFor } from "./position.ts";
import { peerPct } from "./v2/tests.ts";
import { classifyV2 } from "./v2/engine.ts";
import { BUCKET_OF } from "./v2/knn.ts";

const ATH = /High[ -]Fly|Aerial|Glide|Athletic|Athlete|Explosive|Force of Nature|Bouncy|Apex|Burner|Open-Lane|Wing[ -]Run|Rim[ -]Run|Speedy/;
test.skipIf(!process.env.RUN_ZZ)("fix metrics", async () => {
	const out = [];
	const n0 = defaultNorms(false);
	const rn = realNorms(n0, false);
	const data = realData();
	const real = data.d.ratings
		.filter((r) => r.season >= 2016 && r.season <= 2025)
		.map((r) => realPlayer(data, r));
	const gen = await sampleLeague(3000, "zz-fix", 19, 32, false);
	for (const p of gen) p.pos = positionFor(p.ratings, true);
	for (const [label, ps, norms] of [
		["random league", gen, n0],
		["real 2016-2025", real, rn],
	]) {
		const gap = {};
		let athN = 0, athBad = 0, shooters = 0, shGen = 0, cmp = 0, cmpBig = 0, cut = 0;
		for (const p of ps) {
			const r = { norms, pos: p.pos, age: p.age, stats: p.stats };
			const c = classifyV2(p.ratings, { ...r, srID: p.slug });
			const gid = ["glue-wing", "glue-guard", "steady-game-manager", "energy-big"].find((g) => c.id === g || c.id.includes(`:${g === "glue-wing" ? "glueWing" : g === "glue-guard" ? "glueGuard" : g === "steady-game-manager" ? "gameManager" : "energyBig"}:`));
			if (gid) (gap[gid] ??= []).push(p.name ?? `ovr ${p.ovr}`);
			const s = scoreAll(p.ratings, norms, ARCHETYPES, p.pos, undefined, r);
			const b = BUCKET_OF[s.pos];
			if (ATH.test(c.name)) {
				athN++;
				if (peerPct(b, "ath", s.cv.ath) < 0.5) athBad++;
			}
			if (peerPct(b, "shoot", s.cv.shoot) >= 0.8 || peerPct(b, "mid", s.cv.mid) >= 0.8) {
				shooters++;
				if (isGenericBuild({ id: c.id })) shGen++;
			}
			if (c.id === "crafty-mid-post-scorer" || c.id === "mid-post-bucket-getter") {
				cmp++;
				if (["PF", "FC"].includes(s.pos)) cmpBig++;
			}
			if (/Cutter/.test(c.name)) cut++;
		}
		const pc = (a, n) => `${((100 * a) / n).toFixed(2)}%`;
		out.push(`${label} (n=${ps.length}): A athletic names ${pc(athN, ps.length)}, of them below his position's median athleticism ${pc(athBad, athN)}; C shooters (three or mid top 20%) on generic builds ${pc(shGen, shooters)} (n=${shooters}); B mid-post builds ${cmp} (PF/FC ${cmpBig}); D cutter names ${pc(cut, ps.length)}; gap builds ${Object.entries(gap).map(([k, v]) => `${k} ${pc(v.length, ps.length)} e.g. ${v.slice(0, 4).join(", ")}`).join("; ")}`);
	}
	for (const [slug, season] of [["brandel01", 2006], ["aldrila01", 2015], ["antetgi01", 2025], ["doncilu01", 2025]]) {
		const row = data.d.ratings.find((x) => x.slug === slug && x.season === season);
		if (!row) { out.push(`${slug} ${season}: not found`); continue; }
		const p = realPlayer(data, row);
		const c = classifyV2(p.ratings, { norms: rn, pos: p.pos, age: p.age, stats: p.stats, srID: p.slug });
		out.push(`${p.name} (${p.pos}): ${c.name}`);
	}
	writeFileSync(process.env.RUN_ZZ, out.join("\n") + "\n");
}, 3600000);
