import { test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";

/*
 * Play-by-play logging: CPU cost per game of a game nobody watches, with its events logged for storage ("log") or not ("skip"),
 * new-league defaults. Not part of the normal run:
 *   PBP_COST=1 node_modules/.bin/vitest run --project basketball src/worker/core/GameSim.basketball/pbpCost.script.test.ts
 */
const env = (globalThis as any).process?.env ?? {};

test.skipIf(!env.PBP_COST)(
	"sim cost of play-by-play logging",
	{ timeout: 3600000 },
	async () => {
		const games = Number(env.PBP_COST_GAMES ?? 200);
		// (CPU time of this process, not wall time: the machine may be busy)
		const now = () => {
			const u = (globalThis as any).process.cpuUsage();
			return (u.user + u.system) / 1000;
		};
		const sim: Record<string, number> = { log: 0, skip: 0 };
		const load: Record<string, number> = { log: 0, skip: 0 };
		await withSeededRandom(77, async () => {
			await genTeams();
			const settings = getDefaultSettings() as Record<string, unknown>;
			for (const [key, value] of Object.entries(settings)) {
				g.setWithoutSavingToDB(key as any, value as any);
			}
			for (let rep = -2; rep < 8; rep++) {
				for (const mode of rep % 2 === 0 ? ["log", "skip"] : ["skip", "log"]) {
					const storePbp = mode === "log";
					// (what turned logging off before GameSim took storePbp)
					g.setWithoutSavingToDB("storePlayByPlay", storePbp);
					const loaded = [];
					const l0 = now();
					for (let i = 0; i < games / 8; i++) {
						loaded.push(
							await loadTeams(
								[0, 1],
								{},
								storePbp ? undefined : new Set<number>(),
							),
						);
					}
					const l1 = now();
					for (const teams of loaded) {
						new GameSim({
							gid: 1,
							teams: [teams[0]!, teams[1]!],
							baseInjuryRate: 0,
							doPlayByPlay: false,
							storePbp,
							homeCourtFactor: 1,
							allStarGame: false,
							neutralSite: false,
						}).run();
					}
					// (the first two rounds warm up the JIT)
					if (rep >= 0) {
						sim[mode]! += now() - l1;
						load[mode]! += l1 - l0;
					}
				}
			}
		});
		const n = games;
		console.log(
			`per game: sim log ${(sim.log! / n).toFixed(2)} ms, skip ${(sim.skip! / n).toFixed(2)} ms; loadTeams (2 teams) log ${(load.log! / n).toFixed(2)} ms, skip ${(load.skip! / n).toFixed(2)} ms`,
		);
	},
);
