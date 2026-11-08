/*
 * Recalibrates the League achievements rarities on simulated BBGM leagues.
 *
 *   node tools/leagueAchievementsCalibration/calibrate.ts <sim output.json>...
 *
 * The inputs come from sim.cjs (one random-players league each, with the achievements tally after every season). For every shown
 * tier this measures how often it happens per season in BBGM sims and puts it in the League Explorer's rarity bands (the Explorer
 * calibrated on real NBA history, where many feats are far rarer than in BBGM sims):
 *   common: more than 0.6 a season, rare: 0.15-0.6, legendary: 0.025-0.15, impossible: rarer.
 * The rate of a tier is the larger of
 *   - occurrences per season with data (the engine's count, as it grows season by season; "max" tiers only, since the count of
 *     an "n" tier is a running total), and
 *   - the first-unlock hazard: leagues that unlocked it / seasons played until they did (or until the end).
 * Within one metric a harder threshold is never less rare than an easier one, and a tier any league unlocked in its first 5 seasons
 * is never "impossible". Tiers no league had data for keep the Explorer's rarity.
 *
 * Writes src/common/leagueAchievements/calibration.generated.ts (read by defs.ts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// (imported by path at run time: the tools are type checked apart from src)
const defsPath = path.join(
	import.meta.dirname,
	"../../src/common/leagueAchievements/defs.generated.ts",
);
type DefRow = [
	string,
	string,
	"c" | "r" | "l" | "i",
	number,
	string,
	string,
	string,
	0 | 1,
	"max" | "n",
	...unknown[],
];
const { DEF_ROWS } = (await import(defsPath)) as { DEF_ROWS: DefRow[] };

type Tier = { s: "u" | "l" | "x"; n: number; first: number | null };
type SimOut = {
	label: string;
	start: number;
	seasons: { season: number; tally: { tiers: Record<string, Tier> } }[];
};

const files = process.argv.slice(2);
if (files.length === 0) {
	throw new Error(
		"Usage: node tools/leagueAchievementsCalibration/calibrate.ts <sim.json>...",
	);
}
const sims: SimOut[] = files.map((f) => JSON.parse(readFileSync(f, "utf8")));

const BANDS: [letter: "c" | "r" | "l" | "i", min: number][] = [
	["c", 0.6],
	["r", 0.15],
	["l", 0.025],
	["i", 0],
];
const ORDER = { c: 0, r: 1, l: 2, i: 3 } as const;
const band = (rate: number) => BANDS.find(([, min]) => rate >= min)![0];

type Measure = {
	id: string;
	metric: string;
	t: number;
	low: boolean;
	kind: "max" | "n";
	explorer: "c" | "r" | "l" | "i";
	rate: number | null;
	// Per league: the season index (1 = the league's first season) it was first unlocked in, 0 if never, -1 if no data
	first: number[];
};

const measures: Measure[] = [];
for (const row of DEF_ROWS) {
	const [, metric, r, t, , , , low, kind] = row;
	const id = `${metric}-${t}`;
	let occ = 0;
	let seasonsWithData = 0;
	let unlockedLeagues = 0;
	let exposure = 0;
	const first: number[] = [];
	for (const sim of sims) {
		let prevN = 0;
		let firstAt = 0;
		let any = false;
		for (const [k, { tally }] of sim.seasons.entries()) {
			const x = tally.tiers[id];
			if (!x || x.s === "x") {
				continue;
			}
			any = true;
			seasonsWithData += 1;
			occ += Math.max(0, x.n - prevN);
			prevN = Math.max(prevN, x.n);
			if (!firstAt) {
				exposure += 1;
				if (x.s === "u") {
					firstAt = k + 1;
					unlockedLeagues += 1;
				}
			}
		}
		first.push(any ? firstAt : -1);
	}
	let rate: number | null = null;
	if (seasonsWithData > 0) {
		const hazard = unlockedLeagues / exposure;
		rate = kind === "max" ? Math.max(occ / seasonsWithData, hazard) : hazard;
	}
	measures.push({
		id,
		metric,
		t,
		low: low === 1,
		kind,
		explorer: r,
		rate,
		first,
	});
}

// Assign bands, then make them monotonic within each metric (a harder threshold is at least as rare)
const rarity = new Map<string, "c" | "r" | "l" | "i">();
for (const m of measures) {
	rarity.set(m.id, m.rate === null ? m.explorer : band(m.rate));
}
// Never "impossible" if any league unlocked it in its first EARLY seasons (a rate can be low over 40 seasons and still hit early)
const EARLY = 5;
const capEarly = () => {
	for (const m of measures) {
		if (rarity.get(m.id) === "i" && m.first.some((k) => k > 0 && k <= EARLY)) {
			rarity.set(m.id, "l");
		}
	}
};
capEarly();
const byMetric = Map.groupBy(measures, (m) => m.metric);
for (const list of byMetric.values()) {
	const sorted = list.toSorted((a, b) => (a.low ? b.t - a.t : a.t - b.t));
	let floor = 0;
	for (const m of sorted) {
		const o = Math.max(ORDER[rarity.get(m.id)!], floor);
		floor = o;
		rarity.set(m.id, (["c", "r", "l", "i"] as const)[o]!);
	}
}

capEarly();

const totalSeasons = sims.reduce((a, s) => a + s.seasons.length, 0);
const counts = { c: 0, r: 0, l: 0, i: 0 };
const changed = { up: 0, down: 0 };
for (const m of measures) {
	const r = rarity.get(m.id)!;
	counts[r] += 1;
	if (ORDER[r] < ORDER[m.explorer]) {
		changed.down += 1;
	} else if (ORDER[r] > ORDER[m.explorer]) {
		changed.up += 1;
	}
}

const round = (x: number) => Math.round(x * 10000) / 10000;
const rows = measures.map(
	(m) =>
		`\t${JSON.stringify(m.id)}: [${JSON.stringify(rarity.get(m.id))}, ${m.rate === null ? "null" : round(m.rate)}, ${JSON.stringify(m.first)}],`,
);
const out = `// GENERATED by tools/leagueAchievementsCalibration/calibrate.ts from ${sims.length} simulated random-players leagues (${totalSeasons} seasons: ${sims.map((s) => s.seasons.length).join(", ")}). Do not edit by hand.
// Rarity of every shown tier measured on BBGM sims (the Explorer's own rarities were measured on real NBA history, which is much stingier than a BBGM league).
// Bands (occurrences per season): common > 0.6, rare 0.15-0.6, legendary 0.025-0.15, impossible < 0.025.
// Result: ${counts.c} common, ${counts.r} rare, ${counts.l} legendary, ${counts.i} impossible; ${changed.down} tiers made more common than the Explorer had them, ${changed.up} rarer.
// Rows: id: [rarity, rate per season (null: no league had the data, the Explorer's rarity is kept), season index each league first unlocked it in (0 never, -1 no data)].

export const CALIBRATION_LEAGUES = ${sims.length};
export const CALIBRATION_SEASONS: number[] = ${JSON.stringify(sims.map((s) => s.seasons.length))};

export const CALIBRATION: Record<string, ["c" | "r" | "l" | "i", number | null, number[]]> = {
${rows.join("\n")}
};
`;
const target = path.join(
	import.meta.dirname,
	"../../src/common/leagueAchievements/calibration.generated.ts",
);
writeFileSync(target, out);
console.log(
	`${measures.length} tiers over ${totalSeasons} seasons: ${JSON.stringify(counts)}, ${JSON.stringify(changed)}`,
);
