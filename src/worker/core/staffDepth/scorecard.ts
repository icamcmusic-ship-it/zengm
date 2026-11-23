// Staff Report scorecard: how the staff did, season over season, against the league. Development (young players' change in ovr vs the
// league's young players), scouting (draft picks that beat their slot) and the medical side (games lost to injury vs a league-average
// roster). Plus budget recommendations that follow from it, and the frozen history of past reports.

import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { getProStats } from "../../../common/preDraft.ts";
import type {
	Player,
	StaffReportHistoryEntry,
	StaffScorecard,
} from "../../../common/types.ts";

// Young players: their development is what the staff is judged on
const YOUNG_AGE = 25;
// Drafts judged: old enough to have a few seasons of results, recent enough to be this front office's
const DRAFT_LAG_MIN = 2;
const DRAFT_LAG_MAX = 5;

const regularStats = (p: Player) =>
	getProStats(p).filter((row) => !row.playoffs);

const playedFor = (p: Player, tid: number, season: number) =>
	regularStats(p).some(
		(row) => row.season === season && row.tid === tid && (row.gp ?? 0) > 0,
	);

const ovrIn = (p: Player, season: number) =>
	p.ratings.findLast((r) => r.season === season)?.ovr;

// Team of a season: the last team he played for that season (or his current team in the current season)
const seasonTid = (p: Player, season: number) =>
	regularStats(p)
		.filter((row) => row.season === season && (row.gp ?? 0) > 0)
		.at(-1)?.tid ?? (season === g.get("season") ? p.tid : undefined);

const cache = new Map<string, StaffScorecard>();

export const getSeasonScorecard = async (
	tid: number,
	season: number,
): Promise<StaffScorecard> => {
	const current = season === g.get("season");
	const key = `${g.get("lid")}|${tid}|${season}`;
	if (!current) {
		const hit = cache.get(key);
		if (hit) {
			return hit;
		}
	}

	const players = await idb.merged.players.getAll(
		current ? { tid: [0, Infinity] } : { activeSeason: season },
	);

	// Development
	let devYouSum = 0;
	let devYouN = 0;
	let devLeagueSum = 0;
	let devLeagueN = 0;
	// Injuries
	let injuryYou = 0;
	let injuryLeague = 0;
	const teams = new Set<number>();
	for (const p of players) {
		const t = seasonTid(p, season);
		if (t === undefined || t < 0) {
			continue;
		}
		teams.add(t);
		const games = (p.injuries ?? [])
			.filter((inj) => inj.season === season)
			.reduce((sum, inj) => sum + inj.games, 0);
		injuryLeague += games;
		if (t === tid) {
			injuryYou += games;
		}
		if (season - p.born.year <= YOUNG_AGE) {
			const now = ovrIn(p, season);
			const before = ovrIn(p, season - 1);
			if (now !== undefined && before !== undefined) {
				devLeagueSum += now - before;
				devLeagueN += 1;
				if (t === tid && (current || playedFor(p, tid, season))) {
					devYouSum += now - before;
					devYouN += 1;
				}
			}
		}
	}

	// Scouting: this franchise's picks in the judged drafts, by career win shares rank in their class vs their slot
	let scoutHits = 0;
	let scoutJudged = 0;
	const numTeams = Math.max(1, g.get("numActiveTeams"));
	for (
		let year = season - DRAFT_LAG_MAX;
		year <= season - DRAFT_LAG_MIN;
		year++
	) {
		const draftees = (await idb.merged.players.getAll({ draftYear: year }))
			.filter((p) => p.draft.round > 0 && p.draft.pick > 0)
			.map((p) => ({
				p,
				slot: (p.draft.round - 1) * numTeams + p.draft.pick,
				ws: regularStats(p)
					.filter((row) => row.season <= season)
					.reduce(
						(sum, row) =>
							sum + ((row as any).ows ?? 0) + ((row as any).dws ?? 0),
						0,
					),
			}))
			.sort((a, b) => b.ws - a.ws || a.slot - b.slot);
		for (const [i, x] of draftees.entries()) {
			if (x.p.draft.tid !== tid) {
				continue;
			}
			scoutJudged += 1;
			if (i + 1 <= x.slot) {
				scoutHits += 1;
			}
		}
	}

	const out: StaffScorecard = {
		season,
		tid,
		devYou:
			devYouN > 0 ? Math.round((10 * devYouSum) / devYouN) / 10 : undefined,
		devLeague:
			devLeagueN > 0
				? Math.round((10 * devLeagueSum) / devLeagueN) / 10
				: undefined,
		numDev: devYouN,
		scoutHits,
		scoutJudged,
		injuryGames: injuryYou,
		injuryGamesExpected:
			teams.size > 0 ? Math.round(injuryLeague / teams.size) : 0,
	};
	if (!current) {
		cache.set(key, out);
		if (cache.size > 60) {
			cache.delete(cache.keys().next().value!);
		}
	}
	return out;
};

// Words for a development gap, so the No Visible Ratings challenge sees a band rather than rating points
export const devBand = (card: Pick<StaffScorecard, "devYou" | "devLeague">) => {
	if (card.devYou === undefined || card.devLeague === undefined) {
		return undefined;
	}
	const gap = card.devYou - card.devLeague;
	return gap >= 1.5
		? "Well ahead of the league"
		: gap >= 0.5
			? "Ahead of the league"
			: gap > -0.5
				? "About league average"
				: gap > -1.5
					? "Behind the league"
					: "Well behind the league";
};

// The last few seasons, oldest first (seasons before the league started are left out)
export const getScorecards = async (tid: number, numSeasons = 3) => {
	const season = g.get("season");
	const out: StaffScorecard[] = [];
	for (
		let s = Math.max(g.get("startingSeason"), season - numSeasons + 1);
		s <= season;
		s++
	) {
		out.push(await getSeasonScorecard(tid, s));
	}
	return out;
};

// ---- Budget recommendations -------------------------------------------------

export type BudgetRec = {
	item: "coaching" | "health" | "scouting" | "facilities";
	title: string;
	text: string;
};

const ITEM_NAMES: Record<BudgetRec["item"], string> = {
	coaching: "coaching",
	health: "health",
	scouting: "scouting",
	facilities: "facilities",
};

// What the scorecard says about the budget, next to the league's average levels (only with budget items on). Raising an item that
// lags where the results lag; trimming one that is well above average where results don't need it.
export const getBudgetRecs = async (
	tid: number,
	card: StaffScorecard | undefined,
): Promise<BudgetRec[]> => {
	if (!g.get("budget") || !card) {
		return [];
	}
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const me = teams.find((t) => t.tid === tid);
	if (!me || teams.length < 2) {
		return [];
	}
	const avg = (item: BudgetRec["item"]) => {
		const levels = teams
			.map((t) => t.budget[item])
			.filter((x) => Number.isFinite(x));
		return levels.length > 0
			? levels.reduce((sum, x) => sum + x, 0) / levels.length
			: Number.NaN;
	};
	const recs: BudgetRec[] = [];
	const level = (item: BudgetRec["item"]) => me.budget[item];
	const diff = (item: BudgetRec["item"]) => level(item) - avg(item);
	const name = (item: BudgetRec["item"]) => ITEM_NAMES[item];

	// Coaching budget only matters without the real coaching staff
	const devGap =
		card.devYou !== undefined && card.devLeague !== undefined
			? card.devYou - card.devLeague
			: undefined;
	if (!g.get("coachingStaff") && devGap !== undefined) {
		if (devGap <= -0.5 && diff("coaching") < -3) {
			recs.push({
				item: "coaching",
				title: "Raise the coaching budget",
				text: `Your young players are developing behind the league, and your ${name("coaching")} level (${level("coaching")}) is below the league average (${Math.round(avg("coaching"))}).`,
			});
		} else if (devGap >= 1 && diff("coaching") > 15) {
			recs.push({
				item: "coaching",
				title: "The coaching budget could come down",
				text: `Development is well ahead of the league and your ${name("coaching")} level (${level("coaching")}) is far above average (${Math.round(avg("coaching"))}); a little less would still keep you ahead.`,
			});
		}
	}
	const injuryRatio =
		card.injuryGamesExpected > 0
			? card.injuryGames / card.injuryGamesExpected
			: undefined;
	if (injuryRatio !== undefined) {
		if (injuryRatio >= 1.2 && diff("health") < 0) {
			recs.push({
				item: "health",
				title: "Raise the health budget",
				text: `${card.injuryGames} games lost to injury vs ${card.injuryGamesExpected} for an average team, and your ${name("health")} level (${level("health")}) is below the league average (${Math.round(avg("health"))}). Health spending shortens injuries.`,
			});
		} else if (injuryRatio <= 0.6 && diff("health") > 15) {
			recs.push({
				item: "health",
				title: "The health budget has room",
				text: `Only ${card.injuryGames} games lost to injury vs ${card.injuryGamesExpected} for an average team, with a ${name("health")} level well above average. Some of it could go elsewhere, though luck plays a part.`,
			});
		}
	}
	if (card.scoutJudged >= 3) {
		const rate = card.scoutHits / card.scoutJudged;
		if (rate < 0.4 && diff("scouting") < -3) {
			recs.push({
				item: "scouting",
				title: "Raise the scouting budget",
				text: `Only ${card.scoutHits} of your last ${card.scoutJudged} draft picks beat their slot, and your ${name("scouting")} level (${level("scouting")}) is below average (${Math.round(avg("scouting"))}).`,
			});
		}
	}
	return recs;
};

// ---- History ------------------------------------------------------------------

export const getStaffHistory = (): StaffReportHistoryEntry[] => {
	try {
		return g.get("staffReportHistory") ?? [];
	} catch {
		return [];
	}
};
