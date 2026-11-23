import { idb } from "../db/index.ts";
import { g, local } from "../util/index.ts";
import type { TeamSeason, Player } from "../../common/types.ts";
import addFirstNameShort from "../util/addFirstNameShort.ts";
import {
	getHistoryPlayerProcessor,
	getHistoryTeam,
	historyStats,
} from "./teamHistory.ts";
import { getPlayoffsByConfBySeason } from "./frivolitiesTeamSeasons.ts";
import { defineView } from "../util/defineView.ts";
import { gmEnabled } from "../core/gm/index.ts";
import { getUserVsGms } from "../core/gm/profile.ts";
import { isCollege } from "../core/college/isCollege.ts";

export default defineView({
	id: "gmHistory",
	load: async ({ updateEvents }) => {
		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("gameSim") ||
			updateEvents.has("gameAttributes")
		) {
			const seasonsByTid: Record<number, Set<number>> = {};
			const teamSeasonsByTeam: TeamSeason[][] = [];
			// Each team's current run of consecutive seasons
			const runs = new Map<number, TeamSeason[]>();
			for (
				let season = g.get("startingSeason");
				season <= g.get("season");
				season++
			) {
				// The teams the user ran this season, every one in multi team mode. Recorded on the team seasons (TeamSeason.userControl),
				// where a season spent in spectator mode or auto play is "auto" and doesn't count. Seasons before that was recorded: the
				// season's user team; this season before its regular season: the user's teams now, unless the AI runs them
				const all = await idb.merged.teamSeasons.getAll({ season });
				let teamSeasons: TeamSeason[];
				if (all.some((ts) => ts.userControl !== undefined)) {
					teamSeasons = all.filter((ts) => ts.userControl === "user");
				} else if (season === g.get("season")) {
					const userTids = new Set(
						g.get("spectator") || local.autoPlayUntil ? [] : g.get("userTids"),
					);
					teamSeasons = all.filter((ts) => userTids.has(ts.tid));
				} else {
					const tid = g.get("userTid", season);
					teamSeasons = all.filter((ts) => ts.tid === tid);
				}

				for (const ts of teamSeasons.sort((a, b) => a.tid - b.tid)) {
					let run = runs.get(ts.tid);
					if (!run || run.at(-1)!.season !== season - 1) {
						run = [];
						runs.set(ts.tid, run);
						teamSeasonsByTeam.push(run);
					}
					run.push(ts);

					if (!seasonsByTid[ts.tid]) {
						seasonsByTid[ts.tid] = new Set();
					}
					seasonsByTid[ts.tid]!.add(season);
				}
			}

			const playoffsByConfBySeason = await getPlayoffsByConfBySeason();
			const teamHistories = [];
			for (const teamSeasons of teamSeasonsByTeam) {
				const group = getHistoryTeam(teamSeasons, playoffsByConfBySeason);

				// This is to filter out when tid is DOES_NOT_EXIST when realStats=="all"
				if (group.history.length > 0) {
					teamHistories.push(group);
				}
			}
			teamHistories.reverse();

			const allTeamSeasons = teamSeasonsByTeam.flat();

			// Executive of the Year awards you won (Coach & Executive of the Year), stored on your team seasons
			const execAwards = allTeamSeasons
				.filter((ts) => ts.execOfTheYear?.user)
				.map((ts) => ({
					season: ts.season,
					tid: ts.tid,
					abbrev: ts.abbrev,
					region: ts.region,
					name: ts.name,
				}))
				.sort((a, b) => b.season - a.season);

			const tids = new Set(allTeamSeasons.map((ts) => ts.tid));

			const teamHistory = getHistoryTeam(
				allTeamSeasons,
				playoffsByConfBySeason,
			);
			const processPlayer = getHistoryPlayerProcessor(
				allTeamSeasons,
				teamHistory.history,
				true,
			);

			// Only keep stats from the user's seasons. This makes a new object, so the player in the cache is not changed.
			const getRow = (p: Player) =>
				processPlayer({
					...p,
					stats: p.stats.filter((row) =>
						seasonsByTid[row.tid]?.has(row.season),
					),
				});

			let players;

			// Use statsTids to search for players, unless there are so many teams that it's maybe not worth it
			if (tids.size <= g.get("numTeams") / 2) {
				players = [];
				const pids = new Set<number>();
				for (const tid of tids) {
					// A player who played for several of these teams is found for each one, but only processed the first time. Players with no row are processed again, which is fine because they'll have no row again.
					const playersTid = (
						await idb.merged.players.getAll(
							{ statsTid: tid },
							{
								filter: (p) => !pids.has(p.pid),
								map: getRow,
							},
						)
					).filter((p) => p !== undefined);
					for (const p of playersTid) {
						players.push(p);
						pids.add(p.pid);
					}
				}
			} else {
				players = (
					await idb.merged.players.getAll(undefined, {
						filter: (p) => p.statsTids.some((tid) => tids.has(tid)),
						map: getRow,
					})
				).filter((p) => p !== undefined);
			}

			// AI GM personalities: your record and trades against each AI GM
			const vsGms =
				gmEnabled() && !isCollege() ? await getUserVsGms() : undefined;

			return {
				...teamHistory,
				vsGms,
				execAwards,
				players: addFirstNameShort(players),
				stats: historyStats,
				teamHistories,
			};
		}
	},
});
