// Front Office Budget (League Extra "frontOffice", basketball): six departments funded from an owner-set envelope, and their bounded
// effects. Pure functions shared by the worker (effects, AI allocation, owner mood) and the UI (Team Finances sliders and effect lines).
// See docs/native-features.md, "Front Office Budget".
//
// Every effect reads levelToEffect of the department's level (the 3-season average, like the other budget items): 0 at DEFAULT_LEVEL
// (34, the league-average spend), linear below it and tanh (diminishing returns) above it, so the league as a whole is neutral at average
// spending and the top of the scale buys less than the bottom costs.

import {
	BUDGET_LEVEL_SCALE,
	DEFAULT_LEVEL,
	MAX_LEVEL,
	healthEffect,
	levelToAmount,
	levelToEffect,
} from "./budgetLevels.ts";

// The two new departments (stored in t.frontOffice and teamSeason.frontOffice). Medical is the existing health budget item, Scouting,
// Coaching and Facilities are the existing ones
export type FrontOfficeNewKey = "analytics" | "travel";
export const FRONT_OFFICE_NEW_KEYS: readonly FrontOfficeNewKey[] = [
	"analytics",
	"travel",
];

export type FrontOfficeDept =
	| "scouting"
	| "analytics"
	| "health"
	| "travel"
	| "coaching"
	| "facilities";

export const FRONT_OFFICE_DEPTS: readonly FrontOfficeDept[] = [
	"scouting",
	"analytics",
	"health",
	"travel",
	"coaching",
	"facilities",
];

export const FRONT_OFFICE_DEPT_NAMES: Record<FrontOfficeDept, string> = {
	scouting: "Scouting",
	analytics: "Analytics",
	health: "Medical",
	travel: "Travel & Sports Science",
	coaching: "Coaching",
	facilities: "Facilities",
};

// Cost of a level relative to the old budget items (levelToAmount). Analytics and sports science departments are smaller than a
// coaching or medical staff
export const DEPT_COST_SCALE: Record<FrontOfficeDept, number> = {
	scouting: 1,
	analytics: 0.4,
	health: 1,
	travel: 0.4,
	coaching: 1,
	facilities: 1,
};

export const deptAmount = (
	dept: FrontOfficeDept,
	level: number,
	salaryCap: number,
) => DEPT_COST_SCALE[dept] * levelToAmount(level, salaryCap);

// What the two new departments cost a team at the league-average level, per season (thousands of dollars). The owner's profit
// expectation is lowered by this much, so owner mood is neutral at average spending
export const newDeptsAverageAmount = (salaryCap: number) =>
	FRONT_OFFICE_NEW_KEYS.reduce(
		(sum, key) => sum + deptAmount(key, DEFAULT_LEVEL, salaryCap),
		0,
	);

// ---------------------------------------------------------------------------------------------------------------------------------
// Owner's envelope

// Inverse of levelToEffect
export const effectToLevel = (effect: number) => {
	const x =
		effect > 0
			? Math.atanh(Math.min(effect / BUDGET_LEVEL_SCALE, 0.999))
			: effect / BUDGET_LEVEL_SCALE;
	return Math.max(
		1,
		Math.min(MAX_LEVEL, Math.round(((x + 1) * (MAX_LEVEL - 1)) / 3 + 1)),
	);
};

// The average level the owner funds, by market size (population rank), like defaultBudgetLevel without its random part: the biggest
// market funds about level 60, the smallest about 10, the middle 34
export const ownerTargetLevel = (popRank: number, numTeams: number) => {
	if (numTeams <= 1) {
		return DEFAULT_LEVEL;
	}
	const scaledRank =
		BUDGET_LEVEL_SCALE * ((2 * (numTeams - popRank)) / (numTeams - 1) - 1);
	return effectToLevel(
		Math.max(
			-BUDGET_LEVEL_SCALE * 0.98,
			Math.min(BUDGET_LEVEL_SCALE * 0.98, 0.95 * scaledRank),
		),
	);
};

// The owner's front office envelope per season (thousands of dollars): every department at his target level
// (withoutCoaching: with the coaching staff on, coaching is its staff's salaries, which the budget doesn't set, so it is outside the
// envelope and the spending measured against it)
export const envelopeAmount = (
	targetLevel: number,
	salaryCap: number,
	withoutCoaching = false,
) =>
	FRONT_OFFICE_DEPTS.reduce(
		(sum, dept) =>
			withoutCoaching && dept === "coaching"
				? sum
				: sum + deptAmount(dept, targetLevel, salaryCap),
		0,
	);

// Owner mood (money) lost per season for spending over the envelope: this much per 100% over, after a small tolerance
export const OVERSPEND_TOLERANCE = 0.02;
export const OVERSPEND_MOOD = 0.75;
export const overspendMoodPenalty = (spent: number, envelope: number) => {
	if (envelope <= 0) {
		return 0;
	}
	const over = spent / envelope - 1 - OVERSPEND_TOLERANCE;
	return over > 0 ? OVERSPEND_MOOD * over : 0;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Effects

const clamp = (x: number, lo: number, hi: number) =>
	Math.max(lo, Math.min(hi, x));

// Scouting with Draft Lottery Night & Combine: the scouting level (3-season average) at which your scouts read the combine early
export const EARLY_COMBINE_LEVEL = 55;

// Medical (the health budget): injury durations keep the existing healthEffect (-12% at the top to +13% at the bottom). The department
// adds a lower injury rate (in-game injuries, -7% to +8%) and faster recovery for players 30 and older (another -10% to +11% of the
// duration, fully from age 34)
export const MEDICAL_RATE = 0.07;
export const MEDICAL_OLD_DURATION = 0.1;
export const medicalInjuryRateFactor = (level: number) =>
	1 - MEDICAL_RATE * levelToEffect(level);
export const medicalAgeDurationFactor = (level: number, age: number) =>
	1 - MEDICAL_OLD_DURATION * levelToEffect(level) * clamp((age - 29) / 5, 0, 1);

// Travel & Sports Science: scales the fatigue penalties of travel and 3 games in 4 nights (Load, Fatigue & Venue) and of back-to-backs
// (Injury Depth), 0.5x at the top to 1.5x at the bottom. With neither feature on, a small endurance effect instead (+-1.5%)
export const TRAVEL_PENALTY = 0.45;
export const TRAVEL_FALLBACK = 0.015;
export const travelPenaltyScale = (level: number) =>
	1 - TRAVEL_PENALTY * levelToEffect(level);
export const travelEnduranceFallback = (level: number) =>
	1 + TRAVEL_FALLBACK * levelToEffect(level);

// Analytics: the head coach's game management (Coaching Systems, 0-100 rating, +-12 points; the league is centered again afterwards),
// an AI GM's lean toward analytics (+-0.3 on his -1 to 1 trait), and the user's projection ranges (width 0.65x at the top to 1.4x at
// the bottom, and that share of the scouting fuzz left in the center)
export const ANALYTICS_MGMT = 12;
export const ANALYTICS_GM = 0.3;
export const ANALYTICS_WIDTH = 0.35;
export const analyticsMgmtBoost = (level: number) =>
	ANALYTICS_MGMT * levelToEffect(level);
export const analyticsGmShift = (level: number) =>
	ANALYTICS_GM * levelToEffect(level);
// Realistic Rotations with Coaching Systems: the coach's youth/veteran bias in the minutes plan, 0.6x at the top to 1.45x at the bottom
export const ANALYTICS_ROTATION = 0.4;
export const analyticsRotationBias = (level: number) =>
	1 - ANALYTICS_ROTATION * levelToEffect(level);
export const analyticsWidthFactor = (level: number) =>
	clamp(1 - ANALYTICS_WIDTH * levelToEffect(level), 0.5, 1.5);

// Expected change in ovr over the next season by age, and the 80% band of it at an average analytics department (BBGM's progression
// spread: wide for young players)
const AGE_DELTA: [number, number][] = [
	[19, 4.5],
	[21, 3.8],
	[23, 2.4],
	[25, 1.2],
	[27, 0],
	[29, -0.9],
	[31, -2],
	[33, -3.2],
	[36, -4.5],
];
const interp = (table: [number, number][], x: number) => {
	if (x <= table[0]![0]) {
		return table[0]![1];
	}
	for (let i = 1; i < table.length; i++) {
		const [x1, y1] = table[i]!;
		const [x0, y0] = table[i - 1]!;
		if (x <= x1) {
			return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
		}
	}
	return table.at(-1)![1];
};
export const projectionBaseHalfWidth = (age: number) =>
	interp(
		[
			[19, 7],
			[23, 5.5],
			[27, 4],
			[31, 4],
			[35, 5],
		],
		age,
	);

// The user's analytics department's projection of a player's ovr next season. ovr is what the user sees (with scouting fuzz), fuzz is
// that fuzz (0 for his own players): a better department sees through part of it and gives a narrower band
export const analyticsProjection = ({
	ovr,
	fuzz,
	age,
	level,
}: {
	ovr: number;
	fuzz: number;
	age: number;
	level: number;
}) => {
	const w = analyticsWidthFactor(level);
	const trueOvr = ovr - fuzz;
	const mid = trueOvr + w * fuzz + interp(AGE_DELTA, age);
	const half = projectionBaseHalfWidth(age) * w;
	return {
		lo: Math.max(0, Math.round(mid - half)),
		mid: Math.round(mid),
		hi: Math.min(100, Math.round(mid + half)),
	};
};

// ---------------------------------------------------------------------------------------------------------------------------------
// AI allocation

// Leanings, each -1 to 1: analytics (analytics GM vs old-school), patience (rebuilding vs win-now). Weights multiply the team's target
// level; their mean is 1 so the total spend stays the same
export const aiDeptWeights = (
	{ analytics, patience }: { analytics: number; patience: number },
	depts: readonly FrontOfficeDept[],
) => {
	const raw: Record<FrontOfficeDept, number> = {
		analytics: 1 + 0.45 * analytics - 0.1 * patience,
		scouting: 1 - 0.2 * analytics + 0.25 * patience,
		health: 1 - 0.2 * patience + 0.05 * analytics,
		travel: 1 - 0.2 * patience + 0.15 * analytics,
		coaching: 1 + 0.15 * patience,
		facilities: 1 - 0.05 * patience - 0.1 * analytics,
	};
	let sum = 0;
	for (const dept of depts) {
		sum += raw[dept];
	}
	const mean = sum / depts.length;
	const out = {} as Record<FrontOfficeDept, number>;
	for (const dept of depts) {
		out[dept] = raw[dept] / mean;
	}
	return out;
};

export const aiAllocate = (
	targetLevel: number,
	leanings: { analytics: number; patience: number },
	depts: readonly FrontOfficeDept[],
) => {
	const weights = aiDeptWeights(leanings, depts);
	const out = {} as Record<FrontOfficeDept, number>;
	for (const dept of depts) {
		out[dept] = clamp(Math.round(targetLevel * weights[dept]), 1, MAX_LEVEL);
	}
	return out;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// One-line effect descriptions for Team Finances

const pct = (x: number) => {
	const r = Math.round(x * 10) / 10;
	return `${r > 0 ? "+" : ""}${r}%`;
};

export const deptEffectLine = (
	dept: FrontOfficeDept,
	level: number,
	{
		scouts,
		scheduleLoad,
		injuryDepth,
		coachSystems,
		combine,
	}: {
		combine?: boolean;
		scouts?: number;
		scheduleLoad?: boolean;
		injuryDepth?: boolean;
		coachSystems?: boolean;
	} = {},
) => {
	const e = levelToEffect(level);
	if (dept === "scouting") {
		return `${scouts !== undefined ? `${scouts} scouts, ` : ""}prospect rating error ${pct(-100 * (e / 2))}${combine && level >= EARLY_COMBINE_LEVEL ? ", early combine read" : ""}`;
	}
	if (dept === "analytics") {
		const parts = [
			`projection ranges ${pct(100 * (analyticsWidthFactor(level) - 1))}`,
		];
		if (coachSystems) {
			const m = Math.round(analyticsMgmtBoost(level));
			parts.push(`coach game management ${m >= 0 ? "+" : ""}${m}`);
		}
		return parts.join(", ");
	}
	if (dept === "health") {
		return `injury duration ${pct(100 * healthEffect(level))}, injury rate ${pct(100 * (medicalInjuryRateFactor(level) - 1))}, 30+ recovery ${pct(100 * (medicalAgeDurationFactor(level, 34) - 1))}`;
	}
	if (dept === "travel") {
		if (scheduleLoad || injuryDepth) {
			return `travel and ${scheduleLoad ? "back-to-back/3-in-4" : "back-to-back"} fatigue ${pct(100 * (travelPenaltyScale(level) - 1))}`;
		}
		return `endurance ${pct(100 * (travelEnduranceFallback(level) - 1))}`;
	}
	if (dept === "coaching") {
		return `progression ${pct(100 * 0.09 * e)}`;
	}
	return `player mood ${e >= 0 ? "+" : ""}${Math.round(20 * e) / 10}, ticket demand ${pct(3.75 * e)}`;
};
