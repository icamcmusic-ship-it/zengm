// Draft pick value: what each overall pick has produced over the league's history. Mean and median career win shares with the middle half of outcomes, how often the pick became an All-Star, a starter or played at all, the undrafted pool for comparison, and the same by era.
//
// - Career win shares are regular season. A drafted player who never played counts as 0.
// - Hit rates leave out players whose outcome is unknown rather than counting them as misses. "Starter" (a season of 20+ games, starting at least half of them) needs games started on file for that season (starts covering 90%+ of its team games). "All-Star" is a no only if he played a season in which All-Stars were named.
// - Classes before the league's first season (partial) and classes without enough seasons played since are left out. A class needs 10 seasons if that leaves at least 20 picks, else 8, 6 or 4.

import type { WLeague, WPlayer } from "../wrapped/types.ts";
import {
	ALL_STAR,
	careerWs,
	lastCompleteSeason,
	overallPick,
	picksPerRound,
	quantile,
	round1,
} from "./util.ts";

export const MATURE_STEPS = [10, 8, 6, 4];
export const BANDS: [number, number][] = [
	[1, 3],
	[4, 10],
	[11, 20],
	[21, 30],
	[31, 45],
	[46, 60],
	[61, Infinity],
];

export type Rate = { hit: number; n: number };

export type PickSummary = {
	n: number;
	mean: number | null;
	median: number | null;
	p25: number | null;
	p75: number | null;
	max: number | null;
	best: number | null;
	played: Rate;
	allStar: Rate;
	starter: Rate;
};

export type PickSlot = PickSummary & { pick: number };
export type PickBand = PickSummary & { lo: number; hi: number; label: string };
export type PickEra = {
	label: string;
	from: number;
	to: number;
	n: number;
	bands: PickBand[];
};

export type PickValue = {
	from: number;
	to: number;
	mature: number;
	classes: number;
	numPicks: number;
	maxPick: number;
	slots: PickSlot[];
	undrafted: PickSummary;
	bands: PickBand[];
	eras: PickEra[];
	// First season with games started on file, if any
	gsFrom: number | null;
};

type Outcome = {
	pid: number;
	pick: number | null;
	year: number;
	ws: number;
	played: boolean | null;
	allStar: boolean | null;
	starter: boolean | null;
};

const rate = (xs: Outcome[], key: "played" | "allStar" | "starter"): Rate => {
	let hit = 0;
	let n = 0;
	for (const x of xs) {
		const v = x[key];
		if (v !== null) {
			n += 1;
			if (v) {
				hit += 1;
			}
		}
	}
	return { hit, n };
};

const summarize = (xs: Outcome[]): PickSummary => {
	const vals = xs.map((x) => x.ws).sort((a, b) => a - b);
	const r = (x: number | null) => (x === null ? null : round1(x));
	let best: Outcome | undefined;
	for (const x of xs) {
		if (!best || x.ws > best.ws) {
			best = x;
		}
	}
	return {
		n: xs.length,
		mean:
			xs.length > 0
				? round1(vals.reduce((a, b) => a + b, 0) / xs.length)
				: null,
		median: r(quantile(vals, 0.5)),
		p25: r(quantile(vals, 0.25)),
		p75: r(quantile(vals, 0.75)),
		max: best ? best.ws : null,
		best: best ? best.pid : null,
		played: rate(xs, "played"),
		allStar: rate(xs, "allStar"),
		starter: rate(xs, "starter"),
	};
};

const bandsOf = (xs: Outcome[], maxPick: number): PickBand[] => {
	const out: PickBand[] = [];
	for (const [lo, hi] of BANDS) {
		if (lo > maxPick) {
			break;
		}
		const top = Math.min(hi, maxPick);
		const inBand = xs.filter((x) => x.pick! >= lo && x.pick! <= hi);
		out.push({
			...summarize(inBand),
			lo,
			hi: top,
			label: lo === top ? `${lo}` : `${lo}-${top}`,
		});
	}
	return out;
};

export const buildPickValue = (L: WLeague): PickValue | null => {
	const from = L.startingSeason;
	const lastComplete = lastCompleteSeason(L);
	const perRound = picksPerRound(L);

	// Games started are known for a season if the starts on file cover 90%+ of its team games times 5 starters
	const gsSum = new Map<number, number>();
	const asNamed = new Set<number>();
	for (const p of L.players) {
		for (const s of p.stats) {
			if (s.gs > 0) {
				gsSum.set(s.season, (gsSum.get(s.season) ?? 0) + s.gs);
			}
		}
		for (const a of p.awards) {
			if (a.type === ALL_STAR) {
				asNamed.add(a.season);
			}
		}
	}
	const teamGames = new Map<number, number>();
	for (const ts of L.teamSeasons) {
		const gp = ts.won + ts.lost + ts.tied + ts.otl;
		teamGames.set(ts.season, (teamGames.get(ts.season) ?? 0) + gp);
	}
	const gsKnown = new Set<number>();
	for (const [season, gs] of gsSum) {
		const tg = teamGames.get(season);
		if (tg && gs >= 0.9 * 5 * tg) {
			gsKnown.add(season);
		}
	}

	const outcome = (p: WPlayer, pick: number | null): Outcome => {
		const rows = p.stats.filter((s) => s.gp > 0);
		const played = rows.length > 0;
		const isAllStar = p.awards.some((a) => a.type === ALL_STAR);
		let allStar: boolean | null;
		if (isAllStar) {
			allStar = true;
		} else if (!played || rows.some((s) => asNamed.has(s.season))) {
			allStar = false;
		} else {
			allStar = null;
		}
		let starter: boolean | null = null;
		if (!played) {
			starter = false;
		} else {
			const known = rows.filter((s) => gsKnown.has(s.season));
			if (known.some((s) => s.gp >= 20 && s.gs >= s.gp / 2)) {
				starter = true;
			} else if (known.length > 0 && known.length === rows.length) {
				starter = false;
			}
		}
		return {
			pid: p.pid,
			pick,
			year: p.draft.year,
			ws: played ? careerWs(p) : 0,
			played,
			allStar,
			starter,
		};
	};

	const classSize = new Map<number, number>();
	for (const p of L.players) {
		if (p.draft.round > 0 && p.draft.pick > 0 && p.draft.year >= from) {
			classSize.set(p.draft.year, (classSize.get(p.draft.year) ?? 0) + 1);
		}
	}
	const years = [...classSize.keys()].sort((a, b) => a - b);
	let mature: number | undefined;
	let use: number[] = [];
	for (const m of MATURE_STEPS) {
		use = years.filter((y) => y <= lastComplete - m);
		const n = use.reduce((sum, y) => sum + classSize.get(y)!, 0);
		if (n >= 20) {
			mature = m;
			break;
		}
	}
	if (mature === undefined || use.length === 0) {
		return null;
	}
	const useSet = new Set(use);

	const picks: Outcome[] = [];
	const undrafted: Outcome[] = [];
	for (const p of L.players) {
		if (!useSet.has(p.draft.year)) {
			continue;
		}
		const pick = overallPick(p, perRound);
		if (pick !== null) {
			picks.push(outcome(p, pick));
		} else if (p.stats.some((s) => s.gp > 0)) {
			undrafted.push(outcome(p, null));
		}
	}

	let maxPick = 0;
	const byPick: Outcome[][] = [];
	for (const x of picks) {
		maxPick = Math.max(maxPick, x.pick!);
		(byPick[x.pick!] ??= []).push(x);
	}
	const slots: PickSlot[] = [];
	for (let k = 1; k <= maxPick; k++) {
		slots.push({ ...summarize(byPick[k] ?? []), pick: k });
	}

	// Eras: decades of classes, merged until each has enough picks to say something
	const buckets = new Map<number, Outcome[]>();
	for (const x of picks) {
		const decade = Math.floor(x.year / 10) * 10;
		let b = buckets.get(decade);
		if (!b) {
			b = [];
			buckets.set(decade, b);
		}
		b.push(x);
	}
	const need = Math.max(60, Math.round(picks.length / 8));
	const groups: { xs: Outcome[]; from: number; to: number }[] = [];
	let cur: (typeof groups)[number] | undefined;
	for (const decade of [...buckets.keys()].sort((a, b) => a - b)) {
		cur ??= { xs: [], from: Infinity, to: -Infinity };
		for (const x of buckets.get(decade)!) {
			cur.xs.push(x);
			cur.from = Math.min(cur.from, x.year);
			cur.to = Math.max(cur.to, x.year);
		}
		if (cur.xs.length >= need) {
			groups.push(cur);
			cur = undefined;
		}
	}
	if (cur) {
		const prev = groups.at(-1);
		if (prev) {
			prev.xs.push(...cur.xs);
			prev.to = cur.to;
		} else {
			groups.push(cur);
		}
	}
	const eras: PickEra[] =
		groups.length > 1
			? groups.map((grp) => ({
					label: grp.from === grp.to ? `${grp.from}` : `${grp.from}-${grp.to}`,
					from: grp.from,
					to: grp.to,
					n: grp.xs.length,
					bands: bandsOf(grp.xs, maxPick),
				}))
			: [];

	return {
		from: use[0]!,
		to: use.at(-1)!,
		mature,
		classes: use.length,
		numPicks: picks.length,
		maxPick,
		slots,
		undrafted: summarize(undrafted),
		bands: bandsOf(picks, maxPick),
		eras,
		gsFrom: gsKnown.size > 0 ? Math.min(...gsKnown) : null,
	};
};
