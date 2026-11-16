// Frozen Pre-draft Ranks setting (pure part). A prospect's rank is where he stood in his whole class when the draft started, never
// among the players still on the board: otherwise the best player left becomes "#1" as soon as the top of the class is gone, and a
// second-round prospect can show up as No. 1 late in the draft. The live order of the players left is a separate "Best available"
// list. See worker/core/draft/preDraftRanks.ts and docs/native-features.md.

export type PreDraftRankInfo = {
	// Rank on your scouts' list (their view of each prospect's value, with scouting fuzz), 1 = best
	r: number;
	// Rank on the consensus board (true value, the order the AI drafts in), 1 = best
	v: number;
	// Class size
	n: number;
	// frozen: the snapshot taken when the draft started. class: recounted over the whole class, drafted players included (values don't
	// change until the next season). scout: from the scouts' last stored snapshot of the class (overall grade), for older classes
	src: "frozen" | "class" | "scout";
};

type ClassMember = {
	pid: number;
	value: number;
	valueFuzz: number;
};

const rankBy = <T extends { pid: number }>(
	list: readonly T[],
	score: (x: T) => number,
) => {
	// Ties by pid, so the order never depends on the order players were read in
	const sorted = [...list].sort((a, b) => score(b) - score(a) || a.pid - b.pid);
	return new Map(sorted.map((x, i) => [x.pid, i + 1]));
};

// Ranks over the whole class, drafted or not
export const rankClass = (members: readonly ClassMember[]) => {
	const r = rankBy(members, (x) => x.valueFuzz);
	const v = rankBy(members, (x) => x.value);
	const out = new Map<number, { r: number; v: number; n: number }>();
	for (const x of members) {
		out.set(x.pid, { r: r.get(x.pid)!, v: v.get(x.pid)!, n: members.length });
	}
	return out;
};

// Old classes with no snapshot: the scouts' overall grade in their last stored snapshot of the draft year
export const rankByScoutGrade = (
	members: readonly { pid: number; o: number }[],
) => rankBy(members, (x) => x.o);

// The pick he went at against his pre-draft rank: positive = taken later than his rank (a steal), negative = earlier (a reach).
// Small differences are noise, not a steal or a reach.
export const STEAL_REACH_MIN = 5;
export const stealOrReach = (overallPick: number, preDraftRank: number) => {
	const diff = overallPick - preDraftRank;
	const kind: "steal" | "reach" | undefined =
		Math.abs(diff) < STEAL_REACH_MIN ? undefined : diff > 0 ? "steal" : "reach";
	return { diff, kind };
};

export const preDraftRankText = (rank: number) => `Pre-draft #${rank}`;

export const draftedVsPreDraftText = (overallPick: number, rank: number) =>
	`Drafted #${overallPick} · ${preDraftRankText(rank)}`;
