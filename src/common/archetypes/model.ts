// arch14: the fitted reading. A build's score for a player is a weighted sum of the reading's terms (the profile match, the
// calibration bias, what his standouts and roles earn, what the name's promises cost, ...), each weight fitted to a judged
// set of players (fit.script.test.ts, judged.data.ts) with a ranking loss regularised toward the hand settings (weight 1),
// plus per skill class a weight on "the name promises it and he has it" (the build-level skill weights) and a bias per
// family. A family classifier (multinomial logistic over his skill classes, size, level and stats) reads his family first:
// when it is sure (probability `tau` or more) builds of other families pay `gate`, and every build gets `gamma` times the
// log probability of its family (the soft fallback when it is not). Parameters: fitted.data.ts (standard ratings) and
// fittedExpanded.data.ts (the Expanded Ratings setting).
import { FAMILIES, type Family } from "./families.ts";

// The reading's terms, in the order the score sums them (each already signed: a penalty is negative)
export const TERMS = [
	"match",
	"rare",
	"bias",
	"star",
	"standout",
	"twoWay",
	"passBig",
	"sig",
	"creator",
	"rolePass",
	"roleRim",
	"roleSniper",
	"roleShoot",
	"roleMid",
	"absFloor",
	"noShot",
	"air",
	"eliteShot",
	"touch",
	"generic",
	"need",
	"promFloor",
	"promReb",
	"promLead",
	"promRel",
	"allAround",
	// arch14 (user request): his player traits (only with the Player Traits setting on; 0 without), each group's mean score
	// above or below 50 (in units of 25) where the build's name is that style (score.ts TRAIT_GROUPS); hidden traits too
	"trOffBall",
	"trScreen",
	"trHandle",
	"trDefVers",
	"trHustle",
	"trShotDisc",
	"trClutch",
	"trLeader",
	"trIron",
] as const;
export type Term = (typeof TERMS)[number];

// The skill classes a name can promise (score.ts promisesOf): "promises it" times his level at it (classValues)
export const CLASS_FEATS = [
	"shoot",
	"mid",
	"finish",
	"post",
	"handle",
	"pass",
	"reb",
	"rimD",
	"perD",
	"ath",
	"stre",
	"def",
	"score",
] as const;

// What the family classifier reads about him
export const FAM_FEATS = [
	"one",
	"shoot",
	"mid",
	"finish",
	"post",
	"handle",
	"pass",
	"reb",
	"rimD",
	"perD",
	"ath",
	"stre",
	"hgt",
	"level",
	"prospect",
	"sUsg",
	"sPss",
	"sThree",
	"sReb",
	"sBlk",
	"sStl",
	"sDrb",
] as const;

export type FittedModel = {
	// Weight per term (hand settings: 1)
	theta: Record<Term, number>;
	// Weight per promised skill class (hand settings: 0)
	cls: Record<(typeof CLASS_FEATS)[number], number>;
	// Bias per family (hand settings: 0)
	famBias: Record<Family, number>;
	// Family classifier: weights per family over FAM_FEATS (all 0: every family equally likely)
	famW: Record<Family, number[]>;
	// Weight of the log probability of a build's family, the gate's threshold and strength
	gamma: number;
	tau: number;
	gate: number;
	// Close calls: within this margin the previous label is kept, else his stats decide (classify.ts)
	tieMargin: number;
	tieStatsK: number;
};

const ones = <K extends string>(keys: readonly K[], v: number) =>
	Object.fromEntries(keys.map((k) => [k, v])) as Record<K, number>;

// The hand settings: the reading as it was before arch14
export const TRAIT_TERMS: readonly Term[] = TERMS.filter((t) =>
	t.startsWith("tr"),
);
// (the trait terms did not exist before arch14: 0 in the hand settings, a moderate 0.3 the fit is regularised toward)
export const TRAIT_PRIOR = 0.3;
export const HAND_MODEL: FittedModel = {
	theta: Object.fromEntries(
		TERMS.map((t) => [t, TRAIT_TERMS.includes(t) ? 0 : 1]),
	) as Record<Term, number>,
	cls: ones(CLASS_FEATS, 0),
	famBias: ones(FAMILIES, 0),
	famW: Object.fromEntries(
		FAMILIES.map((f) => [f, FAM_FEATS.map(() => 0)]),
	) as Record<Family, number[]>,
	gamma: 0,
	tau: 1.01,
	gate: 0,
	tieMargin: 0,
	tieStatsK: 0,
};

// Family probabilities from his features (FAM_FEATS order)
export const familyProbs = (m: FittedModel, x: number[]): number[] => {
	const logits = FAMILIES.map((f) => {
		const w = m.famW[f];
		let t = 0;
		for (let i = 0; i < x.length; i++) {
			t += w[i]! * x[i]!;
		}
		return t;
	});
	const max = Math.max(...logits);
	const e = logits.map((l) => Math.exp(l - max));
	const sum = e.reduce((a, b) => a + b, 0);
	return e.map((v) => v / sum);
};
