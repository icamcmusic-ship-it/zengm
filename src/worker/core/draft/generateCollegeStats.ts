import { applyPendingShape } from "./classShape.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	RATING_KEYS,
	forwardProject,
	generateCollegeClass,
	type CollegeProspect,
	type NcaaSeason,
	type Ratings,
} from "../../../common/collegeStats/index.ts";
import {
	buildNcaaSeasonForClass,
	storeCollegeSeasonMarkers,
	type ClassNcaaSeason,
} from "./collegeSeason.ts";
import { hasPreDraftStats } from "../../../common/preDraft.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";
import { player } from "../index.ts";
import { autoRegenerateClass } from "./regenerateRatings.ts";
import {
	makeBlankPreDraftStatsRow,
	replacePreDraftAwards,
	replacePreDraftStats,
} from "../player/normalizePreDraft.ts";
import { last } from "../../../common/utils.ts";
import type { Player } from "../../../common/types.ts";
import { expandedRatingsApply } from "../player/expandedRatings.ts";

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

export const toCollegeProspect = (
	p: Player,
	draftYear: number,
): CollegeProspect => {
	const ratingsRow = last(p.ratings);
	const ratings = {} as Ratings;
	for (const key of RATING_KEYS) {
		ratings[key] = (ratingsRow as any)[key];
	}
	// Expanded ratings: steals and blocks read perimeter/interior defense and wingspan
	if (expandedRatingsApply(ratingsRow as any)) {
		const r = ratingsRow as any;
		ratings.wng = r.wng;
		ratings.pdef = r.pdef;
		ratings.idef = r.idef;
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

	const classPlayers = await getProspects(draftYear);
	let players = classPlayers;
	if (onlyMissing) {
		players = players.filter((p) => !hasPreDraftStats(p));
	}

	const prospects = players.map((p) => toCollegeProspect(p, draftYear));
	const options = {
		seed,
		draftYear,
		fillBlankColleges: fillBlankColleges ?? true,
	};

	// College season (conference tournaments, March Madness) of the draft year, built from every prospect in the class
	let ncaa: ClassNcaaSeason | undefined;
	if (featureOn("collegeSeason") && players.length > 0) {
		ncaa = await buildNcaaSeasonForClass({
			draftYear,
			seed,
			classPlayers,
			targets: players,
			targetProspects: prospects,
			options,
			reuse: !!onlyMissing,
		});
	}
	const ncaaSeason: NcaaSeason | undefined = ncaa?.season;

	const results = generateCollegeClass(prospects, {
		...options,
		ncaaSeason,
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

	await storeCollegeSeasonMarkers({
		draftYear,
		ncaa,
		targets: players,
		results: resultsByKey,
	});

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
		if (
			stats.length !== p.stats.length ||
			awards.length !== p.awards.length ||
			p.collegeSeason
		) {
			p.stats = stats;
			p.awards = awards;
			delete p.collegeSeason;
			numPlayers += 1;
			await idb.cache.players.put(p);
		}
	}
	return { numPlayers };
};

/**
 * What happens to a newly created draft class (each season's new class, all classes at league creation, imported or topped off classes), in this order since stats depend on ratings:
 * 0. "Draft Class Shapes": a class generated from scratch (marked pending when it was made) gets its shape, once
 * 1. "Re-randomize ratings when a new draft class is created": prospects never regenerated get rebuilt with the league's saved regenerator settings
 * 2. "Auto-generate college/overseas stats for new draft classes": prospects without pre-draft stats get them
 * Both are seeded from the league and the class year, and only ever touch undrafted prospects. draftYears defaults to every class with prospects.
 */
export const processNewDraftClasses = async (
	draftYears?: number[],
	options?: {
		// false for a class that was imported and only topped off, so imported ratings are kept
		rerandomize?: boolean;
		// false to leave out the automatic college stats (a class of forced scrubs)
		stats?: boolean;
	},
) => {
	if (__SPORT !== "basketball") {
		return;
	}
	let years = draftYears;
	if (!years) {
		const prospects = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		years = [...new Set(prospects.map((p) => p.draft.year))];
	}
	years = [...years].sort((a, b) => a - b);
	for (const draftYear of years) {
		await applyPendingShape(draftYear);
	}

	const rerandomize =
		g.get("rerandomizeDraftClassRatings") && options?.rerandomize !== false;
	// Also off with the College Stats switch of League Extras
	const stats =
		options?.stats !== false && featureOption<boolean>("generateCollegeStats");
	if (!rerandomize && !stats) {
		return;
	}
	for (const draftYear of years) {
		if (rerandomize) {
			await autoRegenerateClass(
				draftYear,
				g.get("draftClassRegenSettings") as any,
			);
		}
		if (stats) {
			await generateCollegeStats({
				draftYear,
				seed: `${g.get("lid")}-${draftYear}-auto`,
				onlyMissing: true,
			});
		}
	}
};

// Kept for callers of the old name
export const autoGenerateCollegeStats = processNewDraftClasses;

/**
 * The "all classes" button on Draft Scouting: college/overseas stats for every upcoming class, each with its own seed derived from the given one. onlyMissing keeps prospects who already have stats.
 */
export const generateCollegeStatsAllClasses = async ({
	seed,
	onlyMissing,
}: {
	seed: string;
	onlyMissing: boolean;
}) => {
	const prospects = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const years = [...new Set(prospects.map((p) => p.draft.year))].sort(
		(a, b) => a - b,
	);
	const classes = [];
	for (const draftYear of years) {
		classes.push({
			draftYear,
			...(await generateCollegeStats({
				draftYear,
				seed: `${seed}|${draftYear}`,
				onlyMissing,
			})),
		});
	}
	return { classes };
};
