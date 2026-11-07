// A deterministic large fake league (30 teams, decades of history, players with real careers that start, change teams and retire), for performance tests and for checking that the engines give the same output after refactors. Unlike makeLeague, players come and go, so there are tens of thousands of stat rows.
import type {
	WAward,
	WGame,
	WLeague,
	WPlayer,
	WStat,
	WTeamSeason,
} from "./types.ts";
import { seededRng } from "./util.ts";

export const makeBigLeague = ({
	numTeams = 30,
	numSeasons = 40,
	seed = "big",
	// Seasons at the end that have box scores
	boxSeasons = 2,
	gamesPerTeam = 82,
}: {
	numTeams?: number;
	numSeasons?: number;
	seed?: string;
	boxSeasons?: number;
	gamesPerTeam?: number;
} = {}): WLeague => {
	const rng = seededRng(seed);
	const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
	const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)]!;
	const start = 1990;
	const last = start + numSeasons - 1;
	const players: WPlayer[] = [];
	const teamSeasons: WTeamSeason[] = [];
	const series: WLeague["series"] = [];
	const games: WGame[] = [];
	const numPlayoffRounds: Record<number, number> = {};

	// Per player: his entire career is planned up front
	type Active = { p: WPlayer; tid: number; skill: number; end: number };
	let active: Active[] = [];
	let nextPid = 0;
	const newPlayer = (season: number, tid: number): Active => {
		const age = ri(19, 22);
		const pid = nextPid++;
		const p: WPlayer = {
			pid,
			name: `First${pid} Last${pid % 977}`,
			firstName: `First${pid}`,
			lastName: `Last${pid % 977}`,
			bornYear: season - age,
			bornLoc: pid % 9 === 0 ? "Canada" : "USA",
			college: pid % 3 === 0 ? "" : `College${pid % 40}`,
			draft: {
				year: season - 1,
				round: 1 + (pid % 2),
				pick: 1 + (pid % 30),
				tid,
			},
			tid,
			retiredYear: Infinity,
			hof: false,
			awards: [],
			stats: [],
			po: [],
			injuries: [],
			ovr: {},
			moves: [{ season: season - 1, tid, type: "draft" }],
			relatives: [],
		};
		players.push(p);
		const skill = Math.pow(rng(), 2.2);
		return { p, tid, skill, end: season + ri(3, 16) };
	};

	for (let tid = 0; tid < numTeams; tid++) {
		for (let k = 0; k < 14; k++) {
			active.push(newPlayer(start, tid));
		}
	}

	const AWARDS_TOP = [
		"Most Valuable Player",
		"Defensive Player of the Year",
		"Rookie of the Year",
		"Sixth Man of the Year",
		"Most Improved Player",
	];

	for (let s = start; s <= last; s++) {
		numPlayoffRounds[s] = 4;
		const strength = Array.from({ length: numTeams }, () => rng());
		const rows = new Map<number, WStat[]>();
		const seasonRows: { a: Active; row: WStat }[] = [];
		for (const a of active) {
			const age = s - a.p.bornYear;
			const peak = 1 - Math.abs(age - 27) / 14;
			const level = Math.max(0.05, a.skill * Math.max(0.2, peak));
			const gp = ri(25, gamesPerTeam);
			const mpg = 8 + level * 30;
			const ppg = 2 + level * 28 + rng() * 2;
			// A few players are traded mid-season, giving two rows
			const traded = rng() < 0.08;
			const parts = traded ? 2 : 1;
			for (let i = 0; i < parts; i++) {
				const tid = i === 0 ? a.tid : (a.tid + ri(1, numTeams - 1)) % numTeams;
				const g = Math.max(1, Math.round(gp / parts));
				const row: WStat = {
					season: s,
					tid,
					gp: g,
					gs: Math.round(g * level),
					min: g * mpg,
					pts: g * ppg,
					trb: g * (1 + level * 10 * rng()),
					ast: g * (0.5 + level * 8 * rng()),
					stl: g * level * 2,
					blk: g * level * 1.5 * rng(),
					tov: g * (1 + level * 2),
					tp: g * level * 3 * rng(),
					tpa: g * level * 7,
					fg: g * ppg * 0.36,
					fga: g * ppg * 0.8,
					ft: g * ppg * 0.2,
					fta: g * ppg * 0.26,
					per: 8 + level * 20 + rng(),
					ws: level * 12 * (g / 82),
					bpm: -4 + level * 12,
					vorp: level * 6 * (g / 82),
				};
				a.p.stats.push(row);
				seasonRows.push({ a, row });
				let list = rows.get(tid);
				if (!list) {
					list = [];
					rows.set(tid, list);
				}
				list.push(row);
			}
			a.p.ovr[s] = Math.round(40 + level * 40);
			a.p.tid = a.tid;
			if (rng() < 0.03) {
				a.p.injuries.push({
					season: s,
					games: ri(2, 60),
					type: pick(["Sprained Ankle", "Torn ACL", "Bruised Knee"]),
				});
			}
		}

		// Teams
		const wins = strength.map((x) => Math.round(15 + x * 52 + rng() * 6));
		const order = [...Array(numTeams).keys()].sort(
			(a, b) => wins[b]! - wins[a]!,
		);
		const seedOfTid = new Map<number, number>();
		order.slice(0, 16).forEach((tid, i) => seedOfTid.set(tid, i + 1));
		for (let tid = 0; tid < numTeams; tid++) {
			teamSeasons.push({
				tid,
				season: s,
				abbrev: `T${tid}`,
				region: `City${tid}`,
				name: `Team${tid}`,
				colors: ["#a00", "#fff", "#888"],
				won: wins[tid]!,
				lost: gamesPerTeam - wins[tid]!,
				tied: 0,
				otl: 0,
				playoffRoundsWon: -1,
				seed: seedOfTid.get(tid),
				gp: gamesPerTeam,
				pts: gamesPerTeam * (95 + Math.round(strength[tid]! * 20)),
				oppPts: gamesPerTeam * (115 - Math.round(strength[tid]! * 20)),
			});
		}
		const tsOf = (tid: number) =>
			teamSeasons.find((t) => t.season === s && t.tid === tid)!;
		// Four rounds of seeded series among 16 teams
		let alive = order.slice(0, 16);
		const rounds: WLeague["series"][number]["rounds"] = [];
		for (let r = 0; r < 4; r++) {
			const matches: WLeague["series"][number]["rounds"][number] = [];
			const next: number[] = [];
			for (let i = 0; i < alive.length / 2; i++) {
				const hi = alive[i]!;
				const lo = alive[alive.length - 1 - i]!;
				const upset = rng() < 0.25;
				const winner = upset ? lo : hi;
				const loserWon = ri(0, 3);
				matches.push({
					home: {
						tid: hi,
						seed: seedOfTid.get(hi)!,
						won: winner === hi ? 4 : loserWon,
					},
					away: {
						tid: lo,
						seed: seedOfTid.get(lo)!,
						won: winner === lo ? 4 : loserWon,
					},
				});
				next.push(winner);
				tsOf(hi).playoffRoundsWon = Math.max(
					tsOf(hi).playoffRoundsWon,
					winner === hi ? r + 1 : r,
				);
				tsOf(lo).playoffRoundsWon = Math.max(
					tsOf(lo).playoffRoundsWon,
					winner === lo ? r + 1 : r,
				);
			}
			rounds.push(matches);
			alive = next;
		}
		series.push({ season: s, rounds });
		const champ = tsOf(alive[0]!);

		// Playoff stat rows
		for (const { a, row } of seasonRows) {
			const ts = tsOf(row.tid);
			if (ts.playoffRoundsWon < 0 || a.tid !== row.tid) {
				continue;
			}
			const g = Math.max(1, Math.round((ts.playoffRoundsWon + 1) * 5 * rng()));
			a.p.po.push({
				...row,
				gp: g,
				gs: g,
				min: (row.min / row.gp) * g,
				pts: (row.pts / row.gp) * g,
				trb: (row.trb / row.gp) * g,
				ast: (row.ast / row.gp) * g,
				stl: (row.stl / row.gp) * g,
				blk: (row.blk / row.gp) * g,
				tov: (row.tov / row.gp) * g,
				tp: (row.tp / row.gp) * g,
				tpa: (row.tpa / row.gp) * g,
				fg: (row.fg / row.gp) * g,
				fga: (row.fga / row.gp) * g,
				ft: (row.ft / row.gp) * g,
				fta: (row.fta / row.gp) * g,
			});
		}

		// Awards
		const byWs = [...seasonRows].sort((x, y) => y.row.ws - x.row.ws);
		const award = (p: WPlayer, type: string) => {
			p.awards.push({ season: s, type } as WAward);
		};
		for (const [i, t] of AWARDS_TOP.entries()) {
			award(byWs[i * 3 + ri(0, 2)]!.a.p, t);
		}
		for (const { a } of byWs.slice(0, 24)) {
			award(a.p, "All-Star");
		}
		byWs.slice(0, 5).forEach(({ a }) => award(a.p, "First Team All-League"));
		byWs.slice(5, 10).forEach(({ a }) => award(a.p, "Second Team All-League"));
		byWs.slice(10, 15).forEach(({ a }) => award(a.p, "Third Team All-League"));
		const champRows = seasonRows
			.filter((x) => x.row.tid === champ.tid)
			.sort((x, y) => y.row.ws - x.row.ws);
		if (champRows[0]) {
			award(champRows[0].a.p, "Finals MVP");
		}
		for (const { a, row } of champRows) {
			if (a.tid === row.tid) {
				award(a.p, "Won Championship");
			}
		}

		// Box scores for the recent seasons only, as BBGM keeps few
		if (s > last - boxSeasons) {
			const rosterOf = new Map<number, Active[]>();
			for (const a of active) {
				const l = rosterOf.get(a.tid) ?? [];
				l.push(a);
				rosterOf.set(a.tid, l);
			}
			for (let i = 0; i < (numTeams * gamesPerTeam) / 2; i++) {
				const a = ri(0, numTeams - 1);
				const b = (a + ri(1, numTeams - 1)) % numTeams;
				const line = (tid: number) =>
					(rosterOf.get(tid) ?? []).slice(0, 10).map(({ p, skill }) => ({
						pid: p.pid,
						name: p.name,
						min: 10 + Math.round(skill * 28),
						pts: ri(0, 8 + Math.round(skill * 30)),
						trb: ri(0, 4 + Math.round(skill * 10)),
						ast: ri(0, 3 + Math.round(skill * 9)),
						stl: ri(0, 3),
						blk: ri(0, 3),
						tp: ri(0, 6),
					}));
				const pa = line(a);
				const pb = line(b);
				games.push({
					gid: s * 10000 + i,
					season: s,
					day: i,
					playoffs: i % 25 === 0,
					overtimes: i % 50 === 0 ? 1 : 0,
					teams: [
						{ tid: a, pts: pa.reduce((x, y) => x + y.pts, 0), players: pa },
						{
							tid: b,
							pts: pb.reduce((x, y) => x + y.pts, 0) + (i % 7 === 0 ? 1 : 0),
							players: pb,
						},
					],
				});
			}
		}

		// Age, retire, draft, trade
		const next: Active[] = [];
		for (const a of active) {
			if (s >= a.end || s - a.p.bornYear > 39) {
				a.p.retiredYear = s;
				a.p.tid = -3;
				a.p.hof = a.skill > 0.8 && a.p.stats.length > 10;
				if (a.p.hof) {
					award(a.p, "Hall of Fame");
				}
				continue;
			}
			if (rng() < 0.12) {
				a.tid = ri(0, numTeams - 1);
				a.p.moves.push({
					season: s,
					tid: a.tid,
					type: "trade",
					fromTid: a.p.tid,
				});
			}
			next.push(a);
		}
		active = next;
		const perTeam = new Map<number, number>();
		for (const a of active) {
			perTeam.set(a.tid, (perTeam.get(a.tid) ?? 0) + 1);
		}
		for (let tid = 0; tid < numTeams; tid++) {
			for (let k = perTeam.get(tid) ?? 0; k < 14; k++) {
				active.push(newPlayer(s + 1, tid));
			}
		}
	}

	return {
		startingSeason: start,
		season: last,
		currentComplete: true,
		userTid: 3,
		numPlayoffRounds,
		teamSeasons,
		players,
		series,
		games,
	};
};
