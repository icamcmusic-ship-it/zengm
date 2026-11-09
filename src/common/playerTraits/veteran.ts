import { getProStats } from "../preDraft.ts";

// Veteran savvy: the 13th trait. Grows with pro seasons played (plateau around 8-10), plus the usual seeded personal component. Pure, no worker/DB/`g` access.

// Seasons after which the experience part stops growing
export const VETERAN_PLATEAU_SEASONS = 9;
// Experience part at the plateau, in score points (0 for a rookie)
export const VETERAN_EXPERIENCE_MAX = 30;

// Concave: big steps early, flat from VETERAN_PLATEAU_SEASONS on. 0 at 0 seasons, ~16 at 3, ~27 at 6, 30 at 9+.
export const veteranExperienceCurve = (proSeasons: number) => {
	const x = Math.max(0, Math.min(proSeasons, VETERAN_PLATEAU_SEASONS));
	const left = 1 - x / VETERAN_PLATEAU_SEASONS;
	return VETERAN_EXPERIENCE_MAX * (1 - left * left);
};

type StatsRow = {
	season: number;
	tid?: number | undefined;
	playoffs?: boolean;
	gp?: number;
};

/**
 * Completed pro regular seasons in which he played (gp > 0), before `season`. Pre-draft (college) rows are excluded via getProStats. Seasons after his draft
 * year but before the league existed (startingSeason) have no stats rows in a random-players league, so those are counted as played unless a stats row says otherwise.
 * Draft prospects and rookies get 0.
 */
export const proSeasonsPlayed = ({
	p,
	season,
	startingSeason,
}: {
	p: { draft?: { year?: number }; stats?: StatsRow[] };
	season: number;
	startingSeason?: number;
}) => {
	const stats = p.stats
		? getProStats(p as { draft?: { year?: number }; stats: StatsRow[] })
		: [];
	const played = new Set<number>();
	const anyRow = new Set<number>();
	for (const row of stats) {
		if (row.playoffs || row.season >= season) {
			continue;
		}
		anyRow.add(row.season);
		if ((row.gp ?? 0) > 0) {
			played.add(row.season);
		}
	}
	let count = played.size;
	const draftYear = p.draft?.year;
	if (
		startingSeason !== undefined &&
		typeof draftYear === "number" &&
		Number.isFinite(draftYear) &&
		draftYear > 0
	) {
		const end = Math.min(season, startingSeason);
		for (let y = draftYear + 1; y < end; y++) {
			if (!anyRow.has(y)) {
				count += 1;
			}
		}
	}
	return count;
};

// --- Mentoring ---

// Ratings moved by the mentoring bonus (all basketball ratings but height)
export const MENTOR_RATING_KEYS = [
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

// Maximum preseason progression bonus (ovr points, in expectation) for a young player on the team with the best mentors
export const MENTOR_MAX_BONUS = 0.5;
// Teammates at or under this age (in the new season) are mentored
export const MENTEE_MAX_AGE = 23;
// Only clearly savvy veterans mentor: z above this (score ~60)
const MENTOR_Z_THRESHOLD = 0.25;

// One veteran's mentoring strength, 0 to 0.75
export const mentorStrength = (veteranSavvyScore: number) =>
	Math.max(
		0,
		Math.max(-1, Math.min(1, (veteranSavvyScore - 50) / 40)) -
			MENTOR_Z_THRESHOLD,
	);

// A team's raw mentoring, 0 to MENTOR_MAX_BONUS: the two best mentors count (the second half as much)
export const teamMentoring = (veteranSavvyScores: number[]) => {
	const s = veteranSavvyScores.map(mentorStrength).sort((a, b) => b - a);
	const total = (s[0] ?? 0) + 0.5 * (s[1] ?? 0);
	return MENTOR_MAX_BONUS * Math.min(1, total / 0.75);
};

/**
 * Progression bonus per mentee (ovr points, in expectation), for every team. Centered so the average over all mentees in the league is exactly 0:
 * young players with strong mentors develop a little faster, those without a little slower, and the league's overall ratings do not drift up.
 * menteesByTid: number of mentees per team. Returns tid -> bonus, within +-MENTOR_MAX_BONUS.
 */
export const mentorBonuses = (
	rawByTid: Map<number, number>,
	menteesByTid: Map<number, number>,
) => {
	let sum = 0;
	let n = 0;
	for (const [tid, count] of menteesByTid) {
		sum += (rawByTid.get(tid) ?? 0) * count;
		n += count;
	}
	const mean = n > 0 ? sum / n : 0;
	const output = new Map<number, number>();
	for (const tid of menteesByTid.keys()) {
		output.set(tid, (rawByTid.get(tid) ?? 0) - mean);
	}
	return output;
};

/**
 * Apply a bonus of `bonus` ovr points in expectation to a ratings row: with probability |bonus| every rating but height moves by one point in its direction.
 * `random` is a seeded draw in [0, 1) so this is deterministic. Ratings are clamped to 0-100.
 */
export const applyMentorBonus = (
	ratings: Record<string, any>,
	bonus: number,
	random: number,
	keys: readonly string[],
) => {
	if (bonus === 0 || random >= Math.min(1, Math.abs(bonus))) {
		return false;
	}
	const step = bonus > 0 ? 1 : -1;
	for (const key of keys) {
		if (key === "hgt" || typeof ratings[key] !== "number") {
			continue;
		}
		ratings[key] = Math.max(0, Math.min(100, ratings[key] + step));
	}
	return true;
};

// For a skill badge built on this trait (the badge system decides whether to show it): 0 below score 60, rising to 1 at score 90
export const veteranSavvyBadgeScore = (score: number) =>
	Math.max(0, Math.min(1, (score - 60) / 30));
