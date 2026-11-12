// Scouting reports, worker side (League Extras: Scouting Reports). Reports are derived on view from what the user's scouts can see
// (input.ts). Stored: compact grade snapshots at a few phases (stock up/down) and the department's take at the draft (track record).
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	addSnap,
	assignScouts,
	blurbOf,
	briefOf,
	buildChangelog,
	buildReport,
	categoryScores,
	departmentHistory,
	draftTierName,
	formatGradeRange,
	GRADE_KEYS,
	gmLensAdjustment,
	gradeLetter,
	hoverOf,
	judgeable,
	makeSnap,
	opponentNotes,
	outcomeTier,
	parseScoutId,
	peerGroupOf,
	qualityLabel,
	roleName,
	scoutAccuracy,
	scoutById,
	scoutsSplit,
	scoutTake,
	trackLine,
	type FullReport,
	type GradeKey,
	type ScoutCall,
	type ScoutDepartment,
	type Scout,
	BIAS_NAMES,
	SHORT_LABELS,
	SPECIALTY_NAMES,
	type ScoutInput,
	type SnapStats,
} from "../../../common/scoutingReports/index.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import type { Player, Race } from "../../../common/types.ts";
import type { ScoutingExportPage } from "../../../common/playerExport.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { generateFace } from "../../util/face.ts";
import fuzzRating from "../player/fuzzRating.ts";
import {
	buildInput,
	clearScoutingCache,
	departmentFor,
	getPeers,
	getReportCtx,
	isProspectPlayer,
	PHASES_WITH_SNAPSHOTS,
	scoutingReportsOn,
	type ReportCtx,
} from "./input.ts";

export { scoutingReportsOn, clearScoutingCache, departmentFor };

const peersFor = (input: ScoutInput, ctx: ReportCtx) =>
	getPeers(
		ctx,
		input.kind === "prospect" ? "prospect" : "pro",
		peerGroupOf(input.pos),
		input.draft.year,
	);

export const reportFor = async (
	p: Player,
	ctx: ReportCtx,
	opts: { leadId?: number; light?: boolean } = {},
) => {
	const input = await buildInput(p, ctx, { light: opts.light });
	const peers = await peersFor(input, ctx);
	const report = buildReport({
		input,
		peers,
		dept: ctx.dept,
		numTeams: ctx.numTeams,
		leadId: opts.leadId,
	});
	return { input, report };
};

const snapStatsOf = (input: ScoutInput): SnapStats | undefined => {
	const s = input.kind === "prospect" ? input.preDraft : input.production;
	if (!s || s.gp <= 0) {
		return undefined;
	}
	return {
		tpPct: s.tpPct,
		ftPct: s.ftPct,
		tov36: s.min > 0 ? (s.tov * 36) / s.min : 0,
		pts36: s.min > 0 ? (s.pts * 36) / s.min : 0,
		min: s.gp * s.min,
	};
};

const trackRecordFor = (p: Player, ctx: ReportCtx, input: ScoutInput) => {
	const rec = p.scoutDraft;
	if (!rec) {
		return undefined;
	}
	const scouts = rec.by
		.map((id) => scoutById(ctx.seed, id, ctx.startingSeason, ctx.season))
		.filter((s): s is Scout => !!s);
	const retired = p.tid === PLAYER.RETIRED;
	if (!judgeable(rec.s, ctx.season, retired)) {
		return {
			text: `Our scouts said in ${rec.s}: ${draftTierName(rec.t)} (too early to judge).`,
			scouts: scouts.map((s) => s.name),
		};
	}
	const peakOvr = Math.max(
		0,
		...(p.ratings as any[])
			.filter((r) => r.season > rec.s)
			.map((r) => fuzzRating(r.ovr, r.fuzz ?? 0)),
	);
	const became = outcomeTier({
		peakOvr,
		awards: input.awards,
		proSeasons: input.proSeasons,
		scale: ctx.roleScale,
	});
	return {
		text: `${trackLine(rec.t, became)} (${rec.s}).`,
		scouts: scouts.map((s) => s.name),
	};
};

// Everything the player's Scouting page shows
export const getPlayerScoutingPage = async (pid: number, leadId?: number) => {
	const p = await idb.merged.players.get(pid);
	if (!p) {
		return undefined;
	}
	const ctx = await getReportCtx();
	const { input, report } = await reportFor(p, ctx, { leadId });
	const current = makeSnap(
		ctx.season,
		ctx.phase,
		report.take,
		input.looks,
		snapStatsOf(input),
	);
	const changelog = buildChangelog(
		p.scoutSnaps ?? [],
		input.kind === "retired" ? undefined : current,
		input.kind === "prospect",
	);
	const second = report.byline.second;
	const comparison =
		report.secondTake && second
			? {
					scouts: [report.byline.lead, second],
					rows: GRADE_KEYS.map((key) => {
						const a = report.take.grades.find((x) => x.key === key)!;
						const b = report.secondTake!.grades.find((x) => x.key === key)!;
						return {
							key,
							label: a.label,
							a: formatGradeRange(a.lo, a.hi),
							b: formatGradeRange(b.lo, b.hi),
							diff: b.grade - a.grade,
						};
					}),
					overall: [
						formatGradeRange(report.take.overall.lo, report.take.overall.hi),
						formatGradeRange(
							report.secondTake.overall.lo,
							report.secondTake.overall.hi,
						),
					],
					ranges: [
						`${roleName(report.take.floor, peerGroupOf(input.pos))} to ${roleName(report.take.ceiling, peerGroupOf(input.pos))}`,
						`${roleName(report.secondTake.floor, peerGroupOf(input.pos))} to ${roleName(report.secondTake.ceiling, peerGroupOf(input.pos))}`,
					],
				}
			: undefined;
	return {
		report,
		changelog,
		comparison,
		track: trackRecordFor(p, ctx, input),
		dept: {
			tid: ctx.dept.tid,
			quality: qualityLabel(ctx.dept.quality),
			scouts: ctx.dept.scouts.map((s) => ({
				...briefOf(s),
				specialtyName: SPECIALTY_NAMES[s.specialty],
				biasName: BIAS_NAMES[s.bias],
			})),
		},
		pos: input.pos,
		age: input.age,
		production: input.production ?? input.preDraft,
		kind: input.kind,
	};
};

export type PlayerScoutingPage = NonNullable<
	Awaited<ReturnType<typeof getPlayerScoutingPage>>
>;

// One line for the Overview
export const getScoutingSummary = async (pid: number) => {
	if (!scoutingReportsOn()) {
		return undefined;
	}
	const p = await idb.merged.players.get(pid);
	if (!p) {
		return undefined;
	}
	const ctx = await getReportCtx();
	const { input, report } = await reportFor(p, ctx, { light: true });
	return {
		overall: formatGradeRange(report.overall.lo, report.overall.hi),
		blurb: blurbOf(report, input.pos),
		byline: report.byline.lead.name,
	};
};

export const getScoutingHover = async (pid: number) => {
	if (!scoutingReportsOn()) {
		return undefined;
	}
	const p = await idb.merged.players.get(pid);
	if (!p) {
		return undefined;
	}
	const ctx = await getReportCtx();
	const { report } = await reportFor(p, ctx, { light: true });
	return hoverOf(report);
};

export const getScoutingBlurbs = async (pids: number[]) => {
	const out: Record<number, string> = {};
	if (!scoutingReportsOn()) {
		return out;
	}
	const ctx = await getReportCtx();
	for (const pid of pids.slice(0, 60)) {
		const p = await idb.merged.players.get(pid);
		if (!p) {
			continue;
		}
		const { input, report } = await reportFor(p, ctx, { light: true });
		out[pid] = blurbOf(report, input.pos);
	}
	return out;
};

// ---- faces for scouts (no stored data: drawn from the scout's seed) ----

const RACES: Race[] = ["white", "black", "asian", "brown"];

const seededFace = (seed: string) => {
	const rng = new Rng(`face|${seed}`);
	const race = RACES[rng.int(0, RACES.length - 1)]!;
	const orig = Math.random;
	Math.random = () => rng.random();
	try {
		return generateFace({ race });
	} finally {
		Math.random = orig;
	}
};

const scoutCalls = async (ctx: ReportCtx) => {
	const players = await idb.merged.players.getAll({ activeAndRetired: true });
	const prospects = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const calls: (ScoutCall & { judged: boolean })[] = [];
	for (const p of [...players, ...prospects]) {
		const rec = p.scoutDraft;
		if (!rec) {
			continue;
		}
		const retired = p.tid === PLAYER.RETIRED;
		const judged =
			judgeable(rec.s, ctx.season, retired) && !isProspectPlayer(p);
		let became = -1;
		if (judged) {
			const peakOvr = Math.max(
				0,
				...(p.ratings as any[])
					.filter((r) => r.season > rec.s)
					.map((r) => fuzzRating(r.ovr, r.fuzz ?? 0)),
			);
			const input = await buildInput(p, ctx, { light: true });
			became = outcomeTier({
				peakOvr,
				awards: input.awards,
				proSeasons: input.proSeasons,
				scale: ctx.roleScale,
			});
		}
		rec.by.forEach((scoutId, i) => {
			calls.push({
				scoutId,
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				season: rec.s,
				said: rec.v[i] ?? rec.t,
				became,
				judged,
			});
		});
	}
	return calls;
};

// The Scouting Department page
export const getDepartmentPage = async (tid: number) => {
	const ctx = await getReportCtx();
	const dept = await departmentFor(tid);
	const level = dept.level;
	const history = departmentHistory({
		leagueSeed: ctx.seed,
		tid,
		season: ctx.season,
		level,
		startingSeason: ctx.startingSeason,
	});
	const calls = await scoutCalls(ctx);
	const mine = calls.filter((c) => parseScoutId(c.scoutId).tid === tid);
	const scoutRow = (s: Scout, current: boolean) => {
		const own = mine.filter((c) => c.scoutId === s.id);
		const judged = own.filter((c) => c.judged);
		const acc = scoutAccuracy(judged);
		return {
			...briefOf(s),
			specialtyName: SPECIALTY_NAMES[s.specialty],
			biasName: BIAS_NAMES[s.bias],
			qualityLabel: qualityLabel(s.quality),
			since: s.since,
			until: s.until,
			age: s.age,
			current,
			face: current ? seededFace(s.seed) : undefined,
			calls: own.length,
			accuracy: acc
				? {
						calls: acc.calls,
						hitRate: Math.round(100 * acc.hitRate),
						avgError: Math.round(10 * acc.avgError) / 10,
						best: acc.best
							? trackLine(acc.best.said, acc.best.became).replace(
									"Our scouts said",
									acc.best.name,
								)
							: undefined,
						worst: acc.worst
							? trackLine(acc.worst.said, acc.worst.became).replace(
									"Our scouts said",
									acc.worst.name,
								)
							: undefined,
					}
				: undefined,
		};
	};
	const currentIds = new Set(dept.scouts.map((s) => s.id));
	// Who joined and who left, most recent first
	const moves: { season: number; text: string }[] = [];
	for (const s of history) {
		if (s.since > ctx.startingSeason - 1 && s.since <= ctx.season) {
			moves.push({
				season: s.since,
				text: `Hired ${s.name} (${SPECIALTY_NAMES[s.specialty].toLowerCase()})`,
			});
		}
		if (s.until <= ctx.season && s.until > ctx.startingSeason) {
			moves.push({
				season: s.until,
				text: `${s.name} left the department after ${s.until - s.since} seasons`,
			});
		}
	}
	moves.sort((a, b) => b.season - a.season);
	const judgedCalls = mine
		.filter((c) => c.judged)
		.toSorted((a, b) => b.season - a.season || b.became - a.became);
	const seenPid = new Set<number>();
	const track = [];
	for (const c of judgedCalls) {
		if (seenPid.has(c.pid)) {
			continue;
		}
		seenPid.add(c.pid);
		track.push({
			pid: c.pid,
			name: c.name,
			season: c.season,
			text: trackLine(c.said, c.became),
			hit: Math.abs(c.became - c.said) <= 1,
		});
		if (track.length >= 25) {
			break;
		}
	}
	const teams = await idb.cache.teams.getAll();
	return {
		tid,
		level,
		quality: qualityLabel(dept.quality),
		qualityValue: Math.round(100 * dept.quality),
		scouts: dept.scouts.map((s) => scoutRow(s, true)),
		former: history
			.filter((s) => !currentIds.has(s.id) && s.until <= ctx.season)
			.slice(0, 12)
			.map((s) => scoutRow(s, false)),
		moves: moves.slice(0, 15),
		track,
		pending: mine.filter((c) => !c.judged).length,
		teams: teams
			.filter((t) => !t.disabled)
			.map((t) => ({
				tid: t.tid,
				abbrev: t.abbrev,
				name: `${t.region} ${t.name}`,
			})),
		userTid: g.get("userTid"),
	};
};

// ---- snapshots (stock up/down) and the draft take (track record) ----

export const recordSnapshots = async (phase: number) => {
	if (!scoutingReportsOn()) {
		return;
	}
	clearScoutingCache();
	const ctx = await getReportCtx();
	const season = g.get("season");
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.UNDRAFTED,
		Infinity,
	]);
	for (const p of players) {
		if (p.tid !== PLAYER.UNDRAFTED && p.tid < PLAYER.FREE_AGENT) {
			continue;
		}
		const prospect = isProspectPlayer(p);
		// Prospects are snapshot only in their draft year's season (and the one before), to keep it small
		if (prospect && p.draft.year > season + 1) {
			continue;
		}
		const input = await buildInput(p, ctx, { light: true });
		const peers = await peersFor(input, ctx);
		const base = categoryScores({
			ratings: input.ratings,
			production: input.production ?? input.preDraft,
			group: peerGroupOf(input.pos),
			traits: input.traits,
		});
		const { lead, second } = assignScouts(
			ctx.dept,
			{
				kind: input.kind,
				level: input.preDraft?.level,
				athletic: base.ath >= 60,
				shooter: base.cs >= 58 || base.od >= 58,
			},
			p.pid,
		);
		if (!lead) {
			continue;
		}
		const take = scoutTake({ input, peers, scout: lead });
		let changed = false;
		if (PHASES_WITH_SNAPSHOTS.has(phase)) {
			const snaps = addSnap(
				p.scoutSnaps,
				makeSnap(season, phase, take, input.looks, snapStatsOf(input)),
			);
			if (snaps) {
				p.scoutSnaps = snaps;
				changed = true;
			}
		}
		if (phase === PHASE.DRAFT && prospect && p.draft.year === season) {
			const take2 = second
				? scoutTake({ input, peers, scout: second })
				: undefined;
			const v = [take.expected, ...(take2 ? [take2.expected] : [])];
			p.scoutDraft = {
				s: season,
				t: Math.round(v.reduce((a, b) => a + b, 0) / v.length),
				by: [lead.id, ...(second ? [second.id] : [])],
				v,
				o: take.overall.grade,
			};
			changed = true;
		}
		if (changed) {
			await idb.cache.players.put(p);
		}
	}
};

export const afterNewPhase = async (phase: number) => {
	if (!scoutingReportsOn()) {
		return;
	}
	if (!PHASES_WITH_SNAPSHOTS.has(phase) && phase !== PHASE.DRAFT) {
		return;
	}
	try {
		await recordSnapshots(phase);
	} catch (error) {
		// Never let the reports break a phase change
		console.error("Scouting snapshots failed", error);
	}
};

// ---- playoffs: opponent scouting ----

export const getOpponentScouting = async (season = g.get("season")) => {
	if (!scoutingReportsOn()) {
		return undefined;
	}
	const userTid = g.get("userTid");
	const ps = await idb.merged.playoffSeries.get(season);
	if (!ps) {
		return undefined;
	}
	let found: { round: number; opp: number } | undefined;
	for (let round = ps.series.length - 1; round >= 0; round--) {
		for (const s of ps.series[round] ?? []) {
			if (!s.away) {
				continue;
			}
			if (s.home.tid === userTid || s.away.tid === userTid) {
				found = {
					round,
					opp: s.home.tid === userTid ? s.away.tid : s.home.tid,
				};
				break;
			}
		}
		if (found) {
			break;
		}
	}
	if (!found) {
		return undefined;
	}
	const ctx = await getReportCtx();
	const players = (
		await idb.cache.players.indexGetAll("playersByTid", found.opp)
	)
		.filter((p) => p.injury.gamesRemaining === 0)
		.sort((a, b) => b.valueNoPotFuzz - a.valueNoPotFuzz)
		.slice(0, 5);
	const notes = [];
	const grades: Record<string, number[]> = {};
	for (const p of players) {
		const { input, report } = await reportFor(p, ctx, { light: true });
		notes.push(opponentNotes(report, input.pos));
		for (const gr of report.grades) {
			(grades[gr.key] ??= []).push(gr.grade);
		}
	}
	const avg = (k: GradeKey) => {
		const list = grades[k] ?? [];
		return list.length > 0 ? list.reduce((a, b) => a + b, 0) / list.length : 6;
	};
	const keys: string[] = [];
	if (avg("shoot") >= 8) {
		keys.push("They shoot it: run them off the line and live with twos.");
	} else if (avg("shoot") <= 5) {
		keys.push(
			"Pack the paint; they haven't shown they can make us pay from outside.",
		);
	}
	if (avg("pm") >= 8) {
		keys.push(
			"Their passing is the engine. Pressure the handlers and stay home on shooters.",
		);
	}
	if (avg("reb") >= 8) {
		keys.push("Box out: they win the glass if we let them.");
	} else if (avg("reb") <= 5) {
		keys.push("Crash the offensive glass; they don't rebound well.");
	}
	if (avg("bs") <= 5) {
		keys.push("Turn up the ball pressure; they turn it over.");
	}
	if (avg("pd") <= 5) {
		keys.push("Attack their perimeter defenders off the dribble.");
	}
	if (avg("id") <= 5) {
		keys.push("Go at the rim; nobody back there protects it.");
	}
	if (keys.length === 0) {
		keys.push("A balanced team: execution and matchups will decide it.");
	}
	const t = await idb.cache.teams.get(found.opp);
	return {
		season,
		round: found.round,
		opponent: {
			tid: found.opp,
			abbrev: t?.abbrev ?? "",
			name: t ? `${t.region} ${t.name}` : "",
		},
		players: notes,
		keys,
		byline: `${ctx.dept.scouts.find((s) => s.specialty === "pro")?.name ?? ctx.dept.scouts[0]?.name ?? "Our staff"}, advance scouting`,
	};
};

// ---- rumors: "Scouts are split on X" (for the rumors feed; nothing here depends on it) ----

// The takes of a few departments around the league on a player, all from what is publicly visible of him plus each scout's own error
// salt: another set of departments and wording (the rumors feed's draft-time buzz), "" for the default
export const getScoutingSplit = async (pid: number, salt = "") => {
	if (!scoutingReportsOn()) {
		return undefined;
	}
	const p = await idb.merged.players.get(pid);
	if (!p) {
		return undefined;
	}
	const ctx = await getReportCtx();
	const input = await buildInput(p, ctx, { light: true });
	const peers = await peersFor(input, ctx);
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const rng = new Rng(`rumorTeams|${ctx.seed}|${pid}|${ctx.season}${salt}`);
	const picked = teams.toSorted(() => rng.random() - 0.5).slice(0, 4);
	const takes = [];
	for (const t of picked) {
		const dept: ScoutDepartment = await departmentFor(t.tid);
		const lead = dept.scouts[0];
		if (lead) {
			takes.push({
				scout: `${t.region} ${lead.name}`,
				take: scoutTake({ input, peers, scout: lead }),
			});
		}
	}
	return scoutsSplit(
		input.name,
		input.pos,
		takes,
		`${ctx.seed}|${pid}|${ctx.season}${salt}`,
	);
};

// The players scouts disagree on most right now (top prospects and the league's best), for a rumors feed
export const getScoutingRumors = async (limit = 3) => {
	if (!scoutingReportsOn()) {
		return [];
	}
	const prospects = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	)
		.filter((p) => p.draft.year === g.get("season"))
		.sort((a, b) => b.valueFuzz - a.valueFuzz)
		.slice(0, 12);
	const out = [];
	for (const p of prospects) {
		const split = await getScoutingSplit(p.pid);
		if (split) {
			out.push({ pid: p.pid, ...split });
		}
	}
	return out.sort((a, b) => b.spread - a.spread).slice(0, limit);
};

// ---- the newspaper's draft preview ----

export const getDraftPreviewFacts = async () => {
	if (!scoutingReportsOn()) {
		return undefined;
	}
	const season = g.get("season");
	const all = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const draftYear = g.get("phase") > PHASE.DRAFT ? season + 1 : season;
	const prospects = all
		.filter((p) => p.draft.year === draftYear)
		.sort((a, b) => b.valueFuzz - a.valueFuzz)
		.slice(0, 8);
	if (prospects.length < 3) {
		return undefined;
	}
	const ctx = await getReportCtx();
	const rows = [];
	for (const [i, p] of prospects.entries()) {
		const { input, report } = await reportFor(p, ctx, { light: true });
		const best = report.grades
			.filter((x) => !x.sub)
			.toSorted((a, b) => b.grade - a.grade)[0]!;
		const snaps = p.scoutSnaps ?? [];
		const first = snaps[0];
		const move = first ? report.overall.grade - first.o : 0;
		rows.push({
			pid: p.pid,
			rank: i + 1,
			name: input.name,
			pos: input.pos,
			age: input.age,
			school: input.preDraft?.team ?? "",
			overall: gradeLetter(report.overall.grade),
			best: `${best.label} ${gradeLetter(best.grade)}`,
			floor: report.header.floorText,
			ceiling: report.header.ceilingText,
			comp: report.header.comps[0]?.name,
			line: report.bottomLine.split(". ")[0]!.replace(/\.$/, "") + ".",
			move,
		});
	}
	return {
		draftYear,
		scout:
			ctx.dept.scouts.find((s) => s.specialty === "college")?.name ??
			ctx.dept.scouts[0]!.name,
		rows,
	};
};

// ---- AI GMs: grades through their evaluation lens ----

let lensCache:
	| { key: string; z: Map<number, Partial<Record<GradeKey, number>>> }
	| undefined;

/**
 * Draft adjustments in value points for an AI GM, from the grades his department sees through his analytics/old-school lens. The
 * weights sum to zero and the grades are z-scores within the class, so the class is neither inflated nor deflated; bounded per player.
 */
export const gmLensAdjustments = (players: Player[], analytics: number) => {
	const key = `${g.get("lid")}|${g.get("season")}|${players.length}|${players[0]?.pid}`;
	if (lensCache?.key !== key) {
		// AI teams see true ratings (as everywhere in the AI), so this never touches what the user's scouts see
		const scores = players.map((p) => {
			const r = p.ratings.at(-1) as any;
			return categoryScores({
				ratings: { ...r },
				production: undefined,
				group: peerGroupOf(r.pos),
			});
		});
		const z = new Map<number, Partial<Record<GradeKey, number>>>();
		const stats = GRADE_KEYS.map((k) => {
			const vals = scores.map((s) => s[k]);
			const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
			const sd =
				Math.sqrt(
					vals.reduce((a, b) => a + (b - mean) ** 2, 0) /
						Math.max(1, vals.length),
				) || 1;
			return { k, mean, sd };
		});
		players.forEach((p, i) => {
			const zz: Partial<Record<GradeKey, number>> = {};
			for (const { k, mean, sd } of stats) {
				zz[k] = (scores[i]![k] - mean) / sd;
			}
			z.set(p.pid, zz);
		});
		lensCache = { key, z };
	}
	return players.map((p) =>
		gmLensAdjustment(analytics, lensCache!.z.get(p.pid) ?? {}),
	);
};

// The PDF page (Download players)
export const getScoutingExport = async (
	pid: number,
): Promise<ScoutingExportPage | undefined> => {
	if (!scoutingReportsOn()) {
		return undefined;
	}
	const p = await idb.merged.players.get(pid);
	if (!p) {
		return undefined;
	}
	const ctx = await getReportCtx();
	const { report } = await reportFor(p, ctx);
	return {
		byline: `${report.byline.lead.name}, ${report.byline.lead.title}`,
		overall: formatGradeRange(report.overall.lo, report.overall.hi),
		overallGrade: report.overall.grade,
		rangeLine: report.header.rangeLine,
		confidence: report.header.confidence,
		reference: report.reference,
		archetype: report.header.archetype,
		grades: report.grades.map((x) => ({
			key: x.key,
			short: SHORT_LABELS[x.key],
			label: x.label,
			text: formatGradeRange(x.lo, x.hi),
			grade: x.grade,
			lo: x.lo,
			hi: x.hi,
			line: x.line,
			sub: !!x.sub,
		})),
		shotMix: report.shotMix?.map((m) => ({ label: m.label, share: m.share })),
		comps: report.header.comps.map((x) => x.line),
		flags: report.flags.map((f) => ({ text: f.text, red: f.tone === "red" })),
		sections: [
			...(report.pro
				? [
						{
							title: "Pro report",
							lines: [
								`Role: ${report.pro.role}`,
								report.pro.trendLine,
								`Ideal role: ${report.pro.idealRole}`,
								...(report.pro.contract ? [report.pro.contract] : []),
							],
						},
					]
				: []),
			{ title: "Offense", lines: report.offense },
			{ title: "Defense", lines: report.defense },
			{ title: "Development", lines: report.development },
		],
		bottomLine: report.bottomLine,
	};
};

export type { FullReport };
