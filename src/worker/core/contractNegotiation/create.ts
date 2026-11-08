import { PHASE, PLAYER } from "../../../common/constants.ts";
import { player } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, lock } from "../../util/index.ts";
import type { Negotiation } from "../../../common/types.ts";
import { getCurrentContract } from "../../../common/contracts.ts";
import {
	getExtensionDemand,
	getExtensionIneligibleReason,
} from "../contract/extension.ts";

/**
 * Start a new contract negotiation with a player.
 *
 * @memberOf core.contractNegotiation
 * @param {number} pid An integer that must correspond with the player ID of a free agent.
 * @param {boolean} resigning Set to true if this is a negotiation for a contract extension, which will allow multiple simultaneous negotiations. Set to false otherwise.
 * @param {number=} tid Team ID the contract negotiation is with. This only matters for Multi Team Mode. If undefined, defaults to g.get("userTid").
 * @return {Promise.<string=>)} If an error occurs, resolve to a string error message.
 */
const create = async (
	pid: number,
	resigning: boolean,
	tid: number = g.get("userTid"),
): Promise<string | Negotiation> => {
	if (
		g.get("phase") > PHASE.AFTER_TRADE_DEADLINE &&
		g.get("phase") <= PHASE.RESIGN_PLAYERS &&
		!resigning
	) {
		return "You're not allowed to sign free agents now.";
	}

	if (lock.get("gameSim")) {
		return "You cannot initiate a new negotiaion while game simulation is in progress.";
	}

	if (g.get("phase") < 0) {
		return "You're not allowed to sign free agents now.";
	}

	const p = await idb.cache.players.get(pid);
	if (!p) {
		throw new Error("Invalid pid");
	}

	// Extension for a player under contract with this team
	if (p.tid === tid && tid >= 0 && !resigning) {
		const reason = getExtensionIneligibleReason(p, tid);
		if (reason !== undefined) {
			return reason;
		}
		const contract = getCurrentContract(p)!;
		const extension = getExtensionDemand(p, contract);
		const moodInfo = await player.moodInfo(p, tid, {
			contractAmount: extension.amount,
		});
		if (!moodInfo.willing) {
			return `<a href="${helpers.leagueUrl(["player", p.pid])}">${
				p.firstName
			} ${p.lastName}</a> doesn't want to talk about an extension right now.`;
		}
		return {
			pid,
			tid,
			resigning: false,
			extension,
		};
	}

	if (p.tid !== PLAYER.FREE_AGENT) {
		return `${p.firstName} ${p.lastName} is not a free agent.`;
	}

	if (!resigning) {
		const moodInfo = await player.moodInfo(p, tid);
		if (!moodInfo.willing) {
			return `<a href="${helpers.leagueUrl(["player", p.pid])}">${
				p.firstName
			} ${p.lastName}</a> refuses to sign with you, no matter what you offer.`;
		}
	}

	const negotiation: Negotiation = {
		pid,
		tid,
		resigning,
	};

	return negotiation;
};

export default create;
