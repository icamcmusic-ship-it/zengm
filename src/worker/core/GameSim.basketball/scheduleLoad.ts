// Load, Fatigue & Venue (the scheduleLoad setting of the League extras, see docs/native-features.md): nonlinear fatigue, injury risk
// that rises with tiredness, 3 games in 4 nights, home court split into a base, a crowd and a referee part, travel, and (an option) a
// referee crew that calls a game tighter or looser. Everything here is only used with the setting on; with it off GameSim and loadTeams
// do exactly what they did before and draw the same random numbers.
import geographicCoordinates from "../../../common/geographicCoordinates.ts";

export const LOAD = {
	// Fatigue of a shooter (his make probability): the sim's penalty x = 1 - energy is replaced by (1 - w) x + w x^2 / x0, the same at
	// x0 (E[x^2] / E[x] over the league's shots, so the league's shooting stays the same), smaller when fresh and steeper when tired.
	// (Team composites and substitutions keep the stock, linear fatigue: in the composites the curve moved league shooting, assists and
	// steals in ways no single x0 could center)
	fatigueCurve: 0.5,
	fatigueX0: 0.2,

	// In-game injury risk: times exp(k x), x = 1 - energy, divided by its average over the ten players on the court, so the tired
	// players get hurt more often and the league injury rate stays the same whatever the rotations
	injuryTired: 4,

	// 3 games in 4 nights (realistic schedule length only, about 0.7 per team per 82 games since the schedule's repair pass, 3-4
	// before): endurance and injury risk on the third game (on top of a back-to-back, with Injury Depth), and everyone's injury risk
	// scaled by injuryNorm so the league rate stays the same (1 / (1 + 0.1 * 0.7 / 82))
	threeInFourEndurance: 0.97,
	threeInFourInjury: 1.1,
	injuryNorm: 0.999,
	// Injury Depth's back-to-back risk (x1.15) and its normalization were tuned on the old schedule (about 74 back-to-backs per team);
	// with the realistic schedule length (about 14) it gives about 7-8% fewer injuries (the realistic schedule's own measurement and
	// scheduleLoadSeason.script.test.ts), which this puts back
	injuryDepthRealisticSchedule: 1.1,

	// Home court: the setting's homeCourtAdvantage percentage is split into a base part and a crowd part (both scale the composite
	// ratings, as before), and part of it goes to the referees: the home team draws more fouls (its free throw rate about +3%) and the
	// visitors fewer
	baseShare: 0.4,
	crowdShare: 0.35,
	refFoulLean: 0.03,
	// The crowd: 0.5 + hype (0.5 for an empty building, 1.5 for a sold-out, hyped one), times this in the playoffs
	crowdPlayoffs: 1.5,

	// Travel: each team's endurance, by the distance of its trip to this game (km), up to travelMax at travelKm. The trip is from the
	// city of the team's previous game this season (home or away; teamSeason.lastGameSite), so a home team back from a road trip has one
	// too, and a visitor on a road trip comes from the last stop, not from home. The first game of a season (no previous game) is the
	// trip from home, as before. travelRest scales it by the days since that game (1: the second night of a back-to-back, 2, 3 or more)
	travelMax: 0.03,
	travelKm: 4000,
	travelRest: [1, 0.8, 0.6],

	// Referee variance (option): each game's crew calls fouls times exp(sd z), one normal draw per game
	refSd: 0.07,
};

// The fatigue multiplier (1 = fresh) from the stock one
export const loadFatigue = (energy: number) => {
	const x = Math.max(0, Math.min(1, 1 - energy));
	const w = LOAD.fatigueCurve;
	// Clamped at 0: below about 48% energy the curve went negative, which turned the fatigue penalty into a bonus (with the late-game
	// blend in GameSim.fatigue, and multiplied into ratings that are subtracted)
	return Math.max(0, 1 - ((1 - w) * x + (w * x * x) / LOAD.fatigueX0));
};

// Injury risk weight for a player with this (stock) energy on the court, before dividing by the average over the court
export const tiredInjuryWeight = (energy: number) =>
	Math.exp(LOAD.injuryTired * (1 - energy));

// The crowd factor of the home team (about 1 on average in the regular season)
export const crowdLevel = (hype: number, playoffs: boolean) =>
	(0.5 + hype) * (playoffs ? LOAD.crowdPlayoffs : 1);

// The composite rating multiplier of the home team from the setting's home court advantage (percent), split into base and crowd. The
// rest of it is the referees' lean
export const homeCourtModifier = (homeCourtAdvantage: number, crowd: number) =>
	1 + (homeCourtAdvantage / 100) * (LOAD.baseShare + LOAD.crowdShare * crowd);

// The referees' lean, also proportional to the home court setting (1% stock)
// Clamped so the foul multipliers 1 -/+ lean stay in [0.5, 1.5] (unclamped, a home court above about 34% made the home team's foul
// multiplier negative)
export const REF_LEAN_MAX = 0.5;
export const refLean = (homeCourtAdvantage: number) => {
	const lean = LOAD.refFoulLean * homeCourtAdvantage;
	return Number.isFinite(lean)
		? Math.max(-REF_LEAN_MAX, Math.min(REF_LEAN_MAX, lean))
		: 0;
};

// Great-circle distance in km between two team regions, undefined if either has no coordinates
export const travelDistance = (
	from: string | undefined,
	to: string | undefined,
) => {
	if (from === undefined || to === undefined) {
		return undefined;
	}
	const a = geographicCoordinates[from];
	const b = geographicCoordinates[to];
	if (!a || !b) {
		return undefined;
	}
	const rad = Math.PI / 180;
	const dLat = (b.latitude - a.latitude) * rad;
	const dLon = (b.longitude - a.longitude) * rad;
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(a.latitude * rad) *
			Math.cos(b.latitude * rad) *
			Math.sin(dLon / 2) ** 2;
	return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
};

// How much of a trip's load is left after this many days since the team's last game (undefined: unknown, all of it)
export const travelRestFactor = (days: number | undefined) => {
	if (days === undefined || !Number.isFinite(days)) {
		return 1;
	}
	const rest = LOAD.travelRest;
	return rest[Math.max(0, Math.min(rest.length - 1, Math.round(days) - 1))]!;
};

// The trip to this game (km): from the previous game's city if known, else from home. undefined if a city has no coordinates
export const tripKm = (
	lastSite: string | undefined,
	home: string | undefined,
	venue: string | undefined,
	dist: (a: string | undefined, b: string | undefined) => number | undefined,
) => {
	const from = lastSite ?? home;
	if (from !== undefined && from === venue) {
		return 0;
	}
	return dist(from, venue);
};

// The visitors' endurance multiplier for a trip of this many km
export const travelEndurance = (km: number | undefined) =>
	km === undefined ? 1 : 1 - LOAD.travelMax * Math.min(1, km / LOAD.travelKm);

// Is this game the third in four nights (lastGameDay and prevGameDay are the team's two previous game days)
export const isThreeInFour = (
	day: number | undefined,
	lastGameDay: number | undefined,
	prevGameDay: number | undefined,
) =>
	day !== undefined &&
	lastGameDay !== undefined &&
	prevGameDay !== undefined &&
	lastGameDay < day &&
	prevGameDay >= day - 3;
