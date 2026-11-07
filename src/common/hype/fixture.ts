// A deterministic fake season for tests of the hype engine: 8 teams, a 70 game season of box scores, a short playoff bracket, eight seasons of history, and a few planted story lines (a career milestone, a heater, a revenge game, a rookie duel, a record chase).
import { seededRng } from "../wrapped/util.ts";
import { buildRecords } from "./records.ts";
import type {
	HBoxLine,
	HGame,
	HPlayerRaw,
	HRaw,
	HRow,
	HSeries,
	HTeam,
} from "./types.ts";

export const SEASON = 2030;
export const NUM_GAMES = 70;
const FIRST = 2022;

// Planted story lines (pids)
export const MILESTONE_PID = 0; // 19,800 career points going into the season, 20 a game
export const HEATER_PID = 12; // 25 a game in his team's games 11-15, 10 before and after
export const MOVER_PID = 22; // traded from team 3 to team 2 last offseason
export const ROOKIE_A = 5; // team 0, No. 1 pick
export const ROOKIE_B = 15; // team 1, No. 2 pick
export const CHASER_PID = 30; // team 3, 40 a game against a 2,700 point record
export const HOLDER_PID = 40; // team 4, set the record in 2026

const teamOf = (pid: number) => Math.floor(pid / 10);

export const makeRaw = (seed = "hype-fixture"): HRaw => {
	const rng = seededRng(seed);
	const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
	const teams: HTeam[] = Array.from({ length: 8 }, (_, tid) => ({
		tid,
		abbrev: `T${tid}`,
		name: `City${tid} Team${tid}`,
		cid: tid < 4 ? 0 : 1,
		did: tid % 2,
	}));

	const players: HPlayerRaw[] = [];
	for (let pid = 0; pid < 80; pid++) {
		const tid = teamOf(pid);
		const i = pid % 10;
		const rookie = pid === ROOKIE_A || pid === ROOKIE_B;
		const rows: HRow[] = [];
		const ovrBySeason: Record<number, number> = {};
		const baseOvr = 72 - i * 3 + (pid % 3);
		for (let s = FIRST; s <= SEASON; s++) {
			ovrBySeason[s] = baseOvr + (s % 2);
		}
		if (!rookie) {
			for (let s = FIRST; s < SEASON; s++) {
				let ppg = Math.max(4, 22 - i * 2) + (s % 3);
				let pts = 70 * ppg;
				if (pid === MILESTONE_PID) {
					pts = s === SEASON - 1 ? 1404 : 2628;
				}
				if (pid === CHASER_PID) {
					pts = 70 * 15;
				}
				if (pid === HOLDER_PID) {
					pts = s === 2026 ? 2700 : 70 * 12;
				}
				ppg = pts / 70;
				// the mover played for team 3 until last season
				const rowTid = pid === MOVER_PID ? 3 : tid;
				rows.push({
					season: s,
					tid: rowTid,
					gp: 70,
					min: 70 * 30,
					pts,
					trb: 70 * (i < 3 ? 8 : 4),
					ast: 70 * (i < 3 ? 5 : 2),
					stl: 70,
					blk: 35,
					tp: 70 * 2,
				});
			}
		}
		players.push({
			pid,
			name: `Player ${pid}`,
			tid,
			draft: rookie
				? { year: SEASON - 1, round: 1, pick: pid === ROOKIE_A ? 1 : 2 }
				: { year: FIRST - 3, round: 1 + (pid % 2), pick: 1 + (pid % 30) },
			rows,
			ovrBySeason,
			allStar: pid === MOVER_PID ? [2027] : [],
			moves:
				pid === MOVER_PID
					? [{ season: SEASON - 1, phase: 7, tid: 2, type: "trade", fromTid: 3 }]
					: [],
			released: [],
		});
	}

	// Schedule: circle method, 7 rounds repeated
	const games: HGame[] = [];
	let gid = 1000;
	const order = [0, 1, 2, 3, 4, 5, 6, 7];
	for (let day = 1; day <= NUM_GAMES; day++) {
		const rot = [order[0]!, ...order.slice(1).map((_, k) => order[1 + ((k + day - 1) % 7)]!)];
		const cycle = Math.floor((day - 1) / 7);
		for (let k = 0; k < 4; k++) {
			let a = rot[k]!;
			let b = rot[7 - k]!;
			if ((k + cycle) % 2 === 1) {
				[a, b] = [b, a];
			}
			games.push(makeGame(gid++, day, [a, b], [0, 0], false, false));
		}
	}

	// The box scores. Team points are the sum of the lines, with the planted lines in them.
	const teamGame = new Map<number, number>();
	for (const g of games) {
		for (const t of g.teams) {
			const n = (teamGame.get(t.tid) ?? 0) + 1;
			teamGame.set(t.tid, n);
			const roster = players.filter((p) => p.tid === t.tid);
			t.players = roster.map((p) => {
				const i = p.pid % 10;
				let pts = Math.round(ri(1, 4) + (10 - i) * 1.4);
				if (i === 6) {
					pts += ri(0, 30);
				}
				if (p.pid === MILESTONE_PID || p.pid === MOVER_PID) {
					pts = 20;
				}
				if (p.pid === HEATER_PID) {
					pts = n >= 11 && n <= 15 ? 25 : 10;
				}
				if (p.pid === CHASER_PID) {
					pts = 40;
				}
				if (p.pid === ROOKIE_A || p.pid === ROOKIE_B) {
					pts = 14;
				}
				return {
					pid: p.pid,
					name: p.name,
					min: Math.max(8, 36 - i * 3),
					pts,
					trb: i < 3 ? 6 : 3,
					ast: i < 3 ? 4 : 1,
					stl: 1,
					blk: i === 1 ? 1 : 0,
					tp: i < 4 ? 2 : 1,
				};
			});
			t.pts = t.players.reduce((s, p) => s + p.pts, 0);
			t.ovr = 50 + (t.tid % 4) * 2;
		}
		// no ties
		if (g.teams[0].pts === g.teams[1].pts) {
			g.teams[0].players[6]!.pts += 1;
			g.teams[0].pts += 1;
		}
		for (const t of g.teams) {
			t.ptsQtrs = quarters(t.pts, g.gid);
		}
	}
	// records after each game
	{
		const w = new Map<number, number>();
		const l = new Map<number, number>();
		for (const g of games) {
			const hw = g.teams[0].pts > g.teams[1].pts;
			const [h, a] = g.teams;
			w.set(h.tid, (w.get(h.tid) ?? 0) + (hw ? 1 : 0));
			l.set(h.tid, (l.get(h.tid) ?? 0) + (hw ? 0 : 1));
			w.set(a.tid, (w.get(a.tid) ?? 0) + (hw ? 0 : 1));
			l.set(a.tid, (l.get(a.tid) ?? 0) + (hw ? 1 : 0));
			h.won = w.get(h.tid);
			h.lost = l.get(h.tid);
			a.won = w.get(a.tid);
			a.lost = l.get(a.tid);
		}
	}

	// Playoffs: top four by record, two best-of-3 rounds
	const finalW = new Map<number, number>();
	for (const g of games) {
		const hw = g.teams[0].pts > g.teams[1].pts;
		finalW.set(g.teams[0].tid, (finalW.get(g.teams[0].tid) ?? 0) + (hw ? 1 : 0));
		finalW.set(g.teams[1].tid, (finalW.get(g.teams[1].tid) ?? 0) + (hw ? 0 : 1));
	}
	const seeds = [...order].sort((a, b) => (finalW.get(b) ?? 0) - (finalW.get(a) ?? 0) || a - b).slice(0, 4);
	const series: HSeries[] = [];
	let day = NUM_GAMES + 1;
	const playSeries = (
		round: number,
		hi: { tid: number; seed: number },
		lo: { tid: number; seed: number },
		start: number,
	) => {
		const s: HSeries = {
			season: SEASON,
			round,
			numRounds: 2,
			numToWin: 2,
			home: { ...hi, won: 0 },
			away: { ...lo, won: 0 },
			gids: [],
		};
		let d = start;
		while (s.home.won < 2 && s.away!.won < 2) {
			const n = s.gids.length;
			const homeTid = n === 1 ? lo.tid : hi.tid;
			const awayTid = n === 1 ? hi.tid : lo.tid;
			// the better seed wins unless it is the third game
			const homeWins = homeTid === hi.tid ? (n + round) % 3 !== 0 : (n + round) % 3 === 0;
			const g = makeGame(gid++, d, [homeTid, awayTid], homeWins ? [101, 96] : [95, 100], true, false);
			fillBox(g, players, ri);
			games.push(g);
			s.gids.push(g.gid);
			const winner = homeWins ? homeTid : awayTid;
			if (winner === s.home.tid) {
				s.home.won++;
			} else {
				s.away!.won++;
			}
			d++;
		}
		series.push(s);
		return { winner: s.home.won > s.away!.won ? s.home : s.away!, end: d };
	};
	const a = playSeries(0, { tid: seeds[0]!, seed: 1 }, { tid: seeds[3]!, seed: 4 }, day);
	const b = playSeries(0, { tid: seeds[1]!, seed: 2 }, { tid: seeds[2]!, seed: 3 }, day);
	day = Math.max(a.end, b.end);
	const [x, y] = a.winner.seed < b.winner.seed ? [a.winner, b.winner] : [b.winner, a.winner];
	playSeries(1, x, y, day);

	// History: the finals of the year before, and a few older meetings between teams 0 and 1
	const past = (season: number, round: number, hi: number, lo: number, hiWon: number, loWon: number): HSeries => ({
		season,
		round,
		numRounds: 2,
		numToWin: 2,
		home: { tid: hi, seed: 1, won: hiWon },
		away: { tid: lo, seed: 2, won: loWon },
		gids: [],
	});
	const history = [
		past(2027, 0, 0, 1, 2, 1),
		past(2028, 1, 0, 1, 2, 0),
		past(2029, 1, 1, 0, 2, 1),
		past(2026, 0, 2, 5, 2, 0),
	];

	const raw: HRaw = {
		season: SEASON,
		numGames: NUM_GAMES,
		teams,
		games,
		linesComplete: true,
		players,
		series: [...history, ...series],
		records: null,
		playoffsByConf: true,
		maxPlayoffSeed: 3,
	};
	// this season's rows, from the box scores
	for (const p of players) {
		const mine = games.filter((g) => !g.playoffs && g.teams.some((t) => t.players.some((l) => l.pid === p.pid && l.min > 0)));
		let pts = 0;
		for (const g of mine) {
			pts += g.teams.flatMap((t) => t.players).find((l) => l.pid === p.pid)!.pts;
		}
		p.rows.push({ season: SEASON, tid: p.tid, gp: mine.length, pts, trb: mine.length * 3, ast: mine.length, stl: mine.length, blk: 0, tp: mine.length });
	}
	raw.records = buildRecords(players, SEASON);
	return raw;
};

function quarters(total: number, gid: number) {
	const r = seededRng(`q${gid}-${total}`);
	const q = [0.25, 0.25, 0.25].map((f) => Math.round(total * (f + (r() - 0.5) * 0.06)));
	q.push(total - q[0]! - q[1]! - q[2]!);
	return q;
}

function makeGame(
	gid: number,
	day: number,
	tids: [number, number],
	pts: [number, number],
	playoffs: boolean,
	playIn: boolean,
): HGame {
	return {
		gid,
		season: SEASON,
		day,
		playoffs,
		playIn,
		overtimes: 0,
		teams: [
			{ tid: tids[0], pts: pts[0], players: [] },
			{ tid: tids[1], pts: pts[1], players: [] },
		],
		clutch: [],
	};
}

function fillBox(g: HGame, players: HPlayerRaw[], ri: (a: number, b: number) => number) {
	for (const t of g.teams) {
		const roster = players.filter((p) => p.tid === t.tid);
		let left = t.pts;
		const lines: HBoxLine[] = roster.map((p) => {
			const i = p.pid % 10;
			const pts = Math.min(left, Math.max(0, Math.round(ri(1, 4) + (10 - i) * 1.4)));
			left -= pts;
			return { pid: p.pid, name: p.name, min: Math.max(8, 36 - i * 3), pts, trb: 3, ast: 1, stl: 1, blk: 0, tp: 1 };
		});
		lines[6]!.pts += left;
		t.players = lines;
		t.ptsQtrs = quarters(t.pts, g.gid);
		t.ovr = 52;
	}
}
