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

const OPT_SUM = ["orb", "drb", "pf", "pm", "ows", "dws", "dd", "td"] as const;
const OPT_MAX = [
	"ptsMax",
	"trbMax",
	"astMax",
	"stlMax",
	"blkMax",
	"tpMax",
] as const;
const OPT_RATE = ["ortg", "drtg", "usgp"] as const;

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
	// Optional fields stay undefined unless every row recorded them
	for (const k of OPT_SUM) {
		if (rows.length > 0 && rows.every((r) => r[k] !== undefined)) {
			out[k] = rows.reduce((a, r) => a + r[k]!, 0);
		}
	}
	for (const k of OPT_MAX) {
		if (rows.length > 0 && rows.every((r) => r[k] !== undefined)) {
			out[k] = Math.max(...rows.map((r) => r[k]!));
		}
	}
	for (const k of OPT_RATE) {
		if (rows.length > 0 && rows.every((r) => r[k] !== undefined) && minW > 0) {
			out[k] = rows.reduce((a, r) => a + r[k]! * r.min, 0) / minW;
		}
	}
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

export class LeagueIndex {
	L: WLeague;
	players = new Map<number, WPlayer>();
	private teamMap = new Map<string, WTeamSeason>();
	private linesBySeason = new Map<number, SeasonLine[]>();
	private lineMaps = new Map<number, Map<number, SeasonLine>>();
	private poBySeason = new Map<number, SeasonLine[]>();
	private seriesBySeason = new Map<number, WSeries>();
	private gamesBySeason = new Map<number, WGame[]>();
	private memo = new Map<string, unknown>();
	seasons: number[];

	constructor(L: WLeague) {
		this.L = L;
		for (const p of L.players) {
			this.players.set(p.pid, p);
		}
		const seasons = new Set<number>();
		for (const ts of L.teamSeasons) {
			this.teamMap.set(`${ts.tid}|${ts.season}`, ts);
			seasons.add(ts.season);
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
		for (const p of L.players) {
			for (const [src, target] of [
				[p.stats, this.linesBySeason],
				[p.po, this.poBySeason],
			] as const) {
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
					list.push(toLine(p, rows));
				}
			}
		}
	}

	// Every player's line for one team in one season, using only the games he played for that team
	teamLines(tid: number, season: number): SeasonLine[] {
		const all = this.cached("teamLines", () => {
			const m = new Map<string, SeasonLine[]>();
			for (const p of this.L.players) {
				const by = new Map<string, WStat[]>();
				for (const r of p.stats) {
					if (r.gp <= 0) {
						continue;
					}
					const k = `${r.tid}|${r.season}`;
					const rows = by.get(k);
					if (rows) {
						rows.push(r);
					} else {
						by.set(k, [r]);
					}
				}
				for (const [k, rows] of by) {
					const list = m.get(k);
					const line = toLine(p, rows);
					if (list) {
						list.push(line);
					} else {
						m.set(k, [line]);
					}
				}
			}
			return m;
		});
		return all.get(`${tid}|${season}`) ?? [];
	}

	// A player's last regular-season line before this season
	prevLine(pid: number, season: number) {
		for (let s = season - 1; s >= season - 6; s--) {
			const l = this.line(pid, s);
			if (l) {
				return l;
			}
		}
		return undefined;
	}

	// Playoff series a team played in a season, round by round
	seriesOf(tid: number, season: number) {
		const ps = this.series(season);
		if (!ps || !this.decided(season)) {
			return [];
		}
		const out: {
			round: number;
			won: number;
			lost: number;
			seed: number;
			oppTid: number;
			oppSeed: number;
			win: boolean;
		}[] = [];
		for (const [ri, round] of ps.rounds.entries()) {
			for (const m of round) {
				if (!m.away) {
					continue;
				}
				const me =
					m.home.tid === tid ? m.home : m.away.tid === tid ? m.away : undefined;
				if (!me) {
					continue;
				}
				const opp = me === m.home ? m.away : m.home;
				out.push({
					round: ri,
					won: me.won,
					lost: opp.won,
					seed: me.seed,
					oppTid: opp.tid,
					oppSeed: opp.seed,
					win: me.won > opp.won,
				});
			}
		}
		return out;
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
		for (const ts of this.L.teamSeasons) {
			if (
				ts.tid === tid &&
				(!best || Math.abs(ts.season - season) < Math.abs(best.season - season))
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

	teamsIn(season: number) {
		return this.L.teamSeasons.filter((ts) => ts.season === season);
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
		return this.teamsIn(season).find((t) => t.playoffRoundsWon >= n && n > 0);
	}

	runnerUp(season: number) {
		if (!this.decided(season)) {
			return undefined;
		}
		const n = this.numRounds(season);
		return this.teamsIn(season).find((t) => t.playoffRoundsWon === n - 1);
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
		return this.linesBySeason.get(season) ?? [];
	}

	poLines(season: number) {
		return this.poBySeason.get(season) ?? [];
	}

	line(pid: number, season: number) {
		let m = this.lineMaps.get(season);
		if (!m) {
			m = new Map(this.lines(season).map((l) => [l.pid, l]));
			this.lineMaps.set(season, m);
		}
		return m.get(pid);
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
		const out: number[] = [];
		if (!this.decided(season) && type !== "All-Star") {
			return out;
		}
		for (const p of this.L.players) {
			if (p.awards.some((a) => a.season === season && a.type === type)) {
				out.push(p.pid);
			}
		}
		return out;
	}

	awardWinner(season: number, type: string) {
		const pid = this.awardPids(season, type)[0];
		return pid === undefined ? undefined : this.players.get(pid);
	}

	countAwards(p: WPlayer, type: string, upTo: number = Infinity) {
		return p.awards.filter(
			(a) => a.type === type && a.season <= upTo && this.decided(a.season),
		).length;
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
		return this.L.teamSeasons
			.filter(
				(ts) =>
					ts.tid === tid &&
					ts.season <= upTo &&
					this.decided(ts.season) &&
					ts.playoffRoundsWon >= this.numRounds(ts.season) &&
					this.numRounds(ts.season) > 0,
			)
			.map((ts) => ts.season);
	}

	teamHistory(tid: number) {
		return this.L.teamSeasons
			.filter((ts) => ts.tid === tid)
			.sort((a, b) => a.season - b.season);
	}
}
