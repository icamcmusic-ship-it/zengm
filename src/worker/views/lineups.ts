// Advanced Tracking Stats (League extras, see docs/native-features.md): a team-season's five-man lineups (the most used ones, kept by the
// game sim's tracking) and its players' on/off numbers
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { featureOffError } from "../util/nativeFeatures.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import {
	validatePlayoffs,
	validateSeason,
	validateTeam,
} from "../util/processInputs.ts";
import {
	advStat,
	lineupLine,
	sumAdv,
	TEAM_ADV,
	type TeamAdv,
} from "../../common/advStats.ts";

const processInputs = (params: RouteParams<"lineups">) => {
	return {
		tid: validateTeam(params.team),
		season: validateSeason(params.season),
		playoffs: validatePlayoffs(params.playoffs),
	};
};

export default defineView({
	id: "lineups",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("advStats");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!(inputs.season === g.get("season") && updateEvents.has("gameSim")) &&
			!updateEvents.has("newPhase") &&
			inputs.tid === prevInputs?.tid &&
			inputs.season === prevInputs?.season &&
			inputs.playoffs === prevInputs?.playoffs
		) {
			return;
		}

		const { tid, season } = inputs;
		const playoffs = inputs.playoffs === "playoffs";
		const teamStatsRows = await idb.merged.teamStats.getAll({ tid, season });
		const teamStats = teamStatsRows.find(
			(row) => !!row.playoffs === playoffs,
		);
		const teamAdv: TeamAdv | undefined = teamStats?.adv;
		const numPlayers = g.get("numPlayersOnCourt");

		// The team's players that season
		const players = await idb.merged.players.getAll(
			{ statsTid: tid },
			{
				filter: (p) =>
					p.stats.some(
						(row) =>
							row.tid === tid &&
							row.season === season &&
							!!row.playoffs === playoffs,
					),
			},
		);
		const names = new Map<number, { name: string; pos: string }>();
		const onOff = [];
		for (const p of players) {
			const rows = p.stats.filter(
				(row) =>
					row.tid === tid && row.season === season && !!row.playoffs === playoffs,
			);
			const ratings =
				p.ratings.findLast((r) => r.season <= season) ?? p.ratings.at(-1)!;
			names.set(p.pid, {
				name: `${p.firstName} ${p.lastName}`,
				pos: ratings.pos,
			});
			const adv = sumAdv(rows);
			if (!adv) {
				continue;
			}
			let min = 0;
			let gp = 0;
			for (const row of rows) {
				min += row.min ?? 0;
				gp += row.gp ?? 0;
			}
			if (gp === 0) {
				continue;
			}
			onOff.push({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				pos: ratings.pos,
				gp,
				min,
				onOrtg: advStat(adv, "onOrtg"),
				onDrtg: advStat(adv, "onDrtg"),
				onNet: advStat(adv, "onNet"),
				offNet: advStat(adv, "offNet"),
				onOffNet: advStat(adv, "onOffNet"),
				rimDeter: advStat(adv, "rimDeter"),
			});
		}

		const lineups = (teamAdv?.lu ?? []).map((row) => {
			const line = lineupLine(row, numPlayers);
			return {
				...line,
				key: line.pids.join("-"),
				players: line.pids.map((pid) => ({
					pid,
					name: names.get(pid)?.name ?? `Player ${pid}`,
					pos: names.get(pid)?.pos ?? "",
				})),
			};
		});

		let team;
		if (teamAdv) {
			const t = teamAdv.t;
			const possFor = t[TEAM_ADV.possFor] ?? 0;
			const possAgainst = t[TEAM_ADV.possAgainst] ?? 0;
			const ortg = possFor > 0 ? (100 * teamStats.pts) / possFor : undefined;
			const drtg =
				possAgainst > 0 ? (100 * teamStats.oppPts) / possAgainst : undefined;
			const clMin = (t[TEAM_ADV.clSec] ?? 0) / 60;
			team = {
				ortg,
				drtg,
				net: ortg !== undefined && drtg !== undefined ? ortg - drtg : undefined,
				clMin,
				clPm: (t[TEAM_ADV.clPtsFor] ?? 0) - (t[TEAM_ADV.clPtsAgainst] ?? 0),
			};
		}

		return {
			lineups,
			numPlayers,
			onOff,
			playoffs: inputs.playoffs,
			season,
			team,
			tid,
		};
	},
});
