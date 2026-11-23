// "Download season data" (Daily Schedule, League → Schedule): one season's games in one file. Every stored game's summary, each team's
// box score totals game by game, and the standings after each day of the regular season. Shared by the worker (the game rows,
// worker/util/seasonExport/) and the UI (standings, CSV and zip, ui/components/SeasonDataPack.tsx). See
// docs/native-features.md#downloads.
import { getCols } from "./getCols.ts";
import { toCSV } from "./playerExport.ts";

export const SEASON_PACK_FORMAT = "zengm-season-pack";
// Bump when a field changes meaning or moves (adding a field is fine)
export const SEASON_PACK_SCHEMA_VERSION = 1;
// Games per worker request (the UI asks for the season in chunks, with a progress bar)
export const SEASON_PACK_CHUNK = 100;

export type SeasonPackTeam = {
	tid: number;
	abbrev: string;
	region: string;
	name: string;
	cid: number;
	did: number;
	conf: string;
	div: string;
};

export type SeasonGameType =
	| "regularSeason"
	| "playIn"
	| "playoffs"
	| "nit"
	| "allStar";

export type SeasonPackGame = {
	gid: number;
	season: number;
	// Day of the season (no calendar dates are stored)
	day: number | null;
	type: SeasonGameType;
	// Playoffs: round index (0 = first round, -1 = play-in), its name, and the game number in the series
	round: number | null;
	roundName: string | null;
	gameInSeries: number | null;
	homeTid: number;
	homeAbbrev: string;
	homePts: number;
	awayTid: number;
	awayAbbrev: string;
	awayPts: number;
	// Shootout goals/makes, when the game went to one
	homeShootout: number | null;
	awayShootout: number | null;
	winnerTid: number | null;
	tie: boolean;
	overtimes: number;
	numPeriods: number | null;
	att: number;
	neutralSite: boolean;
	rivalry: boolean;
	marquee: string | null;
};

export type SeasonPackTeamLog = {
	gid: number;
	day: number | null;
	type: SeasonGameType;
	tid: number;
	abbrev: string;
	oppTid: number;
	oppAbbrev: string;
	home: boolean;
	result: "W" | "L" | "T";
	pts: number;
	oppPts: number;
	overtimes: number;
	// Points by period, "28-31-25-30"
	ptsByPeriod: string;
	// The team's box score totals as stored (sport specific keys: fg, fga, tp, ... in basketball)
	stats: Record<string, number>;
};

export type SeasonPackStandingsRow = {
	day: number;
	tid: number;
	abbrev: string;
	cid: number;
	did: number;
	gp: number;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	winp: number;
	pts: number;
	oppPts: number;
	diff: number;
	gbConf: number;
	gbLeague: number;
	confRank: number;
	divRank: number;
	leagueRank: number;
	streak: string;
	lastTen: string;
};

// What the worker sends first: the league context, the teams and the stored games' ids
export type SeasonPackInfo = {
	format: typeof SEASON_PACK_FORMAT;
	schemaVersion: typeof SEASON_PACK_SCHEMA_VERSION;
	exportedAt: string;
	generator: string;
	league: {
		lid: number;
		name: string;
		sport: string;
		season: number;
		currentSeason: number;
		phase: number;
		phaseName: string;
		college: boolean;
		numGames: number;
		numPlayoffRounds: number;
		ties: boolean;
		otl: boolean;
	};
	teams: SeasonPackTeam[];
	gids: number[];
	notes: string[];
};

export type SeasonPackChunk = {
	games: SeasonPackGame[];
	teamLogs: SeasonPackTeamLog[];
};

export type SeasonPack = Omit<SeasonPackInfo, "gids"> & {
	counts: {
		games: number;
		regularSeason: number;
		playoffs: number;
		days: number;
	};
	dataDictionary: Record<string, Record<string, string>>;
	games: SeasonPackGame[];
	teamLogs: SeasonPackTeamLog[];
	standingsHistory: SeasonPackStandingsRow[];
};

const sortGames = <T extends { day: number | null; gid: number }>(xs: T[]) =>
	xs.sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.gid - b.gid);

const winpOf = (r: {
	won: number;
	lost: number;
	tied: number;
	otl: number;
}) => {
	const gp = r.won + r.lost + r.tied + r.otl;
	return gp > 0 ? (r.won + 0.5 * r.tied) / gp : 0;
};

const gamesBack = (
	leader: { won: number; lost: number },
	t: { won: number; lost: number },
) => (leader.won - t.won + (t.lost - leader.lost)) / 2;

// Standings after each day of the regular season, from the games: record, points, games back of the conference and league
// leader, and ranks by win% (ties by point differential, then wins; not the league's full tiebreakers, which need the whole
// season's head-to-head context the page computes)
export const buildStandingsHistory = (
	teams: SeasonPackTeam[],
	games: SeasonPackGame[],
	otlCounts = false,
): SeasonPackStandingsRow[] => {
	type Rec = {
		won: number;
		lost: number;
		tied: number;
		otl: number;
		pts: number;
		oppPts: number;
		results: ("W" | "L" | "T" | "OTL")[];
	};
	const recs = new Map<number, Rec>(
		teams.map((t) => [
			t.tid,
			{ won: 0, lost: 0, tied: 0, otl: 0, pts: 0, oppPts: 0, results: [] },
		]),
	);
	const regular = sortGames(
		games.filter((gm) => gm.type === "regularSeason" && gm.day !== null),
	);
	const out: SeasonPackStandingsRow[] = [];
	let i = 0;
	while (i < regular.length) {
		const day = regular[i]!.day!;
		for (; i < regular.length && regular[i]!.day === day; i++) {
			const gm = regular[i]!;
			for (const [tid, pts, oppPts] of [
				[gm.homeTid, gm.homePts, gm.awayPts],
				[gm.awayTid, gm.awayPts, gm.homePts],
			] as const) {
				const r = recs.get(tid);
				if (!r) {
					continue;
				}
				r.pts += pts;
				r.oppPts += oppPts;
				if (gm.tie || gm.winnerTid === null) {
					r.tied += 1;
					r.results.push("T");
				} else if (gm.winnerTid === tid) {
					r.won += 1;
					r.results.push("W");
				} else if (otlCounts && gm.overtimes > 0) {
					r.otl += 1;
					r.results.push("OTL");
				} else {
					r.lost += 1;
					r.results.push("L");
				}
			}
		}

		const rows = teams.map((t) => {
			const r = recs.get(t.tid)!;
			let streak = "";
			const last = r.results.at(-1);
			if (last) {
				let n = 0;
				for (let j = r.results.length - 1; j >= 0; j--) {
					if (r.results[j] !== last) {
						break;
					}
					n += 1;
				}
				streak = `${last === "OTL" ? "L" : last}${n}`;
			}
			const lt = r.results.slice(-10);
			const ltW = lt.filter((x) => x === "W").length;
			const ltL = lt.filter((x) => x === "L").length;
			const ltT = lt.filter((x) => x === "T").length;
			const ltO = lt.filter((x) => x === "OTL").length;
			return {
				day,
				tid: t.tid,
				abbrev: t.abbrev,
				cid: t.cid,
				did: t.did,
				gp: r.won + r.lost + r.tied + r.otl,
				won: r.won,
				lost: r.lost,
				tied: r.tied,
				otl: r.otl,
				winp: Math.round(winpOf(r) * 1000) / 1000,
				pts: r.pts,
				oppPts: r.oppPts,
				diff: r.pts - r.oppPts,
				gbConf: 0,
				gbLeague: 0,
				confRank: 0,
				divRank: 0,
				leagueRank: 0,
				streak,
				lastTen: [
					ltW,
					ltL,
					...(ltT > 0 ? [ltT] : []),
					...(ltO > 0 ? [ltO] : []),
				]
					.map(String)
					.join("-"),
			};
		});
		const order = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
			b.winp - a.winp || b.diff - a.diff || b.won - a.won || a.tid - b.tid;
		const rankBy = (
			key: "confRank" | "divRank" | "leagueRank",
			gbKey: "gbConf" | "gbLeague" | undefined,
			group: (row: (typeof rows)[number]) => number,
		) => {
			const groups = Map.groupBy(rows, group);
			for (const members of groups.values()) {
				members.sort(order);
				const leader = members[0]!;
				for (const [rank, row] of members.entries()) {
					row[key] = rank + 1;
					if (gbKey) {
						row[gbKey] = gamesBack(leader, row);
					}
				}
			}
		};
		rankBy("leagueRank", "gbLeague", () => 0);
		rankBy("confRank", "gbConf", (row) => row.cid);
		rankBy("divRank", undefined, (row) => row.did);
		rows.sort((a, b) => a.leagueRank - b.leagueRank);
		out.push(...rows);
	}
	return out;
};

// Column descriptions, written into the file (JSON) and as data_dictionary.csv
const GAME_DICT: Record<keyof SeasonPackGame, string> = {
	gid: "Game id (the box score's URL uses it)",
	season: "Season",
	day: "Day of the season the game was played (the game has no calendar dates)",
	type: "regularSeason, playIn, playoffs, nit (college NIT) or allStar",
	round:
		"Playoffs: round index, 0 = first round (-1 = play-in tournament); empty in the regular season",
	roundName: "Playoffs: the round's name",
	gameInSeries: "Playoffs: game number within the series (1 = game 1)",
	homeTid: "Home team id (first team in the box score)",
	homeAbbrev: "Home team abbreviation that season",
	homePts: "Home team points",
	awayTid: "Away team id",
	awayAbbrev: "Away team abbreviation that season",
	awayPts: "Away team points",
	homeShootout: "Home team shootout score, when the game went to a shootout",
	awayShootout: "Away team shootout score, when the game went to a shootout",
	winnerTid: "Winning team id (empty for a tie)",
	tie: "True if the game ended tied",
	overtimes: "Number of overtime periods",
	numPeriods: "Number of regulation periods",
	att: "Attendance",
	neutralSite: "Played at a neutral site",
	rivalry: "Scheduled as a rivalry game (Marquee Games)",
	marquee: "Marquee slate (holiday or national TV), when it had one",
};

const TEAM_LOG_DICT: Record<
	Exclude<keyof SeasonPackTeamLog, "stats">,
	string
> = {
	gid: "Game id",
	day: "Day of the season",
	type: "regularSeason, playIn, playoffs, nit or allStar",
	tid: "Team id",
	abbrev: "Team abbreviation that season",
	oppTid: "Opponent team id",
	oppAbbrev: "Opponent abbreviation that season",
	home: "True for the home team",
	result: "W, L or T",
	pts: "Points scored",
	oppPts: "Points allowed",
	overtimes: "Number of overtime periods",
	ptsByPeriod: "Points by period, separated by dashes",
};

const STANDINGS_DICT: Record<keyof SeasonPackStandingsRow, string> = {
	day: "Standings after the games of this day (regular season)",
	tid: "Team id",
	abbrev: "Team abbreviation that season",
	cid: "Conference id",
	did: "Division id",
	gp: "Games played",
	won: "Wins",
	lost: "Losses",
	tied: "Ties",
	otl: "Overtime losses (sports that count them)",
	winp: "Win% (a tie counts half)",
	pts: "Points scored so far",
	oppPts: "Points allowed so far",
	diff: "Point differential",
	gbConf: "Games behind the conference leader",
	gbLeague: "Games behind the league leader",
	confRank:
		"Rank in the conference by win%, then point differential (not the full tiebreakers)",
	divRank: "Rank in the division by the same order",
	leagueRank: "Rank in the league by the same order",
	streak: "Current streak (W3 = won 3 in a row)",
	lastTen: "Record in the last 10 games (W-L, then ties and OT losses if any)",
};

const TEAM_DICT: Record<keyof SeasonPackTeam, string> = {
	tid: "Team id",
	abbrev: "Abbreviation that season",
	region: "Region (city) that season",
	name: "Name that season",
	cid: "Conference id",
	did: "Division id",
	conf: "Conference name",
	div: "Division name",
};

// A team box score stat key → its column title and description from the stats tables ("fg" → "FG: Field Goals Made")
export const statDescription = (key: string) => {
	try {
		const col = getCols([`stat:${key}`])[0]!;
		return col.desc ? `${col.title}: ${col.desc}` : col.title;
	} catch {
		// Not a stats column
		return "Team box score total (as stored)";
	}
};

export const seasonPackDictionary = (statKeys: string[]) => ({
	teams: { ...TEAM_DICT },
	games: { ...GAME_DICT },
	teamLogs: {
		...TEAM_LOG_DICT,
		...Object.fromEntries(statKeys.map((key) => [key, statDescription(key)])),
	},
	standingsHistory: { ...STANDINGS_DICT },
});

// Stat keys in the order they first appear (the same in every game of a sport)
const statKeysOf = (logs: SeasonPackTeamLog[]) => {
	const keys = new Set<string>();
	for (const log of logs) {
		for (const key of Object.keys(log.stats)) {
			keys.add(key);
		}
	}
	return [...keys];
};

// The file from the info and the chunks: games sorted by day, the standings history and the data dictionary
export const buildSeasonPack = (
	info: SeasonPackInfo,
	chunks: SeasonPackChunk[],
): SeasonPack => {
	const { gids: _gids, ...rest } = info;
	const games = sortGames(chunks.flatMap((c) => c.games));
	const teamLogs = sortGames(chunks.flatMap((c) => c.teamLogs));
	const standingsHistory = buildStandingsHistory(
		info.teams,
		games,
		info.league.otl,
	);
	return {
		...rest,
		counts: {
			games: games.length,
			regularSeason: games.filter((gm) => gm.type === "regularSeason").length,
			playoffs: games.filter(
				(gm) => gm.type === "playoffs" || gm.type === "playIn",
			).length,
			days: new Set(standingsHistory.map((row) => row.day)).size,
		},
		dataDictionary: seasonPackDictionary(statKeysOf(teamLogs)),
		games,
		teamLogs,
		standingsHistory,
	};
};

const rowsOf = <T extends Record<string, unknown>>(
	items: T[],
	cols: string[],
) => [cols, ...items.map((item) => cols.map((col) => item[col] ?? ""))];

// The CSV files of the zip: teams, games, team game logs (stats as columns), standings history and the data dictionary
export const seasonPackCSVFiles = (pack: SeasonPack) => {
	const statKeys = statKeysOf(pack.teamLogs);
	const logCols = Object.keys(TEAM_LOG_DICT);
	const files: { name: string; text: string }[] = [
		{
			name: "teams.csv",
			text: toCSV(rowsOf(pack.teams, Object.keys(TEAM_DICT))),
		},
		{
			name: "games.csv",
			text: toCSV(rowsOf(pack.games, Object.keys(GAME_DICT))),
		},
		{
			name: "team_game_logs.csv",
			text: toCSV([
				[...logCols, ...statKeys],
				...pack.teamLogs.map((log) => [
					...logCols.map((col) => (log as any)[col] ?? ""),
					...statKeys.map((key) => log.stats[key] ?? ""),
				]),
			]),
		},
		{
			name: "standings_history.csv",
			text: toCSV(rowsOf(pack.standingsHistory, Object.keys(STANDINGS_DICT))),
		},
		{
			name: "data_dictionary.csv",
			text: toCSV([
				["file", "column", "description"],
				...Object.entries(pack.dataDictionary).flatMap(([file, cols]) =>
					Object.entries(cols).map(([col, desc]) => [file, col, desc]),
				),
			]),
		},
	];
	return files;
};

export const seasonPackToJSON = (pack: SeasonPack) => JSON.stringify(pack);
