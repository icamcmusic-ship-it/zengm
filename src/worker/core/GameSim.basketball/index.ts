import { schoolDistanceKm } from "../../../common/college/geography.ts";
import { g, helpers } from "../../util/index.ts";
import { nativeFeatureEnabled } from "../../../common/nativeFeatures.ts";
import {
	SIM_FIX_EXPANDED_SYNERGY_CUTOFFS,
	SIM_FIX_LOW_POST,
	SIM_FIX_MID_RANGE,
	SIM_FIX_PERF_FACTOR,
} from "./simSettings.ts";
import {
	CLOSER_FACTOR,
	CLOSING_MARGIN,
	CLOSING_SECONDS,
	FOUL_TROUBLE_SIT_FACTOR,
	foulTroubleSitUntil,
	minutesDebtFactor,
	NON_CLOSER_FACTOR,
	pickClosers,
	planMinutes,
	UNPLANNED_FACTOR,
} from "./rotationPlanner.ts";
import {
	POSITIONAL_SCALE,
	positionalShares,
	type PositionalShares,
} from "./positionalComposites.ts";
import { PHASE, STARTING_NUM_TIMEOUTS } from "../../../common/constants.ts";
import jumpBallWinnerStartsThisPeriodWithPossession from "./jumpBallWinnerStartsThisPeriodWithPossession.ts";
import getInjuryRate from "./getInjuryRate.ts";
import type {
	GameAttributesLeague,
	PlayerInjury,
	TeamNum,
} from "../../../common/types.ts";
import GameSimBase from "../GameSim/GameSimBase.ts";
import { maxBy } from "../../../common/utils.ts";
import {
	type BlockType,
	type FgaType,
	type FgMakeType,
	type FgMissType,
} from "./PlayByPlayLogger.ts";
import getWinner from "../../../common/getWinner.ts";
import { formatClock } from "../../../common/formatClock.ts";
import type {
	ClutchMeta,
	ClutchPlayerRef,
} from "../../../common/pbpFlavor/clutch.ts";
import PlayByPlayLogger from "./PlayByPlayLogger.ts";
import {
	NEUTRAL_COACH_SIM,
	type CoachSim,
} from "../../../common/coachSystems.ts";
import { choice, truncGauss, uniform } from "../../../common/random.ts";
import {
	CREATION,
	CREATION_POWER,
	lineupSpacing,
	SPACING,
	spacingAround,
	synergySpacingFactor,
	type LineupSpacing,
} from "./spacingCreation.ts";
import {
	assignMatchups,
	driveMismatch,
	MATCHUP,
	mismatchScale,
	postMismatch,
} from "./matchupDefense.ts";
import {
	ENDGAME,
	endgameRole,
	endgameRoleScore,
	endgameValues,
	foulTargetWeights,
	runTimeoutSource,
	runTimeoutThreshold,
	saveLastTimeout,
	upThreeFoulProb,
} from "./endgame.ts";
import {
	crowdLevel,
	homeCourtModifier,
	LOAD,
	loadFatigue,
	refLean,
	tiredInjuryWeight,
	travelDistance,
	travelEndurance,
} from "./scheduleLoad.ts";
import {
	lateGameSituationWeight,
	teamChemistryBonus,
	teamSwitchDefenseBonus,
	lineupSizeMismatch,
	teamLateGameDecisionQuality,
	type TraitEffects,
	type TraitSituation,
} from "../../../common/playerTraits/index.ts";
import {
	drawBackcourtTime,
	drawHalfCourtSearch,
	drawOrbQuickShot,
	drawRestartSearch,
	drawTransitionTime,
	gaussian,
	HALF_COURT_SEARCH_MODE,
	ORB_RESET_SEARCH_MEAN,
	ORB_RESET_SEARCH_SD,
	paceScales,
	PROB_ORB_QUICK_SHOT,
	PROB_TRANSITION,
	PROB_VIOLATION_IN_CRISIS,
	SHOT_CLOCK_FULL,
	SHOT_CLOCK_RESET_ORB,
	getShotClockOrbReset,
	shotClockMakeFactor,
	teamPaceFactor,
	deriveTraits,
	NEUTRAL_TRAITS,
	type Traits,
	TOV_SCALE,
} from "./possessionModel.ts";
import { TURNOVERS } from "./realisticTurnovers.ts";

// Player traits: the chance that a team misses the right end-of-game call (foul when behind, hold for the last shot, 2-for-1) at full
// weight, before late-game IQ moves it (see applyLateGameDecision)
const LATE_GAME_BASE_ERROR = 0.06;
// const NUM_TIMEOUTS_MAX_FINAL_PERIOD = 4;
// const NUM_TIMEOUTS_MAX_FINAL_PERIOD_LAST_3_MIN = 2;
const NUM_TIMEOUTS_OVERTIME = 2;

const TIMEOUTS_STOP_CLOCK = 2; // [minutes]

const TIP_IN_ONLY_LIMIT = 0.2; // [seconds] - only tip-ins from an inbound with less than this much time

// Technical and flagrant fouls (the technicalFouls setting). Rates are per chance: a tech can follow any dead ball, a flagrant can happen
// on any half-court possession. Tuned so a game has about 0.4 technicals, 0.08 flagrant 1s and 0.005 flagrant 2s (see technicalFouls.test.ts,
// which also changes them to test rare cases)
export const TECHNICAL_FOUL_RATES = {
	techPerDeadBall: 0.0029,
	// Of technicals, the share called on the bench (the coach) rather than a player on the floor
	techBench: 0.2,
	flagrantPerPossession: 0.0005,
	// Of flagrant fouls, the share that are flagrant 2 (an ejection)
	flagrant2: 0.06,
};

type ShotType =
	| "atRim"
	| "ft"
	| "lowPost"
	| "midRange"
	| "threePointer"
	| "tipIn"
	| "putBack";
type Stat =
	| "ast"
	| "ba"
	| "benchTime"
	| "blk"
	| "courtTime"
	| "drb"
	| "energy"
	| "fg"
	| "fgAtRim"
	| "fgLowPost"
	| "fgMidRange"
	| "fga"
	| "fgaAtRim"
	| "fgaLowPost"
	| "fgaMidRange"
	| "ft"
	| "fta"
	| "gp"
	| "gs"
	| "min"
	| "orb"
	| "pf"
	| "pts"
	| "stl"
	| "tov"
	| "tp"
	| "tpa"
	| "sAtt"
	| "sPts";
type CompositeRating =
	| "blocking"
	| "fouling"
	| "passing"
	| "rebounding"
	| "offRebounding"
	| "defRebounding"
	| "stealing"
	| "turnovers"
	| "usage"
	| "jumpBall"
	| "creation";
// Expanded ratings calibration (see docs/native-features.md, Expanded ratings): keeps league blocks and field goal percentages the same as with the
// setting off
const EXPANDED_BLK_FACTOR = 1.07;
const EXPANDED_BLK_JUMPER_FACTOR = 0.9;
const EXPANDED_FINISH_OVER = 1.5;
const EXPANDED_LENGTH_REF = 0.5;
const EXPANDED_INTERIOR_OFFSET = 0.006;
const EXPANDED_PERIMETER_OFFSET = 0.008;
const EXPANDED_STL_FACTOR = 1.01;

// Perimeter Defense: how much the perimeter defense composite tilts who is credited with a steal, and how much of the stealing
// composite's power (4) it takes back. The two composites are close (speed, defense), so without the damping the pick went as about
// the fifth power and piled steals on the best few defenders (4-5 players at 2.0+ a season, leader ~2.5)
const PERIMETER_STEAL_POWER = 1;
const PERIMETER_STEAL_DAMPING = 1.5;
// ... and the top of the tail: a weight above this many times the five players' mean keeps only part of the excess, so an extreme
// speed/defense guard (spd 99) doesn't get 3.3 steals a game (the real-life maximum is 2.5-3, leaders are usually 2-2.5). Only who
// gets the steal changes, not how many (sweep19: leaders 2.2-3.3 -> 2.2-2.3 over seeds 1, 2, 6, 18)
const STEAL_WEIGHT_SOFT_CAP = 1.6;
const STEAL_WEIGHT_EXCESS = 0.4;
// Second step (offensive/defensive rebounding, catch-and-shoot/off-the-dribble shooting, ball security): keeps league offensive
// rebounds, turnovers and jump shooting the same as with the setting off
const EXPANDED_ORB_FACTOR = 1.004;
// Share of the turnover denominator that is ball security (the rest is dribbling and passing, as with the setting off)
const EXPANDED_BSC_SHARE = 0.6;
const EXPANDED_TOV_FACTOR = 1.012;
// How much of the catch-and-shoot / off-the-dribble gap a jumper's make probability gets (assisted: + gap / 2, unassisted: - gap / 2)
const EXPANDED_JUMPER_STYLE = 0.32;
const EXPANDED_JUMPER_OFFSET = 0.003;

type PlayerGameSim = {
	id: number;
	name: string;
	age: number;
	pos: string;
	valueNoPot: number;
	stat: any;
	compositeRating: any;
	skills: string[];
	injured: boolean;
	newInjury: boolean;
	injury: PlayerInjury & {
		playingThrough: boolean;
	};
	ptModifier: number;
	// Raw ratings, for the wording of the play-by-play only (see loadTeams)
	pbpRatings?: Record<string, number>;
	// Player traits (the playerTraits setting): his effects on the game, set once per game in loadTeams, undefined with the setting off.
	// gameZ is his game-to-game form this game, one standard normal draw per player per game (only when traitEffects exist)
	traitEffects?: TraitEffects;
	gameZ?: number;
	// His height rating, for defensive versatility (size mismatches). Only set with traitEffects
	traitHgt?: number;
};
type TeamGameSim = {
	id: number;
	pace: number; // mean number of possessions the team likes to have in a game
	// Coaching systems (the coachSystems setting, common/coachSystems.ts), set by staff/systems.ts applyCoachSystems. Undefined: no effect
	coachSim?: CoachSim;
	stat: any;
	compositeRating: any;
	player: PlayerGameSim[];
	synergy: {
		def: number;
		off: number;
		reb: number;
	};
};

type PossessionOutcome =
	| "tov"
	| "stl"
	| "endOfPeriod"
	| "nonShootingFoul"
	| "drb"
	| "orb"
	| "fg"
	| "ft"
	| "timeout"
	| "outOfBoundsDefense"
	| "outOfBoundsOffense";

type ClockFactor = ReturnType<GameSim["getClockFactor"]>;

const teamNums: [TeamNum, TeamNum] = [0, 1];

// Return the indexes of the elements in ovrs, sorted from smallest to largest.
// So [50, 70, 10, 20, 60] => [2, 3, 0, 4, 1]
// The set is to handle ties.
// The descending sort and reverse is so ties are handled with the later entry in ovrs getting the lower index, like:
// [0, 0, 0, 0, 0] => [4, 3, 2, 1, 0]
const getSortedIndexes = (ovrs: number[]) => {
	const ovrsSortedDesc = ovrs.toSorted((a, b) => b - a);
	const usedIndexes = new Set();
	const sortedIndexes = ovrsSortedDesc
		.map((ovr) => {
			let index = ovrs.indexOf(ovr);
			while (usedIndexes.has(index)) {
				index += 1;
			}
			usedIndexes.add(index);
			return index;
		})
		.reverse();

	return sortedIndexes;
};

const STOCK_SYNERGY_CUTOFFS = { Di: 0.57, Dp: 0.61, R: 0.61 };

const NEUTRAL_CS: CoachSim = {
	...NEUTRAL_COACH_SIM,
	off: "motion",
	def: "switch",
};

// Use if denominator of prob might be 0
const boundProb = (prob: number) => helpers.bound(prob, 0.001, 0.999);

const ref = (p: { id: number; name: string }): ClutchPlayerRef => ({
	pid: p.id,
	name: p.name,
});

class GameSim extends GameSimBase {
	team: [TeamGameSim, TeamGameSim];

	playersOnCourt: [PlayerGameSim[], PlayerGameSim[]];

	t: number;

	numPeriods: number;

	foulsThisQuarter: [number, number];

	foulsLastTwoMinutes: [number, number];

	paceFactor: number;

	synergyFactor: number;

	lastScoringPlay: {
		team: TeamNum;
		player: PlayerGameSim;
		type: ShotType;
		time: number;
		// Additive metadata for the clutch-play flavor text (no random draws): the assister and the defender the shot was made over, if known
		ast?: PlayerGameSim;
		def?: PlayerGameSim;
	}[];

	clutchPlays: {
		text: string;
		showNotification: boolean;
		pids: [number];
		tids: [number];
		// What happened, for the flavor wording (src/common/pbpFlavor/clutch.ts). Present without play-by-play logging
		meta?: ClutchMeta;
	}[];

	// Latest candidate for a game-saving defensive play (see noteDefensiveStop)
	defensiveStop:
		| {
				t: TeamNum;
				period: number;
				oppPts: number;
				meta: Extract<ClutchMeta, { kind: "defense" }>;
		  }
		| undefined;

	o: TeamNum;

	d: TeamNum;

	playByPlay: PlayByPlayLogger;

	elam: boolean;

	elamActive: boolean;

	elamDone: boolean;

	elamTarget: number;

	fatigueFactor: number;

	numPlayersOnCourt: number;

	gender: GameAttributesLeague["gender"];

	timeouts: [number, number] = [STARTING_NUM_TIMEOUTS!, STARTING_NUM_TIMEOUTS!];

	isClockRunning = true;

	// Individual possession state
	prevPossessionOutcome: PossessionOutcome | undefined;
	possessionLength = 0;
	lastOrbPlayer: PlayerGameSim | undefined;

	ratingArrayCache: number[];

	// Technical and flagrant fouls, ejections (the technicalFouls setting). When it is off, nothing here is ever used, so the sim's random
	// numbers are exactly what they were before this existed
	techFouls: boolean;
	ejected = new Set<PlayerGameSim>();
	techs = new Map<PlayerGameSim | number, number>();
	flagrants = new Map<PlayerGameSim, number>();
	// The realistic possession model (the realisticPossessions setting, see possessionModel.ts): a real shot clock, transition and
	// half-court possessions, late-clock shots and violations, end-of-period clock management. When it is off, nothing here is used and no
	// extra random numbers are drawn, so games play out exactly as before
	realPoss: boolean;
	shotClock = SHOT_CLOCK_FULL;
	// Shot clock length (the customShotClock setting; 24 unless it is on) and what it resets to after an offensive rebound
	shotClockFull = SHOT_CLOCK_FULL;
	shotClockOrb = SHOT_CLOCK_RESET_ORB;
	// One-and-one bonus (the oneAndOne setting): team fouls in a period from which a non-shooting foul gives a one-and-one, undefined = off
	oneAndOneFouls: number | undefined;
	shotClockViolations: [number, number] = [0, 0];
	teamPaceFactor: [number, number] = [1, 1];
	// Player traits (the playerTraits setting, see docs/player-traits.md). When no player has trait effects, nothing here is used and no
	// extra random numbers are drawn, so games play out exactly as before. None of it reads or depends on the play-by-play
	traitsOn: boolean;
	// What the traits of the players on the court mean for the realistic possession model (see possessionModel.ts Traits), refreshed every
	// possession
	traits: [Traits, Traits] = [{ ...NEUTRAL_TRAITS }, { ...NEUTRAL_TRAITS }];
	// Expanded ratings (the expandedRatings setting, see docs/native-features.md, Expanded ratings): wingspan and perimeter/interior defense. loadTeams then
	// gives every player a "length" composite (and the defense, rebounding and finishing composites read the new ratings). Off: nothing
	// below is used, games play out exactly as before
	expandedRatings: boolean;

	// Perimeter Defense (League extras, see docs/native-features.md): who gets credited with a steal leans to quick on-ball defenders
	perimeterDefense: boolean;
	// Game Sim Fixes (League extras, see simSettings.ts): make probabilities of mid-range and post shots, the trailing team's boost,
	// synergy skill cutoffs with expanded ratings. Off: nothing below is used
	simFixes: boolean;
	// Position-aware team composites (League extras, see positionalComposites.ts): each player counts by his role for the team
	// composites. Off: plain 5-man averages, as before
	positionalComposites: boolean;
	// Realistic Rotations (League extras, see rotationPlanner.ts): minutes targets planned at tip-off, foul trouble rules, closers,
	// garbage time by value. Off: the stock substitution values, as before. Either way the same random numbers are drawn
	realisticRotations: boolean;
	// Minutes per regulation game planned for each player, his rank by value on his team, and until when (elapsed regulation seconds)
	// he sits in foul trouble
	minutesTargets = new Map<PlayerGameSim, number>();
	valueRanks = new Map<PlayerGameSim, number>();
	foulTroubleSitUntil = new Map<PlayerGameSim, number>();
	// (game settings read once at tip-off)
	rotationQuarterSeconds = 720;
	rotationFoulsToFoulOut = 6;
	// Each team's shares for its last lineup (recomputed only when the lineup changes)
	positionalSharesCache: [
		PositionalShares | undefined,
		PositionalShares | undefined,
	] = [undefined, undefined];
	positionalSharesLineup: [PlayerGameSim[], PlayerGameSim[]] = [[], []];
	// Expanded ratings, second step (offRebounding/defRebounding/ballSecurity/catchShoot/offDribble composites from loadTeams)
	expandedRatings2: boolean;
	// Player traits: a playoff game, where the big-game trait applies (the whole game)
	bigGame = false;
	// Player traits: picking the player who gets a technical or flagrant foul (temper weighs in, see traitPickWeight)
	pickingTechFoul = false;
	possTimeScale = 1;
	gameClockFactor = 1;
	// Coaching systems (the coachSystems setting, see common/coachSystems.ts): each team's multipliers. When neither team has them, nothing
	// below is used and no random numbers are drawn differently, so games play out exactly as before
	coachSys = false;
	cs: [CoachSim, CoachSim] = [NEUTRAL_CS, NEUTRAL_CS];
	// The current segment of the possession followed a shot or free throw attempt (for the shot clock reset when it goes out off the defense)
	afterShotAttempt = false;
	// Spacing & Shot Creation (League extras, see spacingCreation.ts): the spacing of each team's five (refreshed with the synergy, at
	// each substitution) and the creator of the current shot. Off: nothing here is used and no extra random numbers are drawn
	spacingCreation: boolean;
	lineupSpacing: [LineupSpacing, LineupSpacing] = [
		{ sum: 0, nonShooters: 0 },
		{ sum: 0, nonShooters: 0 },
	];
	creator: PlayerGameSim | undefined;
	// Matchup Defense (League extras, see matchupDefense.ts): for each team on defense, the index of the defender guarding each offensive
	// player (by his index on the court), assigned at each substitution, and the team's average defensive versatility. Off: nothing here is
	// used and no extra random numbers are drawn
	matchupDefense: boolean;
	guards: [number[], number[]] = [[], []];
	teamVersatility: [number, number] = [0, 0];
	// The matchup of the last shot (for the calibration script)
	lastMatchup = { delta: 0, post: 0, drive: 0, fitRel: 0 };
	// End-of-Game Intelligence (League extras, see endgame.ts): run-stopping timeouts (each team's extra timeouts and the opponent's
	// unanswered points), offense/defense substitutions in the last minute, who gets fouled on purpose, fouling when up 3, last shots and
	// 2-for-1s in the stock possession model. Off: nothing here is used and no extra random numbers are drawn
	smartEndgame: boolean;
	// Realistic Turnovers (League extras, see realisticTurnovers.ts): fewer turnovers, the same steals
	realisticTurnovers: boolean;
	earlyTimeouts: [number, number] = [0, 0];
	// Unanswered points by each team
	scoringRun: [number, number] = [0, 0];
	// The team that has the ball next (for the substitutions at a dead ball)
	nextOffense: TeamNum | undefined;
	// Does each team's coach foul when up 3 (decided the first time it comes up)
	up3Coach: [boolean | undefined, boolean | undefined] = [undefined, undefined];
	runTimeoutNow = false;
	// (for the tests and the calibration script)
	endgameCounts = { runTimeouts: 0, up3Fouls: 0, odSubs: 0 };
	// Load, Fatigue & Venue (League extras, see scheduleLoad.ts): nonlinear fatigue, injury risk with tiredness, the home court split
	// into base, crowd and referees, travel, and the referee crew. foulMult is each team's foul rate on defense (the referees' lean and
	// crew). Off: nothing here is used and no extra random numbers are drawn
	scheduleLoad: boolean;
	foulMult: [number, number] = [1, 1];
	// The away team's trip in km (undefined without the regions' coordinates)
	travelKm: number | undefined;
	skillsCountCache = new Map<
		PlayerGameSim,
		Record<"3" | "A" | "B" | "Di" | "Dp" | "Po" | "Ps" | "R", number>
	>();

	/**
	 * Initialize the two teams that are playing this game.
	 *
	 * When an instance of this class is created, information about the two teams is passed to GameSim. Then GameSim.run will actually simulate a game and return the results (i.e. stats) of the simulation. Also see core.game where the inputs to this function are generated.
	 */
	constructor({
		gid,
		day,
		teams,
		doPlayByPlay,
		homeCourtFactor,
		allStarGame,
		baseInjuryRate,
		neutralSite,
	}: {
		gid: number;
		day?: number;
		teams: [TeamGameSim, TeamGameSim];
		doPlayByPlay: boolean;
		homeCourtFactor: number;
		allStarGame: boolean;
		baseInjuryRate: number;
		neutralSite: boolean;
	}) {
		super({
			gid,
			day,
			allStarGame,
			baseInjuryRate,
			neutralSite,
		});
		// Every game logs its events when they are stored with the box score (only what the text needs, if nobody watches it live)
		const storePlayByPlay = !!g.get("storePlayByPlay");
		this.playByPlay = new PlayByPlayLogger(
			doPlayByPlay || storePlayByPlay,
			doPlayByPlay,
		);
		this.techFouls = !!g.get("technicalFouls") && !allStarGame;

		this.team = teams; // If a team plays twice in a day, this needs to be a deep copy

		// Player traits: one normal draw per player per game for his game-to-game form, only when he has trait effects
		this.traitsOn = false;
		for (const t of teams) {
			for (const p of t.player) {
				if (p.traitEffects) {
					this.traitsOn = true;
					p.gameZ = gaussian();
				}
			}
		}

		if (teams[0].coachSim || teams[1].coachSim) {
			this.coachSys = true;
			this.cs = [
				teams[0].coachSim ?? NEUTRAL_CS,
				teams[1].coachSim ?? NEUTRAL_CS,
			];
		}

		this.perimeterDefense = nativeFeatureEnabled("perimeterDefense", (key) =>
			g.get(key as any),
		);

		this.simFixes = nativeFeatureEnabled("simFixes", (key) =>
			g.get(key as any),
		);
		this.positionalComposites = nativeFeatureEnabled(
			"positionalComposites",
			(key) => g.get(key as any),
		);

		this.expandedRatings = teams.some((t) =>
			t.player.some((p) => p.compositeRating.length !== undefined),
		);
		this.expandedRatings2 = teams.some((t) =>
			t.player.some((p) => p.compositeRating.offRebounding !== undefined),
		);
		this.matchupDefense = nativeFeatureEnabled("matchupDefense", (key) =>
			g.get(key as any),
		);
		// (loadTeams adds the creation composite only with the setting on)
		this.spacingCreation = teams.some((t) =>
			t.player.some((p) => p.compositeRating.creation !== undefined),
		);

		this.smartEndgame =
			!allStarGame &&
			nativeFeatureEnabled("smartEndgame", (key) => g.get(key as any));
		if (this.smartEndgame) {
			this.earlyTimeouts = [ENDGAME.earlyTimeouts, ENDGAME.earlyTimeouts];
			this.rotationQuarterSeconds = g.get("quarterLength") * 60;
		}

		this.realisticTurnovers = nativeFeatureEnabled(
			"realisticTurnovers",
			(key) => g.get(key as any),
		);

		this.scheduleLoad =
			!allStarGame &&
			nativeFeatureEnabled("scheduleLoad", (key) => g.get(key as any));
		if (this.scheduleLoad && g.get("scheduleLoadRefVariance")) {
			// One draw per game: how tightly this crew calls it
			const crew = Math.exp(LOAD.refSd * gaussian());
			this.foulMult = [crew, crew];
		}

		// Starting lineups, which will be reset by updatePlayersOnCourt. This must be done because of injured players in the top 5.
		this.numPlayersOnCourt = g.get("numPlayersOnCourt");

		this.realisticRotations = nativeFeatureEnabled(
			"realisticRotations",
			(key) => g.get(key as any),
		);
		if (this.realisticRotations) {
			// (also set below, needed here for the first lineup)
			this.numPeriods = g.get("numPeriods");
			this.planRotations();
		}
		this.playersOnCourt = [
			this.team[0].player.slice(0, this.numPlayersOnCourt),
			this.team[1].player.slice(0, this.numPlayersOnCourt),
		];
		this.ratingArrayCache = new Array(this.numPlayersOnCourt);

		this.updatePlayersOnCourt({
			recordStarters: true,
		});
		this.updateSynergy();

		this.t = g.get("quarterLength") * 60; // Game clock, in seconds
		this.numPeriods = g.get("numPeriods");
		this.gender = g.get("gender");

		this.paceFactor = g.get("pace") / 100;
		this.paceFactor +=
			0.025 * helpers.bound((this.paceFactor - 1) / 0.2, -1, 1);

		// Sanity check for very small values - things behave weirdly below this
		this.paceFactor = Math.max(this.paceFactor, 0.1);

		this.realPoss = !!g.get("realisticPossessions");
		if (g.get("customShotClock")) {
			this.shotClockFull = helpers.bound(
				Math.round(g.get("shotClockLength")),
				10,
				60,
			);
			this.shotClockOrb = getShotClockOrbReset(this.shotClockFull);
			this.shotClock = this.shotClockFull;
		}
		if (g.get("oneAndOne")) {
			this.oneAndOneFouls = g.get("oneAndOneFouls");
		}
		if (this.realPoss) {
			const scales = paceScales(this.paceFactor, this.shotClockFull);
			this.possTimeScale = scales.possTimeScale;
			this.gameClockFactor = scales.gameClockFactor;
			this.teamPaceFactor = [
				teamPaceFactor(this.team[0].pace),
				teamPaceFactor(this.team[1].pace),
			];
			if (this.coachSys) {
				this.teamPaceFactor = [
					this.teamPaceFactor[0] * this.cs[0].pace,
					this.teamPaceFactor[1] * this.cs[1].pace,
				];
			}
		}

		this.foulsThisQuarter = [0, 0];
		this.foulsLastTwoMinutes = [0, 0];

		// Parameters
		this.synergyFactor = 0.1; // How important is synergy?

		this.lastScoringPlay = [];
		this.clutchPlays = [];
		this.defensiveStop = undefined;
		this.elam = this.allStarGame ? g.get("elamASG") : g.get("elam");
		this.elamActive = false;
		this.elamDone = false;
		this.elamTarget = 0;

		this.fatigueFactor = 0.055;

		this.bigGame = g.get("phase") === PHASE.PLAYOFFS && !allStarGame;

		if (g.get("phase") === PHASE.PLAYOFFS) {
			this.fatigueFactor /= 1.85;
			this.synergyFactor *= 2.5;
		}

		if (!neutralSite) {
			this.homeCourtAdvantage(homeCourtFactor);
		}

		this.o = 0;
		this.d = 1;
	}

	/**
	 * Home court advantage.
	 *
	 * Scales composite ratings, giving home players bonuses and away players penalties.
	 *
	 */
	homeCourtAdvantage(homeCourtFactor: number) {
		const homeCourtModifier =
			homeCourtFactor *
			helpers.bound(
				this.scheduleLoad
					? this.loadHomeCourtModifier()
					: 1 + g.get("homeCourtAdvantage") / 100,
				0.01,
				Infinity,
			);

		for (const t of teamNums) {
			let factor;

			if (t === 0) {
				factor = homeCourtModifier; // Bonus for home team
			} else {
				factor = 1.0 / homeCourtModifier; // Penalty for away team
			}

			for (let p = 0; p < this.team[t].player.length; p++) {
				for (const r of Object.keys(this.team[t].player[p]!.compositeRating)) {
					if (r !== "endurance") {
						if (r === "turnovers" || r === "fouling") {
							// These are negative ratings, so the bonus or penalty should be inversed
							this.team[t].player[p]!.compositeRating[r] /= factor;
						} else {
							// Apply bonus or penalty
							this.team[t].player[p]!.compositeRating[r] *= factor;
						}
					}
				}
			}
		}
	}

	// Load, Fatigue & Venue: the base and crowd parts of the home court, and the rest of it as the referees' lean and the visitors' trip
	loadHomeCourtModifier() {
		const hca = g.get("homeCourtAdvantage");
		const lean = refLean(hca);
		this.foulMult = [
			this.foulMult[0] * (1 - lean),
			this.foulMult[1] * (1 + lean),
		];
		// College mode: campus to campus (the region is the school's name)
		this.travelKm =
			g.get("leagueType") === "college"
				? schoolDistanceKm(
						(this.team[1] as any).region,
						(this.team[0] as any).region,
					)
				: travelDistance(
						(this.team[1] as any).region,
						(this.team[0] as any).region,
					);
		let travel = travelEndurance(this.travelKm);
		// Front Office Budget: the visitors' Travel & Sports Science scales the travel penalty (undefined when off), measured for the season
		// review
		const foTravelScale: number | undefined = (this.team[1] as any)
			.foTravelScale;
		if (foTravelScale !== undefined && travel < 1) {
			const neutral = travel;
			travel = 1 - (1 - neutral) * foTravelScale;
			const t1 = this.team[1] as any;
			t1.foFatigue ??= { penalty: 0, saved: 0 };
			t1.foFatigue.penalty += 100 * (1 - neutral);
			t1.foFatigue.saved += 100 * (1 - neutral) * (1 - foTravelScale);
		}
		for (const p of this.team[1].player) {
			if (p.compositeRating.endurance !== undefined) {
				p.compositeRating.endurance *= travel;
			}
		}
		return homeCourtModifier(
			hca,
			crowdLevel(
				// Marquee Games: holiday, national TV and rivalry games are a little louder
				((this.team[0] as any).crowdHype ?? 0.5) +
					((this.team[0] as any).crowdBoost ?? 0),
				g.get("phase") === PHASE.PLAYOFFS,
			),
		);
	}

	/**
	 * Simulates the game and returns the results.
	 *
	 * Also see core.game where the outputs of this function are used.
	 *
	 * @return {Array.<Object>} Game result object, an array of two objects similar to the inputs to GameSim, but with both the team and player "stat" objects filled in and the extraneous data (pace, valueNoPot, compositeRating) removed. In other words...
	 *     {
	 *         "gid": 0,
	 *         "overtimes": 0,
	 *         "team": [
	 *             {
	 *                 "id": 0,
	 *                 "stat": {},
	 *                 "player": [
	 *                     {
	 *                         "id": 0,
	 *                         "stat": {},
	 *                         "skills": [],
	 *                         "injured": false
	 *                     },
	 *                     ...
	 *                 ]
	 *             },
	 *         ...
	 *         ]
	 *     }
	 */
	run() {
		// Simulate the game up to the end of regulation
		this.simRegulation();

		// Play overtime periods if necessary
		let numOvertimes = 0;
		while (
			this.team[0].stat.pts === this.team[1].stat.pts &&
			numOvertimes < this.maxOvertimes
		) {
			this.checkGameTyingShot();
			this.simOvertime();
			numOvertimes += 1;
		}

		this.checkGameWinner();
		this.checkDefensiveStop();

		this.doShootout();

		this.playByPlay.logEvent({
			type: "gameOver",
		});

		// Delete stuff that isn't needed before returning
		for (const t of teamNums) {
			delete this.team[t].compositeRating;

			// @ts-expect-error
			delete this.team[t].pace;

			for (const p of this.team[t].player) {
				// @ts-expect-error
				delete p.age;

				// @ts-expect-error
				delete p.valueNoPot;
				delete p.compositeRating;
				delete p.traitEffects;
				delete p.gameZ;

				// @ts-expect-error
				delete p.ptModifier;
				delete p.stat.benchTime;
				delete p.stat.courtTime;
				delete p.stat.energy;
			}
		}

		const out = {
			gid: this.id,
			day: this.day,
			overtimes: this.overtimes,
			team: this.team,
			clutchPlays: this.clutchPlays,
			playByPlay: this.playByPlay.getPlayByPlay(this.team),
			numPlayersOnCourt: this.numPlayersOnCourt,
			neutralSite: this.neutralSite,
			// scoringSummary: this.playByPlay.scoringSummary,
		};
		return out;
	}

	doShootoutShot(t: TeamNum, p: PlayerGameSim) {
		// 20% to 80%
		const probMake = p.compositeRating.shootingThreePointer * 0.6 + 0.2;

		const made = Math.random() < probMake;

		this.recordStat(t, undefined, "sAtt");
		if (made) {
			this.recordStat(t, undefined, "sPts");
		}

		this.playByPlay.logEvent({
			type: "shootoutShot",
			t,
			pid: p.id,
			made,
		});
	}

	doShootout() {
		if (
			this.shootoutRounds <= 0 ||
			this.team[0].stat.pts !== this.team[1].stat.pts
		) {
			return;
		}

		this.shootout = true;
		this.t = 1; // So fast-forward to end of period stops before the shootout
		this.team[0].stat.sPts = 0;
		this.team[0].stat.sAtt = 0;
		this.team[1].stat.sPts = 0;
		this.team[1].stat.sAtt = 0;

		this.playByPlay.logEvent({
			type: "shootoutStart",
			rounds: this.shootoutRounds,

			// So fast-forward to end of period stops before the shootout
			clock: this.t,
		});

		const shooters = teamNums.map((t) => {
			// Find best shooter - slight bias towards high usage players
			return maxBy(
				this.team[t].player,
				(p) =>
					p.compositeRating.shootingThreePointer +
					0.2 * p.compositeRating.usage -
					(p.injured ? 1000 : 0),
			)!;
		}) as [PlayerGameSim, PlayerGameSim];

		const reversedTeamNums = [1, 0] as const;

		for (const t of reversedTeamNums) {
			const shooter = shooters[t];

			this.playByPlay.logEvent({
				type: "shootoutTeam",
				t,
				pid: shooter.id,
			});

			for (let i = 0; i < this.shootoutRounds; i++) {
				if (
					this.shouldEndShootoutEarly(t, i, [
						this.team[0].stat.sPts,
						this.team[1].stat.sPts,
					])
				) {
					break;
				}

				this.doShootoutShot(t, shooter);
			}
		}

		if (this.team[0].stat.sPts === this.team[1].stat.sPts) {
			this.playByPlay.logEvent({
				type: "shootoutTie",
			});

			while (this.team[0].stat.sPts === this.team[1].stat.sPts) {
				for (const t of reversedTeamNums) {
					this.doShootoutShot(t, shooters[t]);
				}
			}
		}

		// Log winner
		const winner = this.team[0].stat.sPts > this.team[1].stat.sPts ? 0 : 1;
		const loser = winner === 0 ? 1 : 0;
		this.clutchPlays.push({
			text: `<a href="${helpers.leagueUrl(["player", shooters[winner].id])}">${
				shooters[winner].name
			}</a> defeated <a href="${helpers.leagueUrl(["player", shooters[loser].id])}">${
				shooters[loser].name
			}</a> in a shootout`,
			showNotification: this.team[winner].id === g.get("userTid"),
			pids: [shooters[winner].id],
			tids: [this.team[winner].id],
			meta: {
				kind: "shootout",
				player: ref(shooters[winner]),
				opp: ref(shooters[loser]),
			},
		});
	}

	jumpBall() {
		const jumpers = teamNums.map((t) => {
			const ratios = this.ratingArray("jumpBall", t, 1, this.ratingArrayCache);
			const maxRatio = Math.max(...ratios);
			let ind = ratios.indexOf(maxRatio);
			if (ind < 0) {
				ind = 0;
			}
			return this.playersOnCourt[t][ind];
		}) as [PlayerGameSim, PlayerGameSim];
		const prob =
			0.5 *
			(jumpers[0].compositeRating.jumpBall /
				jumpers[1].compositeRating.jumpBall) **
				3;

		// Team assignments are the opposite of what you'd expect, cause in simPossession it swaps possession at top
		this.o = Math.random() < prob ? 1 : 0;
		this.d = this.o === 0 ? 1 : 0;
		this.playByPlay.logEvent({
			type: "jumpBall",
			t: this.d,
			pid: jumpers[this.d].id,
			pid2: jumpers[this.o].id,
			clock: this.t,
		});
		return this.d;
	}

	checkElamEnding() {
		if (
			this.elam &&
			!this.elamActive &&
			((g.get("elamOvertime") &&
				this.team[0].stat.ptsQtrs.length > this.numPeriods) ||
				(!g.get("elamOvertime") &&
					this.team[0].stat.ptsQtrs.length >= this.numPeriods &&
					this.t <= g.get("elamMinutes") * 60))
		) {
			const maxPts = Math.max(
				this.team[this.d].stat.pts,
				this.team[this.o].stat.pts,
			);
			this.elamTarget = maxPts + g.get("elamPoints");
			this.elamActive = true;
			this.t = Infinity; // This disables any late clock effects
			this.playByPlay.logEvent({
				type: "elamActive",
				target: this.elamTarget,
			});
		}
	}

	logTimeouts() {
		this.playByPlay.logEvent({
			type: "timeouts",
			timeouts: [...this.timeouts],
		});
	}

	// Set the number of timeouts for each team to maxTimeouts, unless it's already lower than that in which case do nothing
	/*setMaxTimeouts(maxTimeouts: number) {
		this.timeouts = this.timeouts.map(timeouts => {
			return Math.min(timeouts, maxTimeouts);
		}) as [number, number];
		this.logTimeouts();
	}*/

	simRegulation() {
		let period = 1;
		const wonJump = this.jumpBall();
		// let doneSettingTimeoutsLastThreeMinutes = false;

		while (!this.elamDone) {
			if (period !== 1) {
				this.doSubstitutionsIfDeadBall({
					type: "newPeriod",
				});
			}

			const finalPeriod = period === this.numPeriods;
			// Coaching systems: a quick-trigger coach has used a timeout by now (to stop runs), so he has one fewer for the end
			// (End-of-Game Intelligence: the timeouts to stop runs are simulated instead, and at most two of the extra ones are left)
			if (finalPeriod && this.smartEndgame) {
				for (const t of teamNums) {
					this.earlyTimeouts[t] = Math.min(
						this.earlyTimeouts[t],
						ENDGAME.maxFinalPeriod,
					);
				}
			} else if (finalPeriod && this.coachSys) {
				for (const t of teamNums) {
					if (this.cs[t].burnTimeout && this.timeouts[t] > 1) {
						this.timeouts[t] -= 1;
						this.logTimeouts();
					}
				}
			}
			/*if (finalPeriod) {
				this.setMaxTimeouts(NUM_TIMEOUTS_MAX_FINAL_PERIOD);
			}*/

			// Team assignments are the opposite of what you'd expect, cause in simPossession it swaps possession at top
			if (
				jumpBallWinnerStartsThisPeriodWithPossession(period, this.numPeriods)
			) {
				this.o = wonJump === 0 ? 1 : 0;
			} else {
				this.o = wonJump === 0 ? 0 : 1;
			}
			this.d = this.o === 0 ? 1 : 0;

			this.checkElamEnding(); // Before loop, in case it's at 0
			while (this.t > 0 && !this.elamDone) {
				/*if (
					finalPeriod &&
					!doneSettingTimeoutsLastThreeMinutes &&
					this.t <= 3 * 60
				) {
					this.setMaxTimeouts(NUM_TIMEOUTS_MAX_FINAL_PERIOD_LAST_3_MIN);
					doneSettingTimeoutsLastThreeMinutes = true;
				}*/

				this.simPossession();
				this.checkElamEnding();
			}

			if (finalPeriod) {
				break;
			}

			period += 1;

			this.team[0].stat.ptsQtrs.push(0);
			this.team[1].stat.ptsQtrs.push(0);
			this.foulsThisQuarter = [0, 0];
			this.foulsLastTwoMinutes = [0, 0];
			this.lastScoringPlay = [];
			this.scoringRun = [0, 0];
			this.t = g.get("quarterLength") * 60;
			this.playByPlay.logEvent({
				type: "period",
				period: this.team[0].stat.ptsQtrs.length,
				clock: this.t,
			});
		}
	}

	simOvertime() {
		this.t = 60 * this.getOvertimeLength();

		this.timeouts = [NUM_TIMEOUTS_OVERTIME, NUM_TIMEOUTS_OVERTIME];
		this.earlyTimeouts = [0, 0];
		this.scoringRun = [0, 0];
		this.logTimeouts();

		this.lastScoringPlay = [];
		this.overtimes += 1;
		this.team[0].stat.ptsQtrs.push(0);
		this.team[1].stat.ptsQtrs.push(0);
		this.foulsThisQuarter = [0, 0];
		this.foulsLastTwoMinutes = [0, 0];
		this.lastScoringPlay = [];
		this.playByPlay.logEvent({
			type: "overtime",
			period: this.team[0].stat.ptsQtrs.length,
			clock: this.t,
		});

		// Check for elamOvertime
		this.checkElamEnding();

		this.doSubstitutionsIfDeadBall({
			type: "newPeriod",
		});

		this.jumpBall();

		while (this.t > 0 && !this.elamDone) {
			this.simPossession();
		}
	}

	getClockFactor() {
		if (this.elamActive) {
			return;
		}

		if (this.realPoss) {
			return this.getClockFactorRealistic();
		}

		if (this.shouldIntentionalFoul()) {
			return "intentionalFoul";
		}

		const period = this.team[this.o].stat.ptsQtrs.length;
		const pointDifferential =
			this.team[this.o].stat.pts - this.team[this.d].stat.pts;

		// Run out the clock if winning
		if (period >= this.numPeriods && this.t <= 24 && pointDifferential > 0) {
			return "runOutClock" as const;
		}

		if (this.t <= 26 && (period < this.numPeriods || pointDifferential >= 0)) {
			return "holdForLastShot" as const;
		}

		if (
			period >= this.numPeriods &&
			((this.t <= 3 * 60 && pointDifferential <= -10) ||
				(this.t <= 2 * 60 && pointDifferential <= -5) ||
				(this.t <= 1 * 60 && pointDifferential < 0))
		) {
			return "catchUp";
		}
		if (
			period >= this.numPeriods &&
			((this.t <= 3 * 60 && pointDifferential > 10) ||
				(this.t <= 2 * 60 && pointDifferential > 5) ||
				(this.t <= 1 * 60 && pointDifferential > 0))
		) {
			return "maintainLead";
		}

		if (this.t >= 32 && this.t <= 52) {
			return "twoForOne";
		}
	}

	// Call this before running clock for possession
	shouldIntentionalFoul() {
		const diff = this.team[this.o].stat.pts - this.team[this.d].stat.pts;
		if (this.smartEndgame && diff === -3 && this.shouldFoulUpThree()) {
			return true;
		}
		const offenseWinningByABit = diff > 0 && diff <= 6;
		const intentionalFoul =
			offenseWinningByABit &&
			this.team[0].stat.ptsQtrs.length >= this.numPeriods &&
			this.t < (this.coachSys ? this.cs[this.d].foulWindow : 27) &&
			this.t > 0.3 &&
			this.getNumFoulsUntilBonus() <= 10;

		return intentionalFoul;
	}

	probNonShootingFoul() {
		let probability = 0.08;
		const defensiveLead =
			this.team[this.d].stat.pts - this.team[this.o].stat.pts;

		// Protect a close lead (or a tie) without giving away free throws. Keep
		// fouls to give and intentional fouling separate from this adjustment.
		// Calibrated to 2021-24 NBA play-by-play: roughly 4-5 non-shooting
		// penalty fouls per 100 possessions in this situation. The probability
		// here is per check, so it is not directly a per-possession rate.
		if (
			!this.elamActive &&
			this.team[this.o].stat.ptsQtrs.length >= this.numPeriods &&
			this.t <= 60 &&
			defensiveLead >= 0 &&
			defensiveLead <= 2 &&
			this.getNumFoulsUntilBonus() <= 1
		) {
			probability *= 0.5;
		}

		if (this.traitsOn) {
			probability *= this.traitMean(this.d, (e) => e.foulProneness, 1);
		}

		if (this.coachSys) {
			probability *= this.cs[this.d].foul;
		}

		// Load, Fatigue & Venue: the referees
		if (this.scheduleLoad) {
			probability *= this.foulMult[this.d];
		}

		return probability * g.get("foulRateFactor");
	}

	// When a shot is made and the clock is still running, some time runs off the clock before the next possession starts. No need to worry about going into negative clock values, since the clock stops after made baskets with under 2 minutes left
	dtInbound() {
		let dt = 0;

		if (
			(this.prevPossessionOutcome === "fg" ||
				this.prevPossessionOutcome === "ft") &&
			this.isClockRunning
		) {
			// Time to gather ball after shot was made, and then to inbound it too
			dt += uniform(1, 5);
			if (this.realPoss) {
				// (2-3 s on average in the NBA; it runs off the game clock, not the shot clock)
				dt *=
					(0.75 * this.possTimeScale * this.gameClockFactor) /
					this.teamPaceFactor[this.o];
			}
		}

		return dt;
	}

	doSubstitutionsIfDeadBall(
		info:
			| {
					type: "afterPossession";
					injuries: boolean;
			  }
			| {
					type: "newPeriod";
			  },
	) {
		const outcome = this.prevPossessionOutcome;
		const deadBall =
			info.type === "newPeriod" ||
			(info.type === "afterPossession" && info.injuries) ||
			outcome === "timeout" ||
			outcome === "outOfBoundsDefense" ||
			outcome === "outOfBoundsOffense" ||
			outcome === "nonShootingFoul" ||
			outcome === "ft";
		if (deadBall) {
			// (the possession changes at the start of the next one, so the defense has the ball next)
			this.nextOffense = info.type === "afterPossession" ? this.d : undefined;
			const substitutions = this.updatePlayersOnCourt();

			if (substitutions) {
				this.updateSynergy();
			}
		}
	}

	simPossession() {
		// Possession change
		this.o = this.o === 1 ? 0 : 1;
		this.d = this.o === 1 ? 0 : 1;
		this.nextOffense = this.o;
		this.runTimeoutNow = false;
		this.updateTeamCompositeRatings();

		const dtInbound = this.dtInbound();
		this.t -= dtInbound;
		this.possessionLength = 0;
		this.isClockRunning = true; // Set after computing dtIinbound!
		if (this.realPoss) {
			this.resetShotClock();
			if (this.traitsOn) {
				this.traits = [
					deriveTraits(this.playersOnCourt[0].map((p) => p.traitEffects)),
					deriveTraits(this.playersOnCourt[1].map((p) => p.traitEffects)),
				];
			}
		}

		const clockFactor = this.applyLateGameDecision(this.getClockFactor());
		const outcome = this.getPossessionOutcome(clockFactor);

		// Swap o and d so that o will get another possession when they are swapped again at the beginning of the loop.
		if (
			outcome === "orb" ||
			outcome === "nonShootingFoul" ||
			outcome === "timeout" ||
			outcome === "outOfBoundsDefense"
		) {
			this.o = this.o === 1 ? 0 : 1;
			this.d = this.o === 1 ? 0 : 1;
		}

		const possessionTime = dtInbound + this.possessionLength;
		this.updatePlayingTime(possessionTime);

		if (this.techFouls) {
			this.maybeTechnicalFoul(outcome);
		}

		// Nobody can get hurt if no time elapsed, otherwise a player could be injured immediately after subbing in, with 0 minutes played
		// (End-of-Game Intelligence: nor during a timeout to stop a run, which is not a possession)
		const injuries =
			possessionTime > 0 && !this.runTimeoutNow ? this.injuries() : false;

		this.prevPossessionOutcome = outcome;

		// With 0 on the clock, either the game is over (no subs) or the subs should happen at start of next period
		if (this.t > 0 && !this.elamDone) {
			this.doSubstitutionsIfDeadBall({
				type: "afterPossession",
				injuries,
			});
		}
	}

	isLateGame() {
		const quarter = this.team[0].stat.ptsQtrs.length;
		let lateGame;
		if (this.elamActive) {
			const ptsToTarget =
				this.elamTarget -
				Math.max(this.team[this.d].stat.pts, this.team[this.o].stat.pts);
			lateGame = ptsToTarget <= 15;
		} else {
			lateGame = quarter >= this.numPeriods && this.t < 6 * 60;
		}

		return lateGame;
	}

	/**
	 * Convert energy into fatigue, which can be multiplied by a rating to get a fatigue-adjusted value.
	 *
	 * @param {number} energy A player's energy level, from 0 to 1 (0 = lots of energy, 1 = none).
	 * @return {number} Fatigue, from 0 to 1 (0 = lots of fatigue, 1 = none).
	 */
	fatigue(energy: number, skip?: boolean, loadCurve?: boolean): number {
		energy += 0.016;

		if (energy > 1) {
			energy = 1;
		}
		if (skip) {
			return energy;
		}

		// Load, Fatigue & Venue: the shooter's penalty steepens as he tires
		if (loadCurve && this.scheduleLoad) {
			energy = loadFatigue(energy);
		}

		// Late in games, or in OT, fatigue matters less
		if (this.isLateGame()) {
			const factor = this.elamActive ? 2 : 6 - this.t / 60;
			return (energy + factor) / (1 + factor);
		}

		return energy;
	}

	// Realistic Rotations: minutes targets for the game (rotationPlanner.ts) and each player's rank by value
	planRotations() {
		const playoffs = g.get("phase") === PHASE.PLAYOFFS;
		this.rotationQuarterSeconds = g.get("quarterLength") * 60;
		this.rotationFoulsToFoulOut = g.get("foulsNeededToFoulOut");
		for (const t of this.team) {
			const targets = planMinutes(
				t.player.map((p) => ({
					valueNoPot: p.valueNoPot,
					injured: p.injured,
					ptModifier: this.allStarGame ? 1 : p.ptModifier,
					minutesRestriction: (p as any).minutesRestriction,
					coachMinutesMult: (p as any).coachMinutesMult,
				})),
				{
					playoffs,
					backToBack: !!(t as any).backToBack,
					numPlayersOnCourt: this.numPlayersOnCourt,
					allStarGame: this.allStarGame,
					// The coach's rotation style and rest philosophy (coaching systems, staff/systems.ts applyCoachSystems)
					rotationStyle: (t as any).rotationStyle,
					backToBackCut: (t as any).backToBackCut,
				},
			);
			for (const [i, p] of t.player.entries()) {
				this.minutesTargets.set(p, targets[i]!);
			}
			const byValue = t.player.toSorted((a, b) => b.valueNoPot - a.valueNoPot);
			for (const [rank, p] of byValue.entries()) {
				this.valueRanks.set(p, rank);
			}
		}
	}

	// Realistic Rotations: seconds of regulation played so far (regulation length in overtime)
	elapsedRegulationSeconds() {
		const quarterSeconds = this.rotationQuarterSeconds;
		const period = this.team[0].stat.ptsQtrs.length;
		if (period > this.numPeriods) {
			return this.numPeriods * quarterSeconds;
		}
		const t = this.t ?? quarterSeconds;
		return (period - 1) * quarterSeconds + (quarterSeconds - t);
	}

	// Realistic Rotations: after a foul, does he have to sit for a while (rotationPlanner.ts foulTroubleSitUntil)
	onPersonalFoul(p: PlayerGameSim) {
		const sitUntil = foulTroubleSitUntil({
			pf: p.stat.pf,
			period: this.team[0].stat.ptsQtrs.length,
			numPeriods: this.numPeriods,
			foulsNeededToFoulOut: this.rotationFoulsToFoulOut,
			quarterSeconds: this.rotationQuarterSeconds,
		});
		if (
			sitUntil !== undefined &&
			sitUntil > (this.foulTroubleSitUntil.get(p) ?? -1)
		) {
			this.foulTroubleSitUntil.set(p, sitUntil);
		}
	}

	// Realistic Rotations: the closing lineup of each team, in the last minutes of a close game (undefined otherwise)
	getClosers(): [Set<PlayerGameSim>, Set<PlayerGameSim>] | undefined {
		const quarter = this.team[0].stat.ptsQtrs.length;
		const closingSeconds =
			(CLOSING_SECONDS * this.rotationQuarterSeconds) / 720;
		if (
			this.elamActive ||
			quarter < this.numPeriods ||
			this.t === undefined ||
			this.t > Math.min(closingSeconds, CLOSING_SECONDS) ||
			Math.abs(this.team[0].stat.pts - this.team[1].stat.pts) > CLOSING_MARGIN
		) {
			return undefined;
		}
		// End-of-Game Intelligence: offense/defense substitutions in the last minute (without Realistic Rotations, closers only then)
		const od = this.endgameOd();
		if (!od && !this.realisticRotations) {
			return undefined;
		}
		const foulsNeededToFoulOut = g.get("foulsNeededToFoulOut");
		return teamNums.map((t) => {
			const candidates = this.team[t].player
				.filter(
					(p) =>
						!p.injured &&
						!this.ejected.has(p) &&
						!(foulsNeededToFoulOut > 0 && p.stat.pf >= foulsNeededToFoulOut) &&
						(this.allStarGame || p.ptModifier > 0),
				)
				.sort(
					(a, b) =>
						b.valueNoPot * (this.allStarGame ? 1 : b.ptModifier) -
						a.valueNoPot * (this.allStarGame ? 1 : a.ptModifier),
				);
			return od
				? this.pickEndgameClosers(t, candidates)
				: pickClosers(candidates, this.numPlayersOnCourt);
		}) as [Set<PlayerGameSim>, Set<PlayerGameSim>];
	}

	// ---- End-of-Game Intelligence (the smartEndgame setting, see endgame.ts). Only called with the setting on ----

	// The coach's game management, -1 to 1 (0 without coaching systems)
	endgameMgmt(t: TeamNum) {
		return this.coachSys
			? helpers.bound((this.cs[t].foulWindow - 27) / 6, -1, 1)
			: 0;
	}

	// The last minute of a close game (final period or overtime), when teams substitute for offense and defense at dead balls
	endgameOd() {
		return (
			this.smartEndgame &&
			!this.elamActive &&
			this.nextOffense !== undefined &&
			this.t !== undefined &&
			this.t <= ENDGAME.odSeconds &&
			this.team[0].stat.ptsQtrs.length >= this.numPeriods &&
			Math.abs(this.team[0].stat.pts - this.team[1].stat.pts) <=
				ENDGAME.odMargin
		);
	}

	// The closing lineup for the situation: the team's best players, with the last spots going to free throw shooters (ahead, with the
	// ball), shooters (behind) or defenders and rebounders (on defense). candidates are sorted best first
	pickEndgameClosers(t: TeamNum, candidates: PlayerGameSim[]) {
		const role = endgameRole(
			t === this.nextOffense,
			this.team[t].stat.pts - this.team[t === 0 ? 1 : 0].stat.pts,
		);
		const pool = candidates.slice(0, Math.max(9, this.numPlayersOnCourt));
		const values = endgameValues(
			pool.map((p) => p.valueNoPot * (this.allStarGame ? 1 : p.ptModifier)),
			pool.map((p) => endgameRoleScore(role, p.compositeRating)),
			this.endgameMgmt(t),
		);
		const picked = pickClosers(
			pool
				.map((p, i) => ({ pos: p.pos, valueNoPot: values[i]!, p }))
				.sort((a, b) => b.valueNoPot - a.valueNoPot),
			this.numPlayersOnCourt,
		);
		const closers = new Set<PlayerGameSim>();
		for (const { p } of picked) {
			closers.add(p);
		}
		return closers;
	}

	// A timeout is a breather for everyone on the floor
	timeoutBreather() {
		for (const t of teamNums) {
			for (const p of this.playersOnCourt[t]) {
				p.stat.energy = Math.min(1, p.stat.energy + ENDGAME.timeoutRest);
			}
		}
	}

	// At the start of a possession: the team with the ball stops the other team's run with a timeout
	maybeRunTimeout(): PossessionOutcome | undefined {
		const o = this.o;
		const quick = this.coachSys ? this.cs[o].burnTimeout : undefined;
		if (
			this.elamActive ||
			this.scoringRun[this.d] < runTimeoutThreshold(quick)
		) {
			return;
		}
		const finalPeriod = this.team[0].stat.ptsQtrs.length >= this.numPeriods;
		if (
			finalPeriod &&
			Math.abs(this.team[0].stat.pts - this.team[1].stat.pts) >
				ENDGAME.runMaxMargin
		) {
			return;
		}
		const source = runTimeoutSource({
			early: this.earlyTimeouts[o],
			late: this.timeouts[o],
			finalPeriod,
			overtime: this.overtimes > 0,
			t: this.t,
			quickTrigger: quick,
		});
		if (!source) {
			return;
		}
		if (source === "early") {
			this.earlyTimeouts[o] -= 1;
		} else {
			this.timeouts[o] -= 1;
			this.logTimeouts();
		}
		this.scoringRun[this.d] = 0;
		this.runTimeoutNow = true;
		this.endgameCounts.runTimeouts += 1;
		this.isClockRunning = false;
		this.timeoutBreather();
		this.playByPlay.logEvent({
			type: "timeout",
			clock: this.t,
			t: o,
			numLeft: this.earlyTimeouts[o] + this.timeouts[o],
			advancesBall: false,
		});
		return "timeout";
	}

	// Up 3 on defense with a few seconds left: foul before a three can go up (each coach either does it or not, more often the good
	// game managers; decided with one random number the first time it comes up)
	shouldFoulUpThree() {
		if (this.elamActive || this.team[0].stat.ptsQtrs.length < this.numPeriods) {
			return false;
		}
		const prob = upThreeFoulProb(this.t, this.endgameMgmt(this.d));
		if (prob <= 0) {
			return false;
		}
		let coach = this.up3Coach[this.d];
		if (coach === undefined) {
			coach = Math.random() < prob;
			this.up3Coach[this.d] = coach;
		}
		if (coach) {
			this.endgameCounts.up3Fouls += 1;
		}
		return coach;
	}

	// Who the defense fouls on purpose: the worst free throw shooter it can get to (one random number, like the pick it replaces)
	pickFoulTarget() {
		const players = this.playersOnCourt[this.o];
		const weights = this.ratingArray("usage", this.o, 1, this.ratingArrayCache);
		const ftProbs = [];
		for (let i = 0; i < this.numPlayersOnCourt; i++) {
			ftProbs.push(this.freeThrowProb(this.o, players[i]!));
		}
		foulTargetWeights(weights, ftProbs, this.endgameMgmt(this.d), weights);
		let sum = 0;
		for (const w of weights) {
			sum += w;
		}
		const rand = Math.random() * sum;
		let runningSum = 0;
		for (let i = 0; i < this.numPlayersOnCourt; i++) {
			runningSum += weights[i]!;
			if (rand < runningSum) {
				return players[i]!;
			}
		}
		return players[0]!;
	}

	// The shooter of the possession: by usage, or when the defense fouls on purpose, its target
	pickShooter(clockFactor: ClockFactor) {
		return this.smartEndgame && clockFactor === "intentionalFoul"
			? this.pickFoulTarget()
			: this.pickPlayer("usage", this.o, this.usagePower());
	}

	// The stock possession model: shoot early for a 2-for-1 (the realistic model plans it itself; the stock model already holds for
	// the last shot). dt is when the shot would go up otherwise
	endgameShotTime(dt: number) {
		if (
			Math.random() <
			ENDGAME.twoForOneProb + ENDGAME.clockMgmt * this.endgameMgmt(this.o)
		) {
			const target = this.t - uniform(29, 35);
			if (target >= 0.5) {
				return Math.min(dt, target);
			}
		}
		return dt;
	}

	// Realistic Rotations: how much more or less he is wanted on the court than his value and fatigue say (not in blowouts)
	rotationFactor(
		p: PlayerGameSim,
		foulLimit: number,
		elapsed: number,
		closers: Set<PlayerGameSim> | undefined,
	) {
		let factor = 1;
		const sitUntil = this.foulTroubleSitUntil.get(p);
		const rulesApply =
			this.numPeriods === 4 && this.rotationFoulsToFoulOut >= 5;
		if (rulesApply) {
			if (
				sitUntil !== undefined &&
				sitUntil > elapsed &&
				this.overtimes === 0 &&
				!this.elamActive
			) {
				// Sitting: his minutes plan doesn't bring him back early, but he can still close a game
				return FOUL_TROUBLE_SIT_FACTOR * (closers?.has(p) ? CLOSER_FACTOR : 1);
			}
		} else {
			factor *= this.getFoulTroubleFactor(p, foulLimit);
		}

		if (closers) {
			factor *= closers.has(p) ? CLOSER_FACTOR : NON_CLOSER_FACTOR;
		} else {
			const target = this.minutesTargets.get(p) ?? 0;
			if (target > 0) {
				const regulationSeconds = this.numPeriods * this.rotationQuarterSeconds;
				factor *= minutesDebtFactor(
					target,
					p.stat.min,
					elapsed / regulationSeconds,
				);
			} else {
				factor *= UNPLANNED_FACTOR;
			}
		}
		return factor;
	}

	getFoulTroubleLimit() {
		const foulsNeededToFoulOut = g.get("foulsNeededToFoulOut");

		// No foul trouble in overtime or late in 4th quarter
		const quarter = this.team[0].stat.ptsQtrs.length;
		if (
			this.overtimes > 0 ||
			this.elamActive ||
			(quarter === this.numPeriods && this.t < 8 * 60)
		) {
			return foulsNeededToFoulOut;
		}

		const quarterLength = g.get("quarterLength");

		const gameCompletionFraction =
			(quarter - this.t / (quarterLength * 60)) / this.numPeriods;

		// For default settings, the limit by quarter is 2/3/5/5. (Last quarter is 5 because of that Math.min)
		let foulLimit = Math.ceil(gameCompletionFraction * foulsNeededToFoulOut);
		if (foulLimit < 2) {
			// Don't worry about 1 foul
			foulLimit = 2;
		} else if (foulLimit >= foulsNeededToFoulOut) {
			// Worry about actually fouling out, otherwise this does nothing
			foulLimit = foulsNeededToFoulOut - 1;
		}

		return foulLimit;
	}

	// 1 -> no foul trouble
	// less than 1 -> decreases
	getFoulTroubleFactor(p: PlayerGameSim, foulLimit: number) {
		if (p.stat.pf === foulLimit) {
			// More likely to sub off at limit
			return 0.75;
		} else if (p.stat.pf > foulLimit) {
			// Very likely to sub off beyond limit
			return 0.1;
		}

		return 1;
	}

	/**
	 * Perform appropriate substitutions.
	 *
	 * Can this be sped up?
	 *
	 * @return {boolean} true if a substitution occurred, false otherwise.
	 */
	updatePlayersOnCourt({
		recordStarters = false,
		shooter = undefined,
	}: {
		recordStarters?: boolean;
		shooter?: PlayerGameSim;
	} = {}) {
		let substitutions = false;
		let blowout = false;
		const lateGame = this.isLateGame();

		const foulsNeededToFoulOut = g.get("foulsNeededToFoulOut");

		if (this.o !== undefined && this.d !== undefined) {
			const diff = Math.abs(
				this.team[this.d].stat.pts - this.team[this.o].stat.pts,
			);
			const quarter = this.team[this.o].stat.ptsQtrs.length;
			if (this.elamActive) {
				const ptsToTarget =
					this.elamTarget -
					Math.max(this.team[this.d].stat.pts, this.team[this.o].stat.pts);
				blowout = diff >= 20 && ptsToTarget < diff;
			} else {
				blowout =
					quarter === this.numPeriods &&
					((diff >= 30 && this.t < 12 * 60) ||
						(diff >= 25 && this.t < 9 * 60) ||
						(diff >= 20 && this.t < 7 * 60) ||
						(diff >= 15 && this.t < 3 * 60) ||
						(diff >= 10 && this.t < 1 * 60));
			}
		}

		const foulLimit = this.getFoulTroubleLimit();

		// Realistic Rotations
		const elapsed = this.realisticRotations
			? this.elapsedRegulationSeconds()
			: 0;
		const closers =
			(this.realisticRotations || this.smartEndgame) && !blowout
				? this.getClosers()
				: undefined;
		// End-of-Game Intelligence: offense/defense substitutions don't wait for a player to have been on or off the court for a while
		const odSubs = closers !== undefined && this.endgameOd();

		for (const t of teamNums) {
			const getOvrs = (includeFouledOut: boolean) => {
				// Overall values scaled by fatigue, etc
				// Player IDs can be large and sparse in long-running leagues.
				const ovrs = new Map<number, number>();
				let numEligiblePlayers = 0;

				for (const [i, p] of this.team[t].player.entries()) {
					// Injured or fouled out players can't play
					if (
						p.injured ||
						this.ejected.has(p) ||
						(!includeFouledOut &&
							foulsNeededToFoulOut > 0 &&
							p.stat.pf >= foulsNeededToFoulOut)
					) {
						ovrs.set(p.id, -Infinity);
					} else {
						let ovr =
							p.valueNoPot *
							this.fatigue(p.stat.energy) *
							(!lateGame ? uniform(0.9, 1.1) : 1);

						if (!this.allStarGame) {
							ovr *= p.ptModifier;
						}

						// Also scale based on margin late in games, so stars play less in blowouts (this doesn't really work that well, but better than nothing)
						if (blowout) {
							// Realistic Rotations: the end of the bench by value, not by roster order
							ovr *= this.realisticRotations
								? (this.valueRanks.get(p)! + 1) / 10
								: (i + 1) / 10;
						} else if (this.realisticRotations) {
							ovr *= this.rotationFactor(p, foulLimit, elapsed, closers?.[t]);
						} else {
							// If it's not a blowout, worry about foul trouble
							const foulTroubleFactor = this.getFoulTroubleFactor(p, foulLimit);
							ovr *= foulTroubleFactor;
							if (closers) {
								// (End-of-Game Intelligence without Realistic Rotations: the last minute's closers)
								ovr *= closers[t].has(p) ? CLOSER_FACTOR : NON_CLOSER_FACTOR;
							}
						}

						ovrs.set(p.id, ovr);
						if (ovr > -Infinity) {
							numEligiblePlayers += 1;
						}
					}
				}

				return { ovrs, numEligiblePlayers };
			};

			const result = getOvrs(false);
			let ovrs = result.ovrs;

			// What if too many players fouled out? Play them. Ideally would force non fouled out players to play first, but whatever. Without this, it would only play bottom of the roster guys (tied at -Infinity)
			if (result.numEligiblePlayers < this.numPlayersOnCourt) {
				ovrs = getOvrs(true).ovrs;
			}

			const ovrsOnCourt = this.playersOnCourt[t].map((p) => ovrs.get(p.id)!);

			const pids = [];
			const pidsOff = [];

			// Sub off the lowest ovr guy first
			for (const pp of getSortedIndexes(ovrsOnCourt)) {
				const p = this.playersOnCourt[t][pp]!;
				const onCourtOvr = ovrs.get(p.id)!;
				const onCourtIsIneligible = onCourtOvr === -Infinity;
				this.playersOnCourt[t][pp] = p; // Don't sub out guy shooting FTs!

				if (t === this.o && p === shooter) {
					continue;
				}
				if (!(p.stat.courtTime > 2) && !onCourtIsIneligible && !odSubs) {
					continue;
				}

				// The other lineup slots stay fixed until a substitute is accepted.
				let positions:
					| { numG: number; numPG: number; numF: number; numC: number }
					| undefined;

				// Loop through bench players (in order of current roster position) to see if any should be subbed in)
				for (const b of this.team[t].player) {
					if (this.playersOnCourt[t].includes(b)) {
						continue;
					}

					const benchIsValidAndBetter =
						(odSubs || (p.stat.courtTime > 2 && b.stat.benchTime > 2)) &&
						ovrs.get(b.id)! > onCourtOvr;
					const benchIsEligible = ovrs.get(b.id) !== -Infinity;

					if (
						benchIsValidAndBetter ||
						(onCourtIsIneligible && benchIsEligible)
					) {
						// Check if position of substitute makes for a valid lineup
						// Requre 2 Gs (or 1 PG) and 2 Fs (or 1 C)
						if (positions === undefined) {
							positions = { numG: 0, numPG: 0, numF: 0, numC: 0 };
							for (let j = 0; j < this.playersOnCourt[t].length; j++) {
								if (j !== pp) {
									const pos = this.playersOnCourt[t][j]!.pos;
									positions.numG += Number(pos.includes("G"));
									positions.numPG += Number(pos === "PG");
									positions.numF += Number(pos.includes("F"));
									positions.numC += Number(pos === "C");
								}
							}
						}
						const numG = positions.numG + Number(b.pos.includes("G"));
						const numPG = positions.numPG + Number(b.pos === "PG");
						const numF = positions.numF + Number(b.pos.includes("F"));
						const numC = positions.numC + Number(b.pos === "C");

						const cutoff =
							this.numPlayersOnCourt >= 5
								? 2
								: this.numPlayersOnCourt >= 3
									? 1
									: 0;
						if (
							(numG < cutoff && numPG === 0) ||
							(numF < cutoff && numC === 0)
						) {
							if (this.fatigue(p.stat.energy) > 0.728 && !onCourtIsIneligible) {
								// Exception for ridiculously tired players, so really unbalanced teams won't play starters whole game
								continue;
							}
						}

						substitutions = true;
						if (odSubs) {
							this.endgameCounts.odSubs += 1;
						}

						// Substitute player
						this.playersOnCourt[t][pp] = b;
						b.stat.courtTime = uniform(-2, 2);
						b.stat.benchTime = uniform(-2, 2);
						p.stat.courtTime = uniform(-2, 2);
						p.stat.benchTime = uniform(-2, 2);

						/*// Keep track of deviations from the normal starting lineup for the play-by-play
						if (this.playByPlay?.active) {
							this.playByPlay.push({
								type: "sub",
								t,
								on: b.id,
								off: p.id,
							});
						}*/

						// It's only a "substitution" if it's not the starting lineup
						if (!recordStarters) {
							pids.push(b.id);
							pidsOff.push(p.id);
						}

						break;
					}
				}
			}

			if (pids.length > 0) {
				this.playByPlay.logEvent({
					type: "sub",
					t,
					pids,
					pidsOff,
					clock: this.t,
				});
			}
		}

		// Record starters if that hasn't been done yet. This should run the first time this function is called, and never again.
		for (const t of teamNums) {
			for (const p of this.playersOnCourt[t]) {
				if (recordStarters) {
					this.recordStat(t, p, "gs");
				}
				this.recordStat(t, p, "gp");
			}
		}

		return substitutions;
	}

	/**
	 * Update synergy.
	 *
	 * This should be called after this.updatePlayersOnCourt as it only produces different output when the players on the court change.
	 */
	/* Player traits (the playerTraits setting). Everything below is only called when this.traitsOn, and works on the sim's own numbers (score,
	   clock, ratings): nothing here reads the play-by-play. */

	// The game situation for team t, for the situational trait hooks
	traitSituation(t: TeamNum): TraitSituation {
		return {
			scoreDiff: this.team[t].stat.pts - this.team[1 - t]!.stat.pts,
			timeLeft: this.t,
			period: this.team[0].stat.ptsQtrs.length,
			numPeriods: this.numPeriods,
		};
	}

	// Average of an effect over the players on the court for team t (neutral, 1 or 0, for a player without trait effects)
	traitMean(
		t: TeamNum,
		f: (e: TraitEffects) => number,
		neutral: number,
	): number {
		let total = 0;
		for (const p of this.playersOnCourt[t]) {
			total += p.traitEffects ? f(p.traitEffects) : neutral;
		}
		return total / this.playersOnCourt[t].length;
	}

	// How hard the defense of team t's opponent pressures the ball, 0 to 1, from its perimeter defense
	traitPressure(offense: TeamNum) {
		return helpers.bound(
			(this.team[1 - offense]!.compositeRating.defensePerimeter - 0.3) / 0.4,
			0,
			1,
		);
	}

	// The offense's turnover probability, scaled: clutch (in clutch time) and handling under pressure, averaged over the players on the court
	traitTurnoverMult(offense: TeamNum) {
		const sit = this.traitSituation(offense);
		const pressure = this.traitPressure(offense);
		const bigGame = this.bigGame;
		return this.traitMean(
			offense,
			(e) =>
				e.clutchTurnoverMult(sit) *
				e.pressureTurnoverMult(pressure) *
				(bigGame ? e.bigGameTurnoverMult : 1),
			1,
		);
	}

	// Shot make probability changes for a shooter: his game-to-game form, shot selection quality, clutch and, for assisted jumpers and
	// finishes (the plays that come off a screen, roll or pop), screening
	traitShotDelta(
		p: PlayerGameSim,
		passer: PlayerGameSim | undefined,
		type: ShotType,
	) {
		const e = p.traitEffects!;
		let delta = e.gameFormShotDelta(p.gameZ ?? 0);
		delta += e.shotSelectionBias(p.compositeRating.usage).shotQualityDelta;
		delta += e.clutchShotModifier(this.traitSituation(this.o));
		if (this.bigGame) {
			delta += e.bigGameShotDelta;
		}
		if (
			passer !== undefined &&
			(type === "midRange" || type === "threePointer" || type === "atRim")
		) {
			delta += e.screenShotDelta;
		}
		return delta;
	}

	// Weight multiplier for a player in a pickPlayer draw (who shoots, fouls, steals, rebounds or turns it over)
	traitPickWeight(rating: CompositeRating, p: PlayerGameSim, t: TeamNum) {
		const e = p.traitEffects;
		if (!e) {
			return 1;
		}
		switch (rating) {
			case "usage":
				return e.shotSelectionBias(p.compositeRating.usage).attemptWeightMult;
			case "fouling":
				// Technical and flagrant fouls: temper too
				return this.pickingTechFoul
					? e.foulProneness * e.techProneness
					: e.foulProneness;
			case "stealing":
				return e.gambleStealMultiplier * e.looseBallBonus;
			case "rebounding":
				return e.looseBallBonus;
			case "turnovers":
				return (
					e.clutchTurnoverMult(this.traitSituation(t)) *
					e.pressureTurnoverMult(this.traitPressure(t)) *
					(this.bigGame ? e.bigGameTurnoverMult : 1)
				);
			default:
				return 1;
		}
	}

	// Technical and flagrant fouls (the technicalFouls setting): multiply the rate by the average temper of team t's players on the court
	// (techProneness or flagrantProneness, 1 for an average temper). Exactly 1 with traits off
	traitTemperRate(t: TeamNum, type: "tech" | "flagrant") {
		if (!this.traitsOn) {
			return this.coachSys ? this.cs[t].temper : 1;
		}
		return (
			(this.coachSys ? this.cs[t].temper : 1) *
			this.traitMean(
				t,
				type === "tech" ? (e) => e.techProneness : (e) => e.flagrantProneness,
				1,
			)
		);
	}

	// Who gets a technical or flagrant foul: like any foul, plus temper with traits on. Same random numbers either way
	pickTechFouler(t: TeamNum) {
		this.pickingTechFoul = true;
		try {
			return this.pickPlayer("fouling", t, 1);
		} finally {
			this.pickingTechFoul = false;
		}
	}

	// End-of-game decisions (foul when behind, hold for the last shot, two-for-one): a team with poor late-game IQ sometimes misses the right
	// call and plays the possession normally. The chance of missing it is 0 outside the last four minutes
	applyLateGameDecision(clockFactor: ClockFactor): ClockFactor {
		if (
			!this.traitsOn ||
			(clockFactor !== "intentionalFoul" &&
				clockFactor !== "holdForLastShot" &&
				clockFactor !== "twoForOne")
		) {
			return clockFactor;
		}
		// The trailing team (on defense) decides to foul, otherwise the offense decides how to use the clock
		const t = clockFactor === "intentionalFoul" ? this.d : this.o;
		const sit = this.traitSituation(t);
		const weight = lateGameSituationWeight(sit);
		if (weight <= 0) {
			return clockFactor;
		}
		const effects = this.playersOnCourt[t]
			.toSorted(
				(a, b) => b.compositeRating.dribbling - a.compositeRating.dribbling,
			)
			.map((p) => p.traitEffects)
			.filter((e) => e !== undefined);
		const quality = teamLateGameDecisionQuality(effects, sit);
		const probCorrect = helpers.bound(
			1 - LATE_GAME_BASE_ERROR * weight + quality,
			0,
			1,
		);
		return Math.random() < probCorrect ? clockFactor : undefined;
	}

	updateSynergy() {
		for (const t of teamNums) {
			// Count all the *fractional* skills of the active players on a team (including duplicates)
			const skillsCount = {
				"3": 0,
				A: 0,
				B: 0,
				Di: 0,
				Dp: 0,
				Po: 0,
				Ps: 0,
				R: 0,
			};

			for (let i = 0; i < this.numPlayersOnCourt; i++) {
				const p = this.playersOnCourt[t][i]!;

				let skills = this.skillsCountCache.get(p);

				if (!skills) {
					// 1 / (1 + e^-(15 * (x - 0.61))) from 0 to 1
					// 0.61 is not always used - keep in sync with skills.js!

					const r = p.compositeRating;
					// Game Sim Fixes: the expanded Di, Dp and R composites have their own skill cutoffs
					const cutoffs =
						this.simFixes && this.expandedRatings
							? SIM_FIX_EXPANDED_SYNERGY_CUTOFFS
							: STOCK_SYNERGY_CUTOFFS;
					skills = {
						"3": helpers.sigmoid(r.shootingThreePointer, 15, 0.59),
						A: helpers.sigmoid(r.athleticism, 15, 0.63),
						B: helpers.sigmoid(r.dribbling, 15, 0.68),
						Di: helpers.sigmoid(r.defenseInterior, 15, cutoffs.Di),
						Dp: helpers.sigmoid(r.defensePerimeter, 15, cutoffs.Dp),
						Po: helpers.sigmoid(r.shootingLowPost, 15, 0.61),
						Ps: helpers.sigmoid(r.passing, 15, 0.63),
						R: helpers.sigmoid(r.rebounding, 15, cutoffs.R),
					};

					this.skillsCountCache.set(p, skills);
				}

				skillsCount["3"] += skills["3"];
				skillsCount.A += skills.A;
				skillsCount.B += skills.B;
				skillsCount.Di += skills.Di;
				skillsCount.Dp += skills.Dp;
				skillsCount.Po += skills.Po;
				skillsCount.Ps += skills.Ps;
				skillsCount.R += skills.R;
			}

			// Base offensive synergy
			this.team[t].synergy.off = 0;
			this.team[t].synergy.off += 5 * helpers.sigmoid(skillsCount["3"], 3, 2); // 5 / (1 + e^-(3 * (x - 2))) from 0 to 5

			this.team[t].synergy.off +=
				3 * helpers.sigmoid(skillsCount.B, 15, 0.75) +
				helpers.sigmoid(skillsCount.B, 5, 1.75); // 3 / (1 + e^-(15 * (x - 0.75))) + 1 / (1 + e^-(5 * (x - 1.75))) from 0 to 5

			this.team[t].synergy.off +=
				3 * helpers.sigmoid(skillsCount.Ps, 15, 0.75) +
				helpers.sigmoid(skillsCount.Ps, 5, 1.75) +
				helpers.sigmoid(skillsCount.Ps, 5, 2.75); // 3 / (1 + e^-(15 * (x - 0.75))) + 1 / (1 + e^-(5 * (x - 1.75))) + 1 / (1 + e^-(5 * (x - 2.75))) from 0 to 5

			this.team[t].synergy.off += helpers.sigmoid(skillsCount.Po, 15, 0.75); // 1 / (1 + e^-(15 * (x - 0.75))) from 0 to 5

			this.team[t].synergy.off +=
				helpers.sigmoid(skillsCount.A, 15, 1.75) +
				helpers.sigmoid(skillsCount.A, 5, 2.75); // 1 / (1 + e^-(15 * (x - 1.75))) + 1 / (1 + e^-(5 * (x - 2.75))) from 0 to 5

			this.team[t].synergy.off /= 17; // Punish teams for not having multiple perimeter skills

			const perimFactor =
				helpers.bound(
					Math.sqrt(1 + skillsCount.B + skillsCount.Ps + skillsCount["3"]) - 1,
					0,
					2,
				) / 2; // Between 0 and 1, representing the perimeter skills

			// Spacing & Shot Creation: the spacing of the five takes over part of the perimeter factor
			if (this.spacingCreation) {
				const spacing = lineupSpacing(this.playersOnCourt[t]);
				this.lineupSpacing[t] = spacing;
				this.team[t].synergy.off *=
					0.5 +
					0.5 *
						((1 - SPACING.synergyShare) * perimFactor +
							SPACING.synergyShare *
								synergySpacingFactor(spacing, this.numPlayersOnCourt));
			} else {
				this.team[t].synergy.off *= 0.5 + 0.5 * perimFactor; // Defensive synergy
			}

			// Player traits: floor spacing (off-ball movement) and screening
			if (this.traitsOn) {
				for (let i = 0; i < this.numPlayersOnCourt; i++) {
					const e = this.playersOnCourt[t][i]!.traitEffects;
					if (e) {
						this.team[t].synergy.off +=
							e.spacingContribution + e.screenContribution;
					}
				}
			}

			this.team[t].synergy.def = 0;
			this.team[t].synergy.def += helpers.sigmoid(skillsCount.Dp, 15, 0.75); // 1 / (1 + e^-(15 * (x - 0.75))) from 0 to 5

			this.team[t].synergy.def += 2 * helpers.sigmoid(skillsCount.Di, 15, 0.75); // 2 / (1 + e^-(15 * (x - 0.75))) from 0 to 5

			this.team[t].synergy.def +=
				helpers.sigmoid(skillsCount.A, 5, 2) +
				helpers.sigmoid(skillsCount.A, 5, 3.25); // 1 / (1 + e^-(5 * (x - 2))) + 1 / (1 + e^-(5 * (x - 3.25))) from 0 to 5

			this.team[t].synergy.def /= 6; // Rebounding synergy

			this.team[t].synergy.reb = 0;
			this.team[t].synergy.reb +=
				helpers.sigmoid(skillsCount.R, 15, 0.75) +
				helpers.sigmoid(skillsCount.R, 5, 1.75); // 1 / (1 + e^-(15 * (x - 0.75))) + 1 / (1 + e^-(5 * (x - 1.75))) from 0 to 5

			this.team[t].synergy.reb /= 4;
		}

		if (this.matchupDefense) {
			this.assignMatchups();
		}
	}

	// Matchup Defense: each defense's assignments for the current lineups, and its average defensive versatility
	assignMatchups() {
		for (const d of teamNums) {
			const o = teamNums[1 - d]!;
			assignMatchups(
				this.playersOnCourt[o],
				this.playersOnCourt[d],
				this.isSwitching(d),
				this.guards[d],
			);
			let versatility = 0;
			for (const p of this.playersOnCourt[d]) {
				versatility += p.traitEffects?.switchDefenseContribution ?? 0;
			}
			this.teamVersatility[d] =
				versatility / Math.max(1, this.playersOnCourt[d].length);
		}
	}

	isSwitching(d: TeamNum) {
		return this.team[d].coachSim?.def === "switch";
	}

	// Matchup Defense: the player guarding offensive player p (undefined if he is not on the court)
	defenderOf(p: PlayerGameSim) {
		const j = this.playersOnCourt[this.o].indexOf(p);
		if (j < 0) {
			return undefined;
		}
		return this.playersOnCourt[this.d][this.guards[this.d][j] ?? j];
	}

	// Matchup Defense: how much better (or worse) the shooter's defender defends this type of shot than his teammates on the court, on the
	// scale of the team's shot defense
	matchupRel(type: ShotType, defender: PlayerGameSim) {
		const rating = (q: PlayerGameSim) => {
			const r = q.compositeRating;
			const value =
				type === "threePointer" || type === "midRange"
					? r.defensePerimeter
					: type === "lowPost"
						? r.defenseInterior
						: 0.5 * (r.defensePerimeter + r.defenseInterior);
			return value * this.fatigue(q.stat.energy);
		};
		const lineup = this.playersOnCourt[this.d];
		let sum = 0;
		for (const q of lineup) {
			sum += rating(q);
		}
		return rating(defender) - sum / lineup.length;
	}

	// Position-aware team composites: the shares of team t's players on the court, cached until the lineup changes
	getPositionalShares(t: TeamNum) {
		const lineup = this.playersOnCourt[t];
		const last = this.positionalSharesLineup[t];
		let same = last.length === lineup.length;
		for (let i = 0; same && i < lineup.length; i++) {
			same = last[i] === lineup[i];
		}
		if (!same) {
			this.positionalSharesCache[t] = positionalShares(lineup);
			this.positionalSharesLineup[t] = [...lineup];
		}
		return this.positionalSharesCache[t];
	}

	/**
	 * Update team composite ratings.
	 *
	 * This should be called once every possession, after this.updatePlayersOnCourt and this.updateSynergy as they influence output, to update the team composite ratings based on the players currently on the court.
	 */
	updateTeamCompositeRatings() {
		const foulLimit = this.getFoulTroubleLimit();

		// Scale composite ratings
		for (const t of teamNums) {
			const oppT = teamNums[1 - t]!;
			const diff = this.team[t].stat.pts - this.team[oppT].stat.pts;

			const perfFactor =
				1 - (this.simFixes ? SIM_FIX_PERF_FACTOR : 0.2) * Math.tanh(diff / 60);

			// Only update ones that are actually used
			let dribbling = 0;
			let passing = 0;
			let rebounding = 0;
			let defense = 0;
			let defensePerimeter = 0;
			let blocking = 0;
			let defenseInterior = 0;
			let offRebounding = 0;
			let defRebounding = 0;
			let ballSecurity = 0;
			let defenseInside = 0;
			let defenseOutside = 0;
			// Position-aware team composites: each player weighted by his share of the job (undefined: plain averages, as before)
			const shares = this.positionalComposites
				? this.getPositionalShares(t)
				: undefined;
			if (shares) {
				const S = POSITIONAL_SCALE;
				const lineup = this.playersOnCourt[t];
				for (let i = 0; i < lineup.length; i++) {
					const p = lineup[i]!;
					const ratings = p.compositeRating;
					const fatigue = this.fatigue(p.stat.energy);
					const pf = p.stat.pf;
					const foulLimitFactor =
						pf === foulLimit ? 0.9 : pf > foulLimit ? 0.75 : 1;
					const base = fatigue * perfFactor;
					const baseD = base * foulLimitFactor;
					const int = shares.interior[i]!;
					const reb = shares.rebound[i]!;
					const per = shares.perimeter[i]!;
					const ball = shares.ball[i]!;

					dribbling += ratings.dribbling * base * ball * S.dribbling;
					passing += ratings.passing * base;
					rebounding += ratings.rebounding * base * reb * S.rebounding;
					defense += ratings.defense * baseD;
					defensePerimeter +=
						ratings.defensePerimeter * baseD * per * S.defensePerimeter;
					blocking += ratings.blocking * baseD * int * S.blocking;
					if (this.expandedRatings) {
						defenseInterior +=
							ratings.defenseInterior * baseD * int * S.defenseInterior;
					} else {
						defenseInside += ratings.defense * baseD * int * S.defenseInside;
						defenseOutside += ratings.defense * baseD * per * S.defenseOutside;
					}
					if (this.expandedRatings2) {
						offRebounding +=
							ratings.offRebounding * base * reb * S.offRebounding;
						defRebounding +=
							ratings.defRebounding * base * reb * S.defRebounding;
						ballSecurity += ratings.ballSecurity * base * ball * S.ballSecurity;
					}
				}
			}
			// Plain averages (the setting off): exactly the old arithmetic
			for (const p of shares ? [] : this.playersOnCourt[t]) {
				const ratings = p.compositeRating;
				const fatigue = this.fatigue(p.stat.energy);
				const pf = p.stat.pf;
				const foulLimitFactor =
					pf === foulLimit ? 0.9 : pf > foulLimit ? 0.75 : 1;

				dribbling += ratings.dribbling * fatigue * perfFactor;
				passing += ratings.passing * fatigue * perfFactor;
				rebounding += ratings.rebounding * fatigue * perfFactor;
				defense += ratings.defense * fatigue * perfFactor * foulLimitFactor;
				defensePerimeter +=
					ratings.defensePerimeter * fatigue * perfFactor * foulLimitFactor;
				blocking += ratings.blocking * fatigue * perfFactor * foulLimitFactor;
				if (this.expandedRatings) {
					defenseInterior +=
						ratings.defenseInterior * fatigue * perfFactor * foulLimitFactor;
				}
				if (this.expandedRatings2) {
					offRebounding += ratings.offRebounding * fatigue * perfFactor;
					defRebounding += ratings.defRebounding * fatigue * perfFactor;
					ballSecurity += ratings.ballSecurity * fatigue * perfFactor;
				}
			}

			const ratings = this.team[t].compositeRating;
			const synergy = this.team[t].synergy;

			ratings.dribbling = dribbling / 5 + this.synergyFactor * synergy.off;
			ratings.passing = passing / 5 + this.synergyFactor * synergy.off;
			ratings.rebounding = rebounding / 5 + this.synergyFactor * synergy.reb;
			ratings.defense = defense / 5 + this.synergyFactor * synergy.def;
			ratings.defensePerimeter =
				defensePerimeter / 5 + this.synergyFactor * synergy.def;
			ratings.blocking = blocking / 5 + this.synergyFactor * synergy.def;
			if (this.expandedRatings) {
				ratings.defenseInterior =
					defenseInterior / 5 + this.synergyFactor * synergy.def;
			} else if (shares) {
				// Position-aware team composites without expanded ratings: shot defense inside and outside (see shotDefense)
				ratings.defenseInside =
					defenseInside / 5 + this.synergyFactor * synergy.def;
				ratings.defenseOutside =
					defenseOutside / 5 + this.synergyFactor * synergy.def;
			}
			if (this.expandedRatings2) {
				ratings.offRebounding =
					offRebounding / 5 + this.synergyFactor * synergy.reb;
				ratings.defRebounding =
					defRebounding / 5 + this.synergyFactor * synergy.reb;
				ratings.ballSecurity =
					ballSecurity / 5 + this.synergyFactor * synergy.off;
			}

			// Player traits: team chemistry (leadership) lifts or lowers every team composite rating a little
			if (this.traitsOn) {
				const bonus = teamChemistryBonus(
					this.playersOnCourt[t].map(
						(p) => p.traitEffects?.chemistryContribution ?? 0,
					),
				);
				if (bonus !== 0) {
					const factor = 1 + bonus;
					ratings.dribbling *= factor;
					ratings.passing *= factor;
					ratings.rebounding *= factor;
					if (this.expandedRatings2) {
						ratings.offRebounding *= factor;
						ratings.defRebounding *= factor;
						ratings.ballSecurity *= factor;
					}
					ratings.defense *= factor;
					ratings.defensePerimeter *= factor;
					ratings.blocking *= factor;
					if (this.expandedRatings) {
						ratings.defenseInterior *= factor;
					}
				}

				// Defensive versatility: switching against a lineup that mixes big and small players
				const switchBonus = teamSwitchDefenseBonus(
					this.playersOnCourt[t].map(
						(p) => p.traitEffects?.switchDefenseContribution ?? 0,
					),
					lineupSizeMismatch(
						this.playersOnCourt[oppT].map((p) => p.traitHgt ?? 50),
					),
				);
				if (switchBonus !== 0) {
					const factor = 1 + switchBonus;
					ratings.defense *= factor;
					ratings.defensePerimeter *= factor;
					ratings.blocking *= factor;
					if (this.expandedRatings) {
						ratings.defenseInterior *= factor;
					}
				}
			}
		}
	}

	/**
	 * Update playing time stats.
	 *
	 * This should be called once every possession, at the end, to record playing time and bench time for players.
	 */
	updatePlayingTime(possessionLength: number) {
		const min = possessionLength / 60;
		for (const t of teamNums) {
			const playersOnCourt = this.playersOnCourt[t];

			// Update minutes (overall, court, and bench)
			for (const p of this.team[t].player) {
				if (playersOnCourt.includes(p)) {
					p.stat.min += min;
					this.team[t].stat.min += min;
					if (this.playByPlay.active && this.playByPlay.live) {
						this.playByPlay.logStat(t, p.id, "min", min);
					}

					p.stat.courtTime += min;

					// This used to be 0.04. Increase more to lower PT
					p.stat.energy +=
						-min *
						this.fatigueFactor *
						(1 - p.compositeRating.endurance) *
						(p.traitEffects?.energyDrainRate ?? 1); // player traits (motor)

					if (p.stat.energy < 0) {
						p.stat.energy = 0;
					}
				} else {
					p.stat.benchTime += min;
					p.stat.energy +=
						min * 0.094 * (p.traitEffects?.energyRecoveryRate ?? 1);

					if (p.stat.energy > 1) {
						p.stat.energy = 1;
					}
				}
			}
		}
	}

	/**
	 * See if any injuries occurred this possession, and handle the consequences.
	 *
	 * This doesn't actually compute the type of injury, it just determines if a player is injured bad enough to miss the rest of the game.
	 */
	injuries() {
		if (this.baseInjuryRate === 0) {
			return false;
		}

		let newInjury = false;
		let baseRate = this.baseInjuryRate;

		// Modulate by pace - since injuries are evaluated per possession, but really probably happen per minute played
		baseRate *= 100 / g.get("pace");

		// Load, Fatigue & Venue: the tired players on the court are the ones at risk (normalized over the ten on the court)
		let tiredNorm = 1;
		if (this.scheduleLoad) {
			let sum = 0;
			let n = 0;
			for (const t of teamNums) {
				for (const p of this.playersOnCourt[t]) {
					sum += tiredInjuryWeight(p.stat.energy);
					n += 1;
				}
			}
			tiredNorm = n / sum;
		}

		for (const t of teamNums) {
			for (const p of this.team[t].player) {
				// Only players on the court can be injured
				if (this.playersOnCourt[t].includes(p)) {
					const injuryRate =
						getInjuryRate(baseRate, p.age, p.injury.gamesRemaining > 0) *
						((p as any).injuryRiskFactor ?? 1) * // injuryDepth setting, see game/injuryDepthTeam.ts
						(p.traitEffects?.injuryRateMultiplier ?? 1) * // player traits (durability)
						((p as any).simInjuryFactor ?? 1) * // Game Sim Fixes: strength and endurance
						((p as any).medicalInjuryFactor ?? 1) * // Front Office Budget: Medical
						// Load, Fatigue & Venue: tired players, 3 games in 4 nights
						(this.scheduleLoad
							? ((p as any).loadInjuryFactor ?? 1) *
								tiredInjuryWeight(p.stat.energy) *
								tiredNorm
							: 1);

					if (Math.random() < injuryRate) {
						p.injured = true;
						p.newInjury = true;
						newInjury = true;
						this.playByPlay.logEvent({
							type: "injury",
							t,
							pid: p.id,
							clock: this.t,
						});
					}
				}
			}
		}

		return newInjury;
	}

	getNumFoulsUntilBonus() {
		const foulsUntilBonus = g.get("foulsUntilBonus");

		// Different cutoff for OT/regulation
		const normal =
			foulsUntilBonus[this.overtimes >= 1 ? 1 : 0] -
			this.foulsThisQuarter[this.d];

		// Also check last 2 minutes limit, when appropriate;
		if (this.t <= 2 * 60) {
			return Math.min(
				normal,
				foulsUntilBonus[2] - this.foulsLastTwoMinutes[this.d],
			);
		}

		// Not in last 2 minutes
		return normal;
	}

	advanceClockSeconds(seconds: number) {
		if (this.t === 0) {
			throw new Error("advanceClockSeconds called with 0 already on the clock");
		}

		// Adjust for pace up until near the end of the period, so we don't make end of game stuff too weird
		let secondsAdjusted;
		if (this.realPoss) {
			// Possession times are already scaled for pace (possessionModel.ts); only extra dead time for a very slow pace setting
			this.shotClock -= seconds;
			secondsAdjusted =
				this.t - seconds * this.gameClockFactor > 40
					? seconds * this.gameClockFactor
					: seconds;
		} else {
			secondsAdjusted =
				this.t - seconds / this.paceFactor > 40
					? seconds / this.paceFactor
					: seconds;
		}

		if (secondsAdjusted > this.t) {
			this.possessionLength += this.t;
			this.t = 0;
		} else {
			this.possessionLength += secondsAdjusted;
			this.t -= secondsAdjusted;
		}
	}

	timeoutAdvancesBall() {
		return (
			this.team[this.o].stat.ptsQtrs.length >= this.numPeriods &&
			this.t <= TIMEOUTS_STOP_CLOCK * 60
		);
	}

	doOutOfBounds(probOffenseRetainsBall: number) {
		this.isClockRunning = false;
		const offenseRetainsBall = Math.random() < probOffenseRetainsBall;
		this.playByPlay.logEvent({
			type: "outOfBounds",
			on: offenseRetainsBall ? "defense" : "offense",
			t: offenseRetainsBall ? this.d : this.o,
			clock: this.t,
		});
		return offenseRetainsBall ? "outOfBoundsDefense" : "outOfBoundsOffense";
	}

	getPossessionOutcome(clockFactor: ClockFactor): PossessionOutcome {
		// If winning at end of game, just run out the clock
		if (clockFactor === "runOutClock") {
			this.advanceClockSeconds(Infinity);
			this.playByPlay.logEvent({
				type: "endOfPeriod",
				t: this.o,
				clock: this.t,
				reason: "runOutClock",
			});
			return "endOfPeriod";
		}

		// End-of-Game Intelligence: a timeout to stop the other team's run
		if (this.smartEndgame) {
			const timeout = this.maybeRunTimeout();
			if (timeout) {
				return timeout;
			}
		}

		const tipInFromOutOfBounds =
			this.t <= TIP_IN_ONLY_LIMIT && this.sideOutOfBounds();
		const lateGamePutBack =
			this.prevPossessionOutcome === "orb" && this.t < 1.5;

		// With not much time on the clock at the end of a quarter, possession might end with the clock running out
		if (this.t <= 6 && !tipInFromOutOfBounds) {
			const noShot = this.noShotBeforeBuzzer(clockFactor, lateGamePutBack);
			if (noShot) {
				return noShot;
			}
		}

		const timeoutAdvancesBall = this.timeoutAdvancesBall();
		const possessionStartsInFrontcourt =
			this.prevPossessionOutcome === "orb" ||
			this.prevPossessionOutcome === "nonShootingFoul" ||
			(this.prevPossessionOutcome === "timeout" && timeoutAdvancesBall);

		if (this.realPoss) {
			return this.getPossessionOutcomeRealistic(
				clockFactor,
				possessionStartsInFrontcourt,
				tipInFromOutOfBounds,
				lateGamePutBack,
			);
		}

		const timeout = this.maybeTimeoutToAdvanceBall(
			possessionStartsInFrontcourt,
			timeoutAdvancesBall,
		);
		if (timeout) {
			return timeout;
		}

		// Simulate backcourt events, only if necessary
		if (!possessionStartsInFrontcourt) {
			// Turnover in backcourt? Actually for possessions starting in backcourt, currently this simulates
			if (this.t > 0.2 && Math.random() < this.probTov()) {
				let dt;
				if (this.t < 8 || clockFactor === "intentionalFoul") {
					dt = uniform(0.1, Math.min(this.t, 5));
				} else {
					dt = uniform(1, 8);
				}
				this.advanceClockSeconds(dt);
				return this.doTov();
			}

			// Offense loses ball out of bounds, but retains possession
			if (Math.random() < 0.01) {
				return this.doOutOfBounds(1);
			}
		}

		// Spacing & Shot Creation: the creator first, then the shooter
		if (this.spacingCreation) {
			this.creator = this.pickPlayer("creation", this.o, this.creationPower());
		}
		const shooter = this.pickShooter(clockFactor);

		// Flagrant foul? (only with the technicalFouls setting, so otherwise no random number is drawn here)
		if (
			this.techFouls &&
			clockFactor !== "intentionalFoul" &&
			this.t > 10 &&
			Math.random() <
				TECHNICAL_FOUL_RATES.flagrantPerPossession *
					g.get("foulRateFactor") *
					this.traitTemperRate(this.d, "flagrant")
		) {
			return this.doFlagrantFoul(shooter);
		}

		// Non-shooting foul?
		if (
			Math.random() < this.probNonShootingFoul() ||
			clockFactor === "intentionalFoul"
		) {
			return this.doNonShootingFoulPossession(shooter, clockFactor);
		}

		// Time to advance ball to frontcourt
		if (!possessionStartsInFrontcourt) {
			const upperLimitMin =
				clockFactor === "catchUp" ? 1 : clockFactor === "maintainLead" ? 4 : 2;
			const min = Math.max(Math.min(this.t - 0.3, upperLimitMin), 0);
			const upperLimitMax =
				clockFactor === "catchUp" ? 4 : clockFactor === "maintainLead" ? 8 : 6;
			const max = Math.max(Math.min(this.t - 0.3, upperLimitMax), 0);
			let dt = uniform(min, max);
			if (this.coachSys) {
				dt = Math.min(dt / this.cs[this.o].pace, max);
			}
			this.advanceClockSeconds(dt);
		}

		// Shot!
		return this.doShot(
			shooter,
			clockFactor,
			possessionStartsInFrontcourt,
			tipInFromOutOfBounds,
			lateGamePutBack,
		);
	}

	// The possession ends with the clock running out before a shot goes up (end of a period), or undefined if a shot can still be tried
	noShotBeforeBuzzer(
		clockFactor: ClockFactor,
		lateGamePutBack: boolean,
	): PossessionOutcome | undefined {
		// When lateGamePutBack is true, more likely to get a shot up
		if (
			this.t <= 0.1 ||
			Math.random() > (this.t / 8) ** (1 / (lateGamePutBack ? 12 : 6))
		) {
			const period = this.team[this.o].stat.ptsQtrs.length;
			const pointDifferential =
				this.team[this.o].stat.pts - this.team[this.d].stat.pts;
			this.advanceClockSeconds(Infinity);
			this.playByPlay.logEvent({
				type: "endOfPeriod",
				t: this.o,
				clock: this.t,
				reason:
					clockFactor === "intentionalFoul"
						? "intentionalFoul"
						: period >= this.numPeriods && pointDifferential > 0
							? "runOutClock"
							: "noShot",
			});
			return "endOfPeriod";
		}
	}

	// Late in the game, a trailing team may call a timeout to advance the ball to the frontcourt
	maybeTimeoutToAdvanceBall(
		possessionStartsInFrontcourt: boolean,
		timeoutAdvancesBall: boolean,
	): PossessionOutcome | undefined {
		if (
			!possessionStartsInFrontcourt &&
			timeoutAdvancesBall &&
			this.t < 120 &&
			this.timeouts[this.o] > 0
		) {
			const pointDifferential =
				this.team[this.o].stat.pts - this.team[this.d].stat.pts;
			let takeTimeout = false;
			const smart = this.smartEndgame;
			if (pointDifferential === 0) {
				if (this.t <= 10) {
					takeTimeout = true;
				}
			} else if (smart && pointDifferential > 0) {
				// End-of-Game Intelligence: ahead by a basket after the other team scored, with the fouls coming: a timeout to advance the
				// ball and put the free throw shooters in (better game managers more often)
				if (
					pointDifferential <= 3 &&
					this.t <= 24 &&
					this.t > 2 &&
					(this.prevPossessionOutcome === "fg" ||
						this.prevPossessionOutcome === "ft") &&
					Math.random() < 0.5 + 0.3 * this.endgameMgmt(this.o)
				) {
					takeTimeout = true;
				}
			} else if (pointDifferential < 0) {
				// If comeback is very unlikely, no point in taking a timeout
				let comebackAttempt = false;
				if (this.t > 60 && pointDifferential >= -21) {
					comebackAttempt = true;
				} else if (this.t > 30 && pointDifferential >= -18) {
					comebackAttempt = true;
				} else if (this.t > 20 && pointDifferential >= -15) {
					comebackAttempt = true;
				} else if (this.t > 10 && pointDifferential >= -12) {
					comebackAttempt = true;
				} else if (this.t > 5 && pointDifferential >= -9) {
					comebackAttempt = true;
				} else if (this.t > 2 && pointDifferential >= -6) {
					comebackAttempt = true;
				} else if (pointDifferential >= -3) {
					comebackAttempt = true;
				}

				if (comebackAttempt) {
					if (this.t < 10) {
						// If time is really low, definitely take a timeout to advance ball
						takeTimeout = true;
					} else if (
						this.t < 25 &&
						(this.isClockRunning || (smart && pointDifferential >= -3))
					) {
						// If time is somewhat low, definitely take a timeout to advance ball
						// (End-of-Game Intelligence: also after a made basket, when a three can tie or win it)
						takeTimeout = true;
					} else if (
						smart &&
						saveLastTimeout(this.timeouts[this.o], pointDifferential, this.t)
					) {
						// End-of-Game Intelligence: within a basket, the last timeout is kept for the final possession
					} else if (this.t < 60 && this.isClockRunning) {
						// If time is a little low, sometimes take a timeout to advance ball
						// (coaching systems: better game managers use them more readily)
						const mgmt = this.coachSys
							? (this.cs[this.o].foulWindow - 27) / 6
							: 0;
						if (
							((this.t - 25) / (60 - 25)) * (1 - 0.3 * mgmt) <
							Math.random()
						) {
							takeTimeout = true;
						}
					}
				}
			}

			if (takeTimeout) {
				this.isClockRunning = false;
				this.timeouts[this.o] -= 1;
				this.logTimeouts();
				if (smart) {
					this.timeoutBreather();
				}
				this.playByPlay.logEvent({
					type: "timeout",
					clock: this.t,
					t: this.o,
					numLeft: this.timeouts[this.o],
					advancesBall: this.timeoutAdvancesBall(),
				});
				return "timeout";
			}
		}
	}

	// A non-shooting foul (or an intentional foul, with that clockFactor). dtNormal, if given, is when an ordinary foul happens
	doNonShootingFoulPossession(
		shooter: PlayerGameSim,
		clockFactor: ClockFactor,
		dtNormal?: () => number,
	): PossessionOutcome {
		let dt;
		if (clockFactor === "intentionalFoul") {
			if (this.t < 8) {
				if (this.t <= 0.2 || (this.t < 1 && Math.random() > this.t)) {
					// Time ran out while trying to foul
					this.advanceClockSeconds(Infinity);
					this.playByPlay.logEvent({
						type: "endOfPeriod",
						t: this.o,
						clock: this.t,
						reason: "intentionalFoul",
					});
					return "endOfPeriod";
				}
				dt = uniform(0.1, Math.min(this.t - 0.2, 4));
			} else {
				dt = uniform(1, 5);
			}
		} else if (dtNormal) {
			dt = dtNormal();
		} else {
			if (this.t < 2) {
				dt = uniform(0, this.t);
			} else {
				dt = uniform(
					1,
					Math.min(this.t, this.shotClockFull - this.possessionLength),
				);
			}
		}
		this.advanceClockSeconds(dt);
		this.isClockRunning = false;

		// In the bonus? Checks offset by 1, because the foul counter won't increment until doPf is called below
		const numFoulsUntilBonus = this.getNumFoulsUntilBonus();
		let inBonus = numFoulsUntilBonus <= 1;

		// One-and-one (oneAndOne setting): before the two-shot bonus, from the oneAndOneFouls-th team foul of the period
		let oneAndOne = false;
		if (
			!inBonus &&
			this.oneAndOneFouls !== undefined &&
			this.overtimes === 0 &&
			this.oneAndOneFouls - this.foulsThisQuarter[this.d] <= 1
		) {
			inBonus = true;
			oneAndOne = true;
		}

		if (this.t <= 0) {
			throw new Error("Clock at 0 for non-shooting foul");
		}

		if (inBonus) {
			this.doPf({ t: this.d, type: "pfBonus", shooter });
		} else {
			this.doPf({ t: this.d, type: "pfNonShooting" });
		}

		if (inBonus) {
			return this.doFt(shooter, 2, oneAndOne);
		}

		return "nonShootingFoul";
	}

	// ---- Realistic possession model (realisticPossessions setting; see possessionModel.ts) ----

	// The "poss" of a play-by-play event: seconds of shot clock used (what the text reads as "late in the shot clock"), or with the shot clock
	// off, or in the old model, seconds since the possession started
	eventPoss() {
		if (this.realPoss && this.t > this.shotClock) {
			return this.shotClockFull - this.shotClock;
		}
		return this.possessionLength;
	}

	// At the start of each segment of a possession: a full 24 on a change of possession, 14 after an offensive rebound (or a missed shot out of
	// bounds off the defense), at least 14 after a defensive foul, unchanged after a timeout or the ball going out off the defense
	resetShotClock() {
		const prev = this.prevPossessionOutcome;
		if (prev === "orb") {
			this.shotClock = this.shotClockOrb;
		} else if (prev === "nonShootingFoul") {
			this.shotClock = Math.max(this.shotClockOrb, this.shotClock);
		} else if (prev === "outOfBoundsDefense") {
			this.shotClock = this.afterShotAttempt
				? this.shotClockOrb
				: Math.max(1, this.shotClock);
		} else if (prev === "timeout") {
			this.shotClock = Math.max(1, this.shotClock);
		} else {
			this.shotClock = this.shotClockFull;
		}
		this.afterShotAttempt = false;
	}

	getClockFactorRealistic() {
		if (this.shouldIntentionalFoulRealistic()) {
			return "intentionalFoul" as const;
		}

		const period = this.team[this.o].stat.ptsQtrs.length;
		const pointDifferential =
			this.team[this.o].stat.pts - this.team[this.d].stat.pts;
		const finalPeriod = period >= this.numPeriods;

		// Run out the clock if winning, once the shot clock can't make them shoot
		if (
			finalPeriod &&
			pointDifferential > 0 &&
			this.t <= this.shotClock + 0.5
		) {
			return "runOutClock" as const;
		}

		// Hold for the last shot, when the shot clock is (about) off
		if (
			this.t <= this.shotClock + 2 &&
			(!finalPeriod || pointDifferential >= 0)
		) {
			return "holdForLastShot" as const;
		}

		if (
			finalPeriod &&
			((this.t <= 3 * 60 && pointDifferential <= -10) ||
				(this.t <= 2 * 60 && pointDifferential <= -5) ||
				(this.t <= 1 * 60 && pointDifferential < 0))
		) {
			return "catchUp" as const;
		}
		if (
			finalPeriod &&
			((this.t <= 3 * 60 && pointDifferential > 10) ||
				(this.t <= 2 * 60 && pointDifferential > 5) ||
				(this.t <= 1 * 60 && pointDifferential > 0))
		) {
			return "maintainLead" as const;
		}

		// 2-for-1: with ~34-50 s left, shoot with ~29-35 s left, early enough to get the ball back for the last shot
		if (this.t >= 34 && this.t <= 50) {
			return "twoForOne" as const;
		}
	}

	// The trailing team (on defense) fouls on purpose late in the game: down 1-2 once the leader could run out the clock (shot clock off), down 3 then too unless time is nearly gone,
	// down 4-6 inside ~35 s (sometimes inside a minute), down 7-12 a bit earlier and only sometimes
	shouldIntentionalFoulRealistic() {
		if (this.team[0].stat.ptsQtrs.length < this.numPeriods || this.t <= 0.3) {
			return false;
		}
		const lead = this.team[this.o].stat.pts - this.team[this.d].stat.pts;
		if (this.smartEndgame && lead === -3 && this.shouldFoulUpThree()) {
			return true;
		}
		if (lead <= 0) {
			return false;
		}
		const shotClockOff = this.t <= this.shotClock;
		let prob = 0;
		if (lead <= 2) {
			prob = shotClockOff ? 1 : 0;
		} else if (lead === 3) {
			// (down 3, most teams play for a stop and a three, but with the leader about to run out the clock, foul)
			prob = shotClockOff && this.t > 10 ? 1 : 0;
		} else if (lead <= 6) {
			// (coaching systems: better game managers start fouling at the right time, worse ones late)
			const w = this.coachSys ? this.cs[this.d].foulWindow / 27 : 1;
			prob = this.t <= 35 * w ? 1 : this.t <= 60 * w ? 0.3 : 0;
		} else if (lead <= 9) {
			prob = this.t <= 60 ? 0.5 : this.t <= 90 ? 0.15 : 0;
		} else if (lead <= 12) {
			prob = this.t <= 40 ? 0.2 : 0;
		}
		return prob >= 1 || (prob > 0 && Math.random() < prob);
	}

	// How likely a late-clock crisis ends in a violation rather than a forced shot: ball handling and the defense's pressure, through the same
	// ratings as the turnover chance (~1 for an average matchup)
	violationTendency() {
		return helpers.bound(
			(this.traits[this.o].shotDiscipline * this.probTov()) / 0.13,
			0.5,
			1.8,
		);
	}

	// When the shot goes up (seconds from now), or that the shot clock runs out first
	planPossession(
		clockFactor: ClockFactor,
		possessionStartsInFrontcourt: boolean,
		tipInFromOutOfBounds: boolean,
		lateGamePutBack: boolean,
	) {
		const sc = this.shotClock;
		const tLeft = this.t;
		if (tipInFromOutOfBounds) {
			return { shotAt: 0, violation: false };
		}
		if (lateGamePutBack) {
			return {
				shotAt: uniform(Math.min(tLeft, 0.1), Math.min(tLeft, 1)) * 0.9,
				violation: false,
			};
		}

		// Faster teams (pace rating) and a faster league (pace setting) take less time
		const k = this.possTimeScale / this.teamPaceFactor[this.o];
		const prev = this.prevPossessionOutcome;

		let shotAt;
		if (
			prev === "nonShootingFoul" ||
			prev === "outOfBoundsDefense" ||
			prev === "timeout"
		) {
			// Inbounding with part of the shot clock used: run a set play with what is left
			shotAt = k * drawRestartSearch(sc, clockFactor === "maintainLead");
		} else if (prev === "orb") {
			shotAt =
				Math.random() < PROB_ORB_QUICK_SHOT
					? drawOrbQuickShot()
					: k *
						Math.max(
							1,
							ORB_RESET_SEARCH_MEAN + ORB_RESET_SEARCH_SD * gaussian(),
						);
		} else {
			let probTransition = possessionStartsInFrontcourt
				? 0
				: (prev === "stl"
						? PROB_TRANSITION.steal
						: prev === "drb"
							? PROB_TRANSITION.drb
							: PROB_TRANSITION.inbound) *
					this.teamPaceFactor[this.o] ** 3;
			if (clockFactor === "maintainLead") {
				probTransition *= 0.3;
			} else if (clockFactor === "catchUp") {
				probTransition *= 1.5;
			}
			if (this.coachSys) {
				probTransition *=
					this.cs[this.o].transition * this.cs[this.d].oppTransition;
			}
			if (Math.random() < probTransition) {
				shotAt = k * drawTransitionTime();
			} else {
				let backcourt = possessionStartsInFrontcourt
					? 0
					: k * drawBackcourtTime();
				let mean = HALF_COURT_SEARCH_MODE;
				if (clockFactor === "catchUp") {
					mean = 5;
					backcourt *= 0.7;
				} else if (clockFactor === "maintainLead") {
					// Milk the shot clock
					mean += 4;
				}
				shotAt =
					backcourt +
					drawHalfCourtSearch(k * mean, this.traits[this.o].consistency);
			}
		}

		// End of a period
		if (
			clockFactor === "holdForLastShot" &&
			tLeft > 1.5 &&
			Math.random() <
				(this.smartEndgame
					? ENDGAME.holdProb + ENDGAME.clockMgmt * this.endgameMgmt(this.o)
					: 0.85)
		) {
			// Hold for the last shot, going with ~1-4 s left
			shotAt = tLeft - uniform(1, Math.min(4.5, tLeft - 0.5));
		} else if (
			clockFactor === "twoForOne" &&
			Math.random() <
				(this.smartEndgame
					? ENDGAME.twoForOneProb + ENDGAME.clockMgmt * this.endgameMgmt(this.o)
					: 0.7)
		) {
			const target = tLeft - uniform(29, 35);
			if (target >= 1.5) {
				shotAt = Math.min(shotAt, target);
			}
		}

		let violation = false;
		if (tLeft <= sc) {
			// Shot clock off: the game clock is the limit, and someone gets a shot up before the buzzer (the chance of not even getting one
			// up is at the start of the possession, noShotBeforeBuzzer)
			if (shotAt > tLeft - 0.3) {
				shotAt = tLeft - uniform(0.1, Math.min(1.5, tLeft * 0.8));
			}
		} else if (shotAt >= sc - 0.3) {
			// Late-clock crisis: no shot found in time. Either a violation or a forced, contested shot just before the horn
			if (Math.random() < PROB_VIOLATION_IN_CRISIS * this.violationTendency()) {
				violation = true;
				shotAt = sc;
			} else {
				shotAt = sc - uniform(0.1, Math.min(1.5, sc * 0.8));
			}
		}

		return { shotAt: Math.max(0, shotAt), violation };
	}

	getPossessionOutcomeRealistic(
		clockFactor: ClockFactor,
		possessionStartsInFrontcourt: boolean,
		tipInFromOutOfBounds: boolean,
		lateGamePutBack: boolean,
	): PossessionOutcome {
		const timeout = this.maybeTimeoutToAdvanceBall(
			possessionStartsInFrontcourt,
			this.timeoutAdvancesBall(),
		);
		if (timeout) {
			return timeout;
		}

		const { shotAt, violation } = this.planPossession(
			clockFactor,
			possessionStartsInFrontcourt,
			tipInFromOutOfBounds,
			lateGamePutBack,
		);
		// Something that happens before the shot (or violation) would have
		const beforeShot = (fraction: number) =>
			Math.max(0, Math.min(fraction * shotAt, this.t - 0.05));

		// Turnover
		if (
			!tipInFromOutOfBounds &&
			this.t > 0.2 &&
			Math.random() < TOV_SCALE * this.probTov()
		) {
			this.advanceClockSeconds(
				clockFactor === "intentionalFoul"
					? uniform(0.1, Math.min(this.t - 0.05, 5))
					: beforeShot(uniform(0.15, 1)),
			);
			return this.doTov();
		}

		// Offense loses ball out of bounds, but retains possession
		if (!tipInFromOutOfBounds && Math.random() < 0.01) {
			this.advanceClockSeconds(beforeShot(uniform(0.1, 0.9)));
			return this.doOutOfBounds(1);
		}

		// Spacing & Shot Creation: the creator first, then the shooter
		if (this.spacingCreation) {
			this.creator = this.pickPlayer("creation", this.o, this.creationPower());
		}
		const shooter = this.pickShooter(clockFactor);

		// Flagrant foul? (only with the technicalFouls setting)
		if (
			this.techFouls &&
			clockFactor !== "intentionalFoul" &&
			this.t > 10 &&
			Math.random() <
				TECHNICAL_FOUL_RATES.flagrantPerPossession *
					g.get("foulRateFactor") *
					this.traitTemperRate(this.d, "flagrant")
		) {
			return this.doFlagrantFoul(shooter);
		}

		// Non-shooting foul, or an intentional foul
		if (
			!tipInFromOutOfBounds &&
			(Math.random() < this.probNonShootingFoul() ||
				clockFactor === "intentionalFoul")
		) {
			return this.doNonShootingFoulPossession(shooter, clockFactor, () =>
				beforeShot(uniform(0.1, 1)),
			);
		}

		if (shotAt > 0) {
			this.advanceClockSeconds(Math.min(shotAt, this.t));
		}

		if (violation) {
			return this.doShotClockViolation();
		}

		if (this.t <= 0) {
			// (should not happen: shots are planned before the buzzer)
			this.playByPlay.logEvent({
				type: "endOfPeriod",
				t: this.o,
				clock: this.t,
				reason: "noShot",
			});
			return "endOfPeriod";
		}

		return this.doShot(
			shooter,
			clockFactor,
			possessionStartsInFrontcourt,
			tipInFromOutOfBounds,
			lateGamePutBack,
			true,
		);
	}

	// The shot clock runs out: a turnover, and the other team inbounds the ball
	doShotClockViolation(): PossessionOutcome {
		const p = this.pickPlayer("turnovers", this.o, 2);
		this.recordStat(this.o, p, "tov");
		this.shotClockViolations[this.o] += 1;
		this.isClockRunning = false;
		this.playByPlay.logEvent({
			type: "tov",
			t: this.o,
			pid: p.id,
			outOfBounds: false,
			clock: this.t,
			poss: this.shotClockFull,
			shotClock: true,
		});
		return "outOfBoundsOffense";
	}

	/**
	 * Probability of the current possession ending in a turnover.
	 *
	 * @return {number} Probability from 0 to 1.
	 */
	// Expanded ratings: a jumper off a pass leans on catch-and-shoot, a self-created one on off-the-dribble shooting. csh and dsh average
	// the player's fg/tp level, so this is plus or minus half their gap
	jumpShotStyleDelta(p: PlayerGameSim, passer: PlayerGameSim | undefined) {
		const gap = p.compositeRating.catchShoot - p.compositeRating.offDribble;
		return (
			EXPANDED_JUMPER_STYLE * (passer !== undefined ? gap : -gap) * 0.5 +
			EXPANDED_JUMPER_OFFSET
		);
	}

	probTov() {
		const o = this.team[this.o].compositeRating;
		const prob = this.expandedRatings2
			? // Expanded ratings: ball security carries most of it, dribbling and passing the rest
				(EXPANDED_TOV_FACTOR *
					g.get("turnoverFactor") *
					(0.14 * this.team[this.d].compositeRating.defense)) /
				((1 - EXPANDED_BSC_SHARE) * 0.5 * (o.dribbling + o.passing) +
					EXPANDED_BSC_SHARE * o.ballSecurity)
			: (g.get("turnoverFactor") *
					(0.14 * this.team[this.d].compositeRating.defense)) /
				(0.5 * (o.dribbling + o.passing));
		let prob2 = this.coachSys
			? prob * this.cs[this.o].tov * this.cs[this.d].forceTov
			: prob;
		if (this.realisticTurnovers) {
			prob2 *= TURNOVERS.tovMult;
		}
		return boundProb(
			this.traitsOn ? prob2 * this.traitTurnoverMult(this.o) : prob2,
		);
	}

	/**
	 * Turnover.
	 *
	 * @return {string} Either "tov" or "stl" depending on whether the turnover was caused by a steal or not.
	 */
	doTov(pOverride?: PlayerGameSim) {
		const p = pOverride ?? this.pickPlayer("turnovers", this.o, 2);
		this.recordStat(this.o, p, "tov");

		if (this.probStl() > Math.random()) {
			return this.doStl(p);
		}

		// Credited to his matchup (same slot on the court), so no random draw is needed
		// (Matchup Defense: his actual defender)
		const ind = this.playersOnCourt[this.o].indexOf(p);
		const matchup = this.matchupDefense
			? (this.defenderOf(p) ?? this.playersOnCourt[this.d][0])
			: this.playersOnCourt[this.d][ind >= 0 ? ind : 0];
		if (matchup) {
			this.noteDefensiveStop("tov", matchup, p);
		}

		// Ball could go out of bounds on the turnover
		const outOfBounds = Math.random() < 0.3;
		if (outOfBounds) {
			this.isClockRunning = false;
		}

		this.playByPlay.logEvent({
			type: "tov",
			t: this.o,
			pid: p.id,
			outOfBounds,
			clock: this.t,
			poss: this.eventPoss(),
			// (the play-by-play text would otherwise guess from a long possession that this was a shot-clock violation)
			shotClock:
				this.realPoss && this.eventPoss() >= this.shotClockFull - 7
					? false
					: undefined,
		});
		return outOfBounds ? "outOfBoundsOffense" : ("tov" as const);
	}

	/**
	 * Probability that a turnover occurring in this possession is a steal.
	 *
	 * @return {number} Probability from 0 to 1.
	 */
	probStl() {
		const prob =
			g.get("stealFactor") *
			((0.45 * this.team[this.d].compositeRating.defensePerimeter) /
				(0.5 *
					(this.team[this.o].compositeRating.dribbling +
						this.team[this.o].compositeRating.passing)));
		let prob2 = this.expandedRatings ? prob * EXPANDED_STL_FACTOR : prob;
		if (this.coachSys) {
			prob2 *= this.cs[this.d].stl;
		}
		if (this.realisticTurnovers) {
			prob2 *= TURNOVERS.stlMult;
		}
		return boundProb(
			this.traitsOn
				? prob2 * this.traitMean(this.d, (e) => e.gambleStealMultiplier, 1)
				: prob2,
		);
	}

	/**
	 * Steal.
	 *
	 * @return {string} Currently always returns "stl".
	 */
	doStl(pStoleFrom: PlayerGameSim) {
		// Ball could go out of bounds on the steal
		const outOfBounds = Math.random() < 0.1;
		if (outOfBounds) {
			this.isClockRunning = false;
		}

		const p = this.pickPlayer("stealing", this.d, 4);
		this.recordStat(this.d, p, "stl");
		this.noteDefensiveStop("stl", p, pStoleFrom);
		this.playByPlay.logEvent({
			type: "stl",
			t: this.d,
			pid: p.id,
			pidTov: pStoleFrom.id,
			outOfBounds,
			clock: this.t,
			poss: this.eventPoss(),
		});
		return outOfBounds ? "outOfBoundsOffense" : ("stl" as const);
	}

	sideOutOfBounds() {
		return (
			this.prevPossessionOutcome === "nonShootingFoul" ||
			(this.prevPossessionOutcome === "timeout" &&
				this.timeoutAdvancesBall()) ||
			this.prevPossessionOutcome === "outOfBoundsDefense" ||
			this.prevPossessionOutcome === "outOfBoundsOffense"
		);
	}

	getShotInfo({
		currentFatigue,
		lateGamePutBack,
		p,
		passer,
		tipInFromOutOfBounds,
		putBack,
		deferAssist = false,
	}: {
		currentFatigue: number;
		lateGamePutBack: boolean;
		p: PlayerGameSim;
		passer: PlayerGameSim | undefined;
		tipInFromOutOfBounds: boolean;
		putBack: boolean;
		// Spacing & Shot Creation: decide whether the shot is assisted (and by whom) once its type is known
		deferAssist?: boolean;
	}) {
		// Spacing & Shot Creation: is the shooter his own creator, and the spacing around him
		const sc = this.spacingCreation;
		const selfCreated =
			sc && (this.creator === undefined || this.creator === p);
		const spacing = sc
			? spacingAround(
					this.lineupSpacing[this.o],
					p.compositeRating.spacingThreat ?? 0,
					this.numPlayersOnCourt - 1,
				)
			: 0;
		// Matchup Defense: his defender, and the size and speed mismatches (relieved by switching and versatility)
		const md = this.matchupDefense;
		let defender: PlayerGameSim | undefined;
		let mismatchRelief = 1;
		let postTilt = 1;
		let driveTilt = 1;
		let pullUpTilt = 1;
		if (md) {
			defender = this.defenderOf(p);
			if (defender) {
				mismatchRelief = mismatchScale(
					defender,
					this.isSwitching(this.d),
					this.teamVersatility[this.d],
				);
				const post = mismatchRelief * postMismatch(p, defender);
				const drive = mismatchRelief * driveMismatch(p, defender);
				// (divided by the league average, so the league shot mix stays the same)
				postTilt = (1 + post) / MATCHUP.postNorm;
				driveTilt = (1 + drive) / MATCHUP.driveNorm;
				this.lastMatchup.post = post;
				this.lastMatchup.drive = drive;
			}
			if (
				this.team[this.d].coachSim?.def === "drop" &&
				(sc ? selfCreated : passer === undefined)
			) {
				pullUpTilt = MATCHUP.dropPullUpSelect;
			}
		}

		let shootingThreePointerScaled = p.compositeRating.shootingThreePointer;

		// Too many players shooting 3s at the high end - scale 0.55-1.0 to 0.55-0.85
		if (shootingThreePointerScaled > 0.55) {
			shootingThreePointerScaled =
				0.55 + (shootingThreePointerScaled - 0.55) * (0.3 / 0.45);
		}

		// Too many players shooting 3s at the low end - scale 0.35-0.45 to 0.1-0.45, and 0-0.35 to 0-0.1
		let shootingThreePointerScaled2 = shootingThreePointerScaled;
		if (shootingThreePointerScaled2 < 0.35) {
			shootingThreePointerScaled2 =
				0 + shootingThreePointerScaled2 * (0.1 / 0.35);
		} else if (shootingThreePointerScaled2 < 0.45) {
			shootingThreePointerScaled2 =
				0.1 + (shootingThreePointerScaled2 - 0.35) * (0.35 / 0.1);
		}

		// In some situations (4th quarter late game situations depending on score, and last second heaves in other quarters) players shoot more 3s
		const diff = this.team[this.d].stat.pts - this.team[this.o].stat.pts;
		const quarter = this.team[this.o].stat.ptsQtrs.length;
		const forceThreePointer =
			(diff >= 3 &&
				diff <= 10 &&
				this.t <= 10 &&
				quarter >= this.numPeriods &&
				Math.random() > this.t / 60) ||
			(quarter < this.numPeriods &&
				this.t < 2 &&
				this.possessionLength <= 3 &&
				!this.sideOutOfBounds());

		const rushed = this.t < 2 && this.possessionLength < 6;

		if (this.t <= 0) {
			throw new Error("Clock at 0 when a shot is taken");
		}

		// Pick the type of shot and store the success rate (with no defense) in probMake and the probability of an and one in probAndOne
		let probAndOne;
		let probMake;
		let probMissAndFoul;
		let type: ShotType;
		let fgaLogType: FgaType | "fgaTpFake" | "fgaTp" | "fgaTipIn";
		if (tipInFromOutOfBounds && passer !== undefined) {
			fgaLogType = "fgaTipIn";
			type = "tipIn";
			probMissAndFoul = 0.02;
			probMake = 0.1 + p.compositeRating.shootingAtRim * 0.1;
			probAndOne = 0.01;
		} else if (putBack) {
			type = "putBack";
			fgaLogType = "fgaPutBack";
			probMissAndFoul = 0.37;
			probMake = p.compositeRating.shootingAtRim * 0.41 + 0.54;
			probAndOne = 0.25;

			if (lateGamePutBack) {
				probMissAndFoul *= 0.75;
				probMake *= 0.75;
				probAndOne *= 0.75;
			}
		} else if (
			forceThreePointer ||
			Math.random() <
				0.67 *
					shootingThreePointerScaled2 *
					g.get("threePointTendencyFactor") *
					(this.coachSys ? this.cs[this.o].three * this.cs[this.d].dThree : 1) *
					(sc ? (selfCreated ? CREATION.selfThree : CREATION.otherThree) : 1)
		) {
			// Three pointer
			type = "threePointer";
			if (deferAssist) {
				passer = this.drawAssist(p, type, selfCreated);
			}
			fgaLogType = g.get("threePointers") ? "fgaTp" : "fgaTpFake";
			probMissAndFoul = 0.02;
			probMake = shootingThreePointerScaled * 0.3 + 0.36;
			probAndOne = 0.01;
			if (this.expandedRatings2) {
				probMake += this.jumpShotStyleDelta(p, passer);
			}

			// Better shooting in the ASG, why not?
			if (this.allStarGame) {
				probMake += 0.02;
			}
			probMake *= g.get("threePointAccuracyFactor");
		} else {
			// Game Sim Fixes: the shot selection has its own composites (see simSettings.ts)
			const cso = this.cs[this.o];
			const csd = this.cs[this.d];
			const r1 =
				(this.coachSys ? cso.mid * csd.dMid : 1) *
				pullUpTilt *
				0.8 *
				Math.random() *
				(this.simFixes
					? (p.compositeRating.shootingMidRangeSelect ??
						p.compositeRating.shootingMidRange)
					: p.compositeRating.shootingMidRange);
			const r2 =
				(this.coachSys ? cso.rim * csd.dRim : 1) *
				(sc
					? (selfCreated ? CREATION.selfRim : 1) *
						Math.max(0.2, 1 + SPACING.selectRim * spacing)
					: 1) *
				driveTilt *
				Math.random() *
				(p.compositeRating.shootingAtRim +
					this.synergyFactor *
						(this.team[this.o].synergy.off - this.team[this.d].synergy.def)); // Synergy makes easy shots either more likely or less likely

			const r3 =
				(this.coachSys ? cso.post * csd.dPost : 1) *
				postTilt *
				Math.random() *
				((this.simFixes
					? (p.compositeRating.shootingLowPostSelect ??
						p.compositeRating.shootingLowPost)
					: p.compositeRating.shootingLowPost) +
					this.synergyFactor *
						(this.team[this.o].synergy.off - this.team[this.d].synergy.def)); // Synergy makes easy shots either more likely or less likely

			if (deferAssist) {
				passer = this.drawAssist(
					p,
					r1 > r2 && r1 > r3 ? "midRange" : r2 > r3 ? "atRim" : "lowPost",
					selfCreated,
				);
			}
			if (r1 > r2 && r1 > r3) {
				// Two point jumper
				type = "midRange";
				fgaLogType = "fgaMidRange";
				probMissAndFoul = 0.07;
				// Game Sim Fixes: offensive IQ only steers the shot selection above, the make is fg and strength
				probMake = this.simFixes
					? SIM_FIX_MID_RANGE.intercept +
						SIM_FIX_MID_RANGE.slope *
							(p.compositeRating.shootingMidRangeMake ??
								p.compositeRating.shootingMidRange)
					: p.compositeRating.shootingMidRange * 0.32 + 0.42;
				probAndOne = 0.05;
				if (this.expandedRatings2) {
					probMake += this.jumpShotStyleDelta(p, passer);
				}
			} else if (r2 > r3) {
				// Dunk, fast break or half court
				type = "atRim";
				fgaLogType = "fgaAtRim";
				probMissAndFoul = 0.37;
				probMake = p.compositeRating.shootingAtRim * 0.41 + 0.54;
				probAndOne = 0.25;
			} else {
				// Post up
				fgaLogType = "fgaLowPost";
				type = "lowPost";
				probMissAndFoul = 0.33;
				// Game Sim Fixes: the make leans more on inside scoring
				probMake = this.simFixes
					? SIM_FIX_LOW_POST.intercept +
						SIM_FIX_LOW_POST.slope *
							(p.compositeRating.shootingLowPostMake ??
								p.compositeRating.shootingLowPost)
					: p.compositeRating.shootingLowPost * 0.32 + 0.34;
				probAndOne = 0.15;
			}
			// Better shooting in the ASG, why not?
			if (this.allStarGame) {
				probMake += 0.1;
			}

			probMake *= g.get("twoPointAccuracyFactor");
		}

		let blocked;
		if (
			(this.expandedRatings ? this.probBlkExpanded(p, type) : this.probBlk()) >
			Math.random()
		) {
			blocked = true;
		} else {
			blocked = false;

			let foulFactor =
				0.65 *
				(p.compositeRating.drawingFouls / 0.5) ** 2 *
				g.get("foulRateFactor");

			if (this.allStarGame) {
				foulFactor *= 0.4;
			}

			// Player traits: a defense of foul-prone players fouls more shooters
			if (this.traitsOn) {
				foulFactor *= this.traitMean(this.d, (e) => e.foulProneness, 1);
			}

			if (this.coachSys) {
				foulFactor *= this.cs[this.d].foul;
			}

			// Load, Fatigue & Venue: the referees
			if (this.scheduleLoad) {
				foulFactor *= this.foulMult[this.d];
			}

			probMissAndFoul *= foulFactor;
			probAndOne *= foulFactor;
			const teamDefense = this.expandedRatings
				? this.shotDefenseExpanded(type)
				: this.positionalComposites
					? this.shotDefensePositional(type)
					: this.team[this.d].compositeRating.defense;
			// Matchup Defense: partly his defender (a weak one gets attacked), partly the team (help defense)
			let matchupDelta = 0;
			if (md && defender) {
				const rel = this.matchupRel(type, defender);
				matchupDelta =
					MATCHUP.share *
					((rel < 0 ? rel * mismatchRelief : rel) -
						(type === "threePointer"
							? MATCHUP.centerThree
							: type === "midRange"
								? MATCHUP.centerMid
								: type === "lowPost"
									? MATCHUP.centerPost
									: MATCHUP.centerRim));
				this.lastMatchup.delta = matchupDelta;
				this.lastMatchup.fitRel = rel;
			}
			probMake =
				(probMake -
					0.25 * (md ? teamDefense + matchupDelta : teamDefense) +
					this.synergyFactor *
						(this.team[this.o].synergy.off - this.team[this.d].synergy.def)) *
				currentFatigue;

			if (this.coachSys) {
				probMake += this.coachMakeDelta();
			}

			// End-of-Game Intelligence: a play drawn up in a late timeout, better from a good game manager
			if (
				this.smartEndgame &&
				this.coachSys &&
				this.prevPossessionOutcome === "timeout" &&
				this.t <= ENDGAME.atoSeconds &&
				this.team[0].stat.ptsQtrs.length >= this.numPeriods
			) {
				probMake += ENDGAME.atoMake * this.endgameMgmt(this.o);
			}

			// Matchup Defense: drop coverage gives up pull-up jumpers
			if (
				md &&
				type === "midRange" &&
				passer === undefined &&
				this.team[this.d].coachSim?.def === "drop"
			) {
				probMake += MATCHUP.dropPullUpMake;
			}

			// Spacing & Shot Creation: room to drive and post up
			if (sc) {
				if (type === "atRim") {
					probMake += SPACING.makeRim * (spacing - SPACING.makeCenter);
				} else if (type === "lowPost") {
					probMake += SPACING.makePost * (spacing - SPACING.makeCenter);
				}
			}

			if (!tipInFromOutOfBounds) {
				// Adjust probMake for end of quarter situations, where shot quality will be lower without much time
				if (rushed) {
					probMake *= Math.sqrt(this.possessionLength / 8);
				}

				// Assisted shots are easier (Spacing & Shot Creation: more so from better passers)
				if (passer !== undefined) {
					probMake += sc
						? (CREATION.bonus * passer.compositeRating.passing) /
							CREATION.bonusPassingRef
						: 0.025;
				}

				// Early-clock shots are better, late-clock shots are contested (only while the shot clock is on)
				if (this.realPoss && !putBack && this.t > this.shotClock) {
					probMake *= shotClockMakeFactor(this.shotClock, this.shotClockFull);
				}

				// Player traits: his game form, shot selection (gunners vs disciplined shooters), clutch and screens. Clamped, since the
				// deltas can push a probability out of range
				if (this.traitsOn && p.traitEffects) {
					probMake = helpers.bound(
						probMake + this.traitShotDelta(p, passer, type),
						0,
						1,
					);
				}
			}
		}

		return {
			blocked,
			passer,
			desperation: forceThreePointer || rushed,
			fgaLogType,
			probAndOne,
			probMake,
			probMissAndFoul,
			type,
		};
	}

	doShot(
		p: PlayerGameSim,
		clockFactor: ClockFactor,
		possessionStartsInFrontcourt: boolean,
		tipInFromOutOfBounds: boolean,
		lateGamePutBack: boolean,
		// The realistic possession model already ran the clock to the shot, and handled turnovers
		preTimed: boolean = false,
	) {
		const putBack = lateGamePutBack; // Eventually use this in more situations

		// If it's a putback, override shooter selection with whoever got the last offensive rebound
		if (putBack && this.lastOrbPlayer !== undefined) {
			p = this.lastOrbPlayer;
		}

		const currentFatigue = this.fatigue(p.stat.energy, false, true);

		// Is this an "assisted" attempt (i.e. an assist will be recorded if it's made)
		let passer: PlayerGameSim | undefined;
		// Spacing & Shot Creation: decided once the type of shot is known (getShotInfo), except for a tip-in off an inbound
		let deferAssist = false;
		if (this.spacingCreation) {
			if (!putBack && this.numPlayersOnCourt > 1) {
				if (tipInFromOutOfBounds) {
					passer = this.creatorPasser(p);
				} else {
					deferAssist = this.t > 1;
				}
			}
		} else if (
			(tipInFromOutOfBounds ||
				(this.t > 1 && this.probAst() > Math.random())) &&
			!putBack &&
			this.numPlayersOnCourt > 1
		) {
			passer = this.pickPlayer("passing", this.o, 10, p);
		}

		// Ball is already in frontcourt. How long until the shot goes up?
		let lowerLimit = Math.min(this.t / 2, 2);
		let upperLimit = Math.min(
			this.shotClockFull - this.possessionLength,
			this.t - 0.1,
		);
		if (upperLimit < 0) {
			lowerLimit = 0;
			upperLimit = 0;
		}

		// Time from the ball being in the frontcourt to a shot
		let dt;
		if (preTimed || tipInFromOutOfBounds) {
			dt = 0;
		} else if (putBack) {
			dt = uniform(Math.min(this.t, 0.1), Math.min(this.t, 1));
		} else if (this.t <= 0.3) {
			dt = uniform(0, upperLimit);
		} else if (this.t < 1) {
			// Less than 1 second left
			dt = uniform(0.2, upperLimit);
		} else if (lowerLimit > upperLimit) {
			// Less than 2 seconds left
			dt = uniform(0.5, upperLimit);
		} else if (upperLimit - lowerLimit < 4) {
			// Due to being near the end of the quarter, upperLimit and lowerLimit are close
			dt = uniform(lowerLimit, upperLimit);
		} else {
			const mean =
				clockFactor === "catchUp"
					? 5
					: clockFactor === "maintainLead"
						? 12
						: 6.25;

			dt = truncGauss(
				this.coachSys ? mean / this.cs[this.o].pace : mean,
				5,
				lowerLimit,
				upperLimit,
			);
		}
		// End-of-Game Intelligence: 2-for-1s in the stock possession model
		if (
			this.smartEndgame &&
			!preTimed &&
			!tipInFromOutOfBounds &&
			!putBack &&
			clockFactor === "twoForOne"
		) {
			dt = this.endgameShotTime(dt);
		}
		this.advanceClockSeconds(dt);

		// Turnovers for possessions that start in the frontcourt only (other turnovers are already handled above for the entire possession, although I guess it'd be better to do it here)
		if (possessionStartsInFrontcourt && !preTimed) {
			if (Math.random() < this.probTov()) {
				let pTurnover;
				if (tipInFromOutOfBounds) {
					pTurnover = passer;
				} else if (putBack) {
					pTurnover = p;
				}
				return this.doTov(pTurnover);
			}

			// Offense loses ball out of bounds, but retains possession
			if (Math.random() < 0.01) {
				return this.doOutOfBounds(1);
			}
		}

		const shotInfo = this.getShotInfo({
			currentFatigue,
			lateGamePutBack,
			p,
			passer,
			tipInFromOutOfBounds,
			putBack,
			deferAssist,
		});
		const {
			blocked,
			desperation,
			fgaLogType,
			probAndOne,
			probMake,
			probMissAndFoul,
			type,
		} = shotInfo;
		passer = shotInfo.passer;

		const baseLogInformation = {
			t: this.o,
			pid: p.id,
			clock: this.t,
			poss: this.eventPoss(),
		};
		if (
			fgaLogType === "fgaLowPost" ||
			fgaLogType === "fgaMidRange" ||
			fgaLogType === "fgaAtRim"
		) {
			this.playByPlay.logEvent({
				...baseLogInformation,
				type: fgaLogType,
			});
		} else if (fgaLogType === "fgaTp" || fgaLogType === "fgaTpFake") {
			this.playByPlay.logEvent({
				...baseLogInformation,
				type: fgaLogType,
				desperation,
			});
		} else if (fgaLogType === "fgaTipIn" && passer !== undefined) {
			this.playByPlay.logEvent({
				...baseLogInformation,
				type: fgaLogType,
				pidPass: passer.id,
			});
		}
		if (blocked) {
			return this.doBlk(p, type); // orb or drb
		}

		const advanceClock = () => {
			if (!this.isClockRunning) {
				// Time between shot and foul being called, rarely
				if (Math.random() < 0.1) {
					this.advanceClockSeconds(uniform(0, 0.2));
				}
				return;
			}

			// Time between the shot being released and the shot being decided (either make or miss, not including time to rebound)
			this.advanceClockSeconds(
				uniform(
					...((type === "atRim" || type === "tipIn" || type === "putBack"
						? [0.2, 0.5]
						: type === "lowPost"
							? [0.7, 1.1]
							: type === "midRange"
								? [0.9, 1.3]
								: [1.2, 1.9]) as [number, number]),
				),
			);
		};

		// Make
		if (probMake > Math.random()) {
			const andOne = probAndOne > Math.random();
			if (andOne) {
				this.isClockRunning = false;
			}
			advanceClock();
			return this.doFg(p, passer, type, andOne);
		}

		// Miss, but fouled
		if (probMissAndFoul > Math.random()) {
			this.isClockRunning = false;
			advanceClock();
			const threePointer = type === "threePointer" && g.get("threePointers");

			this.doPf({
				t: this.d,
				type: threePointer ? "pfTP" : "pfFG",
				shooter: p,
			});

			if (threePointer) {
				return this.doFt(p, 3);
			}

			return this.doFt(p, 2);
		}

		// Miss
		advanceClock();
		this.recordStat(this.o, p, "fga");
		let fgMissLogType: FgMissType | undefined;
		if (type === "tipIn") {
			this.recordStat(this.o, p, "fgaAtRim");
			fgMissLogType = "missTipIn";
		} else if (type === "putBack") {
			this.recordStat(this.o, p, "fgaAtRim");
			fgMissLogType = "missPutBack";
		} else if (type === "atRim") {
			this.recordStat(this.o, p, "fgaAtRim");
			fgMissLogType = "missAtRim";
		} else if (type === "lowPost") {
			this.recordStat(this.o, p, "fgaLowPost");
			fgMissLogType = "missLowPost";
		} else if (type === "midRange") {
			this.recordStat(this.o, p, "fgaMidRange");
			fgMissLogType = "missMidRange";
		} else if (type === "threePointer") {
			this.recordStat(this.o, p, "tpa");
			fgMissLogType = "missTp";
		} else {
			throw new Error(`Should never happen ${fgMissLogType}`);
		}

		this.playByPlay.logEvent({
			type: fgMissLogType,
			t: this.o,
			pid: p.id,
			clock: this.t,
		});

		return this.doReb();
	}

	/**
	 * Probability that a shot taken this possession is blocked.
	 *
	 * @return {number} Probability from 0 to 1.
	 */
	probBlk() {
		return (
			g.get("blockFactor") *
			0.2 *
			this.team[this.d].compositeRating.blocking ** 2
		);
	}

	// Expanded ratings: block probability. Shots at the rim and in the post are blocked more by long, interior defenses (the blocking
	// composite reads wingspan and interior defense) and less when the shooter is long himself (finishing over defenders); jump shots
	// a little less. Calibrated so league blocks stay the same (docs/native-features.md, Expanded ratings).
	probBlkExpanded(p: PlayerGameSim, type: ShotType) {
		let factor = EXPANDED_BLK_FACTOR;
		if (
			type === "atRim" ||
			type === "lowPost" ||
			type === "putBack" ||
			type === "tipIn"
		) {
			factor *= helpers.bound(
				1 -
					EXPANDED_FINISH_OVER *
						(p.compositeRating.length - EXPANDED_LENGTH_REF),
				0.7,
				1.3,
			);
		} else {
			factor *= EXPANDED_BLK_JUMPER_FACTOR;
		}
		return this.probBlk() * factor;
	}

	// Expanded ratings: the defense a shot faces. Shots at the rim and in the post are contested by the interior defense, jump shots by
	// the perimeter defense, each mixed with the overall team defense (calibrated to the same league average as the stock "defense")
	// Position-aware team composites without expanded ratings: shots inside are defended more by the bigs, jumpers by the smaller
	// players (half the plain team defense, half the weighted one, like shotDefenseExpanded)
	shotDefensePositional(type: ShotType) {
		const ratings = this.team[this.d].compositeRating;
		if (
			type === "atRim" ||
			type === "lowPost" ||
			type === "putBack" ||
			type === "tipIn"
		) {
			return 0.5 * ratings.defense + 0.5 * ratings.defenseInside;
		}
		return 0.5 * ratings.defense + 0.5 * ratings.defenseOutside;
	}

	shotDefenseExpanded(type: ShotType) {
		const ratings = this.team[this.d].compositeRating;
		if (
			type === "atRim" ||
			type === "lowPost" ||
			type === "putBack" ||
			type === "tipIn"
		) {
			return (
				0.5 * ratings.defense +
				0.5 * ratings.defenseInterior +
				EXPANDED_INTERIOR_OFFSET
			);
		}
		return (
			0.5 * ratings.defense +
			0.5 * ratings.defensePerimeter +
			EXPANDED_PERIMETER_OFFSET
		);
	}

	/**
	 * Blocked shot.
	 *
	 * @param {number} shooter Integer from 0 to 4 representing the index of this.playersOnCourt[this.o] for the shooting player.
	 * @return {string} Output of this.doReb.
	 */
	doBlk(p: PlayerGameSim, type: ShotType) {
		this.recordStat(this.o, p, "ba");
		this.recordStat(this.o, p, "fga");

		if (type === "atRim" || type === "tipIn" || type === "putBack") {
			this.recordStat(this.o, p, "fgaAtRim");
		} else if (type === "lowPost") {
			this.recordStat(this.o, p, "fgaLowPost");
		} else if (type === "midRange") {
			this.recordStat(this.o, p, "fgaMidRange");
		} else if (type === "threePointer") {
			this.recordStat(this.o, p, "tpa");
		}

		const p2 = this.pickPlayer("blocking", this.d, 10);
		this.recordStat(this.d, p2, "blk");
		this.noteDefensiveStop("blk", p2, p, type);
		let blockLogType: BlockType | undefined;
		if (type === "tipIn") {
			blockLogType = "blkTipIn";
		} else if (type === "putBack") {
			blockLogType = "blkPutBack";
		} else if (type === "lowPost") {
			blockLogType = "blkLowPost";
		} else if (type === "midRange") {
			blockLogType = "blkMidRange";
		} else if (type === "threePointer") {
			blockLogType = "blkTp";
		} else if (type === "atRim") {
			blockLogType = "blkAtRim";
		} else {
			throw new Error(`Should never happen ${type}`);
		}
		this.playByPlay.logEvent({
			type: blockLogType,
			t: this.d,
			pid: p2.id,
			clock: this.t,
		});
		return this.doReb();
	}

	/**
	 * Field goal.
	 *
	 * Simulate a successful made field goal.
	 *
	 * @param {number} shooter Integer from 0 to 4 representing the index of this.playersOnCourt[this.o] for the shooting player.
	 * @param {number} shooter Integer from 0 to 4 representing the index of this.playersOnCourt[this.o] for the passing player, who will get an assist. -1 if no assist.
	 * @param {number} type 2 for a two pointer, 3 for a three pointer.
	 * @return {string} fg, orb, or drb (latter two are for and ones)
	 */
	doFg(
		p: PlayerGameSim,
		passer: PlayerGameSim | undefined,
		type: ShotType,
		andOne: boolean = false,
	) {
		const pid = p.id;
		this.recordStat(this.o, p, "fga");
		this.recordStat(this.o, p, "fg");
		this.recordStat(this.o, p, "pts", 2); // 2 points for 2's

		let fouler;
		if (andOne) {
			fouler = this.pickPlayer("fouling", this.d, 1);
		}

		let fgMakeLogType: FgMakeType | undefined;
		if (type === "tipIn") {
			this.recordStat(this.o, p, "fgaAtRim");
			this.recordStat(this.o, p, "fgAtRim");
			fgMakeLogType = andOne ? "fgTipInAndOne" : "fgTipIn";
		} else if (type === "putBack") {
			this.recordStat(this.o, p, "fgaAtRim");
			this.recordStat(this.o, p, "fgAtRim");
			fgMakeLogType = andOne ? "fgPutBackAndOne" : "fgPutBack";
		} else if (type === "atRim") {
			this.recordStat(this.o, p, "fgaAtRim");
			this.recordStat(this.o, p, "fgAtRim");
			fgMakeLogType = andOne ? "fgAtRimAndOne" : "fgAtRim";
		} else if (type === "lowPost") {
			this.recordStat(this.o, p, "fgaLowPost");
			this.recordStat(this.o, p, "fgLowPost");
			fgMakeLogType = andOne ? "fgLowPostAndOne" : "fgLowPost";
		} else if (type === "midRange") {
			this.recordStat(this.o, p, "fgaMidRange");
			this.recordStat(this.o, p, "fgMidRange");
			fgMakeLogType = andOne ? "fgMidRangeAndOne" : "fgMidRange";
		} else if (type === "threePointer") {
			if (g.get("threePointers")) {
				this.recordStat(this.o, p, "pts"); // Extra point for 3's
			}
			this.recordStat(this.o, p, "tpa");
			this.recordStat(this.o, p, "tp");
			fgMakeLogType = andOne ? "tpAndOne" : "tp";
		} else {
			throw new Error(`Should never happen ${type}`);
		}
		if (passer !== undefined) {
			this.recordStat(this.o, passer, "ast");
		}

		const baseLogInformation = {
			t: this.o,
			pid,
			clock: this.t,
			pidFoul: fouler?.id,
		};
		let defender: PlayerGameSim | undefined = fouler;

		// assign correct log events
		if (fgMakeLogType === "fgPutBackAndOne" || fgMakeLogType === "fgPutBack") {
			this.playByPlay.logEvent({
				...baseLogInformation,
				type: fgMakeLogType,
			});
		} else if (
			fgMakeLogType === "fgAtRimAndOne" ||
			fgMakeLogType === "fgAtRim"
		) {
			// Randomly pick a name to be dunked on
			const pDefense = fouler ?? this.pickPlayer("blocking", this.d, 5);
			defender = pDefense;
			const pidDefense = pDefense.id;

			this.playByPlay.logEvent({
				...baseLogInformation,
				type: fgMakeLogType,
				pidDefense,
				pidAst: passer?.id,
			});
		} else {
			this.playByPlay.logEvent({
				...baseLogInformation,
				type: fgMakeLogType,
				pidAst: passer?.id,
			});
		}
		this.recordLastScore(this.o, p, type, passer, defender);

		if (andOne && !this.elamDone) {
			this.doPf({ t: this.d, type: "pfAndOne", shooter: p, fouler });
			return this.doFt(p, 1); // fg, orb, or drb
		}

		// In the last 2 minutes of a period, stop clock after made FG
		if (this.t <= 2 * 60) {
			this.isClockRunning = false;
		}

		return "fg";
	}

	/**
	 * Probability that a shot taken this possession is assisted.
	 *
	 * @return {number} Probability from 0 to 1.
	 */
	probAst() {
		return (
			((0.6 * (2 + this.team[this.o].compositeRating.passing)) /
				(2 + this.team[this.d].compositeRating.defense)) *
			g.get("assistFactor") *
			(this.coachSys ? this.cs[this.o].ast : 1)
		);
	}

	// Coaching systems: late in a close game (final period or overtime, last 5 minutes, within 8)
	isClutchTime() {
		return (
			this.team[0].stat.ptsQtrs.length >= this.numPeriods &&
			this.t <= 300 &&
			Math.abs(this.team[0].stat.pts - this.team[1].stat.pts) <= 8
		);
	}

	// Power on the usage composite when picking the shooter: 1.25 stock, more for star-centric systems and, late, for closers
	usagePower() {
		if (!this.coachSys) {
			return 1.25;
		}
		const cs = this.cs[this.o];
		return 1.25 * cs.usage * (this.isClutchTime() ? cs.clutchUsage : 1);
	}

	// Spacing & Shot Creation: power on the creation composite when picking the creator (the coach's usage multipliers apply)
	creationPower() {
		if (!this.coachSys) {
			return CREATION_POWER;
		}
		const cs = this.cs[this.o];
		return (
			CREATION_POWER * cs.usage * (this.isClutchTime() ? cs.clutchUsage : 1)
		);
	}

	// Spacing & Shot Creation: who passes to shooter p, the creator unless he is the shooter himself
	creatorPasser(p: PlayerGameSim) {
		const creator = this.creator;
		if (
			creator !== undefined &&
			creator !== p &&
			this.playersOnCourt[this.o].includes(creator)
		) {
			return creator;
		}
		return this.pickPlayer("creation", this.o, this.creationPower(), p);
	}

	// Spacing & Shot Creation: is a shot of this type assisted, and by whom
	drawAssist(p: PlayerGameSim, type: ShotType, selfCreated: boolean) {
		const typeFactor =
			type === "threePointer"
				? CREATION.astThree
				: type === "atRim"
					? CREATION.astRim
					: type === "lowPost"
						? CREATION.astPost
						: CREATION.astMid;
		const prob =
			this.probAst() *
			typeFactor *
			(selfCreated ? CREATION.astSelf : CREATION.astOther);
		if (prob > Math.random()) {
			return this.creatorPasser(p);
		}
		return undefined;
	}

	// Coaching systems: change to the make probability of a shot (scheme fit, coaching strengths, installation, late-game management, and
	// in the stock possession model an easier shot after a defensive rebound against a team that crashed the glass)
	coachMakeDelta() {
		const o = this.cs[this.o];
		const d = this.cs[this.d];
		let delta = o.make + d.dMake;
		if (this.isClutchTime()) {
			delta += o.clutchMake - d.clutchMake;
		}
		if (!this.realPoss && this.prevPossessionOutcome === "drb") {
			delta += 0.06 * (d.oppTransition - 1);
		}
		return delta;
	}

	// This runs before an overtime period is played, so all these shots lead to another overtime period, not the end of the game
	checkGameTyingShot() {
		// can assume that the last scoring play tied the game
		const play = this.lastScoringPlay.at(-1);

		if (!play || this.elamActive) {
			return;
		}

		let shotType = "a basket";

		switch (play.type) {
			case "atRim":
			case "tipIn":
			case "putBack":
			case "lowPost":
			case "midRange":
				break;

			case "threePointer":
				shotType = "a three-pointer";
				break;

			case "ft": {
				shotType = "a free throw";

				const prevPlay = this.lastScoringPlay.at(-2);
				if (play && prevPlay) {
					if (prevPlay.team === play.team) {
						switch (prevPlay.type) {
							case "atRim":
							case "tipIn":
							case "putBack":
							case "lowPost":
							case "midRange":
								shotType = "a three-point play";
								break;

							case "threePointer":
								shotType = "a four-point play";
								break;

							case "ft":
								if (
									this.lastScoringPlay.at(-3)?.team === play.team &&
									this.lastScoringPlay.at(-3)?.type === "ft"
								) {
									shotType = "three free throws";
								} else {
									shotType = "two free throws";
								}

								break;

							default:
						}
					}
				}

				break;
			}

			default:
		}

		const team = this.team[play.team];
		const p = play.player;
		let eventText = `<a href="${helpers.leagueUrl(["player", p.id])}">${
			p.name
		}</a> made ${shotType}`;

		if (play.time > 0) {
			eventText += ` with ${formatClock(play.time)} seconds remaining`;
		} else {
			eventText +=
				play.type === "ft" ? " with no time on the clock" : " at the buzzer";
		}

		const otLabel = helpers.overtimeCounter(
			this.team[0].stat.ptsQtrs.length - this.numPeriods + 1,
		);
		eventText += ` to force ${otLabel} overtime`;
		this.clutchPlays.push({
			text: eventText,
			showNotification: team.id === g.get("userTid"),
			pids: [p.id],
			tids: [team.id],
			meta: {
				...this.scoringMeta(this.lastScoringPlay.length - 1, "forceOT"),
				otLabel,
			},
		});
	}

	// This runs after the game ends (except shootout) so it could be a game-tying shot if the game will end in a tie or shootout
	checkGameWinner() {
		if (this.lastScoringPlay.length === 0) {
			return;
		}

		const winner = getWinner([this.team[0].stat, this.team[1].stat])!;
		const loser = winner === 0 ? 1 : 0;
		const finalMargin =
			winner === -1
				? 0
				: this.team[winner].stat.pts - this.team[loser].stat.pts;
		let margin = finalMargin;

		// work backwards from last scoring plays, check if any resulted in a tie-break or lead change
		let pts = 0;
		let shotType = "basket";
		for (let i = this.lastScoringPlay.length - 1; i >= 0; i--) {
			const play = this.lastScoringPlay[i]!;

			switch (play.type) {
				case "atRim":
				case "tipIn":
				case "putBack":
				case "lowPost":
				case "midRange":
					pts = 2;
					break;

				case "threePointer":
					shotType = "three-pointer";
					pts = 3;
					break;

				case "ft":
					// Special handling for free throws
					shotType = "free throw";

					if (i > 0) {
						const prevPlay = this.lastScoringPlay[i - 1]!;

						if (prevPlay.team === play.team) {
							switch (prevPlay.type) {
								// cases where the basket ties the game, and the and-one wins it
								case "atRim":
								case "tipIn":
								case "putBack":
								case "lowPost":
								case "midRange":
									shotType = "three-point play";
									break;

								case "threePointer":
									shotType = "four-point play";
									break;

								default:
							}
						}
					}

					pts = 1;
					break;

				default:
			}

			margin -= winner === -1 || play.team === winner ? pts : -pts;

			if (margin <= 0) {
				const team = this.team[play.team];
				const p = play.player;

				const winningOrTying = winner === -1 ? "game-tying" : "game-winning";

				let eventText = `<a href="${helpers.leagueUrl([
					"player",
					p.id,
				])}">${p.name}</a> made a ${winningOrTying} ${shotType}`;

				if (!this.elamActive) {
					if (play.time > 0) {
						eventText += ` with ${formatClock(play.time)} seconds remaining`;
					} else {
						eventText +=
							play.type === "ft"
								? " with no time on the clock"
								: " at the buzzer";
					}
				}

				if (winner === -1 && this.shootoutRounds > 0) {
					eventText += " to force a shootout";
				}

				this.clutchPlays.push({
					text: eventText,
					showNotification: team.id === g.get("userTid"),
					pids: [p.id],
					tids: [team.id],
					meta: {
						...this.scoringMeta(i, winner === -1 ? "tying" : "winner"),
						shootout: winner === -1 && this.shootoutRounds > 0,
					},
				});
				return;
			}
		}
	}

	// Flavor metadata for the scoring play at this.lastScoringPlay[i] (only reads what the sim already recorded)
	scoringMeta(
		i: number,
		kind: "winner" | "tying" | "forceOT",
	): Extract<ClutchMeta, { kind: "winner" | "tying" | "forceOT" }> {
		const play = this.lastScoringPlay[i]!;
		const prev = this.lastScoringPlay[i - 1];
		let finish: "and1" | "and1Three" | "twoFt" | "threeFt" | undefined;
		let fgPlay = play;
		if (play.type === "ft" && prev && prev.team === play.team) {
			if (prev.type === "threePointer") {
				finish = "and1Three";
				fgPlay = prev;
			} else if (prev.type === "ft") {
				if (kind === "forceOT") {
					const prev2 = this.lastScoringPlay[i - 2];
					finish =
						prev2 && prev2.team === play.team && prev2.type === "ft"
							? "threeFt"
							: "twoFt";
				}
			} else {
				finish = "and1";
				fgPlay = prev;
			}
		}
		return {
			kind,
			player: ref(play.player),
			shot: play.type as Extract<ClutchMeta, { kind: "winner" }>["shot"],
			finish,
			time: play.time,
			elam: this.elamActive,
			ast: fgPlay.ast ? ref(fgPlay.ast) : undefined,
			def: fgPlay.def ? ref(fgPlay.def) : undefined,
		};
	}

	// A block, steal or forced turnover by the defense in the last 10 seconds of the 4th quarter or overtime, with the defense tied or
	// ahead by no more than the offense could have scored on the play (2 or 3 for a block, 3 otherwise), so it stopped a go-ahead or tying
	// score. Only a candidate: checkDefensiveStop keeps it if the defense went on to win in that period and the offense never scored again.
	noteDefensiveStop(
		play: "blk" | "stl" | "tov",
		defender: PlayerGameSim,
		opp: PlayerGameSim,
		shot?: ShotType,
	) {
		const period = this.team[0].stat.ptsQtrs.length;
		if (period < this.numPeriods || this.t > 10 || this.elamActive) {
			return;
		}
		const lead = this.team[this.d].stat.pts - this.team[this.o].stat.pts;
		const maxPts = play === "blk" && shot !== "threePointer" ? 2 : 3;
		if (lead < 0 || lead > maxPts) {
			return;
		}
		this.defensiveStop = {
			t: this.d,
			period,
			oppPts: this.team[this.o].stat.pts,
			meta: {
				kind: "defense",
				play,
				player: ref(defender),
				opp: ref(opp),
				shot: shot as Extract<ClutchMeta, { kind: "defense" }>["shot"],
				time: this.t,
				lead,
			},
		};
	}

	checkDefensiveStop() {
		const stop = this.defensiveStop;
		if (!stop) {
			return;
		}
		const winner = getWinner([this.team[0].stat, this.team[1].stat]);
		const other = stop.t === 0 ? 1 : 0;
		if (
			winner !== stop.t ||
			stop.period !== this.team[0].stat.ptsQtrs.length ||
			this.team[other].stat.pts !== stop.oppPts
		) {
			return;
		}
		const { meta } = stop;
		const verb =
			meta.play === "blk"
				? "blocked"
				: meta.play === "stl"
					? "stole the ball from"
					: "forced a turnover by";
		const team = this.team[stop.t];
		this.clutchPlays.push({
			text: `<a href="${helpers.leagueUrl(["player", meta.player.pid])}">${
				meta.player.name
			}</a> ${verb} <a href="${helpers.leagueUrl(["player", meta.opp.pid])}">${
				meta.opp.name
			}</a> with ${formatClock(meta.time)} seconds remaining to preserve the win`,
			showNotification: team.id === g.get("userTid"),
			pids: [meta.player.pid],
			tids: [team.id],
			meta,
		});
	}

	recordLastScore(
		teamnum: TeamNum,
		playernum: PlayerGameSim,
		type: ShotType,
		ast?: PlayerGameSim,
		def?: PlayerGameSim,
	) {
		// only record plays in the fourth quarter or overtime...
		if (this.team[0].stat.ptsQtrs.length < this.numPeriods) {
			return;
		}

		// ...in the last 24 seconds...
		if (this.t > 24) {
			return;
		}

		// ...when the lead is 3 or less
		if (Math.abs(this.team[0].stat.pts - this.team[1].stat.pts) > 4) {
			return;
		}

		const currPlay = {
			team: teamnum,
			player: playernum,
			type,
			time: this.t,
			ast,
			def,
		};

		if (!this.lastScoringPlay[0]) {
			this.lastScoringPlay.push(currPlay);
		} else {
			const lastPlay = this.lastScoringPlay[0];

			if (lastPlay.time !== currPlay.time) {
				this.lastScoringPlay = [];
			}

			this.lastScoringPlay.push(currPlay);
		}
	}

	// 95% max, a 75 FT rating gets you 90%, and a 25 FT rating gets you 60%. Player traits: clutch free throw shooting
	freeThrowProb(t: TeamNum, p: PlayerGameSim) {
		const base =
			g.get("ftAccuracyFactor") * p.compositeRating.shootingFT * 0.6 + 0.45;
		if (this.traitsOn && p.traitEffects) {
			return helpers.bound(
				base +
					p.traitEffects.clutchFtModifier(this.traitSituation(t)) +
					(this.bigGame ? p.traitEffects.bigGameFtDelta : 0),
				0,
				0.95,
			);
		}
		return helpers.bound(base, 0, 0.95);
	}

	// oneAndOne: the second shot is only taken if the first one is made
	doFt(p: PlayerGameSim, amount: number, oneAndOne: boolean = false) {
		const ftp = this.freeThrowProb(this.o, p);

		let outcome: PossessionOutcome | undefined;

		for (let i = 0; i < amount; i++) {
			this.recordStat(this.o, p, "fta");

			if (Math.random() < ftp) {
				// Between 60% and 90%
				this.recordStat(this.o, p, "ft");
				this.recordStat(this.o, p, "pts");
				this.playByPlay.logEvent({
					type: "ft",
					t: this.o,
					pid: p.id,
					clock: this.t,
				});
				outcome = "ft";
				this.recordLastScore(this.o, p, "ft");

				if (this.elamDone) {
					break;
				}
			} else {
				this.playByPlay.logEvent({
					type: "missFt",
					t: this.o,
					pid: p.id,
					clock: this.t,
				});
				outcome = undefined;
				if (oneAndOne) {
					break;
				}
			}
		}

		if (outcome === "ft") {
			this.isClockRunning = false;
		} else {
			this.isClockRunning = true;
			outcome = this.doReb();
		}

		return outcome;
	}

	/**
	 * Personal foul.
	 *
	 * @param {number} t Team (0 or 1, this.o or this.d).
	 */
	doPf(
		info:
			| {
					t: TeamNum;
					type: "pfNonShooting";
					shooter?: undefined;
					fouler?: PlayerGameSim;
			  }
			| {
					t: TeamNum;
					type: "pfBonus" | "pfFG" | "pfTP" | "pfAndOne";
					shooter: PlayerGameSim;
					fouler?: PlayerGameSim;
			  },
	) {
		const t = info.t;
		const p = info.fouler ?? this.pickPlayer("fouling", t, 1);
		this.recordStat(t, p, "pf");

		// pfAndOne is handled in the shot event
		if (info.type !== "pfAndOne") {
			const baseLogInformation = {
				t,
				pid: p.id,
				clock: this.t,
			};
			if (info.type === "pfNonShooting") {
				this.playByPlay.logEvent({
					...baseLogInformation,
					type: info.type,
				});
			} else {
				this.playByPlay.logEvent({
					...baseLogInformation,
					type: info.type,
					pidShooting: info.shooter.id,
				});
			}
		}

		// Foul out
		const foulsNeededToFoulOut = g.get("foulsNeededToFoulOut");
		if (foulsNeededToFoulOut > 0 && p.stat.pf >= foulsNeededToFoulOut) {
			this.playByPlay.logEvent({
				type: "foulOut",
				t,
				pid: p.id,
				clock: this.t,
			});

			// Force substitutions now
			this.updatePlayersOnCourt({
				shooter: info.shooter,
			});
			this.updateSynergy();
		}

		this.foulsThisQuarter[t] += 1;

		if (this.t <= 2 * 60) {
			this.foulsLastTwoMinutes[t] += 1;
		}
	}

	// Free throws with no rebound after them: a technical's (by the other team, possession unchanged) or a flagrant's (the ball goes back to the
	// fouled team)
	shootFreeThrowsDeadBall(
		t: TeamNum,
		p: PlayerGameSim,
		amount: number,
		tech: boolean,
	) {
		const ftp = this.freeThrowProb(t, p);
		for (let i = 0; i < amount; i++) {
			this.recordStat(t, p, "fta");
			if (Math.random() < ftp) {
				this.recordStat(t, p, "ft");
				this.recordStat(t, p, "pts");
				this.playByPlay.logEvent({
					type: "ft",
					t,
					pid: p.id,
					clock: this.t,
					...(tech ? { tech: true } : {}),
				});
				this.recordLastScore(t, p, "ft");
				if (this.elamDone) {
					break;
				}
			} else {
				this.playByPlay.logEvent({
					type: "missFt",
					t,
					pid: p.id,
					clock: this.t,
					...(tech ? { tech: true } : {}),
				});
			}
		}
	}

	eject(
		t: TeamNum,
		p: PlayerGameSim,
		reason: "flagrant2" | "flagrants" | "techs",
		shooter?: PlayerGameSim,
	) {
		this.ejected.add(p);
		this.playByPlay.logEvent({
			type: "ejection",
			t,
			pid: p.id,
			reason,
			clock: this.t,
		});
		if (this.playersOnCourt[t].includes(p)) {
			// Force substitutions now, like a foul out
			this.updatePlayersOnCourt({
				shooter,
			});
			this.updateSynergy();
		}
	}

	// After a possession: maybe a technical foul at the dead ball. One free throw for the other team, possession unchanged
	maybeTechnicalFoul(outcome: PossessionOutcome) {
		if (this.t <= 0 || this.elamDone) {
			return;
		}
		const deadBall =
			outcome === "fg" ||
			outcome === "ft" ||
			outcome === "nonShootingFoul" ||
			outcome === "timeout" ||
			outcome === "outOfBoundsDefense" ||
			outcome === "outOfBoundsOffense";
		if (!deadBall) {
			return;
		}
		// Players argue calls more than they argue anything else
		const factor = outcome === "nonShootingFoul" || outcome === "ft" ? 2 : 1;
		// Player traits: hotheads on the court mean more technicals (exactly 1 with the setting off)
		const temper =
			(this.traitTemperRate(0, "tech") + this.traitTemperRate(1, "tech")) / 2;
		if (
			Math.random() >=
			TECHNICAL_FOUL_RATES.techPerDeadBall * factor * temper
		) {
			return;
		}

		const t: TeamNum = Math.random() < 0.5 ? 0 : 1;
		const other: TeamNum = t === 0 ? 1 : 0;
		const bench = Math.random() < TECHNICAL_FOUL_RATES.techBench;
		const p = bench ? undefined : this.pickTechFouler(t);

		// Coaches are keyed by team number, players by themselves
		const key = p ?? t;
		const num = (this.techs.get(key) ?? 0) + 1;
		this.techs.set(key, num);

		this.playByPlay.logEvent({
			type: "techFoul",
			t,
			pid: p?.id,
			num,
			clock: this.t,
		});

		if (num >= 2) {
			if (p) {
				this.eject(t, p, "techs");
			} else {
				this.playByPlay.logEvent({
					type: "ejection",
					t,
					pid: undefined,
					reason: "techs",
					clock: this.t,
				});
			}
		}

		// The best free throw shooter on the floor takes it
		const shooter = maxBy(
			this.playersOnCourt[other],
			(p2) => p2.compositeRating.shootingFT,
		);
		if (shooter) {
			this.shootFreeThrowsDeadBall(other, shooter, 1, true);
		}
	}

	// A flagrant foul by the defense: a personal (and team) foul, two free throws, and the fouled team keeps the ball. A flagrant 2, or a
	// second flagrant, ejects the fouler
	doFlagrantFoul(shooter: PlayerGameSim): PossessionOutcome {
		const maxDt = Math.max(
			0.5,
			Math.min(this.t - 1, this.shotClockFull - this.possessionLength),
		);
		this.advanceClockSeconds(uniform(Math.min(1, maxDt), maxDt));
		this.isClockRunning = false;

		const t = this.d;
		const fouler = this.pickTechFouler(t);
		const level: 1 | 2 = Math.random() < TECHNICAL_FOUL_RATES.flagrant2 ? 2 : 1;
		this.recordStat(t, fouler, "pf");
		this.foulsThisQuarter[t] += 1;
		if (this.t <= 2 * 60) {
			this.foulsLastTwoMinutes[t] += 1;
		}

		this.playByPlay.logEvent({
			type: "flagrantFoul",
			t,
			pid: fouler.id,
			pidShooting: shooter.id,
			level,
			clock: this.t,
		});

		const numFlagrants = (this.flagrants.get(fouler) ?? 0) + 1;
		this.flagrants.set(fouler, numFlagrants);

		const foulsNeededToFoulOut = g.get("foulsNeededToFoulOut");
		if (level === 2) {
			this.eject(t, fouler, "flagrant2", shooter);
		} else if (numFlagrants >= 2) {
			this.eject(t, fouler, "flagrants", shooter);
		} else if (
			foulsNeededToFoulOut > 0 &&
			fouler.stat.pf >= foulsNeededToFoulOut
		) {
			this.playByPlay.logEvent({
				type: "foulOut",
				t,
				pid: fouler.id,
				clock: this.t,
			});
			this.updatePlayersOnCourt({
				shooter,
			});
			this.updateSynergy();
		}

		this.shootFreeThrowsDeadBall(this.o, shooter, 2, false);

		// The offense keeps the ball, inbounding in the frontcourt
		return "nonShootingFoul";
	}

	doReb() {
		let p;
		this.afterShotAttempt = true;

		if (this.t === 0) {
			return "endOfPeriod";
		}

		this.advanceClockSeconds(uniform(0.1, 0.7));

		if (this.t === 0) {
			return "endOfPeriod";
		}

		if (Math.random() < 0.1) {
			return this.doOutOfBounds(0.1);
		}

		// Expanded ratings: the defense's defensive rebounding against the offense's offensive rebounding
		const exp2 = this.expandedRatings2;
		const dReb = exp2
			? this.team[this.d].compositeRating.defRebounding
			: this.team[this.d].compositeRating.rebounding;
		const oReb = exp2
			? EXPANDED_ORB_FACTOR * this.team[this.o].compositeRating.offRebounding
			: this.team[this.o].compositeRating.rebounding;
		if (
			(0.75 * (2 + dReb)) /
				(g.get("orbFactor") *
					(2 + oReb) *
					(this.coachSys
						? this.cs[this.o].orb * this.cs[this.d].orbAllowed
						: 1)) >
			Math.random()
		) {
			p = this.pickPlayer(exp2 ? "defRebounding" : "rebounding", this.d, 3);
			this.recordStat(this.d, p, "drb");
			this.playByPlay.logEvent({
				type: "drb",
				t: this.d,
				pid: p.id,
				clock: this.t,
			});
			return "drb" as const;
		}

		this.lastOrbPlayer = this.pickPlayer(
			exp2 ? "offRebounding" : "rebounding",
			this.o,
			5,
		);
		p = this.lastOrbPlayer;
		this.recordStat(this.o, p, "orb");
		this.playByPlay.logEvent({
			type: "orb",
			t: this.o,
			pid: p.id,
			clock: this.t,
		});
		return "orb" as const;
	}

	/**
	 * Generate an array of composite ratings.
	 *
	 * @param {string} rating Key of this.team[t].player[p].compositeRating to use.
	 * @param {number} t Team (0 or 1, this.or or this.d).
	 * @param {number=} power Power that the composite rating is raised to after the components are linearly combined by  the weights and scaled from 0 to 1. This can be used to introduce nonlinearities, like making a certain stat more uniform (power < 1) or more unevenly distributed (power > 1) or making a composite rating an inverse (power = -1). Default value is 1.
	 * @return {Array.<number>} Array of composite ratings of the players on the court for the given rating and team.
	 */
	ratingArray(
		rating: CompositeRating,
		t: TeamNum,
		power: number,
		array: number[],
	) {
		const foulLimit = rating === "fouling" ? this.getFoulTroubleLimit() : 0;
		let total = 0;

		// Scale composite ratings
		for (let i = 0; i < this.numPlayersOnCourt; i++) {
			const p = this.playersOnCourt[t][i]!;

			let compositeRating = p.compositeRating[rating];

			if (rating === "fouling") {
				const pf = p.stat.pf;
				if (pf === foulLimit - 1) {
					compositeRating *= 0.8;
				} else if (pf === foulLimit) {
					compositeRating *= 0.5;
				} else if (pf > foulLimit) {
					compositeRating *= 0.25;
				}
			}

			let value = (compositeRating * this.fatigue(p.stat.energy)) ** power;

			// Perimeter Defense: the steal goes more often to the on-ball, perimeter defender. Only who gets it changes, not how many
			// steals there are, and no extra random numbers are drawn.
			if (rating === "stealing" && this.perimeterDefense) {
				value *=
					(p.compositeRating.defensePerimeter * this.fatigue(p.stat.energy)) **
						PERIMETER_STEAL_POWER /
					(compositeRating * this.fatigue(p.stat.energy)) **
						PERIMETER_STEAL_DAMPING;
			}

			// Player traits: shot selection, foul proneness, steals and hustle
			if (this.traitsOn && p.traitEffects) {
				value *= this.traitPickWeight(rating, p, t);
			}

			array[i] = value;
			total += value;
		}

		if (rating === "stealing" && this.perimeterDefense && total > 0) {
			const cap = (STEAL_WEIGHT_SOFT_CAP * total) / this.numPlayersOnCourt;
			total = 0;
			for (let i = 0; i < this.numPlayersOnCourt; i++) {
				const value = array[i]!;
				if (value > cap) {
					array[i] = cap + STEAL_WEIGHT_EXCESS * (value - cap);
				}
				total += array[i]!;
			}
		}

		// Set floor (5% of total)
		const floor = 0.05 * total;

		for (let i = 0; i < this.numPlayersOnCourt; i++) {
			if (array[i]! < floor) {
				array[i] = floor;
			}
		}

		return array;
	}

	pickPlayer(
		rating: CompositeRating,
		t: TeamNum,
		power: number,
		exempt?: PlayerGameSim,
	) {
		const ratios = this.ratingArray(rating, t, power, this.ratingArrayCache);
		const playersOnCourt = this.playersOnCourt[t];

		if (exempt !== undefined) {
			const index = playersOnCourt.indexOf(exempt);
			if (index >= 0) {
				ratios[index] = 0;
			}
		}

		let sum = 0;
		for (const ratio of ratios) {
			sum += ratio;
		}

		// Special case for all 0 rated players - randomly pick one
		if (sum === 0) {
			const candidates = playersOnCourt.filter((p) => p !== exempt);
			return choice(candidates);
		}

		const rand = Math.random() * sum;

		let runningSum = 0;

		for (const [i, ratio] of ratios.entries()) {
			runningSum += ratio;
			if (rand < runningSum) {
				return playersOnCourt[i]!;
			}
		}

		return playersOnCourt[0]!;
	}

	/**
	 * Increments a stat (s) for a player (p) on a team (t) by amount (default is 1).
	 *
	 * @param {number} t Team (0 or 1, this.or or this.d).
	 * @param {number} p Integer index of this.team[t].player for the player of interest.
	 * @param {string} s Key for the property of this.team[t].player[p].stat to increment.
	 * @param {number} amt Amount to increment (default is 1).
	 */
	recordStat(
		t: TeamNum,
		p: PlayerGameSim | undefined,
		s: Exclude<Stat, "benchTime" | "courtTime" | "energy" | "min">,
		amt: number = 1,
	) {
		if (p !== undefined) {
			if (s === "gp") {
				p.stat[s] = 1;
			} else {
				p.stat[s] += amt;
				if (s === "pf" && this.realisticRotations) {
					this.onPersonalFoul(p);
				}
			}
		}

		if (s !== "gs" && s !== "gp") {
			const teamStat = this.team[t].stat;
			teamStat[s] += amt; // Record quarter-by-quarter scoring too

			if (s === "pts") {
				teamStat.ptsQtrs[teamStat.ptsQtrs.length - 1] += amt;
				if (this.smartEndgame) {
					this.scoringRun[t] += amt;
					this.scoringRun[t === 0 ? 1 : 0] = 0;
				}

				for (const i of [0, 1] as const) {
					for (let j = 0; j < this.numPlayersOnCourt; j++) {
						const p2 = this.playersOnCourt[i][j]!;
						p2.stat.pm += i === t ? amt : -amt;
					}
				}

				if (
					this.elamActive &&
					(this.team[this.d].stat.pts >= this.elamTarget ||
						this.team[this.o].stat.pts >= this.elamTarget)
				) {
					this.elamDone = true;
				}
			}
		}

		if (this.playByPlay?.active) {
			this.playByPlay.logStat(t, p === undefined ? undefined : p.id, s, amt);
		}
	}
}

export default GameSim;
