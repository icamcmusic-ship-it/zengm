// Realistic AI Economy (League extra, featureRealisticEconomy): the trade rules for AI-to-AI trades. Pure checks, so
// they can be tested directly. With the extra off none of this runs and the stock rules apply.

// The random AI-to-AI trade (betweenAiTeams attempt) lets the initiating team lose up to 15 value units. With the extra
// on, both teams must come out roughly even.
export const FAIR_TRADE_MIN_DV = -2;

// Times an unfair random trade is retried with new players, so the number of trades stays close to stock
export const FAIR_TRADE_RETRIES = 2;

// No salary cap: a team over the luxury tax after the trade can't take back more than 125% + $100k of what it sends out
export const SALARY_MATCH_RATIO = 1.25;
export const SALARY_MATCH_BUFFER = 100; // thousands

export type SalaryMatchSide = {
	payrollBefore: number;
	salaryOut: number;
	salaryIn: number;
};

export const salaryMatchOk = (
	sides: SalaryMatchSide[],
	luxuryPayroll: number,
) =>
	sides.every(({ payrollBefore, salaryOut, salaryIn }) => {
		if (salaryIn <= salaryOut) {
			return true;
		}
		const payrollAfter = payrollBefore + salaryIn - salaryOut;
		if (payrollAfter <= luxuryPayroll) {
			return true;
		}
		return salaryIn <= SALARY_MATCH_RATIO * salaryOut + SALARY_MATCH_BUFFER;
	});
