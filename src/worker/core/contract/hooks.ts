import { PHASE } from "../../../common/constants.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import type { Phase } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, local } from "../../util/index.ts";
import moodInfo from "../player/moodInfo.ts";
import getPayroll from "../team/getPayroll.ts";
import {
	extendContract,
	getExtensionDemand,
	getExtensionIneligibleReason,
} from "./extension.ts";
import { recordMoodSnapshots } from "./moodHistory.ts";
import { decideContractOptions, pickAiContractTerms } from "./options.ts";
import {
	endHoldouts,
	startHoldouts,
	updateHoldouts,
	updateTradeRequests,
} from "./unrest.ts";

// These never stop a phase change or a day of games, they just log the error
const safely = async (name: string, cb: () => Promise<void>) => {
	try {
		await cb();
	} catch (error) {
		console.error(`Error in contract hook ${name}`, error);
	}
};

// Called at the start of newPhase, before the phase is changed, so g.get("phase") is still the old phase
export const beforeNewPhase = async (phase: Phase) => {
	if (phase === PHASE.AFTER_TRADE_DEADLINE || phase === PHASE.PLAYOFFS) {
		// Midseason and end of regular season mood
		await safely("moodSnapshots", recordMoodSnapshots);
	}

	if (phase === PHASE.PLAYOFFS) {
		await safely("endHoldouts", endHoldouts);
	}

	if (phase === PHASE.RESIGN_PLAYERS) {
		// After the playoffs, before contracts expire
		await safely("moodSnapshots", recordMoodSnapshots);

		// Before newPhaseResignPlayers looks for expiring contracts, so a declined option makes a contract expire now
		await safely("decideContractOptions", decideContractOptions);
	}

	if (phase === PHASE.REGULAR_SEASON) {
		await safely("startHoldouts", startHoldouts);
	}
};

// AI teams extend some of their good players in the last season of their contracts
export const aiExtensions = async (probPerTeam = 0.05) => {
	if (!g.get("contractExtensions")) {
		return;
	}

	const season = g.get("season");
	const userTids = g.get("userTids");
	for (let tid = 0; tid < g.get("numTeams"); tid++) {
		if (
			(userTids.includes(tid) && !local.autoPlayUntil && !g.get("spectator")) ||
			Math.random() >= probPerTeam
		) {
			continue;
		}

		const players = (await idb.cache.players.indexGetAll("playersByTid", tid))
			.sort((a, b) => b.value - a.value)
			.slice(0, 7);
		for (const p of players) {
			const contract = getCurrentContract(p);
			if (
				!contract ||
				getContractExp(contract) !== season ||
				season - p.born.year > 31 ||
				getExtensionIneligibleReason(p, tid) !== undefined
			) {
				continue;
			}

			const demand = getExtensionDemand(p, contract);
			const mood = await moodInfo(p, tid, { contractAmount: demand.amount });
			if (!mood.willing) {
				continue;
			}

			if (g.get("salaryCapType") === "hard") {
				const payroll = await getPayroll(tid, season + 1);
				if (payroll + mood.contractAmount > g.get("salaryCap")) {
					continue;
				}
			}

			const terms = g.get("contractOptions")
				? pickAiContractTerms(
						p,
						{ amount: mood.contractAmount, exp: demand.exp },
						Math.random,
						demand.exp - getContractExp(contract),
					)
				: undefined;
			await extendContract(p, {
				amount: mood.contractAmount,
				exp: demand.exp,
				terms,
			});
			await idb.cache.players.put(p);

			// At most one per team per day
			break;
		}
	}
};

// After each day of regular season games
export const afterDay = async () => {
	const phase = g.get("phase");
	if (phase !== PHASE.REGULAR_SEASON && phase !== PHASE.AFTER_TRADE_DEADLINE) {
		return;
	}

	await safely("updateHoldouts", updateHoldouts);

	// About weekly, since it checks the mood of a lot of players
	if (Math.random() < 1 / 7) {
		await safely("updateTradeRequests", updateTradeRequests);
	}

	if (phase === PHASE.REGULAR_SEASON) {
		await safely("aiExtensions", () => aiExtensions());
	}
};
