import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { PHASE } from "../../../common/constants.ts";
import { team } from "../index.ts";
import getSchedule from "../season/getSchedule.ts";
import getPlayoffsByConf from "../season/getPlayoffsByConf.ts";
import { getActualPlayThroughInjuries } from "../game/loadTeams.ts";
import { simSeasonOdds, type SeasonOddsResult } from "./simSeason.ts";
import type { TeamSeasonRecord } from "../team/getHypotheticalTeam.ts";

export type { SeasonOddsResult, TeamOdds } from "./simSeason.ts";

export const NUM_SIMS = 1000;

// Weight of the actual point margin vs the roster-based rating grows with games played
const MOV_PRIOR_GAMES = 25;

let cache:
	| {
			key: string;
			result: Promise<SeasonOddsResult | undefined>;
	  }
	| undefined;

const isAvailable = () => {
	if (__SPORT !== "basketball") {
		return false;
	}
	const phase = g.get("phase");
	return (
		phase === PHASE.REGULAR_SEASON ||
		phase === PHASE.AFTER_TRADE_DEADLINE ||
		phase === PHASE.PLAYOFFS
	);
};

const getTeamRatings = async (tids: number[]) => {
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const byTid = Map.groupBy(players, (p) => p.tid);
	const teams = await idb.cache.teams.getAll();
	const teamsByTid = new Map(teams.map((t) => [t.tid, t]));

	const ratings = new Map<number, number>();
	for (const tid of tids) {
		const teamPlayers = (byTid.get(tid) ?? [])
			.map((p) => {
				const r = p.ratings.at(-1)!;
				return {
					pid: p.pid,
					value: p.value,
					injury: p.injury,
					ratings: { ovr: r.ovr, ovrs: r.ovrs, pos: r.pos },
				};
			})
			.sort((a, b) => a.pid - b.pid);
		const t = teamsByTid.get(tid);
		const ovr = team.ovr(teamPlayers, {
			// Short injuries will be over soon, so only long ones count against a team's rest of season
			accountForInjuredPlayers: {
				numDaysInFuture: 10,
				playThroughInjuries: getActualPlayThroughInjuries(t ?? "default"),
			},
			playoffs: g.get("phase") === PHASE.PLAYOFFS,
		});
		// team.ovr is a point margin translated to 0-100, undo that (playoffs ovr is shifted by 40)
		const shifted = g.get("phase") === PHASE.PLAYOFFS ? ovr + 40 : ovr;
		ratings.set(tid, ((shifted - 50) * 15) / 50);
	}
	return ratings;
};

const compute = async (numSims: number) => {
	const season = g.get("season");
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[season], [season, "Z"]],
	);
	const activeTids = (await idb.cache.teams.getAll())
		.filter((t) => !t.disabled)
		.map((t) => t.tid);
	const records = teamSeasons.filter((ts) => activeTids.includes(ts.tid));
	const ratings = await getTeamRatings(records.map((ts) => ts.tid));

	const teamStats = (await idb.cache.teamStats.getAll()).filter(
		(row) => !row.playoffs,
	);
	const statsByTid = new Map(
		teamStats
			.filter((row) => row.season === season)
			.map((row) => [row.tid, row]),
	);

	const teams = records.map((ts) => {
		const stats = statsByTid.get(ts.tid);
		const gp = stats?.gp ?? 0;
		const mov = gp > 0 ? (stats.pts - stats.oppPts) / gp : 0;
		const w = gp / (gp + MOV_PRIOR_GAMES);
		return {
			tid: ts.tid,
			rating: (1 - w) * ratings.get(ts.tid)! + w * mov,
			record: ts as TeamSeasonRecord,
		};
	});

	const phase = g.get("phase");
	const schedule =
		phase === PHASE.PLAYOFFS
			? []
			: (await getSchedule()).filter((game) => game.homeTid >= 0);
	const playoffSeries =
		phase === PHASE.PLAYOFFS
			? await idb.cache.playoffSeries.get(season)
			: undefined;

	return simSeasonOdds({
		byConf: await getPlayoffsByConf(season),
		teams,
		schedule,
		playoffSeries,
		numGamesPlayoffSeries: g.get("numGamesPlayoffSeries", "current"),
		hca: 2.5 * g.get("homeCourtAdvantage"),
		numSims,
	});
};

const getKey = async () => {
	const season = g.get("season");
	const schedule = await getSchedule();
	const playoffSeries = await idb.cache.playoffSeries.get(season);
	let playoffKey = "";
	if (playoffSeries) {
		playoffKey = JSON.stringify([
			playoffSeries.currentRound,
			playoffSeries.series.map((round) =>
				round.map((s) => [s.home.won, s.away?.won]),
			),
			playoffSeries.playIns?.map((p) => p.map((s) => [s.home.won, s.away.won])),
		]);
	}

	// Rosters matter too (trades, signings, injuries)
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	let rosterHash = 0;
	for (const p of players) {
		rosterHash =
			(rosterHash * 31 + p.pid * 7 + p.tid * 13 + p.injury.gamesRemaining) %
			1000000007;
	}

	return `${season}|${g.get("phase")}|${schedule.length}|${playoffKey}|${rosterHash}`;
};

// Cached until a game day, a roster move or an injury changes things
export const getSeasonOdds = async (
	numSims: number = NUM_SIMS,
): Promise<SeasonOddsResult | undefined> => {
	if (!isAvailable()) {
		return;
	}

	const key = `${await getKey()}|${numSims}`;
	if (cache?.key !== key) {
		cache = {
			key,
			result: compute(numSims).catch((error) => {
				console.error(error);
				cache = undefined;
				return undefined;
			}),
		};
	}
	return cache.result;
};
