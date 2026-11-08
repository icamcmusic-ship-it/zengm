import { PHASE } from "../../../common/constants.ts";
import {
	getContractAmount,
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import type {
	Contract,
	ContractTerms,
	FlatContractInfo,
	Player,
	PlayerWithoutKey,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { getContractStartSeason } from "../../util/getContractStartSeason.ts";
import genContract from "../player/genContract.ts";
import moodInfo from "../player/moodInfo.ts";
import { truncateContractBefore } from "./index.ts";

export const playerLink = (p: Pick<Player, "pid" | "firstName" | "lastName">) =>
	`<a href="${helpers.leagueUrl(["player", p.pid])}">${p.firstName} ${p.lastName}</a>`;

export const teamLink = (tid: number) => {
	const info = g.get("teamInfoCache")[tid];
	return `<a href="${helpers.leagueUrl(["roster", `${info?.abbrev}_${tid}`, g.get("season")])}">${info?.region} ${info?.name}</a>`;
};

// What a player would get on the open market right now, ignoring mood. Not randomized, so it's stable.
export const estimateMarketValue = (p: PlayerWithoutKey) => {
	return genContract(p, false).amount;
};

// Remove the option season, like when an option is declined. Keeps guaranteed in sync with amounts.
const dropOptionSeason = (contract: Contract) => {
	const option = contract.option;
	if (!option) {
		return false;
	}
	if (!truncateContractBefore(contract, option.season)) {
		return false;
	}
	if (contract.guaranteed) {
		contract.guaranteed = contract.guaranteed.slice(0, contract.amounts.length);
	}
	return true;
};

export const applyOptionDecision = (
	contract: Contract,
	decision: "exercised" | "declined",
) => {
	if (!contract.option || contract.option.decision !== undefined) {
		return false;
	}
	if (decision === "declined") {
		if (!dropOptionSeason(contract)) {
			return false;
		}
	}
	contract.option.decision = decision;
	return true;
};

// The current contract's option, if it's the next one to be decided: the option season is the only season left after this one
export const getPendingOption = (
	p: Pick<PlayerWithoutKey, "contracts" | "tid">,
	season: number = g.get("season"),
) => {
	const contract = getCurrentContract(p);
	if (
		contract?.option &&
		contract.option.decision === undefined &&
		contract.option.season === season + 1 &&
		getContractExp(contract) === contract.option.season
	) {
		return { contract, option: contract.option };
	}
};

// Player opts out when he can get more on the market, or when he's unhappy and wouldn't lose much by leaving
export const playerOptsOut = ({
	age,
	marketValue,
	optionAmount,
	probWilling,
}: {
	age: number;
	marketValue: number;
	optionAmount: number;
	probWilling: number;
}) => {
	if (age >= 34 && marketValue < optionAmount * 1.2) {
		return false;
	}
	if (marketValue > optionAmount * 1.1) {
		return true;
	}
	return probWilling < 0.3 && marketValue >= optionAmount * 0.9;
};

// Team keeps the option season if the player is worth about what he'd be paid
export const teamExercises = ({
	marketValue,
	optionAmount,
}: {
	marketValue: number;
	optionAmount: number;
}) => {
	return marketValue >= optionAmount * 0.9;
};

// Decide options whose decision is due, at the start of the re-signing phase (before expiring contracts are handled, so a declined option makes his contract expire now)
export const decideContractOptions = async () => {
	const season = g.get("season");
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const userTids = g.get("userTids");

	for (const p of players) {
		const pending = getPendingOption(p, season);
		if (!pending) {
			continue;
		}
		const { contract, option } = pending;
		const optionAmount = getContractAmount(contract, option.season) ?? 0;
		const marketValue = estimateMarketValue(p);

		let decision: "exercised" | "declined";
		let text;
		if (option.type === "player") {
			const mood = await moodInfo(p, p.tid);
			decision = playerOptsOut({
				age: season - p.born.year,
				marketValue,
				optionAmount,
				probWilling: mood.probWilling,
			})
				? "declined"
				: "exercised";
			text =
				decision === "declined"
					? `${playerLink(p)} declined his ${helpers.formatCurrency(optionAmount / 1000, "M")} player option for ${option.season} with the ${teamLink(p.tid)}, so his contract is up now.`
					: `${playerLink(p)} exercised his ${helpers.formatCurrency(optionAmount / 1000, "M")} player option for ${option.season} with the ${teamLink(p.tid)}.`;
		} else {
			decision = teamExercises({ marketValue, optionAmount })
				? "exercised"
				: "declined";
			text = `The ${teamLink(p.tid)} ${decision} their ${helpers.formatCurrency(optionAmount / 1000, "M")} team option on ${playerLink(p)} for ${option.season}${userTids.includes(p.tid) ? " (decided automatically, since you didn't decide before the re-signing phase)" : ""}.`;
		}

		applyOptionDecision(contract, decision);
		await idb.cache.players.put(p);
		await logEvent({
			type: "contractOption",
			text,
			pids: [p.pid],
			tids: [p.tid],
			score: p.value >= 60 ? 10 : 0,
			showNotification: userTids.includes(p.tid),
		});
	}
};

// User decides on his own team option before the re-signing phase
export const userDecideTeamOption = async (
	pid: number,
	decision: "exercised" | "declined",
) => {
	const p = await idb.cache.players.get(pid);
	if (!p || !g.get("userTids").includes(p.tid)) {
		return "You can only decide on options for your own players.";
	}
	if (g.get("phase") >= PHASE.RESIGN_PLAYERS || g.get("phase") < 0) {
		return "Options can't be decided now.";
	}
	const pending = getPendingOption(p);
	if (!pending || pending.option.type !== "team") {
		return "There is no team option to decide right now. It can be decided during the last season before the option season.";
	}

	const optionAmount =
		getContractAmount(pending.contract, pending.option.season) ?? 0;
	applyOptionDecision(pending.contract, decision);
	await idb.cache.players.put(p);
	await logEvent({
		type: "contractOption",
		text: `The ${teamLink(p.tid)} ${decision} their ${helpers.formatCurrency(optionAmount / 1000, "M")} team option on ${playerLink(p)} for ${pending.option.season}.`,
		pids: [p.pid],
		tids: [p.tid],
		showNotification: false,
	});
};

// When a player is released, only the guaranteed part of future seasons is owed, and an undecided team option is not owed at all. The current season, which may already be partly paid, is always owed in full.
export const applyReleaseGuarantees = (
	contract: Contract,
	season: number = g.get("season"),
) => {
	if (
		contract.option?.type === "team" &&
		contract.option.decision === undefined
	) {
		if (contract.option.season > season) {
			applyOptionDecision(contract, "declined");
		}
	}

	if (contract.guaranteed) {
		for (let i = 0; i < contract.amounts.length; i++) {
			if (contract.start + i > season) {
				contract.amounts[i] = contract.guaranteed[i] ?? contract.amounts[i]!;
			}
		}
	}
};

// What releasing a player now would cost in total (the rest of this season plus guaranteed future seasons), and what it would cost without guarantees, in thousands of dollars
export const getReleaseCost = (
	contract: Contract,
	season: number = g.get("season"),
) => {
	const copy: Contract = {
		...contract,
		amounts: [...contract.amounts],
		guaranteed: contract.guaranteed ? [...contract.guaranteed] : undefined,
		option: contract.option ? { ...contract.option } : undefined,
	};
	applyReleaseGuarantees(copy, season);

	const startSeason = getContractStartSeason();
	const sumFrom = (c: Contract) => {
		let total = 0;
		for (let i = 0; i < c.amounts.length; i++) {
			const s = c.start + i;
			if (s < startSeason) {
				continue;
			}
			let amount = c.amounts[i]!;
			if (s === season && g.get("phase") <= PHASE.PLAYOFFS) {
				const paid = c.payments
					.filter((row) => row.season === s)
					.reduce((sum, row) => sum + row.amount, 0);
				amount = Math.max(0, amount - paid);
			}
			total += amount;
		}
		return total;
	};

	return {
		owed: sumFrom(copy),
		full: sumFrom(contract),
	};
};

// Terms AI teams put in multi-year contracts they sign, so options and guarantees show up around the league. Older players get team-friendly terms, young good players get player options.
export const pickAiContractTerms = (
	p: Pick<PlayerWithoutKey, "born" | "value">,
	contract: FlatContractInfo,
	random: () => number = Math.random,
	// Override for an extension, where the new seasons start after the current contract
	yearsOverride?: number,
): ContractTerms | undefined => {
	const years = yearsOverride ?? contract.exp - getContractStartSeason() + 1;
	if (years < 2 || contract.rookie) {
		return;
	}

	const age = g.get("season") - p.born.year;
	const r = random();
	if (age >= 31) {
		if (r < 0.3) {
			return { option: "team" };
		}
		if (r < 0.55) {
			return { guaranteed: 0.5 };
		}
	} else if (p.value >= 60 && age <= 28) {
		if (r < 0.25) {
			return { option: "player" };
		}
	} else if (years >= 3 && r < 0.15) {
		return { option: "team" };
	} else if (years >= 3 && r < 0.25) {
		return { guaranteed: 0.75 };
	}
};
