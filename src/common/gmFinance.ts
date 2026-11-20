// AI GM finance styles (core "gmFinance", with AI GM Personalities and the budget): each AI GM has a fixed finance leaning that decides
// how he runs the team's money inside the owner's envelope: budget levels per department, ticket price, luxury tax willingness, free
// agency targets, arena/facilities projects and commercial deal style. Pure helpers shared by worker and UI; worker side in
// worker/core/gm/finance.ts. Every effect is a bounded tweak of the existing AI logic, and the styles roughly cancel league-wide.
//
// The style is drawn from a seeded stream keyed on the GM's id (and the league salt), weighted by his personality traits, so it is
// stable, never moves the main random stream, and an existing GM without one gets the same style whenever it is derived.
import type { DealStyle, OwnerType } from "./commercial.ts";
import type { FrontOfficeDept } from "./frontOffice.ts";
import { saltedSeed } from "./leagueSalt.ts";
import { makeSeededRandom } from "./random.ts";
import type { GmTraits } from "./types.gm.ts";

export type GmFinanceStyle =
	| "spendthrift"
	| "frugal"
	| "analytics"
	| "development"
	| "facilities"
	| "balanced";

export type GmFinanceProfile = {
	// Budget levels added to the owner's spending level (before it's split over the departments)
	spend: number;
	// Shift of the GM's luxury tax tolerance trait (re-signing into the tax, cap exceptions, contract weights, salary dumps)
	tax: number;
	// Shift of the GM's free agency trait (star hunter vs depth builder)
	faStars: number;
	// Multiplier on the AI's automatic ticket price
	ticket: number;
	// Department weight multipliers (renormalized so they only move money between departments)
	dept: Partial<Record<FrontOfficeDept, number>>;
	// Multiplier on the chance an AI team starts an arena/facilities project, and the cash reserve he wants left (salary caps)
	projectProb: number;
	projectReserve: number;
	// Preferred sponsorship/local TV deal style, if any
	dealStyle?: DealStyle;
};

export const GM_FINANCE_STYLES: Record<
	GmFinanceStyle,
	{
		name: string;
		// "a frugal GM"
		adjective: string;
		description: string;
		profile: GmFinanceProfile;
	}
> = {
	spendthrift: {
		name: "Spendthrift",
		adjective: "big-spending",
		description:
			"Spends to the top of the owner's budget, pays luxury tax to keep and add talent, chases star free agents, keeps tickets a bit cheaper and bets on performance-based sponsorship deals.",
		profile: {
			spend: 6,
			tax: 0.4,
			faStars: 0.2,
			ticket: 0.96,
			dept: {},
			projectProb: 1.4,
			projectReserve: 1,
			dealStyle: "short",
		},
	},
	frugal: {
		name: "Frugal",
		adjective: "frugal",
		description:
			"Runs the team for the bottom line: low budgets, avoids the luxury tax, looks for value in free agency, charges more for tickets, rarely builds and prefers long, safe deals.",
		profile: {
			spend: -6,
			tax: -0.4,
			faStars: -0.2,
			ticket: 1.06,
			dept: {},
			projectProb: 0.5,
			projectReserve: 1.5,
			dealStyle: "long",
		},
	},
	analytics: {
		name: "Analytics-first",
		adjective: "analytics-first",
		description:
			"Pours money into analytics (and some into scouting and sports science) and keeps coaching and facilities lean; prices tickets a little higher.",
		profile: {
			spend: 0,
			tax: 0,
			faStars: 0,
			ticket: 1.02,
			dept: {
				analytics: 1.6,
				scouting: 1.1,
				travel: 1.1,
				coaching: 0.8,
				facilities: 0.8,
			},
			projectProb: 1,
			projectReserve: 1,
		},
	},
	development: {
		name: "Player development",
		adjective: "development-minded",
		description:
			"Spends on coaching and facilities to grow players, less on analytics and travel; a little warier of the luxury tax and likes stable long-term deals.",
		profile: {
			spend: 0,
			tax: -0.1,
			faStars: -0.1,
			ticket: 1,
			dept: {
				coaching: 1.35,
				facilities: 1.3,
				scouting: 1.1,
				analytics: 0.85,
				travel: 0.85,
			},
			projectProb: 1.2,
			projectReserve: 1,
			dealStyle: "long",
		},
	},
	facilities: {
		name: "Facilities builder",
		adjective: "facilities-building",
		description:
			"Builds: a big facilities budget, starts arena and facilities projects much more often (with less cash in reserve), and prices tickets a little higher to pay for them.",
		profile: {
			spend: 0,
			tax: 0,
			faStars: 0,
			ticket: 1.03,
			dept: {
				facilities: 1.45,
				health: 1.05,
				analytics: 0.9,
				scouting: 0.9,
			},
			projectProb: 2.4,
			projectReserve: 0.5,
			dealStyle: "long",
		},
	},
	balanced: {
		name: "Balanced",
		adjective: "balanced",
		description:
			"Spends what the owner budgets, spread evenly, at the usual ticket prices and tax willingness.",
		profile: {
			spend: 0,
			tax: 0,
			faStars: 0,
			ticket: 1,
			dept: {},
			projectProb: 1,
			projectReserve: 1,
		},
	},
};

export const GM_FINANCE_STYLE_KEYS = Object.keys(
	GM_FINANCE_STYLES,
) as GmFinanceStyle[];

export const isGmFinanceStyle = (x: unknown): x is GmFinanceStyle =>
	typeof x === "string" && Object.hasOwn(GM_FINANCE_STYLES, x);

// Relative chance of each style, from the GM's traits: tax-tolerant (and win-now) GMs lean spendthrift, tax-averse ones frugal, analytics
// GMs analytics-first, patient ones player development
export const gmFinanceStyleWeights = (
	traits: Pick<GmTraits, "taxTolerance" | "analytics" | "patience">,
): Record<GmFinanceStyle, number> => {
	const pos = (x: number) => Math.max(0, x);
	return {
		spendthrift:
			0.8 + 2 * pos(traits.taxTolerance) + 0.6 * pos(-traits.patience),
		frugal: 0.8 + 2 * pos(-traits.taxTolerance),
		analytics: 0.7 + 2.2 * pos(traits.analytics),
		development: 0.7 + 1.8 * pos(traits.patience),
		facilities: 0.7,
		balanced: 1.4,
	};
};

// The GM's style, drawn from a stream seeded by his id (and the league salt)
export const genGmFinanceStyle = (gm: {
	gmid: number;
	traits: Pick<GmTraits, "taxTolerance" | "analytics" | "patience">;
}): GmFinanceStyle => {
	const rng = makeSeededRandom(
		saltedSeed((Math.imul(gm.gmid + 1, 0x2f6b4c1d) ^ 0x6d5f17a3) >>> 0),
	);
	// Warm up the stream (mulberry32's first value from nearby seeds is correlated)
	rng();
	const weights = gmFinanceStyleWeights(gm.traits);
	let total = 0;
	for (const key of GM_FINANCE_STYLE_KEYS) {
		total += weights[key];
	}
	let r = rng() * total;
	for (const key of GM_FINANCE_STYLE_KEYS) {
		r -= weights[key];
		if (r < 0) {
			return key;
		}
	}
	return "balanced";
};

export const getGmFinanceStyle = (gm: {
	gmid: number;
	traits: GmTraits;
	financeStyle?: GmFinanceStyle;
}) =>
	isGmFinanceStyle(gm.financeStyle) ? gm.financeStyle : genGmFinanceStyle(gm);

// The owner sets the envelope, the GM decides within it: where they conflict, the owner's type wins. A bottom line owner gets no extra
// spending, tax, cheaper tickets or extra projects from his GM; a big spender or win-now owner no cuts in spending or tax willingness
export const effectiveGmFinanceProfile = (
	style: GmFinanceStyle,
	ownerType: OwnerType,
): GmFinanceProfile => {
	const base = GM_FINANCE_STYLES[style].profile;
	const p: GmFinanceProfile = { ...base, dept: { ...base.dept } };
	if (ownerType === "profit") {
		p.spend = Math.min(0, p.spend);
		p.tax = Math.min(0, p.tax);
		p.faStars = Math.min(0, p.faStars);
		p.ticket = Math.max(1, p.ticket);
		p.projectProb = Math.min(1, p.projectProb);
		p.projectReserve = Math.max(1, p.projectReserve);
	} else if (ownerType === "spendHappy" || ownerType === "winNow") {
		p.spend = Math.max(0, p.spend);
		p.tax = Math.max(0, p.tax);
		p.faStars = Math.max(0, p.faStars);
	}
	return p;
};

// Department weights times the style's multipliers, renormalized to the same mean (so the total spend is still set by the level)
export const applyDeptMultipliers = <K extends string>(
	weights: Record<K, number>,
	dept: Partial<Record<string, number>>,
	keys: readonly K[],
) => {
	let before = 0;
	let after = 0;
	const out = {} as Record<K, number>;
	for (const key of keys) {
		const w = weights[key] * (dept[key] ?? 1);
		out[key] = w;
		before += weights[key];
		after += w;
	}
	if (after > 0) {
		for (const key of keys) {
			out[key] *= before / after;
		}
	}
	return out;
};

// Bounds, so league economics stay sane whatever the profile
export const GM_FINANCE_BOUNDS = {
	spend: 8,
	tax: 0.4,
	ticketMin: 0.94,
	ticketMax: 1.07,
	projectProbMax: 0.6,
};
