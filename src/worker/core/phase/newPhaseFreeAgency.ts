import { contractNegotiation, freeAgents, player } from "../index.ts";
import { helpers } from "../../util/index.ts";
import type { Conditions, PhaseReturn } from "../../../common/types.ts";
import * as college from "../college/index.ts";
import { idb } from "../../db/index.ts";
import { PLAYER } from "../../../common/constants.ts";
import { getNumPlayersTradedAwayNormalizedAll } from "../player/getNumPlayersTradedAwayNormalized.ts";

const newPhaseFreeAgency = async (
	conditions: Conditions,
): Promise<PhaseReturn> => {
	// College mode: this phase is signing day
	if (college.isCollege()) {
		return college.newPhaseSigningDay(conditions);
	}

	// In case some weird situation results in games still in the schedule, clear them
	await idb.cache.schedule.clear();

	// Delete all current negotiations to resign players
	await contractNegotiation.cancelAll();

	await freeAgents.ensureEnoughPlayers();

	await freeAgents.normalizeContractDemands({ type: "freeAgentsOnly" });

	// For any players who were free agents last year too, reset numPlayersTradedAwayNormalized
	const numPlayersTradedAwayNormalized =
		await getNumPlayersTradedAwayNormalizedAll();
	const players = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT)
	).filter((p) => p.yearsFreeAgent > 0);
	for (const p of players) {
		player.addToFreeAgents(p, numPlayersTradedAwayNormalized);
	}
	await idb.cache.players.putAll(players);

	return {
		redirect: {
			url: helpers.leagueUrl(["free_agents"]),
			text: "View free agents",
		},
		updateEvents: ["playerMovement"],
	};
};

export default newPhaseFreeAgency;
