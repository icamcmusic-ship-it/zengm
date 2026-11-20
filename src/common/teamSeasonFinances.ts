// Season totals of a team's books (thousands of dollars). Expenses include the Front Office Budget's Analytics and Travel & Sports
// Science departments, which are recorded in teamSeason.frontOffice rather than teamSeason.expenses but are paid from cash like the
// other budget items, and Owner's Office project payments (teamSeason.projectExpenses). Owner distributions (Realistic AI Economy) are not an expense: they are a draw on cash after profit, recorded in
// teamSeason.ownerDistributions, so cash change = revenue - expenses - ownerDistributions.

type SeasonBooks = {
	revenues: Record<string, number>;
	expenses: Record<string, number>;
	frontOffice?: { expenses: Record<"analytics" | "travel", number> };
	// Owner's Office arena/facilities project payments
	projectExpenses?: number;
};

export const seasonRevenue = (ts: Pick<SeasonBooks, "revenues">) => {
	let sum = 0;
	for (const value of Object.values(ts.revenues)) {
		sum += value ?? 0;
	}
	return sum;
};

export const seasonFrontOfficeExpenses = (
	ts: Pick<SeasonBooks, "frontOffice">,
) =>
	(ts.frontOffice?.expenses.analytics ?? 0) +
	(ts.frontOffice?.expenses.travel ?? 0);

export const seasonExpenses = (
	ts: Pick<SeasonBooks, "expenses" | "frontOffice" | "projectExpenses">,
) => {
	let sum = seasonFrontOfficeExpenses(ts) + (ts.projectExpenses ?? 0);
	for (const value of Object.values(ts.expenses)) {
		sum += value ?? 0;
	}
	return sum;
};

export const seasonProfit = (ts: SeasonBooks) =>
	seasonRevenue(ts) - seasonExpenses(ts);
