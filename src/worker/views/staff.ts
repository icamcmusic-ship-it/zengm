import { levelToEffect, coachingEffect } from "../../common/budgetLevels.ts";
import { PHASE } from "../../common/constants.ts";
import {
	COACH_FREE_AGENT,
	COACH_ROLES,
	COACH_ROLE_NAMES,
} from "../../common/staff.ts";
import type { CoachRole } from "../../common/types.ts";
import { finances } from "../core/index.ts";
import {
	getBuyout,
	getStaffLevel,
	getStaffPayroll,
} from "../core/staff/index.ts";
import { idb } from "../db/index.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { validateTeam } from "../util/processInputs.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import {
	STAFF_DISABLED_MESSAGE,
	formatCoach,
	staffViewEnabled,
} from "./staffShared.ts";

export default defineView({
	id: "staff",
	processInputs: (params: RouteParams<"staff">) => ({
		tid: validateTeam(params.team),
	}),
	load: async ({ updateEvents, inputs, prevInputs }) => {
		if (!staffViewEnabled()) {
			return { errorMessage: STAFF_DISABLED_MESSAGE };
		}
		const { tid } = inputs;
		if (
			updateEvents.has("firstRun") ||
			tid !== prevInputs?.tid ||
			updateEvents.has("staff") ||
			updateEvents.has("newPhase") ||
			updateEvents.has("gameAttributes")
		) {
			const coaches = await idb.cache.coaches.getAll();
			const teamCoaches = coaches.filter((c) => c.tid === tid);
			const slots = COACH_ROLES.map((role) => {
				const c = teamCoaches.find((c) => c.role === role);
				return {
					role,
					roleName: COACH_ROLE_NAMES[role],
					coach: c ? { ...formatCoach(c), buyout: getBuyout(c) } : undefined,
				};
			});

			const isUser = g.get("userTids").includes(tid) && !g.get("spectator");

			const freeAgents: Record<CoachRole, ReturnType<typeof formatCoach>[]> = {
				head: [],
				dev: [],
				off: [],
				def: [],
			};
			if (isUser) {
				const fas = coaches.filter((c) => c.tid === COACH_FREE_AGENT);
				for (const role of COACH_ROLES) {
					freeAgents[role] = fas
						.map((c) => formatCoach(c, role))
						.sort((a, b) => b.ovr - a.ovr)
						.slice(0, 25);
				}
			}

			const level = await getStaffLevel(tid);
			const levelLastThree = await finances.getLevelLastThree("coaching", {
				tid,
			});
			const info = g.get("teamInfoCache")[tid]!;

			return {
				abbrev: info.abbrev,
				budget: g.get("budget"),
				canExtend:
					g.get("phase") <= PHASE.PLAYOFFS ||
					g.get("phase") === PHASE.EXPANSION_DRAFT,
				freeAgents,
				isUser,
				level,
				levelLastThree,
				// Progression effect, same scale as Team Finances shows for the coaching budget
				progEffect: coachingEffect(levelLastThree),
				progEffectNow: coachingEffect(level),
				effectScale: levelToEffect(level),
				name: info.name,
				payroll: await getStaffPayroll(tid),
				phase: g.get("phase"),
				region: info.region,
				season: g.get("season"),
				slots,
				tid,
			};
		}
	},
});
