// Owner's Office (League Extra "ownerOffice"): the owner as a person. A name, the season he bought the team and four personality
// traits, seeded per owner (team and first season of ownership), that modify the owner mood and the budget meeting in small, bounded
// ways, plus his mid-season requests, ultimatums and mandates. Pure formulas here; the worker side is worker/core/ownerOffice/owner.ts.

import { makeSeededRandom } from "./random.ts";
import type { OwnerMood } from "./types.ts";

// Each trait runs 0 to 1, 0.5 average
export type OwnerTraits = {
	// Sets the firing line (and, when very patient, an extra season before he fires anyone)
	patience: number;
	// How often he makes mid-season requests, ultimatums and mandates
	meddling: number;
	// How he takes it when the franchise player is traded or released
	starLoyalty: number;
	// How much luxury tax he will stomach (payroll ceiling; AI budgets)
	taxAppetite: number;
};

export type OwnerTraitKey = keyof OwnerTraits;

export const OWNER_TRAIT_KEYS: OwnerTraitKey[] = [
	"patience",
	"meddling",
	"starLoyalty",
	"taxAppetite",
];

export const OWNER_TRAIT_INFO: Record<
	OwnerTraitKey,
	{ name: string; low: string; high: string; description: string }
> = {
	patience: {
		name: "Patience",
		low: "Impatient",
		high: "Patient",
		description:
			"Where the firing line is (an overall mood of -0.75 for the least patient owner, -1.25 for the most), how big his ultimatums' stakes are, and a very patient owner (0.7+) gives you one extra season before he can fire you.",
	},
	meddling: {
		name: "Meddling",
		low: "Hands-off",
		high: "Meddler",
		description:
			"How often he makes mid-season requests, ultimatums and mandates (at most 1, 2 or 3 a season).",
	},
	starLoyalty: {
		name: "Loyalty to stars",
		low: "Business first",
		high: "Loves his stars",
		description:
			"How badly he takes trading or releasing the franchise player during the season.",
	},
	taxAppetite: {
		name: "Luxury tax appetite",
		low: "Tax-averse",
		high: "Will pay tax",
		description:
			"Moves his payroll ceiling up to 4% either way (AI teams: their budget a level either way at the extremes).",
	},
};

export type OwnerProfile = {
	name: string;
	// First season of his ownership
	since: number;
	traits: OwnerTraits;
};

const FIRST_NAMES = [
	"Arthur",
	"Beatrice",
	"Carl",
	"Diane",
	"Edward",
	"Frances",
	"George",
	"Helen",
	"Irving",
	"Joan",
	"Kenneth",
	"Linda",
	"Martin",
	"Nora",
	"Oscar",
	"Patricia",
	"Richard",
	"Sandra",
	"Thomas",
	"Vivian",
	"Walter",
	"Yvonne",
];

const LAST_NAMES = [
	"Ashworth",
	"Bellamy",
	"Castellano",
	"Delacroix",
	"Eastman",
	"Fairbanks",
	"Goldberg",
	"Hargrove",
	"Iverson",
	"Kensington",
	"Lockhart",
	"Montague",
	"Nakamura",
	"Okafor",
	"Pemberton",
	"Quintero",
	"Rothschild",
	"Sterling",
	"Thornton",
	"Vanderbilt",
	"Whitmore",
	"Yamamoto",
];

const round2 = (x: number) => Math.round(x * 100) / 100;

const clamp = (x: number, min: number, max: number) =>
	Math.min(max, Math.max(min, x));

// Seeded by team and first season of ownership only, so an existing league (or a lost profile) derives the same owner again
export const ownerProfileSeed = (tid: number, since: number) =>
	tid * 7368787 + since * 2750159 + 4241;

export const genOwnerProfile = (tid: number, since: number): OwnerProfile => {
	const rng = makeSeededRandom(ownerProfileSeed(tid, since));
	const name = `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]!} ${
		LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]!
	}`;
	// Average of two draws: most owners are near the middle, a few are extreme
	const trait = () => round2((rng() + rng()) / 2);
	return {
		name,
		since,
		traits: {
			patience: trait(),
			meddling: trait(),
			starLoyalty: trait(),
			taxAppetite: trait(),
		},
	};
};

export const traitLabel = (key: OwnerTraitKey, value: number) => {
	const info = OWNER_TRAIT_INFO[key];
	if (value < 0.35) {
		return info.low;
	}
	if (value > 0.65) {
		return info.high;
	}
	return "Average";
};

// The overall owner mood (wins + playoffs + money) at or below which he fires the GM. Stock BBGM: -1
export const firingLine = (traits: OwnerTraits) =>
	round2(-1 - 0.5 * (clamp(traits.patience, 0, 1) - 0.5));

// Seasons after the grace period before he can fire the GM (mood still counts from the end of the grace period)
export const patienceGraceBonus = (traits: OwnerTraits) =>
	traits.patience >= 0.7 ? 1 : 0;

// Multiplier of his ultimatums' stakes: 0.75 (patient) to 1.25 (impatient)
export const stakeScale = (traits: OwnerTraits) =>
	1.25 - 0.5 * clamp(traits.patience, 0, 1);

// Budget meeting: payroll ceiling multiplier (±4%) and win target shift (winning percentage, ±2%)
export const traitPayrollFactor = (traits: OwnerTraits) =>
	1 + 0.08 * (clamp(traits.taxAppetite, 0, 1) - 0.5);
export const traitWinPctShift = (traits: OwnerTraits) =>
	-0.04 * (clamp(traits.patience, 0, 1) - 0.5);

// AI teams: budget levels added to the AI's spending (-1, 0 or +1) and a multiplier of the chance to start a project (0.75 to 1.25)
export const traitAiBudgetNudge = (traits: OwnerTraits) =>
	Math.round(2 * (clamp(traits.taxAppetite, 0, 1) - 0.5));
export const traitAiProjectFactor = (traits: OwnerTraits) =>
	0.75 + 0.5 * clamp(traits.patience, 0, 1);

// Mid-season requests: the most per season and the chance of each eligible one
export const maxRequests = (traits: OwnerTraits) =>
	traits.meddling < 0.3 ? 1 : traits.meddling < 0.7 ? 2 : 3;
export const requestProb = (traits: OwnerTraits) =>
	0.2 + 0.6 * clamp(traits.meddling, 0, 1);

// Trading or releasing the franchise player during the season (no "keep him" request out), wins part of the mood
export const starTradePenalty = (traits: OwnerTraits) =>
	round2(0.04 + 0.12 * clamp(traits.starLoyalty, 0, 1));

export type OwnerMoodComponent = keyof OwnerMood;

export type OwnerRequestKind =
	| "makePlayoffs"
	| "cutPayroll"
	| "keepStar"
	| "playYoung"
	| "ticketFreeze"
	| "keepFanFavorite";

export const OWNER_REQUESTS: Record<
	OwnerRequestKind,
	{
		title: string;
		// Mandates: moves the owner made himself, which the user can override for a mood cost
		mandate: boolean;
		component: OwnerMoodComponent;
		// Mood change if met / if missed or overridden, before stakeScale
		reward: number;
		penalty: number;
	}
> = {
	makePlayoffs: {
		title: "Make the playoffs or you're out",
		mandate: false,
		component: "playoffs",
		reward: 0.05,
		penalty: 0.25,
	},
	cutPayroll: {
		title: "Cut payroll",
		mandate: false,
		component: "money",
		reward: 0.03,
		penalty: 0.12,
	},
	keepStar: {
		title: "Don't trade our franchise player",
		mandate: false,
		component: "wins",
		reward: 0.03,
		penalty: 0.15,
	},
	playYoung: {
		title: "Play the young guys",
		mandate: false,
		component: "wins",
		reward: 0.04,
		penalty: 0.06,
	},
	ticketFreeze: {
		title: "Ticket prices are frozen",
		mandate: true,
		component: "money",
		reward: 0,
		penalty: 0.04,
	},
	keepFanFavorite: {
		title: "Keep the fan favorite",
		mandate: true,
		component: "wins",
		reward: 0,
		penalty: 0.05,
	},
};

export type OwnerRequestStatus = "open" | "met" | "missed" | "overridden";

export type OwnerRequest = {
	id: number;
	kind: OwnerRequestKind;
	// Team games played when it was made
	issuedGp: number;
	// When it is judged: at the trade deadline, or at the end of the season (keep/mandate requests can fail earlier)
	due: "tradeDeadline" | "seasonEnd";
	// The mood stake, already scaled by the owner's patience
	reward: number;
	penalty: number;
	// cutPayroll: payroll (thousands); ticketFreeze: ticket price; playYoung: minutes per game each
	target?: number;
	// keepStar, keepFanFavorite: the player; playYoung: the young players and their minutes when it was made
	pid?: number;
	playerName?: string;
	young?: { pid: number; name: string; min: number }[];
	status: OwnerRequestStatus;
	// The mood change it caused once resolved (signed)
	delta?: number;
	note?: string;
};

export type OwnerAdjustment = {
	text: string;
	component: OwnerMoodComponent;
	delta: number;
};

// Per season (teamSeason.ownerSeason, user's team)
export type OwnerSeasonState = {
	// The franchise player at the start of the season
	franchisePid?: number;
	franchiseName?: string;
	// Set once his departure was charged
	franchiseGone?: boolean;
	// Checkpoints (1, 2) already run
	checkpoints: number[];
	requests: OwnerRequest[];
	adjustments: OwnerAdjustment[];
};

// Requests, ultimatums and the star trade reaction together move the mood at most this much in a season
export const ADJUSTMENT_MIN = -0.5;
export const ADJUSTMENT_MAX = 0.2;

// Checkpoints in the regular season (share of games played) where the owner may make requests
export const REQUEST_CHECKPOINTS = [0.25, 0.5];

export const makeRequest = (
	kind: OwnerRequestKind,
	traits: OwnerTraits,
	rest: Omit<OwnerRequest, "kind" | "reward" | "penalty" | "status">,
): OwnerRequest => {
	const def = OWNER_REQUESTS[kind];
	const scale = def.mandate ? 1 : stakeScale(traits);
	const extra = kind === "keepStar" ? 0.1 * clamp(traits.starLoyalty, 0, 1) : 0;
	return {
		...rest,
		kind,
		reward: round2(def.reward * scale),
		penalty: round2((def.penalty + extra) * scale),
		status: "open",
	};
};

// Resolve a request: its status and the adjustment it adds
export const resolveRequest = (
	request: OwnerRequest,
	status: Exclude<OwnerRequestStatus, "open">,
	note: string,
): OwnerAdjustment => {
	const def = OWNER_REQUESTS[request.kind];
	request.status = status;
	request.note = note;
	request.delta = status === "met" ? request.reward : -request.penalty;
	return {
		text: `${def.title}: ${status === "met" ? "done" : status === "overridden" ? "overridden" : "missed"}`,
		component: def.component,
		delta: request.delta,
	};
};

// Sum of a season's adjustments by mood component, with the total bounded (scaled down proportionally when over)
export const sumAdjustments = (adjustments: OwnerAdjustment[]): OwnerMood => {
	const sums: OwnerMood = { wins: 0, playoffs: 0, money: 0 };
	for (const a of adjustments) {
		sums[a.component] += a.delta;
	}
	const neg =
		Math.min(0, sums.wins) +
		Math.min(0, sums.playoffs) +
		Math.min(0, sums.money);
	const pos =
		Math.max(0, sums.wins) +
		Math.max(0, sums.playoffs) +
		Math.max(0, sums.money);
	const negScale = neg < ADJUSTMENT_MIN ? ADJUSTMENT_MIN / neg : 1;
	const posScale = pos > ADJUSTMENT_MAX ? ADJUSTMENT_MAX / pos : 1;
	for (const key of ["wins", "playoffs", "money"] as const) {
		sums[key] *= sums[key] < 0 ? negScale : posScale;
	}
	return sums;
};

export type JobOutlook = "grace" | "safe" | "warm" | "hot" | "fired";

export const JOB_OUTLOOK_NAMES: Record<JobOutlook, string> = {
	grace: "Safe (too early to judge)",
	safe: "Safe",
	warm: "Warm seat",
	hot: "Hot seat",
	fired: "Likely fired",
};

// The call from the projected overall mood after this season's evaluation and the owner's firing line
export const jobOutlook = ({
	projectedTotal,
	line,
	canFire,
}: {
	projectedTotal: number;
	line: number;
	canFire: boolean;
}): JobOutlook => {
	if (!canFire) {
		return "grace";
	}
	if (projectedTotal <= line) {
		return "fired";
	}
	if (projectedTotal <= line + 0.35) {
		return "hot";
	}
	if (projectedTotal <= line + 1) {
		return "warm";
	}
	return "safe";
};
