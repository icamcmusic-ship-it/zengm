import "fake-indexeddb/auto";
import { describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { getCollegeLeagueTeams } from "../../../common/college/teams.ts";
import { getCollegeSettings } from "../../../common/college/settings.ts";
import { GameSim, game, league, phase } from "../index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";

const env = (globalThis as any).process.env;
describe.skipIf(!env.PROF)("prof", () => {
	test("prof", { timeout: 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(3);
		const level = env.CAL_LEVEL ?? "full";
		const { teams, confs, divs } = getCollegeLeagueTeams(level);
		await league.createStream({}, {
			confs, divs,
			fromFile: { gameAttributes: undefined, hasRookieContracts: true, maxGid: undefined, startingSeason: undefined, teams: undefined, version: LEAGUE_DATABASE_VERSION },
			getLeagueOptions: undefined, keptKeys: new Set(), lid: 0, name: "p", setLeagueCreationStatus: () => {},
			settings: { ...getDefaultSettings(), ...getCollegeSettings(level) } as any,
			shuffleRosters: false, startingSeasonFromInput: "2025",
			teamsFromInput: teams.map((t) => ({ ...t, popRank: 1 })) as any, tid: 0,
		});
		await league.loadGameAttributes();
		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		let simMs = 0; let n = 0;
		const orig = (GameSim as any).prototype.run;
		(GameSim as any).prototype.run = function () { const t = performance.now(); const r = orig.call(this); simMs += performance.now() - t; n++; return r; };
		const inspector = await import("node:inspector" as any);
		const session = new inspector.Session(); session.connect();
		const post = (m: string, a?: any) => new Promise<any>((res, rej) => session.post(m, a, (e: any, r: any) => (e ? rej(e) : res(r))));
		await post("Profiler.enable"); await post("Profiler.start");
		const t0 = performance.now();
		await game.play(Number(env.DAYS ?? 5), {});
		const { profile } = await post("Profiler.stop");
		(await import("node:fs" as any)).writeFileSync(env.PROF + ".cpuprofile", JSON.stringify(profile));
		const total = performance.now() - t0;
		(await import("node:fs" as any)).appendFileSync(env.PROF, JSON.stringify({ total, simMs, n, perGameSim: simMs / n, perGameAll: total / n }) + "\n");
	});
});
