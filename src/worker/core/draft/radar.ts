import {
	getRadarReason,
	isOffRadar,
	radarSeasons,
	tapeAthletic,
	type RadarInput,
	type RadarReason,
} from "../../../common/collegeStats/radar.ts";
import { heightFromRating } from "../../../common/collegeStats/career.ts";
import { getPreDraftStats } from "../../../common/preDraft.ts";
import type { Player } from "../../../common/types.ts";
import { athleticScore } from "../../../common/draftCombine.ts";
import { combineHeld, getClassCombine } from "../draftCombine/index.ts";
import { draftRatings, getRecruitBasis } from "./recruiting.ts";

/**
 * What the radar reason (common/collegeStats/radar.ts) reads of a prospect: his recruiting rank (the stored one, else the one derived for
 * older classes, or `recruitRank` when the caller has his rank in his high school class), his pre-draft seasons, measurements and an
 * athletic read (`athletic`: his combine athletic score once he did the drills, else his tape, as the draft outlets read it).
 */
export const radarInputFor = (
	p: Player,
	{
		recruitRank,
		athletic,
	}: { recruitRank?: number | null; athletic?: number } = {},
): RadarInput | undefined => {
	const r = draftRatings(p);
	if (!r) {
		return undefined;
	}
	const basis = getRecruitBasis(p);
	return {
		hsPath: basis !== undefined,
		recruitRank:
			recruitRank !== undefined ? recruitRank : (basis?.rank ?? undefined),
		story: p.preDraftCareer?.story,
		route: p.preDraftCareer?.route,
		seasons: radarSeasons(
			p.preDraftCareer?.years,
			getPreDraftStats(p) as any[],
		),
		ageAtDraft: p.draft.year - p.born.year,
		heightInches: p.hgt ?? heightFromRating(r.hgt),
		athletic: athletic ?? tapeAthletic(r.spd, r.jmp),
		tested: athletic !== undefined,
	};
};

export type ProspectRadar =
	| RadarReason
	| { kind: "unknown"; title: string; text?: undefined };

/**
 * His combine athletic score, once his class's combine was held and he did the drills (the draft outlets' read), else undefined (his tape).
 * `players`: his class, when the caller has it.
 */
export const combineAthleticFor = async (p: Player, players?: Player[]) =>
	(await classCombineAthletic(p.draft.year, players)).get(p.pid);

// Every tested prospect's combine athletic score in a class (empty before its combine), by pid
export const classCombineAthletic = async (
	draftYear: number,
	players?: Player[],
) => {
	const out = new Map<number, number>();
	if (!combineHeld(draftYear)) {
		return out;
	}
	const combine = await getClassCombine(draftYear, players);
	for (const [pid, result] of combine.results) {
		if (result.drills) {
			out.set(pid, athleticScore(combine.ranks.get(pid)));
		}
	}
	return out;
};

/**
 * Why he is on the radar (a reason), off the radar (kind "unknown": no pedigree, no production, no reason), or undefined: his pedigree or
 * his production speaks for itself.
 */
export const getProspectRadar = (
	p: Player,
	options?: { recruitRank?: number | null; athletic?: number },
): ProspectRadar | undefined => {
	const input = radarInputFor(p, options);
	if (!input) {
		return undefined;
	}
	const reason = getRadarReason(input);
	if (reason) {
		return reason;
	}
	if (isOffRadar(input)) {
		return { kind: "unknown", title: "Off the radar" };
	}
	return undefined;
};
