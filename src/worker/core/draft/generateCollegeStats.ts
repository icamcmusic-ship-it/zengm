import { applyPendingShape } from "./classShape.ts";
import { PLAYER } from "../../../common/constants.ts";
import {
	COLLEGE_STATS_VERSION,
	RATING_KEYS,
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
import { assignRecruitRanks } from "./recruiting.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";
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
		ratings.oreb = r.oreb;
		ratings.dreb = r.dreb;
		ratings.csh = r.csh;
		ratings.dsh = r.dsh;
		ratings.bsc = r.bsc;
	}

	// No projection for classes years away: prospects don't develop before they're drafted (only players on a team or in free agency
	// do, in the preseason), so the ratings a prospect has now are the ones he has in his draft year. Projecting them forward (as
	// this used to) gave classes 3-6 years out ratings 10-25 points too high, which inflated their scoring, assists, 3-point volume
	// and percentages and made everyone a three-point shooter
	const ovr = ratingsRow.ovr;

	return {
		key: String(p.pid),
		age: draftYear - p.born.year,
		ovr,
		pot: ratingsRow.pot,
		pos: ratingsRow.pos,
		ratings,
		college: p.college ?? "",
		bornLoc: p.born.loc,
		heightInches: p.hgt,
		...(p.draftClassShapeInjury ? { injuryHistory: true } : {}),
	};
};

export type GenerateCollegeStatsOptions = {
	draftYear: number;
	seed: string;
	// Skip prospects who already have college rows (for classes where only some prospects need them, like when a new class is topped off after an import). Default false, which replaces whatever is there.
	onlyMissing?: boolean;
	// Give prospects with a blank college one, like a pro club or prep program for international prospects. Default true
	fillBlankColleges?: boolean;
	// Only these prospects (default: all of the class, or all missing stats with onlyMissing)
	pids?: number[];
	// Keep the class's stored college season (schedule, results, bracket) as it is, prospects' places in it included, and only remake the stats. For upgradeCollegeStats
	keepSeason?: boolean;
};

/**
 * Generate college stats and honors for the undrafted prospects of one draft class, as pre-draft stats rows (tid DOES_NOT_EXIST) and pre-draft awards (type prefixed with "College: "). They replace any pre-draft rows in the draft year and five seasons before it, so running this again does not give duplicates. Ratings, value and everything else about a prospect's pro career is untouched, except that a blank college can be filled in.
 */
export const generateCollegeStats = async ({
	draftYear,
	seed,
	onlyMissing,
	fillBlankColleges,
	pids,
	keepSeason,
}: GenerateCollegeStatsOptions) => {
	if (__SPORT !== "basketball") {
		return { numPlayers: 0, numSeasons: 0, numHonors: 0 };
	}

	const classPlayers = await getProspects(draftYear);
	let players = classPlayers;
	if (onlyMissing) {
		players = players.filter((p) => !hasPreDraftStats(p));
	}
	if (pids) {
		const pidSet = new Set(pids);
		players = players.filter((p) => pidSet.has(p.pid));
	}

	const prospects = players.map((p) => toCollegeProspect(p, draftYear));
	const options = {
		seed,
		draftYear,
		fillBlankColleges: fillBlankColleges ?? true,
		// Measured against the whole class, also when only some of it gets stats
		...(players.length < classPlayers.length
			? {
					classProspects: classPlayers.map((p) =>
						toCollegeProspect(p, draftYear),
					),
				}
			: {}),
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
			reuse: keepSeason ? "all" : !!onlyMissing || !!pids,
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
		p.collegeStatsV = COLLEGE_STATS_VERSION;
		p.awards = replacePreDraftAwards(p.awards, result.honors, draftYear);
		if (p.college === "" && result.school !== "") {
			p.college = result.school;
		}
		// His years before the draft. The recruiting ranking is set below, against the rest of his high school class
		if (result.career) {
			p.preDraftCareer = structuredClone(result.career);
		} else {
			delete p.preDraftCareer;
		}

		numSeasons += rows.length;
		numHonors += result.honors.length;
	}
	await assignRecruitRanks(players);
	for (const p of players) {
		if (resultsByKey.has(String(p.pid))) {
			await idb.cache.players.put(p);
		}
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
			p.collegeSeason ||
			p.preDraftCareer
		) {
			p.stats = stats;
			p.awards = awards;
			delete p.collegeSeason;
			delete p.preDraftCareer;
			delete p.collegeStatsV;
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

/**
 * Existing leagues: remake the college stats of undrafted prospects whose stats were generated by an older version of the model (COLLEGE_STATS_VERSION). Version 1 projected the ratings of classes years away forward as if prospects developed before the draft, which they don't, so most classes had inflated, same-looking lines. Only prospects with generated stats (a stored career) are touched, never imported rows without one or drafted players. Generation is deterministic: each class is remade with the seed it was generated with (stored with its college season, otherwise the automatic seed), and its college season (schedule, results, bracket) is kept as it was. Returns the draft years remade.
 */
export const upgradeCollegeStats = async () => {
	if (__SPORT !== "basketball") {
		return [];
	}
	const prospects = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const stale = prospects.filter(
		(p) =>
			p.preDraftCareer !== undefined &&
			(p.collegeStatsV ?? 1) < COLLEGE_STATS_VERSION,
	);
	const years = [...new Set(stale.map((p) => p.draft.year))].sort(
		(a, b) => a - b,
	);
	for (const draftYear of years) {
		const counts = new Map<string, number>();
		for (const p of prospects) {
			if (p.draft.year === draftYear && p.collegeSeason?.season === draftYear) {
				const seed = p.collegeSeason.seed;
				counts.set(seed, (counts.get(seed) ?? 0) + 1);
			}
		}
		const seed =
			[...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ??
			`${g.get("lid")}-${draftYear}-auto`;
		await generateCollegeStats({
			draftYear,
			seed,
			pids: stale.filter((p) => p.draft.year === draftYear).map((p) => p.pid),
			keepSeason: true,
			fillBlankColleges: true,
		});
	}
	return years;
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
