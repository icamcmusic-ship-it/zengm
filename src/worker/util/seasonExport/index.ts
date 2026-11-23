// "Download season data": the worker side. The UI first asks for the season's info (league context, teams, the stored games' ids),
// then for the games in chunks of SEASON_PACK_CHUNK with a progress bar, so a whole season never blocks the worker for long. Only
// what the box scores and schedule pages show goes out: scores, attendance, team totals; never the team rating stored with a game
// (hidden under the no visible ratings challenge) or a God Mode forced result. See common/seasonExport.ts for the format.
import { PHASE, PHASE_TEXT } from "../../../common/constants.ts";
import { helpers as commonHelpers } from "../../../common/helpers.ts";
import {
	SEASON_PACK_FORMAT,
	SEASON_PACK_SCHEMA_VERSION,
	type SeasonGameType,
	type SeasonPackChunk,
	type SeasonPackGame,
	type SeasonPackInfo,
	type SeasonPackTeamLog,
} from "../../../common/seasonExport.ts";
import type { Game, PlayoffSeries } from "../../../common/types.ts";
import { isCollege } from "../../core/college/isCollege.ts";
import { league, season as seasonCore } from "../../core/index.ts";
import hasTies from "../../core/season/hasTies.ts";
import { idb } from "../../db/index.ts";
import { g } from "../index.ts";

// Fields of a stored game team that are not box score totals (or that the pages don't show: the team rating at game time)
const NOT_STATS = new Set([
	"tid",
	"players",
	"ovr",
	"won",
	"lost",
	"tied",
	"otl",
	"playoffs",
	"playerFeat",
	"pts",
	"sPts",
	"ptsQtrs",
]);

const gameType = (gm: Game): SeasonGameType =>
	gm.teams[0].tid < 0 || gm.teams[1].tid < 0
		? "allStar"
		: gm.nit
			? "nit"
			: gm.playoffs
				? "playoffs"
				: "regularSeason";

// gid → its playoff round and game number, from the series' game lists (older leagues without them: the round from the two teams)
type SeriesInfo = {
	byGid: Map<number, { round: number; game: number }>;
	byPair: Map<string, number>;
};
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const getSeriesInfo = (ps: PlayoffSeries | undefined): SeriesInfo => {
	const byGid = new Map<number, { round: number; game: number }>();
	const byPair = new Map<string, number>();
	if (!ps) {
		return { byGid, byPair };
	}
	for (const [round, matchups] of ps.series.entries()) {
		for (const m of matchups) {
			for (const [i, gid] of (m.gids ?? []).entries()) {
				byGid.set(gid, { round, game: i + 1 });
			}
			if (m.away) {
				byPair.set(pairKey(m.home.tid, m.away.tid), round);
			}
		}
	}
	for (const tournament of ps.playIns ?? []) {
		for (const m of tournament) {
			for (const [i, gid] of (m.gids ?? []).entries()) {
				byGid.set(gid, { round: -1, game: i + 1 });
			}
		}
	}
	return { byGid, byPair };
};

const roundName = (
	round: number,
	numRounds: number,
	byConf: number | false,
) => {
	const name = commonHelpers.playoffRoundName(round, numRounds, byConf);
	return `${name[0]!.toUpperCase()}${name.slice(1)}`;
};

// The season's stored games, by id (the current season's are all in the cache; older ones are read by id from the database)
const seasonGids = async (season: number) => {
	if (season === g.get("season")) {
		return (await idb.cache.games.getAll())
			.filter((gm) => gm.season === season)
			.map((gm) => gm.gid)
			.sort((a, b) => a - b);
	}
	const keys = (await idb.league
		.transaction("games")
		.store.index("season")
		.getAllKeys(season)) as number[];
	return [...keys].sort((a, b) => a - b);
};

export const getSeasonPackInfo = async ({
	season,
}: {
	season: number;
}): Promise<SeasonPackInfo> => {
	const teamSeasons = (await idb.merged.teamSeasons.getAll({ season })).sort(
		(a, b) => a.tid - b.tid,
	);
	const confs = g.get("confs", season);
	const divs = g.get("divs", season);
	const gids = await seasonGids(season);
	const phase = g.get("phase");
	const numGames = g.get("numGames", season);
	const numPlayoffRounds = g.get("numGamesPlayoffSeries", season).length;

	const notes: string[] = [];
	if (gids.length === 0) {
		notes.push(
			season > g.get("season")
				? "This season hasn't started."
				: "No box scores are stored for this season (League Settings: how many seasons of box scores to keep), so there are no games, game logs or standings history.",
		);
	} else if (season === g.get("season") && phase <= PHASE.PLAYOFFS) {
		notes.push("The season is still being played: games so far.");
	}
	notes.push(
		"Days are days of the season: games have no calendar dates. Standings ranks are by win% then point differential, not the league's full tiebreakers.",
	);

	return {
		format: SEASON_PACK_FORMAT,
		schemaVersion: SEASON_PACK_SCHEMA_VERSION,
		exportedAt: new Date().toISOString(),
		generator: `${__SPORT === "basketball" ? "Basketball" : __SPORT} GM`,
		league: {
			lid: g.get("lid"),
			name: (await league.getName()) || `League ${g.get("lid")}`,
			sport: __SPORT,
			season,
			currentSeason: g.get("season"),
			phase,
			phaseName: (PHASE_TEXT as Record<number, string>)[phase] ?? String(phase),
			college: isCollege(),
			numGames,
			numPlayoffRounds,
			ties: hasTies(season),
			otl: !!g.get("otl", season),
		},
		teams: teamSeasons.map((ts) => ({
			tid: ts.tid,
			abbrev: ts.abbrev ?? g.get("teamInfoCache")[ts.tid]?.abbrev ?? "",
			region: ts.region ?? g.get("teamInfoCache")[ts.tid]?.region ?? "",
			name: ts.name ?? g.get("teamInfoCache")[ts.tid]?.name ?? "",
			cid: ts.cid,
			did: ts.did,
			conf: confs.find((c) => c.cid === ts.cid)?.name ?? "",
			div: divs.find((d) => d.did === ts.did)?.name ?? "",
		})),
		gids,
		notes,
	};
};

// One chunk of games: their summaries and both teams' game logs
export const getSeasonPackGames = async ({
	season,
	gids,
}: {
	season: number;
	gids: number[];
}): Promise<SeasonPackChunk> => {
	const games = await idb.merged.games.getAll({ gids });
	const teamSeasons = await idb.merged.teamSeasons.getAll({ season });
	const abbrevs = new Map(teamSeasons.map((ts) => [ts.tid, ts.abbrev]));
	const abbrev = (tid: number) =>
		tid < 0
			? "ASG"
			: (abbrevs.get(tid) ?? g.get("teamInfoCache")[tid]?.abbrev ?? "");
	const series = getSeriesInfo(await idb.merged.playoffSeries.get(season));
	const numRounds = g.get("numGamesPlayoffSeries", season).length;
	const byConf = await seasonCore.getPlayoffsByConf(season);

	const out: SeasonPackChunk = { games: [], teamLogs: [] };
	for (const gm of games) {
		if (gm.season !== season) {
			continue;
		}
		let type = gameType(gm);
		const [home, away] = gm.teams;
		let round: number | null = null;
		let gameInSeries: number | null = null;
		if (type === "playoffs") {
			const info = series.byGid.get(gm.gid);
			if (info) {
				round = info.round;
				gameInSeries = info.game;
			} else {
				round = series.byPair.get(pairKey(home.tid, away.tid)) ?? null;
			}
			if (round === -1) {
				type = "playIn";
			}
		}
		const tie = gm.won.pts === gm.lost.pts && gm.won.sPts === gm.lost.sPts;
		const overtimes = gm.overtimes ?? 0;
		out.games.push({
			gid: gm.gid,
			season: gm.season,
			day: gm.day ?? null,
			type,
			round,
			roundName: round !== null ? roundName(round, numRounds, byConf) : null,
			gameInSeries,
			homeTid: home.tid,
			homeAbbrev: abbrev(home.tid),
			homePts: home.pts,
			awayTid: away.tid,
			awayAbbrev: abbrev(away.tid),
			awayPts: away.pts,
			homeShootout: home.sPts ?? null,
			awayShootout: away.sPts ?? null,
			winnerTid: tie ? null : gm.won.tid,
			tie,
			overtimes,
			numPeriods: gm.numPeriods ?? null,
			att: gm.att ?? 0,
			neutralSite: !!gm.neutralSite,
			rivalry: !!gm.rivalry,
			marquee: gm.marquee ?? null,
		} satisfies SeasonPackGame);

		for (const [i, t] of gm.teams.entries()) {
			const opp = gm.teams[i === 0 ? 1 : 0];
			const stats: Record<string, number> = {};
			for (const [key, value] of Object.entries(t)) {
				if (
					!NOT_STATS.has(key) &&
					typeof value === "number" &&
					Number.isFinite(value)
				) {
					stats[key] = value;
				}
			}
			out.teamLogs.push({
				gid: gm.gid,
				day: gm.day ?? null,
				type,
				tid: t.tid,
				abbrev: abbrev(t.tid),
				oppTid: opp.tid,
				oppAbbrev: abbrev(opp.tid),
				home: i === 0,
				result: tie ? "T" : gm.won.tid === t.tid ? "W" : "L",
				pts: t.pts,
				oppPts: opp.pts,
				overtimes,
				ptsByPeriod: Array.isArray(t.ptsQtrs) ? t.ptsQtrs.join("-") : "",
				stats,
			} satisfies SeasonPackTeamLog);
		}
	}
	return out;
};
