// Turning the engine's raw points into a 0-100 score, and judging how rare a single-game line is. The tables come from simulated leagues (calibration.generated.ts, made by tools/hypeCalibration), so a score means the same thing whatever the weights add up to: about half of all games score under 50, one in twenty 85 or more, one in twenty 20 or less.
import { CAL } from "./calibration.generated.ts";

// Percentiles of the calibration games and the score each one maps to
export const PCT = [0, 1, 5, 10, 25, 50, 75, 90, 95, 98, 99.5, 99.9, 100];
const SCORE = [0, 3, 15, 22, 36, 50, 64, 77, 86, 91, 96, 99, 100];

// Piecewise linear: raw points at those percentiles (knots) to the score. Below the lowest knot 0, above the highest 100.
export const rawToScore = (raw: number, knots: readonly number[]): number => {
	if (!Number.isFinite(raw) || knots.length !== PCT.length) {
		return 0;
	}
	if (raw <= knots[0]!) {
		return 0;
	}
	for (let i = 1; i < knots.length; i++) {
		const hi = knots[i]!;
		if (raw <= hi) {
			const lo = knots[i - 1]!;
			const f = hi > lo ? (raw - lo) / (hi - lo) : 1;
			return Math.round(SCORE[i - 1]! + f * (SCORE[i]! - SCORE[i - 1]!));
		}
	}
	return 100;
};

// Soft cap for regular-season games: scores up to SOFT_CAP are unchanged, above it they flatten out and can reach
// only about 90, so the very top of the scale is left for the playoffs.
const SOFT_CAP = 80;
const SOFT_ROOM = 12;
export const regularSeasonCap = (score: number) =>
	score <= SOFT_CAP
		? score
		: Math.round(
				SOFT_CAP + SOFT_ROOM * (1 - Math.exp(-(score - SOFT_CAP) / SOFT_ROOM)),
			);

export const preScore = (raw: number) => rawToScore(raw, CAL.pre);
export const postScore = (raw: number) => rawToScore(raw, CAL.post);

export const LINE_STATS = [
	"pts",
	"trb",
	"ast",
	"stl",
	"blk",
	"tp",
	"gmsc",
] as const;
export type LineStat = (typeof LINE_STATS)[number];

// Survival tables (calibration.generated.ts): CAL.surv[k][v] is -log10 of the share of player lines (players who played, regular season) with stat k at least v, for v = 0, 1, 2, ... (game score rounded down, negative as 0), up to the last value at least 10 lines of the calibration leagues reached; CAL.slope[k] is the rarity per unit past that end (fitted on the thin tail). Exact for the small counts (5 steals is the share of lines with 5 or more, not a quantile that ties with 4).
const survAt = (t: readonly number[], slope: number, x: number) => {
	if (!t.length || !(x > 0)) {
		return 0;
	}
	const n = t.length;
	if (x >= n - 1) {
		return Math.min(9, t[n - 1]! + slope * (x - (n - 1)));
	}
	const i = Math.floor(x);
	return t[i]! + (x - i) * (t[i + 1]! - t[i]!);
};

// Rarity of a single stat in a line: -log10 of the share of lines at least this good (2 = top 1%, 4 = one in 10,000). The value is first scaled to the calibration's scoring environment (era-aware: 12 assists in a slow, low-assist league count like 13.5 in the calibration's).
export const rarity = (k: LineStat, v: number, scale = 1): number => {
	const t = CAL.surv[k];
	if (!t || !Number.isFinite(v)) {
		return 0;
	}
	return survAt(
		t,
		CAL.slope[k] ?? 0.5,
		v * (Number.isFinite(scale) && scale > 0 ? scale : 1),
	);
};

// Step of the combined line index table
export const LINE_STEP = 0.1;

// Rarity of a whole line from its combined index (lineIndex in post.ts, already in rarity units): CAL.line[i] is -log10 of the share of lines whose index is at least i * LINE_STEP. Past the table's end one more unit of index is one more order of magnitude.
export const lineRarity = (c: number): number =>
	survAt(CAL.line, LINE_STEP, c / LINE_STEP);

// How many lines a game has, as log10 (a line that one in 10^r lines reaches shows up about once in 10^(r - perGame) games)
export const linesPerGame = () => CAL.perGame;

// "a 1-in-2,000 line" for rarity >= 3, "top 1%" style below
export const rarityText = (r: number) => {
	if (r >= 3) {
		const n = 10 ** r;
		const round =
			n >= 1e5
				? Math.round(n / 1e4) * 1e4
				: n >= 1e4
					? Math.round(n / 1e3) * 1e3
					: Math.round(n / 100) * 100;
		return `1 in ${round.toLocaleString("en-US")}`;
	}
	const pct = 100 * 10 ** -r;
	return `top ${pct >= 1 ? Math.round(pct) : pct.toFixed(1)}%`;
};

// Average per player line, by stat, in the calibration leagues (to scale other scoring environments)
export const calMean = (k: LineStat) => CAL.mean[k] ?? 0;
