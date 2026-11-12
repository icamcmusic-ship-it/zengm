// College mode: actions from the Recruiting page (docs/college-mode.md)
import { PHASE, PLAYER } from "../../../common/constants.ts";
import type { PlayerRecruit } from "../../../common/college/types.ts";
import { idb } from "../../db/index.ts";
import { g, lock, toUI } from "../../util/index.ts";
import type { Conditions } from "../../../common/types.ts";
import type { Pitch, RecruitAction } from "../../../common/college/interest.ts";
import { advanceOffseasonWeek, userAction } from "./recruiting.ts";
import { league } from "../index.ts";
import { autoSetTargets } from "./offseason.ts";
import { isCollege } from "./isCollege.ts";
import { setRedshirt } from "./redshirt.ts";

const canEdit = () =>
	isCollege() && g.get("phase") >= 0 && g.get("phase") <= PHASE.RESIGN_PLAYERS;

// Renumber the user's targets 1, 2, 3, ... in their current order
const renumber = async () => {
	const recruits = (
		await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
	).filter(
		(p) =>
			p.draft.year === g.get("season") &&
			(p as any).recruit?.userTarget !== undefined,
	);
	recruits.sort(
		(a, b) => (a as any).recruit.userTarget - (b as any).recruit.userTarget,
	);
	for (const [i, p] of recruits.entries()) {
		const recruit = (p as any).recruit as PlayerRecruit;
		if (recruit.userTarget !== i + 1) {
			recruit.userTarget = i + 1;
			await idb.cache.players.put(p);
		}
	}
};

export const collegeSetTarget = async ({
	pid,
	target,
}: {
	pid: number;
	target: boolean;
}) => {
	if (!canEdit()) {
		return;
	}
	const p = await idb.cache.players.get(pid);
	const recruit = (p as any)?.recruit as PlayerRecruit | undefined;
	if (!p || !recruit || p.tid !== PLAYER.UNDRAFTED) {
		return;
	}
	if (target) {
		recruit.userTarget = 1e6;
	} else {
		delete recruit.userTarget;
	}
	await idb.cache.players.put(p);
	await renumber();
	await toUI("realtimeUpdate", [["playerMovement"]]);
};

export const collegeAutoTargets = async () => {
	if (!canEdit()) {
		return;
	}
	await autoSetTargets();
	await toUI("realtimeUpdate", [["playerMovement"]]);
};

export const collegeSetAutoRecruit = async (auto: boolean) => {
	if (!isCollege()) {
		return;
	}
	await league.setGameAttributes({ collegeAutoRecruit: auto });
	await toUI("realtimeUpdate", [["gameAttributes"]]);
};

export const collegeSetRedshirt = async ({
	pid,
	redshirt,
}: {
	pid: number;
	redshirt: boolean;
}) => {
	const p = await idb.cache.players.get(pid);
	if (!isCollege() || !p || p.tid !== g.get("userTid")) {
		return;
	}
	await setRedshirt(p, redshirt);
	await toUI("realtimeUpdate", [["playerMovement"]]);
};

export const collegeRecruitAction = async ({
	pid,
	action,
	pitch,
}: {
	pid: number;
	action: RecruitAction | "nil" | "withdraw";
	pitch?: Pitch;
}) => {
	if (!isCollege()) {
		return "Not a college league.";
	}
	const error = await userAction({ pid, action, pitch });
	await toUI("realtimeUpdate", [["playerMovement"]]);
	return error;
};

export const collegeAdvanceRecruitingWeek = async (
	_: unknown,
	conditions: Conditions,
) => {
	if (!isCollege() || lock.get("newPhase") || lock.get("gameSim")) {
		return false;
	}
	const done = await advanceOffseasonWeek(conditions);
	await toUI("realtimeUpdate", [["playerMovement"]]);
	return done;
};
