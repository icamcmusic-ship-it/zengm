// Owner's Office (League Extra "ownerOffice"): the owner's preseason budget meeting (goals and a spending envelope) and arena/facilities
// projects paid from cash over several seasons. Pure formulas here; the worker side is worker/core/ownerOffice. Amounts in thousands of
// dollars unless noted, like the rest of the finances.

export type OwnerProjectType = "renovation" | "practiceFacility" | "newArena";

export type OwnerProjectDef = {
	name: string;
	description: string;
	// Seasons of payments (the project completes at the start of the season after the last one)
	seasons: number;
	// Total cost, in salary caps
	costCaps: number;
	// Facilities levels added on completion (they wear off by FACILITIES_BONUS_DECAY a season)
	facilities: number;
	// Stadium capacity multiplier on completion
	capacityFactor: number;
};

export const OWNER_PROJECTS: Record<OwnerProjectType, OwnerProjectDef> = {
	renovation: {
		name: "Arena renovation",
		description: "New seats, concourses and scoreboard.",
		seasons: 2,
		costCaps: 0.2,
		facilities: 6,
		capacityFactor: 1,
	},
	practiceFacility: {
		name: "Practice facility",
		description: "A modern training and practice complex.",
		seasons: 2,
		costCaps: 0.3,
		facilities: 9,
		capacityFactor: 1,
	},
	newArena: {
		name: "New arena",
		description: "A new building: more seats and much better facilities.",
		seasons: 4,
		costCaps: 1,
		facilities: 12,
		capacityFactor: 1.1,
	},
};

export const OWNER_PROJECT_TYPES = Object.keys(
	OWNER_PROJECTS,
) as OwnerProjectType[];

export const FACILITIES_BONUS_MAX = 20;
export const FACILITIES_BONUS_DECAY = 1;
// The user needs this share of the cost in cash to start a project
export const PROJECT_START_CASH_SHARE = 0.25;

export type OwnerProject = {
	type: OwnerProjectType;
	// First season of payments
	startSeason: number;
	cost: number;
	paid: number;
};

export type OwnerOfficeTeam = {
	active?: OwnerProject;
	completed: { type: OwnerProjectType; season: number }[];
	// Facilities levels from completed projects (added to the facilities level of the last three seasons)
	facilitiesBonus: number;
};

export type OwnerGoals = {
	// Payroll the owner is willing to carry (thousands)
	maxPayroll: number;
	taxWilling: boolean;
	// Millions of dollars, like the profit in team.getFormatted
	profitTarget: number;
	winTarget: number;
	// Set at season end (user's team)
	result?: {
		won: number;
		profit: number;
		payroll: number;
		scores: { wins: number; profit: number; payroll: number };
		moodDeltas: { wins: number; money: number };
	};
};

const clamp = (x: number, min: number, max: number) =>
	Math.min(max, Math.max(min, x));

export const projectCost = (type: OwnerProjectType, salaryCap: number) =>
	Math.round(OWNER_PROJECTS[type].costCaps * salaryCap);

// One regular season game's payment, never past the cost
export const projectGamePayment = (project: OwnerProject, numGames: number) => {
	const perGame =
		project.cost /
		(OWNER_PROJECTS[project.type].seasons * Math.max(1, numGames));
	return Math.max(0, Math.min(perGame, project.cost - project.paid));
};

// Is the project done once `season` starts?
export const projectDone = (project: OwnerProject, season: number) =>
	season - project.startSeason >= OWNER_PROJECTS[project.type].seasons;

// Market factor: 1 for the biggest market, 0 for the smallest (0.5 in a one-team league)
export const marketFactor = (popRank: number, numTeams: number) =>
	numTeams > 1 ? clamp(1 - (popRank - 1) / (numTeams - 1), 0, 1) : 0.5;

// The preseason budget meeting. No random draws: market size, cash and last season's record
export const computeOwnerGoals = ({
	popRank,
	numTeams,
	cash,
	salaryCap,
	salaryCapScale,
	luxuryPayroll,
	numGames,
	prevWinPct,
}: {
	popRank: number;
	numTeams: number;
	cash: number;
	salaryCap: number;
	// salaryCap / sport's default cap, as in updateOwnerMood
	salaryCapScale: number;
	luxuryPayroll: number;
	numGames: number;
	prevWinPct: number | undefined;
}): OwnerGoals => {
	const market = marketFactor(popRank, numTeams);
	const cashCaps = salaryCap > 0 ? cash / salaryCap : 0;
	const maxPayroll = Math.round(
		luxuryPayroll * (0.93 + 0.12 * market + 0.03 * clamp(cashCaps - 1, -1, 1)),
	);
	const taxWilling = maxPayroll > luxuryPayroll;
	const profitTarget =
		Math.round(
			10 *
				salaryCapScale *
				(10 +
					10 * market +
					5 * clamp(1 - cashCaps, 0, 2) -
					(taxWilling ? 5 : 0)),
		) / 10;
	const winPct = clamp(
		(prevWinPct ?? 0.5) + 0.03 + 0.05 * (market - 0.5),
		0.3,
		0.7,
	);
	return {
		maxPayroll,
		taxWilling,
		profitTarget,
		winTarget: Math.round(winPct * numGames),
	};
};

// Weight of each goal score (-1 to 1) in owner mood: a small, bounded effect next to the main formula
export const OWNER_GOAL_WEIGHT = 0.05;

export const evaluateOwnerGoals = (
	goals: OwnerGoals,
	{
		won,
		profit,
		payroll,
		numGames,
		salaryCapScale,
		luxuryPayroll,
		budget,
	}: {
		won: number;
		profit: number;
		payroll: number;
		numGames: number;
		salaryCapScale: number;
		luxuryPayroll: number;
		budget: boolean;
	},
): NonNullable<OwnerGoals["result"]> => {
	const scores = {
		wins: clamp((won - goals.winTarget) / (0.1 * Math.max(1, numGames)), -1, 1),
		profit: budget
			? clamp(
					(profit - goals.profitTarget) / (15 * Math.max(salaryCapScale, 1e-6)),
					-1,
					1,
				)
			: 0,
		payroll:
			payroll > goals.maxPayroll
				? -clamp(
						(payroll - goals.maxPayroll) / (0.1 * Math.max(1, luxuryPayroll)),
						0,
						1,
					)
				: 0,
	};
	return {
		won,
		profit,
		payroll,
		scores,
		moodDeltas: {
			wins: OWNER_GOAL_WEIGHT * scores.wins,
			money: OWNER_GOAL_WEIGHT * clamp(scores.profit + scores.payroll, -1, 1),
		},
	};
};
