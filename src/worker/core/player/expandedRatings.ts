// Worker side of expanded ratings (the expandedRatings setting; shared parts in common/expandedRatings.ts). Nothing here draws a random
// number or changes anything while the setting is off.

import { realGauss, uniform } from "../../../common/random.ts";
import {
	blendDiq,
	fillExpandedRatings,
	hasExpandedRatings,
	insertExpandedRatingKeys,
} from "../../../common/expandedRatings.ts";
import { expandedRatingsOn } from "./expandedRatingsSwitch.ts";

export { expandedRatingsOn };

// Whether these ratings should be read with the expanded formulas
export const expandedRatingsApply = (r: Record<string, any>) =>
	expandedRatingsOn() && hasExpandedRatings(r);

const limit = (x: number) => (x > 100 ? 100 : x < 0 ? 0 : Math.round(x));

// Set pdef/idef to a split (pdef - idef) around the row's diq, keeping diq their average (except when a rating hits 0 or 100, then diq
// follows the clamped ratings)
export const setDefenseSplit = (r: Record<string, any>, split: number) => {
	const diq = r.diq as number;
	let pdef = limit(diq + Math.round(split / 2));
	const idef = limit(2 * diq - pdef);
	if (2 * diq - pdef !== idef) {
		// idef was clamped, move the rest back to pdef
		pdef = limit(2 * diq - idef);
	}
	r.pdef = pdef;
	r.idef = idef;
	const blended = blendDiq(pdef, idef);
	if (blended !== diq) {
		r.diq = blended;
	}
};

// After something changed diq directly (development, real player determinism, a God Mode edit of diq), move pdef and idef with it
// With the setting off nothing is touched (stale values left from when it was on can't move diq at the 0/100 clamps), and turning it
// back on syncs them (updateExpandedRatingsForLeague).
export const syncDefenseToDiq = (r: Record<string, any>) => {
	if (
		!expandedRatingsOn() ||
		typeof r.pdef !== "number" ||
		typeof r.idef !== "number"
	) {
		return;
	}
	if (blendDiq(r.pdef, r.idef) !== r.diq) {
		setDefenseSplit(r, r.pdef - r.idef);
	}
};

// How much more interior than perimeter defense a player keeps as he ages (per season, before noise): perimeter defense is legs,
// interior defense is size and positioning. Applied symmetrically, so diq (their average) ages exactly like before.
const splitAging = (age: number) => {
	if (age <= 27) {
		return 0;
	}
	if (age <= 29) {
		return 1;
	}
	if (age <= 31) {
		return 1.5;
	}
	return 2;
};

// One season of development of the expanded ratings, run after the stock ratings developed (diq included, so pdef/idef follow diq's
// change and only their split moves here)
export const developExpandedRatings = (
	r: Record<string, any>,
	age: number,
	hgtBefore: number,
) => {
	// Wingspan: fixed, except it grows with height, and a little more in some teenagers
	let wng = r.wng + (r.hgt - hgtBefore);
	if (age <= 20 && Math.random() < 0.15) {
		wng += 1;
	}
	r.wng = limit(wng);

	const shift =
		splitAging(age) * uniform(0.4, 1.4) +
		Math.min(2.5, Math.max(-2.5, realGauss(0, 1)));
	setDefenseSplit(r, r.pdef - r.idef - 2 * Math.round(shift));
};

// Fill in missing expanded ratings (all rows) of a player, if the setting is on. Returns true if something changed.
export const ensureExpandedRatings = (p: {
	pid?: number;
	firstName?: string;
	lastName?: string;
	born?: { year: number };
	srID?: string;
	ratings: any[];
}) => {
	if (!expandedRatingsOn()) {
		return false;
	}
	return fillExpandedRatings(p);
};

// The rating keys of a ratings table: the sport's RATINGS, plus the expanded ones when the setting is on
export const ratingsKeysForView = <T extends string>(keys: readonly T[]) =>
	(expandedRatingsOn() ? insertExpandedRatingKeys(keys) : keys) as T[];
