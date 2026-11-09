import { PHASE, PLAYER } from "../../../common/constants.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import genPlayers from "./genPlayers.ts";

// Upcoming draft years that should have a class: numDraftClasses of them, starting with the next draft that hasn't happened yet
export const getRequiredDraftYears = (
	season: number = g.get("season"),
	phase: number = g.get("phase"),
	numDraftClasses: number = g.get("numDraftClasses"),
) => {
	const first = season + (phase > PHASE.DRAFT ? 1 : 0);
	const num = Math.max(1, Math.round(numDraftClasses ?? 7));
	const years = [];
	for (let i = 0; i < num; i++) {
		years.push(first + i);
	}
	return years;
};

/**
 * Make sure there are numDraftClasses upcoming draft classes. Only empty years get a new class (genPlayers runs the automatic college stats / re-randomize on it once, as a new class), so existing and imported classes are untouched. Returns the years that were generated.
 */
// season/phase default to the current ones; pass them from a newPhase function, which runs before g.phase is updated
const topUpDraftClasses = async (
	season: number = g.get("season"),
	phase: number = g.get("phase"),
) => {
	// Expansion draft, fantasy draft, etc.
	if (phase < 0) {
		return [];
	}

	const prospects = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const existingYears = new Set(prospects.map((p) => p.draft.year));

	const generated = [];
	for (const year of getRequiredDraftYears(season, phase)) {
		if (!existingYears.has(year)) {
			await genPlayers(year);
			generated.push(year);
		}
	}
	return generated;
};

export default topUpDraftClasses;
