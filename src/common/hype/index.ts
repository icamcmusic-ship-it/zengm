// Game hype: a must-watch score (0-100) with reasons for upcoming games, and for finished ones the same pre-game hype plus a verdict on whether the game lived up to it. Basketball only. Everything comes from data known before the game (pre) or the box score (post); nothing is invented.
import { chaseText, findChases, type ChaseCtx } from "./chases.ts";
import { inputFor, resultFor, storedGame, type Target } from "./gather.ts";
import { postHype, verdictOf } from "./post.ts";
import { preHype } from "./pre.ts";
import type { Chase, HListed, HRaw, HypeGame, HypeLite } from "./types.ts";
import { record } from "./util.ts";

export { buildRecords, withActiveCareers } from "./records.ts";
export { plainText, isBadText, label } from "./util.ts";
export { targetOfGame, storedGame } from "./gather.ts";
export type { Target } from "./gather.ts";
export * from "./types.ts";

// Hype of one game: upcoming (not stored) or finished (stored in raw.games)
export const hypeForGame = (raw: HRaw, t: Target): HypeGame | null => {
	const I = inputFor(raw, t);
	if (!I) {
		return null;
	}
	const pre = preHype(I);
	const res = t.completed ? resultFor(raw, t.gid) : null;
	const post = res ? postHype(I, res, pre) : null;
	const verdict = res && post ? verdictOf(I, res, pre, post) : null;
	const game = t.completed ? storedGame(raw, t.gid) : undefined;
	return {
		gid: t.gid,
		season: raw.season,
		day: t.day,
		kind: I.playIn ? "pi" : I.playoffs ? "po" : "rs",
		completed: t.completed,
		teams: I.teams.map((x, i) => ({
			tid: x.tid,
			abbrev: x.abbrev,
			name: x.name,
			record: record(x),
			pts: game ? game.teams[i]!.pts : undefined,
		})),
		pre,
		post,
		verdict,
		watch: post ? Math.round(0.35 * pre.score + 0.65 * post.score) : pre.score,
	};
};

export type ChaseRow = Chase & { text: string };

// Active record chases across the league (the tracker), best first
export const chaseBoard = (raw: HRaw, limit = 25): ChaseRow[] => {
	if (!raw.records) {
		return [];
	}
	const players: HListed[] = raw.players
		.filter((p) => p.tid >= 0)
		.map((p) => ({
			pid: p.pid,
			name: p.name,
			tid: p.tid,
			ovr: p.ovrBySeason[raw.season] ?? null,
			draft: p.draft,
			rows: p.rows.filter((r) => r.season < raw.season),
			cur: p.rows.filter((r) => r.season === raw.season),
			lines: [],
			prevLines: [],
			prevLinesSeason: null,
			ovrBySeason: p.ovrBySeason,
			allStar: p.allStar,
			moves: p.moves,
			released: p.released,
		}));
	const teamName: Record<number, string> = {};
	for (const t of raw.teams) {
		teamName[t.tid] = t.name;
	}
	const C: ChaseCtx = {
		season: raw.season,
		numGames: raw.numGames,
		records: raw.records,
		teamGp: (tid) => {
			const x = raw.teamNow?.[tid];
			return x ? x.won + x.lost + x.tied + x.otl : 0;
		},
		teamName: (tid) => teamName[tid] ?? "",
	};
	const done = raw.teams.every((t) => C.teamGp(t.tid) >= raw.numGames);
	return findChases(C, players, true)
		.filter((x) => (done ? x.status === "broken" : true))
		.slice(0, limit)
		.map((x) => ({ ...x, text: chaseText(C, x, 0, done) }));
};

export const toLite = (h: HypeGame): HypeLite => ({
	gid: h.gid,
	season: h.season,
	day: h.day,
	kind: h.kind,
	completed: h.completed,
	teams: h.teams,
	score: h.pre.score,
	label: h.pre.label,
	reasons: h.pre.reasons,
	series: h.pre.series?.text ?? null,
	post: h.post,
	verdict: h.verdict,
	watch: h.watch,
});
