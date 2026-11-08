// League timeline (a League extras feature): the item types and the pure helpers that pick what goes on it. The worker
// view (src/worker/views/timeline.ts) reads the league and the other features' outputs; the page is
// src/ui/views/Timeline.tsx.

export const TIMELINE_KINDS = [
	"champion",
	"award",
	"headline",
	"storyline",
	"achievement",
	"record",
	"trade",
	"unretire",
] as const;

export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
	champion: "Champions",
	award: "MVPs",
	headline: "Headlines",
	storyline: "Storylines",
	achievement: "Achievements",
	record: "Records",
	trade: "Trades",
	unretire: "Comebacks",
};

export type TimelineItem = {
	kind: TimelineKind;
	season: number;
	// Within a season: lower comes first
	order: number;
	title: string;
	detail?: string;
	// League URL parts of the source page
	url: (string | number)[];
	tids: number[];
	pids: number[];
};

export type TimelineSeason = {
	season: number;
	items: TimelineItem[];
};

// Order of kinds within a season
export const KIND_ORDER: Record<TimelineKind, number> = {
	champion: 0,
	award: 1,
	headline: 2,
	record: 3,
	trade: 4,
	unretire: 5,
	achievement: 6,
	storyline: 7,
};

export const groupTimeline = (items: TimelineItem[]): TimelineSeason[] => {
	const bySeason = new Map<number, TimelineItem[]>();
	for (const item of items) {
		let list = bySeason.get(item.season);
		if (!list) {
			list = [];
			bySeason.set(item.season, list);
		}
		list.push(item);
	}
	return [...bySeason.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([season, list]) => ({
			season,
			items: list.sort(
				(a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.order - b.order,
			),
		}));
};

// ---- records: the moments a league record was set (to date), in season order ----

export type TeamSeasonRecordInput = {
	season: number;
	tid: number;
	abbrev: string;
	name: string;
	won: number;
	lost: number;
	tied?: number;
	otl?: number;
};

export type FeatRecordInput = {
	season: number;
	pid: number;
	tid: number;
	name: string;
	pts: number;
	gid: number;
	playoffs: boolean;
};

const winp = (t: TeamSeasonRecordInput) => {
	const gp = t.won + t.lost + (t.tied ?? 0) + (t.otl ?? 0);
	return gp === 0 ? undefined : (t.won + 0.5 * (t.tied ?? 0)) / gp;
};

const recordText = (t: TeamSeasonRecordInput) =>
	`${t.won}-${t.lost}${t.tied ? `-${t.tied}` : ""}${t.otl ? `-${t.otl}` : ""}`;

// Best and worst regular season records: each time a finished season beats the league's best (or worst) so far. The
// first finished season sets the bar but is not news. minGp leaves out seasons that were cut short.
export const findTeamRecords = (
	teamSeasons: TeamSeasonRecordInput[],
	{ lastFinishedSeason, minGp }: { lastFinishedSeason: number; minGp: number },
): TimelineItem[] => {
	const out: TimelineItem[] = [];
	const seasons = [...new Set(teamSeasons.map((t) => t.season))]
		.filter((s) => s <= lastFinishedSeason)
		.sort((a, b) => a - b);
	let best: number | undefined;
	let worst: number | undefined;
	for (const season of seasons) {
		const rows = teamSeasons.filter((t) => {
			const gp = t.won + t.lost + (t.tied ?? 0) + (t.otl ?? 0);
			return t.season === season && gp >= minGp;
		});
		let top: TeamSeasonRecordInput | undefined;
		let bottom: TeamSeasonRecordInput | undefined;
		for (const t of rows) {
			const w = winp(t)!;
			if (!top || w > winp(top)!) {
				top = t;
			}
			if (!bottom || w < winp(bottom)!) {
				bottom = t;
			}
		}
		if (top) {
			const w = winp(top)!;
			if (best !== undefined && w > best) {
				out.push({
					kind: "record",
					season,
					order: 0,
					title: `${top.name} go ${recordText(top)}, the best record in league history`,
					url: ["roster", `${top.abbrev}_${top.tid}`, season],
					tids: [top.tid],
					pids: [],
				});
			}
			best = best === undefined ? w : Math.max(best, w);
		}
		if (bottom) {
			const w = winp(bottom)!;
			if (worst !== undefined && w < worst) {
				out.push({
					kind: "record",
					season,
					order: 1,
					title: `${bottom.name} go ${recordText(bottom)}, the worst record in league history`,
					url: ["roster", `${bottom.abbrev}_${bottom.tid}`, season],
					tids: [bottom.tid],
					pids: [],
				});
			}
			worst = worst === undefined ? w : Math.min(worst, w);
		}
	}
	return out;
};

// Single-game scoring records: each feat that beats every earlier one. The first season's best only sets the bar.
export const findScoringRecords = (
	feats: FeatRecordInput[],
	teamAbbrev: (tid: number, season: number) => string,
): TimelineItem[] => {
	const out: TimelineItem[] = [];
	const sorted = feats.slice().sort((a, b) => a.gid - b.gid);
	const firstSeason = sorted[0]?.season;
	let best: number | undefined;
	for (const f of sorted) {
		if (best === undefined || f.pts > best) {
			if (best !== undefined && f.season !== firstSeason) {
				out.push({
					kind: "record",
					season: f.season,
					order: 2,
					title: `${f.name} scores ${f.pts} points, a league single-game record`,
					detail: f.playoffs ? "In the playoffs" : undefined,
					url: [
						"game_log",
						`${teamAbbrev(f.tid, f.season)}_${f.tid}`,
						f.season,
						f.gid,
					],
					tids: [f.tid],
					pids: [f.pid],
				});
			}
			best = f.pts;
		}
	}
	return out;
};

// The biggest trades of each season by the event's importance score
export const pickMajorTrades = <
	T extends { season: number; score?: number; eid: number },
>(
	trades: T[],
	perSeason: number,
	minScore = 0,
) => {
	const bySeason = new Map<number, T[]>();
	for (const t of trades) {
		if ((t.score ?? 0) < minScore) {
			continue;
		}
		const list = bySeason.get(t.season) ?? [];
		list.push(t);
		bySeason.set(t.season, list);
	}
	const out: T[] = [];
	for (const list of bySeason.values()) {
		list.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.eid - b.eid);
		out.push(...list.slice(0, perSeason));
	}
	return out;
};
