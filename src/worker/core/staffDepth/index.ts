// Scouting Director & Regions and Coaching Staff Depth (League Extras). See docs/native-features.md.
import { PHASE } from "../../../common/constants.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import {
	coachingDepthOn,
	staffFocusFor,
	stateOf,
	userControls,
} from "./coaching.ts";
import { addSuggestion, removeSuggestion } from "./suggestions.ts";
import {
	afterDay as scoutingAfterDay,
	afterNewPhase as scoutingAfterNewPhase,
	scoutingDepthOn,
} from "./scouting.ts";
import { FOCUSES } from "../../../common/staffDepth/devPlans.ts";
import type { FocusKey } from "../../../common/staffDepth/types.ts";

export { coachingDepthOn, scoutingDepthOn };

const safely = async (what: string, fn: () => Promise<void>) => {
	try {
		await fn();
	} catch (error) {
		// Background staff work must never stop the season
		console.error(`Staff depth (${what}) failed`, error);
	}
};

// Development delegation Suggest: after the playoffs the staff proposes next season's plans. In the preseason it proposes again for
// anyone still without an approved plan for next season (draftees, signings and trade arrivals since the last proposal)
export const proposeDevPlans = async (missingOnly?: boolean) => {
	// Every user team in multi team mode
	for (const tid of g.get("userTids")) {
		await proposeDevPlansFor(tid, missingOnly);
	}
};

const proposeDevPlansFor = async (tid: number, missingOnly?: boolean) => {
	const t = await idb.cache.teams.get(tid);
	if (!t || !userControls(tid)) {
		return;
	}
	const state = stateOf(t);
	if (state.delegation.development !== "suggest") {
		return;
	}
	const season = g.get("season") + 1;
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	const accepted =
		state.devAccepted?.season === season ? state.devAccepted.plans : {};
	const pending = state.suggestions?.find(
		(x) => x.id === `dev-${season}` && x.action.type === "devPlans",
	);
	if (missingOnly && pending) {
		// The full proposal is still waiting for an answer
		return;
	}
	const plans: Record<number, FocusKey> = {};
	const lines: string[] = [];
	for (const p of players) {
		if (state.devOverrides?.[p.pid]) {
			continue;
		}
		if (missingOnly && accepted[p.pid]) {
			continue;
		}
		const f = staffFocusFor(p, season, state.devPriority);
		plans[p.pid] = f;
		lines.push(`${p.firstName} ${p.lastName}: ${FOCUSES[f].name}`);
	}
	if (!missingOnly) {
		// Replaced by the full proposal
		await removeSuggestion(tid, `dev-${season}-missing`);
	}
	if (lines.length === 0) {
		return;
	}
	await addSuggestion(tid, {
		id: missingOnly ? `dev-${season}-missing` : `dev-${season}`,
		area: "development",
		season: g.get("season"),
		title: missingOnly
			? `Development plans for ${season}: players without one`
			: `Development plans for ${season}`,
		text: lines.join("; "),
		action: { type: "devPlans", plans, season },
		pending: true,
	});
};

export const afterNewPhase = async (phase: number) => {
	if (scoutingDepthOn()) {
		await safely("scouting", () => scoutingAfterNewPhase(phase));
	}
	if (coachingDepthOn() && phase === PHASE.DRAFT_LOTTERY) {
		await safely("development plans", () => proposeDevPlans());
	}
	if (coachingDepthOn() && phase === PHASE.PRESEASON) {
		await safely("development plans", () => proposeDevPlans(true));
	}
};

export const afterDay = async () => {
	if (scoutingDepthOn()) {
		await safely("weekly scouting", scoutingAfterDay);
	}
};
