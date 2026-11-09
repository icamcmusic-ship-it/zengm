/**
 * AI drafting by need and position (basketball). Other sports already draft by team ovr change (DRAFT_BY_TEAM_OVR), which covers needs on its own.
 *
 * A prospect's draft score is his value plus a small adjustment, in value points:
 * - need: positions (guard / wing / big) the team is short on among its top players get a bonus, positions it is stacked at a penalty
 * - strategy: contending teams lean to prospects who are ready now (ovr close to pot), rebuilding teams to ceiling (pot well above ovr)
 *
 * The adjustment is at most about 2 value points, while prospects in the same range of a draft are usually several points apart, so value still decides most picks. Measured in draftNeeds.test.ts.
 */

type Group = "G" | "F" | "C";

const POS_GROUPS: Record<string, Partial<Record<Group, number>>> = {
	PG: { G: 1 },
	SG: { G: 1 },
	G: { G: 1 },
	GF: { G: 0.5, F: 0.5 },
	SF: { F: 1 },
	F: { F: 1 },
	PF: { F: 0.6, C: 0.4 },
	FC: { F: 0.4, C: 0.6 },
	C: { C: 1 },
};

const TARGET: Record<Group, number> = { G: 0.4, F: 0.38, C: 0.22 };

export const NEED_WEIGHT = 4;
export const STRATEGY_WEIGHT = 0.05;
const MAX_ADJUSTMENT = 2;

type PlayerLike = {
	value: number;
	ratings: { pos: string; ovr: number; pot: number }[];
};

export type TeamNeeds = Record<Group, number>;

/**
 * How short a team is at each position group, from its 10 most valuable players. Positive = needs one, negative = stacked.
 */
export const getTeamNeeds = (teamPlayers: PlayerLike[]): TeamNeeds => {
	const top = [...teamPlayers].sort((a, b) => b.value - a.value).slice(0, 10);
	const share: TeamNeeds = { G: 0, F: 0, C: 0 };
	let total = 0;
	for (const p of top) {
		const groups = POS_GROUPS[p.ratings.at(-1)!.pos] ?? { F: 1 };
		// Better players count more
		const w = Math.max(0.2, p.value / 50);
		for (const [group, x] of Object.entries(groups)) {
			share[group as Group] += x * w;
		}
		total += w;
	}
	const needs: TeamNeeds = { G: 0, F: 0, C: 0 };
	for (const group of ["G", "F", "C"] as const) {
		needs[group] = total > 0 ? TARGET[group] - share[group] / total : 0;
	}
	return needs;
};

export const getDraftAdjustment = (
	p: PlayerLike,
	needs: TeamNeeds,
	strategy: "contending" | "rebuilding" | undefined,
) => {
	const ratings = p.ratings.at(-1)!;
	const groups = POS_GROUPS[ratings.pos] ?? { F: 1 };
	let need = 0;
	for (const [group, x] of Object.entries(groups)) {
		need += x * needs[group as Group];
	}
	let adj = NEED_WEIGHT * need;

	// Ready now vs ceiling, relative to a typical 12 point gap
	const gap = ratings.pot - ratings.ovr;
	if (strategy === "contending") {
		adj += STRATEGY_WEIGHT * (12 - gap);
	} else if (strategy === "rebuilding") {
		adj += STRATEGY_WEIGHT * (gap - 12);
	}

	return Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, adj));
};

// Player traits: a prospect's trait factor (getAiTraitValueFactor, about 1 +- 0.07) as value points, capped so traits only break near-ties
export const DRAFT_TRAIT_MAX_ADJ = 1.5;
export const getDraftTraitAdjustment = (value: number, traitFactor: number) =>
	Math.max(
		-DRAFT_TRAIT_MAX_ADJ,
		Math.min(DRAFT_TRAIT_MAX_ADJ, Math.max(0, value) * (traitFactor - 1)),
	);

export const getNeedLabels = (needs: TeamNeeds) => {
	const names: Record<Group, string> = {
		G: "Guard",
		F: "Wing/forward",
		C: "Big",
	};
	return (["G", "F", "C"] as const)
		.filter((group) => needs[group] > 0.05)
		.sort((a, b) => needs[b] - needs[a])
		.map((group) => names[group]);
};
