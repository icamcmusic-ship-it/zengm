// Position-aware team composites (the positionalComposites setting, see docs/native-features.md). Team composite ratings were plain
// 5-man averages, so a guard's height protected the rim as much as a center's. With the setting on, each player on the court counts by
// his share of the job: the biggest players for rim protection, blocks and rebounding, the ball handlers for dribbling and ball
// security, the smaller players for perimeter defense. Pure arithmetic on the sim's numbers, no random numbers.

// Shares by rank on the floor (biggest / best ball handler first), for 5 players on the court. Each sums to 5
export const INTERIOR_SHARES = [1.6, 1.3, 1.0, 0.65, 0.45];
export const REBOUND_SHARES = [1.4, 1.2, 1.0, 0.8, 0.6];
// Perimeter defense: by the same size order, smallest gets the most
export const PERIMETER_SHARES = [0.6, 0.8, 1.0, 1.2, 1.4];
export const BALL_SHARES = [1.5, 1.2, 1.0, 0.7, 0.6];

// Rescale factors so the league average of each team composite is the same as the plain average (the weighted averages are a bit
// higher, since bigs have higher rim protection and guards better ball handling). Calibrated over simulated games, see
// docs/native-features.md
export const POSITIONAL_SCALE = {
	blocking: 0.955,
	defenseInterior: 0.954,
	rebounding: 0.968,
	offRebounding: 0.966,
	defRebounding: 0.969,
	dribbling: 0.975,
	ballSecurity: 0.985,
	defensePerimeter: 0.995,
	defenseInside: 0.986,
	defenseOutside: 1.01,
};

const POS_BONUS: Record<string, number> = {
	C: 4,
	FC: 3,
	PF: 2,
	F: 1,
	GF: -1,
	SF: 0,
	SG: -2,
	G: -2,
	PG: -3,
};

type Player = {
	pos: string;
	compositeRating: Record<string, number>;
	simHgt?: number;
};

// How big he plays: height rating plus a little for his position (ties and near ties go to the real big)
export const interiorScore = (p: Player) =>
	(p.simHgt ?? 100 * (p.compositeRating.jumpBall ?? 0.5)) +
	(POS_BONUS[p.pos] ?? 0);

export type PositionalShares = {
	interior: number[];
	rebound: number[];
	perimeter: number[];
	ball: number[];
};

// Each player's shares, in the order of players. Only for 5 players on the court; undefined otherwise (plain averages)
export const positionalShares = (
	players: Player[],
	out?: PositionalShares,
): PositionalShares | undefined => {
	const n = players.length;
	if (n !== INTERIOR_SHARES.length) {
		return undefined;
	}
	const shares = out ?? {
		interior: new Array(n).fill(1),
		rebound: new Array(n).fill(1),
		perimeter: new Array(n).fill(1),
		ball: new Array(n).fill(1),
	};
	const bySize = players
		.map((p, i) => ({ i, v: interiorScore(p) }))
		.sort((a, b) => b.v - a.v || a.i - b.i);
	for (const [rank, { i }] of bySize.entries()) {
		shares.interior[i] = INTERIOR_SHARES[rank]!;
		shares.rebound[i] = REBOUND_SHARES[rank]!;
		shares.perimeter[i] = PERIMETER_SHARES[rank]!;
	}
	const byBall = players
		.map((p, i) => ({ i, v: p.compositeRating.dribbling ?? 0 }))
		.sort((a, b) => b.v - a.v || a.i - b.i);
	for (const [rank, { i }] of byBall.entries()) {
		shares.ball[i] = BALL_SHARES[rank]!;
	}
	return shares;
};
