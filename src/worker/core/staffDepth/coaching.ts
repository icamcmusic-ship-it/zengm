// Coaching Staff Depth (featureCoachingDepth, needs Coaching Staff): the three extra jobs' effects, development plans and the Development
// Report. Nothing here draws from the game's random stream (plans use seeded streams), and nothing runs while the setting is off.
import {
	ALL_COACH_ROLES,
	COACH_ROLES,
	VACANT_RATING,
	depthRatingsFor,
} from "../../../common/staff.ts";
import {
	conditioningDeltas,
	conditioningInjuryFactor,
	depthZ,
	shootingDeltas,
	VIDEO_ADAPT_PER_Z,
	VIDEO_MGMT_PER_Z,
} from "../../../common/staffDepth/coaching.ts";
import {
	chooseFocus,
	FOCUSES,
	focusLevel,
	focusSubNames,
	planRatingDeltas,
	planTiltAmount,
} from "../../../common/staffDepth/devPlans.ts";
import type {
	DevReportRow,
	FocusKey,
	PlanSource,
	StaffDepthTeam,
} from "../../../common/staffDepth/types.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import type { TraitDevelopment } from "../../../common/playerTraits/development.ts";
import type {
	Coach,
	CoachRole,
	CoachWithoutKey,
	Player,
} from "../../../common/types.ts";
import { SUB_INDEX } from "../../../common/subRatings.ts";
import { idb } from "../../db/index.ts";
import { g, local } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { subRatingsOn, tiltRowSubs } from "../player/subRatings.ts";
import { ovrRaw } from "../player/ovr.basketball.ts";
import { ballSecurityBase } from "../../../common/expandedRatings.ts";
import { OVR_COEFS } from "../../../common/staffDepth/devPlans.ts";

// A rating change as development makes it: the expanded ratings follow their stock rating (pdef/idef diq, oreb/dreb reb, csh/dsh half of
// fg/tp each, bsc its base from drb, pss and oiq)
const withChange = (r: Record<string, any>, key: string, d: number) => {
	const out = { ...r, [key]: r[key] + d };
	if (key === "diq" && typeof r.pdef === "number") {
		out.pdef = r.pdef + d;
		out.idef = r.idef + d;
	} else if (key === "reb" && typeof r.oreb === "number") {
		out.oreb = r.oreb + d;
		out.dreb = r.dreb + d;
	} else if ((key === "fg" || key === "tp") && typeof r.csh === "number") {
		out.csh = r.csh + d / 2;
		out.dsh = r.dsh + d / 2;
	}
	if (
		typeof r.bsc === "number" &&
		(key === "drb" || key === "pss" || key === "oiq")
	) {
		out.bsc = r.bsc + ballSecurityBase(out) - ballSecurityBase(r);
	}
	return out;
};

// The league's ovr formula's weights at his ratings (it is linear before the fudge factor)
export const ovrGradient = (r: Record<string, any>) => {
	const base = ovrRaw(r as any);
	const out: Record<string, number> = {};
	for (const key of Object.keys(OVR_COEFS)) {
		if (typeof r[key] === "number") {
			out[key] = ovrRaw(withChange(r, key, 1) as any) - base;
		}
	}
	return out;
};

export const coachingDepthOn = () =>
	__SPORT === "basketball" &&
	!!g.get("coachingStaff") &&
	featureOn("coachingDepth");

// Coaching careers (new coaches start as assistants, promotions, coaching trees) also run in college leagues, for the coaching carousel;
// the extra jobs and development plans don't (the switch is off in college leagues, so this reads it directly)
export const coachingCareersOn = () =>
	__SPORT === "basketball" &&
	!!g.get("coachingStaff") &&
	(featureOn("coachingDepth") ||
		(g.get("leagueType") === "college" &&
			g.get("featureCoachingDepth" as any) === true));

// The staff jobs that exist in this league
export const activeCoachRoles = (): CoachRole[] =>
	coachingDepthOn() ? ALL_COACH_ROLES : COACH_ROLES;

// Ratings of the three extra jobs for a coach who has none yet (stable, no random draws)
export const ensureDepthRatings = (c: CoachWithoutKey) => {
	if (
		c.ratings.sht !== undefined &&
		c.ratings.cnd !== undefined &&
		c.ratings.vid !== undefined
	) {
		return false;
	}
	const d = depthRatingsFor(c);
	c.ratings.sht = d.sht;
	c.ratings.cnd = d.cnd;
	c.ratings.vid = d.vid;
	return true;
};

export const defaultStaffDepthState = (): StaffDepthTeam => ({
	priority: "auto",
	delegation: {
		scouting: "auto",
		development: "auto",
		hiring: "auto",
		board: "auto",
	},
});

export const stateOf = (t: { staffDepth?: StaffDepthTeam }): StaffDepthTeam => {
	const d = defaultStaffDepthState();
	return {
		...d,
		...t.staffDepth,
		delegation: { ...d.delegation, ...t.staffDepth?.delegation },
	};
};

export const userControls = (tid: number) =>
	g.get("userTids").includes(tid) &&
	!local.autoPlayUntil &&
	!g.get("spectator");

export type DepthTeam = {
	tid: number;
	devRating: number;
	shoot: number;
	sc: number;
	video: number;
	shootZ: number;
	scZ: number;
	videoZ: number;
};

let depthCache: { key: string; teams: Map<number, DepthTeam> } | undefined;

export const clearDepthCache = () => {
	depthCache = undefined;
};

// Every team's extra staff against the league average (z centered over the league)
export const getDepthTeams = async () => {
	const key = `${g.get("lid")}|${g.get("season")}|${g.get("phase")}`;
	if (depthCache?.key === key) {
		return depthCache.teams;
	}
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const coaches = (await idb.cache.coaches.getAll()).filter((c) => c.tid >= 0);
	const rows = teams.map((t) => {
		const of = (role: CoachRole) =>
			coaches.find((c) => c.tid === t.tid && c.role === role);
		const shoot = of("shoot");
		const sc = of("sc");
		const video = of("video");
		const dev = of("dev");
		return {
			tid: t.tid,
			devRating: dev?.ratings.dev ?? VACANT_RATING,
			shoot: shoot
				? (shoot.ratings.sht ?? depthRatingsFor(shoot).sht)
				: VACANT_RATING,
			sc: sc ? (sc.ratings.cnd ?? depthRatingsFor(sc).cnd) : VACANT_RATING,
			video: video
				? (video.ratings.vid ?? depthRatingsFor(video).vid)
				: VACANT_RATING,
		};
	});
	const mean = (key: "shoot" | "sc" | "video") =>
		rows.length > 0 ? rows.reduce((a, r) => a + r[key], 0) / rows.length : 50;
	const zs = (key: "shoot" | "sc" | "video") => {
		const m = mean(key);
		const z = rows.map((r) => depthZ(r[key], m));
		const zm = z.length > 0 ? z.reduce((a, b) => a + b, 0) / z.length : 0;
		return z.map((x) => x - zm);
	};
	const shootZ = zs("shoot");
	const scZ = zs("sc");
	const videoZ = zs("video");
	const out = new Map<number, DepthTeam>();
	rows.forEach((r, i) => {
		out.set(r.tid, {
			...r,
			shootZ: shootZ[i]!,
			scZ: scZ[i]!,
			videoZ: videoZ[i]!,
		});
	});
	depthCache = { key, teams: out };
	return out;
};

// Strength & conditioning: the in-game injury rate factor of a team's players (1 when off)
export const getConditioningInjuryFactor = async (tid: number) => {
	if (!coachingDepthOn()) {
		return 1;
	}
	const row = (await getDepthTeams()).get(tid);
	return row ? conditioningInjuryFactor(row.scZ) : 1;
};

// Video/analytics coordinator: boosts of the head coach's game management and series adjustments (Coaching Systems inputs)
export const getVideoBoost = async (tid: number) => {
	if (!coachingDepthOn()) {
		return undefined;
	}
	const row = (await getDepthTeams()).get(tid);
	if (!row) {
		return undefined;
	}
	return {
		mgmt: VIDEO_MGMT_PER_Z * row.videoZ,
		adapt: VIDEO_ADAPT_PER_Z * row.videoZ,
	};
};

/**
 * A plan's shift of one season of development: the rating deltas (ovr-neutral with the league's own ovr formula, the tilt's ovr change
 * paid for too) and the sub-rating tilt. Pure given the player's latest ratings row.
 */
export const planDevelopment = (
	p: Pick<Player, "ratings" | "subP">,
	focus: FocusKey,
	age: number,
	devRating: number,
	subsOn: boolean,
) => {
	const tilt =
		subsOn && p.subP
			? { focus, amount: planTiltAmount(age, devRating) }
			: undefined;
	const r = p.ratings.at(-1) as any;
	let tiltGain = 0;
	if (tilt) {
		const copy = { ...r, sub: Array.isArray(r.sub) ? [...r.sub] : r.sub };
		tiltRowSubs(p as any, copy, tilt.focus, tilt.amount);
		tiltGain = ovrRaw(copy) - ovrRaw(r);
	}
	return {
		ratingDelta: planRatingDeltas(
			focus,
			age,
			devRating,
			ovrGradient(r),
			tiltGain,
		),
		subTilt: tilt,
	};
};

/**
 * Ratings are whole numbers and development floors them (limitRating), so a fractional shift would be biased (a -0.1 on a rating that
 * didn't change takes a whole point). Each delta becomes a whole number with the right expectation: floor(d + u), u uniform from a seeded
 * stream per player and season (not the game's random numbers).
 */
export const ditherDeltas = (deltas: Record<string, number>, seed: string) => {
	const rng = new Rng(`devDither|${seed}`);
	const out: Record<string, number> = {};
	for (const key of Object.keys(deltas).sort()) {
		const v = Math.floor(deltas[key]! + rng.random());
		if (v !== 0) {
			out[key] = v;
		}
	}
	return out;
};

const hashOf = (pid: number, season: number) =>
	new Rng(`devPlan|${pid}|${season}`).random();

// The latest ratings row the staff plans from (his true ratings: they work with him every day)
const planRatings = (p: Pick<Player, "ratings">) => p.ratings.at(-1) as any;

export const staffFocusFor = (
	p: Pick<Player, "pid" | "ratings" | "born">,
	season: number,
	teamPriority?: FocusKey,
) => {
	const r = planRatings(p);
	return chooseFocus({
		ratings: r,
		pos: r.pos ?? "F",
		age: season - p.born.year,
		teamPriority,
		hash: hashOf(p.pid, season),
	});
};

/**
 * The plan of one player for a season's development, or undefined (Manual delegation and no override, or a free agent/prospect).
 * User's team: his override, else by delegation (Auto: the staff with the team priority; Suggest: the approved plans, else last season's
 * focus; Manual: none). AI teams: the staff's.
 */
export const planFor = (
	p: Pick<Player, "pid" | "ratings" | "born" | "tid" | "devPlan">,
	season: number,
	state: StaffDepthTeam | undefined,
): { f: FocusKey; src: PlanSource } | undefined => {
	if (p.tid < 0) {
		return undefined;
	}
	if (!state) {
		return { f: staffFocusFor(p, season), src: "staff" };
	}
	const override = state.devOverrides?.[p.pid];
	if (override) {
		return { f: override, src: "user" };
	}
	const level = state.delegation.development;
	if (level === "manual") {
		return undefined;
	}
	if (level === "suggest") {
		const accepted =
			state.devAccepted?.season === season
				? state.devAccepted.plans[p.pid]
				: undefined;
		if (accepted) {
			return { f: accepted, src: "staff" };
		}
		return p.devPlan && p.devPlan.s === season - 1
			? { f: p.devPlan.f, src: p.devPlan.src }
			: undefined;
	}
	return {
		f: staffFocusFor(p, season, state.devPriority),
		src: state.devPriority ? "team" : "staff",
	};
};

const mergeDev = (
	a: TraitDevelopment | undefined,
	b: Pick<TraitDevelopment, "ratingDelta" | "subTilt">,
): TraitDevelopment => ({
	baseChangeDelta: a?.baseChangeDelta ?? 0,
	dropScale: a?.dropScale ?? 1,
	ratingDelta: b.ratingDelta,
	subTilt: b.subTilt,
});

const reportRowBefore = (p: Player, focus: FocusKey) => {
	const r = p.ratings.at(-1) as any;
	return {
		focus: focusLevel(r, focus),
		ovr: r.ovr as number,
		subs: focusSubNames(focus).map(({ key, name }) => ({
			key,
			name,
			before: (Array.isArray(r.sub) ? r.sub[SUB_INDEX[key]!] : undefined) as
				| number
				| undefined,
		})),
	};
};

/**
 * The preseason's development (phase/newPhasePreseason): every rostered player's plan and the shooting coach and strength & conditioning
 * shifts, as extra fields of his trait development (same random numbers as without them). undefined when the setting is off.
 */
export const prepareDevelopment = async (newSeason: number) => {
	if (!coachingDepthOn()) {
		return undefined;
	}
	const teams = await getDepthTeams();
	const userTids = g.get("userTids");
	const states = new Map<number, StaffDepthTeam>();
	for (const tid of userTids) {
		const t = await idb.cache.teams.get(tid);
		if (t && userControls(tid)) {
			states.set(tid, stateOf(t));
		}
	}
	const subsOn = subRatingsOn();
	const report = new Map<
		number,
		{
			before: ReturnType<typeof reportRowBefore>;
			focus: FocusKey;
			src: PlanSource;
		}
	>();

	return {
		// Call right before player.develop, after the new ratings row was added
		devFor: (p: Player, traitDev: TraitDevelopment | undefined) => {
			if (p.tid < 0) {
				return traitDev;
			}
			const dt = teams.get(p.tid);
			const age = newSeason - p.born.year;
			const plan = planFor(p, newSeason, states.get(p.tid));
			if (plan) {
				p.devPlan = { s: newSeason, f: plan.f, src: plan.src };
			} else {
				delete p.devPlan;
			}
			const devRating = dt?.devRating ?? VACANT_RATING;
			const planned = plan
				? planDevelopment(p, plan.f, age, devRating, subsOn)
				: undefined;
			const ratingDelta: Record<string, number> = { ...planned?.ratingDelta };
			const tilt = planned?.subTilt;
			const add = (deltas: Record<string, number | undefined>) => {
				for (const [key, d] of Object.entries(deltas)) {
					if (d !== undefined && d !== 0) {
						ratingDelta[key] = (ratingDelta[key] ?? 0) + d;
					}
				}
			};
			if (dt) {
				add(shootingDeltas(dt.shootZ, age));
				add(conditioningDeltas(dt.scZ, age));
			}
			if (plan && userTids.includes(p.tid)) {
				report.set(p.pid, {
					before: reportRowBefore(p, plan.f),
					focus: plan.f,
					src: plan.src,
				});
			}
			return mergeDev(traitDev, {
				ratingDelta: ditherDeltas(ratingDelta, `${p.pid}|${newSeason}`),
				subTilt: tilt,
			});
		},
		// After every player developed: the user's Development Report
		finish: async (players: Player[]) => {
			for (const tid of userTids) {
				const t = await idb.cache.teams.get(tid);
				if (!t) {
					continue;
				}
				const rows: DevReportRow[] = [];
				for (const p of players) {
					const info = report.get(p.pid);
					if (!info || p.tid !== tid) {
						continue;
					}
					const r = p.ratings.at(-1) as any;
					rows.push({
						pid: p.pid,
						name: `${p.firstName} ${p.lastName}`,
						pos: r.pos,
						age: newSeason - p.born.year,
						focus: info.focus,
						src: info.src,
						subs: info.before.subs
							.filter((s) => s.before !== undefined && Array.isArray(r.sub))
							.map((s) => ({
								key: s.key,
								name: s.name,
								before: s.before!,
								after: r.sub[SUB_INDEX[s.key]!],
							})),
						focusBefore: Math.round(10 * info.before.focus) / 10,
						focusAfter: Math.round(10 * focusLevel(r, info.focus)) / 10,
						ovrBefore: info.before.ovr,
						ovrAfter: r.ovr,
					});
				}
				const state = stateOf(t);
				t.staffDepth = {
					...state,
					devReport: { season: newSeason, rows },
					devAccepted: undefined,
				};
				await idb.cache.teams.put(t);
			}
		},
	};
};

export const focusName = (f: FocusKey) => FOCUSES[f].name;

// For tests and the UI: is a coach in one of the extra jobs
export const isDepthRole = (role: CoachRole) =>
	role === "shoot" || role === "sc" || role === "video";

export const freeAgentCoachesFor = async (role: CoachRole) =>
	(await idb.cache.coaches.getAll()).filter(
		(c: Coach) => c.tid === -1 && c.role === role,
	);
