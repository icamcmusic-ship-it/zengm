// The Owner page (Owner's Office League Extra, user's team): who the owner is, his personality traits, his mood over the seasons, this
// season's budget meeting goals and progress, projects, a pending sale, his mid-season requests, the stored evaluations, and a projected
// call on the GM's job from the current mood and progress
import { PHASE } from "../../common/constants.ts";
import { OWNER_TYPES } from "../../common/commercial.ts";
import {
	baseMoodDeltas,
	capMoodDeltas,
	getExpectedProfit,
	getSalaryCapScale,
} from "../../common/ownerMood.ts";
import {
	evaluateOwnerGoals,
	judgedGoalsPayroll,
} from "../../common/ownerOffice.ts";
import {
	JOB_OUTLOOK_NAMES,
	OWNER_REQUESTS,
	OWNER_TRAIT_INFO,
	OWNER_TRAIT_KEYS,
	jobOutlook,
	sumAdjustments,
	traitLabel,
} from "../../common/ownerProfile.ts";
import { seasonOwnerJudgedProfit } from "../../common/teamSeasonFinances.ts";
import type {
	OwnerMood,
	Team,
	TeamSeasonWithoutKey,
} from "../../common/types.ts";
import { isCollege } from "../core/college/isCollege.ts";
import { commercialEnabled, getOwnerType } from "../core/commercial/index.ts";
import getLuxuryTaxAmount from "../core/finances/getLuxuryTaxAmount.ts";
import {
	getFinancesInfo,
	ownerOfficeEnabled,
} from "../core/ownerOffice/index.ts";
import {
	describeRequest,
	getFiringRule,
	getOwnerProfile,
	requestsActive,
} from "../core/ownerOffice/owner.ts";
import getPayroll from "../core/team/getPayroll.ts";
import { idb } from "../db/index.ts";
import { defineView } from "../util/defineView.ts";
import { g, helpers } from "../util/index.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import { augmentOwnerMoods } from "./ownerMoodSeasons.ts";

const zeroMood = (): OwnerMood => ({ wins: 0, playoffs: 0, money: 0 });

const sumMood = (mood: OwnerMood) => mood.wins + mood.playoffs + mood.money;

// This season's evaluation as it would go if the season ended on the current pace: wins and judged profit scaled up to a full season,
// the playoffs from the current winning percentage (until they are known), the luxury tax the payroll would owe now
export const projectEvaluation = async (
	t: Team,
	teamSeason: TeamSeasonWithoutKey,
) => {
	const season = g.get("season");
	const rule = await getFiringRule();
	const canFire =
		season >= g.get("gracePeriodEnd") + rule.graceBonus && !g.get("godMode");
	const applied = season >= g.get("gracePeriodEnd") && !g.get("godMode");

	if (teamSeason.ownerEvaluation) {
		const mood = teamSeason.ownerMood ?? zeroMood();
		const total = sumMood(mood);
		return {
			evaluated: true,
			moodBefore: undefined,
			deltas: teamSeason.ownerEvaluation.applied
				? teamSeason.ownerEvaluation.cappedDeltas
				: zeroMood(),
			projectedTotal: total,
			line: rule.line,
			canFire,
			canFireSeason: g.get("gracePeriodEnd") + rule.graceBonus,
			outlook: jobOutlook({ projectedTotal: total, line: rule.line, canFire }),
		};
	}

	const mood = teamSeason.ownerMood ?? zeroMood();
	const numGames = g.get("numGames");
	const gp = helpers.getTeamSeasonGp(teamSeason);
	const phase = g.get("phase");
	const regularSeasonOver = phase >= PHASE.PLAYOFFS;
	const winp = gp > 0 ? (teamSeason.won + 0.5 * teamSeason.tied) / gp : 0.5;
	const won = regularSeasonOver ? teamSeason.won : winp * numGames;
	const playoffRoundsWon = regularSeasonOver
		? teamSeason.playoffRoundsWon
		: winp >= 0.5
			? 0
			: -1;

	const salaryCapScale = getSalaryCapScale(g.get("salaryCap"));
	const expectedProfit = getExpectedProfit(g.get("salaryCap"));
	const payroll = await getPayroll(t.tid);
	let profit = seasonOwnerJudgedProfit(teamSeason) / 1000;
	if (!regularSeasonOver) {
		profit = gp > 0 ? (profit * numGames) / gp : expectedProfit;
		profit -= getLuxuryTaxAmount(payroll, false) / 1000;
	}

	const deltas = baseMoodDeltas({
		won,
		numGames,
		playoffRoundsWon,
		numPlayoffRounds: g.get("numGamesPlayoffSeries", "current").length,
		profit,
		expectedProfit,
		salaryCapScale,
		budget: !!g.get("budget"),
	});
	if (commercialEnabled()) {
		const weights = OWNER_TYPES[getOwnerType(t)].moodWeights;
		deltas.wins *= weights.wins;
		deltas.playoffs *= weights.playoffs;
		deltas.money *= weights.money;
	}
	if (teamSeason.ownerGoals) {
		const result = evaluateOwnerGoals(teamSeason.ownerGoals, {
			won,
			profit,
			...judgedGoalsPayroll(teamSeason.ownerGoals, payroll),
			numGames,
			salaryCapScale,
			luxuryPayroll: g.get("luxuryPayroll"),
			budget: !!g.get("budget"),
		});
		deltas.wins += result.moodDeltas.wins;
		deltas.money += result.moodDeltas.money;
	}
	if (teamSeason.ownerSeason) {
		const sums = sumAdjustments(teamSeason.ownerSeason.adjustments);
		deltas.wins += sums.wins;
		deltas.playoffs += sums.playoffs;
		deltas.money += sums.money;
	}
	const capped = applied ? capMoodDeltas(mood, deltas) : zeroMood();
	const projectedTotal = sumMood(mood) + sumMood(capped);
	return {
		evaluated: false,
		moodBefore: mood,
		deltas: capped,
		projectedTotal,
		line: rule.line,
		canFire,
		canFireSeason: g.get("gracePeriodEnd") + rule.graceBonus,
		outlook: jobOutlook({ projectedTotal, line: rule.line, canFire }),
	};
};

export default defineView({
	id: "owner",
	load: async ({ updateEvents }) => {
		const off = featureOffError("ownerOffice");
		if (off) {
			return off;
		}
		if (!ownerOfficeEnabled()) {
			return {
				errorMessage:
					"The Owner page needs the budget setting (League Settings → Finances).",
			};
		}
		if (isCollege()) {
			return {
				errorMessage:
					"There is no owner in college leagues: the athletic department judges the season against the program's expectations.",
			};
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("gameSim") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("teamFinances") &&
			!updateEvents.has("gameAttributes")
		) {
			return;
		}

		const tid = g.get("userTid");
		const season = g.get("season");
		const t = await idb.cache.teams.get(tid);
		const teamSeason = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsByTidSeason",
			[tid, season],
		);
		if (!t || !teamSeason) {
			return { errorMessage: "Team not found." };
		}

		const profile = getOwnerProfile(t);
		const ownerType = commercialEnabled()
			? {
					key: getOwnerType(t),
					...OWNER_TYPES[getOwnerType(t)],
				}
			: undefined;

		const traits = OWNER_TRAIT_KEYS.map((key) => ({
			key,
			...OWNER_TRAIT_INFO[key],
			value: profile.traits[key],
			label: traitLabel(key, profile.traits[key]),
		}));

		// Mood over the seasons that have been evaluated (this season once its evaluation ran), like the evaluation message
		const minSeason = Math.min(
			season,
			Math.max(g.get("gracePeriodEnd") - 2, season - 9),
		);
		const teamSeasons = (
			await idb.merged.teamSeasons.getAll({ tid, seasons: [minSeason, season] })
		).filter((ts) => ts.season < season || ts.ownerEvaluation);
		const ownerMoods = await augmentOwnerMoods({
			tid,
			moods: teamSeasons.map((ts) => ts.ownerMood ?? zeroMood()),
			seasons: teamSeasons.map((ts) => ts.season),
		});

		const evaluations = teamSeasons
			.filter((ts) => ts.ownerEvaluation)
			.map((ts) => ({
				season: ts.season,
				...ts.ownerEvaluation!,
				mood: ts.ownerMood,
			}))
			.reverse();

		const goals = teamSeason.ownerGoals;
		const payroll = await getPayroll(tid);
		const progress = {
			won: teamSeason.won,
			lost: teamSeason.lost,
			tied: teamSeason.tied,
			otl: teamSeason.otl,
			gp: helpers.getTeamSeasonGp(teamSeason),
			numGames: g.get("numGames"),
			payroll,
			seasonAvgPayroll:
				goals?.payrollTrack && goals.payrollTrack.n > 0
					? goals.payrollTrack.sum / goals.payrollTrack.n
					: undefined,
			// Millions of dollars, without project payments, like the owner judges it
			profit: seasonOwnerJudgedProfit(teamSeason) / 1000,
		};

		const officeInfo = await getFinancesInfo(tid);

		const state = teamSeason.ownerSeason;
		const requests = (state?.requests ?? []).map((r) => ({
			...r,
			title: OWNER_REQUESTS[r.kind].title,
			mandate: OWNER_REQUESTS[r.kind].mandate,
			component: OWNER_REQUESTS[r.kind].component,
			description: describeRequest(r),
		}));

		const pendingSale =
			commercialEnabled() && t.commercial?.pendingSale
				? {
						season: t.commercial.pendingSale.season,
						...OWNER_TYPES[t.commercial.pendingSale.ownerType],
					}
				: undefined;

		const projection = await projectEvaluation(t, teamSeason);

		return {
			abbrev: g.get("teamInfoCache")[tid]?.abbrev,
			region: g.get("teamInfoCache")[tid]?.region,
			teamName: g.get("teamInfoCache")[tid]?.name,
			season,
			name: profile.name,
			since: profile.since,
			yearsOwned: Math.max(1, season - profile.since + 1),
			ownerType,
			traits,
			ownerMoods,
			evaluations,
			goals,
			progress,
			activeProject: officeInfo?.active,
			completedProjects: officeInfo?.completed ?? [],
			pendingSale,
			requests,
			adjustments: state?.adjustments ?? [],
			franchiseName: state?.franchiseName,
			requestsActive: requestsActive(t),
			multiTeam: g.get("userTids").length > 1,
			gracePeriodEnd: g.get("gracePeriodEnd"),
			godMode: g.get("godMode"),
			challengeFiredLuxuryTax: g.get("challengeFiredLuxuryTax"),
			challengeFiredMissPlayoffs: g.get("challengeFiredMissPlayoffs"),
			projection: {
				...projection,
				outlookName: JOB_OUTLOOK_NAMES[projection.outlook],
			},
		};
	},
});
