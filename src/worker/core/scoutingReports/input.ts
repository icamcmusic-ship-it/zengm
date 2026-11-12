// Scouting reports, worker side: what the user's scouts can see of a player, gathered into a ScoutInput. This is the only place that
// reads players for the reports, and it only reads what the UI shows: ratings with the user's scouting fuzz (or nothing under the no
// visible ratings challenge), visible trait readings (hidden ones only once they are known), stats, measurements and public records.
// Never true prospect ratings, never hidden trait scores, never the aging curve.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { getPreDraftStats } from "../../../common/preDraft.ts";
import { getPreDraftLabel } from "../../../common/collegeStats/overseas.ts";
import {
	COMBINE_LOWER_BETTER,
	combinePercentiles,
	getCombine,
	prospectDistance,
	SIMILARITY_RATINGS,
	type CombineResults,
} from "../../../common/collegeStats/profile.ts";
import {
	getContractExp,
	getCurrentContract,
	getNearestContractAmount,
} from "../../../common/contracts.ts";
import { injuryBodyPart } from "../../../common/injuryBodyPart.ts";
import { TRAIT_DEFINITIONS } from "../../../common/playerTraits/definitions.ts";
import {
	categoryScores,
	getDepartment,
	GRADE_KEYS,
	outcomeName,
	outcomeTier,
	peerGroupOf,
	type CategoryScores,
	type GradeKey,
	type PeerGroup,
	type RoleScale,
	type ScoutComp,
	type ScoutDepartment,
	type ScoutInput,
	type ScoutProduction,
	type ScoutRatings,
	type ScoutTeamFit,
	type ScoutTraitReading,
	buildPeerTable,
	type PeerTable,
	departmentQualityForLevel,
} from "../../../common/scoutingReports/index.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import {
	DEFENSE_NAMES,
	OFFENSE_NAMES,
	fitToScore,
	playerSchemeFit,
} from "../../../common/coachSystems.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { isCollege } from "../college/isCollege.ts";
import { getCoachProfile } from "../staff/systems.ts";
import fuzzRating from "../player/fuzzRating.ts";
import getLevelLastThree from "../finances/getLevelLastThree.ts";
import genContract from "../player/genContract.ts";
import { getPlayerTraitsForUI } from "../player/traits.ts";
import { archetypeFor, getLeagueNorms } from "../player/archetype.ts";
import { expandedRatingsApply } from "../player/expandedRatings.ts";
import { getUncertainty } from "../draft/scouting.ts";

// Off in college leagues (no draft, contracts or trades to scout for): the pages are hidden there
export const scoutingReportsOn = () =>
	__SPORT === "basketball" && featureOn("scoutingReports") && !isCollege();

export const isProspectPlayer = (p: Pick<Player, "tid">) =>
	p.tid === PLAYER.UNDRAFTED || p.tid === PLAYER.UNDRAFTED_FANTASY_TEMP;

export const leagueSeed = () =>
	`${g.get("playerTraitsSeed") ?? 0}|${g.get("startingSeason")}`;

const RATING_KEYS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;

const EXPANDED_FUZZED = [
	"pdef",
	"idef",
	"oreb",
	"dreb",
	"csh",
	"dsh",
	"bsc",
] as const;

// A ratings row as the user sees it: fuzz on everything but height and wingspan (measurements), like the player page
export const scoutedRatingsOf = (
	row: Record<string, any> | undefined,
): ScoutRatings | undefined => {
	if (!row || typeof row.hgt !== "number") {
		return undefined;
	}
	const fuzz = row.fuzz ?? 0;
	const out = {} as ScoutRatings;
	for (const key of RATING_KEYS) {
		const value = row[key];
		if (typeof value !== "number") {
			return undefined;
		}
		out[key] = key === "hgt" ? value : fuzzRating(value, fuzz);
	}
	out.ovr = fuzzRating(row.ovr, fuzz);
	out.pot = fuzzRating(row.pot, fuzz);
	if (expandedRatingsApply(row)) {
		out.wng = row.wng;
		for (const key of EXPANDED_FUZZED) {
			if (typeof row[key] === "number") {
				out[key] = fuzzRating(row[key], fuzz);
			}
		}
	}
	return out;
};

const ratingsHidden = (p: Pick<Player, "tid">) =>
	!!g.get("challengeNoRatings") && p.tid !== PLAYER.RETIRED;

// The ratings row a report reads: the latest one (prospects: draft year), or a retired player's peak
const ratingsRowFor = (p: Player) => {
	if (p.tid === PLAYER.RETIRED) {
		let best = p.ratings[0] as any;
		for (const r of p.ratings as any[]) {
			if (
				fuzzRating(r.ovr, r.fuzz ?? 0) > fuzzRating(best.ovr, best.fuzz ?? 0)
			) {
				best = r;
			}
		}
		return best as Record<string, any>;
	}
	return p.ratings.at(-1) as Record<string, any>;
};

const SUM_KEYS = [
	"gp",
	"min",
	"pts",
	"orb",
	"drb",
	"ast",
	"tov",
	"stl",
	"blk",
	"fg",
	"fga",
	"tp",
	"tpa",
	"ft",
	"fta",
	"fgAtRim",
	"fgaAtRim",
	"fgLowPost",
	"fgaLowPost",
	"fgMidRange",
	"fgaMidRange",
	"ows",
	"dws",
] as const;

const productionFromRows = (
	rows: Record<string, any>[],
	season: number,
	team: string,
	level: ScoutProduction["level"],
): ScoutProduction | undefined => {
	if (rows.length === 0) {
		return undefined;
	}
	const t: Record<string, number> = {};
	for (const key of SUM_KEYS) {
		t[key] = rows.reduce(
			(a, r) => a + (typeof r[key] === "number" ? r[key] : 0),
			0,
		);
	}
	const gp = t.gp!;
	if (gp <= 0) {
		return undefined;
	}
	const wavg = (key: string) => {
		let sum = 0;
		let w = 0;
		for (const r of rows) {
			if (typeof r[key] === "number" && typeof r.min === "number") {
				sum += r[key] * r.min;
				w += r.min;
			}
		}
		return w > 0 ? sum / w : undefined;
	};
	const pg = (x: number) => x / gp;
	const pctOf = (made: number, att: number) =>
		att > 0 ? (100 * made) / att : 0;
	const hasLocations = t.fgaAtRim! + t.fgaLowPost! + t.fgaMidRange! > 0;
	return {
		season,
		team,
		level,
		gp,
		min: pg(t.min!),
		pts: pg(t.pts!),
		trb: pg(t.orb! + t.drb!),
		orb: pg(t.orb!),
		ast: pg(t.ast!),
		tov: pg(t.tov!),
		stl: pg(t.stl!),
		blk: pg(t.blk!),
		fga: pg(t.fga!),
		fgPct: pctOf(t.fg!, t.fga!),
		tpa: pg(t.tpa!),
		tpPct: pctOf(t.tp!, t.tpa!),
		fta: pg(t.fta!),
		ftPct: pctOf(t.ft!, t.fta!),
		...(level === "pro" && hasLocations
			? {
					rimA: pg(t.fgaAtRim!),
					rimPct: pctOf(t.fgAtRim!, t.fgaAtRim!),
					postA: pg(t.fgaLowPost!),
					postPct: pctOf(t.fgLowPost!, t.fgaLowPost!),
					midA: pg(t.fgaMidRange!),
					midPct: pctOf(t.fgMidRange!, t.fgaMidRange!),
				}
			: {}),
		per: level === "pro" ? wavg("per") : undefined,
		usg: level === "pro" ? wavg("usgp") : undefined,
		ws48:
			level === "pro" && t.min! > 0
				? ((t.ows! + t.dws!) * 48) / t.min!
				: undefined,
	};
};

const proRows = (p: Player, season: number) =>
	(p.stats as any[]).filter(
		(r) =>
			r.season === season &&
			!r.playoffs &&
			!(r.tid === PLAYER.DOES_NOT_EXIST && r.season <= (p.draft.year ?? 0)),
	);

export const proProductionFor = (p: Player, season: number) =>
	productionFromRows(proRows(p, season), season, "", "pro");

// His most relevant pro season: this one once he has 10 games, else last season
const currentProduction = (p: Player, season: number) => {
	const now = proProductionFor(p, season);
	if (now && now.gp >= 10) {
		return { production: now, prev: proProductionFor(p, season - 1) };
	}
	const last = proProductionFor(p, season - 1);
	if (last) {
		return { production: last, prev: proProductionFor(p, season - 2) };
	}
	return { production: now, prev: undefined };
};

export const preDraftProductionFor = (p: Player) => {
	const rows = getPreDraftStats(p).filter((r: any) => !r.playoffs) as any[];
	if (rows.length === 0) {
		return undefined;
	}
	const season = Math.max(...rows.map((r) => r.season));
	const seasonRows = rows.filter((r) => r.season === season);
	const teamName: string | undefined = seasonRows[0]?.teamName;
	const label = getPreDraftLabel(teamName);
	const careerYear = p.preDraftCareer?.years.find((y) => y.season === season);
	const level: ScoutProduction["level"] =
		careerYear?.level === "juco"
			? "juco"
			: label === "Overseas"
				? "overseas"
				: label === "G League"
					? "pro"
					: "college";
	const prod = productionFromRows(seasonRows, season, teamName ?? "", level);
	// Pre-draft rows have no shot locations or advanced stats worth reading
	return prod
		? {
				...prod,
				rimA: undefined,
				rimPct: undefined,
				postA: undefined,
				postPct: undefined,
				midA: undefined,
				midPct: undefined,
				per: undefined,
				usg: undefined,
				ws48: undefined,
			}
		: undefined;
};

// What the user can see of his traits: visible ones as read (estimate/range), hidden ones flagged so the report says "unknown" until known
export const traitReadingsFor = (
	p: Player,
	scoutingLevel: number,
	season: number,
): ScoutTraitReading[] | undefined => {
	if (!g.get("playerTraits")) {
		return undefined;
	}
	const ui = getPlayerTraitsForUI(p as any, {
		scoutingLevel,
		season,
		// Never God Mode: the report is the scouts' view
		godMode: false,
	});
	if (!ui) {
		return undefined;
	}
	return ui.traits.map((t) => {
		const hidden = TRAIT_DEFINITIONS[t.key].visibility === "hidden";
		const known = !hidden || t.exact;
		return {
			key: t.key,
			name: TRAIT_DEFINITIONS[t.key].name,
			hidden,
			// A hidden trait that isn't known carries no number at all
			estimate: known ? t.estimate : 50,
			low: known ? t.low : 0,
			high: known ? t.high : 100,
			exact: t.exact,
		};
	});
};

const awardsOf = (p: Player) => {
	const out = { allStar: 0, allLeague: 0, mvp: 0, dpoy: 0, champ: 0, roy: 0 };
	for (const a of p.awards as any[]) {
		if (a.season <= (p.draft.year ?? 0) && typeof a.type === "string") {
			continue;
		}
		const name: string = a.type ?? a.name ?? "";
		const team = a.numTeams !== undefined;
		const winner = team || (a.rank ?? 1) === 1;
		if (!winner) {
			continue;
		}
		if (name === "All-Star") {
			out.allStar += 1;
		} else if (/All-League/.test(name) && !/Rookie|Defensive/.test(name)) {
			out.allLeague += 1;
		} else if (
			/Most Valuable Player/.test(name) &&
			!/Playoff|Finals|All-Star/.test(name)
		) {
			out.mvp += 1;
		} else if (/Defensive Player of the Year/.test(name)) {
			out.dpoy += 1;
		} else if (/Won Championship/.test(name)) {
			out.champ += 1;
		} else if (/Rookie of the Year/.test(name)) {
			out.roy += 1;
		}
	}
	return out;
};

const proSeasonsOf = (p: Player) =>
	new Set(
		(p.stats as any[])
			.filter(
				(r) =>
					!r.playoffs &&
					(r.gp ?? 0) >= 10 &&
					!(r.tid === PLAYER.DOES_NOT_EXIST && r.season <= (p.draft.year ?? 0)),
			)
			.map((r) => r.season),
	).size;

// Peak visible ovr of a career
const peakOf = (p: Player) => {
	let best: { ovr: number; season: number; age: number } | undefined;
	for (const r of p.ratings as any[]) {
		if (isProspectPlayer(p) || r.season <= (p.draft.year ?? -Infinity)) {
			continue;
		}
		const ovr = fuzzRating(r.ovr, r.fuzz ?? 0);
		if (!best || ovr > best.ovr) {
			best = { ovr, season: r.season, age: r.season - p.born.year };
		}
	}
	return best;
};

// ---- context: once per request ----

export type ReportCtx = {
	season: number;
	phase: number;
	userTid: number;
	seed: string;
	startingSeason: number;
	numTeams: number;
	numPicks: number;
	roleScale: RoleScale;
	scoutingLevel: number;
	dept: ScoutDepartment;
	salaryCap: number;
	expanded: boolean;
	userPlayers: Player[];
	peerCache: Map<string, PeerTable>;
	compIndex?: CompIndex;
	teamNames: Map<number, string>;
	teamAbbrevs: Map<number, string>;
};

let ctxCache: { key: string; time: number; ctx: ReportCtx } | undefined;

export const clearScoutingCache = () => {
	ctxCache = undefined;
};

const getRoleScale = async (): Promise<RoleScale> => {
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	]);
	const ovrs = players
		.map((p) => {
			const r = p.ratings.at(-1) as any;
			return fuzzRating(r.ovr, r.fuzz ?? 0);
		})
		.sort((a, b) => b - a);
	const n = Math.max(2, g.get("numActiveTeams"));
	const at = (rank: number, fallback: number) =>
		ovrs.length > 0
			? ovrs[Math.min(ovrs.length - 1, Math.max(0, Math.round(rank) - 1))]!
			: fallback;
	return {
		franchise: Math.max(at(Math.max(3, n / 6), 70), at(1, 70) - 4),
		allStar: at((24 * n) / 30, 62),
		qualityStarter: at(2.5 * n, 57),
		starter: at(5 * n, 52),
		rotation: at(8 * n, 47),
		bench: at(12 * n, 42),
	};
};

export const getReportCtx = async (viewerTid?: number): Promise<ReportCtx> => {
	const userTid = viewerTid ?? g.get("userTid");
	const key = `${g.get("lid")}|${g.get("season")}|${g.get("phase")}|${userTid}|${g.get("challengeNoRatings") ? 1 : 0}`;
	if (ctxCache && ctxCache.key === key && Date.now() - ctxCache.time < 15000) {
		return ctxCache.ctx;
	}
	const season = g.get("season");
	const scoutingLevel = await getLevelLastThree("scouting", { tid: userTid });
	const teams = await idb.cache.teams.getAll();
	const ctx: ReportCtx = {
		season,
		phase: g.get("phase"),
		userTid,
		seed: leagueSeed(),
		startingSeason: g.get("startingSeason"),
		numTeams: Math.max(1, g.get("numActiveTeams")),
		numPicks:
			Math.max(1, g.get("numActiveTeams")) *
			Math.max(1, g.get("numDraftRounds")),
		roleScale: await getRoleScale(),
		scoutingLevel,
		dept: getDepartment({
			leagueSeed: leagueSeed(),
			tid: userTid,
			season,
			level: scoutingLevel,
			startingSeason: g.get("startingSeason"),
		}),
		salaryCap: g.get("salaryCap"),
		expanded: featureOn("expandedRatings"),
		userPlayers: await idb.cache.players.indexGetAll("playersByTid", userTid),
		peerCache: new Map(),
		teamNames: new Map(teams.map((t) => [t.tid, `${t.region} ${t.name}`])),
		teamAbbrevs: new Map(teams.map((t) => [t.tid, t.abbrev])),
	};
	ctxCache = { key, time: Date.now(), ctx };
	return ctx;
};

export const departmentFor = async (tid: number, season = g.get("season")) => {
	const level = await getLevelLastThree("scouting", { tid });
	return getDepartment({
		leagueSeed: leagueSeed(),
		tid,
		season,
		level,
		startingSeason: g.get("startingSeason"),
	});
};

// ---- light view of a player (peers, snapshots) ----

export type Light = {
	p: Player;
	group: PeerGroup;
	ratings: ScoutRatings | undefined;
	production: ScoutProduction | undefined;
	traits: ScoutTraitReading[] | undefined;
	scores: CategoryScores;
};

export const lightOf = (p: Player, ctx: ReportCtx): Light => {
	const row = ratingsRowFor(p);
	const ratings = ratingsHidden(p) ? undefined : scoutedRatingsOf(row);
	const prospect = isProspectPlayer(p);
	const production = prospect
		? preDraftProductionFor(p)
		: p.tid === PLAYER.RETIRED
			? proProductionFor(p, row?.season ?? ctx.season)
			: currentProduction(p, ctx.season).production;
	const traits = traitReadingsFor(p, ctx.scoutingLevel, ctx.season);
	const group = peerGroupOf(row?.pos ?? "F");
	return {
		p,
		group,
		ratings,
		production,
		traits,
		scores: categoryScores({ ratings, production, group, traits }),
	};
};

// Peers: this draft class's (prospects), or the league's active players (pros and retired), in his group
export const getPeers = async (
	ctx: ReportCtx,
	kind: "prospect" | "pro",
	group: PeerGroup,
	draftYear: number,
) => {
	const key = `${kind}|${group}|${kind === "prospect" ? draftYear : ""}`;
	const cached = ctx.peerCache.get(key);
	if (cached) {
		return cached;
	}
	let players: Player[];
	let label: string;
	if (kind === "prospect") {
		players = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		).filter((p) => p.draft.year === draftYear);
		label = `${draftYear} draft class`;
	} else {
		players = await idb.cache.players.indexGetAll("playersByTid", [
			0,
			Infinity,
		]);
		label = "league";
	}
	let lights = players.map((p) => lightOf(p, ctx));
	const inGroup = lights.filter((x) => x.group === group);
	if (inGroup.length >= 8) {
		lights = inGroup;
	}
	const table = buildPeerTable(
		label,
		lights.map((x) => x.scores),
		group,
	);
	ctx.peerCache.set(key, table);
	return table;
};

// ---- comparisons ----

type CompEntry = {
	pid: number;
	name: string;
	season: number;
	age: number;
	pos: string;
	ratings: Record<string, number>;
	ovr: number;
	draftYear: number;
	draftPick?: number;
	outcome: string;
};

type CompIndex = { draft: CompEntry[]; pro: CompEntry[] };

let compCache: { key: string; index: CompIndex } | undefined;

const outcomeFor = (p: Player, scale: RoleScale, season: number) => {
	const peak = peakOf(p);
	const proSeasons = proSeasonsOf(p);
	if (p.tid !== PLAYER.RETIRED && season - p.draft.year < 3) {
		return "too early to tell";
	}
	const tier = outcomeTier({
		peakOvr: peak?.ovr ?? 0,
		awards: awardsOf(p),
		proSeasons,
		scale,
	});
	return outcomeName(tier);
};

// Past players of this league: their draft-year ratings (draft comps) and their rating rows by age (pro comps). Built once per season
const getCompIndex = async (ctx: ReportCtx) => {
	const key = `${g.get("lid")}|${ctx.season}|${ctx.phase}`;
	if (compCache?.key === key) {
		return compCache.index;
	}
	const draft: CompEntry[] = [];
	const pro: CompEntry[] = [];
	const players = await idb.merged.players.getAll({ activeAndRetired: true });
	for (const p of players) {
		const name = `${p.firstName} ${p.lastName}`;
		const outcome = outcomeFor(p, ctx.roleScale, ctx.season);
		const draftPick =
			p.draft.round > 0
				? (p.draft.round - 1) * ctx.numTeams + p.draft.pick
				: undefined;
		for (const r of p.ratings as any[]) {
			if (r.season >= ctx.season) {
				continue;
			}
			const ratings: Record<string, number> = {};
			for (const k of SIMILARITY_RATINGS) {
				ratings[k] = k === "hgt" ? r[k] : fuzzRating(r[k], r.fuzz ?? 0);
			}
			const entry = {
				pid: p.pid,
				name,
				season: r.season,
				age: r.season - p.born.year,
				pos: r.pos,
				ratings,
				ovr: fuzzRating(r.ovr, r.fuzz ?? 0),
				draftYear: p.draft.year,
				draftPick,
				outcome,
			};
			if (r.season === p.draft.year) {
				draft.push(entry);
			} else if (r.season > p.draft.year) {
				pro.push(entry);
			}
		}
	}
	const index = { draft, pro };
	compCache = { key, index };
	return index;
};

export const compsFor = async (
	p: Player,
	ratings: ScoutRatings | undefined,
	age: number,
	pos: string,
	kind: ScoutInput["kind"],
	ctx: ReportCtx,
	quality: number,
): Promise<ScoutComp[]> => {
	if (!ratings || kind === "retired") {
		return [];
	}
	const index = await getCompIndex(ctx);
	// A weaker department sees the player less clearly, and picks worse comparisons
	const rng = new Rng(`comps|${ctx.seed}|${p.pid}|${ctx.dept.tid}`);
	const noisy: Record<string, number> = {};
	for (const k of SIMILARITY_RATINGS) {
		noisy[k] = (ratings as any)[k] + rng.normal(0, 1) * 5 * (1 - quality);
	}
	const mine = { ratings: noisy, age, pos, ovr: ratings.ovr };
	const pool =
		kind === "prospect"
			? index.draft
			: index.pro.filter((e) => Math.abs(e.age - age) <= 1);
	const scored = pool
		.filter((e) => e.pid !== p.pid)
		.map((e) => ({ e, d: prospectDistance(mine, e) }))
		.sort((a, b) => a.d - b.d);
	const out: ScoutComp[] = [];
	const seen = new Set<number>();
	for (const { e, d } of scored) {
		if (seen.has(e.pid)) {
			continue;
		}
		seen.add(e.pid);
		out.push({
			pid: e.pid,
			name: e.name,
			when:
				kind === "prospect"
					? `${e.draftYear} draft${e.draftPick !== undefined ? `, No. ${e.draftPick}` : ", undrafted"}`
					: `at ${e.age} (${e.season})`,
			outcome: e.outcome,
			similarity: Math.max(0, Math.round(100 - 4 * d)),
		});
		if (out.length >= 3) {
			break;
		}
	}
	return out;
};

// ---- the combine (prospects) ----

const COMBINE_SHOW: [keyof CombineResults, string, (x: number) => string][] = [
	[
		"heightNoShoes",
		"Height",
		(x) =>
			`${Math.floor(x / 12)}'${(x % 12).toFixed(2).replace(/\.?0+$/, "")}"`,
	],
	[
		"wingspan",
		"Wingspan",
		(x) =>
			`${Math.floor(x / 12)}'${(x % 12).toFixed(2).replace(/\.?0+$/, "")}"`,
	],
	[
		"standingReach",
		"Standing reach",
		(x) => `${Math.floor(x / 12)}'${(x % 12).toFixed(1).replace(/\.0$/, "")}"`,
	],
	["maxVert", "Max vert", (x) => `${x}"`],
	["laneAgility", "Lane agility", (x) => `${x.toFixed(2)}s`],
	["sprint", "Sprint", (x) => `${x.toFixed(2)}s`],
	["bench", "Bench", (x) => `${x} reps`],
];

// The combine numbers the College/Overseas page shows (same function, same inputs), with percentiles in his class
const combineOf = (p: Player): CombineResults | undefined => {
	const r = p.ratings.find((x: any) => x.season === p.draft.year) as any;
	if (!r) {
		return undefined;
	}
	return getCombine({
		pid: p.pid,
		heightInches: p.hgt,
		weight: p.weight,
		ratings: {
			hgt: r.hgt,
			stre: r.stre,
			spd: r.spd,
			jmp: r.jmp,
			endu: r.endu,
			wingspanGap: expandedRatingsApply(r) ? r.wng - r.hgt : undefined,
		},
	});
};

const combineFor = async (p: Player) => {
	if (!featureOn("collegeStats")) {
		return undefined;
	}
	const mine = combineOf(p);
	if (!mine) {
		return undefined;
	}
	const classPlayers = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const all = classPlayers
		.filter((x) => x.draft.year === p.draft.year)
		.map(combineOf)
		.filter((x): x is CombineResults => !!x);
	const pcts = combinePercentiles(mine, all.length > 0 ? all : [mine]);
	return COMBINE_SHOW.map(([key, label, fmt]) => ({
		label,
		value: fmt(mine[key]),
		pct: pcts[key].pct,
		lowerBetter: COMBINE_LOWER_BETTER.has(key),
	})).map(({ lowerBetter: _l, ...rest }) => rest);
};

// ---- team fit ----

const teamFitFor = async (
	ctx: ReportCtx,
	ratings: ScoutRatings | undefined,
	group: PeerGroup,
	pid: number,
): Promise<ScoutTeamFit | undefined> => {
	if (ctx.userTid < 0) {
		return undefined;
	}
	const roster = ctx.userPlayers.filter((x) => x.pid !== pid);
	const lights = roster
		.map((x) => lightOf(x, ctx))
		.sort((a, b) => (b.ratings?.ovr ?? 0) - (a.ratings?.ovr ?? 0));
	const sameGroup = lights
		.filter((x) => x.group === group)
		.map((x) => ({
			name: `${x.p.firstName} ${x.p.lastName}`,
			ovr: x.ratings?.ovr ?? 0,
			age: ctx.season - x.p.born.year,
		}));
	// The roster's best three at each skill against the league's players
	const league = await getPeers(ctx, "pro", group, 0);
	const rosterNeeds: GradeKey[] = [];
	const rosterStrengths: GradeKey[] = [];
	const top = lights.slice(0, 9);
	for (const key of GRADE_KEYS) {
		if (key === "shoot" || key === "cs" || key === "od" || key === "ft") {
			continue;
		}
		const vals = top
			.map((x) => x.scores[key])
			.sort((a, b) => b - a)
			.slice(0, 3);
		if (vals.length === 0) {
			continue;
		}
		const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
		const list = league.scores[key];
		const rank = list.filter((x) => x < avg).length / Math.max(1, list.length);
		if (rank < 0.6) {
			rosterNeeds.push(key);
		} else if (rank >= 0.9) {
			rosterStrengths.push(key);
		}
	}
	let systemFit: ScoutTeamFit["systemFit"];
	if (ratings && featureOn("coachSystems") && featureOn("coachingStaff")) {
		const coaches = await idb.cache.coaches.indexGetAll(
			"coachesByTid",
			ctx.userTid,
		);
		const head = coaches.find((c) => c.role === "head");
		if (head) {
			const profile = getCoachProfile(head);
			const f = playerSchemeFit({ ...ratings });
			systemFit = {
				score: fitToScore(0.6 * f.off[profile.off] + 0.4 * f.def[profile.def]),
				offense: OFFENSE_NAMES[profile.off],
				defense: DEFENSE_NAMES[profile.def],
				coach: `${head.firstName} ${head.lastName}`,
			};
		}
	}
	return {
		teamName: ctx.teamNames.get(ctx.userTid) ?? "team",
		sameGroup,
		rosterNeeds,
		rosterStrengths,
		systemFit,
	};
};

const developmentFor = async (ctx: ReportCtx) => {
	if (!featureOn("coachingStaff") || ctx.userTid < 0) {
		return undefined;
	}
	const coaches = await idb.cache.coaches.indexGetAll(
		"coachesByTid",
		ctx.userTid,
	);
	const head = coaches.find((c) => c.role === "head");
	const dev = coaches.find((c) => c.role === "dev");
	let philosophy: number | undefined;
	if (head && featureOn("coachSystems")) {
		philosophy = getCoachProfile(head).philosophy;
	}
	return {
		philosophy,
		staffDev: dev?.ratings.dev,
		coachName: head ? `${head.firstName} ${head.lastName}` : undefined,
	};
};

// Where our board has a prospect: by what our scouts see (valueFuzz), not the true value
const projectedPickFor = async (p: Player) => {
	const classPlayers = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	)
		.filter((x) => x.draft.year === p.draft.year)
		.sort((a, b) => b.valueFuzz - a.valueFuzz);
	const i = classPlayers.findIndex((x) => x.pid === p.pid);
	return i >= 0 ? i + 1 : undefined;
};

export const buildInput = async (
	p: Player,
	ctx: ReportCtx,
	{ light = false }: { light?: boolean } = {},
): Promise<ScoutInput> => {
	const prospect = isProspectPlayer(p);
	const retired = p.tid === PLAYER.RETIRED;
	const kind: ScoutInput["kind"] = prospect
		? "prospect"
		: retired
			? "retired"
			: "pro";
	const row = ratingsRowFor(p);
	const hidden = ratingsHidden(p);
	const ratings = hidden ? undefined : scoutedRatingsOf(row);
	const prevRow =
		!prospect && !retired
			? (p.ratings as any[]).findLast(
					(r) => r.season < (row?.season ?? ctx.season),
				)
			: undefined;
	const prevRatings = hidden ? undefined : scoutedRatingsOf(prevRow);
	const season = retired ? (row?.season ?? ctx.season) : ctx.season;
	const age = (prospect ? p.draft.year : season) - p.born.year;
	const pos = row?.pos ?? "F";
	const group = peerGroupOf(pos);
	const cur = prospect
		? { production: undefined, prev: undefined }
		: retired
			? {
					production: proProductionFor(p, season),
					prev: proProductionFor(p, season - 1),
				}
			: currentProduction(p, ctx.season);
	const preDraft = preDraftProductionFor(p);
	const traits = traitReadingsFor(p, ctx.scoutingLevel, ctx.season);
	const injuries = (p.injuries ?? [])
		.filter((i) => i.games > 0)
		.map((i) => ({
			season: i.season,
			type: i.type,
			part: injuryBodyPart(i.type),
			games: i.games,
		}));
	const scouting = p.scouting ?? [];
	const yearsOut = prospect ? Math.max(0, p.draft.year - ctx.season) : 0;
	const proSeasons = proSeasonsOf(p);
	const uncertainty = prospect
		? getUncertainty(scouting) *
				(1.3 - 0.6 * departmentQualityForLevel(ctx.scoutingLevel)) +
			0.7 * yearsOut
		: retired
			? 0
			: Math.max(0.4, 1.8 - 0.45 * proSeasons);
	let archetype: string | undefined;
	if (ratings && featureOn("archetypes")) {
		const found = archetypeFor(p, await getLeagueNorms());
		if (found) {
			// Only the archetype's name (no 2K build lists or "also close to")
			archetype = found.view.name;
		}
	}
	const current = !prospect && !retired ? getCurrentContract(p) : undefined;
	const contract = current
		? {
				amount: getNearestContractAmount(current, ctx.season),
				exp: getContractExp(current),
			}
		: undefined;
	const marketValue =
		!prospect && !retired
			? genContract({ ...p, value: p.valueFuzz } as any, false).amount
			: undefined;
	const draftPick =
		p.draft.round > 0
			? (p.draft.round - 1) * ctx.numTeams + p.draft.pick
			: undefined;
	const input: ScoutInput = {
		pid: p.pid,
		name: `${p.firstName} ${p.lastName}`,
		kind,
		pos,
		age,
		heightInches: p.hgt,
		weight: p.weight,
		season,
		ratings,
		prevRatings,
		production: cur.production,
		prevProduction: cur.prev,
		proSeasons,
		preDraft,
		traits,
		injuries,
		injury:
			p.injury.gamesRemaining > 0
				? {
						type: p.injury.type,
						part: injuryBodyPart(p.injury.type),
						games: p.injury.gamesRemaining,
					}
				: undefined,
		combine: prospect && !light ? await combineFor(p) : undefined,
		archetype,
		looks:
			prospect && g.get("scoutingSystem")
				? (p.scouting ?? []).length
				: undefined,
		uncertainty,
		draft: {
			year: p.draft.year,
			round: p.draft.round,
			pick: p.draft.pick,
			abbrev: p.draft.tid >= 0 ? ctx.teamAbbrevs.get(p.draft.tid) : undefined,
		},
		projectedPick: prospect ? await projectedPickFor(p) : draftPick,
		numPicks: ctx.numPicks,
		contract,
		marketValue,
		salaryCap: ctx.salaryCap,
		awards: awardsOf(p),
		peak: retired ? peakOf(p) : undefined,
		expandedRatings: ctx.expanded,
		story: p.preDraftCareer?.story,
		fit: light ? undefined : await teamFitFor(ctx, ratings, group, p.pid),
		comps: light
			? []
			: await compsFor(p, ratings, age, pos, kind, ctx, ctx.dept.quality),
		roleScale: ctx.roleScale,
		development: light ? undefined : await developmentFor(ctx),
		teamName: p.tid >= 0 ? ctx.teamNames.get(p.tid) : undefined,
		onUserTeam: p.tid === ctx.userTid,
		retiredSeason: retired ? p.retiredYear : undefined,
	};
	return input;
};

export const PHASES_WITH_SNAPSHOTS = new Set<number>([
	PHASE.PRESEASON,
	PHASE.AFTER_TRADE_DEADLINE,
	PHASE.PLAYOFFS,
	PHASE.DRAFT_LOTTERY,
]);
