import { clamp } from "./rng.ts";

/**
 * A NET-style computed ranking for the college season (ncaa.ts), from results only: margin of victory adjusted for schedule and site, wins and losses weighted by site and adjusted for schedule, strength of schedule, and records by quadrant (how good the opponent was and where the game was played). Pure, no randomness.
 */

// One game, as the ranking sees it. home: 1 if a was at home, -1 if b was, 0 for a neutral court. d: a's score minus b's
export type NetGame = {
	a: number;
	b: number;
	home: number;
	d: number;
};

export type NcaaNet = {
	// 1 = best
	rank: number;
	// In standard deviations above the average team
	score: number;
	// Strength of schedule, 1 = hardest
	sosRank: number;
	// Record in each quadrant, [wins, losses] for Quadrant 1 to 4
	quads: [number, number][];
	roadW: number;
	roadL: number;
};

// Worst opponent rank that still counts for a quadrant, by site (the NET's own cutoffs, for about 360 teams)
const QUADS = [
	{ home: 30, neutral: 50, away: 75 },
	{ home: 75, neutral: 100, away: 135 },
	{ home: 160, neutral: 200, away: 240 },
];

// site: 1 home, 0 neutral, -1 away. Returns 0-3 for Quadrant 1-4. scale: the cutoffs are for about 360 teams, a smaller league (college
// mode) passes its size / 360
export const quadOf = (oppRank: number, site: number, scale = 1) => {
	const key = site > 0 ? "home" : site < 0 ? "away" : "neutral";
	for (const [i, row] of QUADS.entries()) {
		if (oppRank <= row[key] * scale) {
			return i;
		}
	}
	return 3;
};

const HOME_EDGE = 3.5;

const zScores = (values: number[]) => {
	const n = Math.max(1, values.length);
	const mean = values.reduce((a, b) => a + b, 0) / n;
	const sd =
		Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / n) || 1;
	return values.map((v) => (v - mean) / sd);
};

// Simple rating system: a team's value is its own average result plus the average value of its opponents
const solve = (own: number[], opps: number[][], iterations: number) => {
	const n = own.length;
	let values = [...own];
	for (let iter = 0; iter < iterations; iter++) {
		const next = own.map((m, i) => {
			const list = opps[i]!;
			let sum = 0;
			for (const o of list) {
				sum += values[o]!;
			}
			return m + (list.length > 0 ? sum / list.length : 0);
		});
		const mean = next.reduce((a, b) => a + b, 0) / n;
		values = next.map((x) => x - mean);
	}
	return values;
};

export const computeNet = (
	n: number,
	games: NetGame[],
	quadScale = 1,
): NcaaNet[] => {
	const effSum: number[] = Array.from({ length: n }, () => 0);
	const resSum: number[] = Array.from({ length: n }, () => 0);
	const opps: number[][] = Array.from({ length: n }, () => []);
	for (const game of games) {
		// Margin with the home edge taken out, capped so running up the score is worth nothing
		const eff = clamp(game.d - HOME_EDGE * game.home, -12, 12);
		effSum[game.a]! += eff;
		effSum[game.b]! -= eff;
		// A road win is worth more than a home win, a home loss costs more than a road loss
		const aWon = game.d > 0;
		const res = aWon ? 1 - 0.4 * game.home : -(1 + 0.4 * game.home);
		resSum[game.a]! += res;
		resSum[game.b]! -= res;
		opps[game.a]!.push(game.b);
		opps[game.b]!.push(game.a);
	}
	const per = (sums: number[]) =>
		sums.map((sum, i) => sum / Math.max(1, opps[i]!.length));
	const zEff = zScores(solve(per(effSum), opps, 30));
	const zRes = zScores(solve(per(resSum), opps, 30));
	const score = zEff.map((z, i) => 0.5 * z + 0.5 * zRes[i]!);

	const order = Array.from({ length: n }, (_, i) => i).sort(
		(x, y) => score[y]! - score[x]! || x - y,
	);
	const rank: number[] = [];
	for (const [i, t] of order.entries()) {
		rank[t] = i + 1;
	}

	const sos = opps.map((list) => {
		let sum = 0;
		for (const o of list) {
			sum += score[o]!;
		}
		return list.length > 0 ? sum / list.length : -99;
	});
	const sosOrder = Array.from({ length: n }, (_, i) => i).sort(
		(x, y) => sos[y]! - sos[x]! || x - y,
	);
	const sosRank: number[] = [];
	for (const [i, t] of sosOrder.entries()) {
		sosRank[t] = i + 1;
	}

	const output: NcaaNet[] = Array.from({ length: n }, (_, i) => ({
		rank: rank[i]!,
		score: Math.round(score[i]! * 1000) / 1000,
		sosRank: sosRank[i]!,
		quads: [
			[0, 0],
			[0, 0],
			[0, 0],
			[0, 0],
		],
		roadW: 0,
		roadL: 0,
	}));
	for (const game of games) {
		const aWon = game.d > 0;
		for (const [t, opp, site, won] of [
			[game.a, game.b, game.home, aWon],
			[game.b, game.a, -game.home, !aWon],
		] as const) {
			const net = output[t]!;
			net.quads[quadOf(rank[opp]!, site, quadScale)]![won ? 0 : 1]! += 1;
			if (site < 0) {
				if (won) {
					net.roadW += 1;
				} else {
					net.roadL += 1;
				}
			}
		}
	}
	return output;
};

/**
 * What the selection committee thinks of a team's season, higher is better: the NET, quality wins by tier (Quadrant 1 and 2 wins), bad losses (Quadrant 3 and 4), road wins and the record. On the scale of points per game, like the simple rating system.
 */
export const committeeScore = (
	net: NcaaNet,
	t: { w: number; l: number; srs: number },
) => {
	const [q1, q2, q3, q4] = net.quads as [
		[number, number],
		[number, number],
		[number, number],
		[number, number],
	];
	return (
		0.85 * t.srs +
		1.6 * net.score +
		0.2 * (t.w - t.l) +
		0.2 * q1[0] +
		0.06 * q2[0] -
		0.15 * q3[1] -
		0.3 * q4[1] +
		0.05 * net.roadW
	);
};
