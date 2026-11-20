// Coach of the Year and Executive of the Year (League Extra coachExecAwards, basketball). Both are scored by a formula (Award Settings,
// game attribute coachExecAwardFormulas) from team-season variables computed here, given after the playoffs with the other awards,
// and stored once:
// - Coach of the Year on the winning coach (Coach.awards, as before), read with getCoachAwards (core/staff/data.ts)
// - Executive of the Year on the winning AI general manager (Gm.awards), or, for a front office with no AI GM (the user's team), on the
//   team season (TeamSeason.execOfTheYear). getExecAwards reads both
// No random numbers: ties go to the better record, then the lower id.
import { PHASE } from "../../../common/constants.ts";
import {
	COACH_OF_THE_YEAR,
	COY_KEY,
	COY_VARIABLES,
	EOY_KEY,
	EOY_VARIABLES,
	EXEC_OF_THE_YEAR,
	compareCandidates,
	defaultCoachExecFormula,
	projectedWinps,
	type CoachExecAwardKind,
	type CoyVariable,
	type EoyVariable,
} from "../../../common/coachExecAwards.ts";
import type { Coach, Gm, Team, TeamSeason } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { getActiveSeasonSelector } from "../../db/merged/players.ts";
import { FormulaEvaluator } from "../../util/FormulaEvaluator.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { getExpectedWinps } from "../college/expectations.ts";
import { isCollege } from "../college/isCollege.ts";
import ovr from "../team/ovr.ts";
import { getFormattedAll } from "../team/getFormatted.ts";

export const coachExecAwardsOn = () =>
	__SPORT === "basketball" && featureOn("coachExecAwards");

// Coach of the Year needs head coaches (the coaching staff). It was given before this feature too, so it doesn't depend on the switch
export const coyAvailable = () => {
	if (__SPORT !== "basketball") {
		return false;
	}
	try {
		return !!g.get("coachingStaff");
	} catch {
		return false;
	}
};

// Executive of the Year: every pro team's front office (college programs have no general managers)
export const eoyAvailable = () => coachExecAwardsOn() && !isCollege();

export const coachExecAwardAvailable = (kind: CoachExecAwardKind) =>
	kind === "coy" ? coyAvailable() : eoyAvailable();

const VARIABLES = {
	coy: COY_VARIABLES,
	eoy: EOY_VARIABLES,
};

class CoachExecFormulaEvaluator extends FormulaEvaluator<
	readonly string[],
	[]
> {
	constructor(formula: string, variables: readonly string[]) {
		super(formula, variables, []);
	}
}

const evaluatorCache = new Map<string, CoachExecFormulaEvaluator>();

const getEvaluator = (kind: CoachExecAwardKind, formula: string) => {
	const key = `${kind}|${formula}`;
	let evaluator = evaluatorCache.get(key);
	if (!evaluator) {
		evaluator = new CoachExecFormulaEvaluator(formula, VARIABLES[kind]);
		evaluatorCache.set(key, evaluator);
	}
	return evaluator;
};

// Error message for an invalid formula, undefined if it's fine
export const validateCoachExecFormula = (
	kind: CoachExecAwardKind,
	formula: string,
) => {
	try {
		getEvaluator(kind, formula);
		return undefined;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
};

export const defaultFormula = (kind: CoachExecAwardKind) =>
	defaultCoachExecFormula(kind, isCollege());

// The formula in use: the league's custom one, or the default (also when the custom one is invalid)
export const getCoachExecFormula = (kind: CoachExecAwardKind) => {
	let custom: string | undefined;
	try {
		custom = g.get("coachExecAwardFormulas")?.[kind];
	} catch {}
	if (
		custom !== undefined &&
		custom.trim() !== "" &&
		validateCoachExecFormula(kind, custom) === undefined
	) {
		return custom;
	}
	return defaultFormula(kind);
};

export type TeamAwardContext = {
	tid: number;
	abbrev: string;
	region: string;
	name: string;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	gp: number;
} & Record<CoyVariable | EoyVariable, number>;

const gpOf = (ts: { won: number; lost: number; tied?: number; otl?: number }) =>
	ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0);

const winpOf = (r: {
	won: number;
	lost: number;
	tied?: number;
	otl?: number;
}) => (gpOf(r) > 0 ? helpers.calcWinp(r) : 0);

const salaryOf = (ts: TeamSeason) => {
	const salary = ts.expenses?.salary as unknown;
	if (typeof salary === "number") {
		return salary;
	}
	// Old leagues stored { amount, rank }
	if (
		salary &&
		typeof salary === "object" &&
		typeof (salary as any).amount === "number"
	) {
		return (salary as any).amount as number;
	}
	return 0;
};

// Current ovr of every active team's roster
const liveOvrs = async () => {
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const byTid = Map.groupBy(players, (p) => p.tid);
	const out = new Map<number, number>();
	for (const t of await idb.cache.teams.getAll()) {
		if (t.disabled) {
			continue;
		}
		out.set(
			t.tid,
			ovr(
				(byTid.get(t.tid) ?? []).map((p) => {
					const r = p.ratings.at(-1)!;
					return {
						pid: p.pid,
						value: p.value,
						injury: p.injury,
						ratings: { ovr: r.ovr, ovrs: r.ovrs, pos: r.pos },
					};
				}),
			),
		);
	}
	return out;
};

// Moves "of a season": from the end of last season's playoffs to the end of this season's
const inMoveWindow = (tx: { season: number; phase: number }, season: number) =>
	(tx.season === season - 1 && tx.phase > PHASE.PLAYOFFS) ||
	(tx.season === season && tx.phase <= PHASE.PLAYOFFS);

const winShares = (row: Record<string, unknown>) =>
	(typeof row.ows === "number" ? row.ows : 0) +
	(typeof row.dws === "number" ? row.dws : 0);

/**
 * Every team's award variables for a season (teams that played in it). For the current season in progress, the roster rating is the
 * current one and the season totals are so far
 */
export const getTeamAwardContexts = async (
	season: number,
	options: { players?: boolean } = { players: true },
) => {
	const currentSeason = g.get("season");
	const inProgress =
		season === currentSeason && g.get("phase") <= PHASE.PLAYOFFS;
	const numGames = g.get("numGames");

	const teamSeasons = (await idb.merged.teamSeasons.getAll({ season })).filter(
		(ts) => gpOf(ts) > 0,
	);
	const prevBySeason = new Map(
		(await idb.merged.teamSeasons.getAll({ season: season - 1 })).map((ts) => [
			ts.tid,
			ts,
		]),
	);

	const movByTid = new Map<number, number>();
	const formatted = (await getFormattedAll({
		attrs: ["tid"],
		stats: ["mov"],
		season,
		showNoStats: true,
	})) as { tid: number; stats: { mov?: number } }[];
	for (const t of formatted) {
		movByTid.set(t.tid, t.stats?.mov ?? 0);
	}

	let live: Map<number, number> | undefined;
	const getLive = async () => {
		live ??= await liveOvrs();
		return live;
	};

	// Preseason expectation: the roster rating at the first game, else now (a team that hasn't played yet)
	const startOvrs = new Map<number, number>();
	for (const ts of teamSeasons) {
		if (ts.ovrStart !== undefined) {
			startOvrs.set(ts.tid, ts.ovrStart);
		} else if (inProgress) {
			const ovr = (await getLive()).get(ts.tid);
			if (ovr !== undefined) {
				startOvrs.set(ts.tid, ovr);
			}
		}
	}
	const expProjected = projectedWinps(startOvrs);
	const collegeExpected =
		isCollege() && season === currentSeason
			? await getExpectedWinps()
			: undefined;

	// Roster rating: at the end of the regular season, or now during it
	const endOvrs = new Map<number, number>();
	for (const ts of teamSeasons) {
		let ovr = ts.ovrEnd;
		if (ovr === undefined && inProgress) {
			ovr = (await getLive()).get(ts.tid);
		}
		ovr ??= ts.ovrStart;
		if (ovr !== undefined) {
			endOvrs.set(ts.tid, ovr);
		}
	}
	const rosterProjected = projectedWinps(endOvrs);

	// Injuries and moves, from the players active that season
	const manGamesLost = new Map<number, number>();
	const movesWS = new Map<number, number>();
	if (options.players !== false) {
		const players = await idb.merged.players.getAll(
			getActiveSeasonSelector(season),
		);
		for (const p of players) {
			const rows = p.stats.filter(
				(row) => row.season === season && !row.playoffs,
			) as unknown as ({ tid: number; gp?: number } & Record<
				string,
				unknown
			>)[];

			const injuryGames = Math.min(
				numGames,
				(p.injuries ?? [])
					.filter((injury) => injury.season === season)
					.reduce((sum, injury) => sum + Math.max(0, injury.games), 0),
			);
			if (injuryGames > 0) {
				const totalGp = rows.reduce((sum, row) => sum + (row.gp ?? 0), 0);
				if (rows.length > 0 && totalGp > 0) {
					for (const row of rows) {
						manGamesLost.set(
							row.tid,
							(manGamesLost.get(row.tid) ?? 0) +
								(injuryGames * (row.gp ?? 0)) / totalGp,
						);
					}
				} else {
					const tid = rows.at(-1)?.tid ?? (inProgress ? p.tid : -1);
					if (tid >= 0) {
						manGamesLost.set(tid, (manGamesLost.get(tid) ?? 0) + injuryGames);
					}
				}
			}

			const txs = (p.transactions ?? []).filter((tx) =>
				inMoveWindow(tx, season),
			);
			if (txs.length === 0) {
				continue;
			}
			const incoming = new Set<number>();
			const outgoing = new Set<number>();
			for (const tx of txs) {
				if (
					tx.type === "draft" ||
					tx.type === "freeAgent" ||
					tx.type === "trade"
				) {
					incoming.add(tx.tid);
				}
				if (tx.type === "trade") {
					outgoing.add(tx.fromTid);
				}
			}
			for (const tid of incoming) {
				const ws = rows
					.filter((row) => row.tid === tid)
					.reduce((sum, row) => sum + winShares(row), 0);
				movesWS.set(tid, (movesWS.get(tid) ?? 0) + ws);
			}
			for (const tid of outgoing) {
				const ws = rows
					.filter((row) => row.tid !== tid)
					.reduce((sum, row) => sum + winShares(row), 0);
				movesWS.set(tid, (movesWS.get(tid) ?? 0) - ws);
			}
		}
	}

	// Payroll efficiency, against the league's wins per dollar
	const salaries = teamSeasons.map(salaryOf);
	const totalSalary = salaries.reduce((a, b) => a + b, 0);
	const totalWinp = teamSeasons.reduce((sum, ts) => sum + winpOf(ts), 0);
	const leagueRate = totalSalary > 0 ? totalWinp / totalSalary : 0;

	const out = new Map<number, TeamAwardContext>();
	for (const [i, ts] of teamSeasons.entries()) {
		const gp = gpOf(ts);
		const winp = winpOf(ts);
		const prev = prevBySeason.get(ts.tid);
		const prevWinp = prev && gpOf(prev) > 0 ? winpOf(prev) : 0.5;
		const expWinp =
			collegeExpected?.get(ts.tid) ?? expProjected.get(ts.tid) ?? prevWinp;
		const rosterWinp = rosterProjected.get(ts.tid) ?? expWinp;
		const salary = salaries[i]!;
		const payrollEff =
			salary > 0 && leagueRate > 0
				? helpers.bound(winp / salary / leagueRate - 1, -1, 2)
				: 0;
		const info = g.get("teamInfoCache")[ts.tid];
		out.set(ts.tid, {
			tid: ts.tid,
			abbrev: ts.abbrev ?? info?.abbrev ?? "",
			region: ts.region ?? info?.region ?? "",
			name: ts.name ?? info?.name ?? "",
			won: ts.won,
			lost: ts.lost,
			tied: ts.tied ?? 0,
			otl: ts.otl ?? 0,
			gp,
			winp,
			prevWinp,
			expWinp,
			rosterWinp,
			mov: movByTid.get(ts.tid) ?? 0,
			playoffRoundsWon: ts.playoffRoundsWon,
			injuryRate: (manGamesLost.get(ts.tid) ?? 0) / Math.max(1, gp),
			movesWS: ((movesWS.get(ts.tid) ?? 0) * 82) / Math.max(1, numGames),
			payrollEff,
		});
	}
	return out;
};

const round = (x: number, digits = 3) => {
	const factor = 10 ** digits;
	return Math.round(x * factor) / factor;
};

const pickVars = <T extends string>(ctx: object, keys: readonly T[]) => {
	const out = {} as Record<T, number>;
	for (const key of keys) {
		const value = (ctx as Record<string, unknown>)[key];
		out[key] = round(typeof value === "number" ? value : 0);
	}
	return out;
};

const score = (kind: CoachExecAwardKind, formula: string, ctx: object) => {
	try {
		const vars = pickVars(ctx, VARIABLES[kind]);
		const value = getEvaluator(kind, formula).evaluate(vars as any);
		return Number.isFinite(value) ? value : Number.NaN;
	} catch {
		return Number.NaN;
	}
};

export type CoyCandidate = {
	cid: number;
	name: string;
	tid: number;
	abbrev: string;
	region: string;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	score: number;
	vars: Record<CoyVariable, number>;
};

export type EoyCandidate = {
	// Team of the front office
	tid: number;
	abbrev: string;
	region: string;
	// The GM's name, "You" for the user, or "<region> front office" when the team has no GM
	name: string;
	gmid?: number;
	user: boolean;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	score: number;
	vars: Record<EoyVariable, number>;
};

// A head coach's own record in a season: his stats row, or for the current season before it's recorded, the team's games since he
// was hired
const coachRecords = (
	c: Coach,
	season: number,
	tsByTid: Map<number, TeamSeason>,
) => {
	const rows = c.stats.filter((r) => r.season === season && r.role === "head");
	if (rows.length > 0) {
		return rows;
	}
	if (
		season === g.get("season") &&
		c.tid >= 0 &&
		c.role === "head" &&
		g.get("phase") <= PHASE.PLAYOFFS
	) {
		const ts = tsByTid.get(c.tid);
		if (!ts) {
			return [];
		}
		const base =
			c.hiredRecord &&
			c.hiredRecord.season === season &&
			c.hiredRecord.tid === c.tid
				? c.hiredRecord
				: { won: 0, lost: 0, tied: 0, otl: 0 };
		return [
			{
				season,
				tid: c.tid,
				role: c.role,
				won: Math.max(0, ts.won - base.won),
				lost: Math.max(0, ts.lost - base.lost),
				tied: Math.max(0, (ts.tied ?? 0) - base.tied),
				otl: Math.max(0, (ts.otl ?? 0) - base.otl),
				playoffRoundsWon: ts.playoffRoundsWon,
			},
		];
	}
	return [];
};

/**
 * Coach of the Year candidates for a season, best first: head coaches who coached at least half of their team's games
 */
export const getCoyCandidates = async (
	season: number,
	options: {
		formula?: string;
		contexts?: Map<number, TeamAwardContext>;
	} = {},
) => {
	const formula = options.formula ?? getCoachExecFormula("coy");
	if (!coyAvailable()) {
		return { formula, candidates: [] as CoyCandidate[] };
	}
	const contexts = options.contexts ?? (await getTeamAwardContexts(season));
	const tsByTid = new Map(
		(await idb.merged.teamSeasons.getAll({ season })).map((ts) => [ts.tid, ts]),
	);

	const candidates: CoyCandidate[] = [];
	for (const c of await idb.cache.coaches.getAll()) {
		for (const row of coachRecords(c, season, tsByTid)) {
			const ctx = contexts.get(row.tid);
			const gp = gpOf(row);
			if (!ctx || gp === 0 || gp < ctx.gp / 2) {
				continue;
			}
			const vars = pickVars({ ...ctx, winp: winpOf(row) }, COY_VARIABLES);
			candidates.push({
				cid: c.cid,
				name: `${c.firstName} ${c.lastName}`,
				tid: row.tid,
				abbrev: ctx.abbrev,
				region: ctx.region,
				won: row.won,
				lost: row.lost,
				tied: row.tied,
				otl: row.otl,
				score: score("coy", formula, { ...ctx, winp: winpOf(row) }),
				vars,
			});
		}
	}
	candidates.sort((a, b) =>
		compareCandidates(
			{ score: a.score, winp: a.vars.winp, id: a.cid },
			{ score: b.score, winp: b.vars.winp, id: b.cid },
		),
	);
	return { formula, candidates };
};

export const userControlsTeamNow = (tid: number) =>
	g.get("userTids").includes(tid) &&
	!local.autoPlayUntil &&
	!g.get("spectator");

const allGms = (teams: Team[]) => {
	const gms: Gm[] = [];
	for (const t of teams) {
		if (t.gm) {
			gms.push(t.gm);
		}
		gms.push(...(t.formerGms ?? []));
	}
	return gms;
};

// Who ran a team's front office in a season: its AI GM, or the user
const frontOfficeFor = (
	t: Team,
	season: number,
	gms: Gm[],
): { gm?: Gm; user: boolean } => {
	if (season === g.get("season")) {
		const user = userControlsTeamNow(t.tid);
		return { gm: !user ? t.gm : undefined, user };
	}
	const gm = gms.find(
		(x) =>
			x.seasons.some((row) => row.season === season && row.tid === t.tid) ||
			x.tenures.some(
				(tenure) =>
					tenure.tid === t.tid &&
					tenure.start <= season &&
					(tenure.end === undefined || tenure.end >= season),
			),
	);
	if (gm) {
		return { gm, user: false };
	}
	let userTid: number | undefined;
	try {
		userTid = g.get("userTid", season);
	} catch {}
	return { user: userTid === t.tid || g.get("userTids").includes(t.tid) };
};

const userName = () => "You";

/**
 * Executive of the Year candidates for a season, best first: every team's front office
 */
export const getEoyCandidates = async (
	season: number,
	options: {
		formula?: string;
		contexts?: Map<number, TeamAwardContext>;
	} = {},
) => {
	const formula = options.formula ?? getCoachExecFormula("eoy");
	if (!eoyAvailable()) {
		return { formula, candidates: [] as EoyCandidate[] };
	}
	const contexts = options.contexts ?? (await getTeamAwardContexts(season));
	const teams = await idb.cache.teams.getAll();
	const gms = allGms(teams);

	const candidates: EoyCandidate[] = [];
	for (const t of teams) {
		const ctx = contexts.get(t.tid);
		if (!ctx) {
			continue;
		}
		const { gm, user } = frontOfficeFor(t, season, gms);
		candidates.push({
			tid: t.tid,
			abbrev: ctx.abbrev,
			region: ctx.region,
			name: gm
				? `${gm.firstName} ${gm.lastName}`
				: user
					? userName()
					: `${ctx.region} front office`,
			gmid: gm?.gmid,
			user,
			won: ctx.won,
			lost: ctx.lost,
			tied: ctx.tied,
			otl: ctx.otl,
			score: score("eoy", formula, ctx),
			vars: pickVars(ctx, EOY_VARIABLES),
		});
	}
	candidates.sort((a, b) =>
		compareCandidates(
			{ score: a.score, winp: a.vars.winp, id: a.tid },
			{ score: b.score, winp: b.vars.winp, id: b.tid },
		),
	);
	return { formula, candidates };
};

const teamLink = (tid: number, page = "roster") => {
	const info = g.get("teamInfoCache")[tid];
	if (!info) {
		return "a team";
	}
	return `the <a href="/l/${g.get("lid")}/${page}/${info.abbrev}_${tid}">${info.region} ${info.name}</a>`;
};

export type CoachAwardRow = {
	season: number;
	type: string;
	cid: number;
	name: string;
	tid: number;
};

/**
 * Give Coach of the Year for the current season (after the coaching staff's season records are written). Returns the winner
 */
export const awardCoachOfTheYear = async () => {
	if (!coyAvailable()) {
		return;
	}
	const season = g.get("season");
	const coaches = await idb.cache.coaches.getAll();
	const existing = coaches.find((c) =>
		c.awards.some((a) => a.season === season && a.type === COACH_OF_THE_YEAR),
	);
	if (existing) {
		return existing;
	}
	const { candidates } = await getCoyCandidates(season);
	const best = candidates[0];
	if (!best) {
		return;
	}
	const c = coaches.find((x) => x.cid === best.cid);
	if (!c) {
		return;
	}
	c.awards.push({ season, type: COACH_OF_THE_YEAR });
	await idb.cache.coaches.put(c);
	await logEvent({
		type: "award",
		text: `<a href="/l/${g.get("lid")}/coach/${c.cid}">${c.firstName} ${c.lastName}</a> of ${teamLink(best.tid, "staff")} won the ${COACH_OF_THE_YEAR} award.`,
		showNotification: false,
		tids: [best.tid],
		score: 10,
	});
	return c;
};

export type ExecAwardRow = {
	season: number;
	tid: number;
	abbrev: string;
	region: string;
	name: string;
	gmid?: number;
	user: boolean;
};

const execRowFromGm = (gm: Gm, a: { season: number; tid: number }) => {
	const info = g.get("teamInfoCache")[a.tid];
	return {
		season: a.season,
		tid: a.tid,
		abbrev: info?.abbrev ?? "",
		region: info?.region ?? "",
		name: `${gm.firstName} ${gm.lastName}`,
		gmid: gm.gmid,
		user: false,
	};
};

const execRowFromTeamSeason = (ts: TeamSeason): ExecAwardRow | undefined =>
	ts.execOfTheYear
		? {
				season: ts.season,
				tid: ts.tid,
				abbrev: ts.abbrev,
				region: ts.region,
				name: ts.execOfTheYear.name,
				user: ts.execOfTheYear.user,
			}
		: undefined;

// Executive of the Year winners of one season (one, unless something went wrong)
export const getExecAwardsForSeason = async (season: number) => {
	const out: ExecAwardRow[] = [];
	for (const gm of allGms(await idb.cache.teams.getAll())) {
		for (const a of gm.awards ?? []) {
			if (a.season === season && a.type === EXEC_OF_THE_YEAR) {
				out.push(execRowFromGm(gm, a));
			}
		}
	}
	for (const ts of await idb.merged.teamSeasons.getAll({ season })) {
		const row = execRowFromTeamSeason(ts);
		if (row) {
			out.push(row);
		}
	}
	return out;
};

// Every Executive of the Year, newest first
export const getExecAwards = async () => {
	const out: ExecAwardRow[] = [];
	const teams = await idb.cache.teams.getAll();
	for (const gm of allGms(teams)) {
		for (const a of gm.awards ?? []) {
			if (a.type === EXEC_OF_THE_YEAR) {
				out.push(execRowFromGm(gm, a));
			}
		}
	}
	const start = g.get("startingSeason");
	const end = g.get("season");
	for (const t of teams) {
		for (const ts of await idb.merged.teamSeasons.getAll({
			tid: t.tid,
			seasons: [start, end],
		})) {
			const row = execRowFromTeamSeason(ts);
			if (row) {
				out.push(row);
			}
		}
	}
	return out.sort((a, b) => b.season - a.season || a.tid - b.tid);
};

/**
 * Give Executive of the Year for the current season, before the GM carousel (so the GM who ran the season is still in charge).
 * Returns the winning candidate
 */
export const awardExecOfTheYear = async () => {
	if (!eoyAvailable()) {
		return;
	}
	const season = g.get("season");
	const already = await getExecAwardsForSeason(season);
	if (already.length > 0) {
		return;
	}
	const { candidates } = await getEoyCandidates(season);
	const best = candidates[0];
	if (!best) {
		return;
	}

	const t = await idb.cache.teams.get(best.tid);
	if (t?.gm && best.gmid === t.gm.gmid && !best.user) {
		t.gm.awards ??= [];
		t.gm.awards.push({ season, type: EXEC_OF_THE_YEAR, tid: best.tid });
		await idb.cache.teams.put(t);
	} else {
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			season,
			best.tid,
		]);
		if (!ts) {
			return;
		}
		ts.execOfTheYear = { name: best.name, user: best.user };
		await idb.cache.teamSeasons.put(ts);
	}

	const who = best.user
		? "You"
		: best.gmid !== undefined
			? `General manager <a href="/l/${g.get("lid")}/front_offices">${best.name}</a> of ${teamLink(best.tid)}`
			: `The front office of ${teamLink(best.tid)}`;
	await logEvent({
		type: "award",
		text: best.user
			? `${who} won the ${EXEC_OF_THE_YEAR} award for your work running ${teamLink(best.tid)}.`
			: `${who} won the ${EXEC_OF_THE_YEAR} award.`,
		showNotification: best.user,
		tids: [best.tid],
		score: 10,
	});
	return best;
};

export type CoachExecRace =
	| {
			kind: "coy";
			key: string;
			name: string;
			formula: string;
			candidates: (CoyCandidate & { id: number; odds?: number })[];
			// Who actually won, once the award has been given
			winnerId: number | undefined;
	  }
	| {
			kind: "eoy";
			key: string;
			name: string;
			formula: string;
			candidates: (EoyCandidate & { id: number; odds?: number })[];
			winnerId: number | undefined;
	  };

/**
 * The Coach of the Year and Executive of the Year races of a season (the ones available in this league), best first, with the
 * winner once it's been given. oddsFor turns the candidates' scores into win probabilities (Award Races, during the season)
 */
export const getCoachExecRaces = async (
	season: number,
	options: {
		limit?: number;
		formulas?: { coy?: string; eoy?: string };
		oddsFor?: (
			scores: { pid: number; score: number }[],
		) => Record<number, number> | undefined;
	} = {},
): Promise<CoachExecRace[]> => {
	const races: CoachExecRace[] = [];
	const coy = coyAvailable();
	const eoy = eoyAvailable();
	if (!coy && !eoy) {
		return races;
	}
	const limit = options.limit ?? 10;
	const contexts = await getTeamAwardContexts(season);

	if (coy) {
		const { formula, candidates } = await getCoyCandidates(season, {
			formula: options.formulas?.coy,
			contexts,
		});
		const withId = candidates.map((c) => ({ ...c, id: c.cid }));
		const odds = options.oddsFor?.(
			withId.map((c) => ({ pid: c.id, score: c.score })),
		);
		const winner = (await idb.cache.coaches.getAll()).find((c) =>
			c.awards.some((a) => a.season === season && a.type === COACH_OF_THE_YEAR),
		);
		races.push({
			kind: "coy",
			key: COY_KEY,
			name: COACH_OF_THE_YEAR,
			formula,
			candidates: withId
				.slice(0, limit)
				.map((c) => ({ ...c, odds: odds?.[c.id] })),
			winnerId: winner?.cid,
		});
	}

	if (eoy) {
		const { formula, candidates } = await getEoyCandidates(season, {
			formula: options.formulas?.eoy,
			contexts,
		});
		const withId = candidates.map((c) => ({ ...c, id: c.tid }));
		const odds = options.oddsFor?.(
			withId.map((c) => ({ pid: c.id, score: c.score })),
		);
		const winner = (await getExecAwardsForSeason(season))[0];
		races.push({
			kind: "eoy",
			key: EOY_KEY,
			name: EXEC_OF_THE_YEAR,
			formula,
			candidates: withId
				.slice(0, limit)
				.map((c) => ({ ...c, odds: odds?.[c.id] })),
			winnerId: winner?.tid,
		});
	}

	return races;
};
