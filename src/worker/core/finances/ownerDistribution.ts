// Realistic AI Economy (League extra): at the end of the regular season an AI team's owner takes out 75% of the cash
// above a reserve of one salary cap, so cash settles around the reserve plus a third of a season's profit instead of
// growing without bound. Amounts in thousands.
export const OWNER_RESERVE_CAPS = 1;
export const OWNER_DISTRIBUTION_SHARE = 0.75;

export const ownerDistribution = (cash: number, salaryCap: number) => {
	const excess = cash - OWNER_RESERVE_CAPS * salaryCap;
	return excess > 0 ? Math.round(OWNER_DISTRIBUTION_SHARE * excess) : 0;
};
