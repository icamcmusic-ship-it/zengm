import { PLAYER } from "./constants.ts";

/**
 * Pre-draft ("college") stats rows and honors.
 *
 * A draft prospect can carry stats rows from before he was drafted (a college or overseas season) and award rows ("honors") at those seasons. They are stored like any other stats row / award, with two differences that make them recognizable:
 *
 * - stats rows have `tid === PLAYER.DOES_NOT_EXIST` (a college program is not a team in this league) and a season no later than the player's draft year (a player's first pro season is the one after his draft year)
 * - awards are "simple" awards (`{season, type}`) at a season no later than the draft year (nothing can be won in a pro league before you are drafted into it)
 *
 * These helpers are the single definition of that distinction. Pro experience, career totals, leaders, awards counts, valuations, retirement and Hall of Fame logic must not see these rows, so anything that reads `p.stats` or `p.awards` directly and cares about pro seasons should go through them.
 *
 * Rows of players with an unknown draft year (0/undefined) are never pre-draft. A stats row with `tid === DOES_NOT_EXIST` and a season after the draft year is a real pro season (a team that no longer exists, or a season imported from another league), so it is kept.
 */

type DraftYearSource = { draft?: { year?: number } };

const isValidDraftYear = (
	draftYear: number | undefined | null,
): draftYear is number =>
	typeof draftYear === "number" && Number.isFinite(draftYear) && draftYear > 0;

export const isPreDraftStatsRow = (
	row: { tid?: number | undefined; season: number },
	draftYear: number | undefined | null,
) => {
	return (
		row.tid === PLAYER.DOES_NOT_EXIST &&
		isValidDraftYear(draftYear) &&
		row.season <= draftYear
	);
};

export const isPreDraftAward = (
	award: { season: number; type?: string | undefined },
	draftYear: number | undefined | null,
) => {
	// Built-in awards (type undefined) come from the awards table, so they are always pro
	return (
		typeof award.type === "string" &&
		isValidDraftYear(draftYear) &&
		award.season <= draftYear
	);
};

export const hasPreDraftStats = (
	p: DraftYearSource & {
		stats: { tid?: number | undefined; season: number }[];
	},
) => {
	const draftYear = p.draft?.year;
	if (!isValidDraftYear(draftYear)) {
		return false;
	}
	return p.stats.some((row) => isPreDraftStatsRow(row, draftYear));
};

/**
 * Stats rows from the player's pro career only. Returns the original array (no copy) when there is nothing to remove, which is nearly always.
 */
export const getProStats = <
	Row extends { tid?: number | undefined; season: number },
>(
	p: DraftYearSource & { stats: Row[] },
): Row[] => {
	const draftYear = p.draft?.year;
	if (!isValidDraftYear(draftYear)) {
		return p.stats;
	}
	if (!p.stats.some((row) => isPreDraftStatsRow(row, draftYear))) {
		return p.stats;
	}
	return p.stats.filter((row) => !isPreDraftStatsRow(row, draftYear));
};

export const getPreDraftStats = <
	Row extends { tid?: number | undefined; season: number },
>(
	p: DraftYearSource & { stats: Row[] },
): Row[] => {
	const draftYear = p.draft?.year;
	if (!isValidDraftYear(draftYear)) {
		return [];
	}
	return p.stats.filter((row) => isPreDraftStatsRow(row, draftYear));
};

export const getProAwards = <
	Award extends { season: number; type?: string | undefined },
>(
	p: DraftYearSource & { awards: Award[] },
): Award[] => {
	const draftYear = p.draft?.year;
	if (!isValidDraftYear(draftYear)) {
		return p.awards;
	}
	if (!p.awards.some((award) => isPreDraftAward(award, draftYear))) {
		return p.awards;
	}
	return p.awards.filter((award) => !isPreDraftAward(award, draftYear));
};

export const getPreDraftAwards = <
	Award extends { season: number; type?: string | undefined },
>(
	p: DraftYearSource & { awards: Award[] },
): Award[] => {
	const draftYear = p.draft?.year;
	if (!isValidDraftYear(draftYear)) {
		return [];
	}
	return p.awards.filter((award) => isPreDraftAward(award, draftYear));
};

// Prefix for honors generated natively by this fork, so they can never be confused with a pro award type
export const COLLEGE_AWARD_PREFIX = "College: ";
