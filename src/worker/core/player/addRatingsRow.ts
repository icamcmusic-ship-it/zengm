import genFuzz from "./genFuzz.ts";
import { g } from "../../util/index.ts";
import type {
	MinimalPlayerRatings,
	PlayerWithoutKey,
} from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";

const addRatingsRow = (
	p: PlayerWithoutKey,
	scoutingLevel?: number,
	injuryIndex?: number,
) => {
	const newRatings: MinimalPlayerRatings = {
		...last(p.ratings),
		season: g.get("season"),
		injuryIndex: undefined,
	};

	if (scoutingLevel !== undefined) {
		newRatings.fuzz = (newRatings.fuzz + genFuzz(scoutingLevel)) / 2;
	}

	if (injuryIndex !== undefined) {
		newRatings.injuryIndex = injuryIndex;
	} else {
		// Development breakdown: a new season's row gets its own (develop), an injury's row keeps the season's
		delete (newRatings as { devParts?: unknown }).devParts;
	}

	p.ratings.push(newRatings);
};

export default addRatingsRow;
