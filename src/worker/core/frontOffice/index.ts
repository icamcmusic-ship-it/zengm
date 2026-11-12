// Front Office Budget (League Extra "frontOffice", basketball). The departments are the four budget items (Scouting, Medical = health,
// Coaching, Facilities, unchanged) plus Analytics and Travel & Sports Science, whose levels live in t.frontOffice and are paid and
// recorded like the others in teamSeason.frontOffice. Formulas: common/frontOffice.ts. With the setting off nothing here runs, no random
// numbers are drawn and every hook keeps its old code path.

import {
	DEFAULT_LEVEL,
	MAX_LEVEL,
	levelToEffect,
	scoutingEffectStddev,
} from "../../../common/budgetLevels.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	FRONT_OFFICE_DEPTS,
	FRONT_OFFICE_NEW_KEYS,
	aiAllocate,
	analyticsGmShift,
	deptAmount,
	envelopeAmount,
	medicalAgeDurationFactor,
	medicalInjuryRateFactor,
	ownerTargetLevel,
	travelEnduranceFallback,
	travelPenaltyScale,
	type FrontOfficeDept,
	type FrontOfficeNewKey,
} from "../../../common/frontOffice.ts";
import type {
	FrontOfficeReview,
	Team,
	TeamSeasonWithoutKey,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import getLevelLastThree from "../finances/getLevelLastThree.ts";

export const frontOfficeEnabled = () =>
	__SPORT === "basketball" && featureOn("frontOffice") && !!g.get("budget");

// A team's level of a new department. Before it was ever set: the average of its scouting, health and facilities levels (its owner's
// usual spending), so turning the setting on in an existing league changes nobody's tier
export const defaultNewDeptLevel = (t: {
	budget: Pick<Team["budget"], "scouting" | "health" | "facilities">;
}) =>
	helpers.bound(
		Math.round((t.budget.scouting + t.budget.health + t.budget.facilities) / 3),
		1,
		MAX_LEVEL,
	);

export const getNewDeptLevel = (
	t: Pick<Team, "budget" | "frontOffice">,
	key: FrontOfficeNewKey,
) => t.frontOffice?.[key] ?? defaultNewDeptLevel(t);

// Current levels of all six departments (coaching follows the coaching staff when that's on)
export const getDeptLevels = (
	t: Pick<Team, "budget" | "frontOffice">,
): Record<FrontOfficeDept, number> => ({
	scouting: t.budget.scouting,
	analytics: getNewDeptLevel(t, "analytics"),
	health: t.budget.health,
	travel: getNewDeptLevel(t, "travel"),
	coaching: t.budget.coaching,
	facilities: t.budget.facilities,
});

// Like finances.getLevelLastThree for the new departments: the per-game average over the last 3 seasons. Missing seasons and games
// played before the setting was on count at the team's initial level (like initialBudget for the old items), so a new level phases in
// over 3 seasons instead of applying at once
export const initialNewDeptLevel = (t: Pick<Team, "initialBudget">) =>
	defaultNewDeptLevel({ budget: t.initialBudget });

export const getNewDeptLevelLastThree = async (
	key: FrontOfficeNewKey,
	extra: { tid: number; t?: Team; teamSeasons?: TeamSeasonWithoutKey[] },
) => {
	if (!g.get("budget")) {
		return DEFAULT_LEVEL;
	}
	const NUM_SEASONS = 3;
	const t = extra.t ?? (await idb.cache.teams.get(extra.tid));
	if (!t) {
		return DEFAULT_LEVEL;
	}
	const current = initialNewDeptLevel(t);
	const teamSeasons =
		extra.teamSeasons ??
		(await idb.cache.teamSeasons.indexGetAll("teamSeasonsByTidSeason", [
			[extra.tid, g.get("season") - 2],
			[extra.tid, g.get("season")],
		]));
	const rows = teamSeasons.slice(-NUM_SEASONS);
	const numGames = g.get("numGames");
	let levelSum = 0;
	let gpSum = 0;
	let numImpute = NUM_SEASONS - rows.length;
	for (const row of rows) {
		const gp = helpers.getTeamSeasonGp(row);
		const level = row.frontOffice?.expenseLevels[key] ?? 0;
		if (level === 0) {
			if (gp === 0) {
				if (
					g.get("season") === row.season &&
					g.get("phase") > PHASE.REGULAR_SEASON
				) {
					numImpute += 1;
				}
			} else {
				levelSum += current * gp;
				gpSum += gp;
			}
		} else {
			// Games played before the setting was turned on have no level: counted at the current level
			const gpRecorded = Math.min(gp, row.frontOffice?.gpRecorded ?? gp);
			levelSum += level + current * (gp - gpRecorded);
			gpSum += gp;
		}
	}
	levelSum += current * numImpute * numGames;
	gpSum += numImpute * numGames;
	return gpSum > 0 ? Math.round(levelSum / gpSum) : DEFAULT_LEVEL;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Expenses (writeTeamStats, regular season games only)

const emptyReview = (): FrontOfficeReview => ({
	injuries: 0,
	injuryGames: 0,
	durationGamesSaved: 0,
	injuriesAvoided: 0,
	injuryGamesAvoided: 0,
	fatigueGames: 0,
	fatiguePenalty: 0,
	fatigueSaved: 0,
});

const ensureSeasonRow = (teamSeason: TeamSeasonWithoutKey) => {
	teamSeason.frontOffice ??= {
		expenses: { analytics: 0, travel: 0 },
		expenseLevels: { analytics: 0, travel: 0 },
		gpRecorded: 0,
	};
	return teamSeason.frontOffice;
};

const ensureReview = (teamSeason: TeamSeasonWithoutKey) => {
	const fo = ensureSeasonRow(teamSeason);
	fo.review ??= emptyReview();
	return fo.review;
};

// Pay the new departments for one game and record their levels. Returns the amount paid (thousands of dollars)
export const payGame = (t: Team, teamSeason: TeamSeasonWithoutKey) => {
	const fo = ensureSeasonRow(teamSeason);
	const salaryCap = g.get("salaryCap");
	const numGames = g.get("numGames");
	let paid = 0;
	for (const key of FRONT_OFFICE_NEW_KEYS) {
		const level = getNewDeptLevel(t, key);
		const amount = deptAmount(key, level, salaryCap) / numGames;
		fo.expenses[key] += amount;
		fo.expenseLevels[key] += level;
		paid += amount;
	}
	fo.gpRecorded = (fo.gpRecorded ?? 0) + 1;
	return paid;
};

// The fatigue measurement a game sim team object carries (set in loadTeams, injuryDepthTeam and the game sim)
export type SimFatigue = { penalty: number; saved: number };

export const addSimFatigue = (
	t: { foFatigue?: SimFatigue },
	neutralMult: number,
	scale: number,
) => {
	const penalty = 100 * (1 - neutralMult);
	t.foFatigue ??= { penalty: 0, saved: 0 };
	t.foFatigue.penalty += penalty;
	t.foFatigue.saved += penalty * (1 - scale);
};

export const recordFatigue = (
	teamSeason: TeamSeasonWithoutKey,
	fatigue: SimFatigue | undefined,
) => {
	if (!fatigue || fatigue.penalty <= 0) {
		return;
	}
	const review = ensureReview(teamSeason);
	review.fatigueGames += 1;
	review.fatiguePenalty += fatigue.penalty;
	review.fatigueSaved += fatigue.saved;
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Game sim inputs (loadTeams)

export type SimFrontOffice = {
	healthLevel: number;
	travelLevel: number;
	injuryRateFactor: number;
	travelScale: number;
	enduranceFallback: number;
};

export const getSimFrontOffice = async (
	tid: number,
): Promise<SimFrontOffice | undefined> => {
	if (tid < 0 || !frontOfficeEnabled()) {
		return;
	}
	const healthLevel = await getLevelLastThree("health", { tid });
	const travelLevel = await getNewDeptLevelLastThree("travel", { tid });
	return {
		healthLevel,
		travelLevel,
		injuryRateFactor: medicalInjuryRateFactor(healthLevel),
		travelScale: travelPenaltyScale(travelLevel),
		enduranceFallback: travelEnduranceFallback(travelLevel),
	};
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Injuries (writePlayerStats)

// Medical recovery factor for a player's injury duration (multiplies the health budget's effect), 1 when off
export const getInjuryDurationFactor = (healthLevel: number, age: number) =>
	frontOfficeEnabled() ? medicalAgeDurationFactor(healthLevel, age) : 1;

export const recordInjury = async ({
	tid,
	games,
	neutralGames,
	healthLevel,
}: {
	tid: number;
	games: number;
	neutralGames: number;
	healthLevel: number;
}) => {
	if (tid < 0 || !frontOfficeEnabled()) {
		return;
	}
	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[tid, g.get("season")],
	);
	if (!teamSeason) {
		return;
	}
	const review = ensureReview(teamSeason);
	const avoided = 1 / medicalInjuryRateFactor(healthLevel) - 1;
	review.injuries += 1;
	review.injuryGames += games;
	review.durationGamesSaved += neutralGames - games;
	review.injuriesAvoided += avoided;
	review.injuryGamesAvoided += avoided * neutralGames;
	await idb.cache.teamSeasons.put(teamSeason);
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Owner's envelope

export const getPopRankByTid = async () => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const ranks = helpers.getPopRanks(teams);
	return new Map(teams.map((t, i) => [t.tid, ranks[i]!]));
};

export const getTargetLevel = async (tid: number) => {
	const ranks = await getPopRankByTid();
	return ownerTargetLevel(
		ranks.get(tid) ?? (g.get("numActiveTeams") + 1) / 2,
		g.get("numActiveTeams"),
	);
};

// What a season's department spending was (thousands of dollars), from the recorded expenses
export const getSeasonSpend = (teamSeason: TeamSeasonWithoutKey) =>
	teamSeason.expenses.scouting +
	teamSeason.expenses.coaching +
	teamSeason.expenses.health +
	teamSeason.expenses.facilities +
	(teamSeason.frontOffice?.expenses.analytics ?? 0) +
	(teamSeason.frontOffice?.expenses.travel ?? 0);

// The envelope for the games played so far (thousands of dollars)
export const getSeasonEnvelope = async (teamSeason: TeamSeasonWithoutKey) => {
	const target = await getTargetLevel(teamSeason.tid);
	const gp = Math.min(helpers.getTeamSeasonGp(teamSeason), g.get("numGames"));
	return (envelopeAmount(target, g.get("salaryCap")) * gp) / g.get("numGames");
};

// ---------------------------------------------------------------------------------------------------------------------------------
// AI teams (preseason, replaces the old "sometimes reset each budget item")

// A team's leanings: its GM's (AI GM Personalities), or else from its strategy and a fixed per-team taste
export const getLeanings = (t: Team) => {
	if (t.gm && featureOn("gmPersonalities")) {
		return {
			analytics: t.gm.traits.analytics,
			patience: t.gm.traits.patience,
		};
	}
	// Deterministic per team and league, -0.5 to 0.5
	const h =
		Math.sin((t.tid + 1) * 12.9898 + g.get("lid") * 78.233) * 43758.5453;
	return {
		analytics: h - Math.floor(h) - 0.5,
		patience: t.strategy === "rebuilding" ? 0.5 : -0.5,
	};
};

export const allocateAi = (t: Team, targetLevel: number) => {
	const staff = __SPORT === "basketball" && !!g.get("coachingStaff");
	const depts = FRONT_OFFICE_DEPTS.filter((d) => !staff || d !== "coaching");
	const levels = aiAllocate(targetLevel, getLeanings(t), depts);
	t.budget.scouting = levels.scouting;
	t.budget.health = levels.health;
	t.budget.facilities = levels.facilities;
	if (!staff) {
		t.budget.coaching = levels.coaching;
	}
	t.frontOffice = { analytics: levels.analytics, travel: levels.travel };
};

// ---------------------------------------------------------------------------------------------------------------------------------
// AI GMs: spending on analytics makes a GM lean analytics (gm/index.ts)

export const gmAnalyticsShift = (t: Team) =>
	frontOfficeEnabled() ? analyticsGmShift(getNewDeptLevel(t, "analytics")) : 0;

// ---------------------------------------------------------------------------------------------------------------------------------
// Season review (Team Finances)

export const getScoutingAccuracy = async (scoutingLevel: number) => {
	const prospects = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	if (prospects.length === 0 || g.get("godMode")) {
		return;
	}
	// The same random draws at the league-average level: fuzz is a normal draw times the level's stddev (then scaled for younger
	// classes, by scouting actions and as classes age, all multiplicative), so the same draws at level 34 are fuzz times the stddev ratio.
	// (The draws were made at the level of their time, approximated by the current 3-season level)
	const ratio =
		scoutingEffectStddev(DEFAULT_LEVEL) / scoutingEffectStddev(scoutingLevel);
	let sum = 0;
	let sumAvg = 0;
	for (const p of prospects) {
		const fuzz = p.ratings.at(-1)!.fuzz ?? 0;
		sum += Math.abs(fuzz);
		sumAvg += Math.abs(fuzz * ratio);
	}
	return {
		prospects: prospects.length,
		error: sum / prospects.length,
		errorAvg: sumAvg / prospects.length,
	};
};

export const getReview = async (tid: number, season = g.get("season")) => {
	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[tid, season],
	);
	const t = await idb.cache.teams.get(tid);
	if (!teamSeason || !t) {
		return;
	}
	const scoutingLevel = await getLevelLastThree("scouting", { tid });
	return {
		season,
		gp: helpers.getTeamSeasonGp(teamSeason),
		measured: teamSeason.frontOffice?.review ?? emptyReview(),
		scouting:
			tid === g.get("userTid")
				? await getScoutingAccuracy(scoutingLevel)
				: undefined,
	};
};

// Everything Team Finances shows about the departments
export const getFinancesInfo = async (tid: number) => {
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return;
	}
	const teams = (await idb.cache.teams.getAll()).filter((t2) => !t2.disabled);
	const levels = getDeptLevels(t);
	// League rank of each department's current level (1 = most spent)
	const ranks = {} as Record<FrontOfficeDept, number>;
	const leagueAvg = {} as Record<FrontOfficeDept, number>;
	for (const dept of FRONT_OFFICE_DEPTS) {
		const all = teams.map((t2) => getDeptLevels(t2)[dept]);
		ranks[dept] = 1 + all.filter((x) => x > levels[dept]).length;
		leagueAvg[dept] = all.reduce((a, b) => a + b, 0) / all.length;
	}
	const lastThree: Record<FrontOfficeNewKey, number> = {
		analytics: await getNewDeptLevelLastThree("analytics", { tid, t }),
		travel: await getNewDeptLevelLastThree("travel", { tid, t }),
	};
	const target = await getTargetLevel(tid);
	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[tid, g.get("season")],
	);
	return {
		levels,
		ranks,
		leagueAvg,
		lastThree,
		targetLevel: target,
		envelope: envelopeAmount(target, g.get("salaryCap")),
		seasonSpend: teamSeason ? getSeasonSpend(teamSeason) : 0,
		seasonEnvelope: teamSeason ? await getSeasonEnvelope(teamSeason) : 0,
		review: await getReview(tid),
		prevReview: await getReview(tid, g.get("season") - 1),
		effects: {
			analytics: levelToEffect(lastThree.analytics),
			travel: levelToEffect(lastThree.travel),
		},
	};
};
