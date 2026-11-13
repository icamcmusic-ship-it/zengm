// Staff suggestions (Staff Report): recommendations and, with a delegation level of Suggest, proposals waiting for the user's approval.
// Stored on the user's team (t.staffDepth.suggestions).
import type { StaffSuggestion } from "../../../common/staffDepth/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { stateOf } from "./coaching.ts";

// Keep this season's and last season's (a proposal from the offseason stays until it is answered)
const prune = (list: StaffSuggestion[]) => {
	const season = g.get("season");
	return list.filter((s) => s.season >= season - 1).slice(-30);
};

export const addSuggestion = async (tid: number, s: StaffSuggestion) => {
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return;
	}
	const state = stateOf(t);
	const list = (state.suggestions ?? []).filter((x) => x.id !== s.id);
	list.push(s);
	t.staffDepth = { ...state, suggestions: prune(list) };
	await idb.cache.teams.put(t);
};

export const removeSuggestion = async (tid: number, id: string) => {
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return undefined;
	}
	const state = stateOf(t);
	const found = state.suggestions?.find((x) => x.id === id);
	t.staffDepth = {
		...state,
		suggestions: (state.suggestions ?? []).filter((x) => x.id !== id),
	};
	await idb.cache.teams.put(t);
	return found;
};

export const removeSuggestionsWhere = async (
	tid: number,
	fn: (s: StaffSuggestion) => boolean,
) => {
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		return;
	}
	const state = stateOf(t);
	t.staffDepth = {
		...state,
		suggestions: (state.suggestions ?? []).filter((x) => !fn(x)),
	};
	await idb.cache.teams.put(t);
};
