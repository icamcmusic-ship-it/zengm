import { player, team } from "../index.ts";
import cancel from "./cancel.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, toUI } from "../../util/index.ts";
import type { Negotiation, FlatContractInfo } from "../../../common/types.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { actualPhase } from "../../util/actualPhase.ts";
import { getContractDemand } from "../contract/index.ts";
import type { ContractTerms } from "../../../common/types.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import {
	extendContract,
	getExtensionIneligibleReason,
} from "../contract/extension.ts";

const acceptExtension = async ({
	negotiation,
	amount,
	exp,
	dryRun,
	terms,
}: {
	negotiation: Negotiation;
	amount: number;
	exp: number;
	dryRun: boolean;
	terms?: ContractTerms;
}): Promise<string | undefined | (() => Promise<boolean>)> => {
	const tid = g.get("userTid");
	const p = await idb.cache.players.get(negotiation.pid);
	if (!p) {
		return "Invalid pid";
	}
	const reason = getExtensionIneligibleReason(p, tid);
	if (reason !== undefined) {
		return reason;
	}
	const contract = getCurrentContract(p)!;
	const firstSeason = getContractExp(contract) + 1;
	if (exp < firstSeason) {
		return "An extension must add at least one season.";
	}

	const mood = await player.moodInfo(p, tid, { contractAmount: amount });
	if (!mood.willing) {
		return "Player is no longer willing to negotiate.";
	}

	// With a hard cap, the extension has to fit under the cap in its first season. With a soft cap, teams can always extend their own players, like re-signing them.
	if (g.get("salaryCapType") === "hard") {
		const payroll = await team.getPayroll(tid, firstSeason);
		if (
			payroll + amount - 1 > g.get("salaryCap") &&
			amount - 1 > g.get("minContract")
		) {
			return "This extension would put you over the hard cap in its first season.";
		}
	}

	if (dryRun) {
		return;
	}

	const rollbackInfo = {
		contracts: helpers.deepCopy(p.contracts),
		holdout: p.holdout,
		tradeRequest: p.tradeRequest,
	};
	const eid = await extendContract(p, { amount, exp, terms });
	await idb.cache.players.put(p);

	return async () => {
		const p = await idb.cache.players.get(negotiation.pid);
		if (!p || p.tid !== tid) {
			return false;
		}
		Object.assign(p, rollbackInfo);
		if (!p.holdout) {
			delete p.holdout;
		}
		if (!p.tradeRequest) {
			delete p.tradeRequest;
		}
		await idb.cache.players.put(p);
		await idb.cache.events.delete(eid);
		void toUI("realtimeUpdate", [["playerMovement"]]);
		return true;
	};
};

/**
 * Accept the player's offer.
 *
 * If successful, then the team's current roster will be displayed.
 *
 * @memberOf core.contractNegotiation
 * @param {number} pid An integer that must correspond with the player ID of a player in an ongoing negotiation.
 * @return {Promise.<string=>} If an error occurs, resolves to a string error message.
 */
const accept = async <
	DryRun extends boolean,
	SuccessReturn extends (DryRun extends true ? void : () => Promise<boolean>),
>({
	negotiation,
	amount,
	exp,
	dryRun,
	terms,
}: {
	negotiation: Negotiation;
	amount: number;
	exp: number;
	dryRun: DryRun;
	terms?: ContractTerms;
}) => {
	const salaryCapType = g.get("salaryCapType");
	const tid = g.get("userTid");

	if (negotiation.extension) {
		return acceptExtension({
			negotiation,
			amount,
			exp,
			dryRun,
			terms,
		}) as Promise<SuccessReturn | string>;
	}

	if (salaryCapType !== "none") {
		const payroll = await team.getPayroll(tid);
		const birdException = negotiation.resigning && salaryCapType === "soft";

		// If this contract brings team over the salary cap, it's not a minimum contract, and it's not re-signing a current
		// player with the Bird exception, ERROR!
		if (
			!birdException &&
			payroll + amount - 1 > g.get("salaryCap") &&
			amount - 1 > g.get("minContract")
		) {
			return `You cannot go over the salary cap to sign ${
				salaryCapType === "hard" ? "players" : "free agents"
			} to contracts higher than the minimum salary.`;
		}
	}

	// This error is for sanity checking in multi team mode. Need to check for existence of negotiation.tid because it
	// wasn't there originally and I didn't write upgrade code. Can safely get rid of it later.
	if (negotiation.tid !== undefined && negotiation.tid !== tid) {
		return `This negotiation was started by the ${
			g.get("teamInfoCache")[negotiation.tid]?.region
		} ${g.get("teamInfoCache")[negotiation.tid]?.name} but you are the ${
			g.get("teamInfoCache")[tid]?.region
		} ${
			g.get("teamInfoCache")[tid]?.name
		}. Either switch teams or cancel this negotiation.`;
	}

	const p = await idb.cache.players.get(negotiation.pid);
	if (!p) {
		return "Invalid pid";
	}

	// Make sure the user didn't do something in another tab to change the willingness to negotiate, such as trading away players
	const mood = await player.moodInfo(p, tid);
	if (!mood.willing) {
		return "Player is no longer willing to negotiate.";
	}

	const phase = actualPhase();

	const contract: FlatContractInfo = {
		amount,
		exp,
	};
	if (terms && g.get("contractOptions")) {
		contract.terms = terms;
	}
	if (getContractDemand(p).rookie && phase === PHASE.RESIGN_PLAYERS) {
		// Not sure if the phase condition is necessary. The purpose of this is for hard cap rookies with rookie contract scale.
		contract.rookie = true;
	}

	if (!dryRun) {
		const rollbackInfo = {
			numDaysFreeAgent: p.numDaysFreeAgent,
			numPlayersTradedAwayNormalized: helpers.deepCopy(
				p.numPlayersTradedAwayNormalized,
			),
			jerseyNumber: p.jerseyNumber,
			contractDemand: helpers.deepCopy(p.contractDemand),
			contracts: [...p.contracts],
			transactions: helpers.deepCopy(p.transactions),
		};

		const eid = await player.sign(p, tid, contract, phase);
		await idb.cache.players.put(p);
		await cancel(negotiation.pid);

		// Rollback
		return (async () => {
			const p = await idb.cache.players.get(negotiation.pid);
			if (!p) {
				return false;
			}

			if (p.tid !== tid) {
				return false;
			}

			Object.assign(p, rollbackInfo);
			p.tid = PLAYER.FREE_AGENT;

			if (phase === PHASE.RESIGN_PLAYERS) {
				await idb.cache.negotiations.add({
					pid: p.pid,
					tid,
					resigning: true,
				});
			}

			await idb.cache.players.put(p);
			await idb.cache.events.delete(eid);

			void toUI("realtimeUpdate", [["playerMovement"]]);

			return true;
		}) as SuccessReturn;
	}

	return undefined as SuccessReturn;
};

export default accept;
