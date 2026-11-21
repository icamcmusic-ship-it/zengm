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
 * Draft-and-stash (common/draftStash.ts): an overseas season a drafted player played while a team held his rights is a row like these after his draft year, marked `stash: true`. It counts as pre-draft (overseas) too, so it shows with them and never as a pro season.
 *
 * Rows of players with an unknown draft year (0/undefined) are never pre-draft. A stats row with `tid === DOES_NOT_EXIST` and a season after the draft year is a real pro season (a team that no longer exists, or a season imported from another league), so it is kept.
 */

type DraftYearSource = { draft?: { year?: number } };
type StatsRowSource = {
	tid?: number | undefined;
	season: number;
	stash?: true;
};

const isValidDraftYear = (
	draftYear: number | undefined | null,
): draftYear is number =>
	typeof draftYear === "number" && Number.isFinite(draftYear) && draftYear > 0;

export const isPreDraftStatsRow = (
	row: { tid?: number | undefined; season: number; stash?: true },
	draftYear: number | undefined | null,
) => {
	return (
		row.tid === PLAYER.DOES_NOT_EXIST &&
		isValidDraftYear(draftYear) &&
		(row.season <= draftYear || row.stash === true)
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
		stats: StatsRowSource[];
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
export const getProStats = <Row extends StatsRowSource>(
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

export const getPreDraftStats = <Row extends StatsRowSource>(
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

type PreDraftSchoolSource = DraftYearSource & {
	college?: string;
	real?: boolean;
	linkedCollege?: { school: string };
	preDraftCareer?: { years: { school: string }[] };
	stats?: (StatsRowSource & { teamName?: string; playoffs?: boolean })[];
};

/**
 * The school a generated pre-draft path ends at: his draft year school or club. undefined without a path.
 */
export const getCareerSchool = (p: {
	preDraftCareer?: { years: { school: string }[] };
}): string | undefined => {
	const school = p.preDraftCareer?.years?.at(-1)?.school;
	return school ? school : undefined;
};

/**
 * The school or club a player played for in his last season before the draft (his draft year): the one his bio lists as his college. This is the single definition every view, export and story reads, and p.college is kept equal to it when his pre-draft path is generated (worker/core/draft/generateCollegeStats.ts) and reconciled once for existing leagues (syncPreDraftSchools there).
 *
 * - Real players keep their real college
 * - A prospect from a linked college league: the college team he left (p.college, set to it on import)
 * - A generated pre-draft path (p.preDraftCareer): his draft year school, so after transfers, junior college, the pro pathway program or overseas tiers, his last stop. A draft-and-stash club never is: stash seasons come after the draft, and the club is p.stash.league
 * - Otherwise p.college, or with none the team of his last pre-draft season (never a stash season)
 */
export const getPreDraftSchool = (p: PreDraftSchoolSource): string => {
	if (p.real) {
		return p.college ?? "";
	}
	if (p.linkedCollege) {
		return p.college || p.linkedCollege.school;
	}
	const careerSchool = getCareerSchool(p);
	if (careerSchool !== undefined) {
		return careerSchool;
	}
	if (p.college) {
		return p.college;
	}
	const draftYear = p.draft?.year;
	if (p.stats && isValidDraftYear(draftYear)) {
		let last: { season: number; teamName?: string } | undefined;
		for (const row of p.stats) {
			if (
				row.tid === PLAYER.DOES_NOT_EXIST &&
				row.season <= draftYear &&
				!row.stash &&
				!row.playoffs &&
				row.teamName &&
				(!last || row.season >= last.season)
			) {
				last = row;
			}
		}
		if (last?.teamName) {
			return last.teamName;
		}
	}
	return "";
};
