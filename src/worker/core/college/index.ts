// College mode (docs/college-mode.md): everything a college league does differently from a pro league. The engine calls into this module
// behind isCollege() checks.
import { PHASE } from "../../../common/constants.ts";
import { REGULAR_WEEKS } from "../../../common/collegeStats/ncaaPolls.ts";
import { getSchoolPrestige } from "../../../common/college/teams.ts";
import type {
	Conditions,
	GameResults,
	PhaseReturn,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { recomputeLocalUITeamOvrs } from "../../util/recomputeLocalUITeamOvrs.ts";
import { league, team } from "../index.ts";
import { updateCollegeArchive } from "./archive.ts";
import {
	addRecruitingClass,
	doDepartures,
	doSigningDay,
	doTransferPortal,
	onPreseason,
} from "./offseason.ts";
import {
	afterConfTournamentGames,
	scheduleConfTournamentDay,
	startConfTournaments,
} from "./postseason.ts";
import { newCollegeSchedule } from "./schedule.ts";
import {
	getCollegeState,
	initCollegeSeason,
	makePolls,
	recordResults,
	saveCollegeState,
	weekOfDay,
} from "./state.ts";

export { isCollege } from "./isCollege.ts";
export { createCollegePlayers, getTeamPrestige } from "./players.ts";
export { getCollegeArchive, updateCollegeArchive } from "./archive.ts";
export { getCollegeState } from "./state.ts";
export {
	playQuickGames,
	throttleAdvStats,
	useQuickSim,
} from "./quickSim.ts";
export { genNationalTournament, getNetRows } from "./postseason.ts";
export {
	addRecruitingClass,
	autoSetTargets,
	genRecruitingClass,
	getExpectationDeltas,
	getRecruitingBoard,
	getRecruitingClassSize,
	interestLabel,
	onPreseason,
} from "./offseason.ts";

/**
 * Regular season: write the schedule (one round per day) and start the season's state (results log, preseason poll).
 */
export const startRegularSeason = async () => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const { rounds } = newCollegeSchedule(
		teams.map((t) => ({ tid: t.tid, cid: t.cid })),
		g.get("numGames"),
	);
	await idb.cache.schedule.clear();
	const games = [];
	for (const [i, round] of rounds.entries()) {
		for (const [homeTid, awayTid] of round) {
			games.push({ homeTid, awayTid, day: i + 1 });
		}
	}
	await idb.cache.schedule.addAll(games);
	await recomputeLocalUITeamOvrs();
	await initCollegeSeason(rounds.length);
};

/**
 * After a day's games are saved (or one game of a day, when a game is watched live).
 */
export const afterGames = async (results: GameResults[], dayOver: boolean) => {
	const state = getCollegeState();
	if (!state) {
		return;
	}
	recordResults(state, results);
	const phase = g.get("phase");
	if (phase === PHASE.AFTER_TRADE_DEADLINE) {
		await afterConfTournamentGames(state, results);
		await saveCollegeState(state);
		if (dayOver) {
			await scheduleConfTournamentDay(state);
		}
		return;
	}
	if (phase === PHASE.REGULAR_SEASON && dayOver) {
		const day = results.find((r) => typeof r.day === "number")?.day;
		if (typeof day === "number") {
			const week = weekOfDay(day, state.regDays);
			if (
				week > state.pollWeek &&
				(day >= state.regDays || weekOfDay(day + 1, state.regDays) > week)
			) {
				makePolls(state, week);
			}
		}
	}
	await saveCollegeState(state);
};

export const newPhaseConfTournaments = async (): Promise<PhaseReturn> => {
	const state = getCollegeState();
	if (state && state.pollWeek < REGULAR_WEEKS - 1) {
		makePolls(state, REGULAR_WEEKS - 1);
		await saveCollegeState(state);
	}
	await startConfTournaments();
	return {
		redirect: {
			url: helpers.leagueUrl(["college_conf_tournaments"]),
			text: "View conference tournaments",
		},
	};
};

/**
 * Season over (after the awards): archive the season's polls, brackets and selection on the awards record.
 */
export const archiveSeason = async () => {
	const state = getCollegeState();
	if (!state) {
		return;
	}
	await updateCollegeArchive({
		polls: state.polls,
		confTournaments: state.confTournaments,
		selection: state.selection
			? {
					...state.selection,
					// The top of the ranking is enough for the archive
					net: state.selection.net.slice(0, 120),
				}
			: undefined,
	});
};

export const newPhaseDepartures = async (
	conditions: Conditions,
): Promise<PhaseReturn> => {
	await idb.cache.schedule.clear();
	await doDepartures(conditions);
	await league.setGameAttributes({ otherTeamsWantToHire: false });
	return {
		redirect: {
			url: helpers.leagueUrl(["college_departures"]),
			text: "View departures",
		},
		updateEvents: ["playerMovement"],
	};
};

export const newPhaseTransferPortal = async (
	conditions: Conditions,
): Promise<PhaseReturn> => {
	await idb.cache.schedule.clear();
	await doTransferPortal(conditions);
	return {
		updateEvents: ["playerMovement"],
	};
};

export const newPhaseRecruiting = async (): Promise<PhaseReturn> => {
	await idb.cache.schedule.clear();
	// A league that somehow has no class (imported, changed by hand) gets one now
	await addRecruitingClass();
	return {
		redirect: {
			url: helpers.leagueUrl(["college_recruiting"]),
			text: "View recruiting",
		},
		updateEvents: ["playerMovement"],
	};
};

export const newPhaseSigningDay = async (
	conditions: Conditions,
): Promise<PhaseReturn> => {
	await idb.cache.schedule.clear();
	await doSigningDay(conditions);
	return {
		redirect: {
			url: helpers.leagueUrl(["college_recruiting"]),
			text: "View recruiting class",
		},
		updateEvents: ["playerMovement"],
	};
};

/**
 * League creation, after the players are saved: prestige on the teams, the first recruiting class, sorted rosters.
 */
export const afterLeagueCreation = async () => {
	const teams = await idb.cache.teams.getAll();
	for (const t of teams) {
		const prestige = getSchoolPrestige(t.region);
		if (prestige !== undefined && (t as any).collegePrestige === undefined) {
			(t as any).collegePrestige = prestige;
			(t as any).collegePrestigeBase = prestige;
			await idb.cache.teams.put(t);
		}
	}
	await addRecruitingClass();
	for (const t of teams) {
		if (!t.disabled) {
			await team.rosterAutoSort(t.tid);
		}
	}
};

export { onPreseason as collegePreseason };
