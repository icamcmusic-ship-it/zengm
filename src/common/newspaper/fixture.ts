// A synthetic league for tests: every kind of fact the engine reads, generated from a seed, so tests can build papers for many seasons and editions without a database.

import { Rng } from "./text.ts";
import type {
	EditionId,
	NPGame,
	NPPlayer,
	NPSeries,
	NPTeam,
	NewsFacts,
} from "./types.ts";

const NUM_TEAMS = 12;
const REGIONS = [
	"Aurora",
	"Bayview",
	"Cedar",
	"Dover",
	"Eastport",
	"Fairview",
	"Glenwood",
	"Harbor",
	"Ironton",
	"Juniper",
	"Kingsford",
	"Lakeside",
];
const NICKS = [
	"Herons",
	"Foxes",
	"Rangers",
	"Pilots",
	"Wolves",
	"Comets",
	"Miners",
	"Sailors",
	"Bears",
	"Falcons",
	"Knights",
	"Owls",
];
const FIRST = [
	"Ari",
	"Ben",
	"Cal",
	"Dev",
	"Eli",
	"Fox",
	"Gus",
	"Hal",
	"Ira",
	"Jax",
	"Kai",
	"Lou",
	"Max",
	"Nia",
	"Oz",
	"Pat",
	"Quin",
	"Rex",
	"Sol",
	"Tay",
	"Uri",
	"Vic",
	"Wes",
	"Xan",
	"Yul",
	"Zed",
];
const LAST = [
	"Abbott",
	"Bishop",
	"Carver",
	"Dalton",
	"Ellis",
	"Frost",
	"Gates",
	"Hobbs",
	"Irwin",
	"Jensen",
	"Keller",
	"Lowe",
	"Marsh",
	"Nash",
	"Orr",
	"Poole",
	"Quist",
	"Reeves",
	"Stone",
	"Tate",
];

export const makeFixture = (
	edition: EditionId,
	season = 2025,
	seedKey = "abc",
): NewsFacts => {
	const r = new Rng(`fixture|${seedKey}|${season}`);
	const firstSeason = 2005;
	const gp =
		edition === "preseason"
			? 0
			: edition === "midseason"
				? 30 + ((season * 7) % 26)
				: 82;
	const numGames = 82;
	// Which team is which in the playoffs changes every season
	const rot = season % NUM_TEAMS;
	const M = (t: number) => (t + rot) % NUM_TEAMS;
	const slotOf = (tid: number) => (tid - rot + NUM_TEAMS) % NUM_TEAMS;
	const finalWins = season % 4;
	const teams: NPTeam[] = [];
	for (let tid = 0; tid < NUM_TEAMS; tid++) {
		const strength = new Rng(`team|${seedKey}|${tid}`).random();
		const won =
			gp === 0
				? 0
				: Math.round(gp * (0.2 + 0.6 * (0.35 * strength + 0.65 * r.random())));
		const hist = [];
		for (let y = firstSeason; y < season; y++) {
			const w = Math.round(
				82 *
					(0.2 +
						0.6 *
							(0.35 * strength +
								0.65 * new Rng(`h|${seedKey}|${tid}|${y}`).random())),
			);
			hist.push({
				season: y,
				won: w,
				lost: 82 - w,
				playoffRoundsWon:
					w > 46 ? new Rng(`po|${seedKey}|${tid}|${y}`).int(0, 3) : -1,
			});
		}
		const champYears = hist
			.filter((h) => h.playoffRoundsWon >= 3)
			.map((h) => h.season);
		const lost = gp - won;
		const rounds = edition === "final" || edition === "playoffs";
		teams.push({
			tid,
			abbrev: REGIONS[tid]!.slice(0, 3).toUpperCase(),
			region: REGIONS[tid]!,
			name: NICKS[tid]!,
			cid: tid % 2,
			did: tid % 4,
			gp,
			won,
			lost,
			pts: gp ? 98 + r.random() * 18 + strength * 4 : undefined,
			oppPts: gp ? 98 + r.random() * 18 - strength * 3 : undefined,
			streak: r.int(-6, 7),
			wonHome: Math.ceil(won * 0.55),
			lostHome: Math.floor(lost * 0.45),
			wonAway: Math.floor(won * 0.45),
			lostAway: Math.ceil(lost * 0.55),
			playoffRoundsWon: rounds
				? slotOf(tid) === 0
					? edition === "final"
						? 3
						: 2
					: slotOf(tid) === 1
						? 2
						: slotOf(tid) < 4
							? 1
							: slotOf(tid) < 8
								? 0
								: -1
				: -1,
			seed: rounds
				? slotOf(tid) < 8
					? (slotOf(tid) % 4) + 1
					: undefined
				: undefined,
			prev: hist.length
				? {
						won: hist.at(-1)!.won,
						lost: hist.at(-1)!.lost,
						playoffRoundsWon: hist.at(-1)!.playoffRoundsWon,
					}
				: undefined,
			titles: champYears,
			firstSeason,
			hist,
			close: gp ? { w: r.int(3, 12), l: r.int(3, 12) } : undefined,
			ot: gp ? { w: r.int(0, 5), l: r.int(0, 5) } : undefined,
			bestStreak: gp ? r.int(4, 11) : undefined,
			worstStreak: gp ? r.int(3, 9) : undefined,
			payroll: 70000 + r.int(0, 60000),
		});
	}

	const players: NPPlayer[] = [];
	let pid = 0;
	for (let tid = 0; tid < NUM_TEAMS; tid++) {
		for (let k = 0; k < 13; k++) {
			const played = gp > 0;
			const games = played ? r.int(Math.floor(gp * 0.5), gp) : 0;
			const star = 1 - k / 13;
			const ppg = played ? 3 + star * 24 + r.random() * 3 : 0;
			const age =
				19 + ((pid * 7 + season) % 17) + (pid % 11 === 0 ? season % 5 : 0);
			const ovr = Math.round(38 + star * 28 + r.random() * 6);
			players.push({
				pid,
				name: `${FIRST[(pid * 3 + Math.floor(season / 2) * 5) % FIRST.length]} ${LAST[(pid * 5 + tid + Math.floor(season / 3)) % LAST.length]}`,
				tid,
				age,
				pos: ["PG", "SG", "SF", "PF", "C", "G", "F"][pid % 7]!,
				ovr,
				pot: Math.min(85, ovr + Math.max(0, 27 - age)),
				prevOvr: ovr + r.int(-6, 7),
				gp: games,
				min: played ? 10 + star * 24 + r.random() * 3 : 0,
				pts: ppg,
				trb: played ? 1 + r.random() * 9 * star + 1 : 0,
				ast: played ? r.random() * 8 * star + 0.5 : 0,
				stl: played ? 0.4 + r.random() * 1.6 : 0,
				blk: played ? 0.2 + r.random() * 1.5 : 0,
				per: played ? 10 + star * 12 : 0,
				ws: played ? star * 9 + r.random() * 2 : 0,
				fgp: 42 + r.random() * 12,
				tpp: 30 + r.random() * 12,
				tp: played ? r.random() * 3 : 0,
				gs: played ? (k < 5 ? 0.9 : 0.1) : undefined,
				ftp: played ? 60 + r.random() * 35 : undefined,
				tov: played ? 0.8 + r.random() * 2.5 : undefined,
				pf: played ? 1.2 + r.random() * 2.2 : undefined,
				orb: played ? r.random() * 3 : undefined,
				ows: played ? star * 5 : undefined,
				dws: played ? star * 3 : undefined,
				pm: played ? (r.random() - 0.5) * 10 : undefined,
				dd: played ? r.int(0, Math.round(star * 30)) : undefined,
				td: played ? r.int(0, Math.round(star * 4)) : undefined,
				g30: played ? r.int(0, Math.round(star * 16)) : undefined,
				g40: played ? r.int(0, 2) : undefined,
				hi: played ? Math.round(ppg + 8 + r.random() * 14) : undefined,
				boxGp: games,
				career: {
					gp: 500 + r.int(0, 600),
					pts: 5000 + r.int(0, 14000),
					trb: 1800 + r.int(0, 4000),
					ast: 900 + r.int(0, 3500),
					stl: 300,
					blk: 200,
					tp: 400,
					ws: 30 + r.int(0, 70),
					seasons: Math.max(1, age - 20),
				},
				honors: {
					mvp: r.int(0, 1),
					dpoy: 0,
					allStar: r.int(0, 5),
					allLeague: r.int(0, 3),
					titles: r.int(0, 2),
				},
				po:
					edition === "final" || edition === "playoffs"
						? {
								gp: 8,
								min: 30,
								pts: 12 + star * 12,
								trb: 5,
								ast: 4,
								stl: 1,
								blk: 1,
								per: 18,
								ws: 1,
								fgp: 47,
								tpp: 36,
								tp: 2,
							}
						: undefined,
				prevLine: { gp: 70, pts: 8 + star * 14, trb: 4, ast: 3, ws: 3 },
				draftYear: season - 1 - (pid % 5),
				draftRound: 1 + (pid % 2),
				draftPick: (pid % 30) + 1,
				draftTid: tid,
				rookie: k === 12,
				contractAmount: 1500 + Math.round(star * 28000),
				contractExp: season + (pid % 4),
				college: pid % 3 === 0 ? "State" : undefined,
				country: pid % 4 === 0 ? "Canada" : "USA",
				jersey: String(pid % 99),
				contractStart: season - (pid % 3),
				contractType: ["rookie", "reSign", "freeAgent"][pid % 3],
				prevTid: pid % 6 === 0 ? (tid + 1 + (season % 3)) % NUM_TEAMS : tid,
			});
			pid += 1;
		}
	}

	const series: NPSeries[][] = [];
	const games: NPGame[] = [];
	if (edition === "final" || edition === "playoffs") {
		const mkSeries = (
			round: number,
			a: number,
			as: number,
			aw: number,
			b: number,
			bs: number,
			bw: number,
			gidStart: number,
		): NPSeries => {
			const total = aw + bw;
			const gids: number[] = [];
			for (let i = 0; i < total; i++) {
				const gid = gidStart + i;
				gids.push(gid);
				const aWins = i < aw;
				const gr = new Rng(`g|${seedKey}|${season}|${gid}`);
				const winner = aWins ? a : b;
				const loser = aWins ? b : a;
				games.push({
					gid,
					playoffs: true,
					won: { tid: winner, pts: 100 + gr.int(0, 14) },
					lost: { tid: loser, pts: 90 + gr.int(0, 9) },
					overtimes: 0,
					stars: [
						{
							pid: winner * 13,
							name: players[winner * 13]!.name,
							tid: winner,
							pts: 20 + gr.int(0, 20),
							trb: 8,
							ast: 6,
							min: 36,
						},
						{
							pid: loser * 13,
							name: players[loser * 13]!.name,
							tid: loser,
							pts: 18 + gr.int(0, 12),
							trb: 6,
							ast: 4,
							min: 36,
						},
					],
				});
			}
			return {
				round,
				home: { tid: a, seed: as, won: aw },
				away: { tid: b, seed: bs, won: bw },
				gids,
			};
		};
		series.push(
			[
				mkSeries(0, M(0), 1, 4, M(7), 4, 1 + (season % 3), 100),
				mkSeries(0, M(1), 2, 4, M(6), 3, 3 - (season % 2), 110),
				mkSeries(0, M(2), 1, 2, M(3), 4, 4, 120),
				mkSeries(0, M(4), 2, 4, M(5), 3, season % 4, 130),
			],
			[
				mkSeries(1, M(0), 1, 4, M(3), 4, 2 + (season % 2), 140),
				mkSeries(
					1,
					M(1),
					2,
					edition === "final" ? 4 : 2,
					M(4),
					3,
					1 + (season % 3),
					150,
				),
			],
		);
		if (edition === "final") {
			series.push([mkSeries(2, M(0), 1, 4, M(1), 2, finalWins, 160)]);
		}
	}

	const final = edition === "final";
	const champions: NonNullable<NewsFacts["champions"]> = [];
	for (let y = firstSeason; y < season; y++) {
		const w = teams.find((t) =>
			t.hist?.some((h) => h.season === y && h.playoffRoundsWon >= 3),
		);
		const l = teams.find((t) =>
			t.hist?.some((h) => h.season === y && h.playoffRoundsWon === 2),
		);
		if (w) {
			champions.push({
				season: y,
				tid: w.tid,
				runnerUp: l?.tid,
				fmvp: "Some Finalist",
			});
		}
	}
	const h2h = [];
	for (let a = 0; a < NUM_TEAMS; a++) {
		for (let b = a + 1; b < NUM_TEAMS; b++) {
			if (gp > 0) {
				const aw = r.int(0, 4);
				h2h.push({ a, b, aw, bw: 4 - aw, margin: r.int(-20, 20) });
			}
		}
	}

	return {
		leagueName: "Test League",
		seedKey,
		season,
		edition,
		numGames,
		numRounds: 3,
		gp,
		userTid: 0,
		confs: [
			{ cid: 0, name: "East" },
			{ cid: 1, name: "West" },
		],
		divs: [
			{ did: 0, cid: 0, name: "North" },
			{ did: 1, cid: 1, name: "South" },
			{ did: 2, cid: 0, name: "Central" },
			{ did: 3, cid: 1, name: "Pacific" },
		],
		teams,
		players,
		awards: final
			? [
					{
						key: "MVP",
						name: "Most Valuable Player",
						pid: M(0) * 13,
						tid: M(0),
						order: [M(0) * 13, M(2) * 13, M(5) * 13],
					},
					{
						key: "DPOY",
						name: "Defensive Player of the Year",
						pid: M(1) * 13 + 1,
						tid: M(1),
						order: [M(1) * 13 + 1, M(3) * 13 + 1],
					},
					{
						key: "FMVP",
						name: "Finals MVP",
						pid: M(0) * 13 + 3,
						tid: M(0),
						order: [M(0) * 13 + 3],
					},
					{
						key: "ROY",
						name: "Rookie of the Year",
						pid: M(0) * 13 + 12,
						tid: M(0),
						order: [M(0) * 13 + 12, M(4) * 13 + 12, M(6) * 13 + 12],
					},
					{
						key: "FMVP",
						name: "East Finals MVP",
						pid: M(0) * 13 + 1,
						tid: M(0),
						order: [M(0) * 13 + 1],
						group: "East",
					},
				]
			: [],
		teamAwards: final
			? [
					{
						key: "allLeague",
						name: "All-League",
						teams: [
							{
								title: "First team",
								pids: [
									M(0) * 13,
									M(0) * 13 + 1,
									M(1) * 13 + 1,
									M(2) * 13 + 1,
									M(3) * 13 + 1,
								],
							},
							{
								title: "Second team",
								pids: [
									M(4) * 13,
									M(5) * 13 + 1,
									M(6) * 13 + 1,
									M(7) * 13 + 1,
									M(8) * 13 + 1,
								],
							},
						],
					},
				]
			: [],
		series,
		currentRound: final ? 3 : edition === "playoffs" ? 1 : 0,
		champion: final ? M(0) : undefined,
		runnerUp: final ? M(1) : undefined,
		games,
		feats: gp
			? [
					{
						pid: 3 + (season % 20),
						name: players[3 + (season % 20)]!.name,
						tid: Math.floor((3 + (season % 20)) / 13),
						oppTid: 2,
						gid: 5 + (season % 9),
						playoffs: false,
						result: "W",
						score: `${120 + (season % 7)}-${110 + (season % 5)}`,
						pts: 44 + (season % 13),
						trb: 10,
						ast: 3,
						stl: 1,
						blk: 0,
					},
					{
						pid: 14 + (season % 11),
						name: players[14 + (season % 11)]!.name,
						tid: 1,
						oppTid: 4,
						gid: 6 + (season % 5),
						playoffs: false,
						result: "L",
						score: `${99 + (season % 4)}-104`,
						pts: 38 + (season % 9),
						trb: 6,
						ast: 9,
						stl: 2,
						blk: 1,
					},
				]
			: [],
		trades: [
			{
				phase: 1,
				tids: [season % 5, 5 + (season % 6)],
				got: [
					[
						{
							kind: "player",
							pid: 30 + (season % 30),
							name: players[30 + (season % 30)]!.name,
							ws: gp ? 1 + (season % 6) : undefined,
						},
					],
					[{ kind: "pick", season: season + 1, round: 1, originalTid: 0 }],
				],
				score: 10,
			},
			{
				phase: 1,
				tids: [(season + 2) % 4, 4 + ((season + 1) % 6)],
				got: [
					[
						{
							kind: "player",
							pid: 45 + (season % 20),
							name: players[45 + (season % 20)]!.name,
							ws: gp ? 0.5 + (season % 4) : undefined,
						},
					],
					[
						{
							kind: "player",
							pid: 70 + (season % 20),
							name: players[70 + (season % 20)]!.name,
							ws: gp ? 2.5 - (season % 3) : undefined,
						},
					],
				],
				score: 6,
			},
		],
		signings: (
			[
				{
					kind: "freeAgent",
					phase: 8,
					pid: 70 + (season % 20),
					name: players[70 + (season % 20)]!.name,
					tid: 5,
					amount: 18000 + (season % 7) * 500,
					exp: season + 3,
					score: 5,
				},
				{
					kind: "freeAgent",
					phase: 8,
					pid: 71 + (season % 20),
					name: players[71 + (season % 20)]!.name,
					tid: 6,
					amount: 14000 + (season % 5) * 400,
					exp: season + 2,
					score: 4,
				},
				{
					kind: "reSigned",
					phase: 7,
					pid: 72 + (season % 20),
					name: players[72 + (season % 20)]!.name,
					tid: 7,
					amount: 22000 + (season % 3) * 700,
					exp: season + 4,
					score: 4,
				},
				{
					kind: "freeAgent",
					phase: 8,
					pid: 73 + (season % 20),
					name: players[73 + (season % 20)]!.name,
					tid: 5,
					amount: 9000,
					exp: season + 1,
					score: 3,
				},
				{
					kind: "freeAgent",
					phase: 8,
					pid: 74 + (season % 20),
					name: players[74 + (season % 20)]!.name,
					tid: 8,
					amount: 7000,
					exp: season + 1,
					score: 2,
				},
			] as NewsFacts["signings"]
		).slice(0, 3 + (season % 3)),
		retirees: final
			? [
					{
						pid: 999,
						name: `${FIRST[season % FIRST.length]} ${LAST[(season * 3) % LAST.length]}`,
						age: 36 + (season % 4),
						tid: M(2),
						seasons: 12 + (season % 7),
						gp: 900 + (season % 13) * 20,
						pts: 15000 + (season % 17) * 400,
						trb: 4000 + (season % 11) * 90,
						ast: 2000 + (season % 9) * 130,
						ws: 80 + (season % 21),
						titles: season % 3,
						mvps: season % 2,
						allStars: 4 + (season % 6),
						hof: season % 5 === 0,
					},
				]
			: [],
		draft: final
			? Array.from({ length: 24 }, (_, i) => ({
					pid: 2000 + i,
					name: `${FIRST[(i + season) % FIRST.length]} ${LAST[(i * 2 + season) % LAST.length]}`,
					tid: (i + season) % NUM_TEAMS,
					round: i < 12 ? 1 : 2,
					pick: (i % 12) + 1,
					age: 19 + ((i + season) % 4),
					pos: "G",
					ovr: 46 + (season % 7) - Math.floor(i / 2),
					pot: 66 + (season % 9) - Math.floor(i / 2),
					college: i % 2 ? "State" : undefined,
				}))
			: [],
		injuries: gp
			? Array.from({ length: 7 }, (_, i) => ({
					pid: 10 + i * 5 + (season % 5),
					name: players[10 + i * 5 + (season % 5)]!.name,
					tid: (i * 2 + season) % NUM_TEAMS,
					type: ["Sprained Ankle", "Torn ACL", "Bruised Knee"][
						(i + season) % 3
					]!,
					gamesRemaining: 3 + i * 4 + (season % 6),
				}))
			: [],
		recordWins: {
			won: 70,
			tid: 2,
			season: 2012,
			region: "Cedar",
			name: "Rangers",
		},
		firstSeason,
		playIn: true,
		numPlayoffTeams: 8,
		byConf: true,
		salaryCap: 90000,
		luxuryPayroll: 120000,
		minPayroll: 60000,
		champions,
		mvps: Array.from({ length: Math.min(8, season - firstSeason) }, (_, i) => ({
			season: season - 1 - i,
			pid: (i * 13) % 100,
			name: players[(i * 13) % 100]!.name,
			tid: i % NUM_TEAMS,
			age: 22 + ((i + season) % 9),
		})),
		h2h,
		prevPairs: [
			[0, 7],
			[1, 6],
			[2, 3],
		],
		draftRetro: {
			year: season - 5,
			picks: Array.from({ length: 14 }, (_, i) => ({
				pid: 3000 + i,
				name: `${FIRST[(i * 2 + season) % FIRST.length]} ${LAST[(i + season * 3) % LAST.length]}`,
				pick: i + 1,
				round: 1,
				draftTid: i % NUM_TEAMS,
				tid: i % 3 === 0 ? -1 : i % NUM_TEAMS,
				retired: i % 3 === 0,
				ovr: 60 - i,
				pts: 8000 - i * 400,
				ws: 60 - i * 3,
				seasons: 5,
				allStar: i < 3 ? 2 : 0,
			})),
		},
		then: {
			year: season - 10,
			list: Array.from({ length: 6 }, (_, i) => ({
				pid: 4000 + i,
				name: `${FIRST[(i * 4 + season) % FIRST.length]} ${LAST[(i * 3 + season * 2) % LAST.length]}`,
				ws: 14 - i,
				pts: 24 - i * 2,
				tid: i % NUM_TEAMS,
				nowTid: i < 2 ? i : -1,
				retired: i >= 2,
				age: 32 + i,
				ovr: 55,
				nowPpg: i < 2 ? 14 : undefined,
			})),
		},
		careerBoard: Array.from({ length: 12 }, (_, i) => ({
			pid: i * 7,
			name: players[i * 7]?.name ?? `Legend ${i}`,
			tid: i % 2 === 0 ? i % NUM_TEAMS : -1,
			active: i % 2 === 0,
			pts: 22000 - i * 1200 + (season - 2005) * (330 - i * 11),
			trb: 5000,
			ast: 3000,
			ws: 120 - i * 5,
			seasons: 14,
		})),
		lottery: final
			? [0, 1, 2, 3, 4].map((i) => ({
					tid: M(11 - i),
					originalTid: M(11 - i),
					slot: i + 1,
					pick: [
						[1, 2, 3, 4, 5],
						[3, 1, 2, 4, 5],
						[1, 4, 2, 3, 5],
						[2, 3, 5, 1, 4],
					][season % 4]![i]!,
					chances: [140, 140, 140, 125, 105][i]!,
				}))
			: undefined,
		releases: Array.from({ length: 2 + (season % 4) }, (_, i) => ({
			pid: 90 + i,
			name: players[90 + i]!.name,
			tid: (i + season) % NUM_TEAMS,
		})),
		wire: {
			trades: 4 + (season % 6),
			freeAgents: 18 + (season % 9),
			reSigned: 7 + (season % 5),
			releases: 10 + (season % 7),
		},
	};
};
