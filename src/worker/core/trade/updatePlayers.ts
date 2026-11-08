import { idb } from "../../db/index.ts";
import type { TradeTeams } from "../../../common/types.ts";
import isUntradable from "./isUntradable.ts";
import { validatePickConditionSpec } from "../../../common/draftPickConditions.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { getNumPicksPerRound } from "./getPickValues.ts";

/**
 * Validates that players are allowed to be traded and updates the database.
 *
 * If any of the player IDs submitted do not correspond with the two teams that are trading, they will be ignored.
 *
 * @memberOf core.trade
 * @param {Array.<Object>} teams Array of objects containing the assets for the two teams in the trade. The first object is for the user's team and the second is for the other team. Values in the objects are tid (team ID), pids (player IDs) and dpids (draft pick IDs).
 * @return {Promise.<Array.<Object>>} Resolves to an array taht's the same as the input, but with invalid entries removed.
 */
const updatePlayers = async (teams: TradeTeams): Promise<TradeTeams> => {
	// UI actions that only toggle assets don't send pickConditions, so keep the ones already in the trade
	const prevTrade = await idb.cache.trade.get(0);
	// Make sure each entry in teams has pids and dpids that actually correspond to the correct tid
	for (const t of teams) {
		// TEMP DISABLE WITH ESLINT 9 UPGRADE eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (!t.dpidsExcluded) {
			t.dpidsExcluded = [];
		}
		// TEMP DISABLE WITH ESLINT 9 UPGRADE eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
		if (!t.pidsExcluded) {
			t.pidsExcluded = [];
		}

		// Check players
		const players = await idb.cache.players.indexGetAll("playersByTid", t.tid);
		const pidsGood: number[] = [];
		const pidsExcludedGood: number[] = [];

		for (const p of players) {
			// Also, make sure player is not untradable
			if (!isUntradable(p).untradable) {
				if (t.pids.includes(p.pid)) {
					pidsGood.push(p.pid);
				}

				if (t.pidsExcluded.includes(p.pid)) {
					pidsExcludedGood.push(p.pid);
				}
			}
		}

		t.pids = pidsGood;
		t.pidsExcluded = pidsExcludedGood; // Check draft picks

		const draftPicks = await idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			t.tid,
		);
		const dpidsGood: number[] = [];
		const dpidsExcludedGood: number[] = [];

		for (const dp of draftPicks) {
			if (t.dpids.includes(dp.dpid)) {
				dpidsGood.push(dp.dpid);
			}

			if (t.dpidsExcluded.includes(dp.dpid)) {
				dpidsExcludedGood.push(dp.dpid);
			}
		}

		t.dpids = dpidsGood;
		t.dpidsExcluded = dpidsExcludedGood;

		const conditions =
			t.pickConditions ??
			prevTrade?.teams.find((t2) => t2.tid === t.tid)?.pickConditions;
		const otherTid = teams.find((t2) => t2 !== t)?.tid;
		const otherPicks =
			otherTid !== undefined && conditions && conditions.length > 0
				? await idb.cache.draftPicks.indexGetAll("draftPicksByTid", otherTid)
				: [];
		const conditionsGood = (conditions ?? []).filter((c) => {
			const dp = draftPicks.find((dp) => dp.dpid === c.dpid);
			if (
				!featureOn("draftPickConditions") ||
				dp === undefined ||
				!t.dpids.includes(c.dpid) ||
				validatePickConditionSpec(c, dp, getNumPicksPerRound()) !== undefined
			) {
				return false;
			}
			if (c.type === "swap") {
				// The receiving team needs its own pick in the same draft and round to swap with
				return (
					dp.originalTid !== otherTid &&
					otherPicks.some(
						(dp2) =>
							dp2.originalTid === otherTid &&
							dp2.season === dp.season &&
							dp2.round === dp.round &&
							!dp2.swap,
					)
				);
			}
			return true;
		});
		if (conditionsGood.length > 0) {
			t.pickConditions = conditionsGood.map((c) => ({ ...c, tid: otherTid }));
		} else {
			delete t.pickConditions;
		}
	}

	await idb.cache.trade.put({
		rid: 0,
		teams,
	});
	return teams;
};

export default updatePlayers;
