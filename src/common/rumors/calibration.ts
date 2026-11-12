import type { Rumor, RumorType } from "./types.ts";

// Recalibration of the rumor mill's raw scores. Each gatherer in worker/core/rumors scores a rumor from the rules the AI uses (a
// deadline window, a per-day signing chance, a firing probability, ...), and those scores aren't probabilities: the audit
// (src/test/ratingInflation/rumors.script.test.ts) found strong rumors claiming 70% coming true 59% of the time. So each score goes
// through a monotone table fitted on the audit's outcomes (isotonic regression, pool adjacent violators), per type or per type and kind
// where a kind has enough rumors of its own. The league's own track record (logic.ts calibrationFactor) then only corrects what is
// particular to a league. Refit with RUMOR_FIT=1 (see the audit script) and paste the table here.

// Knots [raw score, chance it comes true], raw ascending. Linear between knots, flat beyond the ends
export type CalibrationCurve = [number, number][];

// Keys: "type" or "type/kind"
export type CalibrationTable = Record<string, CalibrationCurve>;

// Fitted on 48 leagues x 6 seasons (~23,000 resolved rumors; GM hot seat only from the 32 leagues after fair GM job security)
export const RUMOR_CALIBRATION: CalibrationTable = {
	coach: [
		[0.17, 0.18],
		[0.258, 0.272],
		[0.331, 0.301],
		[0.356, 0.391],
		[0.367, 0.494],
		[0.375, 0.525],
		[0.487, 0.577],
		[0.608, 0.591],
		[0.632, 0.65],
	],
	draft: [
		[0.33, 0.279],
		[0.5, 0.396],
		[0.53, 0.699],
	],
	extension: [
		[0.107, 0.006],
		[0.191, 0.052],
		[0.245, 0.065],
		[0.329, 0.128],
		[0.412, 0.16],
		[0.487, 0.239],
		[0.538, 0.301],
		[0.633, 0.334],
		[0.695, 0.448],
		[0.767, 0.511],
		[0.822, 0.652],
		[0.831, 0.699],
		[0.841, 0.746],
	],
	"extension/blocked": [[0.08, 0.228]],
	"freeAgent/finalists": [
		[0.087, 0.07],
		[0.125, 0.167],
		[0.166, 0.197],
		[0.203, 0.265],
		[0.231, 0.273],
		[0.257, 0.343],
		[0.334, 0.416],
		[0.446, 0.429],
		[0.599, 0.517],
	],
	"freeAgent/leaning": [
		[0.056, 0.049],
		[0.093, 0.115],
		[0.11, 0.124],
		[0.139, 0.154],
		[0.166, 0.165],
		[0.208, 0.197],
		[0.294, 0.215],
		[0.499, 0.25],
	],
	gm: [
		[0.172, 0.079],
		[0.206, 0.185],
		[0.25, 0.226],
		[0.335, 0.306],
		[0.404, 0.486],
		[0.456, 0.514],
		[0.537, 0.651],
		[0.661, 0.783],
	],
	"interest/request": [[0.06, 0.022]],
	"interest/vet": [[0.028, 0.006]],
	pick: [[0.05, 0.063]],
	shopping: [[0.05, 0.04]],
	"shopping/deadline": [[0.12, 0.011]],
	"shopping/dump": [[0.08, 0.151]],
	"shopping/rebuild": [[0.07, 0.195]],
	"shopping/request": [[0.7, 0.402]],
	unhappy: [
		[0.1, 0.133],
		[0.2, 0.339],
		[0.5, 0.582],
	],
	"unhappy/holdout": [[0.2, 0.22]],
};

export const calibrationKey = (
	type: RumorType,
	kind: string | undefined,
	table: CalibrationTable = RUMOR_CALIBRATION,
) => {
	if (kind !== undefined && table[`${type}/${kind}`]) {
		return `${type}/${kind}`;
	}
	return table[type] ? type : undefined;
};

export const interpolate = (curve: CalibrationCurve, x: number) => {
	const first = curve[0];
	if (!first) {
		return x;
	}
	if (x <= first[0]) {
		return first[1];
	}
	for (let i = 1; i < curve.length; i++) {
		const [x1, y1] = curve[i]!;
		if (x <= x1) {
			const [x0, y0] = curve[i - 1]!;
			return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
		}
	}
	return curve.at(-1)![1];
};

// The chance a rumor comes true from its raw score. A type or kind not in the table keeps its raw score
export const recalibrate = (
	type: RumorType,
	kind: string | undefined,
	raw: number,
	table: CalibrationTable = RUMOR_CALIBRATION,
) => {
	const key = calibrationKey(type, kind, table);
	return key === undefined ? raw : interpolate(table[key]!, raw);
};

/**
 * Isotonic regression (pool adjacent violators) of outcomes on scores: blocks of nearby scores whose rates go up with the score. Each
 * block becomes a knot at its mean score. Blocks smaller than minBlock are merged with a neighbor, so a knot is never a handful of rumors.
 * prior: pseudo-rumors at the raw score itself added to each block, which pulls tiny blocks towards the score
 */
export const fitIsotonic = (
	points: { x: number; y: number }[],
	minBlock = 1,
	prior = 0,
): CalibrationCurve => {
	type Block = { sx: number; sy: number; n: number };
	const sorted = points.toSorted((a, b) => a.x - b.x);
	// Equal scores always share a block
	const blocks: Block[] = [];
	let lastX: number | undefined;
	for (const p of sorted) {
		const last = blocks.at(-1);
		if (last && lastX === p.x) {
			last.sx += p.x;
			last.sy += p.y;
			last.n += 1;
		} else {
			blocks.push({ sx: p.x, sy: p.y, n: 1 });
		}
		lastX = p.x;
	}
	const rate = (b: Block) => (b.sy + prior * (b.sx / b.n)) / (b.n + prior);
	const merge = (a: Block, b: Block): Block => ({
		sx: a.sx + b.sx,
		sy: a.sy + b.sy,
		n: a.n + b.n,
	});
	const pav = (input: Block[]) => {
		const out: Block[] = [];
		for (const b of input) {
			out.push(b);
			while (out.length > 1 && rate(out.at(-2)!) >= rate(out.at(-1)!)) {
				const top = out.pop()!;
				out.push(merge(out.pop()!, top));
			}
		}
		return out;
	};
	let out = pav(blocks);
	// Small blocks join the neighbor with the closer rate, then monotonicity is restored
	while (out.length > 1) {
		const i = out.findIndex((b) => b.n < minBlock);
		if (i < 0) {
			break;
		}
		const j =
			i === 0
				? 1
				: i === out.length - 1
					? i - 1
					: Math.abs(rate(out[i - 1]!) - rate(out[i]!)) <=
						  Math.abs(rate(out[i + 1]!) - rate(out[i]!))
						? i - 1
						: i + 1;
		const lo = Math.min(i, j);
		out.splice(lo, 2, merge(out[lo]!, out[lo + 1]!));
		out = pav(out);
	}
	const curve: CalibrationCurve = [];
	for (const b of out) {
		const knot: [number, number] = [
			Math.round((b.sx / b.n) * 1000) / 1000,
			Math.round(rate(b) * 1000) / 1000,
		];
		// Knots that round to the same score keep the higher one
		if (curve.length > 0 && curve.at(-1)![0] === knot[0]) {
			curve[curve.length - 1] = knot;
		} else {
			curve.push(knot);
		}
	}
	return curve;
};

// Fit a table from resolved rumors with their raw scores: a curve per type, and one per kind with at least minKind rumors
export const fitCalibration = (
	rumors: Pick<Rumor, "type" | "kind" | "raw" | "status">[],
	{
		minBlock = 40,
		minKind = 150,
		prior = 4,
	}: { minBlock?: number; minKind?: number; prior?: number } = {},
) => {
	const resolved = rumors.filter(
		(r) => r.status !== "open" && r.raw !== undefined,
	);
	const kindCounts = new Map<string, number>();
	for (const r of resolved) {
		if (r.kind !== undefined) {
			const key = `${r.type}/${r.kind}`;
			kindCounts.set(key, (kindCounts.get(key) ?? 0) + 1);
		}
	}
	// A kind with enough rumors gets its own curve, the rest of the type shares one
	const groups = new Map<string, { x: number; y: number }[]>();
	for (const r of resolved) {
		const kindKey = r.kind === undefined ? undefined : `${r.type}/${r.kind}`;
		const key =
			kindKey !== undefined && (kindCounts.get(kindKey) ?? 0) >= minKind
				? kindKey
				: r.type;
		const point = { x: r.raw!, y: r.status === "confirmed" ? 1 : 0 };
		const list = groups.get(key);
		if (list) {
			list.push(point);
		} else {
			groups.set(key, [point]);
		}
	}
	const table: CalibrationTable = {};
	for (const [key, points] of [...groups.entries()].sort((a, b) =>
		a[0].localeCompare(b[0]),
	)) {
		table[key] = fitIsotonic(points, minBlock, prior);
	}
	return table;
};
