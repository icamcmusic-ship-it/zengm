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

// Tail fractions of the line tables: CAL.tail[k][i] is the value that a fraction TAIL[i] of all player lines (players who played) reach
export const TAIL = [1e-1, 3e-2, 1e-2, 3e-3, 1e-3, 3e-4, 1e-4, 3e-5];

// Rarity of a line: -log10 of the share of lines at least this good (2 = top 1%, 4 = one in 10,000). The value is first scaled to the calibration's scoring environment (era-aware: 12 assists in a slow, low-assist league count like 13.5 in the calibration's). Past the table's end, extrapolated along its last step.
export const rarity = (k: LineStat, v: number, scale = 1): number => {
	const t = CAL.tail[k];
	if (!t || !Number.isFinite(v) || v <= 0) {
		return 0;
	}
	const x = v * (Number.isFinite(scale) && scale > 0 ? scale : 1);
	const lg = TAIL.map((f) => -Math.log10(f));
	if (x < t[0]!) {
		return t[0]! > 0 ? Math.max(0, lg[0]! * (x / t[0]!)) : 0;
	}
	for (let i = 1; i < t.length; i++) {
		if (x < t[i]!) {
			const f = (x - t[i - 1]!) / Math.max(1e-9, t[i]! - t[i - 1]!);
			return lg[i - 1]! + f * (lg[i]! - lg[i - 1]!);
		}
	}
	const n = t.length;
	const step = Math.max(0.5, t[n - 1]! - t[n - 2]!);
	return Math.min(
		9,
		lg[n - 1]! + ((x - t[n - 1]!) / step) * (lg[n - 1]! - lg[n - 2]!),
	);
};

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
