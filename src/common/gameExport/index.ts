// Per-game download (Game Log, "Download game data"): the format's version, what the sim records for it at game time, the data
// dictionary and the CSV files. The file is built by worker/util/gameExport; the UI adds the play-by-play text and saves it.

export {
	analyzePlayByPlay,
	winProbability,
	type PbpAnalysis,
} from "./pbpAnalysis.ts";
export { boxAnalytics } from "./boxAnalytics.ts";
export { GAME_DATA_DICTIONARY } from "./dictionary.ts";
export { gameExportCsvFiles } from "./csv.ts";

export const GAME_EXPORT_FORMAT = "zengm-game";
// 1: box score and play-by-play. 2: pregame, teamContext, playerContext, analytics, unavailable, dataDictionary
export const GAME_EXPORT_SCHEMA_VERSION = 2;

export { gameCtxOf, type GameCtx } from "./gameCtx.ts";

const num = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : 0;

// John Hollinger's game score
export const gameScore = (p: Record<string, unknown>) =>
	num(p.pts) +
	0.4 * num(p.fg) -
	0.7 * num(p.fga) -
	0.4 * (num(p.fta) - num(p.ft)) +
	0.7 * num(p.orb) +
	0.3 * num(p.drb) +
	num(p.stl) +
	0.7 * num(p.ast) +
	0.7 * num(p.blk) -
	0.4 * num(p.pf) -
	num(p.tov);
