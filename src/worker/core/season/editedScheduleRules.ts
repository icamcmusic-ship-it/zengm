import { getEditedScheduleRules as getRules } from "../../../common/validateEditedSchedule.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";

// Schedule editor: the special-day rules for validateEditedSchedule (common/validateEditedSchedule.ts), the same for the CSV import
// in the UI (sent with the scheduleEditor view) and for the save (setScheduleFromEditor). Without the active teams (a Set, which
// the view can't send); the UI and the save add them
export const getEditedScheduleRules = async () => {
	const scheduleBefore = await idb.cache.schedule.getAll();
	const { allStarGameAllowed, tradeDeadlineAllowed } = getRules({
		activeTids: new Set(),
		allStarGameAlreadyHappened: !!(await idb.cache.allStars.get(
			g.get("season"),
		)),
		allStarGameSetting: g.get("allStarGame"),
		phase: g.get("phase"),
		scheduleHasAllStarGame: scheduleBefore.some(
			(game) => game.homeTid === -1 && game.awayTid === -2,
		),
	});
	return { allStarGameAllowed, tradeDeadlineAllowed };
};
