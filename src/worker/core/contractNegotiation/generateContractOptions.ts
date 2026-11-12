import { PHASE } from "../../../common/constants.ts";
import type { Negotiation, FlatContractInfo } from "../../../common/types.ts";
import { range } from "../../../common/utils.ts";
import g from "../../util/g.ts";
import helpers from "../../util/helpers.ts";
import { getContractStartSeason } from "../../util/getContractStartSeason.ts";
import accept from "./accept.ts";
import { contractGrowthFactor } from "./contractAmountForYears.ts";
import type { CapExceptionType } from "../../../common/capExceptions.ts";
import {
	capExceptionsEnabled,
	getAvailableCapExceptions,
	getSigningCapInfo,
} from "../contract/capExceptions.ts";
import { idb } from "../../db/index.ts";
import getPayroll from "../team/getPayroll.ts";

export const generateContractOptions = async (
	negotiation: Negotiation,
	contract: FlatContractInfo,
	ovr: number,
	// First season of the contract, different from the default for an extension
	startSeasonOverride?: number,
	// Lengths that can be offered, for an extension which adds seasons to a contract that already has some
	maxLength?: number,
) => {
	const growthFactor = contractGrowthFactor(ovr);
	const startSeason = startSeasonOverride ?? getContractStartSeason();
	let found: number | undefined;

	const allowedLengths = range(
		g.get("minContractLength"),
		(maxLength ?? g.get("maxContractLength")) + 1,
	);

	const contractOptions: {
		exp: number;
		years: number;
		amount: number;
		smallestAmount: boolean;
		disabledReason?: string;
		// Salary cap exception this contract would be signed with (setting)
		exception?: CapExceptionType;
		// Disabled because it is longer than the exception that would cover the amount allows (shown on the row, not only on hover)
		exceptionTooLong?: { exception: CapExceptionType; maxYears: number };
	}[] = allowedLengths.map((contractLength, i) => {
		const contractOption = {
			exp: startSeason + contractLength - 1,
			years: contractLength,
			amount: 0,
			smallestAmount: false,
		};

		if (contractOption.exp === contract.exp) {
			contractOption.amount = contract.amount;
			contractOption.smallestAmount = true;
			found = i;
		}

		return contractOption;
	});

	if (found === undefined) {
		contractOptions[0]!.amount = contract.amount;
		contractOptions[0]!.smallestAmount = true;
		found = 0;
	}

	// From the desired contract, ask for more money for less or more years
	for (const [i, contractOption] of contractOptions.entries()) {
		const factor = 1 + Math.abs(found - i) * growthFactor;
		contractOption.amount = contractOptions[found]!.amount * factor;
		contractOption.amount =
			helpers.roundContract(contractOption.amount * 1000) / 1000;
	}

	const possible = contractOptions.filter((contractOption) => {
		if (contractOption.smallestAmount) {
			return true;
		}

		if (
			g.get("challengeNoFreeAgents") &&
			g.get("phase") !== PHASE.RESIGN_PLAYERS &&
			contractOption.amount * 1000 > g.get("minContract")
		) {
			return false;
		}

		return contractOption.amount * 1000 <= g.get("maxContract");
	});

	// Salary cap exceptions (setting): say which free agent contracts would use one
	const exceptionTeam =
		capExceptionsEnabled() && !negotiation.resigning && !negotiation.extension
			? await idb.cache.teams.get(g.get("userTid"))
			: undefined;
	const payroll = exceptionTeam ? await getPayroll(g.get("userTid")) : 0;

	for (const row of possible) {
		const disabledReason = await accept({
			negotiation,
			amount: Math.round(row.amount * 1000),
			exp: row.exp,
			dryRun: true,
		});
		if (typeof disabledReason === "string") {
			row.disabledReason = disabledReason;
			if (exceptionTeam) {
				const amount = Math.round(row.amount * 1000);
				const covers = getAvailableCapExceptions(exceptionTeam, payroll).filter(
					(exception) => amount <= exception.amount,
				);
				if (
					covers.length > 0 &&
					payroll + amount - 1 > g.get("salaryCap") &&
					covers.every((exception) => exception.maxYears < row.years)
				) {
					const longest = covers.reduce((a, b) =>
						b.maxYears > a.maxYears ? b : a,
					);
					row.exceptionTooLong = {
						exception: longest.type,
						maxYears: longest.maxYears,
					};
				}
			}
		} else if (
			exceptionTeam &&
			Math.round(row.amount * 1000) - 1 > g.get("minContract")
		) {
			const capInfo = getSigningCapInfo(
				exceptionTeam,
				payroll,
				Math.round(row.amount * 1000),
				row.years,
			);
			if (capInfo?.type === "exception") {
				row.exception = capInfo.exception.type;
			}
		}
	}

	return possible;
};
