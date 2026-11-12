import afterPicks from "./afterPicks.ts";
import deleteLotteryResultIfNoDraftYet from "./deleteLotteryResultIfNoDraftYet.ts";
import genOrder from "./genOrder.ts";
import genOrderFantasy from "./genOrderFantasy.ts";
import genPicks from "./genPicks.ts";
import genPlayers from "./genPlayers.ts";
import {
	generateCollegeStats,
	autoGenerateCollegeStats,
	processNewDraftClasses,
	generateCollegeStatsAllClasses,
	removeCollegeStats,
	upgradeCollegeStats,
} from "./generateCollegeStats.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import getOrder from "./getOrder.ts";
import getRookieContractLength from "./getRookieContractLength.ts";
import getRookieSalaries from "./getRookieSalaries.ts";
import runPicks from "./runPicks.ts";
import selectPlayer from "./selectPlayer.ts";
import topUpDraftClasses from "./topUpDraftClasses.ts";

export default {
	afterPicks,
	deleteLotteryResultIfNoDraftYet,
	genOrder,
	genOrderFantasy,
	genPicks,
	genPlayers,
	genPlayersWithoutSaving,
	generateCollegeStats,
	autoGenerateCollegeStats,
	processNewDraftClasses,
	generateCollegeStatsAllClasses,
	removeCollegeStats,
	upgradeCollegeStats,
	getOrder,
	getRookieContractLength,
	getRookieSalaries,
	runPicks,
	selectPlayer,
	topUpDraftClasses,
};
