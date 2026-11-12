// College mode: the off-season movement of a season: the pro draft, graduation, the transfer portal, signing day (docs/college-mode.md)
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import * as college from "../core/college/index.ts";
import { getCollegeTeamNames } from "./collegePolls.ts";

export default defineView({
	id: "collegeDepartures",
	processInputs: (params: RouteParams<"collegeDepartures">) => {
		const season =
			params.season !== undefined ? Number.parseInt(params.season) : undefined;
		return {
			season:
				season === undefined || Number.isNaN(season)
					? g.get("season") - (g.get("phase") < 5 ? 1 : 0)
					: season,
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
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("newPhase") &&
			inputs.season === prevInputs?.season
		) {
			return;
		}
		const season = inputs.season;
		const archive = await college.getCollegeArchive(season);
		const seasons = [];
		for (let s = g.get("startingSeason"); s <= g.get("season"); s++) {
			seasons.push(s);
		}
		return {
			season,
			seasons,
			proDraft: archive?.proDraft ?? [],
			graduated: archive?.graduated,
			transfers: archive?.transfers ?? [],
			commits: archive?.commits ?? [],
			teams: await getCollegeTeamNames(season),
			userTid: g.get("userTid"),
		};
	},
});
