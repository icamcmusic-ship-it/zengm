import { COACH_ROLE_NAMES } from "../../common/staff.ts";
import { idb } from "../db/index.ts";
import { hotSeatLabel, hotSeatNow } from "../core/staff/systems.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import {
	STAFF_DISABLED_MESSAGE,
	formatCoach,
	getTeamColors,
	staffViewEnabled,
} from "./staffShared.ts";

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
