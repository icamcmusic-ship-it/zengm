// Coach Decisions (the coachDecisions setting): the switch and promised roles. Kept apart from staff/coachDecisions.ts, with only light
// imports, since player signing and mood read it (staff/coachDecisions.ts pulls in the coaching systems and would make an import cycle).

import type { RolePromise } from "../../../common/coachDecisions.ts";
import { PHASE } from "../../../common/constants.ts";
import { nativeFeatureEnabled } from "../../../common/nativeFeatures.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, local } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

// Needs Coaching Staff, Coaching Systems and Realistic Rotations
export const coachDecisionsOn = () =>
	__SPORT === "basketball" &&
	!!g.get("coachingStaff") &&
	nativeFeatureEnabled("coachSystems", (key) => g.get(key as any)) &&
	featureOn("coachDecisions") &&
	nativeFeatureEnabled("realisticRotations", (key) => g.get(key as any));

// A team the user runs himself (not spectator mode or auto play)
export const isUserRun = (tid: number) =>
	g.get("userTids").includes(tid) &&
	!g.get("spectator") &&
	local.autoPlayUntil === undefined;

export const PROMISE = {
	// Games before a promise can be judged, the share of games it must be kept in
	minGames: 15,
	keep: 0.6,
	// Mood: kept, broken (at most), and offered in a negotiation
	keptMood: 0.5,
	brokenMood: -3,
	offerStarter: 1.25,
	offerRotation: 0.6,
};

/** The "Promised role" mood component: a promise to him being kept or broken, or the role offered in this negotiation. */
export const rolePromiseMood = (
	promise: RolePromise | undefined,
	tid: number,
	offered?: "starter" | "rotation",
) => {
	let mood = 0;
	if (offered) {
		mood +=
			offered === "starter" ? PROMISE.offerStarter : PROMISE.offerRotation;
	}
	if (
		promise &&
		promise.tid === tid &&
		promise.season === g.get("season") &&
		promise.g >= PROMISE.minGames
	) {
		const share = promise.ok / promise.g;
		mood +=
			share >= PROMISE.keep
				? PROMISE.keptMood * (promise.role === "starter" ? 1 : 0.6)
				: (PROMISE.brokenMood * (PROMISE.keep - share)) / PROMISE.keep;
	}
	return Math.round(mood * 100) / 100;
};

/**
 * An AI team's promise to a player it signs: a starting job if he'd be among its 4 best players, a rotation spot among its 7 best
 * (players of some value only). The user's promises come from the negotiation.
 */
export const aiRolePromise = async (
	p: Player,
	tid: number,
	exp: number,
): Promise<RolePromise | undefined> => {
	if (!coachDecisionsOn() || isUserRun(tid)) {
		return undefined;
	}
	const teammates = (await idb.cache.players.indexGetAll("playersByTid", tid))
		.filter((p2) => p2.pid !== p.pid)
		.map((p2) => p2.valueNoPot)
		.sort((a, b) => b - a);
	const rank = teammates.filter((v) => v > p.valueNoPot).length;
	const role = rank < 4 ? "starter" : rank < 7 ? "rotation" : undefined;
	if (!role || p.valueNoPot < 45) {
		return undefined;
	}
	return newPromise(tid, role, exp, "ai");
};

// A promise made now: it covers the season a contract signed now starts in and, for a longer contract, the next one
export const newPromise = (
	tid: number,
	role: "starter" | "rotation",
	exp: number,
	by: "user" | "ai",
): RolePromise => {
	const season =
		g.get("phase") > PHASE.PLAYOFFS ? g.get("season") + 1 : g.get("season");
	return {
		tid,
		role,
		exp: Math.max(season, Math.min(exp, season + 1)),
		by,
		season,
		g: 0,
		ok: 0,
	};
};
