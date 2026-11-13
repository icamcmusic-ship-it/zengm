import { PLAYER, PLAYER_STATS_TABLES } from "../../common/constants.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { player } from "../core/index.ts";
import { getCommon } from "./player.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { getCollegeSeason } from "../core/draft/collegeSeason.ts";
import { featureOn } from "../util/nativeFeatures.ts";
import { getScoutReport } from "../core/draft/scouting.ts";
import {
	getPlayerCombine,
	lotteryNightOn,
} from "../core/draftCombine/index.ts";
import {
	COLLEGE_AWARD_PREFIX,
	getPreDraftAwards,
	getPreDraftStats,
	getProStats,
} from "../../common/preDraft.ts";
import {
	PRO_SHORT,
	getLeagueEnv,
	getPreDraftLabel,
} from "../../common/collegeStats/overseas.ts";
import { getSchool } from "../../common/collegeStats/colleges.helpers.ts";
import {
	getTeamIndex,
	getTeamSummary,
	ncaaResultText,
	type NcaaSeason,
	type ProspectNcaaSummary,
} from "../../common/collegeStats/ncaa.ts";
import type { SplitLine } from "../../common/collegeStats/season.ts";
import { Rng } from "../../common/collegeStats/rng.ts";
import {
	SIMILARITY_RATINGS,
	combinePercentiles,
	estimateRecord,
	getClub,
	getCombine,
	getHeadCoach,
	getRecruitingExtras,
	getStockTimeline,
	starsForRank,
	prospectDistance,
	type CombineResults,
	type TeamRecord,
} from "../../common/collegeStats/profile.ts";
import type { MinimalPlayerRatings, Player } from "../../common/types.ts";
import {
	JUCO_LEAGUE,
	getStoryText,
	isJuco,
	type CareerYear,
	type StoredPreDraftCareer,
} from "../../common/collegeStats/career.ts";
import { COLLEGES } from "../../common/collegeStats/colleges.ts";
import {
	getScoutingReport,
	type ReportRatings,
} from "../../common/collegeStats/scoutingReport.ts";
import {
	draftRatings as draftRatingsRow,
	getHsClassRanks,
	getRecruitBasis,
} from "../core/draft/recruiting.ts";
import { archetypeFor, getLeagueNorms } from "../core/player/archetype.ts";
import { expandedRatingsApply } from "../core/player/expandedRatings.ts";

type PlayerRatings = MinimalPlayerRatings & Record<string, any>;

const CLASS_NAMES = ["Fr.", "So.", "Jr.", "Sr.", "Gr."];

// His ratings row in his draft year: the last one from before he became a pro
const draftRatings = (p: Player): PlayerRatings | undefined =>
	draftRatingsRow(p);

/**
 * His stored career (schools year by year, redshirt years, story), if it still matches his stats rows: every season he has a row for is a year of it at the same school, and every year he played has a row. Rows replaced since (an edited player, an import) leave it unused, and the page falls back to what the rows say.
 */
const validCareer = (
	p: Player,
	rows: { season: number; teamName?: string }[],
): StoredPreDraftCareer | undefined => {
	const career = p.preDraftCareer;
	if (!career || !Array.isArray(career.years) || career.years.length === 0) {
		return undefined;
	}
	const bySeason = new Map(career.years.map((year) => [year.season, year]));
	if (bySeason.size !== career.years.length) {
		return undefined;
	}
	for (const row of rows) {
		const year = bySeason.get(row.season);
		if (!year || year.school !== (row.teamName ?? p.college ?? "")) {
			return undefined;
		}
	}
	const rowSeasons = new Set(rows.map((row) => row.season));
	if (rowSeasons.size !== rows.length) {
		return undefined;
	}
	for (const year of career.years) {
		if (year.status !== "redshirt" && !rowSeasons.has(year.season)) {
			return undefined;
		}
	}
	return career;
};

let programsCache: { name: string; strength: number }[] | undefined;
const getPrograms = () => {
	programsCache ??= Object.keys(COLLEGES).map((name) => ({
		name,
		strength: getSchool(name)!.strength,
	}));
	return programsCache;
};

const CAREER_NOTES: Record<string, string> = {
	redshirt: "Redshirt year (did not play)",
	medical: "Medical redshirt",
	injury: "Season-ending injury",
};

const isProspect = (p: Player) =>
	p.tid === PLAYER.UNDRAFTED || p.tid === PLAYER.UNDRAFTED_FANTASY_TEMP;

const combineFor = (p: Player): CombineResults | undefined => {
	const r = draftRatings(p);
	if (!r) {
		return undefined;
	}
	// wng is on the hgt scale, so what matters is how far it is from his height rating. Only with the setting on: a row can keep wng from
	// when the setting was on before
	const wingspanGap = expandedRatingsApply(r) ? r.wng - r.hgt : undefined;
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
			wingspanGap,
		},
	});
};

const getNumPicks = () =>
	Math.max(1, g.get("numActiveTeams")) * Math.max(1, g.get("numDraftRounds"));

const overallPick = (p: Player) =>
	p.draft.round > 0
		? (p.draft.round - 1) * Math.max(1, g.get("numActiveTeams")) + p.draft.pick
		: undefined;

// Computed on first use: the regular/advanced stats tables only exist in basketball, and this module is loaded in every sport
const statsPerGame = () =>
	(PLAYER_STATS_TABLES.regular?.stats ?? []).filter(
		(stat) => !stat.endsWith("Max"),
	);
const statsAdvanced = () =>
	(PLAYER_STATS_TABLES.advanced?.stats ?? []).filter(
		(stat) => stat !== "onOff100" && stat !== "pm100",
	);

const formatTable = async (
	pRaw: Player,
	stats: string[],
	statType: "perGame" | "totals",
) => {
	const rawRows = getPreDraftStats(pRaw).filter((row) => !row.playoffs);
	const formatted: any = await player.format(pRaw, {
		stats: ["season", "age", ...stats] as any[],
		seasonType: "regularSeason",
		statType,
		preDraftStats: "only",
		mergeStats: "none",
	});
	if (!formatted || formatted.stats.length !== rawRows.length) {
		return {
			rows: [] as Record<string, any>[],
			career: undefined as Record<string, any> | undefined,
		};
	}
	return {
		rows: (formatted.stats as Record<string, any>[])
			.map(
				(row, i): Record<string, any> => ({
					...row,
					teamName: rawRows[i]!.teamName ?? pRaw.college ?? "",
				}),
			)
			.filter((row) => (row.gp ?? 0) > 0),
		career: formatted.careerStats as Record<string, any> | undefined,
	};
};

export type SplitRow = {
	name: string;
	record?: [number, number];
	line: SplitLine;
	estimated?: boolean;
};

const addLines = (lines: SplitLine[]): SplitLine => {
	const out = { ...lines[0]! };
	for (const key of Object.keys(out) as (keyof SplitLine)[]) {
		out[key] = lines.reduce((sum, line) => sum + line[key], 0);
	}
	return out;
};

const gameLine = (games: ProspectNcaaSummary["games"]): SplitLine => ({
	gp: games.length,
	min: games.reduce((a, x) => a + x.min, 0),
	pts: games.reduce((a, x) => a + x.pts, 0),
	orb: 0,
	drb: games.reduce((a, x) => a + x.trb, 0),
	ast: games.reduce((a, x) => a + x.ast, 0),
	stl: games.reduce((a, x) => a + x.stl, 0),
	blk: games.reduce((a, x) => a + x.blk, 0),
	tov: games.reduce((a, x) => a + x.tov, 0),
	fg: games.reduce((a, x) => a + x.fg, 0),
	fga: games.reduce((a, x) => a + x.fga, 0),
	tp: games.reduce((a, x) => a + x.tp, 0),
	tpa: games.reduce((a, x) => a + x.tpa, 0),
	ft: games.reduce((a, x) => a + x.ft, 0),
	fta: games.reduce((a, x) => a + x.fta, 0),
	pf: 0,
});

/**
 * Non-conference, conference, conference tournament and NCAA tournament splits of his draft year season. Stats generated before splits were stored get the regular season split by his team's schedule (marked estimated).
 */
const getSplits = (
	summary: ProspectNcaaSummary,
	seasonRow: Record<string, number> | undefined,
	pid: number,
	// His season ended early: the team's postseason games are not his, and are not in summary.games
	missedPostseason: boolean,
): SplitRow[] => {
	const conf = summary.games.filter((game) => game.event === "conf");
	const ncaa = summary.games.filter((game) => game.event === "ncaa");
	const nit = summary.games.filter((game) => game.event === "nit");
	const wl = (games: typeof conf): [number, number] => [
		games.filter((x) => x.won).length,
		games.filter((x) => !x.won).length,
	];
	const post = wl(summary.games);
	const regularTeam = summary.w + summary.l - summary.games.length;
	const nonConfRecord: [number, number] = [
		summary.w - summary.confW - post[0],
		summary.l - summary.confL - post[1],
	];
	const output: SplitRow[] = [];
	let nonConf = summary.splits?.nonConf;
	let confLine = summary.splits?.conf;
	let estimated = false;
	if ((!nonConf || !confLine) && seasonRow && regularTeam > 0) {
		// Regular season = season - postseason, split by his team's schedule
		const postLine = gameLine(summary.games);
		const regular: SplitLine = {
			gp: Math.max(0, seasonRow.gp! - postLine.gp),
			min: Math.max(0, seasonRow.min! - postLine.min),
			pts: Math.max(0, seasonRow.pts! - postLine.pts),
			orb: 0,
			// Game lines only have total rebounds, kept in drb
			drb: Math.max(0, seasonRow.drb! + seasonRow.orb! - postLine.drb),
			ast: Math.max(0, seasonRow.ast! - postLine.ast),
			stl: Math.max(0, seasonRow.stl! - postLine.stl),
			blk: Math.max(0, seasonRow.blk! - postLine.blk),
			tov: Math.max(0, seasonRow.tov! - postLine.tov),
			fg: Math.max(0, seasonRow.fg! - postLine.fg),
			fga: Math.max(0, seasonRow.fga! - postLine.fga),
			tp: Math.max(0, seasonRow.tp! - postLine.tp),
			tpa: Math.max(0, seasonRow.tpa! - postLine.tpa),
			ft: Math.max(0, seasonRow.ft! - postLine.ft),
			fta: Math.max(0, seasonRow.fta! - postLine.fta),
			pf: seasonRow.pf!,
		};
		const share =
			(nonConfRecord[0] + nonConfRecord[1]) / Math.max(1, regularTeam);
		const rng = new Rng(`splits|${pid}`);
		const ncGp = Math.round(regular.gp * share);
		nonConf = { ...regular };
		confLine = { ...regular };
		for (const key of Object.keys(regular) as (keyof SplitLine)[]) {
			const part =
				key === "gp"
					? ncGp
					: Math.round(
							regular[key] *
								(regular.gp > 0 ? ncGp / regular.gp : 0) *
								(1 +
									(key === "pts" || key === "fg" ? 0.04 : 0) +
									rng.normal(0, 0.03)),
						);
			nonConf[key] = Math.min(regular[key], Math.max(0, part));
			confLine[key] = regular[key] - nonConf[key];
		}
		nonConf.fg = Math.min(nonConf.fg, nonConf.fga);
		nonConf.tp = Math.min(nonConf.tp, nonConf.tpa, nonConf.fg);
		nonConf.ft = Math.min(nonConf.ft, nonConf.fta);
		confLine.fg = regular.fg - nonConf.fg;
		confLine.tp = regular.tp - nonConf.tp;
		confLine.ft = regular.ft - nonConf.ft;
		estimated = true;
	}
	if (nonConf && confLine) {
		output.push(
			{
				name: "Non-conference",
				record: missedPostseason ? undefined : nonConfRecord,
				line: nonConf,
				estimated,
			},
			{
				name: `${summary.conf} (regular season)`,
				record: [summary.confW, summary.confL],
				line: confLine,
				estimated,
			},
		);
	}
	if (conf.length > 0) {
		output.push({
			name: `${summary.conf} Tournament`,
			record: wl(conf),
			line: gameLine(conf),
		});
	}
	if (ncaa.length > 0) {
		output.push({
			name: "NCAA Tournament",
			record: wl(ncaa),
			line: gameLine(ncaa),
		});
	}
	if (nit.length > 0) {
		output.push({
			name: "NIT",
			record: wl(nit),
			line: gameLine(nit),
		});
	}
	if (output.length > 1 && nonConf && confLine) {
		output.push({
			name: "Postseason",
			record: post,
			line: addLines([gameLine(summary.games)]),
		});
	}
	return output;
};

const getPreDraftInfo = async (pRaw: Player) => {
	const draftYear = pRaw.draft.year;
	const rawRows = getPreDraftStats(pRaw).filter((row) => !row.playoffs);
	const honors = getPreDraftAwards(pRaw).map((award) => ({
		season: award.season,
		type: award.type!.replace(COLLEGE_AWARD_PREFIX, ""),
	}));
	const summary = featureOn("collegeSeason")
		? pRaw.collegeSeason?.summary
		: undefined;

	if (rawRows.length === 0 && honors.length === 0 && !summary) {
		return undefined;
	}

	const [perGame, totals, advanced] = await Promise.all([
		formatTable(pRaw, statsPerGame(), "perGame"),
		formatTable(pRaw, statsPerGame(), "totals"),
		formatTable(pRaw, statsAdvanced(), "perGame"),
	]);

	const prospect = isProspect(pRaw);
	const rDraft = draftRatings(pRaw);
	const fuzz = prospect ? (rDraft?.fuzz ?? 0) : 0;

	// Season by season: where, coach, team record
	const ncaaSeasons = new Map<number, NcaaSeason | undefined>();
	const getNcaaSeason = async (season: number) => {
		if (!featureOn("collegeSeason")) {
			return undefined;
		}
		if (!ncaaSeasons.has(season)) {
			ncaaSeasons.set(season, (await getCollegeSeason(season))?.season);
		}
		return ncaaSeasons.get(season);
	};

	const career = validCareer(pRaw, rawRows);
	// With a career: every year of it, redshirt years included. Otherwise his stats rows
	const entries: {
		season: number;
		teamName: string;
		row: (typeof rawRows)[number] | undefined;
		year: CareerYear | undefined;
	}[] = career
		? career.years.map((year) => ({
				season: year.season,
				teamName: year.school,
				row: rawRows.find((row) => row.season === year.season),
				year,
			}))
		: rawRows.map((row) => ({
				season: row.season,
				teamName: row.teamName ?? pRaw.college ?? "",
				row,
				year: undefined,
			}));

	let collegeIndex = 0;
	const seasons = [];
	let prevTeam: string | undefined;
	for (const entry of entries) {
		const { teamName, year } = entry;
		const row = entry.row ?? { season: entry.season, gp: 0, gs: 0 };
		const juco = isJuco(teamName);
		const label = juco ? ("JUCO" as const) : getPreDraftLabel(teamName);
		const school = getSchool(teamName);
		const isNcaa = !!school && !school.nonCollege;
		const env = getLeagueEnv(teamName);
		const club = isNcaa || juco ? undefined : getClub(teamName, pRaw.pid);
		const coachKey = club ? `${teamName}|${club}` : teamName;
		const coach = getHeadCoach(coachKey, row.season, label === "Overseas");
		const notes: string[] = [];
		if (year?.move && prevTeam !== undefined && prevTeam !== teamName) {
			notes.push(
				year.move === "juco"
					? `Junior college transfer from ${prevTeam}`
					: `Transferred from ${prevTeam}`,
			);
		}
		if (year?.status) {
			notes.push(CAREER_NOTES[year.status]!);
		}
		prevTeam = teamName;

		let record: TeamRecord | undefined;
		let apRank: number | undefined;
		let ncaa: string | undefined;
		let confRank: { rank: number; size: number } | undefined;
		if (isNcaa && summary && summary.season === row.season) {
			record = {
				w: summary.w,
				l: summary.l,
				confW: summary.confW,
				confL: summary.confL,
				estimated: false,
			};
			apRank = summary.apRank;
			ncaa = ncaaResultText(summary);
			confRank = { rank: summary.confRank, size: summary.confSize };
		} else if (isNcaa) {
			const ncaaSeason = await getNcaaSeason(row.season);
			const team = ncaaSeason ? getTeamIndex(ncaaSeason, teamName) : -1;
			// A season simulated after his stats were generated can have played fewer games than he did; then the estimate, which covers his games
			if (
				ncaaSeason &&
				team >= 0 &&
				ncaaSeason.teams[team]!.w + ncaaSeason.teams[team]!.l >= (row.gp ?? 0)
			) {
				const t = ncaaSeason.teams[team]!;
				record = {
					w: t.w,
					l: t.l,
					confW: t.confW,
					confL: t.confL,
					estimated: false,
				};
				apRank = t.apRank;
				ncaa = ncaaResultText(getTeamSummary(ncaaSeason, team));
				const conf = ncaaSeason.conferences.find((c) => c.name === t.conf);
				confRank = { rank: t.confRank, size: conf?.standings.length ?? 0 };
			}
		}
		record ??= estimateRecord({
			team: coachKey,
			season: row.season,
			// A junior college that sends players on to Division I wins most of its games
			strength: juco ? 74 : (school?.strength ?? 60),
			gp: row.gp ?? 0,
			conference: isNcaa ? school.conference : undefined,
		});

		seasons.push({
			season: row.season,
			teamName,
			label,
			classYear: year
				? year.cls
				: isNcaa
					? CLASS_NAMES[Math.min(collegeIndex++, 4)]
					: undefined,
			conference: isNcaa ? school.conference : undefined,
			league: isNcaa ? undefined : juco ? JUCO_LEAGUE : teamName,
			leagueShort: isNcaa
				? undefined
				: juco
					? "JUCO"
					: (PRO_SHORT[teamName] ?? teamName),
			status: year?.status,
			notes,
			club,
			strength: school?.strength,
			leagueGames: env?.games,
			coach,
			record,
			apRank,
			ncaa,
			confRank,
			gp: row.gp ?? 0,
			gs: row.gs ?? 0,
		});
	}

	// Recruiting, for a player with a US high school path (an NCAA or junior college first stop). His ranks are his own within his high
	// school class
	const basis = rDraft ? getRecruitBasis(pRaw) : undefined;
	let recruiting;
	if (basis) {
		const ranks = (await getHsClassRanks(basis.classOf)).get(pRaw.pid);
		const nationalRank = ranks ? ranks.nationalRank : basis.rank;
		const committedSchool = getSchool(basis.committed);
		recruiting = {
			classOf: basis.classOf,
			pos: basis.pos,
			nationalRank,
			posRank: ranks ? ranks.posRank : basis.posRank,
			stars: starsForRank(nationalRank),
			jucoStart: basis.jucoStart,
			reclassifiedFrom:
				career?.story === "reclass" ? basis.classOf + 1 : undefined,
			...getRecruitingExtras({
				pid: pRaw.pid,
				nationalRank,
				committed: basis.committed,
				committedStrength:
					committedSchool && !committedSchool.nonCollege
						? committedSchool.strength
						: undefined,
				programs: getPrograms(),
				jucoStart: basis.jucoStart,
			}),
		};
	}

	// His draft class, for combine ranks and the draft board
	const classPlayers = (await idb.merged.players.getAll({ draftYear })).filter(
		(p) => p.draft.year === draftYear && p.ratings.length > 0,
	);
	if (!classPlayers.some((p) => p.pid === pRaw.pid)) {
		classPlayers.push(pRaw);
	}

	const combine = combineFor(pRaw);
	let combineInfo;
	if (combine) {
		const all: CombineResults[] = [];
		for (const p of classPlayers) {
			const c = p.pid === pRaw.pid ? combine : combineFor(p);
			if (c) {
				all.push(c);
			}
		}
		combineInfo = {
			results: combine,
			percentiles: combinePercentiles(combine, all),
			n: all.length,
			// Without a wingspan rating, wingspan comes from length in the hgt rating
			wingspanRating: rDraft !== undefined && expandedRatingsApply(rDraft),
		};
	}

	// Draft stock
	const numPicks = getNumPicks();
	let finalPick: number;
	let drafted = false;
	const pick = overallPick(pRaw);
	if (pick !== undefined) {
		finalPick = pick;
		drafted = true;
	} else if (!prospect) {
		// Went undrafted
		finalPick = numPicks + 10;
		drafted = true;
	} else {
		// Where the board has him now: by value, the order the AI drafts in (and the Mock Draft shows), not the user's own fuzzed scouting list, which can put a second rounder in the lottery
		const board = classPlayers
			.filter(isProspect)
			.sort((a, b) => b.value - a.value);
		finalPick = board.findIndex((p) => p.pid === pRaw.pid) + 1;
		if (finalPick <= 0) {
			finalPick = numPicks + 10;
		}
	}
	const stock = getStockTimeline({
		pid: pRaw.pid,
		seasons: entries.map((entry) => entry.season),
		finalPick,
		numPicks,
		// Not ranked out of high school: nowhere near a draft board when he started
		recruitRank: recruiting
			? (recruiting.nationalRank ?? (career && !career.story ? 700 : undefined))
			: undefined,
		drafted,
		story: career?.story,
	});

	// His story, if he is one of his class's unusual prospects
	let story;
	const lastEntry = entries.at(-1);
	if (career?.story && lastEntry) {
		const first = entries[0]!;
		story = {
			kind: career.story,
			...getStoryText(career.story, {
				hsClass: career.hsClass,
				recruitRank: recruiting?.nationalRank,
				heightInches: pRaw.hgt,
				ageAtDraft: draftYear - pRaw.born.year,
				school: lastEntry.teamName,
				conference: seasons.at(-1)?.conference,
				firstSeason: first.season,
				firstAge: first.season - pRaw.born.year,
				lastGp: lastEntry.row?.gp ?? 0,
				lastSeason: lastEntry.season,
			}),
		};
	}

	const scoutingReport = await getReport(pRaw, {
		rDraft,
		lastSeason: seasons.findLast((x) => x.gp > 0),
		lastRow: perGame.rows.at(-1),
		pick: finalPick <= numPicks ? finalPick : undefined,
		numPicks,
		drafted,
		prospect,
		story: career?.story,
	});

	// Similar prospects from past classes in this league
	let comps: Awaited<ReturnType<typeof getComps>> = [];
	if (rDraft) {
		comps = await getComps(pRaw, rDraft, fuzz);
	}

	const splits =
		summary && summary.games
			? getSplits(
					summary,
					rawRows.findLast((row) => row.season === summary.season) as any,
					pRaw.pid,
					career?.years.at(-1)?.status === "injury",
				)
			: [];

	return {
		draftYear,
		drafted,
		draft:
			pick !== undefined
				? {
						round: pRaw.draft.round,
						pick: pRaw.draft.pick,
						overall: pick,
						abbrev: g.get("teamInfoCache")[pRaw.draft.tid]?.abbrev ?? "",
						tid: pRaw.draft.tid,
					}
				: undefined,
		projectedPick: !drafted && finalPick <= numPicks ? finalPick : undefined,
		numPicks,
		perGame,
		totals,
		advanced,
		statsPerGame: statsPerGame(),
		statsAdvanced: statsAdvanced(),
		seasons,
		honors,
		summary,
		splits,
		recruiting,
		// Draft Lottery Night & Combine setting: its own combine (draftCombine below) replaces this one
		combine: lotteryNightOn() ? undefined : combineInfo,
		stock,
		comps,
		story,
		scoutingReport,
		// Scouting System setting: your scouts' ranges and notes on a prospect (only here and on his other pages, not on the Draft
		// Board or Draft Scouting)
		scoutNotes:
			prospect &&
			featureOn("scoutingSystem") &&
			!g.get("challengeNoRatings") &&
			pRaw.ratings.length > 0
				? getScoutReport(pRaw)
				: undefined,
	};
};

const REPORT_RATINGS = [
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
	"ovr",
	"pot",
] as const;

/**
 * His draft year ratings as the user's scouts see them: scouting fuzz applied to everything but height (as everywhere ratings are shown), or undefined when ratings are hidden (the no visible ratings challenge). The scouting report is written from these and never from the true ratings.
 */
export const getScoutedRatings = (
	p: Player,
	r: PlayerRatings | undefined,
): ReportRatings | undefined => {
	if (!r || (g.get("challengeNoRatings") && p.tid !== PLAYER.RETIRED)) {
		return undefined;
	}
	const out = {} as ReportRatings;
	for (const key of REPORT_RATINGS) {
		const value = (r as any)[key];
		if (typeof value !== "number") {
			return undefined;
		}
		out[key] = key === "hgt" ? value : player.fuzzRating(value, r.fuzz ?? 0);
	}
	return out;
};

const getReport = async (
	p: Player,
	{
		rDraft,
		lastSeason,
		lastRow,
		pick,
		numPicks,
		drafted,
		prospect,
		story,
	}: {
		rDraft: PlayerRatings | undefined;
		lastSeason:
			| { teamName: string; club?: string; classYear?: string }
			| undefined;
		lastRow: Record<string, any> | undefined;
		pick: number | undefined;
		numPicks: number;
		drafted: boolean;
		prospect: boolean;
		story: string | undefined;
	},
) => {
	if (!rDraft) {
		return undefined;
	}
	const ratings = getScoutedRatings(p, rDraft);
	// The archetype label the Draft Scouting page shows (from fuzzed ratings). Only for a prospect: a pro's label is from his current ratings, not his draft year
	const archetype =
		prospect && ratings
			? archetypeFor(p, await getLeagueNorms())?.view.label
			: undefined;
	const production =
		lastSeason && lastRow && (lastRow.gp ?? 0) > 0
			? {
					team: lastSeason.club ?? lastSeason.teamName,
					classYear: lastSeason.classYear,
					gp: lastRow.gp,
					min: lastRow.min,
					pts: lastRow.pts,
					trb: lastRow.trb,
					ast: lastRow.ast,
					stl: lastRow.stl,
					blk: lastRow.blk,
					tov: lastRow.tov,
					fgPct: lastRow.fgp,
					tpPct: lastRow.tpp,
					tpa: lastRow.tpa,
					ftPct: lastRow.ftp,
					fta: lastRow.fta,
				}
			: undefined;
	if (!ratings && !production) {
		return undefined;
	}
	return getScoutingReport({
		pid: p.pid,
		pos: rDraft.pos,
		age: p.draft.year - p.born.year,
		heightInches: p.hgt,
		ratings,
		archetype,
		production,
		pick,
		numPicks,
		drafted,
		looks:
			prospect && featureOn("scoutingSystem")
				? (p.scouting ?? []).length
				: undefined,
		story,
	});
};

const getComps = async (pRaw: Player, rDraft: PlayerRatings, fuzz: number) => {
	const draftYear = pRaw.draft.year;
	const fuzzed = (x: number) => (fuzz ? player.fuzzRating(x, fuzz) : x);
	const mine = {
		ratings: Object.fromEntries(
			SIMILARITY_RATINGS.map((key) => [
				key,
				key === "hgt" ? rDraft.hgt : fuzzed((rDraft as any)[key]),
			]),
		),
		age: draftYear - pRaw.born.year,
		pos: rDraft.pos,
		ovr: fuzzed(rDraft.ovr),
	};

	const candidates: { p: Player; distance: number; r: PlayerRatings }[] = [];
	const firstSeason = g.get("startingSeason");
	for (
		let year = draftYear - 1;
		year >= Math.max(firstSeason, draftYear - 25);
		year--
	) {
		const players = await idb.merged.players.getAll({ draftYear: year });
		for (const p of players) {
			if (p.draft.year !== year || isProspect(p)) {
				continue;
			}
			// Only players whose draft year ratings exist (drafted while this league was running)
			const r = p.ratings.find((row) => row.season === year);
			if (!r) {
				continue;
			}
			const distance = prospectDistance(mine, {
				ratings: r as any,
				age: year - p.born.year,
				pos: r.pos,
				ovr: r.ovr,
			});
			candidates.push({ p, distance, r });
		}
	}
	candidates.sort((a, b) => a.distance - b.distance);

	const output = [];
	for (const { p, distance, r } of candidates.slice(0, 5)) {
		const formatted = await player.format(p, {
			attrs: ["pid", "name", "tid", "abbrev"],
			stats: ["gp", "pts", "trb", "ast", "per", "ws"],
			seasonType: "regularSeason",
		});
		const proSeasons = new Set(
			getProStats(p)
				.filter((row) => !row.playoffs && (row.gp ?? 0) > 0)
				.map((row) => row.season),
		).size;
		const preDraft = getPreDraftStats(p).filter((row) => !row.playoffs);
		const lastPre = preDraft.at(-1);
		let peakOvr = 0;
		for (const row of p.ratings) {
			if (row.season > p.draft.year) {
				peakOvr = Math.max(peakOvr, row.ovr);
			}
		}
		const countAwards = (type: string) =>
			p.awards.filter((a) => a.type === type).length;
		output.push({
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			draftYear: p.draft.year,
			pick: overallPick(p),
			draftAbbrev:
				p.draft.round > 0
					? (g.get("teamInfoCache")[p.draft.tid]?.abbrev ?? "")
					: undefined,
			pos: r.pos,
			age: p.draft.year - p.born.year,
			ovrAtDraft: r.ovr,
			potAtDraft: r.pot,
			school: lastPre?.teamName ?? p.college ?? "",
			similarity: Math.max(0, Math.round(100 - 3 * distance)),
			proSeasons,
			peakOvr: peakOvr > 0 ? peakOvr : undefined,
			career: formatted?.careerStats as
				| {
						gp: number;
						pts: number;
						trb: number;
						ast: number;
						per: number;
						ws: number;
				  }
				| undefined,
			allStar: countAwards("All-Star"),
			// (an MVP from the award settings has a name and actAs, no type)
			mvp:
				countAwards("Most Valuable Player") +
				p.awards.filter(
					(a) =>
						a.type === undefined &&
						a.numTeams === undefined &&
						a.rank === 1 &&
						(a.actAs === "mvp" || a.name === "Most Valuable Player"),
				).length,
			retired: p.tid === PLAYER.RETIRED,
		});
	}
	return output;
};

const processInputs = (params: RouteParams<"playerPreDraft">) => {
	return {
		pid: params.pid !== undefined ? Number.parseInt(params.pid) : undefined,
	};
};

export default defineView({
	id: "playerPreDraft",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("playerMovement") ||
			prevInputs?.pid !== inputs.pid
		) {
			const topStuff = await getCommon(
				inputs.pid,
				undefined,
				"player_pre_draft",
			);
			if (topStuff.type === "error") {
				// https://stackoverflow.com/a/59923262/786644
				const returnValue = {
					errorMessage: topStuff.errorMessage,
				};
				return returnValue;
			}

			const preDraft =
				__SPORT === "basketball"
					? await getPreDraftInfo(topStuff.pRaw)
					: undefined;

			// Draft Lottery Night & Combine setting: his combine, once it was held
			const draftCombine =
				__SPORT === "basketball"
					? await getPlayerCombine(topStuff.pRaw)
					: undefined;

			// The raw player stays in the worker (hidden trait seeds, etc.)
			const { pRaw: _pRaw, ...topStuffForUI } = topStuff;

			return {
				...topStuffForUI,
				preDraft,
				draftCombine: draftCombine
					? { ...draftCombine, season: topStuff.pRaw.draft.year }
					: undefined,
			};
		}
	},
});
