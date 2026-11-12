// College mode: the transfer portal (docs/college-mode.md)
import { PHASE } from "../../common/constants.ts";
import { classYearAbbrev } from "../../common/college/constants.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import * as college from "../core/college/index.ts";
import { getBoard, isPortalOpen } from "../core/college/recruiting.ts";
import { getClassYear } from "../core/college/offseason.ts";
import { getCollegeTeamNames } from "./collegePolls.ts";

export default defineView({
	id: "collegePortal",
	load: async ({ updateEvents }) => {
		if (!college.isCollege()) {
			return {
				errorMessage: "This page is only available in college leagues.",
			};
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes")
		) {
			return;
		}
		const season = g.get("season");
		const open = isPortalOpen();
		const board = open ? await getBoard("portal") : undefined;
		const players = (board?.list ?? []).map(({ pr, info }) => ({
			...info,
			from: pr.p.portal!.from,
			classYear: classYearAbbrev(getClassYear(pr.p)),
		}));
		players.sort((a, b) => b.ovr - a.ovr);
		const archive = await college.getCollegeArchive(season);
		return {
			open,
			after: g.get("phase") > PHASE.AFTER_DRAFT || g.get("phase") < 0,
			players,
			state: board?.state,
			openSpots: board?.openSpots ?? 0,
			offers: board?.offers ?? 0,
			offerLimit: board?.offerLimit ?? 0,
			weeksLeft: board?.weeksLeft ?? 0,
			transfers: archive?.transfers ?? [],
			season,
			teams: await getCollegeTeamNames(season),
			userTid: g.get("userTid"),
			autoRecruit: g.get("collegeAutoRecruit"),
		};
	},
});
