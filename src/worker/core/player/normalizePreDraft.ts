import { PLAYER } from "../../../common/constants.ts";
import {
	isPreDraftStatsRow,
	isPreDraftAward,
} from "../../../common/preDraft.ts";
import type {
	PlayerAward,
	PlayerAwardSimple,
	PlayerStats,
} from "../../../common/types.ts";
import stats from "./stats.ts";

// Pre-draft rows are written for the draft year and this many seasons before it. Anything older is left alone when replacing, like the Draft Class Workshop does
export const PRE_DRAFT_WINDOW = 5;

const isFiniteNumber = (x: unknown): x is number =>
	typeof x === "number" && Number.isFinite(x);

// A complete stats row with everything zeroed, shaped like addStatsRow makes
export const makeBlankPreDraftStatsRow = (season: number): PlayerStats => {
	const row: any = {
		playoffs: false,
		season,
		tid: PLAYER.DOES_NOT_EXIST,
		yearsWithTeam: 1,
	};

	for (const key of stats.derived) {
		row[key] = 0;
	}
	for (const key of stats.raw) {
		row[key] = 0;
	}
	for (const key of stats.max) {
		// Needs to be null rather than undefined so it persists in JSON, otherwise career totals will not know about these fields
		row[key] = null;
	}
	if (stats.byPos) {
		for (const key of stats.byPos) {
			row[key] = [];
		}
	}
	if (__SPORT === "baseball") {
		row.rfld = [];
	}

	return row;
};

/**
 * Turn stats rows from an uploaded file into valid pre-draft rows for a prospect.
 *
 * - Every row becomes a regular season row for tid DOES_NOT_EXIST, because teams in another league (or a college program) are not teams in this league.
 * - Seasons are shifted by `seasonOffset` (where the draft year in the file maps to the draft year it's being imported as).
 * - Rows after the draft year are dropped, since a prospect can't have played a pro season.
 * - Missing/invalid stats are zeroed, so the row has every key BBGM expects.
 * - Duplicate rows (same season and school, which is what repeated exports of the same class give) are collapsed to the last one.
 *
 * Returns rows sorted by season.
 */
export const normalizePreDraftStats = (
	rows: unknown,
	{ draftYear, seasonOffset }: { draftYear: number; seasonOffset: number },
): PlayerStats[] => {
	if (!Array.isArray(rows)) {
		return [];
	}

	const keyed = new Map<string, PlayerStats>();

	for (const input of rows) {
		if (!input || typeof input !== "object") {
			continue;
		}
		if (input.playoffs === true) {
			continue;
		}

		const inputSeason = Number(input.season);
		if (!Number.isInteger(inputSeason)) {
			continue;
		}
		const season = inputSeason + seasonOffset;
		if (season > draftYear) {
			continue;
		}

		const row: any = makeBlankPreDraftStatsRow(season);

		for (const key of stats.derived) {
			if (isFiniteNumber(input[key])) {
				row[key] = input[key];
			}
		}
		for (const key of stats.raw) {
			if (isFiniteNumber(input[key])) {
				row[key] = input[key];
			}
		}
		for (const key of stats.max) {
			const value = input[key];
			if (
				Array.isArray(value) &&
				value.length >= 2 &&
				isFiniteNumber(value[0]) &&
				isFiniteNumber(value[1])
			) {
				row[key] = [value[0], value[1]];
			}
		}
		if (stats.byPos) {
			for (const key of stats.byPos) {
				if (Array.isArray(input[key])) {
					row[key] = input[key].map((x: unknown) =>
						isFiniteNumber(x) ? x : undefined,
					);
				}
			}
		}

		if (isFiniteNumber(input.yearsWithTeam) && input.yearsWithTeam >= 1) {
			row.yearsWithTeam = Math.round(input.yearsWithTeam);
		}
		if (
			(typeof input.jerseyNumber === "string" && input.jerseyNumber !== "") ||
			isFiniteNumber(input.jerseyNumber)
		) {
			row.jerseyNumber = String(input.jerseyNumber);
		}

		// School, if the file has one
		const teamName = [input.teamName, input.school].find(
			(x) => typeof x === "string" && x.trim() !== "",
		);
		if (typeof teamName === "string") {
			row.teamName = teamName.trim();
		}

		// Last one wins
		const key = `${season}|${row.teamName ?? ""}`;
		keyed.delete(key);
		keyed.set(key, row);
	}

	return Array.from(keyed.values()).sort((a, b) => a.season - b.season);
};

/**
 * Awards from an uploaded file for a prospect. Only simple awards ({season, type}) are kept, with seasons shifted by `seasonOffset`, and any at a season after the draft year dropped. Duplicates are collapsed. Awards from before the draft class window are kept too, they are just as pre-draft.
 */
export const normalizePreDraftAwards = (
	awards: unknown,
	{ draftYear, seasonOffset }: { draftYear: number; seasonOffset: number },
): PlayerAwardSimple[] => {
	if (!Array.isArray(awards)) {
		return [];
	}

	const seen = new Set<string>();
	const output: PlayerAwardSimple[] = [];
	for (const input of awards) {
		if (
			!input ||
			typeof input !== "object" ||
			typeof input.type !== "string" ||
			input.type.trim() === ""
		) {
			continue;
		}
		const inputSeason = Number(input.season);
		if (!Number.isInteger(inputSeason)) {
			continue;
		}
		const season = inputSeason + seasonOffset;
		if (season > draftYear) {
			continue;
		}

		const type = input.type.trim();
		const key = `${season}|${type}`;
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		output.push({ season, type });
	}

	return output.sort((a, b) => a.season - b.season);
};

const inWindow = (season: number, draftYear: number) =>
	season <= draftYear && season >= draftYear - PRE_DRAFT_WINDOW;

/**
 * Put new pre-draft rows on a player, replacing any existing pre-draft rows in the draft year and the five seasons before it (so doing this twice does not give duplicates). Pre-draft rows older than that, and all pro rows, are kept. Result is sorted so pre-draft rows come first.
 */
export const replacePreDraftStats = (
	existing: PlayerStats[],
	newRows: PlayerStats[],
	draftYear: number,
): PlayerStats[] => {
	const kept = existing.filter(
		(row) =>
			!(isPreDraftStatsRow(row, draftYear) && inWindow(row.season, draftYear)),
	);
	const preDraft = [
		...kept.filter((row) => isPreDraftStatsRow(row, draftYear)),
		...newRows,
	].sort((a, b) => a.season - b.season);
	const pro = kept.filter((row) => !isPreDraftStatsRow(row, draftYear));
	return [...preDraft, ...pro];
};

export const replacePreDraftAwards = (
	existing: PlayerAward[],
	newAwards: PlayerAwardSimple[],
	draftYear: number,
): PlayerAward[] => {
	const kept = existing.filter(
		(award) =>
			!(isPreDraftAward(award, draftYear) && inWindow(award.season, draftYear)),
	);
	// Pre-draft honors first, oldest season first. Pro awards keep their order.
	const preDraft = [
		...kept.filter((award) => isPreDraftAward(award, draftYear)),
		...newAwards,
	].sort((a, b) => a.season - b.season);
	return [
		...preDraft,
		...kept.filter((award) => !isPreDraftAward(award, draftYear)),
	];
};

/**
 * Prepare a player object from an uploaded draft class file, before it is turned into a real player. This keeps (rather than deletes) pre-draft stats rows and honors, shifted along with the draft year, normalized, and de-duplicated. Mutates p.
 *
 * `draftYear` is the draft year the class is being imported as. The draft year in the file is p.draft.year, or `fileSeason` for files with no draft info.
 */
export const prepareUploadedProspectPreDraft = (
	p: any,
	{
		draftYear,
		fileSeason,
	}: { draftYear: number; fileSeason: number | undefined },
) => {
	const fileDraftYearRaw = Number(p.draft?.year);
	const fileDraftYear =
		Number.isInteger(fileDraftYearRaw) && fileDraftYearRaw > 0
			? fileDraftYearRaw
			: (fileSeason ?? draftYear);
	const seasonOffset = draftYear - fileDraftYear;

	// Rows from another league (or a college), with no team here. Note that this ignores tid, since no tid in a file means anything in this league.
	p.stats = normalizePreDraftStats(p.stats, { draftYear, seasonOffset });

	// Honors before the draft. Pro awards in the file (there shouldn't be any, for a prospect) are left alone.
	const awards: unknown[] = Array.isArray(p.awards) ? p.awards : [];
	const isPre = (award: any) =>
		award && typeof award === "object" && isPreDraftAward(award, fileDraftYear);
	p.awards = [
		...normalizePreDraftAwards(awards.filter(isPre), {
			draftYear,
			seasonOffset,
		}),
		// Anything else needs at least a valid season to be an award at all
		...awards.filter(
			(award: any) =>
				!isPre(award) &&
				award &&
				typeof award === "object" &&
				Number.isFinite(award.season),
		),
	];
};
