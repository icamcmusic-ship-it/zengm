// Coaching systems (the coachSystems setting, basketball, needs the coaching staff). The pure parts (systems, fit, sim effects) are in
// common/coachSystems.ts. This file connects them to the league: profiles stored on coaches, the sim multipliers for each game day
// (applyCoachSystems), installation, adaptation, reputation, hot seat, coaching trees, system trends, AI hiring by fit, player scheme fit
// for mood/free agency/AI GMs, and the head coach's development philosophy.
//
// With the setting off nothing here runs (every entry point returns early), so the sim and the coaching market draw exactly the random numbers
// they did before.
import {
	analyticsMgmtBoost,
	analyticsRotationBias,
} from "../../../common/frontOffice.ts";
import {
	frontOfficeEnabled,
	getNewDeptLevelLastThree,
} from "../frontOffice/index.ts";
import { PHASE } from "../../../common/constants.ts";
import { COACH_FREE_AGENT, coachOvr } from "../../../common/staff.ts";
import {
	coachSimEffects,
	DEFENSE_SYSTEMS,
	deriveCoachProfile,
	fitToScore,
	INSTALL_START,
	normalizeCoachSims,
	OFFENSE_SYSTEMS,
	playerSchemeFit,
	rosterSchemeFit,
	seriesAdjustment,
	hashString,
	leagueRelativeFits,
	ROTATION_WEIGHTS,
	type CoachSim,
	type FitRatings,
	type SystemTrends,
} from "../../../common/coachSystems.ts";
import type {
	Coach,
	CoachProfile,
	CoachWithoutKey,
	DefenseSystem,
	OffenseSystem,
	Player,
} from "../../../common/types.ts";
import { nativeFeatureEnabled } from "../../../common/nativeFeatures.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local } from "../../util/index.ts";
import { winProb } from "../seasonOdds/simSeason.ts";
import teamOvr from "../team/ovr.ts";
import { getGmWeights } from "../gm/index.ts";
import { getVideoBoost } from "../staffDepth/coaching.ts";
import type { GmWeights } from "../../../common/gmPersonality.ts";

export const coachSystemsEnabled = () =>
	__SPORT === "basketball" &&
	!!g.get("coachingStaff") &&
	nativeFeatureEnabled("coachSystems", (key) => g.get(key as any));

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

// A coach's profile: stored, or derived deterministically (coaches from before the setting, or generated while it was off)
export const getCoachProfile = (c: CoachWithoutKey): CoachProfile =>
	c.profile ?? deriveCoachProfile(c);

// Store a profile on every coach that doesn't have one (migration, when the setting is on). No random draws
export const ensureProfiles = async () => {
	if (!coachSystemsEnabled()) {
		return;
	}
	for (const c of await idb.cache.coaches.getAll()) {
		if (!c.profile) {
			c.profile = deriveCoachProfile(c);
			await idb.cache.coaches.put(c);
		}
	}
};

// ---- trends: systems that won lately become more popular with new coaches ----

export const computeSystemTrends = async (
	season: number,
): Promise<SystemTrends> => {
	const off: Record<string, { n: number; pct: number }> = {};
	const def: Record<string, { n: number; pct: number }> = {};
	for (const c of await idb.cache.coaches.getAll()) {
		const profile = c.profile;
		if (!profile) {
			continue;
		}
		for (const row of c.stats) {
			if (row.role !== "head" || row.season < season - 2) {
				continue;
			}
			const gp = row.won + row.lost + row.tied + row.otl;
			if (gp === 0) {
				continue;
			}
			const pct = (row.won + 0.5 * row.tied) / gp + 0.03 * row.playoffRoundsWon;
			for (const [store, key] of [
				[off, row.off ?? profile.off],
				[def, row.def ?? profile.def],
			] as const) {
				store[key] ??= { n: 0, pct: 0 };
				store[key].n += 1;
				store[key].pct += pct;
			}
		}
	}
	const weight = (x: { n: number; pct: number } | undefined) =>
		x && x.n >= 2 ? clamp(Math.exp(4 * (x.pct / x.n - 0.52)), 0.7, 1.5) : 1;
	return {
		off: Object.fromEntries(OFFENSE_SYSTEMS.map((s) => [s, weight(off[s])])),
		def: Object.fromEntries(DEFENSE_SYSTEMS.map((s) => [s, weight(def[s])])),
	};
};

// For newly generated coaches (generateCoach)
export const profileForNewCoach = (c: CoachWithoutKey) =>
	coachSystemsEnabled()
		? deriveCoachProfile(c, local.coachSystemTrends)
		: undefined;

// ---- scheme fit ----

export const fitRatingsOf = (p: Pick<Player, "ratings">): FitRatings => {
	const r = p.ratings.at(-1) as any;
	return {
		hgt: r.hgt,
		stre: r.stre,
		spd: r.spd,
		jmp: r.jmp,
		endu: r.endu,
		ins: r.ins,
		dnk: r.dnk,
		ft: r.ft,
		fg: r.fg,
		tp: r.tp,
		oiq: r.oiq,
		diq: r.diq,
		drb: r.drb,
		pss: r.pss,
		reb: r.reb,
		pdef: r.pdef,
		idef: r.idef,
		wng: r.wng,
	};
};

const rosterOf = async (tid: number) => {
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	return players
		.filter((p) => p.injury.gamesRemaining === 0)
		.sort((a, b) => b.valueNoPot - a.valueNoPot);
};

// Every team's roster fit, relative to the league's other rosters (leagueRelativeFits). Cached until the next day of games, hire, trade
// window... (clearCoachSystemsCache, or a new key)
let fitsCache:
	| {
			key: string;
			time: number;
			fits: Map<number, ReturnType<typeof rosterSchemeFit>>;
	  }
	| undefined;

const getLeagueFits = async (key?: string) => {
	const fullKey = `${g.get("lid")}|${g.get("season")}|${g.get("phase")}|${key}`;
	// (without a key, for pages and the offseason: good for a few seconds, so a loop over teams computes it once)
	if (
		fitsCache &&
		fitsCache.key === fullKey &&
		(key !== undefined || Date.now() - fitsCache.time < 3000)
	) {
		return fitsCache.fits;
	}
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const raw = [];
	for (const t of teams) {
		raw.push(rosterSchemeFit((await rosterOf(t.tid)).map(fitRatingsOf)));
	}
	const rel = leagueRelativeFits(raw);
	const fits = new Map(teams.map((t, i) => [t.tid, rel[i]!]));
	fitsCache = { key: fullKey, time: Date.now(), fits };
	return fits;
};

// perf3: the fits the sim reads, worked out again for a team only when its rotation changes (its healthy top players by value, in
// order, and their ratings rows: a trade, a signing, a release, an injury or a return, a new order, a God Mode edit), and for every
// team once a week of games (days 0-6, 7-13, ... of the phase). A team's fit reads nothing else, so this gives the same fits as
// working them out every day (the sim benchmark's hashes match with all extras on)
let weeklyFits:
	| {
			week: string;
			sigs: Map<number, unknown[]>;
			raw: Map<number, ReturnType<typeof rosterSchemeFit>>;
			tids: string;
			rel: Map<number, ReturnType<typeof rosterSchemeFit>>;
	  }
	| undefined;
// (off: every day, as before; for the sim benchmark's comparison)
let weeklyFitsOn = true;
export const setWeeklyFits = (on: boolean) => {
	weeklyFitsOn = on;
	weeklyFits = undefined;
};
const getWeeklyFits = async (day: number) => {
	const week = `${g.get("lid")}|${g.get("season")}|${g.get("phase")}|${weeklyFitsOn ? Math.floor(day / 7) : `d${day}`}`;
	if (!weeklyFitsOn) {
		// (every team's fit worked out afresh)
		weeklyFits = undefined;
	}
	if (weeklyFits?.week !== week) {
		weeklyFits = {
			week,
			sigs: new Map(),
			raw: new Map(),
			tids: "",
			rel: new Map(),
		};
	}
	const w = weeklyFits;
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	let changed = false;
	for (const t of teams) {
		const roster = await rosterOf(t.tid);
		const sig = roster
			.slice(0, ROTATION_WEIGHTS.length)
			.map((p) => p.ratings.at(-1));
		const prev = w.sigs.get(t.tid);
		if (
			!prev ||
			prev.length !== sig.length ||
			prev.some((row, i) => row !== sig[i])
		) {
			w.sigs.set(t.tid, sig);
			w.raw.set(t.tid, rosterSchemeFit(roster.map(fitRatingsOf)));
			changed = true;
		}
	}
	const tids = teams.map((t) => t.tid).join(",");
	if (changed || w.tids !== tids) {
		w.tids = tids;
		const rel = leagueRelativeFits(teams.map((t) => w.raw.get(t.tid)!));
		w.rel = new Map(teams.map((t, i) => [t.tid, rel[i]!]));
	}
	return w.rel;
};

export const getRosterFit = async (tid: number, key?: string) => {
	const fits = await getLeagueFits(key);
	return (
		fits.get(tid) ?? rosterSchemeFit((await rosterOf(tid)).map(fitRatingsOf))
	);
};

/**
 * How well a player fits a team's head coach's systems, for mood, free agency and AI GMs. In standard deviations among rotation players (-2 bad ... 2 great); 0 with the
 * setting off or no head coach. score is the same as a 0-100 number (50 = typical).
 */
export const playerSystemFitForTeam = async (
	p: Pick<Player, "ratings">,
	tid: number,
) => {
	if (!coachSystemsEnabled() || tid < 0) {
		return { fit: 0, score: 50 };
	}
	const head = await getHeadCoach(tid);
	if (!head) {
		return { fit: 0, score: 50 };
	}
	return playerSystemFit(p, getCoachProfile(head));
};

export const playerSystemFit = (
	p: Pick<Player, "ratings">,
	profile: Pick<CoachProfile, "off" | "def">,
) => {
	const f = playerSchemeFit(fitRatingsOf(p));
	const fit = 0.6 * f.off[profile.off] + 0.4 * f.def[profile.def];
	return { fit, score: fitToScore(fit) };
};

const getHeadCoach = async (tid: number) => {
	const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
	return coaches.find((c) => c.role === "head");
};

// ---- installation ----

const contractStartSeason = () =>
	g.get("phase") > PHASE.PLAYOFFS ? g.get("season") + 1 : g.get("season");

// How far the coach's systems are installed with his team (0-1): a new system starts at INSTALL_START and is fully in after half a season
export const installProgress = async (c: Coach, profile: CoachProfile) => {
	const season = g.get("season");
	if (profile.since === undefined || season > profile.since) {
		return 1;
	}
	if (season < profile.since) {
		return INSTALL_START;
	}
	const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
		season,
		c.tid,
	]);
	let gp = ts ? ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0) : 0;
	if (c.hiredRecord && c.hiredRecord.season === season) {
		const h = c.hiredRecord;
		gp -= h.won + h.lost + h.tied + h.otl;
	}
	const games = Math.max(1, 0.5 * g.get("numGames"));
	return INSTALL_START + (1 - INSTALL_START) * Math.min(1, gp / games);
};

// ---- the sim ----

export type TeamCoachSystem = {
	tid: number;
	sim: CoachSim;
	profile: CoachProfile;
	install: number;
	offFit: number;
	defFit: number;
	cid: number;
	// his style's rotation dial (-1 tight ... 1 deep)
	rotation: number;
	// Front Office Budget: the analytics department's level (3-season average), undefined when off
	analyticsLevel?: number;
};

let leagueCache:
	| { key: string; teams: Map<number, TeamCoachSystem> }
	| undefined;

export const clearCoachSystemsCache = () => {
	leagueCache = undefined;
	fitsCache = undefined;
	weeklyFits = undefined;
};

// Every team's sim multipliers, normalized over the league (common/coachSystems.ts normalizeCoachSims). Cached for a day of games
export const getLeagueCoachSystems = async (day?: number) => {
	const key = `${g.get("lid")}|${g.get("season")}|${g.get("phase")}|${day}`;
	if (day !== undefined && leagueCache?.key === key) {
		return leagueCache.teams;
	}
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const weekly = day !== undefined ? await getWeeklyFits(day) : undefined;
	const rows: TeamCoachSystem[] = [];
	for (const t of teams) {
		const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", t.tid);
		const head = coaches.find((c) => c.role === "head");
		if (!head) {
			continue;
		}
		const profile = getCoachProfile(head);
		const fit = weekly?.get(t.tid) ?? (await getRosterFit(t.tid, `day${day}`));
		const install = await installProgress(head, profile);
		const offFit = fit.off[profile.off];
		const defFit = fit.def[profile.def];
		const analyticsLevel = frontOfficeEnabled()
			? await getNewDeptLevelLastThree("analytics", { tid: t.tid, t })
			: undefined;
		// Coaching Staff Depth: the video/analytics coordinator sharpens game management and series adjustments (centered over the league)
		const video = await getVideoBoost(t.tid);
		const baseProfile = video
			? {
					...profile,
					mgmt: clamp(profile.mgmt + video.mgmt, 0, 100),
					adapt: clamp(profile.adapt + video.adapt, 0, 100),
				}
			: profile;
		rows.push({
			tid: t.tid,
			cid: head.cid,
			rotation: head.style.rotation,
			profile: baseProfile,
			install,
			offFit,
			defFit,
			analyticsLevel,
			sim: coachSimEffects({
				// Front Office Budget: an analytics department sharpens the head coach's game management (the league is centered again
				// in normalizeCoachSims). Unchanged when off
				profile:
					analyticsLevel !== undefined
						? {
								...baseProfile,
								mgmt: clamp(
									baseProfile.mgmt + analyticsMgmtBoost(analyticsLevel),
									0,
									100,
								),
							}
						: baseProfile,
				head: head.ratings,
				offCoord: coaches.find((c) => c.role === "off")?.ratings,
				defCoord: coaches.find((c) => c.role === "def")?.ratings,
				install,
				offFit,
				defFit,
				style: head.style,
			}),
		});
	}
	const normalized = normalizeCoachSims(rows.map((r) => r.sim));
	const out = new Map<number, TeamCoachSystem>();
	for (const [i, row] of rows.entries()) {
		out.set(row.tid, { ...row, sim: normalized[i]! });
	}
	leagueCache = { key, teams: out };
	return out;
};

// Sentinel in pbpGame before the systems (common/pbpFlavor/story.ts parseCoachSystems)
export const PBP_COACH_SYSTEMS_MARKER = 9101;

/**
 * Give each team playing today its coach's sim multipliers (t.coachSim), the rotation hooks (rotationStyle, rest on back-to-backs, trust in
 * young players), playoff series adjustments, and the labels for the box score and play-by-play. Call after loadTeams (and
 * setPbpGameContext). Does nothing with the setting off.
 */
export const applyCoachSystems = async (
	schedule: readonly { homeTid: number; awayTid: number; day?: number }[],
	teams: Record<number, any>,
) => {
	if (!coachSystemsEnabled() || schedule.length === 0) {
		return;
	}
	const league = await getLeagueCoachSystems(schedule[0]?.day);
	const playoffs = g.get("phase") === PHASE.PLAYOFFS;
	const series = playoffs
		? await idb.cache.playoffSeries.get(g.get("season"))
		: undefined;
	const rotations = nativeFeatureEnabled("realisticRotations", (key) =>
		g.get(key as any),
	);

	for (const matchup of schedule) {
		if (matchup.homeTid < 0 || matchup.awayTid < 0) {
			continue;
		}
		const pair = [matchup.homeTid, matchup.awayTid] as const;
		const sims: (CoachSim | undefined)[] = [];
		for (const [i, tid] of pair.entries()) {
			const row = league.get(tid);
			const t = teams[tid];
			if (!row || !t) {
				sims.push(undefined);
				continue;
			}
			let sim = row.sim;
			const oppRow = league.get(pair[1 - i]!);
			if (series && oppRow) {
				const s = series.series[series.currentRound]?.find(
					(s) =>
						(s.home.tid === tid && s.away?.tid === pair[1 - i]) ||
						(s.away?.tid === tid && s.home.tid === pair[1 - i]),
				);
				if (s && s.away) {
					const own = s.home.tid === tid ? s.home : s.away;
					const opp = s.home.tid === tid ? s.away : s.home;
					sim = seriesAdjustment(
						sim,
						oppRow.sim,
						row.profile.adapt,
						(opp.won ?? 0) - (own.won ?? 0),
					);
				}
			}
			sims.push(sim);
		}
		for (const [i, tid] of pair.entries()) {
			const sim = sims[i];
			const row = league.get(tid);
			const t = teams[tid];
			if (!sim || !row || !t) {
				continue;
			}
			// (a copy, since a team can only play once a day but the cache is shared)
			t.coachSim = { ...sim };
			if (rotations) {
				const profile = row.profile;
				t.rotationStyle = clamp(
					0.6 * row.rotation + (playoffs ? -0.35 : 0),
					-1,
					1,
				);
				if (t.backToBack) {
					t.backToBackCut = 2 * (1 + 0.75 * profile.rest);
				}
				if (profile.youth !== 0) {
					// Front Office Budget: analytics tempers the coach's age bias in the minutes plan (a weak department amplifies it)
					const youth =
						row.analyticsLevel !== undefined
							? profile.youth * analyticsRotationBias(row.analyticsLevel)
							: profile.youth;
					for (const p of t.player) {
						const age = p.age;
						if (age <= 23) {
							p.coachMinutesMult = 1 + 0.12 * youth;
						} else if (age >= 31) {
							p.coachMinutesMult = 1 - 0.08 * youth;
						}
					}
				}
			}
		}
		// Labels for the play-by-play (stored with the game)
		const home = teams[matchup.homeTid];
		if (home && Array.isArray(home.pbpGame) && sims[0] && sims[1]) {
			home.pbpGame = [
				...home.pbpGame,
				PBP_COACH_SYSTEMS_MARKER,
				OFFENSE_SYSTEMS.indexOf(sims[0].off),
				DEFENSE_SYSTEMS.indexOf(sims[0].def),
				OFFENSE_SYSTEMS.indexOf(sims[1].off),
				DEFENSE_SYSTEMS.indexOf(sims[1].def),
			];
		}
	}
};

// ---- reputation, hot seat ----

const winPct = (r: {
	won: number;
	lost: number;
	tied: number;
	otl: number;
}) => {
	const gp = r.won + r.lost + r.tied + r.otl;
	return gp > 0 ? (r.won + 0.5 * r.tied) / gp : 0.5;
};

/**
 * Reputation, 0-100 (50 = an ordinary coach with no track record): results relative to expectations, playoff runs, Coach of the Year awards
 * and the development of young players, recent seasons counting most.
 */
export const coachReputation = (c: CoachWithoutKey) => {
	let w = 0;
	let wins = 0;
	let playoffs = 0;
	let dev = 0;
	let devW = 0;
	const season = g.get("season");
	for (const row of c.stats) {
		const gp = row.won + row.lost + row.tied + row.otl;
		const age = Math.max(0, season - row.season);
		const weight = 0.8 ** age;
		if (row.dev !== undefined) {
			dev += weight * row.dev;
			devW += weight;
		}
		if (gp === 0) {
			continue;
		}
		const head = row.role === "head" ? 1 : 0.4;
		w += weight * head;
		wins +=
			weight *
			head *
			(winPct(row) -
				0.5 +
				0.5 * (winPct(row) - (row.expectedPct ?? winPct(row))));
		playoffs += weight * head * Math.max(0, row.playoffRoundsWon + 1);
	}
	const coy = c.awards.filter((a) => a.type === "Coach of the Year").length;
	const experience = Math.min(8, c.stats.length);
	const rep =
		42 +
		experience +
		(w > 0 ? (110 * wins) / w + (7 * playoffs) / w : 0) +
		5 * Math.min(3, coy) +
		(devW > 0 ? (2.5 * dev) / devW : 0) +
		(c.ratings.off + c.ratings.def + c.ratings.mot - 150) / 15;
	return Math.round(clamp(rep, 0, 100));
};

export const reputationLabel = (rep: number) =>
	rep >= 80
		? "Elite"
		: rep >= 65
			? "Highly regarded"
			: rep >= 50
				? "Respected"
				: rep >= 35
					? "Unproven"
					: "Struggling";

/**
 * How hot a head coach's seat is, 0 (safe) ... 1 (about to be fired): his team's results against the preseason expectation (the Season Odds
 * rating model), recent seasons counting most, with some patience for a high reputation. For the AI's firing decisions, the coach page and
 * the newspaper.
 */
export const hotSeat = (
	c: CoachWithoutKey,
	extra?: { pct: number; expectedPct?: number },
) => {
	const rows = c.stats
		.filter((r) => r.tid === c.tid && r.role === "head")
		.slice(-3)
		.map(
			(r): { pct: number; expectedPct?: number; playoffRoundsWon: number } => ({
				pct: winPct(r),
				expectedPct: r.expectedPct,
				playoffRoundsWon: r.playoffRoundsWon,
			}),
		);
	if (extra) {
		rows.push({ ...extra, playoffRoundsWon: -1 });
	}
	if (rows.length === 0) {
		return 0;
	}
	const weights = [0.15, 0.3, 0.55].slice(-rows.length);
	let wSum = 0;
	let score = 0;
	for (const [i, r] of rows.entries()) {
		const w = weights[i]!;
		const exp = r.expectedPct ?? 0.5;
		score +=
			w *
			(r.pct -
				exp +
				0.03 * Math.max(0, r.playoffRoundsWon) -
				(exp >= 0.58 && r.playoffRoundsWon < 0 ? 0.05 : 0));
		wSum += w;
	}
	score /= wSum;
	const rep = coachReputation(c);
	const heat = 1 / (1 + Math.exp((score + 0.06 + 0.002 * (rep - 50)) / 0.04));
	return Math.round(heat * 100) / 100;
};

// The hot seat including the season in progress (10+ games in)
export const hotSeatNow = async (c: CoachWithoutKey) => {
	const season = g.get("season");
	const phase = g.get("phase");
	if (
		c.tid >= 0 &&
		phase >= PHASE.REGULAR_SEASON &&
		phase <= PHASE.PLAYOFFS &&
		!c.stats.some((r) => r.season === season && r.tid === c.tid)
	) {
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			season,
			c.tid,
		]);
		if (ts && ts.won + ts.lost >= 10) {
			const expect = c.profile?.expect;
			return hotSeat(c, {
				pct: winPct({
					won: ts.won,
					lost: ts.lost,
					tied: ts.tied ?? 0,
					otl: ts.otl ?? 0,
				}),
				expectedPct:
					expect?.season === season && expect.tid === c.tid
						? expect.pct
						: undefined,
			});
		}
	}
	return hotSeat(c);
};

export const hotSeatLabel = (heat: number) =>
	heat >= 0.75
		? "Red hot"
		: heat >= 0.5
			? "Warm"
			: heat >= 0.25
				? "Some pressure"
				: "Safe";

// Firing probability from the hot seat (replaces the record-based rules when the setting is on). Similar number of firings per season
export const hotSeatFireProb = (c: Coach, tenure: number) => {
	if (tenure < 1) {
		return 0;
	}
	const heat = hotSeat(c);
	return heat > 0.5 ? Math.min(0.75, 1.5 * (heat - 0.5)) : 0;
};

// Preseason expectation for every team (from team ovr, like Season Odds), stored on head coaches for the hot seat
export const setExpectations = async () => {
	if (!coachSystemsEnabled()) {
		return;
	}
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const ovrs = new Map<number, number>();
	for (const t of teams) {
		const players = await idb.cache.players.indexGetAll("playersByTid", t.tid);
		ovrs.set(
			t.tid,
			teamOvr(
				players.map((p) => ({
					injury: p.injury,
					value: p.value,
					ratings: {
						ovr: p.ratings.at(-1)!.ovr,
						ovrs: p.ratings.at(-1)!.ovrs,
						pos: p.ratings.at(-1)!.pos,
					},
				})),
			),
		);
	}
	const season = g.get("season");
	for (const t of teams) {
		let sum = 0;
		for (const o of teams) {
			if (o.tid !== t.tid) {
				sum += winProb(ovrs.get(t.tid)! - ovrs.get(o.tid)!);
			}
		}
		const pct = teams.length > 1 ? sum / (teams.length - 1) : 0.5;
		const head = await getHeadCoach(t.tid);
		if (head) {
			head.profile = getCoachProfile(head);
			head.profile.expect = { season, tid: t.tid, pct };
			await idb.cache.coaches.put(head);
		}
	}
};

// ---- the offseason: annotate the season, adapt systems ----

// Average ovr change of each team's players 24 and under this season (the progs at the start of the season), relative to the league's
const youngDevelopment = async (season: number) => {
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const byTid = new Map<number, number[]>();
	let all = 0;
	let n = 0;
	for (const p of players) {
		if (season - p.born.year > 24) {
			continue;
		}
		const cur = p.ratings.findLast((r) => r.season === season);
		const prev = p.ratings.findLast((r) => r.season === season - 1);
		if (!cur || !prev) {
			continue;
		}
		const d = cur.ovr - prev.ovr;
		const list = byTid.get(p.tid) ?? [];
		list.push(d);
		byTid.set(p.tid, list);
		all += d;
		n += 1;
	}
	const mean = n > 0 ? all / n : 0;
	const out = new Map<number, number>();
	for (const [tid, list] of byTid) {
		out.set(tid, list.reduce((a, b) => a + b, 0) / list.length - mean);
	}
	return out;
};

// After recordSeason in the offseason: expectation, development and systems on the season rows
export const annotateSeason = async () => {
	if (!coachSystemsEnabled()) {
		return;
	}
	const season = g.get("season");
	const dev = await youngDevelopment(season);
	for (const c of await idb.cache.coaches.getAll()) {
		const row = c.stats.find((r) => r.season === season && r.tid === c.tid);
		if (!row || c.tid < 0) {
			continue;
		}
		const profile = getCoachProfile(c);
		if (c.role === "head") {
			row.off = profile.off;
			row.def = profile.def;
			if (profile.expect?.season === season && profile.expect.tid === c.tid) {
				row.expectedPct = Math.round(profile.expect.pct * 1000) / 1000;
			}
		}
		if (c.role === "head" || c.role === "dev") {
			const d = dev.get(c.tid);
			if (d !== undefined) {
				row.dev = Math.round(d * 10) / 10;
			}
		}
		c.profile = profile;
		await idb.cache.coaches.put(c);
	}
	// (in local, which is reset with the league: a module variable here outlived the league, so the first coaches of the next league
	// opened or created in the same session got the old league's trends)
	local.coachSystemTrends = await computeSystemTrends(season);
};

// Head coaches who aren't stubborn move toward the systems their roster fits (takes effect next season, with a new installation)
export const adaptSystems = async () => {
	if (!coachSystemsEnabled()) {
		return;
	}
	const season = g.get("season");
	for (const c of await idb.cache.coaches.getAll()) {
		if (c.tid < 0 || c.role !== "head") {
			continue;
		}
		const profile = getCoachProfile(c);
		if (profile.adapt < 25) {
			continue;
		}
		const fit = await getRosterFit(c.tid);
		const prob = (profile.adapt / 100) * 0.5;
		const bestOff = OFFENSE_SYSTEMS.reduce((a, b) =>
			fit.off[b] > fit.off[a] ? b : a,
		);
		const bestDef = DEFENSE_SYSTEMS.reduce((a, b) =>
			fit.def[b] > fit.def[a] ? b : a,
		);
		let changed = false;
		if (fit.off[bestOff] - fit.off[profile.off] > 0.8 && Math.random() < prob) {
			profile.off = bestOff;
			changed = true;
		}
		if (fit.def[bestDef] - fit.def[profile.def] > 0.8 && Math.random() < prob) {
			profile.def = bestDef;
			changed = true;
		}
		if (changed) {
			profile.since = season + 1;
		}
		c.profile = profile;
		await idb.cache.coaches.put(c);
	}
};

// ---- coaching trees ----

/**
 * When a coach becomes a head coach: his mentor is the head coach he last worked under as an assistant, and he brings part of that system
 * with him (an offensive coordinator his offense, a defensive coordinator his defense, a development coach his philosophy). Also starts the
 * installation of his systems with the new team.
 */
export const onHeadCoachHired = async (c: Coach) => {
	if (!coachSystemsEnabled()) {
		return;
	}
	const profile = getCoachProfile(c);
	const phase = g.get("phase");
	profile.since =
		phase >= PHASE.REGULAR_SEASON && phase <= PHASE.PLAYOFFS
			? g.get("season")
			: contractStartSeason();
	const asAssistant = c.stats.findLast((r) => r.role !== "head");
	if (asAssistant && !profile.mentor) {
		const all = await idb.cache.coaches.getAll();
		const mentor = all.find(
			(m) =>
				m.cid !== c.cid &&
				m.stats.some(
					(r) =>
						r.season === asAssistant.season &&
						r.tid === asAssistant.tid &&
						r.role === "head",
				),
		);
		if (mentor) {
			const mp = getCoachProfile(mentor);
			profile.mentor = {
				cid: mentor.cid,
				name: `${mentor.firstName} ${mentor.lastName}`,
			};
			const random = makeSeededRandom(
				hashString(`tree|${c.cid}|${mentor.cid}`),
			);
			if (asAssistant.role === "off" && random() < 0.65) {
				profile.off = mp.off;
			} else if (asAssistant.role === "def" && random() < 0.65) {
				profile.def = mp.def;
			} else if (random() < 0.4) {
				profile.off = mp.off;
			}
			profile.philosophy =
				Math.round(
					100 *
						(asAssistant.role === "dev"
							? 0.5 * profile.philosophy + 0.5 * mp.philosophy
							: 0.75 * profile.philosophy + 0.25 * mp.philosophy),
				) / 100;
		}
	}
	c.profile = profile;
	await idb.cache.coaches.put(c);
};

// The coaching tree: his mentor's line upward and everyone who worked under him and became a head coach
export const coachingTree = async (cid: number) => {
	const all = await idb.cache.coaches.getAll();
	const byCid = new Map(all.map((c) => [c.cid, c]));
	const up: { cid: number; name: string }[] = [];
	let cur = byCid.get(cid);
	const seen = new Set<number>([cid]);
	while (cur?.profile?.mentor && !seen.has(cur.profile.mentor.cid)) {
		up.push(cur.profile.mentor);
		seen.add(cur.profile.mentor.cid);
		cur = byCid.get(cur.profile.mentor.cid);
	}
	const down = all
		.filter((c) => c.profile?.mentor?.cid === cid)
		.map((c) => ({
			cid: c.cid,
			name: `${c.firstName} ${c.lastName}`,
			tid: c.tid,
		}));
	return { up, down };
};

// ---- AI hiring by fit ----

export type HiringContext = {
	tid: number;
	strategy: "contending" | "rebuilding";
	fit: ReturnType<typeof rosterSchemeFit>;
	numYoung: number;
};

export const getTeamHiringContext = async (
	tid: number,
): Promise<HiringContext> => {
	const t = await idb.cache.teams.get(tid);
	const roster = await rosterOf(tid);
	const season = g.get("season");
	return {
		tid,
		strategy: t?.strategy ?? "contending",
		fit: await getRosterFit(tid),
		numYoung: roster.slice(0, 10).filter((p) => season - p.born.year <= 24)
			.length,
	};
};

/**
 * Bonus (in coach ovr points) an AI team gives a head coach candidate: systems that fit its roster, a development philosophy for a
 * rebuilding team or a young roster, game management and a win-now approach for a contender, and reputation. With AI GM personalities on,
 * the GM's leanings scale it (gm: getGmWeights): analytics GMs weigh scheme fit more, patient GMs development coaches, win-now GMs game
 * managers. Used by the coaching market (fillVacancies) for AI teams.
 */
export const headCoachFitBonus = (
	c: CoachWithoutKey,
	ctx: HiringContext,
	gm?: GmWeights,
) => {
	const profile = getCoachProfile(c);
	const fit = 0.6 * ctx.fit.off[profile.off] + 0.4 * ctx.fit.def[profile.def];
	const rebuilding = ctx.strategy === "rebuilding" || ctx.numYoung >= 5;
	const analytics = gm?.traits.analytics ?? 0;
	const patience = gm?.traits.patience ?? 0;
	return (
		3 * (1 + 0.5 * analytics) * fit +
		(rebuilding
			? 4 * profile.philosophy + 2 * profile.youth + 0.04 * (c.ratings.dev - 50)
			: -2.5 * profile.philosophy + 0.08 * (profile.mgmt - 50)) +
		2.5 * patience * profile.philosophy +
		0.05 * Math.max(0, -patience) * (profile.mgmt - 50) +
		0.08 * (coachReputation(c) - 50)
	);
};

// Candidates for a team's head coaching job, best first (coach ovr plus headCoachFitBonus). For the AI GM code
export const rankHeadCoachCandidates = async (
	tid: number,
	candidates?: Coach[],
) => {
	const ctx = await getTeamHiringContext(tid);
	const gm = await getGmWeights(tid);
	const list =
		candidates ??
		(await idb.cache.coaches.getAll()).filter(
			(c) => c.tid === COACH_FREE_AGENT,
		);
	return list
		.map((c) => ({
			c,
			score: coachOvr(c.ratings, "head") + headCoachFitBonus(c, ctx, gm),
			bonus: headCoachFitBonus(c, ctx, gm),
		}))
		.sort((a, b) => b.score - a.score);
};

// ---- development philosophy ----

// Coaching level change (budget level units, 1-100 scale) for a player's progs from his head coach's philosophy: development coaches help
// young players and pay less attention to veterans, win-now coaches the other way around. Centered over the league's coaches
export const philosophyLevelDelta = (profile: CoachProfile, age: number) => {
	const ph = profile.philosophy;
	if (age <= 23) {
		return 8 * ph;
	}
	if (age >= 30) {
		return -5 * ph;
	}
	return 0;
};

export const getHeadProfiles = async () => {
	const out = new Map<number, CoachProfile>();
	if (!coachSystemsEnabled()) {
		return out;
	}
	for (const c of await idb.cache.coaches.getAll()) {
		if (c.tid >= 0 && c.role === "head") {
			out.set(c.tid, getCoachProfile(c));
		}
	}
	return out;
};

// ---- mood ----

/**
 * The "Coach & system" mood component for a player on or considering team tid: how he fits the head coach's systems, the coach's personality
 * (players' coaches are liked, disciplinarians rub big egos the wrong way) and reputation. Small, bounded to +-1.5.
 */
export const coachMood = async (
	p: Pick<Player, "ratings">,
	tid: number,
	ego?: number,
) => {
	if (!coachSystemsEnabled() || tid < 0) {
		return 0;
	}
	const head = await getHeadCoach(tid);
	if (!head) {
		return 0;
	}
	const profile = getCoachProfile(head);
	const { fit } = playerSystemFit(p, profile);
	let x = 0.35 * fit + 0.35 * profile.personality;
	if (ego !== undefined && profile.personality < 0) {
		// (ego 0-100; big egos and disciplinarians)
		x += 0.6 * profile.personality * clamp((ego - 50) / 30, 0, 1);
	}
	x += (coachReputation(head) - 50) / 60;
	return helpers.bound(x, -1.5, 1.5);
};

// ---- for the UI and other features ----

export const getTeamCoachSystem = async (tid: number) => {
	if (!coachSystemsEnabled()) {
		return;
	}
	const head = await getHeadCoach(tid);
	if (!head) {
		return;
	}
	const profile = getCoachProfile(head);
	const fit = await getRosterFit(tid);
	const install = await installProgress(head, profile);
	const sortedOff = OFFENSE_SYSTEMS.toSorted((a, b) => fit.off[b] - fit.off[a]);
	const sortedDef = DEFENSE_SYSTEMS.toSorted((a, b) => fit.def[b] - fit.def[a]);
	return {
		cid: head.cid,
		name: `${head.firstName} ${head.lastName}`,
		profile,
		install,
		offFit: fitToScore(fit.off[profile.off]),
		defFit: fitToScore(fit.def[profile.def]),
		fit: fitToScore(0.6 * fit.off[profile.off] + 0.4 * fit.def[profile.def]),
		bestOff: sortedOff[0] as OffenseSystem,
		bestDef: sortedDef[0] as DefenseSystem,
		reputation: coachReputation(head),
		hotSeat: hotSeat(head),
	};
};
