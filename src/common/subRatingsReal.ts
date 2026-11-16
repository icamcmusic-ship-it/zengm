// Real players' sub-ratings from their stats (sub-ratings step 2, tools/realSubRatings.ts), shared by the tool and the game.
//
// The tool fits, for each of 12 box-score stats, how far a player-season is from what his base ratings predict (a z-score). Each sub's
// lean is a fixed mix of those z-scores (REAL_LEAN_MIX). Two leans are read from them:
// - the stock lean (`subLean` in the real players data): soft-thresholded, shrunk by minutes / (minutes + 1200), 7 points per z, capped
//   at 16. Written by the tool, unchanged.
// - Wider Sub-Rating Shapes (the subRatingsWide setting): the same mix of z-scores (`subZ` in the data: his minutes over the window and
//   the 12 raw z-scores), each z in rating points as the real NBA reference spreads that stat (REAL_WIDE.scale), shrunk only by his
//   sample (minutes / (minutes + REAL_WIDE.shrink), so a rookie or a bench player shrinks more), no threshold, a wider cap
//   (wideRealLean).

export const STAT_Z_KEYS = [
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
export type StatZKey = (typeof STAT_Z_KEYS)[number];

// Each sub's lean: weights on the stat z-scores
export const REAL_LEAN_MIX: Record<
	string,
	Partial<Record<StatZKey, number>>
> = {
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

// Wider shapes from the same z-scores (the subRatingsWide setting). Additions to the stock mix where the stock one is silent about a
// contrast the stats do show: catch-and-shoot vs off the dribble also from 3PA rate against usage (a low-usage high-volume shooter is a
// spot-up shooter), finesse vs contact from FT rate.
export const REAL_WIDE = {
	// Rating points per unit of z, by stat: the real NBA reference (tools/realSubRatings.ts --reference), how far the part of the stat
	// its base doesn't explain spreads on the base's scale (sqrt(1 - R2) x the base's sd over the same players)
	scale: {
		blk: 8.4,
		stl: 6.3,
		orb: 9.3,
		drb: 7.5,
		ast: 6,
		tov: 9.8,
		usg: 9.2,
		tpar: 12.7,
		tpp: 14.3,
		ftr: 12.5,
		twop: 13.7,
		ftp: 5.8,
	} as Record<StatZKey, number>,
	// Times this (1: shrunk only by his sample), less for the athletic subs, which the box score only reads indirectly (speed from FT rate
	// and offensive boards, lateral quickness from steals, leaping from blocks and boards)
	k: 1,
	subK: { sls: 0.5, lat: 0.5, stj: 0.5, mxv: 0.5 } as Record<string, number>,
	// Cap on a lean
	cap: 28,
	// Shrinkage by sample: minutes over the window / (minutes + shrink)
	shrink: 600,
	extra: {
		tcs: { tpar: 0.2 },
		spu: { tpar: 0.15 },
		pul: { tpar: -0.15 },
	} as Record<string, Partial<Record<StatZKey, number>>>,
};

// Parse a stored `subZ` ("minutes,z1,...,z12")
export const parseSubZ = (
	s: unknown,
): { min: number; z: Record<StatZKey, number> } | undefined => {
	if (typeof s !== "string") {
		return;
	}
	const parts = s.split(",").map(Number);
	if (
		parts.length !== STAT_Z_KEYS.length + 1 ||
		parts.some((v) => !Number.isFinite(v))
	) {
		return;
	}
	const z = {} as Record<StatZKey, number>;
	STAT_Z_KEYS.forEach((k, i) => {
		z[k] = parts[i + 1]!;
	});
	return { min: parts[0]!, z };
};

// The wide lean of a real player (SUB_DEFS order, 25 numbers): his z-scores shrunk only by his sample
export const wideRealLean = (
	subKeys: readonly string[],
	parsed: { min: number; z: Record<StatZKey, number> },
): number[] => {
	const shrink = parsed.min / (parsed.min + REAL_WIDE.shrink);
	return subKeys.map((key) => {
		let v = 0;
		for (const mix of [REAL_LEAN_MIX[key], REAL_WIDE.extra[key]]) {
			if (!mix) {
				continue;
			}
			for (const [k, wt] of Object.entries(mix)) {
				v += wt! * parsed.z[k as StatZKey] * REAL_WIDE.scale[k as StatZKey];
			}
		}
		const lean = REAL_WIDE.k * (REAL_WIDE.subK[key] ?? 1) * v * shrink;
		return Math.max(-REAL_WIDE.cap, Math.min(REAL_WIDE.cap, lean));
	});
};
