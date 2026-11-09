// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Distributions of the expanded ratings and of the composites with and without them, in a generated league. Run with
// EXPANDED_DIST=1 vitest --run --project basketball <this file>
import { test } from "vitest";
import { g } from "../../util/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import createRandomPlayers from "../league/create/createRandomPlayers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { range } from "../../../common/utils.ts";
import { COMPOSITE_WEIGHTS } from "../../../common/constants.ts";
import compositeRating from "./compositeRating.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { EXPANDED_COMPOSITE_WEIGHTS } from "../../../common/expandedRatings.ts";

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

test.skipIf(!process.env.EXPANDED_DIST)(
	"expanded ratings distributions",
	async () => {
		const orig = Math.random;
		Math.random = makeSeededRandom(5);
		const rows = [];
		for (const expanded of [false, true]) {
			for (const rep of range(Number(process.env.EXPANDED_REPS ?? 4))) {
				resetG();
				g.setWithoutSavingToDB("expandedRatings", expanded);
				await resetCache({});
				const players = await createRandomPlayers({
					activeTids: range(30),
					onlyFreeAgents: false,
					scoutingLevel: DEFAULT_LEVEL,
					teams: range(30).map((tid) => ({ tid })),
				});
				for (const p of players) {
					if (p.tid >= 0) {
						rows.push({ expanded, r: p.ratings.at(-1) });
					}
				}
			}
		}
		Math.random = orig;
		const out = [];
		for (const expanded of [false, true]) {
			const rs = rows.filter((x) => x.expanded === expanded).map((x) => x.r);
			out.push(`expanded ${expanded}: n ${rs.length}`);
			for (const k of ["ovr", "pot", "hgt", "wng", "diq", "pdef", "idef"]) {
				if (rs[0][k] === undefined) {
					continue;
				}
				const xs = rs.map((r) => r[k]);
				out.push(`  ${k}\t${mean(xs).toFixed(2)}\t${sd(xs).toFixed(2)}`);
			}
			if (expanded) {
				for (const pos of ["PG", "SG", "SF", "PF", "C", "G", "F", "GF", "FC"]) {
					const xs = rs.filter((r) => r.pos === pos);
					if (xs.length) {
						out.push(
							`  pdef-idef ${pos}\t${mean(xs.map((r) => r.pdef - r.idef)).toFixed(2)}\twng-hgt ${mean(xs.map((r) => r.wng - r.hgt)).toFixed(2)}\tn ${xs.length}`,
						);
					}
				}
			}
			for (const [key, w] of Object.entries(COMPOSITE_WEIGHTS)) {
				const stock = rs.map((r) =>
					compositeRating(r, w.ratings, w.weights, false),
				);
				let line = `  ${key}\t${mean(stock).toFixed(4)}\t${sd(stock).toFixed(4)}`;
				const e = EXPANDED_COMPOSITE_WEIGHTS[key];
				if (expanded && e) {
					const xs = rs.map((r) =>
						compositeRating(r, e.ratings, e.weights, false),
					);
					line += `\texp ${mean(xs).toFixed(4)}\t${sd(xs).toFixed(4)}`;
					if (e.skill) {
						const nStock = stock.filter((x) => x > w.skill.cutoff).length;
						const sorted = [...xs].sort((a, b) => b - a);
						line += `\tskill stock ${nStock} exp ${xs.filter((x) => x > e.skill.cutoff).length} matching cutoff ${sorted[nStock].toFixed(4)}`;
					}
				}
				out.push(line);
			}
			if (expanded) {
				const e = EXPANDED_COMPOSITE_WEIGHTS.length;
				const xs = rs.map((r) =>
					compositeRating(r, e.ratings, e.weights, false),
				);
				out.push(`  length\texp ${mean(xs).toFixed(4)}\t${sd(xs).toFixed(4)}`);
			}
		}
		(globalThis as any).process.stdout.write(out.join("\n") + "\n");
	},
	600_000,
);
