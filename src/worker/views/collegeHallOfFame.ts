// College Hall of Fame data for the Hall of Fame page (hallOfFame view) and its Watch tab (hallOfFameWatch view), college leagues only
import { PLAYER } from "../../common/constants.ts";
import {
	COLLEGE_HOF_MIN,
	COLLEGE_HOF_WAIT,
	COLLEGE_HOF_WINDOW,
	type CollegeHofCase,
} from "../../common/college/hallOfFame.ts";
import { classYearAbbrev } from "../../common/college/constants.ts";
import type { Player } from "../../common/types.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import {
	coachMainTid,
	collegeCaseOf,
	collegeCoachCaseOf,
	collegeExitSeason,
	loadTeamResults,
} from "../core/hallOfFame/college.ts";

const school = (tid: number) => {
	const info = g.get("teamInfoCache")[tid];
	return { tid, abbrev: info?.abbrev ?? "", region: info?.region ?? "" };
};

const perGame = (total: number, gp: number) =>
	gp > 0 ? Math.round((10 * total) / gp) / 10 : 0;

const statsOf = (hofCase: CollegeHofCase) => ({
	gp: hofCase.gp,
	pts: perGame(hofCase.pts, hofCase.gp),
	trb: perGame(hofCase.trb, hofCase.gp),
	ast: perGame(hofCase.ast, hofCase.gp),
	ws: Math.round(10 * hofCase.ws) / 10,
});

const posOf = (p: Player) => p.ratings.at(-1)?.pos ?? "";

export const loadCollegeHallOfFame = async () => {
	const season = g.get("season");
	const teamResult = await loadTeamResults(g.get("startingSeason"), season);

	// Inductees, from the classes stored on the awards rows (plus anyone with the season on his record, e.g. an edited player)
	const classes: {
		season: number;
		classSize: number;
		candidates: number;
		players: number;
		coaches: number;
	}[] = [];
	const inducted = new Map<number, { season: number; score?: number }>();
	for (const awards of await idb.merged.awards.getAll()) {
		const hof = awards.collegeHof;
		if (!hof) {
			continue;
		}
		classes.push({
			season: awards.season,
			classSize: hof.classSize,
			candidates: hof.candidates,
			players: hof.players.length,
			coaches: hof.coaches.length,
		});
		for (const row of hof.players) {
			inducted.set(row.pid, { season: awards.season, score: row.score });
		}
	}
	classes.sort((a, b) => b.season - a.season);

	const players = [];
	for (const [pid, info] of inducted) {
		const p = await idb.merged.players.get(pid);
		if (!p || p.collegeHof === undefined) {
			continue;
		}
		const hofCase = collegeCaseOf(p, teamResult);
		players.push({
			pid: p.pid,
			firstName: p.firstName,
			lastName: p.lastName,
			pos: posOf(p),
			schools: hofCase.tids.map(school),
			firstSeason: hofCase.firstSeason,
			lastSeason: hofCase.lastSeason,
			exit: p.collegeExit?.type,
			pick: p.collegeExit?.pick,
			inducted: p.collegeHof,
			score: info.score ?? Math.round(10 * hofCase.score) / 10,
			line: hofCase.line,
			...statsOf(hofCase),
		});
	}
	players.sort((a, b) => b.inducted - a.inducted || b.score - a.score);

	const coaches = [];
	for (const c of await idb.cache.coaches.getAll()) {
		if (c.hof === undefined) {
			continue;
		}
		const hofCase = collegeCoachCaseOf(c);
		const tid = coachMainTid(c);
		coaches.push({
			cid: c.cid,
			name: `${c.firstName} ${c.lastName}`,
			inducted: c.hof,
			retiredYear: c.retiredYear,
			school: tid >= 0 ? school(tid) : undefined,
			won: hofCase.won,
			lost: hofCase.lost,
			titles: hofCase.titles,
			finalFours: hofCase.finalFours,
			coy: hofCase.coy,
			line: hofCase.line,
		});
	}
	coaches.sort((a, b) => b.inducted - a.inducted || a.cid - b.cid);

	return {
		classes,
		coaches,
		min: COLLEGE_HOF_MIN,
		players,
		wait: COLLEGE_HOF_WAIT,
		window: COLLEGE_HOF_WINDOW,
	};
};

// Watch: current players (score so far, and a projection over his remaining eligibility) and players who left school and are waiting,
// candidates or were inducted recently
const MAX_ACTIVE = 100;
const MIN_ACTIVE_SHARE = 0.3;
const MIN_RETIRED_SHARE = 0.5;

export const loadCollegeHallOfFameWatch = async () => {
	const season = g.get("season");
	const teamResult = await loadTeamResults(
		Math.max(
			g.get("startingSeason"),
			season - COLLEGE_HOF_WAIT - COLLEGE_HOF_WINDOW - 6,
		),
		season,
	);

	type Row = {
		pid: number;
		firstName: string;
		lastName: string;
		pos: string;
		classYear?: string;
		schools: ReturnType<typeof school>[];
		score: number;
		projected: number;
		status: "active" | "waiting" | "candidate" | "inducted" | "expired";
		eligible?: number;
		inducted?: number;
		line: string;
	};

	const active: Row[] = [];
	for (const p of await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	])) {
		const hofCase = collegeCaseOf(p, teamResult);
		const classYear = (p as any).classYear as number | undefined;
		// His seasons so far (the season in progress counts as played) and what is left of his four
		const played = Math.max(
			1,
			(hofCase.lastSeason ?? season) - (hofCase.firstSeason ?? season) + 1,
		);
		const left = Math.max(0, 4 - Math.max(played, classYear ?? played));
		const projected = hofCase.score + (left * hofCase.score) / played;
		if (projected < MIN_ACTIVE_SHARE * COLLEGE_HOF_MIN) {
			continue;
		}
		active.push({
			pid: p.pid,
			firstName: p.firstName,
			lastName: p.lastName,
			pos: posOf(p),
			classYear:
				classYear !== undefined ? classYearAbbrev(classYear) : undefined,
			schools: hofCase.tids.map(school),
			score: Math.round(10 * hofCase.score) / 10,
			projected: Math.round(10 * projected) / 10,
			status: "active",
			line: hofCase.line,
		});
	}
	active.sort((a, b) => b.projected - a.projected || a.pid - b.pid);
	active.splice(MAX_ACTIVE);

	const retired: Row[] = [];
	for (
		let year = season;
		year >=
		Math.max(
			g.get("startingSeason"),
			season - COLLEGE_HOF_WAIT - COLLEGE_HOF_WINDOW,
		);
		year--
	) {
		for (const p of await idb.merged.players.getAll({ retiredYear: year })) {
			if (p.tid !== PLAYER.RETIRED) {
				continue;
			}
			const hofCase = collegeCaseOf(p, teamResult);
			if (
				p.collegeHof === undefined &&
				hofCase.score < MIN_RETIRED_SHARE * COLLEGE_HOF_MIN
			) {
				continue;
			}
			const eligible = collegeExitSeason(p) + COLLEGE_HOF_WAIT;
			const status: Row["status"] =
				p.collegeHof !== undefined
					? "inducted"
					: eligible > season
						? "waiting"
						: eligible + COLLEGE_HOF_WINDOW - 1 >= season
							? "candidate"
							: "expired";
			retired.push({
				pid: p.pid,
				firstName: p.firstName,
				lastName: p.lastName,
				pos: posOf(p),
				schools: hofCase.tids.map(school),
				score: Math.round(10 * hofCase.score) / 10,
				projected: Math.round(10 * hofCase.score) / 10,
				status,
				eligible,
				inducted: p.collegeHof,
				line: hofCase.line,
			});
		}
	}
	retired.sort((a, b) => b.score - a.score || a.pid - b.pid);

	return {
		active,
		min: COLLEGE_HOF_MIN,
		retired,
		season,
		wait: COLLEGE_HOF_WAIT,
	};
};
