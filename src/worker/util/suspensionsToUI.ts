import { idb } from "../db/index.ts";
import g from "./g.ts";
import toUI from "./toUI.ts";
import { isSuspended } from "../core/player/techDiscipline.ts";
import type { LocalStateUI } from "../../common/types.ts";

// League discipline (technicalFouls setting): the games left on each active suspension, by pid, for the "SUS" marker next to player
// names (components/SuspensionIcon.tsx). Sent on league load and after every day of games, from the cache (no extra db reads)
export const getSuspensions = async () => {
	const suspensions: LocalStateUI["suspensions"] = {};
	if (!g.get("technicalFouls")) {
		return suspensions;
	}
	const season = g.get("season");
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	for (const p of players) {
		if (isSuspended(p, season)) {
			suspensions[p.pid] = p.discipline!.suspension!;
		}
	}
	return suspensions;
};

export const suspensionsToUI = async () => {
	await toUI("updateLocal", [{ suspensions: await getSuspensions() }]);
};
