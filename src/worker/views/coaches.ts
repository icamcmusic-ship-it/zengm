import { COACH_ROLE_NAMES } from "../../common/staff.ts";
import {
	COACH_OF_THE_YEAR,
	getCoachAwards,
	getCoachingCarousel,
} from "../core/staff/index.ts";
import { idb } from "../db/index.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { validateSeason } from "../util/processInputs.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import {
	STAFF_DISABLED_MESSAGE,
	formatCoach,
	staffViewEnabled,
} from "./staffShared.ts";

export default defineView({
	id: "coaches",
	processInputs: (params: RouteParams<"coaches">) => ({
		season: validateSeason(params.season),
	}),
	load: async ({ updateEvents, inputs, prevInputs }) => {
		if (!staffViewEnabled()) {
			return { errorMessage: STAFF_DISABLED_MESSAGE };
		}
		const { season } = inputs;
		if (
			updateEvents.has("firstRun") ||
			season !== prevInputs?.season ||
			updateEvents.has("staff") ||
			updateEvents.has("newPhase")
		) {
			const coaches = await idb.cache.coaches.getAll();
			const abbrev = (tid: number) => g.get("teamInfoCache")[tid]?.abbrev ?? "";

			const headCoaches = coaches
				.filter((c) => c.tid >= 0 && c.role === "head")
				.map((c) => {
					const row = c.stats.find((r) => r.season === season);
					return {
						...formatCoach(c),
						seasonWon: row?.won,
						seasonLost: row?.lost,
					};
				})
				.sort((a, b) => (a.abbrev ?? "").localeCompare(b.abbrev ?? ""));

			const carousel = (await getCoachingCarousel(season)).map((m) => ({
				...m,
				abbrev: abbrev(m.tid),
			}));

			const coy = (await getCoachAwards(COACH_OF_THE_YEAR)).map((a) => ({
				...a,
				abbrev: abbrev(a.tid),
			}));

			const seasons = new Set<number>([g.get("season")]);
			for (const c of coaches) {
				for (const tx of c.transactions) {
					seasons.add(tx.season);
				}
			}

			return {
				season,
				currentSeason: g.get("season"),
				seasons: [...seasons].sort((a, b) => b - a),
				headCoaches,
				carousel,
				coy,
				roleNames: COACH_ROLE_NAMES,
				userTid: g.get("userTid"),
			};
		}
	},
});
