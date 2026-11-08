/* eslint-disable no-undef, curly, unicorn/prefer-single-call */
// @ts-nocheck
// Diagnostics for the archetype engine: position mismatches, confidence, true-vs-fuzzed agreement, year-to-year flapping and
// the distribution. Not part of the normal run: RUN_ARCHETYPE_DIAG=1 (writes /tmp/claude-0/arch-diag.txt)
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import { resetG } from "../../test/helpers.ts";
import develop from "../../worker/core/player/develop.ts";
import generate from "../../worker/core/player/generate.ts";
import ovrFn from "../../worker/core/player/ovr.ts";
import pos from "../../worker/core/player/pos.ts";
import { ARCHETYPES, classify } from "./classify.ts";
import { buildNorms } from "./match.ts";
import { DEFAULT_NORMS } from "./norms.data.ts";
import { sampleLeague } from "./sample.testutil.ts";

const HARD = {
	guard: ["F", "PF", "FC", "C"],
	wing: [],
	forward: ["PG", "G"],
	big: ["PG", "G", "SG", "GF"],
};
// Clearly odd but not forbidden
const SOFT = {
	guard: ["SF"],
	wing: ["FC", "C", "PG"],
	forward: ["SG"],
	big: ["SF"],
};

test.skipIf(!process.env.RUN_ARCHETYPE_DIAG)(
	"diag",
	async () => {
		const out: string[] = [];
		const sample = await sampleLeague(6000, "diag-v1");
		const league = buildNorms(sample.slice(0, 450), ARCHETYPES, DEFAULT_NORMS);
		league.bias = DEFAULT_NORMS.bias;
		const rng = new Rng("diag-fuzz");
		const run = (label, ratingsOf, norms) => {
			let hard = 0,
				soft = 0,
				conf = 0,
				hyb = 0;
			const byOvr = [0, 0, 0];
			const nOvr = [0, 0, 0];
			const tab = {};
			const counts = {};
			const ex = [];
			for (const p of sample) {
				const ps = pos(p.ratings);
				const c = classify(ratingsOf(p), { ovr: p.ovr, norms, pos: ps });
				counts[c.id] = (counts[c.id] ?? 0) + 1;
				tab[ps] ??= {};
				tab[ps][c.group] = (tab[ps][c.group] ?? 0) + 1;
				const t = p.ovr < 45 ? 0 : p.ovr < 55 ? 1 : 2;
				nOvr[t]++;
				if (HARD[c.group].includes(ps)) {
					hard++;
					byOvr[t]++;
					if (ex.length < 12)
						ex.push(`${ps} -> ${c.id} hgt${p.ratings.hgt} ovr${p.ovr}`);
				} else if (SOFT[c.group].includes(ps)) soft++;
				conf += c.confidence;
				if (c.secondary) hyb++;
			}
			const n = sample.length;
			out.push(
				`== ${label}: hard ${((100 * hard) / n).toFixed(2)}% soft ${((100 * soft) / n).toFixed(2)}% conf ${(conf / n).toFixed(3)} hybrid ${((100 * hyb) / n).toFixed(1)}% used ${Object.keys(counts).length}/${ARCHETYPES.length} hard-by-ovr(<45,45-55,55+) ${byOvr.map((x, i) => ((100 * x) / Math.max(1, nOvr[i])).toFixed(2)).join("/")}`,
			);
			out.push("pos x group " + JSON.stringify(tab));
			if (ex.length) out.push(ex.join("; "));
			return counts;
		};
		const fuzzed = (sd) => {
			const cache = new Map();
			return (p) => {
				if (!cache.has(p)) {
					const f = Math.max(-2 * sd, Math.min(2 * sd, rng.normal(0, sd)));
					const r = {};
					for (const k of RATING_KEYS)
						r[k] =
							k === "hgt"
								? p.ratings[k]
								: Math.round(Math.max(0, Math.min(100, p.ratings[k] + f)));
					cache.set(p, r);
				}
				return cache.get(p);
			};
		};
		const counts = run(
			"true ratings, reference norms",
			(p) => p.ratings,
			DEFAULT_NORMS,
		);
		run("true ratings, small-league norms", (p) => p.ratings, league);
		const f3 = fuzzed(3);
		run("fuzzed sd3, reference norms", f3, DEFAULT_NORMS);
		const f6 = fuzzed(6);
		run("fuzzed sd6 (prospects), reference norms", f6, DEFAULT_NORMS);
		// true vs fuzzed agreement
		let sameId = 0,
			sameGroup = 0,
			sameId6 = 0,
			sameGroup6 = 0;
		for (const p of sample) {
			const ps = pos(p.ratings);
			const a = classify(p.ratings, { pos: ps });
			const b = classify(f3(p), { pos: ps });
			const c = classify(f6(p), { pos: ps });
			if (a.id === b.id) sameId++;
			if (a.group === b.group) sameGroup++;
			if (a.id === c.id) sameId6++;
			if (a.group === c.group) sameGroup6++;
		}
		const n = sample.length;
		out.push(
			`true vs fuzzed: sd3 same archetype ${((100 * sameId) / n).toFixed(1)}% same group ${((100 * sameGroup) / n).toFixed(1)}%; sd6 same archetype ${((100 * sameId6) / n).toFixed(1)}% same group ${((100 * sameGroup6) / n).toFixed(1)}%`,
		);
		// Flapping: the same players season after season, with stickiness as the game uses it
		resetG();
		const rng2 = new Rng("diag-flap");
		let changes = 0,
			steps = 0,
			groupChanges = 0;
		for (let i = 0; i < 1500; i++) {
			const p = generate(-1, 19, 2025 - rng2.int(0, 6), false, DEFAULT_LEVEL);
			await develop(p, rng2.int(0, 6), true);
			let prev;
			for (let y = 0; y < 5; y++) {
				await develop(p, 1, false);
				const row = p.ratings.at(-1);
				if (ovrFn(row) < 38) continue;
				const r = {};
				for (const k of RATING_KEYS) r[k] = row[k];
				const c = classify(r, { previousId: prev?.id, pos: pos(r) });
				if (prev) {
					steps++;
					if (prev.id !== c.id) changes++;
					if (prev.group !== c.group) groupChanges++;
				}
				prev = c;
			}
		}
		out.push(
			`flapping: archetype changes ${((100 * changes) / steps).toFixed(1)}% of seasons, group changes ${((100 * groupChanges) / steps).toFixed(1)}% (${steps} player-seasons)`,
		);
		const rows = ARCHETYPES.map((a) => [
			a.id,
			a.group,
			a.rare ? "rare" : "",
			(100 * (counts[a.id] ?? 0)) / n,
		]).sort((x, y) => y[3] - x[3]);
		const g = {};
		for (const r of rows) g[r[1]] = (g[r[1]] ?? 0) + r[3];
		out.push(
			"groups " +
				JSON.stringify(
					Object.fromEntries(
						Object.entries(g).map(([k, v]) => [k, v.toFixed(1)]),
					),
				),
		);
		const shares = rows.map((r) => r[3]).filter((x) => x > 0);
		out.push(
			`max share ${shares[0]?.toFixed(2)} min nonzero ${shares.at(-1)?.toFixed(2)} zero ${rows
				.filter((r) => r[3] === 0)
				.map((r) => r[0])
				.join(",")}`,
		);
		out.push(
			rows
				.map(
					(r) => `${r[0]} (${r[1]}${r[2] ? ",rare" : ""}) ${r[3].toFixed(2)}`,
				)
				.join("\n"),
		);
		mkdirSync("/tmp/claude-0", { recursive: true });
		writeFileSync("/tmp/claude-0/arch-diag.txt", out.join("\n") + "\n");
	},
	900000,
);
