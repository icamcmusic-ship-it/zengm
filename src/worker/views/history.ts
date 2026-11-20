import { idb } from "../db/index.ts";
import { g, local, updatePlayMenu } from "../util/index.ts";
import type {
	Award,
	AwardInfoIndividual,
	AwardInfoTeam,
	AwardPlayer,
} from "../../common/types.ts";
import { defineView } from "../util/defineView.ts";
import { bySport } from "../../common/sportFunctions.ts";
import { processPlayersHallOfFame } from "../util/processPlayersHallOfFame.ts";
import { groupByUnique, last } from "../../common/utils.ts";
import { showStatsByType } from "../../common/awards.ts";
import { awardCandidateStats } from "../core/awards/getAwardCandidates.ts";
import {
	effectiveAwardFormula,
	getAwardKeyStats,
	pickerStats,
	type KeyStatRow,
} from "../core/awards/keyStats.ts";
import { getPosByGpF } from "../core/player/getPosByGpF.ts";
import { formatAwardNamePrefix } from "../core/awards/prefixes.ts";
import { PlayersCache } from "../db/PlayersCache.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { getSeasonState, validateSeason } from "../util/processInputs.ts";
import { isCurrentSeasonComplete } from "../../common/seasons.ts";
import { player, team } from "../core/index.ts";
import { isCollege } from "../core/college/isCollege.ts";
import { getCollegeState } from "../core/college/state.ts";
import { getCollegeArchive } from "../core/college/archive.ts";
import { COACH_OF_THE_YEAR } from "../../common/coachExecAwards.ts";
import {
	coyAvailable,
	eoyAvailable,
	getExecAwardsForSeason,
} from "../core/awards/coachExecAwards.ts";
import { getCoachAwards } from "../core/staff/data.ts";

const processInputs = (params: RouteParams<"history">) => {
	let season = validateSeason(params.season);

	// If playoffs aren't over, season awards haven't been set, so view last season by default
	if (
		season === g.get("season") &&
		!isCurrentSeasonComplete(getSeasonState())
	) {
		season -= 1;
	}

	return {
		season,
	};
};

const viewedSeasonSummary = async () => {
	local.unviewedSeasonSummary = false;
	await updatePlayMenu();
};

export default defineView({
	id: "history",
	processInputs,
	load: async ({ inputs: { season }, updateEvents, prevInputs }) => {
		if (local.unviewedSeasonSummary) {
			viewedSeasonSummary();
		}

		if (updateEvents.has("firstRun") || prevInputs?.season !== season) {
			const awards = await idb.merged.awards.get(season);

			if (!awards) {
				viewedSeasonSummary(); // Should never happen, but just in case

				// https://stackoverflow.com/a/59923262/786644
				const returnValue = {
					invalidSeason: true as const,
					season,
				};
				return returnValue;
			}

			const teams = await team.getFormattedAll({
				attrs: ["tid"],
				seasonAttrs: [
					"playoffRoundsWon",
					"abbrev",
					"region",
					"name",
					"won",
					"lost",
					"tied",
					"otl",
				],
				season,
			});
			const teamsByTid = groupByUnique(teams, "tid");

			const augmentTeams = (bestRecords: Record<number, number>) => {
				const map = new Map<number, (typeof teamsByTid)[number]>();
				for (const [cidDidString, tid] of Object.entries(bestRecords)) {
					const t = teamsByTid[tid];
					if (t) {
						const cidDid = Number.parseInt(cidDidString);
						map.set(cidDid, t);
					}
				}

				return map;
			};

			const playersCache = new PlayersCache();

			const augmentPlayer = async ({
				pid,
				pos,
				season,
				showStats,
				statOverrides,
				statRange,
				tid,
			}: {
				pid: number;
				pos?: string;
				season: number;
				showStats: AwardInfoIndividual["showStats"];
				statOverrides?: AwardPlayer["statOverrides"];
				statRange: Award["statRange"];
				tid: number;
			}) => {
				const stats = showStatsByType[showStats];
				if (!stats) {
					throw new Error("Invalid showStats");
				}

				// (award key stats: every stat the award's picker offers, so the page shows the user's chosen columns or the
				// ones its formula suggests)
				const allStats = [
					...new Set([...stats, ...(pickerStats(false, []) as typeof stats)]),
				];
				if (__SPORT === "baseball") {
					allStats.push("gpF");
				}

				const p = await playersCache.get(pid);
				if (!p) {
					return;
				}
				const p2 = await player.format(p, {
					attrs: ["name"],
					stats: allStats,
					season,
					seasonType:
						statRange === undefined
							? "regularSeason"
							: statRange === "combined"
								? "combined"
								: "playoffs",
					mergeStats: "totOnly",
					showNoStats: true,
					fuzz: true,
				});
				if (!p2) {
					return;
				}

				// Manually add pos, since ratings could have been deleted or something
				const ratingsPos =
					p.ratings.findLast((row) => row.season === season)?.pos ??
					last(p.ratings).pos;

				// Could have asked for "abbrev" in player.formatAll, but we already have the teams in memory...
				const t = teamsByTid[tid];

				return {
					pid,
					name: p2.name,
					pos: pos ?? getPosByGpF(p2.stats.gpF, ratingsPos),
					statOverrides,
					stats: {
						...p2.stats,
						tid,
						abbrev: t?.seasonAttrs.abbrev ?? "???",
					},
				};
			};

			const individualAwards: (Omit<AwardInfoIndividual, "winner"> & {
				winner: Awaited<ReturnType<typeof augmentPlayer>>;
			})[] = [];
			const individualAwardsPlayoffs: typeof individualAwards = [];
			const teamAwards: (Omit<AwardInfoTeam, "winner"> & {
				winner: (
					| Awaited<ReturnType<typeof augmentPlayer>>
					| { pos?: string }
				)[][];
			})[] = [];

			for (const award of awards.awards) {
				const numTeams = award.numTeams;
				if (numTeams === undefined) {
					const winner =
						award.winner[0]?.pid === undefined
							? undefined
							: await augmentPlayer({
									...award.winner[0],
									season: awards.season,
									showStats: award.showStats,
									statRange: award.statRange,
								});

					const augmented = {
						...award,
						numTeams,
						name: formatAwardNamePrefix(award, awards.season),
						winner,
					};

					if (
						award.statRange === "playoffs" ||
						typeof award.statRange === "number"
					) {
						individualAwardsPlayoffs.push(augmented);
					} else {
						individualAwards.push(augmented);
					}
				} else {
					const winner: (typeof teamAwards)[number]["winner"] = [];
					for (const team of award.winner) {
						const augmentedTeam: (typeof winner)[number] = [];
						for (const pTemp of team) {
							const p =
								pTemp.pid === undefined
									? pTemp
									: await augmentPlayer({
											...pTemp,
											season: awards.season,
											showStats: award.showStats,
											statRange: award.statRange,
										});
							augmentedTeam.push(p);
						}
						winner.push(augmentedTeam);
					}

					const augmented = {
						...award,
						numTeams,
						name: formatAwardNamePrefix(award, awards.season),
						winner,
					};

					teamAwards.push(augmented);
				}
			}

			// Award key stats: each award's formula's stats, ranked across the players this page shows for it (the winner and
			// the stored finishers, or the whole team), as on Award Races and Award History
			const keyStatsFor = async (
				award: (typeof awards.awards)[number],
				shown: { pid?: number; tid?: number; pos?: string }[],
			) => {
				const rows: KeyStatRow[] = [];
				for (const w of shown) {
					if (w.pid === undefined || w.tid === undefined) {
						continue;
					}
					const ap = await augmentPlayer({
						pid: w.pid,
						pos: w.pos,
						season: awards.season,
						showStats: award.showStats,
						statRange: award.statRange,
						tid: w.tid,
					});
					if (!ap) {
						continue;
					}
					const t = teamsByTid[w.tid]?.seasonAttrs;
					const gp = t ? t.won + t.lost + (t.tied ?? 0) + (t.otl ?? 0) : 0;
					const stats: Record<string, unknown> = {
						seasonFraction: 1,
						teamGp: gp,
						winp: t && gp > 0 ? (t.won + 0.5 * (t.tied ?? 0)) / gp : 0,
					};
					for (const [k, v] of Object.entries(ap.stats)) {
						stats[k] = Array.isArray(v)
							? v
									.filter((x): x is number => typeof x === "number")
									.reduce((a, b) => a + b, 0)
							: v;
					}
					for (const [k, v] of Object.entries(ap.statOverrides ?? {})) {
						stats[k] = v;
					}
					rows.push({ stats, formula: effectiveAwardFormula(award, ap.pos) });
				}
				return getAwardKeyStats({
					award,
					fallback: awardCandidateStats[award.showStats] ?? [],
					rows,
				});
			};
			const storedByShortName = new Map(
				awards.awards.map((award) => [
					award.shortName + JSON.stringify(award.group ?? null),
					award,
				]),
			);
			const withKeyStats = async <
				T extends { shortName: string; group?: unknown },
			>(
				list: T[],
			) => {
				const out = [];
				for (const a of list) {
					const stored = storedByShortName.get(
						a.shortName + JSON.stringify(a.group ?? null),
					);
					if (!stored) {
						out.push(a);
						continue;
					}
					const shown =
						stored.numTeams === undefined
							? (
									stored.winner as {
										pid?: number;
										tid?: number;
										pos?: string;
									}[]
								).slice(0, 5)
							: (
									stored.winner as {
										pid?: number;
										tid?: number;
										pos?: string;
									}[][]
								).flat();
					out.push({ ...a, keyStats: await keyStatsFor(stored, shown) });
				}
				return out;
			};

			const awardsAugmented = {
				season: awards.season,
				bestRecordConfs: augmentTeams(awards.bestRecordConfs),
				individualAwards: await withKeyStats(individualAwards),
				individualAwardsPlayoffs: await withKeyStats(individualAwardsPlayoffs),
				teamAwards: await withKeyStats(teamAwards),
			};

			const retiredPlayersAll = await idb.merged.players.getAll({
				retiredYear: season,
			});
			const retiredStat = bySport({
				baseball: "war",
				basketball: "ws",
				football: "av",
				hockey: "ps",
			} as const);
			const retiredPlayers = processPlayersHallOfFame(
				await player.formatAll(retiredPlayersAll, {
					attrs: ["pid", "name", "born", "hof"],
					ratings: ["pos", "season"],
					stats: ["season", "tid", "abbrev", retiredStat],
					showNoStats: true,
				}),
			).map((p) => {
				const lastStats = p.stats.at(-1);

				return {
					pid: p.pid,
					name: p.name,
					age: season - p.born.year,
					hof: p.hof,
					pos: p.bestPos,
					t:
						lastStats?.season === season
							? {
									tid: lastStats.tid,
									abbrev: lastStats.abbrev,
								}
							: undefined,
					stat: p.careerStats[retiredStat],
				};
			});
			retiredPlayers.sort((a, b) => (b.stat ?? 0) - (a.stat ?? 0));

			// Get champs
			const champ = teams.find(
				(t) =>
					t.seasonAttrs.playoffRoundsWon ===
					g.get("numGamesPlayoffSeries", season).length,
			);

			// Coach of the Year and Executive of the Year (built in), shown with the awards
			const coyRow = (await getCoachAwards(COACH_OF_THE_YEAR)).find(
				(a) => a.season === season,
			);
			const eoyRow = (await getExecAwardsForSeason(season))[0];
			const teamLabel = (tid: number) => {
				const t = teams.find((t2) => t2.tid === tid);
				const info = g.get("teamInfoCache")[tid];
				return {
					abbrev: t?.seasonAttrs.abbrev ?? info?.abbrev ?? "",
					region: t?.seasonAttrs.region ?? info?.region ?? "",
				};
			};
			const coachExecAwards = {
				coy: coyRow
					? {
							cid: coyRow.cid,
							name: coyRow.name,
							tid: coyRow.tid,
							...teamLabel(coyRow.tid),
						}
					: undefined,
				eoy: eoyRow
					? {
							name: eoyRow.name,
							gmid: eoyRow.gmid,
							user: eoyRow.user,
							tid: eoyRow.tid,
							...teamLabel(eoyRow.tid),
						}
					: undefined,
				// Show the heading (with "No winner" until it's given) for the current season when the award exists in this league,
				// and for past seasons only when it was given
				showCoy: !!coyRow || (coyAvailable() && season === g.get("season")),
				showEoy: !!eoyRow || (eoyAvailable() && season === g.get("season")),
			};

			// College mode: the NIT champion, shown with the awards
			let college:
				| {
						nitChampion?: { tid: number; abbrev: string; region: string };
				  }
				| undefined;
			if (isCollege()) {
				const state = getCollegeState();
				const nit =
					state && state.season === season
						? state.nit
						: (await getCollegeArchive(season))?.nit;
				const nitInfo =
					nit?.champion !== undefined
						? g.get("teamInfoCache")[nit.champion]
						: undefined;
				college = {
					nitChampion:
						nit?.champion !== undefined
							? {
									tid: nit.champion,
									abbrev: nitInfo?.abbrev ?? "",
									region: nitInfo?.region ?? "",
								}
							: undefined,
				};
			}

			return {
				awards: awardsAugmented,
				champ,
				coachExecAwards,
				college,
				confs: g.get("confs", season),
				invalidSeason: false as const,
				retiredPlayers,
				retiredStat,
				season,
			};
		}
	},
});
