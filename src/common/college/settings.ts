// College mode: the settings a college league is created with. See docs/college-mode.md.
import { COLLEGE_SCHOLARSHIPS } from "./constants.ts";
import {
	getCollegeLeagueTeams,
	getCollegeTournamentSize,
	type CollegeLevel,
} from "./teams.ts";

// League Extras that read the whole league or make little sense with hundreds of teams: off by default in a college league
// (the user can turn them back on), unlike the ones flagged college: false in the registry, which are always off
const EXTRAS_OFF_BY_DEFAULT = [
	"featureNewspaper",
	"featureWrapped",
	"featureStorylines",
	"featureHype",
	"featureBestGames",
	"featureLeagueAchievements",
	"featureTimeline",
	"featureRecordsBook",
	"featureMilestones",
	"featureRivalries",
	"featureFrivolities",
] as const;

// Always off (also forced by the registry flag), written explicitly so code that reads the raw game attribute sees false
const EXTRAS_FORCED_OFF = [
	"featureTradeGrader",
	"featureContractValue",
	"featureSeasonOdds",
	"contractOptions",
	"contractExtensions",
	"tradeRequests",
	"featureHoldouts",
	"featureTradeExplain",
	"aiTradesNeedBased",
	"featureAiTradeOffers",
	"featureTradeMarket",
	"featureThreeTeamTrades",
	"featureDraftPickConditions",
	"featureGmPersonalities",
	"featureCollegeStats",
	"featureCollegeSeason",
	"featureDraftClassShapes",
	"featureRatingsRegenerator",
	"scoutingSystem",
	"featureDraftBoard",
	"featureAiDraftNeeds",
	"featureMockDraft",
	"featureUnretire",
	"featureAwardVote",
	"featureSeriesRecaps",
	"generateCollegeStats",
	"rerandomizeDraftClassRatings",
] as const;

/**
 * Settings of a college league, to merge over the new league defaults.
 */
export const getCollegeSettings = (level: CollegeLevel) => {
	const numTeams = getCollegeLeagueTeams(level).teams.length;
	const numRounds = Math.log2(getCollegeTournamentSize(numTeams));

	const settings: Record<string, unknown> = {
		leagueType: "college",
		collegeLevel: level,
		collegeAutoRecruit: true,

		// Rules
		numPeriods: 2,
		quarterLength: 20,
		overtimeLength: 5,
		foulsNeededToFoulOut: 5,
		// Two shots from the 10th team foul of a half (one-and-one from the 7th), every foul in overtime
		foulsUntilBonus: [10, 1, 10],
		oneAndOne: true,
		oneAndOneFouls: 7,
		customShotClock: true,
		shotClockLength: 30,
		...COLLEGE_SIM_CALIBRATION,

		// Season
		numGames: 30,
		numGamesDiv: null,
		numGamesConf: null,
		allStarGame: null,
		tradeDeadline: 1,
		numGamesPlayoffSeries: Array.from({ length: numRounds }, () => 1),
		numPlayoffByes: 0,
		playIn: false,
		playoffsByConf: false,
		playoffsReseed: false,
		neutralSite: "playoffs",

		// Rosters: 13 scholarships, nobody is cut or signed
		maxRosterSize: COLLEGE_SCHOLARSHIPS,
		minRosterSize: 9,
		draftAges: [18, 18],
		numDraftRounds: 0,
		numDraftClasses: 1,
		draftType: "freeAgents",
		forceRetireAge: 0,
		minRetireAge: 30,

		// No money
		salaryCapType: "none",
		budget: false,
		aiTradesFactor: 0,
		challengeNoTrades: false,
		inflationAvg: 0,
		inflationMax: 0,
		inflationMin: 0,
		inflationStd: 0,
		playersRefuseToNegotiate: false,
		aiJerseyRetirement: false,
		tragicDeathRate: 0,
		sonRate: 0,
		brotherRate: 0,

		// Hundreds of teams: keep what is stored small
		pbpStore: "user",
		saveOldBoxScores: {
			pastSeasons: 1,
			pastSeasonsType: "your",
			note: "all",
			playoffs: "your",
			finals: "all",
		},
	};

	for (const key of EXTRAS_OFF_BY_DEFAULT) {
		settings[key] = false;
	}
	for (const key of EXTRAS_FORCED_OFF) {
		settings[key] = false;
	}

	return settings;
};

// Game sim tendencies tuned so that college rosters under college rules score like college teams (see the Calibration section of
// docs/college-mode.md and src/worker/core/college/collegeCalibration.script.test.ts)
export const COLLEGE_SIM_CALIBRATION = {
	pace: 88,
	threePointTendencyFactor: 1.9,
	threePointAccuracyFactor: 1.03,
	twoPointAccuracyFactor: 1.15,
	ftAccuracyFactor: 1.1,
	blockFactor: 1.3,
	foulRateFactor: 1.55,
	orbFactor: 1.03,
};
