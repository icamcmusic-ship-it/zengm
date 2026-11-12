import helpers from "../../util/helpers.ts";

// What a player asks per year for a contract of another length than the one he wants: 10-20% more per year away from it (the
// percentage from the last digit of his ovr, deterministic noise). In millions, like the negotiation's options
export const contractGrowthFactor = (ovr: number) =>
	0.15 + (ovr % 10) * 0.01 - 0.05;

export const contractAmountForYears = ({
	amount,
	askedYears,
	years,
	ovr,
}: {
	// Millions per year for askedYears
	amount: number;
	askedYears: number;
	years: number;
	ovr: number;
}) =>
	helpers.roundContract(
		amount *
			(1 + Math.abs(askedYears - years) * contractGrowthFactor(ovr)) *
			1000,
	) / 1000;
