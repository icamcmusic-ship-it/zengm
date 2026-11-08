// Family trees: players joined by their relatives (father, son, brother) into families, each laid out by generation with the careers side by side; family records (combined win shares, points, titles, All-Stars); every father-son pair and every pair of brothers, with the seasons they were teammates and opponents.
//
// Stats are regular season. A player with no games has played: false and his career adds nothing (unknown is never counted as 0 games played: first and last are null).

import type { WLeague, WPlayer } from "../wrapped/types.ts";
import {
	ALL_STAR,
	MVP,
	awardSeasons,
	championsOf,
	round1,
	titleSeasons,
} from "./util.ts";

// Generation step from a player to the relative named: his father is one generation up
const DELTA: Record<string, number> = { father: -1, son: 1, brother: 0 };

export type FamilyMember = {
	pid: number;
	name: string;
	gen: number;
	played: boolean;
	gp: number;
	pts: number;
	ws: number;
	allStar: number;
	mvp: number;
	titles: number[];
	hof: boolean;
	first: number | null;
	last: number | null;
	active: boolean;
};

export type FamilyTotals = {
	players: number;
	played: number;
	gp: number;
	pts: number;
	ws: number;
	allStar: number;
	mvp: number;
	hof: number;
	// Member titles added up, and distinct seasons with a title in the family
	titles: number;
	titleSeasons: number;
	gens: number;
	first: number | null;
	last: number | null;
};

export type Family = {
	// pid of its best player, used as the family's id in URLs
	id: number;
	name: string;
	members: FamilyMember[];
	gens: FamilyMember[][];
	totals: FamilyTotals;
};

export type FamilyPair = {
	// a is the father or the older brother
	a: number;
	b: number;
	type: "father-son" | "brothers";
	together: number[];
	against: number[];
	overlap: number[];
};

export type Families = {
	families: Family[];
	fatherSon: FamilyPair[];
	brothers: FamilyPair[];
	related: number;
};

// "Smith Jr." -> "Smith": a family is named without the generational suffix
export const surname = (p: Pick<WPlayer, "lastName" | "name">) => {
	const parts = (p.lastName || p.name).trim().split(/\s+/);
	while (parts.length > 1 && /^(jr|sr|i{1,3}|iv|v)\.?$/i.test(parts.at(-1)!)) {
		parts.pop();
	}
	return parts.join(" ") || p.name;
};

const teamsBySeason = (p: WPlayer) => {
	const m = new Map<number, Set<number>>();
	for (const s of p.stats) {
		if (s.gp > 0 && s.tid >= 0) {
			let set = m.get(s.season);
			if (!set) {
				set = new Set();
				m.set(s.season, set);
			}
			set.add(s.tid);
		}
	}
	return m;
};

const pairOf = (
	pa: WPlayer,
	pb: WPlayer,
	type: FamilyPair["type"],
): FamilyPair => {
	const ta = teamsBySeason(pa);
	const tb = teamsBySeason(pb);
	const together: number[] = [];
	const against: number[] = [];
	const overlap: number[] = [];
	for (const [season, fa] of ta) {
		const fb = tb.get(season);
		if (!fb) {
			continue;
		}
		overlap.push(season);
		if ([...fa].some((tid) => fb.has(tid))) {
			together.push(season);
		} else {
			against.push(season);
		}
	}
	const sort = (xs: number[]) => xs.sort((x, y) => x - y);
	return {
		a: pa.pid,
		b: pb.pid,
		type,
		together: sort(together),
		against: sort(against),
		overlap: sort(overlap),
	};
};

export const buildFamilies = (L: WLeague): Families => {
	const champions = championsOf(L);
	const byPid = new Map<number, WPlayer>();
	for (const p of L.players) {
		byPid.set(p.pid, p);
	}

	const member = (p: WPlayer, gen: number): FamilyMember => {
		let gp = 0;
		let pts = 0;
		let ws = 0;
		let first: number | null = null;
		let last: number | null = null;
		for (const s of p.stats) {
			if (s.gp > 0) {
				gp += s.gp;
				pts += s.pts;
				ws += s.ws;
				first = first === null ? s.season : Math.min(first, s.season);
				last = last === null ? s.season : Math.max(last, s.season);
			}
		}
		return {
			pid: p.pid,
			name: p.name,
			gen,
			played: gp > 0,
			gp,
			pts,
			ws: round1(ws),
			allStar: awardSeasons(p, ALL_STAR).size,
			mvp: awardSeasons(p, MVP).size,
			titles: titleSeasons(p, champions),
			hof: p.hof,
			first,
			last,
			active: p.tid >= 0,
		};
	};

	const adj = new Map<number, { to: number; d: number }[]>();
	const link = (a: number, b: number, d: number) => {
		let list = adj.get(a);
		if (!list) {
			list = [];
			adj.set(a, list);
		}
		list.push({ to: b, d });
	};
	const fatherSon = new Map<string, [WPlayer, WPlayer]>();
	const brothers = new Map<string, [WPlayer, WPlayer]>();
	const related = new Set<number>();
	// Older brother first: earlier birth year, then earlier pid
	const older = (x: WPlayer, y: WPlayer) =>
		x.bornYear < y.bornYear || (x.bornYear === y.bornYear && x.pid < y.pid);

	for (const p of L.players) {
		for (const r of p.relatives) {
			const q = byPid.get(r.pid);
			if (!q || q.pid === p.pid) {
				continue;
			}
			related.add(p.pid);
			related.add(q.pid);
			const d = DELTA[r.type] ?? 0;
			link(p.pid, q.pid, d);
			link(q.pid, p.pid, -d);
			if (r.type === "son" || r.type === "father") {
				const [father, son] = r.type === "son" ? [p, q] : [q, p];
				fatherSon.set(`${father.pid}|${son.pid}`, [father, son]);
			} else if (r.type === "brother") {
				const [a, b] = older(p, q) ? [p, q] : [q, p];
				brothers.set(`${a.pid}|${b.pid}`, [a, b]);
			}
		}
	}

	const seen = new Set<number>();
	const families: Family[] = [];
	for (const start of [...adj.keys()].sort((a, b) => a - b)) {
		if (seen.has(start)) {
			continue;
		}
		const gen = new Map<number, number>([[start, 0]]);
		const queue = [start];
		seen.add(start);
		for (let i = 0; i < queue.length; i++) {
			const cur = queue[i]!;
			for (const e of adj.get(cur) ?? []) {
				if (gen.has(e.to)) {
					continue;
				}
				gen.set(e.to, gen.get(cur)! + e.d);
				seen.add(e.to);
				queue.push(e.to);
			}
		}
		if (queue.length < 2) {
			continue;
		}
		const minGen = Math.min(...gen.values());
		const members = queue.map((pid) =>
			member(byPid.get(pid)!, gen.get(pid)! - minGen),
		);
		members.sort((a, b) => a.gen - b.gen || b.ws - a.ws || a.pid - b.pid);
		const sparse: FamilyMember[][] = [];
		for (const m of members) {
			(sparse[m.gen] ??= []).push(m);
		}
		const gens = sparse.filter((x) => x !== undefined);
		const titleSet = new Set<number>();
		const totals: FamilyTotals = {
			players: members.length,
			played: 0,
			gp: 0,
			pts: 0,
			ws: 0,
			allStar: 0,
			mvp: 0,
			hof: 0,
			titles: 0,
			titleSeasons: 0,
			gens: gens.length,
			first: null,
			last: null,
		};
		for (const m of members) {
			if (m.played) {
				totals.played += 1;
			}
			totals.gp += m.gp;
			totals.pts += m.pts;
			totals.ws += m.ws;
			totals.allStar += m.allStar;
			totals.mvp += m.mvp;
			totals.hof += m.hof ? 1 : 0;
			totals.titles += m.titles.length;
			for (const y of m.titles) {
				titleSet.add(y);
			}
			if (m.first !== null) {
				totals.first =
					totals.first === null ? m.first : Math.min(totals.first, m.first);
			}
			if (m.last !== null) {
				totals.last =
					totals.last === null ? m.last : Math.max(totals.last, m.last);
			}
		}
		totals.ws = round1(totals.ws);
		totals.titleSeasons = titleSet.size;
		const best = [...members].sort((a, b) => b.ws - a.ws || a.pid - b.pid)[0]!;
		families.push({
			id: best.pid,
			name: surname(byPid.get(best.pid)!),
			members,
			gens,
			totals,
		});
	}
	families.sort(
		(a, b) =>
			b.totals.ws - a.totals.ws ||
			b.totals.players - a.totals.players ||
			a.id - b.id,
	);

	return {
		families,
		fatherSon: [...fatherSon.values()].map(([a, b]) =>
			pairOf(a, b, "father-son"),
		),
		brothers: [...brothers.values()].map(([a, b]) => pairOf(a, b, "brothers")),
		related: related.size,
	};
};

// The family a player belongs to
export const familyOf = (F: Families, pid: number) =>
	F.families.find((f) => f.members.some((m) => m.pid === pid));
