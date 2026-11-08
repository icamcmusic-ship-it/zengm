import { positionFor } from "../../../common/archetypes/position.ts";
import type { PlayerRatings } from "../../../common/types.basketball.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

// Assign a position (PG, SG, SF, PF, C, G, GF, FC) based on ratings. See analysis/pos-basketball. The formulas live in
// common/archetypes/position.ts so archetypes read positions the same way. With "Improved positions" on, the two-axis
// model is used, and `previous` (his current position) is kept unless another one fits clearly better.
const pos = (ratings: PlayerRatings, previous?: string): string =>
	positionFor(ratings, featureOn("improvedPositions"), previous);

export default pos;
