// Game flow (Game Sim Fixes, see docs/native-features.md, Game flow): contest levels of shots, help-defense rotations, runs, momentum and
// timeouts, coaching adjustments at the breaks, fatigue that hits defense first, minutes by the score, and garbage time. Pure helpers and
// the calibration counters; GameSim.basketball/index.ts calls them only with Game Sim Fixes on (constants in simSettings.ts).
import { SIM_FIX_CONTEST } from "./simSettings.ts";

// Contest levels, in storage order (Advanced Tracking Stats, common/advStats.ts CONTEST_LEVELS)
export const CONTEST_OPEN = 0;
export const CONTEST_CONTESTED = 1;
export const CONTEST_HEAVY = 2;

// Shot types with a contest level, in SIM_FIX_CONTEST's order (-1: none, a putback or a tip-in)
export const contestTypeIndex = (type: string) =>
	type === "threePointer"
		? 0
		: type === "midRange"
			? 1
			: type === "atRim"
				? 2
				: type === "lowPost"
					? 3
					: -1;

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

// Per shot type: the base log-odds of open and heavy, and the make changes and block multipliers centered on the base shares (so a
// league of average contests shoots what it did before)
const tables = () => {
	const C = SIM_FIX_CONTEST;
	return C.base.map(([open, heavy], ti) => {
		const shares = [open!, 1 - open! - heavy!, heavy!];
		const make = C.make[ti]!;
		let meanMake = 0;
		let meanBlk = 0;
		for (let l = 0; l < 3; l++) {
			meanMake += shares[l]! * make[l]!;
			meanBlk += shares[l]! * C.blk[l]!;
		}
		return {
			openLogit: logit(open!),
			heavyLogit: logit(heavy!),
			make: make.map((x) => x - meanMake),
			blk: C.blk.map((x) => x / meanBlk),
		};
	});
};
let cache: ReturnType<typeof tables> | undefined;
let cacheKey: unknown;
// (recomputed if a calibration script swaps the constants)
export const contestTables = () => {
	if (!cache || cacheKey !== SIM_FIX_CONTEST.make) {
		cache = tables();
		cacheKey = SIM_FIX_CONTEST.make;
	}
	return cache;
};

// The level of a shot from its score z and a uniform random number u
export const contestLevel = (ti: number, z: number, u: number) => {
	const tb = contestTables()[ti]!;
	const k = SIM_FIX_CONTEST.k;
	let open = sigmoid(tb.openLogit - k * z);
	let heavy = sigmoid(tb.heavyLogit + k * z);
	const sum = open + heavy;
	if (sum > 0.95) {
		open *= 0.95 / sum;
		heavy *= 0.95 / sum;
	}
	return u < open
		? CONTEST_OPEN
		: u >= 1 - heavy
			? CONTEST_HEAVY
			: CONTEST_CONTESTED;
};

// Calibration counters (gameFlow script, threeGradient.script.test.ts): only counted while on
export const FLOW_DIAG = {
	on: false,
	// contest: by shot type × level, attempts, makes; the sum of z by shot type and its count; the sum of the make changes by type
	ctN: [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	],
	ctMake: [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	],
	zSum: [0, 0, 0, 0],
	zN: [0, 0, 0, 0],
	deltaSum: [0, 0, 0, 0],
	counts: {} as Record<string, number>,
	sums: {} as Record<string, number>,
};
export const flowCount = (key: string, amt = 1) => {
	FLOW_DIAG.counts[key] = (FLOW_DIAG.counts[key] ?? 0) + amt;
};
export const flowSum = (key: string, x: number) => {
	FLOW_DIAG.sums[key] = (FLOW_DIAG.sums[key] ?? 0) + x;
	FLOW_DIAG.counts[`n:${key}`] = (FLOW_DIAG.counts[`n:${key}`] ?? 0) + 1;
};
export const resetFlowDiag = () => {
	for (const arr of [FLOW_DIAG.ctN, FLOW_DIAG.ctMake]) {
		for (const row of arr) {
			row.fill(0);
		}
	}
	FLOW_DIAG.zSum.fill(0);
	FLOW_DIAG.zN.fill(0);
	FLOW_DIAG.deltaSum.fill(0);
	FLOW_DIAG.counts = {};
	FLOW_DIAG.sums = {};
};
