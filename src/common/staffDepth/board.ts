// The Director's big board: the draft class ranked from the scouting reports (what the user's scouts see), weighted by the priority and
// the team's needs. Pure.
import type { ScoutPriority, ScoutRegion } from "./types.ts";

export type BoardProspect = {
	pid: number;
	name: string;
	// value as the user's scouts see it (valueFuzz)
	value: number;
	// fuzzed ovr/pot
	ovr: number;
	pot: number;
	pos: string;
	age: number;
	region: ScoutRegion;
	// share of his fuzz left (1 = no looks), see fuzzFactorForLooks
	uncertainty: number;
	// the user's board entry
	rank?: number;
	locked?: boolean;
};

export type Needs = { G: number; F: number; C: number };

const GROUPS: Record<string, Partial<Record<keyof Needs, number>>> = {
	PG: { G: 1 },
	SG: { G: 1 },
	G: { G: 1 },
	GF: { G: 0.5, F: 0.5 },
	SF: { F: 1 },
	F: { F: 1 },
	PF: { F: 0.6, C: 0.4 },
	FC: { F: 0.4, C: 0.6 },
	C: { C: 1 },
};

const isGuard = (pos: string) => (GROUPS[pos]?.G ?? 0) >= 0.5;
const isBig = (pos: string) => (GROUPS[pos]?.C ?? 0) >= 0.4;

// The priority the Director works with on Auto: rebuilding teams want upside, contenders players who are ready; a clear need otherwise
export const autoPriority = (
	strategy: "contending" | "rebuilding" | undefined,
	needs: Needs,
): Exclude<ScoutPriority, "auto"> => {
	const maxNeed = Math.max(needs.G, needs.F, needs.C);
	if (maxNeed > 0.12) {
		return "need";
	}
	if (strategy === "rebuilding") {
		return "upside";
	}
	if (strategy === "contending") {
		return "ready";
	}
	return "bpa";
};

// Does a prospect fit the priority (more looks, a bump on the board)?
export const matchesPriority = (
	priority: ScoutPriority,
	p: Pick<BoardProspect, "pos" | "region" | "ovr" | "pot" | "age">,
	needs?: Needs,
) => {
	switch (priority) {
		case "guards":
			return isGuard(p.pos);
		case "bigs":
			return isBig(p.pos);
		case "intl":
			return p.region === "intl";
		case "upside":
			return p.pot - p.ovr >= 14 || p.age <= 19;
		case "ready":
			return p.pot - p.ovr <= 9 || p.age >= 22;
		case "need": {
			if (!needs) {
				return false;
			}
			let need = 0;
			for (const [g, x] of Object.entries(GROUPS[p.pos] ?? { F: 1 })) {
				need += x * needs[g as keyof Needs];
			}
			return need > 0.05;
		}
		default:
			return false;
	}
};

// Board score in value points: value, plus at most about 3 points for the priority and needs, minus a little for a prospect the scouts
// barely know (the Director prefers the players he has seen, about 1 point at no looks)
export const boardScore = (
	p: BoardProspect,
	priority: Exclude<ScoutPriority, "auto">,
	needs: Needs,
) => {
	let s = p.value;
	let need = 0;
	for (const [g, x] of Object.entries(GROUPS[p.pos] ?? { F: 1 })) {
		need += x * needs[g as keyof Needs];
	}
	// Needs always count a little, a lot with the need priority
	s += (priority === "need" ? 8 : 2.5) * need;
	const gap = p.pot - p.ovr;
	if (priority === "upside") {
		s += 0.12 * (gap - 12) + (p.age <= 19 ? 1 : 0);
	} else if (priority === "ready") {
		s += 0.12 * (12 - gap) + (p.age >= 22 ? 0.8 : 0);
	} else if (
		priority === "guards" ||
		priority === "bigs" ||
		priority === "intl"
	) {
		s += matchesPriority(priority, p) ? 2.5 : 0;
	}
	s -= 1.2 * Math.max(0, p.uncertainty - 0.6);
	return Math.round(s * 100) / 100;
};

/**
 * Rank a class: locked prospects keep their rank, the rest fill the other places in board score order. Returns pid -> rank (1 = top).
 */
export const rankBoard = (
	prospects: BoardProspect[],
	priority: Exclude<ScoutPriority, "auto">,
	needs: Needs,
): Map<number, number> => {
	const out = new Map<number, number>();
	const taken = new Set<number>();
	for (const p of prospects) {
		if (p.locked && p.rank !== undefined && !taken.has(p.rank)) {
			out.set(p.pid, p.rank);
			taken.add(p.rank);
		}
	}
	const rest = prospects
		.filter((p) => !out.has(p.pid))
		.map((p) => ({ p, s: boardScore(p, priority, needs) }))
		.sort((a, b) => b.s - a.s || a.p.pid - b.p.pid);
	let rank = 1;
	for (const { p } of rest) {
		while (taken.has(rank)) {
			rank += 1;
		}
		out.set(p.pid, rank);
		taken.add(rank);
	}
	return out;
};

// Summary lines of a board update: new top, the biggest risers and fallers (at least 4 places, top 40 only)
export const summarizeBoardChanges = (
	before: Map<number, number | undefined>,
	after: Map<number, number>,
	names: Map<number, string>,
	max = 5,
) => {
	const lines: string[] = [];
	const moves: { pid: number; from: number; to: number }[] = [];
	for (const [pid, to] of after) {
		const from = before.get(pid);
		if (from !== undefined && from !== to && (from <= 40 || to <= 40)) {
			moves.push({ pid, from, to });
		}
	}
	const top = [...after].find(([, r]) => r === 1)?.[0];
	if (top !== undefined && before.get(top) !== 1) {
		lines.push(`New No. 1: ${names.get(top)}`);
	}
	const risers = moves
		.filter((m) => m.from - m.to >= 4)
		.sort((a, b) => b.from - b.to - (a.from - a.to))
		.slice(0, max);
	const fallers = moves
		.filter((m) => m.to - m.from >= 4)
		.sort((a, b) => b.to - b.from - (a.to - a.from))
		.slice(0, max);
	for (const m of risers) {
		lines.push(`Up: ${names.get(m.pid)} ${m.from} → ${m.to}`);
	}
	for (const m of fallers) {
		lines.push(`Down: ${names.get(m.pid)} ${m.from} → ${m.to}`);
	}
	const added = [...after].filter(
		([pid, r]) => before.get(pid) === undefined && r <= 30,
	);
	if (added.length > 0 && before.size > 0) {
		lines.push(
			`Added: ${added
				.slice(0, 3)
				.map(([pid, r]) => `${names.get(pid)} (${r})`)
				.join(", ")}`,
		);
	}
	return lines;
};
