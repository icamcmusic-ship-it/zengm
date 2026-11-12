// College mode: the head coaching carousel between schools (docs/college-mode.md, Coaching careers). Runs inside the offseason coaching
// market (runOffseason) after the firings: schools with an open head coaching job, best programs first, hire the coach whose stock is
// highest, and that can be a sitting head coach at a smaller program, who leaves it (and his old school then has an opening of its own).
// The user's school's head coach is the user: bigger programs make him offers instead, which he accepts or declines on the Coaching
// Carousel page until the Departures phase.
import { PHASE } from "../../../common/constants.ts";
import { gauss } from "../../../common/random.ts";
import { COACH_FREE_AGENT, coachOvr } from "../../../common/staff.ts";
import type {
	CollegeCoachOffer,
	CollegeState,
} from "../../../common/college/types.ts";
import type { Coach } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent, toUI } from "../../util/index.ts";
import { getExpectedWinps } from "../college/expectations.ts";
import { getTeamPrestige } from "../college/players.ts";
import { getCollegeState, saveCollegeState } from "../college/state.ts";
import switchTo from "../team/switchTo.ts";
import { coachReputation } from "./systems.ts";
import {
	addTransaction,
	coachLink,
	fillVacancies,
	hire,
	syncAllBudgets,
	teamLink,
} from "./index.ts";

// How far below a school's prestige a sitting head coach's program must be for him to move there
const MIN_STEP_UP = 6;
// At most this share of the league's head coaches change schools in one offseason (on top of firings and retirements)
const MAX_POACH_SHARE = 0.08;

const winPct = (r: {
	won: number;
	lost: number;
	tied: number;
	otl: number;
}) => {
	const gp = r.won + r.lost + r.tied + r.otl;
	return gp > 0 ? (r.won + 0.5 * r.tied) / gp : 0.5;
};

// Seasons in a row as head coach of his current school
const headTenure = (c: Coach) => {
	let n = 0;
	for (let i = c.stats.length - 1; i >= 0; i--) {
		const row = c.stats[i]!;
		if (row.tid !== c.tid || row.role !== "head") {
			break;
		}
		n += 1;
	}
	return n;
};

/**
 * A head coach's stock on the job market, about 0-100: his reputation plus how his last two seasons at his school went against what its
 * prestige expects, and tournament wins. A free agent is judged on his reputation and ratings.
 */
export const coachStock = (c: Coach, expected: Map<number, number>) => {
	let stock = coachReputation(c);
	const rows = c.stats.filter((r) => r.role === "head").slice(-2);
	const weights = rows.length === 2 ? [0.4, 0.6] : [1];
	for (const [i, row] of rows.entries()) {
		const exp = expected.get(row.tid) ?? 0.5;
		stock +=
			weights[i]! *
			(70 * (winPct(row) - exp) + 3 * Math.max(0, row.playoffRoundsWon + 1));
	}
	if (rows.length === 0) {
		stock += (coachOvr(c.ratings, "head") - 55) / 3;
	}
	return stock;
};

/**
 * AI firings in college: the last three seasons at his school against what its prestige expects (latest counting most). A new coach gets
 * two seasons, and a coach with a big reputation some patience.
 */
export const collegeFireProb = (
	c: Coach,
	tenure: number,
	expected: Map<number, number>,
) => {
	if (tenure < 2) {
		return 0;
	}
	const rows = c.stats
		.filter((r) => r.tid === c.tid && r.role === "head")
		.slice(-3);
	if (rows.length === 0) {
		return 0;
	}
	const weights = [0.2, 0.3, 0.5].slice(-rows.length);
	let score = 0;
	let wSum = 0;
	for (const [i, row] of rows.entries()) {
		score +=
			weights[i]! *
			(winPct(row) -
				(expected.get(row.tid) ?? 0.5) +
				0.02 * Math.max(0, row.playoffRoundsWon + 1));
		wSum += weights[i]!;
	}
	score /= wSum;
	const patience = coachReputation(c) >= 70 ? 0.5 : 1;
	return helpers.bound(4 * (-score - 0.06), 0, 0.8) * patience;
};

// Stock a coach needs for an offer from a school of this prestige
const offerThreshold = (prestige: number) => 30 + 0.4 * prestige;

const userControls = (tid: number) =>
	g.get("userTids").includes(tid) &&
	!local.autoPlayUntil &&
	!g.get("spectator");

/**
 * The carousel (inside runOffseason, after the firings and before the free agent market). Returns the schools that hold their opening for
 * an offer to the user.
 */
export const runCollegeCarousel = async () => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const prestige = new Map(teams.map((t) => [t.tid, getTeamPrestige(t)]));
	const expected = await getExpectedWinps();
	const coaches = await idb.cache.coaches.getAll();
	const heads = new Map<number, Coach>();
	for (const c of coaches) {
		if (c.tid >= 0 && c.role === "head") {
			heads.set(c.tid, c);
		}
	}
	const freeAgents = coaches.filter(
		(c) => c.tid === COACH_FREE_AGENT && c.role === "head",
	);
	const stock = new Map<number, number>();
	for (const c of [...heads.values(), ...freeAgents]) {
		stock.set(c.cid, coachStock(c, expected) + gauss(0, 3));
	}

	const userTid = g.get("userTid");
	const userCoach = userControls(userTid) ? heads.get(userTid) : undefined;
	const state = getCollegeState();
	const offers: CollegeCoachOffer[] = [];
	const held = new Set<number>();

	// Open head coaching jobs, best program first. Openings made by the carousel join the queue
	const open = teams
		.filter((t) => !heads.has(t.tid))
		.map((t) => t.tid)
		.sort((a, b) => prestige.get(b)! - prestige.get(a)!);
	const moved = new Set<number>();
	let poaches = 0;
	const maxPoaches = Math.max(2, Math.round(MAX_POACH_SHARE * teams.length));

	while (open.length > 0) {
		const tid = open.shift()!;
		const p = prestige.get(tid)!;

		// The user's coach: an offer if he is good enough for this job and it is a step up
		if (
			userCoach &&
			state &&
			userCoach.tid === userTid &&
			offers.length < 3 &&
			p >= prestige.get(userTid)! + 3 &&
			stock.get(userCoach.cid)! >= offerThreshold(p) &&
			Math.random() < 0.75
		) {
			const ts = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsBySeasonTid",
				[g.get("season"), tid],
			);
			offers.push({
				tid,
				prestige: Math.round(p * 10) / 10,
				years: 5,
				won: ts?.won ?? 0,
				lost: ts?.lost ?? 0,
			});
			held.add(tid);
			continue;
		}

		// Sitting head coaches at smaller programs who would come, best stock first
		if (poaches < maxPoaches) {
			const candidates = [...heads.values()]
				.filter(
					(c) =>
						c.tid >= 0 &&
						c.tid !== userTid &&
						!moved.has(c.cid) &&
						!held.has(c.tid) &&
						headTenure(c) >= 2 &&
						g.get("season") - c.born.year < 66 &&
						prestige.get(c.tid)! <= p - MIN_STEP_UP &&
						stock.get(c.cid)! >= offerThreshold(p),
				)
				.sort((a, b) => stock.get(b.cid)! - stock.get(a.cid)!);
			const bestFreeAgent = Math.max(
				-Infinity,
				...freeAgents
					.filter((c) => c.tid === COACH_FREE_AGENT)
					.map((c) => stock.get(c.cid)!),
			);
			let hired: Coach | undefined;
			for (const c of candidates.slice(0, 3)) {
				if (stock.get(c.cid)! < bestFreeAgent + 2) {
					break;
				}
				// A bigger step up is harder to turn down
				const gap = p - prestige.get(c.tid)!;
				if (Math.random() < helpers.bound(gap / 25, 0.2, 0.85)) {
					hired = c;
					break;
				}
			}
			if (hired) {
				const oldTid = hired.tid;
				addTransaction(hired, oldTid, "head", "left");
				hired.tid = COACH_FREE_AGENT;
				heads.delete(oldTid);
				await hire(hired, tid, "head", 5, {
					text: `${teamLink(tid)} hired ${coachLink(hired)} away from ${teamLink(oldTid)} as head coach.`,
					tids: [tid, oldTid],
				});
				heads.set(tid, hired);
				moved.add(hired.cid);
				poaches += 1;
				// His old school has an opening now, in prestige order
				const i = open.findIndex(
					(t) => prestige.get(t)! < prestige.get(oldTid)!,
				);
				open.splice(i < 0 ? open.length : i, 0, oldTid);
			}
		}
	}

	if (state) {
		const newState: CollegeState = { ...state, coachOffers: offers };
		await saveCollegeState(newState);
	}
	if (offers.length > 0) {
		await logEvent({
			type: "info",
			text: `You have ${offers.length === 1 ? "a job offer" : `${offers.length} job offers`} from ${offers.map((o) => teamLink(o.tid).replace(/^the /, "")).join(", ")}. <a href="${helpers.leagueUrl(["college_carousel"])}">Accept or decline</a> before the Departures phase.`,
			showNotification: true,
			tids: offers.map((o) => o.tid),
			score: 20,
			saveToDb: true,
		});
	}
	return held;
};

const getOffers = () => getCollegeState()?.coachOffers ?? [];

const clearOffers = async () => {
	const state = getCollegeState();
	if (state?.coachOffers) {
		await saveCollegeState({ ...state, coachOffers: [] });
	}
};

/**
 * Offers the user did not take expire when the Departures phase starts: those schools hire someone else.
 */
export const expireCoachOffers = async () => {
	if (getOffers().length === 0) {
		return;
	}
	await clearOffers();
	await fillVacancies({ includeUser: false });
	await syncAllBudgets();
};

export const canRespondToOffers = () =>
	g.get("phase") === PHASE.DRAFT_LOTTERY && !g.get("gameOver");

/**
 * Move the user's coach (the head coach of his old school) to his new school. "fired": after the owner fired him. The new school's head
 * coach, if any, loses his job.
 */
export const moveUserCoach = async (
	fromTid: number,
	toTid: number,
	how: "fired" | "left",
) => {
	if (fromTid === toTid) {
		return;
	}
	const coaches = await idb.cache.coaches.getAll();
	const c = coaches.find((c2) => c2.tid === fromTid && c2.role === "head");
	if (!c) {
		return;
	}
	const current = coaches.find(
		(c2) => c2.tid === toTid && c2.role === "head" && c2.cid !== c.cid,
	);
	if (current) {
		addTransaction(current, toTid, "head", "fired");
		current.tid = COACH_FREE_AGENT;
		await idb.cache.coaches.put(current);
	}
	addTransaction(c, fromTid, "head", how);
	c.tid = COACH_FREE_AGENT;
	await hire(c, toTid, "head", 5, {
		text:
			how === "fired"
				? `${teamLink(fromTid)} fired head coach ${coachLink(c)}, and ${teamLink(toTid)} hired him.`
				: `${coachLink(c)} left ${teamLink(fromTid)} to become head coach of ${teamLink(toTid)}.`,
		tids: [toTid, fromTid],
	});
};

/**
 * The user accepts (switches to that school, and his old school hires someone) or declines an offer.
 */
export const respondToOffer = async (tid: number, accept: boolean) => {
	const offers = getOffers();
	const offer = offers.find((o) => o.tid === tid);
	if (!offer || !canRespondToOffers()) {
		return { error: "That offer is no longer available." };
	}
	const state = getCollegeState()!;
	if (!accept) {
		await saveCollegeState({
			...state,
			coachOffers: offers.filter((o) => o.tid !== tid),
		});
		await fillVacancies({ includeUser: false });
		await syncAllBudgets();
		return {};
	}

	const fromTid = g.get("userTid");
	await moveUserCoach(fromTid, tid, "left");
	// Other offers are off the table, and those schools (and his old one) hire
	await saveCollegeState({ ...state, coachOffers: [] });
	await switchTo(tid);
	await fillVacancies({ includeUser: false });
	await syncAllBudgets();
	await toUI("realtimeUpdate", [["staff", "playerMovement"]]);
	return {};
};
