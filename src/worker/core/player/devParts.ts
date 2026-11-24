// Development breakdown (basketball): what made up a player's ovr change in a season, stored on that season's ratings row as devParts, in
// ovr points. Filled by develop.ts (the preseason's year of development) and game/writePlayerStats.ts (injury losses during the season).
// See docs/native-features.md, Development breakdown.

import type { DevParts } from "../../../common/types.basketball.ts";
import type { DevPartsRatings } from "./developSeason.basketball.ts";
import { expandedRatingsApply } from "./expandedRatings.ts";
import { ovrRaw } from "./ovr.basketball.ts";

// Slope of the stock fudge factor (ovr.basketball.ts applyFudge): ovr points per raw point at this raw ovr
const fudgeSlope = (raw: number) => {
	if (raw >= 68) {
		return 1;
	}
	if (raw >= 50) {
		return 1 + 4 / 18;
	}
	if (raw >= 42) {
		return 1 + 9 / 8;
	}
	if (raw >= 31) {
		return 1 + 5 / 11;
	}
	return 1;
};

const num = (x: unknown) => (typeof x === "number" ? x : 0);

/**
 * Ovr points of a change of his base ratings (rating points by key), linearized at these ratings. Expanded ratings follow their compat
 * ratings like in development (pdef/idef follow diq, oreb/dreb follow reb, csh/dsh follow fg + tp, ball security follows handle, IQ and
 * passing).
 */
export const ovrPointsOf = (
	ratings: Record<string, any>,
	delta: Record<string, number>,
) => {
	const after: Record<string, any> = { ...ratings };
	for (const [key, d] of Object.entries(delta)) {
		if (typeof after[key] === "number") {
			after[key] += d;
		}
	}
	if (expandedRatingsApply(ratings)) {
		const follow = (key: string, d: number) => {
			if (typeof after[key] === "number") {
				after[key] += d;
			}
		};
		follow("pdef", num(delta.diq));
		follow("idef", num(delta.diq));
		follow("oreb", num(delta.reb));
		follow("dreb", num(delta.reb));
		const shoot = (num(delta.fg) + num(delta.tp)) / 2;
		follow("csh", shoot);
		follow("dsh", shoot);
		follow(
			"bsc",
			0.5 * num(delta.drb) + 0.3 * num(delta.oiq) + 0.2 * num(delta.pss),
		);
	}
	const raw = ovrRaw(ratings as any);
	return (ovrRaw(after as any) - raw) * fudgeSlope(raw);
};

/** Ovr points of a change from one row to another (mentor bonus), linearized at the first. */
export const ovrPointsBetween = (
	before: Record<string, any>,
	after: Record<string, any>,
) => {
	const raw = ovrRaw(before as any);
	return (ovrRaw(after as any) - raw) * fudgeSlope(raw);
};

export const emptyDevPartsRatings = (): DevPartsRatings => ({
	traits: {},
	coach: {},
	aging: {},
	minutes: {},
});

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * One season's breakdown: the parts in ovr points (rounded to 0.1, zero parts left out), base is the rest of his actual ovr change (age,
 * noise, his development rates, rounding and the limits).
 */
export const makeDevParts = ({
	before,
	parts,
	mentor,
	ovrChange,
}: {
	before: Record<string, any>;
	parts: DevPartsRatings;
	mentor: number;
	ovrChange: number;
}): DevParts => {
	const out: Omit<DevParts, "base"> = {};
	let sum = 0;
	const add = (key: Exclude<keyof DevParts, "base">, x: number) => {
		const v = round1(x);
		if (v !== 0) {
			out[key] = v;
			sum += v;
		}
	};
	add("coach", ovrPointsOf(before, parts.coach));
	add("traits", ovrPointsOf(before, parts.traits));
	add("mentor", mentor);
	add("aging", ovrPointsOf(before, parts.aging));
	add("minutes", ovrPointsOf(before, parts.minutes));
	return { base: round1(ovrChange - sum), ...out };
};

/** An injury's ovr loss (negative) added to the row's breakdown, if it has one (rows from before it have none). */
export const addInjuryToDevParts = (
	ratings: { devParts?: DevParts },
	ovrChange: number,
) => {
	if (!ratings.devParts || ovrChange === 0) {
		return;
	}
	ratings.devParts = {
		...ratings.devParts,
		injury: round1((ratings.devParts.injury ?? 0) + ovrChange),
	};
};
