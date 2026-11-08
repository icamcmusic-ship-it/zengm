/* The "Realistic possession model" (realisticPossessions setting): how long possessions take, with a real 24-second shot clock.

   Targets, modern NBA (approximate, 2022-25 regular seasons; basketball-reference, NBA.com shot-clock tracking, pbpstats.com, Inpredictable):
   - pace ~99-100 possessions per 48 minutes, teams from ~96 to ~104 (here from the teams' pace ratings and the league's pace setting)
   - average possession ~14-15 s of game clock; transition (after a steal or a long rebound) ~5-8 s; half-court after a make or a dead ball
     ~16-18 s (including the ~2-3 s it takes to inbound the ball after a make)
   - when shots go up, by shot clock left (shot clock on): 24-22 ~6%, 22-18 ~15%, 18-15 ~16%, 15-7 ~38%, 7-4 ~15%, 4-0 ~9%, so a late-clock
     tail; FG% is best very early (transition) and worst in the last 4 seconds (~-8 points of FG%)
   - shot clock resets to 14 after an offensive rebound, and to 14 (if lower) after a defensive foul in the frontcourt
   - shot-clock violations ~0.5-1 per team per game (they are turnovers), from late-clock possessions where no shot is found; 8-second and
     backcourt violations are rare (part of the ordinary turnovers here)
   - offensive rebounds: about 1 in 3 is put back (or kicked out for a shot) within ~3 s
   - end of a period: hold for the last shot (shoot with ~1-4 s left), 2-for-1 when getting the ball with ~30-45 s left; end of a game: the
     trailing team fouls, the leader runs the clock (uses the shot clock), timeouts advance the ball (as before).

   All times here are seconds of shot clock (= game clock with the default pace). Every random number this draws is drawn only when the
   setting is on, so with it off games play out exactly as before. */
import { helpers } from "../../util/index.ts";
import { truncGauss, uniform } from "../../../common/random.ts";

export const SHOT_CLOCK_FULL = 24;
export const SHOT_CLOCK_RESET_ORB = 14;

// Average team pace rating (TeamGameSim.pace, from loadTeams: nominally 100-115, but averaged over a roster it is ~108 +/- 0.3-0.6), so
// teams faster than this play faster than league average
const TEAM_PACE_RATING_MEAN = 108;
// How much a team's possessions speed up per point of pace rating, so that teams span roughly 96-104 pace (NBA: ~+/-4)
const TEAM_PACE_PER_RATING_POINT = 0.05;

export const teamPaceFactor = (paceRating: number) => {
	return helpers.bound(
		1 + TEAM_PACE_PER_RATING_POINT * (paceRating - TEAM_PACE_RATING_MEAN),
		0.93,
		1.07,
	);
};

// The league's pace setting (paceFactor, 1 = default) speeds up or slows down possessions. Slowing down past what the shot clock allows
// would just mean more violations, so beyond that the extra time comes off the game clock as dead time instead (like the old model, which
// stretched every second of game clock)
const MAX_POSS_TIME_SCALE = 1.15;
export const paceScales = (paceFactor: number) => {
	const scale = 1 / paceFactor;
	const possTimeScale = Math.min(scale, MAX_POSS_TIME_SCALE);
	return {
		possTimeScale,
		gameClockFactor: scale / possTimeScale,
	};
};

// Transition chances: how often a possession becomes a fast break, by how it started (~15-17% of NBA possessions are transition)
export const PROB_TRANSITION = {
	steal: 0.6,
	drb: 0.24,
	inbound: 0.03,
};

// Shot clock used by a transition shot
export const drawTransitionTime = () => uniform(1.2, 8.5);

// Getting the ball over half court after a make or a dead ball (NBA average ~4-5 s; 8 s is the limit)
export const drawBackcourtTime = () => truncGauss(4.3, 1.1, 2, 7.5);

// Time to find a shot once in the half court: most often ~11 s after crossing half court, skewed (many quick hitters, fewer late ones), no
// upper limit. When it runs past the shot clock, that is a late-clock crisis (a forced shot or a violation). The mode is the argument, so
// pace and clock management can move it
export const HALF_COURT_SEARCH_MODE = 10.75;
const SEARCH_SD_EARLY = 6.5;
const SEARCH_SD_LATE = 3.6;
// Some possessions stall (nothing there, the ball gets reset): the late-clock tail
const PROB_STALL = 0.035;
// spreadScale is the team's consistency trait (1 = average, below 1 = steadier)
export const drawHalfCourtSearch = (mode: number, spreadScale = 1) => {
	const z = gaussian();
	let search = Math.max(
		1,
		mode + spreadScale * (z < 0 ? SEARCH_SD_EARLY : SEARCH_SD_LATE) * z,
	);
	if (Math.random() < PROB_STALL) {
		search += uniform(4, 13);
	}
	return search;
};

// Inbounding after a foul, a timeout or the ball going out off the defense, with shotClock left: a set play that uses about half of it (or most
// of it, to milk the clock)
export const drawRestartSearch = (shotClock: number, milk: boolean) => {
	const mean = milk
		? 0.8 * shotClock
		: Math.min(HALF_COURT_SEARCH_MODE - 1.5, 0.5 * shotClock);
	return Math.max(0.8, mean + Math.min(3.5, 0.25 * shotClock) * gaussian());
};

// After an offensive rebound: a quick putback or kick-out shot, or a reset with the 14-second clock
export const PROB_ORB_QUICK_SHOT = 0.34;
export const drawOrbQuickShot = () => uniform(0.3, 3);
export const ORB_RESET_SEARCH_MEAN = 6.2;
export const ORB_RESET_SEARCH_SD = 3;

// Late-clock crisis (no shot found before the shot clock runs out): the chance it is a violation rather than a forced shot. Scaled by the
// offense's ball handling and turnover tendency. Tuned to ~0.5-1 violations per team per game
export const PROB_VIOLATION_IN_CRISIS = 0.35;

// The turnover chance per possession is scaled down a bit, since shot-clock violations are turnovers too and TOV% should stay where it was
export const TOV_SCALE = 0.95;

// FG% by shot clock left: early (mostly transition) shots are better, late-clock shots are contested. Normalized so that the average over
// all shots is unchanged (FG% stays calibrated); NBA: ~+5 points of FG% at 24-18, ~-8 points at 4-0
export const SHOT_CLOCK_MAKE_NORM = 0.995;
export const shotClockMakeFactor = (shotClockLeft: number) => {
	let factor;
	if (shotClockLeft >= 18) {
		factor = 1.07;
	} else if (shotClockLeft >= 7) {
		factor = 1;
	} else if (shotClockLeft >= 4) {
		factor = 0.97;
	} else {
		factor = 0.86 + 0.02 * shotClockLeft;
	}
	return factor / SHOT_CLOCK_MAKE_NORM;
};

/* Player traits (the playerTraits setting, see docs/player-traits.md and common/playerTraits) as they change possessions in the realistic
   possession model. GameSim derives these from the trait effects of the players on the court (deriveTraits below, once per possession); they
   are only ever used when the setting is on, so with it off every value is 1 and nothing changes. Nothing here reads play-by-play events; the
   sim never depends on them. The other trait effects (clutch shot/FT/turnover, game form, shot selection, ...) are applied directly in GameSim:
   - shotDiscipline: scales the chance a late-clock crisis ends in a violation (1 = average; below 1 = finds a shot)
   - consistency: scales how spread out a team's half-court search times are (lower = steadier possession lengths)
   (A clutch hook used to be here as a multiplier on shot quality; it is the real clutchShotModifier now, which also works without the
   realistic possession model. Durability is the injury rate multiplier.) */
export type Traits = {
	shotDiscipline: number;
	consistency: number;
};
export const NEUTRAL_TRAITS: Traits = {
	shotDiscipline: 1,
	consistency: 1,
};

// How much a team's average shot discipline z (-1 to 1) moves its late-clock violation chance (high discipline = fewer violations)
const VIOLATION_PER_DISCIPLINE_Z = 0.3;

// Traits of a group of players on the court, from their trait effects (undefined = traits off for him = neutral)
export const deriveTraits = (
	effects: readonly (
		| { scores: Readonly<{ shotDiscipline: number }>; varianceScale: number }
		| undefined
	)[],
): Traits => {
	if (effects.length === 0) {
		return { ...NEUTRAL_TRAITS };
	}
	let z = 0;
	let variance = 0;
	for (const e of effects) {
		z += e ? helpers.bound((e.scores.shotDiscipline - 50) / 40, -1, 1) : 0;
		variance += e ? e.varianceScale : 1;
	}
	return {
		shotDiscipline: 1 - (VIOLATION_PER_DISCIPLINE_Z * z) / effects.length,
		consistency: variance / effects.length,
	};
};

// Standard normal
const gaussian = () => {
	let u = 0;
	while (u === 0) {
		u = Math.random();
	}
	const v = Math.random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
export { gaussian };
