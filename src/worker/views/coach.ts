import { COACH_ROLE_NAMES } from "../../common/staff.ts";
import { idb } from "../db/index.ts";
import { hotSeatLabel, hotSeatNow } from "../core/staff/systems.ts";
import { defineView } from "../util/defineView.ts";
import { coachingDepthOn } from "../core/staffDepth/coaching.ts";
import { coachTreePage } from "../core/staffDepth/careers.ts";
import { coachRelationshipsFor } from "../core/staff/relationships.ts";
import { g } from "../util/index.ts";
import { featureOn } from "../util/nativeFeatures.ts";
import { primeFace } from "../util/faceAging.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import {
	STAFF_DISABLED_MESSAGE,
	formatCoach,
	getTeamColors,
	staffViewEnabled,
} from "./staffShared.ts";

// An ex-player coach's prime face as a player, for "Then and Now" on his page
const playerThen = async (pid: number | undefined) => {
	if (pid === undefined || !featureOn("faceAging")) {
		return undefined;
	}
	const p = await idb.merged.players.get(pid);
	if (!p || p.imgURL || !p.faceAging) {
		return undefined;
	}
	const prime = await primeFace(p);
	return prime
		? { ...prime, pid, name: `${p.firstName} ${p.lastName}` }
		: undefined;
};

export default defineView({
	id: "coach",
	processInputs: (params: RouteParams<"coach">) => ({
		cid: Number.parseInt(params.cid ?? ""),
	}),
	load: async ({ updateEvents, inputs, prevInputs }) => {
		if (!staffViewEnabled()) {
			return { errorMessage: STAFF_DISABLED_MESSAGE };
		}
		const { cid } = inputs;
		if (
			updateEvents.has("firstRun") ||
			cid !== prevInputs?.cid ||
			updateEvents.has("staff") ||
			updateEvents.has("newPhase")
		) {
			const c = Number.isNaN(cid)
				? undefined
				: await idb.cache.coaches.get(cid);
			if (!c) {
				return { errorMessage: "Coach not found." };
			}
			const abbrev = (tid: number) => g.get("teamInfoCache")[tid]?.abbrev ?? "";
			const coach = formatCoach(c);
			if (coach.systems && coach.systems.hotSeatText) {
				const heat = await hotSeatNow(c);
				coach.systems = {
					...coach.systems,
					hotSeat: heat,
					hotSeatText: hotSeatLabel(heat),
				};
			}
			return {
				coach,
				// Coaching Staff Depth: where his career started, his mentors, protégés and the assistants who worked under him
				tree: coachingDepthOn() ? await coachTreePage(c) : undefined,
				// Face Aging: an ex-player coach's "Then and Now", his face in his prime as a player (that season's jersey)
				playerThen: await playerThen(c.tree?.exPlayer),
				// Player–coach relationships (undefined when off)
				relationships: await coachRelationshipsFor(c.cid),
				colors: c.tid >= 0 ? (await getTeamColors()).get(c.tid) : undefined,
				stats: c.stats.map((row) => ({
					...row,
					abbrev: abbrev(row.tid),
					roleName: COACH_ROLE_NAMES[row.role],
					numPlayoffRounds: g.get("numGamesPlayoffSeries", row.season).length,
				})),
				awards: c.awards,
				transactions: c.transactions.map((tx) => ({
					...tx,
					abbrev: abbrev(tx.tid),
					roleName: COACH_ROLE_NAMES[tx.role],
				})),
				userTid: g.get("userTid"),
			};
		}
	},
});
