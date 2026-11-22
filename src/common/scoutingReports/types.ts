// Scouting reports (League Extras: Scouting Reports). Everything here is pure: the worker gathers what the user's scouts can see
// (ratings with scouting fuzz, visible traits, stats, measurements) into a ScoutInput and these modules write the report. Nothing here may
// ever be handed true ratings of a prospect, hidden trait scores that are not yet known, or the secret aging curve.

export const GRADE_KEYS = [
	"shoot",
	"cs",
	"od",
	"ft",
	"fin",
	"pm",
	"bs",
	"reb",
	"pd",
	"id",
	"ath",
	"size",
	"iq",
	"motor",
] as const;

export type GradeKey = (typeof GRADE_KEYS)[number];

export type PeerGroup = "guard" | "wing" | "big";

// Ratings as the user sees them (fuzz applied to everything but height and wingspan)
export type ScoutRatings = {
	hgt: number;
	stre: number;
	spd: number;
	jmp: number;
	endu: number;
	ins: number;
	dnk: number;
	ft: number;
	fg: number;
	tp: number;
	oiq: number;
	diq: number;
	drb: number;
	pss: number;
	reb: number;
	ovr: number;
	pot: number;
	// Expanded ratings, only with that setting on
	wng?: number;
	pdef?: number;
	idef?: number;
	oreb?: number;
	dreb?: number;
	csh?: number;
	dsh?: number;
	bsc?: number;
	// Sub-ratings (the subRatings setting), SUB_DEFS order, with scouting fuzz
	sub?: number[];
};

// One season of production, per game (percentages 0-100)
export type ScoutProduction = {
	season: number;
	team: string;
	level: "pro" | "college" | "overseas" | "juco" | "other";
	gp: number;
	min: number;
	pts: number;
	trb: number;
	orb: number;
	ast: number;
	tov: number;
	stl: number;
	blk: number;
	fga: number;
	fgPct: number;
	tpa: number;
	tpPct: number;
	fta: number;
	ftPct: number;
	// Shot locations per game (pro seasons only)
	rimA?: number;
	rimPct?: number;
	postA?: number;
	postPct?: number;
	midA?: number;
	midPct?: number;
	per?: number;
	usg?: number;
	ws48?: number;
	bpm?: number;
};

export type ScoutTraitReading = {
	key: string;
	name: string;
	hidden: boolean;
	// Only set when the user can see a number: the estimate (exact once known, the middle of the scouting range before)
	estimate: number;
	low: number;
	high: number;
	exact: boolean;
};

export type ScoutInjury = {
	season: number;
	type: string;
	part: string;
	games: number;
};

export type ScoutCombine = { label: string; value: string; pct: number }[];

export type PlayerKind = "prospect" | "pro" | "retired";

export type RoleScale = {
	// Visible ovr needed for each role, from the league's own players (rank thresholds)
	franchise: number;
	allStar: number;
	qualityStarter: number;
	starter: number;
	rotation: number;
	bench: number;
};

export type ScoutComp = {
	pid: number;
	name: string;
	// "2031 draft, No. 4" or "at 24 (2033)"
	when: string;
	// What he became / what he was, from the league's records
	outcome: string;
	similarity: number;
};

export type ScoutInput = {
	pid: number;
	name: string;
	kind: PlayerKind;
	pos: string;
	age: number;
	heightInches: number;
	weight: number;
	season: number;
	// undefined when ratings are hidden (no visible ratings challenge): the report is written from production
	ratings?: ScoutRatings;
	// Last season's ratings as seen then, for trends (pros)
	prevRatings?: ScoutRatings;
	production?: ScoutProduction;
	prevProduction?: ScoutProduction;
	// Pro seasons with real minutes
	proSeasons: number;
	// Draft-year production (prospects and drafted pros, for "age vs production" and "competition level")
	preDraft?: ScoutProduction;
	traits?: ScoutTraitReading[];
	injuries: ScoutInjury[];
	// Current injury, if any
	injury?: { type: string; part: string; games: number };
	combine?: ScoutCombine;
	// Draft Lottery Night & Combine setting: what the combine measured (size) and tested (athleticism), which narrows those grades,
	// and its lines for the report
	combineTested?: { size: boolean; ath: boolean };
	combineNotes?: string[];
	archetype?: string;
	builds2k?: string[];
	// Scouting looks this season (scouting system), undefined without it
	looks?: number;
	// Scout Specialties & Assignments: scouts' focus areas sharpen reports on prospects in them
	scoutFocus?: boolean;
	// Remaining uncertainty about his ratings, in rating points (never from the true fuzz: from scouting actions and the budget)
	uncertainty: number;
	draft: { year: number; round: number; pick: number; abbrev?: string };
	// Prospects: where the user's board / the consensus has him
	projectedPick?: number;
	// Prospects: trajectory signals for the projection cone (pre-draft production year over year, our scouts' grade over time)
	trajectory?: import("./cone.ts").Trajectory;
	numPicks: number;
	contract?: { amount: number; exp: number; rookie?: boolean };
	// What his production and ratings would get on the market, thousands per year
	marketValue?: number;
	salaryCap: number;
	awards: {
		allStar: number;
		allLeague: number;
		mvp: number;
		dpoy: number;
		champ: number;
		roy: number;
	};
	// Retired: his best visible ovr and the season
	peak?: { ovr: number; season: number; age: number };
	expandedRatings: boolean;
	story?: string;
	// Team fit, from the user's team point of view
	fit?: ScoutTeamFit;
	comps: ScoutComp[];
	roleScale: RoleScale;
	// The user's head coach's development philosophy (-1 win-now ... 1 development) and his development staff rating (0-100), when known
	development?: { philosophy?: number; staffDev?: number; coachName?: string };
	teamName?: string;
	// Same team as the user
	onUserTeam: boolean;
	retiredSeason?: number;
	// Prospects' full reports: the public facts the strengths & weaknesses read beyond the draft-year line (skills.ts)
	skills?: SkillSignals;
};

// ---- Strengths & weaknesses (skills.ts) ----

// One pre-draft season, totals (only public stats: the College/Overseas page shows the same numbers)
export type SkillSeasonLine = {
	season: number;
	age: number;
	level: ScoutProduction["level"];
	// Level of competition on the conference scale (75 = an average power-conference schedule)
	strength: number;
	gp: number;
	min: number;
	pts: number;
	orb: number;
	drb: number;
	ast: number;
	tov: number;
	stl: number;
	blk: number;
	pf: number;
	fg: number;
	fga: number;
	tp: number;
	tpa: number;
	ft: number;
	fta: number;
	// Shot locations (0 when not tracked)
	rimA: number;
	rim: number;
	postA: number;
	post: number;
	midA: number;
	mid: number;
	// His shots that were blocked
	ba: number;
	usg?: number;
};

// A stretch of games, totals (non-conference, conference play)
export type SkillSplit = {
	gp: number;
	min: number;
	pts: number;
	orb: number;
	drb: number;
	ast: number;
	stl: number;
	blk: number;
	tov: number;
	fg: number;
	fga: number;
	tp: number;
	tpa: number;
	ft: number;
	fta: number;
	pf: number;
};

// One of his postseason games (conference tournament, NCAA tournament, NIT)
export type SkillGame = {
	event: "conf" | "ncaa" | "nit";
	// Against a strong opponent: an NCAA tournament game, or a seeded opponent seeded higher than his team
	strong: boolean;
	won: boolean;
	min: number;
	pts: number;
	fg: number;
	fga: number;
	tp: number;
	tpa: number;
	gmsc: number;
};

export type SkillSignals = {
	// Pre-draft seasons, oldest first
	seasons: SkillSeasonLine[];
	// Draft-year season split into non-conference (November-December) and conference play (January-March)
	splits?: { nonConf: SkillSplit; conf: SkillSplit };
	games?: SkillGame[];
	// Age- and schedule-adjusted production (game score per 40, collegeStats/production.ts)
	ageAdjusted?: number;
	// Public: the hand he shoots with (shootingHand.ts)
	hand?: "left" | "right";
	// The combine (measurements are public): wingspan minus height without shoes, measured minus listed height in shoes and weight,
	// drill effort (missing = full), skipped drills, shooting drills (makes / attempts)
	combine?: {
		apeIndex?: number;
		heightVsListed?: number;
		weightVsListed?: number;
		weight?: number;
		effort?: number;
		skipped?: boolean;
		spotUp?: [number, number];
		offDribble?: [number, number];
		sprintPct?: number;
		agilityPct?: number;
		benchPct?: number;
	};
	// Real Player Comps (none under the no visible ratings challenge)
	realComp?: {
		name: string;
		season: string;
		age: number;
		similarity: string;
		became: string;
	};
	// What his archetype label rests on, in words (no numbers)
	archetypeWhy?: string[];
	// His class's average trait reading (the scouts' view), so a motor or temper read means he stands out in his class
	traitCenters?: Record<string, number>;
	// Last season's report: our grades of him then (GRADE_KEYS order), for trend arrows
	prev?: { season: number; grades: number[] };
};

export type SkillTier = "elite" | "plus" | "average" | "minus" | "major";

export type SkillFamily =
	| "skill"
	| "situational"
	| "consistency"
	| "mechanics"
	| "feel"
	| "defense"
	| "physical"
	| "motor"
	| "role";

export type SkillEvidence = {
	src: "stats" | "splits" | "combine" | "film" | "traits";
	text: string;
};

export type SkillItem = {
	key: string;
	family: SkillFamily;
	side: "strength" | "weakness";
	tier: SkillTier;
	tierLabel: string;
	title: string;
	text: string;
	evidence: SkillEvidence[];
	// Vs last season's report
	trend?: { dir: "up" | "down" | "flat"; text: string };
	// Weaknesses: can development fix it, and the development plan focus that targets it
	fix?: { fixable: boolean; text: string; focus?: string };
	// The second scout sees it differently
	dissent?: string;
};

export type SkillReport = {
	strengths: SkillItem[];
	weaknesses: SkillItem[];
	swing: {
		key: GradeKey;
		skill: string;
		text: string;
		evidence?: SkillEvidence;
	};
	role: {
		text: string;
		risk: "Low" | "Moderate" | "High" | "Very high";
		why: string;
	};
	anchor?: string;
	contradictions: string[];
	certainty: "confident" | "measured" | "hedged";
	certaintyNote: string;
	// The lead scout's lean, as the report words it
	voice: string;
};

export type ScoutTeamFit = {
	teamName: string;
	// Players on the user's roster in his group, best first: name, visible ovr
	sameGroup: { name: string; ovr: number; age: number }[];
	// The user roster's grade in each category (median of top rotation), for "fills a need"
	rosterNeeds: GradeKey[];
	rosterStrengths: GradeKey[];
	// Coach systems (setting): his fit to the user's head coach's systems, 0-100 (50 typical)
	systemFit?: {
		score: number;
		offense: string;
		defense: string;
		coach: string;
	};
};

export type Specialty =
	| "college"
	| "international"
	| "pro"
	| "athletes"
	| "shooters";

export type ScoutBias =
	| "none"
	| "athletes"
	| "shooters"
	| "size"
	| "production"
	| "tools"
	| "harsh"
	| "generous"
	| "youth";

export type Scout = {
	id: number;
	tid: number;
	slot: number;
	name: string;
	// Year hired, and the year he leaves (exclusive; may be in the future)
	since: number;
	until: number;
	age: number;
	specialty: Specialty;
	// 0-1
	quality: number;
	bias: ScoutBias;
	seed: string;
};

export type ScoutDepartment = {
	tid: number;
	season: number;
	level: number;
	// 0-1 (0.5 = an average department)
	quality: number;
	scouts: Scout[];
};

export type GradeRow = {
	key: GradeKey;
	label: string;
	// Grade index (0 = F, 12 = A+): the scout's call and the range he would sign off on
	grade: number;
	lo: number;
	hi: number;
	// 0-100 score before the grade (for charts)
	score: number;
	line: string;
	sub?: boolean;
};

export type ReportFlag = { text: string; tone: "red" | "green" };

export type ScoutTake = {
	scoutId: number;
	grades: GradeRow[];
	overall: { grade: number; lo: number; hi: number };
	// Projected role tiers (0 = out of the league ... 6 = franchise player)
	floor: number;
	ceiling: number;
	expected: number;
};

export type FullReport = {
	pid: number;
	name: string;
	kind: PlayerKind;
	byline: { lead: ScoutBrief; second?: ScoutBrief };
	header: {
		archetype?: string;
		builds2k?: string[];
		comps: (ScoutComp & { line: string })[];
		floorText: string;
		ceilingText: string;
		rangeLine: string;
		confidence: "Low" | "Medium" | "High" | "Very high";
		confidenceNote: string;
		// Prospects: the projection cone (projected peak floor / median / ceiling)
		cone?: import("./cone.ts").Cone;
	};
	reference: string;
	grades: GradeRow[];
	overall: { grade: number; lo: number; hi: number };
	offense: string[];
	shotMix?: { label: string; share: number; pct?: number }[];
	selfCreated?: number;
	defense: string[];
	physical: string[];
	combine?: ScoutCombine;
	intangibles: { name: string; text: string; known: boolean }[];
	flags: ReportFlag[];
	development: string[];
	fit: string[];
	pro?: {
		role: string;
		trend: "improving" | "declining" | "stable";
		trendLine: string;
		idealRole: string;
		contract?: string;
		usage: string;
	};
	retro?: string;
	// Prospects' full reports: strengths & weaknesses, swing skill, NBA role and risk (skills.ts)
	skills?: SkillReport;
	bottomLine: string;
	// For the history, the blurbs, AI and rumors
	take: ScoutTake;
	secondTake?: ScoutTake;
};

export type ScoutBrief = {
	id: number;
	name: string;
	specialty: Specialty;
	quality: number;
	bias: ScoutBias;
	title: string;
	// Scout Specialties: his focus, and whether this player is in it
	focus?: string;
	inFocus?: boolean;
};
