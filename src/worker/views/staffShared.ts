import {
	COACH_ROLE_NAMES,
	bestRole,
	coachOvr,
	coachSalaryDemand,
	describeStyle,
} from "../../common/staff.ts";
import type { Coach, CoachRole } from "../../common/types.ts";
import { g } from "../util/index.ts";
import { describeProfile } from "../../common/coachSystems.ts";
import {
	coachReputation,
	coachSystemsEnabled,
	getCoachProfile,
	hotSeat,
	hotSeatLabel,
	reputationLabel,
} from "../core/staff/systems.ts";

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
		? "The coaching staff is turned off in this league. You can turn it on in League Settings → League Extras."
		: "The coaching staff is only available for basketball.";

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
