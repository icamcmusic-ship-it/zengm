import { COMPOSITE_WEIGHTS } from "../constants.basketball.ts";
import type {
	ArchetypeRatings,
	DimKey,
	RatingKey,
	SkillLabel,
} from "./types.ts";
import { compositeWeightsFor } from "../expandedRatings.ts";

export const DIMS: DimKey[] = [
	"usg",
	"drb",
	"pss",
	"rim",
	"post",
	"mid",
	"three",
	"ft",
	"reb",
	"dint",
	"dper",
	"blk",
	"ath",
	"end",
	"stl",
	"draw",
	"spd",
	"jmp",
	"stre",
	"oiq",
	"diq",
	"hgt",
	"pdef",
	"idef",
	"len",
];

// Dimensions of the expanded ratings. A match only counts the ones an archetype names (as for height), and length only
// for a player who has a wingspan
export const EXPANDED_DIMS: DimKey[] = ["pdef", "idef", "len"];

export const hasExpanded = (r: ArchetypeRatings) =>
	typeof r.wng === "number" &&
	typeof r.pdef === "number" &&
	typeof r.idef === "number";

// Dimensions that are BBGM composite ratings, and the composite each one is
const COMPOSITE_OF: Partial<Record<DimKey, keyof typeof COMPOSITE_WEIGHTS>> = {
	usg: "usage",
	drb: "dribbling",
	pss: "passing",
	rim: "shootingAtRim",
	post: "shootingLowPost",
	mid: "shootingMidRange",
	three: "shootingThreePointer",
	ft: "shootingFT",
	reb: "rebounding",
	dint: "defenseInterior",
	dper: "defensePerimeter",
	blk: "blocking",
	ath: "athleticism",
	end: "endurance",
	stl: "stealing",
	draw: "drawingFouls",
};

export const DIM_LABELS: Record<DimKey, string> = {
	usg: "Scoring volume",
	drb: "Ball handling",
	pss: "Passing",
	rim: "Finishing at the rim",
	post: "Post scoring",
	mid: "Mid-range shooting",
	three: "Three-point shooting",
	ft: "Free throw shooting",
	reb: "Rebounding",
	dint: "Interior defense",
	dper: "Perimeter defense",
	blk: "Shot blocking",
	ath: "Athleticism",
	end: "Endurance",
	stl: "Steals",
	draw: "Drawing fouls",
	spd: "Speed",
	jmp: "Jumping",
	stre: "Strength",
	oiq: "Offensive IQ",
	diq: "Defensive IQ",
	hgt: "Height",
	pdef: "Perimeter defense rating",
	idef: "Interior defense rating",
	len: "Length",
};

export const DIM_RATINGS: Record<DimKey, RatingKey[]> = {
	usg: ["ins", "dnk", "fg", "tp"],
	drb: ["drb", "spd"],
	pss: ["pss", "oiq", "drb"],
	rim: ["hgt", "dnk", "stre"],
	post: ["ins", "hgt", "stre"],
	mid: ["fg", "oiq"],
	three: ["tp", "oiq"],
	ft: ["ft"],
	reb: ["reb", "hgt"],
	dint: ["diq", "hgt", "stre"],
	dper: ["spd", "diq"],
	blk: ["hgt", "jmp", "diq"],
	ath: ["spd", "jmp", "stre"],
	end: ["endu"],
	stl: ["diq", "spd"],
	draw: ["drb", "spd", "dnk"],
	spd: ["spd"],
	jmp: ["jmp"],
	stre: ["stre"],
	oiq: ["oiq"],
	diq: ["diq"],
	hgt: ["hgt"],
	// Without expanded ratings these are his defensive IQ (the expanded keys are not RatingKeys)
	pdef: ["diq"],
	idef: ["diq"],
	len: ["hgt"],
};

// compositeRating without fuzz: a weighted mean of ratings (a number is a literal rating value), 0..1
const composite = (
	r: ArchetypeRatings,
	components: (string | number)[],
	weights: number[] | undefined,
) => {
	let num = 0;
	let den = 0;
	for (const [i, c] of components.entries()) {
		const v = typeof c === "number" ? c : (r as Record<string, number>)[c]!;
		const w = weights?.[i] ?? 1;
		num += v * w;
		den += 100 * w;
	}
	return Math.min(1, Math.max(0, num / den));
};

// Expanded ratings (setting on, see ArchetypeRatings): the game's composites with wingspan and perimeter/interior defense
const weightsFor = (r: ArchetypeRatings) =>
	compositeWeightsFor(COMPOSITE_WEIGHTS, hasExpanded(r));

// Length: wingspan relative to height, 0.5 = wingspan as long as his height rating (the average)
const lengthOf = (r: ArchetypeRatings) =>
	hasExpanded(r) ? Math.min(1, Math.max(0, (50 + r.wng! - r.hgt) / 100)) : 0.5;

export const compositeValues = (r: ArchetypeRatings) => {
	const out = {} as Record<DimKey, number>;
	const weights = weightsFor(r);
	for (const dim of DIMS) {
		const comp = COMPOSITE_OF[dim];
		if (comp) {
			const c = weights[comp]!;
			out[dim] = composite(r, c.ratings, c.weights);
		} else if (dim === "len") {
			out[dim] = lengthOf(r);
		} else if (dim === "pdef" || dim === "idef") {
			out[dim] = (r[dim] ?? r.diq) / 100;
		} else {
			out[dim] = r[dim as RatingKey] / 100;
		}
	}
	return out;
};

// BBGM's skills (3, A, B, Di, Dp, Po, Ps, R, V) from the ratings, the game's own cutoffs
export const skillsOf = (r: ArchetypeRatings): SkillLabel[] => {
	const sk: SkillLabel[] = [];
	for (const c of Object.values(weightsFor(r))) {
		if (
			c.skill &&
			composite(r, c.ratings, c.weights) > (c.skill.cutoff ?? 0.61)
		) {
			sk.push(c.skill.label as SkillLabel);
		}
	}
	return sk.sort();
};
