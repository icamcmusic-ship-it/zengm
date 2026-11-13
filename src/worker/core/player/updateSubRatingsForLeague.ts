import { PLAYER } from "../../../common/constants.ts";
import { isValidSubArray, subsMatchBases } from "../../../common/subRatings.ts";
import { idb } from "../../db/index.ts";
import { ensureSubs, subRatingsOn } from "./subRatings.ts";

// Sub-ratings turned on in a league, or a league opened (or created from a file or real rosters) with the setting on: every player who
// isn't retired gets his sub-ratings filled in once from his ratings (a neutral shape plus a lean from his size and physicals, seeded by
// his pid; draft prospects of generated classes get their generated shape), and rows whose bases changed while the setting was off are
// brought back in sync, keeping their shape. Bases are never changed. Retired players are left alone (their pages show bases only).
// Returns the number of players changed.
const updateSubRatingsForLeague = async () => {
	if (__SPORT !== "basketball" || !subRatingsOn()) {
		return 0;
	}
	const players = await idb.cache.players.getAll();
	let n = 0;
	for (const p of players) {
		if (p.tid === PLAYER.RETIRED) {
			continue;
		}
		if (ensureSubs(p as any)) {
			n += 1;
			await idb.cache.players.put(p);
		}
	}
	return n;
};

// Whether any player who isn't retired is missing his sub-ratings or has them out of sync (cheap check before the update)
export const subRatingsNeedUpdate = async () => {
	if (__SPORT !== "basketball" || !subRatingsOn()) {
		return false;
	}
	const players = await idb.cache.players.getAll();
	return players.some((p) => {
		if (p.tid === PLAYER.RETIRED) {
			return false;
		}
		const r = p.ratings.at(-1) as any;
		return !p.subP || !isValidSubArray(r.sub) || !subsMatchBases(r);
	});
};

export default updateSubRatingsForLeague;
