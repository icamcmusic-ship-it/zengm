import type { ArchetypeGroup, ArchetypeRatings, Pos } from "./types.ts";

const POS_VALUES: Record<Pos, number> = {
	PG: 0,
	SG: 1,
	SF: 2,
	PF: 3,
	C: 4,
	G: 0.5,
	F: 2.5,
	FC: 3.5,
	GF: 1.5,
};

export const POSITIONS: Pos[] = [
	"PG",
	"G",
	"SG",
	"GF",
	"SF",
	"F",
	"PF",
	"FC",
	"C",
];

// BBGM's basketball position from ratings (the game's own regression, see analysis/pos-basketball). The worker's
// pos.basketball.ts uses this too, so an archetype and the position shown next to it are read the same way.
export const positionOf = (
	ratings: Pick<ArchetypeRatings, keyof ArchetypeRatings>,
): Pos => {
	const value =
		-0.922949 +
		0.073339 * ratings.hgt +
		0.009744 * ratings.stre +
		-0.002215 * ratings.spd +
		-0.005438 * ratings.jmp +
		0.003006 * ratings.endu +
		-0.003516 * ratings.ins +
		-0.008239 * ratings.dnk +
		0.001647 * ratings.ft +
		-0.001404 * ratings.fg +
		-0.004599 * ratings.tp +
		0.001407 * ratings.diq +
		0.002433 * ratings.oiq +
		-0.000753 * ratings.drb +
		-0.021888 * ratings.pss +
		0.016867 * ratings.reb;

	let minDiff = Infinity;
	let minDiffPos: Pos = "F";
	for (const [pos, posValue] of Object.entries(POS_VALUES) as [Pos, number][]) {
		const diff = Math.abs(value - posValue);
		if (diff < minDiff) {
			minDiff = diff;
			minDiffPos = pos;
		}
	}
	return minDiffPos;
};

export const isPos = (x: unknown): x is Pos =>
	typeof x === "string" && (POSITIONS as string[]).includes(x);

// Position is a strong prior on an archetype: an additive nudge on the fit z, or null when the pairing is never allowed.
// Archetypes can override single positions (a Big Guard may be a GF), but HARD_BLOCK always wins.
export const GROUP_POS_PRIOR: Record<
	ArchetypeGroup,
	Record<Pos, number | null>
> = {
	guard: {
		PG: 0,
		G: 0,
		SG: 0,
		GF: -0.3,
		SF: -1,
		F: null,
		PF: null,
		FC: null,
		C: null,
	},
	wing: {
		PG: -0.8,
		G: -0.4,
		SG: 0,
		GF: 0,
		SF: 0,
		F: 0,
		PF: -0.6,
		FC: -1.2,
		C: -2,
	},
	forward: {
		PG: null,
		G: null,
		SG: -1.5,
		GF: -0.5,
		SF: -0.1,
		F: 0,
		PF: 0,
		FC: 0,
		C: -0.4,
	},
	big: {
		PG: null,
		G: null,
		SG: null,
		GF: null,
		SF: -1.5,
		F: -0.4,
		PF: 0,
		FC: 0,
		C: 0,
	},
};

// Pairings that are wrong whatever an archetype says: a guard is never a big or a forward, a center or power forward is
// never a guard, a GF is never a big
export const HARD_BLOCK: Record<ArchetypeGroup, Pos[]> = {
	guard: ["F", "PF", "FC", "C"],
	wing: [],
	forward: ["PG", "G"],
	big: ["PG", "G", "SG", "GF"],
};

export const posPrior = (
	group: ArchetypeGroup,
	override: Partial<Record<Pos, number | null>> | undefined,
	pos: Pos,
): number | null => {
	if (HARD_BLOCK[group].includes(pos)) {
		return null;
	}
	if (override && pos in override) {
		return override[pos] as number | null;
	}
	return GROUP_POS_PRIOR[group][pos];
};
