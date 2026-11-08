// Records standing going into a season, from the players' regular season rows of every earlier season.
// A row without a stat leaves that player-season (or career) out for that stat: unknown is never counted as 0.
import {
	STAT_KEYS,
	type HPlayerRaw,
	type HRecordEntry,
	type HRecords,
	type HRow,
	type StatKey,
} from "./types.ts";
import { known } from "./util.ts";

type Tot = Record<StatKey, number | null>;
const zero = (): Tot => ({ pts: 0, trb: 0, ast: 0, stl: 0, blk: 0, tp: 0 });
const addRow = (t: Tot, r: HRow) => {
	for (const k of STAT_KEYS) {
		const v = r[k];
		t[k] = t[k] === null || !known(v) ? null : t[k] + v;
	}
};

// ovr that makes a player a star in a season: the top 3% of the players with games (never worse than the 5th best)
const starCutOf = (ovrs: number[]) => {
	const s = [...ovrs].sort((a, b) => b - a);
	return s.length
		? s[Math.min(s.length - 1, Math.max(4, Math.round(s.length * 0.03)))]!
		: Number.POSITIVE_INFINITY;
};

export const buildRecords = (
	players: readonly HPlayerRaw[],
	season: number,
): HRecords => {
	const R: HRecords = {
		seasonLeague: {},
		seasonFranchise: {},
		careerLeague: {},
		careerFranchise: {},
		starCut: {},
		firstSeason: Number.POSITIVE_INFINITY,
	};
	const ovrs = new Map<number, { list: number[]; seen: Set<number> }>();
	const frSeasons = new Map<number, Set<number>>();
	const curSeen = new Set<number>();
	const curAll: number[] = [];
	const curPlayed: number[] = [];
	const careerLg = new Map<StatKey, HRecordEntry[]>();
	const careerFr = new Map<string, HRecordEntry[]>();

	const push = (list: HRecordEntry[], e: HRecordEntry) => {
		list.push(e);
		list.sort((a, b) => b.v - a.v);
		if (list.length > 2) {
			list.length = 2;
		}
	};
	const better = (
		cur: Partial<Record<StatKey, HRecordEntry>>,
		k: StatKey,
		e: HRecordEntry,
	) => {
		const c = cur[k];
		if (!c || e.v > c.v) {
			cur[k] = e;
		}
	};

	for (const p of players) {
		const bySeason = new Map<number, Tot>();
		const byFr = new Map<string, Tot>();
		const career = zero();
		const careerByFr = new Map<number, Tot>();
		let any = false;
		for (const r of p.rows) {
			if (r.season === season) {
				// the season itself is not in the records, but its stars are needed
				const o = p.ovrBySeason[season];
				if (known(o) && !curSeen.has(p.pid)) {
					curSeen.add(p.pid);
					curAll.push(o);
					if (r.gp > 0) {
						curPlayed.push(o);
					}
				}
			}
			if (r.season >= season || !(r.gp > 0)) {
				continue;
			}
			any = true;
			R.firstSeason = Math.min(R.firstSeason, r.season);
			let st = bySeason.get(r.season);
			if (!st) {
				bySeason.set(r.season, (st = zero()));
			}
			addRow(st, r);
			const key = `${r.tid}|${r.season}`;
			let sf = byFr.get(key);
			if (!sf) {
				byFr.set(key, (sf = zero()));
			}
			addRow(sf, r);
			addRow(career, r);
			let cf = careerByFr.get(r.tid);
			if (!cf) {
				careerByFr.set(r.tid, (cf = zero()));
			}
			addRow(cf, r);
			let fs = frSeasons.get(r.tid);
			if (!fs) {
				frSeasons.set(r.tid, (fs = new Set()));
			}
			fs.add(r.season);
			const o = p.ovrBySeason[r.season];
			if (known(o)) {
				let e = ovrs.get(r.season);
				if (!e) {
					ovrs.set(r.season, (e = { list: [], seen: new Set() }));
				}
				// one per player-season
				if (!e.seen.has(p.pid)) {
					e.seen.add(p.pid);
					e.list.push(o);
				}
			}
		}
		if (!any) {
			continue;
		}
		for (const [s, t] of bySeason) {
			for (const k of STAT_KEYS) {
				const v = t[k];
				if (known(v)) {
					better(R.seasonLeague, k, { v, pid: p.pid, name: p.name, season: s });
				}
			}
		}
		for (const [key, t] of byFr) {
			const [tidS, seasonS] = key.split("|");
			const tid = Number(tidS);
			const fr = (R.seasonFranchise[tid] ??= { n: 0, best: {} });
			for (const k of STAT_KEYS) {
				const v = t[k];
				if (known(v)) {
					better(fr.best, k, {
						v,
						pid: p.pid,
						name: p.name,
						season: Number(seasonS),
					});
				}
			}
		}
		for (const k of STAT_KEYS) {
			const v = career[k];
			if (known(v)) {
				let list = careerLg.get(k);
				if (!list) {
					careerLg.set(k, (list = []));
				}
				push(list, { v, pid: p.pid, name: p.name });
			}
		}
		for (const [tid, t] of careerByFr) {
			for (const k of STAT_KEYS) {
				const v = t[k];
				if (known(v)) {
					const key = `${tid}|${k}`;
					let list = careerFr.get(key);
					if (!list) {
						careerFr.set(key, (list = []));
					}
					push(list, { v, pid: p.pid, name: p.name });
				}
			}
		}
	}
	for (const [tid, set] of frSeasons) {
		const fr = (R.seasonFranchise[tid] ??= { n: 0, best: {} });
		fr.n = set.size;
	}
	for (const [k, list] of careerLg) {
		R.careerLeague[k] = list;
	}
	for (const [key, list] of careerFr) {
		const [tidS, k] = key.split("|");
		const tid = Number(tidS);
		(R.careerFranchise[tid] ??= {})[k as StatKey] = list;
	}
	for (const [s, e] of ovrs) {
		R.starCut[s] = starCutOf(e.list);
	}
	// the season itself: players with games, or (early in the season) everyone on a roster
	R.starCut[season] = starCutOf(curPlayed.length >= 100 ? curPlayed : curAll);
	if (!Number.isFinite(R.firstSeason)) {
		R.firstSeason = season;
	}
	return R;
};

// Active record holders keep adding to their career marks: add this season so far (rows of the current season) to the career records
export const withActiveCareers = (
	R: HRecords,
	nowRows: (pid: number) => HRow[] | null,
): HRecords => {
	const bump = (list: HRecordEntry[], k: StatKey, tid?: number) =>
		list
			.map((e) => {
				const rows = (nowRows(e.pid) ?? []).filter(
					(r) => r.gp > 0 && (tid === undefined || r.tid === tid),
				);
				let add = 0;
				for (const r of rows) {
					const v = r[k];
					if (!known(v)) {
						return e;
					}
					add += v;
				}
				return add ? { ...e, v: e.v + add } : e;
			})
			.sort((a, b) => b.v - a.v);
	const out: HRecords = { ...R, careerLeague: {}, careerFranchise: {} };
	for (const k of STAT_KEYS) {
		const l = R.careerLeague[k];
		if (l) {
			out.careerLeague[k] = bump(l, k);
		}
	}
	for (const [tidS, per] of Object.entries(R.careerFranchise)) {
		const tid = Number(tidS);
		const o: Partial<Record<StatKey, HRecordEntry[]>> = {};
		for (const k of STAT_KEYS) {
			const l = per[k];
			if (l) {
				o[k] = bump(l, k, tid);
			}
		}
		out.careerFranchise[tid] = o;
	}
	return out;
};
