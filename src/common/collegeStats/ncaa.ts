import { COLLEGES } from "./colleges.ts";
import { getSchool } from "./colleges.helpers.ts";
import { Rng, clamp } from "./rng.ts";

/**
 * A light college season around a draft class: every NCAA school in COLLEGES gets a team strength (its program strength plus the draft prospects on its roster), plays a regular season (conference double round robin or single round robin plus extra games, and non-conference games) decided game by game from the two strengths, then conference tournaments (the winner gets the automatic bid), an AP Top 25, Selection Sunday (32 automatic bids + 36 at-large, First Four, four regions seeded 1-16 on an S-curve) and the NCAA tournament.
 *
 * Pure and deterministic: the same seed, season and contributions always give the same season. Nothing is a full game simulation, only scores.
 */

export const NCAA_REGIONS = ["East", "West", "South", "Midwest"] as const;

// Conferences that only send their top 4 teams to the conference tournament
const TOP4_TOURNEY = new Set(["Ivy"]);

// A prospect on a school's roster
export type NcaaContribution = {
	key: string;
	school: string;
	// Points per game he adds to his team
	boost: number;
};

export type NcaaTeam = {
	school: string;
	conf: string;
	// True strength: points per game better than an average Division I team
	rating: number;
	w: number;
	l: number;
	confW: number;
	confL: number;
	// Simple rating system (margin of victory adjusted for schedule), after all games
	srs: number;
	// Place in the conference standings, 1 = regular season champion
	confRank: number;
	// Conference tournament result, like "Champion" or "Quarterfinals"
	confTourney: string;
	apRank?: number;
	ncaaSeed?: number;
	// Index in NCAA_REGIONS
	region?: number;
	// NCAA tournament result, like "Elite Eight"
	ncaa?: string;
	bid?: "auto" | "at-large";
};

// a and b are team indexes. b is -1 for a bye (a advances)
export type NcaaGame = {
	a: number;
	b: number;
	seedA: number;
	seedB: number;
	scoreA: number;
	scoreB: number;
	ot: number;
};

export type NcaaConference = {
	name: string;
	// Team indexes, regular season standings order
	standings: number[];
	// Rounds of the conference tournament, first round first
	tourney: NcaaGame[][];
	champion: number;
};

export type NcaaFirstFourGame = NcaaGame & {
	region: number;
	seed: number;
};

export type NcaaTournament = {
	firstFour: NcaaFirstFourGame[];
	// Per region, rounds: Round of 64 (8 games), Round of 32, Sweet 16, Elite Eight
	regions: NcaaGame[][][];
	// Semifinals: East vs Midwest, West vs South
	finalFour: NcaaGame[];
	final: NcaaGame;
	champion: number;
};

export type NcaaApEntry = {
	team: number;
	pts: number;
	firstPlace: number;
	// Record at the time of the poll (before the NCAA tournament)
	w: number;
	l: number;
};

export type NcaaSeason = {
	season: number;
	teams: NcaaTeam[];
	conferences: NcaaConference[];
	ap: NcaaApEntry[];
	tournament: NcaaTournament;
};

export const NCAA_ROUND_NAMES = [
	"First Four",
	"Round of 64",
	"Round of 32",
	"Sweet 16",
	"Elite Eight",
	"Final Four",
	"Championship",
] as const;

// What a team that lost in each NCAA round reached
const NCAA_RESULTS = [
	"First Four",
	"Round of 64",
	"Round of 32",
	"Sweet 16",
	"Elite Eight",
	"Final Four",
	"Runner-up",
];

// How far into the NCAA tournament a result is, for sorting (0 = did not make it)
export const ncaaResultDepth = (result: string | undefined) => {
	if (result === undefined) {
		return 0;
	}
	if (result === "Champion") {
		return 9;
	}
	return NCAA_RESULTS.indexOf(result) + 2;
};

export const winner = (game: NcaaGame) =>
	game.b < 0 ? game.a : game.scoreA > game.scoreB ? game.a : game.b;

export const loser = (game: NcaaGame) =>
	game.b < 0 ? -1 : game.scoreA > game.scoreB ? game.b : game.a;

// Bracket positions of seeds 1..size (a power of 2), so the top seeds meet as late as possible: [1, 4, 2, 3] for 4
export const seedOrder = (size: number) => {
	if (size === 16) {
		// The NCAA's own order, same pairings as the generic one
		return [1, 16, 8, 9, 5, 12, 4, 13, 6, 11, 3, 14, 7, 10, 2, 15];
	}
	let order = [1];
	while (order.length < size) {
		const m = order.length * 2;
		order = order.flatMap((s) => [s, m + 1 - s]);
	}
	return order;
};

// Name of a conference tournament round, counting from the final
export const confRoundName = (round: number, numRounds: number) => {
	const fromEnd = numRounds - 1 - round;
	if (fromEnd === 0) {
		return "Final";
	}
	if (fromEnd === 1) {
		return "Semifinals";
	}
	if (fromEnd === 2) {
		return "Quarterfinals";
	}
	return ["First Round", "Second Round", "Third Round"][round] ?? "First Round";
};

const confResultName = (round: number, numRounds: number) => {
	const fromEnd = numRounds - 1 - round;
	if (fromEnd === 0) {
		return "Runner-up";
	}
	return confRoundName(round, numRounds);
};

// Points of margin a prospect adds to his team, from his talent relative to the class (z around 0)
export const getProspectBoost = (z: number) => clamp(2.2 + 2 * z, 0.5, 7);

// Diminishing returns: a team's best prospect counts fully, the next ones less
const sumBoosts = (boosts: number[]) => {
	const sorted = [...boosts].sort((a, b) => b - a);
	let sum = 0;
	for (const [i, boost] of sorted.entries()) {
		sum += boost * Math.max(0.3, 1 - 0.25 * i);
	}
	return sum;
};

const playGame = (rng: Rng, ratingA: number, ratingB: number, home: number) => {
	const margin = ratingA - ratingB + home;
	let d = Math.round(rng.normal(margin, 11.5));
	let ot = 0;
	while (d === 0) {
		ot += 1;
		d = Math.round(rng.normal(margin * 0.12, 4.5));
	}
	const total = Math.round(rng.normal(141 + 9 * ot, 13));
	let hi = Math.round((total + Math.abs(d)) / 2);
	let lo = hi - Math.abs(d);
	if (lo < 38) {
		lo = 38;
		hi = lo + Math.abs(d);
	}
	return d > 0
		? { scoreA: hi, scoreB: lo, ot }
		: { scoreA: lo, scoreB: hi, ot };
};

// Circle method: rounds of [i, j] pairs for n teams (a team sits out a round when n is odd)
const roundRobin = (n: number) => {
	const ids = Array.from({ length: n % 2 === 0 ? n : n + 1 }, (_, i) =>
		i < n ? i : -1,
	);
	const m = ids.length;
	const rounds: [number, number][][] = [];
	for (let r = 0; r < m - 1; r++) {
		const round: [number, number][] = [];
		for (let i = 0; i < m / 2; i++) {
			const x = ids[i]!;
			const y = ids[m - 1 - i]!;
			if (x >= 0 && y >= 0) {
				round.push(r % 2 === 0 ? [x, y] : [y, x]);
			}
		}
		rounds.push(round);
		// Rotate everything but the first
		ids.splice(1, 0, ids.pop()!);
	}
	return rounds;
};

const NON_CONF_GAMES = 12;

/**
 * The season. contributions are the prospects on each school's roster, in any order; schools not in COLLEGES are ignored.
 */
export const simulateNcaaSeason = ({
	seed,
	season,
	contributions,
}: {
	seed: string;
	season: number;
	contributions: NcaaContribution[];
}): NcaaSeason => {
	const rng = new Rng(`${seed}|${season}|ncaa`);

	const boostsBySchool = new Map<string, number[]>();
	for (const c of [...contributions].sort((a, b) =>
		a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
	)) {
		const list = boostsBySchool.get(c.school) ?? [];
		list.push(c.boost);
		boostsBySchool.set(c.school, list);
	}

	const teams: NcaaTeam[] = Object.keys(COLLEGES).map((school) => {
		const info = getSchool(school)!;
		return {
			school,
			conf: info.conference!,
			rating:
				(info.strength - 72) * 0.45 +
				rng.normal(0, 5.5) +
				sumBoosts(boostsBySchool.get(school) ?? []),
			w: 0,
			l: 0,
			confW: 0,
			confL: 0,
			srs: 0,
			confRank: 0,
			confTourney: "",
		};
	});
	const n = teams.length;
	const margins: number[] = Array.from({ length: n }, () => 0);
	const opps: number[][] = Array.from({ length: n }, () => []);

	const record = (
		a: number,
		b: number,
		home: number,
		conf: boolean,
	): NcaaGame => {
		const result = playGame(rng, teams[a]!.rating, teams[b]!.rating, home);
		const d = clamp(result.scoreA - result.scoreB, -20, 20);
		margins[a]! += d;
		margins[b]! -= d;
		opps[a]!.push(b);
		opps[b]!.push(a);
		const [win, lose] = result.scoreA > result.scoreB ? [a, b] : [b, a];
		teams[win]!.w += 1;
		teams[lose]!.l += 1;
		if (conf) {
			teams[win]!.confW += 1;
			teams[lose]!.confL += 1;
		}
		return { a, b, seedA: 0, seedB: 0, ...result };
	};

	// Non-conference: random pairings
	const all = Array.from({ length: n }, (_, i) => i);
	for (let r = 0; r < NON_CONF_GAMES; r++) {
		for (let i = all.length - 1; i > 0; i--) {
			const j = Math.floor(rng.random() * (i + 1));
			[all[i], all[j]] = [all[j]!, all[i]!];
		}
		for (let i = 0; i + 1 < all.length; i += 2) {
			const home = rng.random() < 0.5 ? 3.5 : -3.5;
			record(all[i]!, all[i + 1]!, home, false);
		}
	}

	// Conference schedules
	const confNames: string[] = [];
	const membersByConf = new Map<string, number[]>();
	for (const [i, t] of teams.entries()) {
		if (!membersByConf.has(t.conf)) {
			confNames.push(t.conf);
			membersByConf.set(t.conf, []);
		}
		membersByConf.get(t.conf)!.push(i);
	}
	for (const conf of confNames) {
		const members = membersByConf.get(conf)!;
		const rounds = roundRobin(members.length);
		const double = 2 * (members.length - 1) <= 22;
		const extra = double ? rounds.length : Math.max(0, 20 - rounds.length);
		const schedule = [
			...rounds.map((round) => ({ round, swap: false })),
			...rounds.slice(0, extra).map((round) => ({ round, swap: true })),
		];
		for (const { round, swap } of schedule) {
			for (const [x, y] of round) {
				const [h, a] = swap ? [y, x] : [x, y];
				record(members[h]!, members[a]!, 3.5, true);
			}
		}
	}

	const computeSrs = () => {
		let srs = margins.map((m, i) => m / Math.max(1, opps[i]!.length));
		const mov = [...srs];
		for (let iter = 0; iter < 40; iter++) {
			const next = mov.map((m, i) => {
				const list = opps[i]!;
				let sum = 0;
				for (const o of list) {
					sum += srs[o]!;
				}
				return m + (list.length > 0 ? sum / list.length : 0);
			});
			const mean = next.reduce((a, b) => a + b, 0) / n;
			srs = next.map((x) => x - mean);
		}
		for (const [i, t] of teams.entries()) {
			t.srs = Math.round(srs[i]! * 100) / 100;
		}
	};
	computeSrs();

	// Standings
	const pct = (t: NcaaTeam) =>
		t.confW + t.confL > 0 ? t.confW / (t.confW + t.confL) : 0;
	const conferences: NcaaConference[] = confNames.map((name) => {
		const standings = [...membersByConf.get(name)!].sort((x, y) => {
			const tx = teams[x]!;
			const ty = teams[y]!;
			return pct(ty) - pct(tx) || ty.confW - tx.confW || ty.srs - tx.srs;
		});
		for (const [i, t] of standings.entries()) {
			teams[t]!.confRank = i + 1;
		}
		return { name, standings, tourney: [], champion: -1 };
	});

	// Single elimination on a neutral court. entrants are in seed order. Returns the rounds and sets result labels with setResult(team, round index of the loss, number of rounds) and the champion
	const playBracket = (
		entrants: number[],
		setResult: (team: number, round: number, numRounds: number) => void,
	) => {
		let size = 1;
		while (size < entrants.length) {
			size *= 2;
		}
		const numRounds = Math.log2(size);
		const order = seedOrder(size);
		let current = order.map((s) => ({
			team: s <= entrants.length ? entrants[s - 1]! : -1,
			seed: s,
		}));
		const rounds: NcaaGame[][] = [];
		for (let r = 0; r < numRounds; r++) {
			const games: NcaaGame[] = [];
			const next: typeof current = [];
			for (let i = 0; i < current.length; i += 2) {
				let x = current[i]!;
				let y = current[i + 1]!;
				if (x.team < 0) {
					[x, y] = [y, x];
				}
				let game: NcaaGame;
				if (y.team < 0) {
					game = {
						a: x.team,
						b: -1,
						seedA: x.seed,
						seedB: 0,
						scoreA: 0,
						scoreB: 0,
						ot: 0,
					};
				} else {
					game = {
						...record(x.team, y.team, 0, false),
						seedA: x.seed,
						seedB: y.seed,
					};
					setResult(loser(game), r, numRounds);
				}
				games.push(game);
				const w = winner(game);
				next.push(w === x.team ? x : y);
			}
			rounds.push(games);
			current = next;
		}
		return { rounds, champion: current[0]!.team };
	};

	for (const conf of conferences) {
		const entrants = TOP4_TOURNEY.has(conf.name)
			? conf.standings.slice(0, 4)
			: conf.standings;
		for (const t of conf.standings) {
			teams[t]!.confTourney = "Did not qualify";
		}
		const { rounds, champion } = playBracket(entrants, (t, r, numRounds) => {
			teams[t]!.confTourney = confResultName(r, numRounds);
		});
		conf.tourney = rounds;
		conf.champion = champion;
		teams[champion]!.confTourney = "Champion";
		teams[champion]!.bid = "auto";
	}
	computeSrs();

	// AP Top 25 (final poll, before the NCAA tournament): each voter ranks the teams he sees as best, a little differently
	const apScore = (t: NcaaTeam) => t.srs + 0.4 * (t.w - t.l);
	const contenders = Array.from({ length: n }, (_, i) => i)
		.sort((x, y) => apScore(teams[y]!) - apScore(teams[x]!))
		.slice(0, 40);
	const apPts = new Map<number, { pts: number; firstPlace: number }>();
	for (const t of contenders) {
		apPts.set(t, { pts: 0, firstPlace: 0 });
	}
	const NUM_VOTERS = 62;
	for (let v = 0; v < NUM_VOTERS; v++) {
		const ballot = contenders
			.map((t) => ({ t, score: apScore(teams[t]!) + rng.normal(0, 1.8) }))
			.sort((x, y) => y.score - x.score)
			.slice(0, 25);
		for (const [i, { t }] of ballot.entries()) {
			const entry = apPts.get(t)!;
			entry.pts += 25 - i;
			if (i === 0) {
				entry.firstPlace += 1;
			}
		}
	}
	const ap: NcaaApEntry[] = contenders
		.filter((t) => apPts.get(t)!.pts > 0)
		.sort(
			(x, y) =>
				apPts.get(y)!.pts - apPts.get(x)!.pts ||
				apScore(teams[y]!) - apScore(teams[x]!),
		)
		.slice(0, 25)
		.map((t) => ({
			team: t,
			...apPts.get(t)!,
			w: teams[t]!.w,
			l: teams[t]!.l,
		}));
	for (const [i, entry] of ap.entries()) {
		teams[entry.team]!.apRank = i + 1;
	}

	// Selection Sunday
	const selScore = (t: number) =>
		teams[t]!.srs + 0.25 * (teams[t]!.w - teams[t]!.l);
	const bySel = (x: number, y: number) => selScore(y) - selScore(x) || x - y;
	const autoBids = conferences.map((c) => c.champion).sort(bySel);
	const atLarge = Array.from({ length: n }, (_, i) => i)
		.filter((t) => teams[t]!.bid !== "auto")
		.sort(bySel)
		.slice(0, 68 - autoBids.length);
	for (const t of atLarge) {
		teams[t]!.bid = "at-large";
	}
	const lastFourIn = atLarge.slice(-4);
	const lowestAuto = autoBids.slice(-4);
	const direct = [...autoBids, ...atLarge]
		.filter((t) => !lastFourIn.includes(t) && !lowestAuto.includes(t))
		.sort(bySel);

	type Slot = { team: number } | { ff: number };
	const slots: Slot[][] = NCAA_REGIONS.map(() => []);
	const firstFour: NcaaFirstFourGame[] = [];
	const ffPairs = [
		{ teams: lastFourIn.slice(0, 2), seed: 11 },
		{ teams: lastFourIn.slice(2, 4), seed: 11 },
		{ teams: lowestAuto.slice(0, 2), seed: 16 },
		{ teams: lowestAuto.slice(2, 4), seed: 16 },
	];
	let k = 0;
	let ffAtLarge = 0;
	let ffAuto = 2;
	for (let line = 1; line <= 16; line++) {
		const order = line % 2 === 1 ? [0, 1, 2, 3] : [3, 2, 1, 0];
		for (const [j, region] of order.entries()) {
			let slot: Slot;
			if (line === 11 && j >= 2) {
				slot = { ff: ffAtLarge++ };
			} else if (line === 16 && j >= 2) {
				slot = { ff: ffAuto++ };
			} else {
				slot = { team: direct[k++]! };
			}
			slots[region]![line] = slot;
			if ("ff" in slot) {
				const [x, y] = ffPairs[slot.ff]!.teams as [number, number];
				firstFour[slot.ff] = {
					a: x,
					b: y,
					seedA: line,
					seedB: line,
					scoreA: 0,
					scoreB: 0,
					ot: 0,
					region,
					seed: line,
				};
			}
		}
	}
	for (const [region, regionSlots] of slots.entries()) {
		for (let line = 1; line <= 16; line++) {
			const slot = regionSlots[line]!;
			const list = "team" in slot ? [slot.team] : ffPairs[slot.ff]!.teams;
			for (const t of list) {
				teams[t]!.ncaaSeed = line;
				teams[t]!.region = region;
			}
		}
	}

	const setNcaa = (t: number, round: number) => {
		teams[t]!.ncaa = NCAA_RESULTS[round];
	};
	for (const [i, game] of firstFour.entries()) {
		const result = record(game.a, game.b, 0, false);
		firstFour[i] = {
			...game,
			scoreA: result.scoreA,
			scoreB: result.scoreB,
			ot: result.ot,
		};
		setNcaa(loser(firstFour[i]!), 0);
	}

	const playNcaaGame = (
		x: { team: number; seed: number },
		y: { team: number; seed: number },
		round: number,
	) => {
		const game = {
			...record(x.team, y.team, 0, false),
			seedA: x.seed,
			seedB: y.seed,
		};
		setNcaa(loser(game), round);
		return game;
	};

	const regions: NcaaGame[][][] = [];
	const regionWinners: { team: number; seed: number }[] = [];
	for (const regionSlots of slots) {
		let current = seedOrder(16).map((seed) => {
			const slot = regionSlots[seed]!;
			return {
				team: "team" in slot ? slot.team : winner(firstFour[slot.ff]!),
				seed,
			};
		});
		const rounds: NcaaGame[][] = [];
		for (let r = 0; r < 4; r++) {
			const games: NcaaGame[] = [];
			const next: typeof current = [];
			for (let i = 0; i < current.length; i += 2) {
				const x = current[i]!;
				const y = current[i + 1]!;
				const game = playNcaaGame(x, y, r + 1);
				games.push(game);
				next.push(winner(game) === x.team ? x : y);
			}
			rounds.push(games);
			current = next;
		}
		regions.push(rounds);
		regionWinners.push(current[0]!);
	}
	const semis = [
		playNcaaGame(regionWinners[0]!, regionWinners[3]!, 5),
		playNcaaGame(regionWinners[1]!, regionWinners[2]!, 5),
	];
	const finalists = semis.map((game, i) => {
		const pair = i === 0 ? [0, 3] : [1, 2];
		return regionWinners[pair[0]!]!.team === winner(game)
			? regionWinners[pair[0]!]!
			: regionWinners[pair[1]!]!;
	});
	const final = playNcaaGame(finalists[0]!, finalists[1]!, 6);
	const champion = winner(final);
	teams[champion]!.ncaa = "Champion";

	return {
		season,
		teams,
		conferences,
		ap,
		tournament: { firstFour, regions, finalFour: semis, final, champion },
	};
};

export type TeamPostseasonGame = {
	event: "conf" | "ncaa";
	round: string;
	game: NcaaGame;
};

// A team's postseason games, in the order they were played: conference tournament, then NCAA tournament
export const getTeamPostseason = (
	season: NcaaSeason,
	team: number,
): TeamPostseasonGame[] => {
	const output: TeamPostseasonGame[] = [];
	const has = (game: NcaaGame) =>
		game.b >= 0 && (game.a === team || game.b === team);
	const t = season.teams[team]!;
	const conf = season.conferences.find((c) => c.name === t.conf);
	if (conf) {
		for (const [r, games] of conf.tourney.entries()) {
			for (const game of games) {
				if (has(game)) {
					output.push({
						event: "conf",
						round: confRoundName(r, conf.tourney.length),
						game,
					});
				}
			}
		}
	}
	const { tournament } = season;
	for (const game of tournament.firstFour) {
		if (has(game)) {
			output.push({ event: "ncaa", round: NCAA_ROUND_NAMES[0], game });
		}
	}
	for (let r = 0; r < 4; r++) {
		for (const rounds of tournament.regions) {
			for (const game of rounds[r]!) {
				if (has(game)) {
					output.push({ event: "ncaa", round: NCAA_ROUND_NAMES[r + 1]!, game });
				}
			}
		}
	}
	for (const game of tournament.finalFour) {
		if (has(game)) {
			output.push({ event: "ncaa", round: NCAA_ROUND_NAMES[5], game });
		}
	}
	if (has(tournament.final)) {
		output.push({
			event: "ncaa",
			round: NCAA_ROUND_NAMES[6],
			game: tournament.final,
		});
	}
	return output;
};

// One of a prospect's postseason games, his line and the result
export type ProspectNcaaGame = {
	event: "conf" | "ncaa";
	round: string;
	opp: string;
	seed?: number;
	oppSeed?: number;
	tm: number;
	oppScore: number;
	ot: number;
	won: boolean;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tov: number;
	fg: number;
	fga: number;
	tp: number;
	tpa: number;
	ft: number;
	fta: number;
	gmsc: number;
};

// A prospect's team's season, stored on the prospect (p.collegeSeason.summary) for his player page
export type ProspectNcaaSummary = {
	season: number;
	school: string;
	conf: string;
	w: number;
	l: number;
	confW: number;
	confL: number;
	confRank: number;
	confSize: number;
	apRank?: number;
	confTourney: string;
	ncaaSeed?: number;
	region?: string;
	ncaa?: string;
	// Postseason games he played. Empty for a prospect whose stats were not generated with the season (imported ones)
	games: ProspectNcaaGame[];
};

// What is stored on a prospect: enough to rebuild the whole season (seed + every prospect's school and boost) and his own summary
export type StoredCollegeSeason = {
	season: number;
	seed: string;
	school: string;
	boost: number;
	summary: ProspectNcaaSummary;
};

export const getTeamIndex = (season: NcaaSeason, school: string) =>
	season.teams.findIndex((t) => t.school === school);

export const getTeamSummary = (
	season: NcaaSeason,
	team: number,
	games: ProspectNcaaGame[] = [],
): ProspectNcaaSummary => {
	const t = season.teams[team]!;
	const conf = season.conferences.find((c) => c.name === t.conf);
	return {
		season: season.season,
		school: t.school,
		conf: t.conf,
		w: t.w,
		l: t.l,
		confW: t.confW,
		confL: t.confL,
		confRank: t.confRank,
		confSize: conf?.standings.length ?? 0,
		apRank: t.apRank,
		confTourney: t.confTourney,
		ncaaSeed: t.ncaaSeed,
		region: t.region !== undefined ? NCAA_REGIONS[t.region] : undefined,
		ncaa: t.ncaa,
		games,
	};
};

// "Elite Eight (seed 3)", or undefined if he was not in the tournament
export const ncaaResultText = (summary: {
	ncaa?: string;
	ncaaSeed?: number;
}) =>
	summary.ncaa !== undefined
		? `${summary.ncaa === "Champion" ? "National Champion" : summary.ncaa} (seed ${summary.ncaaSeed})`
		: undefined;

/**
 * Tournament honors for prospects, from their postseason game lines: conference tournament MVP and all-tournament team, NCAA Final Four Most Outstanding Player and All-Final Four team, regional Most Outstanding Players, plus the team honors (conference regular season and tournament champions, national champion). A tournament whose best player was not a draft prospect gives a prospect no MVP. Types are without the "College: " prefix.
 */
export const getTourneyHonors = (
	season: NcaaSeason,
	entries: { key: string; school: string; games: ProspectNcaaGame[] }[],
) => {
	const output = new Map<string, string[]>();
	const give = (key: string, type: string) => {
		const list = output.get(key) ?? [];
		if (!list.includes(type)) {
			list.push(type);
		}
		output.set(key, list);
	};
	const teamOf = new Map<string, NcaaTeam>();
	for (const e of entries) {
		const t = season.teams[getTeamIndex(season, e.school)];
		if (t) {
			teamOf.set(e.key, t);
		}
	}
	const sumGmsc = (games: ProspectNcaaGame[]) =>
		games.reduce((sum, game) => sum + game.gmsc, 0);

	// Team honors
	for (const e of entries) {
		const t = teamOf.get(e.key);
		if (!t || e.games.length === 0) {
			continue;
		}
		if (t.confRank === 1) {
			give(e.key, `${t.conf} Regular Season Champion`);
		}
		if (t.confTourney === "Champion") {
			give(e.key, `${t.conf} Tournament Champion`);
		}
		if (t.ncaa === "Champion") {
			give(e.key, "NCAA Champion");
		}
	}

	// Conference tournaments
	for (const conf of season.conferences) {
		const candidates = entries
			.filter((e) => teamOf.get(e.key)?.conf === conf.name)
			.map((e) => {
				const games = e.games.filter((game) => game.event === "conf");
				return {
					e,
					t: teamOf.get(e.key)!,
					sum: sumGmsc(games),
					avg: games.length > 0 ? sumGmsc(games) / games.length : 0,
					n: games.length,
				};
			})
			.filter((c) => c.n > 0);
		const champs = candidates
			.filter((c) => c.t.confTourney === "Champion")
			.sort((x, y) => y.sum - x.sum);
		const mvp = champs[0];
		if (mvp && mvp.avg >= 9) {
			give(mvp.e.key, `${conf.name} Tournament MVP`);
		}
		const allTourney = candidates
			.filter((c) =>
				c === mvp && mvp.avg >= 9
					? true
					: ["Champion", "Runner-up", "Semifinals"].includes(c.t.confTourney) &&
						c.avg >= 12,
			)
			.sort((x, y) => y.avg - x.avg)
			.slice(0, 5);
		for (const c of allTourney) {
			give(c.e.key, `All-${conf.name} Tournament Team`);
		}
	}

	// NCAA: Final Four
	const f4 = entries
		.map((e) => {
			const games = e.games.filter(
				(game) =>
					game.event === "ncaa" &&
					(game.round === "Final Four" || game.round === "Championship"),
			);
			return {
				e,
				t: teamOf.get(e.key),
				sum: sumGmsc(games),
				avg: games.length > 0 ? sumGmsc(games) / games.length : 0,
				n: games.length,
			};
		})
		.filter((c) => c.n > 0);
	const champs = f4
		.filter((c) => c.t?.ncaa === "Champion")
		.sort((x, y) => y.sum - x.sum);
	let mop = champs[0] && champs[0].avg >= 9 ? champs[0] : undefined;
	if (!mop) {
		// Rarely, a great player on the losing side
		const best = [...f4].sort((x, y) => y.avg - x.avg)[0];
		if (best && best.avg >= 18) {
			mop = best;
		}
	}
	if (mop) {
		give(mop.e.key, "NCAA Final Four Most Outstanding Player");
	}
	for (const c of f4
		.filter((c) => c === mop || c.avg >= 11)
		.sort((x, y) => y.avg - x.avg)
		.slice(0, 5)) {
		give(c.e.key, "NCAA All-Final Four Team");
	}

	// NCAA: regional Most Outstanding Player, from the Sweet 16 and Elite Eight, on the region's champion
	for (const [region, name] of NCAA_REGIONS.entries()) {
		const regionChamp = winner(season.tournament.regions[region]![3]![0]!);
		const best = entries
			.filter((e) => teamOf.get(e.key) === season.teams[regionChamp])
			.map((e) => ({
				e,
				sum: sumGmsc(
					e.games.filter(
						(game) =>
							game.event === "ncaa" &&
							(game.round === "Sweet 16" || game.round === "Elite Eight"),
					),
				),
			}))
			.sort((x, y) => y.sum - x.sum)[0];
		if (best && best.sum >= 18) {
			give(best.e.key, `NCAA ${name} Regional Most Outstanding Player`);
		}
	}

	return output;
};
