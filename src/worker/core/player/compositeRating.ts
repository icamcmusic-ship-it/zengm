import { applyFuzz, getFuzz } from "./fuzzRating.ts";
import type { MinimalPlayerRatings } from "../../../common/types.ts";
import { weightedComposite } from "../../../common/compositeMath.ts";

const compositeRating = (
	ratings: MinimalPlayerRatings,
	components: (string | number)[],
	weights: number[] | undefined,
	fuzz: boolean,
): number => {
	// Only compute this once, rather than for every component
	const fuzzValue = fuzz ? getFuzz(ratings.fuzz) : 0;

	return weightedComposite(components, weights, (component) => {
		// @ts-expect-error
		const rating: number | undefined = ratings[component];

		if (rating === undefined) {
			throw new Error(`Undefined value for rating "${component}"`);
		}

		if (fuzz) {
			// Don't fuzz height (or wingspan, a measurement too)
			return component === "hgt" || component === "wng"
				? rating
				: applyFuzz(rating, fuzzValue);
		}
		return rating;
	});
};

export default compositeRating;
