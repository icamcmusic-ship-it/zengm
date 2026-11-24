import { PHASE, PLAYER } from "../../../common/constants.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import genPlayers from "./genPlayers.ts";
import { getDraftClassTargetSize } from "./genPlayersWithoutSaving.ts";

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
 *
 * undersized: also add prospects to every upcoming class smaller than a class is now made (getDraftClassTargetSize), for a mid-league
 * change of the number of draft rounds or teams. Only new prospects are added (beyond the default rounds' worth they are scrubs, as
 * genPlayers always does for extra rounds); nobody already in the class changes. Not in a league with random debuts forever, whose
 * classes are real players. Returns those years too.
 */
// season/phase default to the current ones; pass them from a newPhase function, which runs before g.phase is updated
const topUpDraftClasses = async (
	season: number = g.get("season"),
	phase: number = g.get("phase"),
	{ undersized = false }: { undersized?: boolean } = {},
) => {
	// Expansion draft, fantasy draft, etc.
	if (phase < 0) {
		return [];
	}

	const prospects = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const classSizes = new Map<number, number>();
	for (const p of prospects) {
		classSizes.set(p.draft.year, (classSizes.get(p.draft.year) ?? 0) + 1);
	}
	const target =
		undersized && g.get("randomDebutsForever") === undefined
			? getDraftClassTargetSize().baseNumPlayers
			: undefined;

	const generated = [];
	for (const year of getRequiredDraftYears(season, phase)) {
		const size = classSizes.get(year) ?? 0;
		// (never during this year's draft: its drafted prospects are no longer counted, and nobody joins a class mid-draft)
		const drafting = year === season && phase === PHASE.DRAFT;
		if (size === 0 || (target !== undefined && size < target && !drafting)) {
			await genPlayers(year);
			generated.push(year);
		}
	}
	return generated;
};

export default topUpDraftClasses;
