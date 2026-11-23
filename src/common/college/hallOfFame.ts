// College Hall of Fame (college leagues, basketball): the score of a college career and the seeded class size, pure so the worker
// (core/hallOfFame/college.ts), the pages and the tests share them. See docs/native-features.md, College Hall of Fame.
//
// A player who left the league (graduated, turned pro or left the sport; a transfer inside the league is still an active player) is a
// candidate from the season COLLEGE_HOF_WAIT seasons after he left, for COLLEGE_HOF_WINDOW seasons. Each season the committee inducts
// a small class: the best candidates over the bar, at most the season's class size (seeded, 2 to 4).
import { Rng } from "../pbpFlavor/rng.ts";

export const COLLEGE_HOF_AWARD = "Inducted into the College Hall of Fame";
export const COLLEGE_HOF_WAIT = 3;
export const COLLEGE_HOF_WINDOW = 10;
// Below this score nobody is inducted, whatever the class size (a small league or a thin year)
export const COLLEGE_HOF_MIN = 25;
// Coaches (head coach seasons in the league): retired at least COLLEGE_HOF_WAIT seasons, and the case clears this
export const COLLEGE_COACH_HOF_THRESHOLD = 30;

// Points for an award, by its short name (the college award settings of common/college/awards.ts). Team awards by team number
const INDIVIDUAL_POINTS: Record<string, number> = {
	POY: 10,
	DPOY: 3,
	FOY: 1.5,
	MOP: 3,
	CPOY: 2.5,
};
const TEAM_POINTS: Record<string, number[]> = {
	AA: [5, 3, 2],
	ALC: [1.25, 0.5],
	AF: [0.5],
};
export const POINTS_PER_WS = 0.5;
export const POINTS_PER_SEASON = 0.5;
export const POINTS_TITLE = 4;
export const POINTS_FINAL_FOUR = 1.5;
export const POINTS_TOURNAMENT = 0.4;

export type CollegeHofAward = {
	type?: string;
	shortName?: string;
	rank?: number;
	numTeams?: number;
	actAs?: string;
	group?: unknown;
	season: number;
};

export type CollegeHofStatRow = {
	season: number;
	tid: number;
	playoffs: boolean;
	gp?: number;
	// Stored rows have offensive and defensive win shares (ws is only in formatted stats)
	ws?: number;
	ows?: number;
	dws?: number;
	pts?: number;
	trb?: number;
	ast?: number;
};

// How far his team went in the national tournament that season: rounds won (-1 missed it) and the number of rounds
export type TeamResult = (
	tid: number,
	season: number,
) => { roundsWon: number; numRounds: number } | undefined;

export type CollegeHofCase = {
	score: number;
	awards: number;
	production: number;
	team: number;
	seasons: number;
	poy: number;
	allAmerican: number;
	firstTeamAllAmerican: number;
	confPoy: number;
	titles: number;
	finalFours: number;
	tournaments: number;
	ws: number;
	gp: number;
	pts: number;
	trb: number;
	ast: number;
	tids: number[];
	firstSeason: number | undefined;
	lastSeason: number | undefined;
	line: string;
};

const plural = (n: number, word: string) =>
	n === 1 ? `${word}` : `${n}× ${word}`;

// What the award is, by short name, or by what it acts as for renamed award settings
const awardKey = (a: CollegeHofAward) => {
	if (a.type !== undefined) {
		return a.type === "Won Championship" ? "title" : undefined;
	}
	if (
		a.shortName &&
		(a.shortName in INDIVIDUAL_POINTS || a.shortName in TEAM_POINTS)
	) {
		return a.shortName;
	}
	if (a.numTeams === undefined && a.actAs === "mvp") {
		return a.group ? "CPOY" : "POY";
	}
	return undefined;
};

/**
 * A college career's Hall of Fame case: awards (national and conference), production (win shares, regular season and national
 * tournament), team success (titles, Final Fours, tournament trips, from his team's seasons) and seasons played.
 */
export const collegeHofCase = (
	p: { awards: CollegeHofAward[]; stats: CollegeHofStatRow[] },
	teamResult: TeamResult,
): CollegeHofCase => {
	let awards = 0;
	let poy = 0;
	let allAmerican = 0;
	let firstTeamAllAmerican = 0;
	let confPoy = 0;
	for (const a of p.awards) {
		const key = awardKey(a);
		if (key === undefined || key === "title") {
			continue;
		}
		if (key in INDIVIDUAL_POINTS) {
			if (a.rank === 1 && a.numTeams === undefined) {
				awards += INDIVIDUAL_POINTS[key]!;
				if (key === "POY") {
					poy += 1;
				} else if (key === "CPOY") {
					confPoy += 1;
				}
			}
		} else {
			const points = TEAM_POINTS[key]!;
			const rank = a.rank ?? 1;
			awards += points[rank - 1] ?? 0;
			if (key === "AA") {
				allAmerican += 1;
				if (rank === 1) {
					firstTeamAllAmerican += 1;
				}
			}
		}
	}

	// Seasons he played (regular season games), and with which school
	const seasonTids = new Map<number, number>();
	let ws = 0;
	let gp = 0;
	let pts = 0;
	let trb = 0;
	let ast = 0;
	const tids: number[] = [];
	for (const row of p.stats) {
		if (row.tid < 0) {
			continue;
		}
		ws += row.ws ?? (row.ows ?? 0) + (row.dws ?? 0);
		if (row.playoffs || !((row.gp ?? 0) > 0)) {
			continue;
		}
		gp += row.gp ?? 0;
		pts += row.pts ?? 0;
		trb += row.trb ?? 0;
		ast += row.ast ?? 0;
		seasonTids.set(row.season, row.tid);
		if (!tids.includes(row.tid)) {
			tids.push(row.tid);
		}
	}

	let titles = 0;
	let finalFours = 0;
	let tournaments = 0;
	for (const [season, tid] of seasonTids) {
		const result = teamResult(tid, season);
		if (!result || result.roundsWon < 0 || result.numRounds <= 0) {
			continue;
		}
		tournaments += 1;
		if (result.roundsWon >= result.numRounds - 2) {
			finalFours += 1;
		}
		if (result.roundsWon >= result.numRounds) {
			titles += 1;
		}
	}

	const production = POINTS_PER_WS * Math.max(0, ws);
	const team =
		POINTS_TITLE * titles +
		POINTS_FINAL_FOUR * finalFours +
		POINTS_TOURNAMENT * tournaments;
	const seasons = POINTS_PER_SEASON * seasonTids.size;

	const parts: string[] = [];
	if (poy > 0) {
		parts.push(plural(poy, "Player of the Year"));
	}
	if (allAmerican > 0) {
		parts.push(
			firstTeamAllAmerican > 0
				? `${plural(allAmerican, "All-American")} (${firstTeamAllAmerican} first team)`
				: plural(allAmerican, "All-American"),
		);
	}
	if (confPoy > 0) {
		parts.push(plural(confPoy, "Conference Player of the Year"));
	}
	if (titles > 0) {
		parts.push(
			titles === 1 ? "national champion" : `${titles}× national champion`,
		);
	} else if (finalFours > 0) {
		parts.push(plural(finalFours, "Final Four"));
	}
	parts.push(`${Math.round(ws * 10) / 10} WS`);

	const seasonsList = [...seasonTids.keys()];
	return {
		score: awards + production + team + seasons,
		awards,
		production,
		team,
		seasons,
		poy,
		allAmerican,
		firstTeamAllAmerican,
		confPoy,
		titles,
		finalFours,
		tournaments,
		ws,
		gp,
		pts,
		trb,
		ast,
		tids,
		firstSeason: seasonsList.length > 0 ? Math.min(...seasonsList) : undefined,
		lastSeason: seasonsList.length > 0 ? Math.max(...seasonsList) : undefined,
		line: parts.join(", "),
	};
};

// The season's class size: 2 (40%), 3 (40%) or 4 (20%), seeded by the season (and the league salt)
export const collegeHofClassSize = (season: number) => {
	const x = new Rng(season, 7311).random();
	return x < 0.4 ? 2 : x < 0.8 ? 3 : 4;
};

// The committee's view of a candidate this season: his score times a little seeded noise (sd about 6%), so close cases are not decided
// by the formula alone and a candidate can get in in a later year
export const collegeHofVote = (pid: number, season: number, score: number) => {
	const rng = new Rng(pid, 7312 + 7919 * season);
	const u = Math.max(rng.random(), 1e-12);
	const v = rng.random();
	const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
	return score * (1 + 0.06 * z);
};

export type CollegeCoachCase = {
	score: number;
	won: number;
	lost: number;
	titles: number;
	finalFours: number;
	tournaments: number;
	coy: number;
	line: string;
};

/**
 * A college head coach's case: wins, national titles, Final Fours, tournament trips and Coach of the Year awards.
 */
export const collegeCoachHofCase = (
	rows: {
		role: string;
		season: number;
		won: number;
		lost: number;
		playoffRoundsWon: number;
	}[],
	coy: number,
	numRounds: (season: number) => number,
): CollegeCoachCase => {
	let won = 0;
	let lost = 0;
	let titles = 0;
	let finalFours = 0;
	let tournaments = 0;
	for (const row of rows) {
		if (row.role !== "head") {
			continue;
		}
		won += row.won;
		lost += row.lost;
		if (row.playoffRoundsWon >= 0) {
			tournaments += 1;
			const n = numRounds(row.season);
			if (n > 0 && row.playoffRoundsWon >= n - 2) {
				finalFours += 1;
			}
			if (n > 0 && row.playoffRoundsWon >= n) {
				titles += 1;
			}
		}
	}
	const score =
		won / 40 + 4 * titles + 1.5 * finalFours + 0.5 * tournaments + 2 * coy;
	const parts = [`${won}-${lost}`];
	if (titles > 0) {
		parts.push(`${titles} national ${titles === 1 ? "title" : "titles"}`);
	}
	if (finalFours > 0) {
		parts.push(plural(finalFours, "Final Four"));
	}
	if (coy > 0) {
		parts.push(`${coy} Coach of the Year`);
	}
	return {
		score,
		won,
		lost,
		titles,
		finalFours,
		tournaments,
		coy,
		line: parts.join(", "),
	};
};
