import type { LeagueIndex } from "../../common/wrapped/league.ts";
import {
	findStoriesAsync,
	type Story,
} from "../../common/storylines/index.ts";
import { buildThreads, type Thread } from "../../common/storylines/threads.ts";
import { whyOf, type WhySection } from "../../common/storylines/why.ts";
import {
	getWrapped,
	memoize,
	yieldToWorker,
	type Built,
} from "./wrappedData.ts";
import { wperfTime } from "./wrappedPerf.ts";

type State = {
	X: LeagueIndex;
	stories: Story[];
	byId: Map<string, Story>;
	rank: Map<string, { kindRank: number; kindCount: number; rank: number }>;
	threads: Thread[];
};

// Stories and threads are found once per snapshot (the snapshot itself is rebuilt when the league changes), without holding up the worker
export const getStoryState = (built: Built): Promise<State> =>
	memoize(built, "storyState", async () => {
		const { X } = built;
		const stories = await wperfTime("storylines.find", () =>
			findStoriesAsync(X, yieldToWorker),
		);
		const kindCounts = new Map<string, number>();
		for (const s of stories) {
			kindCounts.set(s.kind, (kindCounts.get(s.kind) ?? 0) + 1);
		}
		// Position within its kind, by score
		const byKind = new Map<string, Story[]>();
		for (const s of stories) {
			byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
		}
		const rank = new Map<
			string,
			{ kindRank: number; kindCount: number; rank: number }
		>();
		for (const list of byKind.values()) {
			[...list]
				.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
				.forEach((s, i) => {
					rank.set(s.id, {
						kindRank: i + 1,
						kindCount: list.length,
						rank: 0,
					});
				});
		}
		stories.forEach((s, i) => {
			rank.get(s.id)!.rank = i + 1;
		});
		return {
			X,
			stories,
			byId: new Map(stories.map((s) => [s.id, s])),
			rank,
			threads: buildThreads(X, stories),
		};
	});

export const getStorylineWhy = async (
	id: string,
): Promise<WhySection[] | undefined> => {
	const state = await getStoryState(await getWrapped());
	const story = state.byId.get(id);
	const r = state.rank.get(id);
	if (!story || !r) {
		return undefined;
	}
	return whyOf(state.X, story, {
		kindRank: r.kindRank,
		kindCount: r.kindCount,
		rank: r.rank,
		total: state.stories.length,
	});
};
