// College mode: recruiting v2 and the user-run transfer portal (docs/college-mode.md). Every school (the user's too, with Auto recruit on)
// spends weekly recruiting points on actions (contact, visits, offers) with pitches; each recruit's interest in each school builds week by
// week (common/college/interest.ts), and he commits once a school that offered him is far enough ahead. Players in the transfer portal
// are recruited the same way during the portal window.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	COLLEGE_ELIGIBILITY_YEARS,
	COLLEGE_SCHOLARSHIPS,
	classYearAbbrev,
} from "../../../common/college/constants.ts";
import {
	ACTIONS,
	MAX_INTEREST,
	NIL_FULL,
	PITCHES,
	actionGain,
	bestPitch,
	fit,
	genPrefs,
	nilBudget,
	pickCommit,
	playingTimeGrade,
	proximityGrade,
	shouldDecommit,
	weeklyBudget,
	weeklyUpdate,
	type Grades,
	type Pitch,
	type RecruitAction,
	type SchoolInterest,
} from "../../../common/college/interest.ts";
import {
	homeState,
	sameDivision,
	schoolState,
} from "../../../common/college/geography.ts";
import type {
	CollegeDeparture,
	CollegeRecruitingState,
	RecruitingBox,
} from "../../../common/college/types.ts";
import type { Conditions } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { league, player } from "../index.ts";
import { getCollegeArchive, updateCollegeArchive } from "./archive.ts";
import {
	IDEAL_BY_GROUP,
	getActiveTeams,
	getClassYear,
	getRecruits,
	leaveSchool,
	playerLink,
	posGroup,
	seasonMinutes,
	teamLink,
	type CollegePlayer,
} from "./offseason.ts";
import { getTeamPrestige } from "./players.ts";

// Weeks of the transfer portal window (the Transfer portal phase) and of late recruiting (the Recruiting phase)
export const PORTAL_WEEKS = 3;
export const LATE_RECRUITING_WEEKS = 2;
export const OFFICIAL_VISITS_PER_SEASON = 5;
// Offers out at once, per open scholarship
export const OFFERS_PER_SPOT = 2;
// Most schools a prospect follows at once
const MAX_SCHOOLS = 12;
const NIL_STEP = 5;

type Kind = "recruit" | "portal";
type Prospect = { p: CollegePlayer; box: RecruitingBox; kind: Kind };

type SchoolInfo = {
	tid: number;
	prestige: number;
	state: string | undefined;
	coach: number;
	winp: number;
	// Ovr of the players who will be on the roster next season, by position group, best first
	depth: number[][];
	staying: number;
	commits: number;
	// Recruited by the AI (every school but the user's, unless Auto recruit is on)
	auto: boolean;
};

const isUserAuto = () =>
	g.get("collegeAutoRecruit") || g.get("spectator") || !!local.autoPlayUntil;

// ---- The user's recruiting state ----

const coachQuality = async (tid: number) => {
	if (!g.get("coachingStaff")) {
		return 0.5;
	}
	const head = (await idb.cache.coaches.indexGetAll("coachesByTid", tid)).find(
		(c) => c.role === "head",
	);
	if (!head) {
		return 0.4;
	}
	const r = head.ratings;
	return helpers.bound((r.dev + r.off + r.def + 2 * r.mot) / 500, 0, 1);
};

export const getRecruitingState = async (): Promise<CollegeRecruitingState> => {
	const season = g.get("season");
	const state = g.get("collegeRecruiting");
	if (state && state.season === season) {
		return state;
	}
	const userTid = g.get("userTid");
	const t = await idb.cache.teams.get(userTid);
	const prestige = t ? getTeamPrestige(t as any) : 60;
	const budget = weeklyBudget(prestige, await coachQuality(userTid));
	const nil = nilBudget(prestige);
	const fresh: CollegeRecruitingState = {
		season,
		week: 0,
		budget,
		points: budget,
		nilBudget: nil,
		nil,
		officialVisits: OFFICIAL_VISITS_PER_SEASON,
		offseasonWeeks: 0,
	};
	await saveRecruitingState(fresh);
	return fresh;
};

const saveRecruitingState = async (state: CollegeRecruitingState) => {
	await league.setGameAttributes({ collegeRecruiting: { ...state } });
};

// ---- Prospects and schools ----

const ensureBox = (box: RecruitingBox) => {
	if (!box.prefs) {
		box.prefs = genPrefs();
	}
	if (!box.schools) {
		box.schools = [];
	}
	return box as Required<Pick<RecruitingBox, "prefs" | "schools">> &
		RecruitingBox;
};

export const getPortalPlayers = async () =>
	(
		(await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.FREE_AGENT,
		)) as CollegePlayer[]
	).filter((p) => p.portal && p.portal.season === g.get("season"));

export const isPortalOpen = () => g.get("phase") === PHASE.AFTER_DRAFT;

const getProspects = async (): Promise<Prospect[]> => {
	const prospects: Prospect[] = [];
	for (const p of await getRecruits()) {
		ensureBox(p.recruit!);
		prospects.push({ p, box: p.recruit!, kind: "recruit" });
	}
	if (isPortalOpen()) {
		for (const p of await getPortalPlayers()) {
			ensureBox(p.portal!);
			prospects.push({ p, box: p.portal!, kind: "portal" });
		}
	}
	return prospects;
};

const winPct = async (tid: number) => {
	const season = g.get("season");
	for (const s of [season, season - 1]) {
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			s,
			tid,
		]);
		if (ts && ts.won + ts.lost >= 5) {
			return ts.won / (ts.won + ts.lost);
		}
	}
	return 0.5;
};

const getSchools = async (prospects: Prospect[]) => {
	const teams = await getActiveTeams();
	const players = (await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	])) as CollegePlayer[];
	const byTid = Map.groupBy(players, (p) => p.tid);
	const offseason = g.get("phase") >= PHASE.DRAFT || g.get("phase") < 0;
	const commits = new Map<number, number>();
	for (const { box, kind } of prospects) {
		if (kind === "recruit" && box.commit !== undefined) {
			commits.set(box.commit, (commits.get(box.commit) ?? 0) + 1);
		}
	}
	const userTid = g.get("userTid");
	const schools = new Map<number, SchoolInfo>();
	for (const t of teams) {
		const staying = (byTid.get(t.tid) ?? []).filter(
			(p) => offseason || getClassYear(p) < COLLEGE_ELIGIBILITY_YEARS,
		);
		const depth: number[][] = [[], [], []];
		for (const p of staying) {
			const ratings = last(p.ratings);
			depth[posGroup(ratings.pos)]!.push(ratings.ovr);
		}
		for (const list of depth) {
			list.sort((a, b) => b - a);
		}
		schools.set(t.tid, {
			tid: t.tid,
			prestige: getTeamPrestige(t as any),
			state: schoolState(t.region),
			coach: await coachQuality(t.tid),
			winp: await winPct(t.tid),
			depth,
			staying: staying.length,
			commits: commits.get(t.tid) ?? 0,
			auto: t.tid !== userTid || isUserAuto(),
		});
	}
	return schools;
};

const openSpots = (school: SchoolInfo) =>
	COLLEGE_SCHOLARSHIPS - school.staying - school.commits;

export const getGrades = (
	school: SchoolInfo,
	p: CollegePlayer,
	si: SchoolInterest | undefined,
): Grades => {
	const ratings = last(p.ratings);
	const better = school.depth[posGroup(ratings.pos)]!.filter(
		(ovr) => ovr > ratings.ovr,
	).length;
	const recruitState = homeState(p.born.loc);
	return {
		pt: playingTimeGrade(better),
		prestige: helpers.bound((school.prestige - 35) / 65, 0, 1),
		proximity: proximityGrade(
			school.state,
			recruitState ?? "",
			sameDivision(school.state, recruitState),
			recruitState === undefined,
		),
		coach: school.coach,
		winning: school.winp,
		nil: Math.min(1, (si?.nil ?? 0) / NIL_FULL),
	};
};

const getEntry = (box: RecruitingBox, tid: number, create: boolean) => {
	const schools = box.schools!;
	let si = schools.find((s) => s.tid === tid);
	if (!si && create) {
		si = { tid, i: 0 };
		schools.push(si);
		if (schools.length > MAX_SCHOOLS) {
			// Make room: he stops following the school he likes least that did not offer
			const userTid = g.get("userTid");
			const drop = schools
				.filter((s) => s !== si && !s.o && s.tid !== userTid)
				.sort((a, b) => a.i - b.i)[0];
			if (drop) {
				schools.splice(schools.indexOf(drop), 1);
			}
		}
	}
	return si;
};

const applyAction = (
	prospect: Prospect,
	school: SchoolInfo,
	action: RecruitAction,
	pitch?: Pitch,
) => {
	const si = getEntry(prospect.box, school.tid, true)!;
	const grades = getGrades(school, prospect.p, si);
	si.i = Math.min(
		MAX_INTEREST,
		si.i + actionGain(action, prospect.box.prefs!, grades, pitch),
	);
	si.a = true;
	if (action === "offer") {
		si.o = true;
	} else if (action === "officialVisit") {
		si.v = true;
	}
	return si;
};

// ---- AI recruiting ----

// What a prospect is worth to a school: recruits by rank, portal players by ovr
const quality = (prospect: Prospect) =>
	prospect.kind === "recruit"
		? 1000 - (prospect.p.recruit?.rank ?? 999)
		: last(prospect.p.ratings).ovr * 10;

const aiRecruit = (
	school: SchoolInfo,
	prospects: Prospect[],
	expected: Map<number, number>,
	budget: number,
	officialVisitsUsed: number,
) => {
	const spots = openSpots(school);
	if (spots <= 0) {
		return;
	}
	const max = Math.max(2, spots * 3);
	const counts = school.depth.map((list) => list.length);
	const targets: Prospect[] = [];
	for (const prospect of prospects) {
		if (targets.length >= max) {
			break;
		}
		const { p, box, kind } = prospect;
		if (box.commit !== undefined && box.commit !== school.tid) {
			continue;
		}
		if (kind === "portal") {
			if (p.portal!.from === school.tid && school.tid !== g.get("userTid")) {
				// AI schools try to keep good players
				if (last(p.ratings).ovr >= (school.depth.flat()[7] ?? 0)) {
					targets.push(prospect);
				}
				continue;
			}
			// He would play for this school
			const ovr = last(p.ratings).ovr;
			const sorted = school.depth.flat().sort((a, b) => b - a);
			if (ovr < (sorted[7] ?? 0)) {
				continue;
			}
			targets.push(prospect);
			continue;
		}
		const exp = expected.get(p.pid) ?? 50;
		if (exp > school.prestige + 5 || exp < school.prestige - 20) {
			continue;
		}
		const group = posGroup(last(p.ratings).pos);
		if (counts[group]! >= IDEAL_BY_GROUP[group]! + 2) {
			continue;
		}
		targets.push(prospect);
	}

	const nilEach = Math.round(
		nilBudget(school.prestige) / Math.max(2, spots * 2),
	);
	let offers = 0;
	let visits = officialVisitsUsed;
	for (const [j, prospect] of targets.entries()) {
		if (budget <= 0) {
			break;
		}
		const si = getEntry(prospect.box, school.tid, false);
		const grades = getGrades(school, prospect.p, si);
		const pitch = bestPitch(prospect.box.prefs!, grades);
		if (!si?.o && offers < spots * OFFERS_PER_SPOT) {
			const entry = applyAction(prospect, school, "offer");
			entry.nil = nilEach;
			offers += 1;
		} else if (si?.o) {
			offers += 1;
		}
		let action: RecruitAction;
		if (
			j < 2 &&
			!si?.v &&
			visits < OFFICIAL_VISITS_PER_SEASON &&
			budget >= ACTIONS.officialVisit.cost
		) {
			action = "officialVisit";
			visits += 1;
		} else if (j <= spots && budget >= ACTIONS.homeVisit.cost) {
			action = "homeVisit";
		} else {
			action = "contact";
		}
		if (
			prospect.kind === "portal" &&
			prospect.p.portal!.from === school.tid &&
			action !== "contact"
		) {
			action = "retain";
		}
		budget -= ACTIONS[action].cost;
		applyAction(prospect, school, action, pitch);
	}
};

// Prestige of the school the n-th best uncommitted recruit would expect to sign with (open spots, best programs first)
const expectedPrestige = (
	prospects: Prospect[],
	schools: Map<number, SchoolInfo>,
) => {
	const slots: number[] = [];
	for (const school of schools.values()) {
		for (let i = 0; i < openSpots(school); i++) {
			slots.push(school.prestige);
		}
	}
	slots.sort((a, b) => b - a);
	const expected = new Map<number, number>();
	let i = 0;
	for (const { p, box, kind } of prospects) {
		if (kind === "recruit" && box.commit === undefined) {
			expected.set(p.pid, slots[Math.min(i, slots.length - 1)] ?? 50);
			i += 1;
		}
	}
	return expected;
};

// ---- A week of recruiting ----

const newsCommit = async (
	prospect: Prospect,
	tid: number,
	conditions: Conditions | undefined,
	decommit: boolean,
) => {
	const { p, kind } = prospect;
	const userTid = g.get("userTid");
	const ratings = last(p.ratings);
	const stars = p.recruit?.stars ?? 0;
	const involvesUser =
		tid === userTid ||
		prospect.box.schools?.some((s) => s.tid === userTid && s.o);
	if (kind === "recruit" && stars < 4 && !involvesUser) {
		return;
	}
	const who =
		kind === "recruit"
			? `${"★".repeat(stars)} ${ratings.pos} ${playerLink(p)} (No. ${p.recruit!.rank}, ${p.recruit!.state})`
			: `${ratings.pos} ${playerLink(p)} (transfer from ${teamLink(p.portal!.from)})`;
	await logEvent(
		{
			type: "freeAgent",
			text: decommit
				? `${who} decommitted from ${teamLink(tid)}.`
				: `${who} committed to ${teamLink(tid)}.`,
			showNotification: tid === userTid && !local.autoPlayUntil,
			pids: [p.pid],
			tids: [tid],
			score: stars >= 5 ? 10 : 5,
		},
		conditions,
	);
};

/**
 * One week of recruiting for every school: AI actions, interest decay and word of mouth, commitments and decommitments, portal moves.
 */
export const recruitingWeek = async (conditions?: Conditions) => {
	const prospects = await getProspects();
	if (prospects.length === 0) {
		const state = await getRecruitingState();
		await saveRecruitingState({
			...state,
			week: state.week + 1,
			points: state.budget,
		});
		return;
	}
	prospects.sort((a, b) => quality(b) - quality(a));
	const schools = await getSchools(prospects);
	const state = await getRecruitingState();
	const userTid = g.get("userTid");

	// AI schools (and the user's with Auto recruit) spend their points
	const expected = expectedPrestige(prospects, schools);
	const recruitProspects = prospects.filter((pr) => pr.kind === "recruit");
	const portalProspects = prospects.filter((pr) => pr.kind === "portal");
	const visitsUsed = new Map<number, number>();
	for (const { box } of prospects) {
		for (const s of box.schools ?? []) {
			if (s.v) {
				visitsUsed.set(s.tid, (visitsUsed.get(s.tid) ?? 0) + 1);
			}
		}
	}
	for (const school of schools.values()) {
		if (!school.auto) {
			continue;
		}
		const budget =
			school.tid === userTid
				? state.points
				: weeklyBudget(school.prestige, school.coach);
		// During the portal window, half the effort goes to the portal
		const share = portalProspects.length > 0 ? 0.5 : 1;
		aiRecruit(
			school,
			recruitProspects,
			expected,
			budget * share,
			visitsUsed.get(school.tid) ?? 0,
		);
		if (portalProspects.length > 0) {
			aiRecruit(
				school,
				portalProspects,
				expected,
				budget * (1 - share),
				OFFICIAL_VISITS_PER_SEASON,
			);
		}
	}

	// Decay, word of mouth, commitments
	const moved: CollegeDeparture[] = [];
	for (const prospect of prospects) {
		const { p, box, kind } = prospect;
		for (const si of box.schools ?? []) {
			const school = schools.get(si.tid);
			if (!school) {
				continue;
			}
			si.i = weeklyUpdate(si.i, {
				active: !!si.a,
				fitValue: fit(box.prefs!, getGrades(school, p, si)),
			});
			delete si.a;
		}
		if (box.commit !== undefined) {
			if (shouldDecommit(box.schools ?? [], box.commit)) {
				const tid = box.commit;
				delete box.commit;
				const school = schools.get(tid);
				if (school) {
					school.commits -= 1;
				}
				await newsCommit(prospect, tid, conditions, true);
			}
		}
		if (box.commit === undefined) {
			const tid = pickCommit(box.schools ?? [], (tid) => {
				const school = schools.get(tid);
				return !!school && openSpots(school) > 0;
			});
			if (tid !== undefined) {
				const school = schools.get(tid)!;
				await newsCommit(prospect, tid, conditions, false);
				if (kind === "portal") {
					const move = await portalMove(p, tid, conditions);
					if (move) {
						moved.push(move);
					}
					school.staying += 1;
					school.depth[posGroup(last(p.ratings).pos)]!.push(
						last(p.ratings).ovr,
					);
				} else {
					box.commit = tid;
					school.commits += 1;
				}
			}
		}
		await idb.cache.players.put(p);
	}
	if (moved.length > 0) {
		await addTransfers(moved);
	}

	await saveRecruitingState({
		...state,
		week: state.week + 1,
		points: state.budget,
	});
};

/**
 * Regular season: a recruiting week every poll week.
 */
export const recruitingWeeksTo = async (week: number) => {
	let state = await getRecruitingState();
	while (state.week < week) {
		await recruitingWeek();
		state = await getRecruitingState();
	}
};

// ---- The user's actions ----

const userSchool = async (prospects: Prospect[]) => {
	const schools = await getSchools(prospects);
	return { school: schools.get(g.get("userTid"))!, schools };
};

export const getUserOffers = (prospects: Prospect[], kind: Kind) => {
	const userTid = g.get("userTid");
	return prospects.filter(
		(pr) =>
			pr.kind === kind &&
			(pr.box.commit === undefined || pr.box.commit === userTid) &&
			pr.box.schools?.some((s) => s.tid === userTid && s.o),
	).length;
};

export const canRecruit = () => {
	const phase = g.get("phase");
	return phase >= PHASE.PRESEASON && phase <= PHASE.RESIGN_PLAYERS;
};

/**
 * One of the user's actions on a recruit or a portal player. Returns an error message, or undefined when it was done.
 */
export const userAction = async ({
	pid,
	action,
	pitch,
}: {
	pid: number;
	action: RecruitAction | "nil" | "withdraw";
	pitch?: Pitch;
}): Promise<string | undefined> => {
	if (!canRecruit()) {
		return "Recruiting is closed until the preseason.";
	}
	const prospects = await getProspects();
	const prospect = prospects.find((pr) => pr.p.pid === pid);
	if (!prospect) {
		return "He is not being recruited.";
	}
	const { box, kind, p } = prospect;
	const userTid = g.get("userTid");
	if (
		box.commit !== undefined &&
		box.commit !== userTid &&
		action !== "scout"
	) {
		// Committed elsewhere: only an offer or visits can still flip him
		if (action === "contact") {
			return "He has committed to another school. A visit or an offer might still change his mind.";
		}
	}
	const state = await getRecruitingState();
	const { school } = await userSchool(prospects);
	if (pitch !== undefined && !PITCHES.includes(pitch)) {
		pitch = undefined;
	}
	let si = getEntry(box, userTid, false);

	if (action === "nil") {
		if (state.nil < NIL_STEP) {
			return "No NIL money left this season.";
		}
		si = getEntry(box, userTid, true)!;
		si.nil = (si.nil ?? 0) + NIL_STEP;
		state.nil -= NIL_STEP;
	} else if (action === "withdraw") {
		if (!si?.o) {
			return "You have not offered him.";
		}
		delete si.o;
		si.i *= 0.6;
		if (box.commit === userTid) {
			delete box.commit;
		}
	} else {
		const info = ACTIONS[action];
		if (state.points < info.cost) {
			return `Not enough recruiting points this week (${info.name} costs ${info.cost}).`;
		}
		if (action === "scout") {
			if ((box.scout ?? 0) >= 2) {
				return "Already fully scouted.";
			}
			box.scout = (box.scout ?? 0) + 1;
		} else {
			if (
				action === "retain" &&
				(kind !== "portal" || p.portal!.from !== userTid)
			) {
				return "A retention pitch is only for your own players in the portal.";
			}
			if (action === "officialVisit") {
				if (si?.v) {
					return "He already took an official visit.";
				}
				if (state.officialVisits <= 0) {
					return "No official visits left this season.";
				}
				state.officialVisits -= 1;
			}
			if (action === "offer") {
				if (si?.o) {
					return "You already offered him.";
				}
				const spots = openSpots(school);
				const limit = Math.max(0, spots) * OFFERS_PER_SPOT;
				if (getUserOffers(prospects, kind) >= limit) {
					return spots <= 0
						? "No open scholarships."
						: `You can have ${limit} offers out with ${spots} open scholarship${spots === 1 ? "" : "s"}.`;
				}
			}
			if (
				(action === "contact" ||
					action === "homeVisit" ||
					action === "retain") &&
				si?.a
			) {
				return "You already worked on him this week.";
			}
			applyAction(prospect, school, action, pitch);
		}
		state.points -= info.cost;
	}
	await idb.cache.players.put(p);
	await saveRecruitingState(state);
	return undefined;
};

/**
 * Offseason: the user moves the portal window or late recruiting on by a week.
 */
export const advanceOffseasonWeek = async (conditions?: Conditions) => {
	const phase = g.get("phase");
	const max = maxOffseasonWeeks(phase);
	const state = await getRecruitingState();
	const used = state.offseasonPhase === phase ? state.offseasonWeeks : 0;
	if (max === 0 || used >= max) {
		return false;
	}
	await recruitingWeek(conditions);
	const after = await getRecruitingState();
	await saveRecruitingState({
		...after,
		offseasonPhase: phase,
		offseasonWeeks: used + 1,
	});
	return true;
};

export const maxOffseasonWeeks = (phase: number) =>
	phase === PHASE.AFTER_DRAFT
		? PORTAL_WEEKS
		: phase === PHASE.RESIGN_PLAYERS
			? LATE_RECRUITING_WEEKS
			: 0;

export const offseasonWeeksLeft = async () => {
	const phase = g.get("phase");
	const state = await getRecruitingState();
	const used = state.offseasonPhase === phase ? state.offseasonWeeks : 0;
	return Math.max(0, maxOffseasonWeeks(phase) - used);
};

// The weeks the user did not play by hand, before the phase ends
export const finishOffseasonWeeks = async (conditions?: Conditions) => {
	while (await advanceOffseasonWeek(conditions)) {
		// Each call plays a week
	}
};

// ---- Transfer portal ----

const addTransfers = async (moves: CollegeDeparture[]) => {
	const archive = await getCollegeArchive(g.get("season"));
	await updateCollegeArchive({
		transfers: [...(archive?.transfers ?? []), ...moves],
	});
};

// A portal player joins a school (his own again, or a new one)
const portalMove = async (
	p: CollegePlayer,
	to: number,
	conditions: Conditions | undefined,
): Promise<CollegeDeparture | undefined> => {
	const from = p.portal!.from;
	const season = g.get("season");
	const ratings = last(p.ratings);
	delete p.portal;
	p.tid = to;
	p.gamesUntilTradable = 0;
	if (to === from) {
		await logEvent(
			{
				type: "freeAgent",
				text: `${playerLink(p)} withdrew from the transfer portal and stays at ${teamLink(to)}.`,
				showNotification: to === g.get("userTid") && !local.autoPlayUntil,
				pids: [p.pid],
				tids: [to],
				score: 0,
			},
			conditions,
		);
		await idb.cache.players.put(p);
		return undefined;
	}
	p.transfers = (p.transfers ?? 0) + 1;
	const eid = await logEvent(
		{
			type: "freeAgent",
			text: `${playerLink(p)} (${ratings.pos}, ${classYearAbbrev(getClassYear(p))}) transferred from ${teamLink(from)} to ${teamLink(to)}.`,
			showNotification: false,
			pids: [p.pid],
			tids: [to],
			score: 5,
		},
		conditions,
	);
	if (!p.transactions) {
		p.transactions = [];
	}
	p.transactions.push({
		season,
		phase: g.get("phase"),
		tid: to,
		type: "freeAgent",
		eid,
	});
	player.setJerseyNumber(p, await player.genJerseyNumber(p));
	await idb.cache.players.put(p);
	return {
		pid: p.pid,
		name: `${p.firstName} ${p.lastName}`,
		pos: ratings.pos,
		tid: from,
		classYear: getClassYear(p),
		ovr: ratings.ovr,
		toTid: to,
	};
};

/**
 * Entering the Transfer portal phase: players enter the portal. Bench players who did not play, a few good players at small programs,
 * and on the user's team players unhappy with their minutes. A player who transferred once does not enter again.
 */
export const openPortal = async (conditions: Conditions) => {
	const season = g.get("season");
	const userTid = g.get("userTid");
	const teams = await getActiveTeams();
	const prestige = new Map(
		teams.map((t) => [t.tid, getTeamPrestige(t as any)]),
	);
	const players = (await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	])) as CollegePlayer[];
	const rosters = Map.groupBy(players, (p) => p.tid);
	const numGames = g.get("numGames");
	const allOvrs = players.map((p) => last(p.ratings).ovr).sort((a, b) => b - a);
	const topOvr = allOvrs[Math.floor(allOvrs.length * 0.08)] ?? 99;

	const userTexts: string[] = [];
	let count = 0;
	for (const t of teams) {
		const roster = [...(rosters.get(t.tid) ?? [])].sort(
			(a, b) => last(b.ratings).ovr - last(a.ratings).ovr,
		);
		let left = 0;
		for (const [i, p] of roster.entries()) {
			if (left >= 3 || roster.length - left <= 6) {
				break;
			}
			const classYear = getClassYear(p);
			if (
				classYear >= COLLEGE_ELIGIBILITY_YEARS ||
				classYear < 1 ||
				(p.transfers ?? 0) >= 1
			) {
				continue;
			}
			const { min } = seasonMinutes(p, season);
			const mpg = min / Math.max(1, numGames);
			const buried = i >= 8 && mpg < 8;
			// Minutes below what his rating says he should get (the user's players notice)
			const unhappy = t.tid === userTid && i >= 5 && i <= 9 && mpg < 12;
			const up =
				i < 2 &&
				last(p.ratings).ovr >= topOvr &&
				prestige.get(t.tid)! < 70 &&
				mpg > 20;
			if (
				(buried && Math.random() < 0.3) ||
				(unhappy && Math.random() < 0.3) ||
				(up && Math.random() < 0.25)
			) {
				p.portal = {
					from: t.tid,
					season,
					prefs: genPrefs(),
					// His school can still keep him
					schools: [{ tid: t.tid, i: 25, o: true }],
				};
				p.tid = PLAYER.FREE_AGENT;
				await idb.cache.players.put(p);
				left += 1;
				count += 1;
				if (t.tid === userTid) {
					userTexts.push(
						`${playerLink(p)} (${last(p.ratings).pos}, ${classYearAbbrev(classYear)})`,
					);
				}
			}
		}
	}
	if (!g.get("spectator")) {
		logEvent(
			{
				type: "info",
				text: `<b>Transfer portal</b><br>${count} players entered the <a href="${helpers.leagueUrl(["college_portal"])}">transfer portal</a>.${
					userTexts.length > 0
						? `<br>From your team: ${userTexts.join(", ")}. A retention pitch might keep them.`
						: ""
				}`,
				showNotification: !local.autoPlayUntil,
				saveToDb: false,
			},
			conditions,
		);
	}
	await updateCollegeArchive({ transfers: [] });
};

/**
 * End of the portal window (entering the Recruiting phase): the weeks left are played, then everyone still in the portal picks the
 * school he likes best that has a spot, goes back to his school if it has room, or leaves college.
 */
export const closePortal = async (conditions: Conditions) => {
	const portal = await getPortalPlayers();
	if (portal.length === 0) {
		return;
	}
	const prospects: Prospect[] = portal.map((p) => ({
		p,
		box: ensureBox(p.portal!),
		kind: "portal",
	}));
	const recruits = await getRecruits();
	const allProspects: Prospect[] = [
		...recruits.map((p) => ({
			p,
			box: ensureBox(p.recruit!),
			kind: "recruit" as const,
		})),
		...prospects,
	];
	const schools = await getSchools(allProspects);
	prospects.sort((a, b) => quality(b) - quality(a));
	const moved: CollegeDeparture[] = [];
	for (const prospect of prospects) {
		const { p, box } = prospect;
		const from = p.portal!.from;
		const ovr = last(p.ratings).ovr;
		const options = (box.schools ?? [])
			.filter((s) => {
				const school = schools.get(s.tid);
				return !!school && openSpots(school) > 0;
			})
			.sort((a, b) => (b.o ? 1.3 : 1) * b.i - (a.o ? 1.3 : 1) * a.i);
		let to = options[0]?.tid;
		if (to === undefined) {
			// Anyone with a spot where he would play
			let best: { tid: number; score: number } | undefined;
			for (const school of schools.values()) {
				if (openSpots(school) <= 0) {
					continue;
				}
				const sorted = school.depth.flat().sort((a, b) => b - a);
				if (ovr < (sorted[9] ?? 0)) {
					continue;
				}
				const score = school.prestige + (school.tid === from ? 10 : 0);
				if (!best || score > best.score) {
					best = { tid: school.tid, score };
				}
			}
			to = best?.tid;
		}
		if (to === undefined) {
			delete p.portal;
			await leaveSchool(
				p,
				{ season: g.get("season"), type: "left", tid: from },
				`${playerLink(p)} found no school in the transfer portal and left college.`,
				conditions,
			);
			continue;
		}
		const school = schools.get(to)!;
		school.staying += 1;
		school.depth[posGroup(last(p.ratings).pos)]!.push(ovr);
		const move = await portalMove(p, to, conditions);
		if (move) {
			moved.push(move);
		}
	}
	await addTransfers(moved);
};

// ---- Signing day ----

/**
 * Signing day with recruiting v2: committed recruits sign with their school, then the others, best first, with the school they like best
 * that offered and has a spot. Returns the recruits it signed (pid -> tid); the rest are left for the v1 rules.
 */
export const signCommitted = async (
	openings: Map<number, number>,
): Promise<Map<number, number>> => {
	const signed = new Map<number, number>();
	const recruits = await getRecruits();
	for (const p of recruits) {
		const box = p.recruit!;
		if (box.commit !== undefined && (openings.get(box.commit) ?? 0) > 0) {
			signed.set(p.pid, box.commit);
			openings.set(box.commit, openings.get(box.commit)! - 1);
		}
	}
	for (const p of recruits) {
		if (signed.has(p.pid)) {
			continue;
		}
		const options = (p.recruit!.schools ?? [])
			.filter((s) => s.o && s.i >= 20 && (openings.get(s.tid) ?? 0) > 0)
			.sort((a, b) => b.i - a.i);
		const tid = options[0]?.tid;
		if (tid !== undefined) {
			signed.set(p.pid, tid);
			openings.set(tid, openings.get(tid)! - 1);
		}
	}
	return signed;
};

// ---- For the pages ----

export const prospectInfo = (
	prospect: Prospect,
	school: SchoolInfo,
	teamInfoCache: { abbrev: string; region: string }[],
) => {
	const { p, box } = prospect;
	const userTid = g.get("userTid");
	const ratings = last(p.ratings);
	const scout = box.scout ?? 0;
	// Scouting narrows the fuzz: half after one report, exact after two
	const fuzz =
		ratings.fuzz *
		(prospect.kind === "recruit" ? 1.5 : 1) *
		[1, 0.5, 0][scout]!;
	const si = box.schools?.find((s) => s.tid === userTid);
	const grades = getGrades(school, p, si);
	const prefs = box.prefs!;
	const ranked = [...PITCHES].sort((a, b) => prefs[b] - prefs[a]);
	const top = [...(box.schools ?? [])]
		.filter((s) => s.tid !== userTid)
		.sort((a, b) => b.i - a.i)
		.slice(0, 3)
		.map((s) => ({
			tid: s.tid,
			abbrev: teamInfoCache[s.tid]?.abbrev ?? "",
			region: teamInfoCache[s.tid]?.region ?? "",
			interest: Math.round(s.i),
			offered: !!s.o,
		}));
	return {
		pid: p.pid,
		name: `${p.firstName} ${p.lastName}`,
		pos: ratings.pos,
		hgt: p.hgt,
		ovr: Math.round(helpers.bound(ratings.ovr + fuzz, 0, 100)),
		pot: Math.round(helpers.bound(ratings.pot + fuzz, 0, 100)),
		scout,
		// What he wants: nothing before scouting, his top two after one report, everything after two
		wants:
			scout >= 2
				? ranked.map((key) => ({ key, weight: prefs[key] }))
				: scout === 1
					? ranked.slice(0, 2).map((key) => ({ key, weight: undefined }))
					: [],
		grades,
		interest: Math.round(si?.i ?? 0),
		offered: !!si?.o,
		visited: !!si?.v,
		actedThisWeek: !!si?.a,
		nil: si?.nil ?? 0,
		top,
		commit: box.commit,
		commitAbbrev:
			box.commit !== undefined ? teamInfoCache[box.commit]?.abbrev : undefined,
	};
};

export const getBoard = async (kind: Kind) => {
	const prospects = await getProspects();
	const { school } = await userSchool(prospects);
	const teamInfoCache = g.get("teamInfoCache");
	const state = await getRecruitingState();
	const list = prospects
		.filter((pr) => pr.kind === kind)
		.map((pr) => ({ pr, info: prospectInfo(pr, school, teamInfoCache) }));
	return {
		list,
		state,
		openSpots: openSpots(school),
		offers: getUserOffers(prospects, kind),
		offerLimit: Math.max(0, openSpots(school)) * OFFERS_PER_SPOT,
		weeksLeft: await offseasonWeeksLeft(),
	};
};

export const RECRUIT_ACTIONS = ACTIONS;
