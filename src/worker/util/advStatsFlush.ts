// Advanced stats every 3 days setting (League extras > Game Simulation, docs/native-features.md "Performance"): pro
// leagues compute the full advanced stats (PER, WS, BPM, VORP, ratings, percentages, on/off) after every third game day
// of the regular season and the playoffs instead of after every day. Everything that reads them first calls
// flushAdvStats, which computes them now if a day was skipped. They are computed from the season totals, so whenever
// they are read the values are the same as with the every-day computation.
//
// The one exception is PER (and EWA, from the same pass): player value reads PER after every game, so the regular
// season days in between still compute those two (cheap), and the league plays out exactly as with every-day
// computation. In the playoffs nothing reads them in between (player value uses regular season stats).
import { PHASE } from "../../common/constants.ts";
import { nativeFeatureEnabled } from "../../common/nativeFeatures.ts";
import g from "./g.ts";

// League id the stored advanced stats are known to be up to date for. undefined: maybe stale (a skipped day, or a
// league just loaded mid-season)
let freshLid: number | undefined;
let runCount = 0;

// For tests: how many times the full advanced stats were computed
export const advStatsRunCount = () => runCount;

// Set by util/advStats.ts (kept apart so that the readers that flush do not import the whole advanced stats code)
let compute: ((perOnly?: boolean) => Promise<void>) | undefined;
export const setAdvStatsCompute = (
	fn: (perOnly?: boolean) => Promise<void>,
) => {
	compute = fn;
};

const getCompute = () => {
	if (!compute) {
		throw new Error("advStats not loaded");
	}
	return compute;
};

export const runAdvStats = async () => {
	runCount += 1;
	await getCompute()();
	freshLid = g.get("lid");
};

const inSeason = () => {
	const phase = g.get("phase");
	return (
		phase === PHASE.REGULAR_SEASON ||
		phase === PHASE.AFTER_TRADE_DEADLINE ||
		phase === PHASE.PLAYOFFS
	);
};

const throttleOn = () => {
	if (!nativeFeatureEnabled("advStatsEvery3Days", (key) => g.get(key as any))) {
		return false;
	}
	try {
		return g.get("leagueType") !== "college";
	} catch {
		return true;
	}
};

// After a day of games. day: the schedule day just played. computeAnyway: the last day of the regular season or of a sim
export const advStatsAfterDay = async (
	day: number | undefined,
	computeAnyway: boolean,
) => {
	if (
		throttleOn() &&
		inSeason() &&
		!computeAnyway &&
		day !== undefined &&
		day % 3 !== 0
	) {
		freshLid = undefined;
		if (g.get("phase") !== PHASE.PLAYOFFS) {
			await getCompute()(true);
		}
		return;
	}
	await runAdvStats();
};

// Before reading advanced stats (pages the user opens call it only when no sim is running: the sim keeps them within 2
// days and computes them itself when it stops)
export const flushAdvStats = async () => {
	if (freshLid === g.get("lid") || !throttleOn() || !inSeason()) {
		return;
	}
	await runAdvStats();
};
