// Injury types by position and body type (basketball, with Injury Depth): when a player gets hurt, the injury type is drawn with the
// frequencies reweighted for his size and position. Bigs (tall, heavy for their height, centers) get more foot, knee and back injuries,
// guards (small, light, point guards) more ankle sprains and hamstring strains.
//
// Each injury's weight is frequency × (1 + slope × size), where size is about 0 for an average player (-1.5 to 1.5) and the slopes are
// centered so that sum(frequency × slope) = 0. So the total weight is the same for every player (each player's draw is a plain
// reweighting) and each type's share is linear in size: over a league whose average size is 0, the shares of every injury type, and the
// mean length of an injury, are the same as without this. How often players get hurt isn't touched (that's the game sim's injury rate).
// Same one random number per draw as before.

import { injuryBodyPart } from "../../../common/injuryBodyPart.ts";
import type { InjuriesSetting } from "../../../common/types.ts";
import { g, helpers } from "../../util/index.ts";
import { BASKETBALL_WEIGHT } from "./genWeight.ts";

// Positive: more often for bigs. By body part, with a few injuries named apart
const BODY_PART_SLOPES: Record<string, number> = {
	Foot: 0.35,
	Knee: 0.2,
	Back: 0.25,
	"Hip/Groin": 0.05,
	Hand: 0.05,
	Ankle: -0.2,
	Leg: -0.1,
};
const NAME_SLOPES: [RegExp, number][] = [
	[/\bhamstring\b/i, -0.3],
	[/\bplantar\b/i, 0.4],
	[/\bachilles\b/i, 0],
];

// Position, from guard (-1) to center (1)
const POSITION_SIZE: Record<string, number> = {
	PG: -1,
	G: -0.75,
	SG: -0.5,
	GF: -0.25,
	SF: 0,
	F: 0.25,
	PF: 0.5,
	FC: 0.75,
	C: 1,
};

// Height sd in inches, and the spread of weight around the weight for his height (BASKETBALL_WEIGHT's noise)
const HEIGHT_SD = 3.3;

export const MAX_SIZE = 1.5;

// About 0 for an average player, positive for bigs. Height and weight are converted back from the league's height and weight factors
// (and the women's league ratios), so it's relative to the players he plays with
export const getInjurySize = (p: {
	hgt: number;
	weight: number;
	pos: string | undefined;
}) => {
	const female = g.get("gender") === "female";
	const heightScale = (g.get("heightFactor") ?? 1) * (female ? 0.92 : 1);
	const weightScale = (g.get("weightFactor") ?? 1) * (female ? 0.75 : 1);
	const W = BASKETBALL_WEIGHT;

	let size = 0.4 * (POSITION_SIZE[p.pos ?? ""] ?? 0);
	if (p.hgt > 0 && heightScale > 0) {
		const inches = p.hgt / heightScale;
		size += (0.4 * (inches - W.refHeight)) / HEIGHT_SD;
		if (p.weight > 0 && weightScale > 0) {
			// Heavy for his height
			const expected = W.intercept + W.perInch * (inches - W.refHeight);
			size += (0.2 * (p.weight / weightScale - expected)) / W.noise;
		}
	}
	return helpers.bound(size, -MAX_SIZE, MAX_SIZE);
};

const rawSlope = (name: string) => {
	for (const [regex, slope] of NAME_SLOPES) {
		if (regex.test(name)) {
			return slope;
		}
	}
	return BODY_PART_SLOPES[injuryBodyPart(name)] ?? 0;
};

// Centered so that sum(frequency × slope) = 0 for this list, and kept small enough that no weight goes below 0 at MAX_SIZE
export const getInjurySlopes = (injuries: InjuriesSetting) => {
	const raw = injuries.map((row) => rawSlope(row.name));
	let total = 0;
	let weighted = 0;
	for (const [i, row] of injuries.entries()) {
		const frequency = Math.max(0, row.frequency);
		total += frequency;
		weighted += frequency * raw[i]!;
	}
	const mean = total > 0 ? weighted / total : 0;
	let slopes = raw.map((slope) => slope - mean);
	const maxAbs = Math.max(0, ...slopes.map((slope) => Math.abs(slope)));
	const limit = 0.9 / MAX_SIZE;
	if (maxAbs > limit) {
		// Scaling keeps the sum at 0
		slopes = slopes.map((slope) => (slope * limit) / maxAbs);
	}
	return slopes;
};

// Cumulative weights for a player of this size. The last one equals the plain frequencies' sum (to rounding)
export const getWeightedCumSums = (
	injuries: InjuriesSetting,
	slopes: number[],
	size: number,
) => {
	const sums: number[] = [];
	for (const [i, row] of injuries.entries()) {
		sums[i] = row.frequency * (1 + slopes[i]! * size);
		if (i > 0) {
			sums[i] += sums[i - 1]!;
		}
	}
	return sums;
};
