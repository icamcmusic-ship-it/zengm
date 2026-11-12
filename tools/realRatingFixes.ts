// Fork corrections to a few real players' ratings in data/real-player-data.basketball.json (arch13).
//
// The real ratings come with the upstream data (no formula for them in this repo). Where a rating clearly contradicts
// the player's own box score, this sets it to what his stats predict: one regression per rating, fitted on every
// 2016-2026 player-season with 800+ regular-season minutes (the same season's stats, which is what the ratings track
// best), on that rating's own shooting/finishing stats only. Only the listed players and ratings are touched, and only
// in seasons where the rating is more than one standard error off in the reported direction; a later copy of the same
// row (the data repeats the last season's ratings for future seasons) gets the same value.
//
// Mikal Bridges was checked too (his fg reads 1.8 standard errors above his box score) and left alone: box scores have no
// shot zones, and he really is a high-volume mid-range shooter, so the regression cannot overrule that rating.
//
// node tools/realRatingFixes.ts          print the evidence
// node tools/realRatingFixes.ts --write  also write the data file (the JSON round-trips byte for byte)
import { readFileSync, writeFileSync } from "node:fs";

const DATA = "data/real-player-data.basketball.json";
const STATS = "data/real-player-stats.basketball.json";

type Dim = "tp" | "fg" | "jmp" | "dnk";

// Which stats each rating is read from (besides a constant and height)
const MODELS: Record<Dim, string[]> = {
	// three: 3P%, 3PA per 36, FT%
	tp: ["tpp", "tpa36", "ftp"],
	// mid-range: shooting touch (3P%, FT%) and volume, minus free-throw drawing (rim pressure)
	fg: ["tpp", "tpa36", "ftp", "pts36", "usg", "fga36", "twoa36", "fta36"],
	// jumping: block rate, rebounding, rim pressure and 2P%
	jmp: ["blk", "orb", "fta36", "twop", "stl", "drb"],
	// finishing at the rim: 2P%, free throws drawn, touch, rebounding and blocks
	dnk: ["twop", "fta36", "usg", "ftp", "tpa36", "orb", "blk"],
};

// The reported misreadings: [name, rating, direction the rating is off (+1 too high, -1 too low), why]
const FIXES: [string, Dim, 1 | -1, string][] = [
	[
		"Luguentz Dort",
		"jmp",
		1,
		"rated as a leaper; a strong, ground-bound stopper",
	],
	[
		"Desmond Bane",
		"jmp",
		1,
		"rated as a leaper; a shooter/driver who plays below the rim",
	],
	["Ivica Zubac", "fg", 1, "mid-range read from a rim finisher's 2P%"],
	["Isaiah Hartenstein", "fg", 1, "mid-range read from a rim finisher's 2P%"],
	["Luka Dončić", "tp", -1, "three at 53 for a high-volume step-back shooter"],
	["Herbert Jones", "fg", 1, "mid-range as the top skill of a defensive wing"],
	[
		"Franz Wagner",
		"fg",
		1,
		"mid-range above what his shooting stats support (a driver)",
	],
	["Myles Turner", "dnk", 1, "elite rim finishing for a pick-and-pop big"],
];
const SEASONS = [2024, 2025, 2026];

const d = JSON.parse(readFileSync(DATA, "utf8"));
const st = JSON.parse(readFileSync(STATS, "utf8"));

type Totals = Record<
	| "min"
	| "pts"
	| "tp"
	| "tpa"
	| "fga"
	| "fg"
	| "ft"
	| "fta"
	| "blkp"
	| "stlp"
	| "orbp"
	| "drbp"
	| "usgp",
	number
>;

const seasonTotals = (slug: string, season: number): Totals | undefined => {
	const rows = (st.stats[slug] ?? []).filter(
		(x: any) => x.season === season && !x.playoffs,
	);
	if (rows.length === 0) {
		return;
	}
	const t = {} as Totals;
	for (const r of rows) {
		for (const k of [
			"min",
			"pts",
			"tp",
			"tpa",
			"fga",
			"fg",
			"ft",
			"fta",
		] as const) {
			t[k] = (t[k] ?? 0) + (r[k] ?? 0);
		}
	}
	for (const k of ["blkp", "stlp", "orbp", "drbp", "usgp"] as const) {
		t[k] =
			rows.reduce((a: number, r: any) => a + (r[k] ?? 0) * (r.min ?? 0), 0) /
			Math.max(1, t.min);
	}
	return t;
};

const features = (hgt: number, s: Totals) => {
	const m = s.min / 36;
	return {
		one: 1,
		hgt,
		tpp: s.tpa >= 20 ? s.tp / s.tpa : 0.3,
		tpa36: s.tpa / m,
		ftp: s.fta >= 20 ? s.ft / s.fta : 0.7,
		fta36: s.fta / m,
		fga36: s.fga / m,
		twoa36: (s.fga - s.tpa) / m,
		twop: (s.fg - s.tp) / Math.max(1, s.fga - s.tpa),
		pts36: s.pts / m,
		blk: s.blkp,
		stl: s.stlp,
		orb: s.orbp,
		drb: s.drbp,
		usg: s.usgp,
	} as Record<string, number>;
};

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

// Training rows: 2016-2026, 800+ minutes
const train: { r: any; f: Record<string, number> }[] = [];
for (const r of d.ratings) {
	if (r.season < 2016 || r.season > 2026) {
		continue;
	}
	const s = seasonTotals(r.slug, r.season);
	if (s && s.min >= 800) {
		train.push({ r, f: features(r.hgt, s) });
	}
}

const write = process.argv.includes("--write");
const slugOf = (name: string) =>
	Object.keys(d.bios).find((k) => d.bios[k].name === name)!;

for (const dim of Object.keys(MODELS) as Dim[]) {
	const keys = ["one", "hgt", ...MODELS[dim]];
	const X = train.map((t) => keys.map((k) => t.f[k]!));
	const y = train.map((t) => t.r[dim] as number);
	const w = leastSquares(X, y);
	const pred = X.map((row) => row.reduce((a, v, i) => a + v * w[i]!, 0));
	const se = Math.sqrt(
		y.reduce((a, v, i) => a + (v - pred[i]!) ** 2, 0) / y.length,
	);
	console.log(
		`${dim}: n ${y.length}, se ${se.toFixed(1)}, ${keys.map((k, i) => `${k} ${w[i]!.toFixed(2)}`).join(", ")}`,
	);
	for (const [name, fixDim, dir, why] of FIXES) {
		if (fixDim !== dim) {
			continue;
		}
		const slug = slugOf(name);
		const rows = d.ratings.filter((r: any) => r.slug === slug);
		for (const season of SEASONS) {
			const row = rows.find((r: any) => r.season === season);
			const s = seasonTotals(slug, season);
			if (!row || !s || s.min < 300) {
				continue;
			}
			const f = features(row.hgt, s);
			const p = Math.round(keys.reduce((a, k, i) => a + f[k]! * w[i]!, 0));
			const old = row[dim];
			const off = (dir * (old - p)) / se;
			const apply = off > 1;
			console.log(
				`  ${name} ${season} ${dim} ${old} -> stats say ${p} (${off.toFixed(2)} se off)${apply ? " FIX" : ""} - ${why}`,
			);
			if (apply && write) {
				// Later rows that copy the last season's (future seasons) get the same value
				for (const later of rows) {
					if (
						season === SEASONS.at(-1) &&
						later.season > season &&
						later[dim] === old
					) {
						later[dim] = p;
					}
				}
				row[dim] = p;
			}
		}
	}
}

if (write) {
	writeFileSync(DATA, JSON.stringify(d, null, 2));
	console.log(`wrote ${DATA}`);
}
