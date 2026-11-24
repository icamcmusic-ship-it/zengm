// Salary cap exceptions (League Extras: Salary Cap Exceptions, soft cap only). Shared by the worker and the UI.

export type CapExceptionType =
	| "nonTaxpayerMle"
	| "taxpayerMle"
	| "biAnnual"
	| "room"
	| "disabledPlayer";

export const CAP_EXCEPTION_TYPES: readonly CapExceptionType[] = [
	"nonTaxpayerMle",
	"taxpayerMle",
	"biAnnual",
	"room",
	"disabledPlayer",
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
	// Granted for a season-ending injury, not a share of the cap: see DISABLED_PLAYER below
	disabledPlayer: {
		name: "disabled player exception",
		shortName: "Disabled player",
		capFraction: 0,
		maxYears: 1,
	},
};

// Disabled player exception (NBA): when a player is ruled out for the rest of the season, his team gets an exception worth half his
// salary (or the non-taxpayer mid-level exception, if less), to sign or trade for one player on a contract that ends this season. Like
// the NBA's (applications by January 15, the exception expires on March 10), it's granted in the first half of the regular season and
// expires at the trade deadline (the end of the regular season in a league without one)
export const DISABLED_PLAYER = {
	salaryFraction: 0.5,
	// Granted only while the team has played no more than this share of its games (the NBA's January 15, about game 41 of 82)
	maxSeasonFraction: 0.5,
};

// A disabled player exception granted to a team
export type DisabledPlayerException = {
	// The regular season it was granted in (it's only good for that one)
	season: number;
	// The injured player
	pid: number;
	amount: number;
	// The player signed or traded for with it
	usedPid?: number;
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
	// Disabled player exceptions granted this season (older ones are pruned)
	disabledPlayer?: DisabledPlayerException[];
};

export const describeCapException = (type: CapExceptionType) =>
	CAP_EXCEPTIONS[type]?.name ?? "salary cap exception";
