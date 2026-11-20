// Shot Zones (League extras, see docs/native-features.md): each shot's sub-zone (dunk / layup / cut at the rim, short mid-range and
// floaters vs long twos, corner vs above-the-break threes), a small make shift by sub-zone (centered on the league so totals stay put)
// and an expected FG% (xFG) for shot quality. With the setting off none of this runs and the sim draws no extra random number.
import { SHOT_ZONE_INDEX } from "../../../common/advStats.ts";

export const SZ = {
	// Corner threes: share of a three that is from the corner (catch-and-shoot role players who don't handle the ball much go there)
	cornerBase: 0.08,
	cornerAssisted: 0.17,
	cornerLowDrb: 0.14,
	cornerMin: 0.03,
	cornerMax: 0.5,
	// Make bonus of a corner three (shorter shot), minus the league's corner share times it on every three, so 3P% stays put
	cornerMake: 0.04,
	cornerRef: 0.24,
	// Mid-range: share that is a short (4-14 ft) shot or floater, more for small, quick players with a floater/touch
	shortBase: 0.38,
	shortSmall: 0.18,
	shortFloater: 0.22,
	shortMin: 0.15,
	shortMax: 0.75,
	// Make of a short mid-range shot: his floater/touch vs the league's (on short shots), so the league's mid-range FG% stays put
	shortMake: 0.12,
	floaterRef: 0.5,
	// At the rim: dunk share (dunk rating, size, explosiveness), cut share of assisted finishes (movers) and the make shifts (relative to
	// a layup), centered by rimRef
	dunkBase: -0.05,
	dunkSlope: 0.6,
	dunkMax: 0.6,
	cutAssisted: 0.22,
	cutMover: 0.18,
	cutSelf: 0.03,
	dunkMake: 0.14,
	cutMake: 0.06,
	rimRef: 0.045,
	// Expected FG% by sub-zone (league average on an average defense, unassisted), and its adjustments: team and on-ball defense, an
	// assist, spacing, a rushed shot
	xfgBase: [0.71, 0.58, 0.63, 0.66, 0.39, 0.413, 0.413, 0.368, 0.333],
	xfgTeamDef: 0.25,
	xfgDefRef: 0.47,
	xfgDefender: 0.06,
	xfgDefenderRef: 0.47,
	xfgAssist: 0.03,
	xfgSpacing: 0.03,
};

const clamp = (x: number, lo: number, hi: number) =>
	x < lo ? lo : x > hi ? hi : x;

type Ratings = Record<string, number | undefined> | undefined;

// A player's zone tendencies, computed once per game from his raw ratings (the floater sub-rating when there is one)
export type ShotZoneProfile = {
	corner: number;
	cornerAssisted: number;
	short: number;
	floater: number;
	dunk: number;
	mover: number;
};

export const shotZoneProfile = (r: Ratings): ShotZoneProfile => {
	const v = (key: string, def = 50) => r?.[key] ?? def;
	const drbN = clamp((v("drb") - 30) / 50, 0, 1);
	const small = clamp((60 - v("hgt")) / 35, 0, 1);
	const spdN = clamp((v("spd") - 35) / 50, 0, 1);
	// floater/touch sub-rating if present, otherwise a blend of shooting and inside touch
	const floater = clamp((r?.flt ?? (v("fg") + v("ins")) / 2) / 100, 0, 1);
	const corner = SZ.cornerBase + SZ.cornerLowDrb * (1 - drbN);
	const dunk = clamp(
		SZ.dunkBase +
			(SZ.dunkSlope *
				(v("dnk") / 100) *
				(0.5 * v("hgt") + 0.25 * v("jmp") + 0.25 * v("stre"))) /
				60,
		0,
		SZ.dunkMax,
	);
	return {
		corner,
		cornerAssisted: corner + SZ.cornerAssisted,
		short: clamp(
			SZ.shortBase +
				SZ.shortSmall * small * (0.5 + 0.5 * spdN) +
				SZ.shortFloater * (floater - 0.5),
			SZ.shortMin,
			SZ.shortMax,
		),
		floater,
		dunk,
		mover: spdN,
	};
};

// The sub-zone of a shot (u: one random number) and its make shift
export const pickShotZone = (
	type: "threePointer" | "midRange" | "atRim",
	prof: ShotZoneProfile,
	assisted: boolean,
	u: number,
) => {
	if (type === "threePointer") {
		const pCorner = clamp(
			assisted ? prof.cornerAssisted : prof.corner,
			SZ.cornerMin,
			SZ.cornerMax,
		);
		const corner = u < pCorner;
		return {
			zone: corner ? SHOT_ZONE_INDEX.corner3 : SHOT_ZONE_INDEX.ab3,
			make: SZ.cornerMake * ((corner ? 1 : 0) - SZ.cornerRef),
		};
	}
	if (type === "midRange") {
		const short = u < prof.short;
		return {
			zone: short ? SHOT_ZONE_INDEX.short : SHOT_ZONE_INDEX.long,
			make: short ? SZ.shortMake * (prof.floater - SZ.floaterRef) : 0,
		};
	}
	const pCut = assisted
		? SZ.cutAssisted + SZ.cutMover * prof.mover
		: SZ.cutSelf;
	if (u < prof.dunk) {
		return { zone: SHOT_ZONE_INDEX.dunk, make: SZ.dunkMake - SZ.rimRef };
	}
	if (u < prof.dunk + pCut) {
		return { zone: SHOT_ZONE_INDEX.cut, make: SZ.cutMake - SZ.rimRef };
	}
	return { zone: SHOT_ZONE_INDEX.layup, make: -SZ.rimRef };
};

// Expected FG% of a shot: from where it is, the defense (team and his man), an assist, spacing (and a rushed shot), not who shoots it
export const expectedFg = (
	zone: number,
	teamDefense: number,
	defenderDefense: number | undefined,
	assisted: boolean,
	spacing: number,
	rushFactor: number,
) => {
	let x =
		SZ.xfgBase[zone]! -
		SZ.xfgTeamDef * (teamDefense - SZ.xfgDefRef) +
		(assisted ? SZ.xfgAssist : 0) +
		SZ.xfgSpacing * spacing;
	if (defenderDefense !== undefined) {
		x -= SZ.xfgDefender * (defenderDefense - SZ.xfgDefenderRef);
	}
	return clamp(x * rushFactor, 0.01, 0.99);
};
