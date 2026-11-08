import { featureOffError } from "../util/nativeFeatures.ts";
import { idb } from "../db/index.ts";
import { changeLog } from "../db/changeLog.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { isBulkSimming } from "../util/wrappedData.ts";
import { getSeasonState } from "../util/processInputs.ts";
import { isCurrentSeasonComplete } from "../../common/seasons.ts";
import {
	buildHomeCourt,
	extremes,
	type HCGame,
} from "../../common/leagueHistory/homeCourt.ts";

// Box scores reduced to what this page needs, per season. A season that is over only changes if its box scores are deleted (which changes how many there are) or something writes to its games.
let gamesCache:
	| {
			lid: number;
			epoch: number;
			seasons: Map<number, { seq: number; count: number; games: HCGame[] }>;
	  }
	| undefined;

const loadGames = async () => {
	const lid = g.get("lid");
	if (
		!gamesCache ||
		gamesCache.lid !== lid ||
		gamesCache.epoch !== changeLog.epoch
	) {
		gamesCache = { lid, epoch: changeLog.epoch, seasons: new Map() };
	}
	const cache = gamesCache.seasons;
	const index = idb.league.transaction("games").store.index("season");
	const seasons = new Set<number>();
	let cursor = await index.openKeyCursor();
	while (cursor) {
		const season = cursor.key as number;
		seasons.add(season);
		cursor = await cursor.continue(season + 1);
	}
	// The current season's games may only be in the cache so far
	seasons.add(g.get("season"));

	const out: HCGame[] = [];
	for (const season of [...seasons].sort((a, b) => a - b)) {
		const count = await idb.league
			.transaction("games")
			.store.index("season")
			.count(season);
		const seq = changeLog.season("games", season);
		const hit = cache.get(season);
		let games: HCGame[];
		if (hit && hit.count === count && hit.seq === seq) {
			games = hit.games;
		} else {
			games = await idb.merged.games.getAll(
				{ season },
				{
					filter: (gm) => gm.teams.length === 2,
					map: (gm) => ({
						season: gm.season,
						playoffs: !!gm.playoffs,
						neutralSite: !!gm.neutralSite,
						home: { tid: gm.teams[0].tid, pts: gm.teams[0].pts },
						away: { tid: gm.teams[1].tid, pts: gm.teams[1].pts },
					}),
				},
			);
			cache.set(season, { seq, count, games });
		}
		for (const gm of games) {
			out.push(gm);
		}
	}
	for (const season of cache.keys()) {
		if (!seasons.has(season)) {
			cache.delete(season);
		}
	}
	return out;
};

export default defineView({
	id: "homeCourt",
	load: async ({ updateEvents }) => {
		const featureOff = featureOffError("frivolities");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameSim")
		) {
			return;
		}
		// While games are being simmed, leave the page as it is. It updates when the sim stops.
		if (!updateEvents.has("firstRun") && isBulkSimming()) {
			return;
		}
		const currentSeason = g.get("season");
		const teamSeasonsAll = await idb.merged.teamSeasons.getAll();
		const series = await idb.merged.playoffSeries.getAll();
		const games = await loadGames();

		const completeSeasons = new Set<number>();
		for (let s = g.get("startingSeason"); s < currentSeason; s++) {
			completeSeasons.add(s);
		}
		if (isCurrentSeasonComplete(getSeasonState())) {
			completeSeasons.add(currentSeason);
		}

		const D = buildHomeCourt({
			teamSeasons: teamSeasonsAll
				.filter((ts) => ts.season <= currentSeason)
				.map((ts) => ({
					tid: ts.tid,
					season: ts.season,
					wonHome: ts.wonHome ?? 0,
					lostHome: ts.lostHome ?? 0,
					wonAway: ts.wonAway ?? 0,
					lostAway: ts.lostAway ?? 0,
				})),
			games,
			series: series.map((ps) => ({
				season: ps.season,
				rounds: ps.series.map((round) =>
					round.map((m) => ({
						home: { tid: m.home.tid, won: m.home.won },
						away: m.away ? { tid: m.away.tid, won: m.away.won } : undefined,
					})),
				),
			})),
			completeSeasons,
		});

		// Names: the team's latest row, and each team season's own for the lists of team seasons
		const teams: Record<
			number,
			{ abbrev: string; region: string; name: string }
		> = {};
		const latestSeason: Record<number, number> = {};
		const seasonInfo = new Map<string, { abbrev: string; name: string }>();
		for (const ts of teamSeasonsAll) {
			if (
				latestSeason[ts.tid] === undefined ||
				ts.season > latestSeason[ts.tid]!
			) {
				latestSeason[ts.tid] = ts.season;
				teams[ts.tid] = { abbrev: ts.abbrev, region: ts.region, name: ts.name };
			}
			seasonInfo.set(`${ts.tid}|${ts.season}`, {
				abbrev: ts.abbrev,
				name: `${ts.region} ${ts.name}`,
			});
		}
		const named = (rows: ReturnType<typeof extremes>) =>
			rows.map((r) => ({
				...r,
				...(seasonInfo.get(`${r.tid}|${r.season}`) ?? {
					abbrev: teams[r.tid]?.abbrev ?? "???",
					name: "",
				}),
			}));

		const lists = {
			bestHome: named(extremes(D.teamSeasons, "homeP", "best")),
			bestRoad: named(extremes(D.teamSeasons, "roadP", "best")),
			worstHome: named(extremes(D.teamSeasons, "homeP", "worst")),
			worstRoad: named(extremes(D.teamSeasons, "roadP", "worst")),
			biggestGap: named(extremes(D.teamSeasons, "gap", "best")),
			betterOnRoad: named(
				extremes(D.teamSeasons, "gap", "worst").filter((r) => r.gap! < 0),
			),
		};

		return {
			seasons: D.seasons,
			eras: D.eras,
			teams: D.teams,
			teamInfos: teams,
			series: D.series,
			box: D.box,
			po: D.po,
			total: D.total,
			lists,
			currentSeason,
			currentComplete: completeSeasons.has(currentSeason),
		};
	},
});
