// Award History: the winners (and the other top finishers that were saved) of one award in every season, with that award's key
// stats from each player's stored stats for the season (see core/awards/keyStats.ts).
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { PlayersCache } from "../db/PlayersCache.ts";
import { player } from "../core/index.ts";
import { last } from "../../common/utils.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import type { DropdownOption } from "../../ui/hooks/useDropdownOptions.tsx";
import type { Awards, PlayerStatAttr, TeamSeason } from "../../common/types.ts";
import { awardCandidateStats } from "../core/awards/getAwardCandidates.ts";
import {
	awardStatColsSetting,
	effectiveAwardFormula,
	getAwardKeyStats,
	pickerStats,
	type KeyStatRow,
} from "../core/awards/keyStats.ts";
import { awardActive } from "../core/awards/trackingAwards.ts";
import { getPosByGpF } from "../core/player/getPosByGpF.ts";
import {
	COACH_EXEC_AWARD_KEYS,
	COACH_EXEC_AWARD_NAMES,
	COACH_OF_THE_YEAR,
	type CoachExecAwardKind,
} from "../../common/coachExecAwards.ts";
import {
	coachExecAwardAvailable,
	getExecAwards,
} from "../core/awards/coachExecAwards.ts";
import { getCoachAwards } from "../core/staff/data.ts";
import getPlayoffsByConf from "../core/season/getPlayoffsByConf.ts";

export type CoachExecHistoryRow = {
	key: string;
	season: number;
	name: string;
	// Coach of the Year: the coach. Executive of the Year: the AI GM, if any
	cid?: number;
	gmid?: number;
	user: boolean;
	tid: number;
	abbrev: string;
	region: string;
	record: string | undefined;
	// Playoff result, like "league champs", empty if it missed them
	playoffs: string;
};

// Coach of the Year or Executive of the Year winners, newest first
const getCoachExecHistory = async (
	kind: CoachExecAwardKind,
): Promise<CoachExecHistoryRow[]> => {
	const winners =
		kind === "coy"
			? (await getCoachAwards(COACH_OF_THE_YEAR)).map((a) => ({
					...a,
					gmid: undefined,
					user: false,
				}))
			: (await getExecAwards()).map((a) => ({ ...a, cid: undefined }));
	const rows: CoachExecHistoryRow[] = [];
	for (const a of winners) {
		const ts = await idb.merged.teamSeasons.getByTidSeason(a.tid, a.season);
		rows.push({
			key: `${a.season}-${a.tid}-${a.cid ?? a.gmid ?? "user"}`,
			season: a.season,
			name: a.name,
			cid: a.cid,
			gmid: a.gmid,
			user: a.user,
			tid: a.tid,
			abbrev: ts?.abbrev ?? g.get("teamInfoCache")[a.tid]?.abbrev ?? "???",
			region: ts?.region ?? g.get("teamInfoCache")[a.tid]?.region ?? "",
			record: ts
				? helpers.formatRecord({
						won: ts.won,
						lost: ts.lost,
						tied: ts.tied,
						otl: ts.otl,
					})
				: undefined,
			playoffs: ts
				? helpers.upperCaseFirstLetter(
						helpers.roundsWonText({
							playoffRoundsWon: ts.playoffRoundsWon,
							numPlayoffRounds: g.get("numGamesPlayoffSeries", a.season).length,
							playoffsByConf: await getPlayoffsByConf(a.season),
						}),
					)
				: "",
		});
	}
	return rows.sort((a, b) => b.season - a.season);
};

type StoredAward = Awards["awards"][number];

type StatsRecord = Record<string, unknown>;

const processInputs = (params: RouteParams<"awardHistory">) => {
	return {
		award: params.award,
	};
};

const statRangeSeasonType = (statRange: StoredAward["statRange"]) =>
	statRange === undefined
		? ("regularSeason" as const)
		: statRange === "combined"
			? ("combined" as const)
			: ("playoffs" as const);

const isSeasonTypeRow = (
	row: { playoffs: boolean | "combined" },
	seasonType: "regularSeason" | "playoffs" | "combined",
) =>
	seasonType === "regularSeason"
		? row.playoffs === false
		: seasonType === "playoffs"
			? row.playoffs === true
			: row.playoffs === "combined";

export default defineView({
	id: "awardHistory",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (
			!updateEvents.has("firstRun") &&
			inputs.award === prevInputs?.award &&
			!updateEvents.has("newPhase")
		) {
			return;
		}

		const allAwards = await idb.merged.awards.getAll();

		// Dropdown: the current awards first, then any older ones from history
		const names = new Map<string, string>();
		for (const award of g.get("awards").filter(awardActive)) {
			names.set(award.shortName, award.name);
		}
		const storedShortNames = new Set<string>();
		for (const awards of allAwards.toReversed()) {
			for (const award of awards.awards) {
				storedShortNames.add(award.shortName);
				if (!names.has(award.shortName)) {
					names.set(award.shortName, award.name);
				}
			}
		}
		// Coach of the Year and Executive of the Year (built in), if given in this league
		const coachExecHistories = new Map<string, CoachExecHistoryRow[]>();
		for (const kind of ["coy", "eoy"] as const) {
			const history = await getCoachExecHistory(kind);
			if (history.length > 0 || coachExecAwardAvailable(kind)) {
				const key = COACH_EXEC_AWARD_KEYS[kind];
				coachExecHistories.set(key, history);
				names.set(key, COACH_EXEC_AWARD_NAMES[kind]);
			}
		}

		const awardOptions: DropdownOption[] = Array.from(
			names,
			([key, label]) => ({ key, label }),
		);

		const shortName =
			inputs.award !== undefined && names.has(inputs.award)
				? inputs.award
				: (awardOptions[0]?.key as string | undefined);

		const entries: {
			season: number;
			award: StoredAward;
		}[] = [];
		if (shortName !== undefined) {
			for (const awards of allAwards) {
				for (const award of awards.awards) {
					if (award.shortName === shortName) {
						entries.push({ season: awards.season, award });
					}
				}
			}
		}
		entries.sort((a, b) => b.season - a.season);

		const latestAward: Pick<
			StoredAward,
			| "formula"
			| "formulaByPos"
			| "mip"
			| "numTeams"
			| "rookie"
			| "showStats"
			| "statRange"
			| "statCols"
		> = entries[0]?.award ??
			g.get("awards").find((award) => award.shortName === shortName) ?? {
				formula: "0",
				showStats: "offense",
			};
		const fallback = awardCandidateStats[latestAward.showStats] ?? [];
		const playoffSeries = typeof latestAward.statRange === "number";
		const statsToLoad = pickerStats(false, []);

		const playersCache = new PlayersCache();
		const teamSeasonsCache = new Map<number, Map<number, TeamSeason>>();
		const getTeamSeason = async (season: number, tid: number) => {
			let bySeason = teamSeasonsCache.get(season);
			if (!bySeason) {
				bySeason = new Map();
				for (const ts of await idb.merged.teamSeasons.getAll({ season })) {
					bySeason.set(ts.tid, ts);
				}
				teamSeasonsCache.set(season, bySeason);
			}
			return bySeason.get(tid);
		};

		const rows = [];
		const keyStatRows: KeyStatRow[] = [];
		const formulas = new Set<string>();

		for (const { season, award } of entries) {
			const mip = !!award.mip;
			const series = typeof award.statRange === "number";
			const seasonType = statRangeSeasonType(award.statRange);

			let groupName: string | undefined;
			const group = award.group;
			if (group?.type === "conf") {
				groupName = g
					.get("confs", season)
					.find((c) => c.cid === group.cid)?.name;
			} else if (group?.type === "div") {
				groupName = g
					.get("divs", season)
					.find((d) => d.did === group.did)?.name;
			} else if (group?.type === "playoffSeries") {
				const abbrevs = await Promise.all(
					group.tids.map(
						async (tid) =>
							(await getTeamSeason(season, tid))?.abbrev ??
							g.get("teamInfoCache")[tid]?.abbrev ??
							"???",
					),
				);
				groupName = abbrevs.join(" vs ");
			}

			const winners: {
				pid: number;
				tid: number;
				rank: number;
				statOverrides?: Record<string, unknown>;
			}[] = [];
			if (award.numTeams === undefined) {
				for (const [i, p] of award.winner.entries()) {
					if (p.pid !== undefined) {
						winners.push({ ...p, rank: i + 1 });
					}
				}
			} else {
				for (const [i, team] of award.winner.entries()) {
					for (const p of team) {
						if (p.pid !== undefined) {
							winners.push({ ...p, rank: i + 1 });
						}
					}
				}
			}

			for (const winner of winners) {
				const p = await playersCache.get(winner.pid);
				if (!p) {
					continue;
				}

				let stats: StatsRecord = {};
				let prevStats: StatsRecord | undefined;
				if (series) {
					// Series stats are only kept with the award
					stats = { ...winner.statOverrides };
					delete stats.score;
				} else {
					const p2 = (await player.format(p, {
						attrs: [],
						stats: ["season", "tid", ...(statsToLoad as PlayerStatAttr[])],
						seasonRange: [mip ? season - 1 : season, season],
						seasonType,
						mergeStats: "totOnly",
						showNoStats: true,
						fuzz: true,
					})) as
						| {
								stats: ({
									season: number;
									playoffs: boolean | "combined";
								} & StatsRecord)[];
						  }
						| undefined;
					const statsRows = (p2?.stats ?? []).filter((row) =>
						isSeasonTypeRow(row, seasonType),
					);
					stats = { ...statsRows.findLast((row) => row.season === season) };
					const prev = statsRows.findLast((row) => row.season === season - 1);
					if (mip && prev) {
						prevStats = prev;
					}
					for (const record of [stats, prevStats]) {
						if (!record) {
							continue;
						}
						for (const [key, value] of Object.entries(record)) {
							if (Array.isArray(value)) {
								record[key] = key.endsWith("Max")
									? value[0]
									: helpers.sum(
											value.filter((x): x is number => typeof x === "number"),
										);
							}
						}
					}
				}

				// Team context some formulas read
				const ts = await getTeamSeason(season, winner.tid);
				const teamContext = {
					seasonFraction: 1,
					teamGp: ts ? helpers.getTeamSeasonGp(ts) : 0,
					winp: ts ? helpers.calcWinp(ts) : 0,
				};
				const statsWithContext: StatsRecord = { ...teamContext, ...stats };

				const ratingsPos =
					p.ratings.findLast((row) => row.season === season)?.pos ??
					last(p.ratings).pos;
				const pos =
					__SPORT === "baseball" && stats.gpF
						? getPosByGpF(stats.gpF as any, ratingsPos)
						: ratingsPos;

				const formula = effectiveAwardFormula(award, pos);
				formulas.add(award.formula);
				keyStatRows.push({
					stats: statsWithContext,
					baseline: prevStats
						? { ...statsWithContext, ...prevStats }
						: undefined,
					formula,
				});

				rows.push({
					key: `${season}-${JSON.stringify(award.group ?? null)}-${winner.rank}-${winner.pid}`,
					season,
					rank: winner.rank,
					groupName,
					pid: p.pid,
					firstName: p.firstName,
					lastName: p.lastName,
					pos,
					age: season - p.born.year,
					hof: !!p.hof,
					watch: p.watch,
					tid: winner.tid,
					abbrev:
						ts?.abbrev ?? g.get("teamInfoCache")[winner.tid]?.abbrev ?? "???",
					record: ts
						? helpers.formatRecord({
								won: ts.won,
								lost: ts.lost,
								tied: ts.tied,
								otl: ts.otl,
							})
						: undefined,
					score:
						typeof winner.statOverrides?.score === "number"
							? winner.statOverrides.score
							: undefined,
					stats: statsWithContext,
					prevStats,
				});
			}
		}

		const keyStats = getAwardKeyStats({
			award: latestAward,
			fallback,
			rows: keyStatRows,
			statCols:
				shortName !== undefined
					? awardStatColsSetting({
							shortName,
							statCols: latestAward.statCols,
						})
					: undefined,
		});

		return {
			award: shortName,
			awardName: shortName !== undefined ? names.get(shortName) : undefined,
			awardOptions,
			formulaChanged: formulas.size > 1,
			// Coach of the Year or Executive of the Year: its own table
			coachExecRows:
				shortName !== undefined ? coachExecHistories.get(shortName) : undefined,
			hasHistory:
				storedShortNames.size > 0 ||
				[...coachExecHistories.values()].some((rows) => rows.length > 0),
			keyStats,
			mip: !!latestAward.mip,
			numTeams: latestAward.numTeams,
			playoffSeries,
			rookie: !!latestAward.rookie,
			rows,
		};
	},
});
