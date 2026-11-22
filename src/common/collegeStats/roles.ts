import { Rng, clamp } from "./rng.ts";
import type { CareerPlan, PlannedYear } from "./career.ts";

/**
 * Role changes from season to season, so his stats follow his role year to year:
 * - His hidden trajectory (playerTraits/development.ts lateness, -1 early bloomer to 1 late bloomer). A late bloomer was further behind
 *   and played less in his early seasons, so his last ones are the breakout; an early bloomer was already close to what he is, so his
 *   numbers flatten out, and a slump is likelier.
 * - Breakout and slump seasons: a season his role (and his game) jumped, or fell back. Likelier the way his trajectory points.
 * - Freshmen: many start the season on the bench and move into the starting lineup during it.
 * Transfers' bigger and smaller roles are the career model's (career.ts), and teammates coming and going are the team model's (teams.ts).
 *
 * Everything is drawn from a stream of its own (seed, draft year, key, "role"), so nothing else about him changes.
 */

export type SeasonRole = "breakout" | "slump" | "midStarter";

// Per season back from the draft year, for a lateness of 1: talent behind (class sd) and minutes
const LATE_Z_PER_YEAR = 0.22;
const LATE_MPG_PER_YEAR = 1.5;
// Chance of a breakout or slump season (a season after one he played), before his trajectory leans it
const BREAKOUT_RATE = 0.1;
const SLUMP_RATE = 0.07;
const TRAJECTORY_LEAN = 0.6;
// Chance a freshman starts on the bench and moves into the lineup during the season, around a class-average prospect
const MID_STARTER_RATE = 0.35;

// Levels a role means something at: a team, not a youth or prep year away
const ROLE_LEVELS = new Set([
	"ncaa",
	"juco",
	"dii",
	"naia",
	"other",
	"pathway",
]);

export const applyRoleArc = (
	plan: CareerPlan,
	{
		seedBase,
		lateness,
		z,
	}: {
		seedBase: string;
		// His hidden trajectory, 0 when unknown
		lateness: number;
		// Class-relative talent (draft year)
		z: number;
	},
) => {
	const rng = new Rng(`${seedBase}|role`);
	const L = clamp(lateness, -1, 1);
	// A story already decides how his seasons went: no breakout or slump on top of one
	const storied = plan.story !== undefined;
	let prev: PlannedYear | undefined;
	for (const year of plan.years) {
		// Draws in the same order whatever happens, so one change doesn't move the rest
		const uEvent = rng.random();
		const uRamp = rng.random();
		const uSize = rng.random();
		if (!year.played) {
			continue;
		}
		const k = year.yearsBack;
		if (k > 0) {
			year.zShift -= LATE_Z_PER_YEAR * L * Math.min(k, 3);
			year.mpgShift -= LATE_MPG_PER_YEAR * L * Math.min(k, 2);
		}
		if (
			!storied &&
			prev?.played &&
			ROLE_LEVELS.has(year.level) &&
			year.gamesCap === undefined
		) {
			const pBreakout = BREAKOUT_RATE * (1 + TRAJECTORY_LEAN * L);
			const pSlump = SLUMP_RATE * (1 - TRAJECTORY_LEAN * L);
			if (uEvent < pBreakout) {
				year.role = "breakout";
				year.mpgShift += 3 + 2 * uSize;
				year.usageShift += 0.45;
				year.zShift += 0.15;
			} else if (uEvent < pBreakout + pSlump) {
				year.role = "slump";
				year.mpgShift -= 2.5 + 2 * uSize;
				year.usageShift -= 0.35;
				year.zShift -= 0.25;
			}
		}
		// His first season on a college team
		if (
			year.level === "ncaa" &&
			year.classIndex === 0 &&
			year.gamesCap === undefined &&
			!year.role &&
			uRamp < clamp(MID_STARTER_RATE + 0.12 * z - 0.1 * L, 0.12, 0.6)
		) {
			year.role = "midStarter";
			year.ramp = 4 + 4 * uSize;
		}
		prev = year;
	}
};
