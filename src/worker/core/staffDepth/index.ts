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
import { addSuggestion } from "./suggestions.ts";
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

// Development delegation Suggest: after the playoffs the staff proposes next season's plans
const proposeDevPlans = async () => {
	const tid = g.get("userTid");
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
	const plans: Record<number, FocusKey> = {};
	const lines: string[] = [];
	for (const p of players) {
		if (state.devOverrides?.[p.pid]) {
			continue;
		}
		const f = staffFocusFor(p, season, state.devPriority);
		plans[p.pid] = f;
		lines.push(`${p.firstName} ${p.lastName}: ${FOCUSES[f].name}`);
	}
	if (lines.length === 0) {
		return;
	}
	await addSuggestion(tid, {
		id: `dev-${season}`,
		area: "development",
		season: g.get("season"),
		title: `Development plans for ${season}`,
		text: lines.join("; "),
		action: { type: "devPlans", plans },
		pending: true,
	});
};

export const afterNewPhase = async (phase: number) => {
	if (scoutingDepthOn()) {
		await safely("scouting", () => scoutingAfterNewPhase(phase));
	}
	if (coachingDepthOn() && phase === PHASE.DRAFT_LOTTERY) {
		await safely("development plans", proposeDevPlans);
	}
};

export const afterDay = async () => {
	if (scoutingDepthOn()) {
		await safely("weekly scouting", scoutingAfterDay);
	}
};
