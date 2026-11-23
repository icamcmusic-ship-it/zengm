// Not a real test: measures the College Hall of Fame (docs/native-features.md, College Hall of Fame). Plays HOF_SEASONS seasons of a
// spectator college league and prints each season's class, the number of candidates and the score distribution of the players who
// left school. Skipped unless HOF_SEASONS is set:
//
//   HOF_SEASONS=20 HOF_LEVEL=power node_modules/.bin/vitest run --project basketball \
//     src/worker/core/hallOfFame/collegeHofRates.script.test.ts
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync } from "node:fs";
import { describe, test } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { COLLEGE_HOF_WAIT } from "../../../common/college/hallOfFame.ts";
import type { CollegeLevel } from "../../../common/college/teams.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { collegeCaseOf, loadTeamResults } from "./college.ts";
import {
	createCollegeTestLeague,
	playCollegeSeason,
} from "./collegeTestLeague.ts";

const env = (globalThis as any).process.env;
const SEASONS = Number(env.HOF_SEASONS ?? 0);
// Optional: one JSON line per departed player (his case), to tune the weights offline
const DUMP: string | undefined = env.HOF_DUMP;

const quantile = (xs: number[], q: number) => {
	const s = xs.toSorted((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};

describe.skipIf(!SEASONS)("college hall of fame rates", () => {
	test("seasons", { timeout: 6 * 60 * 60 * 1000 }, async () => {
		await createCollegeTestLeague(
			Number(env.HOF_SEED ?? 5),
			(env.HOF_LEVEL ?? "power") as CollegeLevel,
		);
		const start = g.get("season");
		for (let i = 0; i < SEASONS; i++) {
			const t0 = Date.now();
			await playCollegeSeason();
			const season = g.get("season") - 1;
			const awards = await idb.merged.awards.get(season);
			const hof = awards?.collegeHof;
			console.log(
				`HOF ${season} classSize=${hof?.classSize} candidates=${hof?.candidates} players=${hof?.players.length ?? 0} coaches=${hof?.coaches.length ?? 0} ${(hof?.players ?? []).map((r) => `${r.name} ${r.score} [${r.line}]`).join("; ")} ${(hof?.coaches ?? []).map((r) => `coach ${r.name} ${r.score} [${r.line}]`).join("; ")} (${Math.round((Date.now() - t0) / 1000)}s)`,
			);

			// Scores of last season's departures (complete careers), for the bar
			const exitSeason = season;
			if (exitSeason >= start) {
				const teamResult = await loadTeamResults(start, season);
				const scores = [];
				for (const p of await idb.merged.players.getAll({
					retiredYear: exitSeason,
				})) {
					if (p.tid === PLAYER.RETIRED) {
						const hofCase = collegeCaseOf(p, teamResult);
						scores.push(hofCase.score);
						if (DUMP) {
							const { line, tids, ...rest } = hofCase;
							appendFileSync(
								DUMP,
								`${JSON.stringify({ pid: p.pid, exit: exitSeason, exitType: p.collegeExit?.type, ...rest })}\n`,
							);
						}
					}
				}
				console.log(
					`EXITS ${exitSeason} n=${scores.length} p50=${quantile(scores, 0.5).toFixed(1)} p90=${quantile(scores, 0.9).toFixed(1)} p98=${quantile(scores, 0.98).toFixed(1)} p99=${quantile(scores, 0.99).toFixed(1)} top=${scores
						.toSorted((a, b) => b - a)
						.slice(0, 8)
						.map((x) => x.toFixed(1))
						.join(",")} (eligible ${exitSeason + COLLEGE_HOF_WAIT})`,
				);
			}
		}
		let total = 0;
		let seasons = 0;
		for (let season = start; season < g.get("season"); season++) {
			const hof = (await idb.merged.awards.get(season))?.collegeHof;
			if (season >= start + COLLEGE_HOF_WAIT) {
				seasons += 1;
				total += hof?.players.length ?? 0;
			}
		}
		console.log(
			`TOTAL ${total} players in ${seasons} seasons with candidates possible (${(total / Math.max(1, seasons)).toFixed(2)} a season)`,
		);
	});
});
