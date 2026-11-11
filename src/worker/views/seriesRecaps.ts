import { featureOffError } from "../util/nativeFeatures.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { season as seasonCore } from "../core/index.ts";
import {
	seriesRecap,
	type RecapGame,
	type RecapPlayerLine,
	type SeriesRecap,
} from "../../common/seriesRecap/index.ts";
import type { Game } from "../../common/types.ts";
import type { RouteParams } from "../../ui/router/types.ts";

const teamName = (tid: number) =>
	g.get("teamInfoCache")[tid]?.name ?? `Team ${tid}`;

const num = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : 0;

export const toRecapGame = (game: Game): RecapGame => ({
	gid: game.gid,
	overtimes: game.overtimes ?? 0,
	clutchPlays: game.clutchPlays,
	teams: game.teams.map((t) => ({
		tid: t.tid,
		pts: t.pts,
		ptsQtrs: Array.isArray(t.ptsQtrs) ? t.ptsQtrs : [],
		players: ((t.players ?? []) as any[]).map(
			(p): RecapPlayerLine => ({
				pid: p.pid,
				name: p.name ?? "",
				min: num(p.min),
				pts: num(p.pts),
				trb: num(p.drb) + num(p.orb),
				ast: num(p.ast),
				stl: num(p.stl),
				blk: num(p.blk),
				tov: num(p.tov),
				fg: num(p.fg),
				fga: num(p.fga),
				ft: num(p.ft),
				fta: num(p.fta),
			}),
		),
	})) as RecapGame["teams"],
});

// Recaps of a season's playoff series (play-ins left out), first round first
export const loadSeriesRecaps = async (season: number) => {
	const ps = await idb.merged.playoffSeries.get(season);
	if (!ps) {
		return [];
	}
	const games = await idb.merged.games.getAll(
		{ season },
		{ filter: (gm) => !!gm.playoffs },
	);
	const byGid = new Map(games.map((gm) => [gm.gid, gm]));
	const numRounds = ps.series.length;
	const byConf = await seasonCore.getPlayoffsByConf(season);
	const out: (SeriesRecap & { key: string })[] = [];
	ps.series.forEach((round, ri) => {
		const numToWin = helpers.numGamesToWinRound(ri, season);
		for (const m of round) {
			if (!m.away || (m.home.won === 0 && m.away.won === 0)) {
				continue;
			}
			const recapGames = (m.gids ?? [])
				.map((gid) => byGid.get(gid))
				.filter((gm): gm is Game => !!gm)
				.map(toRecapGame);
			const roundName = helpers.upperCaseFirstLetter(
				helpers.playoffRoundName(ri, numRounds, byConf),
			);
			const recap = seriesRecap(
				{
					season,
					round: ri,
					numRounds,
					roundName: roundName === "Finals" ? "Finals" : roundName,
					home: m.home,
					away: m.away,
					numToWin,
					seedsComparable: m.home.cid === m.away.cid || byConf === false,
					games: recapGames,
				},
				teamName,
			);
			const a = Math.min(m.home.tid, m.away.tid);
			const b = Math.max(m.home.tid, m.away.tid);
			out.push({ ...recap, key: `${a}-${b}` });
		}
	});
	return out;
};

const processInputs = (params: RouteParams<"seriesRecaps">) => {
	const season =
		params.season !== undefined && /^\d+$/.test(params.season)
			? Number(params.season)
			: g.get("season");
	const m = /^(\d+)-(\d+)$/.exec(params.pair ?? "");
	return {
		season,
		pair: m
			? `${Math.min(+m[1]!, +m[2]!)}-${Math.max(+m[1]!, +m[2]!)}`
			: undefined,
	};
};

export default defineView({
	id: "seriesRecaps",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("seriesRecaps");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("gameSim") &&
			!updateEvents.has("newPhase") &&
			inputs.season === prevInputs?.season &&
			inputs.pair === prevInputs?.pair
		) {
			return;
		}
		const recaps = await loadSeriesRecaps(inputs.season);
		const selected =
			(inputs.pair ? recaps.find((r) => r.key === inputs.pair) : undefined) ??
			recaps.findLast((r) => r.complete) ??
			recaps.at(-1);
		return {
			season: inputs.season,
			pair: inputs.pair,
			recaps: recaps.map((r) => ({
				key: r.key,
				round: r.round,
				roundName: r.roundName,
				headline: r.headline,
				complete: r.complete,
				winner: r.winner,
				loser: r.loser,
				upset: r.upset,
				comeback: r.comeback,
			})),
			selected,
		};
	},
});
