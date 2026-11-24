// Offensive Emphasis (League Extras: featureOffEmphasis; common/offEmphasis.ts): each team's play-type dials, set by its head coach
// (auto) or the user, and what the game sim gets from them
import { PHASE } from "../../../common/constants.ts";
import {
	AUTO_FIT_MEAN,
	autoEmphasis,
	clampEmphasis,
	type Emphasis,
	emphasisFit,
	emphasisRecommendation,
	type EmphasisMode,
	type EmphasisRatings,
	emphasisSim,
	NEUTRAL_EMPHASIS,
	type OffEmphasisTeam,
	type PlayTypePpp,
	leagueNorms,
	rawStrengths,
	rosterStrengths,
	type StrengthNorms,
} from "../../../common/offEmphasis.ts";
import { playTypeProfile, sumAdv } from "../../../common/advStats.ts";
import type { Player, Team } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { userRunsTeam } from "../../util/userRunsTeam.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { getCoachProfile } from "../staff/systems.ts";

// On only with Realistic Play Types (and what that needs: the realistic possession model and Spacing & Shot Creation)
export const offEmphasisOn = () =>
	__SPORT === "basketball" &&
	featureOn("offEmphasis") &&
	featureOn("realisticPlayTypes") &&
	!!g.get("realisticPossessions") &&
	featureOn("spacingCreation");

const ratingsRow = (r: any): EmphasisRatings => ({
	hgt: r.hgt,
	stre: r.stre,
	spd: r.spd,
	jmp: r.jmp,
	ins: r.ins,
	dnk: r.dnk,
	fg: r.fg,
	tp: r.tp,
	oiq: r.oiq,
	drb: r.drb,
	pss: r.pss,
});

const rosterRows = async (tid: number) => {
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	return players
		.filter((p) => p.injury.gamesRemaining === 0)
		.toSorted((a, b) => b.valueNoPot - a.valueNoPot);
};

// The league's norms (every active team's roster), refreshed weekly like the dials
// and the league's average fit with every team on its coach's dials (the fit bonus is relative to it, so league totals stay put)
let normsCache:
	| { key: string; norms: StrengthNorms; autoFitMean: number }
	| undefined;
const getLeagueContext = async (day = 0) => {
	const key = `${g.get("lid")}|${g.get("season")}|${Math.floor(day / 7)}`;
	if (normsCache?.key === key) {
		return normsCache;
	}
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const rosters: { tid: number; ratings: EmphasisRatings[] }[] = [];
	for (const t of teams) {
		const rows = await rosterRows(t.tid);
		if (rows.length >= 5) {
			rosters.push({
				tid: t.tid,
				ratings: rows.map((p) => ratingsRow(p.ratings.at(-1))),
			});
		}
	}
	const norms = leagueNorms(rosters.map((r) => rawStrengths(r.ratings)));
	let fitSum = 0;
	for (const r of rosters) {
		const z = rosterStrengths(r.ratings, norms);
		fitSum += emphasisFit(autoEmphasis(z, await headCoachSystem(r.tid)), z);
	}
	normsCache = {
		key,
		norms,
		autoFitMean: rosters.length >= 6 ? fitSum / rosters.length : AUTO_FIT_MEAN,
	};
	return normsCache;
};
const getLeagueNorms = async (day?: number) =>
	(await getLeagueContext(day)).norms;

export const teamStrengths = async (tid: number, day?: number) =>
	rosterStrengths(
		(await rosterRows(tid)).map((p) => ratingsRow(p.ratings.at(-1))),
		await getLeagueNorms(day),
	);

// The head coach's offense system (Coaching Systems profile, derived when the setting is off), undefined without a head coach
const headCoachSystem = async (tid: number) => {
	if (!g.get("coachingStaff")) {
		return undefined;
	}
	const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
	const head = coaches.find((c) => c.role === "head");
	return head ? getCoachProfile(head).off : undefined;
};

export const coachEmphasis = async (tid: number, day?: number) =>
	autoEmphasis(await teamStrengths(tid, day), await headCoachSystem(tid));

const defaultState = (e: Emphasis): OffEmphasisTeam => ({ mode: "auto", e });

// Refresh a team's dials: auto teams (every AI team, and the user's on Auto) follow the coach weekly and at every new season; on
// Suggest the coach's proposal is refreshed and the dials stay. Returns the state (saved when changed)
// A user team the AI runs (spectator mode, auto play) plays the coach's dials, while the user's own (his mode and manual dials) are
// kept for when he takes it back: before, spectator mode switched him to Auto for good and auto play used his manual dials
export const ensureTeamEmphasis = async (t: Team, day = 0) => {
	const season = g.get("season");
	const cur = t.offEmphasis;
	const userTeam = g.get("userTids").includes(t.tid);
	const aiRunsUserTeam = userTeam && !userRunsTeam(t.tid);
	const stale =
		!cur?.set || cur.set.season !== season || Math.abs(cur.set.day - day) >= 7;
	if (cur && !stale && (!aiRunsUserTeam || cur.mode === "auto")) {
		return cur;
	}
	const auto = await coachEmphasis(t.tid, day);
	let next: OffEmphasisTeam;
	if (!cur) {
		next = defaultState(auto);
	} else if (cur.mode === "auto" || !userTeam) {
		next = { ...cur, mode: userTeam ? cur.mode : "auto", e: auto };
	} else if (cur.mode === "suggest") {
		next = { ...cur, suggested: auto };
	} else {
		next = { ...cur };
	}
	if (stale || !cur) {
		next.set = { season, day };
		t.offEmphasis = next;
		await idb.cache.teams.put(t);
	}
	return aiRunsUserTeam ? { ...next, e: auto } : next;
};

// Before a day's games: each team's sim multipliers from its dials and the fit to the healthy players it dresses
export const applyOffEmphasis = async (
	schedule: readonly { homeTid: number; awayTid: number; day?: number }[],
	teams: Record<number, any>,
) => {
	if (!offEmphasisOn() || g.get("phase") > PHASE.PLAYOFFS) {
		return;
	}
	const day = schedule[0]?.day ?? 0;
	for (const matchup of schedule) {
		for (const tid of [matchup.homeTid, matchup.awayTid]) {
			const gt = teams[tid];
			if (tid < 0 || !gt) {
				continue;
			}
			const t = await idb.cache.teams.get(tid);
			if (!t) {
				continue;
			}
			const state = await ensureTeamEmphasis(t, day);
			const players = (gt.player as any[])
				.filter((p) => !p.injured && p.pbpRatings)
				.toSorted((a, b) => b.valueNoPot - a.valueNoPot);
			const z = rosterStrengths(
				players.map((p) => ratingsRow(p.pbpRatings)),
				await getLeagueNorms(day),
			);
			gt.offEmphasis = emphasisSim(
				state.e,
				emphasisFit(state.e, z),
				(await getLeagueContext(day)).autoFitMean,
			);
		}
	}
};

// ---- User actions ----

export const setOffEmphasis = async ({
	mode,
	e,
	acceptSuggestion,
}: {
	mode?: EmphasisMode;
	e?: Partial<Emphasis>;
	acceptSuggestion?: boolean;
}) => {
	const tid = g.get("userTid");
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return;
	}
	const cur = t.offEmphasis ?? defaultState(await coachEmphasis(tid));
	const next: OffEmphasisTeam = { ...cur };
	if (mode) {
		next.mode = mode;
		if (mode === "auto") {
			next.e = await coachEmphasis(tid);
			delete next.suggested;
		} else if (mode === "suggest") {
			next.suggested = await coachEmphasis(tid);
		} else {
			delete next.suggested;
		}
	}
	if (e) {
		next.e = clampEmphasis({ ...next.e, ...e });
		if (next.mode === "auto") {
			next.mode = "manual";
		}
	}
	if (acceptSuggestion && next.suggested) {
		next.e = next.suggested;
		delete next.suggested;
	}
	next.set = { season: g.get("season"), day: cur.set?.day ?? 0 };
	t.offEmphasis = next;
	await idb.cache.teams.put(t);
};

// ---- Pages ----

type PtLine = {
	key: string;
	name: string;
	freq: number;
	ppp: number;
	poss: number;
};

const profileOf = (rows: { adv?: number[] }[]): PtLine[] | undefined => {
	const prof = playTypeProfile(sumAdv(rows));
	return prof?.types.map((x) => ({
		key: x.key,
		name: x.name,
		freq: x.freq ?? 0,
		ppp: x.ppp ?? 0,
		poss: x.poss,
	}));
};

// This season's regular-season play-type mix of a team and of the league (Advanced Tracking Stats), undefined without them
export const playTypeMix = async (tid: number, season = g.get("season")) => {
	if (!featureOn("advStats")) {
		return undefined;
	}
	const players = await idb.cache.players.getAll();
	const teamRows: Player["stats"] = [];
	const leagueRows: Player["stats"] = [];
	for (const p of players) {
		for (const row of p.stats) {
			if (row.season === season && !row.playoffs && row.adv) {
				leagueRows.push(row);
				if (row.tid === tid) {
					teamRows.push(row);
				}
			}
		}
	}
	const team = profileOf(teamRows);
	const league = profileOf(leagueRows);
	if (!team || !league) {
		return undefined;
	}
	return { team, league };
};

const toPpp = (lines: PtLine[]): PlayTypePpp => {
	const out: PlayTypePpp = {};
	for (const l of lines) {
		(out as any)[l.key] = { freq: l.freq, ppp: l.ppp, poss: l.poss };
	}
	return out;
};

export const getOffEmphasisPage = async (tid: number) => {
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return undefined;
	}
	const state = t.offEmphasis ?? defaultState(await coachEmphasis(tid));
	const z = await teamStrengths(tid);
	const auto = await coachEmphasis(tid);
	const mix = await playTypeMix(tid);
	const rec = mix
		? emphasisRecommendation(toPpp(mix.team), toPpp(mix.league), state.e, z)
		: undefined;
	return {
		tid,
		mode: state.mode,
		e: state.e,
		suggested: state.suggested,
		auto,
		strengths: z,
		fit: emphasisFit(state.e, z),
		autoFit: emphasisFit(auto, z),
		coachSystem: await headCoachSystem(tid),
		mix,
		recommendation: rec?.text,
	};
};

// Staff Report line
export const offEmphasisRecommendation = async (tid: number) => {
	if (!offEmphasisOn()) {
		return undefined;
	}
	const page = await getOffEmphasisPage(tid);
	if (!page) {
		return undefined;
	}
	return {
		mode: page.mode,
		fit: page.fit,
		text: page.recommendation,
	};
};

export { NEUTRAL_EMPHASIS };
