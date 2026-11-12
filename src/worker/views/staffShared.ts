import {
	COACH_ROLE_NAMES,
	VACANT_RATING,
	bestRole,
	coachOvr,
	coachSalaryDemand,
	describeStyle,
} from "../../common/staff.ts";
import type {
	Coach,
	CoachRatings,
	CoachRole,
	CoachWithoutKey,
} from "../../common/types.ts";
import { g } from "../util/index.ts";
import {
	DEFENSE_DESCRIPTIONS,
	DEFENSE_NAMES,
	DEFENSE_SYSTEMS,
	INSTALL_START,
	OFFENSE_DESCRIPTIONS,
	OFFENSE_NAMES,
	OFFENSE_SYSTEMS,
	describeProfile,
	fitLabel,
	fitToScore,
	type rosterSchemeFit,
} from "../../common/coachSystems.ts";
import {
	coachReputation,
	coachSystemsEnabled,
	getCoachProfile,
	hotSeat,
	hotSeatLabel,
	playerSystemFit,
	reputationLabel,
} from "../core/staff/systems.ts";
import { idb } from "../db/index.ts";

// Coaching systems: a coach's identity for the coach pages (undefined with the setting off)
const formatSystems = (c: Coach) => {
	if (!coachSystemsEnabled()) {
		return undefined;
	}
	const profile = getCoachProfile(c);
	const rep = coachReputation(c);
	const heat = c.role === "head" && c.tid >= 0 ? hotSeat(c) : 0;
	return {
		...describeProfile(profile),
		offenseKey: profile.off,
		defenseKey: profile.def,
		mgmt: profile.mgmt,
		adapt: profile.adapt,
		mentor: profile.mentor,
		reputation: rep,
		reputationText: reputationLabel(rep),
		hotSeat: heat,
		hotSeatText: c.role === "head" && c.tid >= 0 ? hotSeatLabel(heat) : "",
	};
};

export const STAFF_DISABLED_MESSAGE =
	__SPORT === "basketball"
		? "The coaching staff is turned off in this league, so there are no coaches to show. Turn it on in League Settings → League Extras → Coaching Staff, and every team gets a head coach and three assistants."
		: "The coaching staff is only available for basketball.";

export const SYSTEMS_DISABLED_MESSAGE =
	"Coaching systems are turned off in this league, so coaches have no offense or defense systems, scheme fit, reputation or job security. Turn them on in League Settings → League Extras → Game Simulation → Coaching Systems.";

// Every team's colours, for the staff's ties and pins (StaffFace)
export const getTeamColors = async () => {
	const teams = await idb.cache.teams.getAll();
	return new Map(teams.map((t) => [t.tid, t.colors]));
};

type RosterFit = ReturnType<typeof rosterSchemeFit>;

/**
 * A head coach (or a candidate for the job) against a team's roster: his systems in plain words, how the roster fits them, and the staff's
 * strengths with him in charge. Coaching systems only.
 */
export const headCoachOutlook = (
	c: CoachWithoutKey,
	rosterFit: RosterFit,
	coordinators: { off?: CoachRatings; def?: CoachRatings },
) => {
	const profile = getCoachProfile(c);
	const offFit = fitToScore(rosterFit.off[profile.off]);
	const defFit = fitToScore(rosterFit.def[profile.def]);
	const fit = fitToScore(
		0.6 * rosterFit.off[profile.off] + 0.4 * rosterFit.def[profile.def],
	);
	const bestOff = OFFENSE_SYSTEMS.toSorted(
		(a, b) => rosterFit.off[b] - rosterFit.off[a],
	)[0]!;
	const bestDef = DEFENSE_SYSTEMS.toSorted(
		(a, b) => rosterFit.def[b] - rosterFit.def[a],
	)[0]!;
	return {
		offense: profile.off,
		defense: profile.def,
		offenseName: OFFENSE_NAMES[profile.off],
		defenseName: DEFENSE_NAMES[profile.def],
		offenseDescription: OFFENSE_DESCRIPTIONS[profile.off],
		defenseDescription: DEFENSE_DESCRIPTIONS[profile.def],
		fit,
		fitText: fitLabel(fit),
		offFit,
		defFit,
		// What this roster would fit best
		bestOffenseName: OFFENSE_NAMES[bestOff],
		bestOffenseFit: fitToScore(rosterFit.off[bestOff]),
		bestDefenseName: DEFENSE_NAMES[bestDef],
		bestDefenseFit: fitToScore(rosterFit.def[bestDef]),
		strengths: {
			off: Math.round(
				0.6 * c.ratings.off + 0.4 * (coordinators.off?.off ?? VACANT_RATING),
			),
			def: Math.round(
				0.6 * c.ratings.def + 0.4 * (coordinators.def?.def ?? VACANT_RATING),
			),
			dev: c.ratings.dev,
			mgmt: profile.mgmt,
			mot: c.ratings.mot,
		},
		describe: describeProfile(profile),
		adapt: profile.adapt,
		installStart: Math.round(INSTALL_START * 100),
	};
};

export type HeadCoachOutlook = ReturnType<typeof headCoachOutlook>;

/**
 * The rotation players who fit a head coach's systems best and worst (0-100, 50 = a typical rotation player): what is helping and hurting
 * the team's scheme fit.
 */
export const rosterFitPlayers = async (tid: number, c: CoachWithoutKey) => {
	const profile = getCoachProfile(c);
	const players = (await idb.cache.players.indexGetAll("playersByTid", tid))
		.filter((p) => p.injury.gamesRemaining === 0)
		.sort((a, b) => b.valueNoPot - a.valueNoPot)
		.slice(0, 9)
		.map((p) => ({
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			pos: p.ratings.at(-1)!.pos,
			score: playerSystemFit(p, profile).score,
		}))
		.sort((a, b) => b.score - a.score);
	return {
		helping: players.filter((p) => p.score >= 55).slice(0, 3),
		hurting: players
			.filter((p) => p.score <= 45)
			.slice(-3)
			.reverse(),
	};
};

export const staffViewEnabled = () =>
	__SPORT === "basketball" && !!g.get("coachingStaff");

const teamAbbrev = (tid: number) => g.get("teamInfoCache")[tid]?.abbrev;

export const formatCoach = (c: Coach, roleOverride?: CoachRole) => {
	const role = roleOverride ?? c.role;
	let won = 0;
	let lost = 0;
	let headSeasons = 0;
	let titles = 0;
	for (const row of c.stats) {
		if (row.role === "head") {
			won += row.won;
			lost += row.lost;
			headSeasons += 1;
			const numRounds = g.get("numGamesPlayoffSeries", row.season).length;
			if (numRounds > 0 && row.playoffRoundsWon >= numRounds) {
				titles += 1;
			}
		}
	}
	return {
		cid: c.cid,
		name: `${c.firstName} ${c.lastName}`,
		age: g.get("season") - c.born.year,
		born: c.born,
		face: c.face,
		tid: c.tid,
		abbrev: teamAbbrev(c.tid),
		role: c.role,
		roleName: COACH_ROLE_NAMES[c.role],
		bestRole: bestRole(c.ratings),
		ovr: coachOvr(c.ratings, role),
		ratings: c.ratings,
		style: c.style,
		styleText: describeStyle(c.style),
		contract: c.contract,
		demand: coachSalaryDemand(c.ratings, role, g.get("salaryCap")),
		headWon: won,
		headLost: lost,
		headSeasons,
		titles,
		numAwards: c.awards.length,
		retiredYear: c.retiredYear,
		systems: formatSystems(c),
	};
};

export type CoachFormatted = ReturnType<typeof formatCoach>;
