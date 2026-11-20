// Coach of the Year and Executive of the Year (League Extra coachExecAwards, basketball): built-in front office awards, scored by
// editable formulas (Award Settings) from team-season variables. Pure data and helpers shared by the worker and the UI. See
// docs/native-features.md (Coach & Executive of the Year).

export const COACH_OF_THE_YEAR = "Coach of the Year";
export const EXEC_OF_THE_YEAR = "Executive of the Year";

// Keys of these awards on Award History (the award dropdown and URL) and Award Races. Player award abbrevs are user defined, so
// these are long names that won't collide with one
export const COY_KEY = "coach_of_the_year";
export const EOY_KEY = "executive_of_the_year";

export type CoachExecAwardKind = "coy" | "eoy";

export const COACH_EXEC_AWARD_NAMES: Record<CoachExecAwardKind, string> = {
	coy: COACH_OF_THE_YEAR,
	eoy: EXEC_OF_THE_YEAR,
};

export const COACH_EXEC_AWARD_KEYS: Record<CoachExecAwardKind, string> = {
	coy: COY_KEY,
	eoy: EOY_KEY,
};

export const COY_VARIABLES = [
	"winp",
	"prevWinp",
	"expWinp",
	"rosterWinp",
	"mov",
	"playoffRoundsWon",
	"injuryRate",
] as const;

export const EOY_VARIABLES = [
	"winp",
	"prevWinp",
	"expWinp",
	"mov",
	"playoffRoundsWon",
	"movesWS",
	"payrollEff",
] as const;

export type CoyVariable = (typeof COY_VARIABLES)[number];
export type EoyVariable = (typeof EOY_VARIABLES)[number];

export const COACH_EXEC_VARIABLE_DOCS: Record<
	CoyVariable | EoyVariable,
	string
> = {
	winp: "Winning percentage in the regular season (for a coach, the games he coached; ties count as half a win)",
	prevWinp:
		"The team's winning percentage the season before (0.5 if it didn't play)",
	expWinp:
		"Preseason expectation, as a winning percentage: the team's roster rating when the season started against the league's (college: what the program's prestige expects, for the current season). Last season's winning percentage when no preseason rating was saved",
	rosterWinp:
		"Winning percentage the team's roster rating at the end of the regular season (now, during the season) is worth against the league's",
	mov: "Average margin of victory in the regular season",
	playoffRoundsWon:
		"Playoff rounds won (-1 missed the playoffs, 0 lost in the first round, and so on)",
	injuryRate:
		"Man-games lost to injury per team game (the average number of players out each game)",
	movesWS:
		"Value added by the season's moves: win shares of the players the team drafted, signed or traded for since the last playoffs (with this team), minus the win shares of the players it traded away (elsewhere), per 82 games",
	payrollEff:
		"Payroll efficiency: winning percentage per dollar of salary paid this season, relative to the league (0 is league average, 0.5 is 50% more wins per dollar)",
};

export const DEFAULT_COY_FORMULA =
	"winp + 0.5 * (winp - expWinp) + 0.3 * (winp - prevWinp) + 0.3 * (winp - rosterWinp) + 0.005 * mov + 0.02 * playoffRoundsWon + 0.01 * injuryRate";

// College mode: against what the program's prestige expects, and the national tournament counts more
export const DEFAULT_COY_FORMULA_COLLEGE =
	"winp - expWinp + 0.3 * (winp - prevWinp) + 0.05 * max(0, playoffRoundsWon + 1)";

export const DEFAULT_EOY_FORMULA =
	"0.25 * winp + 0.5 * (winp - prevWinp) + 0.5 * (winp - expWinp) + 0.01 * movesWS + 0.1 * payrollEff + 0.03 * playoffRoundsWon";

export type CoachExecAwardFormulas = {
	coy?: string;
	eoy?: string;
};

export const defaultCoachExecFormula = (
	kind: CoachExecAwardKind,
	college: boolean,
) =>
	kind === "eoy"
		? DEFAULT_EOY_FORMULA
		: college
			? DEFAULT_COY_FORMULA_COLLEGE
			: DEFAULT_COY_FORMULA;

// Win% a team's rating is worth against the league average (same curve as the Season Odds projection)
const ratingWinp = (ratingDiff: number) =>
	1 / (1 + Math.exp(-ratingDiff / 6.5));

/**
 * Win% each team's ovr is worth against the league's: ovr 50 to 100 maps to a rating like the AI GM's expectations, then the
 * Season Odds win probability against the league mean
 */
export const projectedWinps = (ovrs: Map<number, number>) => {
	const ratings = new Map<number, number>();
	for (const [tid, ovr] of ovrs) {
		ratings.set(tid, ((ovr - 50) * 15) / 50);
	}
	const values = [...ratings.values()];
	const mean =
		values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
	const out = new Map<number, number>();
	for (const [tid, rating] of ratings) {
		out.set(tid, ratingWinp(rating - mean));
	}
	return out;
};

/**
 * Deterministic order of award candidates: score, then winning percentage, then the lower id. Candidates with a score that isn't a
 * number go last
 */
export const compareCandidates = (
	a: { score: number; winp: number; id: number },
	b: { score: number; winp: number; id: number },
) => {
	const aOk = Number.isFinite(a.score);
	const bOk = Number.isFinite(b.score);
	if (aOk !== bOk) {
		return aOk ? -1 : 1;
	}
	if (aOk && b.score !== a.score) {
		return b.score - a.score;
	}
	if (b.winp !== a.winp) {
		return b.winp - a.winp;
	}
	return a.id - b.id;
};
