import { idb } from "../db/index.ts";
import { player } from "../core/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { PLAYER } from "../../common/constants.ts";
import {
	BADGE_GROUP_NAMES,
	BADGE_RATING_KEYS,
	SKILL_BADGES,
	badgeScore,
	conditionMet as matches,
	pickBadgeRatings,
	type BadgeRatings,
} from "../../common/skillBadges/index.ts";
import type { RouteParams } from "../../ui/router/types.ts";

const processInputs = (params: RouteParams<"skillBadges">) => {
	const label =
		params.badge !== undefined &&
		SKILL_BADGES.some((def) => def.label === params.badge)
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
			ratings: [...BADGE_RATING_KEYS, "ovr", "pos"],
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

		return {
			label: inputs.label,
			numPlayers: rows.length,
			numTeams: g.get("numActiveTeams"),
			userTid: g.get("userTid"),
			badges,
		};
	},
});
