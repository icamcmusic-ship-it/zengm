// Draft-and-stash (basketball): a team drafts a prospect whose last season before the draft was at a pro club abroad and keeps
// his rights while he keeps playing there. The rules are pure functions here; the worker side (worker/core/draftStash) stores
// and moves players. See docs/native-features.md, Draft-and-stash.
//
// Representation: a stashed player has tid PLAYER.STASHED (not on any roster, so no roster spot, no payroll, no games) and
// p.stash = { tid, season, league } with the team holding his rights. Each season abroad adds a stats row with tid
// DOES_NOT_EXIST, the league as its team name and stash: true, which common/preDraft.ts counts with his pre-draft/overseas
// rows, never as a pro season.
//
// Nothing here draws from the game's random numbers: AI choices are fixed rules and the overseas stats come from a small RNG
// seeded with the player and the season (salted per league).
import { PHASE, PLAYER } from "./constants.ts";
import { Rng, clamp } from "./collegeStats/rng.ts";
import {
	getLeagueEnv,
	getLeagueTier,
	isOverseasLeague,
} from "./collegeStats/overseas.ts";
import {
	getCountry,
	getRegion,
	getSchool,
} from "./collegeStats/colleges.helpers.ts";
import { pickLeagueOfTier } from "./collegeStats/career.ts";
import { simulateSeason } from "./collegeStats/season.ts";
import type { CollegeSeason, Ratings } from "./collegeStats/types.ts";
import type { Phase } from "./types.ts";

// His rights lapse at the start of free agency in the season this many seasons after his draft year...
export const STASH_MAX_SEASONS = 4;
// ...or the season he is this old, whichever comes first
export const STASH_MAX_AGE = 27;
// Brought over within this many seasons after his draft year: he signs the rookie scale contract of his pick
export const STASH_ROOKIE_WINDOW = 1;
// Seasons of a contract computed from his value (outside the rookie window)
export const STASH_CONTRACT_YEARS = 3;
// AI trade value of a stashed player's rights, relative to the same player on a roster
export const STASH_TRADE_VALUE_FACTOR = 0.8;

// The offseason phases a stashed player can be stashed or brought over in (after the draft, before the preseason)
export const isStashWindowPhase = (phase: Phase) =>
	phase === PHASE.DRAFT ||
	phase === PHASE.AFTER_DRAFT ||
	phase === PHASE.RESIGN_PLAYERS ||
	phase === PHASE.FREE_AGENCY;

type StatsRowLike = {
	tid?: number;
	season: number;
	playoffs?: boolean;
	teamName?: string;
	stash?: true;
};

/**
 * The overseas league of his most recent season before the draft (or abroad since), undefined if that season was not at a pro club abroad. Reads his pre-draft rows (team name) and falls back to his college field (generated prospects with a pro club have it there).
 */
export const getOverseasLeague = (p: {
	stats: StatsRowLike[];
	college?: string;
	draft: { year: number };
	preDraftCareer?: { years: { school: string }[] };
}): string | undefined => {
	const draftYear = p.draft.year;
	let last: StatsRowLike | undefined;
	for (const row of p.stats) {
		if (
			row.tid === PLAYER.DOES_NOT_EXIST &&
			!row.playoffs &&
			(row.season <= draftYear || row.stash) &&
			(!last || row.season >= last.season)
		) {
			last = row;
		}
	}
	const name =
		last?.teamName ?? p.preDraftCareer?.years.at(-1)?.school ?? p.college;
	if (name !== undefined && name !== "" && isOverseasLeague(name)) {
		return name;
	}
	return undefined;
};

/**
 * The last season his rights can be held: at the start of free agency of this season they lapse if he is still abroad.
 */
export const getStashLapseSeason = (p: {
	draft: { year: number };
	born: { year: number };
}) => Math.min(p.draft.year + STASH_MAX_SEASONS, p.born.year + STASH_MAX_AGE);

// Do his rights lapse at the start of free agency in this season?
export const stashRightsLapse = (
	p: { draft: { year: number }; born: { year: number } },
	season: number,
) => season >= getStashLapseSeason(p);

/**
 * Can a player on a team be stashed right now? A reason string when he can't (for the UI), undefined when he can.
 */
export const stashBlockedReason = ({
	p,
	season,
	phase,
	hasProStats,
	overseasLeague,
}: {
	p: { tid: number; draft: { year: number; round: number } };
	season: number;
	phase: Phase;
	hasProStats: boolean;
	overseasLeague: string | undefined;
}): string | undefined => {
	if (p.tid < 0) {
		return "Only a player on a team can be stashed.";
	}
	if (overseasLeague === undefined) {
		return "Only a player whose last season before the draft was with a club overseas can be stashed.";
	}
	if (p.draft.year !== season || p.draft.round <= 0) {
		return "Only a player drafted this season can be stashed.";
	}
	if (!isStashWindowPhase(phase)) {
		return "Players can only be stashed between the draft and the start of the regular season.";
	}
	if (hasProStats) {
		return "He has already played for his team.";
	}
	return undefined;
};

/**
 * Can a stashed player be brought over right now? undefined when he can.
 */
export const bringOverBlockedReason = ({
	phase,
	rosterSize,
	maxRosterSize,
}: {
	phase: Phase;
	rosterSize: number;
	maxRosterSize: number;
}): string | undefined => {
	if (!isStashWindowPhase(phase)) {
		return "A stashed player can only be brought over between the draft and the start of the regular season.";
	}
	if (rosterSize >= maxRosterSize) {
		return `The roster is full (${maxRosterSize} players).`;
	}
	return undefined;
};

/**
 * A buyout of his contract abroad, paid by the team that brings him over (a team expense, in thousands of dollars). None in the offseason he was stashed (he never really left), otherwise a fraction of the minimum contract that grows with the strength of the league.
 */
export const getStashBuyout = ({
	league,
	seasonsAbroad,
	minContract,
}: {
	league: string;
	seasonsAbroad: number;
	minContract: number;
}) => {
	if (seasonsAbroad <= 0) {
		return 0;
	}
	const strength = getSchool(league)?.strength ?? 70;
	const factor = clamp((strength - 50) / 40, 0.25, 1);
	return Math.round((minContract * factor) / 10) * 10;
};

export type StashContractPlan = {
	amount: number;
	exp: number;
	rookie: boolean;
};

/**
 * The contract he signs when brought over in this season's offseason: the rookie scale of his pick inside the rookie window (when the league has a rookie scale), otherwise his market value (marketAmount, the game's contract formula) for STASH_CONTRACT_YEARS seasons.
 */
export const getStashContract = ({
	season,
	draftYear,
	rookieAmount,
	rookieLength,
	marketAmount,
	minContract,
}: {
	season: number;
	draftYear: number;
	// undefined when there is no rookie scale (no automatic rookie contracts, or an unknown pick)
	rookieAmount: number | undefined;
	rookieLength: number;
	marketAmount: number;
	minContract: number;
}): StashContractPlan => {
	if (rookieAmount !== undefined && season - draftYear <= STASH_ROOKIE_WINDOW) {
		return {
			amount: Math.max(minContract, rookieAmount),
			exp: season + rookieLength,
			rookie: true,
		};
	}
	return {
		amount: Math.max(minContract, marketAmount),
		exp: season + STASH_CONTRACT_YEARS,
		rookie: false,
	};
};

// The ovr of a team's Nth best player (its rotation bar), 0 for a short roster
export const rotationOvr = (ovrs: number[], n = 10) => {
	const sorted = [...ovrs].sort((a, b) => b - a);
	return sorted[n - 1] ?? 0;
};

/**
 * AI rule at the end of the draft: stash a pick who is not in the lottery (pick number above 10) when the roster is too full for him or he is far from good enough for the rotation (4+ ovr below its 10th best player).
 */
export const aiShouldStash = ({
	pickNum,
	ovr,
	teamRotationOvr,
	rosterSize,
	maxRosterSize,
}: {
	pickNum: number;
	ovr: number;
	teamRotationOvr: number;
	rosterSize: number;
	maxRosterSize: number;
}) => {
	if (pickNum <= 10) {
		return false;
	}
	return rosterSize > maxRosterSize || ovr < teamRotationOvr - 4;
};

/**
 * AI rule at the start of free agency: bring a stashed player over when he is good enough for the rotation (at most 1 ovr below its 10th best player) and there is room. In his last season before his rights lapse, the bar is lower (4 below): better a young backup than nothing.
 */
export const aiShouldBringOver = ({
	ovr,
	teamRotationOvr,
	rosterSize,
	maxRosterSize,
	lastChance,
}: {
	ovr: number;
	teamRotationOvr: number;
	rosterSize: number;
	maxRosterSize: number;
	lastChance: boolean;
}) => {
	if (rosterSize >= maxRosterSize) {
		return false;
	}
	return ovr >= teamRotationOvr - (lastChance ? 4 : 1);
};

// The ovr a stashed player needs to move up from a development tier league to a mid tier one, and from a mid tier league to a top one
export const STASH_MOVE_UP_OVR = { mid: 44, top: 49 };

/**
 * The league a stashed player spends a season in: the one he was in, unless he has outgrown a development or mid tier league (his ovr at
 * the bar of the tier above). Then a league of the next tier up, from the full list of overseas leagues (preDraftPaths' domestic leagues
 * included), most likely his own country's or one of his part of the world. Seeded by the player and the season, so the same season always
 * gives the same league; one step a season at most.
 */
export const getStashLeague = ({
	pid,
	season,
	league,
	ovr,
	bornLoc,
}: {
	pid: number;
	season: number;
	league: string;
	ovr: number;
	bornLoc: string;
}) => {
	const tier = getLeagueTier(league);
	const next = tier === "dev" ? "mid" : tier === "mid" ? "top" : undefined;
	if (next === undefined || ovr < STASH_MOVE_UP_OVR[next]) {
		return league;
	}
	return pickLeagueOfTier(
		next,
		getRegion(bornLoc),
		new Rng(`draftStash|moveUp|${pid}|${season}`),
		getCountry(bornLoc),
	);
};

/**
 * One season abroad for a stashed player, from the overseas stats generator (collegeStats), seeded by the player and the season so the same league always gives the same line. ovr and ratings are his current ones; age his age that season.
 */
export const simulateStashSeason = ({
	pid,
	season,
	league,
	ratings,
	ovr,
	age,
	pos,
}: {
	pid: number;
	season: number;
	league: string;
	ratings: Ratings;
	ovr: number;
	age: number;
	pos: string;
}): CollegeSeason => {
	const school = getSchool(league);
	const rng = new Rng(`draftStash|${pid}|${season}`);
	// Measured against a typical draft class (mean 41, sd 8.5, like the college stats prior): a stashed player who developed
	// plays a bigger role
	const zTalent = clamp((ovr - 41) / 8.5, -2.5, 2.5);
	return simulateSeason({
		season,
		rng,
		ratings,
		zTalent,
		classIndex: 3,
		school: league,
		conference: undefined,
		strength: school?.strength ?? 70,
		gameMinutes: school?.gameMinutes ?? 40,
		noise: 1,
		pos,
		proEnv: getLeagueEnv(league),
		age,
	});
};
