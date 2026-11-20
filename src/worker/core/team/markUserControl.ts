import { idb } from "../../db/index.ts";
import { g, local } from "../../util/index.ts";

/**
 * Record who runs the user's teams this season (TeamSeason.userControl), for GM History and Executive of the Year: called when the
 * regular season and the playoffs start. A season counts as the user's if he ran the team himself at either point, so one he only
 * spent in spectator mode or auto play doesn't
 */
const markUserControl = async () => {
	const auto = !!local.autoPlayUntil || g.get("spectator");
	const season = g.get("season");
	for (const tid of g.get("userTids")) {
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			season,
			tid,
		]);
		if (!ts || ts.userControl === "user") {
			continue;
		}
		const value = auto ? "auto" : "user";
		if (ts.userControl !== value) {
			ts.userControl = value;
			await idb.cache.teamSeasons.put(ts);
		}
	}
};

export default markUserControl;
