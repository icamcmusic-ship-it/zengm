import {
	PLAY_KNOTS_MIN_MINUTES,
	playStatKnots,
	positionStats,
} from "../../../common/archetypes/position.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

// The league's quantiles of assist% + usage%/10 (improved positions, sgdrift: see playStatKnots in
// common/archetypes/position.ts), from the active players' regular seasons of `season` and the one before, as positions
// read them. Worked out once a season (the first time positions are assigned in it, normally in the preseason, when
// last season's stats are complete) and kept for the rest of it.
const cached = new Map<string, number[] | undefined>();

export const leaguePlayStatKnots = async (
	season: number,
): Promise<number[] | undefined> => {
	if (__SPORT !== "basketball" || !featureOn("improvedPositions")) {
		return undefined;
	}
	let key;
	try {
		key = `${g.get("lid")}|${season}`;
	} catch {
		return undefined;
	}
	if (cached.has(key)) {
		return cached.get(key);
	}
	let knots: number[] | undefined;
	try {
		const values: number[] = [];
		for (const p of await idb.cache.players.getAll()) {
			if (p.tid < -1) {
				continue;
			}
			const st = positionStats(p.stats, season);
			if (st && st.min >= PLAY_KNOTS_MIN_MINUTES) {
				values.push(st.astp + 0.1 * st.usgp);
			}
		}
		knots = playStatKnots(values);
	} catch {
		knots = undefined;
	}
	if (cached.size > 10) {
		cached.clear();
	}
	cached.set(key, knots);
	return knots;
};
