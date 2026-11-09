import { draft } from "../../index.ts";
import { PHASE, PLAYER } from "../../../../common/constants.ts";
import type { PlayerWithoutKey } from "../../../../common/types.ts";
import { g } from "../../../util/index.ts";

const addDraftProspects = async ({
	players,
	scoutingLevel,
}: {
	players: PlayerWithoutKey[];
	scoutingLevel: number;
}) => {
	const draftProspectsByDraftYear = Map.groupBy(
		players.filter((p) => p.tid === PLAYER.UNDRAFTED),
		(p) => p.draft.year,
	);

	const seasonOffset = g.get("phase") >= PHASE.RESIGN_PLAYERS ? 1 : 0;
	const requiredYears = [];
	const numDraftClasses = Math.max(
		3,
		Math.round(g.get("numDraftClasses") ?? 3),
	);
	for (let i = 0; i < numDraftClasses; i++) {
		requiredYears.push(g.get("season") + seasonOffset + i);
	}
	for (const year of requiredYears) {
		if (!draftProspectsByDraftYear.has(year)) {
			draftProspectsByDraftYear.set(year, []);
		}
	}

	if (g.get("phase") >= 0) {
		const upcomingDraftYear = g.get("season") + seasonOffset;
		for (const [season, draftClass] of draftProspectsByDraftYear) {
			if (season < upcomingDraftYear) {
				// Should never happen, but maybe in custom file or God Mode
				continue;
			} else if (season === upcomingDraftYear) {
				// If the draft has already happened this season but next year's class hasn't been bumped up, don't create any PLAYER.UNDRAFTED
				if (
					g.get("phase") <= PHASE.DRAFT_LOTTERY ||
					g.get("phase") >= PHASE.RESIGN_PLAYERS
				) {
					const extraPlayers = await draft.genPlayersWithoutSaving(
						season,
						scoutingLevel,
						draftClass,
					);
					players.push(...extraPlayers);
				}
			} else {
				const extraPlayers = await draft.genPlayersWithoutSaving(
					season,
					scoutingLevel,
					draftClass,
				);
				players.push(...extraPlayers);
			}
		}
	}
};

export default addDraftProspects;
