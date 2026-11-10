import { Rng, clamp } from "./rng.ts";

/**
 * The weekly AP poll of the college season (ncaa.ts): a preseason poll from reputation (the program, its prospects, a look at practice and some hype), then a poll after each week of the regular season from the results so far, voted by the same 62 voters all year (each has his own lasting opinion of every team), and the final poll, which is the one ncaa.ts has always made after the conference tournaments.
 *
 * Has its own random stream, so it changes nothing else about the season.
 */

export const NUM_VOTERS = 62;
// Regular season weeks. Poll 0 is the preseason poll, polls 1 to REGULAR_WEEKS follow each week, and the final poll (after the conference tournaments) is poll REGULAR_WEEKS + 1
export const REGULAR_WEEKS = 17;
// Non-conference games are in weeks 1 to NON_CONF_WEEKS
export const NON_CONF_WEEKS = 6;

export type NcaaApEntry = {
	team: number;
	pts: number;
	firstPlace: number;
	// Record at the time of the poll
	w: number;
	l: number;
};

export type NcaaPollEntry = NcaaApEntry & {
	// Rank in the previous poll, undefined if it was not ranked (or for the preseason poll)
	prev?: number;
};

export type NcaaPoll = {
	week: number;
	// "Preseason", "Week 5", "Final"
	label: string;
	ranked: NcaaPollEntry[];
	// Others receiving votes, most points first
	others: { team: number; pts: number }[];
	// Ranked in the previous poll, not in this one
	dropped: number[];
};

// A regular season game: a's score minus b's, and the week it was played in (1 to REGULAR_WEEKS)
export type PollGame = {
	a: number;
	b: number;
	d: number;
	week: number;
};

export const pollLabel = (week: number) =>
	week === 0 ? "Preseason" : week > REGULAR_WEEKS ? "Final" : `Week ${week}`;

export const buildWeeklyPolls = ({
	seed,
	season,
	reputation,
	games,
	finalPoll,
}: {
	seed: string;
	season: number;
	// What is known about each team before a game is played, in points per game
	reputation: number[];
	games: PollGame[];
	finalPoll: { ranked: NcaaApEntry[]; others: { team: number; pts: number }[] };
}): NcaaPoll[] => {
	const rng = new Rng(`${seed}|${season}|polls`);
	const n = reputation.length;
	const all = Array.from({ length: n }, (_, i) => i);

	// October's story about each team, and each voter's own opinion of it, which last all season
	const repMean = reputation.reduce((a, b) => a + b, 0) / Math.max(1, n);
	const rep = reputation.map((x) => 0.85 * (x - repMean) + rng.normal(0, 1.6));
	const eyes = Array.from({ length: NUM_VOTERS }, () =>
		Array.from({ length: n }, () => rng.normal(0, 1.1)),
	);

	const byWeek: PollGame[][] = Array.from(
		{ length: REGULAR_WEEKS + 1 },
		() => [],
	);
	for (const game of games) {
		byWeek[clamp(game.week, 1, REGULAR_WEEKS)]!.push(game);
	}

	const w: number[] = Array.from({ length: n }, () => 0);
	const l: number[] = Array.from({ length: n }, () => 0);
	const margins: number[] = Array.from({ length: n }, () => 0);
	const opps: number[][] = Array.from({ length: n }, () => []);
	let srs: number[] = Array.from({ length: n }, () => 0);
	let standing: number[] = [...rep];

	const polls: NcaaPoll[] = [];
	const vote = (week: number) => {
		const contenders = [...all]
			.sort((x, y) => standing[y]! - standing[x]! || x - y)
			.slice(0, 45);
		const pts = new Map<number, { pts: number; firstPlace: number }>();
		for (const t of contenders) {
			pts.set(t, { pts: 0, firstPlace: 0 });
		}
		for (let v = 0; v < NUM_VOTERS; v++) {
			const eye = eyes[v]!;
			const ballot = contenders
				.map((t) => ({
					t,
					score: standing[t]! + eye[t]! + rng.normal(0, 1.1),
				}))
				.sort((x, y) => y.score - x.score)
				.slice(0, 25);
			for (const [i, { t }] of ballot.entries()) {
				const entry = pts.get(t)!;
				entry.pts += 25 - i;
				if (i === 0) {
					entry.firstPlace += 1;
				}
			}
		}
		const sorted = contenders
			.filter((t) => pts.get(t)!.pts > 0)
			.sort(
				(x, y) =>
					pts.get(y)!.pts - pts.get(x)!.pts ||
					standing[y]! - standing[x]! ||
					x - y,
			);
		polls.push({
			week,
			label: pollLabel(week),
			ranked: sorted
				.slice(0, 25)
				.map((t) => ({ team: t, ...pts.get(t)!, w: w[t]!, l: l[t]! })),
			others: sorted.slice(25).map((t) => ({ team: t, pts: pts.get(t)!.pts })),
			dropped: [],
		});
	};

	// Preseason
	vote(0);

	for (let week = 1; week <= REGULAR_WEEKS; week++) {
		const weekW: number[] = Array.from({ length: n }, () => 0);
		const weekL: number[] = Array.from({ length: n }, () => 0);
		for (const game of byWeek[week]!) {
			const d = clamp(game.d, -20, 20);
			margins[game.a]! += d;
			margins[game.b]! -= d;
			opps[game.a]!.push(game.b);
			opps[game.b]!.push(game.a);
			const [win, lose] = game.d > 0 ? [game.a, game.b] : [game.b, game.a];
			w[win]! += 1;
			l[lose]! += 1;
			weekW[win]! += 1;
			weekL[lose]! += 1;
		}

		// Simple rating system over the games so far, starting from last week's
		const mov = margins.map((m, i) => m / Math.max(1, opps[i]!.length));
		for (let iter = 0; iter < 8; iter++) {
			const next: number[] = [];
			let total = 0;
			for (let i = 0; i < n; i++) {
				const list = opps[i]!;
				let sum = 0;
				for (let j = 0; j < list.length; j++) {
					sum += srs[list[j]!]!;
				}
				const value = mov[i]! + (list.length > 0 ? sum / list.length : 0);
				next.push(value);
				total += value;
			}
			const mean = total / n;
			for (let i = 0; i < n; i++) {
				next[i]! -= mean;
			}
			srs = next;
		}

		// Early on a few games say little, so reputation still counts. By March it is all results, like the final poll
		const k = 20 * (1 - week / (REGULAR_WEEKS + 1)) ** 1.5;
		const prev = standing;
		standing = all.map((t) => {
			const played = opps[t]!.length;
			const raw =
				(played * srs[t]! + k * rep[t]!) / Math.max(1, played + k) +
				0.4 * (w[t]! - l[t]!);
			let value = 0.25 * prev[t]! + 0.75 * raw;
			if (weekL[t]! > 0 && weekW[t] === 0) {
				// Voters do not move a team up for losing
				value = Math.min(value, prev[t]! - 0.3 * weekL[t]!);
			} else if (weekW[t]! > 0 && weekL[t] === 0) {
				// Or down for winning, however ugly the wins were
				value = Math.max(value, prev[t]! + 0.25 * weekW[t]!);
			}
			return value;
		});
		vote(week);
	}

	polls.push({
		week: REGULAR_WEEKS + 1,
		label: pollLabel(REGULAR_WEEKS + 1),
		ranked: finalPoll.ranked.map((entry) => ({ ...entry })),
		others: finalPoll.others,
		dropped: [],
	});

	for (let i = 1; i < polls.length; i++) {
		const prevRanks = new Map(
			polls[i - 1]!.ranked.map((entry, rank) => [entry.team, rank + 1]),
		);
		const now = new Set<number>();
		for (const entry of polls[i]!.ranked) {
			now.add(entry.team);
			const prev = prevRanks.get(entry.team);
			if (prev !== undefined) {
				entry.prev = prev;
			}
		}
		polls[i]!.dropped = polls[i - 1]!.ranked.map((entry) => entry.team).filter(
			(t) => !now.has(t),
		);
	}
	return polls;
};

// Polls each team was No. 1 in, most first
export const getWeeksAtNo1 = (polls: NcaaPoll[]) => {
	const counts = new Map<number, number>();
	for (const poll of polls) {
		const top = poll.ranked[0];
		if (top) {
			counts.set(top.team, (counts.get(top.team) ?? 0) + 1);
		}
	}
	return [...counts]
		.map(([team, weeks]) => ({ team, weeks }))
		.sort((a, b) => b.weeks - a.weeks || a.team - b.team);
};

// Every team that was ever ranked: its rank in each poll (0 = not ranked), best first (by its best rank, then weeks ranked)
export const getPollHistory = (polls: NcaaPoll[]) => {
	const history = new Map<number, number[]>();
	for (const [i, poll] of polls.entries()) {
		for (const [rank, entry] of poll.ranked.entries()) {
			let ranks = history.get(entry.team);
			if (!ranks) {
				ranks = Array.from({ length: polls.length }, () => 0);
				history.set(entry.team, ranks);
			}
			ranks[i] = rank + 1;
		}
	}
	return [...history]
		.map(([team, ranks]) => {
			const ranked = ranks.filter((r) => r > 0);
			return {
				team,
				ranks,
				best: Math.min(...ranked),
				weeks: ranked.length,
			};
		})
		.sort((a, b) => a.best - b.best || b.weeks - a.weeks || a.team - b.team);
};
