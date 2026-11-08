// Small helpers shared by the league history engines (Redraft, Pick Value, Family Trees, Home Court, League Economics, Jersey Numbers by Team). The engines are pure functions over plain data, so the worker views and the tests feed them the same way.

import type { WLeague, WPlayer } from "../wrapped/types.ts";

export const round1 = (x: number) => Math.round(x * 10) / 10;

export const ratio = (w: number, l: number) => (w + l > 0 ? w / (w + l) : null);

export const mean = (xs: number[]) =>
	xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

// Linear interpolation between the closest ranks, of an array sorted ascending
export const quantile = (sorted: number[], q: number) => {
	if (sorted.length === 0) {
		return null;
	}
	const i = (sorted.length - 1) * q;
	const lo = Math.floor(i);
	const hi = Math.ceil(i);
	return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
};

// 0 = every value the same, approaching 1 = one holds everything
export const gini = (values: number[]) => {
	const n = values.length;
	const total = values.reduce((a, b) => a + b, 0);
	if (n === 0 || total <= 0) {
		return null;
	}
	const sorted = [...values].sort((a, b) => a - b);
	let weighted = 0;
	for (let i = 0; i < n; i++) {
		weighted += (i + 1) * sorted[i]!;
	}
	return (2 * weighted) / (n * total) - (n + 1) / n;
};

// The last season whose playoffs are over
export const lastCompleteSeason = (
	L: Pick<WLeague, "season" | "currentComplete">,
) => (L.currentComplete ? L.season : L.season - 1);

// Champion tid by season, for seasons whose playoffs are over
export const championsOf = (
	L: Pick<
		WLeague,
		"season" | "currentComplete" | "teamSeasons" | "numPlayoffRounds"
	>,
) => {
	const last = lastCompleteSeason(L);
	const out = new Map<number, number>();
	for (const ts of L.teamSeasons) {
		const rounds = L.numPlayoffRounds[ts.season];
		if (
			ts.season <= last &&
			rounds !== undefined &&
			rounds > 0 &&
			ts.playoffRoundsWon === rounds
		) {
			out.set(ts.season, ts.tid);
		}
	}
	return out;
};

// Career regular season win shares (the snapshot only has pro rows). A player with no games is 0: he produced nothing.
export const careerWs = (p: WPlayer) => {
	let ws = 0;
	for (const s of p.stats) {
		ws += s.ws;
	}
	return round1(ws);
};

export const playedGames = (p: WPlayer) => {
	let gp = 0;
	for (const s of p.stats) {
		gp += s.gp;
	}
	return gp;
};

export const awardSeasons = (p: WPlayer, type: string) => {
	const out = new Set<number>();
	for (const a of p.awards) {
		if (a.type === type) {
			out.add(a.season);
		}
	}
	return out;
};

export const ALL_STAR = "All-Star";
export const MVP = "Most Valuable Player";

// Seasons a player won the title: on the champion at the end of its regular season or in its playoffs
export const titleSeasons = (p: WPlayer, champions: Map<number, number>) => {
	const out = new Set<number>();
	const lastTid = new Map<number, number>();
	for (const s of p.stats) {
		lastTid.set(s.season, s.tid);
	}
	for (const [season, tid] of lastTid) {
		if (champions.get(season) === tid) {
			out.add(season);
		}
	}
	for (const s of p.po) {
		if (champions.get(s.season) === s.tid) {
			out.add(s.season);
		}
	}
	return [...out].sort((a, b) => a - b);
};

// Draft picks per round in a draft year: the number of teams that season, or more if a round had more picks
export const picksPerRound = (L: Pick<WLeague, "teamSeasons" | "players">) => {
	const teams = new Map<number, number>();
	for (const ts of L.teamSeasons) {
		teams.set(ts.season, (teams.get(ts.season) ?? 0) + 1);
	}
	const maxFirst = new Map<number, number>();
	for (const p of L.players) {
		if (
			p.draft.round === 1 &&
			p.draft.pick > (maxFirst.get(p.draft.year) ?? 0)
		) {
			maxFirst.set(p.draft.year, p.draft.pick);
		}
	}
	return (year: number) =>
		Math.max(maxFirst.get(year) ?? 0, teams.get(year) ?? 0, 1);
};

// Overall pick number, or null for an undrafted player
export const overallPick = (
	p: Pick<WPlayer, "draft">,
	perRound: (year: number) => number,
) => {
	const d = p.draft;
	if (!(d.round > 0) || !(d.pick > 0)) {
		return null;
	}
	return (d.round - 1) * perRound(d.year) + d.pick;
};
