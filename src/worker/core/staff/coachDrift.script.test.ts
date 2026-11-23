// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Coach rating drift: the league's coach ratings and salaries over decades of offseasons (no games: random records), with the coach
// market (associate head coaches) on. Run with COACH_DRIFT=1 npx vitest --run --project basketball <this file>
// (COACH_DRIFT_SEASONS, COACH_DRIFT_SEEDS to change the size)
import { test } from "vitest";
import { makeSeededRandom } from "../../../common/random.ts";
import { PHASE } from "../../../common/constants.ts";
import { coachOvr } from "../../../common/staff.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { team } from "../index.ts";
import { ensureStaff, onPreseason, runOffseason } from "./index.ts";
import { range } from "../../../common/utils.ts";

const mean = (xs) =>
	xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN;
const sd = (xs) => {
	const m = mean(xs);
	return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

const realRandom = Math.random;

test.skipIf(!process.env.COACH_DRIFT)(
	"coach ratings and salaries over decades",
	async () => {
		const numSeasons = Number(process.env.COACH_DRIFT_SEASONS ?? 30);
		const seeds = range(Number(process.env.COACH_DRIFT_SEEDS ?? 3));
		const rows = range(numSeasons + 1).map(() => ({
			head: [],
			asst: [],
			heir: [],
			rating: [],
			salary: [],
			headSalary: [],
			age: [],
			headR: { off: [], def: [], mot: [], mgmt: [] },
			heads: [],
		}));
		for (const seed of seeds) {
			Math.random = makeSeededRandom(seed + 1);
			resetG();
			g.setWithoutSavingToDB("coachingStaff", true);
			g.setWithoutSavingToDB("coachSystems", true);
			g.setWithoutSavingToDB("featureCoachingDepth", true);
			g.setWithoutSavingToDB("featureCoachMarket", true);
			g.setWithoutSavingToDB("userTids", []);
			g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
			idb.league = mockIDBLeague();
			const teams = helpers.getTeamsDefault().map(team.generate);
			await resetCache({ teams });
			await ensureStaff();
			for (const i of range(numSeasons + 1)) {
				const season = g.get("season");
				const employed = (await idb.cache.coaches.getAll()).filter(
					(c) => c.tid >= 0,
				);
				const row = rows[i];
				for (const c of employed) {
					const ovr = coachOvr(c.ratings, c.role);
					if (c.role === "head") {
						row.head.push(ovr);
						row.headSalary.push(c.contract.amount);
						for (const key of ["off", "def", "mot"]) {
							row.headR[key].push(c.ratings[key]);
						}
						if (c.profile) {
							row.headR.mgmt.push(c.profile.mgmt);
						}
						row.heads.push({ ovr, ...c.ratings, mgmt: c.profile?.mgmt });
					} else if (["dev", "off", "def"].includes(c.role)) {
						row.asst.push(ovr);
					}
					if (c.succession?.heir !== undefined) {
						row.heir.push(coachOvr(c.ratings, "head"));
					}
					for (const key of ["dev", "off", "def", "mot"]) {
						row.rating.push(c.ratings[key]);
					}
					row.salary.push(c.contract.amount);
					row.age.push(season - c.born.year);
				}
				if (i === numSeasons) {
					break;
				}
				for (const t of await idb.cache.teams.getAll()) {
					const ts = team.genSeasonRow(t, undefined, season);
					ts.won = Math.round(41 + 10 * (Math.random() - 0.5) * 2);
					ts.lost = 82 - ts.won;
					await idb.cache.teamSeasons.add(ts);
				}
				g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
				await runOffseason();
				g.setWithoutSavingToDB("season", season + 1);
				g.setWithoutSavingToDB("phase", PHASE.PRESEASON);
				await onPreseason();
				g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
			}
		}
		Math.random = realRandom;
		const pct = (xs, q) => {
			const s = xs.toSorted((a, b) => a - b);
			return s[Math.round(q * (s.length - 1))];
		};
		const all = { off: [], def: [], mot: [], mgmt: [] };
		for (const r of rows) {
			for (const key of Object.keys(all)) {
				all[key].push(...r.headR[key]);
			}
		}
		for (const key of Object.keys(all)) {
			console.log(
				`| head ${key}: p5 ${pct(all[key], 0.05)} p50 ${pct(all[key], 0.5)} p95 ${pct(all[key], 0.95)}`,
			);
		}
		// The league's top and bottom 5% of head coaches by ovr: their average ratings (coachImpact.script.test.ts)
		const heads = rows.flatMap((r) => r.heads).sort((a, b) => a.ovr - b.ovr);
		const n5 = Math.round(heads.length * 0.05);
		for (const [name, group] of [
			["bottom 5%", heads.slice(0, n5)],
			["top 5%", heads.slice(-n5)],
		]) {
			console.log(
				`| ${name} head coaches: ${["ovr", "off", "def", "mot", "dev", "mgmt"].map((k) => `${k} ${mean(group.map((x) => x[k])).toFixed(1)}`).join(", ")}`,
			);
		}
		console.log(
			"season | head ovr mean (sd) | asst ovr mean (sd) | heir head-ovr mean (n) | all ratings mean (sd) | salary mean | head salary mean | age",
		);
		for (const [i, r] of rows.entries()) {
			if (i % 3 !== 0 && i !== numSeasons) {
				continue;
			}
			console.log(
				`${i} | ${mean(r.head).toFixed(1)} (${sd(r.head).toFixed(1)}) | ${mean(r.asst).toFixed(1)} (${sd(r.asst).toFixed(1)}) | ${mean(r.heir).toFixed(1)} (${r.heir.length}) | ${mean(r.rating).toFixed(1)} (${sd(r.rating).toFixed(1)}) | ${mean(r.salary).toFixed(0)} | ${mean(r.headSalary).toFixed(0)} | ${mean(r.age).toFixed(1)}`,
			);
		}
	},
	3_600_000,
);
