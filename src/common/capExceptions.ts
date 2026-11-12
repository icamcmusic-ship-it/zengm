// Salary cap exceptions (League Extras: Salary Cap Exceptions, soft cap only). Shared by the worker and the UI.

export type CapExceptionType =
	| "nonTaxpayerMle"
	| "taxpayerMle"
	| "biAnnual"
	| "room";

export const CAP_EXCEPTION_TYPES: readonly CapExceptionType[] = [
	"nonTaxpayerMle",
	"taxpayerMle",
	"biAnnual",
	"room",
];

// Amounts are shares of the salary cap, like the NBA's (2023-24: $12.4M, $5.0M, $4.5M and $7.7M with a $136M cap). maxYears is capped by the league's max contract length.
export const CAP_EXCEPTIONS: Record<
	CapExceptionType,
	{
		name: string;
		shortName: string;
		capFraction: number;
		maxYears: number;
	}
> = {
	nonTaxpayerMle: {
		name: "mid-level exception",
		shortName: "Mid-level",
		capFraction: 0.0912,
		maxYears: 4,
	},
	taxpayerMle: {
		name: "taxpayer mid-level exception",
		shortName: "Taxpayer mid-level",
		capFraction: 0.0368,
		maxYears: 2,
	},
	biAnnual: {
		name: "bi-annual exception",
		shortName: "Bi-annual",
		capFraction: 0.0332,
		maxYears: 2,
	},
	room: {
		name: "room exception",
		shortName: "Room",
		capFraction: 0.0568,
		maxYears: 3,
	},
};

// A team using the mid-level or bi-annual exception can't end up with a payroll above the first apron, and one using the taxpayer mid-level exception can't end up above the second apron. Both are multiples of the luxury tax line, like the NBA's.
export const FIRST_APRON_FACTOR = 1.045;
export const SECOND_APRON_FACTOR = 1.105;

// Repeater tax: over the luxury tax in at least 3 of the previous 4 seasons, the tax rate is multiplied by this (1.5 -> 2.5, like the NBA's extra $1 per $1)
export const REPEATER_TAX_FACTOR = 5 / 3;
export const REPEATER_TAX_SEASONS = 4;
export const REPEATER_TAX_MIN_SEASONS = 3;

export type CapExceptionUse = {
	// League year: the first season of a contract signed then, so free agency after the 2025 playoffs and the 2026 regular season are both 2026
	season: number;
	type: CapExceptionType;
	pid: number;
	amount: number;
};

// Stored on the team object
export type TeamCapExceptions = {
	uses: CapExceptionUse[];
	// Last league year the team signed a free agent for more than the minimum with cap space. Such a team only has the room exception that year.
	capSpaceSeason?: number;
};

export const describeCapException = (type: CapExceptionType) =>
	CAP_EXCEPTIONS[type]?.name ?? "salary cap exception";
