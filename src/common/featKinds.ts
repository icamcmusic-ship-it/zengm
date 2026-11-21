// Kinds of statistical feats (basketball), for the Statistical Feats page's filter and leaderboard. A feat stores its box score line,
// not why it qualified, so the kinds are worked out again with the same cutoffs as checkStatisticalFeat.basketball.ts (scaled by the
// feat's factor). A feat can be several kinds (a 50 point triple-double).

export const FEAT_KINDS_BASKETBALL = [
	{ key: "tripleDouble", name: "Triple-double", short: "3x10" },
	{ key: "fiveByFive", name: "5x5", short: "5x5" },
	{ key: "pts50", name: "50+ points", short: "50 Pts" },
	{ key: "reb25", name: "25+ rebounds", short: "25 Reb" },
	{ key: "ast20", name: "20+ assists", short: "20 Ast" },
	{ key: "stl10", name: "10+ steals", short: "10 Stl" },
	{ key: "blk10", name: "10+ blocks", short: "10 Blk" },
	{ key: "tp10", name: "10+ threes", short: "10 3PM" },
] as const;

export type FeatKind = (typeof FEAT_KINDS_BASKETBALL)[number]["key"];

export const featKindsBasketball = (
	stats: {
		pts: number;
		orb: number;
		drb: number;
		ast: number;
		stl: number;
		blk: number;
		tp: number;
	},
	factor: number,
): FeatKind[] => {
	const trb = stats.orb + stats.drb;
	const at = (amount: number) => factor * amount;
	const kinds: FeatKind[] = [];

	const doubles = [stats.pts, trb, stats.ast, stats.stl, stats.blk].filter(
		(x) => x >= at(10),
	).length;
	if (doubles >= 3) {
		kinds.push("tripleDouble");
	}
	if (
		[stats.pts, trb, stats.ast, stats.stl, stats.blk].every((x) => x >= at(5))
	) {
		kinds.push("fiveByFive");
	}
	if (stats.pts >= at(50)) {
		kinds.push("pts50");
	}
	if (trb >= at(25)) {
		kinds.push("reb25");
	}
	if (stats.ast >= at(20)) {
		kinds.push("ast20");
	}
	if (stats.stl >= at(10)) {
		kinds.push("stl10");
	}
	if (stats.blk >= at(10)) {
		kinds.push("blk10");
	}
	if (stats.tp >= at(10)) {
		kinds.push("tp10");
	}
	return kinds;
};

export type FeatGameType = "regularSeason" | "playoffs" | "nit" | "allStar";

export const FEAT_GAME_TYPE_NAMES: Record<FeatGameType, string> = {
	regularSeason: "Regular season",
	playoffs: "Playoffs",
	nit: "NIT",
	allStar: "All-Star",
};

type LeaderFeat = {
	pid: number;
	name: string;
	tid: number;
	season: number;
	gid: number;
	kinds: string[];
	deleted?: boolean;
};

export type FeatLeader = {
	pid: number;
	name: string;
	// Team of his latest feat
	tid: number;
	count: number;
	byKind: Record<string, number>;
	first: number;
	last: number;
	deleted: boolean;
};

// Feats per player, most first (then the earliest to get there)
export const featLeaders = (feats: LeaderFeat[]): FeatLeader[] => {
	const byPid = new Map<number, FeatLeader & { lastGid: number }>();
	for (const feat of feats) {
		let row = byPid.get(feat.pid);
		if (!row) {
			row = {
				pid: feat.pid,
				name: feat.name,
				tid: feat.tid,
				count: 0,
				byKind: {},
				first: feat.season,
				last: feat.season,
				deleted: !!feat.deleted,
				lastGid: -Infinity,
			};
			byPid.set(feat.pid, row);
		}
		row.count += 1;
		for (const kind of feat.kinds) {
			row.byKind[kind] = (row.byKind[kind] ?? 0) + 1;
		}
		row.first = Math.min(row.first, feat.season);
		if (
			feat.season > row.last ||
			(feat.season === row.last && feat.gid > row.lastGid)
		) {
			row.last = feat.season;
			row.lastGid = feat.gid;
			row.tid = feat.tid;
			row.name = feat.name;
		}
	}
	return [...byPid.values()]
		.map(({ lastGid: _lastGid, ...row }) => row)
		.sort((a, b) => b.count - a.count || a.first - b.first || a.pid - b.pid);
};
