import { DEF_ROWS, MERGED, RETIRED_ROWS, TOPICS } from "./defs.generated.ts";
import { CALIBRATION } from "./calibration.generated.ts";
import type { Rarity } from "./labels.ts";

// The League achievements catalogue. The rows come from the League Explorer (see tools/convertLeagueAchievements.ts); this turns them into the def objects the engine reads. Rarities are recalibrated on simulated BBGM leagues (calibration.generated.ts).

export const RARITIES: Rarity[] = ["common", "rare", "legendary", "impossible"];
export const RARITY_RANK: Record<Rarity, number> = {
	common: 0,
	rare: 1,
	legendary: 2,
	impossible: 3,
};

// What data a tier relies on. A tier whose data the league doesn't have is "unavailable", never locked at 0.
export type Need =
	| "series"
	| "games"
	| "awards"
	| "allstars"
	| "stats"
	| "draft"
	| "lottery"
	| "events"
	| "injuries"
	| "h2h"
	| "contracts"
	| "ratings";

export const NEED_TEXT: Record<Need, string> = {
	games: "box scores",
	awards: "award data",
	allstars: "All-Star data",
	series: "playoff data",
	events: "the trade log",
	lottery: "lottery results",
	draft: "drafts played in this league",
	injuries: "injury records",
	stats: "player stats",
	h2h: "head-to-head records",
	contracts: "salary records",
	ratings: "player ratings",
};

const FORMATTERS = {
	rec: (n: number) => "." + String(Math.round(n * 1000)).padStart(3, "0"),
	money: (n: number) =>
		"$" +
		(n / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 }) +
		"M",
	f1: (n: number) => n.toFixed(1),
	f2: (n: number) => n.toFixed(2),
	pct: (n: number) => (n * 100).toFixed(1).replace(/\.0$/, "") + "%",
	pct1: (n: number) => (n * 100).toFixed(1) + "%",
	pct0: (n: number) => (n * 100).toFixed(0) + "%",
	floor: (n: number) => Math.floor(n).toLocaleString("en-US"),
	round: (n: number) => Math.round(n).toLocaleString("en-US"),
};
export type FormatterName = keyof typeof FORMATTERS;

export type DefRow = [
	topic: string,
	metric: string,
	rarity: "c" | "r" | "l" | "i",
	t: number,
	name: string,
	desc: string,
	unit: string,
	low: 0 | 1,
	kind: "max" | "n",
	need: Need,
	fmtV: FormatterName | null,
];

export type AchievementDef = {
	// "<metric>-<threshold>", never changes
	id: string;
	topic: string;
	metric: string;
	rarity: Rarity;
	// Threshold
	t: number;
	name: string;
	desc: string;
	// Progress wording
	unit: string;
	// The threshold is a ceiling (lower is better)
	low: boolean;
	// "n": reaching a count of occurrences
	kind: "max" | "n";
	need: Need;
	fmtV: ((n: number) => string) | null;
	// Position in the catalogue
	i: number;
};

const LETTER: Record<DefRow[2], Rarity> = {
	c: "common",
	r: "rare",
	l: "legendary",
	i: "impossible",
};

const toDef = (row: DefRow, i: number): AchievementDef => {
	const [topic, metric, r, t, name, desc, unit, low, kind, need, fmtV] = row;
	const id = `${metric}-${t}`;
	return {
		id,
		topic,
		metric,
		// Rarity as measured on simulated BBGM leagues (calibration.generated.ts, see tools/leagueAchievementsCalibration), else the Explorer's
		rarity: LETTER[CALIBRATION[id]?.[0] ?? r],
		t,
		name,
		desc,
		unit,
		low: low === 1,
		kind,
		need,
		fmtV: fmtV ? FORMATTERS[fmtV] : null,
		i,
	};
};

const defs = DEF_ROWS.map(toDef);
const retired = RETIRED_ROWS.map((row, i) => toDef(row, defs.length + i));
const byId = new Map(defs.map((d) => [d.id, d]));

export const TOPIC_LABEL: Record<string, string> = Object.fromEntries(TOPICS);

// The object the engine was written against (the Explorer's AchievementDefs)
export const Defs = {
	defs,
	retired,
	byId,
	RARITY: { c: "common", r: "rare", l: "legendary", i: "impossible" },
	TOPICS,
	RARITIES,
	MERGED,
};

export { MERGED, TOPICS };

// A value of a metric as text, the way the Explorer shows it
export const formatValue = (
	v: number | null | undefined,
	d: AchievementDef,
): string => {
	if (v === null || v === undefined || !Number.isFinite(v)) {
		return "–";
	}
	if (d.metric === "tall" || d.metric === "short") {
		return `${Math.floor(v / 12)}′${Math.round(v % 12)}″`;
	}
	if (d.fmtV) {
		return d.fmtV(v);
	}
	if (Number.isInteger(v)) {
		return v.toLocaleString("en-US");
	}
	const s = Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1);
	return s.replace(/\.?0+$/, "");
};
