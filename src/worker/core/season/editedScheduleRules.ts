import { PHASE } from "../../../common/constants.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";

// Schedule editor: the special-day rules for validateEditedSchedule (common/validateEditedSchedule.ts), the same for the CSV import
// in the UI (sent with the scheduleEditor view) and for the save (setScheduleFromEditor)
export const getEditedScheduleRules = async () => {
	const scheduleBefore = await idb.cache.schedule.getAll();
	const allStarGameSetting = g.get("allStarGame");
	const allStarGameAllowed =
		scheduleBefore.some((game) => game.homeTid === -1 && game.awayTid === -2) ||
		(allStarGameSetting !== null &&
			allStarGameSetting >= 0 &&
			!(await idb.cache.allStars.get(g.get("season"))));
	return {
		allStarGameAllowed,
		// Another one would start the AFTER_TRADE_DEADLINE phase again (play.ts)
		tradeDeadlineAllowed: g.get("phase") < PHASE.AFTER_TRADE_DEADLINE,
	};
};
