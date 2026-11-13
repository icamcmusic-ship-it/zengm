/* eslint-disable no-undef, curly */
// @ts-nocheck
// arch15: how sub-ratings sit around their bases (RUN_ARCHETYPE_SUBLEANS=1), for subLeans.data.ts: per sub, the mean and the
// standard deviation of (sub - base) over a generated league (Sub-Ratings on, developed draft classes, 19 to 32) and over real
// NBA players 2016-2025 (shapes from their stats). The archetype reading takes each sub's lean as (offset - mean) / sd, so a
// shape every generated player has (contact finishing a few points under dunks/layups) is no signal. ARCH_EXPANDED=1: with
// Expanded Ratings on (the subs then follow the expanded ratings).
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import { resetG } from "../../test/helpers.ts";
import develop from "../../worker/core/player/develop.ts";
import generate from "../../worker/core/player/generate.ts";
import ovrFn from "../../worker/core/player/ovr.ts";
import { ensureSubs } from "../../worker/core/player/subRatings.ts";
import { g } from "../../worker/util/index.ts";
import { fillExpandedRatings } from "../expandedRatings.ts";
import { NUM_SUBS, SUB_DEFS } from "../subRatings.ts";
import {
	parseSubLean,
	realSubShape,
	seedFromString,
} from "../subRatingsGen.ts";
import { realData } from "./real.testutil.ts";

const EXPANDED = Boolean(process.env.ARCH_EXPANDED);

const stats = (rows) => {
	const mean = new Array(NUM_SUBS).fill(0);
	const sd = new Array(NUM_SUBS).fill(0);
	for (const o of rows) for (let i = 0; i < NUM_SUBS; i++) mean[i] += o[i];
	for (let i = 0; i < NUM_SUBS; i++) mean[i] /= rows.length;
	for (const o of rows)
		for (let i = 0; i < NUM_SUBS; i++) sd[i] += (o[i] - mean[i]) ** 2;
	for (let i = 0; i < NUM_SUBS; i++) sd[i] = Math.sqrt(sd[i] / rows.length);
	return { mean, sd };
};
const offsetsOf = (row) => row.sub.map((s, i) => s - row[SUB_DEFS[i].base]);

test.skipIf(!process.env.RUN_ARCHETYPE_SUBLEANS)(
	"sub leans",
	async () => {
		resetG();
		g.setWithoutSavingToDB("improvedPositions", true);
		g.setWithoutSavingToDB("subRatings", true);
		if (EXPANDED) g.setWithoutSavingToDB("expandedRatings", true);
		const rr = new Rng("subleans-random");
		const orig = Math.random;
		Math.random = () => rr.random();
		const gen = [];
		try {
			const rng = new Rng("subleans");
			while (gen.length < 4000) {
				const k = rng.int(0, 13);
				const p = generate(-1, 19, 2025 - k, false, DEFAULT_LEVEL);
				if (k > 0) await develop(p, k, true);
				else ensureSubs(p);
				const row = p.ratings.at(-1);
				if (ovrFn(row) < 38 || !row.sub) continue;
				gen.push(offsetsOf(row));
			}
		} finally {
			Math.random = orig;
		}
		const { d } = realData();
		if (EXPANDED) {
			const bySlug = {};
			for (const row of d.ratings) (bySlug[row.slug] ??= []).push(row);
			for (const [slug, rows] of Object.entries(bySlug)) {
				rows.sort((x, y) => x.season - y.season);
				fillExpandedRatings({ srID: slug, ratings: rows });
			}
		}
		const real = [];
		for (const row of d.ratings) {
			if (row.season < 2016 || row.season > 2025) continue;
			const lean = parseSubLean(row.subLean);
			if (!lean) continue;
			const { sub } = realSubShape(row, seedFromString(row.slug), lean);
			real.push(offsetsOf({ ...row, sub }));
		}
		const a = stats(gen);
		const b = stats(real);
		const r1 = (x) => Math.round(x * 10) / 10;
		const lines = SUB_DEFS.map(
			(s, i) =>
				`${s.key}\tgen ${r1(a.mean[i])} sd ${r1(a.sd[i])}\treal ${r1(b.mean[i])} sd ${r1(b.sd[i])}`,
		);
		writeFileSync(
			process.env.ARCH_SUBLEANS_OUT ?? "/tmp/subleans.txt",
			`generated n=${gen.length}, real n=${real.length}, expanded ${EXPANDED}\n${lines.join("\n")}\nGEN=${JSON.stringify({ mean: a.mean.map(r1), sd: a.sd.map(r1) })}\nREAL=${JSON.stringify({ mean: b.mean.map(r1), sd: b.sd.map(r1) })}\n`,
		);
	},
	1200000,
);
