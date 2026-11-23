// One team strength measure, shared by the Power Rankings and Season Odds (playoff and title odds): an expected point margin against an
// average team on a neutral court, blending the roster's rating with the margin the team has actually played to. Early in the season it
// is almost all roster; as games are played the real margin takes over (half and half after MOV_PRIOR_GAMES games).

import { bySport } from "../../../common/sportFunctions.ts";
import { isCollege } from "../college/isCollege.ts";

// Games of real margin that count as much as the roster rating
export const MOV_PRIOR_GAMES = 25;

// How much a point (goal, run) of margin of victory is worth next to the rating term. Basketball is the reference (1); in low scoring sports
// a goal or run is worth much more, otherwise margin barely counts there
export const MOV_SCALE = bySport({
	baseball: 7,
	basketball: 1,
	football: 1,
	hockey: 10,
});

// team.ovr is a point margin translated to a 0-100 scale (-15/+15 -> 0/100), shifted down by 40 with the playoff rotation (pro basketball).
// Undo that.
export const ovrToMargin = (ovr: number, playoffOvr: boolean = false) => {
	const shifted =
		playoffOvr && __SPORT === "basketball" && !isCollege() ? ovr + 40 : ovr;
	return ((shifted - 50) * 15) / 50;
};

// Weight of the real margin (0 before any game, towards 1 late in a long season)
export const resultsWeight = (gp: number) =>
	gp > 0 ? gp / (gp + MOV_PRIOR_GAMES) : 0;

export type TeamStrength = {
	// The blend: expected point margin vs an average team
	strength: number;
	// Roster rating as a point margin
	roster: number;
	// Real margin per game, scaled by MOV_SCALE
	results: number;
	// Weight of results in the blend
	w: number;
};

export const teamStrength = ({
	ovr,
	mov,
	gp,
	playoffOvr,
}: {
	ovr: number;
	mov: number;
	gp: number;
	playoffOvr?: boolean;
}): TeamStrength => {
	const roster = ovrToMargin(ovr, playoffOvr);
	const results = gp > 0 ? MOV_SCALE * mov : 0;
	const w = resultsWeight(gp);
	return {
		strength: (1 - w) * roster + w * results,
		roster,
		results,
		w,
	};
};
