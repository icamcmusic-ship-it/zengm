// @ts-nocheck (node-only script, like src/test/ratingInflation/pop.script.test.ts)
/* eslint-disable */
// Aging curves of every rating and of ovr (Realistic Aging, docs/native-features.md): N generated 19-year-olds developed to 38 with no
// attrition (no survivorship bias), with each secret aging curve (Player Traits) too.
//   RA_AGING=1 RA_REALISTIC=0|1 RA_V2=0|1 RA_EXP=0|1 RA_N=3000 [RA_OUT=file.json] node_modules/.bin/vitest run --project basketball \
//     src/test/ovrFit/aging.script.test.ts
import { test } from "vitest";
import { writeFileSync } from "node:fs";
import { g } from "../../worker/util/index.ts";
import { withSeededRandom } from "../../worker/core/GameSim.basketball/simLiveGameForTests.ts";
import { player } from "../../worker/core/index.ts";
import { developSeasonSync } from "../../worker/core/player/developSeason.ts";
import ovr from "../../worker/core/player/ovr.ts";
import { resetCache, resetG } from "../helpers.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { last } from "../../common/utils.ts";
import { fillExpandedRatings } from "../../common/expandedRatings.ts";
import { agingCurveDelta } from "../../common/playerTraits/development.ts";

const env = process.env;
const KEYS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
	"wng",
	"pdef",
	"idef",
	"oreb",
	"dreb",
	"csh",
	"dsh",
	"bsc",
];
const CURVES = ["normal", "early", "late", "graceful"];

test.skipIf(!env.RA_AGING)(
	"aging curves",
	async () => {
		const exp = env.RA_EXP === "1";
		const N = Number(env.RA_N ?? 3000);
		const out: any = {
			exp,
			realistic: env.RA_REALISTIC === "1",
			v2: env.RA_V2 === "1",
			aging: {},
			curves: {},
		};
		await withSeededRandom(4242, async () => {
			resetG();
			g.setWithoutSavingToDB("expandedRatings", exp);
			g.setWithoutSavingToDB("realisticAging", env.RA_REALISTIC === "1");
			g.setWithoutSavingToDB("ovrV2", env.RA_V2 === "1");
			g.setWithoutSavingToDB("playerTraits", false);
			await resetCache({});
			const grpOf = (h: number) => (h < 40 ? "guard" : h < 55 ? "wing" : "big");
			const sums: any = { all: {}, guard: {}, wing: {}, big: {} };
			const curveOvr: any = Object.fromEntries(CURVES.map((c) => [c, {}]));
			for (let i = 0; i < N; i++) {
				const p = player.generate(
					-2,
					19,
					g.get("season"),
					false,
					DEFAULT_LEVEL,
				);
				if (exp) {
					fillExpandedRatings(p);
				}
				const r0: any = last(p.ratings);
				const curve = CURVES[i % CURVES.length];
				const rows = [{ ...r0 }];
				const r: any = rows[0];
				const grp = grpOf(r.hgt);
				for (let age = 19; age <= 38; age++) {
					if (age > 19) {
						// Half the players without traits, the other half with each aging curve
						const traitDev =
							i % 8 < 4
								? undefined
								: {
										baseChangeDelta: agingCurveDelta(curve, age),
										dropScale: 1,
									};
						developSeasonSync(r, age, DEFAULT_LEVEL, undefined, traitDev);
					}
					r.ovr = ovr(r);
					if (i % 8 < 4) {
						for (const gname of ["all", grp]) {
							const byAge = (sums[gname][age] ??= {});
							for (const k of [...KEYS, "ovr"]) {
								if (typeof r[k] === "number") (byAge[k] ??= []).push(r[k]);
							}
						}
					} else {
						(curveOvr[curve][age] ??= []).push(r.ovr);
					}
				}
			}
			const m = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
			for (const [gname, byAgeAll] of Object.entries(sums)) {
				out.aging[gname] = {};
				for (const [age, byKey] of Object.entries(byAgeAll as any)) {
					out.aging[gname][age] = Object.fromEntries(
						Object.entries(byKey as any).map(([k, arr]) => [
							k,
							Number(m(arr).toFixed(2)),
						]),
					);
				}
			}
			for (const c of CURVES) {
				out.curves[c] = Object.fromEntries(
					Object.entries(curveOvr[c]).map(([a, arr]) => [
						a,
						Number(m(arr).toFixed(2)),
					]),
				);
			}
		});
		const A = out.aging.all;
		const ages = Object.keys(A).map(Number);
		const peak = (k: string, gname = "all") =>
			ages.reduce(
				(best, a) =>
					out.aging[gname][a][k] > out.aging[gname][best][k] ? a : best,
				19,
			);
		const lines = [`realistic ${out.realistic} v2 ${out.v2} exp ${exp}`];
		lines.push(
			`age ${["ovr", ...KEYS.filter((k) => typeof A[19][k] === "number")].map((k) => k.padStart(5)).join(" ")}`,
		);
		for (const a of ages) {
			lines.push(
				`${a}  ${["ovr", ...KEYS.filter((k) => typeof A[19][k] === "number")].map((k) => A[a][k].toFixed(1).padStart(5)).join(" ")}`,
			);
		}
		lines.push(
			`peak age: ${["ovr", ...KEYS.filter((k) => typeof A[19][k] === "number" && k !== "hgt" && k !== "wng")].map((k) => `${k} ${peak(k)}`).join(", ")}`,
		);
		lines.push(
			`ovr peak by group: ${["guard", "wing", "big"].map((gname) => `${gname} ${peak("ovr", gname)}`).join(", ")}`,
		);
		lines.push(
			`ovr vs peak at 31/33/35 by group: ${["guard", "wing", "big"].map((gname) => `${gname} ${[31, 33, 35].map((a) => (out.aging[gname][a].ovr - out.aging[gname][peak("ovr", gname)].ovr).toFixed(1)).join("/")}`).join(", ")}`,
		);
		for (const c of CURVES) {
			const cA = out.curves[c];
			const pk = ages.reduce((best, a) => (cA[a] > cA[best] ? a : best), 19);
			lines.push(
				`curve ${c}: peak ${pk} (${cA[pk].toFixed(1)}), ovr at 23/27/31/34: ${[23, 27, 31, 34].map((a) => cA[a].toFixed(1)).join("/")}`,
			);
		}
		process.stdout.write(lines.join("\n") + "\n");
		if (env.RA_OUT) {
			writeFileSync(env.RA_OUT, JSON.stringify(out));
		}
	},
	3600 * 1000,
);
