// College mode: the per-season archive, kept on the season's awards record (key "college"). See docs/college-mode.md.
import type { CollegeArchive } from "../../../common/college/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";

export const getCollegeArchive = async (
	season: number,
): Promise<CollegeArchive | undefined> => {
	const awards = (await idb.merged.awards.get(season)) as any;
	return awards?.college;
};

/**
 * Merge values into the archive of the current season. The awards record exists from the end of the playoffs on.
 */
export const updateCollegeArchive = async (patch: Partial<CollegeArchive>) => {
	const season = g.get("season");
	const awards = (await idb.merged.awards.get(season)) as any;
	if (!awards) {
		return;
	}
	awards.college = { ...awards.college, ...patch };
	await idb.cache.awards.put(awards);
};
