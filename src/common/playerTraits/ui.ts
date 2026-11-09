import { TRAIT_DEFINITIONS } from "./definitions.ts";
import { DEVELOPMENT_AMPLITUDES } from "./development.ts";
import { EFFECT_AMPLITUDES, traitZ } from "./effects.ts";
import { EGO_AMPLITUDES } from "./ego.ts";
import { TRAIT_KEYS, type TraitKey, type TraitScores } from "./types.ts";

export type TraitLevel = "elite" | "strong" | "average" | "weak" | "poor";

export const traitLevel = (score: number): TraitLevel => {
	if (score >= 80) {
		return "elite";
	}
	if (score >= 65) {
		return "strong";
	}
	if (score > 35) {
		return "average";
	}
	if (score > 20) {
		return "weak";
	}
	return "poor";
};

export const TRAIT_LEVEL_LABELS: Record<TraitLevel, string> = {
	elite: "Elite",
	strong: "Strong",
	average: "Average",
	weak: "Weak",
	poor: "Poor",
};

export type TraitBadge = {
	key: TraitKey;
	label: string;
	score: number;
	tone: "good" | "bad";
};

// Badges for the notable traits only (score at least 70 or at most 30), most extreme first
export const traitBadges = (
	scores: TraitScores,
	{
		max = 4,
		upper = 70,
		lower = 30,
	}: { max?: number; upper?: number; lower?: number } = {},
): TraitBadge[] => {
	const badges: TraitBadge[] = [];
	for (const key of TRAIT_KEYS) {
		const score = scores[key];
		if (score >= upper) {
			badges.push({
				key,
				label: TRAIT_DEFINITIONS[key].badgeHigh,
				score,
				tone: "good",
			});
		} else if (score <= lower) {
			badges.push({
				key,
				label: TRAIT_DEFINITIONS[key].badgeLow,
				score,
				tone: "bad",
			});
		}
	}
	badges.sort((a, b) => Math.abs(b.score - 50) - Math.abs(a.score - 50));
	return badges.slice(0, max);
};

// Which end of the scale is described
export const traitDescription = (key: TraitKey, score: number) => {
	const def = TRAIT_DEFINITIONS[key];
	return score >= 50 ? def.high : def.low;
};

export type TraitFilter = {
	key: TraitKey;
	// Inclusive bounds on the 0-100 score
	min?: number;
	max?: number;
};

export const matchesTraitFilters = (
	scores: TraitScores | undefined,
	filters: TraitFilter[],
) => {
	if (filters.length === 0) {
		return true;
	}
	if (!scores) {
		return false;
	}
	return filters.every((f) => {
		const score = scores[f.key];
		return (
			(f.min === undefined || score >= f.min) &&
			(f.max === undefined || score <= f.max)
		);
	});
};

// Short text for a table cell or column header
export const TRAIT_SHORT: Record<TraitKey, string> = {
	clutch: "Clu",
	consistency: "Con",
	durability: "Dur",
	shotDiscipline: "Dis",
	offBall: "OBM",
	screen: "Scr",
	hustle: "Hus",
	foulDiscipline: "FDi",
	recovery: "Rec",
	handle: "HUP",
	lateGameIq: "LIQ",
	leadership: "Ldr",
	veteranSavvy: "Vet",
	workEthic: "WkE",
	bigGame: "BiG",
	ego: "Ego",
	temper: "Tmp",
};

export const isTraitKey = (x: unknown): x is TraitKey =>
	typeof x === "string" && (TRAIT_KEYS as readonly string[]).includes(x);

const signed = (x: number, digits = 1) => {
	const rounded = Number(x.toFixed(digits));
	return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}`;
};
// Additive probability, in percentage points
const pts = (x: number) => `${signed(100 * x)} pts`;
// Fractional change, as a percent
const rel = (x: number) => `${signed(100 * x, 0)}%`;

// What a score means in games for one player, in numbers (at full situation weight). For the Traits page. Only call it with a reading the
// user is allowed to see.
export const traitEffectSummary = (key: TraitKey, score: number): string => {
	const A = EFFECT_AMPLITUDES;
	const z = traitZ(score);
	switch (key) {
		case "clutch":
			return `Clutch time: FG ${pts(A.clutchShot * z)}, FT ${pts(A.clutchFt * z)}, turnovers ${rel(-A.clutchTurnover * z)}.`;
		case "consistency":
			return `Size of his hot and cold nights: ${rel(-A.variance * z)}.`;
		case "durability":
			return `Injury rate: ${rel(-A.injury * z)}.`;
		case "shotDiscipline":
			return `As a top option: shot attempts ${rel(-A.shotAttemptWeight * z)}, shot quality ${pts(A.shotQuality * z)}.`;
		case "offBall":
			return `Team offensive synergy while he plays: ${signed(A.spacing * z, 3)}.`;
		case "screen":
			return `Team offensive synergy: ${signed(A.screenSynergy * z, 3)}; his shots off screens ${pts(A.screenShot * z)}.`;
		case "hustle":
			return `Loose balls, deflections and charges: ${rel(A.hustle * z)}.`;
		case "foulDiscipline":
			return `Fouls ${rel(-A.foul * z)}, steals ${rel(-A.gambleSteal * z)}.`;
		case "recovery":
			return `Energy regained on the bench: ${rel(A.recovery * z)}.`;
		case "handle":
			return `Turnovers against full pressure: ${rel(-A.pressureTurnover * z)}.`;
		case "lateGameIq":
			return `Right end-of-game call: ${pts(A.lateGameDecision * z)}.`;
		case "leadership":
			return `Team chemistry contribution: ${signed(z, 2)} (of -1 to +1).`;
		case "veteranSavvy":
			return `Small boosts late in games and to chemistry: ${signed(z, 2)} (of -1 to +1).`;
		case "workEthic":
			return `Yearly development: ${signed(DEVELOPMENT_AMPLITUDES.workEthicGrowthYoung * z)} rating points while 24 and under (${signed(DEVELOPMENT_AMPLITUDES.workEthicGrowthOld * z)} after), bad years ${rel(-DEVELOPMENT_AMPLITUDES.workEthicDropScale * z)} as deep (before centering on the league).`;
		case "bigGame":
			return `Every playoff game: FG ${pts(A.bigGameShot * z)}, FT ${pts(A.bigGameFt * z)}, turnovers ${rel(-A.bigGameTurnover * z)}.`;
		case "ego":
			return `Each teammate's mood: ${signed(EGO_AMPLITUDES.teammateMood * z, 2)}; team chemistry ${signed(A.egoChemistry * z, 2)}; chance he asks for a trade when unhappy ${rel(-EGO_AMPLITUDES.tradeRequestProb * z)}.`;
		case "temper":
			return `Technical fouls ${rel(-A.temperTech * z)}, flagrant fouls ${rel(-A.temperFlagrant * z)}; clutch FG ${pts(A.temperClutchShot * z)}, FT ${pts(A.temperClutchFt * z)}.`;
	}
};
