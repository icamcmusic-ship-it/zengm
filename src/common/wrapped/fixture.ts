// A deterministic fake league for tests of the Wrapped and Storylines engines
import type { WGame, WLeague, WPlayer, WStat, WTeamSeason } from "./types.ts";
import { seededRng } from "./util.ts";

export const makeLeague = (numSeasons = 4, seed = "fixture"): WLeague => {
	const rng = seededRng(seed);
	const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
	const start = 2025;
	const numTeams = 8;
	const teamSeasons: WTeamSeason[] = [];
	const players: WPlayer[] = [];
	const games: WGame[] = [];
	const series: WLeague["series"] = [];
	const numPlayoffRounds: Record<number, number> = {};
	for (let pid = 0; pid < numTeams * 10; pid++) {
		players.push({
			pid,
			name: `Player ${pid}`,
			firstName: "Player",
			lastName: `${pid}`,
			bornYear: start - ri(19, 34),
			bornLoc: pid % 7 === 0 ? "Canada" : "USA",
			college: "",
			draft: {
				year: start - 3,
				round: 1 + (pid % 2),
				pick: 1 + (pid % 30),
				tid: pid % numTeams,
			},
			tid: pid % numTeams,
			retiredYear: Infinity,
			hof: false,
			awards: [],
			stats: [],
			po: [],
			injuries: [],
			ovr: {},
			moves: [],
			relatives: [],
		});
	}
	for (let s = start; s < start + numSeasons; s++) {
		numPlayoffRounds[s] = 2;
		const wins = Array.from({ length: numTeams }, () => ri(10, 72));
		for (let tid = 0; tid < numTeams; tid++) {
			const won = wins[tid]!;
			teamSeasons.push({
				tid,
				season: s,
				abbrev: `T${tid}`,
				region: `City${tid}`,
				name: `Team${tid}`,
				colors: ["#000", "#fff", "#888"],
				won,
				lost: 82 - won,
				tied: 0,
				otl: 0,
				playoffRoundsWon: -1,
				gp: 82,
				pts: 82 * ri(100, 115),
				oppPts: 82 * ri(100, 115),
			});
		}
		const order = [...Array(numTeams).keys()].sort(
			(a, b) => wins[b]! - wins[a]!,
		);
		const seeds = order.slice(0, 4);
		const r1 = [
			{
				home: { tid: seeds[0]!, seed: 1, won: 4 },
				away: { tid: seeds[3]!, seed: 4, won: ri(0, 3) },
			},
			{
				home: { tid: seeds[1]!, seed: 2, won: ri(0, 3) },
				away: { tid: seeds[2]!, seed: 3, won: 4 },
			},
		];
		const r2 = [
			{
				home: { tid: seeds[0]!, seed: 1, won: 4 },
				away: { tid: seeds[2]!, seed: 3, won: ri(0, 3) },
			},
		];
		series.push({ season: s, rounds: [r1, r2] });
		for (const t of teamSeasons.filter((x) => x.season === s)) {
			t.playoffRoundsWon =
				t.tid === seeds[0]
					? 2
					: t.tid === seeds[2]
						? 1
						: seeds.includes(t.tid)
							? 0
							: -1;
			t.seed = seeds.includes(t.tid) ? seeds.indexOf(t.tid) + 1 : undefined;
		}
		for (const p of players) {
			const gp = ri(40, 82);
			const ppg = ri(3, 30);
			const row: WStat = {
				season: s,
				tid: p.tid,
				gp,
				gs: gp,
				min: gp * ri(10, 38),
				pts: gp * ppg,
				trb: gp * ri(1, 12),
				ast: gp * ri(0, 9),
				stl: gp,
				blk: Math.round(gp / 2),
				tov: gp * 2,
				tp: gp * ri(0, 3),
				tpa: gp * 5,
				fg: gp * 8,
				fga: gp * 17,
				ft: gp * 3,
				fta: gp * 4,
				per: ri(8, 28),
				ws: ri(0, 15),
				bpm: ri(-5, 9),
				vorp: ri(0, 6),
			};
			p.stats.push(row);
			if (p.tid === seeds[0]) {
				p.awards.push({ season: s, type: "Won Championship" });
			}
		}
		players[ri(0, players.length - 1)]!.awards.push({
			season: s,
			type: "Most Valuable Player",
		});
		for (let i = 0; i < 300; i++) {
			const a = ri(0, numTeams - 1);
			const b = (a + ri(1, numTeams - 1)) % numTeams;
			const line = (tid: number) =>
				players
					.filter((p) => p.tid === tid)
					.map((p) => ({
						pid: p.pid,
						name: p.name,
						min: 30,
						pts: ri(0, 40),
						trb: ri(0, 15),
						ast: ri(0, 12),
						stl: ri(0, 4),
						blk: ri(0, 4),
						tp: ri(0, 7),
					}));
			const pa = line(a);
			const pb = line(b);
			games.push({
				gid: s * 1000 + i,
				season: s,
				day: i,
				playoffs: false,
				overtimes: i % 50 === 0 ? 2 : 0,
				teams: [
					{ tid: a, pts: pa.reduce((x, y) => x + y.pts, 0), players: pa },
					{ tid: b, pts: pb.reduce((x, y) => x + y.pts, 0) + 1, players: pb },
				],
			});
		}
	}
	return {
		startingSeason: start,
		season: start + numSeasons - 1,
		currentComplete: true,
		userTid: 0,
		numPlayoffRounds,
		teamSeasons,
		players,
		series,
		games,
	};
};

const PLACES = ["USA", "USA", "USA", "USA", "Canada", "France", "Serbia", "Spain", "Nigeria", "Australia"];
const COLLEGES = ["Duke", "Kansas", "Kentucky", "UCLA", "Gonzaga", "", "", "Arizona"];
const POS = ["PG", "SG", "SF", "PF", "C", "G", "F", "GF", "FC"];

// A richer deterministic league: draft classes, ratings and pay, awards, playoff rows, injuries, trades, retirements and every optional stat, so the extra topics have something to say. It uses its own random stream, so makeLeague itself is unchanged.
export const makeRichLeague = (numSeasons = 12, seed = "rich"): WLeague => {
	const L = makeLeague(numSeasons, seed);
	const rng = seededRng(`${seed}|rich`);
	const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
	const start = L.startingSeason;
	const last = start + numSeasons - 1;
	const numTeams = 8;

	// New draft classes: players drafted in season s play from s + 1
	let pid = L.players.length;
	for (let s = start; s < last; s++) {
		for (let i = 0; i < 14; i++) {
			const round = i < 10 ? 1 : 2;
			const pick = round === 1 ? i + 1 : i - 9;
			const stats: WStat[] = [];
			L.players.push({
				pid,
				name: `Rookie ${pid}`,
				firstName: "Rookie",
				lastName: `${pid}`,
				bornYear: s - ri(19, 23),
				bornLoc: PLACES[pid % PLACES.length]!,
				college: COLLEGES[pid % COLLEGES.length]!,
				draft: { year: s, round, pick, tid: i % numTeams },
				tid: i % numTeams,
				retiredYear: Infinity,
				hof: false,
				awards: [],
				stats,
				po: [],
				injuries: [],
				ovr: {},
				moves: [],
				relatives: [],
			});
			pid += 1;
		}
	}
	const rookies = L.players.slice(numTeams * 10);
	const rowFor = (p: WPlayer, s: number, tid: number, gp: number): WStat => {
		const ppg = ri(2, 28);
		return {
			season: s,
			tid,
			gp,
			gs: ri(0, 1) === 0 ? gp : ri(0, Math.floor(gp / 3)),
			min: gp * ri(8, 36),
			pts: gp * ppg,
			trb: gp * ri(1, 11),
			ast: gp * ri(0, 9),
			stl: gp,
			blk: Math.round(gp / 2),
			tov: gp * 2,
			tp: gp * ri(0, 3),
			tpa: gp * ri(2, 7),
			fg: gp * 8,
			fga: gp * 17,
			ft: gp * 3,
			fta: gp * 4,
			per: ri(8, 28),
			ws: ri(0, 12),
			bpm: ri(-5, 9),
			vorp: ri(0, 5),
		};
	};
	for (const p of rookies) {
		for (let s = p.draft.year + 1; s <= last; s++) {
			p.stats.push(rowFor(p, s, p.tid, ri(30, 82)));
		}
	}
	// Veterans: some retire, some are traded mid-season
	for (const p of L.players) {
		if (p.pid >= numTeams * 10) {
			continue;
		}
		const yrs = p.pid % 3;
		p.draft = {
			year: start - 1 - yrs,
			round: p.pid % 5 === 0 ? 0 : 1 + (p.pid % 2),
			pick: p.pid % 5 === 0 ? 0 : 1 + (p.pid % 14),
			tid: p.pid % numTeams,
		};
		if (p.pid % 9 === 0) {
			const stop = last - 3 - (p.pid % 3);
			p.stats = p.stats.filter((r) => r.season <= stop);
			p.retiredYear = stop;
			p.tid = -3;
		}
		if (p.pid % 11 === 0) {
			const row = p.stats.find((r) => r.season === start + 1);
			if (row && row.gp > 10) {
				const gp1 = Math.floor(row.gp / 2);
				const frac = gp1 / row.gp;
				const second: WStat = {
					...row,
					tid: (row.tid + 1) % numTeams,
					gp: row.gp - gp1,
					gs: 0,
					min: Math.round(row.min * (1 - frac)),
					pts: Math.round(row.pts * (1 - frac)),
				};
				row.gp = gp1;
				row.min = Math.round(row.min * frac);
				row.pts = Math.round(row.pts * frac);
				p.stats.push(second);
				p.moves.push({ season: start + 1, tid: second.tid, type: "trade", fromTid: row.tid });
			}
		}
	}
	L.players[1]!.relatives.push({ type: "brother", pid: 2 });
	L.players[2]!.relatives.push({ type: "brother", pid: 1 });

	// Ratings, pay, optional stats, playoffs, injuries
	const top4 = (s: number) =>
		L.teamSeasons.filter((t) => t.season === s && t.playoffRoundsWon >= 0).map((t) => t.tid);
	for (const p of L.players) {
		p.bornLoc = PLACES[p.pid % PLACES.length]!;
		p.college = COLLEGES[p.pid % COLLEGES.length]!;
		p.pot = {};
		p.pos = {};
		p.paid = [];
		p.moves.unshift({ season: p.draft.year, tid: p.draft.tid, type: "draft" });
		p.hgt = 30 + (p.pid % 60);
		let ovr = ri(40, 62);
		for (const r of p.stats) {
			if (r.gp <= 0) {
				continue;
			}
			ovr = Math.max(25, Math.min(85, ovr + ri(-5, 6)));
			p.ovr[r.season] = ovr;
			p.pot[r.season] = Math.min(90, ovr + Math.max(0, ri(0, 14) - (r.season - p.bornYear - 19))) ;
			p.pos[r.season] = POS[p.pid % POS.length]!;
			p.paid.push({ season: r.season, tid: r.tid, amount: ri(600, 36000) });
			const trb = r.trb;
			r.orb = Math.round(trb * 0.28);
			r.drb = trb - r.orb;
			r.pf = r.gp * 2;
			r.pm = ri(-250, 380);
			r.ortg = ri(98, 122);
			r.drtg = ri(96, 116);
			r.usgp = ri(12, 31);
			r.ows = r.ws * 0.6;
			r.dws = r.ws * 0.4;
			r.dd = ri(0, 35);
			r.td = ri(0, 6);
			r.ptsMax = Math.round(r.pts / r.gp) + ri(5, 25);
			r.trbMax = Math.round(trb / r.gp) + ri(3, 10);
			r.astMax = Math.round(r.ast / r.gp) + ri(3, 9);
			r.stlMax = ri(2, 6);
			r.blkMax = ri(1, 7);
			r.tpMax = ri(1, 8);
			if (top4(r.season).includes(r.tid) && ri(0, 3) > 0) {
				p.po.push({ ...rowFor(p, r.season, r.tid, ri(5, 20)), per: ri(8, 28) });
			}
			if (ri(0, 5) === 0) {
				p.injuries.push({ season: r.season, games: ri(3, 60), type: ri(0, 1) ? "Sprained Ankle" : "Torn ACL" });
			}
		}
	}

	// Awards: sorted by win shares of each season
	for (let s = start; s <= last; s++) {
		const lines = L.players
			.map((p) => ({ p, r: p.stats.find((r) => r.season === s && r.gp > 0) }))
			.filter((x): x is { p: WPlayer; r: WStat } => x.r !== undefined)
			.sort((a, b) => b.r.ws - a.r.ws || a.p.pid - b.p.pid);
		lines.slice(0, 14).forEach((x, i) => {
			x.p.awards.push({ season: s, type: "All-Star" });
			if (i < 5) {
				x.p.awards.push({ season: s, type: "First Team All-League" });
			} else if (i < 10) {
				x.p.awards.push({ season: s, type: "Second Team All-League" });
			}
			if (i >= 5 && i < 9) {
				x.p.awards.push({ season: s, type: "First Team All-Defensive" });
			}
		});
		lines[1]?.p.awards.push({ season: s, type: "Defensive Player of the Year" });
		lines[3]?.p.awards.push({ season: s, type: "Finals MVP" });
		const rk = lines.find((x) => x.p.draft.year === s - 1);
		rk?.p.awards.push({ season: s, type: "Rookie of the Year" });
		for (const x of lines.filter((y) => y.p.draft.year === s - 1).slice(0, 5)) {
			x.p.awards.push({ season: s, type: "First Team All-Rookie" });
		}
	}

	// Team extras
	for (const t of L.teamSeasons) {
		t.cid = t.tid % 2;
		t.did = t.tid % 4;
		const home = Math.min(41, Math.round(t.won * 0.58), t.won);
		t.wonHome = home;
		t.lostHome = 41 - home;
		t.wonAway = Math.min(41, t.won - home);
		t.lostAway = Math.max(0, 41 - t.wonAway);
		t.wonDiv = Math.round(t.won / 6);
		t.lostDiv = 14 - t.wonDiv;
		t.wonConf = Math.round(t.won * 0.5);
		t.lostConf = 40 - t.wonConf;
		t.gpHome = 41;
		t.att = 41 * (12000 + ((t.tid * 977 + t.season * 31) % 8000));
		t.payroll = 60000 + ((t.tid * 7919 + t.season * 131) % 70000);
		t.hype = ((t.tid * 13 + t.season * 7) % 100) / 100;
		t.pop = 2 + (t.tid % 5);
		t.streak = ((t.tid + t.season) % 13) - 6;
		t.numPlayersTradedAway = t.tid % 4;
	}
	L.confs = [
		{ cid: 0, name: "East" },
		{ cid: 1, name: "West" },
	];
	L.divs = [0, 1, 2, 3].map((did) => ({ did, cid: did % 2, name: `Div${did}` }));
	for (const g of L.games) {
		for (const t of g.teams) {
			const q = Math.floor(t.pts / 4);
			t.ptsQtrs = [q, q, q, t.pts - 3 * q];
		}
		g.att = 15000;
	}
	return L;
};
