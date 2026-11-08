// Redraft: every draft class re-ordered by career regular season win shares, the original pick next to the redraft slot, each class's steals and busts, and the all-time lists (biggest steals, biggest busts, who should have gone first).
//
// - A player who never played is 0 (he produced nothing), ranked by his original pick among the others with 0.
// - Undrafted players join the class of their draft year, but only if they played.
// - A class drafted before the league's first season is partial (only the players still active when the league began exist), and stays out of the all-time lists, as does a class with fewer than MATURE seasons played since.

import type { WLeague } from "../wrapped/types.ts";
import {
	ALL_STAR,
	awardSeasons,
	careerWs,
	lastCompleteSeason,
	overallPick,
	picksPerRound,
	playedGames,
} from "./util.ts";

export const MATURE = 4;

export type RedraftEntry = {
	pid: number;
	year: number;
	// Overall pick, null for undrafted
	pick: number | null;
	round: number;
	// Team that drafted him
	tid: number;
	ws: number;
	played: boolean;
	// Redraft slot, 1-based
	slot: number;
	// Original pick minus redraft slot: positive means he deserved to go earlier. For an undrafted player, counted from one past the last pick.
	delta: number;
	allStar: number;
	hof: boolean;
};

export type RedraftClass = {
	year: number;
	partial: boolean;
	seasonsSince: number;
	developing: boolean;
	perRound: number;
	entries: RedraftEntry[];
	drafted: number;
	undrafted: number;
};

export type RedraftOne = {
	year: number;
	actual: RedraftEntry | null;
	redraft: RedraftEntry | null;
};

export type Redraft = {
	from: number;
	years: number[];
	classes: Map<number, RedraftClass>;
	steals: RedraftEntry[];
	busts: RedraftEntry[];
	ones: RedraftOne[];
};

const isSteal = (c: RedraftClass, x: RedraftEntry) =>
	x.slot <= c.perRound && x.delta > 0 && x.ws > 0;

// A top 10 pick who falls out of the top half of the redraft's first round
const isBust = (c: RedraftClass, x: RedraftEntry) =>
	x.pick !== null &&
	x.pick <= Math.min(10, c.perRound) &&
	x.slot > x.pick &&
	x.slot > Math.ceil(c.perRound / 2);

const byStealSize = (a: RedraftEntry, b: RedraftEntry) =>
	b.delta - a.delta || b.ws - a.ws || a.pid - b.pid;
const byBustSize = (a: RedraftEntry, b: RedraftEntry) =>
	b.slot - b.pick! - (a.slot - a.pick!) || a.ws - b.ws || a.pid - b.pid;

export const classStealsBusts = (c: RedraftClass, n = 5) => {
	return {
		steals: c.entries
			.filter((x) => isSteal(c, x))
			.sort(byStealSize)
			.slice(0, n),
		busts: c.entries
			.filter((x) => isBust(c, x))
			.sort(byBustSize)
			.slice(0, n),
	};
};

export const buildRedraft = (L: WLeague): Redraft => {
	const from = L.startingSeason;
	const lastComplete = lastCompleteSeason(L);
	const perRound = picksPerRound(L);

	const byYear = new Map<
		number,
		{ drafted: WLeague["players"]; undrafted: WLeague["players"] }
	>();
	for (const p of L.players) {
		const year = p.draft.year;
		if (!Number.isFinite(year)) {
			continue;
		}
		const drafted = p.draft.round > 0 && p.draft.pick > 0;
		// Undrafted players count only if they played. Prospects not drafted yet are undrafted with no games, so they are left out too.
		if (!drafted && playedGames(p) === 0) {
			continue;
		}
		let entry = byYear.get(year);
		if (!entry) {
			entry = { drafted: [], undrafted: [] };
			byYear.set(year, entry);
		}
		(drafted ? entry.drafted : entry.undrafted).push(p);
	}

	const classes = new Map<number, RedraftClass>();
	for (const [year, { drafted, undrafted }] of byYear) {
		if (drafted.length === 0) {
			continue;
		}
		const seasonsSince = Math.max(0, lastComplete - year);
		const entries: RedraftEntry[] = [...drafted, ...undrafted].map((p) => {
			const gp = playedGames(p);
			return {
				pid: p.pid,
				year,
				pick: overallPick(p, perRound),
				round: p.draft.round > 0 ? p.draft.round : 0,
				tid: p.draft.tid,
				ws: gp > 0 ? careerWs(p) : 0,
				played: gp > 0,
				slot: 0,
				delta: 0,
				allStar: awardSeasons(p, ALL_STAR).size,
				hof: p.hof,
			};
		});
		entries.sort(
			(a, b) =>
				b.ws - a.ws ||
				(a.pick ?? Infinity) - (b.pick ?? Infinity) ||
				a.pid - b.pid,
		);
		const numDrafted = drafted.length;
		entries.forEach((x, i) => {
			x.slot = i + 1;
			x.delta = (x.pick ?? numDrafted + 1) - x.slot;
		});
		classes.set(year, {
			year,
			partial: year < from,
			seasonsSince,
			developing: seasonsSince < MATURE,
			perRound: perRound(year),
			entries,
			drafted: numDrafted,
			undrafted: undrafted.length,
		});
	}

	const steals: RedraftEntry[] = [];
	const busts: RedraftEntry[] = [];
	const ones: RedraftOne[] = [];
	for (const c of classes.values()) {
		if (c.partial || c.developing) {
			continue;
		}
		for (const x of c.entries) {
			if (isSteal(c, x)) {
				steals.push(x);
			}
			if (isBust(c, x)) {
				busts.push(x);
			}
		}
		ones.push({
			year: c.year,
			actual: c.entries.find((x) => x.pick === 1) ?? null,
			redraft: c.entries[0] ?? null,
		});
	}
	steals.sort(byStealSize);
	busts.sort(byBustSize);
	ones.sort((a, b) => b.year - a.year);

	return {
		from,
		years: [...classes.keys()].sort((a, b) => a - b),
		classes,
		steals,
		busts,
		ones,
	};
};
