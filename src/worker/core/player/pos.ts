import posBaseball from "./pos.baseball.ts";
import posBasketball from "./pos.basketball.ts";
import posFootball from "./pos.football.ts";
import posHockey from "./pos.hockey.ts";
import type { MinimalPlayerRatings } from "../../../common/types.ts";
import type { PositionContext } from "../../../common/archetypes/position.ts";
import { bySport } from "../../../common/sportFunctions.ts";

// previous: the position he has now, which basketball's improved positions stick to; context: his stats and last season's
// ratings, which they also read (both ignored elsewhere)
const pos = (
	ratings: MinimalPlayerRatings,
	previous?: string,
	context?: PositionContext,
) => {
	return bySport<
		(ratings: any, previous?: string, context?: PositionContext) => string
	>({
		baseball: posBaseball,
		basketball: posBasketball,
		football: posFootball,
		hockey: posHockey,
	})(ratings, previous, context);
};

export default pos;
