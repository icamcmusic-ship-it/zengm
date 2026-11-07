import type { Formulas } from "../../../common/ratingsBuilds/index.ts";
import heightToRating from "./heightToRating.ts";
import ovr from "./ovr.ts";
import pos from "./pos.ts";
import { potEstimatorBasketballWithoutNoise } from "./potEstimator.ts";
import skills from "./skills.ts";
import type { MinimalPlayerRatings } from "../../../common/types.ts";

// The game's own player.ovr / pos / skills / heightToRating / pot estimator, handed to the (pure) ratings build engine so
// every overall it solves is checked against the real formula
export const ratingsBuildFormulas: Formulas = {
	ovr: (ratings) => ovr(ratings as unknown as MinimalPlayerRatings),
	pos: (ratings) => pos(ratings as unknown as MinimalPlayerRatings),
	skills: (ratings) => skills(ratings as unknown as MinimalPlayerRatings),
	heightToRating,
	potEstimate: (o, age) => potEstimatorBasketballWithoutNoise(o, age),
};
