import { PHASE } from "../../../common/constants.ts";
import {
	getContractAmount,
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import {
	getContractTermsFactor,
	normalizeContractTerms,
} from "../../../common/contractTerms.ts";
import type {
	Contract,
	ContractTerms,
	FlatContractInfo,
	Player,
	PlayerWithoutKey,
} from "../../../common/types.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { estimateMarketValue, playerLink, teamLink } from "./options.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

// Players can be extended in the last seasons of their contracts: this many seasons left, counting the current one
export const EXTENSION_WINDOW_SEASONS = 2;

export const isExtensionPhase = (phase = g.get("phase")) =>
	phase >= PHASE.PRESEASON && phase <= PHASE.AFTER_TRADE_DEADLINE;

// Why a player can't be extended right now, or undefined if he can
export const getExtensionIneligibleReason = (
	p: Pick<PlayerWithoutKey, "contracts" | "tid" | "draft" | "holdout">,
	tid: number,
): string | undefined => {
	if (!featureOn("contractExtensions")) {
		return "Contract extensions are disabled in League Settings.";
	}
	if (p.tid !== tid || tid < 0) {
		return "Only players on your team can be extended.";
	}
	if (!isExtensionPhase()) {
		return "Extensions can only be signed during the preseason and regular season. After that, expiring contracts are re-signed in the re-signing phase.";
	}
	const contract = getCurrentContract(p);
	if (!contract) {
		return "He has no contract to extend.";
	}
	const season = g.get("season");
	const exp = getContractExp(contract);
	if (exp - season + 1 > EXTENSION_WINDOW_SEASONS) {
		return `Only players in the last ${EXTENSION_WINDOW_SEASONS} seasons of their contracts can be extended (his runs through ${exp}).`;
	}
	if (contract.option && contract.option.decision === undefined) {
		return "His contract has an undecided option, which needs to be decided first.";
	}
	if (contract.extensions?.some((row) => row.season === season)) {
		return "He was already extended this season.";
	}
};

// Extra seasons a player wants, based on age, like longer deals for young players
export const getExtensionYears = (age: number) => {
	let years;
	if (age <= 25) {
		years = 4;
	} else if (age <= 28) {
		years = 3;
	} else if (age <= 31) {
		years = 2;
	} else {
		years = 1;
	}
	return helpers.bound(
		years,
		g.get("minContractLength"),
		g.get("maxContractLength"),
	);
};

// What the player asks for in an extension, before mood. The amount is his market value, but never less than he makes now unless he's well past his prime.
export const getExtensionDemand = (
	p: PlayerWithoutKey,
	contract: Contract,
): FlatContractInfo => {
	const season = g.get("season");
	const age = season - p.born.year;
	const exp = getContractExp(contract);
	const current = getContractAmount(contract, exp) ?? g.get("minContract");

	let amount = estimateMarketValue(p);
	if (age < 30) {
		amount = Math.max(amount, current);
	}
	amount = helpers.bound(
		helpers.roundContract(amount),
		g.get("minContract"),
		g.get("maxContract"),
	);

	return {
		amount,
		exp: exp + getExtensionYears(age),
	};
};

// Add seasons to a player's current contract. The current seasons stay as they are, so payroll this season doesn't change.
export const extendContract = async (
	p: Player,
	{
		amount,
		exp,
		terms,
	}: { amount: number; exp: number; terms?: ContractTerms },
	phase = g.get("phase"),
) => {
	const contract = getCurrentContract(p);
	if (!contract) {
		throw new Error("No contract to extend");
	}
	const oldExp = getContractExp(contract);
	const firstSeason = oldExp + 1;
	if (exp < firstSeason) {
		throw new Error("Extension must add at least one season");
	}

	const numNewSeasons = exp - oldExp;
	const newAmounts = Array.from({ length: numNewSeasons }, () => amount);

	// Old option, if any, is moot now. Mark it as exercised, since he's still under contract that season.
	if (contract.option && contract.option.decision === undefined) {
		contract.option.decision = "exercised";
	}

	if (contract.guaranteed) {
		contract.guaranteed.push(...newAmounts);
	}
	contract.amounts.push(...newAmounts);

	const normalizedTerms = featureOn("contractOptions")
		? normalizeContractTerms(terms, numNewSeasons)
		: undefined;
	if (normalizedTerms?.option) {
		contract.option = {
			type: normalizedTerms.option,
			season: exp,
		};
	}
	if (normalizedTerms?.guaranteed !== undefined) {
		const guaranteed = normalizedTerms.guaranteed;
		contract.guaranteed ??= [...contract.amounts];
		for (let i = 1; i < numNewSeasons; i++) {
			contract.guaranteed[contract.amounts.length - numNewSeasons + i] =
				Math.round(amount * guaranteed);
		}
	}

	const eid = await logEvent({
		type: "extension",
		text: `The ${teamLink(p.tid)} signed ${playerLink(p)} to a ${numNewSeasons} year, ${helpers.formatCurrency(amount / 1000, "M")}/year extension through ${exp}.`,
		pids: [p.pid],
		tids: [p.tid],
		score: p.value >= 60 ? 10 : 0,
		showNotification: false,
	});

	contract.extensions ??= [];
	contract.extensions.push({
		season: g.get("season"),
		phase,
		firstSeason,
		amount,
		eid,
	});

	// A new deal settles holdouts and trade requests
	delete p.holdout;
	delete p.tradeRequest;

	return eid;
};

// Amount with terms, like in negotiations
export const applyTermsToAmount = (
	amount: number,
	terms: ContractTerms | undefined,
	years: number,
) =>
	helpers.bound(
		helpers.roundContract(amount * getContractTermsFactor(terms, years)),
		g.get("minContract"),
		g.get("maxContract"),
	);
