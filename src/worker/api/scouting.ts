// Scouting Reports (League Extras): calls from the UI for the short forms of a report (hover cards, blurbs, the Overview line,
// playoff opponent scouting) and the PDF page. Everything comes from what the user's scouts can see.
import {
	getOpponentScouting,
	getPlayerScoutingPage,
	getScoutingBlurbs,
	getScoutingHover,
	getScoutingSummary,
	scoutingReportsOn,
} from "../core/scoutingReports/index.ts";

const getHover = async (pid: number) => getScoutingHover(pid);

const getBlurbs = async (pids: number[]) => getScoutingBlurbs(pids);

const getSummary = async (pid: number) => getScoutingSummary(pid);

const getOpponent = async (season?: number) => getOpponentScouting(season);

const getPage = async ({ pid, scout }: { pid: number; scout?: number }) =>
	scoutingReportsOn() ? getPlayerScoutingPage(pid, scout) : undefined;

export default {
	getBlurbs,
	getHover,
	getOpponent,
	getPage,
	getSummary,
};
