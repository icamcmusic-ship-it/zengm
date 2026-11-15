// Advanced stats every 3 days setting (League extras > Game Simulation, see docs/native-features.md)
import { PHASE } from "../../common/constants.ts";
import { nativeFeatureEnabled } from "../../common/nativeFeatures.ts";
import g from "./g.ts";

// League id the stored advanced stats are known to be up to date for. undefined: maybe stale (a skipped day, or a
// league just loaded mid-season)
let freshLid: number | undefined;
let runCount = 0;

// For tests: how many times advanced stats were computed
export const advStatsRunCount = () => runCount;

// Set by util/advStats.ts (kept apart so that the readers that flush do not import the whole advanced stats code)
let compute: (() => Promise<void>) | undefined;
export const setAdvStatsCompute = (fn: () => Promise<void>) => {
	compute = fn;
};

const run = async () => {
	if (!compute) {
		throw new Error("advStats not loaded");
	}
	runCount += 1;
	await compute();
	freshLid = g.get("lid");
};
export const runAdvStats = run;

const inSeason = () => {
	const phase = g.get("phase");
	return (
		phase === PHASE.REGULAR_SEASON ||
		phase === PHASE.AFTER_TRADE_DEADLINE ||
		phase === PHASE.PLAYOFFS
	);
};

// Advanced stats every 3 days setting (League extras > Performance): pro leagues compute advanced stats (PER, WS, BPM,
// VORP, ...) after every third game day, not every day. Everything that reads them first calls flushAdvStats, which
// computes them now if a day was skipped. advStats recomputes everything from the season totals, so the values are the
// same as the daily computation whenever they are read.
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

// After a day of games. day: the schedule day just played. lastDay: nothing left to play in this phase (end of the
// regular season or of a playoffs round, which always computes)
export const advStatsAfterDay = async (
	day: number | undefined,
	lastDay: boolean,
) => {
	if (
		throttleOn() &&
		inSeason() &&
		!lastDay &&
		day !== undefined &&
		day % 3 !== 0
	) {
		freshLid = undefined;
		return;
	}
	await run();
};

// Before reading advanced stats (pages the user opens call it only when no sim is running: the sim keeps them
// within 2 days and computes them itself when it stops)
export const flushAdvStats = async () => {
	if (freshLid === g.get("lid") || !throttleOn() || !inSeason()) {
		return;
	}
	await run();
};
