// College mode: conference tournament brackets (docs/college-mode.md)
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import type { CollegeConfTournament } from "../../common/college/types.ts";
import * as college from "../core/college/index.ts";
import { getCollegeTeamNames } from "./collegePolls.ts";

export default defineView({
	id: "collegeConfTournaments",
	processInputs: (params: RouteParams<"collegeConfTournaments">) => {
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
		let tournaments: CollegeConfTournament[] = [];
		const state = college.getCollegeState();
		if (state && state.season === season) {
			tournaments = state.confTournaments ?? [];
		} else {
			tournaments =
				(await college.getCollegeArchive(season))?.confTournaments ?? [];
		}
		const confs = g.get("confs", season);
		const seasons = [];
		for (let s = g.get("startingSeason"); s <= g.get("season"); s++) {
			seasons.push(s);
		}
		const userTid = g.get("userTid");
		const userCid = confs.find((c) =>
			tournaments.some((t) => t.cid === c.cid && t.seeds.includes(userTid)),
		)?.cid;
		return {
			season,
			seasons,
			tournaments: tournaments.map((t) => ({
				...t,
				name: confs.find((c) => c.cid === t.cid)?.name ?? "",
			})),
			teams: await getCollegeTeamNames(season),
			userTid,
			userCid,
		};
	},
});
