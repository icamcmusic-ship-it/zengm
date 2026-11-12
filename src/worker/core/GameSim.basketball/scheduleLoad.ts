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

	// Travel: the visitors' endurance, by the distance from home (km), up to travelMax at travelKm
	travelMax: 0.03,
	travelKm: 4000,

	// Referee variance (option): each game's crew calls fouls times exp(sd z), one normal draw per game
	refSd: 0.07,
};

// The fatigue multiplier (1 = fresh) from the stock one
export const loadFatigue = (energy: number) => {
	const x = 1 - energy;
	const w = LOAD.fatigueCurve;
	return 1 - ((1 - w) * x + (w * x * x) / LOAD.fatigueX0);
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
export const refLean = (homeCourtAdvantage: number) =>
	LOAD.refFoulLean * homeCourtAdvantage;

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
