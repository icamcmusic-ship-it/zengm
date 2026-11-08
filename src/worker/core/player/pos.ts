import posBaseball from "./pos.baseball.ts";
import posBasketball from "./pos.basketball.ts";
import posFootball from "./pos.football.ts";
import posHockey from "./pos.hockey.ts";
import type { MinimalPlayerRatings } from "../../../common/types.ts";
import { bySport } from "../../../common/sportFunctions.ts";

// previous: the position he has now, which basketball's improved positions stick to (ignored elsewhere)
const pos = (ratings: MinimalPlayerRatings, previous?: string) => {
	return bySport<(ratings: any, previous?: string) => string>({
		baseball: posBaseball,
		basketball: posBasketball,
		football: posFootball,
		hockey: posHockey,
	})(ratings, previous);
};

export default pos;
