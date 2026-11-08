import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import type { MoodComponents } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import moodInfo from "../player/moodInfo.ts";
import {
	getExtensionDemand,
	getExtensionIneligibleReason,
} from "./extension.ts";
import { sumMoodComponents } from "./moodHistory.ts";
import { getPendingOption, getReleaseCost } from "./options.ts";
import { hasActiveTradeRequest, isHoldingOut } from "./unrest.ts";

type Scenario = {
	key: string;
	label: string;
	adjust?: (components: MoodComponents) => void;
};

// "What if" changes to mood components. These are projections: the real components are recomputed from the team's results, so these just show which levers matter for this player.
export const MOOD_SCENARIOS: Scenario[] = [
	{ key: "current", label: "Right now" },
	{
		key: "winning",
		label: "Team wins a lot (contender)",
		adjust: (c) => {
			c.teamPerformance = Math.max(c.teamPerformance, 2);
		},
	},
	{
		key: "playoffs",
		label: "After a deep playoff run (wins and hype)",
		adjust: (c) => {
			c.teamPerformance = Math.max(c.teamPerformance, 2);
			c.hype = Math.max(c.hype, 1.5);
		},
	},
	{
		key: "role",
		label: "Bigger role (more playing time)",
		adjust: (c) => {
			c.playingTime = Math.max(c.playingTime, 1);
		},
	},
	{
		key: "stability",
		label: "No more trading away teammates",
		adjust: (c) => {
			c.trades = 0;
		},
	},
	{
		key: "all",
		label: "All of the above",
		adjust: (c) => {
			c.teamPerformance = Math.max(c.teamPerformance, 2);
			c.hype = Math.max(c.hype, 1.5);
			c.playingTime = Math.max(c.playingTime, 1);
			c.trades = 0;
		},
	},
];

export const getPlayerContractPanel = async (pid: number) => {
	const p = await idb.cache.players.get(pid);
	if (!p || p.tid === PLAYER.RETIRED || p.tid === PLAYER.UNDRAFTED) {
		return undefined;
	}

	const season = g.get("season");
	const userTid = g.get("userTid");
	const onUserTeam = p.tid === userTid;
	const contract = getCurrentContract(p);

	// Mood toward his own team, or the user's team for a free agent
	const moodTid = p.tid >= 0 ? p.tid : userTid;
	const scenarios = [];
	for (const scenario of MOOD_SCENARIOS) {
		const info = await moodInfo(p, moodTid, {
			adjustComponents: scenario.adjust,
		});
		scenarios.push({
			key: scenario.key,
			label: scenario.label,
			sum: Math.round(sumMoodComponents(info.components) * 10) / 10,
			probWilling: info.probWilling,
			willing: info.willing,
		});
	}

	let contractInfo;
	if (contract) {
		contractInfo = {
			type: contract.type,
			start: contract.start,
			exp: getContractExp(contract),
			seasons: contract.amounts.map((amount, i) => ({
				season: contract.start + i,
				amount,
				guaranteed: contract.guaranteed?.[i] ?? amount,
				option:
					contract.option?.season === contract.start + i
						? contract.option
						: undefined,
			})),
			// An option that was declined is no longer in amounts, but still worth showing
			option: contract.option,
			extensions: contract.extensions ?? [],
			releaseCost: onUserTeam ? getReleaseCost(contract) : undefined,
		};
	}

	const pending = getPendingOption(p);
	const canDecideTeamOption =
		onUserTeam &&
		pending?.option.type === "team" &&
		g.get("phase") >= 0 &&
		g.get("phase") < PHASE.RESIGN_PLAYERS;

	let extension;
	if (onUserTeam && g.get("contractExtensions")) {
		const reason = getExtensionIneligibleReason(p, userTid);
		let demand;
		if (reason === undefined && contract) {
			const flat = getExtensionDemand(p, contract);
			const info = await moodInfo(p, userTid, { contractAmount: flat.amount });
			demand = {
				amount: info.contractAmount,
				exp: flat.exp,
				willing: info.willing,
			};
		}
		extension = { reason, demand };
	}

	return {
		pid: p.pid,
		tid: p.tid,
		season,
		onUserTeam,
		settings: {
			contractOptions: g.get("contractOptions"),
			contractExtensions: g.get("contractExtensions"),
			tradeRequests: g.get("tradeRequests"),
			holdoutFrequency: g.get("holdoutFrequency"),
		},
		contract: contractInfo,
		canDecideTeamOption,
		extension,
		tradeRequest: hasActiveTradeRequest(p) ? p.tradeRequest : undefined,
		holdout: isHoldingOut(p) ? p.holdout : undefined,
		moodHistory: p.moodHistory ?? [],
		scenarios,
	};
};
