// League Extras "Face Aging": which seasons of a player's face history are shown (player page "Then and Now", HoF plaques), how
// they're labelled and which team's jersey each one wears. Pure functions, tested in faceHistory.test.ts.
//
// - No face from before he was drafted is shown: the history starts at his first pro season, the first season after his draft
//   year with a regular-season stats row on a team (or his current team). Prospects and unsigned players have none.
// - College leagues: the same rule gives his first college season (recruits are prospects until they enroll).
// - Labels: "Rookie" for that first pro season, unless he was already a pro before the league began (drafted before the
//   league's first draft year): then "League start" (his first season is the league's first) or "First season".
import type { FaceConfig } from "facesjs";

type StatsRow = {
	season: number;
	tid: number;
	playoffs?: boolean;
	gp?: number;
};

export type HistoryPlayer = {
	tid: number;
	draft: { year: number };
	stats: readonly StatsRow[];
	ratings?: readonly { season: number; ovr: number }[];
	retiredYear?: number;
};

export type FaceHistoryLabel = "Rookie" | "League start" | "First season";

export type FaceHistoryEntry = {
	season: number;
	face: FaceConfig;
	colors: [string, string, string];
	jersey: string;
	// The first entry only
	label?: FaceHistoryLabel;
};

// A plain jersey's colours, for seasons with no team (retired, unsigned)
export const NEUTRAL_JERSEY_COLORS: [string, string, string] = [
	"#5f6368",
	"#c4c7cc",
	"#ffffff",
];

export const firstProSeason = (
	p: HistoryPlayer,
	currentSeason: number,
	college = false,
): number | undefined => {
	const after = (season: number) => college || season > p.draft.year;
	let first: number | undefined;
	for (const row of p.stats) {
		if (
			!row.playoffs &&
			row.tid >= 0 &&
			after(row.season) &&
			(first === undefined || row.season < first)
		) {
			first = row.season;
		}
	}
	if (p.tid >= 0 && after(currentSeason) && first === undefined) {
		first = currentSeason;
	}
	return first;
};

export const firstSeasonLabel = (
	p: HistoryPlayer,
	proStart: number,
	startingSeason: number,
	college = false,
): FaceHistoryLabel => {
	if (college) {
		return "First season";
	}
	// Drafted before the league's first draft: he was a pro before the league's records of him
	if (p.draft.year < startingSeason - 1) {
		return proStart === startingSeason ? "League start" : "First season";
	}
	return "Rookie";
};

// The team he wore that season: the one he played the most regular-season games for (a tie goes to the later team, where he
// ended the season). Undefined: no team (retired, unsigned); the current season falls back to his current team.
export const seasonTeam = (
	p: HistoryPlayer,
	season: number,
	currentSeason: number,
): number | undefined => {
	if (p.retiredYear !== undefined && season > p.retiredYear) {
		return undefined;
	}
	const gp = new Map<number, number>();
	let best: number | undefined;
	for (const row of p.stats) {
		if (row.playoffs || row.season !== season || row.tid < 0) {
			continue;
		}
		const total = (gp.get(row.tid) ?? 0) + (row.gp ?? 0);
		gp.set(row.tid, total);
		if (best === undefined || total >= gp.get(best)!) {
			best = row.tid;
		}
	}
	if (best === undefined && season === currentSeason && p.tid >= 0) {
		return p.tid;
	}
	return best;
};

// His prime, for HoF plaques and a retired player's then-and-now: the pro season with his best ovr (the first, on a tie)
export const primeSeason = (
	p: HistoryPlayer,
	proStart: number,
): number | undefined => {
	let best: { season: number; ovr: number } | undefined;
	for (const row of p.ratings ?? []) {
		if (
			row.season < proStart ||
			(p.retiredYear !== undefined && row.season > p.retiredYear)
		) {
			continue;
		}
		if (best === undefined || row.ovr > best.ovr) {
			best = row;
		}
	}
	return best?.season;
};

// A Hall of Fame plaque (League Extras "Face Aging"): his face in his prime, in that season's jersey
export type HofPlaque = {
	pid: number;
	name: string;
	imgURL?: string;
	firstSeason?: number;
	retiredYear: number;
	peakOvr: number;
	season: number;
	face: FaceConfig;
	colors: [string, string, string];
	jersey: string;
};
