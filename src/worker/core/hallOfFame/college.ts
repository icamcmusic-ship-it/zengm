// College Hall of Fame (college leagues): run once a season when the season is over (phase.newPhaseBeforeDraft → runHallOfFame), in
// place of the pro Hall of Fame. Players who left the league COLLEGE_HOF_WAIT or more seasons ago are candidates; the committee inducts
// a seeded class of 2-4 of the best over the bar, and retired head coaches whose college case clears its bar join the coaches wing.
// The scores are in common/college/hallOfFame.ts. See docs/native-features.md, College Hall of Fame.
import { PLAYER } from "../../../common/constants.ts";
import {
	COLLEGE_COACH_HOF_THRESHOLD,
	COLLEGE_HOF_AWARD,
	COLLEGE_HOF_MIN,
	COLLEGE_HOF_WAIT,
	COLLEGE_HOF_WINDOW,
	collegeCoachHofCase,
	collegeHofCase,
	collegeHofClassSize,
	collegeHofVote,
	type CollegeHofCase,
	type TeamResult,
} from "../../../common/college/hallOfFame.ts";
import { COACH_OF_THE_YEAR } from "../../../common/coachExecAwards.ts";
import { COACH_RETIRED } from "../../../common/staff.ts";
import type {
	Awards,
	Coach,
	Conditions,
	Player,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import addAward from "../player/addAward.ts";

type CollegeHofRecord = NonNullable<Awards["collegeHof"]>;

const numRounds = (season: number) => {
	try {
		return g.get("numGamesPlayoffSeries", season).length;
	} catch {
		return g.get("numGamesPlayoffSeries", "current").length;
	}
};

/**
 * Each school's national tournament result in the seasons [minSeason, maxSeason], for collegeHofCase.
 */
export const loadTeamResults = async (
	minSeason: number,
	maxSeason: number,
): Promise<TeamResult> => {
	const results = new Map<string, number>();
	const start = Math.max(minSeason, g.get("startingSeason"));
	for (let season = start; season <= maxSeason; season++) {
		for (const ts of await idb.merged.teamSeasons.getAll({ season })) {
			results.set(`${ts.tid}|${ts.season}`, ts.playoffRoundsWon);
		}
	}
	return (tid, season) => {
		const roundsWon = results.get(`${tid}|${season}`);
		return roundsWon === undefined
			? undefined
			: { roundsWon, numRounds: numRounds(season) };
	};
};

// The season he left school (older leagues' players may only have retiredYear)
export const collegeExitSeason = (p: Player) =>
	p.collegeExit?.season ?? p.retiredYear;

// First season he can be inducted
export const collegeHofEligible = (p: Player) =>
	collegeExitSeason(p) + COLLEGE_HOF_WAIT;

export const collegeCaseOf = (p: Player, teamResult: TeamResult) =>
	collegeHofCase(p as any, teamResult);

const schoolNames = (tids: number[]) => {
	const teamInfoCache = g.get("teamInfoCache");
	return tids.map((tid) => teamInfoCache[tid]?.region ?? "?").join(", ");
};

const playerLink = (p: { pid: number; firstName: string; lastName: string }) =>
	`<a href="${helpers.leagueUrl(["player", p.pid])}">${p.firstName} ${p.lastName}</a>`;

const hofLink = () =>
	`<a href="${helpers.leagueUrl(["hall_of_fame"])}">College Hall of Fame</a>`;

const yearsText = (c: CollegeHofCase) =>
	c.firstSeason === undefined
		? ""
		: c.firstSeason === c.lastSeason
			? `${c.firstSeason}`
			: `${c.firstSeason}-${c.lastSeason}`;

/**
 * Candidates this season: players who left school between COLLEGE_HOF_WAIT and COLLEGE_HOF_WAIT + COLLEGE_HOF_WINDOW - 1 seasons ago,
 * are not in yet and whose case clears the bar. Read from the stored players, so an older college league has a pool the first season
 * this runs (nothing is backdated: its classes start now).
 */
export const collegeHofCandidates = async (
	season: number,
	teamResult: TeamResult,
	minScore = COLLEGE_HOF_MIN,
) => {
	const out: { p: Player; hofCase: CollegeHofCase }[] = [];
	const lastExit = season - COLLEGE_HOF_WAIT;
	const firstExit = lastExit - COLLEGE_HOF_WINDOW + 1;
	for (
		let retiredYear = Math.max(firstExit, g.get("startingSeason"));
		retiredYear <= lastExit;
		retiredYear++
	) {
		for (const p of await idb.merged.players.getAll({ retiredYear })) {
			if (p.tid !== PLAYER.RETIRED || p.collegeHof !== undefined) {
				continue;
			}
			const exit = collegeExitSeason(p);
			if (exit < firstExit || exit > lastExit) {
				continue;
			}
			const hofCase = collegeCaseOf(p, teamResult);
			if (hofCase.score >= minScore && hofCase.gp > 0) {
				out.push({ p, hofCase });
			}
		}
	}
	return out;
};

const runPlayers = async (
	season: number,
	conditions: Conditions,
): Promise<{
	rows: CollegeHofRecord["players"];
	candidates: number;
	classSize: number;
	inducted: Player[];
}> => {
	const teamResult = await loadTeamResults(
		season - COLLEGE_HOF_WAIT - COLLEGE_HOF_WINDOW - 6,
		season,
	);
	const candidates = await collegeHofCandidates(season, teamResult);
	const classSize = collegeHofClassSize(season);
	const picks = candidates
		.map((c) => ({
			...c,
			vote: collegeHofVote(c.p.pid, season, c.hofCase.score),
		}))
		.sort((a, b) => b.vote - a.vote || a.p.pid - b.p.pid)
		.slice(0, classSize);

	const userTid = g.get("userTid");
	const rows: CollegeHofRecord["players"] = [];
	const inducted: Player[] = [];
	for (const { p: p0, hofCase } of picks) {
		const p = (await idb.cache.players.get(p0.pid)) ?? p0;
		p.collegeHof = season;
		addAward(p, { season, type: COLLEGE_HOF_AWARD });
		await idb.cache.players.put(p);
		inducted.push(p);
		rows.push({
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			tids: hofCase.tids,
			firstSeason: hofCase.firstSeason,
			lastSeason: hofCase.lastSeason,
			exit: p.collegeExit?.type,
			score: Math.round(hofCase.score * 10) / 10,
			line: hofCase.line,
		});
		logEvent(
			{
				type: "hallOfFame",
				text: `${playerLink(p)} (${schoolNames(hofCase.tids)}, ${yearsText(hofCase)}; ${hofCase.line}) was inducted into the ${hofLink()}.`,
				showNotification: hofCase.tids.includes(userTid),
				pids: [p.pid],
				tids: hofCase.tids,
				score: 10,
			},
			conditions,
		);
	}
	return { rows, candidates: candidates.length, classSize, inducted };
};

export const collegeCoachCaseOf = (c: Coach) =>
	collegeCoachHofCase(
		c.stats,
		c.awards.filter((a) => a.type === COACH_OF_THE_YEAR).length,
		numRounds,
	);

// The school he was head coach of for the most seasons
export const coachMainTid = (c: Coach) => {
	const counts = new Map<number, number>();
	for (const row of c.stats) {
		if (row.role === "head") {
			counts.set(row.tid, (counts.get(row.tid) ?? 0) + 1);
		}
	}
	let best = -1;
	let bestN = 0;
	for (const [tid, n] of counts) {
		if (n > bestN) {
			best = tid;
			bestN = n;
		}
	}
	return best;
};

const runCoaches = async (season: number, conditions: Conditions) => {
	const out: CollegeHofRecord["coaches"] = [];
	for (const c of await idb.cache.coaches.getAll()) {
		if (
			c.tid !== COACH_RETIRED ||
			c.hof !== undefined ||
			c.retiredYear === undefined ||
			c.retiredYear + COLLEGE_HOF_WAIT > season
		) {
			continue;
		}
		const hofCase = collegeCoachCaseOf(c);
		if (hofCase.score < COLLEGE_COACH_HOF_THRESHOLD) {
			continue;
		}
		c.hof = season;
		await idb.cache.coaches.put(c);
		const tid = coachMainTid(c);
		const name = `${c.firstName} ${c.lastName}`;
		out.push({
			cid: c.cid,
			name,
			tid,
			score: Math.round(hofCase.score * 10) / 10,
			line: hofCase.line,
		});
		logEvent(
			{
				type: "hallOfFame",
				text: `Coach <a href="${helpers.leagueUrl(["coach", c.cid])}">${name}</a> (${tid >= 0 ? `${schoolNames([tid])}, ` : ""}${hofCase.line}) was inducted into the ${hofLink()}.`,
				showNotification: tid === g.get("userTid"),
				pids: [],
				tids: tid >= 0 ? [tid] : [],
				score: 10,
			},
			conditions,
		);
	}
	return out;
};

/**
 * The season's College Hall of Fame class (players and coaches), with a "Class of" news item, stored on the season's awards row.
 */
export const runCollegeHallOfFame = async (conditions: Conditions) => {
	const season = g.get("season");
	const { rows, candidates, classSize, inducted } = await runPlayers(
		season,
		conditions,
	);
	const coaches = await runCoaches(season, conditions);

	const parts = [
		...rows.map(
			(row) =>
				`<a href="${helpers.leagueUrl(["player", row.pid])}">${row.name}</a> (${schoolNames(row.tids)})`,
		),
		...coaches.map(
			(row) =>
				`coach <a href="${helpers.leagueUrl(["coach", row.cid])}">${row.name}</a>${row.tid >= 0 ? ` (${schoolNames([row.tid])})` : ""}`,
		),
	];
	if (parts.length > 0) {
		const list =
			parts.length === 1
				? parts[0]
				: `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
		const tids = new Set<number>();
		for (const row of rows) {
			for (const tid of row.tids) {
				tids.add(tid);
			}
		}
		for (const row of coaches) {
			if (row.tid >= 0) {
				tids.add(row.tid);
			}
		}
		logEvent(
			{
				type: "hallOfFame",
				text: `The ${hofLink()} Class of ${season}: ${list}.`,
				showNotification: tids.has(g.get("userTid")),
				pids: inducted.map((p) => p.pid),
				tids: [...tids],
				score: 20,
			},
			conditions,
		);
	}

	if (rows.length > 0 || coaches.length > 0 || candidates > 0) {
		const awards = await idb.merged.awards.get(season);
		if (awards) {
			await idb.cache.awards.put({
				...awards,
				collegeHof: { classSize, candidates, players: rows, coaches },
			});
		}
	}
};
