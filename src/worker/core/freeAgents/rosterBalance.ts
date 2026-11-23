// AI Roster Balance (the aiRosterBalance setting, basketball): a gentle positional need term for AI free agent signings, roster-fill
// signings and cuts, so AI rosters keep at least 2 bigs and 3 guards and no more than about 7 of either. Pure functions; the hardship
// signings are in hardship.ts. See docs/native-features.md.
import { featureOn } from "../../util/nativeFeatures.ts";

export const rosterBalanceOn = () =>
	__SPORT === "basketball" && featureOn("aiRosterBalance");

export type PosGroup = "big" | "guard" | "wing";
export const posGroup = (pos: string): PosGroup => {
	if (pos === "C" || pos === "FC" || pos === "PF") {
		return "big";
	}
	if (pos === "PG" || pos === "SG" || pos === "G") {
		return "guard";
	}
	return "wing";
};

export const MIN_BIGS = 2;
export const MIN_GUARDS = 3;
// A group this big is full: signing another one is penalized, cutting one is preferred
export const MAX_GROUP = 7;
// Value points (player value is ~40-80): a signing that fills a missing big or guard spot, and one that adds to a full group
const NEED_BONUS = 6;
const EXCESS_PENALTY = 6;
// Cuts: a player from a full group is cut before one this much worse elsewhere
const CUT_EXCESS_BONUS = 4;

export type GroupCounts = Record<PosGroup, number>;
export const groupCounts = (positions: readonly string[]): GroupCounts => {
	const counts: GroupCounts = { big: 0, guard: 0, wing: 0 };
	for (const pos of positions) {
		counts[posGroup(pos)] += 1;
	}
	return counts;
};

const minOf = (group: PosGroup) =>
	group === "big" ? MIN_BIGS : group === "guard" ? MIN_GUARDS : 0;

// Value points to add to a free agent at pos for a team with these group counts
export const signNeedBonus = (counts: GroupCounts, pos: string) => {
	const group = posGroup(pos);
	if (counts[group] < minOf(group)) {
		return NEED_BONUS;
	}
	if (group !== "wing" && counts[group] >= MAX_GROUP) {
		return -EXCESS_PENALTY * (1 + counts[group] - MAX_GROUP);
	}
	return 0;
};

// Candidates (sorted best first, maybe with small adjustments to value already, like player traits) re-sorted by positional need. Each
// one's key is the lowest value so far in the list (so the order of the ones with no need term is kept) plus his need term
export const sortByNeed = <T>(
	rosterPositions: readonly string[],
	candidates: readonly T[],
	getPos: (p: T) => string,
	getValue: (p: T) => number,
): T[] => {
	const counts = groupCounts(rosterPositions);
	let runningMin = Infinity;
	return candidates
		.map((p, i) => {
			runningMin = Math.min(runningMin, getValue(p));
			return { p, i, key: runningMin + signNeedBonus(counts, getPos(p)) };
		})
		.sort((a, b) => b.key - a.key || a.i - b.i)
		.map(({ p }) => p);
};

// The players to cut, in order: lowest value first, but never one that would leave the roster below 2 bigs or 3 guards (unless there
// is nobody else to cut), and a player from a full group (7+) before a slightly better one elsewhere
export const pickCuts = <T>(
	players: readonly T[],
	numToDrop: number,
	getPos: (p: T) => string,
	getValue: (p: T) => number,
): T[] => {
	const remaining = [...players];
	const cuts: T[] = [];
	for (let n = 0; n < numToDrop && remaining.length > 0; n++) {
		const counts = groupCounts(remaining.map(getPos));
		let best: T | undefined;
		let bestScore = Infinity;
		let fallback: T | undefined;
		let fallbackValue = Infinity;
		for (const p of remaining) {
			const group = posGroup(getPos(p));
			const value = getValue(p);
			if (value < fallbackValue) {
				fallbackValue = value;
				fallback = p;
			}
			if (counts[group] <= minOf(group)) {
				continue;
			}
			const score =
				value -
				(group !== "wing" && counts[group] >= MAX_GROUP ? CUT_EXCESS_BONUS : 0);
			if (score < bestScore) {
				bestScore = score;
				best = p;
			}
		}
		const cut = best ?? fallback!;
		cuts.push(cut);
		remaining.splice(remaining.indexOf(cut), 1);
	}
	return cuts;
};
