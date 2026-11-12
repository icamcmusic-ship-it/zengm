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

export type ScoutInjury = { season: number; type: string; part: string; games: number };

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
	archetype?: string;
	builds2k?: string[];
	// Scouting looks this season (scouting system), undefined without it
	looks?: number;
	// Remaining uncertainty about his ratings, in rating points (never from the true fuzz: from scouting actions and the budget)
	uncertainty: number;
	draft: { year: number; round: number; pick: number; abbrev?: string };
	// Prospects: where the user's board / the consensus has him
	projectedPick?: number;
	numPicks: number;
	contract?: { amount: number; exp: number; rookie?: boolean };
	// What his production and ratings would get on the market, thousands per year
	marketValue?: number;
	salaryCap: number;
	awards: { allStar: number; allLeague: number; mvp: number; dpoy: number; champ: number; roy: number };
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
};

export type ScoutTeamFit = {
	teamName: string;
	// Players on the user's roster in his group, best first: name, visible ovr
	sameGroup: { name: string; ovr: number; age: number }[];
	// The user roster's grade in each category (median of top rotation), for "fills a need"
	rosterNeeds: GradeKey[];
	rosterStrengths: GradeKey[];
	// Coach systems (setting): his fit to the user's head coach's systems, 0-100 (50 typical)
	systemFit?: { score: number; offense: string; defense: string; coach: string };
};

export type Specialty = "college" | "international" | "pro" | "athletes" | "shooters";

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
};
