// Commercial Deals & Ownership (League Extra "commercial", basketball, needs budget): multi-year sponsorship and local TV deals,
// league revenue sharing and ownership sales. Pure formulas here; the worker side is worker/core/commercial. Amounts in thousands of
// dollars, like the rest of the finances.

export type DealKind = "sponsor" | "localTv";
export const DEAL_KINDS: DealKind[] = ["sponsor", "localTv"];

export const DEAL_KIND_NAMES: Record<DealKind, string> = {
	sponsor: "Sponsorship",
	localTv: "Local TV",
};

// long: many years at a small discount (safe, but fixed while the cap grows). standard: fair value. short: one season, a lower base
// plus a bonus that grows with this season's winning percentage (upside)
export type DealStyle = "long" | "standard" | "short";

export const DEAL_STYLES: Record<
	DealStyle,
	{
		name: string;
		description: string;
		years: number;
		baseShare: number;
		bonusShare: number;
	}
> = {
	long: {
		name: "Long-term",
		description: "Five seasons at a fixed price. Safe, but it won't grow.",
		years: 5,
		baseShare: 0.95,
		bonusShare: 0,
	},
	standard: {
		name: "Standard",
		description: "Three seasons at market value.",
		years: 3,
		baseShare: 1,
		bonusShare: 0,
	},
	short: {
		name: "Performance",
		description:
			"One season: a lower base plus a bonus paid as you win (most at a .700 record).",
		years: 1,
		baseShare: 0.85,
		bonusShare: 0.35,
	},
};

export const DEAL_STYLE_KEYS = Object.keys(DEAL_STYLES) as DealStyle[];

export type CommercialDeal = {
	kind: DealKind;
	style: DealStyle;
	// Base value per season
	annual: number;
	// Most bonus per season (performance deals)
	bonus: number;
	years: number;
	// First season paid
	startSeason: number;
	// Partner name, for flavor
	partner: string;
};

export type OwnerType = "traditional" | "spendHappy" | "profit" | "winNow";

export const OWNER_TYPES: Record<
	OwnerType,
	{
		name: string;
		description: string;
		// Multipliers of the owner mood deltas
		moodWeights: { wins: number; playoffs: number; money: number };
		// Budget levels added to an AI team's spending
		budgetNudge: number;
		// Owner's Office: payroll ceiling multiplier and profit target change (millions, at the default cap)
		payrollFactor: number;
		profitTargetDelta: number;
		// Preferred deal style for AI teams
		dealStyle: DealStyle;
	}
> = {
	traditional: {
		name: "Traditional",
		description: "A balanced owner.",
		moodWeights: { wins: 1, playoffs: 1, money: 1 },
		budgetNudge: 0,
		payrollFactor: 1,
		profitTargetDelta: 0,
		dealStyle: "standard",
	},
	spendHappy: {
		name: "Big spender",
		description:
			"Spends freely on payroll and the budget; cares less about profit.",
		moodWeights: { wins: 1.1, playoffs: 1.1, money: 0.6 },
		budgetNudge: 8,
		payrollFactor: 1.06,
		profitTargetDelta: -5,
		dealStyle: "standard",
	},
	profit: {
		name: "Bottom line",
		description:
			"Runs the team as a business: profit counts much more, spending is tight.",
		moodWeights: { wins: 0.8, playoffs: 0.8, money: 1.5 },
		budgetNudge: -8,
		payrollFactor: 0.95,
		profitTargetDelta: 5,
		dealStyle: "long",
	},
	winNow: {
		name: "Win now",
		description: "Wants a title soon: playoff success counts most.",
		moodWeights: { wins: 1.2, playoffs: 1.4, money: 0.7 },
		budgetNudge: 4,
		payrollFactor: 1.04,
		profitTargetDelta: -3,
		dealStyle: "short",
	},
};

export const OWNER_TYPE_KEYS = Object.keys(OWNER_TYPES) as OwnerType[];

export type CommercialTeam = {
	deals: Partial<Record<DealKind, CommercialDeal>>;
	// Offers waiting for the user's choice (signed automatically at the first regular season game)
	offers?: Partial<Record<DealKind, CommercialDeal[]>>;
	ownerType?: OwnerType;
	ownerSince?: number;
	// The user's team: a sale announced a season ahead
	pendingSale?: { season: number; ownerType: OwnerType };
};

const clamp = (x: number, min: number, max: number) =>
	Math.min(max, Math.max(min, x));

// Base value per season, in salary caps, of an average deal
export const DEAL_BASE_CAPS: Record<DealKind, number> = {
	sponsor: 0.2,
	localTv: 0.22,
};

// Fair value per season: market size, recent success, star power (hype and population) and arena/facilities. Each input is 0 to 1;
// the factor runs 0.5 to 1.5 (1 for an average team)
export const dealFairValue = ({
	kind,
	salaryCap,
	market,
	success,
	star,
	facilities,
}: {
	kind: DealKind;
	salaryCap: number;
	market: number;
	success: number;
	star: number;
	facilities: number;
}) => {
	const factor =
		0.5 +
		0.5 * clamp(market, 0, 1) +
		0.25 * clamp(success, 0, 1) +
		0.15 * clamp(star, 0, 1) +
		0.1 * clamp(facilities, 0, 1);
	return DEAL_BASE_CAPS[kind] * salaryCap * factor;
};

// Recent success, 0 to 1: winning percentage of up to the last three seasons (most recent counts most) and playoff rounds won
export const successScore = (
	seasons: { winp: number; playoffRoundsWon: number; numRounds: number }[],
) => {
	if (seasons.length === 0) {
		return 0.5;
	}
	let sum = 0;
	let weights = 0;
	for (const [i, s] of seasons.entries()) {
		const weight = i + 1;
		const playoffs =
			s.playoffRoundsWon < 0
				? 0
				: (1 + s.playoffRoundsWon) / (1 + Math.max(1, s.numRounds));
		sum += weight * (0.7 * clamp((s.winp - 0.3) / 0.4, 0, 1) + 0.3 * playoffs);
		weights += weight;
	}
	return sum / weights;
};

const PARTNERS: Record<DealKind, string[]> = {
	sponsor: [
		"Summit Bank",
		"Northstar Motors",
		"Bluepeak Energy",
		"Harbor Health",
		"Crescent Airlines",
		"Ironline Telecom",
		"Goldleaf Insurance",
		"Pioneer Brewing",
	],
	localTv: [
		"Metro Sports Network",
		"Channel 7 Sports",
		"Regional Sports Live",
		"Hometown Broadcasting",
		"Arena Vision",
		"Courtside TV",
	],
};

// The offers at a renewal, one per style, with a little seeded noise
export const makeOffers = ({
	kind,
	fair,
	startSeason,
	rng,
}: {
	kind: DealKind;
	fair: number;
	startSeason: number;
	rng: () => number;
}): CommercialDeal[] =>
	DEAL_STYLE_KEYS.map((style) => {
		const def = DEAL_STYLES[style];
		const noise = 0.94 + 0.12 * rng();
		const partners = PARTNERS[kind];
		return {
			kind,
			style,
			annual: Math.round(fair * def.baseShare * noise),
			bonus: Math.round(fair * def.bonusShare * noise),
			years: def.years,
			startSeason,
			partner: partners[Math.floor(rng() * partners.length)]!,
		};
	});

export const dealExpired = (deal: CommercialDeal | undefined, season: number) =>
	!deal || season >= deal.startSeason + deal.years;

// Share (0 to 1) of a performance deal's bonus earned at this winning percentage
export const bonusShareForWinp = (winp: number) =>
	clamp((winp - 0.35) / 0.35, 0, 1);

// One regular season game's payment of a deal
export const dealGamePayment = (
	deal: CommercialDeal,
	numGames: number,
	winp: number,
) =>
	(deal.annual + deal.bonus * bonusShareForWinp(winp)) / Math.max(1, numGames);

// Revenue sharing: each team pays sharePct% of its local revenue into a pool, paid out equally or weighted to small markets
// (weight 0.25 + (1 - market), market 1 for the biggest). Returns the payout per team, in the input order
export const revenueSharingPayouts = (
	teams: { localRevenue: number; market: number }[],
	sharePct: number,
	mode: "equal" | "smallMarkets",
) => {
	const share = clamp(sharePct, 0, 100) / 100;
	const contributions = teams.map((t) => Math.max(0, share * t.localRevenue));
	const pool = contributions.reduce((a, b) => a + b, 0);
	const weights = teams.map((t) =>
		mode === "smallMarkets" ? 0.25 + (1 - clamp(t.market, 0, 1)) : 1,
	);
	const totalWeight = weights.reduce((a, b) => a + b, 0);
	return teams.map((_t, i) => ({
		contribution: contributions[i]!,
		payout: totalWeight > 0 ? (pool * weights[i]!) / totalWeight : 0,
	}));
};

// Ownership sales: chance per team per season
export const OWNER_SALE_PROB = 0.02;

// A new owner type, different from the current one
export const pickNewOwnerType = (current: OwnerType, rng: () => number) => {
	const options = OWNER_TYPE_KEYS.filter((type) => type !== current);
	return options[Math.floor(rng() * options.length)]!;
};
