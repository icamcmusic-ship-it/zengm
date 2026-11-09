import { positionOf } from "../../../common/archetypes/position.ts";
import type { PlayerRatings } from "../../../common/types.basketball.ts";

// Assign a position (PG, SG, SF, PF, C, G, GF, FC) based on ratings. See analysis/pos-basketball. The formula lives in
// common/archetypes/position.ts so archetypes read positions the same way.
const pos = (ratings: PlayerRatings): string => positionOf(ratings);

export default pos;
