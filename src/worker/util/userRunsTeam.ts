import g from "./g.ts";
import local from "./local.ts";

/**
 * The user makes this team's decisions right now: it's one of his teams, spectator mode is off and auto play isn't running.
 * Otherwise the AI runs it, and the user's settings for it (rotation, playing time, shot plans, scheme, negotiations) are ignored.
 * Use this instead of writing the three checks out, so spectator mode and auto play are always treated the same.
 */
export const userRunsTeam = (tid: number) =>
	!g.get("spectator") &&
	local.autoPlayUntil === undefined &&
	g.get("userTids").includes(tid);
