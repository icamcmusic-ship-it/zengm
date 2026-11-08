// Pure helpers for the coaching staff feature, shared by worker and UI
import { BUDGET_LEVEL_SCALE, MAX_LEVEL } from "./budgetLevels.ts";
import type { CoachRatings, CoachRole, CoachStyle } from "./types.staff.ts";

export const COACH_FREE_AGENT = -1;
export const COACH_RETIRED = -3;

export const COACH_ROLES: CoachRole[] = ["head", "dev", "off", "def"];

export const COACH_ROLE_NAMES: Record<CoachRole, string> = {
	head: "Head Coach",
	dev: "Player Development",
	off: "Offensive Coordinator",
	def: "Defensive Coordinator",
};

export const COACH_ROLE_ABBREVS: Record<CoachRole, string> = {
	head: "HC",
	dev: "PD",
	off: "OC",
	def: "DC",
};

export const COACH_RATING_NAMES: Record<keyof CoachRatings, string> = {
	dev: "Player development",
	off: "Offense",
	def: "Defense",
	mot: "Motivation",
};

// How good a coach is at a given job
export const coachOvr = (ratings: CoachRatings, role: CoachRole) => {
	let ovr;
	if (role === "head") {
		ovr =
			0.3 * ratings.off +
			0.3 * ratings.def +
			0.25 * ratings.mot +
			0.15 * ratings.dev;
	} else if (role === "dev") {
		ovr = 0.8 * ratings.dev + 0.2 * ratings.mot;
	} else if (role === "off") {
		ovr = 0.8 * ratings.off + 0.2 * ratings.dev;
	} else {
		ovr = 0.8 * ratings.def + 0.2 * ratings.dev;
	}
	return Math.round(ovr);
};

// The role a coach is best suited for
export const bestRole = (ratings: CoachRatings): CoachRole => {
	let best: CoachRole = "head";
	let bestOvr = -Infinity;
	for (const role of COACH_ROLES) {
		// Head coach needs to be clearly better to count, since it's the more important job
		const ovr = coachOvr(ratings, role) - (role === "head" ? 3 : 0);
		if (ovr > bestOvr) {
			best = role;
			bestOvr = ovr;
		}
	}
	return best;
};

// Salary in thousands per season at the default $90M salary cap
const BASE_SALARY: Record<CoachRole, number> = {
	head: 5500,
	dev: 3200,
	off: 3200,
	def: 3200,
};

export const coachSalaryDemand = (
	ratings: CoachRatings,
	role: CoachRole,
	salaryCap: number,
) => {
	const ovr = coachOvr(ratings, role);
	const factor = Math.min(3, Math.max(0.3, 2 ** ((ovr - 62) / 10)));
	return Math.round((BASE_SALARY[role] * factor * salaryCap) / 90000 / 10) * 10;
};

// Value used when a staff slot is vacant
export const VACANT_RATING = 30;

// Development score of a whole staff, mostly from the player development assistant
export const staffDevScore = (
	staff: Partial<Record<CoachRole, CoachRatings>>,
) => {
	const dev = (role: CoachRole) => staff[role]?.dev ?? VACANT_RATING;
	const mot = (role: CoachRole) => staff[role]?.mot ?? VACANT_RATING;
	return (
		0.5 * dev("dev") +
		0.2 * dev("head") +
		0.1 * dev("off") +
		0.1 * dev("def") +
		0.1 * mot("head")
	);
};

// Calibration, see staff/calibration.test.ts. STAFF_DEV_SCORE_REF is roughly the league average dev score of hired staffs, so the average team gets the same development effect as the default coaching budget. STAFF_DEV_SCORE_SPREAD is the score difference that gives the maximum budget effect, chosen so the spread of effects across the league is similar to the spread of AI coaching budgets.
export const STAFF_DEV_SCORE_REF = 57;
export const STAFF_DEV_SCORE_SPREAD = 10.5;

// Inverse of levelToEffect in budgetLevels.ts
export const effectToLevel = (effect: number) => {
	const x =
		effect > 0
			? Math.atanh(effect / BUDGET_LEVEL_SCALE)
			: effect / BUDGET_LEVEL_SCALE;
	return Math.min(
		MAX_LEVEL,
		Math.max(1, Math.round(((x + 1) * (MAX_LEVEL - 1)) / 3 + 1)),
	);
};

// Translate a staff into an equivalent coaching budget level (1-100), which is what player development uses
export const staffDevScoreToLevel = (score: number) => {
	const effect = Math.min(
		0.98,
		Math.max(-0.98, (score - STAFF_DEV_SCORE_REF) / STAFF_DEV_SCORE_SPREAD),
	);
	return effectToLevel(effect * BUDGET_LEVEL_SCALE);
};

export const describeStyle = (style: CoachStyle) => {
	const parts: string[] = [];
	const add = (value: number, low: string, high: string) => {
		if (value >= 0.35) {
			parts.push(high);
		} else if (value <= -0.35) {
			parts.push(low);
		}
	};
	add(style.pace, "Slow pace", "Fast pace");
	add(style.threes, "Inside game", "Three-point heavy");
	add(style.defense, "Conservative defense", "Pressure defense");
	add(style.rotation, "Tight rotation", "Deep bench");
	return parts.length > 0 ? parts.join(", ") : "Balanced";
};
