import { Rng } from "../ratingsBuilds/rng.ts";
import { traitZ } from "./effects.ts";

// Development traits: work ethic (a regular trait key) and the aging curve (secret, not a trait key: see AGING_CURVE_INFO). Both act on the
// yearly base change of a player's ratings in the preseason (developSeason.basketball.ts), never on pot: pot is shown to the user, and it
// would leak the aging curve. Pure, no worker/DB/`g` access.

// --- Work ethic ---

export const DEVELOPMENT_AMPLITUDES = {
	// Added to the yearly base change (rating points, before each rating's random scale) at work ethic z = 1, for players 24 and under
	workEthicGrowthYoung: 1,
	// The same for older players (it helps them hold on to what they have)
	workEthicGrowthOld: 0.5,
	// Fraction by which the bad part of a year's random development roll (the negative noise) shrinks at z = 1, or grows at z = -1
	workEthicDropScale: 0.35,
} as const;

export const WORK_ETHIC_YOUNG_MAX_AGE = 24;

// Work ethic z, before centering on the league (see centerDevelopment)
export const workEthicZ = (workEthicScore: number) => traitZ(workEthicScore);

// --- Aging curve (secret) ---

export type AgingCurve = "early" | "late" | "graceful" | "normal";

// Share of players with each curve
export const AGING_CURVE_SHARES: Record<AgingCurve, number> = {
	early: 0.2,
	late: 0.2,
	graceful: 0.15,
	normal: 0.45,
};

const AGING_CURVE_ORDER: AgingCurve[] = ["early", "late", "graceful", "normal"];

export const AGING_CURVE_INFO: Record<
	AgingCurve,
	{ name: string; description: string }
> = {
	early: {
		name: "Early bloomer",
		description:
			"Developed faster than most as a young player, peaked early and started to decline sooner.",
	},
	late: {
		name: "Late bloomer",
		description:
			"Developed slowly at first, kept improving into his late 20s and peaked later than most.",
	},
	graceful: {
		name: "Aged gracefully",
		description:
			"A normal rise, then a much slower decline than most players in his 30s.",
	},
	normal: {
		name: "Normal aging curve",
		description: "Developed, peaked and declined like a typical player.",
	},
};

/**
 * The aging curve of a player. Never stored on the player (so it can never reach the UI through the player object, an export or a God Mode
 * editor): it is derived every time from the league's trait seed and the pid, so it is deterministic, fixed for a whole career, and existing
 * leagues need no backfill. Only revealed to the user once the player retires.
 */
export const agingCurveForPlayer = (
	leagueSeed: number | string,
	pid: number,
): AgingCurve => {
	const u = new Rng(`agingCurve|${leagueSeed}|${pid}`).random();
	let cumulative = 0;
	for (const curve of AGING_CURVE_ORDER) {
		cumulative += AGING_CURVE_SHARES[curve];
		if (u < cumulative) {
			return curve;
		}
	}
	return "normal";
};

// Raw change to the yearly base change (rating points) by age, before centering
const rawAgingDelta = (curve: AgingCurve, age: number) => {
	switch (curve) {
		case "early":
			if (age <= 21) {
				return 2;
			}
			if (age <= 23) {
				return 1;
			}
			if (age <= 25) {
				return 0;
			}
			if (age <= 30) {
				return -1;
			}
			return -0.5;
		case "late":
			if (age <= 21) {
				return -1.5;
			}
			if (age <= 23) {
				return -0.5;
			}
			if (age <= 25) {
				return 0.5;
			}
			if (age <= 29) {
				return 1.5;
			}
			if (age <= 31) {
				return 0.5;
			}
			return 0;
		case "graceful":
			if (age <= 29) {
				return 0;
			}
			if (age <= 31) {
				return 1;
			}
			if (age <= 35) {
				return 1.75;
			}
			// Fades out: he keeps what he saved in his 30s, but from 37 he declines like everyone else. Without the fade (1.75 at every age)
			// graceful agers barely declined at 38-41, so they were 3/4 of the league's 38+ players and the 40+ count piled up (docs/player-traits.md)
			if (age <= 36) {
				return 0.75;
			}
			return 0;
		default:
			return 0;
	}
};

/**
 * Change to the yearly base change (rating points) for a player of this aging curve at this age. Centered at every age over the population
 * (the shares above), so at any age the league's average development is unchanged: an aging curve moves when a player develops, not how much
 * the league develops.
 */
export const agingCurveDelta = (curve: AgingCurve, age: number) => {
	let mean = 0;
	for (const c of AGING_CURVE_ORDER) {
		mean += AGING_CURVE_SHARES[c] * rawAgingDelta(c, age);
	}
	return rawAgingDelta(curve, age) - mean;
};

// --- Both together ---

export type TraitDevelopment = {
	// Added to the yearly base change of every rating (rating points)
	baseChangeDelta: number;
	// Multiply the negative part of this year's random development noise. 1 is neutral, lower is steadier.
	dropScale: number;
};

export const NEUTRAL_TRAIT_DEVELOPMENT: TraitDevelopment = Object.freeze({
	baseChangeDelta: 0,
	dropScale: 1,
});

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

// One player's development from his (centered) work ethic z and his aging curve delta
export const traitDevelopment = ({
	workEthicZ: z,
	age,
	agingDelta,
}: {
	workEthicZ: number;
	age: number;
	agingDelta: number;
}): TraitDevelopment => {
	const A = DEVELOPMENT_AMPLITUDES;
	const growth =
		age <= WORK_ETHIC_YOUNG_MAX_AGE
			? A.workEthicGrowthYoung
			: A.workEthicGrowthOld;
	return {
		baseChangeDelta: growth * z + agingDelta,
		dropScale: clamp(1 - A.workEthicDropScale * z, 0.5, 1.5),
	};
};

/**
 * Center a league's development plans so the league as a whole does not develop faster or slower (no rating inflation): the mean work ethic
 * z and the mean aging delta of the players developing this preseason are subtracted. Input: pid -> raw values. Output: pid -> plan.
 */
export const centerDevelopment = (
	rows: { pid: number; age: number; workEthicZ: number; agingDelta: number }[],
) => {
	const output = new Map<number, TraitDevelopment>();
	if (rows.length === 0) {
		return output;
	}
	let zMean = 0;
	let agingMean = 0;
	for (const row of rows) {
		zMean += row.workEthicZ;
		agingMean += row.agingDelta;
	}
	zMean /= rows.length;
	agingMean /= rows.length;
	for (const row of rows) {
		output.set(
			row.pid,
			traitDevelopment({
				workEthicZ: row.workEthicZ - zMean,
				age: row.age,
				agingDelta: row.agingDelta - agingMean,
			}),
		);
	}
	return output;
};
