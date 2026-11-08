import { rawEngine } from "./engine.generated.ts";
import type { AchievementDef } from "./defs.ts";
import type { AData } from "./adapter.ts";

// Types for the engine (engine.generated.ts, the League Explorer's own engine, verbatim).

// One occurrence of a feat: who (pid), for which team (tid), when (season, and `at`, a sortable moment inside the league's history), where (gid: a box score, eid: a trade event)
export type Occurrence = {
	pid?: number;
	tid?: number;
	season?: number;
	gid?: number;
	eid?: number;
	at?: number;
	// The other team (a series opponent) or player (a relative)
	other?: number;
	note?: string;
	cat?: string;
	v?: number;
};

export type Best = {
	v: number;
	pid?: number;
	tid?: number;
	season?: number;
	gid?: number;
	eid?: number;
	other?: number;
};

export type AchResult = {
	id: string;
	// unavailable: the league doesn't have the data this tier needs (never "locked at 0")
	state: "unlocked" | "locked" | "unavailable";
	count: number;
	// The first occurrence that reached the tier
	first: Occurrence | null;
	// The league's best value so far (null: nothing qualifying recorded yet)
	best: Best | null;
	// 0..1 toward the threshold, from best
	progress: number;
	// Unlocked only: occurrences per team, and per season
	byTeam?: Map<number, { n: number; first: Occurrence }>;
	bySeason?: Map<number, { n: number; first: Occurrence }>;
};

export type CountSummary = {
	total: number;
	unlocked: number;
	unavailable: number;
};

export type EngineSummary = CountSummary & {
	possible: number;
	pct: number;
	byRarity: Record<string, CountSummary>;
	byTopic: Record<string, CountSummary>;
};

export type EngineRun = {
	// First season that counts (the league's own seasons)
	own: number;
	// Which kinds of data the league has
	have: Record<string, boolean>;
	results: Map<string, AchResult>;
	summary: EngineSummary;
};

const E = rawEngine as unknown as {
	compute: (
		data: AData,
		opts?: { budget?: number },
	) => Generator<unknown, EngineRun>;
	run: (data: AData) => EngineRun;
	ownFrom: (data: AData) => number;
	progressOf: (d: AchievementDef, v: number | null | undefined) => number;
	nextTier: (
		results: Map<string, AchResult>,
		d: AchievementDef,
	) => {
		d: AchievementDef;
		r: AchResult;
		progress: number;
		best: Best | null;
	} | null;
	closestNext: (
		results: Map<string, AchResult>,
		opts?: { topic?: string; rarity?: string; n?: number },
	) => { d: AchievementDef; r: AchResult }[];
	teamView: (
		results: Map<string, AchResult>,
		data: AData,
		tid: number,
	) => {
		tids: number[];
		items: { d: AchievementDef; r: AchResult; n: number; first: Occurrence }[];
		byRarity: Record<string, number>;
		total: number;
	};
	ladders: () => Map<string, AchievementDef[]>;
};

// A generator: yields between steps so a caller can let other work run
export const computeAchievements = (data: AData) =>
	E.compute(data, { budget: 25 });
export const runAchievements = (data: AData) => E.run(data);
export const ownFrom = (data: AData) => E.ownFrom(data);
export const progressOf = (d: AchievementDef, v: number | null | undefined) =>
	E.progressOf(d, v);
export const nextTier = E.nextTier;
export const closestNext = E.closestNext;
export const teamView = E.teamView;
export const ladders = E.ladders;
