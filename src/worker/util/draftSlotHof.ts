// Draft History's "Hall of Fame rate by draft slot" card: the realized Hall of Fame and All-Star share of each part of the draft,
// over every class old enough to judge (common/draftSlotHof.ts). Read when the card is opened, not with the page.
import {
	buildDraftSlotHof,
	matureClassYears,
	type DraftSlotPlayer,
} from "../../common/draftSlotHof.ts";
import { hasCurrentSeasonDraftHappened } from "../../common/seasons.ts";
import { idb } from "../db/index.ts";
import g from "./g.ts";
import { getSeasonState } from "./processInputs.ts";

export const getDraftSlotHof = async () => {
	const lastDraft = hasCurrentSeasonDraftHappened(getSeasonState())
		? g.get("season")
		: g.get("season") - 1;
	const range = matureClassYears(g.get("startingSeason"), lastDraft);
	if (!range) {
		return { mature: undefined };
	}
	const players: DraftSlotPlayer[] = [];
	for (let year = range.from; year <= range.to; year++) {
		await idb.merged.players.getAll(
			{ draftYear: year },
			{
				filter: (p) => p.draft.year === year && p.draft.round > 0,
				map: (p) => {
					players.push({
						year,
						round: p.draft.round,
						pick: p.draft.pick,
						hof: !!p.hof,
						allStar: p.awards.some((a) => a.type === "All-Star"),
					});
					return undefined;
				},
			},
		);
	}
	return { mature: range.mature, result: buildDraftSlotHof(players, range) };
};
