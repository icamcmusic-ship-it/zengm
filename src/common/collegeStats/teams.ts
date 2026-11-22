import { COLLEGES, PATHWAY_TEAM, getLowerLevel } from "./colleges.ts";
import { isJuco } from "./juco.ts";
import { Rng, clamp } from "./rng.ts";

/**
 * Class-aware teams: a college (or junior college, prep school, small college, youth academy, the pro pathway program) is one roster a
 * season, shared by every draft class. A 2027 freshman and a 2026 junior at the same school in the same season are teammates: they play
 * the same team games at the same pace, and each one's minutes and usage make room for the other's.
 *
 * Nothing is stored for a team. What a team season is (its games, pace and how deep its supporting cast is) comes from a stream of its
 * own (school and season, no draft year), so every class that has a player there sees the same team. Who is on it comes from the
 * prospects' own careers (generated, or planned for classes not generated yet), so a roster is rebuilt whenever it is needed.
 *
 * Overseas and G League seasons are in leagues of many clubs, not one team, so they have no roster here.
 */

// The level of competition every adjustment is measured against: a mid-major Division I schedule (conference scale, 0-100)
export const SOS_REFERENCE = 75;

// A school whose season is one team (one roster), rather than a league of clubs
export const isTeamSchool = (name: string | undefined) =>
	name !== undefined &&
	(!!COLLEGES[name] ||
		isJuco(name) ||
		getLowerLevel(name) !== undefined ||
		name === PATHWAY_TEAM);

export type TeamSeason = {
	// Games the team played (regular season and postseason). Drawn exactly as the College/Overseas page's estimated record draws them
	// (profile.ts estimateRecord), so a record shown there and the games his stats were made over always agree
	games: number;
	// Possessions per 40 minutes, around the Division I average (68)
	pace: number;
	// How good the players around the prospects are, in standard deviations (0 = what the program's strength says)
	depth: number;
};

export const PACE_40 = 68;

/**
 * A team season, from a stream of its own (school and season), the same for every class that has a player on it.
 */
export const getTeamSeason = (school: string, season: number): TeamSeason => {
	const record = new Rng(`record|${school}|${season}`);
	const games = Math.round(record.normal(32.5, 1.6));
	const rng = new Rng(`teamSeason|${school}|${season}`);
	const pace = PACE_40 * clamp(rng.normal(1, 0.045), 0.89, 1.11);
	const depth = clamp(rng.normal(0, 1), -2, 2);
	return { games, pace: Math.round(10 * pace) / 10, depth };
};

export type TeamMember = {
	// The prospect (his key in generation, his pid as a string in the game)
	key: string;
	draftYear: number;
	school: string;
	season: number;
	// Talent that season on the class-relative scale generation uses (generate.ts zTalent)
	z: number;
	pos: string;
	// Minutes per game and usage (0-1) he was expected to play that season before his teammates (season.ts expectedRole), for the team's
	// budget
	mpg: number;
	usg: number;
	// Not in the class being made (his stats are made, or will be made with his own class): he gets no role from here, and gives nothing
	// back to the team's budget. His teammates play around him
	locked?: boolean;
};

export type TeamRole = {
	// Hooks of the season model (season.ts): minutes per game, usage in standard deviations
	mpgShift: number;
	usageShift: number;
	// Prospects on his team that season, him not included, and how many of them are from other draft classes
	teammates: number;
	otherClass: number;
};

const POS_NUM: Record<string, number> = {
	PG: 1,
	G: 1.5,
	SG: 2,
	GF: 2.5,
	SF: 3,
	F: 3.5,
	PF: 4,
	FC: 4.5,
	C: 5,
};

// How much two players compete for the same minutes: 1 at the same position, nothing across the floor
const overlap = (a: string, b: string) =>
	Math.max(0, 1 - Math.abs((POS_NUM[a] ?? 3) - (POS_NUM[b] ?? 3)) / 2.5);

// How much of the floor a teammate takes: a fringe prospect a little, the class's best a lot
const load = (z: number) => Math.max(0, z + 1.2);

// Usage (sd units) and minutes per load point of the teammates around him
const USAGE_PER_LOAD = 0.16;
const MPG_PER_LOAD = 1.3;
// A teammate as good as him or better takes minutes in full, a lesser one half
const LESSER_TEAMMATE = 0.5;
// The program around the prospects: a stronger program has better non-prospects too, per point of strength above PROGRAM_REFERENCE (a
// typical prospect's program, so on average prospects play what they did before teams)
const PROGRAM_REFERENCE = 84;
const MPG_PER_STRENGTH = 0.09;
const USAGE_PER_STRENGTH = 0.012;
const MPG_PER_DEPTH = 0.9;
const USAGE_PER_DEPTH = 0.1;
// The team's budget: the prospects together use at most this share of the team's possessions (usage times share of minutes, summed) and
// play at most this many minutes a game, so there is always a supporting cast. Beyond it, the prospects whose roles are being made give
// some back, the lesser ones more
export const TEAM_USAGE_CAP = 0.72;
export const TEAM_MPG_CAP = 160;

export const teamKey = (school: string, season: number) =>
	`${school}|${season}`;

/**
 * Rosters by team season (teamKey), from the members of every class.
 */
export const buildRosters = (members: TeamMember[]) => {
	const rosters = new Map<string, TeamMember[]>();
	for (const m of members) {
		if (!isTeamSchool(m.school)) {
			continue;
		}
		const key = teamKey(m.school, m.season);
		let roster = rosters.get(key);
		if (!roster) {
			roster = [];
			rosters.set(key, roster);
		}
		// One entry per prospect a season
		if (!roster.some((x) => x.key === m.key)) {
			roster.push(m);
		}
	}
	return rosters;
};

/**
 * Roles of the members who are not locked, by `${key}|${season}`: how much their teammates (prospects of every class on the roster, and
 * the program's supporting cast) shift their minutes and usage. Deterministic (no random numbers but the team season's own), and the
 * same for a member whatever order the roster is in.
 *
 * Every member's role is worked out the same way, locked or not, from what is known about him before any season is played (his talent,
 * position and expected minutes and usage, which a stored career keeps), so remaking a class with the same seed gives the same roles
 * whether its teammates' classes were planned or already made then. Only the members not locked (the class being made) give back
 * minutes and usage when the team is over its budget.
 */
export const getTeamRoles = (
	rosters: Map<string, TeamMember[]>,
	strengthOf: (school: string) => number,
): Map<string, TeamRole> => {
	const roles = new Map<string, TeamRole>();
	for (const roster of rosters.values()) {
		const { school, season } = roster[0]!;
		const team = getTeamSeason(school, season);
		const strength = strengthOf(school);
		const own = new Map<TeamMember, TeamRole>();
		for (const m of roster) {
			let usagePressure = 0;
			let minutesPressure = 0;
			let otherClass = 0;
			for (const t of roster) {
				if (t === m) {
					continue;
				}
				const l = load(t.z);
				usagePressure += l;
				minutesPressure +=
					l * overlap(m.pos, t.pos) * (t.z >= m.z - 0.3 ? 1 : LESSER_TEAMMATE);
				if (t.draftYear !== m.draftYear) {
					otherClass += 1;
				}
			}
			const program = clamp(strength - PROGRAM_REFERENCE, -30, 20);
			own.set(m, {
				mpgShift:
					-MPG_PER_LOAD * minutesPressure -
					MPG_PER_STRENGTH * program -
					MPG_PER_DEPTH * team.depth,
				usageShift:
					-USAGE_PER_LOAD * usagePressure -
					USAGE_PER_STRENGTH * program -
					USAGE_PER_DEPTH * team.depth,
				teammates: roster.length - 1,
				otherClass,
			});
		}

		// The team's budget. Expected minutes and usage with the shifts above (about 4.4 usage points a standard deviation)
		let usage = 0;
		let minutes = 0;
		const expected = new Map<TeamMember, { mpg: number; usg: number }>();
		for (const m of roster) {
			const role = own.get(m);
			const mpg = clamp(m.mpg + (role ? role.mpgShift : 0), 7, 36);
			const usg = clamp(
				m.usg + (role ? 0.044 * role.usageShift : 0),
				0.13,
				0.34,
			);
			expected.set(m, { mpg, usg });
			usage += (usg * mpg) / 40;
			minutes += mpg;
		}
		const unlocked = roster
			.filter((m) => !m.locked)
			.sort((a, b) => (a.z !== b.z ? a.z - b.z : a.key < b.key ? -1 : 1));
		if (
			unlocked.length > 0 &&
			(usage > TEAM_USAGE_CAP || minutes > TEAM_MPG_CAP)
		) {
			// Weights: the lesser prospects give back the most
			const weights = unlocked.map((_m, i) => unlocked.length - i);
			const total = weights.reduce((a, b) => a + b, 0);
			const extraMin = Math.max(0, minutes - TEAM_MPG_CAP);
			const extraUsage = Math.max(0, usage - TEAM_USAGE_CAP);
			for (const [i, m] of unlocked.entries()) {
				const role = own.get(m)!;
				const e = expected.get(m)!;
				const share = weights[i]! / total;
				const cutMin = Math.min(e.mpg - 7, extraMin * share);
				role.mpgShift -= cutMin;
				// Usage given back, as a share of the possessions he uses: usage points over his share of minutes
				const cutUsg = Math.min(
					e.usg - 0.13,
					(extraUsage * share * 40) / Math.max(7, e.mpg - cutMin),
				);
				role.usageShift -= cutUsg / 0.044;
			}
		}
		for (const [m, role] of own) {
			if (!m.locked) {
				roles.set(`${m.key}|${m.season}`, role);
			}
		}
	}
	return roles;
};
