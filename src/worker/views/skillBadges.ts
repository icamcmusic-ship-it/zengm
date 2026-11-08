import { featureOffError } from "../util/nativeFeatures.ts";
import { TRAIT_DEFINITIONS } from "../../common/playerTraits/definitions.ts";
import { getTraitViewContext } from "../util/playerTraitsView.ts";
import { idb } from "../db/index.ts";
import { player } from "../core/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { PLAYER } from "../../common/constants.ts";
import {
	BADGE_GROUP_NAMES,
	BADGE_RATING_KEYS,
	SKILL_BADGES,
	SKILL_COMBOS,
	badgeScore,
	comboParts,
	getDisplayBadges,
	getSkillBadges,
	skillMargin,
	hasBadge,
	type BadgeTraits,
	pickBadgeRatings,
	type BadgeRatings,
} from "../../common/skillBadges/index.ts";
import type { RouteParams } from "../../ui/router/types.ts";

const processInputs = (params: RouteParams<"skillBadges">) => {
	const label =
		params.badge !== undefined &&
		(SKILL_BADGES.some((def) => def.label === params.badge) ||
			SKILL_COMBOS.some((def) => def.label === params.badge))
			? params.badge
			: undefined;
	return { label };
};

const LEADERS = 5;
const LIST_SIZE = 50;

export default defineView({
	id: "skillBadges",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("skillBadges");
		if (featureOff) {
			return featureOff;
		}
		if (__SPORT !== "basketball") {
			return {
				errorMessage:
					"Extended skill badges are only available for basketball.",
			};
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("newPhase") &&
			prevInputs?.label === inputs.label
		) {
			return;
		}
		if (SKILL_BADGES.length === 0) {
			return { errorMessage: "No badges" };
		}

		const playersAll = await idb.cache.players.indexGetAll("playersByTid", [
			PLAYER.FREE_AGENT,
			Infinity,
		]);
		const formatted = await player.formatAll(playersAll, {
			attrs: ["pid", "firstName", "lastName", "age", "tid", "abbrev", "injury"],
			ratings: [...BADGE_RATING_KEYS, "ovr", "pos", "skills"],
			season: g.get("season"),
			showNoStats: true,
			showRookies: true,
			fuzz: true,
		});

		type Row = {
			pid: number;
			name: string;
			pos: string;
			ovr: number;
			age: number;
			abbrev: string;
			tid: number;
			ratings: BadgeRatings;
			traits: BadgeTraits | undefined;
			display: string[];
			skills: string[];
		};
		const rows: Row[] = [];
		const traitContext = await getTraitViewContext();
		const playersByPid = new Map(playersAll.map((p) => [p.pid, p]));
		for (const p of formatted) {
			const ratings = pickBadgeRatings(p.ratings as any);
			const fullPlayer = playersByPid.get(p.pid);
			const traits =
				traitContext.enabled && fullPlayer
					? player.getBadgeTraits(
							fullPlayer as any,
							g.get("season"),
							traitContext.scoutingLevel,
						)
					: undefined;
			if (ratings) {
				rows.push({
					pid: p.pid,
					name: `${p.firstName} ${p.lastName}`,
					pos: p.ratings.pos,
					ovr: p.ratings.ovr,
					age: p.age,
					abbrev: p.abbrev,
					tid: p.tid,
					ratings,
					traits,
					display: getDisplayBadges(ratings, p.ratings.skills ?? [], traits),
					skills: p.ratings.skills ?? [],
				});
			}
		}

		const badges = SKILL_BADGES.filter(
			(def) => traitContext.enabled || !def.traitConditions,
		).map((def) => {
			const holders = rows
				.filter((r) => hasBadge(r.ratings, def, r.traits))
				.map((r) => ({ row: r, score: badgeScore(r.ratings, def, r.traits) }))
				.sort((a, b) => b.score - a.score || b.row.ovr - a.row.ovr);
			const toLeader = ({ row, score }: (typeof holders)[number]) => ({
				pid: row.pid,
				name: row.name,
				pos: row.pos,
				ovr: row.ovr,
				age: row.age,
				abbrev: row.abbrev,
				tid: row.tid,
				score: Math.round(score * 100),
			});
			return {
				label: def.label,
				name: def.name,
				group: def.group,
				groupName: BADGE_GROUP_NAMES[def.group],
				meaning: def.meaning,
				thresholds: [
					...(def.traitConditions ?? []).map(
						(cond) =>
							`${TRAIT_DEFINITIONS[cond.trait].name} trait >= ${cond.cutoff}`,
					),
					...def.conditions.map(
						(cond) =>
							`score ${cond.dir === "below" ? "<=" : ">="} ${Math.round(cond.cutoff * 100)}`,
					),
					...(def.traitAlternative
						? [
								`(or ${TRAIT_DEFINITIONS[def.traitAlternative.trait].name} trait >= ${def.traitAlternative.cutoff})`,
							]
						: []),
				],
				count: holders.length,
				leaders: holders.slice(0, LEADERS).map(toLeader),
				list:
					inputs.label === def.label
						? holders.slice(0, LIST_SIZE).map(toLeader)
						: [],
			};
		});

		const combos = SKILL_COMBOS.map((def) => {
			const holders = rows
				.flatMap((r) => {
					if (!r.display.includes(def.label)) {
						return [];
					}
					// What it replaced for him, and how far past its cutoff the weakest part is
					const parts =
						comboParts(
							def,
							new Set([...r.skills, ...getSkillBadges(r.ratings, r.traits)]),
						) ?? def.all;
					const margin = Math.min(
						...parts.map((c) => skillMargin(r.ratings, c, r.traits)),
					);
					return [
						{
							row: r,
							score: margin,
							parts,
						},
					];
				})
				.sort((a, b) => b.score - a.score || b.row.ovr - a.row.ovr);
			const toLeader = ({ row, score, parts }: (typeof holders)[number]) => ({
				pid: row.pid,
				name: row.name,
				pos: row.pos,
				ovr: row.ovr,
				age: row.age,
				abbrev: row.abbrev,
				tid: row.tid,
				score: Math.round(score * 100),
				parts: parts.join(" + "),
			});
			return {
				label: def.label,
				name: def.name,
				meaning: def.meaning,
				components: [
					...def.all,
					...(def.any
						? [
								def.minAny === 0
									? `optional ${def.any.join("/")}`
									: `${def.minAny ?? 1}+ of ${def.any.join("/")}`,
							]
						: []),
					...(def.extra ? [`absorbs ${def.extra.join("/")}`] : []),
				].join(" + "),
				level: def.level ?? 1,
				count: holders.length,
				leaders: holders.slice(0, LEADERS).map(toLeader),
				list:
					inputs.label === def.label
						? holders.slice(0, LIST_SIZE).map(toLeader)
						: [],
			};
		});

		return {
			label: inputs.label,
			combos,
			numPlayers: rows.length,
			numTeams: g.get("numActiveTeams"),
			userTid: g.get("userTid"),
			badges,
		};
	},
});
