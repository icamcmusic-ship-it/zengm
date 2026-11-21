import { idb } from "../db/index.ts";
import type { PlayerFeat } from "../../common/types.ts";
import { g, helpers } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { bySport } from "../../common/sportFunctions.ts";
import { processPlayerStats } from "../util/processPlayerStats.ts";
import { getWatchPids } from "./news.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { validateTeam } from "../util/processInputs.ts";
import { validateSeason } from "../util/processInputs.ts";
import {
	FEAT_GAME_TYPE_NAMES,
	FEAT_KINDS_BASKETBALL,
	featKindsBasketball,
	type FeatGameType,
	type FeatKind,
} from "../../common/featKinds.ts";

const processInputs = (params: RouteParams<"playerFeats">) => {
	let season: number | "all";

	if (params.season && params.season !== "all") {
		season = validateSeason(params.season);
	} else {
		season = "all";
	}

	return {
		season,
		team: validateTeam(params.team, ["all", "watch"]),
	};
};

// Which of these players still exist. Only keys are read from IndexedDB, plus the cache (new players not saved yet,
// and players deleted but not saved yet)
const existingPids = async (pids: Set<number>) => {
	const out = new Set<number>();
	if (pids.size === 0) {
		return out;
	}
	const cacheByKey = await idb.cache.players.getAllByKey();
	const sorted = [...pids].sort((a, b) => a - b);
	const dbKeys = new Set(
		await idb.league.getAllKeys(
			"players",
			IDBKeyRange.bound(sorted[0]!, sorted.at(-1)!),
		),
	);
	for (const pid of pids) {
		if (
			cacheByKey[pid] !== undefined ||
			(dbKeys.has(pid) && !idb.cache.players.hasPendingDelete(pid))
		) {
			out.add(pid);
		}
	}
	return out;
};

export default defineView({
	id: "playerFeats",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("gameSim") ||
			inputs.team !== prevInputs?.team ||
			inputs.season !== prevInputs?.season
		) {
			const watchPids =
				inputs.team === "watch" ? await getWatchPids() : undefined;

			// Applied while reading feats, so feats that won't be shown are not all held in memory
			const filter = (feat: PlayerFeat) =>
				(typeof inputs.team !== "number" || feat.tid === inputs.team) &&
				(watchPids === undefined || watchPids.has(feat.pid)) &&
				(inputs.season === "all" || feat.season === inputs.season);

			// One season only reads that season's feats (see merged/playerFeats.ts)
			const feats = await idb.merged.playerFeats.getAll(
				inputs.season === "all" ? undefined : { season: inputs.season },
				{ filter },
			);

			// Deleted players have no player page, so their names are shown without a link
			const pidExists = await existingPids(new Set(feats.map((f) => f.pid)));

			const featsProcessed = feats.map((feat) => {
				const featStats = { ...feat.stats };
				let score = feat.score;

				if (__SPORT === "basketball") {
					featStats.trb = featStats.orb + featStats.drb;
					featStats.fgp =
						featStats.fga > 0 ? (100 * featStats.fg) / featStats.fga : 0;
					featStats.tpp =
						featStats.tpa > 0 ? (100 * featStats.tp) / featStats.tpa : 0;
					featStats.ftp =
						featStats.fta > 0 ? (100 * featStats.ft) / featStats.fta : 0;

					featStats.gmsc = helpers.gameScore(featStats);
				} else if (__SPORT === "hockey") {
					const toAdd = ["g", "a", "pts", "sPct", "foPct"];
					const processed = processPlayerStats(featStats, toAdd);
					for (const stat of toAdd) {
						featStats[stat] = processed[stat];
					}
				} else if (__SPORT === "baseball") {
					const toAdd = ["ab", "ip", "gmsc"];
					const processed = processPlayerStats(featStats, toAdd);
					for (const stat of toAdd) {
						featStats[stat] = processed[stat];
					}
				}

				const overtimeText = helpers.overtimeText(
					feat.overtimes,
					feat.numPeriods,
				);
				if (overtimeText !== "") {
					score += ` (${overtimeText})`;
				}

				// Basketball: which cutoffs it met, for the feat type filter and the leaderboard (same cutoffs as when it was
				// recorded, with its stored factor)
				const kinds: FeatKind[] =
					__SPORT === "basketball"
						? featKindsBasketball(
								feat.stats,
								feat.factor ??
									helpers.featScaleFactor(feat.overtimes, feat.playoffs),
							)
						: [];

				let type: FeatGameType;
				if (feat.playoffs) {
					type = "playoffs";
				} else if (feat.nit) {
					type = "nit";
				} else if (feat.tid === -1 || feat.tid === -2) {
					type = "allStar";
				} else {
					type = "regularSeason";
				}

				return {
					...feat,
					stats: featStats,
					score,
					abbrev: g.get("teamInfoCache")[feat.tid]?.abbrev,
					oppAbbrev: g.get("teamInfoCache")[feat.oppTid]?.abbrev,
					type,
					kinds,
					deleted: !pidExists.has(feat.pid),
				};
			});

			// Filter options: the kinds and game types these feats have
			const kindsPresent = new Set(featsProcessed.flatMap((f) => f.kinds));
			const kindOptions = FEAT_KINDS_BASKETBALL.filter((kind) =>
				kindsPresent.has(kind.key),
			).map(({ key, name, short }) => ({ key, name, short }));
			const typesPresent = new Set(featsProcessed.map((f) => f.type));
			const typeOptions = helpers
				.keys(FEAT_GAME_TYPE_NAMES)
				.filter((type) => typesPresent.has(type))
				.map((type) => ({ key: type, name: FEAT_GAME_TYPE_NAMES[type] }));

			// The cutoffs in the text: for one season, the ones its regulation games used (feats store their factor), so
			// changed settings don't rewrite old seasons' cutoffs. Otherwise the current settings.
			let quarterLengthFactor = helpers.featScaleFactor(0);
			if (inputs.season !== "all") {
				const stored = feats.find(
					(f) => f.factor !== undefined && f.overtimes === 0,
				)?.factor;
				if (stored !== undefined) {
					quarterLengthFactor = stored;
				}
			}

			const stats = bySport({
				baseball: [
					"ab",
					"r",
					"h",
					"rbi",
					"hr",
					"sb",
					"bb",
					"so",
					"pa",
					"ip",
					"hPit",
					"rPit",
					"er",
					"bbPit",
					"soPit",
					"hrPit",
					"pc",
					"gmsc",
				],
				basketball: [
					"gs",
					"min",
					"fg",
					"fga",
					"fgp",
					"tp",
					"tpa",
					"tpp",
					"ft",
					"fta",
					"ftp",
					"orb",
					"drb",
					"trb",
					"ast",
					"tov",
					"stl",
					"blk",
					"pf",
					"pts",
					"gmsc",
				],
				football: [
					"pssCmp",
					"pss",
					"pssYds",
					"pssTD",
					"rus",
					"rusYds",
					"rusTD",
					"rec",
					"recYds",
					"recTD",
					"defInt",
					"defIntTD",
					"defFmbFrc",
					"defFmbRec",
					"defFmbTD",
					"defSk",
					"defSft",
					"prTD",
					"krTD",
				],
				hockey: [
					"g",
					"a",
					"pts",
					"pm",
					"pim",
					"evG",
					"ppG",
					"shG",
					"gwG",
					"evA",
					"ppA",
					"shA",
					"gwA",
					"s",
					"sPct",
					"tsa",
					"min",
					"fow",
					"fol",
					"foPct",
					"blk",
					"hit",
					"tk",
					"gv",
					"sv",
				],
			});
			return {
				team: inputs.team,
				feats: featsProcessed,
				kindOptions,
				typeOptions,
				quarterLengthFactor,
				season: inputs.season,
				stats,
			};
		}
	},
});
