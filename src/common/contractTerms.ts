import type { Contract, ContractTerms } from "./types.ts";

// Guarantee levels that can be offered in negotiations, for every season after the first
export const GUARANTEE_LEVELS = [1, 0.75, 0.5, 0] as const;

// Terms only apply to contracts of at least 2 seasons: an option is on the final season, and the first season is always fully guaranteed
export const termsApply = (years: number) => years >= 2;

// Drop terms that don't do anything, so contracts without them look the same as before
export const normalizeContractTerms = (
	terms: ContractTerms | undefined,
	years: number,
): ContractTerms | undefined => {
	if (!terms || !termsApply(years)) {
		return;
	}

	const output: ContractTerms = {};
	if (terms.option === "player" || terms.option === "team") {
		output.option = terms.option;
	}
	if (
		terms.guaranteed !== undefined &&
		Number.isFinite(terms.guaranteed) &&
		terms.guaranteed < 1
	) {
		output.guaranteed = Math.max(0, terms.guaranteed);
	}

	if (output.option === undefined && output.guaranteed === undefined) {
		return;
	}
	return output;
};

// How much more (or less) a player asks for per season with these terms. A player option is worth something to him, so he takes a bit less. A team option or a partial guarantee is a risk for him, so he wants more.
export const getContractTermsFactor = (
	terms: ContractTerms | undefined,
	years: number,
) => {
	const normalized = normalizeContractTerms(terms, years);
	if (!normalized) {
		return 1;
	}

	let factor = 1;
	if (normalized.option === "player") {
		factor *= 0.95;
	} else if (normalized.option === "team") {
		factor *= 1.1;
	}

	const guaranteed = normalized.guaranteed ?? 1;
	factor *= 1 + 0.2 * (1 - guaranteed);

	return factor;
};

export const optionLabel = (type: "player" | "team") =>
	type === "player" ? "Player option" : "Team option";

// Short text like "player option 2027, 50% guaranteed after 2025"
export const describeContractTerms = (
	terms: ContractTerms | undefined,
	exp: number,
	start?: number,
) => {
	const parts: string[] = [];
	if (terms?.option) {
		parts.push(`${terms.option} option ${exp}`);
	}
	if (terms?.guaranteed !== undefined && terms.guaranteed < 1) {
		parts.push(
			`${Math.round(terms.guaranteed * 100)}% guaranteed${start !== undefined ? ` after ${start}` : " after year 1"}`,
		);
	}
	return parts.join(", ");
};

// Amount a team owes for each season of a contract if it releases the player
export const getGuaranteedAmounts = (
	contract: Pick<Contract, "amounts" | "guaranteed">,
) => {
	return contract.amounts.map(
		(amount, i) => contract.guaranteed?.[i] ?? amount,
	);
};

// Like ContractTerms, from a signed contract
export const getTermsFromContract = (
	contract: Pick<Contract, "amounts" | "guaranteed" | "option">,
): ContractTerms | undefined => {
	const terms: ContractTerms = {};
	if (contract.option && contract.option.decision === undefined) {
		terms.option = contract.option.type;
	}
	if (contract.guaranteed) {
		const last = contract.amounts.length - 1;
		if (last > 0 && contract.amounts[last]! > 0) {
			terms.guaranteed = contract.guaranteed[last]! / contract.amounts[last]!;
		}
	}
	return terms.option !== undefined || terms.guaranteed !== undefined
		? terms
		: undefined;
};
