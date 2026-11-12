// College mode: awards (docs/college-mode.md, Awards). The player awards are award settings (common/college/awards.ts); this file switches a
// league to them and chooses the Coach of the Year.
import {
	COLLEGE_AWARDS,
	getCollegeAwardSettings,
} from "../../../common/college/awards.ts";
import { g } from "../../util/index.ts";
import { league } from "../index.ts";

/**
 * Make sure the league uses the college awards (a college league made before them still has the pro ones).
 */
export const useCollegeAwards = async () => {
	const awards = g.get("awards");
	if (getCollegeAwardSettings(awards) !== awards) {
		await league.setGameAttributes({ awards: COLLEGE_AWARDS });
	}
};
