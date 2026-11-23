import {
	classWord,
	heightFromRating,
	type CareerYear,
	type PreDraftCareer,
	type RouteKind,
	type StoryKind,
} from "./career.ts";
import { getPreDraftLabel } from "./overseas.ts";
import { Rng, clamp } from "./rng.ts";
import type { CollegeProspect, CollegeSeason } from "./types.ts";

/**
 * Why a prospect is on the draft radar. A real draftee who was lowly recruited out of high school and didn't produce before the draft is very
 * rare, and when one is a legit prospect there is a reason: he bloomed late, a transfer gave him a bigger role, he produced in junior
 * college or as a teenage pro, an injury cut his career short after a strong start, or his physical tools are too good to pass on.
 *
 * Everything here is story, read off what is public about him (his recruiting rank, his pre-draft seasons and stats, his measurements and
 * athletic testing): nothing about his ratings or development changes. Generation (generate.ts) uses it two ways: the recruiting rank a
 * prospect's career is given follows his draft stock (getHsRank), and a prospect with real draft stock whose rank came out low and whose
 * production is weak, with nothing in his story to explain it, gets the rank his stock says instead (so a high-stock prospect has pedigree,
 * production or a reason). The College/Overseas page, the Big Boards and the draft outlets read the reason (getRadarReason).
 */

// A recruit ranked worse than this (or unranked) had little high school pedigree: a two-star or a low three-star
export const LOW_PEDIGREE_RANK = 300;

// What getHsRank stores as unranked: past this, recruiting services don't rank him
const UNRANKED_PAST = 800;

export const isLowPedigree = (rank: number | null | undefined) =>
	rank === undefined || rank === null || rank > LOW_PEDIGREE_RANK;

// One pre-draft season, his career year with what he did in it
export type RadarSeason = {
	season: number;
	school: string;
	level?: CareerYear["level"];
	cls?: string;
	status?: CareerYear["status"];
	move?: CareerYear["move"];
	role?: CareerYear["role"];
	injury?: CareerYear["injury"];
	gp: number;
	min: number;
	pts: number;
};

/**
 * His seasons, oldest first: each stats season (regular season, summed over rows), with what his stored career says about it. A career year
 * without games (a redshirt year, a year away) is left out.
 */
export const radarSeasons = (
	years: CareerYear[] | undefined,
	rows: {
		season: number;
		teamName?: string;
		gp?: number;
		min?: number;
		pts?: number;
		playoffs?: boolean;
	}[],
): RadarSeason[] => {
	const bySeason = new Map<number, RadarSeason>();
	for (const row of rows) {
		if (row.playoffs) {
			continue;
		}
		let s = bySeason.get(row.season);
		if (!s) {
			const year = years?.find((y) => y.season === row.season);
			s = {
				season: row.season,
				school: year?.school ?? row.teamName ?? "",
				...(year?.level ? { level: year.level } : {}),
				...(year?.cls ? { cls: year.cls } : {}),
				...(year?.status ? { status: year.status } : {}),
				...(year?.move ? { move: year.move } : {}),
				...(year?.role ? { role: year.role } : {}),
				...(year?.injury ? { injury: year.injury } : {}),
				gp: 0,
				min: 0,
				pts: 0,
			};
			bySeason.set(row.season, s);
		}
		s.gp += row.gp ?? 0;
		s.min += row.min ?? 0;
		s.pts += row.pts ?? 0;
	}
	return [...bySeason.values()].sort((a, b) => a.season - b.season);
};

const ppg = (s: RadarSeason) => (s.gp > 0 ? s.pts / s.gp : 0);
const mpg = (s: RadarSeason) => (s.gp > 0 ? s.min / s.gp : 0);

// A real season: enough games to count
const counts = (s: RadarSeason) => s.gp >= 8;

/**
 * Weak pre-draft production: no stats, or a last season he barely played (under 8 games, under 14 minutes or 6 points a game), with no
 * earlier season of real production (22+ minutes and 10+ points a game) either.
 */
export const isWeakProduction = (seasons: RadarSeason[]) => {
	const last = seasons.at(-1);
	if (!last) {
		return true;
	}
	const weakLast = !counts(last) || mpg(last) < 14 || ppg(last) < 6;
	if (!weakLast) {
		return false;
	}
	return !seasons.some((s) => counts(s) && mpg(s) >= 22 && ppg(s) >= 10);
};

export type RadarKind =
	| "lateBloomer"
	| "transfer"
	| "juco"
	| "injury"
	| "youngPro"
	| "workouts"
	| "tools"
	| "combine";

export const RADAR_TITLES: Record<RadarKind | "unknown", string> = {
	lateBloomer: "Late bloomer",
	transfer: "Transfer who found a role",
	juco: "Junior college standout",
	injury: "Injury-shortened career",
	youngPro: "Teenage pro",
	workouts: "Workout riser",
	tools: "Elite physical tools",
	combine: "Combine riser",
	unknown: "Off the radar",
};

export type RadarReason = {
	kind: RadarKind;
	title: string;
	text: string;
};

export type RadarInput = {
	// A US high school path (he has a recruiting rank, or was unranked)
	hsPath: boolean;
	// His national recruiting rank; undefined or null: unranked
	recruitRank: number | null | undefined;
	story?: StoryKind;
	route?: RouteKind;
	seasons: RadarSeason[];
	ageAtDraft: number;
	heightInches: number;
	// Athletic read, 0-100 (50 average): his combine athletic score once he did the drills, else a read of his tape
	athletic: number;
	// The athletic read is from the combine
	tested?: boolean;
};

// Height (7'0") and athletic read that are, on their own, a reason teams look at a prospect
const TOOLS_HEIGHT = 84;
const TOOLS_ATHLETIC = 86;

const feetInches = (inches: number) =>
	`${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;

const one = (x: number) => (Math.round(10 * x) / 10).toFixed(1);

const pedigreeWords = (input: RadarInput) =>
	input.recruitRank === undefined || input.recruitRank === null
		? "Unranked out of high school"
		: `Ranked No. ${input.recruitRank} in his high school class`;

/**
 * A prospect who looks under the radar: lowly recruited (or no high school ranking at all) and/or little to show before the draft. Only
 * those get a reason: everyone else's pedigree or production speaks for itself.
 */
export const isUnderRadar = (input: RadarInput) =>
	input.hsPath
		? isLowPedigree(input.recruitRank)
		: isWeakProduction(input.seasons);

/**
 * The reason a lowly recruited or unproductive prospect is on the radar, or undefined when nothing in his story explains it (or he doesn't
 * need it: see isUnderRadar). The first that fits, in order: an injury cut short a career that had started well, a junior college or small
 * college standout, a transfer whose role grew, a late breakout, a teenage pro, a draft year he sat out, his physical tools.
 */
export const getRadarReason = (input: RadarInput): RadarReason | undefined => {
	if (!isUnderRadar(input)) {
		return undefined;
	}
	const { seasons } = input;
	const last = seasons.at(-1);
	const make = (kind: RadarKind, text: string): RadarReason => ({
		kind,
		title: RADAR_TITLES[kind],
		text,
	});

	// An injury in one of his last two seasons, after (or in) a season that showed what he can do
	const recent = seasons.slice(-2);
	const hurt = recent.find(
		(s) =>
			s.status === "injury" ||
			s.status === "medical" ||
			s.injury?.ended ||
			s.injury?.major,
	);
	if (hurt || (input.story === "injury" && last)) {
		const injured = hurt ?? last!;
		const best = seasons
			.filter((s) => s.gp >= 5)
			.sort((a, b) => ppg(b) - ppg(a))[0];
		if (best && ppg(best) >= 9) {
			return make(
				"injury",
				`His ${injured.season} season ${injured.status === "injury" || injured.status === "medical" || injured.injury?.ended ? `ended after ${injured.gp} ${injured.gp === 1 ? "game" : "games"}` : "was cut short"} by an injury. Teams are going on what he showed when healthy: ${one(ppg(best))} points a game in ${best.season} at ${best.school}.`,
			);
		}
	}

	// A junior college (or Division II/NAIA) standout who moved up
	const lower = seasons.filter(
		(s) => s.level === "juco" || s.level === "dii" || s.level === "naia",
	);
	const bestLower = lower.sort((a, b) => ppg(b) - ppg(a))[0];
	if (bestLower && counts(bestLower) && ppg(bestLower) >= 11) {
		const level =
			bestLower.level === "juco"
				? "junior college"
				: bestLower.level === "dii"
					? "Division II"
					: "NAIA";
		return make(
			"juco",
			`Not a big recruit out of high school, he scored ${one(ppg(bestLower))} points a game at ${bestLower.school} (${level}) in ${bestLower.season}, which put him on Division I radars${last && last.school !== bestLower.school ? ` and got him to ${last.school}` : ""}.`,
		);
	}

	// A transfer whose role grew at his new school
	if (
		last &&
		counts(last) &&
		(last.move === "up" || last.move === "down" || last.move === "lateral")
	) {
		const prev = seasons
			.slice(0, -1)
			.filter((s) => s.school !== last.school && s.gp > 0)
			.at(-1);
		if (prev && ppg(last) >= 8 && ppg(last) >= ppg(prev) + 3) {
			return make(
				"transfer",
				`${one(ppg(prev))} points a game at ${prev.school}, then a bigger role after transferring to ${last.school}: ${one(mpg(last))} minutes and ${one(ppg(last))} points a game.`,
			);
		}
	}

	// A late breakout: his last season well above everything before it
	if (last && counts(last) && seasons.length >= 2) {
		const before = seasons.slice(0, -1).filter(counts);
		const prevBest = Math.max(0, ...before.map(ppg));
		const jump = ppg(last) - prevBest;
		const storied = input.story === "lateBloomer" || input.story === "unranked";
		if (
			ppg(last) >= 9 &&
			(jump >= 4 ||
				(storied && jump >= 2) ||
				(last.role === "breakout" && jump >= 2.5))
		) {
			const cls = classWord(last.cls);
			return make(
				"lateBloomer",
				`${input.hsPath ? `${pedigreeWords(input)}, he` : "He"} broke out ${cls ? `as a ${cls}` : `in ${last.season}`}: ${one(prevBest)} to ${one(ppg(last))} points a game.`,
			);
		}
	}

	// A teenager holding a spot on a pro team
	if (last && counts(last) && input.ageAtDraft <= 20) {
		const label = getPreDraftLabel(last.school);
		if (
			label === "Overseas" ||
			label === "G League" ||
			label === "Pro pathway"
		) {
			const where =
				label === "Pro pathway"
					? `with ${last.school}`
					: `in the ${last.school === "NBA G League" ? "G League" : last.school}`;
			return make(
				"youngPro",
				`Played ${one(mpg(last))} minutes a game against grown men ${where} at ${input.ageAtDraft}: modest numbers, but teams value ${input.ageAtDraft <= 19 ? "a teenager" : "a 20-year-old"} who holds his own as a pro.`,
			);
		}
	}

	// No games at all in his draft year
	if (!last || last.gp === 0) {
		return make(
			"workouts",
			"No games to judge him on before the draft: teams got to know him in private workouts, where his tools showed.",
		);
	}

	// Physical tools
	if (input.tested && input.athletic >= TOOLS_ATHLETIC) {
		return make(
			"combine",
			`Tested as one of the best athletes in his class at the combine (athletic score ${Math.round(input.athletic)}), and his stock rose with it.`,
		);
	}
	if (input.heightInches >= TOOLS_HEIGHT || input.athletic >= TOOLS_ATHLETIC) {
		return make(
			"tools",
			input.heightInches >= TOOLS_HEIGHT
				? `${feetInches(input.heightInches)} and still raw: the production isn't there yet, but size like his gets looks from every team.`
				: "One of the most explosive athletes in his class: the production isn't there yet, but tools like his get looks from every team.",
		);
	}
	return undefined;
};

/**
 * Off the radar: under the radar with nothing to explain it (no pedigree and no production). Undrafted free agent material, unless a
 * team sees something it likes in workouts.
 */
export const isOffRadar = (input: RadarInput) =>
	isUnderRadar(input) &&
	isWeakProduction(input.seasons) &&
	getRadarReason(input) === undefined;

export const offRadarText = (projectedInRange: boolean) =>
	projectedInRange
		? "Lowly recruited and little to show before the draft: scouts have almost nothing to go on beyond his workouts."
		: "Lowly recruited and little to show before the draft: an undrafted free agent type unless a team likes what it sees in workouts.";

// The athletic read of his tape, as the draft outlets make it (0-100, 50 average): his speed and leaping
export const tapeAthletic = (spd: number, jmp: number) =>
	clamp(50 + 2.2 * ((spd + jmp) / 2 - 52), 0, 100);

/**
 * The recruiting rank a new career is given (generate.ts), before it is fitted around the rest of his high school class: what the recruiting
 * services said about him as a high school senior. It follows his draft stock (zStock, class standard deviations), as real rankings do for
 * players who end up on draft boards: a lottery pick was nearly always a top-25 recruit, a second rounder anything from the top 100 to
 * unranked. The more years he has been out of high school the more he grew since and the less it says: a late bloomer (by his hidden
 * trajectory, the same one his role arc follows) was ranked lower, an early one higher. His story or route moves it as before: a five-star
 * bust, an unranked riser, a late-blooming senior, a reclassified freshman, a junior college or small college start, the pro pathway
 * program. undefined: unranked. From a stream of his own.
 */
export const getHsRank = ({
	seedBase,
	zStock,
	yearsBefore,
	lateness,
	story,
	jucoStart,
	smallStart,
	pathway,
}: {
	seedBase: string;
	zStock: number;
	// Pre-draft seasons before his draft year (0 for a freshman)
	yearsBefore: number;
	lateness: number;
	story: StoryKind | undefined;
	jucoStart: boolean;
	smallStart: boolean;
	pathway: boolean;
}): number | undefined => {
	const rng = new Rng(`${seedBase}|hsRank`);
	const noise = rng.normal(0, 1);
	const u = rng.random();
	const base = hsRankMedian(zStock, yearsBefore, lateness);
	const rank = Math.max(
		1,
		Math.round(base * Math.exp((0.45 + 0.08 * yearsBefore) * noise)),
	);
	if (pathway) {
		return Math.min(rank, 1 + Math.floor(u * 25));
	}
	if (story === "bust") {
		return 2 + Math.floor(u * 21);
	}
	if (story === "unranked") {
		return undefined;
	}
	if (story === "lateBloomer") {
		const r = Math.round(Math.max(rank, 180) * (1.2 + u));
		return r > 650 ? undefined : r;
	}
	if (story === "reclass") {
		return Math.max(1, Math.round(rank * (0.5 + 0.4 * u)));
	}
	if (jucoStart || smallStart) {
		const r = Math.round(rank * 2.5 + 120 + 200 * u);
		return r > 600 ? undefined : r;
	}
	return rank > UNRANKED_PAST ? undefined : rank;
};

// The middle of his recruiting rank's range (no noise, no story)
export const hsRankMedian = (
	zStock: number,
	yearsBefore: number,
	lateness: number,
) => {
	const growth =
		yearsBefore *
		(0.12 + 0.3 * Math.max(0, lateness) - 0.15 * Math.max(0, -lateness));
	// Log rank by stock: steeper at the top (a top-3 pick was a top-5 recruit), flatter at the bottom (the end of a class was a two- or
	// three-star, not a nobody)
	const z = clamp(zStock, -2.5, 2.8);
	const slope = z < 0 ? 0.95 * z : z <= 1 ? 1.28 * z : 1.28 + 1.8 * (z - 1);
	const log = 4.77 - slope;
	return Math.exp(log + growth);
};

// Draft stock (class sd) from which a prospect is someone draft boards care about: about the top 85% of a class. A prospect below it can
// be off the radar with nothing to explain it, as undrafted free agents are
export const FIT_MIN_STOCK = -0.9;

/**
 * The recruiting rank a new career is stored with (career.hsRank; undefined: unranked): getHsRank, unless that leaves a prospect with real
 * draft stock lowly recruited, short of production and with nothing in his story to explain why he is on the radar. He was ranked where
 * his stock says then (the middle of his range, at worst a mid three-star): his story is fitted to him, not him to it.
 */
export const fitHsRank = ({
	p,
	career,
	seasons,
	zStock,
	seedBase,
	draftYear,
}: {
	p: CollegeProspect;
	career: PreDraftCareer;
	seasons: CollegeSeason[];
	zStock: number;
	seedBase: string;
	draftYear: number;
}): number | undefined => {
	const first = career.years[0];
	if (career.hsClass === undefined || !first) {
		return undefined;
	}
	const firstCollege =
		career.years.find(
			(y) => y.level !== "prep" && y.level !== "academy" && y.level !== "gap",
		) ?? first;
	const yearsBefore = Math.max(0, draftYear - career.hsClass - 1);
	const lateness = p.lateness ?? 0;
	const rank = getHsRank({
		seedBase,
		zStock,
		yearsBefore,
		lateness,
		story: career.story,
		jucoStart: first.level === "juco",
		smallStart: firstCollege.level === "dii" || firstCollege.level === "naia",
		pathway: first.level === "pathway",
	});
	if (
		!isLowPedigree(rank) ||
		zStock < FIT_MIN_STOCK ||
		career.story === "unranked" ||
		career.story === "lateBloomer"
	) {
		return rank;
	}
	const input: RadarInput = {
		hsPath: true,
		recruitRank: rank,
		story: career.story,
		route: career.route,
		seasons: radarSeasons(
			career.years,
			seasons.map((s) => ({
				season: s.season,
				teamName: s.school,
				gp: s.stats.gp ?? 0,
				min: s.stats.min ?? 0,
				pts: s.stats.pts ?? 0,
			})),
		),
		ageAtDraft: p.age,
		heightInches: p.heightInches ?? heightFromRating(p.ratings.hgt),
		athletic: tapeAthletic(p.ratings.spd, p.ratings.jmp),
	};
	if (!isWeakProduction(input.seasons) || getRadarReason(input)) {
		return rank;
	}
	return Math.min(
		rank ?? Infinity,
		Math.round(
			Math.min(
				LOW_PEDIGREE_RANK - 40,
				hsRankMedian(zStock, yearsBefore, lateness),
			),
		),
	);
};
