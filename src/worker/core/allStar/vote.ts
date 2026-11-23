// The All-Star vote (the allStarVote setting, basketball). Three electorates rank the candidates:
//  - fans (50% of the starter vote): scoring, fame (earlier All-Star selections), the team's buzz (hype) and market (population),
//    and a little of how well he's actually played;
//  - players and media (25% each): how well he's played (win shares and EWA, the same value BBGM picked All-Stars by), with
//    a nod to scoring (players) or the team's record (media).
// Starters: the best weighted rank at each court slot (2 backcourt, 3 frontcourt per conference with 5 on the court). Reserves
// (the coaches' picks): by players' and media's rank, with minimums at each slot and the rest wild cards. Pure and seeded.
import { orderBy } from "../../../common/utils.ts";
import type { AllStarVoteRow } from "../../../common/types.ts";

export type VoteCandidate = {
	pid: number;
	tid: number;
	name: string;
	cid: number;
	court: "backcourt" | "frontcourt";
	// Value: 2.5 * EWA + WS this season
	value: number;
	ppg: number;
	teamWinp: number;
	teamHype: number;
	teamPop: number;
	prevAllStars: number;
};

const sd = (xs: number[]) => {
	if (xs.length < 2) {
		return 1;
	}
	const m = xs.reduce((a, b) => a + b, 0) / xs.length;
	const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
	return Math.sqrt(v) || 1;
};

const zs = (xs: number[]) => {
	const m = xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
	const s = sd(xs);
	return xs.map((x) => (x - m) / s);
};

const gauss = (rand: () => number) => {
	const u = Math.max(1e-12, rand());
	const v = rand();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export const VOTE_WEIGHTS = {
	fan: {
		ppg: 0.45,
		value: 0.25,
		fame: 0.2,
		hype: 0.15,
		market: 0.1,
		noise: 0.3,
	},
	player: { value: 0.8, ppg: 0.2, noise: 0.25 },
	media: { value: 0.75, winp: 0.25, noise: 0.25 },
	// Shares of the starters' weighted rank
	share: { fan: 0.5, player: 0.25, media: 0.25 },
};

// Ranks (1 = best) of each candidate in each electorate, plus fan vote totals. The candidates are one ballot (a conference, or
// the whole league)
export const castVotes = (
	candidates: VoteCandidate[],
	rand: () => number,
): AllStarVoteRow[] => {
	const W = VOTE_WEIGHTS;
	const zValue = zs(candidates.map((c) => c.value));
	const zPpg = zs(candidates.map((c) => c.ppg));
	const zFame = zs(candidates.map((c) => Math.min(c.prevAllStars, 6)));
	const zHype = zs(candidates.map((c) => c.teamHype));
	const zMarket = zs(candidates.map((c) => Math.log(Math.max(0.1, c.teamPop))));
	const zWinp = zs(candidates.map((c) => c.teamWinp));

	const fan: number[] = [];
	const player: number[] = [];
	const media: number[] = [];
	for (let i = 0; i < candidates.length; i++) {
		fan.push(
			W.fan.ppg * zPpg[i]! +
				W.fan.value * zValue[i]! +
				W.fan.fame * zFame[i]! +
				W.fan.hype * zHype[i]! +
				W.fan.market * zMarket[i]! +
				W.fan.noise * gauss(rand),
		);
		player.push(
			W.player.value * zValue[i]! +
				W.player.ppg * zPpg[i]! +
				W.player.noise * gauss(rand),
		);
		media.push(
			W.media.value * zValue[i]! +
				W.media.winp * zWinp[i]! +
				W.media.noise * gauss(rand),
		);
	}

	const rankOf = (scores: number[]) => {
		const order = orderBy(
			scores.map((score, i) => ({ score, i, pid: candidates[i]!.pid })),
			["score", "pid"],
			["desc", "asc"],
		);
		const ranks: number[] = [];
		for (const [rank, { i }] of order.entries()) {
			ranks[i] = rank + 1;
		}
		return ranks;
	};
	const fanRanks = rankOf(fan);
	const playerRanks = rankOf(player);
	const mediaRanks = rankOf(media);

	// Fan ballots: a few million for the leaders, falling off fast
	const maxFan = Math.max(...fan);
	return candidates.map((c, i) => ({
		pid: c.pid,
		tid: c.tid,
		name: c.name,
		cid: c.cid,
		court: c.court,
		fanVotes: Math.round(4_000_000 * Math.exp(1.6 * (fan[i]! - maxFan))),
		fanRank: fanRanks[i]!,
		playerRank: playerRanks[i]!,
		mediaRank: mediaRanks[i]!,
		score:
			W.share.fan * fanRanks[i]! +
			W.share.player * playerRanks[i]! +
			W.share.media * mediaRanks[i]!,
	}));
};

// Slots for one team of numPlayers with numStarters starters: starters split 2:3 backcourt:frontcourt, reserves with minimums
// in the same 2:3 ratio of 5 of the 7 spots (the rest wild cards)
export const slotsFor = (numPlayers: number, numStarters: number) => {
	const starters = Math.min(numStarters, numPlayers);
	const startersBack = Math.round((starters * 2) / 5);
	const reserves = numPlayers - starters;
	const reservesBack = Math.round((reserves * 2) / 7);
	const reservesFront = Math.round((reserves * 3) / 7);
	return {
		startersBack,
		startersFront: starters - startersBack,
		reservesBack,
		reservesFront,
		reservesWild: reserves - reservesBack - reservesFront,
	};
};

// Picks one team from one ballot: the starters by weighted rank in their court slots, then the reserves by the players' and
// media's rank (the coaches' choice) with the slot minimums. Returns the rows in pick order with selected set
export const selectFromVotes = (
	rows: AllStarVoteRow[],
	numPlayers: number,
	numStarters: number,
) => {
	const slots = slotsFor(numPlayers, numStarters);
	const picked: AllStarVoteRow[] = [];
	const used = new Set<number>();
	const take = (
		list: AllStarVoteRow[],
		n: number,
		selected: AllStarVoteRow["selected"],
	) => {
		let count = 0;
		for (const row of list) {
			if (count >= n) {
				break;
			}
			if (!used.has(row.pid)) {
				used.add(row.pid);
				row.selected = selected;
				picked.push(row);
				count += 1;
			}
		}
	};

	const byStarter = orderBy(
		rows,
		["score", "fanRank", "pid"],
		["asc", "asc", "asc"],
	);
	take(
		byStarter.filter((r) => r.court === "backcourt"),
		slots.startersBack,
		"starter",
	);
	take(
		byStarter.filter((r) => r.court === "frontcourt"),
		slots.startersFront,
		"starter",
	);

	const byCoach = orderBy(
		rows,
		[(r) => r.playerRank + r.mediaRank, "fanRank", "pid"],
		["asc", "asc", "asc"],
	);
	take(
		byCoach.filter((r) => r.court === "backcourt"),
		slots.reservesBack,
		"reserve",
	);
	take(
		byCoach.filter((r) => r.court === "frontcourt"),
		slots.reservesFront,
		"reserve",
	);
	// Wild cards, then anyone if a court ran short of candidates
	take(byCoach, numPlayers - picked.length, "reserve");

	return picked;
};
