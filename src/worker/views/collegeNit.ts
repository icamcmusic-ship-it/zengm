// College mode: the NIT bracket (docs/college-mode.md)
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import type { CollegeNit } from "../../common/college/types.ts";
import * as college from "../core/college/index.ts";
import { getCollegeTeamNames } from "./collegePolls.ts";

export default defineView({
	id: "collegeNit",
	processInputs: (params: RouteParams<"collegeNit">) => {
		const season =
			params.season !== undefined ? Number.parseInt(params.season) : undefined;
		return {
			season:
				season === undefined || Number.isNaN(season) ? g.get("season") : season,
		};
	},
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (!college.isCollege()) {
			return {
				errorMessage: "This page is only available in college leagues.",
			};
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("gameSim") &&
			!updateEvents.has("newPhase") &&
			inputs.season === prevInputs?.season
		) {
			return;
		}
		const season = inputs.season;
		let nit: CollegeNit | undefined;
		const state = college.getCollegeState();
		if (state && state.season === season) {
			nit = state.nit;
		} else {
			nit = (await college.getCollegeArchive(season))?.nit;
		}
		const seasons = [];
		for (let s = g.get("startingSeason"); s <= g.get("season"); s++) {
			seasons.push(s);
		}
		return {
			season,
			seasons,
			nit,
			enabled: college.nitOn(),
			teams: await getCollegeTeamNames(season),
			userTid: g.get("userTid"),
		};
	},
});
