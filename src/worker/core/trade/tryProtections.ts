import type { TradeTeams } from "../../../common/types.ts";
import {
	getTradePickConditions,
	validatePickConditionSpec,
} from "../../../common/draftPickConditions.ts";
import { idb } from "../../db/index.ts";
import { helpers } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import type { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import { getNumPicksPerRound } from "./getPickValues.ts";

const TOPS = [3, 5, 8, 10, 14];

// When the AI team (teams[1]) doesn't like a trade where it gives up 1st round picks, see if protecting those picks would make it work. Returns the trade with the smallest protection that works.
const tryProtections = async (
	teams: TradeTeams,
	valueChangeCalculator: ValueChangeCalculator,
): Promise<TradeTeams | undefined> => {
	if (!featureOn("draftPickConditions")) {
		return;
	}

	const numPicksPerRound = getNumPicksPerRound();
	const existing = new Set((teams[1].pickConditions ?? []).map((c) => c.dpid));
	const candidates = [];
	for (const dpid of teams[1].dpids) {
		const dp = await idb.cache.draftPicks.get(dpid);
		if (
			dp &&
			!existing.has(dpid) &&
			validatePickConditionSpec(
				{ type: "protection", top: 1, rollover: [], then: "unprotected" },
				dp,
				numPicksPerRound,
			) === undefined
		) {
			candidates.push(dpid);
		}
	}
	if (candidates.length === 0) {
		return;
	}

	for (const top of TOPS) {
		if (top >= numPicksPerRound / 2) {
			break;
		}
		const newTeams = helpers.deepCopy(teams);
		newTeams[1].pickConditions = [
			...(newTeams[1].pickConditions ?? []),
			...candidates.map((dpid) => ({
				type: "protection" as const,
				dpid,
				tid: teams[0].tid,
				top,
				rollover: [top],
				then: "unprotected" as const,
			})),
		];
		const dv = await valueChangeCalculator.evaluate({
			tid: newTeams[1].tid,
			pidsAdd: newTeams[0].pids,
			pidsRemove: newTeams[1].pids,
			dpidsAdd: newTeams[0].dpids,
			dpidsRemove: newTeams[1].dpids,
			tradingPartnerTid: newTeams[0].tid,
			pickConditions: getTradePickConditions(newTeams),
		});
		if (dv > 0) {
			return newTeams;
		}
	}
};

export default tryProtections;
