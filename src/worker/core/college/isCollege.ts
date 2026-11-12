import { g } from "../../util/index.ts";

// Is this a college league (docs/college-mode.md)? Always false outside basketball and before a league is loaded
export const isCollege = () => {
	if (__SPORT !== "basketball") {
		return false;
	}
	try {
		return g.get("leagueType") === "college";
	} catch {
		return false;
	}
};
