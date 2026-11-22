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
import { g, local, logEvent } from "../../util/index.ts";
import { userHire } from "../staff/index.ts";
import {
	clearDepthCache,
	nextDevSeason,
	stateOf,
	userControls,
} from "./coaching.ts";
import {
	applyBoardRanks,
	careerOf,
	directorFor,
	getScoutingContext,
	scoutingDepthOn,
	updateBoard,
} from "./scouting.ts";
import { clearScoutingCache, departmentFor } from "../scoutingReports/input.ts";
import { removeSuggestion } from "./suggestions.ts";

// Refuses in spectator mode and while auto play runs: the staff decides then, like for every AI team
const assertControls = (tid: number) => {
	if (!userControls(tid)) {
		throw new Error(
			g.get("spectator")
				? "You're in spectator mode: the staff makes these decisions."
				: local.autoPlayUntil
					? "Auto play is running: the staff makes these decisions."
					: "You don't control this team.",
		);
	}
};

const userTeam = async () => {
	const tid = g.get("userTid");
	assertControls(tid);
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

/**
 * Accept a recommendation or approve a proposal. With a suggestionId, the stored proposal's action is applied (the page may not have all of
 * it, e.g. the plans under the No Visible Ratings challenge). Returns a sentence for the confirmation toast.
 */
export const applyStaffAction = async (
	actionFromPage: SuggestionAction,
	suggestionId?: string,
): Promise<string> => {
	const t = await userTeam();
	const state = stateOf(t);
	const stored = suggestionId
		? state.suggestions?.find((s) => s.id === suggestionId && s.pending)
		: undefined;
	const action = stored?.action ?? actionFromPage;
	let message = "Done.";
	switch (action.type) {
		case "assignRegions": {
			// Applied over the assignments as they are now (not a copy from when the page loaded), and only for scouts still on staff
			const ctx = await getScoutingContext(t.tid);
			if (!ctx) {
				throw new Error("Scouting Director & Regions is off.");
			}
			const ids = new Set(ctx.scouts.map((s) => s.id));
			const moves = Object.entries(action.assignments)
				.map(([id, region]) => [Number(id), region] as const)
				.filter(([id]) => ids.has(id));
			if (moves.length === 0) {
				throw new Error(
					"Those scouts are no longer on your staff. Reload the page for a new recommendation.",
				);
			}
			const regions: Record<number, ScoutRegion> = {};
			for (const s of ctx.scouts) {
				regions[s.id] = ctx.plan.assignments[s.id] as ScoutRegion;
			}
			for (const [id, region] of moves) {
				regions[id] = region;
			}
			const wasAuto = state.delegation.scouting === "auto";
			t.staffDepth = {
				...state,
				manualRegions: regions,
				delegation: {
					...state.delegation,
					// Auto would ignore the kept assignments
					scouting: wasAuto ? "suggest" : state.delegation.scouting,
				},
			};
			await idb.cache.teams.put(t);
			message = wasAuto
				? "Scouts reassigned. Scouting delegation is now Suggest, so the Director keeps these assignments and proposes changes for you to approve."
				: "Scouts reassigned.";
			break;
		}
		case "setPriority":
			await setStaffDepthSettings({ priority: action.priority });
			message = "Scouting priority set.";
			break;
		case "devPlans": {
			const season = action.season ?? nextDevSeason();
			// Merged with plans already approved for the same season (a later proposal only covers players who were missing)
			const prev =
				state.devAccepted?.season === season ? state.devAccepted.plans : {};
			t.staffDepth = {
				...state,
				devAccepted: { season, plans: { ...prev, ...action.plans } },
			};
			await idb.cache.teams.put(t);
			message = `Development plans for ${season} approved.`;
			break;
		}
		case "teamDevPriority":
			await setStaffDepthSettings({
				devPriority: action.focus === "none" ? null : action.focus,
			});
			message = "Team development priority set.";
			break;
		case "hire": {
			// Hire first, then let the current coach go: if the hire fails (he signed elsewhere, was fired by you recently), the job
			// stays filled and no buyout is paid
			await userHire({
				cid: action.cid,
				role: action.role,
				years: 3,
				tid: t.tid,
				replace: true,
			});
			clearDepthCache();
			message = "Coach hired.";
			break;
		}
		case "board":
			await applyBoardRanks(action.ranks);
			message = "Draft board updated.";
			break;
		case "watch": {
			const p = await idb.cache.players.get(action.pid);
			if (p) {
				p.watch = p.watch ?? 1;
				await idb.cache.players.put(p);
			}
			message = "Added to your watch list.";
			break;
		}
	}
	if (suggestionId) {
		await removeSuggestion(t.tid, suggestionId);
	}
	return message;
};

export const dismissStaffSuggestion = async (id: string) => {
	const t = await userTeam();
	await removeSuggestion(t.tid, id);
};

// Staff Report: dismiss a recommendation for the rest of the season, or bring it back
const MAX_DISMISSED_RECS = 50;
export const dismissStaffRecommendation = async (id: string, undo = false) => {
	const t = await userTeam();
	const state = stateOf(t);
	const season = g.get("season");
	let ids =
		state.dismissedRecs?.season === season ? [...state.dismissedRecs.ids] : [];
	ids = ids.filter((x) => x !== id);
	if (!undo && id !== "none") {
		ids.push(id);
	}
	state.dismissedRecs = { season, ids: ids.slice(-MAX_DISMISSED_RECS) };
	if (ids.length === 0) {
		delete state.dismissedRecs;
	}
	t.staffDepth = state;
	await idb.cache.teams.put(t);
};

export const setDraftBoardLock = async (pid: number, locked: boolean) => {
	assertControls(g.get("userTid"));
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

/**
 * Scout track records: the user acts on them. Promote a scout to Director of Scouting (the Director leaves; the scout's slot gets a new
 * hire) or let a scout go (his slot's next scout starts now; one hired this season leaves after it). Effective this season.
 */
export const manageScout = async (
	scoutId: number,
	what: "promote" | "fire",
): Promise<string> => {
	if (!scoutingDepthOn()) {
		throw new Error("Scouting Director & Regions is off.");
	}
	const t = await userTeam();
	const season = g.get("season");
	const dept = await departmentFor(t.tid);
	const s = dept.scouts.find((x) => x.id === scoutId);
	if (!s) {
		throw new Error("He isn't one of your scouts.");
	}
	const career = careerOf(t);
	if (career.cuts[s.id] !== undefined && career.cuts[s.id]! <= season + 1) {
		throw new Error(`${s.name} is already on his way out.`);
	}
	let message: string;
	if (what === "fire") {
		// (a cut must come after his first season in the chain)
		const leaves = s.since < season ? season : season + 1;
		career.cuts[s.id] = leaves;
		career.cutWhy = { ...career.cutWhy, [s.id]: "fired" };
		message =
			leaves === season
				? `You let ${s.name} go. A new scout takes his place.`
				: `${s.name} will leave after this season (he was only hired this year).`;
		career.log.push({ season, text: `Let go of ${s.name}` });
	} else {
		if (s.since >= season) {
			throw new Error(
				`${s.name} was hired this season: give him a season before promoting him.`,
			);
		}
		const old = directorFor(t, season, dept.level);
		career.cuts[s.id] = season;
		career.cutWhy = { ...career.cutWhy, [s.id]: "promoted" };
		if (!career.dirs.some((d) => d.since <= season - 1)) {
			// Keep the outgoing Director in the history
			career.dirs.unshift({ id: old.id, since: old.since, how: "hired" });
		}
		career.dirs = career.dirs.filter((d) => d.since !== season);
		career.dirs.push({
			id: s.id,
			since: season,
			how: "promoted",
			q: s.quality,
			age: s.age,
		});
		message = `${s.name} is your new Director of Scouting. ${old.name} is out, and a new scout fills ${s.name}'s old job.`;
		career.log.push({
			season,
			text: `${s.name} was promoted to Director of Scouting (${old.name} was replaced)`,
		});
	}
	career.log = career.log.slice(-30);
	t.scoutCareer = career;
	await idb.cache.teams.put(t);
	clearScoutingCache();
	clearDepthCache();
	await logEvent({
		type: "info",
		category: "draft",
		text: message,
		showNotification: false,
		tids: [t.tid],
		score: 0,
	});
	return message;
};
