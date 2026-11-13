// Real players' sub-ratings shapes from their box scores (sub-ratings step 2, see docs/native-features.md, Sub-ratings).
//
// Like tools/realRatingFixes.ts, this is a regression on real player-seasons. Sub-ratings have no ground truth, so the evidence is what a
// player's stats say beyond what his base ratings already say: for each stat (BLK%, STL%, ORB%, DRB%, AST%, TOV%, USG%, 3PA rate, 3P%,
// FT rate, 2P%, FT%), an OLS of the stat on all 15 base ratings, fitted on every 1980-2026 player-season with 800+ regular-season
// minutes. A player-season's residual over the model's standard error is a z-score (BLK% 2 SD above what his ratings predict = blocks
// beyond his Defense rating). Each sub's lean is a fixed mix of those z-scores (blocks from BLK%, range from 3PA rate and 3P%, contact
// finishing from FT rate, vision from AST%, ball security from TOV%, ...), over his last three seasons up to that ratings row (weights
// 1, 0.6, 0.35 times minutes), soft-thresholded (|z| under 0.35 counts as no evidence) and shrunk by sample size (minutes / (minutes
// + 1200)). The game fits the leans to the bases, so every base is reproduced exactly.
//
// Writes `subLean` (25 comma-separated ints in SUB_DEFS order, the wanted offsets from the base) on the ratings rows of
// data/real-player-data.basketball.json that have stats; rows without stats (draft prospects, pre-1973 seasons without BLK%/STL%) get
// none and keep the neutral shape.
//
// node tools/realSubRatings.ts          print the fit and the famous players
// node tools/realSubRatings.ts --write  also write the data file
import { readFileSync, writeFileSync } from "node:fs";
import {
	SUB_DEFS,
	SUB_INDEX,
	fitSubsToBases,
} from "../src/common/subRatings.ts";

const DATA = "data/real-player-data.basketball.json";
const STATS = "data/real-player-stats.basketball.json";

const d = JSON.parse(readFileSync(DATA, "utf8"));
const st = JSON.parse(readFileSync(STATS, "utf8"));

const BASES = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"diq",
	"oiq",
	"drb",
	"pss",
	"reb",
] as const;

const STATS_KEYS = [
	"blk",
	"stl",
	"orb",
	"drb",
	"ast",
	"tov",
	"usg",
	"tpar",
	"tpp",
	"ftr",
	"twop",
	"ftp",
] as const;
type StatKey = (typeof STATS_KEYS)[number];

// Each sub's lean: weights on the stat z-scores
const MIX: Record<string, Partial<Record<StatKey, number>>> = {
	blk: { blk: 1 },
	stl: { stl: 1 },
	idf: { drb: 0.5, blk: 0.3, stl: -0.2 },
	pdf: { stl: 0.5, blk: -0.3, drb: -0.2 },
	rng: { tpar: 0.7, tpp: 0.3 },
	tcs: { tpp: 0.6, usg: -0.5, ast: -0.2 },
	tod: { usg: 0.6, tpar: 0.3, ast: 0.2 },
	pst: { ftr: 0.4, tpar: -0.3, usg: 0.3 },
	cls: { twop: 0.7, orb: 0.3 },
	flt: { ftp: 0.5, twop: 0.3, ftr: -0.3 },
	con: { ftr: 0.8, orb: 0.2 },
	fns: { twop: 0.6, ftr: -0.4 },
	pul: { usg: 0.7, ast: 0.2, tpp: -0.1 },
	spu: { tpp: 0.5, usg: -0.5 },
	orb: { orb: 1 },
	drd: { drb: 1 },
	hnd: { usg: 0.5, ast: 0.4, tov: -0.2 },
	sec: { tov: -0.8, ast: 0.2 },
	crt: { usg: 0.8, ftr: 0.2 },
	vis: { ast: 0.8, usg: 0.2 },
	acc: { tov: -0.7, ast: 0.3 },
	sls: { ftr: 0.5, orb: 0.3, stl: 0.2 },
	lat: { stl: 0.7, blk: -0.2 },
	stj: { blk: 0.5, drb: 0.4 },
	mxv: { orb: 0.5, ftr: 0.4, drb: -0.2 },
};

// Points of sub offset per unit of z, the cap on a lean, the soft threshold and the shrinkage
const K = 7;
const CAP = 16;
const THRESH = 0.35;
const SHRINK_MIN = 1200;
const WINDOW = [1, 0.6, 0.35];

type Season = Partial<Record<StatKey, number>> & { min: number };

const seasonStats = new Map<string, Map<number, Season>>();
for (const [slug, rows] of Object.entries(st.stats) as [string, any[]][]) {
	const bySeason = new Map<number, any[]>();
	for (const r of rows) {
		if (r.playoffs || !r.min) {
			continue;
		}
		const list = bySeason.get(r.season) ?? [];
		list.push(r);
		bySeason.set(r.season, list);
	}
	const out = new Map<number, Season>();
	for (const [season, list] of bySeason) {
		const sum = (k: string) => list.reduce((a, r) => a + (r[k] ?? 0), 0);
		const has = (k: string) => list.every((r) => r[k] !== undefined);
		const min = sum("min");
		const wavg = (k: string) =>
			has(k)
				? list.reduce((a, r) => a + r[k] * r.min, 0) / Math.max(1, min)
				: undefined;
		const fga = sum("fga");
		const fta = sum("fta");
		const tpa = sum("tpa");
		const s: Season = { min };
		s.blk = wavg("blkp");
		s.stl = wavg("stlp");
		s.orb = wavg("orbp");
		s.drb = wavg("drbp");
		s.ast = wavg("astp");
		s.usg = wavg("usgp");
		if (has("tov")) {
			const tov = sum("tov");
			s.tov = (100 * tov) / Math.max(1, fga + 0.44 * fta + tov);
		}
		if (fga > 0) {
			s.tpar = tpa / fga;
			s.ftr = fta / fga;
		}
		// Shrunk percentages, so a few attempts say little
		s.tpp = (sum("tp") + 0.33 * 60) / (tpa + 60);
		s.twop = (sum("fg") - sum("tp") + 0.47 * 60) / (fga - tpa + 60);
		s.ftp = (sum("ft") + 0.72 * 40) / (fta + 40);
		out.set(season, s);
	}
	seasonStats.set(slug, out);
}

// Ratings rows by slug and season
const ratingsOf = new Map<string, Map<number, any>>();
for (const r of d.ratings) {
	const m = ratingsOf.get(r.slug) ?? new Map();
	m.set(r.season, r);
	ratingsOf.set(r.slug, m);
}

const leastSquares = (X: number[][], y: number[]) => {
	const k = X[0]!.length;
	const A = Array.from({ length: k }, () => Array<number>(k).fill(0));
	const b = Array<number>(k).fill(0);
	for (let i = 0; i < X.length; i++) {
		for (let a = 0; a < k; a++) {
			b[a]! += X[i]![a]! * y[i]!;
			for (let c = 0; c < k; c++) {
				A[a]![c]! += X[i]![a]! * X[i]![c]!;
			}
		}
	}
	for (let i = 0; i < k; i++) {
		let p = i;
		for (let j = i + 1; j < k; j++) {
			if (Math.abs(A[j]![i]!) > Math.abs(A[p]![i]!)) {
				p = j;
			}
		}
		[A[i], A[p]] = [A[p]!, A[i]!];
		[b[i], b[p]] = [b[p]!, b[i]!];
		for (let j = 0; j < k; j++) {
			if (j !== i) {
				const f = A[j]![i]! / A[i]![i]!;
				for (let c = 0; c < k; c++) {
					A[j]![c]! -= f * A[i]![c]!;
				}
				b[j]! -= f * b[i]!;
			}
		}
	}
	return b.map((v, i) => v / A[i]![i]!);
};

// What each stat is compared to: the base rating it sits under (BLK% and STL% under Defense, so a center's blocks read above his
// steals), plus height for the shooting and creation stats (a big's low 3PA rate isn't a lean away from range within his three rating)
const PRED: Record<StatKey, (typeof BASES)[number][]> = {
	blk: ["diq"],
	stl: ["diq"],
	orb: ["reb"],
	drb: ["reb"],
	ast: ["pss", "drb"],
	tov: ["drb", "pss"],
	usg: ["drb", "oiq"],
	tpar: ["tp", "hgt"],
	tpp: ["tp"],
	ftr: ["dnk", "ins"],
	twop: ["ins", "dnk"],
	ftp: ["ft"],
};
const xOf = (r: any, key: StatKey) => [
	1,
	...PRED[key].map((b) => r[b] as number),
];

// One model per stat
const models = {} as Record<StatKey, { w: number[]; se: number }>;
const fitLines: string[] = [];
for (const key of STATS_KEYS) {
	const X: number[][] = [];
	const y: number[] = [];
	for (const [slug, seasons] of seasonStats) {
		for (const [season, s] of seasons) {
			const r = ratingsOf.get(slug)?.get(season);
			if (!r || season < 1980 || s.min < 800 || s[key] === undefined) {
				continue;
			}
			X.push(xOf(r, key));
			y.push(s[key]);
		}
	}
	const w = leastSquares(X, y);
	const pred = X.map((row) => row.reduce((a, v, i) => a + v * w[i]!, 0));
	const mean = y.reduce((a, v) => a + v, 0) / y.length;
	const ssr = y.reduce((a, v, i) => a + (v - pred[i]!) ** 2, 0);
	const sst = y.reduce((a, v) => a + (v - mean) ** 2, 0);
	const se = Math.sqrt(ssr / y.length);
	models[key] = { w, se };
	fitLines.push(
		`${key.padEnd(5)} n ${y.length}, R2 ${(1 - ssr / sst).toFixed(2)}, residual sd ${se.toFixed(3)}`,
	);
}

const zOf = (slug: string, season: number, key: StatKey) => {
	const s = seasonStats.get(slug)?.get(season);
	const r = ratingsOf.get(slug)?.get(season);
	if (!s || !r || s[key] === undefined) {
		return;
	}
	const { w, se } = models[key];
	const pred = xOf(r, key).reduce((a, v, i) => a + v * w[i]!, 0);
	return { z: (s[key] - pred) / se, min: s.min };
};

// Year-to-year stability of the z-scores (season t vs t+1, both 800+ minutes): a real skill repeats
const stability: string[] = [];
for (const key of STATS_KEYS) {
	const pairs: [number, number][] = [];
	for (const [slug, seasons] of seasonStats) {
		for (const season of seasons.keys()) {
			if (season < 1980) {
				continue;
			}
			const a = zOf(slug, season, key);
			const b = zOf(slug, season + 1, key);
			if (a && b && a.min >= 800 && b.min >= 800) {
				pairs.push([a.z, b.z]);
			}
		}
	}
	const n = pairs.length;
	const ma = pairs.reduce((s, p) => s + p[0], 0) / n;
	const mb = pairs.reduce((s, p) => s + p[1], 0) / n;
	let sab = 0;
	let saa = 0;
	let sbb = 0;
	for (const [a, b] of pairs) {
		sab += (a - ma) * (b - mb);
		saa += (a - ma) ** 2;
		sbb += (b - mb) ** 2;
	}
	stability.push(`${key} ${(sab / Math.sqrt(saa * sbb)).toFixed(2)}`);
}

// A row's lean: his last three seasons of stats up to the row's season
const leanFor = (slug: string, season: number): number[] | undefined => {
	const seasons = seasonStats.get(slug);
	if (!seasons) {
		return;
	}
	const last = Math.max(...[...seasons.keys()].filter((s) => s <= season));
	if (!Number.isFinite(last)) {
		return;
	}
	const zs = {} as Record<StatKey, number>;
	let any = false;
	for (const key of STATS_KEYS) {
		let sw = 0;
		let swz = 0;
		WINDOW.forEach((wt, i) => {
			const z = zOf(slug, last - i, key);
			if (z) {
				sw += wt * z.min;
				swz += wt * z.min * z.z;
			}
		});
		if (sw <= 0) {
			zs[key] = 0;
			continue;
		}
		any = true;
		const z = swz / sw;
		const soft = Math.sign(z) * Math.max(0, Math.abs(z) - THRESH);
		zs[key] = soft * (sw / (sw + SHRINK_MIN));
	}
	if (!any) {
		return;
	}
	return SUB_DEFS.map((def) => {
		const mix = MIX[def.key]!;
		let v = 0;
		for (const [k, wt] of Object.entries(mix)) {
			v += wt * zs[k as StatKey];
		}
		return Math.max(-CAP, Math.min(CAP, Math.round(K * v)));
	});
};

let written = 0;
for (const r of d.ratings) {
	const lean = leanFor(r.slug, r.season);
	if (lean && lean.some((v) => v !== 0)) {
		r.subLean = lean.join(",");
		written += 1;
	} else {
		delete r.subLean;
	}
}

console.log(
	"Stat models (stat ~ the base it sits under, 1980-2026, 800+ min):",
);
for (const line of fitLines) {
	console.log(`  ${line}`);
}
console.log(
	`Year-to-year correlation of the z-scores: ${stability.join(", ")}`,
);
console.log(`Rows with a lean: ${written} of ${d.ratings.length}`);

const FAMOUS = [
	"Rudy Gobert",
	"Draymond Green",
	"Stephen Curry",
	"Luka Dončić",
	"Klay Thompson",
	"Russell Westbrook",
	"Nikola Jokić",
	"Victor Wembanyama",
	"Luguentz Dort",
	"Clint Capela",
	"LeBron James",
	"Giannis Antetokounmpo",
	"Chris Paul",
	"Kevin Durant",
	"Joel Embiid",
	"Shai Gilgeous-Alexander",
];
const SHOW = [
	"blk",
	"stl",
	"idf",
	"pdf",
	"rng",
	"tcs",
	"tod",
	"pst",
	"con",
	"fns",
	"pul",
	"orb",
	"hnd",
	"sec",
	"crt",
	"vis",
	"acc",
	"lat",
	"mxv",
];
console.log(
	`\n| Player (season) | ${SHOW.join(" | ")} |\n|---|${SHOW.map(() => "---").join("|")}|`,
);
for (const name of FAMOUS) {
	const slug = Object.keys(d.bios).find((k) => d.bios[k].name === name);
	if (!slug) {
		continue;
	}
	const rows = [...(ratingsOf.get(slug)?.values() ?? [])].filter(
		(r) => r.season <= 2026,
	);
	const r = rows.at(-1);
	if (!r) {
		continue;
	}
	const lean = r.subLean
		? r.subLean.split(",").map(Number)
		: SUB_DEFS.map(() => 0);
	const sub = fitSubsToBases(
		SUB_DEFS.map((def, i) => r[def.base] + lean[i]),
		r,
	);
	const cell = (k: string) => {
		const i = SUB_INDEX[k]!;
		const off = sub[i]! - r[SUB_DEFS[i]!.base];
		return `${sub[i]} (${off >= 0 ? "+" : ""}${off})`;
	};
	console.log(`| ${name} (${r.season}) | ${SHOW.map(cell).join(" | ")} |`);
}

if (process.argv.includes("--write")) {
	writeFileSync(DATA, JSON.stringify(d, null, 2));
	console.log(`wrote ${DATA}`);
}
