import {
	positionFor,
	type PositionContext,
} from "../../../common/archetypes/position.ts";
import type { PlayerRatings } from "../../../common/types.basketball.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

// Assign a position (PG, SG, SF, PF, C, G, GF, FC) based on ratings. See analysis/pos-basketball. The formulas live in
// common/archetypes/position.ts so archetypes read positions the same way. With "Improved positions" on, the size band /
// role model is used (reading his assist and usage rates from `context.stats` when he has minutes), and `previous` (his
// current position) is kept unless another one fits clearly better, this season and over two seasons
// (`context.previousRatings`).
const pos = (
	ratings: PlayerRatings,
	previous?: string,
	context?: PositionContext,
): string =>
	positionFor(ratings, featureOn("improvedPositions"), previous, context);

export default pos;
