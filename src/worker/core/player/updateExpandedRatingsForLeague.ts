import { fillExpandedRatings } from "../../../common/expandedRatings.ts";
import { PLAYER } from "../../../common/constants.ts";
import { idb } from "../../db/index.ts";
import { helpers } from "../../util/index.ts";
import ovr from "./ovr.ts";
import skills from "./skills.ts";
import updateValues from "./updateValues.ts";
import { expandedRatingsOn, syncExpandedToCompat } from "./expandedRatings.ts";

// The setting was turned on or off in a league: fill in the new ratings (on) and recompute the current ovr, pot and skills of every
// player who isn't retired (ovr reads wingspan and the skills read the new composites when on). Retired players' old rows are derived
// when they're displayed.
const updateExpandedRatingsForLeague = async () => {
	if (__SPORT !== "basketball") {
		return;
	}
	const on = expandedRatingsOn();
	const players = await idb.cache.players.getAll();
	for (const p of players) {
		if (p.tid === PLAYER.RETIRED) {
			continue;
		}
		const r = p.ratings.at(-1)! as any;
		if (on) {
			fillExpandedRatings(p);
			// Turned back on after a spell off: the rows kept the old perimeter/interior defense while diq developed on its own, so move
			// them to his current diq (keeping his split), or the sim would use stale defense ratings
			syncExpandedToCompat(r);
		}
		if (!r.locked) {
			const oldOvr = r.ovr;
			r.ovr = ovr(r);
			r.pot = helpers.bound(r.pot + (r.ovr - oldOvr), r.ovr, 100);
		}
		r.skills = skills(r);
		if (p.tid === PLAYER.UNDRAFTED) {
			p.draft.ovr = r.ovr;
			p.draft.pot = r.pot;
			p.draft.skills = r.skills;
		}
		await updateValues(p);
		await idb.cache.players.put(p);
	}
};

export default updateExpandedRatingsForLeague;
