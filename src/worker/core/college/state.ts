// College mode: the working state of the current season (results log, weekly AP poll). See docs/college-mode.md.
import { PHASE } from "../../../common/constants.ts";
import {
	COLLEGE_GAME,
	RESULT_SIZE,
	type CollegeState,
} from "../../../common/college/types.ts";
import {
	buildWeeklyPolls,
	REGULAR_WEEKS,
	type PollGame,
} from "../../../common/collegeStats/ncaaPolls.ts";
import type { GameResults } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { getTeamPrestige } from "./players.ts";
import { last } from "../../../common/utils.ts";

export const getCollegeState = (): CollegeState | undefined => {
	const state = g.get("collegeState");
	return state && state.season === g.get("season") ? state : undefined;
};

export const saveCollegeState = async (state: CollegeState) => {
	// A new object, so anything that compares game attributes by reference sees the change
	const value = { ...state };
	await idb.cache.gameAttributes.put({ key: "collegeState", value });
	g.setWithoutSavingToDB("collegeState", value);
	return value;
};

// Weeks 1 to REGULAR_WEEKS - 1 are the regular season, the last one is the conference tournaments
const REG_POLL_WEEKS = REGULAR_WEEKS - 1;

export const weekOfDay = (day: number, regDays: number) =>
	Math.max(
		1,
		Math.min(REG_POLL_WEEKS, Math.ceil((day * REG_POLL_WEEKS) / regDays)),
	);

const pollGames = (state: CollegeState, firstDay: number): PollGame[] => {
	const games: PollGame[] = [];
	const r = state.results;
	for (let i = 0; i < r.length; i += RESULT_SIZE) {
		const type = r[i + 5]!;
		if (type === COLLEGE_GAME.NATIONAL) {
			continue;
		}
		games.push({
			a: r[i + 1]!,
			b: r[i + 2]!,
			d: r[i + 3]!,
			week:
				type === COLLEGE_GAME.CONF_TOURNAMENT
					? REGULAR_WEEKS
					: weekOfDay(r[i]! - firstDay + 1, state.regDays),
		});
	}
	return games;
};

const firstDayOf = (state: CollegeState) =>
	state.results.length > 0 ? state.results[0]! : 1;

/**
 * Polls up to and including the given week (0 = preseason), from the results so far. The poll engine is deterministic for a league and
 * season, and a week's poll only reads the games up to that week, so calling this again later never changes the polls already made.
 */
export const makePolls = (state: CollegeState, week: number) => {
	const polls = buildWeeklyPolls({
		seed: `college|${g.get("lid")}`,
		season: state.season,
		reputation: state.reputation,
		games: pollGames(state, firstDayOf(state)),
		finalPoll: { ranked: [], others: [] },
	});
	const kept = polls.slice(0, Math.min(week, REGULAR_WEEKS) + 1);
	if (week >= REGULAR_WEEKS && kept.length > 0) {
		kept.at(-1)!.label = "Final";
	}
	state.polls = kept;
	state.pollWeek = week;
};

/**
 * Preseason reputation of every team in points per game around 0 (what the voters know before a game is played): the program's prestige and
 * the roster.
 */
export const getReputations = async () => {
	const teams = await idb.cache.teams.getAll();
	const numTeams = g.get("numTeams");
	const raw: number[] = Array.from({ length: numTeams }, () => -30);
	let sum = 0;
	let count = 0;
	for (const t of teams) {
		if (t.disabled) {
			continue;
		}
		const players = await idb.cache.players.indexGetAll("playersByTid", t.tid);
		const ovrs = players
			.map((p) => last(p.ratings).ovr)
			.sort((a, b) => b - a)
			.slice(0, 8);
		const weights = [1, 1, 1, 0.9, 0.8, 0.6, 0.4, 0.3];
		let rating = 0;
		let total = 0;
		for (const [i, ovr] of ovrs.entries()) {
			rating += ovr * weights[i]!;
			total += weights[i]!;
		}
		rating = total > 0 ? rating / total : 30;
		// About a point of margin per point of top-8 rating, plus what the name is worth
		const value = 1.1 * rating + 0.15 * getTeamPrestige(t as any);
		raw[t.tid] = value;
		sum += value;
		count += 1;
	}
	const mean = count > 0 ? sum / count : 0;
	return raw.map((value) => (value === -30 ? -30 : value - mean));
};

export const initCollegeSeason = async (regDays: number) => {
	const state: CollegeState = {
		season: g.get("season"),
		results: [],
		regDays,
		reputation: await getReputations(),
		polls: [],
		pollWeek: 0,
	};
	makePolls(state, 0);
	return saveCollegeState(state);
};

const gameType = (results: GameResults, phase: number) => {
	if (phase === PHASE.PLAYOFFS) {
		return COLLEGE_GAME.NATIONAL;
	}
	if (phase === PHASE.AFTER_TRADE_DEADLINE) {
		return COLLEGE_GAME.CONF_TOURNAMENT;
	}
	return results.team[0].cid === results.team[1].cid
		? COLLEGE_GAME.CONF
		: COLLEGE_GAME.NON_CONF;
};

/**
 * Append a day's games to the results log. Returns the state (not saved yet).
 */
export const recordResults = (state: CollegeState, results: GameResults[]) => {
	const phase = g.get("phase");
	for (const result of results) {
		const home = result.team[0];
		const away = result.team[1];
		if (home.id < 0 || away.id < 0) {
			continue;
		}
		const type = gameType(result, phase);
		state.results.push(
			typeof result.day === "number" ? result.day : 0,
			home.id,
			away.id,
			home.stat.pts - away.stat.pts,
			type === COLLEGE_GAME.NON_CONF || type === COLLEGE_GAME.CONF ? 1 : 0,
			type,
		);
	}
};

// Record of every team in the results log (all games but the national tournament)
export const getRecords = (state: CollegeState) => {
	const numTeams = g.get("numTeams");
	const w: number[] = Array.from({ length: numTeams }, () => 0);
	const l: number[] = Array.from({ length: numTeams }, () => 0);
	const r = state.results;
	for (let i = 0; i < r.length; i += RESULT_SIZE) {
		if (r[i + 5] === COLLEGE_GAME.NATIONAL) {
			continue;
		}
		const d = r[i + 3]!;
		const [win, lose] = d > 0 ? [r[i + 1]!, r[i + 2]!] : [r[i + 2]!, r[i + 1]!];
		w[win]! += 1;
		l[lose]! += 1;
	}
	return { w, l };
};
