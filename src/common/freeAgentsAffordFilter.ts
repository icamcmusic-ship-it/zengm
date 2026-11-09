// DataTable filter for the "Asking For" column (in millions) on the Free Agents page, for the "Show players you can afford now" button. With cap space, anyone asking for up to the cap space. Otherwise (over the cap, or the no free agents challenge mode), only minimum contracts, which can always be signed. The DataTable "<" filter includes the value itself, so players asking for exactly the minimum are shown.
export const getAffordFilter = ({
	capSpace,
	challengeNoFreeAgents,
	minContract,
}: {
	// Millions of dollars, like on the Free Agents page
	capSpace: number;
	challengeNoFreeAgents: boolean;
	// Thousands of dollars, like the game attribute
	minContract: number;
}) => {
	if (capSpace * 1000 > minContract && !challengeNoFreeAgents) {
		return `<${capSpace}`;
	}

	return `<${minContract / 1000}`;
};
