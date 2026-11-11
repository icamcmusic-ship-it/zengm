// AI GM personalities (featureGmPersonalities): pure helpers shared by worker and UI. Every AI team's GM has fixed leanings (GmTraits,
// each -1 to 1) that shift the weights of the existing AI decisions a little: trade values, trade frequency, free agency, re-signing,
// extensions and options, drafting, team strategy and coach hiring. Traits are drawn around 0, so the league as a whole values players,
// picks and contracts like before and trades about as often; individual teams differ. With the setting off nothing here is used.
import type { GmTraits } from "./types.gm.ts";

export const GM_TRAIT_KEYS = [
	"patience",
	"analytics",
	"risk",
	"taxTolerance",
	"pickValue",
	"tradeFreq",
	"loyalty",
	"faStars",
	"draftBPA",
	"draftUpside",
] as const satisfies readonly (keyof GmTraits)[];

// [name, label at -1, label at 1]
export const GM_TRAIT_INFO: Record<
	keyof GmTraits,
	{ name: string; low: string; high: string; description: string }
> = {
	patience: {
		name: "Timeline",
		low: "Win-now",
		high: "Patient",
		description:
			"Win-now GMs pay for veterans and switch to contending sooner; patient ones value youth and picks and rebuild sooner.",
	},
	analytics: {
		name: "Evaluation",
		low: "Old-school",
		high: "Analytics",
		description:
			"Analytics GMs value efficiency, youth, potential and production beyond the ratings; old-school ones value overall rating, experience and size.",
	},
	risk: {
		name: "Risk",
		low: "Cautious",
		high: "Gambler",
		description:
			"Gamblers discount injuries less and like raw prospects; cautious GMs avoid both.",
	},
	taxTolerance: {
		name: "Payroll",
		low: "Tax-averse",
		high: "Spends freely",
		description:
			"How far a GM will go into the luxury tax to keep or extend players, and how much bad contracts bother him.",
	},
	pickValue: {
		name: "Draft picks",
		low: "Trades picks",
		high: "Hoards picks",
		description: "How much a GM values draft picks in trades.",
	},
	tradeFreq: {
		name: "Trading",
		low: "Quiet",
		high: "Dealmaker",
		description: "How often a GM makes trades.",
	},
	loyalty: {
		name: "Loyalty",
		low: "Ruthless",
		high: "Loyal",
		description:
			"Loyal GMs hold on to players they drafted or have had for years, and extend them more readily.",
	},
	faStars: {
		name: "Free agency",
		low: "Depth builder",
		high: "Star hunter",
		description:
			"Star hunters go after the best free agents; depth builders look for value on cheaper deals.",
	},
	draftBPA: {
		name: "Draft board",
		low: "Drafts for need",
		high: "Best available",
		description: "Best player available, or the team's positional needs.",
	},
	draftUpside: {
		name: "Prospects",
		low: "Ready-now",
		high: "Upside",
		description:
			"Upside GMs draft young players with a high ceiling; others prefer prospects who can play now.",
	},
};

// Labels for the strongest leanings, e.g. ["Win-now", "Analytics", "Dealmaker"]
export const gmStyleLabels = (traits: GmTraits, max = 3, threshold = 0.35) =>
	GM_TRAIT_KEYS.filter((key) => Math.abs(traits[key]) >= threshold)
		.sort((a, b) => Math.abs(traits[b]) - Math.abs(traits[a]))
		.slice(0, max)
		.map((key) =>
			traits[key] < 0 ? GM_TRAIT_INFO[key].low : GM_TRAIT_INFO[key].high,
		);

export const gmTraitLabel = (key: keyof GmTraits, x: number) => {
	if (x <= -0.35) {
		return GM_TRAIT_INFO[key].low;
	}
	if (x >= 0.35) {
		return GM_TRAIT_INFO[key].high;
	}
	if (x <= -0.12) {
		return `Leans ${GM_TRAIT_INFO[key].low.toLowerCase()}`;
	}
	if (x >= 0.12) {
		return `Leans ${GM_TRAIT_INFO[key].high.toLowerCase()}`;
	}
	return "Balanced";
};

const clamp = (x: number, min = -1, max = 1) =>
	x < min ? min : x > max ? max : x;

// Draw a GM's traits from a standard normal source. A few traits go together a little: win-now GMs spend more, trade picks and chase
// stars; analytics GMs value picks and upside a bit more
export const genGmTraits = (gaussian: () => number): GmTraits => {
	const d = () => clamp(Math.round(gaussian() * 0.45 * 100) / 100);
	const patience = d();
	const analytics = d();
	const traits: GmTraits = {
		patience,
		analytics,
		risk: d(),
		taxTolerance: clamp(Math.round((d() - 0.3 * patience) * 100) / 100),
		pickValue: clamp(
			Math.round((d() + 0.3 * patience + 0.2 * analytics) * 100) / 100,
		),
		tradeFreq: d(),
		loyalty: d(),
		faStars: clamp(Math.round((d() - 0.25 * patience) * 100) / 100),
		draftBPA: d(),
		draftUpside: clamp(
			Math.round((d() + 0.2 * patience + 0.15 * analytics) * 100) / 100,
		),
	};
	return traits;
};

export const NEUTRAL_GM_TRAITS: GmTraits = {
	patience: 0,
	analytics: 0,
	risk: 0,
	taxTolerance: 0,
	pickValue: 0,
	tradeFreq: 0,
	loyalty: 0,
	faStars: 0,
	draftBPA: 0,
	draftUpside: 0,
};

// The weights each AI decision reads. With all traits 0 every weight is neutral (1 for factors, 0 for shifts). Magnitudes are kept
// modest: no single trait moves a player's trade value more than about 7%
export type GmWeights = {
	traits: GmTraits;

	// Trade value multipliers for future picks and young (<= 23) players, and for veterans (>= 29)
	futureFactor: number;
	vetFactor: number;
	// Draft pick value multiplier
	pickFactor: number;
	// Strength of the analytics/old-school player style factor (see gmPlayerStyleFactor)
	styleStrength: number;
	// Multiplier on the injury discount of incoming players
	injuryFactor: number;
	// Multiplier on the weight of contract value (good/bad contracts)
	contractsFactor: number;
	// Value multiplier for his own players he'd be giving up who were drafted by or have been with the team for years
	loyaltyFactor: number;
	// Relative chance of being picked for an AI-to-AI trade, average 1
	tradeWeight: number;
	// Winning percentage a contender needs to be a deadline buyer is 0.45 + this
	buyerWinpShift: number;
	// Payroll over the tax line (multiple of the luxury tax payroll) before he wants to dump salary
	dumpPayrollFactor: number;
	// Rank on the team (0 = best) below which an expiring player is let go rather than re-signed into the tax: default 3 + this
	avoidTaxRankShift: number;
	// Free agency: bonus in value points for expensive (positive, star hunter) or cheap (negative) free agents
	faStarShift: number;
	// Skip chance multiplier for free agency each day (dealmakers are more active)
	faActivity: number;
	// Draft: multiplier on the need adjustment, and value points per point of pot - ovr gap (upside)
	draftNeedScale: number;
	draftUpside: number;
	// Contract extensions: chance multiplier; team options: exercise threshold shift (as a share of the option amount)
	extensionFactor: number;
	optionShift: number;
	// Team strategy: score thresholds shift (positive = switches to contending sooner and rebuilds later)
	strategyShift: number;
	// Coach hiring: weight on the player development rating relative to the job's ovr, and multiplier on the chance to fire a coach
	coachDevWeight: number;
	coachFireFactor: number;
};

export const gmWeightsFromTraits = (t: GmTraits): GmWeights => ({
	traits: t,
	futureFactor: 1 + 0.07 * t.patience,
	vetFactor: 1 - 0.06 * t.patience,
	pickFactor: 1 + 0.12 * t.pickValue,
	styleStrength: 0.06 * t.analytics,
	injuryFactor: 1 - 0.35 * t.risk,
	contractsFactor: 1 - 0.3 * t.taxTolerance,
	loyaltyFactor: 1 + 0.06 * t.loyalty,
	tradeWeight: 1 + 0.55 * t.tradeFreq,
	buyerWinpShift: 0.06 * t.patience,
	dumpPayrollFactor: 1 + 0.05 * t.taxTolerance,
	avoidTaxRankShift: Math.round(1.4 * t.taxTolerance),
	faStarShift: 2.5 * t.faStars,
	faActivity: 1 + 0.25 * t.tradeFreq,
	draftNeedScale: 1 - 0.75 * t.draftBPA,
	draftUpside: 0.06 * t.draftUpside,
	extensionFactor: 1 + 0.6 * t.loyalty,
	optionShift: -0.08 * t.loyalty,
	strategyShift: -8 * t.patience,
	coachDevWeight: 0.15 * (t.analytics + t.patience) * 0.5,
	coachFireFactor: 1 - 0.35 * t.patience,
});

// Analytics vs old-school: how much a GM of each kind likes this player, -1 (old-school favorite: high ovr, prime/veteran age, size,
// ratings beyond production) to 1 (analytics favorite: young, potential, production beyond the ratings)
export const gmPlayerStyleScore = ({
	age,
	ovr,
	pot,
	hgt,
	per,
	min,
}: {
	age: number;
	ovr: number;
	pot: number;
	// Height rating, 0-100
	hgt: number;
	// Last season's PER and minutes, if any
	per?: number;
	min?: number;
}) => {
	const youth = clamp((26 - age) / 5);
	const ceiling = clamp((pot - ovr) / 10 - 0.3);
	// Production beyond the ratings: PER implied ovr (the value formula's regression) vs ovr, only with real minutes
	const production =
		per !== undefined && min !== undefined && min >= 500
			? clamp((31.693 + 1.531 * per - ovr) / 10)
			: 0;
	const size = clamp((hgt - 50) / 25);
	const s = 0.35 * youth + 0.25 * ceiling + 0.45 * production - 0.3 * size;
	return clamp(s);
};

export const gmPlayerStyleFactor = (
	w: Pick<GmWeights, "styleStrength">,
	score: number,
) => 1 + w.styleStrength * score;

// Risk: gamblers like raw prospects (big pot - ovr gap), cautious GMs don't. At most about 3%
export const gmRiskFactor = (
	w: Pick<GmWeights, "traits">,
	{ age, ovr, pot }: { age: number; ovr: number; pot: number },
) => {
	if (age > 24) {
		return 1;
	}
	const raw = clamp((pot - ovr) / 15);
	return 1 + 0.03 * w.traits.risk * raw;
};

// Draft adjustment in value points from a GM's upside/ready-now leaning, relative to a typical 12 point gap and age 20
export const gmDraftUpsideAdjustment = (
	w: Pick<GmWeights, "draftUpside">,
	{ age, ovr, pot }: { age: number; ovr: number; pot: number },
) => {
	const gap = pot - ovr;
	return clamp(w.draftUpside * (gap - 12 + 2 * (20 - age)), -1.5, 1.5);
};

// Job security. Each season's score is wins above the preseason expectation (per 82 games), plus playoff success, minus a little for
// plain losing even when it was expected. Weighted towards recent seasons
export const gmSeasonScore = ({
	won,
	lost,
	tied,
	otl,
	expWon,
	numGames,
	playoffRoundsWon,
}: {
	won: number;
	lost: number;
	tied: number;
	otl: number;
	expWon?: number;
	numGames: number;
	playoffRoundsWon: number;
}) => {
	const gp = won + lost + tied + otl;
	if (gp === 0) {
		return 0;
	}
	const scale = 82 / Math.max(1, numGames);
	const exp = expWon ?? numGames / 2;
	const aboveExp = (won + 0.5 * tied - (exp * gp) / numGames) * scale;
	const winp = (won + 0.5 * tied) / gp;
	const playoffs = playoffRoundsWon >= 0 ? 2 + 3 * playoffRoundsWon : 0;
	const losing = winp < 0.35 ? -3 : 0;
	return aboveExp + playoffs + losing - 2.5;
};

export const HOT_SEAT_WEIGHTS = [1, 0.6, 0.35];

// From his seasons with this team, most recent last
export const gmHotSeat = (scores: number[]) => {
	let total = 0;
	for (let i = 0; i < HOT_SEAT_WEIGHTS.length; i++) {
		const score = scores.at(-1 - i);
		if (score === undefined) {
			break;
		}
		total += HOT_SEAT_WEIGHTS[i]! * score;
	}
	return Math.round(total * 10) / 10;
};

// Chance the owner fires him after the playoffs. New GMs get three seasons unless it goes very badly, and a GM who is rebuilding gets a bit more rope early on
export const gmFireProb = ({
	hotSeat,
	tenure,
	rebuilding,
	droughtSeasons,
}: {
	hotSeat: number;
	// Completed seasons with this team
	tenure: number;
	rebuilding: boolean;
	// Seasons in a row without the playoffs, with this GM
	droughtSeasons: number;
}) => {
	if (tenure < 3) {
		return tenure >= 1 && hotSeat < -25 ? 0.25 : 0;
	}
	let x = -hotSeat - (rebuilding && tenure <= 3 ? 15 : 9);
	x += Math.max(0, droughtSeasons - 4) * 3;
	if (x <= 0) {
		return 0;
	}
	return Math.min(0.85, 0.25 + 0.04 * x);
};

// Text for the hot seat meter
export const gmHotSeatLabel = (hotSeat: number | undefined) => {
	if (hotSeat === undefined) {
		return "New";
	}
	if (hotSeat >= 8) {
		return "Secure";
	}
	if (hotSeat >= -6) {
		return "Stable";
	}
	if (hotSeat >= -14) {
		return "Warm";
	}
	return "Hot seat";
};
