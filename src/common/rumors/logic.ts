import { recalibrate } from "./calibration.ts";
import {
	RUMOR_LEVELS,
	RUMOR_TYPES,
	rumorLevel,
	type Rumor,
	type RumorMoment,
	type RumorState,
	type RumorStatus,
	type RumorTally,
	type RumorType,
} from "./types.ts";

// Pure logic of the rumor mill: how many rumors, of which type, how sure, and the track record. No database, no Math.random

// Phase numbers (common/constants.ts PHASE), repeated here so this file has no dependencies
const PRESEASON = 0;
const REGULAR_SEASON = 1;
const AFTER_TRADE_DEADLINE = 2;
const PLAYOFFS = 3;
const DRAFT_LOTTERY = 4;
const DRAFT = 5;
const AFTER_DRAFT = 6;
const RESIGN_PLAYERS = 7;
const FREE_AGENCY = 8;

// Rumors kept: this many seasons (current and last), and never more than this many
export const RUMOR_WINDOW_SEASONS = 2;
export const MAX_RUMORS = 500;
export const STATS_SEASONS = 20;

export const emptyRumorState = (seed: number): RumorState => ({
	seed,
	nextRid: 0,
	tick: 0,
	items: [],
	stats: {},
});

// A 32 bit mix of the league's rumor seed with the day counter (and a salt), for the seeded stream of one day
export const mixSeed = (seed: number, tick: number, salt = 0) => {
	let h = (seed ^ 0x9e3779b9) | 0;
	for (const x of [tick, salt]) {
		h = Math.imul(h ^ (x | 0), 0x85ebca6b);
		h ^= h >>> 13;
		h = Math.imul(h, 0xc2b2ae35);
		h ^= h >>> 16;
	}
	return h | 0;
};

export const momentValue = (m: RumorMoment) => m.season * 100 + m.phase;

export const poisson = (rate: number, random: () => number) => {
	if (!(rate > 0)) {
		return 0;
	}
	const limit = Math.exp(-Math.min(rate, 20));
	let k = 0;
	let p = random();
	while (p > limit && k < 50) {
		k += 1;
		p *= random();
	}
	return k;
};

export const weightedIndex = (weights: number[], random: () => number) => {
	let total = 0;
	for (const w of weights) {
		total += Math.max(0, w);
	}
	if (!(total > 0)) {
		return -1;
	}
	let r = random() * total;
	for (const [i, w] of weights.entries()) {
		r -= Math.max(0, w);
		if (r < 0) {
			return i;
		}
	}
	return weights.findLastIndex((w) => w > 0);
};

export type RumorClock = {
	phase: number;
	// 0 to 1, how much of the regular season has been played
	seasonProgress: number;
	// Fraction of the season when the trade deadline happens, >= 1 for none
	tradeDeadline: number;
	// Days of free agency left (30 at the start)
	daysLeft: number;
};

// The run-up to the trade deadline, when the rumor mill is loudest
export const DEADLINE_RUMOR_WINDOW = 0.12;
export const nearDeadline = (clock: RumorClock) =>
	clock.phase === REGULAR_SEASON &&
	clock.tradeDeadline < 1 &&
	clock.seasonProgress >= clock.tradeDeadline - DEADLINE_RUMOR_WINDOW;

// Expected new rumors on a day of games or a day of free agency: about 3 a week in season, more near the deadline and early in free agency
export const dailyRate = (clock: RumorClock) => {
	switch (clock.phase) {
		case REGULAR_SEASON:
			return nearDeadline(clock) ? 1.5 : 0.45;
		case AFTER_TRADE_DEADLINE:
			return 0.3;
		case PLAYOFFS:
			return 0.35;
		case FREE_AGENCY:
			return clock.daysLeft > 20 ? 2 : clock.daysLeft > 10 ? 1.2 : 0.6;
		default:
			return 0;
	}
};

// New rumors when a phase starts
export const phaseBurst = (phase: number) => {
	switch (phase) {
		case PRESEASON:
			return 3;
		case REGULAR_SEASON:
			return 2;
		case AFTER_TRADE_DEADLINE:
			return 1;
		case PLAYOFFS:
			return 2;
		case DRAFT_LOTTERY:
			return 5;
		case DRAFT:
			return 3;
		case AFTER_DRAFT:
			return 2;
		case RESIGN_PLAYERS:
			return 3;
		case FREE_AGENCY:
			return 5;
		default:
			return 0;
	}
};

// Relative chance of each type of rumor right now. 0 where nothing could come of it (no trade rumors after the deadline, ...)
export const typeWeights = (clock: RumorClock): Record<RumorType, number> => {
	const w: Record<RumorType, number> = {
		shopping: 0,
		interest: 0,
		pick: 0,
		unhappy: 0,
		extension: 0,
		freeAgent: 0,
		coach: 0,
		gm: 0,
		draft: 0,
	};
	const progress = clock.seasonProgress;
	switch (clock.phase) {
		case PRESEASON:
			w.unhappy = 3;
			w.freeAgent = 1;
			w.shopping = 1;
			break;
		case REGULAR_SEASON:
			w.shopping = 2.5;
			w.interest = 0.8;
			w.pick = 0.5;
			w.unhappy = 1.5;
			w.extension = 2;
			w.freeAgent = 0.7;
			w.coach = progress >= 0.25 ? 1.2 : 0;
			w.gm = progress >= 0.4 ? 0.8 : 0;
			break;
		case AFTER_TRADE_DEADLINE:
			w.unhappy = 1;
			w.freeAgent = 0.3;
			w.coach = 2;
			w.gm = 1.5;
			w.draft = progress >= 0.85 ? 1 : 0;
			break;
		case PLAYOFFS:
			w.coach = 2;
			w.gm = 2;
			w.draft = 2;
			break;
		case DRAFT_LOTTERY:
			w.draft = 4;
			w.shopping = 1;
			w.pick = 1;
			break;
		case DRAFT:
			w.draft = 4;
			w.shopping = 1;
			break;
		case AFTER_DRAFT:
		case RESIGN_PLAYERS:
			w.shopping = 2;
			w.interest = 0.7;
			w.pick = 0.5;
			break;
		case FREE_AGENCY:
			w.freeAgent = 4;
			w.shopping = 1.5;
			w.interest = 0.6;
			w.pick = 0.3;
			break;
	}
	return w;
};

// When a trade rumor made now runs out: the trade deadline in season, the start of the regular season in the offseason
export const tradeRumorUntil = (
	season: number,
	phase: number,
	hasDeadline: boolean,
): RumorMoment => {
	if (phase === PRESEASON) {
		return { season, phase: REGULAR_SEASON };
	}
	if (phase === REGULAR_SEASON) {
		return { season, phase: hasDeadline ? AFTER_TRADE_DEADLINE : PLAYOFFS };
	}
	if (phase <= PLAYOFFS) {
		// No trades until the offseason
		return { season, phase: FREE_AGENCY };
	}
	return { season: season + 1, phase: REGULAR_SEASON };
};

const clamp01 = (x: number) => Math.max(0.01, Math.min(0.97, x));

/**
 * Track record correction: (confirmed + K) / (expected + K) for a type, from the seasons on record, where expected is the sum of the
 * model's chances (calibration.ts) before this correction. A league where a kind of rumor keeps coming true less often than the model
 * says (few AI trades, say) gets lower confidences from then on, and the other way around. Measured against the model, not against the
 * corrected confidences, so the correction doesn't undo itself once it works
 */
export const CALIBRATION_K = 10;
export const calibrationFactor = (
	stats: RumorState["stats"],
	type: RumorType,
) => {
	let confirmed = 0;
	let expected = 0;
	for (const row of Object.values(stats)) {
		const tally = row[type];
		if (tally) {
			confirmed += tally[0];
			expected += tally[3] ?? tally[2];
		}
	}
	return Math.max(
		0.25,
		Math.min(2.5, (confirmed + CALIBRATION_K) / (expected + CALIBRATION_K)),
	);
};

// The model's chance, from the raw score, then the league's correction, applied to the odds so a strong rumor can't be pushed past certain
export const calibrate = (
	raw: number,
	stats: RumorState["stats"],
	type: RumorType,
	kind?: string,
) => {
	const model = clamp01(recalibrate(type, kind, raw));
	const odds = (model / (1 - model)) * calibrationFactor(stats, type);
	return Math.round(clamp01(odds / (1 + odds)) * 100) / 100;
};

// The model's chance of a rumor, before the league's correction (old rumors without a raw score: their confidence)
export const modelChance = (
	rumor: Pick<Rumor, "type" | "kind" | "raw" | "confidence">,
) =>
	rumor.raw === undefined
		? rumor.confidence
		: clamp01(recalibrate(rumor.type, rumor.kind, rumor.raw));

// Record a resolved rumor in the season it was made
export const addToTally = (
	stats: RumorState["stats"],
	rumor: Pick<Rumor, "season" | "type" | "kind" | "raw" | "confidence">,
	status: Exclude<RumorStatus, "open">,
) => {
	const row = (stats[rumor.season] ??= {});
	const tally: RumorTally = (row[rumor.type] ??= [0, 0, 0, 0]);
	// A tally from before the model's chances were recorded starts them from its confidences
	tally[3] ??= tally[2];
	tally[status === "confirmed" ? 0 : 1] += 1;
	tally[2] = Math.round((tally[2] + rumor.confidence) * 100) / 100;
	tally[3] = Math.round((tally[3] + modelChance(rumor)) * 1000) / 1000;
};

// Drop rumors older than the window (open ones from the previous season stay until they resolve) and old seasons of the record
export const pruneRumors = (state: RumorState, season: number) => {
	state.items = state.items
		.filter((r) => r.season > season - RUMOR_WINDOW_SEASONS)
		.slice(-MAX_RUMORS);
	for (const key of Object.keys(state.stats)) {
		if (Number(key) <= season - STATS_SEASONS) {
			delete state.stats[Number(key)];
		}
	}
};

// Two rumors with the same key say the same thing
export const rumorKey = (
	r: Pick<Rumor, "type" | "kind" | "tids" | "pids" | "dpid" | "cid" | "gmid">,
) => {
	switch (r.type) {
		case "shopping":
		case "unhappy":
		case "extension":
			return `${r.type}|${r.pids[0]}`;
		case "interest":
			return `interest|${r.pids[0]}|${r.tids[0]}`;
		case "freeAgent":
			return `freeAgent|${r.pids[0]}`;
		case "pick":
			return `pick|${r.dpid}`;
		case "coach":
			return `coach|${r.cid}`;
		case "gm":
			return `gm|${r.gmid}`;
		case "draft":
			return `draft|${r.tids[0]}`;
	}
};

// Don't repeat a rumor that is still open, or that resolved recently
export const REPEAT_TICKS = 30;
export const takenKeys = (state: RumorState, season: number) => {
	const keys = new Set<string>();
	for (const r of state.items) {
		if (
			r.status === "open" ||
			state.tick - r.tick < REPEAT_TICKS ||
			// Once per season for the slow ones
			(r.season === season &&
				(r.type === "coach" || r.type === "gm" || r.type === "draft"))
		) {
			keys.add(rumorKey(r));
		}
	}
	return keys;
};

export type AccuracyRow = {
	key: string;
	name: string;
	confirmed: number;
	busted: number;
	// Mean confidence when the rumors were made, and the share that came true
	expected: number | undefined;
	rate: number | undefined;
};

const makeRow = (
	key: string,
	name: string,
	confirmed: number,
	busted: number,
	sumConfidence: number,
): AccuracyRow => {
	const n = confirmed + busted;
	return {
		key,
		name,
		confirmed,
		busted,
		expected: n > 0 ? sumConfidence / n : undefined,
		rate: n > 0 ? confirmed / n : undefined,
	};
};

// Track record by season and by type, from the stats (which outlive the rolling window)
export const accuracyBySeason = (stats: RumorState["stats"]) =>
	Object.keys(stats)
		.map(Number)
		.sort((a, b) => a - b)
		.map((season) => {
			let confirmed = 0;
			let busted = 0;
			let sum = 0;
			for (const tally of Object.values(stats[season]!)) {
				confirmed += tally[0];
				busted += tally[1];
				sum += tally[2];
			}
			return makeRow(String(season), String(season), confirmed, busted, sum);
		});

export const accuracyByType = (
	stats: RumorState["stats"],
	names: Record<RumorType, string>,
) =>
	RUMOR_TYPES.map((type) => {
		let confirmed = 0;
		let busted = 0;
		let sum = 0;
		for (const row of Object.values(stats)) {
			const tally = row[type];
			if (tally) {
				confirmed += tally[0];
				busted += tally[1];
				sum += tally[2];
			}
		}
		return makeRow(type, names[type], confirmed, busted, sum);
	});

// By confidence level, from the rumors still in the window
export const accuracyByLevel = (items: Rumor[]) =>
	RUMOR_LEVELS.map((level) => {
		let confirmed = 0;
		let busted = 0;
		let sum = 0;
		for (const r of items) {
			if (r.status === "open" || rumorLevel(r.confidence).key !== level.key) {
				continue;
			}
			if (r.status === "confirmed") {
				confirmed += 1;
			} else {
				busted += 1;
			}
			sum += r.confidence;
		}
		return makeRow(level.key, level.name, confirmed, busted, sum);
	});

// Whether a drafted player's position is in the group a draft rumor named (basketball positions; a swingman counts as both)
export const posInDraftGroup = (pos: string, group: string) => {
	if (group === "G") {
		return pos === "PG" || pos === "SG" || pos === "G" || pos === "GF";
	}
	if (group === "C") {
		return pos === "C" || pos === "FC";
	}
	return pos === "GF" || pos === "SF" || pos === "F" || pos === "PF";
};
