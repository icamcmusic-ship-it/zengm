import {
	agingCurveFromTrajectory,
	isTrajectorySeed,
	trajectoryLateness,
	trajectorySeedFor,
	trajectoryUFromSeed,
} from "../../../common/playerTraits/development.ts";
import { g } from "../../util/index.ts";

const leagueTraitSeed = () => {
	try {
		return g.get("playerTraitsSeed") ?? 0;
	} catch {
		return 0;
	}
};

type TrajectoryPlayer = { pid: number; trajectorySeed?: number };

// His trajectory seed: the stored one (p.trajectorySeed, kept when he is exported and imported into another league), else the one his
// pid gives in this league, which is exactly what the stored one is set to (so storing it moves nothing)
export const getTrajectorySeed = (p: TrajectoryPlayer) =>
	isTrajectorySeed(p.trajectorySeed)
		? p.trajectorySeed
		: trajectorySeedFor(leagueTraitSeed(), p.pid);

// Store his trajectory seed if he has none yet (with his trait seeds). Returns true if p changed.
export const ensureTrajectorySeed = (p: TrajectoryPlayer) => {
	if (__SPORT !== "basketball" || isTrajectorySeed(p.trajectorySeed)) {
		return false;
	}
	p.trajectorySeed = trajectorySeedFor(leagueTraitSeed(), p.pid);
	return true;
};

const trajectoryUOf = (p: TrajectoryPlayer) =>
	trajectoryUFromSeed(getTrajectorySeed(p));

// His aging curve. Worker only, never sent to the UI (see getRevealedAgingCurve in traits.ts)
export const agingCurveOf = (p: TrajectoryPlayer) =>
	agingCurveFromTrajectory(trajectoryUOf(p));

// A player's hidden trajectory (common/playerTraits/development.ts): the one number his aging curve, his sub-ratings' growth profile and
// his college late-bloomer story all read. Worker only, never sent to the UI. Undefined for a player with no pid yet (a prospect being
// generated), whose signals then read as neutral until he is saved.
export const trajectoryLatenessOf = (p: {
	pid?: number;
	trajectorySeed?: number;
}) => {
	if (__SPORT !== "basketball" || typeof p.pid !== "number") {
		return undefined;
	}
	return trajectoryLateness(trajectoryUOf(p as TrajectoryPlayer));
};
