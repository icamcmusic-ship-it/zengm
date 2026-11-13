import { test } from "vitest";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync } from "node:fs";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { AdvTracker } from "./advTracking.ts";

/*
 * Advanced Tracking Stats: CPU cost of recording in the game sim alone (no storage), new-league defaults. Not part of the normal run:
 *   ADV_COST=1 node_modules/.bin/vitest run --project basketball src/worker/core/GameSim.basketball/advTrackingCost.script.test.ts
 */
const env = (globalThis as any).process?.env ?? {};

test.skipIf(!env.ADV_COST)(
	"sim cost of the tracker",
	{ timeout: 3600000 },
	async () => {
		const games = Number(env.ADV_COST_GAMES ?? 300);
		const cpu = () => {
			const u = (globalThis as any).process.cpuUsage();
			return (u.user + u.system) / 1000;
		};
		const totals: Record<string, number> = { on: 0, off: 0 };
		if (env.ADV_COST_NOOP) {
			for (const m of (env.ADV_COST_NOOP as string).split(",")) {
				(AdvTracker.prototype as any)[m] = function () {
					return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
				};
			}
		}
		let session: any;
		if (env.ADV_COST_PROF) {
			const { Session } = await import(
				/* @vite-ignore */ "node:inspector/promises" as string
			);
			session = new Session();
			session.connect();
			await session.post("Profiler.enable");
			await session.post("Profiler.setSamplingInterval", { interval: 100 });
			await session.post("Profiler.start");
		}
		await withSeededRandom(77, async () => {
			await genTeams();
			const settings = getDefaultSettings() as Record<string, unknown>;
			for (const [key, value] of Object.entries(settings)) {
				g.setWithoutSavingToDB(key as any, value as any);
			}
			for (let rep = -2; rep < 8; rep++) {
				for (const mode of env.ADV_COST_ONLY
					? [env.ADV_COST_ONLY]
					: rep % 2 === 0
						? ["on", "off"]
						: ["off", "on"]) {
					g.setWithoutSavingToDB(
						"advStats" as any,
						(mode === "on" && !env.ADV_COST_SAME) as any,
					);
					const loaded = [];
					for (let i = 0; i < games / 8; i++) {
						loaded.push(await loadTeams([0, 1], {}));
					}
					const c0 = cpu();
					for (const teams of loaded) {
						new GameSim({
							gid: 1,
							teams: [teams[0]!, teams[1]!],
							baseInjuryRate: 0,
							doPlayByPlay: false,
							homeCourtFactor: 1,
							allStarGame: false,
							neutralSite: false,
						}).run();
					}
					// (the first two rounds warm up the JIT)
					if (rep >= 0) {
						totals[mode]! += cpu() - c0;
					}
				}
			}
		});
		if (session) {
			const result = await session.post("Profiler.stop");
			const { writeFileSync } = await import(
				/* @vite-ignore */ "node:fs" as string
			);
			writeFileSync(env.ADV_COST_PROF, JSON.stringify(result.profile));
		}
		const line = `ADV_COST on ${Math.round(totals.on!)} ms, off ${Math.round(totals.off!)} ms, ${(100 * (totals.on! / totals.off! - 1)).toFixed(1)}%`;
		if (env.ADV_COST_OUT) {
			appendFileSync(env.ADV_COST_OUT, `${line}\n`);
		}
	},
);
