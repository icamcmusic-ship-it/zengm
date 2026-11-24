// @ts-nocheck
/* eslint-disable no-undef */
// archaudit: the label distribution of a generated league (sample.testutil.ts, Sub-Ratings and Expanded Ratings on, as
// a new league has them), with counts of labels an audit called implausible: rim-protection words on guards or small
// players, post words on small guards, primary-handler words on centers without a handle, glass words on guards.
//   RUN_LABEL_DIST=out.json npx vitest --run --project basketball src/common/archetypes/v2/labelDist.script.test.ts
// (ARCH_DIST_N players, default 600; the JSON holds every label, to compare two runs)
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import {
	DEFAULT_NORMS_EXPANDED,
	SCORING_ARCHETYPES,
	buildNorms,
} from "../index.ts";
import { positionOf } from "../position.ts";
import { sampleLeague } from "../sample.testutil.ts";
import { classifyV2Label } from "./engine.ts";
import { ratingQuantiles } from "./gateScale.ts";
import { nounGroupQuantiles } from "./nouns.ts";

const OUT = process.env.RUN_LABEL_DIST;
const N = Number(process.env.ARCH_DIST_N ?? 600);

const GUARD = new Set(["PG", "G", "SG"]);
const RIM_RE =
	/Rim-Protect|Shot-Eras|Shot Eras|Rim Protector|Shot Blocker|Swatting/;
const POST_RE = /Post/;
const HANDLER_RE =
	/Ball-Handling|Playmaking|Floor General|Point|Playmaker|Handler/;
const GLASS_RE = /Glass|Rebound|Board/;

test.skipIf(!OUT)(
	"label distribution",
	async () => {
		const sample = await sampleLeague(N, "labelDist", 13, 38, true);
		const rows = sample.map((s) => ({
			ratings: s.ratings,
			ovr: s.ovr,
			pos: positionOf(s.ratings),
			age: s.age,
		}));
		const norms = {
			...buildNorms(rows, SCORING_ARCHETYPES, DEFAULT_NORMS_EXPANDED),
			bias: DEFAULT_NORMS_EXPANDED.bias,
			prospect: DEFAULT_NORMS_EXPANDED.prospect,
			nq: ratingQuantiles(rows),
			ng: nounGroupQuantiles(rows),
		};
		const labels = [];
		const flags = {
			rimSmall: 0,
			postSmallGuard: 0,
			handlerBig: 0,
			glassGuard: 0,
		};
		const examples = {
			rimSmall: [],
			postSmallGuard: [],
			handlerBig: [],
			glassGuard: [],
		};
		for (const [i, s] of sample.entries()) {
			const pos = rows[i].pos;
			const label = classifyV2Label(s.ratings, {
				norms,
				pos,
				ovr: s.ovr,
				pot: s.ovr,
				age: s.age,
			});
			labels.push({ i, pos, hgt: s.hgtInches, ovr: s.ovr, label });
			const ex = `${label} (${pos}, ${s.hgtInches}", ovr ${s.ovr}, drb ${s.ratings.drb})`;
			const flag = (k: string, on: boolean) => {
				if (on) {
					flags[k]++;
					if (examples[k].length < 6) {
						examples[k].push(ex);
					}
				}
			};
			flag(
				"rimSmall",
				RIM_RE.test(label) && (GUARD.has(pos) || s.hgtInches < 77),
			);
			flag(
				"postSmallGuard",
				POST_RE.test(label) && GUARD.has(pos) && s.hgtInches < 76,
			);
			flag(
				"handlerBig",
				HANDLER_RE.test(label) &&
					(pos === "C" || pos === "FC") &&
					s.ratings.drb < 50,
			);
			flag("glassGuard", GLASS_RE.test(label) && GUARD.has(pos));
		}
		const counts = {};
		for (const l of labels) {
			counts[l.label] = (counts[l.label] ?? 0) + 1;
		}
		const top = Object.entries(counts)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 25);
		console.log(
			JSON.stringify(
				{
					n: labels.length,
					distinct: Object.keys(counts).length,
					maxShare: Math.round((1000 * top[0][1]) / labels.length) / 10,
					flags,
					examples,
					top,
				},
				null,
				1,
			),
		);
		writeFileSync(OUT, JSON.stringify(labels));
	},
	1_200_000,
);
