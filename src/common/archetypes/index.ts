export * from "./types.ts";
export {
	ARCHETYPES,
	archetypeById,
	archetypeByName,
	classify,
	defaultNorms,
	explain,
	scoreAll,
	tierFromPercentile,
	TIER_NAMES,
	STICKY_Z,
	isPoorFit,
	POOR_FIT_SCORE,
	POOR_FIT_SHORT,
	RARE_PENALTY,
} from "./classify.ts";
export { buildNorms } from "./match.ts";
export { DEFAULT_NORMS } from "./norms.data.ts";
export { DEFAULT_NORMS_EXPANDED } from "./normsExpanded.data.ts";
export {
	DIM_LABELS,
	DIM_RATINGS,
	DIMS,
	compositeValues,
	skillsOf,
} from "./composites.ts";
export { archetypeToBuild } from "./target.ts";
export { SEEDS } from "./seeds.data.ts";
export * from "./helpers.ts";
