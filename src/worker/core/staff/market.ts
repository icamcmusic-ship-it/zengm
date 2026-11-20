// Coach Market & Succession (featureCoachMarket, needs Coaching Staff and Coaching Staff Depth): interviews, candidate preferences and
// competing offers when the user hires; the associate head coach (heir apparent) and his promotion with continuity; interim head coaches
// when a head coach is fired during the season. Seeded streams only (league seed, team, coach, season), never the main random stream.
import { PHASE } from "../../../common/constants.ts";
import { fitToScore } from "../../../common/coachSystems.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import {
	COACH_FREE_AGENT,
	COACH_ROLE_NAMES,
	coachOvr,
	coachSalaryDemand,
} from "../../../common/staff.ts";
import {
	HEIR_GROWTH_MAX,
	MAX_INTERVIEWS,
	MIN_INTEREST,
	PREF_NAMES,
	candidateInterest,
	coachPrefs,
	interestLabel,
	topPref,
} from "../../../common/staffDepth/coachMarket.ts";
import type {
	CoachInterview,
	CoachMarketTeam,
	CompetingOffer,
} from "../../../common/staffDepth/types.ts";
import type { Coach, CoachProfile, CoachRole } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { leagueSeed } from "../scoutingReports/input.ts";
import { coachingDepthOn, clearDepthCache } from "../staffDepth/coaching.ts";
import {
	clearCoachSystemsCache,
	coachSystemsEnabled,
	getCoachProfile,
	getRosterFit,
} from "./systems.ts";
import {
	addTransaction,
	coachLink,
	fire,
	firedRecentlyBy,
	hire,
	teamLink,
} from "./index.ts";

export const coachMarketOn = () =>
	coachingDepthOn() && featureOn("coachMarket");

const userControls = (tid: number) =>
	g.get("userTids").includes(tid) &&
	!local.autoPlayUntil &&
	!g.get("spectator");

// The season a contract signed now starts
export const hiringSeason = () =>
	g.get("phase") > PHASE.PLAYOFFS ? g.get("season") + 1 : g.get("season");

const inSeason = () => {
	const phase = g.get("phase");
	return phase >= PHASE.REGULAR_SEASON && phase <= PHASE.PLAYOFFS;
};

const fullName = (c: Coach) => `${c.firstName} ${c.lastName}`;

const emptyState = (season: number): CoachMarketTeam => ({
	season,
	interviews: [],
	offers: [],
	checked: [],
});

export const marketStateOf = (t: { coachMarket?: CoachMarketTeam }) => {
	const season = hiringSeason();
	return t.coachMarket && t.coachMarket.season === season
		? t.coachMarket
		: emptyState(season);
};

const getTeam = async (tid: number) => {
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		throw new Error("Invalid team");
	}
	return t;
};

// ---- preferences ----

const winPct = (r: { won: number; lost: number; tied?: number }) => {
	const gp = r.won + r.lost + (r.tied ?? 0);
	return gp > 0 ? (r.won + 0.5 * (r.tied ?? 0)) / gp : 0.5;
};

// Team success (0-1 win%: this season once it is under way, else last season) and market size (0 smallest ... 1 biggest)
export const teamAppeal = async (tid: number) => {
	const season = g.get("season");
	const now = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
		season,
		tid,
	]);
	let success = 0.5;
	if (now && now.won + now.lost >= 10) {
		success = winPct(now);
	} else {
		const last = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsBySeasonTid",
			[season - 1, tid],
		);
		if (last && last.won + last.lost > 0) {
			success = winPct(last);
		} else if (now) {
			success = now.won + now.lost > 0 ? winPct(now) : 0.5;
		}
	}
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const me = teams.find((t) => t.tid === tid);
	const bigger = me ? teams.filter((t) => t.pop > me.pop).length : 0;
	const market = teams.length > 1 ? 1 - bigger / (teams.length - 1) : 0.5;
	return { success, market };
};

export const interestIn = async (
	c: Coach,
	tid: number,
	{ premium = 0, courted }: { premium?: number; courted?: boolean } = {},
) => {
	const appeal = await teamAppeal(tid);
	return candidateInterest({
		prefs: coachPrefs(c),
		...appeal,
		salaryRatio: 1 + premium,
		courted,
	});
};

// ---- interviews ----

const word = (x: number, words: [number, string][], last: string) =>
	words.find(([min]) => x >= min)?.[1] ?? last;

export const interviewCoach = async ({
	tid,
	cid,
	role,
}: {
	tid: number;
	cid: number;
	role: CoachRole;
}) => {
	if (!coachMarketOn()) {
		throw new Error("Coach Market & Succession is off");
	}
	const t = await getTeam(tid);
	const c = await idb.cache.coaches.get(cid);
	if (!c || c.tid !== COACH_FREE_AGENT) {
		throw new Error("That coach is not available");
	}
	const state = marketStateOf(t);
	if (state.interviews.some((x) => x.cid === cid)) {
		throw new Error("You already interviewed him.");
	}
	if (state.interviews.length >= MAX_INTERVIEWS) {
		throw new Error(
			`You can interview ${MAX_INTERVIEWS} candidates per hiring season.`,
		);
	}
	const rng = new Rng(
		`interview|${leagueSeed()}|${tid}|${cid}|${state.season}`,
	);
	const lines: string[] = [];
	const prefs = coachPrefs(c);
	lines.push(`What he wants most: ${PREF_NAMES[topPref(prefs)]}.`);
	let fit: number | undefined;
	if (coachSystemsEnabled()) {
		const profile = getCoachProfile(c);
		const mgmt = profile.mgmt + rng.normal(0, 7);
		const adapt = profile.adapt + rng.normal(0, 8);
		const youth = profile.youth + rng.normal(0, 0.2);
		const pers = profile.personality + rng.normal(0, 0.2);
		lines.push(
			`Game management: ${word(
				mgmt,
				[
					[70, "sharp"],
					[50, "solid"],
					[35, "shaky"],
				],
				"a weakness",
			)}.`,
			`Will he adjust his system to the roster? ${word(
				adapt,
				[
					[65, "readily"],
					[40, "somewhat"],
				],
				"rarely, he is stubborn",
			)}.`,
			`Trusts ${word(
				youth,
				[
					[0.35, "young players"],
					[-0.35, "a mix of young players and veterans"],
				],
				"veterans",
			)}; ${word(
				pers,
				[
					[0.35, "a players' coach"],
					[-0.35, "balanced"],
				],
				"a disciplinarian",
			)}.`,
		);
		if (role === "head") {
			const rf = await getRosterFit(tid);
			fit = helpers.bound(
				Math.round(
					fitToScore(0.6 * rf.off[profile.off] + 0.4 * rf.def[profile.def]) +
						rng.normal(0, 5),
				),
				0,
				100,
			);
			lines.push(`His systems and your roster: about ${fit}/100.`);
		}
	}
	const dev = c.ratings.dev + rng.normal(0, 5);
	lines.push(
		`Teaching and development: ${word(
			dev,
			[
				[70, "a real strength"],
				[50, "fine"],
			],
			"not his focus",
		)}.`,
	);
	const interest = helpers.bound(
		Math.round(
			(await interestIn(c, tid, { courted: true })) + rng.normal(0, 6),
		),
		0,
		100,
	);
	lines.push(
		`His interest in the job: ${interestLabel(interest).toLowerCase()}.`,
	);
	const interview: CoachInterview = {
		cid,
		role,
		season: state.season,
		lines,
		fit,
		interest,
	};
	state.interviews.push(interview);
	t.coachMarket = state;
	await idb.cache.teams.put(t);
	return interview;
};

// ---- competing offers ----

const competingOfferFor = async (
	c: Coach,
	role: CoachRole,
	userTid: number,
	userYears: number,
	season: number,
): Promise<CompetingOffer | undefined> => {
	const coaches = await idb.cache.coaches.getAll();
	const ovr = coachOvr(c.ratings, role);
	const better = coaches.filter(
		(x) =>
			x.tid === COACH_FREE_AGENT &&
			x.cid !== c.cid &&
			coachOvr(x.ratings, role) > ovr,
	).length;
	// Only the top candidates draw rival interest
	if (better >= 3 && ovr < (role === "head" ? 60 : 62)) {
		return undefined;
	}
	const rng = new Rng(
		`rivalOffer|${leagueSeed()}|${c.cid}|${season}|${userTid}`,
	);
	if (!rng.chance(role === "head" ? 0.45 : 0.3)) {
		return undefined;
	}
	const teams = (await idb.cache.teams.getAll()).filter(
		(t) => !t.disabled && t.tid !== userTid && !userControls(t.tid),
	);
	let best: { tid: number; score: number } | undefined;
	for (const t of teams) {
		if (firedRecentlyBy(c, t.tid)) {
			continue;
		}
		const incumbent = coaches.find((x) => x.tid === t.tid && x.role === role);
		if (incumbent && coachOvr(incumbent.ratings, role) > ovr - 6) {
			continue;
		}
		const score =
			(await interestIn(c, t.tid, { premium: 0.15 })) + 4 * rng.random();
		if (!best || score > best.score) {
			best = { tid: t.tid, score };
		}
	}
	if (!best) {
		return undefined;
	}
	const demand = coachSalaryDemand(c.ratings, role, g.get("salaryCap"));
	return {
		cid: c.cid,
		role,
		season,
		tid: best.tid,
		amount: Math.round((demand * (1.1 + 0.15 * rng.random())) / 10) * 10,
		years: rng.int(2, 4),
		userYears,
	};
};

/**
 * Before the user hires: the candidate's interest, then (once per candidate and hiring season) a possible competing offer. Returns the
 * salary to pay, or the offer to match. Throws when he turns the job down.
 */
export const beforeUserHire = async ({
	c,
	tid,
	role,
	years,
	premium,
	match,
}: {
	c: Coach;
	tid: number;
	role: CoachRole;
	years: number;
	premium: number;
	match?: boolean;
}): Promise<{ amount: number } | { offer: CompetingOffer }> => {
	const t = await getTeam(tid);
	const state = marketStateOf(t);
	const pending = state.offers.find((o) => o.cid === c.cid);
	if (match) {
		if (!pending) {
			throw new Error("There is no offer to match.");
		}
		state.offers = state.offers.filter((o) => o !== pending);
		t.coachMarket = state;
		await idb.cache.teams.put(t);
		return { amount: pending.amount };
	}
	if (pending) {
		throw new Error(
			`${fullName(c)} has an offer from another team: match it or walk away.`,
		);
	}
	const interest = await interestIn(c, tid, {
		premium,
		courted: state.interviews.some((x) => x.cid === c.cid),
	});
	if (interest < MIN_INTEREST) {
		throw new Error(
			`${fullName(c)} is not interested in the job (he cares most about ${PREF_NAMES[topPref(coachPrefs(c))]}). A bigger salary might change his mind.`,
		);
	}
	const demand = coachSalaryDemand(c.ratings, role, g.get("salaryCap"));
	if (!state.checked.includes(c.cid)) {
		state.checked.push(c.cid);
		const offer = await competingOfferFor(c, role, tid, years, state.season);
		// Eager candidates and big premiums keep rivals away
		if (offer && interest < 80 && premium < 0.2) {
			state.offers.push(offer);
			t.coachMarket = state;
			await idb.cache.teams.put(t);
			await logEvent({
				type: "info",
				text: `${coachLink(c)} has a competing offer from ${teamLink(offer.tid)}: ${helpers.formatCurrency(offer.amount / 1000, "M")} a season. Match it on the Coaching Staff page or lose him.`,
				saveToDb: false,
				showNotification: true,
			});
			return { offer };
		}
		t.coachMarket = state;
		await idb.cache.teams.put(t);
	}
	return { amount: Math.round((demand * (1 + premium)) / 10) * 10 };
};

// The user walks away from an offer (or never answered it): the rival team hires him
export const walkAway = async (tid: number, cid: number) => {
	const t = await getTeam(tid);
	const state = marketStateOf(t);
	const offer = state.offers.find((o) => o.cid === cid);
	if (!offer) {
		return;
	}
	state.offers = state.offers.filter((o) => o !== offer);
	t.coachMarket = state;
	await idb.cache.teams.put(t);
	const c = await idb.cache.coaches.get(cid);
	if (!c || c.tid !== COACH_FREE_AGENT) {
		return;
	}
	const incumbent = (
		await idb.cache.coaches.indexGetAll("coachesByTid", offer.tid)
	).find((x) => x.role === offer.role);
	if (incumbent) {
		await fire(incumbent, { noInterim: true });
	}
	await hire(c, offer.tid, offer.role, offer.years);
	c.contract.amount = offer.amount;
	await idb.cache.coaches.put(c);
	await logEvent({
		type: "info",
		text: `${coachLink(c)} took the ${COACH_ROLE_NAMES[offer.role]} job with ${teamLink(offer.tid)} instead of yours.`,
		showNotification: userControls(tid),
		tids: [tid, offer.tid],
		score: 0,
	});
};

// Preseason: offers nobody answered go to the rival teams
export const resolvePendingOffers = async () => {
	if (!coachMarketOn()) {
		return;
	}
	for (const t of await idb.cache.teams.getAll()) {
		for (const o of t.coachMarket?.offers ?? []) {
			await walkAway(t.tid, o.cid);
		}
	}
};

// ---- associate head coach (heir apparent) ----

export const heirOf = async (tid: number) =>
	(await idb.cache.coaches.indexGetAll("coachesByTid", tid)).find(
		(c) => c.role !== "head" && c.succession?.heir !== undefined,
	);

export const setHeir = async (tid: number, cid: number | null) => {
	if (!coachMarketOn()) {
		throw new Error("Coach Market & Succession is off");
	}
	const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
	if (cid !== null) {
		const c = coaches.find((x) => x.cid === cid);
		if (!c || c.role === "head") {
			throw new Error("Only one of your assistants can be the heir.");
		}
	}
	for (const c of coaches) {
		const want = c.cid === cid;
		if (want && c.succession?.heir === undefined) {
			c.succession = { ...c.succession, heir: g.get("season") };
			await idb.cache.coaches.put(c);
		} else if (!want && c.succession?.heir !== undefined) {
			c.succession = { ...c.succession, heir: undefined };
			await idb.cache.coaches.put(c);
		}
	}
};

// The profile of the team's last head coach (for continuity), from the transactions
const predecessorProfile = async (
	tid: number,
	exclude: number,
): Promise<CoachProfile | undefined> => {
	let best: { c: Coach; key: number } | undefined;
	for (const c of await idb.cache.coaches.getAll()) {
		if (c.cid === exclude) {
			continue;
		}
		const tx = c.transactions.findLast(
			(x) => x.tid === tid && x.role === "head" && x.type !== "hired",
		);
		if (tx) {
			const key = tx.season * 100 + tx.phase;
			if (!best || key > best.key) {
				best = { c, key };
			}
		}
	}
	return best && coachSystemsEnabled() ? getCoachProfile(best.c) : undefined;
};

// The heir takes over the vacant head coaching job, keeping the predecessor's systems and their installation (the players' familiarity)
export const promoteHeir = async (tid: number, years?: number) => {
	const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
	if (coaches.some((c) => c.role === "head")) {
		return undefined;
	}
	const c = coaches.find(
		(x) => x.role !== "head" && x.succession?.heir !== undefined,
	);
	if (!c) {
		return undefined;
	}
	const from = c.role;
	const prev = await predecessorProfile(tid, c.cid);
	c.succession = { ...c.succession, heir: undefined };
	await hire(c, tid, "head", years ?? 3);
	if (prev) {
		const profile = getCoachProfile(c);
		profile.off = prev.off;
		profile.def = prev.def;
		profile.since = prev.since;
		c.profile = profile;
		await idb.cache.coaches.put(c);
		clearCoachSystemsCache();
	}
	await logEvent({
		type: "info",
		text: `${teamLink(tid)} promoted associate head coach ${coachLink(c)} (${COACH_ROLE_NAMES[from]}) to head coach. The system stays in place.`,
		showNotification: userControls(tid),
		tids: [tid],
		score: 0,
	});
	return c;
};

// Before vacancies are filled: heirs step into vacant head coaching jobs (AI teams, and the user's when his hiring is filled for him)
export const promoteHeirs = async ({
	includeUser,
	userAuto,
}: {
	includeUser: boolean;
	userAuto?: Set<number>;
}) => {
	if (!coachMarketOn()) {
		return;
	}
	for (const t of await idb.cache.teams.getAll()) {
		if (t.disabled) {
			continue;
		}
		if (!includeUser && userControls(t.tid) && !userAuto?.has(t.tid)) {
			continue;
		}
		await promoteHeir(t.tid);
	}
};

const HEIR_RATINGS = ["off", "def", "mot"] as const;

// Offseason: heirs grow toward head coach ratings; AI teams name one when they have none
export const heirOffseason = async () => {
	if (!coachMarketOn()) {
		return;
	}
	const season = g.get("season");
	const seed = leagueSeed();
	const coaches = await idb.cache.coaches.getAll();
	for (const c of coaches) {
		if (c.tid < 0 || c.succession?.heir === undefined) {
			continue;
		}
		if (c.role === "head") {
			c.succession = { ...c.succession, heir: undefined };
			await idb.cache.coaches.put(c);
			continue;
		}
		const rng = new Rng(`heirGrowth|${seed}|${c.cid}|${season}`);
		for (const key of HEIR_RATINGS) {
			if (c.ratings[key] < 78) {
				c.ratings[key] = Math.min(
					100,
					c.ratings[key] + rng.int(0, HEIR_GROWTH_MAX),
				);
			}
		}
		await idb.cache.coaches.put(c);
	}
	for (const t of await idb.cache.teams.getAll()) {
		if (t.disabled || userControls(t.tid)) {
			continue;
		}
		const staff = coaches.filter((c) => c.tid === t.tid);
		if (staff.some((c) => c.succession?.heir !== undefined)) {
			continue;
		}
		const best = staff
			.filter((c) => c.role !== "head" && season - c.born.year <= 60)
			.sort(
				(a, b) =>
					coachOvr(b.ratings, "head") - coachOvr(a.ratings, "head") ||
					a.cid - b.cid,
			)[0];
		if (best && coachOvr(best.ratings, "head") >= 45) {
			best.succession = { ...best.succession, heir: season };
			await idb.cache.coaches.put(best);
		}
	}
};

// ---- interim head coaches ----

// A head coach was fired during the season: the heir is promoted, or else the best assistant takes over as interim
export const afterHeadFired = async (tid: number) => {
	if (!coachMarketOn() || !inSeason()) {
		return;
	}
	if (await promoteHeir(tid)) {
		return;
	}
	const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
	if (coaches.some((c) => c.role === "head")) {
		return;
	}
	const c = coaches
		.filter((x) => x.role !== "head")
		.sort(
			(a, b) =>
				coachOvr(b.ratings, "head") - coachOvr(a.ratings, "head") ||
				a.cid - b.cid,
		)[0];
	if (!c) {
		return;
	}
	const from = c.role;
	await hire(c, tid, "head", 1);
	c.succession = {
		...c.succession,
		interim: { season: g.get("season"), from },
	};
	await idb.cache.coaches.put(c);
	await logEvent({
		type: "info",
		text: `${coachLink(c)} (${COACH_ROLE_NAMES[from]}) is the interim head coach of ${teamLink(tid)}.`,
		showNotification: userControls(tid),
		tids: [tid],
		score: 0,
	});
};

// The interim goes back to his old job if it is still open, or leaves
const endInterim = async (c: Coach) => {
	const tid = c.tid;
	const from = c.succession!.interim!.from;
	c.succession = { ...c.succession, interim: undefined };
	const staff = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
	addTransaction(c, tid, "head", "left");
	if (!staff.some((x) => x.role === from && x.cid !== c.cid)) {
		c.role = from;
		c.contract = {
			amount: coachSalaryDemand(c.ratings, from, g.get("salaryCap")),
			exp: hiringSeason() + 1,
		};
		addTransaction(c, tid, from, "hired");
	} else {
		c.tid = COACH_FREE_AGENT;
	}
	c.hiredRecord = undefined;
	await idb.cache.coaches.put(c);
	clearCoachSystemsCache();
	clearDepthCache();
	await logEvent({
		type: "info",
		text:
			c.tid === tid
				? `Interim head coach ${coachLink(c)} goes back to his job as ${COACH_ROLE_NAMES[from]} of ${teamLink(tid)}.`
				: `Interim head coach ${coachLink(c)} left ${teamLink(tid)}.`,
		showNotification: false,
		tids: [tid],
		score: 0,
	});
};

const keepInterim = (c: Coach, years: number) => {
	c.succession = { ...c.succession, interim: undefined };
	c.contract = {
		amount: Math.max(
			c.contract.amount,
			coachSalaryDemand(c.ratings, "head", g.get("salaryCap")),
		),
		exp: hiringSeason() + years - 1,
	};
	addTransaction(c, c.tid, "head", "reSigned");
};

// Season end (before contracts expire): AI teams keep or replace their interims; the user's stays on until he decides
export const interimOffseason = async () => {
	if (!coachMarketOn()) {
		return;
	}
	const season = g.get("season");
	for (const c of await idb.cache.coaches.getAll()) {
		if (c.tid < 0 || c.role !== "head" || !c.succession?.interim) {
			continue;
		}
		if (userControls(c.tid)) {
			c.contract.exp = Math.max(c.contract.exp, season + 1);
			await idb.cache.coaches.put(c);
			continue;
		}
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			season,
			c.tid,
		]);
		const rng = new Rng(`interim|${leagueSeed()}|${c.cid}|${season}`);
		const pct = ts ? winPct(ts) : 0.5;
		if (pct >= 0.5 || rng.chance(0.25)) {
			keepInterim(c, rng.int(2, 3));
			await idb.cache.coaches.put(c);
			await logEvent({
				type: "info",
				text: `${teamLink(c.tid)} removed the interim tag: ${coachLink(c)} is their head coach.`,
				showNotification: false,
				tids: [c.tid],
				score: 0,
			});
		} else {
			await endInterim(c);
		}
	}
};

export const userInterimDecision = async ({
	tid,
	cid,
	keep,
	years,
}: {
	tid: number;
	cid: number;
	keep: boolean;
	years: number;
}) => {
	const c = await idb.cache.coaches.get(cid);
	if (!c || c.tid !== tid || c.role !== "head" || !c.succession?.interim) {
		throw new Error("No interim head coach to decide on");
	}
	if (
		g.get("phase") <= PHASE.PLAYOFFS &&
		g.get("phase") >= PHASE.REGULAR_SEASON
	) {
		throw new Error("Decide on the interim coach after the season.");
	}
	if (keep) {
		keepInterim(c, helpers.bound(Math.round(years), 1, 5));
		await idb.cache.coaches.put(c);
	} else {
		await endInterim(c);
	}
};

// Preseason: an interim nobody decided on is kept
export const settleInterims = async () => {
	if (!coachMarketOn()) {
		return;
	}
	const season = g.get("season");
	for (const c of await idb.cache.coaches.getAll()) {
		if (c.succession?.interim && c.succession.interim.season < season) {
			c.succession = { ...c.succession, interim: undefined };
			await idb.cache.coaches.put(c);
		}
	}
};
