// Coach Decisions (the coachDecisions setting, basketball; docs/native-features.md "Coach decisions"): the head coach's game-to-game
// calls. Pure functions, no Math.random: every "random" choice (rest nights, how well he reads the opponent, whether he changes the
// lineup after a playoff loss) is a seeded hash of the league, the game day and the players. The league side is
// worker/core/staff/coachDecisions.ts, the sim side GameSim.basketball (foul trouble, hot hand, closers, halftime, the stopper).

import { hashString } from "./coachSystems.ts";
import { salted } from "./leagueSalt.ts";
import type { CoachProfile, CoachRatings, CoachRole } from "./types.staff.ts";

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const round3 = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------------------------------------------------------------------------------
// Stored types

// What the head coach decides on the user's team. Missing: every area follows keepRosterSorted ("Always let coach decide")
export type CoachDelegation = {
	starters: boolean;
	rotation: boolean;
	minutes: boolean;
	matchups: boolean;
};
export const DELEGATION_AREAS = [
	"starters",
	"rotation",
	"minutes",
	"matchups",
] as const;
export type DelegationArea = (typeof DELEGATION_AREAS)[number];
export const DELEGATION_NAMES: Record<DelegationArea, string> = {
	starters: "Starters",
	rotation: "Rotation order",
	minutes: "Minutes",
	matchups: "Matchup changes",
};
export const DELEGATION_HELP: Record<DelegationArea, string> = {
	starters:
		"Who starts each game: his style (young players, veterans or the best system fit), promised roles, loyalty and injury replacements.",
	rotation:
		"The order of the rotation: roles earned and lost on recent form. Off: your roster order and playing time buttons.",
	minutes:
		"Minutes beyond the order: development minutes, rest nights for older stars, more minutes against the opponent's weaknesses and its pace.",
	matchups:
		"Game-by-game changes: a big or small lineup against the opponent, a defensive stopper on their best scorer, halftime and playoff adjustments.",
};

export const delegationFor = (t: {
	keepRosterSorted: boolean;
	coachDelegation?: CoachDelegation;
}): CoachDelegation =>
	t.coachDelegation ?? {
		starters: t.keepRosterSorted,
		rotation: t.keepRosterSorted,
		minutes: t.keepRosterSorted,
		matchups: t.keepRosterSorted,
	};

// The user's lineup choice for the next game (cleared after it). Missing: the coach's choice
export type LineupPreset = "big" | "small" | "defense" | "closing" | "rest";
export const LINEUP_PRESETS: LineupPreset[] = [
	"big",
	"small",
	"defense",
	"closing",
	"rest",
];
export const LINEUP_PRESET_NAMES: Record<LineupPreset, string> = {
	big: "Big",
	small: "Small",
	defense: "Defense",
	closing: "Closing lineup",
	rest: "Rest night",
};

// How often the user overrode his coach this season (games where his starters or playing time went against the coach's plan)
export type CoachPushback = {
	season: number;
	games: number;
	overrides: number;
	// The coach said something about it this season
	noted?: boolean;
};

// His recent form (basketball game score and plus/minus per 36 minutes): short (about 10 games) and season-long averages, and the role
// change it applied (rb, a multiplier - 1 on his place in the rotation order, changed only past a threshold: hysteresis)
export type CoachForm = {
	s: number;
	n: number;
	gs: number;
	gsL: number;
	pm: number;
	rb: number;
	// Started the team's last game
	st?: 1;
};

export type RolePromise = {
	tid: number;
	role: "starter" | "rotation";
	// Last season it covers
	exp: number;
	by: "user" | "ai";
	// This season: games he was healthy for, and games the promise was kept in (started / played 15+ minutes)
	season: number;
	g: number;
	ok: number;
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// Seeded "random" numbers

/** A uniform number in [0, 1) from a key (salted per league). */
export const unitHash = (key: string) =>
	hashString(salted(`cd|${key}`)) / 4294967296;

/** About N(0, 1) from a key. */
export const gaussHash = (key: string) => {
	let sum = 0;
	for (let i = 0; i < 4; i++) {
		sum += unitHash(`${key}|${i}`);
	}
	return (sum - 2) * Math.sqrt(3);
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// Ratings and traits

// What a coach of a job is generated with (see common/staff.ts coachRatingRef, which uses this for the stationary progression)
export const decisionRatingRef = (key: "prp" | "plm", role: CoachRole) => {
	if (role === "head") {
		return 50;
	}
	if (key === "prp") {
		return role === "off" || role === "def" || role === "video" ? 46 : 42;
	}
	return role === "dev" ? 46 : 42;
};

/**
 * Game Prep (prp) and Player Management (plm) of a coach who has none yet (coaches from before the setting, and new ones: no random draws,
 * so the coaching market draws the same numbers): a stable value from his other ratings, his job and his name. 1-100.
 */
export const decisionRatingsFor = (c: {
	ratings: CoachRatings;
	role: CoachRole;
	firstName: string;
	lastName: string;
	born: { year: number };
	// Rating points his age adds (common/staff.ts coachAgeOffset), so young coaches start lower like their other ratings
	ageOffset?: number;
}) => {
	const r = c.ratings;
	const key = `${c.firstName}|${c.lastName}|${c.born.year}`;
	const a = c.ageOffset ?? 0;
	const b = (x: number) => Math.max(1, Math.min(100, Math.round(x)));
	return {
		prp:
			r.prp ??
			b(
				0.3 * r.off +
					0.3 * r.def +
					0.4 * (decisionRatingRef("prp", c.role) + a) +
					6 * gaussHash(`prp|${key}`),
			),
		plm:
			r.plm ??
			b(
				0.35 * r.mot +
					0.15 * r.dev +
					0.5 * (decisionRatingRef("plm", c.role) + a) +
					6 * gaussHash(`plm|${key}`),
			),
	};
};

/** Loyalty, foul-trouble aggressiveness and injury plan of a coach who has none stored (deterministic). */
export const deriveDecisionTraits = (c: {
	firstName: string;
	lastName: string;
	born: { year: number };
	profile: Pick<CoachProfile, "personality" | "philosophy" | "fouls" | "adapt">;
}) => {
	const key = `${c.firstName}|${c.lastName}|${c.born.year}`;
	const p = c.profile;
	return {
		// Players' coaches stand by their veterans, disciplinarians bench them
		loyalty: round2(
			clamp(0.4 * p.personality + 0.4 * gaussHash(`loy|${key}`), -1, 1),
		),
		// Physical, win-now coaches ride foul trouble; careful ones go by the book
		foulRide: round2(
			clamp(
				0.25 * p.fouls - 0.15 * p.philosophy + 0.4 * gaussHash(`ride|${key}`),
				-1,
				1,
			),
		),
		// Adaptable coaches shuffle the lineup (the next man up), stubborn ones keep their units
		injuryNext: round2(
			clamp(
				0.2 + (0.3 * (p.adapt - 50)) / 50 + 0.4 * gaussHash(`inj|${key}`),
				-1,
				1,
			),
		),
	};
};

export type StarterStyle = "youth" | "veteran" | "system" | "best";
export const STARTER_STYLE_NAMES: Record<StarterStyle, string> = {
	youth: "Starts young players",
	veteran: "Starts veterans",
	system: "Starts the best fits for his system",
	best: "Starts his best players",
};

export const starterStyleOf = (
	profile: Pick<CoachProfile, "philosophy" | "adapt">,
): StarterStyle =>
	profile.philosophy >= 0.35
		? "youth"
		: profile.philosophy <= -0.35
			? "veteran"
			: profile.adapt < 40
				? "system"
				: "best";

// Everything the decisions read about a head coach
export type CoachMind = {
	// Game Prep and Player Management, 0-100 (prep with the video coordinator's boost)
	prep: number;
	pm: number;
	philosophy: number;
	youth: number;
	rest: number;
	personality: number;
	adapt: number;
	mgmt: number;
	loyalty: number;
	foulRide: number;
	injuryNext: number;
	style: StarterStyle;
};

export const coachMind = (
	ratings: CoachRatings,
	profile: CoachProfile,
	traits: { loyalty: number; foulRide: number; injuryNext: number },
	prepBoost: number = 0,
): CoachMind => ({
	prep: clamp((ratings.prp ?? 45) + prepBoost, 0, 100),
	pm: clamp(ratings.plm ?? 45, 0, 100),
	philosophy: profile.philosophy,
	youth: profile.youth,
	rest: profile.rest,
	personality: profile.personality,
	adapt: profile.adapt,
	mgmt: profile.mgmt,
	loyalty: profile.loyalty ?? traits.loyalty,
	foulRide: profile.foulRide ?? traits.foulRide,
	injuryNext: profile.injuryNext ?? traits.injuryNext,
	style: starterStyleOf(profile),
});

/** His decision-making tendencies in words (coach pages). */
export const describeDecisions = (m: {
	style: StarterStyle;
	loyalty: number;
	foulRide: number;
	injuryNext: number;
	rest: number;
}) => ({
	starters: STARTER_STYLE_NAMES[m.style],
	loyalty:
		m.loyalty >= 0.35
			? "Sticks with his veterans through slumps"
			: m.loyalty <= -0.35
				? "Plays whoever is hot"
				: "Balanced on roles",
	foulTrouble:
		m.foulRide >= 0.4
			? "Rides players in foul trouble"
			: m.foulRide <= -0.4
				? "Sits players in foul trouble early"
				: "Standard foul-trouble rules",
	injuries:
		m.injuryNext >= 0.2
			? "Promotes the next man when a starter is out"
			: m.injuryNext <= -0.2
				? "Keeps his bench unit together when a starter is out"
				: "Promotes the next man when a starter is out",
	rest:
		m.rest >= 0.35
			? "Rests his older stars often"
			: m.rest <= -0.35
				? "Rarely rests anyone"
				: "Rests older stars now and then",
});

// 0 (30 or less) ... 1 (70 or more): how much of the skill he brings
export const skill01 = (x: number) => clamp((x - 30) / 40, 0, 1);

// ---------------------------------------------------------------------------------------------------------------------------------------
// Recent form (earned and lost roles)

export const FORM = {
	// Weights of the latest game in the short (~10 games) and season averages
	short: 0.18,
	long: 0.05,
	// Minutes for a game to count
	minMin: 8,
	// Form score: game score per 36 above his season level per gsScale, plus/minus per 36 per pmScale
	gsScale: 6,
	pmScale: 25,
	// Role change per unit of form score: low Player Management ... high (more responsive)
	respLow: 0.03,
	respHigh: 0.08,
	maxRole: 0.08,
	// Hysteresis: the applied role changes only when the target moved this far from it
	hysteresis: 0.035,
	// Games before form counts
	minGames: 5,
};

export const formResponsiveness = (pm: number) =>
	FORM.respLow + (FORM.respHigh - FORM.respLow) * skill01(pm);

/**
 * His form after a game. gameScore and pm (plus/minus) are this game's, min his minutes, started whether he started. resp is the coach's
 * responsiveness (formResponsiveness). Returns the new form; rbChanged when his role moved.
 */
export const updateForm = (
	prev: CoachForm | undefined,
	game: {
		season: number;
		min: number;
		gameScore: number;
		pm: number;
		started: boolean;
	},
	resp: number,
): { form: CoachForm; rbChanged: boolean } => {
	let f: CoachForm =
		prev && prev.s === game.season
			? { ...prev }
			: { s: game.season, n: 0, gs: 0, gsL: 0, pm: 0, rb: 0 };
	if (game.started) {
		f.st = 1;
	} else {
		delete f.st;
	}
	if (!(game.min >= FORM.minMin)) {
		return { form: f, rbChanged: false };
	}
	const gs36 = clamp((game.gameScore * 36) / game.min, -20, 60);
	const pm36 = clamp((game.pm * 36) / game.min, -50, 50);
	if (f.n === 0) {
		f = { ...f, gs: gs36, gsL: gs36, pm: pm36 };
	} else {
		f.gs = (1 - FORM.short) * f.gs + FORM.short * gs36;
		f.gsL = (1 - FORM.long) * f.gsL + FORM.long * gs36;
		f.pm = (1 - FORM.short) * f.pm + FORM.short * pm36;
	}
	f.n += 1;
	f.gs = round2(f.gs);
	f.gsL = round2(f.gsL);
	f.pm = round2(f.pm);
	let rbChanged = false;
	if (f.n >= FORM.minGames) {
		const score = (f.gs - f.gsL) / FORM.gsScale + f.pm / FORM.pmScale;
		const target = clamp(resp * score, -FORM.maxRole, FORM.maxRole);
		if (Math.abs(target - f.rb) >= FORM.hysteresis) {
			f.rb = round3(target);
			rbChanged = true;
		}
	}
	return { form: f, rbChanged };
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// Rest nights (beyond the second night of back-to-backs, which Injury Depth already handles)

/**
 * Chance an older star sits a regular season game for rest: none under 30 or outside the top 5, more with age and a load-management coach
 * (rest dial). Good player managers plan it a bit more evenly (a little less on their best player).
 */
export const restNightChance = ({
	age,
	rank,
	rest,
	pm,
}: {
	age: number;
	rank: number;
	rest: number;
	pm: number;
}) => {
	if (age < 30 || rank >= 5) {
		return 0;
	}
	const ageFactor = clamp(0.35 + (age - 30) * 0.22, 0.35, 1.25);
	const dial = clamp(1 + rest, 0, 2);
	const rankFactor = rank === 0 ? 0.85 + 0.15 * (1 - skill01(pm)) : 1;
	return 0.042 * ageFactor * dial * rankFactor;
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// The pregame plan

export type DecisionPlayer = {
	id: number;
	name: string;
	pos: string;
	age: number;
	// The value the coach plans with (the user's team under No Visible Ratings: the fuzzed one he sees)
	value: number;
	injured: boolean;
	// Sitting tonight for rest (flagged injured too)
	rested?: boolean;
	// Raw height and speed (0-100)
	hgt: number;
	spd: number;
	// Composite ratings (about 0-1)
	usage: number;
	three: number;
	post: number;
	perimD: number;
	interiorD: number;
	// His fit in the head coach's systems (SD), for a system coach
	fit?: number;
	// Earned / lost role (CoachForm.rb)
	rb?: number;
	// Ego trait score (0-100), when Player Traits are on
	ego?: number;
	promise?: "starter" | "rotation";
	// Started the team's last game
	lastStarter?: boolean;
};

// A team as an opposing coach reads it
export type TeamRead = {
	// Average height and speed of the likely starters
	size: number;
	speed: number;
	// Perimeter and interior defense of the rotation (value-weighted)
	perimD: number;
	interiorD: number;
	pace: number;
	star?: {
		id: number;
		name: string;
		big: boolean;
		usage: number;
	};
};

export const bestValidLineup = <T extends { pos: string }>(
	candidates: T[],
	n: number,
	score: (p: T) => number,
	poolSize: number = 9,
): T[] => {
	const cutoff = n >= 5 ? 2 : n >= 3 ? 1 : 0;
	const pool = candidates
		.toSorted((a, b) => score(b) - score(a))
		.slice(0, Math.max(poolSize, n));
	if (pool.length <= n) {
		return pool;
	}
	let best: T[] | undefined;
	let bestValue = -Infinity;
	const current: T[] = [];
	const visit = (start: number, value: number) => {
		if (current.length === n) {
			if (value > bestValue && isValidLineup(current, cutoff)) {
				bestValue = value;
				best = [...current];
			}
			return;
		}
		for (let i = start; i <= pool.length - (n - current.length); i++) {
			current.push(pool[i]!);
			visit(i + 1, value + score(pool[i]!));
			current.pop();
		}
	};
	visit(0, 0);
	return best ?? pool.slice(0, n);
};

export const isValidLineup = (players: { pos: string }[], cutoff: number) => {
	let numG = 0;
	let numPG = 0;
	let numF = 0;
	let numC = 0;
	for (const { pos } of players) {
		numG += Number(pos.includes("G"));
		numPG += Number(pos === "PG");
		numF += Number(pos.includes("F"));
		numC += Number(pos === "C");
	}
	return !((numG < cutoff && numPG === 0) || (numF < cutoff && numC === 0));
};

const isBig = (p: { pos: string; hgt: number }) =>
	p.pos === "C" || p.pos === "PF" || p.pos === "FC" || p.hgt >= 62;

/** How a coach's opponents see a team (true values; perceiveTeam adds the scouting noise). */
export const readTeam = (
	players: DecisionPlayer[],
	pace: number,
	numPlayersOnCourt: number,
): TeamRead => {
	const healthy = players
		.filter((p) => !p.injured)
		.sort((a, b) => b.value - a.value);
	const starters = bestValidLineup(healthy, numPlayersOnCourt, (p) => p.value);
	const avg = (xs: number[]) =>
		xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
	const rotation = healthy.slice(0, 8);
	let w = 0;
	let perimD = 0;
	let interiorD = 0;
	for (const [i, p] of rotation.entries()) {
		const wi = i < 5 ? 1 : 0.5;
		w += wi;
		perimD += wi * p.perimD;
		interiorD += wi * p.interiorD;
	}
	let star: DecisionPlayer | undefined;
	for (const p of healthy.slice(0, 6)) {
		if (!star || p.usage * p.value > star.usage * star.value) {
			star = p;
		}
	}
	return {
		size: avg(starters.map((p) => p.hgt)),
		speed: avg(starters.map((p) => p.spd)),
		perimD: w > 0 ? perimD / w : 0,
		interiorD: w > 0 ? interiorD / w : 0,
		pace,
		star: star
			? { id: star.id, name: star.name, big: isBig(star), usage: star.usage }
			: undefined,
	};
};

// Scouting noise: a poor preparer misreads the opponent's size by about 3 height points (SD), an elite one by about 0.6
export const PERCEPTION = {
	size: 3,
	speed: 3,
	def: 0.02,
	pace: 1.2,
	minNoise: 0.2,
};

/** The opponent as this coach reads it: the truth plus seeded noise that shrinks with Game Prep. */
export const perceiveTeam = (
	truth: TeamRead,
	prep: number,
	key: string,
): TeamRead => {
	const noise =
		PERCEPTION.minNoise + (1 - PERCEPTION.minNoise) * (1 - skill01(prep));
	return {
		...truth,
		size: truth.size + PERCEPTION.size * noise * gaussHash(`size|${key}`),
		speed: truth.speed + PERCEPTION.speed * noise * gaussHash(`spd|${key}`),
		perimD: truth.perimD + PERCEPTION.def * noise * gaussHash(`pd|${key}`),
		interiorD:
			truth.interiorD + PERCEPTION.def * noise * gaussHash(`id|${key}`),
		pace: truth.pace + PERCEPTION.pace * noise * gaussHash(`pace|${key}`),
	};
};

export type LeagueRead = {
	perimD: [number, number];
	interiorD: [number, number];
	pace: [number, number];
};

export const leagueRead = (reads: TeamRead[]): LeagueRead => {
	const ms = (xs: number[]): [number, number] => {
		if (xs.length === 0) {
			return [0, 1];
		}
		const m = xs.reduce((a, b) => a + b, 0) / xs.length;
		const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
		return [m, Math.max(1e-6, Math.sqrt(v))];
	};
	return {
		perimD: ms(reads.map((r) => r.perimD)),
		interiorD: ms(reads.map((r) => r.interiorD)),
		pace: ms(reads.map((r) => r.pace)),
	};
};

export const DECISIONS = {
	// Starters picked by style: young (<= 23) / veteran (29+) / system fit bonus to the starting score, only within the top 7
	youthStart: 0.05,
	vetStart: 0.035,
	systemStart: 0.025,
	styleTop: 7,
	promiseStart: 1.3,
	loyalStick: 0.025,
	loyalDampen: 0.7,
	// A starter who isn't among the top 5 of the rotation order is planned for at least this much (AI teams; the user's own starter floor
	// is 24, rotationPlanner.ts)
	starterFloor: 18,
	// A promised rotation spot: at least the 8th in the order, and this many minutes
	rotationFloor: 16,
	// Matchups: the size gap (height points of the likely starters) that makes a coach go big or small, and the swap's limits
	sizeGap: 7,
	speedGap: 3,
	swapHgt: 6,
	swapSpd: 6,
	swapValue: 0.93,
	swapKeyIn: 1.02,
	swapKeyOut: 0.985,
	// Defensive stopper: more minutes for him (regular season, playoffs)
	stopperMin: 0.03,
	stopperMinPlayoffs: 0.06,
	stopperStartValue: 0.85,
	// Attack weaknesses: extra minutes share for the best shooters / post players vs a weak defense
	attack: 0.06,
	// Development minutes on a rebuilding team
	devYoung: 0.18,
	devVet: 0.1,
	// High-ego stars push for minutes
	ego: 0.05,
	// Rotation style shifts: deeper vs fast teams, tighter in rivalry and national TV games, tighter as a playoff series goes on
	pace: 0.2,
	marquee: 0.12,
	seriesPerGame: 0.04,
	// Calibration: the coach's calls move minutes from the top of the order to the bench on average (a starter outside the top 5, the
	// order reshuffled by form, a stopper, development minutes), so the top 5 by value are planned this much more and the 10th man and the
	// ones after him this much less, which keeps the league's minutes by value rank where they were with the setting off (coachDecisions.script.test.ts)
	topKeep: 0.07,
	benchTrim: 0.85,
	deepBenchTrim: 0.5,
};

export type DecisionContext = {
	mind: CoachMind;
	numPlayersOnCourt: number;
	playoffs: boolean;
	rebuilding: boolean;
	marquee: boolean;
	rivalry: boolean;
	// The opponent as he reads it (perceiveTeam) and the league's teams, for what counts as weak or fast
	opp?: TeamRead;
	league?: LeagueRead;
	delegate: CoachDelegation;
	preset?: LineupPreset;
	// Playoffs: games played in this series, and whether his team lost the last one (afterLossRoll: a seeded uniform)
	seriesGames?: number;
	afterLoss?: boolean;
	afterLossRoll?: number;
};

export type MatchupSwap = {
	in: number;
	out: number;
	kind: "big" | "small" | "defense" | "change";
};

export type DecisionPlan = {
	// Ids of the starters, in a sensible order
	starters: number[];
	// Multipliers of each player's place in the rotation order (the plan's ranking value) and of his planned minutes; minutes floors
	keyMult: Map<number, number>;
	minutesMult: Map<number, number>;
	floors: Map<number, number>;
	rotationShift: number;
	stopper?: { defender: number; target: number };
	swap?: MatchupSwap;
	// A swap the coach considered but didn't make (made at halftime if the game goes badly)
	altSwap?: MatchupSwap;
	notes: string[];
	// The notes that come from ratings the user may not see (who defends best, system fit, the opponent's defense): left out of the stored
	// note under No Visible Ratings
	ratingNotes: Set<string>;
	// For the diagnostics
	diag: {
		styleStarter: boolean;
		matchupChange: boolean;
		promiseHonored: number;
		injuryBench: boolean;
		lossChange: boolean;
	};
};

const mult = (m: Map<number, number>, id: number, x: number) => {
	m.set(id, (m.get(id) ?? 1) * x);
};

const lastName = (name: string) => {
	const parts = name.split(" ");
	return parts.length > 1 ? parts.slice(1).join(" ") : name;
};

/**
 * The coach's plan for a game: starters, the rotation order, minutes, the stopper and the matchup swap, with the notes that explain the
 * changes (in words only: no ratings, so nothing leaks under No Visible Ratings). players: the team's players (injured and rested ones
 * flagged injured). Deterministic.
 */
export const planCoachDecisions = (
	players: DecisionPlayer[],
	ctx: DecisionContext,
): DecisionPlan => {
	const { mind, numPlayersOnCourt: n, delegate } = ctx;
	const prep = skill01(mind.prep);
	const pm = skill01(mind.pm);
	const plan: DecisionPlan = {
		starters: [],
		keyMult: new Map(),
		minutesMult: new Map(),
		floors: new Map(),
		rotationShift: 0,
		notes: [],
		ratingNotes: new Set(),
		diag: {
			styleStarter: false,
			matchupChange: false,
			promiseHonored: 0,
			injuryBench: false,
			lossChange: false,
		},
	};
	const healthy = players.filter((p) => !p.injured);
	if (healthy.length < n) {
		plan.starters = healthy.map((p) => p.id);
		return plan;
	}
	const byValue = healthy.toSorted((a, b) => b.value - a.value);
	const valueRank = new Map(byValue.map((p, i) => [p.id, i]));
	const cutoff = n >= 5 ? 2 : n >= 3 ? 1 : 0;

	// ---- Rotation order: earned and lost roles, loyalty ----
	const rbEff = new Map<number, number>();
	for (const p of healthy) {
		let rb = p.rb ?? 0;
		if (p.lastStarter && p.age >= 28) {
			if (rb < 0) {
				// A loyal coach sticks with a slumping veteran; a "what have you done lately" coach doesn't
				rb *=
					mind.loyalty >= 0
						? 1 - DECISIONS.loyalDampen * mind.loyalty
						: 1 - 0.5 * mind.loyalty;
			}
		}
		rbEff.set(p.id, rb);
	}
	if (delegate.rotation) {
		for (const p of healthy) {
			const rb = rbEff.get(p.id)!;
			if (rb !== 0) {
				mult(plan.keyMult, p.id, 1 + rb);
			}
		}
		// Promised rotation spots: at least the 8th in the order
		const keyed = healthy
			.map((p) => ({ p, key: p.value * (plan.keyMult.get(p.id) ?? 1) }))
			.sort((a, b) => b.key - a.key);
		const eighth = keyed[Math.min(7, keyed.length - 1)]!.key;
		for (const { p, key } of keyed) {
			if (p.promise && key < eighth && key > 0) {
				mult(plan.keyMult, p.id, (eighth * 1.001) / key);
				plan.floors.set(p.id, DECISIONS.rotationFloor);
			} else if (p.promise === "rotation") {
				plan.floors.set(p.id, DECISIONS.rotationFloor);
			}
		}
		// Notes: the biggest earned and lost roles among the top 10
		const top = byValue.slice(0, 10);
		const up = top
			.filter((p) => rbEff.get(p.id)! >= 0.06)
			.sort((a, b) => rbEff.get(b.id)! - rbEff.get(a.id)!)[0];
		const down = top
			.filter((p) => rbEff.get(p.id)! <= -0.06)
			.sort((a, b) => rbEff.get(a.id)! - rbEff.get(b.id)!)[0];
		if (up) {
			plan.notes.push(
				`${up.name} has earned a bigger role with his recent play.`,
			);
		}
		if (down) {
			plan.notes.push(`${down.name}'s role shrinks after a rough stretch.`);
		}
	}
	const keyOf = (p: DecisionPlayer) => p.value * (plan.keyMult.get(p.id) ?? 1);

	// ---- Starters ----
	const devLean = clamp((mind.philosophy - 0.2) / 0.6, 0, 1);
	const vetLean = clamp((-mind.philosophy - 0.2) / 0.6, 0, 1);
	const startScore = (p: DecisionPlayer) => {
		let s = keyOf(p);
		if (!delegate.starters) {
			return s;
		}
		const rank = valueRank.get(p.id) ?? 99;
		if (rank < DECISIONS.styleTop) {
			if (mind.style === "youth" && p.age <= 23) {
				s *= 1 + DECISIONS.youthStart * devLean;
			} else if (mind.style === "veteran" && p.age >= 29) {
				s *= 1 + DECISIONS.vetStart * vetLean;
			} else if (mind.style === "system" && p.fit !== undefined) {
				s *= 1 + DECISIONS.systemStart * clamp(p.fit, -2, 2);
			}
		}
		if (p.promise === "starter") {
			s *= DECISIONS.promiseStart;
		}
		if (p.lastStarter && mind.loyalty > 0) {
			s *= 1 + DECISIONS.loyalStick * mind.loyalty;
		}
		return s;
	};
	const presetScore = (p: DecisionPlayer): number => {
		const base = keyOf(p);
		switch (ctx.preset) {
			case "big":
				return base * (1 + 0.012 * (p.hgt - 50));
			case "small":
				return base * (1 + 0.01 * (p.spd - 50) - 0.008 * (p.hgt - 50));
			case "defense":
				return base * (1 + 2.5 * (Math.max(p.perimD, p.interiorD) - 0.5));
			case "closing":
				return p.value;
			default:
				return startScore(p);
		}
	};
	let starters = bestValidLineup(healthy, n, presetScore);
	// The ones the plain value order would start
	const valueStarters = new Set(
		bestValidLineup(healthy, n, (p) => p.value).map((p) => p.id),
	);
	if (delegate.starters && !ctx.preset) {
		const styled = starters.filter((p) => !valueStarters.has(p.id));
		if (styled.length > 0) {
			plan.diag.styleStarter = true;
			const promised = styled.filter((p) => p.promise === "starter");
			plan.diag.promiseHonored += promised.length;
			for (const p of styled) {
				if (p.promise === "starter") {
					plan.notes.push(`${p.name} starts, as promised when he signed.`);
				} else if (mind.style === "youth" && p.age <= 23) {
					plan.notes.push(
						`${p.name} starts: the coach is bringing his young players along.`,
					);
				} else if (mind.style === "veteran" && p.age >= 29) {
					plan.notes.push(`${p.name} starts: the coach trusts his veterans.`);
				} else if (mind.style === "system") {
					const note = `${p.name} starts: he fits what the coach runs.`;
					plan.notes.push(note);
					plan.ratingNotes.add(note);
				} else if (p.lastStarter) {
					plan.notes.push(`${p.name} keeps his starting job.`);
				} else {
					plan.notes.push(`${p.name} moves into the starting lineup.`);
				}
			}
		}
		for (const p of starters) {
			if (p.promise === "starter" && valueStarters.has(p.id)) {
				plan.diag.promiseHonored += 1;
			}
		}
	}

	// ---- Injury replacement: the usual starters with everyone healthy ----
	if (delegate.starters && !ctx.preset) {
		const usual = bestValidLineup(players, n, startScore);
		const missing = usual.filter((p) => p.injured);
		if (missing.length > 0 && mind.injuryNext <= -0.2) {
			// Keep the bench unit together: a deep reserve starts, the 6th and 7th men (the best two who usually come off the bench)
			// keep their bench roles
			const usualIds = new Set(usual.map((p) => p.id));
			const benchKeyed = healthy
				.filter((p) => !usualIds.has(p.id))
				.sort((a, b) => keyOf(b) - keyOf(a));
			const sixth = benchKeyed[0];
			const benchCore = new Set(benchKeyed.slice(0, 2).map((p) => p.id));
			const current = new Set(starters.map((p) => p.id));
			for (const m of missing) {
				const replacing = starters.find((p) => benchCore.has(p.id));
				if (!replacing || !sixth) {
					break;
				}
				const big = isBig(m);
				const reserve = benchKeyed
					.slice(2, 11 - n)
					.filter(
						(p) =>
							!current.has(p.id) &&
							isBig(p) === big &&
							p.value >= 0.88 * sixth.value,
					)[0];
				if (!reserve) {
					continue;
				}
				const next = starters.map((p) => (p === replacing ? reserve : p));
				if (!isValidLineup(next, cutoff)) {
					continue;
				}
				starters = next;
				current.delete(replacing.id);
				current.add(reserve.id);
				plan.diag.injuryBench = true;
				plan.notes.push(
					`${reserve.name} starts for ${m.rested ? "the resting" : "the injured"} ${m.name}; ${replacing.name} stays with the second unit.`,
				);
			}
		}
	}

	// ---- Matchups: big or small, the stopper, after a playoff loss ----
	const starterIds = () => new Set(starters.map((p) => p.id));
	const swapIn = (swap: MatchupSwap) => {
		starters = starters.map((p) =>
			p.id === swap.out ? healthy.find((q) => q.id === swap.in)! : p,
		);
	};
	const findSwap = (
		kind: "big" | "small",
		relax: number,
	): MatchupSwap | undefined => {
		const ids = starterIds();
		const protectedIds = new Set(byValue.slice(0, 2).map((p) => p.id));
		const outs = starters
			.filter((p) => !protectedIds.has(p.id) && p.promise !== "starter")
			.sort((a, b) => (kind === "big" ? a.hgt - b.hgt : b.hgt - a.hgt));
		for (const out of outs) {
			const ins = healthy
				.filter(
					(p) =>
						!ids.has(p.id) &&
						(valueRank.get(p.id) ?? 99) < 9 &&
						p.value >= (DECISIONS.swapValue - relax) * out.value &&
						(kind === "big"
							? p.hgt >= out.hgt + DECISIONS.swapHgt - 2 * relax * 10
							: p.spd >= out.spd + DECISIONS.swapSpd - 2 * relax * 10 &&
								p.hgt <= out.hgt - 2),
				)
				.sort((a, b) => b.value - a.value);
			for (const p of ins) {
				const next = starters.map((q) => (q.id === out.id ? p : q));
				if (isValidLineup(next, cutoff)) {
					return { in: p.id, out: out.id, kind };
				}
			}
		}
		return undefined;
	};
	const nameOf = (id: number) => players.find((p) => p.id === id)?.name ?? "";
	if (delegate.matchups && ctx.opp && !ctx.preset) {
		const opp = ctx.opp;
		const ourSize =
			starters.reduce((a, p) => a + p.hgt, 0) / Math.max(1, starters.length);
		const ourSpeed =
			starters.reduce((a, p) => a + p.spd, 0) / Math.max(1, starters.length);
		const sizeGap = opp.size - ourSize;
		const speedGap = opp.speed - ourSpeed;
		let kind: "big" | "small" | undefined;
		if (sizeGap >= DECISIONS.sizeGap) {
			kind = "big";
		} else if (
			sizeGap <= -DECISIONS.sizeGap &&
			speedGap >= DECISIONS.speedGap
		) {
			kind = "small";
		}
		if (kind) {
			const swap = findSwap(kind, 0);
			if (swap) {
				plan.swap = swap;
				swapIn(swap);
				plan.diag.matchupChange = true;
				plan.notes.push(
					`Starting ${nameOf(swap.in)} over ${lastName(nameOf(swap.out))} tonight: ${
						kind === "big" ? "their frontcourt is big" : "their lineup is small"
					}.`,
				);
			}
		} else {
			// What he'd do if the game goes badly (made at halftime)
			const altKind = sizeGap >= 0 ? "big" : "small";
			plan.altSwap = findSwap(altKind, 0.05);
		}

		// Defensive stopper on their best scorer
		const star = opp.star;
		if (star && (mind.prep >= 45 || ctx.playoffs)) {
			const pool = healthy
				.filter((p) => (valueRank.get(p.id) ?? 99) < 8)
				.sort((a, b) =>
					star.big ? b.interiorD - a.interiorD : b.perimD - a.perimD,
				);
			const stopper = pool[0];
			if (stopper) {
				plan.stopper = { defender: stopper.id, target: star.id };
				mult(
					plan.minutesMult,
					stopper.id,
					1 +
						(ctx.playoffs
							? DECISIONS.stopperMinPlayoffs
							: DECISIONS.stopperMin * (0.5 + prep)),
				);
				// Start him when the opponent's star is the whole show (playoffs or a good preparer), unless a swap was made already
				const ids = starterIds();
				if (
					!plan.swap &&
					!ids.has(stopper.id) &&
					(ctx.playoffs || mind.prep >= 70)
				) {
					const out = starters
						.filter(
							(p) =>
								(valueRank.get(p.id) ?? 0) >= 2 &&
								p.promise !== "starter" &&
								isBig(p) === isBig(stopper) &&
								stopper.value >= DECISIONS.stopperStartValue * p.value,
						)
						.sort((a, b) =>
							star.big ? a.interiorD - b.interiorD : a.perimD - b.perimD,
						)[0];
					if (out) {
						const next = starters.map((p) => (p.id === out.id ? stopper : p));
						if (isValidLineup(next, cutoff)) {
							plan.swap = { in: stopper.id, out: out.id, kind: "defense" };
							starters = next;
							plan.diag.matchupChange = true;
							const note = `${stopper.name} starts to guard ${star.name}.`;
							plan.notes.push(note);
							plan.ratingNotes.add(note);
						}
					}
				}
				if (!plan.swap || plan.swap.in !== stopper.id) {
					const note = `${stopper.name} draws the assignment on ${star.name}.`;
					plan.notes.push(note);
					plan.ratingNotes.add(note);
				}
			}
		}

		// Playoffs: a lineup change after a loss, by his adaptability
		if (
			ctx.playoffs &&
			ctx.afterLoss &&
			!plan.swap &&
			(ctx.afterLossRoll ?? 1) <
				0.15 + 0.5 * skill01(mind.adapt) * (0.6 + 0.4 * prep)
		) {
			const swap =
				findSwap(sizeGap >= 0 ? "big" : "small", 0.08) ??
				(() => {
					// The 6th man in for the starter in the worst form
					const ids = starterIds();
					const sixth = healthy
						.filter((p) => !ids.has(p.id))
						.sort((a, b) => keyOf(b) - keyOf(a))[0];
					const out = starters
						.filter(
							(p) => (valueRank.get(p.id) ?? 0) >= 2 && p.promise !== "starter",
						)
						.sort((a, b) => (rbEff.get(a.id) ?? 0) - (rbEff.get(b.id) ?? 0))[0];
					if (!sixth || !out) {
						return undefined;
					}
					const next = starters.map((p) => (p.id === out.id ? sixth : p));
					return isValidLineup(next, cutoff)
						? ({ in: sixth.id, out: out.id, kind: "change" } as MatchupSwap)
						: undefined;
				})();
			if (swap) {
				plan.swap = { ...swap, kind: "change" };
				swapIn(swap);
				plan.diag.lossChange = true;
				plan.diag.matchupChange = true;
				plan.notes.push(
					`After the loss, ${nameOf(swap.in)} replaces ${lastName(nameOf(swap.out))} in the starting lineup.`,
				);
			}
		}
		if (plan.swap) {
			mult(plan.keyMult, plan.swap.in, DECISIONS.swapKeyIn);
			mult(plan.keyMult, plan.swap.out, DECISIONS.swapKeyOut);
		}
	}

	// ---- Minutes ----
	if (delegate.minutes) {
		// (calibration, see DECISIONS.topKeep)
		for (const [rank, p] of byValue.entries()) {
			if (rank < 5) {
				mult(plan.minutesMult, p.id, 1 + DECISIONS.topKeep);
			} else if (rank >= 9) {
				mult(
					plan.minutesMult,
					p.id,
					rank === 9 ? DECISIONS.benchTrim : DECISIONS.deepBenchTrim,
				);
			}
		}
		// Development minutes: a rebuilding team plays its young players
		if (ctx.rebuilding && !ctx.playoffs) {
			const lean = clamp((mind.philosophy + 0.3) / 1.0, 0, 1);
			if (lean > 0) {
				let any = false;
				for (const p of byValue.slice(0, 11)) {
					if (p.age <= 23) {
						mult(plan.minutesMult, p.id, 1 + DECISIONS.devYoung * lean);
						any = true;
					} else if (p.age >= 30) {
						mult(plan.minutesMult, p.id, 1 - DECISIONS.devVet * lean);
					}
				}
				if (any && lean >= 0.5) {
					plan.notes.push("Rebuilding: more minutes for the young players.");
				}
			}
		}
		// High-ego stars push for minutes (a strong player manager holds the line)
		for (const p of byValue.slice(0, 3)) {
			if (p.ego !== undefined && p.ego > 60) {
				mult(
					plan.minutesMult,
					p.id,
					1 + DECISIONS.ego * clamp((p.ego - 60) / 40, 0, 1) * (1.2 - pm),
				);
			}
		}
		// Attack weaknesses
		if (ctx.opp && ctx.league && (delegate.matchups || !ctx.preset)) {
			const rotation = byValue.slice(0, 9);
			const attack = (
				weakZ: number,
				skill: (p: DecisionPlayer) => number,
				note: string,
			) => {
				const w = clamp((weakZ - 0.5) / 1.5, 0, 1) * (0.5 + 0.5 * prep);
				if (w <= 0) {
					return;
				}
				const best = rotation.toSorted((a, b) => skill(b) - skill(a));
				for (const [i, p] of best.slice(0, 3).entries()) {
					mult(
						plan.minutesMult,
						p.id,
						1 + DECISIONS.attack * w * [1, 0.6, 0.3][i]!,
					);
				}
				if (w >= 0.3) {
					plan.notes.push(note);
					plan.ratingNotes.add(note);
				}
			};
			attack(
				(ctx.league.perimD[0] - ctx.opp.perimD) / ctx.league.perimD[1],
				(p) => p.three,
				"Their perimeter defense is weak: more minutes for the shooters.",
			);
			attack(
				(ctx.league.interiorD[0] - ctx.opp.interiorD) / ctx.league.interiorD[1],
				(p) => p.post,
				"They are soft inside: more minutes for the post players.",
			);
		}
		// Opponent pace: deeper against fast teams, tighter against slow ones
		if (ctx.opp && ctx.league) {
			const z = clamp(
				(ctx.opp.pace - ctx.league.pace[0]) / ctx.league.pace[1],
				-1.5,
				1.5,
			);
			plan.rotationShift += DECISIONS.pace * z;
			if (z >= 1) {
				plan.notes.push("A fast opponent: a deeper bench tonight.");
			} else if (z <= -1) {
				plan.notes.push("A slow opponent: a tighter rotation tonight.");
			}
		}
		// Rivalry and national TV games: a tighter rotation
		if (ctx.marquee || ctx.rivalry) {
			plan.rotationShift -= DECISIONS.marquee;
		}
		// Playoffs: tighter as the series goes on (more for a good game preparer)
		if (ctx.playoffs && ctx.seriesGames) {
			plan.rotationShift -=
				DECISIONS.seriesPerGame *
				Math.min(6, ctx.seriesGames) *
				(0.6 + 0.4 * prep);
		}
		if (ctx.preset === "rest") {
			for (const p of byValue.slice(0, 3)) {
				mult(plan.minutesMult, p.id, 0.85);
			}
			plan.notes.push("A rest night: the stars play fewer minutes.");
		}
	}

	// Starters outside the top of the rotation order get a minutes floor
	const keyed = healthy.toSorted((a, b) => keyOf(b) - keyOf(a));
	const top = new Set(keyed.slice(0, n).map((p) => p.id));
	for (const p of starters) {
		if (!top.has(p.id)) {
			plan.floors.set(
				p.id,
				Math.max(plan.floors.get(p.id) ?? 0, DECISIONS.starterFloor),
			);
		}
	}

	// Starting order: guards first, bigs last (only the set matters to the sim)
	const posOrder = (pos: string) =>
		["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"].indexOf(pos);
	plan.starters = starters
		.toSorted((a, b) => posOrder(a.pos) - posOrder(b.pos))
		.map((p) => p.id);
	plan.notes = plan.notes.slice(0, 4);
	return plan;
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// In-game

/** The sim's settings from the coach (t.coachDecisions in the game sim). */
export type CoachGameSettings = {
	// Foul trouble: -1 by the book ... 1 rides it
	ride: number;
	// Size of the hot/cold hand minutes changes at breaks (1 = the old size)
	hotScale: number;
	// Weight of tonight's play in the closing lineup
	closerForm: number;
	// Late in a close game when ahead: how much a poor free throw shooter's closing value is cut (the other team may foul)
	ftSubs: number;
	// Defensive stopper (ids: his defender, their scorer)
	stopper?: [number, number];
	swap?: MatchupSwap;
	altSwap?: MatchupSwap;
	// Halftime changes (matchup changes are his to make)
	halftime: boolean;
	// Responsiveness of the rotation order to form (written back after the game, see updateForm)
	resp: number;
};

export const coachGameSettings = (
	mind: CoachMind,
	plan: DecisionPlan | undefined,
	delegate: CoachDelegation,
): CoachGameSettings => ({
	ride: delegate.minutes || delegate.rotation ? mind.foulRide : 0,
	hotScale: delegate.rotation ? 0.75 + 0.5 * skill01(mind.pm) : 1,
	closerForm: delegate.rotation ? 0.06 + 0.1 * skill01(mind.prep) : 0,
	ftSubs: delegate.rotation ? 1.2 * skill01(mind.prep) : 0,
	stopper:
		plan?.stopper && delegate.matchups
			? [plan.stopper.defender, plan.stopper.target]
			: undefined,
	swap: delegate.matchups ? plan?.swap : undefined,
	altSwap: delegate.matchups ? plan?.altSwap : undefined,
	halftime: delegate.matchups,
	resp: formResponsiveness(mind.pm),
});

// Halftime: trailing by this much, the coach undoes a matchup swap that isn't working (or makes the one he held back), moving this many
// minutes of the plan
export const HALFTIME = {
	trail: 8,
	trailAlt: 12,
	minutes: 4,
};
