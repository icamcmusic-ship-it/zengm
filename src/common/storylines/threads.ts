// Threads: the stories of one subject (a player, a pair of players, a team, two teams) across seasons, as one timeline. A story belongs to the thread of what it is about: one player; two players; no player and one team; no player and two teams. A thread needs stories in two or more different seasons. Each chapter gets a phase from the league data, never from the story's wording:
//   player: his season against his best by win shares: before it "The rise", the season itself "The peak", after it "The later years", or "The fall" when that season's win shares were under half the peak
//   team: the season's record, "A winning season" or "A losing season"
//   two teams: their head-to-head record that season in the stored box scores
//   two players: no phase

import type { LeagueIndex } from "../wrapped/league.ts";
import { fmtNum, fmtRecord, plural } from "../wrapped/util.ts";
import type { Story } from "./kit.ts";

export type ThreadKind = "player" | "pair" | "team" | "rivalry";

export type Phase = { id: string; label: string; note?: string };

export type Thread = {
	// "p:12", "pp:3-9", "t:4", "tt:2-5"
	key: string;
	kind: ThreadKind;
	title: string;
	pids: number[];
	tids: number[];
	chapters: { id: string; season: number; phase?: Phase }[];
	seasons: number[];
	from: number;
	to: number;
	score: number;
};

const uniq = (a: number[]) => [...new Set(a)];

export const subjectOf = (X: LeagueIndex, s: Story) => {
	const pids = uniq(s.pids.filter((p) => X.players.has(p))).sort(
		(a, b) => a - b,
	);
	const tids = uniq(
		s.tids.filter((t) => t >= 0 && X.teamAny(t, s.season)),
	).sort((a, b) => a - b);
	if (pids.length === 1) {
		return {
			key: `p:${pids[0]}`,
			kind: "player" as const,
			pids,
			tids: [] as number[],
		};
	}
	if (pids.length === 2) {
		return {
			key: `pp:${pids.join("-")}`,
			kind: "pair" as const,
			pids,
			tids: [] as number[],
		};
	}
	if (tids.length === 1 && (pids.length === 0 || pids.length > 2)) {
		return {
			key: `t:${tids[0]}`,
			kind: "team" as const,
			pids: [] as number[],
			tids,
		};
	}
	if (pids.length === 0 && tids.length === 2) {
		return {
			key: `tt:${tids.join("-")}`,
			kind: "rivalry" as const,
			pids: [] as number[],
			tids,
		};
	}
	return undefined;
};

const playerArc = (X: LeagueIndex, pid: number) => {
	const p = X.players.get(pid);
	if (!p) {
		return undefined;
	}
	const ws = new Map<number, number>();
	for (const r of p.stats) {
		if (r.gp > 0) {
			ws.set(r.season, (ws.get(r.season) ?? 0) + r.ws);
		}
	}
	if (ws.size === 0) {
		return undefined;
	}
	let peak = 0;
	let best = -Infinity;
	for (const [y, v] of [...ws].sort((a, b) => a[0] - b[0])) {
		if (v > best) {
			best = v;
			peak = y;
		}
	}
	const ys = [...ws.keys()];
	return { ws, peak, best, first: Math.min(...ys), last: Math.max(...ys) };
};

type Arc = NonNullable<ReturnType<typeof playerArc>>;

const playerPhase = (
	arc: Arc | undefined,
	season: number,
): Phase | undefined => {
	if (!arc) {
		return undefined;
	}
	if (season < arc.first) {
		return { id: "before", label: "Before his debut" };
	}
	if (season > arc.last) {
		return { id: "after", label: "After his career" };
	}
	if (season < arc.peak) {
		return { id: "rise", label: "The rise" };
	}
	if (season === arc.peak) {
		return {
			id: "peak",
			label: "The peak",
			note: `${fmtNum(arc.best, 1)} win shares, his best`,
		};
	}
	const v = arc.ws.get(season);
	if (v !== undefined && arc.best > 0 && v < arc.best / 2) {
		return {
			id: "fall",
			label: "The fall",
			note: `${fmtNum(v, 1)} win shares (peak ${fmtNum(arc.best, 1)})`,
		};
	}
	return { id: "later", label: "The later years" };
};

const teamPhase = (
	X: LeagueIndex,
	tid: number,
	season: number,
): Phase | undefined => {
	const t = X.team(tid, season);
	if (!t || t.won + t.lost + t.tied === 0) {
		return undefined;
	}
	const w = t.won + t.tied / 2;
	const l = t.lost + t.otl + t.tied / 2;
	return {
		id: w > l ? "up" : w < l ? "down" : "even",
		label:
			w > l ? "A winning season" : w < l ? "A losing season" : "A .500 season",
		note: fmtRecord(t.won, t.lost, t.tied, t.otl),
	};
};

const rivalryPhase = (
	X: LeagueIndex,
	a: number,
	b: number,
	season: number,
): Phase | undefined => {
	const gs = X.games(season).filter(
		(g) => g.teams.some((t) => t.tid === a) && g.teams.some((t) => t.tid === b),
	);
	if (gs.length === 0) {
		return undefined;
	}
	const w = gs.filter((g) => {
		const me = g.teams.find((t) => t.tid === a)!;
		return me.pts > g.teams.find((t) => t.tid === b)!.pts;
	}).length;
	const ab = X.teamAny(a, season)?.abbrev ?? "";
	return {
		id: w > gs.length - w ? "a" : w < gs.length - w ? "b" : "even",
		label: "Head to head",
		note: `${ab} ${w}–${gs.length - w} in ${plural(gs.length, "meeting")} stored`,
	};
};

// Stories to threads, longest first. Deterministic.
export const buildThreads = (X: LeagueIndex, stories: Story[]): Thread[] => {
	const groups = new Map<
		string,
		{ subject: NonNullable<ReturnType<typeof subjectOf>>; list: Story[] }
	>();
	for (const s of stories) {
		const subject = subjectOf(X, s);
		if (!subject) {
			continue;
		}
		const g = groups.get(subject.key);
		if (g) {
			g.list.push(s);
		} else {
			groups.set(subject.key, { subject, list: [s] });
		}
	}
	const out: Thread[] = [];
	for (const [key, { subject, list }] of groups) {
		const seasons = [...new Set(list.map((s) => s.season))].sort(
			(a, b) => a - b,
		);
		if (seasons.length < 2) {
			continue;
		}
		const sorted = [...list].sort(
			(a, b) =>
				a.season - b.season || b.score - a.score || (a.id < b.id ? -1 : 1),
		);
		const arcs =
			subject.kind === "player" ? playerArc(X, subject.pids[0]!) : undefined;
		const last = seasons.at(-1)!;
		const names = subject.pids.map((p) => X.players.get(p)!.name);
		const tnames = subject.tids.map((t) => X.teamName(t, last));
		const title =
			subject.kind === "player"
				? `${names[0]}’s story`
				: subject.kind === "pair"
					? `${names[0]} and ${names[1]}`
					: subject.kind === "team"
						? `The ${tnames[0]}`
						: `${tnames[0]} and ${tnames[1]}`;
		out.push({
			key,
			kind: subject.kind,
			title,
			pids: subject.pids,
			tids: subject.tids,
			chapters: sorted.map((s) => ({
				id: s.id,
				season: s.season,
				phase:
					subject.kind === "player"
						? playerPhase(arcs, s.season)
						: subject.kind === "team"
							? teamPhase(X, subject.tids[0]!, s.season)
							: subject.kind === "rivalry"
								? rivalryPhase(X, subject.tids[0]!, subject.tids[1]!, s.season)
								: undefined,
			})),
			seasons,
			from: seasons[0]!,
			to: last,
			score: list.reduce((a, s) => a + s.score, 0),
		});
	}
	return out.sort(
		(a, b) =>
			b.seasons.length - a.seasons.length ||
			b.chapters.length - a.chapters.length ||
			b.score - a.score ||
			(a.key < b.key ? -1 : 1),
	);
};
