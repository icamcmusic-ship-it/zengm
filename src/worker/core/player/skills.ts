import compositeRating from "./compositeRating.ts";
import type { MinimalPlayerRatings } from "../../../common/types.ts";
import { COMPOSITE_WEIGHTS } from "../../../common/constants.ts";
import {
	compositeWeightsFor,
	hasExpandedRatings,
} from "../../../common/expandedRatings.ts";
import {
	skillCutoffs,
	type SkillCutoffFlags,
	type SkillLabel,
} from "../../../common/skillCutoffs.ts";
import { expandedRatingsOn } from "./expandedRatingsSwitch.ts";
import { applyFuzz, getFuzz } from "./fuzzRating.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { fuzzSubs, subRatingsOn } from "./subRatings.ts";
import {
	subSimComposite,
	subSimPlayer,
	subSimTouches,
} from "../GameSim.basketball/subRatingsSim.ts";

export type SkillFlags = Required<SkillCutoffFlags>;

// The league settings the skills depend on: the same ones the game sim's synergy reads (game/loadTeams.ts)
export const skillFlags = (): SkillFlags =>
	__SPORT === "basketball"
		? {
				expanded: expandedRatingsOn(),
				simFixes: featureOn("simFixes"),
				subRatingsSim: subRatingsOn() && featureOn("subRatingsSim"),
			}
		: { expanded: false, simFixes: false, subRatingsSim: false };

/**
 * "Skills" are discrete categories, like someone is a 3 point shooter or they aren't. These are displayed next to the player's name
 * generally, and the game sim's synergy counts the same composites against the same cutoffs (common/skillCutoffs.ts).
 *
 * There should be about 30 (number of teams) players with each skill, except 3 point shooting which should have 60.
 *
 * skillsFromRow reads the row as it is: pass the ratings the user sees (fuzzed, as in player.format) or the true ones. With
 * Sub-Ratings in Sim, the row's sub-ratings (row.sub) are folded into the composites exactly like the sim does.
 */
export const skillsFromRow = (
	row: Record<string, any>,
	flags: SkillFlags = skillFlags(),
): string[] => {
	const sk: string[] = [];

	if (__SPORT !== "basketball") {
		for (const { ratings, skill, weights } of Object.values(
			COMPOSITE_WEIGHTS,
		)) {
			if (
				skill &&
				compositeRating(row as any, ratings, weights, false) >
					(skill.cutoff ?? 0.61)
			) {
				sk.push(skill.label);
			}
		}
		sk.sort();
		return sk;
	}

	// Expanded ratings: the defense, rebounding and finishing composites read wingspan and perimeter/interior defense
	const expanded = flags.expanded && hasExpandedRatings(row as any);
	const compositeWeights = compositeWeightsFor(COMPOSITE_WEIGHTS, expanded);
	const cutoffs = skillCutoffs({ expanded, simFixes: flags.simFixes });
	const sp = flags.subRatingsSim ? subSimPlayer(row as any) : undefined;

	for (const [key, { ratings, skill, weights }] of Object.entries(
		compositeWeights,
	)) {
		if (skill) {
			const value =
				sp && subSimTouches(key)
					? subSimComposite(sp, key, ratings, weights)
					: compositeRating(row as any, ratings, weights, false);
			if (value > cutoffs[skill.label as SkillLabel]) {
				sk.push(skill.label);
			}
		}
	}

	sk.sort();
	return sk;
};

// Rating keys that are measurements (never fuzzed) or not ratings at all
const NOT_FUZZED = new Set([
	"hgt",
	"wng",
	"fuzz",
	"season",
	"ovr",
	"pot",
	"injuryIndex",
]);

// A copy of the row as the scouts see it. `force`: always with the row's fuzz, also in God Mode and multi team mode (stored skills
// must not depend on those switches, or a God Mode spell leaks the true ratings into the saved labels)
export const fuzzedSkillRow = (
	r: Record<string, any>,
	force: boolean,
	p?: { combine?: unknown },
) => {
	const fuzz = getFuzz(r.fuzz ?? 0, force);
	const out: Record<string, any> = { ...r };
	if (fuzz !== 0) {
		for (const [key, value] of Object.entries(r)) {
			if (typeof value === "number" && !NOT_FUZZED.has(key)) {
				out[key] = applyFuzz(value, fuzz);
			}
		}
	}
	if (Array.isArray(r.sub)) {
		out.sub = fuzzSubs(r.sub, r.fuzz, p, force);
	}
	return out;
};

/**
 * The skills stored in a ratings row (ratings.skills, and p.draft.skills for a draft prospect): from the scouts' view of the ratings,
 * always with the row's fuzz. player.format computes the displayed skills live instead (God Mode, scouting and settings as they are
 * now), so the stored ones are only a snapshot for raw views and exports.
 */
const skills = (playerRatings: MinimalPlayerRatings) =>
	skillsFromRow(fuzzedSkillRow(playerRatings, true));

/**
 * The one place a ratings row's stored skills are refreshed. mirrorDraft: also copy them to p.draft.skills (the row is his draft
 * season's, or he is a draft prospect). source: the ratings to read, if not the row itself
 */
export const refreshSkills = (
	p: { draft?: { skills: string[] } } | undefined,
	r: { skills: string[] },
	mirrorDraft: boolean,
	source: MinimalPlayerRatings = r as MinimalPlayerRatings,
) => {
	r.skills = skills(source);
	if (mirrorDraft && p?.draft) {
		p.draft.skills = r.skills;
	}
	return r.skills;
};

export default skills;
