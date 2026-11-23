import { defineView, keepType } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { idb } from "../db/index.ts";
import { getStaffReport } from "../core/staffDepth/report.ts";
import { coachingDepthOn } from "../core/staffDepth/coaching.ts";
import { scoutingDepthOn } from "../core/staffDepth/scouting.ts";
import { isCollege } from "../core/college/isCollege.ts";
import {
	devBand,
	getBudgetRecs,
	getScorecards,
	getStaffHistory,
} from "../core/staffDepth/scorecard.ts";
import type { StaffScorecard } from "../../common/types.ts";

// While games are played, the report is redone every few games of the user's team (the Director's board and looks move weekly), not
// every day
const GAMES_PER_REFRESH = 4;

const simKeyOf = async (tid: number) => {
	const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
		g.get("season"),
		tid,
	]);
	const gp = ts ? ts.won + ts.lost + ts.tied + ts.otl : 0;
	return `${g.get("season")}|${tid}|${Math.floor(gp / GAMES_PER_REFRESH)}`;
};

// Staff Report (Scouting Director & Regions / Coaching Staff Depth): top targets and blind spots, development results and plans, system
// fit, injury/conditioning outlook, one recommended action per area, pending proposals and delegation
export default defineView({
	id: "staffReport",
	processInputs: () => ({}),
	keepPrevOutput: { simKey: keepType<string>() },
	load: async ({ updateEvents, prevOutput }) => {
		if (__SPORT !== "basketball") {
			return { errorMessage: "The Staff Report is only in Basketball GM." };
		}
		// The same switches the staff work runs on (both are off in college leagues, which have no pro targets either)
		if (!scoutingDepthOn() && !coachingDepthOn()) {
			return {
				errorMessage: isCollege()
					? "The Staff Report isn't used in college leagues."
					: "The Staff Report needs Scouting Reports or the Coaching Staff, and both are turned off in this league.",
			};
		}
		const tid = g.get("userTid");
		const simKey = await simKeyOf(tid);
		const changed =
			updateEvents.has("firstRun") ||
			updateEvents.has("newPhase") ||
			updateEvents.has("staff") ||
			updateEvents.has("playerMovement") ||
			updateEvents.has("gameAttributes") ||
			updateEvents.has("teamFinances") ||
			updateEvents.has("watchList") ||
			updateEvents.has("team") ||
			(updateEvents.has("gameSim") && simKey !== prevOutput.simKey);
		if (!changed) {
			return;
		}
		const report = await getStaffReport();
		if (!report) {
			return { errorMessage: "No team." };
		}

		// Scorecard (last 3 seasons), budget recommendations and the History tab. No Visible Ratings: development as a band only
		const noRatings = !!g.get("challengeNoRatings");
		const strip = (card: StaffScorecard) => ({
			...card,
			devYou: noRatings ? undefined : card.devYou,
			devLeague: noRatings ? undefined : card.devLeague,
			devBand: devBand(card),
		});
		const cards = await getScorecards(tid);
		const budgetRecs = await getBudgetRecs(tid, cards.at(-1));
		const history = getStaffHistory()
			.filter((x) => x.tid === tid && x.season < g.get("season"))
			.toReversed()
			.map((x) => ({
				...x,
				scorecard: x.scorecard ? strip(x.scorecard) : undefined,
			}));
		return {
			...report,
			simKey,
			scorecards: cards.map(strip),
			budgetRecs,
			budgetOn: !!g.get("budget"),
			history,
		};
	},
});
