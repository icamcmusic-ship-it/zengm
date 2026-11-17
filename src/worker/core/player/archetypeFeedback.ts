// Archetype feedback and tuning (archfb), the worker side: the user's "Doesn't fit?" picks (per league, in the
// "archetypeFeedback" game attribute, so they travel with the league file), the browser-wide copy that makes the tuning
// follow the user across leagues (the meta DB, "Use my archetype picks in all leagues", on by default), the per-player
// overrides (the user's pick is his label until the user clears it) and the active tuning fitted from all the picks
// (common/archetypes/tuning.ts), which the reading (archetype.ts classifyPlayer) puts on top of the shipped model.
import { idb } from "../../db/index.ts";
import { getMetaAttribute, putMetaAttribute } from "../../db/metaAttributes.ts";
import { g } from "../../util/index.ts";
import {
	EMPTY_TUNING,
	fitTuning,
	mergePicks,
	type FeedbackPick,
	type Tuning,
} from "../../../common/archetypes/tuning.ts";
import { modelFor } from "../../../common/archetypes/classify.ts";
import { refsFromPicks } from "../../../common/archetypes/v2/picks.ts";
import type { RefRow } from "../../../common/archetypes/v2/knn.ts";

export const FEEDBACK_KEY = "archetypeFeedback";
export const GLOBAL_KEY = "archetypeFeedbackGlobal" as const;

export type LeagueFeedback = {
	picks: FeedbackPick[];
	// pid -> the build the user picked for him (shown instead of the reading until cleared)
	overrides: Record<string, { id: string; at: number; uid: string }>;
};
export type GlobalFeedback = { enabled: boolean; picks: FeedbackPick[] };

const emptyLeague = (): LeagueFeedback => ({ picks: [], overrides: {} });

export const leagueFeedback = (): LeagueFeedback => {
	const s = Object.hasOwn(g, FEEDBACK_KEY)
		? (g.get(FEEDBACK_KEY as any) as LeagueFeedback | undefined)
		: undefined;
	return s && Array.isArray(s.picks)
		? { picks: s.picks, overrides: s.overrides ?? {} }
		: emptyLeague();
};

export const saveLeagueFeedback = async (value: LeagueFeedback) => {
	g.setWithoutSavingToDB(FEEDBACK_KEY as any, value);
	await idb.cache.gameAttributes.put({ key: FEEDBACK_KEY, value } as any);
};

// The browser-wide store (the meta DB's attributes; tests and environments without it fall back to memory)
let globalMemory: GlobalFeedback = { enabled: true, picks: [] };
export const getGlobalFeedback = async (): Promise<GlobalFeedback> => {
	try {
		if (idb.meta) {
			const v = await getMetaAttribute(GLOBAL_KEY);
			if (v && Array.isArray(v.picks)) {
				globalMemory = { enabled: v.enabled !== false, picks: v.picks };
			}
		}
	} catch {}
	return globalMemory;
};
export const saveGlobalFeedback = async (value: GlobalFeedback) => {
	globalMemory = value;
	try {
		if (idb.meta) {
			await putMetaAttribute(GLOBAL_KEY, value);
		}
	} catch {}
};
// (tests)
export const resetGlobalFeedbackMemory = async () => {
	await saveGlobalFeedback({ enabled: true, picks: [] });
};

// The picks the tuning is fitted from: this league's, plus the browser-wide ones when that is on
export const tuningPicks = async (): Promise<FeedbackPick[]> => {
	const league = leagueFeedback().picks;
	const glob = await getGlobalFeedback();
	return glob.enabled ? mergePicks(glob.picks, league) : league;
};

let active:
	| { lid: unknown; tuning: Tuning; refs: RefRow[]; refsKey: string }
	| undefined;

// The tuning in force (none until the first refit for this league)
export const activeTuning = (): Tuning =>
	active && active.lid === g.get("lid") ? active.tuning : EMPTY_TUNING;

// archv3: the picks as labeled players for the reading's neighbours (common/archetypes/v2/picks.ts), with a key that
// changes when they do
const NO_REFS = { refs: [] as RefRow[], refsKey: "" };
export const activePickRefs = (): { refs: RefRow[]; refsKey: string } =>
	active && active.lid === g.get("lid") ? active : NO_REFS;

const hashString = (str: string) => {
	let h = 5381;
	for (let i = 0; i < str.length; i++) {
		h = (Math.imul(h, 33) ^ str.charCodeAt(i)) >>> 0;
	}
	return `${str.length}:${h.toString(36)}`;
};

export const refitArchetypeTuning = async (): Promise<Tuning> => {
	const picks = await tuningPicks();
	const tuning = fitTuning(picks, modelFor);
	const labeled = picks.filter((p) => p.picked && p.input?.ratings);
	active = {
		lid: g.get("lid"),
		tuning,
		refs: refsFromPicks(labeled),
		refsKey: hashString(
			labeled
				.map((p) => `${p.uid}=${p.picked}`)
				.sort()
				.join(","),
		),
	};
	return tuning;
};

export const resetArchetypeTuning = () => {
	active = undefined;
};

// After a pick: refit once the user stops picking for a moment (tests refit at once)
let timer: ReturnType<typeof setTimeout> | undefined;
export const scheduleRefit = async () => {
	if (__NODE_ENV === "test") {
		await refitArchetypeTuning();
		return;
	}
	if (timer) {
		clearTimeout(timer);
	}
	timer = setTimeout(() => {
		timer = undefined;
		refitArchetypeTuning().catch((error) => console.error(error));
	}, 250);
};

// The user's pick for a player, if any
export const overrideFor = (pid: number): string | undefined =>
	leagueFeedback().overrides[String(pid)]?.id;
