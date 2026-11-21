// Realistic AI Economy (League extra): at the end of the regular season an AI team's owner takes out 75% of the cash
// above a reserve of one salary cap, so cash settles around the reserve plus a third of a season's profit instead of
// growing without bound. Amounts in thousands.
export const OWNER_RESERVE_CAPS = 1;
export const OWNER_DISTRIBUTION_SHARE = 0.75;

// extraReserve: cash the owner also leaves in the team, like what an Owner's Office project still has to be paid (thousands)
export const ownerDistribution = (
	cash: number,
	salaryCap: number,
	extraReserve: number = 0,
) => {
	const excess =
		cash - OWNER_RESERVE_CAPS * salaryCap - Math.max(0, extraReserve);
	return excess > 0 ? Math.round(OWNER_DISTRIBUTION_SHARE * excess) : 0;
};

// Realistic AI Economy: an AI owner's budget spending is nudged by the team's cash reserves at the start of the season. Cash above the
// reserve buys a few more budget levels, a team in the red spends a few less. Bounded to +/- CASH_SPENDING_MAX_NUDGE levels (out of
// 100), added to the market-size level before it's split over the departments, so it never dominates market size.
export const CASH_SPENDING_MAX_NUDGE = 6;
// Levels per salary cap of cash above (or below) the reserve
export const CASH_SPENDING_LEVELS_PER_CAP = 4;

export const cashSpendingNudge = (cash: number, salaryCap: number) => {
	if (!(salaryCap > 0) || !Number.isFinite(cash)) {
		return 0;
	}
	const capsAboveReserve = cash / salaryCap - OWNER_RESERVE_CAPS;
	const nudge = Math.round(CASH_SPENDING_LEVELS_PER_CAP * capsAboveReserve);
	return Math.max(
		-CASH_SPENDING_MAX_NUDGE,
		Math.min(CASH_SPENDING_MAX_NUDGE, nudge),
	);
};
