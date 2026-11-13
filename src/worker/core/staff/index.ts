// Links are built by hand rather than with helpers.leagueUrl, because typing this module through the route types is circular (views -> staff -> routes).

// Coaching staff: generation, offseason market, hiring/firing, records and awards.
// Basketball only, and only when the coachingStaff setting is enabled. Development effects work by keeping t.budget.coaching equal to the staff's equivalent budget level, so everything that reads coaching levels (getLevelLastThree -> player development) uses the staff automatically.

import { PHASE } from "../../../common/constants.ts";
import { gauss, randInt, truncGauss } from "../../../common/random.ts";
import {
	COACH_FREE_AGENT,
	COACH_RETIRED,
	COACH_ROLE_NAMES,
	coachOvr,
	coachSalaryDemand,
	STAFF_DEV_SCORE_REF,
	staffDevScore,
	staffDevScoreToLevel,
} from "../../../common/staff.ts";
import type {
	Coach,
	CoachRatings,
	CoachRole,
	CoachStyle,
	CoachTransactionType,
	CoachWithoutKey,
	Team,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { generateFace } from "../../util/face.ts";
import name from "../player/name.ts";
import { getAllGmWeights } from "../gm/index.ts";
import { isCollege } from "../college/isCollege.ts";
import { getExpectedWinps } from "../college/expectations.ts";
import { collegeFireProb, runCollegeCarousel } from "./collegeCarousel.ts";
import {
	activeCoachRoles,
	clearDepthCache,
	coachingCareersOn,
	coachingDepthOn,
	ensureDepthRatings,
	isDepthRole,
} from "../staffDepth/coaching.ts";
import {
	afterCoachingMarket,
	exPlayerCoaches,
	headCandidateBonus,
	isHeadEligible,
	onCoachHired,
	userHiringDelegation,
} from "../staffDepth/careers.ts";
import {
	adaptSystems,
	annotateSeason,
	clearCoachSystemsCache,
	coachSystemsEnabled,
	ensureProfiles,
	getTeamHiringContext,
	headCoachFitBonus,
	hotSeatFireProb,
	onHeadCoachHired,
	profileForNewCoach,
	type HiringContext,
} from "./systems.ts";

export const staffEnabled = () =>
	__SPORT === "basketball" && !!g.get("coachingStaff");

const bound = (x: number) => helpers.bound(Math.round(x), 1, 100);

// Season that a contract signed now starts in
const contractStartSeason = () =>
	g.get("phase") > PHASE.PLAYOFFS ? g.get("season") + 1 : g.get("season");

const genStyle = (): CoachStyle => {
	const r = () => helpers.bound(Math.round(gauss(0, 0.45) * 100) / 100, -1, 1);
	return { pace: r(), threes: r(), defense: r(), rotation: r() };
};

export const generateCoach = async ({
	role,
	young,
}: {
	role: CoachRole;
	young?: boolean;
}): Promise<CoachWithoutKey> => {
	const { country, firstName, lastName, race } = await name();

	const base = () => truncGauss(42, 9, 15, 85);
	const ratings: CoachRatings = {
		dev: base(),
		off: base(),
		def: base(),
		mot: base(),
	};
	if (role === "head") {
		ratings.off += gauss(9, 4);
		ratings.def += gauss(9, 4);
		ratings.mot += gauss(9, 4);
	} else if (isDepthRole(role)) {
		// Coaching Staff Depth: the job's own rating, from his others (no random draws) plus the specialist's edge
		ensureDepthRatings({
			firstName,
			lastName,
			born: { year: 0, loc: "" },
			ratings,
		} as any);
		const key = role === "shoot" ? "sht" : role === "sc" ? "cnd" : "vid";
		ratings[key] = ratings[key]! + gauss(15, 5);
	} else {
		ratings[role as "dev" | "off" | "def"] += gauss(15, 5);
	}
	if (young) {
		for (const key of helpers.keys(ratings)) {
			ratings[key] -= 4;
		}
	}
	for (const key of helpers.keys(ratings)) {
		ratings[key] = bound(ratings[key]!);
	}

	const age = young
		? randInt(29, 42)
		: role === "head"
			? randInt(38, 66)
			: randInt(31, 62);

	const c: CoachWithoutKey = {
		firstName,
		lastName,
		born: {
			year: g.get("season") - age,
			loc: country,
		},
		face: generateFace({ race, age }),
		tid: COACH_FREE_AGENT,
		role,
		ratings,
		style: genStyle(),
		contract: {
			amount: coachSalaryDemand(ratings, role, g.get("salaryCap")),
			exp: contractStartSeason() + randInt(1, 3),
		},
		stats: [],
		awards: [],
		transactions: [],
	};
	// Coaching Staff Depth: every coach has the extra jobs' ratings, and where his career started
	if (coachingDepthOn()) {
		ensureDepthRatings(c);
	}
	if (coachingCareersOn()) {
		c.tree = { start: role, startSeason: contractStartSeason() };
	}
	// Coaching systems: his systems, following the league's trends (no random draws)
	const profile = profileForNewCoach(c);
	if (profile) {
		c.profile = profile;
	}
	return c;
};

export const addTransaction = (
	c: CoachWithoutKey,
	tid: number,
	role: CoachRole,
	type: CoachTransactionType,
) => {
	c.transactions.push({
		season: g.get("season"),
		phase: g.get("phase"),
		tid,
		role,
		type,
	});
};

export const getTeamStaff = async (tid: number) => {
	const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
	const staff: Partial<Record<CoachRole, Coach>> = {};
	for (const c of coaches) {
		staff[c.role] = c;
	}
	return staff;
};

export const getStaffPayroll = async (tid: number) => {
	const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
	let total = 0;
	for (const c of coaches) {
		total += c.contract.amount;
	}
	return total;
};

const getTeamDevScore = async (tid: number) => {
	const staff = await getTeamStaff(tid);
	return staffDevScore({
		head: staff.head?.ratings,
		dev: staff.dev?.ratings,
		off: staff.off?.ratings,
		def: staff.def?.ratings,
	});
};

// Carry-over: a team's development score is this share of last season's plus the rest of its current staff's, so a new coach's effect
// phases in (35% the first season, 58% the second, 73% the third, ...) and a team's development edge doesn't jump with every staff change.
// STAFF_DEV_SCORE_SPREAD is set so the league-wide spread of effects is what it was without it (docs/rating-inflation.md)
export const STAFF_DEV_CARRY = 0.65;

// The season a staff's development counts for: the coming one after the playoffs
const staffSeason = () => contractStartSeason();

export const effectiveStaffDevScore = (
	t: Pick<Team, "staffDevCarry">,
	raw: number,
	season: number = staffSeason(),
) => {
	const carry = t.staffDevCarry;
	// (carry.season === season: committed at this offseason, which already counts for the coming season)
	if (!carry || carry.season < season - 1) {
		// A new league, or one from before this: the staff as it is
		return raw;
	}
	return STAFF_DEV_CARRY * carry.score + (1 - STAFF_DEV_CARRY) * raw;
};

const getTeamEffectiveDevScore = async (t: Team, season?: number) =>
	effectiveStaffDevScore(t, await getTeamDevScore(t.tid), season);

// After the playoffs, before any staff change: remember the score the season was played with
const commitDevCarry = async () => {
	const season = g.get("season");
	for (const t of (await idb.cache.teams.getAll()).filter((t) => !t.disabled)) {
		if (t.staffDevCarry?.season === season) {
			continue;
		}
		t.staffDevCarry = {
			season,
			score:
				Math.round((await getTeamEffectiveDevScore(t, season)) * 1000) / 1000,
		};
		await idb.cache.teams.put(t);
	}
};

// Average dev score of the league's current staffs, the score of an "average" staff (development effect 0). Normalizing
// by it keeps the league-wide development effect centered as the coach pool's ratings drift over the decades, so the
// coaching staff doesn't inflate or deflate player ratings (docs/rating-inflation.md). Only the spread across teams
// matters, like with AI coaching budgets.
// Only for measuring the old behaviour (fixed reference) in tools/ratingInflation
export const staffDevScoreRefOptions = { fixed: false };

export const getLeagueStaffDevScoreRef = async () => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	if (teams.length === 0 || staffDevScoreRefOptions.fixed) {
		return STAFF_DEV_SCORE_REF;
	}
	let total = 0;
	for (const t of teams) {
		total += await getTeamEffectiveDevScore(t);
	}
	return total / teams.length;
};

export const getStaffLevel = async (tid: number, ref?: number) => {
	const t = await idb.cache.teams.get(tid);
	const raw = await getTeamDevScore(tid);
	return staffDevScoreToLevel(
		t ? effectiveStaffDevScore(t, raw) : raw,
		ref ?? (await getLeagueStaffDevScoreRef()),
	);
};

// Keep t.budget.coaching equal to the staff's level, which is what is recorded in teamSeason.expenseLevels and used for player development
export const syncBudget = async (
	t: Team,
	alsoInitial?: boolean,
	ref?: number,
) => {
	const level = await getStaffLevel(t.tid, ref);
	t.budget.coaching = level;
	if (alsoInitial) {
		t.initialBudget.coaching = level;
	}
	await idb.cache.teams.put(t);
	return level;
};

export const syncAllBudgets = async (alsoInitial?: boolean) => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const ref = await getLeagueStaffDevScoreRef();
	for (const t of teams) {
		await syncBudget(t, alsoInitial, ref);
	}
};

const userControlsTeam = (tid: number) =>
	g.get("userTids").includes(tid) &&
	!local.autoPlayUntil &&
	!g.get("spectator");

const logHeadCoachEvent = async (text: string, tid: number) => {
	await logEvent({
		type: "info",
		text,
		showNotification: false,
		tids: [tid],
		score: 0,
	});
};

export const teamLink = (tid: number) => {
	const info = g.get("teamInfoCache")[tid];
	if (!info) {
		return "a team";
	}
	return `the <a href="/l/${g.get("lid")}/staff/${info.abbrev}_${tid}">${info.region} ${info.name}</a>`;
};

export const coachLink = (c: Coach) =>
	`<a href="/l/${g.get("lid")}/coach/${c.cid}">${c.firstName} ${c.lastName}</a>`;

export const hire = async (
	c: Coach,
	tid: number,
	role: CoachRole,
	years?: number,
	// College carousel: its own news item instead of the plain "hired" one
	news?: { text: string; tids: number[] },
) => {
	// Coaching Staff Depth: promotions, poaching and the coaching tree (before he changes jobs)
	const depthNews = coachingCareersOn()
		? await onCoachHired(c, tid, role)
		: undefined;
	c.tid = tid;
	c.role = role;
	c.contract = {
		amount: coachSalaryDemand(c.ratings, role, g.get("salaryCap")),
		exp: contractStartSeason() + (years ?? randInt(2, 4)) - 1,
	};
	addTransaction(c, tid, role, "hired");
	c.hiredRecord = undefined;
	const phase = g.get("phase");
	if (phase >= PHASE.REGULAR_SEASON && phase <= PHASE.PLAYOFFS) {
		const ts = await getRecord(g.get("season"), tid);
		if (ts && ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0) > 0) {
			c.hiredRecord = {
				season: g.get("season"),
				tid,
				won: ts.won,
				lost: ts.lost,
				tied: ts.tied ?? 0,
				otl: ts.otl ?? 0,
			};
		}
	}
	await idb.cache.coaches.put(c);
	if (role === "head") {
		// Coaching systems: coaching tree and installation of his systems
		await onHeadCoachHired(c);
		if (news) {
			await logEvent({
				type: "info",
				text: news.text,
				showNotification: false,
				tids: news.tids,
				score: 10,
			});
		} else {
			await logHeadCoachEvent(
				depthNews?.text ??
					`${teamLink(tid)} hired ${coachLink(c)} as head coach.`,
				tid,
			);
		}
	}
	clearCoachSystemsCache();
	clearDepthCache();
};

// Fired by this team this season or last: it can't hire him back yet (AI teams don't, and for the user it would be an exploit:
// fire an overpaid coach for half the rest of his contract and rehire him at his lower asking price)
export const firedRecentlyBy = (c: Coach, tid: number) => {
	const lastTx = c.transactions.at(-1);
	return (
		lastTx !== undefined &&
		lastTx.tid === tid &&
		lastTx.type === "fired" &&
		lastTx.season >= g.get("season") - 1
	);
};

// Half of what's left on the contract, paid now as a coaching expense
export const getBuyout = (c: Coach) => {
	const season = g.get("season");
	const remaining =
		c.contract.exp - season + (g.get("phase") <= PHASE.PLAYOFFS ? 0.5 : 0);
	return Math.round(Math.max(0, remaining) * c.contract.amount * 0.5);
};

export const fire = async (c: Coach) => {
	const tid = c.tid;
	const buyout = getBuyout(c);
	if (buyout > 0) {
		const teamSeason = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsBySeasonTid",
			[g.get("season"), tid],
		);
		if (teamSeason) {
			teamSeason.expenses.coaching += buyout;
			teamSeason.cash -= buyout;
			await idb.cache.teamSeasons.put(teamSeason);
		}
	}
	addTransaction(c, tid, c.role, "fired");
	// Fired during a season: he keeps the games he coached
	const phase = g.get("phase");
	const season = g.get("season");
	if (
		phase >= PHASE.REGULAR_SEASON &&
		phase <= PHASE.PLAYOFFS &&
		!c.stats.some((row) => row.season === season && row.tid === tid)
	) {
		const row = await coachedRecord(c, season, tid);
		if (row && row.won + row.lost + row.tied + row.otl > 0) {
			c.stats.push({ ...row, playoffRoundsWon: -1 });
		}
	}
	c.hiredRecord = undefined;
	c.tid = COACH_FREE_AGENT;
	await idb.cache.coaches.put(c);
	if (c.role === "head") {
		await logHeadCoachEvent(
			`${teamLink(tid)} fired head coach ${coachLink(c)}.`,
			tid,
		);
	}
	clearDepthCache();
	return buyout;
};

// How much an AI team is willing to pay, relative to the average salary for the role. Bigger markets pay more, like budget levels.
const spendFactor = (popRank: number) => {
	const numTeams = Math.max(2, g.get("numActiveTeams"));
	return 0.75 + 0.75 * (1 - (popRank - 1) / (numTeams - 1));
};

// Fill every vacancy, best available coach the team is willing to pay
export const fillVacancies = async ({
	includeUser,
	skipTids,
	roles,
	userAuto,
}: {
	includeUser: boolean;
	// College carousel: schools holding their head coaching job for an offer to the user
	skipTids?: Set<number>;
	// Only these jobs (default: every job of the league)
	roles?: CoachRole[];
	// Coaching Staff Depth: the user's hiring is delegated (Auto), so his vacancies are filled too
	userAuto?: boolean;
}) => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const salaryCap = g.get("salaryCap");
	const numTeams = teams.length;
	const hired: { c: Coach; tid: number }[] = [];

	const allCoaches = await idb.cache.coaches.getAll();
	const freeAgents = allCoaches.filter((c) => c.tid === COACH_FREE_AGENT);
	// Coaching systems: AI teams hire head coaches by fit (rebuilding teams development coaches, contenders tacticians)
	const systems = coachSystemsEnabled();
	const filled = new Set<string>();
	for (const c of allCoaches) {
		if (c.tid >= 0) {
			filled.add(`${c.tid}-${c.role}`);
		}
	}

	const ordered = teams
		.map((t) => ({
			t,
			key: t.pop * gauss(1, 0.25),
		}))
		.sort((a, b) => b.key - a.key);
	const popRanks = new Map<number, number>();
	for (const [i, row] of [...ordered]
		.sort((a, b) => b.t.pop - a.t.pop)
		.entries()) {
		popRanks.set(row.t.tid, i + 1);
	}

	// AI GM personalities (setting): analytics/patient GMs lean to player development, old-school/win-now ones to motivation. Empty when off
	const gms = await getAllGmWeights();

	const depth = coachingCareersOn();
	for (const role of roles ?? activeCoachRoles()) {
		for (const { t } of ordered) {
			if (filled.has(`${t.tid}-${role}`)) {
				continue;
			}
			if (!includeUser && userControlsTeam(t.tid) && !userAuto) {
				continue;
			}
			if (role === "head" && skipTids?.has(t.tid)) {
				continue;
			}

			let available = freeAgents.filter((c) => c.tid === COACH_FREE_AGENT);
			// Coaching Staff Depth: head coaches come from former head coaches and experienced assistants, free or employed elsewhere
			// (promotions and poaching); new coaches start as assistants
			if (depth && role === "head") {
				const pool = (await idb.cache.coaches.getAll()).filter(
					(c) =>
						(c.tid === COACH_FREE_AGENT || (c.tid >= 0 && c.role !== "head")) &&
						isHeadEligible(c),
				);
				if (pool.length > 0) {
					available = pool;
				}
			}
			if (available.length === 0) {
				const c = await generateCoach({ role });
				const cid = await idb.cache.coaches.add(c);
				const coach = (await idb.cache.coaches.get(cid))!;
				freeAgents.push(coach);
				available = [coach];
			}

			const maxSpend =
				coachSalaryDemand(
					{ dev: 60, off: 60, def: 60, mot: 60 },
					role,
					salaryCap,
				) *
				spendFactor(popRanks.get(t.tid) ?? numTeams / 2) *
				1.15;

			let best: Coach | undefined;
			let bestScore = -Infinity;
			let cheapest: Coach | undefined;
			let hiringContext: HiringContext | undefined;
			if (systems && role === "head" && !userControlsTeam(t.tid)) {
				hiringContext = await getTeamHiringContext(t.tid);
			}
			for (const c of available) {
				const demand = coachSalaryDemand(c.ratings, role, salaryCap);
				if (
					!cheapest ||
					demand < coachSalaryDemand(cheapest.ratings, role, salaryCap)
				) {
					cheapest = c;
				}
				if (demand > maxSpend) {
					continue;
				}
				// Former employees who were just fired by this team are not rehired
				if (firedRecentlyBy(c, t.tid)) {
					continue;
				}
				const gm = gms.get(t.tid);
				let score = coachOvr(c.ratings, role) + gauss(0, 2);
				if (depth && role === "head") {
					score += await headCandidateBonus(c, t.tid);
				}
				if (gm) {
					score += gm.coachDevWeight * (c.ratings.dev - c.ratings.mot);
				}
				// Coaching systems: head coaches by fit, through the GM's leanings when there is one
				if (hiringContext) {
					score += headCoachFitBonus(c, hiringContext, gm);
				}
				if (score > bestScore) {
					bestScore = score;
					best = c;
				}
			}
			const choice = best ?? cheapest!;
			const prevTid = choice.tid;
			const prevRole = choice.role;
			await hire(choice, t.tid, role);
			filled.add(`${t.tid}-${role}`);
			hired.push({ c: choice, tid: t.tid });
			if (prevTid >= 0) {
				// Promoted or hired away: his old job is open now
				filled.delete(`${prevTid}-${prevRole}`);
			}
			const idx = freeAgents.indexOf(choice);
			if (idx >= 0) {
				freeAgents.splice(idx, 1);
			}
		}
	}

	return hired;
};

// Keep a pool of free agent coaches for every role
const replenishPool = async () => {
	const coaches = await idb.cache.coaches.getAll();
	const numTeams = g.get("numActiveTeams");
	const depth = coachingCareersOn();
	if (depth) {
		// Coaching Staff Depth: a few former players of the league start out as assistants
		for (const c of await exPlayerCoaches()) {
			await idb.cache.coaches.add(c);
			coaches.push(c as Coach);
		}
	}
	for (const role of activeCoachRoles()) {
		if (depth && role === "head") {
			// Coaching Staff Depth: new coaches enter as assistants, head coaches are promoted from them
			continue;
		}
		const vacancies =
			numTeams - coaches.filter((c) => c.tid >= 0 && c.role === role).length;
		const pool = coaches.filter(
			(c) => c.tid === COACH_FREE_AGENT && c.role === role,
		).length;
		const target = Math.max(0, vacancies) + Math.ceil(numTeams / 3) + 3;
		for (let i = pool; i < target; i++) {
			await idb.cache.coaches.add(
				await generateCoach({ role, young: Math.random() < 0.6 }),
			);
		}
	}
};

// Generate staffs for every team, for a new league or when the setting is turned on. Does nothing if staff already exist.
export const ensureStaff = async () => {
	if (!staffEnabled()) {
		return false;
	}
	const coaches = await idb.cache.coaches.getAll();
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const needsStaff =
		coaches.length === 0 ||
		teams.some((t) => !coaches.some((c) => c.tid === t.tid));
	if (!needsStaff) {
		// Coaching Staff Depth turned on in a league with staffs: the extra jobs are filled (every team, the user's too)
		if (
			coachingDepthOn() &&
			teams.some((t) =>
				(["shoot", "sc", "video"] as const).some(
					(role) => !coaches.some((c) => c.tid === t.tid && c.role === role),
				),
			)
		) {
			for (const c of coaches) {
				if (ensureDepthRatings(c)) {
					await idb.cache.coaches.put(c);
				}
			}
			await replenishPool();
			await fillVacancies({
				includeUser: true,
				roles: ["shoot", "sc", "video"],
			});
			for (const c of await idb.cache.coaches.getAll()) {
				if (c.tid >= 0 && isDepthRole(c.role) && c.transactions.length === 1) {
					// Not a carousel move: the jobs were just created
					c.transactions = [];
					await idb.cache.coaches.put(c);
				}
			}
			return true;
		}
		return false;
	}

	const firstTime = coaches.length === 0;

	if (!firstTime) {
		// A team with no staff in an existing league (expansion team, or the user's team after everyone left). Top up the pool like the offseason market does, rather than generating a whole new league's worth of candidates and then trimming the pool, which would delete coaches with history (records, awards)
		await replenishPool();
		await fillVacancies({ includeUser: true });
		await ensureProfiles();
		await syncAllBudgets(false);
		return true;
	}

	// Candidate pool, about 2x the number of jobs, so the market sorts better coaches onto richer teams
	for (const role of activeCoachRoles()) {
		const num = Math.round(teams.length * 1.8) + 4;
		for (let i = 0; i < num; i++) {
			const c = await generateCoach({ role });
			// Existing coaches have some history with their team
			c.contract.exp = contractStartSeason() + randInt(0, 3);
			if (c.tree) {
				// Coaching Staff Depth: the league's first coaches (head coaches are made as head coaches only here)
				c.tree.initial = true;
			}
			await idb.cache.coaches.add(c);
		}
	}

	await fillVacancies({ includeUser: true });

	// Initial hires shouldn't show up as a coaching carousel (and their systems are already installed)
	for (const c of await idb.cache.coaches.getAll()) {
		c.transactions = [];
		if (c.profile) {
			delete c.profile.since;
		}
		await idb.cache.coaches.put(c);
	}
	await ensureProfiles();

	// Trim the leftover pool, keeping the best for each role
	const leftovers = (await idb.cache.coaches.getAll()).filter(
		(c) => c.tid === COACH_FREE_AGENT,
	);
	for (const role of activeCoachRoles()) {
		const sorted = leftovers
			.filter((c) => c.role === role)
			.sort((a, b) => coachOvr(b.ratings, role) - coachOvr(a.ratings, role));
		for (const c of sorted.slice(Math.ceil(teams.length / 3) + 3)) {
			await idb.cache.coaches.delete(c.cid);
		}
	}

	await syncAllBudgets(true);
	return true;
};

const getRecord = async (season: number, tid: number) => {
	const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
		season,
		tid,
	]);
	return ts;
};

const winPct = (r: {
	won: number;
	lost: number;
	tied?: number;
	otl?: number;
}) => {
	const gp = r.won + r.lost + (r.tied ?? 0) + (r.otl ?? 0);
	return gp > 0 ? (r.won + 0.5 * (r.tied ?? 0)) / gp : 0;
};

// The team's record for the games this coach was in charge of (all of them unless he was hired during the season)
const coachedRecord = async (c: Coach, season: number, tid: number) => {
	const ts = await getRecord(season, tid);
	if (!ts) {
		return undefined;
	}
	const base =
		c.hiredRecord &&
		c.hiredRecord.season === season &&
		c.hiredRecord.tid === tid
			? c.hiredRecord
			: { won: 0, lost: 0, tied: 0, otl: 0 };
	return {
		season,
		tid,
		role: c.role,
		won: Math.max(0, ts.won - base.won),
		lost: Math.max(0, ts.lost - base.lost),
		tied: Math.max(0, (ts.tied ?? 0) - base.tied),
		otl: Math.max(0, (ts.otl ?? 0) - base.otl),
		playoffRoundsWon: ts.playoffRoundsWon,
	};
};

// Record the season for every employed coach. Coaches hired during the season get the games since they were hired.
const recordSeason = async () => {
	const season = g.get("season");
	const coaches = (await idb.cache.coaches.getAll()).filter((c) => c.tid >= 0);
	for (const c of coaches) {
		if (c.stats.some((row) => row.season === season && row.tid === c.tid)) {
			continue;
		}
		const row = await coachedRecord(c, season, c.tid);
		if (!row) {
			continue;
		}
		c.stats.push(row);
		c.hiredRecord = undefined;
		await idb.cache.coaches.put(c);
	}
};

export const COACH_OF_THE_YEAR = "Coach of the Year";

// Best record, with a bonus for improvement over last season and for playoff success
export const coachOfTheYear = async () => {
	const season = g.get("season");
	const heads = (await idb.cache.coaches.getAll()).filter(
		(c) => c.tid >= 0 && c.role === "head",
	);
	const collegeExpected = isCollege() ? await getExpectedWinps() : undefined;
	let best: Coach | undefined;
	let bestScore = -Infinity;
	for (const c of heads) {
		const row = c.stats.find((r) => r.season === season && r.tid === c.tid);
		if (!row || row.won + row.lost === 0) {
			continue;
		}
		const prev = (
			await idb.merged.teamSeasons.getAll({
				tid: c.tid,
				seasons: [season - 1, season - 1],
			})
		)[0];
		const prevPct = prev && prev.won + prev.lost > 0 ? winPct(prev) : 0.5;
		const pct = winPct(row);
		// College mode: against what the program's prestige expects, and the national tournament counts more
		const score = collegeExpected
			? pct -
				(collegeExpected.get(c.tid) ?? 0.5) +
				0.3 * (pct - prevPct) +
				0.05 * Math.max(0, row.playoffRoundsWon + 1) +
				gauss(0, 0.01)
			: pct +
				0.6 * (pct - prevPct) +
				0.02 * row.playoffRoundsWon +
				gauss(0, 0.01);
		if (score > bestScore) {
			bestScore = score;
			best = c;
		}
	}
	if (
		best &&
		!best.awards.some(
			(a) => a.season === season && a.type === COACH_OF_THE_YEAR,
		)
	) {
		best.awards.push({ season, type: COACH_OF_THE_YEAR });
		await idb.cache.coaches.put(best);
		await logEvent({
			type: "award",
			text: `${coachLink(best)} of ${teamLink(best.tid)} won the ${COACH_OF_THE_YEAR} award.`,
			showNotification: false,
			tids: [best.tid],
			score: 10,
		});
	}
	return best;
};

const age = (c: CoachWithoutKey) => g.get("season") - c.born.year;

// Yearly random change of each rating around the age trend. 1.5 before: a development coach's rating moved enough from one season to
// the next to swing his team's development effect on its own (docs/rating-inflation.md)
const COACH_PROGRESS_SD = 1;

const progress = (c: Coach) => {
	const a = age(c);
	const mu = a < 45 ? 1.2 : a < 58 ? 0.2 : -1.2;
	for (const key of ["dev", "off", "def", "mot"] as const) {
		c.ratings[key] = bound(c.ratings[key] + gauss(mu, COACH_PROGRESS_SD));
	}
	// Coaching Staff Depth: the extra jobs' ratings follow the same age trend (no random draws, so the other ratings draw as before)
	for (const key of ["sht", "cnd", "vid"] as const) {
		const v = c.ratings[key];
		if (v !== undefined) {
			c.ratings[key] = bound(v + mu);
		}
	}
};

const tenure = (c: Coach) => {
	let n = 0;
	for (let i = c.stats.length - 1; i >= 0; i--) {
		if (c.stats[i]!.tid !== c.tid) {
			break;
		}
		n += 1;
	}
	return n;
};

const retire = async (c: Coach) => {
	const tid = c.tid;
	if (tid >= 0) {
		addTransaction(c, tid, c.role, "retired");
		if (c.role === "head") {
			await logHeadCoachEvent(
				`Head coach ${coachLink(c)} of ${teamLink(tid)} retired.`,
				tid,
			);
		}
	}
	c.tid = COACH_RETIRED;
	c.retiredYear = g.get("season");
	await idb.cache.coaches.put(c);
};

// The offseason coaching market, run right after the playoffs
export const runOffseason = async () => {
	if (!staffEnabled()) {
		return;
	}
	await ensureStaff();

	const season = g.get("season");
	await commitDevCarry();
	await recordSeason();
	await coachOfTheYear();
	// Coaching systems: expectation, development and systems on the season rows; league system trends
	await ensureProfiles();
	await annotateSeason();
	const systems = coachSystemsEnabled();

	const coaches = (await idb.cache.coaches.getAll()).filter(
		(c) => c.tid !== COACH_RETIRED,
	);
	// AI GM personalities (setting): patient GMs give coaches more time, win-now ones less. Empty when off
	const gms = await getAllGmWeights();
	const collegeExpected = isCollege() ? await getExpectedWinps() : undefined;
	for (const c of coaches) {
		progress(c);

		// Retirement
		const a = age(c) + 1;
		const lastJob = c.transactions.findLast(
			(tx) => tx.type === "hired",
		)?.season;
		const unemployedLong =
			c.tid === COACH_FREE_AGENT &&
			(lastJob === undefined || lastJob < season - 2) &&
			c.stats.length > 0;
		const retireProb =
			(a >= 62 ? (a - 61) * 0.07 : 0) +
			(unemployedLong ? 0.35 : 0) +
			(a > 75 ? 1 : 0);
		if (Math.random() < retireProb) {
			await retire(c);
			continue;
		}

		if (c.tid < 0) {
			await idb.cache.coaches.put(c);
			continue;
		}

		const ts = await getRecord(season, c.tid);
		const pct = ts ? winPct(ts) : 0.5;
		const ovr = coachOvr(c.ratings, c.role);

		if (c.contract.exp <= season) {
			// Expiring contract
			let reSign;
			if (userControlsTeam(c.tid) && isCollege() && c.role === "head") {
				// College mode: the user's head coach is the user, who stays
				reSign = true;
			} else if (userControlsTeam(c.tid)) {
				// User extends on the staff page before this, otherwise they leave
				reSign = false;
			} else if (c.role === "head") {
				reSign =
					pct >= 0.45 || ovr >= 62 ? Math.random() < 0.8 : Math.random() < 0.25;
			} else {
				reSign = ovr >= 50 ? Math.random() < 0.75 : Math.random() < 0.3;
			}
			if (reSign) {
				c.contract = {
					amount: coachSalaryDemand(c.ratings, c.role, g.get("salaryCap")),
					exp: season + randInt(2, 4),
				};
				addTransaction(c, c.tid, c.role, "reSigned");
				await idb.cache.coaches.put(c);
			} else {
				const tid = c.tid;
				addTransaction(c, tid, c.role, "left");
				c.tid = COACH_FREE_AGENT;
				await idb.cache.coaches.put(c);
				if (c.role === "head") {
					await logHeadCoachEvent(
						`Head coach ${coachLink(c)} left ${teamLink(tid)} when his contract expired.`,
						tid,
					);
				}
			}
			continue;
		}

		// AI firings. The owner doesn't wait forever.
		if (!userControlsTeam(c.tid)) {
			let fireProb = 0;
			if (c.role === "head" && collegeExpected) {
				// College mode: results against what the program's prestige expects
				fireProb = collegeFireProb(c, tenure(c), collegeExpected);
			} else if (c.role === "head" && systems) {
				// Coaching systems: the hot seat (results against expectations, reputation)
				fireProb = hotSeatFireProb(c, tenure(c));
			} else if (c.role === "head") {
				const t = tenure(c);
				if (t >= 2 && pct < 0.4) {
					fireProb = 0.55;
				} else if (t >= 1 && pct < 0.3) {
					fireProb = 0.4;
				} else if (
					t >= 3 &&
					c.stats.slice(-3).every((r) => r.playoffRoundsWon < 0) &&
					pct < 0.5
				) {
					fireProb = 0.3;
				}
			} else if (ovr < 40) {
				fireProb = 0.3;
			}
			const gm = gms.get(c.tid);
			if (gm) {
				fireProb *= gm.coachFireFactor;
			}
			if (Math.random() < fireProb) {
				await fire(c);
				continue;
			}
		}

		await idb.cache.coaches.put(c);
	}

	// Coaching systems: adaptable coaches move toward what their roster fits
	await adaptSystems();

	await replenishPool();
	// College mode: schools hire head coaches away from smaller programs, and make offers to the user
	const held = isCollege() ? await runCollegeCarousel() : undefined;
	// Coaching Staff Depth: the user's vacancies are filled now when hiring is delegated (Auto)
	await fillVacancies({
		includeUser: false,
		skipTids: held,
		userAuto: coachingDepthOn() && (await userHiringDelegation()) === "auto",
	});
	if (coachingDepthOn()) {
		await afterCoachingMarket();
	}
	await syncAllBudgets();
	clearCoachSystemsCache();
	clearDepthCache();
};

// Before the regular season, anyone who still has a vacancy (including the user) gets one filled automatically
export const onPreseason = async () => {
	if (!staffEnabled()) {
		return;
	}
	await ensureStaff();
	await ensureProfiles();
	const hired = await fillVacancies({ includeUser: true });
	for (const { c, tid } of hired) {
		if (g.get("userTids").includes(tid)) {
			await logEvent({
				type: "info",
				text: `Your vacant ${COACH_ROLE_NAMES[c.role]} job was filled by ${coachLink(c)}.`,
				saveToDb: false,
				showNotification: true,
			});
		}
	}
	await syncAllBudgets();
};

// User actions

const getUserCoach = async (cid: number) => {
	const c = await idb.cache.coaches.get(cid);
	if (!c) {
		throw new Error("Invalid coach");
	}
	return c;
};

export const userHire = async ({
	cid,
	role,
	years,
	tid,
}: {
	cid: number;
	role: CoachRole;
	years: number;
	tid: number;
}) => {
	if (!staffEnabled()) {
		throw new Error("Coaching staff is disabled");
	}
	const c = await getUserCoach(cid);
	if (c.tid !== COACH_FREE_AGENT) {
		throw new Error("That coach is not available");
	}
	if (firedRecentlyBy(c, tid)) {
		throw new Error(
			"You fired him this season or last, so he won't come back yet.",
		);
	}
	const staff = await getTeamStaff(tid);
	if (staff[role]) {
		throw new Error(
			`You already have a ${COACH_ROLE_NAMES[role]}. Fire him first.`,
		);
	}
	await hire(c, tid, role, helpers.bound(Math.round(years), 1, 5));
	// The league's average staff changed too, so every team's level is relative to the new average
	await syncAllBudgets();
};

export const userFire = async ({ cid, tid }: { cid: number; tid: number }) => {
	const c = await getUserCoach(cid);
	if (c.tid !== tid) {
		throw new Error("That coach is not on your staff");
	}
	const buyout = await fire(c);
	clearCoachSystemsCache();
	// The league's average staff changed too, so every team's level is relative to the new average
	await syncAllBudgets();
	return buyout;
};

export const userExtend = async ({
	cid,
	tid,
	years,
}: {
	cid: number;
	tid: number;
	years: number;
}) => {
	const c = await getUserCoach(cid);
	if (c.tid !== tid) {
		throw new Error("That coach is not on your staff");
	}
	// The new salary starts now (a coach contract has one amount), so he never takes a pay cut: extending an overpaid coach used to
	// cut his salary to his lower asking price at once
	c.contract = {
		amount: Math.max(
			c.contract.amount,
			coachSalaryDemand(c.ratings, c.role, g.get("salaryCap")),
		),
		exp:
			Math.max(c.contract.exp, contractStartSeason() - 1) +
			helpers.bound(Math.round(years), 1, 5),
	};
	addTransaction(c, tid, c.role, "reSigned");
	await idb.cache.coaches.put(c);
};

export {
	getCoachAwards,
	getCoachingCarousel,
	getHeadCoachForSeason,
	getTeamCoachStyle,
} from "./data.ts";

export {
	applyCoachSystems,
	coachMood,
	coachReputation,
	coachSystemsEnabled,
	coachingTree,
	getCoachProfile,
	getHeadProfiles,
	getTeamCoachSystem,
	getTeamHiringContext,
	headCoachFitBonus,
	hotSeat,
	philosophyLevelDelta,
	playerSystemFit,
	playerSystemFitForTeam,
	rankHeadCoachCandidates,
	setExpectations,
} from "./systems.ts";
