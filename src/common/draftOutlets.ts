// Big boards from media outlets (basketball): a handful of made-up draft outlets publish their own big board of a draft class, each
// with its own lean (consensus, upside, production from the pre-draft stats, athleticism), updated in editions during the season.
// Pure: every board is a function of the class's inputs, the edition and seeded streams (league seed, draft year, outlet, prospect),
// so it is the same on every load and never draws from the game's random numbers. The worker stores each outlet's final board on the
// prospects when the draft starts, to score the outlets against the actual draft and, three seasons later, against how the class
// turned out.
import { Rng } from "./collegeStats/rng.ts";

export type OutletLean = "consensus" | "upside" | "production" | "athletic";

export type Outlet = {
	id: number;
	name: string;
	short: string;
	lean: OutletLean;
	// Multiplies the outlet's own noise (a hot-take aggregator is noisier than a careful one)
	noise: number;
	// How much its lean moves a prospect, in class standard deviations per standard deviation of the lean signal
	leanWeight: number;
	description: string;
};

export const OUTLETS: readonly Outlet[] = [
	{
		id: 0,
		name: "The Hoop Ledger",
		short: "Ledger",
		lean: "consensus",
		noise: 0.8,
		leanWeight: 0,
		description:
			"Talks to every front office and sits close to the consensus. Rarely surprising, rarely far off.",
	},
	{
		id: 1,
		name: "Ceiling Report",
		short: "Ceiling",
		lean: "upside",
		noise: 1.1,
		leanWeight: 0.45,
		description:
			"Swings for upside: young prospects with tools and room to grow move up, polished older ones move down.",
	},
	{
		id: 2,
		name: "Box Score Bureau",
		short: "BSB",
		lean: "production",
		noise: 1.1,
		leanWeight: 0.5,
		description:
			"Trusts the numbers: pre-draft production per minute, efficiency, competition level and age. Prospects without stats are a mystery to them.",
	},
	{
		id: 3,
		name: "The Vertical Lab",
		short: "VLab",
		lean: "athletic",
		noise: 1.1,
		leanWeight: 0.45,
		description:
			"Loves athletes: the tape before the combine, the stopwatch and the vertical after it.",
	},
	{
		id: 4,
		name: "Draft Wire Daily",
		short: "Wire",
		lean: "consensus",
		noise: 1.5,
		leanWeight: 0,
		description:
			"Aggregates rumors and hot takes. Close to the consensus on average, noisy from week to week.",
	},
];

export const LEAN_NAMES: Record<OutletLean, string> = {
	consensus: "Consensus",
	upside: "Upside",
	production: "Production",
	athletic: "Athleticism",
};

// ---- Editions ----
// The boards are updated during the season; each edition re-reads the class with less noise.

export type Edition = { index: number; label: string };

export const EDITION_LABELS = [
	"Preseason",
	"Early season",
	"Midseason",
	"Late season",
	"After the tournament",
	"Post-combine",
	"Final",
] as const;
export const FINAL_EDITION = EDITION_LABELS.length - 1;
// A class more than one draft away
export const WAY_TOO_EARLY = -1;

/**
 * The edition of a class's boards. stage: "future" (a later class), "preseason", "regularSeason" (with the share of the user's team's
 * regular season played), "playoffs", "lottery" (after the combine) or "draft" (the draft has started, or it is over).
 */
export const editionOf = (
	stage:
		| "future"
		| "preseason"
		| "regularSeason"
		| "playoffs"
		| "lottery"
		| "draft",
	seasonFraction = 0,
): Edition => {
	if (stage === "future") {
		return { index: WAY_TOO_EARLY, label: "Way-too-early" };
	}
	let index: number;
	if (stage === "preseason") {
		index = 0;
	} else if (stage === "regularSeason") {
		index = seasonFraction < 0.3 ? 1 : seasonFraction < 0.65 ? 2 : 3;
	} else if (stage === "playoffs") {
		index = 4;
	} else if (stage === "lottery") {
		index = 5;
	} else {
		index = FINAL_EDITION;
	}
	return { index, label: EDITION_LABELS[index]! };
};

// Noise left at each edition (way-too-early first)
const NOISE_BY_EDITION = [1.3, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.45];
const noiseScale = (edition: number) =>
	NOISE_BY_EDITION[
		Math.max(0, Math.min(NOISE_BY_EDITION.length - 1, edition + 1))
	]!;

// ---- Boards ----

export type OutletProspect = {
	pid: number;
	// The value the league drafts by (the same read the Mock Draft uses)
	value: number;
	age: number;
	// Upside signal: room between what he is and could be, plus youth (any scale; standardized over the class)
	upside: number;
	// Production signal from his pre-draft stats (any scale), undefined without stats
	production?: number;
	// Athletic signal (0-100): his combine athletic score once tested, else a read of the tape
	athletic: number;
	// Off the radar (collegeStats/radar.ts): lowly recruited (or never recruited), little production and nothing in his story to explain
	// why he would be a prospect. The media can't vouch for him
	offRadar?: boolean;
};

const standardize = (xs: (number | undefined)[]) => {
	const vals = xs.filter((x): x is number => x !== undefined);
	const n = vals.length;
	if (n === 0) {
		return xs.map(() => undefined);
	}
	const mean = vals.reduce((a, b) => a + b, 0) / n;
	const sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n) || 1;
	return xs.map((x) => (x === undefined ? undefined : (x - mean) / sd));
};

// A unit normal for a key that moves a bit with each edition: part fixed for the class, part redrawn each edition
const drifting = (key: string, edition: number) => {
	const fixed = new Rng(`${key}|fixed`).normal(0, 1);
	const step = new Rng(`${key}|e${edition}`).normal(0, 1);
	return 0.75 * fixed + 0.66 * step;
};

// Shared public perception error (sd in class standard deviations): what every outlet hears, so averaging the outlets doesn't recover
// the truth; and each outlet's own error
const PUBLIC_SD = 0.32;
// How far every outlet drops a prospect who is off the radar, in class standard deviations
export const OFF_RADAR_PENALTY = 0.35;
const OUTLET_SD = 0.3;
// Public perception: a read of each prospect the media shares for the whole class (seeded per class and prospect, the same in every
// edition, so it doesn't shrink as the season goes on). With it the final consensus misses by about 0.3 class standard deviations,
// about as much as a team's own scouts at the default scouting budget (fuzz sd about 2 ovr), so the free public board isn't better
// information than paid scouting
export const PERCEPTION_SD = 0.27;

const perceptionError = (seed: string, draftYear: number, pid: number) =>
	new Rng(`outletPerception|${seed}|${draftYear}|${pid}`).normal(0, 1);

/**
 * Every outlet's board of a class: pid -> rank (1 = top), by outlet id. Only the top `size` prospects by the consensus are ranked
 * by each outlet (the rest are off its board).
 */
export const outletBoards = ({
	prospects,
	seed,
	draftYear,
	edition,
}: {
	prospects: OutletProspect[];
	seed: string;
	draftYear: number;
	edition: number;
}) => {
	const zValue = standardize(prospects.map((p) => p.value));
	const zUpside = standardize(prospects.map((p) => p.upside));
	const zProd = standardize(prospects.map((p) => p.production));
	const zAth = standardize(prospects.map((p) => p.athletic));
	const scale = noiseScale(edition);
	const perception = prospects.map(
		(p) => PERCEPTION_SD * perceptionError(seed, draftYear, p.pid),
	);
	const boards = new Map<number, Map<number, number>>();
	for (const outlet of OUTLETS) {
		const list = prospects.map((p, i) => {
			const pub = drifting(
				`outletPublic|${seed}|${draftYear}|${p.pid}`,
				edition,
			);
			const own = drifting(
				`outlet|${seed}|${draftYear}|${outlet.id}|${p.pid}`,
				edition,
			);
			let lean = 0;
			if (outlet.lean === "upside") {
				lean = zUpside[i] ?? 0;
			} else if (outlet.lean === "production") {
				// No stats: they can't vouch for him
				lean = zProd[i] ?? -0.6;
			} else if (outlet.lean === "athletic") {
				lean = zAth[i] ?? 0;
			}
			const score =
				zValue[i]! +
				outlet.leanWeight * lean -
				(p.offRadar ? OFF_RADAR_PENALTY : 0) +
				perception[i]! +
				scale * (PUBLIC_SD * pub + OUTLET_SD * outlet.noise * own);
			return { pid: p.pid, score };
		});
		list.sort((a, b) => b.score - a.score || a.pid - b.pid);
		boards.set(outlet.id, new Map(list.map((x, i) => [x.pid, i + 1])));
	}
	return boards;
};

/**
 * The consensus board: average rank over the outlets (ties by the best single rank, then pid). pid -> { rank, avg, spread }.
 */
export const consensusBoard = (boards: Map<number, Map<number, number>>) => {
	const pids = new Set<number>();
	for (const b of boards.values()) {
		for (const pid of b.keys()) {
			pids.add(pid);
		}
	}
	const rows = [...pids].map((pid) => {
		const ranks = [...boards.values()].map((b) => b.get(pid) ?? b.size + 1);
		const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
		return {
			pid,
			avg,
			best: Math.min(...ranks),
			worst: Math.max(...ranks),
		};
	});
	rows.sort((a, b) => a.avg - b.avg || a.best - b.best || a.pid - b.pid);
	return new Map(
		rows.map((r, i) => [
			r.pid,
			{
				rank: i + 1,
				avg: Math.round(10 * r.avg) / 10,
				spread: r.worst - r.best,
			},
		]),
	);
};

// ---- Signals ----

export type PreDraftLine = {
	gp: number;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tov: number;
	fga: number;
	fta: number;
	level: "college" | "overseas" | "pro" | "juco" | "other";
};

const LEVEL_MULT: Record<PreDraftLine["level"], number> = {
	college: 1,
	overseas: 1.1,
	pro: 1.05,
	juco: 0.75,
	other: 0.7,
};

/**
 * The production outlet's read of his last pre-draft season: a box score composite per 40 minutes, efficiency, the level of
 * competition and his age (younger for the same production is better). undefined with under 150 minutes.
 */
export const productionSignal = (line: PreDraftLine, age: number) => {
	if (line.min < 150) {
		return undefined;
	}
	const per40 =
		(40 *
			(line.pts +
				1.2 * line.trb +
				1.5 * line.ast +
				2 * line.stl +
				2 * line.blk -
				1.5 * line.tov)) /
		line.min;
	const tsa = 2 * (line.fga + 0.44 * line.fta);
	const ts = tsa > 0 ? line.pts / tsa : 0.5;
	return per40 * LEVEL_MULT[line.level] + 30 * (ts - 0.54) - 1.2 * (age - 20);
};

// ---- Accuracy ----

export type BoardRanks = Map<number, number>;

/**
 * How well a board called the actual draft: mean absolute difference between its rank and the overall pick over the prospects picked
 * in the first round (a prospect it left off counts as its board size + 1), and how many of the first round it had in its top
 * firstRound.
 */
export const draftAccuracy = (
	board: BoardRanks,
	picks: Map<number, number>,
	firstRound: number,
) => {
	let err = 0;
	let n = 0;
	let hits = 0;
	for (const [pid, pick] of picks) {
		if (pick > firstRound) {
			continue;
		}
		const r = board.get(pid) ?? board.size + 1;
		err += Math.min(60, Math.abs(r - pick));
		n += 1;
		if (r <= firstRound) {
			hits += 1;
		}
	}
	return n === 0
		? undefined
		: { mae: Math.round((10 * err) / n) / 10, hits, n };
};

/**
 * How well a board called the outcome (three seasons later): over the board's top `top` prospects, the mean absolute difference between
 * its rank and where he finished in the class (outcome rank, capped at 2 × top), and how many of its top 10 finished in the class's top
 * 10.
 */
export const outcomeAccuracy = (
	board: BoardRanks,
	outcome: Map<number, number>,
	top: number,
) => {
	let err = 0;
	let n = 0;
	let hits = 0;
	for (const [pid, r] of board) {
		if (r > top) {
			continue;
		}
		const o = Math.min(2 * top, outcome.get(pid) ?? 2 * top);
		err += Math.abs(r - o);
		n += 1;
		if (r <= 10 && o <= 10) {
			hits += 1;
		}
	}
	return n === 0
		? undefined
		: { mae: Math.round((10 * err) / n) / 10, hits, n };
};

// Outcome judged this many seasons after the draft
export const OUTCOME_SEASONS = 3;

/**
 * Where each member of a class finished: rank by his best (visible) ovr in his first OUTCOME_SEASONS pro seasons, ties by minutes.
 */
export const outcomeRanks = (
	members: { pid: number; peak: number; min: number }[],
) => {
	const sorted = [...members].sort(
		(a, b) => b.peak - a.peak || b.min - a.min || a.pid - b.pid,
	);
	return new Map(sorted.map((m, i) => [m.pid, i + 1]));
};
