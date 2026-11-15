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
import type { HofPlaque, HofWords } from "../../common/faceHistory.ts";
import {
	careerFacts,
	featsByPid,
	hofSeasonsOf,
	hofWords,
} from "../util/hofStory.ts";
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
			// Show Player Nicknames setting (the speeches and plaques are written with or without them)
			updateEvents.has("gameAttributes") ||
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
			const allRaws: Player[] = [];

			const players = (
				await idb.merged.players.getAll(
					{ hof: true },
					{
						map: (pRaw) => {
							if (plaquesOn) {
								raws.push(pRaw);
							}
							allRaws.push(pRaw);
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

			// Plaque text and induction speeches, from each Hall of Famer's career
			const hofSeasons = hofSeasonsOf(allRaws);
			const feats = await featsByPid(new Set(allRaws.map((p) => p.pid)));
			const words: HofWords[] = [];
			const wordsByPid = new Map<number, HofWords>();
			for (const p of allRaws) {
				const facts = await careerFacts(p, { full: true, hofSeasons, feats });
				const prime = plaquesOn ? await primeFace(p) : undefined;
				const primeTid = prime
					? (p.stats as any[]).findLast(
							(row) => row.season === prime.season && row.tid >= 0,
						)?.tid
					: undefined;
				const w = hofWords(
					facts,
					prime
						? {
								season: prime.season,
								team: facts.teams.find((t) => t.tid === primeTid)?.name,
							}
						: undefined,
				);
				const entry = {
					pid: p.pid,
					name: `${p.firstName} ${p.lastName}`,
					nickname: facts.nickname,
					retiredYear: p.retiredYear,
					...w,
				};
				words.push(entry);
				wordsByPid.set(p.pid, entry);
			}
			words.sort((a, b) => b.retiredYear - a.retiredYear);

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
						nickname: wordsByPid.get(p.pid)?.nickname,
						text: wordsByPid.get(p.pid)?.plaque,
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
				words,
			};
		}
	},
});
