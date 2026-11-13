/* eslint-disable no-undef, curly */
// @ts-nocheck
// arch15: the gap analysis (RUN_ARCHETYPE_GAPS=1, ARCH_GAPS_OUT=file). Players the reading fits poorly (poor fit, or a weak
// fit with low confidence) in a random league, veterans, draft prospects and the real NBA 2016-2025, all with sub-ratings
// (Sub-Ratings on), clustered by position group, their two standout skill classes (score.ts classValues) and their most
// distinctive sub-rating feature (subStyle.ts), with each cluster's current labels, examples and mean shape. Recurring roles
// no build names become new builds (customDefs.data.ts).
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import { resetG } from "../../test/helpers.ts";
import develop from "../../worker/core/player/develop.ts";
import generate from "../../worker/core/player/generate.ts";
import ovrFn from "../../worker/core/player/ovr.ts";
import { ensureSubs } from "../../worker/core/player/subRatings.ts";
import { g } from "../../worker/util/index.ts";
import { classify, defaultNorms, isPoorFit } from "./classify.ts";
import { positionFor } from "./position.ts";
import { POS_GROUP } from "./posNames.ts";
import { classValues, prepare, SKILL_CLASSES } from "./score.ts";
import { realData, realNorms, realPlayer } from "./real.testutil.ts";

const NORMS = defaultNorms(false);
const LOW_CONF = 0.15;
const LOW_FIT = 0.3;

const gen = async (n, seed, minAge, maxAge, minOvr) => {
	resetG();
	g.setWithoutSavingToDB("improvedPositions", true);
	g.setWithoutSavingToDB("subRatings", true);
	const rr = new Rng(`${seed}-random`);
	const orig = Math.random;
	Math.random = () => rr.random();
	const out = [];
	try {
		const rng = new Rng(seed);
		while (out.length < n) {
			const k = rng.int(minAge - 19, maxAge - 19);
			const p = generate(-1, 19, 2025 - k, false, DEFAULT_LEVEL);
			if (k > 0) await develop(p, k, true);
			else ensureSubs(p);
			const row = p.ratings.at(-1);
			const o = ovrFn(row);
			if (o < minOvr) continue;
			const r = {};
			for (const key of RATING_KEYS) r[key] = row[key];
			if (row.sub) r.sub = row.sub;
			out.push({ ratings: r, ovr: o, age: 19 + k });
		}
	} finally {
		Math.random = orig;
	}
	return out;
};

test.skipIf(!process.env.RUN_ARCHETYPE_GAPS)(
	"gap analysis",
	async () => {
		const pops = {
			league: await gen(3000, "gaps-league", 19, 32, 38),
			vets: await gen(1000, "gaps-vets", 32, 37, 38),
			pros: (await gen(1000, "gaps-pros", 19, 19, 40)).map((p) => ({
				...p,
				prospect: true,
				age: undefined,
			})),
		};
		const data = realData();
		pops.real = data.d.ratings
			.filter((r) => r.season >= 2016 && r.season <= 2025)
			.map((r) => realPlayer(data, r));
		const rn = realNorms(NORMS, false);
		const clusters = {};
		const totals = {};
		const flagged = {};
		for (const [pop, ps] of Object.entries(pops)) {
			totals[pop] = ps.length;
			for (const p of ps) {
				const pos = p.pos ?? positionFor(p.ratings, true);
				const norms = p.slug ? rn : NORMS;
				const read = { age: p.age, stats: p.stats, prospect: p.prospect };
				const c = classify(p.ratings, { norms, pos, ...read });
				const weak =
					isPoorFit(c) || (c.confidence < LOW_CONF && c.fit < LOW_FIT);
				if (!weak) continue;
				flagged[pop] = (flagged[pop] ?? 0) + 1;
				const pr = prepare(p.ratings, norms, { ...read, pos });
				const cv = classValues(pr);
				const cls = Object.keys(SKILL_CLASSES)
					.map((k) => [k, cv[k]])
					.sort((x, y) => y[1] - x[1]);
				const top = cls
					.slice(0, 2)
					.map(([k]) => k)
					.sort();
				const sub = pr.style.sub;
				const subTop = sub
					? Object.entries(sub).sort(
							(x, y) => Math.abs(y[1]) - Math.abs(x[1]),
						)[0]
					: undefined;
				const subKey = subTop
					? `${subTop[1] > 0 ? "+" : "-"}${subTop[0]}`
					: "none";
				const key = process.env.ARCH_GAPS_FINE
					? `${POS_GROUP[pos]}|${top.join("+")}|${subKey}`
					: `${POS_GROUP[pos]}|${top.join("+")}`;
				const e = (clusters[key] ??= {
					n: 0,
					pops: {},
					labels: {},
					ex: [],
					cv: {},
					sub: {},
					lvl: 0,
				});
				e.n++;
				e.pops[pop] = (e.pops[pop] ?? 0) + 1;
				e.labels[c.name] = (e.labels[c.name] ?? 0) + 1;
				e.lvl += pr.pzLevel;
				for (const [k, v] of cls) e.cv[k] = (e.cv[k] ?? 0) + v;
				if (sub)
					for (const [k, v] of Object.entries(sub))
						e.sub[k] = (e.sub[k] ?? 0) + v;
				if (e.ex.length < 4 && (p.name || e.ex.length < 2))
					e.ex.push(
						`${p.name ?? pop} (${pos}, hgt ${p.ratings.hgt}, ovr ${p.ovr}) -> ${c.name} (fit ${c.fit}, conf ${c.confidence}${isPoorFit(c) ? ", poor" : ""})`,
					);
			}
		}
		const lines = [
			`flagged (poor fit, or fit < ${LOW_FIT} with confidence < ${LOW_CONF}): ${Object.entries(
				flagged,
			)
				.map(([k, v]) => `${k} ${v}/${totals[k]}`)
				.join(", ")}`,
			"",
		];
		for (const [key, e] of Object.entries(clusters)
			.sort((x, y) => y[1].n - x[1].n)
			.slice(0, 45)) {
			const r2 = (x) => (x / e.n).toFixed(2);
			lines.push(
				`${key}: ${e.n} (${Object.entries(e.pops)
					.map(([k, v]) => `${k} ${v}`)
					.join(", ")}), level ${r2(e.lvl)}`,
				`  classes: ${Object.entries(e.cv)
					.sort((x, y) => y[1] - x[1])
					.map(([k, v]) => `${k} ${r2(v)}`)
					.join(", ")}`,
				`  subs: ${Object.entries(e.sub)
					.filter(([, v]) => Math.abs(v / e.n) >= 0.5)
					.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
					.map(([k, v]) => `${k} ${r2(v)}`)
					.join(", ")}`,
				`  now: ${Object.entries(e.labels)
					.sort((x, y) => y[1] - x[1])
					.slice(0, 4)
					.map(([k, v]) => `${k} ${v}`)
					.join(", ")}`,
				`  ex: ${e.ex.join("; ")}`,
				"",
			);
		}
		writeFileSync(
			process.env.ARCH_GAPS_OUT ?? "/tmp/arch-gaps.txt",
			lines.join("\n"),
		);
	},
	1800000,
);
