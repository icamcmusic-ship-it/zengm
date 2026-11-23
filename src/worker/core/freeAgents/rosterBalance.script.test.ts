// Not a real test: a headless spectator league (all AI teams) over a few seasons that logs AI roster position balance (bigs C/FC/PF,
// guards PG/SG/G) and hardship signings, with AI Roster Balance on or off. Skipped unless ROSTER_BALANCE is set:
//
//   ROSTER_BALANCE=on|off ROSTER_BALANCE_SEASONS=3 ROSTER_BALANCE_SEED=1 [ROSTER_BALANCE_INJURY=4] \
//     node_modules/.bin/vitest run --project basketball src/worker/core/freeAgents/rosterBalance.script.test.ts
import "fake-indexeddb/auto";
import { describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../../util/index.ts";
import { groupCounts } from "./rosterBalance.ts";
import { hardshipDiag } from "./hardship.ts";

const env = (globalThis as any).process.env;
const MODE = env.ROSTER_BALANCE;
const SEASONS = Number(env.ROSTER_BALANCE_SEASONS ?? 3);
const SEED = Number(env.ROSTER_BALANCE_SEED ?? 1);

type Snapshot = {
	teams: number;
	fewBigs: number;
	fewGuards: number;
	manyBigs: number;
	manyGuards: number;
	noC: number;
	minBigs: number;
	maxGuards: number;
	shortHanded: number;
};

const snapshot = async (): Promise<Snapshot> => {
	const s: Snapshot = {
		teams: 0,
		fewBigs: 0,
		fewGuards: 0,
		manyBigs: 0,
		manyGuards: 0,
		noC: 0,
		minBigs: Infinity,
		maxGuards: 0,
		shortHanded: 0,
	};
	for (const t of await idb.cache.teams.getAll()) {
		if (t.disabled) {
			continue;
		}
		const players = await idb.cache.players.indexGetAll("playersByTid", t.tid);
		const positions = players.map((p) => last(p.ratings).pos);
		const c = groupCounts(positions);
		s.teams += 1;
		s.fewBigs += Number(c.big < 2);
		s.fewGuards += Number(c.guard < 3);
		s.manyBigs += Number(c.big > 7);
		s.manyGuards += Number(c.guard > 7);
		s.noC += Number(!positions.some((pos) => pos === "C" || pos === "FC"));
		s.minBigs = Math.min(s.minBigs, c.big);
		s.maxGuards = Math.max(s.maxGuards, c.guard);
		s.shortHanded += Number(
			players.filter((p) => p.injury.gamesRemaining === 0).length < 8,
		);
	}
	return s;
};

describe.skipIf(!MODE)("roster balance", () => {
	test("seasons", { timeout: 6 * 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(SEED);
		const on = MODE === "on";
		const settings: any = getDefaultSettings();
		settings.spectator = true;
		settings.featureAiRosterBalance = on;
		await league.createStream(
			{},
			{
				confs: last(defaultGameAttributes.confs).value,
				divs: last(defaultGameAttributes.divs).value,
				fromFile: {
					gameAttributes: undefined,
					hasRookieContracts: true,
					maxGid: undefined,
					startingSeason: undefined,
					teams: undefined,
					version: LEAGUE_DATABASE_VERSION,
				},
				getLeagueOptions: undefined,
				keptKeys: new Set(),
				lid: 0,
				name: `rosterBalance${SEED}`,
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		await league.setGameAttributes({ featureAiRosterBalance: on } as any);
		// ROSTER_BALANCE_INJURY=4: 4x the injury rate, to see the hardship signings at work
		if (env.ROSTER_BALANCE_INJURY) {
			await league.setGameAttributes({
				injuryRate: g.get("injuryRate") * Number(env.ROSTER_BALANCE_INJURY),
			});
		}
		console.log(
			`MODE ${MODE} seed ${SEED} feature ${g.get("featureAiRosterBalance" as any)}`,
		);
		console.log(`START ${JSON.stringify(await snapshot())}`);

		for (let i = 0; i < SEASONS; i++) {
			const s = g.get("season");
			hardshipDiag.signed = 0;
			hardshipDiag.released = 0;
			hardshipDiag.kept = 0;
			hardshipDiag.shortDays = 0;
			hardshipDiag.noRoom = 0;
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			const opening = await snapshot();
			let shortHandedTeamDays = 0;
			let samples = 0;
			let worst = { fewBigs: 0, fewGuards: 0, manyBigs: 0, manyGuards: 0 };
			let guard = 0;
			while (
				g.get("phase") === PHASE.REGULAR_SEASON ||
				g.get("phase") === PHASE.AFTER_TRADE_DEADLINE
			) {
				// A week at a time, sampling the rosters in between
				await game.play(Math.min(7, await season.getDaysLeftSchedule()), {});
				const snap = await snapshot();
				shortHandedTeamDays += snap.shortHanded;
				samples += 1;
				worst = {
					fewBigs: Math.max(worst.fewBigs, snap.fewBigs),
					fewGuards: Math.max(worst.fewGuards, snap.fewGuards),
					manyBigs: Math.max(worst.manyBigs, snap.manyBigs),
					manyGuards: Math.max(worst.manyGuards, snap.manyGuards),
				};
				if ((await season.getDaysLeftSchedule()) === 0) {
					break;
				}
				if (++guard > 60) {
					throw new Error("stuck in regular season");
				}
			}
			const end = await snapshot();
			console.log(
				`SEASON ${JSON.stringify({
					season: s,
					opening,
					end,
					worstWeek: worst,
					shortHandedTeamWeeks: shortHandedTeamDays,
					samples,
					hardship: { ...hardshipDiag },
				})}`,
			);
			let guard2 = 0;
			while (
				g.get("phase") === PHASE.REGULAR_SEASON ||
				g.get("phase") === PHASE.AFTER_TRADE_DEADLINE ||
				g.get("phase") === PHASE.PLAYOFFS
			) {
				await game.play(
					g.get("phase") === PHASE.PLAYOFFS
						? 100
						: await season.getDaysLeftSchedule(),
					{},
				);
				if (++guard2 > 50) {
					throw new Error("stuck in playoffs");
				}
			}
			await phase.newPhase(PHASE.DRAFT, {});
			await draft.runPicks({ type: "untilEnd" }, {});
			await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
			await phase.newPhase(PHASE.FREE_AGENCY, {});
			let faDays = 0;
			while (g.get("phase") === PHASE.FREE_AGENCY) {
				await freeAgents.play(30, {});
				if (++faDays > 10) {
					throw new Error("stuck in free agency");
				}
			}
			console.log(`PRESEASON ${JSON.stringify(await snapshot())}`);
		}
	});
});
