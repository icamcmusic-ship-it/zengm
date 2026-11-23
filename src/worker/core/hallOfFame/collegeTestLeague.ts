// For tests only: a headless spectator college league and a whole-season loop (collegeHallOfFame tests and the measurement script).
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	getCollegeLeagueTeams,
	type CollegeLevel,
} from "../../../common/college/teams.ts";
import { getCollegeSettings } from "../../../common/college/settings.ts";
import { game, league, phase } from "../index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g } from "../../util/index.ts";
import { finishOffseasonWeeks } from "../college/recruiting.ts";

export const createCollegeTestLeague = async (
	seed: number,
	level: CollegeLevel = "power",
) => {
	Math.random = makeSeededRandom(seed);
	const { teams, confs, divs } = getCollegeLeagueTeams(level);
	await league.createStream(
		{},
		{
			confs,
			divs,
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
			name: "college hof",
			setLeagueCreationStatus: () => {},
			settings: {
				...getDefaultSettings(),
				...getCollegeSettings(level),
				collegeQuickSim: true,
				// Nobody to wait for: auto play everything
				spectator: true,
			} as any,
			shuffleRosters: false,
			startingSeasonFromInput: "2025",
			teamsFromInput: teams.map((t) => ({ ...t, popRank: 1 })) as any,
			tid: 0,
		},
	);
	await league.loadGameAttributes();
};

// Play days until the phase changes, with a guard (game.play can refuse to play forever, e.g. a short user roster)
const playPhase = async () => {
	const start = g.get("phase");
	let days = 0;
	while (g.get("phase") === start) {
		await game.play(1, {});
		days += 1;
		if (days > 200) {
			throw new Error(
				`Phase ${start} did not end after ${days} days (season ${g.get("season")})`,
			);
		}
	}
};

/**
 * From the preseason, a whole season: regular season, conference and national tournaments (the Hall of Fame runs when the season is
 * over), departures, portal, recruiting, signing day, and the next preseason.
 */
export const playCollegeSeason = async () => {
	await phase.newPhase(PHASE.REGULAR_SEASON, {});
	for (let i = 0; i < 3 && g.get("phase") < PHASE.DRAFT_LOTTERY; i++) {
		await playPhase();
	}
	if (g.get("phase") !== PHASE.DRAFT_LOTTERY) {
		throw new Error(
			`Season ${g.get("season")} ended in phase ${g.get("phase")}`,
		);
	}
	await phase.newPhase(PHASE.DRAFT, {});
	await phase.newPhase(PHASE.AFTER_DRAFT, {});
	await finishOffseasonWeeks();
	await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
	await phase.newPhase(PHASE.FREE_AGENCY, {});
	await phase.newPhase(PHASE.PRESEASON, {});
};
