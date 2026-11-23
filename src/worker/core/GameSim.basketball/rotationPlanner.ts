// Realistic Rotations (the realisticRotations setting, see docs/native-features.md): minutes targets planned at tip-off, the foul
// trouble rules and the closing lineup. Pure functions, no random numbers; GameSim.updatePlayersOnCourt multiplies its usual
// substitution values by the factors from here.

import { ALL_STAR_MINUTES } from "./allStarSim.ts";

// Minutes per regulation game (48) planned by rank in value among the healthy players, regular season. Sums to 240. Planned a little
// above what the top of the rotation ends up playing, since blowouts and foul trouble take minutes from them (calibrated so the
// league minutes by rank stay about the same as with the setting off, see docs/native-features.md). The top three were raised (and the
// bench trimmed) so the league's top scorers play ~34-35 minutes per game (they played ~33, NBA ~35)
const REGULAR_SEASON_TARGETS = [
	40, 38, 35, 31.5, 28.5, 21.5, 18.5, 14.5, 10, 2.5,
];
// Playoffs: an 8-man rotation, stars play 38-42 (about 40 in close games, less in blowouts)
const PLAYOFF_TARGETS = [43, 41, 38, 36, 34, 24, 15, 9];

// Second night of a back-to-back: starters play a little less, the bench a little more
const BACK_TO_BACK_STARTER_CUT = 2;

// The most a player is planned for (before ptModifier above 1), for 5 on court (it scales with numPlayersOnCourt, up to 48)
const MAX_TARGET_REGULAR_SEASON = 42;
const MAX_TARGET_PLAYOFFS = 44;
// A star (this much better than the team's 5th best player) gets a little more, up to the max
const STAR_VALUE_GAP = 10;
const STAR_BONUS = 3;

export type RotationPlayer = {
	valueNoPot: number;
	injured: boolean;
	ptModifier: number;
	// A cap on his planned minutes, as a share of 36 (Career Aging's old-player caps; 1 = none)
	minutesRestriction?: number;
	// Injury Depth minutes restriction on return (1 = none). Already in ptModifier, so it is divided back out of it and applied once
	// to the plan: he is planned for about this share of the minutes he'd normally get (and not rescaled up)
	injuryRestriction?: number;
	// Coaching systems: the coach's trust in young players or veterans (1 = none)
	coachMinutesMult?: number;
	// The user's team (options.userControlled): one of the starters he picked (the first numPlayersOnCourt in his roster order)
	userStarter?: boolean;
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
	// Minutes in regulation (numPeriods * quarterLength). The tables are for 48; everything is scaled to this. Undefined = 48
	regulationMinutes?: number;
	// Playoffs only: the series state (common/seriesState.ts). 1 a deciding game, 0.8 facing elimination: the top 5 play more (up to
	// 46), the end of the rotation less. Negative (up 3-0): the stars rest a little. Undefined = 0
	seriesUrgency?: number;
	// The user's own team (not AI, spectator or auto play): his roster order and playing time buttons count. The plan ranks by value x
	// playing time, his starters get a minutes floor and the playing time choice moves real minutes. Undefined = an AI team, unchanged
	userControlled?: boolean;
};

// User's team: "+" and "++" (1.25, 1.75) move a player up the plan's order (value x choice^RANK) and a little more at that rank
// (x choice^MINUTES), so "++" on the end of the bench makes him a rotation player. "-" (0.75) keeps his rank and takes about 30% of
// his minutes (x choice^CUT), and the rescale doesn't give them back (an AI team's "-" star got ~32 of ~40 back)
const USER_PT_RANK_EXP = 0.3;
const USER_PT_MINUTES_EXP = 0.2;
const USER_PT_CUT_EXP = 1.25;
// ... and the starters he picked play at least this much (x the playing time choice when it's below normal), unless injured, on a
// minutes restriction or (in the sim) in foul trouble
export const USER_STARTER_FLOOR = 24;

// Playoff series urgency: share of minutes added to the top 5 (and taken from the 7th man on) per unit of urgency
const URGENCY_STARS = 0.07;
const URGENCY_BENCH = 0.5;
const URGENCY_REST_STARS = 0.08;
const URGENCY_MAX_EXTRA = 2;
// ... and the cap comes down when resting
const URGENCY_REST_MAX = 3;

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
		table = ALL_STAR_MINUTES;
	}
	const style = Math.max(-1, Math.min(1, options.rotationStyle ?? 0));

	const user = options.userControlled === true && !options.allStarGame;
	// The user's playing time choice, without an Injury Depth restriction (which is also in ptModifier)
	const restrictionOf = (p: RotationPlayer) =>
		p.injuryRestriction !== undefined &&
		p.injuryRestriction > 0 &&
		p.injuryRestriction < 1
			? p.injuryRestriction
			: 1;
	const choiceOf = (p: RotationPlayer) => p.ptModifier / restrictionOf(p);
	// What the plan ranks by: value, and on the user's team value x his playing time choice
	const keyOf = user
		? (p: RotationPlayer) =>
				p.valueNoPot * Math.max(1, choiceOf(p)) ** USER_PT_RANK_EXP
		: (p: RotationPlayer) => p.valueNoPot;
	const order = players
		.map((p, i) => ({ p, i, key: keyOf(p) }))
		.filter(({ p }) => !p.injured && p.ptModifier > 0)
		.sort((a, b) => b.key - a.key);

	const targets = players.map(() => 0);
	// The table's starters and the next five: with another number on court the whole table is scaled, so they stay its top 5 and next 5
	const numStarters = 5;
	const fifthValue =
		order[Math.min(numStarters - 1, order.length - 1)]?.key ?? 0;
	const urgency =
		options.playoffs && !options.allStarGame
			? Math.max(-1, Math.min(1, options.seriesUrgency ?? 0))
			: 0;
	const max = Math.min(
		((options.playoffs ? MAX_TARGET_PLAYOFFS : MAX_TARGET_REGULAR_SEASON) +
			URGENCY_MAX_EXTRA * Math.max(0, urgency) -
			URGENCY_REST_MAX * Math.max(0, -urgency)) *
			scale,
		// (more than 5 on court: the cap scales with the table, up to the whole game)
		48,
	);

	// Players whose plan isn't rescaled up (an injury restriction), and the most each one is rescaled up to
	const frozen = new Set<number>();
	const caps = players.map(() => max);
	const backToBackCut =
		(options.backToBackCut ?? BACK_TO_BACK_STARTER_CUT) * scale;
	// User's team: the least each one is planned for (his starters' floor)
	const floors = players.map(() => 0);
	for (const [rank, { p, i, key }] of order.entries()) {
		let target = (table[rank] ?? 0) * scale;
		if (rank < numStarters && !options.allStarGame) {
			// Stars play a bit more
			const gap = key - fifthValue;
			target += STAR_BONUS * Math.max(0, Math.min(1, gap / STAR_VALUE_GAP));
			if (options.backToBack) {
				target -= backToBackCut;
			}
		} else if (
			options.backToBack &&
			rank < 2 * numStarters &&
			!options.allStarGame
		) {
			// ... and the next ones get those minutes
			target += backToBackCut;
		}
		if (p.coachMinutesMult !== undefined) {
			target *= p.coachMinutesMult;
		}
		// Coach style: tight rotations pull minutes toward the top 7, deep ones spread them
		if (style !== 0) {
			target *= 1 - 0.12 * style * (rank < 7 ? 1 : -1.5);
		}
		// Series state: must-win games tighten the rotation, a comfortable lead rests the stars
		if (urgency > 0) {
			target *=
				rank < 5
					? 1 + URGENCY_STARS * urgency
					: rank < 6
						? 1
						: 1 - URGENCY_BENCH * urgency;
		} else if (urgency < 0) {
			target *= rank < 5 ? 1 + URGENCY_REST_STARS * urgency : 1;
		}
		target = Math.min(target, max);
		if (p.minutesRestriction !== undefined && p.minutesRestriction < 1) {
			target = Math.min(target, 36 * p.minutesRestriction);
			// (a cap: not rescaled up past it either)
			caps[i] = Math.min(max, 36 * p.minutesRestriction);
		}
		const injuryRestriction = restrictionOf(p);
		if (injuryRestriction < 1) {
			frozen.add(i);
		}
		if (user) {
			const choice = choiceOf(p);
			if (choice < 1) {
				// "-": not rescaled up
				frozen.add(i);
			}
			const restricted =
				injuryRestriction < 1 ||
				(p.minutesRestriction !== undefined && p.minutesRestriction < 1);
			if (p.userStarter && !restricted) {
				floors[i] = Math.min(
					caps[i]!,
					USER_STARTER_FLOOR * scale * Math.min(1, choice),
				);
			}
			targets[i] = Math.min(
				caps[i]!,
				Math.max(
					floors[i]!,
					target *
						(choice < 1
							? choice ** USER_PT_CUT_EXP
							: Math.min(choice ** USER_PT_MINUTES_EXP, 1.5)) *
						injuryRestriction,
				),
			);
			continue;
		}
		targets[i] = Math.max(
			0,
			target *
				Math.min(p.ptModifier / injuryRestriction, 1.5) *
				injuryRestriction,
		);
	}

	// Rescale to the minutes there are, never above the max (more than once, since capped players can't take more). Short-handed, when
	// everybody is at the max, the plan sums to less than the minutes there are: the sim plays whoever is healthy anyway. Before, the
	// rescale went up to 1.25 times the max while the best player stayed at the max, so the 2nd-5th best were planned for more than him
	if (user) {
		rescaleUser(targets, order, totalMinutes, caps, floors, frozen);
	}
	for (let iter = 0; iter <= order.length && !user; iter++) {
		let sum = 0;
		let sumScalable = 0;
		for (const { i } of order) {
			sum += targets[i]!;
			if (!frozen.has(i) && targets[i]! < caps[i]! - 1e-9) {
				sumScalable += targets[i]!;
			}
		}
		const missing = totalMinutes - sum;
		if (missing < 0) {
			// Too many: everybody down
			const factor = totalMinutes / sum;
			for (const { i } of order) {
				targets[i] = targets[i]! * factor;
			}
			break;
		}
		if (missing < 0.01 || sumScalable <= 0) {
			break;
		}
		const factor = 1 + missing / sumScalable;
		for (const { i } of order) {
			if (!frozen.has(i) && targets[i]! < caps[i]! - 1e-9) {
				targets[i] = Math.min(caps[i]!, targets[i]! * factor);
			}
		}
	}

	// Shorter (college 2x20) or longer games: the same shares of the game. Before, the 48-minute plan was compared with the minutes of a
	// 40-minute game, so every planned player looked behind his plan
	const gameScale =
		options.regulationMinutes !== undefined &&
		Number.isFinite(options.regulationMinutes) &&
		options.regulationMinutes > 0
			? options.regulationMinutes / 48
			: 1;
	if (gameScale !== 1) {
		for (let i = 0; i < targets.length; i++) {
			targets[i] = targets[i]! * gameScale;
		}
	}

	return targets;
};

// The user's team: rescale to the minutes there are, each between his floor and his cap (the restricted ones are only scaled down)
const rescaleUser = (
	targets: number[],
	order: { i: number }[],
	totalMinutes: number,
	caps: number[],
	floors: number[],
	frozen: Set<number>,
) => {
	for (let iter = 0; iter <= 2 * order.length; iter++) {
		let sum = 0;
		for (const { i } of order) {
			sum += targets[i]!;
		}
		const up = sum < totalMinutes;
		let sumScalable = 0;
		for (const { i } of order) {
			const t = targets[i]!;
			if (up ? !frozen.has(i) && t < caps[i]! - 1e-9 : t > floors[i]! + 1e-9) {
				sumScalable += t;
			}
		}
		const missing = totalMinutes - sum;
		if (Math.abs(missing) < 0.01 || sumScalable <= 0) {
			break;
		}
		const factor = 1 + missing / sumScalable;
		for (const { i } of order) {
			const t = targets[i]!;
			if (missing > 0 && !frozen.has(i) && t < caps[i]! - 1e-9) {
				targets[i] = Math.min(caps[i]!, t * factor);
			} else if (missing < 0 && t > floors[i]! + 1e-9) {
				targets[i] = Math.max(floors[i]!, t * factor);
			}
		}
	}
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

// Foul trouble rules (NBA-like, with 6 fouls to foul out): when he commits his nth foul, until when (in elapsed regulation seconds) he
// sits. undefined = he doesn't have to sit. Written for 4 quarters; with another number of periods (college halves) the game is
// treated as 4 equal "quarters" by elapsed time (elapsed is then needed), so the same rules apply at the same points of the game
// (before, they never applied unless there were exactly 4 periods)
export const foulTroubleSitUntil = ({
	pf,
	period,
	numPeriods,
	foulsNeededToFoulOut,
	quarterSeconds,
	elapsed,
}: {
	pf: number;
	period: number;
	numPeriods: number;
	foulsNeededToFoulOut: number;
	quarterSeconds: number;
	// Elapsed regulation seconds at the foul (only used when numPeriods !== 4)
	elapsed?: number;
}) => {
	if (
		numPeriods < 1 ||
		foulsNeededToFoulOut < 5 ||
		period > numPeriods ||
		!(quarterSeconds > 0)
	) {
		return undefined;
	}
	const f = foulsNeededToFoulOut;
	// "Quarters" of the game, each a quarter of regulation
	const virtualQuarterSeconds = (numPeriods * quarterSeconds) / 4;
	if (numPeriods !== 4) {
		if (elapsed === undefined || !Number.isFinite(elapsed)) {
			return undefined;
		}
		period = Math.max(
			1,
			Math.min(4, Math.floor(elapsed / virtualQuarterSeconds) + 1),
		);
	}
	// Elapsed seconds when the clock in "quarter" q shows m minutes (minutes scaled to the quarter length)
	const at = (q: number, m: number) =>
		(q - 1) * virtualQuarterSeconds + virtualQuarterSeconds * (1 - m / 12);
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
