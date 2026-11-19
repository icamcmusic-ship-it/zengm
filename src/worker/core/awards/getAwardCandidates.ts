import { awardActive } from "./trackingAwards.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import type {
	Award,
	AwardInfoIndividual,
	AwardInfoTeam,
	Awards,
	GameAttributesLeague,
	PlayerStatAttr,
} from "../../../common/types.ts";
import { groupByUnique } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import addFirstNameShort from "../../util/addFirstNameShort.ts";
import g from "../../util/g.ts";
import type { StatOverridesByMatchup } from "./getPlayers.ts";
import { hashPlayoffSeries } from "./hashPlayoffSeries.ts";
import { processAwards } from "./processAwards.ts";
import {
	effectiveAwardFormula,
	getAwardKeyStats,
	pickerStats,
	type AwardKeyStats,
	type KeyStatRow,
} from "./keyStats.ts";
import player from "../player/index.ts";
import helpers from "../../util/helpers.ts";

const persistedAwardsToAwardSetting = (persistedAwards: Awards) => {
	let statOverridesByMatchup: StatOverridesByMatchup | undefined;

	const awards: GameAttributesLeague["awards"] = [];

	const seenShortNames = new Set<string>();

	for (const persistedAward of persistedAwards.awards) {
		// Store statOverrides first before ignoring repeated ones, so semifinals MVP statOverrides get saved for both awards
		const group = persistedAward.group;
		if (
			group?.type === "playoffSeries" &&
			persistedAward.numTeams === undefined
		) {
			const matchupKey = hashPlayoffSeries(group);
			statOverridesByMatchup ??= {};
			statOverridesByMatchup[matchupKey] = {};
			for (const p of persistedAward.winner) {
				if (p.pid !== undefined && p.statOverrides) {
					statOverridesByMatchup[matchupKey][p.pid] = {
						tid: p.tid,
						...p.statOverrides,
					};
				}
			}
		}

		// Skip multiple repeated conf/div awards - this assumes shortName is unique
		if (seenShortNames.has(persistedAward.shortName)) {
			continue;
		}
		seenShortNames.add(persistedAward.shortName);

		const award: GameAttributesLeague["awards"][number] & {
			winner?: Awards["awards"][number]["winner"];
		} = {
			...persistedAward,
			group:
				group === undefined || group.type === "playoffSeries"
					? undefined
					: group.type,
		};
		delete award.winner;
		awards.push(award);
	}

	return { awards, statOverridesByMatchup };
};

const getAwards = async (season: number) => {
	const persistedAwards = await idb.merged.awards.get(season);

	let awards;
	let statOverridesByMatchup;
	if (persistedAwards) {
		const output = persistedAwardsToAwardSetting(persistedAwards);
		awards = output.awards;
		statOverridesByMatchup = output.statOverridesByMatchup;
	} else {
		// Either the current season, or some past season where no awards are in database so might as well show current awards
		// (Advanced Tracking Stats only awards are left out with the setting off)
		awards = g.get("awards").filter(awardActive);
	}

	return {
		awards,
		statOverridesByMatchup,
	};
};

// Like showStatsByType but with a bit more
export const awardCandidateStats: Partial<
	Record<Award["showStats"], string[]>
> = bySport({
	baseball: {
		overall: ["keyStats", "war"],
		sp: ["w", "l", "era", "ip", "war"],
		rp: ["sv", "era", "ip", "war"],
		offense: ["pa", "hr", "ba", "ops", "war"],
		defense: ["pa", "hr", "ba", "ops", "war"], // Showing actualy defensive stats would be annoying because arrays
	},
	basketball: {
		offense: ["pts", "trb", "ast", "per"],
		defense: ["trb", "blk", "stl", "dws"],
	},
	football: {
		overall: ["keyStats", "av"],
		defense: ["defTck", "defSk", "defPssDef", "defInt", "av"],
		blocking: ["pbw", "pbwr", "rbw", "rbwr", "av"],
	},
	hockey: {
		overall: ["keyStats", "ps"],
		defense: ["tk", "hit", "dps"],
		goalkeeping: ["gpGoalie", "gaa", "svPct", "gps"],
	},
});

type StatRangeKey = "regularSeason" | "playoffs" | "combined";

const sameStatRange = (
	row: { playoffs: boolean | "combined" | "playoffSeries" },
	statRange: StatRangeKey,
) =>
	statRange === "regularSeason"
		? row.playoffs === false
		: statRange === "playoffs"
			? row.playoffs === true
			: row.playoffs === "combined";

// Arrays from stats by position or game highs, as single numbers (like getPlayers does)
const BASEBALL_POS_AVERAGED = new Set(["ch", "fldp", "rf9", "rfg", "inn"]);
const flattenStat = (key: string, value: unknown) => {
	if (!Array.isArray(value)) {
		return value;
	}
	if (key.endsWith("Max")) {
		return value[0];
	}
	const numbers = value.filter((x): x is number => typeof x === "number");
	const sum = helpers.sum(numbers);
	if (__SPORT === "baseball" && BASEBALL_POS_AVERAGED.has(key)) {
		return numbers.length > 0 ? sum / numbers.length : undefined;
	}
	return sum;
};

// Award Races stat picker: load every stat it offers for the candidates only (the award formulas only load what they read)
const addPickerStats = async (
	players: Awaited<ReturnType<typeof processAwards>>["players"],
	pidsByStatRange: Map<StatRangeKey, Set<number>>,
	season: number,
) => {
	const stats = pickerStats(false, []).filter(
		(stat) => stat !== "keyStats",
	) as PlayerStatAttr[];
	const playersByPid = groupByUnique(players, "pid");

	for (const [statRange, pids] of pidsByStatRange) {
		if (pids.size === 0) {
			continue;
		}
		const playersRaw = await idb.merged.players.getAll({
			pids: Array.from(pids),
		});
		const formatted = (await player.formatAll(playersRaw, {
			attrs: ["pid"],
			stats: ["season", ...stats],
			seasonRange: [season - 1, season],
			seasonType: statRange,
			mergeStats: "totOnly",
			fuzz: true,
		})) as unknown as {
			pid: number;
			stats: ({
				season: number;
				playoffs: boolean | "combined";
			} & Record<string, unknown>)[];
		}[];

		for (const p2 of formatted) {
			const p = playersByPid[p2.pid];
			if (!p) {
				continue;
			}
			for (const row2 of p2.stats) {
				if (!sameStatRange(row2, statRange)) {
					continue;
				}

				// currentStats is a reference to one of these rows
				const targets = p.stats.filter(
					(row) => row.season === row2.season && sameStatRange(row, statRange),
				);
				for (const target of targets as Record<string, unknown>[]) {
					for (const stat of stats) {
						if (target[stat] === undefined && row2[stat] !== undefined) {
							target[stat] = flattenStat(stat, row2[stat]);
						}
					}
				}
			}
		}
	}
};

export const getAwardCandidates = async (
	season: number,
	awardsOverride?: GameAttributesLeague["awards"],
	options?: {
		// Load every stat the Award Races stat picker offers, for the candidates
		pickerStats?: boolean;
	},
) => {
	let awards;
	let statOverridesByMatchup;
	if (awardsOverride) {
		awards = awardsOverride;
	} else {
		const info = await getAwards(season);
		awards = info.awards;
		statOverridesByMatchup = info.statOverridesByMatchup;
	}

	const { errorMessages, players, realizedAwards } = await processAwards({
		awards,
		extraStatRanges: [],
		extraStats: [],
		numPlayersPerIndividualAward: 10,
		season,
		statOverridesByMatchup,
	});

	const playersByPid = groupByUnique(players, "pid");

	if (options?.pickerStats) {
		const pidsByStatRange = new Map<StatRangeKey, Set<number>>();
		for (const award of realizedAwards.flat()) {
			const statRange = award.statRange ?? "regularSeason";
			if (typeof statRange === "number") {
				continue;
			}
			const pids = pidsByStatRange.getOrInsert(statRange, new Set());
			const winners =
				award.numTeams === undefined ? award.winner : award.winner.flat();
			for (const p of winners) {
				if (p.pid !== undefined) {
					pids.add(p.pid);
				}
			}
		}
		await addPickerStats(players, pidsByStatRange, season);
	}

	const augmentPlayers = (
		award: Award,
		winner:
			| AwardInfoIndividual["winner"]
			| (AwardInfoTeam["winner"][number][number] & {
					opoyOverride?: undefined;
			  })[],
	) => {
		return addFirstNameShort(
			winner
				.map((p2) => {
					if (p2 === undefined || p2.pid === undefined) {
						return;
					}

					const statRange = award.statRange ?? "regularSeason";

					const p = playersByPid[p2.pid]!;
					return {
						...p,
						currentStats: {
							...p.currentStats[statRange],
							score: p.scores[award.shortName],
						} as {
							score: number | undefined;
						} & (typeof p)["currentStats"]["regularSeason"],
						opoyOverride: p2.opoyOverride,
						statOverrides: p2.statOverrides,
					};
				})
				.filter((p) => p !== undefined),
		);
	};

	type Output = (
		| (AwardInfoIndividual & { rank?: undefined })
		| (AwardInfoTeam & { rank: number })
	) & {
		players: ReturnType<typeof augmentPlayers>;
		stats: string[];
		keyStats: AwardKeyStats;
	};

	const getKeyStats = (
		award: Award,
		augmented: ReturnType<typeof augmentPlayers>,
		fallback: string[],
	) => {
		const rows: KeyStatRow[] = [];
		for (const p of augmented) {
			if (p.opoyOverride) {
				// Scored with a different formula
				continue;
			}
			const stats: Record<string, unknown> = {
				...p.currentStats,
				...p.statOverrides,
			};
			let baseline;
			if (award.mip) {
				const statRange = award.statRange ?? "regularSeason";
				const prev =
					typeof statRange === "number"
						? undefined
						: p.stats.findLast(
								(row) =>
									row.season === season - 1 && sameStatRange(row, statRange),
							);
				if (!prev) {
					continue;
				}
				baseline = { ...stats, ...prev };
			}
			rows.push({
				stats,
				baseline,
				formula: effectiveAwardFormula(award, p.pos),
			});
		}
		return getAwardKeyStats({ award, fallback, rows });
	};

	const awardCandidates: Output[][] = realizedAwards.map((group) =>
		group.flatMap((award) => {
			const showStats = awardCandidateStats[award.showStats];
			if (!showStats) {
				throw new Error("Invalid showStats");
			}

			const stats = [...showStats, "score"];

			const numTeams = award.numTeams;
			if (numTeams !== undefined) {
				const teams = award.winner.map((winner) =>
					augmentPlayers(award, winner),
				);

				// Same key stats for every team of the award, from all of their players
				const keyStats = getKeyStats(award, teams.flat(), showStats);

				return teams.map((players, i): Output => {
					return {
						...award,
						numTeams,
						rank: i + 1,
						players,
						stats,
						keyStats,
					};
				});
			}

			const players = augmentPlayers(award, award.winner);
			return {
				...award,
				numTeams: undefined,
				rank: undefined,
				players,
				stats,
				keyStats: getKeyStats(award, players, showStats),
			};
		}),
	);

	return { awardCandidates, errorMessages };
};
