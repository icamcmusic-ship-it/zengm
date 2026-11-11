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
	isHoldingOut,
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

// Chance per day that an AI team tries to settle a holdout with an extension (much likelier than a routine extension: the player is sitting out)
const HOLDOUT_EXTENSION_PROB = 0.25;

// AI teams extend some of their good players in the last season of their contracts, and try to end holdouts with an extension
export const aiExtensions = async (probPerTeam = 0.05) => {
	if (!g.get("contractExtensions")) {
		return;
	}

	const season = g.get("season");
	const userTids = g.get("userTids");
	const salaryCapType = g.get("salaryCapType");
	for (let tid = 0; tid < g.get("numTeams"); tid++) {
		if (userTids.includes(tid) && !local.autoPlayUntil && !g.get("spectator")) {
			continue;
		}

		const allPlayers = await idb.cache.players.indexGetAll("playersByTid", tid);
		const holdouts = allPlayers.filter((p) => isHoldingOut(p, season));
		const r = Math.random();
		let players;
		if (holdouts.length > 0 && r < HOLDOUT_EXTENSION_PROB) {
			players = holdouts;
		} else if (r < probPerTeam) {
			players = allPlayers.sort((a, b) => b.value - a.value).slice(0, 7);
		} else {
			continue;
		}

		for (const p of players) {
			const contract = getCurrentContract(p);
			const holdingOut = isHoldingOut(p, season);
			if (
				!contract ||
				(getContractExp(contract) !== season && !holdingOut) ||
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

			if (salaryCapType !== "none") {
				// Payroll in the first extended season, without his current deal (which ends before it)
				const firstNewSeason = getContractExp(contract) + 1;
				const payroll = await getPayroll(tid, firstNewSeason);
				const after = payroll + mood.contractAmount;
				if (salaryCapType === "hard" && after > g.get("salaryCap")) {
					continue;
				}
				// Soft cap: no routine extension that takes the team into the luxury tax. A holdout is only settled into the tax for a top-2
				// player, who is worth paying for
				if (salaryCapType === "soft" && after > g.get("luxuryPayroll")) {
					const rank = allPlayers
						.toSorted((a, b) => b.value - a.value)
						.findIndex((p2) => p2.pid === p.pid);
					if (!holdingOut || rank > 1) {
						continue;
					}
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
