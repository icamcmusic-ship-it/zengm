import { idb } from "../db/index.ts";
import addFirstNameShort from "../util/addFirstNameShort.ts";
import { bySport } from "../../common/sportFunctions.ts";
import { processPlayersHallOfFame } from "../util/processPlayersHallOfFame.ts";
import { defineView } from "../util/defineView.ts";
import { player } from "../core/index.ts";
import { primeFace } from "../util/faceAging.ts";
import { featureOn } from "../util/nativeFeatures.ts";
import type { HofPlaque, HofWords } from "../../common/faceHistory.ts";
import {
	getHofStories,
	hofWordsOn,
	plaqueWithPrime,
} from "../util/hofStory.ts";
import type { Player } from "../../common/types.ts";
import { g } from "../util/index.ts";
import {
	HOF_AWARD,
	ballotLine,
	coachHofCase,
	gmHofCase,
	hofBallotOn,
	mostTidOf,
} from "../core/hallOfFame/index.ts";
import { isCollege } from "../core/college/isCollege.ts";
import { loadCollegeHallOfFame } from "./collegeHallOfFame.ts";

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
		// Inductions happen whenever a player retires: in the offseason (newPhase), from tragic deaths during games and God Mode
		// retirements (playerMovement), and from scheduled events (newPhase)
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("newPhase") ||
			updateEvents.has("playerMovement")
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

			// College leagues: the College Hall of Fame (players who left school, college coaches)
			if (isCollege()) {
				return {
					ballotOn: false,
					college: await loadCollegeHallOfFame(),
					players: [],
					plaques: [] as HofPlaque[],
					stats,
					wing: [],
					words: [] as HofWords[],
				};
			}
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
			// Plaque text and speeches are written from basketball careers (points, rebounds, assists, hoops stories)
			const wordsOn = hofWordsOn();
			// Raw players, only kept when plaques or words need them, and only for players on the page
			const raws: Player[] = [];

			const players = (
				await idb.merged.players.getAll(
					{ hof: true },
					{
						map: (pRaw) => {
							const pFormatted = formatPlayer(pRaw);
							if (!pFormatted) {
								return;
							}
							if (plaquesOn || wordsOn) {
								raws.push(pRaw);
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
								inducted: pRaw.awards.find((a) => a.type === HOF_AWARD)?.season,
								// "first ballot, 93.5%" (Hall of Fame Ballot), undefined when inducted when he retired
								ballot: ballotLine(pRaw.hofBallot),
								firstBallot:
									pRaw.hofBallot?.status === "inducted" &&
									pRaw.hofBallot.votes.length === 1,
							};
						},
					},
				)
			).filter((p) => p !== undefined);

			// Plaque text and induction speeches: stored on each Hall of Famer at induction (written once here for older ones)
			const stories = wordsOn
				? await getHofStories(raws, () =>
						idb.merged.players.getAll({ hof: true }),
					)
				: new Map<number, NonNullable<Player["hofStory"]>>();
			const primes = new Map<
				number,
				Awaited<ReturnType<typeof primeFace>> & { tid?: number }
			>();
			if (plaquesOn) {
				for (const p of raws) {
					const prime = await primeFace(p);
					if (prime) {
						primes.set(p.pid, {
							...prime,
							tid: (p.stats as any[]).findLast(
								(row) => row.season === prime.season && row.tid >= 0,
							)?.tid,
						});
					}
				}
			}

			const words: HofWords[] = [];
			const plaques: HofPlaque[] = [];
			for (const p of raws) {
				const story = stories.get(p.pid);
				const prime = primes.get(p.pid);
				const plaqueText = story
					? await plaqueWithPrime(story, prime)
					: undefined;
				const name = `${p.firstName} ${p.lastName}`;
				if (story) {
					words.push({
						pid: p.pid,
						name,
						retiredYear: p.retiredYear,
						plaque: plaqueText!,
						speech: story.speech,
					});
				}
				if (prime) {
					const { tid, ...primeInfo } = prime;
					plaques.push({
						pid: p.pid,
						name,
						imgURL: p.imgURL,
						firstSeason: p.stats.find((row) => row.tid >= 0)?.season,
						retiredYear: p.retiredYear,
						peakOvr: Math.max(...p.ratings.map((row) => row.ovr)),
						...primeInfo,
						text: plaqueText,
					});
				}
			}
			words.sort((a, b) => b.retiredYear - a.retiredYear);
			// Most recent inductees first
			plaques.sort(
				(a, b) => b.retiredYear - a.retiredYear || b.peakOvr - a.peakOvr,
			);

			// Coaches and executives wing
			const teamInfoCache = g.get("teamInfoCache");
			const wing: {
				kind: "coach" | "gm";
				id: number;
				name: string;
				inducted: number;
				retiredYear: number | undefined;
				line: string;
				won: number;
				lost: number;
				titles: number;
				awards: number;
				tid: number;
				abbrev: string;
			}[] = [];
			if (__SPORT === "basketball") {
				for (const c of await idb.cache.coaches.getAll()) {
					if (c.hof !== undefined) {
						const hofCase = coachHofCase(c);
						const tid = mostTidOf(
							c.stats
								.filter((row) => row.role === "head")
								.map((row) => row.tid),
						);
						wing.push({
							kind: "coach",
							id: c.cid,
							name: `${c.firstName} ${c.lastName}`,
							inducted: c.hof,
							retiredYear: c.retiredYear,
							line: hofCase.line,
							won: hofCase.won,
							lost: hofCase.lost,
							titles: hofCase.titles,
							awards: hofCase.coy,
							tid,
							abbrev: teamInfoCache[tid]?.abbrev ?? "",
						});
					}
				}
				for (const t of await idb.cache.teams.getAll()) {
					for (const gm of t.formerGms ?? []) {
						if (gm.hof !== undefined) {
							const hofCase = gmHofCase(gm);
							const tid = mostTidOf(gm.tenures.map((tenure) => tenure.tid));
							wing.push({
								kind: "gm",
								id: gm.gmid,
								name: `${gm.firstName} ${gm.lastName}`,
								inducted: gm.hof,
								retiredYear: gm.retiredYear,
								line: hofCase.line,
								won: hofCase.won,
								lost: hofCase.lost,
								titles: hofCase.titles,
								awards: hofCase.eoy,
								tid,
								abbrev: teamInfoCache[tid]?.abbrev ?? "",
							});
						}
					}
				}
				wing.sort((a, b) => b.inducted - a.inducted || a.id - b.id);
			}

			return {
				ballotOn: hofBallotOn(),
				college: undefined,
				wing,
				players: addFirstNameShort(processPlayersHallOfFame(players)),
				plaques,
				stats,
				words,
			};
		}
	},
});
