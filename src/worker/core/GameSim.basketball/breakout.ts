// Breakout nights (part of the Shot Share Model, see docs/native-features.md "Breakout nights"): role and bench players occasionally have
// big scoring nights. Off (shotShareModel off, or an All-Star game): nothing here is used and the sim draws exactly the random numbers it
// did before. On, it draws none from Math.random either: the one new draw per player per game is a seeded stream of the game and the
// player (Rng, salted by the league), so the rest of the sim's random numbers stay where they were.
//
// - Role factor rf, 0 to 1, from his rank on his team by usage composite (among its healthy top 9 by value): the top scorer 0, the
//   role players (4th and below) 1. Stars are fed every night; everything below scales with rf.
// - Usage form: his shooter-draw weight × exp(sd × uz - sd² / 2) (mean 1), sd from formSdStar (rf 0) to formSdRole (rf 1), with
//   uz = formRho × gameZ (his shooting form for the game, player traits) + sqrt(1 - formRho²) × his own draw. A good shooting night is
//   also a more aggressive night.
// - Career night: with probability careerProb × rf (a rank 4+ player: about 1 in 300 games) his usage form × careerUsage and his shots
//   from the shooter draw + careerMake make probability.
// - Openings: each injured player among his team's top 5 by value (a starter out, up to openInjuryMax) × 1 + openInjury × rf. And the
//   game plan goes at the opponent's weakness: a shooter (three-point threat) against a poor perimeter defense (the opponent's healthy
//   top 8 by value, mean perimeter defense composite), a finisher against a poor interior one: × 1 + matchK × rf × the edge (−0.5 to 1).
// - Hot hand: a role player's boost is hot × (1 + hotRole × rf / hot) instead of hot and lasts hotPoss + hotPossRole × rf shooter draws.
//   A miss doesn't end it (as it does for a star): coldMisses straight misses do. It also starts on a heater: a made shot with heatPts+
//   points at heatEff+ points per shot (FGA + 0.44 FTA).
// - The coach rides it (coaching adjustments, Realistic Rotations): a hot bench player's planned minutes go up benchHotMin × weight ×
//   (1 + coach skill) / 2 more than a starter's, up to benchMaxShift from tip-off, unless the game is a blowout (benchBlowout+ points).
//   And in the closing minutes of a close game a role player with closerPts+ points at closerEff+ points per shot counts as (1 +
//   closerHot) × his value for the closing lineup.
// - Calibration: every shot from the shooter draw - makeCal make probability, so league shooting stays where it was.

import { Rng } from "../../../common/ratingsBuilds/rng.ts";

export const BREAKOUT = {
	roleByRank: [0, 0.35, 0.7, 1],
	formRho: 0.6,
	formSdStar: 0.06,
	// (toned down twice: was 0.22, 2.5, 1 / 150, 1.55, hotRole 0.35, hotPossRole 6, then 0.17, 1 / 300, 1.4, hotPossRole 4, benchHotMin 4,
	// benchMaxShift 8, makeCal 0.0045; see the doc)
	formSdRole: 0.13,
	formZMax: 2,
	careerProb: 1 / 600,
	careerUsage: 1.3,
	careerMake: 0.035,
	openInjury: 0.07,
	openInjuryMax: 2,
	matchK: 0.12,
	// The league's mean perimeter and interior defense composites (healthy top 8 by value, 2026 preset), and how far below it is the full
	// edge
	perimRef: 0.52,
	perimSpan: 0.06,
	intRef: 0.533,
	intSpan: 0.06,
	// A shooter: three-point threat from threatLo, full at threatLo + threatSpan; a finisher: rim composite from rimLo, full at + rimSpan
	threatLo: 0.4,
	threatSpan: 0.2,
	rimLo: 0.5,
	rimSpan: 0.2,
	hotRole: 0.22,
	hotPossRole: 2,
	coldMisses: 2,
	heatPts: 12,
	heatEff: 1.3,
	benchHotMin: 2.5,
	benchMaxShift: 6,
	benchBlowout: 15,
	closerHot: 0.15,
	closerPts: 16,
	closerEff: 1.2,
	// Calibration: taken off the make probability of every shot from the shooter draw (more of the shots now go to whoever is shooting
	// well tonight, so league FG% and 3P% would go up)
	makeCal: 0.0035,
};

const clamp = (x: number, lo: number, hi: number) =>
	x < lo ? lo : x > hi ? hi : x;

export const roleFactor = (rank: number) =>
	BREAKOUT.roleByRank[Math.min(rank, BREAKOUT.roleByRank.length - 1)]!;

// Each player's rank on his team by usage composite, among its healthy top 9 by value (others: the last rank)
export const usageRanks = <
	T extends { valueNoPot: number; injured: boolean; usage: number },
>(
	players: T[],
) => {
	const out = new Map<T, number>();
	const ranked = players
		.filter((p) => !p.injured)
		.toSorted((a, b) => b.valueNoPot - a.valueNoPot)
		.slice(0, 9)
		.toSorted((a, b) => b.usage - a.usage);
	for (const [rank, p] of ranked.entries()) {
		out.set(p, rank);
	}
	for (const p of players) {
		if (!out.has(p)) {
			out.set(p, BREAKOUT.roleByRank.length - 1);
		}
	}
	return out;
};

// His draw for the game: a standard normal (the usage form's own part) and a uniform (the career night), from a stream seeded by the
// game and the player
export const formDraw = (gid: number, pid: number) => {
	const rng = new Rng(`breakout|${gid}|${pid}`);
	const u1 = Math.max(1e-12, rng.random());
	const u2 = rng.random();
	const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
	return { z, u: rng.random() };
};

// The usage form multiplier (mean 1 over his games), from his role factor, his shooting form gameZ (undefined without player traits) and
// his own draw z
export const usageForm = (rf: number, gameZ: number | undefined, z: number) => {
	const B = BREAKOUT;
	const sd = B.formSdStar + (B.formSdRole - B.formSdStar) * rf;
	const uz = clamp(
		gameZ === undefined
			? z
			: B.formRho * gameZ + Math.sqrt(1 - B.formRho ** 2) * z,
		-B.formZMax,
		B.formZMax,
	);
	return Math.exp(sd * uz - (sd * sd) / 2);
};

export const isCareerNight = (rf: number, u: number) =>
	u < BREAKOUT.careerProb * rf;

// Starters out: the injured among the top 5 by value
export const startersOut = (
	players: { valueNoPot: number; injured: boolean }[],
) => {
	let n = 0;
	for (const p of players
		.toSorted((a, b) => b.valueNoPot - a.valueNoPot)
		.slice(0, 5)) {
		if (p.injured) {
			n += 1;
		}
	}
	return n;
};

export const injuryOpening = (rf: number, out: number) =>
	1 + BREAKOUT.openInjury * rf * Math.min(out, BREAKOUT.openInjuryMax);

// The opponent's healthy top 8 by value: mean perimeter and interior defense composites
export const oppDefense = (
	players: {
		valueNoPot: number;
		injured: boolean;
		compositeRating: { defensePerimeter?: number; defenseInterior?: number };
	}[],
) => {
	const top = players
		.filter((p) => !p.injured)
		.toSorted((a, b) => b.valueNoPot - a.valueNoPot)
		.slice(0, 8);
	let perim = 0;
	let int = 0;
	for (const p of top) {
		perim += p.compositeRating.defensePerimeter ?? BREAKOUT.perimRef;
		int += p.compositeRating.defenseInterior ?? BREAKOUT.intRef;
	}
	return top.length > 0
		? { perim: perim / top.length, int: int / top.length }
		: { perim: BREAKOUT.perimRef, int: BREAKOUT.intRef };
};

// The game plan's matchup multiplier for a player with this three-point threat and rim composite against this defense
export const matchupOpening = (
	rf: number,
	threat: number,
	rim: number,
	def: { perim: number; int: number },
) => {
	const B = BREAKOUT;
	const shooter = clamp((threat - B.threatLo) / B.threatSpan, 0, 1);
	const finisher = clamp((rim - B.rimLo) / B.rimSpan, 0, 1);
	const edge =
		shooter * ((B.perimRef - def.perim) / B.perimSpan) +
		finisher * ((B.intRef - def.int) / B.intSpan);
	return 1 + B.matchK * rf * clamp(edge, -0.5, 1);
};

// Core sim (every game with the Shot Share Model, not a setting): the defense keys on a hot bench player (gs 0). Past pts points tonight
// his shooter-draw weight × 1 / (1 + k × (points − pts) / 5): 0.83 at 19, 0.71 at 24, 0.63 at 29, so big bench nights stay rare
export const BENCH_COOL = {
	pts: 14,
	k: 0.25,
};
export const benchCool = (gs: number, pts: number) =>
	gs !== 0 || pts <= BENCH_COOL.pts
		? 1
		: 1 / (1 + (BENCH_COOL.k * (pts - BENCH_COOL.pts)) / 5);

// Points per shot so far (FGA + 0.44 FTA)
export const ptsPerShot = (stat: { pts: number; fga: number; fta: number }) =>
	stat.pts / Math.max(1, stat.fga + 0.44 * stat.fta);

// A heater: points and efficiency enough that the team keeps feeding him
export const onHeater = (stat: { pts: number; fga: number; fta: number }) =>
	stat.pts >= BREAKOUT.heatPts && ptsPerShot(stat) >= BREAKOUT.heatEff;

// Hot enough to close the game
export const hotCloser = (stat: { pts: number; fga: number; fta: number }) =>
	stat.pts >= BREAKOUT.closerPts && ptsPerShot(stat) >= BREAKOUT.closerEff;
