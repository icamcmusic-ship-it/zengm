import limitRating from "./limitRating.ts";
import type { PlayerWithoutKey } from "../../../common/types.ts";
import { RATINGS } from "../../../common/constants.ts";
import { randInt } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";

// A boost (the special prospects of a draft class) or a penalty (scrubs) to every skill rating. Never to height: the hgt rating stands for
// his listed height (and wingspan), which a bonus doesn't change. The amount for hgt is still drawn, so the random stream is unchanged.
const bonus = (p: PlayerWithoutKey, amount?: number) => {
	const ratings = last(p.ratings) as any;

	for (const key of RATINGS) {
		const boost = amount ?? randInt(0, 10);
		if (key === "hgt") {
			continue;
		}
		ratings[key] = limitRating(ratings[key] + boost);
	}
};

export default bonus;
