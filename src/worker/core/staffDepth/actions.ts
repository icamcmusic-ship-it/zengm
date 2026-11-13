// User actions of the Staff Report, the Scouting Department and the Draft Board (worker API)
import { PHASE } from "../../../common/constants.ts";
import type {
	DelegationArea,
	DelegationLevel,
	FocusKey,
	ScoutPriority,
	ScoutRegion,
	SuggestionAction,
} from "../../../common/staffDepth/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { getTeamStaff, userFire, userHire } from "../staff/index.ts";
import { clearDepthCache, stateOf } from "./coaching.ts";
import {
	applyBoardRanks,
	getScoutingContext,
	updateBoard,
} from "./scouting.ts";
import { removeSuggestion } from "./suggestions.ts";

const userTeam = async () => {
	const tid = g.get("userTid");
	const t = await idb.cache.teams.get(tid);
	if (!t) {
		throw new Error("No team");
	}
	return t;
};

export const setStaffDepthSettings = async (settings: {
	priority?: ScoutPriority;
	delegation?: Partial<Record<DelegationArea, DelegationLevel>>;
	devPriority?: FocusKey | null;
}) => {
	const t = await userTeam();
	const state = stateOf(t);
	if (settings.priority) {
		state.priority = settings.priority;
	}
	if (settings.delegation) {
		state.delegation = { ...state.delegation, ...settings.delegation };
		if (settings.delegation.scouting === "auto") {
			delete state.manualRegions;
		} else if (settings.delegation.scouting && !state.manualRegions) {
			// Suggest/Manual start from the Director's current plan
			t.staffDepth = state;
			const ctx = await getScoutingContext(t.tid);
			if (ctx) {
				state.manualRegions = { ...ctx.plan.assignments };
			}
		}
	}
	if (settings.devPriority !== undefined) {
		state.devPriority = settings.devPriority ?? undefined;
	}
	t.staffDepth = state;
	await idb.cache.teams.put(t);
	if (settings.priority) {
		const ctx = await getScoutingContext(t.tid);
		if (ctx && g.get("phase") <= PHASE.DRAFT) {
			await updateBoard(ctx, "New priority");
		}
	}
};

export const setDevOverride = async (pid: number, focus: FocusKey | null) => {
	const t = await userTeam();
	const state = stateOf(t);
	const overrides = { ...state.devOverrides };
	if (focus) {
		overrides[pid] = focus;
	} else {
		delete overrides[pid];
	}
	t.staffDepth = { ...state, devOverrides: overrides };
	await idb.cache.teams.put(t);
};

export const setScoutRegion = async (scoutId: number, region: ScoutRegion) => {
	const t = await userTeam();
	const ctx = await getScoutingContext(t.tid);
	const state = stateOf(t);
	const regions = { ...(state.manualRegions ?? ctx?.plan.assignments) };
	regions[scoutId] = region;
	t.staffDepth = {
		...state,
		manualRegions: regions,
		// Assigning by hand keeps the Director from moving him back
		delegation: {
			...state.delegation,
			scouting:
				state.delegation.scouting === "auto"
					? "manual"
					: state.delegation.scouting,
		},
	};
	await idb.cache.teams.put(t);
};

export const applyStaffAction = async (
	action: SuggestionAction,
	suggestionId?: string,
) => {
	const t = await userTeam();
	const state = stateOf(t);
	switch (action.type) {
		case "assignRegions":
			t.staffDepth = {
				...state,
				manualRegions: action.assignments,
				delegation: {
					...state.delegation,
					scouting:
						state.delegation.scouting === "auto"
							? "suggest"
							: state.delegation.scouting,
				},
			};
			await idb.cache.teams.put(t);
			break;
		case "setPriority":
			await setStaffDepthSettings({ priority: action.priority });
			break;
		case "devPlans": {
			const season =
				g.get("phase") >= PHASE.PLAYOFFS
					? g.get("season") + 1
					: g.get("season");
			t.staffDepth = {
				...state,
				devAccepted: { season, plans: action.plans },
			};
			await idb.cache.teams.put(t);
			break;
		}
		case "teamDevPriority":
			await setStaffDepthSettings({
				devPriority: action.focus === "none" ? null : action.focus,
			});
			break;
		case "hire": {
			const staff = await getTeamStaff(t.tid);
			const current = staff[action.role];
			if (current) {
				await userFire({ cid: current.cid, tid: t.tid });
			}
			await userHire({
				cid: action.cid,
				role: action.role,
				years: 3,
				tid: t.tid,
			});
			clearDepthCache();
			break;
		}
		case "board":
			await applyBoardRanks(action.ranks);
			break;
		case "watch": {
			const p = await idb.cache.players.get(action.pid);
			if (p) {
				p.watch = p.watch ?? 1;
				await idb.cache.players.put(p);
			}
			break;
		}
	}
	if (suggestionId) {
		await removeSuggestion(t.tid, suggestionId);
	}
};

export const dismissStaffSuggestion = async (id: string) => {
	await removeSuggestion(g.get("userTid"), id);
};

export const setDraftBoardLock = async (pid: number, locked: boolean) => {
	const p = await idb.cache.players.get(pid);
	if (!p || !p.draftBoard) {
		return;
	}
	p.draftBoard = { ...p.draftBoard, locked: locked || undefined };
	if (!locked) {
		delete p.draftBoard.locked;
	}
	await idb.cache.players.put(p);
};
