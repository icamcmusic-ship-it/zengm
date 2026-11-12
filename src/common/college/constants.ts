// College mode constants shared by the worker and the UI. See docs/college-mode.md.

export const CLASS_YEARS = ["HS", "Fr", "So", "Jr", "Sr"] as const;
export const CLASS_YEAR_NAMES = [
	"Recruit",
	"Freshman",
	"Sophomore",
	"Junior",
	"Senior",
] as const;

export const classYearAbbrev = (classYear: number | undefined) =>
	classYear === undefined
		? ""
		: (CLASS_YEARS[Math.max(0, Math.min(4, classYear))] ?? "");

export const classYearName = (classYear: number | undefined) =>
	classYear === undefined
		? ""
		: (CLASS_YEAR_NAMES[Math.max(0, Math.min(4, classYear))] ?? "");

export const COLLEGE_SCHOLARSHIPS = 13;
export const COLLEGE_ELIGIBILITY_YEARS = 4;

// Phase names in a college league, by PHASE value (see the calendar in docs/college-mode.md)
export const COLLEGE_PHASE_TEXT: Record<string, string> = {
	"-2": "expansion draft",
	"-1": "fantasy draft",
	"0": "preseason",
	"1": "regular season",
	"2": "conference tournaments",
	"3": "national tournament",
	"4": "season over",
	"5": "departures",
	"6": "transfer portal",
	"7": "recruiting",
	"8": "signing day",
};

export const COLLEGE_REGION_NAMES = ["East", "West", "South", "Midwest"];

// Round names of the national tournament, by rounds left including this one
export const collegeRoundName = (round: number, numRounds: number) => {
	const left = numRounds - round;
	if (left === 1) {
		return "Championship";
	}
	if (left === 2) {
		return "Final Four";
	}
	if (left === 3) {
		return "Elite Eight";
	}
	if (left === 4) {
		return "Sweet Sixteen";
	}
	return `Round of ${2 ** left}`;
};
