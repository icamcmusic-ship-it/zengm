import { featureOffError } from "../util/nativeFeatures.ts";
import { idb } from "../db/index.ts";
import { player } from "../core/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { PLAYER } from "../../common/constants.ts";
import {
	BADGE_GROUP_NAMES,
	BADGE_RATING_KEYS,
	COMBO_TIER_NAMES,
	SKILL_BADGES,
	SKILL_COMBOS,
	badgeScore,
	getDisplayBadges,
	parseToken,
	skillMargin,
	conditionMet as matches,
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
			display: string[];
		};
		const rows: Row[] = [];
		for (const p of formatted) {
			const ratings = pickBadgeRatings(p.ratings as any);
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
					display: getDisplayBadges(ratings, p.ratings.skills ?? []),
				});
			}
		}

		const badges = SKILL_BADGES.map((def) => {
			const holders = rows
				.filter((r) => def.conditions.every((cond) => matches(r.ratings, cond)))
				.map((r) => ({ row: r, score: badgeScore(r.ratings, def) }))
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
				flag: !!def.flag,
				thresholds: def.conditions.map(
					(cond) =>
						`${cond.dir === "below" ? "<=" : ">="} ${Math.round(cond.cutoff * 100)}`,
				),
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
					const token = r.display.find(
						(t) => parseToken(t).label === def.label,
					);
					if (token === undefined) {
						return [];
					}
					// Same rule as comboTier: the weakest consumed component
					const margin = Math.min(
						...def.all.map((c) => skillMargin(r.ratings, c)),
						...(def.any ?? [])
							.map((c) => skillMargin(r.ratings, c))
							.filter((m) => m >= 0),
					);
					return [{ row: r, score: margin, tier: parseToken(token).tier }];
				})
				.sort((a, b) => b.score - a.score || b.row.ovr - a.row.ovr);
			const toLeader = ({ row, score, tier }: (typeof holders)[number]) => ({
				pid: row.pid,
				name: row.name,
				pos: row.pos,
				ovr: row.ovr,
				age: row.age,
				abbrev: row.abbrev,
				tid: row.tid,
				score: Math.round(score * 100),
				tier: COMBO_TIER_NAMES[tier - 1]!,
			});
			return {
				label: def.label,
				name: def.name,
				meaning: def.meaning,
				components:
					def.all.join(" + ") + (def.any ? ` + (${def.any.join(" or ")})` : ""),
				count: holders.length,
				tierCounts: COMBO_TIER_NAMES.map(
					(_, i) => holders.filter((h) => h.tier === i + 1).length,
				),
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
