import { defineView } from "../util/defineView.ts";
import { getCommon } from "./player.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import { getPlayerScoutingPage } from "../core/scoutingReports/index.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { getProspectRooms } from "../core/scoutingReports/room.ts";

const processInputs = (params: RouteParams<"playerScouting">) => {
	return {
		pid: params.pid !== undefined ? Number.parseInt(params.pid) : undefined,
		scout:
			params.scout !== undefined ? Number.parseInt(params.scout) : undefined,
	};
};

// The player's Scouting page (Scouting Reports setting): the full report from the user's scouting department, written only from what
// the scouts can see
export default defineView({
	id: "playerScouting",
	processInputs,
	load: async ({ inputs: { pid, scout } }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "Scouting reports are only in Basketball GM." };
		}
		const off = featureOffError("scoutingReports");
		if (off) {
			return off;
		}
		const topStuff = await getCommon(pid, undefined, "player_scouting");
		if (topStuff.type === "error") {
			return { errorMessage: topStuff.errorMessage };
		}
		const scouting = await getPlayerScoutingPage(topStuff.pRaw.pid, scout);
		if (!scouting) {
			return { errorMessage: "Player not found." };
		}
		// Scout Consensus & Flags (prospects): each scout's grade, the consensus and spread, and the flags
		const room = (await getProspectRooms([topStuff.pRaw])).get(
			topStuff.pRaw.pid,
		);
		// The raw player stays in the worker
		const { pRaw: _pRaw, ...topStuffForUI } = topStuff;
		return {
			...topStuffForUI,
			scouting,
			room,
			scout,
		};
	},
});
