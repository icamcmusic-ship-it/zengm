import { levelToEffect, coachingEffect } from "../../common/budgetLevels.ts";
import { PHASE } from "../../common/constants.ts";
import {
	COACH_FREE_AGENT,
	COACH_ROLES,
	COACH_ROLE_NAMES,
	staffDevScore,
	staffDevScoreToLevel,
} from "../../common/staff.ts";
import type { Coach, CoachRatings, CoachRole } from "../../common/types.ts";
import { finances } from "../core/index.ts";
import {
	coachSystemsEnabled,
	coachingTree,
	getBuyout,
	getCoachProfile,
	getLeagueStaffDevScoreRef,
	getStaffLevel,
	getStaffPayroll,
} from "../core/staff/index.ts";
import {
	getRosterFit,
	getTeamCoachSystem,
	hotSeatLabel,
	hotSeatNow,
} from "../core/staff/systems.ts";
import { idb } from "../db/index.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { validateTeam } from "../util/processInputs.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import {
	STAFF_DISABLED_MESSAGE,
	formatCoach,
	getTeamColors,
	headCoachOutlook,
	rosterFitPlayers,
	staffViewEnabled,
	type HeadCoachOutlook,
} from "./staffShared.ts";

export type CandidateTag =
	| "Best overall"
	| "Best fit"
	| "Best developer"
	| "Best tactician"
	| "Top reputation";

// How many candidates the hiring table lists for a job (the best at that job, plus anyone with a recommendation tag)
const NUM_CANDIDATES = 40;

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
			updateEvents.has("gameAttributes") ||
			updateEvents.has("playerMovement") ||
			updateEvents.has("gameSim")
		) {
			const coaches = await idb.cache.coaches.getAll();
			const teamCoaches = coaches.filter((c) => c.tid === tid);
			const colors = (await getTeamColors()).get(tid);
			const systemsOn = coachSystemsEnabled();
			const season = g.get("season");

			const byRole: Partial<Record<CoachRole, Coach>> = {};
			for (const c of teamCoaches) {
				byRole[c.role] = c;
			}
			const ratingsByRole = (replace?: {
				role: CoachRole;
				ratings: CoachRatings;
			}): Partial<Record<CoachRole, CoachRatings>> => {
				const out: Partial<Record<CoachRole, CoachRatings>> = {};
				for (const role of COACH_ROLES) {
					out[role] =
						replace?.role === role ? replace.ratings : byRole[role]?.ratings;
				}
				return out;
			};

			// Player development: the staff's score against the league's average staff
			const devRef = await getLeagueStaffDevScoreRef();
			const level = await getStaffLevel(tid, devRef);
			const levelIfHired = (role: CoachRole, ratings: CoachRatings) =>
				staffDevScoreToLevel(
					staffDevScore(ratingsByRole({ role, ratings })),
					devRef,
				);
			const activeTeams = (await idb.cache.teams.getAll()).filter(
				(t) => !t.disabled,
			);
			let devRank = 1;
			for (const t of activeTeams) {
				if (t.tid !== tid && (await getStaffLevel(t.tid, devRef)) > level) {
					devRank += 1;
				}
			}

			// Coaching systems: the roster against the head coach's systems
			const rosterFit = systemsOn ? await getRosterFit(tid) : undefined;
			const coordinators = {
				off: byRole.off?.ratings,
				def: byRole.def?.ratings,
			};

			const slots = COACH_ROLES.map((role) => {
				const c = byRole[role];
				return {
					role,
					roleName: COACH_ROLE_NAMES[role],
					coach: c
						? {
								...formatCoach(c),
								buyout: getBuyout(c),
								// What the team's development level would be with this job vacant
								levelIfVacant: staffDevScoreToLevel(
									staffDevScore({ ...ratingsByRole(), [role]: undefined }),
									devRef,
								),
							}
						: undefined,
				};
			});

			let head:
				| (HeadCoachOutlook & {
						cid: number;
						install: number;
						helping: {
							pid: number;
							name: string;
							pos: string;
							score: number;
						}[];
						hurting: {
							pid: number;
							name: string;
							pos: string;
							score: number;
						}[];
						hotSeat: number;
						hotSeatText: string;
						expectedWins: number | undefined;
						tenure: number;
						mentor: { cid: number; name: string } | undefined;
						numProteges: number;
				  })
				| undefined;
			if (byRole.head && rosterFit) {
				const c = byRole.head;
				const system = await getTeamCoachSystem(tid);
				const heat = await hotSeatNow(c);
				const tree = await coachingTree(c.cid);
				const expect = getCoachProfile(c).expect;
				head = {
					...headCoachOutlook(c, rosterFit, coordinators),
					...(await rosterFitPlayers(tid, c)),
					cid: c.cid,
					install: Math.round(100 * (system?.install ?? 1)),
					hotSeat: heat,
					hotSeatText: hotSeatLabel(heat),
					expectedWins:
						expect && expect.season === season && expect.tid === tid
							? Math.round(expect.pct * g.get("numGames"))
							: undefined,
					tenure: c.stats.filter((r) => r.tid === tid && r.role === "head")
						.length,
					mentor: tree.up[0],
					numProteges: tree.down.length,
				};
			}

			const ts = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsBySeasonTid",
				[season, tid],
			);

			const isUser = g.get("userTids").includes(tid) && !g.get("spectator");

			// The hiring market, for your own team: the best free agents at each job, how each would change the staff, and recommendations
			const formatCandidate = (c: Coach, role: CoachRole) => ({
				...formatCoach(c, role),
				levelIfHired: levelIfHired(role, c.ratings),
				outlook:
					role === "head" && rosterFit
						? headCoachOutlook(c, rosterFit, coordinators)
						: undefined,
				tags: [] as CandidateTag[],
			});
			type Candidate = ReturnType<typeof formatCandidate>;
			const candidates: Record<CoachRole, Candidate[]> = {
				head: [],
				dev: [],
				off: [],
				def: [],
			};
			if (isUser) {
				const fas = coaches.filter((c) => c.tid === COACH_FREE_AGENT);
				for (const role of COACH_ROLES) {
					const all = fas
						.map((c) => formatCandidate(c, role))
						.sort((a, b) => b.ovr - a.ovr);
					const tag = (name: CandidateTag, value: (c: Candidate) => number) => {
						let best: Candidate | undefined;
						for (const c of all) {
							if (!best || value(c) > value(best)) {
								best = c;
							}
						}
						best?.tags.push(name);
					};
					tag("Best overall", (c) => c.ovr);
					if (role === "head") {
						if (rosterFit) {
							tag("Best fit", (c) => c.outlook?.fit ?? 0);
						}
						tag("Best developer", (c) => c.ratings.dev);
						tag("Best tactician", (c) => c.ratings.off + c.ratings.def);
						if (systemsOn) {
							tag("Top reputation", (c) => c.systems?.reputation ?? 0);
						}
					} else if (role === "dev") {
						tag("Best developer", (c) => c.levelIfHired + c.ratings.dev / 1000);
					} else {
						tag("Best tactician", (c) => c.ratings[role]);
					}
					candidates[role] = all.filter(
						(c, i) => i < NUM_CANDIDATES || c.tags.length > 0,
					);
				}
			}

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
				candidates,
				coachSystems: systemsOn,
				colors,
				devRank,
				head,
				isUser,
				level,
				levelLastThree,
				numGames: g.get("numGames"),
				numTeams: activeTeams.length,
				// Progression effect, same scale as Team Finances shows for the coaching budget
				progEffect: coachingEffect(levelLastThree),
				progEffectNow: coachingEffect(level),
				effectScale: levelToEffect(level),
				name: info.name,
				payroll: await getStaffPayroll(tid),
				phase: g.get("phase"),
				record: ts ? { won: ts.won, lost: ts.lost } : undefined,
				region: info.region,
				season,
				slots,
				tid,
			};
		}
	},
});
