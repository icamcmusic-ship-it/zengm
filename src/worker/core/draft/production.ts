import { getPreDraftStats } from "../../../common/preDraft.ts";
import {
	getAgeAdjustedProduction,
	getProductionNudges,
	strengthOfTeam,
} from "../../../common/collegeStats/production.ts";
import type { Player } from "../../../common/types.ts";

// Basketball only: other sports have no pre-draft stats
export const productionNudgesOn = () => __SPORT === "basketball";

/**
 * Age-adjusted production (common/collegeStats/production.ts) of a player's pre-draft seasons. undefined without one he played in.
 */
export const getPlayerProduction = (
	p: Pick<Player, "born" | "draft" | "stats">,
) => {
	if (__SPORT !== "basketball") {
		return undefined;
	}
	const rows = getPreDraftStats(p).filter((row) => !row.playoffs) as any[];
	return getAgeAdjustedProduction(
		rows.map((row) => ({
			row,
			strength: strengthOfTeam(row.teamName),
			age: row.season - p.born.year,
		})),
	);
};

/**
 * The AI draft model's (and the consensus board's) production nudge, in value points, for each prospect with pre-draft stats, measured
 * against the rest of his draft class. Bounded (PRODUCTION_NUDGE_MAX), so ratings still decide.
 */
export const getDraftProductionNudges = (
	players: Pick<Player, "pid" | "born" | "draft" | "stats">[],
): Map<number, number> => {
	const byYear = new Map<
		number,
		{ key: number; value: number; minutes: number }[]
	>();
	for (const p of players) {
		const prod = getPlayerProduction(p);
		if (!prod) {
			continue;
		}
		const list = byYear.get(p.draft.year) ?? [];
		list.push({ key: p.pid, ...prod });
		byYear.set(p.draft.year, list);
	}
	const out = new Map<number, number>();
	for (const entries of byYear.values()) {
		for (const [pid, nudge] of getProductionNudges(entries)) {
			out.set(pid, nudge);
		}
	}
	return out;
};
