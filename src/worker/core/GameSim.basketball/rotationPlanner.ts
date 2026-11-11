// Realistic Rotations (the realisticRotations setting, see docs/native-features.md): minutes targets planned at tip-off, the foul
// trouble rules and the closing lineup. Pure functions, no random numbers; GameSim.updatePlayersOnCourt multiplies its usual
// substitution values by the factors from here.

// Minutes per regulation game (48) planned by rank in value among the healthy players, regular season. Sums to 240. Planned a little
// above what the top of the rotation ends up playing, since blowouts and foul trouble take minutes from them (calibrated so the
// league minutes by rank stay about the same as with the setting off, see docs/native-features.md)
const REGULAR_SEASON_TARGETS = [
	37.5, 35.5, 33.5, 31, 29, 22.5, 20, 16, 11.5, 3.5,
];
// Playoffs: an 8-man rotation, stars play 38-42 (about 40 in close games, less in blowouts)
const PLAYOFF_TARGETS = [43, 41, 38, 36, 34, 24, 15, 9];

// Second night of a back-to-back: starters play a little less, the bench a little more
const BACK_TO_BACK_STARTER_CUT = 2;

// The most a player is planned for (before ptModifier above 1)
const MAX_TARGET_REGULAR_SEASON = 39;
const MAX_TARGET_PLAYOFFS = 44;
// A star (this much better than the team's 5th best player) gets a little more, up to the max
const STAR_VALUE_GAP = 10;
const STAR_BONUS = 2;

export type RotationPlayer = {
	valueNoPot: number;
	injured: boolean;
	ptModifier: number;
	// Injury Depth minutes restriction (1 = none), also already in ptModifier
	minutesRestriction?: number;
	// Coaching systems: the coach's trust in young players or veterans (1 = none)
	coachMinutesMult?: number;
};

export type RotationPlanOptions = {
	playoffs: boolean;
	backToBack: boolean;
	numPlayersOnCourt: number;
	allStarGame: boolean;
	// Hook for a coach's rotation style (a later batch): -1 a tight rotation (more minutes for the top of the roster) ... 0 normal
	// ... 1 a deep bench. Undefined = 0
	rotationStyle?: number;
	// Coaching systems: minutes the starters give up on the second night of a back-to-back (rest philosophy). Undefined = 2
	backToBackCut?: number;
};

// Minutes targets per regulation game, in the order of players (0 for injured players and the end of the bench). They sum to
// numPlayersOnCourt * 48 when there are enough healthy players
export const planMinutes = (
	players: RotationPlayer[],
	options: RotationPlanOptions,
) => {
	const scale = options.numPlayersOnCourt / 5;
	const totalMinutes = 48 * options.numPlayersOnCourt;
	let table =
		options.playoffs && !options.allStarGame
			? PLAYOFF_TARGETS
			: REGULAR_SEASON_TARGETS;
	if (options.allStarGame) {
		// Everybody plays
		table = [26, 25, 24, 23, 22, 21, 20, 19, 17, 15, 14, 14];
	}
	const style = Math.max(-1, Math.min(1, options.rotationStyle ?? 0));

	const order = players
		.map((p, i) => ({ p, i }))
		.filter(({ p }) => !p.injured && p.ptModifier > 0)
		.sort((a, b) => b.p.valueNoPot - a.p.valueNoPot);

	const targets = players.map(() => 0);
	const fifthValue = order[Math.min(4, order.length - 1)]?.p.valueNoPot ?? 0;
	const max =
		(options.playoffs ? MAX_TARGET_PLAYOFFS : MAX_TARGET_REGULAR_SEASON) *
		Math.min(1, scale);

	for (const [rank, { p, i }] of order.entries()) {
		let target = (table[rank] ?? 0) * scale;
		if (rank < 5 && !options.allStarGame) {
			// Stars play a bit more
			const gap = p.valueNoPot - fifthValue;
			target += STAR_BONUS * Math.max(0, Math.min(1, gap / STAR_VALUE_GAP));
			if (options.backToBack) {
				target -= options.backToBackCut ?? BACK_TO_BACK_STARTER_CUT;
			}
		} else if (options.backToBack && rank < 10 && !options.allStarGame) {
			// ... and the next five get those minutes
			target += (options.backToBackCut ?? BACK_TO_BACK_STARTER_CUT) * scale;
		}
		if (p.coachMinutesMult !== undefined) {
			target *= p.coachMinutesMult;
		}
		// Coach style: tight rotations pull minutes toward the top 7, deep ones spread them
		if (style !== 0) {
			target *= 1 - 0.12 * style * (rank < 7 ? 1 : -1.5);
		}
		target = Math.min(target, max);
		if (p.minutesRestriction !== undefined && p.minutesRestriction < 1) {
			target = Math.min(target, 36 * p.minutesRestriction);
		}
		targets[i] = Math.max(0, target * Math.min(p.ptModifier, 1.5));
	}

	// Rescale to the minutes there are, without going over the max (more than once, since capped players can't take more)
	for (let iter = 0; iter < 4; iter++) {
		let sum = 0;
		let sumUncapped = 0;
		for (const { i } of order) {
			sum += targets[i]!;
			if (targets[i]! < max - 1e-9) {
				sumUncapped += targets[i]!;
			}
		}
		const missing = totalMinutes - sum;
		if (Math.abs(missing) < 0.01 || sumUncapped <= 0) {
			break;
		}
		const factor = 1 + missing / sumUncapped;
		for (const { i } of order) {
			if (targets[i]! < max - 1e-9 || missing < 0) {
				targets[i] = Math.min(max * 1.25, targets[i]! * factor);
			}
		}
	}

	return targets;
};

// How much more (> 1) or less (< 1) a player is wanted on the court given his minutes so far and his plan. expected is his target
// times the share of regulation that has been played
export const MINUTES_DEBT_SCALE = 2.5;
export const minutesDebtFactor = (
	target: number,
	min: number,
	elapsed: number,
) => {
	const debt = target * elapsed - min;
	return Math.exp(Math.max(-8, Math.min(8, debt)) / MINUTES_DEBT_SCALE);
};
// Players with no planned minutes only come in when needed (fouls, injuries, blowouts)
export const UNPLANNED_FACTOR = 0.2;
// A player sitting because of foul trouble
export const FOUL_TROUBLE_SIT_FACTOR = 0.05;

// Foul trouble rules (NBA-like, with 6 fouls to foul out and 4 periods): when he commits his nth foul, until when (in elapsed
// regulation seconds) he sits. undefined = he doesn't have to sit
export const foulTroubleSitUntil = ({
	pf,
	period,
	numPeriods,
	foulsNeededToFoulOut,
	quarterSeconds,
}: {
	pf: number;
	period: number;
	numPeriods: number;
	foulsNeededToFoulOut: number;
	quarterSeconds: number;
}) => {
	if (numPeriods !== 4 || foulsNeededToFoulOut < 5 || period > numPeriods) {
		return undefined;
	}
	const f = foulsNeededToFoulOut;
	// Elapsed seconds when the clock in period q shows m minutes (minutes scaled to the quarter length)
	const at = (q: number, m: number) =>
		(q - 1) * quarterSeconds + quarterSeconds * (1 - m / 12);
	if (pf >= f - 1) {
		// 5 fouls: closing minutes only
		return at(4, 5);
	}
	if (period === 3 && pf >= f - 2) {
		// 4 in the 3rd quarter: until about 8:00 of the 4th
		return at(4, 8);
	}
	if (period <= 2 && pf >= f - 3) {
		// 3 in the first half: until halftime
		return at(3, 12);
	}
	if (period === 1 && pf >= f - 4) {
		// 2 in the 1st quarter: until about 6:00 of the 2nd
		return at(2, 6);
	}
	return undefined;
};

// Closers: the last 5 minutes of close games
export const CLOSING_SECONDS = 5 * 60;
export const CLOSING_MARGIN = 10;
export const CLOSER_FACTOR = 2.5;
export const NON_CLOSER_FACTOR = 0.4;

type PosPlayer = { pos: string };
// Does a lineup have enough guards and forwards (the same rule as GameSim's substitutions: 2 G or a PG, 2 F or a C)
const validLineup = (players: PosPlayer[], cutoff: number) => {
	let numG = 0;
	let numPG = 0;
	let numF = 0;
	let numC = 0;
	for (const { pos } of players) {
		numG += Number(pos.includes("G"));
		numPG += Number(pos === "PG");
		numF += Number(pos.includes("F"));
		numC += Number(pos === "C");
	}
	return !((numG < cutoff && numPG === 0) || (numF < cutoff && numC === 0));
};

// The best numPlayersOnCourt players that make a valid lineup: the valid lineup with the highest total value among the best 9
// (by value, candidates sorted best first). With no valid lineup among them, just the best ones
const CLOSER_POOL = 9;
export const pickClosers = <T extends PosPlayer & { valueNoPot: number }>(
	candidates: T[],
	numPlayersOnCourt: number,
): Set<T> => {
	const cutoff = numPlayersOnCourt >= 5 ? 2 : numPlayersOnCourt >= 3 ? 1 : 0;
	const pool = candidates.slice(0, Math.max(CLOSER_POOL, numPlayersOnCourt));
	if (pool.length <= numPlayersOnCourt) {
		return new Set(pool);
	}
	let best: T[] | undefined;
	let bestValue = -Infinity;
	const current: T[] = [];
	const visit = (start: number, value: number) => {
		if (current.length === numPlayersOnCourt) {
			if (value > bestValue && validLineup(current, cutoff)) {
				bestValue = value;
				best = [...current];
			}
			return;
		}
		for (
			let i = start;
			i <= pool.length - (numPlayersOnCourt - current.length);
			i++
		) {
			current.push(pool[i]!);
			visit(i + 1, value + pool[i]!.valueNoPot);
			current.pop();
		}
	};
	visit(0, 0);
	return new Set(best ?? pool.slice(0, numPlayersOnCourt));
};
