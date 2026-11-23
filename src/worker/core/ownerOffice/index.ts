// Owner's Office (League Extra "ownerOffice", basketball, needs budget): the owner's preseason budget meeting and arena/facilities
// projects. Formulas: common/ownerOffice.ts. With the setting off nothing here runs and no random numbers are drawn. AI project starts use
// a seeded stream (season, tid), never Math.random, so the main random stream is unchanged.

import { PHASE } from "../../../common/constants.ts";
import {
	FACILITIES_BONUS_DECAY,
	FACILITIES_BONUS_MAX,
	OWNER_PROJECTS,
	OWNER_PROJECT_TYPES,
	PROJECT_START_CASH_SHARE,
	computeOwnerGoals,
	projectCost,
	trackGoalsPayroll,
	projectDone,
	projectGamePayment,
	type OwnerGoals,
	type OwnerOfficeTeam,
	type OwnerProjectType,
} from "../../../common/ownerOffice.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { getSalaryCapScale } from "../../../common/ownerMood.ts";
import type { Team, TeamSeasonWithoutKey } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, toUI } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import getPayroll from "../team/getPayroll.ts";
import { adjustOwnerGoals, commercialEnabled } from "../commercial/index.ts";
import { gmProjectParams } from "../gm/finance.ts";
import { isCollege } from "../college/isCollege.ts";
import { OWNER_RESERVE_CAPS } from "../finances/ownerDistribution.ts";
import { ownerOfficeEnabled } from "./enabled.ts";
import {
	adjustGoalsForTraits,
	ensureOwnerProfile,
	getOwnerProfile,
	onPreseasonOwner,
	ownerAiProjectFactor,
} from "./owner.ts";

export { ownerOfficeEnabled };

// salaryCap / the sport's default cap, frozen like in updateOwnerMood (common/ownerMood.ts)
export const salaryCapScale = () => getSalaryCapScale(g.get("salaryCap"));

const userTeam = (tid: number) =>
	g.get("userTids").includes(tid) &&
	!local.autoPlayUntil &&
	!g.get("spectator");

// The budget meeting's goals only matter where the end-of-season evaluation judges them (updateOwnerMood): a single user team, not in
// college (which judges against the program's expectations). Other user teams get no goals and no meeting, rather than silent goals
const userGoalsReviewed = () => g.get("userTids").length === 1 && !isCollege();

const ensureOffice = (t: Team): OwnerOfficeTeam => {
	t.ownerOffice ??= { completed: [], facilitiesBonus: 0 };
	return t.ownerOffice;
};

// Facilities levels from completed projects, added to the facilities level of the last three seasons (finances.getLevelLastThree)
export const getFacilitiesBonus = (t: Pick<Team, "ownerOffice">) =>
	ownerOfficeEnabled() ? (t.ownerOffice?.facilitiesBonus ?? 0) : 0;

// One regular season game's project payment (thousands), recorded in teamSeason.projectExpenses. Caller takes it from cash. An AI
// team in the red pauses its payments until it has cash again (the project then opens late, see completeProject)
export const payGame = (t: Team, teamSeason: TeamSeasonWithoutKey) => {
	const project = t.ownerOffice?.active;
	if (
		!project ||
		project.startSeason > g.get("season") ||
		g.get("phase") === PHASE.PLAYOFFS ||
		(!userTeam(t.tid) && teamSeason.cash < 0)
	) {
		return 0;
	}
	const amount = projectGamePayment(project, g.get("numGames"));
	project.paid += amount;
	teamSeason.projectExpenses = (teamSeason.projectExpenses ?? 0) + amount;
	return amount;
};

// Finish a project whose payment seasons are over: any unpaid remainder (short seasons) is paid now, from the new season's books (an
// expense, but not in the profit the owner judges). An AI team that can't pay the remainder keeps paying per game and opens it later
const completeProject = (t: Team, teamSeason: TeamSeasonWithoutKey) => {
	const office = ensureOffice(t);
	const project = office.active;
	if (!project || !projectDone(project, g.get("season"))) {
		return;
	}
	const remainder = Math.max(0, project.cost - project.paid);
	if (remainder > 0 && !userTeam(t.tid) && teamSeason.cash < remainder) {
		return;
	}
	if (remainder > 0) {
		teamSeason.projectExpenses = (teamSeason.projectExpenses ?? 0) + remainder;
		teamSeason.cash -= remainder;
	}
	const def = OWNER_PROJECTS[project.type];
	office.facilitiesBonus = Math.min(
		FACILITIES_BONUS_MAX,
		office.facilitiesBonus + def.facilities,
	);
	if (def.capacityFactor !== 1) {
		t.stadiumCapacity = Math.round(
			(t.stadiumCapacity ?? teamSeason.stadiumCapacity) * def.capacityFactor,
		);
		teamSeason.stadiumCapacity = t.stadiumCapacity;
	}
	office.completed.push({ type: project.type, season: g.get("season") });
	office.active = undefined;
	return project.type;
};

const startProjectFor = (
	t: Team,
	type: OwnerProjectType,
	startSeason: number,
) => {
	const office = ensureOffice(t);
	office.active = {
		type,
		startSeason,
		cost: projectCost(type, g.get("salaryCap")),
		paid: 0,
	};
};

// AI teams: when cash-rich (more than the cost plus a cap in reserve), sometimes start a project. Seeded by season and tid. With the
// Realistic AI Economy the owner takes out the cash above about a cap every season (finances/ownerDistribution.ts) but leaves what an
// active project still needs, so there the bar is the user's down payment share plus half the reserve: otherwise a team could never
// afford one
const AI_START_PROB = 0.25;
const maybeStartAi = (t: Team, teamSeason: TeamSeasonWithoutKey) => {
	if (t.ownerOffice?.active) {
		return;
	}
	const salaryCap = g.get("salaryCap");
	const rng = makeSeededRandom(g.get("season") * 7919 + t.tid * 104729 + 31);
	// AI GM finance styles: facilities builders start projects more often with less in reserve, frugal GMs less often (unchanged when off)
	// The owner's patience (common/ownerProfile.ts) makes it a little more or less likely (×0.75 to ×1.25)
	const { prob, reserve } = gmProjectParams(
		t,
		AI_START_PROB * ownerAiProjectFactor(t),
	);
	if (rng() >= prob) {
		return;
	}
	const bonus = t.ownerOffice?.facilitiesBonus ?? 0;
	const realistic = featureOn("realisticEconomy");
	const cashNeeded = (type: OwnerProjectType) => {
		const cost = projectCost(type, salaryCap);
		return realistic
			? PROJECT_START_CASH_SHARE * cost +
					0.5 * OWNER_RESERVE_CAPS * reserve * salaryCap
			: cost + reserve * salaryCap;
	};
	const affordable = OWNER_PROJECT_TYPES.filter(
		(type) =>
			teamSeason.cash > cashNeeded(type) &&
			bonus + OWNER_PROJECTS[type].facilities <= FACILITIES_BONUS_MAX + 4,
	);
	if (affordable.length === 0) {
		return;
	}
	const type = affordable[Math.floor(rng() * affordable.length)]!;
	startProjectFor(t, type, g.get("season"));
};

const formatMillions = (thousands: number) =>
	helpers.formatCurrency(thousands / 1000, "M");

const meetingMessage = (
	goals: OwnerGoals,
	t: Team,
	completed: OwnerProjectType | undefined,
) => {
	const luxuryPayroll = g.get("luxuryPayroll");
	let m = `<p>Welcome to the ${g.get("season")} budget meeting. Here is what I expect from you this season.</p><ul>`;
	m += `<li><b>Payroll:</b> keep it under ${formatMillions(goals.maxPayroll)}. ${
		goals.taxWilling
			? `I'm willing to pay some luxury tax (the tax line is ${formatMillions(luxuryPayroll)}) if it wins us games.`
			: `I'm not paying luxury tax (the tax line is ${formatMillions(luxuryPayroll)}).`
	}</li>`;
	if (g.get("budget")) {
		m += `<li><b>Profit:</b> ${helpers.formatCurrency(goals.profitTarget, "M")} or better, not counting arena and facilities project payments (those are on me).</li>`;
	}
	m += `<li><b>Wins:</b> at least ${goals.winTarget} of ${g.get("numGames")} games.</li></ul>`;
	if (completed) {
		m += `<p>Our ${OWNER_PROJECTS[completed].name.toLowerCase()} is finished. The fans will notice.</p>`;
	}
	const active = t.ownerOffice?.active;
	if (active) {
		m += `<p>The ${OWNER_PROJECTS[active.type].name.toLowerCase()} is under way: ${formatMillions(active.paid)} of ${formatMillions(active.cost)} paid.</p>`;
	}
	m += `<p>Hitting these goals (or missing them) will count a little in my review at the end of the season. You can follow them on the <a href="${helpers.leagueUrl(["owner"])}">Owner</a> page, and start arena and facilities projects on <a href="${helpers.leagueUrl(["team_finances"])}">Team Finances</a>.</p>`;
	m += `<p>${getOwnerProfile(t).name}</p>`;
	return m;
};

// Preseason (after the new team season rows exist): finish projects, wear off old facilities bonuses, hold the budget meeting for
// every team (the user's as a message), and let cash-rich AI teams start projects
export const onPreseason = async () => {
	if (!ownerOfficeEnabled()) {
		return;
	}
	const season = g.get("season");
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const popRanks = helpers.getPopRanks(teams);
	for (const [i, t] of teams.entries()) {
		const teamSeason = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsByTidSeason",
			[t.tid, season],
		);
		if (!teamSeason) {
			continue;
		}
		const prev = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsByTidSeason",
			[t.tid, season - 1],
		);

		// The owner's name and traits, stored once (derived from the team and his first season, so existing leagues get them too)
		ensureOwnerProfile(t);

		if (t.ownerOffice) {
			t.ownerOffice.facilitiesBonus = Math.max(
				0,
				t.ownerOffice.facilitiesBonus - FACILITIES_BONUS_DECAY,
			);
		}
		const completed = completeProject(t, teamSeason);

		const prevGp = prev ? helpers.getTeamSeasonGp(prev) : 0;
		const goals = computeOwnerGoals({
			popRank: popRanks[i]!,
			numTeams: teams.length,
			cash: teamSeason.cash,
			salaryCap: g.get("salaryCap"),
			salaryCapScale: salaryCapScale(),
			luxuryPayroll: g.get("luxuryPayroll"),
			numGames: g.get("numGames"),
			prevWinPct:
				prev && prevGp > 0 ? (prev.won + 0.5 * prev.tied) / prevGp : undefined,
		});
		const user = userTeam(t.tid);
		if (user && !userGoalsReviewed()) {
			// Nothing reviews them (multi-team mode, college), so no goals rather than silent ones
			teamSeason.ownerGoals = undefined;
		} else {
			// Commercial Deals & Ownership: the owner's type shifts the payroll ceiling and profit target
			teamSeason.ownerGoals = commercialEnabled()
				? adjustOwnerGoals(goals, t, salaryCapScale())
				: goals;
			// The owner's traits: tax appetite moves the payroll ceiling, patience the win target (bounded)
			if (!isCollege()) {
				adjustGoalsForTraits(teamSeason.ownerGoals, t);
			}
		}

		if (user) {
			// A clean slate for the owner's mid-season requests (franchise player noted)
			await onPreseasonOwner(t, teamSeason);
			if (teamSeason.ownerGoals) {
				await idb.cache.messages.add({
					read: false,
					from: "The Owner",
					year: season,
					text: meetingMessage(teamSeason.ownerGoals, t, completed),
					subject: "Budget meeting",
					tid: t.tid,
				});
			}
		} else {
			maybeStartAi(t, teamSeason);
		}

		await idb.cache.teamSeasons.put(teamSeason);
		await idb.cache.teams.put(t);
	}
};

// Owner's Office payroll ceiling: one sample of the payroll per regular season game, for teams whose goals the owner reviews
export const trackPayrollGame = async (
	tid: number,
	teamSeason: TeamSeasonWithoutKey,
) => {
	if (
		!teamSeason.ownerGoals ||
		!userTeam(tid) ||
		g.get("phase") === PHASE.PLAYOFFS
	) {
		return;
	}
	trackGoalsPayroll(teamSeason.ownerGoals, await getPayroll(tid));
};

// The user starts a project. Returns an error message, or undefined on success
export const startProject = async (type: OwnerProjectType) => {
	if (!ownerOfficeEnabled()) {
		return "Owner's Office is turned off for this league.";
	}
	if (!OWNER_PROJECTS[type]) {
		return "Unknown project.";
	}
	const t = await idb.cache.teams.get(g.get("userTid"));
	if (!t) {
		return "Team not found.";
	}
	if (t.ownerOffice?.active) {
		return "A project is already under way.";
	}
	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[t.tid, g.get("season")],
	);
	const cost = projectCost(type, g.get("salaryCap"));
	if (!teamSeason || teamSeason.cash < PROJECT_START_CASH_SHARE * cost) {
		return `The owner wants at least ${formatMillions(PROJECT_START_CASH_SHARE * cost)} in cash before breaking ground.`;
	}
	// After the regular season, payments start next season
	const startSeason =
		g.get("phase") > PHASE.REGULAR_SEASON
			? g.get("season") + 1
			: g.get("season");
	startProjectFor(t, type, startSeason);
	await idb.cache.teams.put(t);
	await toUI("realtimeUpdate", [["teamFinances"]]);
};

// Everything Team Finances shows. Undefined when off
export const getFinancesInfo = async (tid: number) => {
	if (!ownerOfficeEnabled()) {
		return;
	}
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return;
	}
	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[tid, g.get("season")],
	);
	const salaryCap = g.get("salaryCap");
	const active = t.ownerOffice?.active;
	return {
		goals: teamSeason?.ownerGoals,
		// Why a user team has no goals: nothing reviews them in multi-team mode or college
		noGoalsReason: !userTeam(tid)
			? undefined
			: g.get("userTids").length > 1
				? ("multiTeam" as const)
				: isCollege()
					? ("college" as const)
					: undefined,
		payroll: await getPayroll(tid),
		won: teamSeason?.won ?? 0,
		cash: teamSeason?.cash ?? 0,
		projectExpenses: teamSeason?.projectExpenses ?? 0,
		facilitiesBonus: t.ownerOffice?.facilitiesBonus ?? 0,
		completed: t.ownerOffice?.completed ?? [],
		active: active
			? {
					...active,
					name: OWNER_PROJECTS[active.type].name,
					finishSeason:
						active.startSeason + OWNER_PROJECTS[active.type].seasons,
				}
			: undefined,
		options: OWNER_PROJECT_TYPES.map((type) => ({
			type,
			...OWNER_PROJECTS[type],
			cost: projectCost(type, salaryCap),
		})),
		minCashShare: PROJECT_START_CASH_SHARE,
	};
};
