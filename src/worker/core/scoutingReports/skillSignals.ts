// Strengths & weaknesses of a prospect's scouting report, worker side: the public facts beyond his draft-year line that
// common/scoutingReports/skills.ts reads. Every pre-draft season's stats (with shot locations and blocked shots), the draft year's
// non-conference / conference split and postseason games, his schedule strength, age-adjusted production, the hand he shoots with,
// what the combine measured, his real-player comp and our last-season grades of him. Nothing here reads true ratings or hidden traits;
// cheap (one player's own records), so it never touches a class-wide page.
import { getPreDraftLabel } from "../../../common/collegeStats/overseas.ts";
import {
	getAgeAdjustedProduction,
	strengthOfTeam,
} from "../../../common/collegeStats/production.ts";
import {
	SHOOTING_ATTEMPTS,
	type CombineRank,
	type CombineKey,
	type DraftCombineResult,
	type ListedMeasurements,
} from "../../../common/draftCombine.ts";
import type { CombineResults } from "../../../common/collegeStats/profile.ts";
import { getPreDraftStats } from "../../../common/preDraft.ts";
import { becameText, type RealComp } from "../../../common/realComps.ts";
import {
	decodeGrades,
	GRADE_KEYS,
	type ScoutCombine,
	type ScoutProduction,
	type SkillGame,
	type SkillSeasonLine,
	type SkillSignals,
} from "../../../common/scoutingReports/index.ts";
import { getShootingHand } from "../../../common/shootingHand.ts";
import type { Player } from "../../../common/types.ts";

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

const levelOf = (
	label: string | undefined,
	careerLevel: string | undefined,
): ScoutProduction["level"] =>
	careerLevel === "juco" || label === "JUCO"
		? "juco"
		: label === "Prep" || label === "Academy" || label === "Small college"
			? "other"
			: label === "Overseas"
				? "overseas"
				: label === "G League" || label === "Pro pathway"
					? "pro"
					: "college";

// Every pre-draft regular season, totals, oldest first
export const skillSeasonsOf = (p: Player): SkillSeasonLine[] => {
	const bySeason = new Map<number, any[]>();
	for (const r of getPreDraftStats(p) as any[]) {
		if (r.playoffs) {
			continue;
		}
		const list = bySeason.get(r.season) ?? [];
		list.push(r);
		bySeason.set(r.season, list);
	}
	const out: SkillSeasonLine[] = [];
	for (const season of [...bySeason.keys()].sort((a, b) => a - b)) {
		const rows = bySeason.get(season)!;
		const sum = (key: string) => rows.reduce((a, r) => a + n(r[key]), 0);
		const min = sum("min");
		const gp = sum("gp");
		if (gp <= 0) {
			continue;
		}
		// The team he played the most minutes for sets the level
		const main = rows.toSorted((a, b) => n(b.min) - n(a.min))[0];
		const teamName: string | undefined = main?.teamName;
		const careerYear = p.preDraftCareer?.years.find((y) => y.season === season);
		let usgW = 0;
		let usg = 0;
		for (const r of rows) {
			if (typeof r.usgp === "number" && n(r.min) > 0) {
				usg += r.usgp * r.min;
				usgW += r.min;
			}
		}
		out.push({
			season,
			age: season - p.born.year,
			level: levelOf(getPreDraftLabel(teamName), careerYear?.level),
			strength: strengthOfTeam(teamName),
			gp,
			min,
			pts: sum("pts"),
			orb: sum("orb"),
			drb: sum("drb"),
			ast: sum("ast"),
			tov: sum("tov"),
			stl: sum("stl"),
			blk: sum("blk"),
			pf: sum("pf"),
			fg: sum("fg"),
			fga: sum("fga"),
			tp: sum("tp"),
			tpa: sum("tpa"),
			ft: sum("ft"),
			fta: sum("fta"),
			rimA: sum("fgaAtRim"),
			rim: sum("fgAtRim"),
			postA: sum("fgaLowPost"),
			post: sum("fgLowPost"),
			midA: sum("fgaMidRange"),
			mid: sum("fgMidRange"),
			ba: sum("ba"),
			usg: usgW > 0 ? usg / usgW : undefined,
		});
	}
	return out;
};

// The draft year's split and postseason games (college season model only)
const seasonGamesOf = (p: Player, lastSeason: number | undefined) => {
	const summary = p.collegeSeason?.summary;
	if (!summary || summary.season !== lastSeason) {
		return {};
	}
	const games: SkillGame[] = (summary.games ?? []).map((g) => ({
		event: g.event,
		strong:
			g.event === "ncaa" ||
			(g.oppSeed !== undefined && g.seed !== undefined && g.oppSeed < g.seed),
		won: g.won,
		min: n(g.min),
		pts: n(g.pts),
		fg: n(g.fg),
		fga: n(g.fga),
		tp: n(g.tp),
		tpa: n(g.tpa),
		gmsc: n(g.gmsc),
	}));
	return {
		splits: summary.splits
			? {
					nonConf: { ...summary.splits.nonConf },
					conf: { ...summary.splits.conf },
				}
			: undefined,
		games: games.length > 0 ? games : undefined,
	};
};

const pctOf = (rows: ScoutCombine | undefined, label: string) =>
	rows?.find((c) => c.label === label)?.pct;

// Each class's average trait reading, as the scouts read it (the class's visible traits; a hidden one only once known). Cached per
// class, season and scouting level: one page reads it once, not once per prospect
const centersCache = new Map<string, Record<string, number>>();
export const classTraitCenters = (
	classPlayers: Player[],
	key: string,
	read: (
		p: Player,
	) =>
		| { key: string; estimate: number; hidden: boolean; exact: boolean }[]
		| undefined,
) => {
	const cached = centersCache.get(key);
	if (cached) {
		return cached;
	}
	const sums: Record<string, [number, number]> = {};
	for (const p of classPlayers) {
		for (const t of read(p) ?? []) {
			if (t.hidden && !t.exact) {
				continue;
			}
			const x = (sums[t.key] ??= [0, 0]);
			x[0] += t.estimate;
			x[1] += 1;
		}
	}
	const out = Object.fromEntries(
		Object.entries(sums)
			.filter(([, [, c]]) => c >= 5)
			.map(([k, [sum, c]]) => [k, Math.round((10 * sum) / c) / 10]),
	);
	if (centersCache.size >= 8) {
		centersCache.clear();
	}
	centersCache.set(key, out);
	return out;
};
export const clearTraitCenters = () => {
	centersCache.clear();
};

export const skillSignalsFor = (
	p: Player,
	{
		season,
		night,
		oldCombine,
		combineRows,
		realComp,
		archetypeWhy,
		traitCenters,
	}: {
		season: number;
		traitCenters?: Record<string, number>;
		// Draft Lottery Night & Combine: his result there (invited), his listing and his ranks
		night?: {
			result: DraftCombineResult;
			listed: ListedMeasurements;
			ranks: Partial<Record<CombineKey, CombineRank>>;
		};
		// The older combine numbers (College/Overseas page) when he wasn't at the Lottery Night combine
		oldCombine?: CombineResults;
		// The combine rows the report shows (percentiles in his class)
		combineRows?: ScoutCombine;
		realComp?: RealComp;
		archetypeWhy?: string[];
	},
): SkillSignals => {
	const seasons = skillSeasonsOf(p);
	const lastSeason = seasons.at(-1)?.season;
	const adj = getAgeAdjustedProduction(
		seasons.map((s) => ({
			row: {
				gp: s.gp,
				min: s.min,
				pts: s.pts,
				fg: s.fg,
				fga: s.fga,
				fta: s.fta,
				ft: s.ft,
				orb: s.orb,
				drb: s.drb,
				stl: s.stl,
				ast: s.ast,
				blk: s.blk,
				pf: s.pf,
				tov: s.tov,
			},
			strength: s.strength,
			age: s.age,
		})),
	);
	let combine: SkillSignals["combine"];
	if (night) {
		const m = night.result.measurements;
		const d = night.result.drills;
		combine = {
			apeIndex: Math.round(10 * (m.wingspan - m.heightNoShoes)) / 10,
			heightVsListed:
				Math.round(100 * (m.heightShoes - night.listed.height)) / 100,
			weightVsListed: Math.round(m.weight - night.listed.weight),
			weight: Math.round(m.weight),
			effort: night.result.effort,
			skipped: !d,
			spotUp: d ? [d.spotUp, SHOOTING_ATTEMPTS.spotUp] : undefined,
			offDribble: d ? [d.offDribble, SHOOTING_ATTEMPTS.offDribble] : undefined,
			sprintPct: night.ranks.sprint?.pct,
			agilityPct: night.ranks.laneAgility?.pct,
			benchPct: night.ranks.bench?.pct,
		};
	} else if (oldCombine) {
		combine = {
			apeIndex:
				Math.round(10 * (oldCombine.wingspan - oldCombine.heightNoShoes)) / 10,
			sprintPct: pctOf(combineRows, "Sprint"),
			agilityPct: pctOf(combineRows, "Lane agility"),
			benchPct: pctOf(combineRows, "Bench"),
		};
	}
	// Last season's report: our last snapshot of him the season before
	let prev: SkillSignals["prev"];
	const snaps = (p.scoutSnaps ?? []).filter((x) => x.s === season - 1);
	const snap = snaps.at(-1);
	if (snap) {
		const grades = decodeGrades(snap.g);
		if (grades.length === GRADE_KEYS.length) {
			prev = { season: snap.s, grades };
		}
	}
	return {
		seasons,
		...seasonGamesOf(p, lastSeason),
		ageAdjusted: adj?.value,
		hand: getShootingHand(p),
		combine,
		realComp: realComp
			? {
					name: realComp.name,
					season: realComp.season,
					age: realComp.age,
					similarity: realComp.similarity,
					became: becameText(realComp),
				}
			: undefined,
		archetypeWhy,
		traitCenters,
		prev,
	};
};
