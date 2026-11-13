import { PHASE } from "../../common/constants.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import addFirstNameShort from "../util/addFirstNameShort.ts";
import { bySport } from "../../common/sportFunctions.ts";
import { processPlayersHallOfFame } from "../util/processPlayersHallOfFame.ts";
import { defineView } from "../util/defineView.ts";
import { player } from "../core/index.ts";
import { primeFace } from "../util/faceAging.ts";
import { featureOn } from "../util/nativeFeatures.ts";
import type { HofPlaque } from "../../common/faceHistory.ts";
import type { Player } from "../../common/types.ts";

// gpF is used on processPlayersHallOfFame for baseball
export const extraStats = bySport({
	baseball: ["gpF"],
	basketball: [],
	football: [],
	hockey: [],
} as const);

export default defineView({
	id: "hallOfFame",
	load: async ({ updateEvents }) => {
		if (
			updateEvents.has("firstRun") ||
			(updateEvents.has("newPhase") && g.get("phase") === PHASE.DRAFT_LOTTERY)
		) {
			const stats = bySport({
				baseball: ["keyStats", "war"],
				basketball: [
					"gp",
					"min",
					"pts",
					"trb",
					"ast",
					"per",
					"ewa",
					"ws",
					"ws48",
				],
				football: ["keyStats", "av"],
				hockey: ["keyStats", "ops", "dps", "ps"],
			} as const);
			const formatOptions = {
				attrs: [
					"pid",
					"firstName",
					"lastName",
					"draft",
					"retiredYear",
					"statsTids",
					"awards",
				],
				ratings: ["season", "ovr", "pos"],
				stats: ["season", "abbrev", "tid", ...stats, ...extraStats],
				fuzz: true,
			} as const;
			const abbrevs = await player.loadAbbrevs(formatOptions);
			const formatPlayer = player.createFormatter(formatOptions, abbrevs);

			// League Extras "Face Aging": plaques with each Hall of Famer's face in his prime
			const plaquesOn = featureOn("faceAging");
			const raws: Player[] = [];

			const players = (
				await idb.merged.players.getAll(
					{ hof: true },
					{
						map: (pRaw) => {
							if (plaquesOn) {
								raws.push(pRaw);
							}
							const pFormatted = formatPlayer(pRaw);
							if (!pFormatted) {
								return;
							}

							const { awards, ...p } = pFormatted;
							let countMvp = 0;
							let countTitles = 0;
							for (const award of awards) {
								if (
									award.type === undefined &&
									award.numTeams === undefined &&
									award.actAs === "mvp" &&
									award.rank === 1
								) {
									countMvp += 1;
								} else if (award.type === "Won Championship") {
									countTitles += 1;
								}
							}
							return {
								...p,
								countMvp,
								countTitles,
							};
						},
					},
				)
			).filter((p) => p !== undefined);

			const plaques: HofPlaque[] = [];
			for (const p of raws) {
				const prime = await primeFace(p);
				if (prime) {
					plaques.push({
						pid: p.pid,
						name: `${p.firstName} ${p.lastName}`,
						imgURL: p.imgURL,
						firstSeason: p.stats.find((row) => row.tid >= 0)?.season,
						retiredYear: p.retiredYear,
						peakOvr: Math.max(...p.ratings.map((row) => row.ovr)),
						...prime,
					});
				}
			}
			// Most recent inductees first
			plaques.sort(
				(a, b) => b.retiredYear - a.retiredYear || b.peakOvr - a.peakOvr,
			);

			return {
				players: addFirstNameShort(processPlayersHallOfFame(players)),
				plaques,
				stats,
			};
		}
	},
});
