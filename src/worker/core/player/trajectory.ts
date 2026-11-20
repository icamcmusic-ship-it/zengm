import {
	trajectoryLateness,
	trajectoryU,
} from "../../../common/playerTraits/development.ts";
import { g } from "../../util/index.ts";

// A player's hidden trajectory (common/playerTraits/development.ts): the one number his aging curve, his sub-ratings' growth profile and
// his college late-bloomer story all read. Worker only, never sent to the UI. Undefined for a player with no pid yet (a prospect being
// generated), whose signals then read as neutral until he is saved.
export const trajectoryLatenessOf = (p: { pid?: number }) => {
	if (__SPORT !== "basketball" || typeof p.pid !== "number") {
		return undefined;
	}
	const seed = g.get("playerTraitsSeed") ?? 0;
	return trajectoryLateness(trajectoryU(seed, p.pid));
};
