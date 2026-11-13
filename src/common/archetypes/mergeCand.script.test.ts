/* eslint-disable no-undef, curly */
// @ts-nocheck
// arch15: merge candidates (RUN_ARCHETYPE_MERGECAND=1, written to ARCH_MERGECAND_OUT as JSON and a readable list). For every
// pair of builds of the same family: how often the reading cannot tell them apart (the two are its top two within TIE_Z for a
// player who holds either), the cosine of their profiles over the reading's dimensions, of their sub-rating and play-type
// wants (subStyle.ts), and whether they promise the same skills. Populations: a random league (Sub-Ratings on) and the real
// NBA 2016-2025 (shapes from their stats), both read as the game reads them.
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
import { ARCHETYPES, defaultNorms, scoreAll } from "./classify.ts";
import { DIMS } from "./composites.ts";
import { familyOf } from "./families.ts";
import { positionFor } from "./position.ts";
import { promisesOf } from "./score.ts";
import { buildWants } from "./subStyle.ts";
import { realData, realNorms, realPlayer } from "./real.testutil.ts";

const TIE_Z = 0.15;
const NORMS = defaultNorms(false);

const genLeague = async (n, seed) => {
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
			const k = rng.int(0, 13);
			const p = generate(-1, 19, 2025 - k, false, DEFAULT_LEVEL);
			if (k > 0) await develop(p, k, true);
			else ensureSubs(p);
			const row = p.ratings.at(-1);
			if (ovrFn(row) < 38) continue;
			const r = {};
			for (const key of RATING_KEYS) r[key] = row[key];
			if (row.sub) r.sub = row.sub;
			out.push({ ratings: r, age: 19 + k, pos: positionFor(r, true) });
		}
	} finally {
		Math.random = orig;
	}
	return out;
};

const cos = (a, b, keys) => {
	let ab = 0,
		aa = 0,
		bb = 0;
	for (const k of keys) {
		const x = a[k] ?? 0,
			y = b[k] ?? 0;
		ab += x * y;
		aa += x * x;
		bb += y * y;
	}
	return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
};

test.skipIf(!process.env.RUN_ARCHETYPE_MERGECAND)(
	"merge candidates",
	async () => {
		const league = await genLeague(3000, "mergecand-league");
		const data = realData();
		const real = data.d.ratings
			.filter((r) => r.season >= 2016 && r.season <= 2025)
			.map((r) => realPlayer(data, r));
		const rn = realNorms(NORMS, false);
		const holders = {};
		const ties = {};
		const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
		for (const [pop, ps] of [
			["league", league],
			["real", real],
		]) {
			for (const p of ps) {
				const s = scoreAll(
					p.ratings,
					pop === "real" ? rn : NORMS,
					ARCHETYPES,
					p.pos,
					undefined,
					{ age: p.age, stats: p.stats },
				).scored;
				const a = s[0].a.id;
				holders[a] = (holders[a] ?? 0) + 1;
				if (s[0].z - s[1].z < TIE_Z) {
					const k = pairKey(a, s[1].a.id);
					ties[k] = (ties[k] ?? 0) + 1;
				}
			}
		}
		const subKeys = new Set();
		const ptKeys = new Set();
		for (const a of ARCHETYPES) {
			for (const [k] of buildWants(a).sub) subKeys.add(k);
			for (const [k] of buildWants(a).pt) ptKeys.add(k);
		}
		const rows = [];
		for (let i = 0; i < ARCHETYPES.length; i++) {
			for (let j = i + 1; j < ARCHETYPES.length; j++) {
				const a = ARCHETYPES[i],
					b = ARCHETYPES[j];
				if (familyOf(a) !== familyOf(b)) continue;
				const ha = holders[a.id] ?? 0,
					hb = holders[b.id] ?? 0;
				const t = ties[pairKey(a.id, b.id)] ?? 0;
				const pa = [...promisesOf(a).all].sort().join("+");
				const pb = [...promisesOf(b).all].sort().join("+");
				const wa = Object.fromEntries(buildWants(a).sub);
				const wb = Object.fromEntries(buildWants(b).sub);
				const xa = Object.fromEntries(buildWants(a).pt);
				const xb = Object.fromEntries(buildWants(b).pt);
				const posOverlap =
					a.positions.filter((p) => b.positions.includes(p)).length /
					Math.min(a.positions.length, b.positions.length);
				rows.push({
					a: a.id,
					b: b.id,
					an: a.name,
					bn: b.name,
					fam: familyOf(a),
					ha,
					hb,
					tie: t,
					tieRate: t / Math.max(1, Math.min(ha, hb)),
					cosW: Math.round(1000 * cos(a.w, b.w, DIMS)) / 1000,
					cosSub: Math.round(1000 * cos(wa, wb, [...subKeys])) / 1000,
					cosPt: Math.round(1000 * cos(xa, xb, [...ptKeys])) / 1000,
					samePromise: pa === pb,
					pa,
					pb,
					posOverlap: Math.round(100 * posOverlap) / 100,
					posA: a.positions.join("/"),
					posB: b.positions.join("/"),
				});
			}
		}
		rows.sort((x, y) => y.cosW + y.tieRate - (x.cosW + x.tieRate));
		const out = process.env.ARCH_MERGECAND_OUT ?? "/tmp/mergecand";
		writeFileSync(
			`${out}.json`,
			JSON.stringify({ holders, n: league.length + real.length, rows }),
		);
		writeFileSync(
			`${out}.txt`,
			rows
				.slice(0, 400)
				.map(
					(r) =>
						`${r.cosW.toFixed(2)} tie ${r.tieRate.toFixed(2)} (${r.tie}) sub ${r.cosSub.toFixed(2)} pt ${r.cosPt.toFixed(2)} ${r.samePromise ? "SAME" : "diff"} pos ${r.posOverlap} | ${r.an} [${r.ha}, ${r.posA}] ~ ${r.bn} [${r.hb}, ${r.posB}] (${r.fam}; ${r.pa} / ${r.pb})`,
				)
				.join("\n") + "\n",
		);
	},
	1800000,
);
