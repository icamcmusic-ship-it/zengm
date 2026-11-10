// @ts-nocheck
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import { fillExpandedRatings } from "../expandedRatings.ts";
import { classify, scoreAll, defaultNorms } from "./classify.ts";
import { prepare, needShortfall, classValues } from "./score.ts";
import { positionFor } from "./position.ts";
test("dbg", () => {
	const d = JSON.parse(readFileSync(new URL("../../../data/real-player-data.basketball.json", import.meta.url), "utf8"));
	const want = (process.env.DBG ?? "LeBron James 2025").split(";");
	const bySlug = {};
	for (const row of d.ratings) (bySlug[row.slug] ??= []).push(row);
	const lines = [];
	for (const w of want) {
		const season = Number(w.slice(-4));
		const name = w.slice(0, -5);
		const slug = Object.keys(d.bios).find((s) => d.bios[s].name === name);
		const rows = bySlug[slug].map((r) => ({ ...r })).sort((a, b) => a.season - b.season);
		for (const on of [false, true]) {
			const rs = rows.map((r) => ({ ...r }));
			if (on) fillExpandedRatings({ srID: slug, ratings: rs });
			const row = rs.find((r) => r.season === season);
			const r = {};
			for (const k of RATING_KEYS) r[k] = row[k];
			if (on) Object.assign(r, { wng: row.wng, pdef: row.pdef, idef: row.idef });
			const pos = positionFor(r, true);
			const age = season - d.bios[slug].bornYear;
			const norms = defaultNorms(on);
			const c = classify(r, { pos, age });
			const p = { ...prepare(r, norms), age };
			const sc = scoreAll(r, norms, undefined, pos, age);
			lines.push(`${w} ${on ? "ON" : "off"} ${pos} age${age} ${JSON.stringify(r)}`);
			lines.push(`  -> ${c.label}; level ${p.level.toFixed(2)}; cv ${Object.entries(classValues(p)).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" ")}`);
			lines.push(`  abs ${Object.entries(p.abs).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" ")}`);
			const ids = (process.env.DBG_IDS ?? "").split(",").filter(Boolean);
			for (const s of [...sc.scored.slice(0, 6), ...sc.scored.filter((x) => ids.includes(x.a.id))])
				lines.push(`    ${s.a.id} z ${s.z.toFixed(2)} raw ${s.raw.toFixed(3)} short ${needShortfall(s.a, p).toFixed(2)}`);
		}
	}
	console.log(lines.join("\n"));
});
