// @ts-nocheck
/* eslint-disable no-undef */
// archskill (reading 29): the name counts on a generated league and its draft class, for the before / after of a reading:
// every player read fresh (no last-season label), with the league's own norms (rating and noun tables), as the game
// reads them after a version bump.
//   RUN_R29=<out prefix> [R29_N=450] [R29_SEED=r29] npx vitest --run --project basketball src/common/archetypes/v2/reading29.script.test.ts
// Writes <prefix>.league.csv and <prefix>.draft.csv (pos, ovr, pot, age, label) and prints the summary.
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL } from "../../budgetLevels.ts";
import { Rng } from "../../ratingsBuilds/rng.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../../worker/util/index.ts";
import develop from "../../../worker/core/player/develop.ts";
import generate from "../../../worker/core/player/generate.ts";
import ovrOf from "../../../worker/core/player/ovr.ts";
import { RATING_KEYS } from "../../ratingsBuilds/solver.ts";
import { EXPANDED_RATINGS2 } from "../../expandedRatings.ts";
import { generateTraitSeeds } from "../../playerTraits/seeds.ts";
import { traitScores } from "../../playerTraits/scores.ts";
import { TRAIT_DEFINITIONS } from "../../playerTraits/index.ts";
import { classifyV2 } from "./engine.ts";
import { defaultNormsFor } from "../classify.ts";
import { ratingQuantiles } from "./gateScale.ts";
import { nounGroupQuantiles } from "./nouns.ts";
import { parseComposedId } from "./grammar.ts";

const OUT = process.env.RUN_R29;

// (the names reading 28 gave for a lack of skill, a development stage or a one-skill player at low ovr)
export const HONEST_RE =
	/Camp Body|Empty-Calorie|Developing|\bRaw\b|Project|Prospect|Rotation Filler|Journeyman|Filler|Late Bloomer|Lottery|Tools|Specialist|Only|One-Trick|Garbage|Gunner$|Streaky|Deep Bench|Bench Bomber|Corner Merchant|Hound|Pest$|Gnat|Glove|Garbage Man|Slow-Motion|Earthbound|Without a Jumper|Hustle Guy|Effort|Connector$|Depth|Body$|Big Body|All Legs|Raw Athlete|Track Star|Unpolished|Work in Progress|Long Shot|Upside|Lump/;

const ratingsOf = (row: any) => {
	const out: any = {};
	for (const k of RATING_KEYS) {
		out[k] = row[k];
	}
	if (typeof row.wng === "number") {
		out.wng = row.wng;
		out.pdef = row.pdef;
		out.idef = row.idef;
		for (const k of EXPANDED_RATINGS2) {
			if (typeof row[k] === "number") {
				out[k] = row[k];
			}
		}
	}
	if (Array.isArray(row.sub)) {
		out.sub = row.sub;
	}
	return out;
};

const make = async (n: number, seed: string, prospects: boolean) => {
	const rng = new Rng(seed);
	const out: any[] = [];
	let i = 0;
	while (out.length < n) {
		const k = prospects ? 0 : rng.int(0, 13);
		const age = prospects ? rng.int(19, 22) : 19 + k;
		const p = generate(-1, age - k, 2025 - k, false, DEFAULT_LEVEL);
		await develop(p as any, k, true);
		const row = p.ratings.at(-1) as any;
		const o = ovrOf(row);
		if (!prospects && o < 38) {
			continue;
		}
		const ratings = ratingsOf(row);
		const sc = traitScores(ratings, generateTraitSeeds(seed, i++), {
			age,
			experience: prospects ? 0 : Math.max(0, k - 1),
		});
		const traits = Object.fromEntries(
			Object.entries(sc).filter(([t]) => t in TRAIT_DEFINITIONS),
		);
		out.push({
			ratings,
			ovr: o,
			pot: row.pot,
			pos: row.pos,
			age,
			prospect: prospects,
			traits,
		});
	}
	return out;
};

const summary = (title: string, rows: any[], labels: string[]) => {
	const n = rows.length;
	const freq = new Map<string, number>();
	for (const l of labels) {
		freq.set(l, (freq.get(l) ?? 0) + 1);
	}
	const top = [...freq].sort((a, b) => b[1] - a[1]);
	const honest = labels.filter((l) => HONEST_RE.test(l)).length;
	const pc = (a: number) => `${((100 * a) / n).toFixed(1)}%`;
	return [
		`== ${title}: ${n} players`,
		`distinct names ${top.length}, held by one ${top.filter(([, k]) => k === 1).length}, top ${top[0]![0]} ${pc(top[0]![1])}, top-10 share ${pc(top.slice(0, 10).reduce((s, [, k]) => s + k, 0))}`,
		`honest / development / depth names: ${honest} (${pc(honest)})`,
		`top 15: ${top
			.slice(0, 15)
			.map(([k, v]) => `${k} ${v}`)
			.join("; ")}`,
	].join("\n");
};

test.skipIf(!OUT)(
	"reading 29: names on a generated league and its draft class",
	async () => {
		const seed = process.env.R29_SEED ?? "r29";
		resetG();
		g.setWithoutSavingToDB("improvedPositions", true);
		g.setWithoutSavingToDB("subRatings", true);
		g.setWithoutSavingToDB("expandedRatings", true);
		const ratingsRng = new Rng(`${seed}-random`);
		const random = Math.random;
		Math.random = () => ratingsRng.random();
		let league: any[];
		let draft: any[];
		try {
			league = await make(Number(process.env.R29_N ?? 450), seed, false);
			draft = await make(70, `${seed}-draft`, true);
		} finally {
			Math.random = random;
		}
		const nq = ratingQuantiles(league);
		const ng = nounGroupQuantiles(league);
		const read = (x: any) =>
			classifyV2(x.ratings, {
				norms: { ...defaultNormsFor(x.ratings), nq, ng },
				pos: x.pos,
				ovr: x.ovr,
				pot: x.pot,
				age: x.age,
				prospect: x.prospect,
				traits: x.traits,
			});
		const lc = league.map(read);
		const dc = draft.map(read);
		const ll = lc.map((c) => c.label);
		const dl = dc.map((c) => c.label);
		// (the kind of name: an honest / development / depth role, a trait or athletic-only name with no basketball skill)
		const kindOf = (c: any) => {
			const pc = parseComposedId(c.id);
			if (pc?.role.honest) {
				return "honest";
			}
			const sk = (c.reason?.skills ?? []).filter(
				(k: string) =>
					![
						"speed",
						"jump",
						"strength",
						"length",
						"transition",
						"motor",
					].includes(k),
			);
			return sk.length === 0 && !/Jack|^v2:s/.test(c.id) ? "no skill" : "skill";
		};
		// (each skill: how many labels name it)
		const usage = (cs: any[]) => {
			const m: Record<string, number> = {};
			for (const c of cs) {
				for (const k of new Set<string>(
					c.reason?.main ?? c.reason?.skills ?? [],
				)) {
					m[k] = (m[k] ?? 0) + 1;
				}
			}
			return `skills named: ${Object.entries(m)
				.sort((a, b) => b[1] - a[1])
				.map(([k, v]) => `${k} ${v}`)
				.join(", ")}`;
		};
		const kinds = (cs: any[]) => {
			const m: Record<string, number> = {};
			for (const c of cs) {
				m[kindOf(c)] = (m[kindOf(c)] ?? 0) + 1;
			}
			return `kinds: ${JSON.stringify(m)}`;
		};
		const csv = (rows: any[], labels: string[], ids: string[]) =>
			[
				"pos,ovr,pot,age,id,label",
				...rows.map(
					(x, i) =>
						`${x.pos},${x.ovr},${x.pot},${x.age},${ids[i]},"${labels[i]}"`,
				),
			].join("\n") + "\n";
		writeFileSync(
			`${OUT}.league.csv`,
			csv(
				league,
				ll,
				lc.map((c) => c.id),
			),
		);
		writeFileSync(
			`${OUT}.draft.csv`,
			csv(
				draft,
				dl,
				dc.map((c) => c.id),
			),
		);
		const bottom = draft
			.map((x, i) => ({ x, l: dl[i] }))
			.sort((a, b) => a.x.ovr - b.x.ovr || a.x.pot - b.x.pot)
			.slice(0, 20);
		const text = [
			summary("league", league, ll),
			kinds(lc),
			usage(lc),
			summary("draft class", draft, dl),
			kinds(dc),
			usage(dc),
			"== draft class, bottom 20 by ovr:",
			...bottom.map(
				(b) =>
					`  ${b.x.pos} ovr ${b.x.ovr} pot ${b.x.pot} age ${b.x.age}: ${b.l}`,
			),
		].join("\n");
		writeFileSync(`${OUT}.txt`, text + "\n");
		console.log(text);
	},
	1_200_000,
);
