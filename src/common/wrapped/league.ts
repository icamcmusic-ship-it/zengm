import type {
	WLeague,
	WPlayer,
	WStat,
	WTeamSeason,
	WGame,
	WSeries,
} from "./types.ts";
import { winPct } from "./util.ts";

// A player's season summed over all his teams, with per-game rates
export type SeasonLine = WStat & {
	pid: number;
	name: string;
	age: number;
	// Last team he played for that season
	tid: number;
	tids: number[];
	ppg: number;
	rpg: number;
	apg: number;
	spg: number;
	bpg: number;
	mpg: number;
	tpg: number;
	tsPct: number;
};

const STAT_KEYS = [
	"gp",
	"gs",
	"min",
	"pts",
	"trb",
	"ast",
	"stl",
	"blk",
	"tov",
	"tp",
	"tpa",
	"fg",
	"fga",
	"ft",
	"fta",
	"ws",
	"vorp",
] as const;

export const sumRows = (rows: WStat[]): WStat => {
	const out: WStat = {
		season: rows[0]?.season ?? 0,
		tid: rows.at(-1)?.tid ?? -1,
		gp: 0,
		gs: 0,
		min: 0,
		pts: 0,
		trb: 0,
		ast: 0,
		stl: 0,
		blk: 0,
		tov: 0,
		tp: 0,
		tpa: 0,
		fg: 0,
		fga: 0,
		ft: 0,
		fta: 0,
		per: 0,
		ws: 0,
		bpm: 0,
		vorp: 0,
	};
	let minW = 0;
	for (const r of rows) {
		for (const k of STAT_KEYS) {
			out[k] += r[k];
		}
		// PER and BPM are rates, weight by minutes
		out.per += r.per * r.min;
		out.bpm += r.bpm * r.min;
		minW += r.min;
	}
	out.per = minW > 0 ? out.per / minW : 0;
	out.bpm = minW > 0 ? out.bpm / minW : 0;
	return out;
};

const toLine = (p: WPlayer, rows: WStat[]): SeasonLine => {
	const s = sumRows(rows);
	const gp = Math.max(1, s.gp);
	const tsa = 2 * (s.fga + 0.44 * s.fta);
	return {
		...s,
		pid: p.pid,
		name: p.name,
		age: s.season - p.bornYear,
		tids: [...new Set(rows.map((r) => r.tid))],
		ppg: s.pts / gp,
		rpg: s.trb / gp,
		apg: s.ast / gp,
		spg: s.stl / gp,
		bpg: s.blk / gp,
		mpg: s.min / gp,
		tpg: s.tp / gp,
		tsPct: tsa > 0 ? s.pts / tsa : 0,
	};
};

// Per-season player lines that can be kept from one index to the next. A season's lines only depend on stat rows of that season, so the owner of the cache (the worker) drops a season when its rows change.
export type LinesCache = {
	reg: Map<number, SeasonLine[]>;
	po: Map<number, SeasonLine[]>;
};

export const newLinesCache = (): LinesCache => ({
	reg: new Map(),
	po: new Map(),
});

type SeasonRows = { p: WPlayer; rows: WStat[] }[];

// True for an index (as opposed to the plain snapshot it is built from)
export const isLeagueIndex = (x: WLeague | LeagueIndex): x is LeagueIndex =>
	typeof (x as LeagueIndex).lines === "function";

export class LeagueIndex {
	L: WLeague;
	players = new Map<number, WPlayer>();
	private teamMap = new Map<string, WTeamSeason>();
	private teamsBySeason = new Map<number, WTeamSeason[]>();
	// In the order of L.teamSeasons
	private teamsByTid = new Map<number, WTeamSeason[]>();
	private rowsBySeason:
		| { reg: Map<number, SeasonRows>; po: Map<number, SeasonRows> }
		| undefined;
	private linesBySeason = new Map<number, SeasonLine[]>();
	private poBySeason = new Map<number, SeasonLine[]>();
	private lineByPid = new Map<number, Map<number, SeasonLine | undefined>>();
	private awardIndex: Map<string, number[]> | undefined;
	private seriesBySeason = new Map<number, WSeries>();
	private gamesBySeason = new Map<number, WGame[]>();
	private memo = new Map<string, unknown>();
	private linesCache: LinesCache | undefined;
	private reuseLines: ((season: number) => boolean) | undefined;
	seasons: number[];

	// linesCache and reuseLines: lines of a season for which reuseLines is true come from linesCache if they are there, and are stored there when computed
	constructor(
		L: WLeague,
		opts?: {
			linesCache?: LinesCache;
			reuseLines?: (season: number) => boolean;
		},
	) {
		this.L = L;
		this.linesCache = opts?.linesCache;
		this.reuseLines = opts?.reuseLines;
		for (const p of L.players) {
			this.players.set(p.pid, p);
		}
		const seasons = new Set<number>();
		for (const ts of L.teamSeasons) {
			this.teamMap.set(`${ts.tid}|${ts.season}`, ts);
			seasons.add(ts.season);
			let bySeason = this.teamsBySeason.get(ts.season);
			if (!bySeason) {
				bySeason = [];
				this.teamsBySeason.set(ts.season, bySeason);
			}
			bySeason.push(ts);
			let byTid = this.teamsByTid.get(ts.tid);
			if (!byTid) {
				byTid = [];
				this.teamsByTid.set(ts.tid, byTid);
			}
			byTid.push(ts);
		}
		this.seasons = [...seasons].sort((a, b) => a - b);
		for (const s of L.series) {
			this.seriesBySeason.set(s.season, s);
		}
		for (const g of L.games) {
			let list = this.gamesBySeason.get(g.season);
			if (!list) {
				list = [];
				this.gamesBySeason.set(g.season, list);
			}
			list.push(g);
		}
	}

	// Which of a player's rows belong to which season, only built when a season's lines are not already cached
	private rows() {
		if (!this.rowsBySeason) {
			const out = {
				reg: new Map<number, SeasonRows>(),
				po: new Map<number, SeasonRows>(),
			};
			for (const p of this.L.players) {
				for (const [src, target] of [
					[p.stats, out.reg],
					[p.po, out.po],
				] as const) {
					if (src.length === 0) {
						continue;
					}
					const bySeason = new Map<number, WStat[]>();
					for (const r of src) {
						if (r.gp <= 0) {
							continue;
						}
						let rows = bySeason.get(r.season);
						if (!rows) {
							rows = [];
							bySeason.set(r.season, rows);
						}
						rows.push(r);
					}
					for (const [season, rows] of bySeason) {
						let list = target.get(season);
						if (!list) {
							list = [];
							target.set(season, list);
						}
						list.push({ p, rows });
					}
				}
			}
			this.rowsBySeason = out;
		}
		return this.rowsBySeason;
	}

	private seasonLines(kind: "reg" | "po", season: number) {
		const mem = kind === "reg" ? this.linesBySeason : this.poBySeason;
		let lines = mem.get(season);
		if (lines) {
			return lines;
		}
		const reuse = this.linesCache && this.reuseLines?.(season);
		if (reuse) {
			lines = this.linesCache![kind].get(season);
		}
		if (!lines) {
			lines = (this.rows()[kind].get(season) ?? []).map(({ p, rows }) =>
				toLine(p, rows),
			);
			if (reuse) {
				this.linesCache![kind].set(season, lines);
			}
		}
		mem.set(season, lines);
		return lines;
	}

	cached<T>(key: string, f: () => T): T {
		if (!this.memo.has(key)) {
			this.memo.set(key, f());
		}
		return this.memo.get(key) as T;
	}

	// A season whose playoffs are over, so awards and the champion are known
	decided(season: number) {
		return (
			season < this.L.season ||
			(season === this.L.season && this.L.currentComplete)
		);
	}

	decidedSeasons() {
		return this.seasons.filter((s) => this.decided(s));
	}

	team(tid: number, season: number) {
		return this.teamMap.get(`${tid}|${season}`);
	}

	// Team info for a season, falling back to the nearest season the team existed
	teamAny(tid: number, season: number) {
		const t = this.team(tid, season);
		if (t) {
			return t;
		}
		let best: WTeamSeason | undefined;
		for (const ts of this.teamsByTid.get(tid) ?? []) {
			if (
				!best ||
				Math.abs(ts.season - season) < Math.abs(best.season - season)
			) {
				best = ts;
			}
		}
		return best;
	}

	teamName(tid: number, season: number) {
		const t = this.teamAny(tid, season);
		return t ? `${t.region} ${t.name}` : "a free agent";
	}

	// A copy, so callers can sort it
	teamsIn(season: number) {
		return [...(this.teamsBySeason.get(season) ?? [])];
	}

	teamWinp(ts: WTeamSeason) {
		return winPct(ts.won, ts.lost, ts.tied);
	}

	numRounds(season: number) {
		return this.L.numPlayoffRounds[season] ?? 4;
	}

	champion(season: number) {
		if (!this.decided(season)) {
			return undefined;
		}
		const n = this.numRounds(season);
		return this.teamsBySeason
			.get(season)
			?.find((t) => t.playoffRoundsWon >= n && n > 0);
	}

	runnerUp(season: number) {
		if (!this.decided(season)) {
			return undefined;
		}
		const n = this.numRounds(season);
		return this.teamsBySeason
			.get(season)
			?.find((t) => t.playoffRoundsWon === n - 1);
	}

	series(season: number) {
		return this.seriesBySeason.get(season);
	}

	games(season: number) {
		return this.gamesBySeason.get(season) ?? [];
	}

	hasBoxScores(season: number) {
		return this.games(season).length > 0;
	}

	lines(season: number) {
		return this.seasonLines("reg", season);
	}

	poLines(season: number) {
		return this.seasonLines("po", season);
	}

	line(pid: number, season: number) {
		let byPid = this.lineByPid.get(season);
		if (!byPid) {
			byPid = new Map();
			for (const l of this.lines(season)) {
				// The first one wins, like find
				if (!byPid.has(l.pid)) {
					byPid.set(l.pid, l);
				}
			}
			this.lineByPid.set(season, byPid);
		}
		return byPid.get(pid);
	}

	// Most games anyone played that season, for "qualified" cutoffs
	maxGp(season: number) {
		return this.cached(`maxgp|${season}`, () => {
			let m = 0;
			for (const l of this.lines(season)) {
				m = Math.max(m, l.gp);
			}
			return m;
		});
	}

	qualified(season: number) {
		return this.cached(`qual|${season}`, () => {
			const need = Math.max(1, Math.round(this.maxGp(season) * 0.5));
			return this.lines(season).filter((l) => l.gp >= need);
		});
	}

	// Every qualified player-season in the league's history
	allQualified() {
		return this.cached("allqual", () =>
			this.seasons.flatMap((s) => this.qualified(s)),
		);
	}

	// Award winners: the pids of players with this award type in this season
	awardPids(season: number, type: string) {
		if (!this.decided(season) && type !== "All-Star") {
			return [];
		}
		if (!this.awardIndex) {
			const index = new Map<string, number[]>();
			for (const p of this.L.players) {
				// A player holding the same award twice in a season is listed once
				const seen = new Set<string>();
				for (const a of p.awards) {
					const key = `${a.season}|${a.type}`;
					if (seen.has(key)) {
						continue;
					}
					seen.add(key);
					let pids = index.get(key);
					if (!pids) {
						pids = [];
						index.set(key, pids);
					}
					pids.push(p.pid);
				}
			}
			this.awardIndex = index;
		}
		// A copy, so callers can sort it
		return [...(this.awardIndex.get(`${season}|${type}`) ?? [])];
	}

	awardWinner(season: number, type: string) {
		const pid = this.awardPids(season, type)[0];
		return pid === undefined ? undefined : this.players.get(pid);
	}

	countAwards(p: WPlayer, type: string, upTo: number = Infinity) {
		let n = 0;
		for (const a of p.awards) {
			if (a.type === type && a.season <= upTo && this.decided(a.season)) {
				n += 1;
			}
		}
		return n;
	}

	careerRows(p: WPlayer, upTo: number = Infinity) {
		return p.stats.filter((r) => r.season <= upTo && r.gp > 0);
	}

	career(p: WPlayer, upTo: number = Infinity) {
		return sumRows(this.careerRows(p, upTo));
	}

	// Team that a player played the most games for, over a set of rows
	mainTeam(rows: WStat[]) {
		const gp = new Map<number, number>();
		for (const r of rows) {
			gp.set(r.tid, (gp.get(r.tid) ?? 0) + r.gp);
		}
		let best = -1;
		let bestGp = -1;
		for (const [tid, n] of gp) {
			if (n > bestGp) {
				best = tid;
				bestGp = n;
			}
		}
		return best;
	}

	titlesOf(tid: number, upTo: number = Infinity) {
		const out: number[] = [];
		for (const ts of this.teamsByTid.get(tid) ?? []) {
			if (
				ts.season <= upTo &&
				this.decided(ts.season) &&
				ts.playoffRoundsWon >= this.numRounds(ts.season) &&
				this.numRounds(ts.season) > 0
			) {
				out.push(ts.season);
			}
		}
		return out;
	}

	teamHistory(tid: number) {
		return [...(this.teamsByTid.get(tid) ?? [])].sort(
			(a, b) => a.season - b.season,
		);
	}
}
