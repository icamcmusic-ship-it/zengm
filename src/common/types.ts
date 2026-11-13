import type { StoredSubInfo } from "./subRatingsGen.ts";
import type { RumorState } from "./rumors/types.ts";
import * as z from "zod";
import type { IsExact } from "conditional-type-checks";
import type { FaceConfig } from "facesjs";
import type { ReactNode } from "react";
import type { RBState } from "./recordsBook.ts";
import type { MarqueeKind } from "./marquee.ts";
import type { DraftCombineResult } from "./draftCombine.ts";
import type { CapExceptionType, TeamCapExceptions } from "./capExceptions.ts";
import type * as views from "../worker/views/index.ts";

import {
	awardSettingsSchema,
	type AwardPlayer,
	type AwardInfoCommon,
	type AwardInfoIndividual,
	type AwardInfoTeam,
	type AwardSettingIndividual,
	type AwardSettingTeam,
	type AwardSettings,
	type PlayerAwardBuiltIn,
	type PlayerAwardSimple,
	type PlayerAward,
	type Award,
	type Awards,
} from "../../common/types.ts";

export {
	awardSettingsSchema,
	type AwardPlayer,
	type AwardInfoCommon,
	type AwardInfoIndividual,
	type AwardInfoTeam,
	type AwardSettingIndividual,
	type AwardSettingTeam,
	type AwardSettings,
	type PlayerAwardBuiltIn,
	type PlayerAwardSimple,
	type PlayerAward,
	type Award,
	type Awards,
};

// Would be nice to make .at(-1) return T but idk how, so use the `last` function instead!
export type NonEmptyArray<T> = [T, ...T[]];

export type Env = {
	bbgmVersion: string;
	enableLogging: boolean;
	heartbeatID: string;
	mobile: boolean;
	useSharedWorker: boolean;
};

declare global {
	var bbgm: any; // Just for debugging, in worker and UI
	var stream0: unknown; // Only in worker, see where it is assigned
	interface Window {
		bbgmVersion: string;
		enableLogging: boolean;
		freestar: any;
		getTheme: () => "dark" | "light";
		getThemeFilename: (theme: "dark" | "light") => string;
		mobile: boolean;
		releaseStage: "unknown" | "development" | "beta" | "production";
		themeCSSLink: HTMLLinkElement;
		useSharedWorker: boolean;
		withGoodUI: () => void;
		withGoodWorker: () => void;
	}

	const __NODE_ENV: "development" | "production" | "test";
	const __SPORT: "basketball" | "football" | "baseball" | "hockey";
	const __JSON_URLS: {
		names: string;
		namesFemale: string;
		realPlayerData: string;
		realPlayerStats: string;
	};
}

type ViewsKeys = keyof typeof views;

export type View<Name extends ViewsKeys> = Exclude<
	Awaited<
		Name extends ViewsKeys
			? ReturnType<(typeof views)[Name]["load"]>
			: Record<string, unknown>
	>,
	void | { redirectUrl: string } | { errorMessage: string }
>;

export type AchievementWhen =
	| "afterAwards"
	| "afterFired"
	| "afterPlayoffs"
	| "afterRegularSeason";

export type Achievement = {
	slug: string;
	name: string;
	category: string;
	desc: string;
	check?: () => boolean | Promise<boolean>;
	when?: AchievementWhen;
};

export type AllStarPlayer = {
	injured?: true;
	pid: number;
	tid: number;
	name: string;
};

export type DunkAttempt = {
	toss: string;
	distance: string;
	move1: string;
	move2: string;
};

type DunkResult = {
	// Index of dunk.players
	index: number;

	// Last attempt is the first successful one
	attempts: DunkAttempt[];

	// undefined until a successful dunk or LOWEST_POSSIBLE_SCORE
	score?: number;
	made: boolean;
};

// Done rack when there are 5 entries here
type ThreeRack = boolean[];

export type ThreeResult = {
	index: number;
	racks: ThreeRack[];
};

export type AllStars = {
	season: number;
	teamNames: [string, string];
	teams: [AllStarPlayer[], AllStarPlayer[]];
	remaining: AllStarPlayer[];
	finalized: boolean; // Refers to if draft is complete or not
	type: GameAttributesLeague["allStarType"];

	// After game is complete
	gid?: number;
	score?: [number, number];
	sPts?: [number, number]; // Only if there was a shootout
	overtimes?: number;
	mvp?: {
		pid: number;
		tid: number;
		name: string;
	};

	dunk?: {
		players: AllStarPlayer[];

		// 2 rounds, plus tiebreaker rounds
		rounds: {
			tiebreaker?: true;
			dunkers: number[]; // Index of dunk.players

			// Default is 2 dunks per player per round, but tiebreaker rounds are 1 dunk per round
			dunks: DunkResult[];
		}[];

		controlling: number[]; // Indexes of dunk.players

		// Index of players array above. Undefined if still in progress
		winner?: number;

		// 2 players each because you can't jump over yourself, but the tallest/shortest player might be a contestant
		pidsTall: [number, number];
		pidsShort: [number, number];
	};

	three?: {
		players: AllStarPlayer[];

		rounds: {
			tiebreaker?: true;
			indexes: number[]; // Index of three.players

			results: ThreeResult[];
		}[];

		// Index of players array above. Undefined if still in progress
		winner?: number;
	};
};

export type CompositeWeights<RatingKey = string> = {
	[key: string]: {
		ratings: (RatingKey | number)[];
		weights?: number[];
		skill?: {
			label: string;
			cutoff?: number;
		};
	};
};

export type Conditions = {
	hostID?: number;
};

export type DraftLotteryResultArray<Completed = boolean> = {
	tid: number;
	originalTid: number;
	chances: number;
	pick: Completed extends true ? number : number | undefined;
	dpid: number;
}[];

export type DraftLotteryResult<Completed = true> = {
	season: number;
	draftType?:
		| Exclude<
				DraftType,
				"random" | "noLottery" | "freeAgents" | "noLotteryReverse"
		  >
		| "dummy";
	rigged?: GameAttributesLeague["riggedLottery"];
	result: DraftLotteryResultArray<Completed>;
} & (
	| {
			draftType: "nba2027";
			// This is so draftTeamHistory can show accurate historical progs for the nba2027 draftType. Values are indexes of the result array, not tids!
			nba2027: {
				restricted1: number[];
				restricted5: number[];
			};
	  }
	| {
			draftType?:
				| Exclude<
						DraftType,
						| "random"
						| "noLottery"
						| "freeAgents"
						| "noLotteryReverse"
						| "nba2027"
				  >
				| "dummy";
			nba2027?: undefined;
	  }
);

export type DraftPickSeason = number | "fantasy" | "expansion";

export type DraftPickWithoutKey = {
	dpid?: number;
	tid: number;
	originalTid: number;
	round: number;
	pick: number; // 0 if not set
	season: DraftPickSeason;
	note?: string;
	noteBool?: 1; // Keep in sync with note - for indexing

	// Draft pick conditions (featureDraftPickConditions), see common/draftPickConditions.ts
	protection?: DraftPickProtection;
	swap?: DraftPickSwapRight;
};

export type DraftPickProtectionThen =
	| "unprotected"
	| "secondRound"
	| "extinguish";

// The pick goes to tid (the team that traded it away) if it lands in the top `top` picks of its round. Then next
// season's pick of the same original team is owed instead, protected top rollover[0], and so on. When rollover runs out
// and the pick was protected again, `then` applies to the following season.
export type DraftPickProtection = {
	tid: number;
	top: number;
	rollover: number[];
	then: DraftPickProtectionThen;
};

// Team tid has the right to swap its own pick (same season and round) for this one, if this one is better
export type DraftPickSwapRight = {
	tid: number;
};

export type PickConditionSpec =
	| {
			type: "protection";
			top: number;
			rollover: number[];
			then: DraftPickProtectionThen;
			// Replaces the protection already stored on the pick (from an earlier trade), instead of adding a new one. top 0 removes it. Only allowed when the team holding that protection is in the trade.
			amend?: true;
	  }
	| {
			type: "swap";
	  };

// A condition added to a pick in a trade. dpid is a pick sent by the team whose TradeTeam holds this, tid is the team receiving it
export type TradePickCondition = PickConditionSpec & {
	dpid: number;
	tid?: number;
};

export type DraftPick = {
	dpid: number;
} & DraftPickWithoutKey;

export type DraftType =
	| "nba1994"
	| "nba2019"
	| "noLottery"
	| "noLotteryReverse"
	| "random"
	| "coinFlip"
	| "randomLottery"
	| "randomLotteryFirst3"
	| "nba1990"
	| "freeAgents"
	| "nhl2017"
	| "nhl2021"
	| "mlb2022"
	| "custom"
	| "cola"
	| "nba2027";

// Key is team ID receiving this asset
// Why store name and extra draft pick info? For performance a bit, but mostly in case old players are deleted in a league, the trade event will still show something reasonable
type TradeEventAsset =
	| {
			pid: number;
			name: string;
			contract: FlatContractInfo;
			ratingsIndex: number;
			statsIndex: number;
	  }
	| {
			dpid: number;
			season: DraftPickSeason;
			round: number;
			originalTid: number;

			// Text of the condition added in this trade, like "top 10 protected"
			condition?: string;

			// Only the right to swap picks was traded, not the pick itself
			swap?: true;
	  };

export type TradeEventTeams = [
	{
		assets: TradeEventAsset[];
	},
	{
		assets: TradeEventAsset[];
	},
];

export type DiscriminateUnion<T, K extends keyof T, V extends T[K]> =
	T extends Record<K, V> ? T : never;

export type EventBBGMWithoutKey =
	| {
			type: Exclude<
				LogEventType,
				"sisyphus" | "trade" | "freeAgent" | "reSigned"
			>;
			text: string;
			pids?: number[];
			dpids?: number[];
			tids?: number[];
			season: number;

			// < 10: not very important
			// < 20: somewhat important
			// >= 20: very important
			score?: number;
	  }
	| {
			type: "sisyphus";
			pids: [number];
			tids: number[];
			season: number;
			wonTitle: boolean;

			// For TypeScript, never actually used
			score?: undefined;
			text?: undefined;
			dpids?: undefined;
	  }
	| {
			type: "trade";
			text?: string; // Only legacy will have text
			pids: number[];
			dpids: number[];
			tids: [number, number];
			season: number;

			// These three will only be undefined in legacy events
			phase?: Phase;
			score?: number;
			teams?: TradeEventTeams;

			// Why the AI made this trade, or that it was one leg of a three-team trade. Appended to the event text
			note?: string;
	  }
	| {
			type: "freeAgent" | "reSigned";
			text?: string; // Only legacy will have text
			pids: [number];
			tids: [number];
			season: number;

			// These three will only be undefined in legacy events
			phase?: Phase;
			score?: number;
			contract?: FlatContractInfo;

			// Salary cap exception the signing used, if any
			exception?: CapExceptionType;

			// Never defined, just for TypeScript
			dpids?: number[];
	  };

export type EventBBGM = EventBBGMWithoutKey & {
	eid: number;
};

type GameTeam = {
	tid: number;
	players: any[];

	ovr?: number; // Undefined for legacy objects
	won?: number; // Undefined for legacy objects
	lost?: number; // Undefined for legacy objects
	tied?: number; // Undefined for legacy objects or if there are no ties in this sport
	otl?: number; // Undefined for legacy objects or if there are no otls in this sport

	playerFeat?: boolean;
	playoffs?: {
		seed: number;
		won: number;
		lost: number;
	};

	// This stat is guaranteed to be here in all sports. Others maybe not
	pts: number;

	// Defined only if it's a shootout
	sPts?: number;

	// For stats
	[key: string]: any;
};

export type Game = {
	att: number;
	clutchPlays?: string[];
	day?: number; // Only optional for legacy
	finals?: boolean;
	forceWin?: number; // If defined, it's the number of iterations that were used to force the win/tie
	gid: number;
	lost: {
		tid: number;
		pts: number;
		sPts?: number;
	};
	neutralSite?: boolean;
	// Marquee Games: holiday slate or national TV, and rivalry games (from the schedule)
	marquee?: MarqueeKind;
	rivalry?: boolean;
	note?: string;
	noteBool?: 1; // Keep in sync with note - for indexing
	numGamesToWinSeries?: number;
	numPeriods?: number; // Optional only for legacy, otherwise it's the number of periods in the game, defined at the start
	numPlayersOnCourt?: number;
	quarterLength?: number; // Minutes per period when the game was played (missing for older games)
	playoffs?: boolean;
	// College mode: an NIT game (also playoffs, played in the national tournament's days). Its stats are not postseason stats
	nit?: boolean;
	overtimes: number;
	scoringSummary?: unknown;
	// Basketball: the play-by-play, compact (see src/common/pbpStore.basketball.ts)
	pbp?: string;
	season: number;
	teams: [GameTeam, GameTeam];
	won: {
		tid: number;
		pts: number;
		sPts?: number;
	};
};

export type GamePlayer = any;

export type GameResults = any;

type GameAttributesNonLeague = { lid: undefined };

export type ScheduledEventGameAttributes = {
	type: "gameAttributes";
	season: number;
	phase: Phase;
	info: Partial<GameAttributesLeague>;
};

export type ScheduledEventTeamInfo = {
	type: "teamInfo";
	season: number;
	phase: Phase;
	info: {
		tid: number;
		abbrev?: string;
		cid?: number;
		colors?: [string, string, string];
		did?: number;
		imgURL?: string;
		imgURLSmall?: string;
		jersey?: string;
		name?: string;
		pop?: number;
		region?: string;
		srID?: string;
		stadiumCapacity?: number;
	};
};

// Changing conferences and divisions requires also specifying which division each team is in. Also there is no way to edit confs/divs from SettingsForm
type ScheduledEventConfsDivs = {
	type: "confsDivs";
	season: number;
	phase: Phase;
	info: {
		confs: GameAttributesLeague["confs"];
		divs: GameAttributesLeague["divs"];

		// Teams not listed here keep the did they had before
		teams: {
			tid: number;
			did: number;
		}[];
	};
};

// No way to edit awards from SettingsForm
type ScheduledEventAwards = {
	type: "awards";
	season: number;
	phase: Phase;
	info: {
		awards: GameAttributesLeague["awards"];
	};
};

export type ScheduledEventWithoutKey = (
	| ScheduledEventTeamInfo
	| ScheduledEventGameAttributes
	| ScheduledEventConfsDivs
	| ScheduledEventAwards
	| {
			type: "expansionDraft";
			season: number;
			phase: Phase;
			info: {
				// Actually stadiumCapacity is optional
				teams: (ExpansionDraftSetupTeam & {
					tid: number;
					srID?: string;
				})[];
				numProtectedPlayers?: number;
			};
	  }
	| {
			type: "contraction";
			season: number;
			phase: Phase;
			info: {
				tid: number;
			};
	  }
	| {
			type: "retirePlayer";
			season: number;
			phase: Phase;
			info: {
				pid: number;
			};
	  }
	| {
			type: "unretirePlayer";
			season: number;
			phase: Phase;
			info: {
				pid: number;
			};
	  }
) & { id?: number };

export type ScheduledEvent = ScheduledEventWithoutKey & { id: number };

export type GameAttributeWithHistory<T> = NonEmptyArray<{
	start: number;
	value: T;
}>;

export type ExpansionDraftSetupTeam = {
	abbrev: string;
	region: string;
	name: string;
	imgURL: string | undefined;
	imgURLSmall?: string;
	colors: [string, string, string];
	jersey?: string;
	pop: string;
	stadiumCapacity: string;
	did: string;
	takeControl: boolean;

	// tid is for referencing a disabled current team
	tid?: number;
};

export type NamesLegacy = {
	first: {
		[key: string]: [string, number][];
	};
	last: {
		[key: string]: [string, number][];
	};
};

export type Conf = { cid: number; name: string; abbrev?: string };
export type Div = { cid: number; did: number; name: string; abbrev?: string };

export type InjuriesSetting = {
	name: string;
	frequency: number;
	games: number;
}[];

export type TragicDeaths = {
	reason: string;
	frequency: number;
}[];

type FootballOvertime = "suddenDeath" | "exceptFg" | "bothPossess";

export type GameAttributesLeague = NativeFeatureGameAttributes & {
	aiJerseyRetirement: boolean;
	aiTradesFactor: number;

	// AI-to-AI trades are driven by team needs (contenders buy, rebuilders sell, salary dumps) rather than just random
	aiTradesNeedBased: boolean;

	// How often AI teams send trade offers to the user during the season, roughly offers per 10 games. 0 disables
	aiTradeOffersFrequency: number;

	// Pending AI-initiated trade offers to the user
	aiTradeOffers: AiTradeOffer[];

	// Rumors (League extras): the rumor mill's rolling window and track record, undefined until the first rumor
	rumors: RumorState | undefined;

	allStarGame: number | null;
	allStarNum: number;
	allStarType: "draft" | "byConf" | "top";
	allStarDunk: boolean;
	allStarThree: boolean;
	alwaysShowCountry: boolean;
	autoExpand:
		| {
				phase: "vote";
				abbrevs: string[];
		  }
		| undefined;
	autoExpandProb: number;
	autoExpandNumTeams: number;
	autoExpandMaxNumTeams: number;
	autoExpandGeo: "naFirst" | "naOnly" | "any";
	autoRelocate:
		| {
				phase: "vote";
				tid: number;
				abbrev: string;
				realigned?: number[][];
		  }
		| undefined;
	autoRelocateProb: number;
	autoRelocateGeo: "naFirst" | "naOnly" | "any";
	autoRelocateRealign: boolean;
	autoRelocateRebrand: boolean;
	awards: AwardSettings;
	brotherRate: number;
	budget: boolean;
	challengeNoDraftPicks: boolean;
	challengeNoFreeAgents: boolean;
	challengeNoRatings: boolean;
	challengeNoTrades: boolean;
	challengeLoseBestPlayer: boolean;
	challengeFiredLuxuryTax: boolean;
	challengeFiredMissPlayoffs: boolean;
	challengeSisyphusMode: boolean;
	challengeThanosMode: number;
	thanosCooldownEnd: number | undefined;
	confs: NonEmptyArray<Conf>;
	daysLeft: number;
	defaultStadiumCapacity: number;
	dh: "all" | "none" | number[];
	difficulty: number;
	divs: NonEmptyArray<Div>;
	draftAges: [number, number];
	draftPickAutoContract: boolean;
	draftPickAutoContractPercent: number;
	draftPickAutoContractRounds: number;
	draftType: DraftType;
	draftLotteryCustomChances: number[];
	draftLotteryCustomNumPicks: number;
	elam: boolean;
	elamASG: boolean;
	elamMinutes: number;
	elamOvertime: boolean;
	elamPoints: number;
	// Basketball: store each game's play-by-play with its box score
	storePlayByPlay: boolean;
	// Basketball: show the play-by-play feed in the live game view
	pbpLiveGame: boolean;
	// Basketball: box score play-by-play tab always, or only after pressing a button
	pbpBoxScore: import("./pbpSettings.ts").PbpBoxScoreMode;
	// Basketball: which games keep their play-by-play (storePlayByPlay false still means none, for old leagues)
	pbpStore: import("./pbpSettings.ts").PbpStoreScope;
	// Basketball: technical and flagrant fouls, ejections in the game sim
	technicalFouls: boolean;
	realisticPossessions: boolean;
	// Basketball: re-injury risk, minutes restrictions after injuries, load management, back-to-back effects, injury-prone players
	injuryDepth: boolean;
	// Basketball: player traits (clutch, durability, ...) that the game sim reads, see src/common/playerTraits and docs/player-traits.md
	playerTraits: boolean;
	// Seed for the stored trait components, set once when a league is created (0 in older leagues)
	playerTraitsSeed: number;
	equalizeRegions: boolean;
	fantasyPoints?: "standard" | "ppr" | "halfPpr";
	forceRetireAge: number;
	forceRetireSeasons: number;
	foulsNeededToFoulOut: number;
	foulsUntilBonus: [number, number, number];
	foulRateFactor: number;
	gameOver: boolean;
	gender: "female" | "male";
	goatFormula?: string;
	// League achievements already announced and their log (basketball, see worker/util/leagueAchievementsStore.ts). Kept with the league so export/import carries it
	leagueAchievements?: {
		v: 1;
		startingSeason: number;
		seen: Record<string, [number, number]>;
		log: {
			id: string;
			season: number;
			phase: number;
			who?: string;
			pid?: number;
			tid?: number;
			at?: number;
			quiet?: boolean;
		}[];
	};
	// Records Book single-game highs, streaks and record holders (basketball, see worker/util/recordsBookData.ts)
	recordsBook?: RBState;
	goatSeasonFormula?: string;
	godMode: boolean;
	godModeInPast: boolean;
	gracePeriodEnd: number;
	groupScheduleSeries: boolean;
	// Realistic schedule length: old compact schedule days / days of the current season's schedule (1 for the old
	// schedule). Daily processes run on that fraction of the days, see worker/core/season/scheduleDayScale.ts
	scheduleDayScale: number;
	// Realistic schedule length: the current season's schedule is spread over the calendar (games every other day or so). Usually
	// the same as scheduleDayScale < 1, but in a 2-3 team league the old schedule already had one game a day, so the scale stays 1
	scheduleSpread: boolean;
	heightFactor: number;
	hideDisabledTeams: boolean;
	hofFactor: number;
	homeCourtAdvantage: number;
	inflationAvg: number;
	inflationMax: number;
	inflationMin: number;
	inflationStd: number;
	injuries?: InjuriesSetting;
	injuryRate: number;
	lid: number;
	lowestDifficulty: number;
	luxuryPayroll: number;
	luxuryTax: number;
	maxContract: number;
	maxContractLength: number;
	maxOvertimes: number | null; // null means infinite overtimes (no ties/shootouts)
	maxOvertimesPlayoffs: number | null; // null means infinite overtimes (no shootouts)
	maxRosterSize: number;
	minContract: number;
	minContractLength: number;
	minPayroll: number;
	minRetireAge: number;
	minRosterSize: number;
	names?: NamesLegacy;
	nextPhase?: Phase;
	numActiveTeams: number;
	numDraftPicksCurrent?: number;
	numDraftRounds: number;
	numDraftClasses: number;
	numGames: number;
	numGamesDiv: number | null;
	numGamesConf: number | null;
	numGamesPlayoffSeries: number[];
	numPeriods: number;
	numPlayersDunk: number;
	numPlayersOnCourt: number;
	numPlayersThree: number;
	numPlayoffByes: number;
	numSeasonsFutureDraftPicks: number;
	numTeams: number;
	numWatchColors: number;
	playIn: boolean;
	playerMoodTraits: boolean;
	pointsFormula: string;
	shootoutRounds: number;
	shootoutRoundsPlayoffs: number;
	spectator: boolean;
	otl: boolean;
	otherTeamsWantToHire: boolean;
	phase: Phase;
	playerBioInfo?: PlayerBioInfo;
	playersRefuseToNegotiate: boolean;
	// Player/team options and partially guaranteed contracts
	contractOptions: boolean;
	// In-season contract extensions for players in the last seasons of their contracts
	contractExtensions: boolean;
	// Very unhappy stars ask to be traded
	tradeRequests: boolean;
	// How often unhappy players hold out, 0 is never and 1 is the default
	holdoutFrequency: number;
	playoffsByConf: boolean;
	playoffsNumTeamsDiv: number;
	playoffsReseed: boolean;
	quarterLength: number;
	randomDebutsForever?: number;
	realDraftRatings?: RealDraftRatingsSetting;
	realPlayerDeterminism: number;
	repeatSeason:
		| undefined
		| {
				type: "playersAndRosters";
				startingSeason: number;
				players: Record<
					number,
					{
						tid: number;
						contract: FlatContractInfo;
						injury: PlayerInjury;
					}
				>;
		  }
		| {
				type: "players";
				startingSeason: number;
		  };
	riggedLottery?: (number | null)[];
	rookieContractLengths: number[];
	rookiesCanRefuse: boolean;
	salaryCap: number;
	salaryCapType: "hard" | "none" | "soft";
	saveOldBoxScores: {
		pastSeasons: number | "all";
		pastSeasonsType?: "your" | "all";
		note?: "your" | "all";
		playoffs?: "your" | "all";
		finals?: "your" | "all";
		playerFeat?: "your" | "all";
		clutchPlays?: "your" | "all";
		allStar?: "all";
	};
	season: number;
	softCapTradeSalaryMatch: number;
	sonRate: number;
	startingSeason: number;
	saveEveryDay: boolean;
	stopOnInjury: boolean;
	stopOnInjuryGames: number;
	tiebreakers: (keyof typeof TIEBREAKERS)[];
	teamInfoCache: {
		abbrev: string;
		region: string;
		name: string;
		imgURL: string | undefined;
		imgURLSmall: string | undefined;
		disabled: boolean | undefined;
	}[];
	tradeDeadline: number;
	tradeProposalsSeed: number;
	tragicDeathRate: number;
	tragicDeaths?: TragicDeaths;
	userTid: number;
	userTids: number[];
	weightFactor: number;

	threePointers: boolean;
	threePointTendencyFactor: number;
	threePointAccuracyFactor: number;
	twoPointAccuracyFactor: number;
	ftAccuracyFactor: number;
	blockFactor: number;
	stealFactor: number;
	turnoverFactor: number;
	orbFactor: number;
	pace: number;
	expansionDraft:
		| {
				phase: "setup";
				numPerTeam?: string;
				numProtectedPlayers?: string;
				teams?: ExpansionDraftSetupTeam[];
		  }
		| {
				phase: "protection";
				numPerTeam: number;
				numProtectedPlayers: number;
				expansionTids: number[];
				protectedPids: { [key: number]: number[] };
				allowSwitchTeam: boolean;
		  }
		| {
				phase: "draft";
				numPerTeam: number;
				numPerTeamDrafted: Record<number, number>;
				expansionTids: number[];
				availablePids: number[];
		  };

	passFactor: number;
	rushYdsFactor: number;
	passYdsFactor: number;
	completionFactor: number;
	scrambleFactor: number;
	sackFactor: number;
	fumbleFactor: number;
	intFactor: number;
	fgAccuracyFactor: number;
	fourthDownFactor: number;
	onsideFactor: number;
	onsideRecoveryFactor: number;
	hitFactor: number;
	giveawayFactor: number;
	takeawayFactor: number;
	deflectionFactor: number;
	saveFactor: number;
	assistFactor: number;
	foulFactor: number;
	groundFactor: number;
	lineFactor: number;
	flyFactor: number;
	powerFactor: number;
	throwOutFactor: number;
	strikeFactor: number;
	balkFactor: number;
	wildPitchFactor: number;
	passedBallFactor: number;
	hitByPitchFactor: number;
	swingFactor: number;
	contactFactor: number;
	errorFactor: number;
	neutralSite: "never" | "finals" | "playoffs";
	rpdPot: boolean;
	currencyFormat: [string, "." | ",", string];
	overtimeLength: number;
	overtimeLengthPlayoffs: number | null;
	forceRetireRealPlayers: boolean;
	forceHistoricalRosters: boolean;
	scrimmageTouchbackKickoff: number;
	twoPointConversions: boolean;
	footballOvertime: FootballOvertime;
	footballOvertimePlayoffs: FootballOvertime;
	easterEggPlayers: boolean;

	// Basketball only. Generate college stats and honors for each new draft class as it is created
	generateCollegeStats: boolean;

	// College mode (docs/college-mode.md). leagueType is set at league creation and never changes
	leagueType: "pro" | "college";
	collegeLevel: "power" | "major" | "full" | undefined;
	collegeAutoRecruit: boolean;
	collegeState: import("./college/types.ts").CollegeState | undefined;
	// 68-team national tournament with the First Four (new college leagues; off for leagues made before it)
	collegeFirstFour: boolean;
	collegeRecruiting:
		| import("./college/types.ts").CollegeRecruitingState
		| undefined;
	// Pro league: the college league whose departed players become its draft classes (docs/college-mode.md)
	linkedCollege: LinkedCollege | undefined;
	scoutingSystem: boolean;
	rerandomizeDraftClassRatings: boolean;
	// Saved from the Regenerate ratings modal ("save as league default"), used by rerandomizeDraftClassRatings
	draftClassRegenSettings: Record<string, unknown> | undefined;
	draftBoardAutoDraft: boolean;

	// Basketball only. Real coaching staff (coaches with ratings and contracts) instead of the coaching budget slider
	coachingStaff: boolean;
	fakeAgeProb: number;
};

type AlwaysWrap = (typeof ALWAYS_WRAP)[number];

export type GameAttributesLeagueWithHistory = Omit<
	GameAttributesLeague,
	AlwaysWrap
> & {
	[T in AlwaysWrap]: GameAttributeWithHistory<GameAttributesLeague[T]>;
};

export type GameAttributes =
	| GameAttributesNonLeague
	| GameAttributesLeagueWithHistory;

export type GameAttributeKey = keyof GameAttributesLeague;

export type GameAttribute<T extends GameAttributeKey> = {
	key: T;
	value: GameAttributesLeagueWithHistory[T];
};

export type League = {
	lid: number;
	name: string;
	tid: number;
	phaseText: string;
	teamName: string;
	teamRegion: string;
	heartbeatID?: string;
	heartbeatTimestamp?: number;
	difficulty?: number;
	starred?: boolean;
	created?: Date;
	lastPlayed?: Date;
	startingSeason?: number;
	season?: number;
	imgURL?: string; // Should contain imgURLSmall if it exists
};

export type Locks = {
	drafting: boolean;
	gameSim: boolean;
	newPhase: boolean;
	stopGameSim: boolean;
};

export type LockName = "drafting" | "newPhase" | "gameSim" | "stopGameSim";

export type LogEventType =
	| "achievement"
	| "ageFraud"
	| "award"
	| "changes"
	| "draft"
	| "draftLottery"
	| "error"
	| "freeAgent"
	| "gameAttribute"
	| "gameLost"
	| "gameTied"
	| "gameWon"
	| "hallOfFame"
	| "healed"
	| "healedList"
	| "info"
	| "injured"
	| "injuredList"
	| "madePlayoffs"
	| "newLeague"
	| "newTeam"
	| "playerFeat"
	| "playoffs"
	| "reSigned"
	| "refuseToSign"
	| "release"
	| "retired"
	| "retiredList"
	| "retiredJersey"
	| "screenshot"
	| "sisyphus"
	| "sisyphusTeam"
	| "success"
	| "teamContraction"
	| "teamExpansion"
	| "teamLogo"
	| "teamRelocation"
	| "teamRename"
	| "trade"
	| "tragedy"
	| "upgrade"
	| "luxuryTax"
	| "luxuryTaxDist"
	| "ownerDistribution"
	| "minPayroll"
	| "undo"
	| "contractOption"
	| "extension"
	| "tradeRequest"
	| "holdout"
	| "draftPickCondition";

// https://stackoverflow.com/a/57103940/786644
export type DistributiveOmit<T, K extends keyof T> = T extends any
	? Omit<T, K>
	: never;

export type OwnerMood = {
	money: number;
	playoffs: number;
	wins: number;
};

export type MessageWithoutKey = {
	mid?: number;
	from: string;
	read: boolean;
	text: string;
	year: number;
	tid?: number;
	subject?: string;
	ownerMoods?: OwnerMood[];
};

export type Message = {
	mid: number;
} & MessageWithoutKey;

export type MenuItemLink = {
	type: "link";
	active?: (pageID?: string, pathname?: string) => boolean;
	league?: true;
	godMode?: true;
	// League extras feature (common/nativeFeatures.ts): hidden when it is turned off
	feature?: NativeFeatureId;
	// Stock page replaced by a League extras feature: hidden when it is turned on
	featureOff?: NativeFeatureId;
	// Only in leagues of this type (college mode). Pro-only pages are listed in ui/util/collegeMode.ts instead
	leagueType?: "college";
	nonLeague?: true;
	commandPalette?: true;
	commandPaletteOnly?: true;
	onClick?: () => undefined | void | false | Promise<undefined | void | false>; // Return false to leave sidebar open
	path?: string | LeagueUrlParts;
	prefix?: ReactNode;
	text:
		| Exclude<ReactNode, null | undefined | number | boolean>
		| {
				side: Exclude<ReactNode, null | undefined | number | boolean>;
				top: Exclude<ReactNode, null | undefined | number | boolean>;
		  };
};

export type MenuItemHeader = {
	type: "header";
	long: string;
	short: string;
	league?: true;
	nonLeague?: true;
	commandPalette?: true;
	commandPaletteOnly?: true;
	children: (MenuItemLink | MenuItemText)[];
};

export type MenuItemText = {
	type: "text";
	text: string;
};

export type MoodComponents = {
	marketSize: number;
	facilities: number;
	teamPerformance: number;
	hype: number;
	loyalty: number;
	trades: number;
	playingTime: number;
	rookieContract: number;
	difficulty: number;
	relatives: number;
	// Player traits: teammates' egos (team-first players lift it, divas drag it down). 0 with the setting off
	lockerRoom: number;
	// Coaching systems: his fit in the head coach's systems, the coach's personality and reputation. 0 with the setting off
	coachFit: number;
	custom?: {
		text: string;
		amount: number;
	}[];
};

export type MoodTrait = "F" | "L" | "$" | "W";

export type Negotiation = {
	pid: number;
	tid: number;
	resigning: boolean;

	// In-season extension for a player under contract. Never saved to the database, it's created whenever it's needed, like a free agent negotiation. amount and exp are what he asks for, before mood.
	extension?: FlatContractInfo;
};

export type Option = {
	id: string;
	label: string;
	url?: string;
	keyboardShortcut?: keyof KeyboardShortcuts["playMenu"];
};

export type Options = {
	fullNames?: boolean;
	phaseChangeRedirects: Phase[];
	units?: "metric" | "us";
};

type LocalStateUIGameTeam = {
	ovr?: number;
	tid: number;
	playoffs?: {
		seed: number;
		won: number;
		lost: number;
	};
} & (
	| {
			pts: number;
			sPts?: number;
	  }
	| {
			pts?: undefined;
			sPts?: undefined;
	  }
);

type GameAttributesSyncedToUi = (typeof gameAttributesSyncedToUi)[number];
export type LocalStateUI = {
	customMenu?: MenuItemHeader;
	email?: string;
	flagOverrides: Record<string, string>;
	gameSimInProgress: boolean;
	games: {
		finals?: boolean;
		forceWin?: number; // Number of iterations - defined means result was forced
		gid: number;
		numPeriods?: number;
		overtimes?: number;
		teams: [LocalStateUIGameTeam, LocalStateUIGameTeam];
	}[];
	fullNames: boolean;
	gold?: boolean;
	keyboardShortcuts: KeyboardShortcutsLocal;
	leagueCreation?: {
		id: string;
		status: string;
	};
	leagueCreationPercent?: {
		id: string;
		percent: number;
	};
	lid?: number;
	liveGameInProgress: boolean;
	phaseText: string;
	playMenuOptions: Option[];
	popup: boolean;
	showLeagueTopBar: boolean;
	showNagModal: boolean;
	sidebarOpen: boolean;
	statusText: string;
	units: "metric" | "us";
	username?: string;
	workerBusy: boolean;
	title?: string;
	hideNewWindow: boolean;
	jumpTo: boolean;
	jumpToSeason?: number | "all" | "career";
	dropdown?: TitleBarDropdown;
	moreInfoSeason?: number;
	moreInfoTid?: number;
	stickyFooterAd: boolean;
	stickyFormButtons: boolean;
} & {
	[Key in Exclude<GameAttributesSyncedToUi, "lid">]: GameAttributesLeague[Key];
};

export type PartialTopMenu = {
	email: string;
	goldCancelled: boolean;
	goldUntil: number;
	mailingList: boolean;
	username: string;
};

export type Phase = -2 | -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type PhaseReturn = {
	redirect?: {
		url: string;
		text: string;
	};
	updateEvents?: UpdateEvents;
};

// A flat contract, the same amount every season through exp. This is used for contract demands (what a player is asking for), and for snapshots of contracts in events and trades. Signed contracts are Contract objects in p.contracts.
export type FlatContractInfo = {
	amount: number;
	exp: number;
	rookie?: true; // If present, this is (or signing it would make) a rookie contract. Could be either a rookie scale auto sign, or negotiated.

	// Option and guarantee terms, only with the contractOptions setting. Missing means no option and fully guaranteed.
	terms?: ContractTerms;
};

export type ContractOptionType = "player" | "team";

// Terms that can be negotiated on top of amount and exp
export type ContractTerms = {
	// Option on the final season. The player (or team) decides at the start of the re-signing phase before that season whether to keep it.
	option?: ContractOptionType;

	// Fraction (0 to 1) of every season after the first that is guaranteed. A team that releases the player only owes the guaranteed part of those seasons. Missing means 1.
	guaranteed?: number;
};

export type ContractOption = {
	type: ContractOptionType;
	season: number;
	decision?: "exercised" | "declined";
};

export type ContractExtension = {
	// When it was signed
	season: number;
	phase: Phase;

	// First season added by the extension
	firstSeason: number;
	amount: number;
	eid?: number;
};

// "unknown" is for contracts where the type can't be determined, like contracts migrated from before contracts were tracked, or a rookie contract with an extension merged into it.
export type ContractType = "rookie" | "reSign" | "freeAgent" | "unknown";

export type ContractPayment = {
	season: number;
	tid: number; // PLAYER.DOES_NOT_EXIST if unknown, like for payments migrated from before contracts were tracked
	amount: number;
};

export type ContractEndedEarly =
	| {
			season: number;
			phase: Phase;
			// godMode is for a player moved from a team to free agency in Customize Player
			reason: "retired" | "died" | "godMode";
			tid?: undefined;
	  }
	| {
			season: number;
			phase: Phase;
			reason: "released";

			// Team that released the player, which still owes the rest of the contract. Deleted once the contract is fully paid, so p.owedByTids only has teams that still owe something. After that, payments say which team paid.
			tid?: number;
	  };

export type Contract = {
	type: ContractType;

	// The "freeAgent" or "reSigned" event for this signing, which says when and by which team it was signed. Undefined if there is none, like for rookie contracts (see p.draft instead), real players' contracts, contracts that came with a league file or imported player, and contracts created in Customize Player. The event can also be missing if old events were deleted.
	eid?: number;

	start: number; // First season paid
	amounts: number[]; // One per season, so exp = start + amounts.length - 1
	payments: ContractPayment[]; // Actually paid, added to every game
	endedEarly?: ContractEndedEarly;

	// See ContractTerms. All optional, so contracts from before these existed need no migration.
	option?: ContractOption;

	// Guaranteed amount for each season, same length as amounts. Missing means fully guaranteed.
	guaranteed?: number[];

	// In-season extensions, which append seasons to amounts
	extensions?: ContractExtension[];

	// Signed over the cap with this salary cap exception
	exception?: CapExceptionType;

	// Released with the stretch provision: amounts after the season of the release were spread over more seasons
	stretched?: true;
};

export type MoodSnapshot = {
	season: number;
	phase: Phase;
	tid: number;
	// Rounded to 0.1, without custom items (which are included in sum)
	components: Omit<MoodComponents, "custom">;
	sum: number;
	probWilling: number;
};

export type TradeRequest = {
	season: number;
	phase: Phase;
	tid: number;
};

export type Holdout = {
	season: number;
	tid: number;
	gamesRemaining: number;
	gamesMissed: number;
};

export type PlayerFeatWithoutKey = {
	fid?: number;
	pid: number;
	name: string;
	pos: string;
	season: number;
	tid: number;
	oppTid: number;
	playoffs: boolean;
	gid: number;
	stats: any;
	result: "W" | "L" | "T";
	score: string;
	overtimes: number;
	numPeriods: number;
};

export type PlayerFeat = PlayerFeatWithoutKey & {
	fid: number;
};

export type PlayerInjury = {
	gamesRemaining: number;
	type: string;
	score?: number;
};

// Only for legacy league files and the migration from before contracts were tracked
type PlayerSalary = {
	amount: number;
	season: number;
};

type PlayerStatsCommon = {
	jerseyNumber?: string;

	// Only for pre-draft (college) rows, which have tid PLAYER.DOES_NOT_EXIST. The school or program name to show in the team column
	teamName?: string;
	playoffs: boolean;
	season: number;
	tid: number;
	yearsWithTeam: number;
};

// Input to processPlayerStats. Not just PlayerStats, it can also be a box score row, player feat, or sums of multiple rows (with extra properties like hasTot), and old rows can be missing stats or have ones that are no longer stored. So it is too varied to type precisely
export type PlayerStatsToProcess = any;

// Stats row as stored in the database, in p.stats. Like PlayerStatsPlus, this has the stats from all sports, because there is no good way to make it depend on the current sport. Numeric stats can be undefined in historical data from before a stat was tracked (even gp and min)
export type PlayerStats = Omit<
	MergeBySport<
		PlayerStatsBaseball,
		PlayerStatsBasketball,
		PlayerStatsFootball,
		PlayerStatsHockey
	>,
	keyof PlayerStatsCommon
> &
	PlayerStatsCommon;

export type RelativeType = "brother" | "father" | "son";

export type Relative = {
	type: RelativeType;
	pid: number;
	name: string;
};

export type MinimalPlayerRatings = {
	ovr: number;
	pot: number;
	fuzz: number;
	pos: string;
	skills: string[];
	season: number;
	// Only in sports with position-specific ratings (not basketball), where they have a value for every position
	ovrs?: Record<string, number>;
	pots?: Record<string, number>;
	injuryIndex?: number;
	hgt: number;
	spd: number;
	endu: number;
	locked?: boolean;
};

export type PlayerWithoutKey<PlayerRatings = MinimalPlayerRatings> = {
	awards: PlayerAward[];
	born: {
		year: number;
		loc: string;
	};
	college: string;

	// College mode (docs/college-mode.md): class year (0 = signed recruit, 1-4 = Fr-Sr), recruiting profile, how he left school
	classYear?: number;
	recruit?: import("./college/types.ts").PlayerRecruit;
	collegeExit?: import("./college/types.ts").PlayerCollegeExit;
	// A draft prospect imported from a linked college league: where he came from there
	linkedCollege?: {
		lid: number;
		pid: number;
		season: number;
		school: string;
		exit: "graduated" | "pro" | "left";
		pick?: number;
		classYear?: number;
	};

	// What the player is asking for. Defined for free agents, draft prospects, and players on a team who need a new contract (unsigned draft picks, or expiring contracts while re-signing).
	contractDemand?: FlatContractInfo & {
		temp?: true; // Used only during league creation, to mark demands that need to be normalized
	};

	// Every contract the player signed, oldest first. If he's on a team, his current contract is the last one, unless it ended early.
	contracts: Contract[];

	// Mood snapshots for players on teams, a couple per season (see contract/moodHistory.ts)
	moodHistory?: MoodSnapshot[];

	// Public trade request, until he's traded or his mood improves
	tradeRequest?: TradeRequest;

	// Holding out (missing games) over his contract
	holdout?: Holdout;

	customMoodItems?: {
		amount: number;
		text: string;
		tid?: number;
	}[];
	diedYear?: number;
	draft: {
		round: number;
		pick: number;
		tid: number;
		originalTid: number;
		year: number;
		pot: number;
		ovr: number;
		skills: string[];
		dpid?: number;
	};
	face: FaceConfig;
	firstName: string;
	gamesUntilTradable: number;
	hgt: number;
	hof?: 1; // Would rather be boolean, but can't index boolean
	imgURL: string;
	injury: PlayerInjury;
	injuries: {
		season: number;
		games: number;
		type: string;
		ovrDrop?: number;
		potDrop?: number;
	}[];
	// injuryDepth setting: state after returning from an injury
	health?: PlayerHealth;
	// injuryDepth setting: rest this player on the second night of back-to-backs
	loadManagement?: boolean;
	jerseyNumber?: string; // Should be undefined only for a player who has never been on a team, or a player signed to his first team before the preseason
	lastName: string;
	moodTraits: MoodTrait[];
	numPlayersTradedAwayNormalized?: Record<number, number>;
	note?: string;
	noteBool?: 1; // Keep in sync with note - for indexing
	numDaysFreeAgent: number;

	// Teams that released this player and still owe him money, from endedEarly.tid of his contracts. This is only so the database can index players who are still owed, since IndexedDB can't index inside p.contracts. Missing if nobody owes him. Update with updateOwedByTids whenever endedEarly.tid changes.
	owedByTids?: number[];

	pid?: number;
	pos?: string; // Only in players from custom league files
	ptModifier: number;
	ratings: NonEmptyArray<PlayerRatings>;

	// Basketball only: the stored random components of the player traits (see common/playerTraits). Created at player generation and lazily; scores are derived from these plus ratings.
	traits?: PlayerTraits;

	// Set by "Regenerate ratings": the build (archetype) the player's ratings were rebuilt around, plus the ratings from before the first regeneration so another regeneration never compounds on the last
	ratingsBuild?: StoredRatingsBuild;
	// Scouting the user's team did on this prospect (scouting system), one entry per scout assignment or workout
	scouting?: ScoutingEntry[];
	// Scouting Reports setting: compact snapshots of the user's scouts' grades (stock up/down history) and their take at the draft (track record). See common/scoutingReports/history.ts
	scoutSnaps?: ScoutSnap[];
	scoutDraft?: ScoutDraftRecord;
	// Draft Lottery Night & Combine: his results, stored when the combine of his class is held, so later changes to his ratings (or a
	// regenerated class) don't rewrite them. Only on invited prospects. See worker/core/draftCombine
	combine?: Omit<DraftCombineResult, "pid">;
	// The user's own draft board entry for this prospect (draft board planner)
	draftBoard?: DraftBoardEntry;
	// Basketball: his team's college season in his draft year (conference tournaments, March Madness), see common/collegeStats/ncaa.ts
	collegeSeason?: StoredCollegeSeason;
	// Basketball: his years before the draft (schools, redshirt years, transfers, junior college), his story if he is one of the class's unusual prospects, and his recruiting ranking, see common/collegeStats/career.ts. Only on prospects whose college stats were generated with the career model
	preDraftCareer?: StoredPreDraftCareer;
	// Basketball: version of the college stats model his pre-draft stats were generated with (COLLEGE_STATS_VERSION in common/collegeStats/season.ts). Missing: 1, or not generated
	collegeStatsV?: number;

	// Basketball, the Draft Class Shapes setting: the shape his class was given (a key of DRAFT_CLASS_SHAPES), or "pending" between being generated and being shaped
	draftClassShape?: string;
	// Version of the shapes his class was given (DRAFT_CLASS_SHAPE_VERSION when it was shaped). Missing: 1
	draftClassShapeV?: number;
	// The injury-riddled class: he comes into the draft off an injury (his college story)
	draftClassShapeInjury?: boolean;

	// Basketball, the subRatings setting: his sub-ratings seed, hidden growth profile and generation info (see common/subRatingsGen.ts)
	subP?: StoredSubInfo;

	// Basketball: the archetype derived from his ratings at the start of each preseason (see src/common/archetypes), oldest first
	archetypes?: StoredArchetype[];
	real?: boolean;
	relatives: Relative[];
	retiredYear: number;
	rosterOrder: number;
	srID?: string;
	stats: PlayerStats[];
	// College mode: his NIT games, apart from the national tournament's postseason stats (same rows, playoffs true). Not read by
	// career totals, awards or records
	nitStats?: PlayerStats[];
	statsTids: number[];
	tid: number;
	transactions?: (
		| {
				season: number;
				phase: Phase;
				tid: number;
				type: "draft";
				pickNum: number;
		  }
		| {
				season: number;
				phase: Phase;
				tid: number;
				type: "freeAgent";
				eid?: number;
		  }
		| {
				season: number;
				phase: Phase;
				tid: number;
				type: "trade";
				fromTid: number;
				eid?: number;
		  }
		| {
				season: number;
				phase: Phase;
				tid: number;
				type: "godMode";
		  }
		| {
				season: number;
				phase: Phase;
				tid: number;
				type: "import";
		  }
		| {
				season: number;
				phase: Phase;
				tid: number;
				type: "sisyphus";
				fromTid: number;
		  }
	)[]; // Only optional cause I'm worried about upgrades
	value: number;
	valueNoPot: number;
	valueFuzz: number;
	valueNoPotFuzz: number;
	watch?: number;
	weight: number;
	yearsFreeAgent: number;

	// Only for hockey goalies
	numConsecutiveGamesG?: number;

	// Only for baseball pitchers
	pFatigue?: number;
};

export type Player<PlayerRatings = MinimalPlayerRatings> = {
	pid: number;
} & PlayerWithoutKey<PlayerRatings>;

// Contract info in the format from before p.contracts (league DB version 75). This can still be in league files, player exports, and real players data.
export type LegacyPlayerContractInfo = {
	contract?: FlatContractInfo & {
		rookieResign?: true;
		temp?: true;
	};
	salaries?: PlayerSalary[];
};

export type PlayerStatType = "per36" | "perGame" | "totals";

// For keys present in multiple sports, the value type is the union of the types from each sport
type MergeBySport<A, B, C, D> = {
	[K in keyof A | keyof B | keyof C | keyof D]:
		| (K extends keyof A ? A[K] : never)
		| (K extends keyof B ? B[K] : never)
		| (K extends keyof C ? C[K] : never)
		| (K extends keyof D ? D[K] : never);
};

// Season rows are [value, gid]. Career rows add [abbrev, tid, season] of when the max happened. null means not yet initialized, undefined is for upgraded rows from before this existed
export type PlayerStatMax =
	| [number, number]
	| [number, number, string, number, number]
	| null
	| undefined;

// Not using a homomorphic mapped type, so optional properties become required but still include undefined, since player.formatAll always sets the key
type PlayerKey = keyof Player;
type PlayerAllKeys = {
	[K in PlayerKey]: Player[K];
};

type PlayerAttrsPlus<Contract = FlatContractInfo> = Omit<
	PlayerAllKeys,
	"diedYear" | "draft" | "hof" | "jerseyNumber" | "ratings" | "stats" | "watch"
> & {
	abbrev: string;
	age: number;
	ageAtDeath: number | null;
	contract: Contract;
	diedYear: number | null;
	draft: Player["draft"] & {
		abbrev: string;
		age: number;
		originalAbbrev: string;
	};
	draftPosition: number;
	experience: number;
	hof: boolean;
	jerseyNumber: string | undefined;
	lastSalary: number | undefined;
	latestTransaction: string;
	latestTransactionSeason: number | undefined;
	name: string;
	numAllStar: number;
	numBrothers: number;
	numFathers: number;
	numSons: number;
	salaries: PlayerSalaryRow[];
	salariesTotal: number;
	salary: number;
	untradable: boolean;
	watch: number;
};
export type PlayerAttr = keyof PlayerAttrsPlus;

// One row per season of each contract, for the player page
export type PlayerSalaryRow = {
	amount: number; // Paid for past seasons, contracted for current and future seasons
	season: number;
	type: "past" | "current" | "future";

	// Teams that paid for this season (past), or are expected to pay (current/future), with the largest first. tid is PLAYER.DOES_NOT_EXIST (abbrev "DNE") if unknown, like for salaries from before this was tracked.
	payers: {
		tid: number;
		abbrev: string;
		amount: number;
		released: boolean;
	}[];
};

// Rating keys from all sports, like RATINGS
export type PlayerRatingKey =
	| RatingKeyBaseball
	| RatingKeyBasketball
	| RatingKeyFootball
	| RatingKeyHockey
	// Basketball expanded ratings (the expandedRatings setting)
	| ExpandedRatingKey;

type PlayerRatingsPlus = Record<PlayerRatingKey, number> & {
	abbrev: string;
	age: number;
	dovr: number;
	dpot: number;
	fuzz: number;
	injuryIndex: number | undefined;
	locked: boolean | undefined;
	ovr: number;
	pos: string;
	pot: number;
	season: number;
	skills: string[];
	// Extended skill badges, basketball only (see common/skillBadges)
	badges: string[];
	tid: number | undefined;
	// Sub-ratings, basketball only (the subRatings setting; undefined when off or on a row without them)
	sub: number[] | undefined;

	// Not in basketball
	ovrs: Record<PositionBaseball | PositionFootball | PositionHockey, number>;
	pots: Record<PositionBaseball | PositionFootball | PositionHockey, number>;
};
export type PlayerRatingAttr = keyof PlayerRatingsPlus;

type PlayerStatsPlusCommon = {
	abbrev: string;
	age: number;
	jerseyNumber: string | undefined;
	playoffs: boolean | "combined";
	season: number;
	tid: number;
	yearsWithTeam: number;
};
type PlayerStatsPlus = Omit<
	MergeBySport<
		PlayerStatsPlusBaseball,
		PlayerStatsPlusBasketball,
		PlayerStatsPlusFootball,
		PlayerStatsPlusHockey
	>,
	keyof PlayerStatsPlusCommon
> &
	PlayerStatsPlusCommon;
export type PlayerStatAttr = keyof PlayerStatsPlus;

export type PlayerStatsTables = Record<
	string,
	{
		name: string;
		onlyShowIf?: PlayerStatAttr[];

		// "pos" is not a real stat, it's a column in baseball fielding tables filled in by expandFieldingStats
		stats: (PlayerStatAttr | "pos")[];

		superCols?: SuperCol[];
	}
>;

export type PlayerSummary = Record<
	string,
	{
		name: string;

		// Positions, not stats
		onlyShowIf?: string[];

		stats: PlayerStatAttr[];
		superCols?: SuperCol[];
	}
>;

export type PlayerSeasonType = "regularSeason" | "playoffs" | "combined";

export type PlayerFormatOptions = {
	season?: number;
	seasonRange?: [number, number];
	tid?: number;
	attrs?: Readonly<PlayerAttr[]>;
	ratings?: Readonly<PlayerRatingAttr[]>;
	stats?: Readonly<PlayerStatAttr[]>;

	// A single value means exactly one season type, so if season is also specified then stats will be a single object. An array means stats will always be an array. Default is "regularSeason"
	seasonType?: PlayerSeasonType | Readonly<PlayerSeasonType[]>;

	showNoStats?: boolean;
	showRookies?: boolean;
	showDraftProspectRookieRatings?: boolean;
	showRetired?: boolean;
	fuzz?: boolean;
	oldStats?: boolean;
	statType?: PlayerStatType;
	mergeStats?: "none" | "totOnly" | "totAndTeams";

	// Stats rows from before the player was drafted (college seasons, tid DOES_NOT_EXIST). "exclude" (default) hides them so they can't affect career totals etc, "only" returns just them, "include" returns everything
	preDraftStats?: "exclude" | "only" | "include";
};

// Is SeasonType one of the values in the seasonType option? Distributes over unions, so if seasonType is a union of single values (like "playoffs" | "regularSeason"), the result is boolean because it's not known which one it is
type SeasonTypeIncluded<
	SeasonTypeOption extends PlayerFormatOptions["seasonType"],
	SeasonType extends PlayerSeasonType,
> =
	SeasonTypeOption extends Readonly<(infer Values)[]>
		? SeasonType extends Values
			? true
			: false
		: SeasonType extends SeasonTypeOption
			? true
			: false;

// Single seasonType value means a single stats row, array means an array of stats rows
type SeasonTypeSingle<
	SeasonTypeOption extends PlayerFormatOptions["seasonType"],
> = SeasonTypeOption extends Readonly<unknown[]> ? false : true;

type RowOrRows<
	Single extends boolean,
	Row,
	SingleExtra = never,
> = Single extends true ? Row | SingleExtra : Row[];

// Rows added by showNoStats have no playoffs value
type PlayerStatsRow<
	Stats extends Readonly<PlayerStatAttr[]>,
	Combined extends boolean,
	ShowNoStats extends boolean,
> = Pick<PlayerStatsPlus, Stats[number]> & {
	playoffs:
		| boolean
		| ([Combined] extends [false] ? never : "combined")
		| ([ShowNoStats] extends [false] ? never : undefined);
	hasTot?: true;
};

// playoffs has the same value as in the rows being summed - false for careerStats, true for careerStatsPlayoffs, "combined" for careerStatsCombined
type PlayerCareerStatsRow<
	Stats extends Readonly<PlayerStatAttr[]>,
	PlayoffsValue extends boolean | "combined",
> = Omit<Pick<PlayerStatsPlus, Stats[number]>, "playoffs"> & {
	playoffs: PlayoffsValue;
	hasTot?: true;
};

// Career stats are only present when season is undefined and the corresponding flag is true. If either is ambiguous, it's optional
type CareerStatsKey<
	Key extends string,
	Row,
	Season extends number | undefined,
	Flag extends boolean,
> = [Season] extends [number]
	? unknown
	: [Flag] extends [false]
		? unknown
		: [Season] extends [undefined]
			? [Flag] extends [true]
				? { [K in Key]: Row }
				: { [K in Key]?: Row }
			: { [K in Key]?: Row };

// A contract for showing in the UI. amount (what the player is paid this season, in millions of dollars) and exp are a summary of it, which is all most of the UI needs.
export type FormattedContract = FlatContractInfo & {
	// Breakdown of the summary by season, from this season through exp (amounts in millions of dollars). Only present if the amounts are different in different seasons, since otherwise the summary already describes the contract.
	remainingSeasons?: {
		season: number;
		amount: number;
	}[];
};

// With seasonRange and no season, contract is the sum of salaries in the range, with exp set to the (undefined) season
type PlayerContractFiltered<
	Season extends number | undefined,
	SeasonRange extends [number, number] | undefined,
> = [SeasonRange] extends [undefined]
	? FormattedContract
	: [Season] extends [number]
		? FormattedContract
		: Omit<FlatContractInfo, "exp"> & { exp: number | undefined };

type PlayerAttrsPart<
	Attrs extends Readonly<PlayerAttr[]>,
	Season extends number | undefined,
	SeasonRange extends [number, number] | undefined,
> = Pick<
	PlayerAttrsPlus<PlayerContractFiltered<Season, SeasonRange>>,
	Attrs[number]
> &
	("untradable" extends Attrs[number] ? { untradableMsg?: string } : unknown);

type PlayerRatingsPart<
	Ratings extends Readonly<PlayerRatingAttr[]>,
	Season extends number | undefined,
> = {
	// Never empty, because player.formatAll filters out players with no ratings rows
	ratings: Season extends number
		? PlayerRatingsPick<Ratings>
		: NonEmptyArray<PlayerRatingsPick<Ratings>>;
};

// Wherever skills are requested, the extended skill badges come with them when that League Extra is on (basketball)
type PlayerRatingsPick<Ratings extends Readonly<PlayerRatingAttr[]>> = Pick<
	PlayerRatingsPlus,
	Ratings[number]
> &
	("skills" extends Ratings[number] ? { badges?: string[] } : unknown);

// For a single season, stats can be undefined if showRookies kept a player with no stats rows. showNoStats prevents that by adding an empty row
type PlayerStatsSingleUndefined<
	ShowNoStats extends boolean,
	ShowRookies extends boolean,
> = [ShowRookies] extends [false]
	? never
	: [ShowNoStats] extends [true]
		? never
		: undefined;

type PlayerStatsPart<
	Stats extends Readonly<PlayerStatAttr[]>,
	Season extends number | undefined,
	Single extends boolean,
	Playoffs extends boolean,
	RegularSeason extends boolean,
	Combined extends boolean,
	ShowNoStats extends boolean,
	ShowRookies extends boolean,
> = {
	stats: Season extends number
		? RowOrRows<
				Single,
				PlayerStatsRow<Stats, Combined, ShowNoStats>,
				PlayerStatsSingleUndefined<ShowNoStats, ShowRookies>
			>
		: PlayerStatsRow<Stats, Combined, ShowNoStats>[];
} & CareerStatsKey<
	"careerStats",
	PlayerCareerStatsRow<Stats, false>,
	Season,
	RegularSeason
> &
	CareerStatsKey<
		"careerStatsPlayoffs",
		PlayerCareerStatsRow<Stats, true>,
		Season,
		Playoffs
	> &
	CareerStatsKey<
		"careerStatsCombined",
		PlayerCareerStatsRow<Stats, "combined">,
		Season,
		Combined
	>;

// If it's not known whether attrs/ratings/stats were requested (like the type includes undefined), then its properties are optional
type PlayerFilteredInner<
	Attrs extends Readonly<PlayerAttr[]> | undefined,
	Ratings extends Readonly<PlayerRatingAttr[]> | undefined,
	Stats extends Readonly<PlayerStatAttr[]> | undefined,
	Season extends number | undefined,
	SeasonRange extends [number, number] | undefined,
	Single extends boolean,
	Playoffs extends boolean,
	RegularSeason extends boolean,
	Combined extends boolean,
	ShowNoStats extends boolean,
	ShowRookies extends boolean,
> = ([Attrs] extends [undefined]
	? unknown
	: [Attrs] extends [Readonly<PlayerAttr[]>]
		? PlayerAttrsPart<Attrs, Season, SeasonRange>
		: Partial<PlayerAttrsPart<NonNullable<Attrs>, Season, SeasonRange>>) &
	// Empty ratings array is the same as not requesting ratings
	([Ratings] extends [undefined]
		? unknown
		: [NonNullable<Ratings>[number]] extends [never]
			? unknown
			: [Ratings] extends [Readonly<PlayerRatingAttr[]>]
				? PlayerRatingsPart<Ratings, Season>
				: Partial<PlayerRatingsPart<NonNullable<Ratings>, Season>>) &
	([Stats] extends [undefined]
		? unknown
		: [Stats] extends [Readonly<PlayerStatAttr[]>]
			? PlayerStatsPart<
					Stats,
					Season,
					Single,
					Playoffs,
					RegularSeason,
					Combined,
					ShowNoStats,
					ShowRookies
				>
			: Partial<
					PlayerStatsPart<
						NonNullable<Stats>,
						Season,
						Single,
						Playoffs,
						RegularSeason,
						Combined,
						ShowNoStats,
						ShowRookies
					>
				>);

// Value of an option, or its default value if it may be missing. Uses Options[Key] rather than inferring from an optional property, because that would drop undefined from the type
type PlayerFormatOptionValue<
	Options,
	Key extends keyof PlayerFormatOptions,
	Default,
> = Key extends keyof Options
	?
			| Exclude<Options[Key], undefined>
			| (undefined extends Options[Key] ? Default : never)
	: Default;

type PlayerFilteredWithSeasonType<
	Options extends PlayerFormatOptions,
	SeasonTypeOption extends PlayerFormatOptions["seasonType"],
> = PlayerFilteredInner<
	PlayerFormatOptionValue<Options, "attrs", undefined>,
	PlayerFormatOptionValue<Options, "ratings", undefined>,
	PlayerFormatOptionValue<Options, "stats", undefined>,
	PlayerFormatOptionValue<Options, "season", undefined>,
	PlayerFormatOptionValue<Options, "seasonRange", undefined>,
	SeasonTypeSingle<SeasonTypeOption>,
	SeasonTypeIncluded<SeasonTypeOption, "playoffs">,
	SeasonTypeIncluded<SeasonTypeOption, "regularSeason">,
	SeasonTypeIncluded<SeasonTypeOption, "combined">,
	PlayerFormatOptionValue<Options, "showNoStats", false>,
	PlayerFormatOptionValue<Options, "showRookies", false>
>;

// Output of player.formatAll for a given set of options
export type PlayerFiltered<Options extends PlayerFormatOptions> =
	PlayerFilteredWithSeasonType<
		Options,
		PlayerFormatOptionValue<Options, "seasonType", "regularSeason">
	>;

export type Race = "asian" | "black" | "brown" | "white";

export type PlayerBioInfo = {
	// This either overwrites a built-in country, or adds a new country
	countries?: Record<
		string,
		{
			// If any of these properties is undefined, fall back to default, then whatever the built-in value is (if it exists)
			first?: Record<string, number>;
			last?: Record<string, number>;
			colleges?: Record<string, number>;
			fractionSkipCollege?: number;
			races?: Record<Race, number>;
			flag?: string;
		}
	>;

	default?: {
		// Applies to all built-in countries, since there is just one global country list to override
		colleges?: Record<string, number>;

		// Applies to all built-in countries except US and Canada, where it's overridden to 0.02 by default
		fractionSkipCollege?: number;

		// Applies to no built-in countries, since they all have built-in defaults
		races?: Record<Race, number>;
	};

	// This specifies which countries (from the built-in database, and supplemented by "data" above)
	frequencies?: Record<string, number>;
};

export type PlayerBioInfoProcessed = {
	countries: Record<
		string,
		{
			first: [string, number][];
			last: [string, number][];
			colleges?: [string, number][];
			fractionSkipCollege?: number;
			races?: [Race, number][];
		}
	>;

	default: {
		colleges: [string, number][];
		fractionSkipCollege: number;
		races: [Race, number][];
	};

	// This specifies which countries (from the built-in database, and supplemented by "data" above)
	frequencies: [string, number][];
};

export type Local = {
	autoPlayUntil?: {
		reject: (error: Error) => void;
		resolve: () => void;
		phase: number;
		season: number;

		// Time in milliseconds of the start of auto play
		start: number;
	};
	autoSave: boolean;
	email: string | undefined;
	eightyTwoZeroDraft?: {
		round: number;
		picks: {
			p: Player;
			teamAbbrev: string;
			season: number;
		}[];
		eliteBallKnowerMode: boolean;
		lockTopPlayers: boolean;
		lifelinesUsed: {
			newTeam: boolean;
			newSeason: boolean;
			unlock: boolean;
		};
		currentTeam:
			| ({
					players: {
						p: Player;
						locked: boolean;
					}[];
					season: number;
					seasonInfo?: {
						won: number;
						lost: number;
						tied: number;
						otl: number;
						roundsWonText?: string;
					};
					srID: string;
			  } & Pick<
					Team,
					"abbrev" | "imgURL" | "imgURLSmall" | "name" | "region" | "tid"
			  >)
			| undefined;
	};
	exhibitionGamePlayers?: Record<number, Player>;
	fantasyDraftResults: (Player<any> & {
		prevAbbrev: string | undefined;
		prevTid: number;
	})[];
	goldUntil: number;
	leagueLoaded: boolean;
	liveSimRatingsStatsPopoverPlayers: Record<number, Player> | undefined;
	mailingList: boolean;
	minFractionDiffs:
		| Record<
				number,
				{
					tid: number;
					diff: number;
				}
		  >
		| undefined;
	phaseText: string;
	playerBioInfo?: PlayerBioInfoProcessed;
	playerOvrMean: number;
	playerOvrStd: number;
	playerOvrMeanStdStale: boolean;
	playingUntilEndOfRound: boolean;
	realPlayerActiveSeasons:
		| Record<
				string,
				Record<number, number | undefined> & {
					retiredUntil?: Record<number, number>;
				}
		  >
		| undefined;
	seasonLeaders: SeasonLeaders | undefined;
	statusText: string;
	undoLog: UndoLog;
	unviewedSeasonSummary: boolean;
	username: string | undefined;
};

export type PlayoffSeriesTeam = {
	abbrev?: string;
	cid: number;
	colors?: [string, string, string];
	imgURL?: string;
	imgURLSmall?: string;
	pendingPlayIn?: true;
	region?: string;
	regularSeason?: {
		won: number;
		lost: number;
		tied?: number;
		otl?: number;
	};
	seed: number;
	tid: number;
	won: number;

	// pts and sPts are basically only used when there is one game in the series, but they're tracked as the sum of all games for some reason. Beside the one game use case, pts is used in a couple places to identify if a series has started or not. Might be good to improve that some day.
	pts?: number; // undefined means game hasn't happened yet
	sPts?: number; // undefined means game hasn't happened yet or there was no shootout
};

export type PlayoffSeriesTeamAugmented = PlayoffSeriesTeam & {
	abbrev: string;
	colors: [string, string, string];
	region: string;
	regularSeason: NonNullable<PlayoffSeriesTeam["regularSeason"]>;
};

type PlayInMatchup = {
	home: PlayoffSeriesTeam;
	away: PlayoffSeriesTeam;
	gids?: number[];
};

// Each entry is the 2 first round games (7/8 and 9/10) and the 1 game between the loser of the 7/8 game and the winner of the 9/10 game
export type PlayInTournament =
	| [PlayInMatchup, PlayInMatchup]
	| [PlayInMatchup, PlayInMatchup, PlayInMatchup];

export type ByConf = number | false;

export type PlayoffSeries = {
	byConf?: ByConf; // undefined is for upgraded leagues and real players leagues
	currentRound: number;
	season: number;
	series: {
		home: PlayoffSeriesTeam;
		away?: PlayoffSeriesTeam;
		gids?: number[];
	}[][];

	// undefined means no play-in tournament
	playIns?: PlayInTournament[];
};

export type ContractInfo = {
	pid: number;
	firstName: string;
	lastName: string;
	skills: string[];
	pos: string;
	injury: PlayerInjury;
	jerseyNumber: string | undefined;
	amount: number; // Current amount, as counted in payroll
	exp: number;

	// Amount for each season, starting with start
	start: number;
	amounts: number[];

	released: boolean;
	watch: number;
};

export type ScheduleGameWithoutKey = {
	gid?: number;
	awayTid: number;
	homeTid: number;
	forceWin?: number | "tie"; // either awayTid or homeTid, if defined
	finals?: boolean; // Used for easily checking neutralSite "finals" setting
	day: number; // In the playoffs the values are kind of weird
	// Marquee Games: holiday slate or national TV, and rivalry games
	marquee?: MarqueeKind;
	rivalry?: boolean;
};

export type ScheduleGame = ScheduleGameWithoutKey & {
	gid: number;
};

export type SortOrder = "asc" | "desc";

export type SortType =
	| "country"
	| "draftPick"
	| "lastTen"
	| "name"
	| "number"
	| "record"
	| "string"
	| "pos";

export type Team = {
	tid: number;
	cid: number;
	did: number;
	region: string;
	name: string;
	abbrev: string;
	imgURL?: string;
	imgURLSmall?: string;
	colors: [string, string, string];
	jersey?: string;
	budget: Record<
		// ticketPrice is in dollars, others are levels
		"ticketPrice" | "scouting" | "coaching" | "health" | "facilities",
		number
	>;
	// initialBudget is for when starting a new league, it can use initialBudget as values for the past 2 seasons when no data exists
	initialBudget: Record<
		"scouting" | "coaching" | "health" | "facilities",
		number
	>;
	strategy: "contending" | "rebuilding";

	// Salary cap exceptions used (League Extras: Salary Cap Exceptions)
	capExceptions?: TeamCapExceptions;
	// Coaching staff: the development score the team played a season with, carried into the next (staff/index.ts STAFF_DEV_CARRY)
	staffDevCarry?: { season: number; score: number };
	// Front Office Budget (League Extra): levels (1-100) of the two departments that are not budget items. Missing: the team's average
	// level of its other departments (common/frontOffice.ts, worker/core/frontOffice)
	frontOffice?: Record<"analytics" | "travel", number>;
	depth?:
		| {
				QB: number[];
				RB: number[];
				WR: number[];
				TE: number[];
				OL: number[];
				DL: number[];
				LB: number[];
				CB: number[];
				S: number[];
				K: number[];
				P: number[];
				KR: number[];
				PR: number[];
		  }
		| {
				F: number[];
				D: number[];
				G: number[];
		  }
		| {
				L: number[]; // Lineup
				LP: number[]; // Lineup (no DH)
				D: number[]; // Defense
				DP: number[]; // Defense (no DH)
				P: number[]; // Pitching
		  };
	firstSeasonAfterExpansion?: number;
	srID?: string;

	pop: number;
	stadiumCapacity: number;

	adjustForInflation: boolean;
	disabled: boolean;
	keepRosterSorted: boolean;

	// [regular season, playoffs]
	playThroughInjuries: [number, number];

	// Optional because no upgrade
	autoTicketPrice?: boolean;

	// Optional because no upgrade. Otherwise, would make this empty array by default
	retiredJerseyNumbers?: {
		number: string;
		seasonRetired: number;
		seasonTeamInfo: number;
		pid?: number;
		score?: number;
		text: string;
	}[];

	draftLottery?:
		| {
				type: "cola";
				chances: number;
				optOut?: true;
		  }
		| {
				type: "nba2027";
				restricted1?: true; // True if team got the top pick last year
				restricted5?: 1 | 2; // Number of prior seasons in a row that team got a top 5 pick (2 is max to track, undefined is 0)
		  };

	// injuryDepth setting: rest older/injury-prone players on the second night of back-to-backs
	loadManagement?: boolean;

	// featureGmPersonalities setting: the AI general manager (none for a team the user runs), and GMs who left this team and are
	// still on the market (or retired), see core/gm
	gm?: import("./types.gm.ts").Gm;
	formerGms?: import("./types.gm.ts").Gm[];
};

export type TeamAttr = keyof Team;

type TeamSeasonPlus = Omit<TeamSeason, "lastTen"> & {
	winp: number;
	revenue: number;
	profit: number;
	salaryPaid: number;
	payroll: number;
	payrollOrSalaryPaid: number;
	lastTen: string;
	streak: string;
	pts: number;
	ptsDefault: number;
	ptsMax: number;
	ptsPct: number;
	avgAge: number | undefined;
	gp: number;
};
export type TeamSeasonAttr = keyof TeamSeasonPlus;

import type {
	PlayerStats as PlayerStatsBaseball,
	PlayerStatsPlus as PlayerStatsPlusBaseball,
	Position as PositionBaseball,
	RatingKey as RatingKeyBaseball,
	TeamStatAttr as TeamStatAttrBaseball,
	TeamStatAttrByPos as TeamStatAttrByPosBaseball,
} from "./types.baseball.ts";
import type {
	PlayerStats as PlayerStatsBasketball,
	PlayerStatsPlus as PlayerStatsPlusBasketball,
	RatingKey as RatingKeyBasketball,
	TeamStatAttr as TeamStatAttrBasketball,
} from "./types.basketball.ts";
import type {
	PlayerStats as PlayerStatsFootball,
	PlayerStatsPlus as PlayerStatsPlusFootball,
	Position as PositionFootball,
	RatingKey as RatingKeyFootball,
	TeamStatAttr as TeamStatAttrFootball,
} from "./types.football.ts";
import type {
	PlayerStats as PlayerStatsHockey,
	PlayerStatsPlus as PlayerStatsPlusHockey,
	Position as PositionHockey,
	RatingKey as RatingKeyHockey,
	TeamStatAttr as TeamStatAttrHockey,
} from "./types.hockey.ts";
import type { REAL_DRAFT_RATINGS, TIEBREAKERS } from "./constants.ts";
import type { TitleBarDropdown } from "../ui/components/Dropdown.tsx";
import type { SuperCol } from "../ui/components/DataTable/index.tsx";
import type { LookingForState } from "../ui/views/TradingBlock/useLookingForState.ts";
import type { ALWAYS_WRAP } from "../worker/core/league/loadGameAttributes.ts";
import type {
	KeyboardShortcuts,
	KeyboardShortcutsLocal,
} from "../ui/util/keyboardShortcuts.ts";
import type { gameAttributesSyncedToUi } from "./gameAttributesSyncedToUi.ts";
import type {
	NativeFeatureGameAttributes,
	NativeFeatureId,
} from "./nativeFeatures.ts";
import type { UndoLog } from "../worker/util/UndoLog.ts";
import type { StoredCollegeSeason } from "./collegeStats/ncaa.ts";
import type { StoredPreDraftCareer } from "./collegeStats/career.ts";
import type { LeagueUrlParts } from "../ui/router/types.ts";
import type { StoredRatingsBuild } from "./ratingsBuilds/types.ts";
import type { StoredArchetype } from "./archetypes/types.ts";
import type { PlayerTraits } from "./playerTraits/types.ts";
import type { ScoutDraftRecord, ScoutSnap } from "./scoutingReports/history.ts";
import type { ExpandedRatingKey } from "./expandedRatings.ts";

type TeamStatsPlus = Record<TeamStatAttrBaseball, number> &
	Record<TeamStatAttrByPosBaseball, number[]> &
	Record<TeamStatAttrBasketball, number> &
	Record<TeamStatAttrFootball, number> &
	Record<TeamStatAttrHockey, number> & {
		season: number;
		playoffs: boolean;
	};
export type TeamStatAttr = keyof TeamStatsPlus;

export type TeamFiltered<
	Attrs extends Readonly<TeamAttr[]> | undefined = undefined,
	SeasonAttrs extends Readonly<TeamSeasonAttr[]> | undefined = undefined,
	StatAttrs extends Readonly<TeamStatAttr[]> | undefined = undefined,
	Season extends number | undefined = undefined,
> = (Attrs extends Readonly<TeamAttr[]>
	? Pick<Team, Attrs[number]>
	: Record<string, unknown>) &
	(SeasonAttrs extends Readonly<TeamSeasonAttr[]>
		? {
				seasonAttrs: Season extends number
					? Pick<TeamSeasonPlus, SeasonAttrs[number]>
					: Pick<TeamSeasonPlus, SeasonAttrs[number]>[];
			}
		: Record<string, unknown>) &
	(StatAttrs extends Readonly<TeamStatAttr[]>
		? {
				stats: Season extends number
					? Pick<TeamStatsPlus, StatAttrs[number]> & { playoffs: boolean }
					: (Pick<TeamStatsPlus, StatAttrs[number]> & { playoffs: boolean })[];
			}
		: Record<string, unknown>);

export type TeamBasic = {
	tid: number;
	cid: number;
	did: number;
	region: string;
	name: string;
	abbrev: string;
	pop: number;
	imgURL?: string;
	imgURLSmall?: string;
	colors: [string, string, string];
	jersey?: string;
};

export type TeamStatType = "perGame" | "totals";

export type TeamSeasonWithoutKey = {
	rid?: number;
	// injuryDepth setting: day of the team's most recent game, for back-to-backs
	lastGameDay?: number;
	// scheduleLoad setting: day of the game before that one, for 3 games in 4 nights
	prevGameDay?: number;
	tid: number;
	season: number;
	gpHome: number; // Includes playoff games! Used for attendance average
	att: number;
	cash: number;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	wonHome: number;
	lostHome: number;
	tiedHome: number;
	otlHome: number;
	wonAway: number;
	lostAway: number;
	tiedAway: number;
	otlAway: number;
	wonDiv: number;
	lostDiv: number;
	tiedDiv: number;
	otlDiv: number;
	wonConf: number;
	lostConf: number;
	tiedConf: number;
	otlConf: number;
	lastTen: (-1 | 0 | 1 | "OTL")[];
	streak: number;
	playoffRoundsWon: number;
	// -1: didn't make playoffs. 0: lost in first round. ... N: won championship
	hype: number;
	pop: number;
	stadiumCapacity: number;
	revenues: {
		luxuryTaxShare: number;
		merch: number;
		sponsor: number;
		ticket: number;
		nationalTv: number;
		localTv: number;
	};
	expenses: {
		luxuryTax: number;
		minTax: number;
		salary: number;
		coaching: number;
		health: number;
		facilities: number;
		scouting: number;
	};
	// These are cumsums per game, divide by gp for the average
	expenseLevels: {
		coaching: number;
		facilities: number;
		health: number;
		scouting: number;
	};
	// Front Office Budget (League Extra): spending and levels of the two new departments (like expenses and expenseLevels), and what the
	// spending measurably bought this season (worker/core/frontOffice)
	frontOffice?: TeamSeasonFrontOffice;
	payrollEndOfSeason: number;
	ownerMood?: OwnerMood;
	numPlayersTradedAway: number;
	note?: string;
	noteBool?: 1; // Keep in sync with note - for indexing

	// w - clinched play-in tournament
	// x - clinched playoffs
	// y - if byes exist - clinched bye
	// z - clinched #1 seed advantage
	// o - eliminated
	clinchedPlayoffs?: "w" | "x" | "y" | "z" | "o";

	// Value only written here after the end of the season
	avgAge?: number;

	// Start of first game, and end of regular season
	ovrStart?: number;
	ovrEnd?: number;

	// Copied over from Team
	cid: number;
	did: number;
	region: string;
	name: string;
	abbrev: string;
	imgURL?: string;
	imgURLSmall?: string;
	colors: [string, string, string];
	jersey?: string;

	// Only used in historical leagues when realStats="all"
	srID?: string;
};

export type PlayerHealth = {
	// Games left under a minutes restriction, and how many it started with
	restrict: number;
	restrictTotal: number;
	// Games left with raised re-injury risk, and the body part that was hurt
	returnGames: number;
	bodyPart: string;
};

export type TeamSeason = TeamSeasonWithoutKey & {
	rid: number;
};

// opp stats (except Blk) can be undefined
export type TeamStatsWithoutKey = any;

export type TeamStats = TeamStatsWithoutKey & {
	rid: number;
};

export type TradePickValues = {
	[key: string]: number[] | undefined;
	default: number[];
};
type TradeSummaryTeam = {
	name: string;
	ovrAfter: number;
	ovrBefore: number;
	payrollAfterTrade: number;
	payrollBeforeTrade: number;
	picks: {
		dpid: number;
		season: DraftPickSeason;
		round: number;
		pick: number;
		desc: string;

		// Condition added in this trade, and whether one can be added
		condition?: PickConditionSpec;
		conditionText?: string;
		canHaveCondition?: boolean;
	}[];
	total: number;
	trade: (PlayerFiltered<{
		attrs: ["pid", "name", "contract", "draft"];
		season: number;
		showRookies: true;
		showNoStats: true;
	}> &
		// Front Office Budget: the user's analytics projection of next season's ovr, for players he'd receive
		{ analytics?: { lo: number; hi: number } })[];
};

export type TeamSeasonFrontOffice = {
	expenses: Record<"analytics" | "travel", number>;
	expenseLevels: Record<"analytics" | "travel", number>;
	// Games recorded (the setting can be turned on mid-season)
	gpRecorded?: number;
	review?: FrontOfficeReview;
};

// Measured during the season, each relative to the same events at league-average spending
export type FrontOfficeReview = {
	// In-game injuries, and games they cost
	injuries: number;
	injuryGames: number;
	// Games saved on those injuries' durations (health budget + Medical recovery of 30+ players), from the same random draws
	durationGamesSaved: number;
	// Injuries the Medical injury rate avoided (or added, negative), sum over injuries of 1/factor - 1, and their games
	injuriesAvoided: number;
	injuryGamesAvoided: number;
	// Games with a travel, back-to-back or 3-in-4 fatigue penalty, the penalties (sum of endurance %) and the part saved
	fatigueGames: number;
	fatiguePenalty: number;
	fatigueSaved: number;
};

export type TradeSummary = {
	teams: [TradeSummaryTeam, TradeSummaryTeam];
	warning: null | string;
	warningAmount?: number;
};

export type TradeTeam = {
	dpids: number[];
	dpidsExcluded: number[];
	pickConditions?: TradePickCondition[];
	pids: number[];
	pidsExcluded: number[];
	tid: number;
	warning?: string | null;
	warningAmount?: number;
};

export type TradeTeams = [TradeTeam, TradeTeam];

// A trade offer an AI team sent to the user, see trade/aiOffers.ts. teams[0] is the user's team
export type AiTradeOffer = {
	id: number;
	tid: number;
	season: number;
	phase: Phase;

	// Number of games the user's team had played when the offer was made, used to expire offers
	gp: number;

	// g.daysLeft when the offer was made, used to expire offers during free agency. Missing in old leagues
	daysLeft?: number;

	// The AI team's roster (sorted pids) when the offer was made. A changed roster expires the offer
	rosterKey?: string;

	// Why the offer was made. Missing in old leagues
	source?: "tradingBlock" | "unsolicited" | "requested";

	teams: TradeTeams;
	reason: string;
};

export type Trade = {
	rid: 0;
	teams: TradeTeams;
};

export type UpdateEvent =
	| "account"
	| "allStarDunk"
	| "allStarThree"
	| "firstRun"
	| "g.goatFormula"
	| "g.goatSeasonFormula"
	| "g.tradeProposalsSeed"
	| "gameAttributes"
	| "gameSim"
	| "leagues"
	| "newPhase"
	| "notes"
	| "options"
	| "playerMovement"
	| "playoffs"
	| "savedTrades"
	| "scheduledEvents"
	// Coaching staff changes
	| "staff"
	| "retiredJerseys"
	| "team"
	| "teamFinances"
	| "draftLottery"
	| "undoTrade"
	// The Wrapped and Storylines snapshot finished building, or made progress
	| "wrappedReady"
	| "wrappedProgress"
	// A League achievement was unlocked
	| "leagueAchievements"

	// This should be used for things that do stuff like "select all players on watch list", not updating the watch property for individual players. crossTabEmit handles that automatically.
	| "watchList";

export type UpdateEvents = UpdateEvent[];

const idSchema = z.object({ id: z.string() });

const faceConfigStrictSchema = z.object({
	fatness: z.number(),
	teamColors: z.tuple([z.string(), z.string(), z.string()]),
	hairBg: idSchema,
	body: z.object({ id: z.string(), color: z.string(), size: z.number() }),
	jersey: idSchema,
	ear: z.object({ id: z.string(), size: z.number() }),
	head: z.object({ id: z.string(), shave: z.string() }),
	eyeLine: idSchema,
	smileLine: z.object({ id: z.string(), size: z.number() }),
	miscLine: idSchema,
	facialHair: idSchema,
	eye: z.object({ id: z.string(), angle: z.number() }),
	eyebrow: z.object({ id: z.string(), angle: z.number() }),
	hair: z.object({ id: z.string(), color: z.string(), flip: z.boolean() }),
	mouth: z.object({ id: z.string(), flip: z.boolean() }),
	nose: z.object({ id: z.string(), flip: z.boolean(), size: z.number() }),
	glasses: idSchema,
	accessories: idSchema,
});

// Compile error if FaceConfig and the schema ever differ, in either direction
true satisfies IsExact<FaceConfig, z.infer<typeof faceConfigStrictSchema>>;

// Unknown properties are kept rather than rejected or stripped
const faceConfigSchema = faceConfigStrictSchema.loose();

// Each value is either an imgURL or a facesjs face. Not z.union, because that only reports "Invalid input" for a bad face, rather than which property of the face is wrong.
const realPlayerPhotoSchema = z
	.unknown()
	.transform((value, ctx): string | FaceConfig => {
		const result = (
			typeof value === "string" ? z.string() : faceConfigSchema
		).safeParse(value);
		if (!result.success) {
			for (const issue of result.error.issues) {
				ctx.addIssue({ ...issue });
			}
			return z.NEVER;
		}
		return result.data;
	});

export const realPlayerPhotosSchema = z.record(
	z.string(),
	realPlayerPhotoSchema,
);
export type RealPlayerPhotos = z.infer<typeof realPlayerPhotosSchema>;

export const individualRealTeamInfoSchema = z.object({
	abbrev: z.string().exactOptional(),
	region: z.string().exactOptional(),
	name: z.string().exactOptional(),
	pop: z.number().exactOptional(),
	colors: z.tuple([z.string(), z.string(), z.string()]).exactOptional(),
	imgURL: z.string().exactOptional(),
	imgURLSmall: z.string().exactOptional(),
	jersey: z.string().exactOptional(),
});
export type IndividualRealTeamInfo = z.infer<
	typeof individualRealTeamInfoSchema
>;

export const realTeamInfoSchema = z.record(
	z.string(),
	individualRealTeamInfoSchema.extend({
		seasons: z.record(z.number(), individualRealTeamInfoSchema).exactOptional(),
	}),
);
export type RealTeamInfo = z.infer<typeof realTeamInfoSchema>;

export type RealDraftRatings = (typeof REAL_DRAFT_RATINGS)[number];

// Either one mode, or a weighted mixture of several
export type RealDraftRatingsSetting =
	| RealDraftRatings
	| Record<RealDraftRatings, number>;

export type GetLeagueOptionsReal = {
	type: "real";
	season: number;
	phase: Phase;
	randomDebuts: boolean;
	randomDebutsKeepCurrent: boolean;
	realDraftRatings: RealDraftRatingsSetting;
	realStats: "none" | "lastSeason" | "allActive" | "allActiveHOF" | "all";
	includePlayers: boolean;

	// For callers that need historical team records/players attached to teams
	includeSeasonInfo?: boolean;
	preservePlayerOvrContext?: boolean;
	pidOffset?: number;
};

export type GetLeagueOptions =
	| GetLeagueOptionsReal
	| {
			type: "legends";
			decade:
				| "1950s"
				| "1960s"
				| "1970s"
				| "1980s"
				| "1990s"
				| "2000s"
				| "2010s"
				| "2020s"
				| "all";
	  };

// Would probably be better to have this all at the root, and store one object per (season, t0, t1) but it's awkward to separate t0 and t1 and IndexedDB does not let you make a compound index that includes a multiEntry index, so maybe this is better?
export type HeadToHead = {
	season: number;

	// The keys are team IDs. First should be the lowest of the pair
	regularSeason: Record<
		number,
		Record<
			number,
			{
				won: number;
				lost: number;
				tied: number;
				otl: number;
				pts: number;
				oppPts: number;

				// Needed because we're only storing one record per (tid, tid) pair, and we swap the results when returning the other
				otw: number;
			}
		>
	>;

	playoffs: Record<
		number,
		Record<
			number,
			// This assumes you can only play one playoff series against a given team in a season
			{
				round: number;
				result: "won" | "lost" | undefined;
				won: number;
				lost: number;
				pts: number;
				oppPts: number;
			}
		>
	>;
};

export type SeasonLeaders = {
	season: number;
	age: number;
	regularSeason: Record<string, unknown>;
	playoffs: Record<string, unknown>;
	combined?: Record<string, unknown>;
	ratings: Record<string, unknown>;

	// Optional because we can't compute this for real players leagues without scanning the whole history (slow, tedious) and probably nobody cares
	ratingsFuzz?: Record<string, unknown>;
};

export type SavedTrade = {
	hash: string;
	tid: number;
};

export type SavedTradingBlock = {
	rid: 0;
	dpids: number[];
	pids: number[];
	tid: number;
	offers: {
		dpids: number[];
		pids: number[];
		tid: number;
	}[];
	lookingFor?: LookingForState;
};

export type TeamNum = 0 | 1;

export type ScoutingEntry = {
	season: number;
	type: "scout" | "workout";
	points: number;
	// |fuzz| before this action, so the report can say how much it narrowed
	fuzzBefore: number;
};

export type DraftBoardEntry = {
	// 1 = top of the board, undefined = unranked
	rank?: number;
	// 1 = top tier
	tier?: number;
	note?: string;
};
export type * from "./types.staff.ts";
export type * from "./types.gm.ts";

// Pro league linked to a college league (docs/college-mode.md)
export type LinkedCollege = {
	lid: number;
	// Import the college league's latest departed class automatically when the season is over
	auto: boolean;
	imports: { collegeSeason: number; draftYear: number; num: number }[];
};
