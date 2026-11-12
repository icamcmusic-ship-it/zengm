// College mode: the regular season schedule. Non-conference games first, then conference play. See docs/college-mode.md.
import { shuffle } from "../../../common/random.ts";

type ScheduleTeam = { tid: number; cid: number };

// Circle method: rounds of [i, j] index pairs for n teams (one team sits out each round when n is odd)
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
		ids.splice(1, 0, ids.pop()!);
	}
	return rounds;
};

// Conference games per team a conference of n teams aims for
export const getNumConfGames = (n: number, numGames: number) => {
	if (n < 2) {
		return 0;
	}
	const double = 2 * (n - 1);
	const max = Math.max(2, Math.round(numGames * (2 / 3)));
	if (double <= max) {
		return double;
	}
	// Single round robin plus some rematches
	return Math.max(n - 1, Math.min(max, n >= 14 ? max : max - 2));
};

// Rounds (each a list of [home, away] tids where every team plays at most once) of one conference
const conferenceRounds = (tids: number[], numGames: number) => {
	const n = tids.length;
	const target = getNumConfGames(n, numGames);
	if (target === 0) {
		return [];
	}
	const order = [...tids];
	shuffle(order);
	const first = roundRobin(n).map((round) =>
		round.map(([a, b]) => [order[a]!, order[b]!] as [number, number]),
	);
	// Second pass with home and away swapped
	const second = first.map((round) =>
		round.map(([a, b]) => [b, a] as [number, number]),
	);
	shuffle(second);

	const rounds = [...first];
	const played = n - 1;
	if (target >= 2 * (n - 1)) {
		rounds.push(...second);
	} else {
		// Enough rounds of the second pass to get every team to the target (a team that sits out one of them ends up a game short)
		const extra = target - played;
		rounds.push(...second.slice(0, n % 2 === 0 ? extra : extra + 1));
	}
	shuffle(rounds);
	return rounds;
};

/**
 * [home, away] pairs of a whole regular season, in the order they are played. Every team plays numGames games (some one fewer when
 * the numbers do not work out).
 */
export const newCollegeSchedule = (teams: ScheduleTeam[], numGames: number) => {
	const byCid = Map.groupBy(teams, (t) => t.cid);
	const cidByTid = new Map(teams.map((t) => [t.tid, t.cid]));

	const confRoundsByCid: [number, number][][][] = [];
	const confGames = new Map<number, number>(teams.map((t) => [t.tid, 0]));
	for (const group of byCid.values()) {
		const rounds = conferenceRounds(
			group.map((t) => t.tid),
			numGames,
		);
		confRoundsByCid.push(rounds);
		for (const round of rounds) {
			for (const [a, b] of round) {
				confGames.set(a, confGames.get(a)! + 1);
				confGames.set(b, confGames.get(b)! + 1);
			}
		}
	}

	// Non-conference games: rounds of random pairings between teams that still need games
	const need = new Map<number, number>(
		teams.map((t) => [t.tid, Math.max(0, numGames - confGames.get(t.tid)!)]),
	);
	const homeCount = new Map<number, number>(teams.map((t) => [t.tid, 0]));
	const playedPairs = new Set<string>();
	const pairKey = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
	const nonConfRounds: [number, number][][] = [];
	const multiConf = byCid.size > 1;

	for (let guard = 0; guard < numGames * 3; guard++) {
		const pool = teams.map((t) => t.tid).filter((tid) => need.get(tid)! > 0);
		if (pool.length < 2) {
			break;
		}
		shuffle(pool);
		// Teams that need the most games go first, so nobody is left with a pile at the end
		pool.sort((a, b) => need.get(b)! - need.get(a)!);
		const used = new Set<number>();
		const round: [number, number][] = [];
		for (const a of pool) {
			if (used.has(a)) {
				continue;
			}
			let partner: number | undefined;
			// First choice: another conference and not played yet. Then anyone not played yet, then anyone from another conference
			for (const pass of [0, 1, 2]) {
				for (const b of pool) {
					if (b === a || used.has(b)) {
						continue;
					}
					const otherConf = cidByTid.get(a) !== cidByTid.get(b);
					const fresh = !playedPairs.has(pairKey(a, b));
					if (
						(pass === 0 && (otherConf || !multiConf) && fresh) ||
						(pass === 1 && fresh) ||
						(pass === 2 && (otherConf || !multiConf))
					) {
						partner = b;
						break;
					}
				}
				if (partner !== undefined) {
					break;
				}
			}
			if (partner === undefined) {
				continue;
			}
			used.add(a);
			used.add(partner);
			playedPairs.add(pairKey(a, partner));
			const aHome =
				homeCount.get(a)! < homeCount.get(partner)! ||
				(homeCount.get(a) === homeCount.get(partner) && Math.random() < 0.5);
			const [home, away] = aHome ? [a, partner] : [partner, a];
			homeCount.set(home, homeCount.get(home)! + 1);
			need.set(a, need.get(a)! - 1);
			need.set(partner, need.get(partner)! - 1);
			round.push([home, away]);
		}
		if (round.length === 0) {
			break;
		}
		nonConfRounds.push(round);
	}

	// Conference play: round r of every conference on the same day
	const confRounds: [number, number][][] = [];
	const maxRounds = Math.max(
		0,
		...confRoundsByCid.map((rounds) => rounds.length),
	);
	for (let r = 0; r < maxRounds; r++) {
		const round: [number, number][] = [];
		for (const rounds of confRoundsByCid) {
			// Spread a conference with fewer rounds over the whole of conference play
			const index = Math.floor((r * rounds.length) / maxRounds);
			const prevIndex =
				r === 0 ? -1 : Math.floor(((r - 1) * rounds.length) / maxRounds);
			if (index !== prevIndex && rounds[index]) {
				round.push(...rounds[index]);
			}
		}
		if (round.length > 0) {
			confRounds.push(round);
		}
	}

	return {
		rounds: [...nonConfRounds, ...confRounds],
		numNonConfRounds: nonConfRounds.length,
	};
};
