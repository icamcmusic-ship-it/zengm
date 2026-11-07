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
