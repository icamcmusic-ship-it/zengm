import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	RATING_KEYS,
	forwardProject,
	generateCollegeClass,
	type CollegeProspect,
	type Ratings,
} from "../../../common/collegeStats/index.ts";
import { hasPreDraftStats } from "../../../common/preDraft.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { player } from "../index.ts";
import {
	makeBlankPreDraftStatsRow,
	replacePreDraftAwards,
	replacePreDraftStats,
} from "../player/normalizePreDraft.ts";
import { last } from "../../../common/utils.ts";
import type { Player } from "../../../common/types.ts";

const getProspects = async (draftYear: number) => {
	// In a fantasy draft the prospects are temporary and there's no point
	const players = await idb.cache.players.indexGetAll(
		"playersByDraftYearRetiredYear",
		[[draftYear], [draftYear, Infinity]],
	);
	return players.filter((p) => p.tid === PLAYER.UNDRAFTED);
};

// The first class still to be drafted, so classes further in the future get their ratings projected to when they'll actually be drafted
const getFirstDraftYear = () =>
	g.get("season") + (g.get("phase") >= PHASE.RESIGN_PLAYERS ? 1 : 0);

const toCollegeProspect = (p: Player, draftYear: number): CollegeProspect => {
	const ratingsRow = last(p.ratings);
	const ratings = {} as Ratings;
	for (const key of RATING_KEYS) {
		ratings[key] = (ratingsRow as any)[key];
	}

	const ageNow = getFirstDraftYear() - p.born.year;
	const yearsAhead = Math.max(0, draftYear - getFirstDraftYear());
	const projected = forwardProject(ratings, yearsAhead, ageNow);
	const ovr =
		yearsAhead > 0
			? player.ovr({ ...ratingsRow, ...projected } as any, ratingsRow.pos)
			: ratingsRow.ovr;

	return {
		key: String(p.pid),
		age: draftYear - p.born.year,
		ovr,
		pot: ratingsRow.pot,
		pos: ratingsRow.pos,
		ratings: projected,
		college: p.college ?? "",
		bornLoc: p.born.loc,
	};
};

export type GenerateCollegeStatsOptions = {
	draftYear: number;
	seed: string;
	// Skip prospects who already have college rows (for classes where only some prospects need them, like when a new class is topped off after an import). Default false, which replaces whatever is there.
	onlyMissing?: boolean;
	// Give prospects with a blank college one, like a pro club or prep program for international prospects. Default true
	fillBlankColleges?: boolean;
};

/**
 * Generate college stats and honors for the undrafted prospects of one draft class, as pre-draft stats rows (tid DOES_NOT_EXIST) and pre-draft awards (type prefixed with "College: "). They replace any pre-draft rows in the draft year and five seasons before it, so running this again does not give duplicates. Ratings, value and everything else about a prospect's pro career is untouched, except that a blank college can be filled in.
 */
export const generateCollegeStats = async ({
	draftYear,
	seed,
	onlyMissing,
	fillBlankColleges,
}: GenerateCollegeStatsOptions) => {
	if (__SPORT !== "basketball") {
		return { numPlayers: 0, numSeasons: 0, numHonors: 0 };
	}

	let players = await getProspects(draftYear);
	if (onlyMissing) {
		players = players.filter((p) => !hasPreDraftStats(p));
	}

	const prospects = players.map((p) => toCollegeProspect(p, draftYear));
	const results = generateCollegeClass(prospects, {
		seed,
		draftYear,
		fillBlankColleges: fillBlankColleges ?? true,
	});
	const resultsByKey = new Map(results.map((result) => [result.key, result]));

	let numSeasons = 0;
	let numHonors = 0;
	for (const p of players) {
		const result = resultsByKey.get(String(p.pid));
		if (!result) {
			continue;
		}

		const rows = result.seasons.map((season) => {
			const row: any = makeBlankPreDraftStatsRow(season.season);
			for (const [key, value] of Object.entries(season.stats)) {
				row[key] = value;
			}
			for (const [key, value] of Object.entries(season.max)) {
				row[key] = value;
			}
			row.teamName = season.school;
			return row;
		});

		p.stats = replacePreDraftStats(p.stats, rows, draftYear);
		p.awards = replacePreDraftAwards(p.awards, result.honors, draftYear);
		if (p.college === "" && result.school !== "") {
			p.college = result.school;
		}

		numSeasons += rows.length;
		numHonors += result.honors.length;
		await idb.cache.players.put(p);
	}

	return { numPlayers: players.length, numSeasons, numHonors };
};

/**
 * Remove college stats and honors from a class's undrafted prospects.
 */
export const removeCollegeStats = async (draftYear: number) => {
	const players = await getProspects(draftYear);
	let numPlayers = 0;
	for (const p of players) {
		const stats = replacePreDraftStats(p.stats, [], draftYear);
		const awards = replacePreDraftAwards(p.awards, [], draftYear);
		if (stats.length !== p.stats.length || awards.length !== p.awards.length) {
			p.stats = stats;
			p.awards = awards;
			numPlayers += 1;
			await idb.cache.players.put(p);
		}
	}
	return { numPlayers };
};
