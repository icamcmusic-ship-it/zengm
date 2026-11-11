/* eslint-disable no-undef */
// @ts-nocheck
// Regenerates norms.data.ts (RUN_ARCHETYPE_CALIBRATION=1) or, with ARCH_EXPANDED=1 too, normsExpanded.data.ts: the same
// reference league generated with the Expanded Ratings setting on. Not part of the normal run.
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { ARCHETYPES, scoreAll } from "./classify.ts";
import { buildNorms } from "./match.ts";
import { positionFor } from "./position.ts";
import { sampleLeague, sampleTraits } from "./sample.testutil.ts";

const EXPANDED = Boolean(process.env.ARCH_EXPANDED);
const BIAS_MAX = 0.25;
// Overused archetypes may be trimmed a little harder than rare types are pushed up (catch-all role players twice as hard)
const BIAS_MIN = -0.4;

test.skipIf(!process.env.RUN_ARCHETYPE_CALIBRATION)(
	"write norms",
	async () => {
		// A whole league, 19 to 32 year olds
		const sample = await sampleLeague(8000, "norms-v2", 13, 38, EXPANDED);
		// Positions as the game shows them with Improved positions on (the default)
		for (const p of sample) {
			p.pos = positionFor(p.ratings, true);
		}
		const norms = buildNorms(sample, ARCHETYPES);
		// The bias is evened out over the league plus a draft class or two of raw prospects, as a league holds them
		const prospects = (
			await sampleLeague(1200, "norms-prospects", 0, 30, EXPANDED)
		).map((p) => ({ ...p, pos: positionFor(p.ratings, true) }));
		const biasSample = [...sample, ...prospects];
		// Raw prospects' tables are read with prospects among the peers (else any prospect is an exceptional fit)
		const life = buildNorms(
			biasSample,
			ARCHETYPES.filter((a) => a.level),
			undefined,
			norms,
		);
		Object.assign(norms.match, life.match);
		const round = (xs: number[]) =>
			xs.map((x) => Math.round(x * 10000) / 10000);
		// Nudge the shares toward even with small additive steps on the z score. Kept small (|bias| <= 0.25): correctness, which the
		// position prior and height gate decide, matters more than evenness, so the bias only trims archetypes that are far off
		// Even shares within each group (guard, wing, forward, big), the group sizes as the ratings give them. Raw prospects and
		// veterans keep their natural share, only trimmed when one passes LIFECYCLE_MAX.
		// Two passes: every label without player traits (trait labels cannot be picked then), then the trait labels alone with
		// visible traits, so a league with traits off reads exactly as calibrated
		const lifecycle = (a) => Boolean(a.level || a.age);
		const LIFECYCLE_MAX = 0.02;
		const traitsOf = biasSample.map((p, i) =>
			sampleTraits(p.ratings, p.age, "calibrate-traits", i),
		);
		const evenOut = (list, withTraits) => {
			const ids = new Set(list.map((a) => a.id));
			let target: Record<string, number> | undefined;
			for (let iter = 0; iter < 25; iter++) {
				const counts: Record<string, number> = {};
				for (const [i, p] of biasSample.entries()) {
					const best = scoreAll(
						p.ratings,
						{ ...norms, bias },
						ARCHETYPES,
						p.pos,
						p.age,
						withTraits ? traitsOf[i] : undefined,
					).scored[0]!.a.id;
					counts[best] = (counts[best] ?? 0) + 1;
				}
				if (!target) {
					target = {};
					const groupShare: Record<string, number> = {};
					const groupWt: Record<string, number> = {};
					for (const a of ARCHETYPES) {
						if (lifecycle(a)) {
							continue;
						}
						groupShare[a.group] =
							(groupShare[a.group] ?? 0) +
							(counts[a.id] ?? 0) / biasSample.length;
						groupWt[a.group] =
							(groupWt[a.group] ?? 0) +
							// (labels that need traits only count where traits are on)
							(a.trait && !withTraits ? 0 : a.rare ? 0.15 : 1);
					}
					for (const a of ARCHETYPES) {
						target[a.id] = lifecycle(a)
							? LIFECYCLE_MAX
							: (groupShare[a.group]! * (a.rare ? 0.15 : 1)) /
								groupWt[a.group]!;
					}
				}
				for (const a of ARCHETYPES) {
					if (!ids.has(a.id)) {
						continue;
					}
					const actual = Math.max(
						0.0004,
						(counts[a.id] ?? 0) / biasSample.length,
					);
					// Lifecycle archetypes: only ever trimmed
					const t = lifecycle(a)
						? Math.max(actual, target[a.id]!)
						: target[a.id]!;
					// Lifecycle and broad (generic) labels are never pushed up: an underused broad label means players got a
					// more specific one
					bias[a.id] = Math.min(
						lifecycle(a) || a.tags.includes("generic") ? 0 : BIAS_MAX,
						Math.max(
							a.tags.includes("role") || lifecycle(a) ? 2 * BIAS_MIN : BIAS_MIN,
							bias[a.id]! + 0.15 * Math.log(t / actual),
						),
					);
				}
			}
		};
		const bias: Record<string, number> = {};
		for (const a of ARCHETYPES) {
			bias[a.id] = 0;
		}
		evenOut(
			ARCHETYPES.filter((a) => !a.trait),
			false,
		);
		evenOut(
			ARCHETYPES.filter((a) => a.trait),
			true,
		);
		norms.bias = Object.fromEntries(
			Object.entries(bias).map(([k, v]) => [k, Math.round(v * 100) / 100]),
		);
		const q = Object.fromEntries(
			Object.entries(norms.q).map(([k, v]) => [k, round(v)]),
		);
		const src = `// GENERATED by calibrate.script.test.ts from 8000 BBGM-generated players (developed random draft classes, 19 to 32) and 1200 draft prospects${EXPANDED ? ", with the Expanded Ratings setting on" : ""}. Do not edit by hand.
import type { Norms } from "./types.ts";

export const ${EXPANDED ? "DEFAULT_NORMS_EXPANDED" : "DEFAULT_NORMS"}: Norms = ${JSON.stringify({ q, beta: norms.beta, ovr: round(norms.ovr), match: norms.match, bias: norms.bias })};
`;
		writeFileSync(
			new URL(
				EXPANDED ? "./normsExpanded.data.ts" : "./norms.data.ts",
				import.meta.url,
			),
			src,
		);
	},
	600000,
);
