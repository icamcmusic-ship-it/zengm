// Scouting Director & Regions (featureScoutingDepth, needs Scouting Reports): the Director's region plan, the looks prospects get over the
// season and the fuzz narrowing they buy (the user's view only: AI teams always see true ratings), the weekly big board, "our guy" and scout
// careers. Seeded streams only; nothing runs while the setting is off.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { getPreDraftStats } from "../../../common/preDraft.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import {
	departmentQualityForLevel,
	getDepartment,
	scoutFromId,
	scoutId,
} from "../../../common/scoutingReports/scouts.ts";
import { scoutAccuracy } from "../../../common/scoutingReports/history.ts";
import type { Scout } from "../../../common/scoutingReports/types.ts";
import {
	autoPriority,
	matchesPriority,
	rankBoard,
	summarizeBoardChanges,
	type BoardProspect,
	type Needs,
} from "../../../common/staffDepth/board.ts";
import {
	confidenceFromFactor,
	effectiveQuality,
	eventLooks,
	fuzzFactorForLooks,
	LOOKS_CARRY,
	planRegions,
	prospectRegion,
	REGION_NAMES,
	SCOUT_REGIONS,
	scoutExperience,
	visibilityForRank,
	weeklyLooks,
	type RegionPlan,
} from "../../../common/staffDepth/regions.ts";
import type {
	ScoutCareerTeam,
	ScoutPriority,
	ScoutRegion,
	StaffDepthTeam,
} from "../../../common/staffDepth/types.ts";
import type { Player, Team } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, logEvent } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import fuzzRating from "../player/fuzzRating.ts";
import updateValues from "../player/updateValues.ts";
import getLevelLastThree from "../finances/getLevelLastThree.ts";
import { getTeamNeeds } from "../draft/draftNeeds.ts";
import {
	careerCutsFor,
	getReportCtx,
	leagueSeed,
	scoutingReportsOn,
	withExperience,
} from "../scoutingReports/input.ts";
import { stateOf } from "./coaching.ts";
import { scoutCalls } from "../scoutingReports/index.ts";
import { addSuggestion } from "./suggestions.ts";

export const scoutingDepthOn = () =>
	__SPORT === "basketball" && featureOn("scoutingDepth") && scoutingReportsOn();

export const DIRECTOR_SLOT = 9;

export const emptyCareer = (): ScoutCareerTeam => ({
	cuts: {},
	dirs: [],
	rep: {},
	ourGuys: [],
	log: [],
});

export const careerOf = (t: Pick<Team, "scoutCareer">) => ({
	...emptyCareer(),
	...t.scoutCareer,
});

// The draft year of the class being scouted now: this season's draft until it's held, then next season's
export const currentDraftYear = () =>
	g.get("phase") > PHASE.DRAFT ? g.get("season") + 1 : g.get("season");

export const directorFor = (t: Team, season: number, level: number): Scout => {
	const career = careerOf(t);
	const dir = career.dirs.findLast((d) => d.since <= season);
	const seed = leagueSeed();
	const id = dir?.id ?? scoutId(t.tid, DIRECTOR_SLOT, 0);
	const since =
		dir?.since ??
		g.get("startingSeason") - new Rng(`dirSince|${seed}|${t.tid}`).int(0, 6);
	const s = scoutFromId(
		seed,
		id,
		Math.min(
			0.92,
			departmentQualityForLevel(Number.isFinite(level) ? level : 34) + 0.06,
		),
		since,
		9999,
	);
	s.tid = t.tid;
	s.age += Math.max(0, season - since);
	s.quality = effectiveQuality(s, season);
	return s;
};

export const getUserDepth = async (tid = g.get("userTid")) => {
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return undefined;
	}
	return { t, state: stateOf(t) };
};

const saveState = async (t: Team, state: StaffDepthTeam) => {
	t.staffDepth = state;
	await idb.cache.teams.put(t);
};

const schoolOf = (p: Player) =>
	(getPreDraftStats(p).at(-1) as any)?.teamName ?? p.college ?? undefined;

export const regionOf = (p: Player) =>
	prospectRegion({ pid: p.pid, school: schoolOf(p), bornLoc: p.born.loc });

type ClassRow = {
	p: Player;
	region: ScoutRegion;
	rank: number;
	future: boolean;
};

// Every prospect with his region and his rank in his class by the user's scouts' value
export const getClasses = async () => {
	const draftYear = currentDraftYear();
	const prospects = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const byYear = new Map<number, Player[]>();
	for (const p of prospects) {
		if (p.draft.year < draftYear) {
			continue;
		}
		const list = byYear.get(p.draft.year) ?? [];
		list.push(p);
		byYear.set(p.draft.year, list);
	}
	const rows: ClassRow[] = [];
	for (const [year, list] of byYear) {
		list.sort((a, b) => b.valueFuzz - a.valueFuzz || a.pid - b.pid);
		list.forEach((p, i) =>
			rows.push({
				p,
				region: regionOf(p),
				rank: i + 1,
				future: year > draftYear,
			}),
		);
	}
	return rows;
};

const classShareOf = (rows: ClassRow[]) => {
	const share = {} as Record<ScoutRegion, number>;
	for (const r of SCOUT_REGIONS) {
		share[r] = 0;
	}
	let total = 0;
	for (const row of rows) {
		if (row.future) {
			continue;
		}
		const w = visibilityForRank(row.rank);
		share[row.region] += w;
		total += w;
	}
	for (const r of SCOUT_REGIONS) {
		share[r] = total > 0 ? share[r] / total : 0.2;
	}
	return share;
};

const needsOf = async (tid: number): Promise<Needs> => {
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	return getTeamNeeds(players as any);
};

// The priority the Director works with (the user's, or his own on Auto)
export const effectivePriority = (
	state: StaffDepthTeam,
	t: Team,
	needs: Needs,
): Exclude<ScoutPriority, "auto"> =>
	state.priority === "auto"
		? autoPriority(t.strategy as any, needs)
		: state.priority;

export type ScoutingContext = {
	t: Team;
	state: StaffDepthTeam;
	season: number;
	level: number;
	scouts: Scout[];
	director: Scout;
	plan: RegionPlan;
	// the Director's own plan (differs from plan when assignments are kept by hand)
	auto: RegionPlan;
	priority: Exclude<ScoutPriority, "auto">;
	needs: Needs;
	rows: ClassRow[];
};

export const getScoutingContext = async (
	tid = g.get("userTid"),
): Promise<ScoutingContext | undefined> => {
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return undefined;
	}
	const state = stateOf(t);
	const season = g.get("season");
	const level = await getLevelLastThree("scouting", { tid });
	const dept = withExperience(
		getDepartment({
			leagueSeed: leagueSeed(),
			tid,
			season,
			level,
			startingSeason: g.get("startingSeason"),
			cuts: await careerCutsFor(tid),
		}),
		season,
	);
	const director = directorFor(t, season, level);
	const rows = await getClasses();
	const needs = await needsOf(tid);
	const priority = effectivePriority(state, t, needs);
	const args = {
		scouts: dept.scouts,
		directorQuality: director.quality,
		classShare: classShareOf(rows),
		priority,
		season,
		seed: `${leagueSeed()}|${tid}`,
	};
	const auto = planRegions(args);
	const keep =
		state.delegation.scouting !== "auto" ? state.manualRegions : undefined;
	const plan = keep ? planRegions({ ...args, manual: keep }) : auto;
	return {
		t,
		state,
		season,
		level,
		scouts: dept.scouts,
		director,
		plan,
		auto,
		priority,
		needs,
		rows,
	};
};

/**
 * Add looks to a prospect and narrow his latest ratings row's fuzz to fuzzFactorForLooks of what it was before. A new ratings row (a new
 * season) starts again from its own fuzz with half the looks; a fuzz changed by something else (scouting points) is kept.
 */
export const applyLooks = (
	p: Player,
	added: number,
	season: number,
	region: ScoutRegion,
	coverage: number,
	event?: string,
) => {
	const r = p.ratings.at(-1)!;
	let L = p.scoutLooks;
	if (!L) {
		L = { s: season, n: 0, b: r.fuzz, a: 1, r: r.season };
	} else if (L.r !== r.season) {
		// The new row's fuzz averaged in the old (narrowed) one: undo that part
		L = {
			s: season,
			n: L.n * LOOKS_CARRY,
			b: (r.fuzz * 2) / (1 + L.a),
			a: 1,
			r: r.season,
		};
		r.fuzz = L.b;
	} else if (Math.abs(r.fuzz - L.b * L.a) > 1e-9) {
		L.b = r.fuzz / L.a;
	}
	if (L.s !== season) {
		L.s = season;
		L.ev = undefined;
	}
	L.n = Math.round((L.n + added) * 1000) / 1000;
	if (event) {
		L.ev = [...(L.ev ?? []), event];
	}
	const f = fuzzFactorForLooks(L.n);
	r.fuzz = L.b * f;
	L.a = Math.round(f * 10000) / 10000;
	r.fuzz = L.b * L.a;
	L.reg = region;
	L.cov = Math.round(coverage * 100) / 100;
	p.scoutLooks = L;
};

const isInTournament = (p: Player) =>
	p.collegeSeason?.season === p.draft.year &&
	p.collegeSeason.summary?.ncaaSeed !== undefined;

// Looks for a week (or several) of the regular season, or a big event, for every prospect
const addLooks = async (
	ctx: ScoutingContext,
	what: { weeks: number } | { event: "tournament" | "showcase" | "combine" },
) => {
	for (const row of ctx.rows) {
		const { p } = row;
		const coverage = ctx.plan.coverage[row.region];
		let added = 0;
		let event: string | undefined;
		if ("weeks" in what) {
			const ovr = fuzzRating(p.ratings.at(-1)!.ovr, p.ratings.at(-1)!.fuzz);
			const pot = fuzzRating(p.ratings.at(-1)!.pot, p.ratings.at(-1)!.fuzz);
			added =
				what.weeks *
				weeklyLooks({
					coverage,
					visibility: visibilityForRank(row.rank),
					priorityMatch: matchesPriority(
						ctx.priority,
						{
							pos: p.ratings.at(-1)!.pos,
							region: row.region,
							ovr,
							pot,
							age: p.draft.year - p.born.year,
						},
						ctx.needs,
					),
					future: row.future,
				});
		} else {
			if (row.future || p.scoutLooks?.ev?.includes(what.event)) {
				continue;
			}
			if (what.event === "tournament") {
				if (!isInTournament(p)) {
					continue;
				}
			} else if (what.event === "showcase") {
				if (isInTournament(p) || row.rank > 60) {
					continue;
				}
			} else if (p.combine?.season !== g.get("season")) {
				continue;
			}
			added = eventLooks(what.event, coverage);
			event = what.event;
		}
		applyLooks(p, added, ctx.season, row.region, coverage, event);
		await updateValues(p);
		await idb.cache.players.put(p);
	}
};

// The user's view (fuzz is always the user team's): also while auto playing, so the board is ready when the user takes over
const userTidIfControlled = () => {
	const tid = g.get("userTid");
	return g.get("spectator") ? undefined : tid;
};

// The Director's board for the current class (draft board ranks), with a summary of the changes
export const updateBoard = async (ctx: ScoutingContext, reason: string) => {
	if (!featureOn("draftBoard") || ctx.state.delegation.board === "manual") {
		return;
	}
	const draftYear = currentDraftYear();
	const cls = ctx.rows.filter((r) => r.p.draft.year === draftYear);
	if (cls.length === 0) {
		return;
	}
	const list: BoardProspect[] = cls.map(({ p, region }) => {
		const r = p.ratings.at(-1)!;
		return {
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			value: p.valueFuzz,
			ovr: fuzzRating(r.ovr, r.fuzz),
			pot: fuzzRating(r.pot, r.fuzz),
			pos: r.pos,
			age: draftYear - p.born.year,
			region,
			uncertainty: p.scoutLooks?.a ?? 1,
			rank: p.draftBoard?.rank,
			locked: p.draftBoard?.locked,
		};
	});
	const ranks = rankBoard(list, ctx.priority, ctx.needs);
	const cutoff =
		Math.max(1, g.get("numActiveTeams")) *
			Math.max(1, g.get("numDraftRounds")) +
		10;
	const kept = new Map(
		[...ranks].filter(
			([pid, r]) =>
				r <= cutoff || list.find((x) => x.pid === pid)?.locked === true,
		),
	);
	const before = new Map(list.map((x) => [x.pid, x.rank]));
	const names = new Map(list.map((x) => [x.pid, x.name]));
	const lines = summarizeBoardChanges(
		new Map([...before].filter(([, r]) => r !== undefined)),
		kept,
		names,
	);
	const changed = list.some((x) => x.rank !== kept.get(x.pid));
	if (!changed) {
		return;
	}
	if (ctx.state.delegation.board === "suggest") {
		await addSuggestion(ctx.t.tid, {
			id: `board-${ctx.season}`,
			area: "board",
			season: ctx.season,
			title: "Update the draft board",
			text: `${reason}: ${lines.length > 0 ? lines.join("; ") : "small reshuffles"}.`,
			action: { type: "board", ranks: Object.fromEntries(kept) },
			pending: true,
		});
		return;
	}
	await applyBoardRanks(
		Object.fromEntries(kept),
		cls.map((r) => r.p),
	);
	const t = (await idb.cache.teams.get(ctx.t.tid))!;
	const state = stateOf(t);
	const week = state.week?.season === ctx.season ? state.week.n : 0;
	const log = [...(state.boardLog ?? [])];
	if (lines.length > 0) {
		log.push({ season: ctx.season, week, lines: [reason, ...lines] });
	}
	await saveState(t, { ...state, boardLog: log.slice(-8) });
};

export const applyBoardRanks = async (
	ranks: Record<number, number>,
	players?: Player[],
) => {
	const list =
		players ??
		(
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		).filter((p) => p.draft.year === currentDraftYear());
	for (const p of list) {
		const rank = ranks[p.pid];
		const old = p.draftBoard;
		if (rank === undefined) {
			if (old?.rank !== undefined && !old.locked) {
				const rest = { ...old, rank: undefined };
				if (rest.tier === undefined && rest.note === undefined) {
					delete p.draftBoard;
				} else {
					p.draftBoard = rest;
				}
				await idb.cache.players.put(p);
			}
			continue;
		}
		if (old?.rank !== rank) {
			p.draftBoard = { ...old, rank };
			await idb.cache.players.put(p);
		}
	}
};

// Weekly during the regular season (after each day's games): looks, then the board
export const afterDay = async () => {
	if (!scoutingDepthOn()) {
		return;
	}
	const phase = g.get("phase");
	if (phase !== PHASE.REGULAR_SEASON && phase !== PHASE.AFTER_TRADE_DEADLINE) {
		return;
	}
	const tid = userTidIfControlled();
	if (tid === undefined) {
		return;
	}
	const season = g.get("season");
	const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
		season,
		tid,
	]);
	if (!ts) {
		return;
	}
	const gp = ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0);
	const week = Math.floor(gp / 3.5);
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return;
	}
	const state = stateOf(t);
	const prev = state.week?.season === season ? state.week.n : 0;
	if (week <= prev) {
		return;
	}
	await saveState(t, { ...state, week: { season, n: week } });
	const ctx = (await getScoutingContext(tid))!;
	await addLooks(ctx, { weeks: Math.min(4, week - prev) });
	await updateBoard(ctx, `Week ${week}`);
	await proposeRegions(ctx);
};

// Scouting delegation Suggest: the Director proposes his assignments when they differ from the ones kept
const proposeRegions = async (ctx: ScoutingContext) => {
	if (ctx.state.delegation.scouting !== "suggest") {
		return;
	}
	const differs = ctx.scouts.some(
		(s) => ctx.auto.assignments[s.id] !== ctx.plan.assignments[s.id],
	);
	if (!differs || !ctx.state.manualRegions) {
		return;
	}
	const moves = ctx.scouts
		.filter((s) => ctx.auto.assignments[s.id] !== ctx.plan.assignments[s.id])
		.map((s) => `${s.name} to ${REGION_NAMES[ctx.auto.assignments[s.id]!]}`);
	await addSuggestion(ctx.t.tid, {
		id: `regions-${ctx.season}`,
		area: "scouting",
		season: ctx.season,
		title: "Reassign scouts",
		text: `The Director wants to move ${moves.join(", ")}.`,
		action: { type: "assignRegions", assignments: ctx.auto.assignments },
		pending: true,
	});
};

// ---- "our guy" and scout careers ----

const reputationOf = (
	s: Scout,
	career: ScoutCareerTeam,
	acc: Map<number, { judged: number; hitRate: number }>,
	season: number,
) => {
	const a = acc.get(s.id);
	const fromHits = a
		? Math.max(
				-0.6,
				Math.min(0.6, (a.hitRate - 0.45) * 2 * Math.min(1, a.judged / 5)),
			)
		: 0;
	return (
		Math.round(
			100 *
				(fromHits +
					(career.rep[s.id] ?? 0) +
					0.015 * scoutExperience(s, season)),
		) / 100
	);
};

export const reputationLabel = (rep: number) =>
	rep >= 0.45
		? "Respected"
		: rep >= 0.2
			? "Rising"
			: rep > -0.1
				? "Unproven"
				: "Questioned";

// Hit rates per scout id from the draft takes that can be judged
export const scoutAccuracyById = async () => {
	const ctx = await getReportCtx();
	const calls = await scoutCalls(ctx);
	const byId = new Map<number, typeof calls>();
	for (const c of calls) {
		if (!c.judged) {
			continue;
		}
		const list = byId.get(c.scoutId) ?? [];
		list.push(c);
		byId.set(c.scoutId, list);
	}
	const out = new Map<number, { judged: number; hitRate: number }>();
	for (const [id, list] of byId) {
		const a = scoutAccuracy(list);
		if (a) {
			out.set(id, { judged: a.calls, hitRate: a.hitRate });
		}
	}
	return out;
};

const departmentOf = async (t: Team, season: number) => {
	const level = await getLevelLastThree("scouting", { tid: t.tid });
	return {
		level,
		dept: withExperience(
			getDepartment({
				leagueSeed: leagueSeed(),
				tid: t.tid,
				season,
				level,
				startingSeason: g.get("startingSeason"),
				cuts: careerOf(t).cuts,
			}),
			season,
		),
	};
};

const BIAS_SCORE: Record<string, (r: any, p: Player) => number> = {
	athletes: (r) => 0.15 * (r.spd + r.jmp - 100),
	shooters: (r) => 0.2 * (r.tp - 50),
	size: (r) => 0.3 * (r.hgt - 50),
	production: (_r, p) =>
		(0.2 * ((getPreDraftStats(p).at(-1) as any)?.pts ?? 0)) /
		Math.max(1, (getPreDraftStats(p).at(-1) as any)?.gp ?? 1),
	tools: (r) => 0.15 * (r.pot - r.ovr),
	youth: (_r, p) => (p.draft.year - p.born.year <= 19 ? 2 : 0),
};

// Preseason: each scout picks 1-3 favourite prospects of the coming class, through his specialty and bias (never the consensus top 3)
export const pickOurGuys = async () => {
	const season = g.get("season");
	const prospects = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	)
		.filter((p) => p.draft.year === season)
		.sort((a, b) => b.value - a.value);
	if (prospects.length < 10) {
		return;
	}
	const pool = prospects.slice(3, 75);
	const seed = leagueSeed();
	for (const t of (await idb.cache.teams.getAll()).filter((t) => !t.disabled)) {
		const career = careerOf(t);
		if (career.ourGuys.some((x) => x.s === season)) {
			continue;
		}
		const { dept } = await departmentOf(t, season);
		for (const s of dept.scouts) {
			const rng = new Rng(`ourGuy|${seed}|${s.id}|${season}`);
			const scored = pool.map((p) => {
				const r = p.ratings.at(-1) as any;
				const region = regionOf(p);
				let score = p.value + (BIAS_SCORE[s.bias]?.(r, p) ?? 0);
				if (s.specialty === "international" && region === "intl") {
					score += 4;
				} else if (
					s.specialty === "college" &&
					(region === "east" || region === "west" || region === "midSouth")
				) {
					score += 1.5;
				} else if (s.specialty === "athletes") {
					score += 0.1 * (r.spd + r.jmp - 100);
				} else if (s.specialty === "shooters") {
					score += 0.15 * (r.tp - 50);
				}
				score += rng.normal(0, 2 + 4 * (1 - s.quality));
				return { p, score };
			});
			scored.sort((a, b) => b.score - a.score);
			const n = 1 + rng.int(0, 2);
			for (const { p } of scored.slice(0, n)) {
				career.ourGuys.push({
					s: season,
					sid: s.id,
					pid: p.pid,
					name: `${p.firstName} ${p.lastName}`,
				});
			}
		}
		career.ourGuys = career.ourGuys.filter((x) => x.s >= season - 12);
		t.scoutCareer = career;
		await idb.cache.teams.put(t);
	}
};

const scoutName = (id: number) => scoutFromId(leagueSeed(), id, 0.5, 0, 0).name;

// After the draft: judge "our guy" calls (a star any time; bust or solid after four seasons), then retirements, poaching and promotions
export const runScoutCareers = async () => {
	const season = g.get("season");
	const seed = leagueSeed();
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const userTid = g.get("userTid");
	const acc = await scoutAccuracyById();
	const news: { tids: number[]; text: string; user: boolean }[] = [];

	for (const t of teams) {
		const career = careerOf(t);
		for (const call of career.ourGuys) {
			if (call.judged || call.s > season - 1) {
				continue;
			}
			const p = await idb.merged.players.get(call.pid);
			if (!p) {
				continue;
			}
			const peak = Math.max(
				0,
				...(p.ratings as any[])
					.filter((r) => r.season > call.s)
					.map((r) => r.ovr),
			);
			const allStar = p.awards.some(
				(a: any) =>
					typeof a.type === "string" &&
					(a.type === "All-Star" || a.type.startsWith("All-League")),
			);
			let verdict: "star" | "bust" | "solid" | undefined;
			if (allStar || peak >= 64) {
				verdict = "star";
			} else if (season - call.s >= 4) {
				verdict = peak < 47 ? "bust" : "solid";
			}
			if (!verdict) {
				continue;
			}
			call.judged = verdict;
			const name = scoutName(call.sid);
			const link = `<a href="/l/${g.get("lid")}/player/${p.pid}">${call.name}</a>`;
			if (verdict === "star") {
				career.rep[call.sid] =
					Math.round(100 * ((career.rep[call.sid] ?? 0) + 0.3)) / 100;
				news.push({
					tids: [t.tid],
					user: t.tid === userTid,
					text: `Scout ${name} called it: ${link} was "his guy" in the ${call.s} class and became a star. His reputation soars.`,
				});
			} else if (verdict === "bust") {
				career.rep[call.sid] =
					Math.round(100 * ((career.rep[call.sid] ?? 0) - 0.2)) / 100;
				news.push({
					tids: [t.tid],
					user: t.tid === userTid,
					text: `Scout ${name} pounded the table for ${link} in the ${call.s} class. He busted, and it shows on ${name}'s reputation.`,
				});
			}
		}
		t.scoutCareer = career;
	}

	// Retirements, poaching, Directors leaving and promotions (effective next season)
	const next = season + 1;
	const directors = new Map<number, Scout>();
	for (const t of teams) {
		const level = await getLevelLastThree("scouting", { tid: t.tid });
		directors.set(t.tid, directorFor(t, season, level));
	}
	for (const t of teams) {
		const career = careerOf(t);
		const rng = new Rng(`scoutCareer|${seed}|${t.tid}|${season}`);
		const { dept } = await departmentOf(t, season);
		const user = t.tid === userTid;
		for (const s of dept.scouts) {
			if (career.cuts[s.id] !== undefined) {
				continue;
			}
			const age = s.age;
			const retireProb = age >= 70 ? 1 : age >= 66 ? 0.3 : 0;
			if (rng.random() < retireProb) {
				career.cuts[s.id] = next;
				career.cutWhy = { ...career.cutWhy, [s.id]: "retired" };
				career.log.push({
					season,
					text: `${s.name} retired after ${season - s.since} seasons`,
				});
				continue;
			}
			const rep = reputationOf(s, career, acc, season);
			if (rep >= 0.3 && s.quality >= 0.55 && rng.random() < 0.15 * rep) {
				// Hired away as another team's Director of Scouting (one whose Director is not as good)
				const options = teams.filter(
					(o) =>
						o.tid !== t.tid &&
						(directors.get(o.tid)?.quality ?? 1) < s.quality &&
						!careerOf(o).dirs.some((d) => d.since === next),
				);
				if (options.length > 0) {
					const o = options[rng.int(0, options.length - 1)]!;
					const oc = careerOf(o);
					oc.dirs.push({ id: s.id, since: next, how: "poached" });
					oc.log.push({
						season,
						text: `Hired ${s.name} away from the ${t.region} ${t.name} as Director of Scouting`,
					});
					o.scoutCareer = oc;
					await idb.cache.teams.put(o);
					career.cuts[s.id] = next;
					career.cutWhy = { ...career.cutWhy, [s.id]: "poached" };
					career.log.push({
						season,
						text: `${s.name} was hired away by the ${o.region} ${o.name} as their Director of Scouting`,
					});
					news.push({
						tids: [t.tid, o.tid],
						user: user || o.tid === userTid,
						text: `The ${o.region} ${o.name} hired scout ${s.name} away from the ${t.region} ${t.name} to be their Director of Scouting.`,
					});
				}
			}
		}
		// The Director: retirement or leaving, then a promotion from within (a respected scout) or a new hire
		const dir = directors.get(t.tid)!;
		if (!career.dirs.some((d) => d.since <= season)) {
			career.dirs.unshift({ id: dir.id, since: dir.since, how: "hired" });
		}
		const replaced = career.dirs.some((d) => d.since === next);
		const leaves = dir.age >= 68 || rng.random() < 0.07;
		if (!replaced && leaves) {
			const candidates = dept.scouts
				.filter((s) => career.cuts[s.id] === undefined)
				.map((s) => ({ s, rep: reputationOf(s, career, acc, season) }))
				.filter((x) => x.rep >= 0.1 && scoutExperience(x.s, season) >= 5)
				.sort((a, b) => b.rep - a.rep);
			const promoted = candidates[0]?.s;
			if (promoted) {
				career.cuts[promoted.id] = next;
				career.cutWhy = { ...career.cutWhy, [promoted.id]: "promoted" };
				career.dirs.push({ id: promoted.id, since: next, how: "promoted" });
				career.log.push({
					season,
					text: `${promoted.name} was promoted to Director of Scouting (${dir.name} ${dir.age >= 68 ? "retired" : "left"})`,
				});
			} else {
				const n = career.dirs.filter(
					(d) => Math.floor(d.id / 1000) % 10 === DIRECTOR_SLOT,
				).length;
				const id = scoutId(t.tid, DIRECTOR_SLOT, Math.max(1, n));
				career.dirs.push({ id, since: next, how: "hired" });
				career.log.push({
					season,
					text: `Hired ${scoutName(id)} as Director of Scouting (${dir.name} ${dir.age >= 68 ? "retired" : "left"})`,
				});
			}
			if (user) {
				news.push({
					tids: [t.tid],
					user,
					text: `Your Director of Scouting ${dir.name} ${dir.age >= 68 ? "retired" : "left the team"}. ${career.log.at(-1)!.text}.`,
				});
			}
		}
		career.log = career.log.slice(-30);
		t.scoutCareer = career;
		await idb.cache.teams.put(t);
	}
	for (const n of news) {
		await logEvent({
			type: "info",
			text: n.text,
			showNotification: n.user,
			tids: n.tids,
			score: n.user ? 10 : 0,
		});
	}
};

// Phase hooks (newPhase), after the phase's own work
export const afterNewPhase = async (phase: number) => {
	if (!scoutingDepthOn()) {
		return;
	}
	if (phase === PHASE.PRESEASON) {
		await pickOurGuys();
		return;
	}
	if (phase === PHASE.AFTER_DRAFT) {
		await runScoutCareers();
		return;
	}
	const tid = userTidIfControlled();
	if (tid === undefined) {
		return;
	}
	if (phase === PHASE.REGULAR_SEASON) {
		// (a new league starts in the preseason, so its scouts pick theirs now)
		await pickOurGuys();
		const ctx = (await getScoutingContext(tid))!;
		await addLooks(ctx, { weeks: 1 });
		await updateBoard(ctx, "Opening board");
	} else if (phase === PHASE.PLAYOFFS) {
		const ctx = (await getScoutingContext(tid))!;
		await addLooks(ctx, { event: "tournament" });
		await addLooks(ctx, { event: "showcase" });
		await updateBoard(ctx, "After the tournament and the showcase");
	} else if (phase === PHASE.DRAFT_LOTTERY) {
		const ctx = (await getScoutingContext(tid))!;
		await addLooks(ctx, { event: "combine" });
		await updateBoard(ctx, "After the combine");
	}
};

export { confidenceFromFactor };
