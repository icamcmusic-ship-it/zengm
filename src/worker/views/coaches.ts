import { COACH_FREE_AGENT, COACH_ROLE_NAMES } from "../../common/staff.ts";
import {
	DEFENSE_NAMES,
	OFFENSE_NAMES,
	fitLabel,
} from "../../common/coachSystems.ts";
import {
	COACH_OF_THE_YEAR,
	getCoachAwards,
	getCoachingCarousel,
	coachSystemsEnabled,
} from "../core/staff/index.ts";
import { idb } from "../db/index.ts";
import {
	getRosterFit,
	getTeamCoachSystem,
	hotSeatLabel,
	hotSeatNow,
} from "../core/staff/systems.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { validateSeason } from "../util/processInputs.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import {
	STAFF_DISABLED_MESSAGE,
	formatCoach,
	headCoachOutlook,
	staffViewEnabled,
} from "./staffShared.ts";

export default defineView({
	id: "coaches",
	processInputs: (params: RouteParams<"coaches">) => ({
		season: validateSeason(params.season),
	}),
	load: async ({ updateEvents, inputs, prevInputs }) => {
		if (!staffViewEnabled()) {
			return { errorMessage: STAFF_DISABLED_MESSAGE };
		}
		const { season } = inputs;
		if (
			updateEvents.has("firstRun") ||
			season !== prevInputs?.season ||
			updateEvents.has("staff") ||
			updateEvents.has("newPhase") ||
			updateEvents.has("gameSim") ||
			updateEvents.has("playerMovement")
		) {
			const coaches = await idb.cache.coaches.getAll();
			const abbrev = (tid: number) => g.get("teamInfoCache")[tid]?.abbrev ?? "";
			const currentSeason = g.get("season");
			const systemsOn = coachSystemsEnabled();
			const userTid = g.get("userTid");

			// One row per coach. The current season lists everyone with a job or looking for one; a past season lists that season's head coaches
			// (with the team, record and systems of that season)
			type Row = ReturnType<typeof formatCoach> & {
				// "head" / "assistant" (on a staff now) or "available"
				status: "head" | "assistant" | "available";
				seasonTid: number;
				seasonAbbrev: string;
				seasonWon: number | undefined;
				seasonLost: number | undefined;
				offenseName: string | undefined;
				defenseName: string | undefined;
				offenseKey: string | undefined;
				defenseKey: string | undefined;
				// Scheme fit: a head coach's with his own roster, an available coach's with your roster
				fit: number | undefined;
				fitText: string | undefined;
				install: number | undefined;
				hotSeatText: string;
				hotSeat: number | undefined;
			};
			const rows: Row[] = [];

			if (season === currentSeason) {
				const userFit = systemsOn ? await getRosterFit(userTid) : undefined;
				const userStaff = coaches.filter((c) => c.tid === userTid);
				const userCoordinators = {
					off: userStaff.find((c) => c.role === "off")?.ratings,
					def: userStaff.find((c) => c.role === "def")?.ratings,
				};
				for (const c of coaches) {
					if (c.tid < 0 && c.tid !== COACH_FREE_AGENT) {
						continue;
					}
					const formatted = formatCoach(c);
					const isHead = c.tid >= 0 && c.role === "head";
					let seasonWon: number | undefined;
					let seasonLost: number | undefined;
					let fit: number | undefined;
					let fitText: string | undefined;
					let install: number | undefined;
					let hotSeat: number | undefined;
					let hotSeatText = "";
					if (isHead) {
						const row = c.stats.find(
							(r) => r.season === season && r.tid === c.tid,
						);
						if (row) {
							seasonWon = row.won;
							seasonLost = row.lost;
						} else {
							const ts = await idb.cache.teamSeasons.indexGet(
								"teamSeasonsBySeasonTid",
								[season, c.tid],
							);
							if (ts) {
								// (a coach hired during the season only gets the games since)
								const h =
									c.hiredRecord?.season === season &&
									c.hiredRecord.tid === c.tid
										? c.hiredRecord
										: undefined;
								seasonWon = ts.won - (h?.won ?? 0);
								seasonLost = ts.lost - (h?.lost ?? 0);
							}
						}
						if (systemsOn) {
							const system = await getTeamCoachSystem(c.tid);
							if (system) {
								fit = system.fit;
								fitText = fitLabel(system.fit);
								install = Math.round(100 * system.install);
							}
							hotSeat = await hotSeatNow(c);
							hotSeatText = hotSeatLabel(hotSeat);
						}
					} else if (c.tid === COACH_FREE_AGENT && userFit) {
						const outlook = headCoachOutlook(c, userFit, userCoordinators);
						fit = outlook.fit;
						fitText = outlook.fitText;
					}
					rows.push({
						...formatted,
						status: c.tid < 0 ? "available" : isHead ? "head" : "assistant",
						seasonTid: c.tid,
						seasonAbbrev: c.tid >= 0 ? abbrev(c.tid) : "",
						seasonWon,
						seasonLost,
						offenseName: formatted.systems?.offense,
						defenseName: formatted.systems?.defense,
						offenseKey: formatted.systems?.offenseKey,
						defenseKey: formatted.systems?.defenseKey,
						fit,
						fitText,
						install,
						hotSeat,
						hotSeatText,
					});
				}
			} else {
				for (const c of coaches) {
					for (const row of c.stats) {
						if (row.season !== season || row.role !== "head") {
							continue;
						}
						rows.push({
							...formatCoach(c),
							// (as he was that season)
							age: season - c.born.year,
							status: "head",
							seasonTid: row.tid,
							seasonAbbrev: abbrev(row.tid),
							seasonWon: row.won,
							seasonLost: row.lost,
							offenseName: row.off ? OFFENSE_NAMES[row.off] : undefined,
							defenseName: row.def ? DEFENSE_NAMES[row.def] : undefined,
							offenseKey: row.off,
							defenseKey: row.def,
							fit: undefined,
							fitText: undefined,
							install: undefined,
							hotSeat: undefined,
							hotSeatText: "",
						});
					}
				}
			}
			rows.sort(
				(a, b) => a.seasonAbbrev.localeCompare(b.seasonAbbrev) || b.ovr - a.ovr,
			);

			const carousel = (await getCoachingCarousel(season)).map((m) => ({
				...m,
				abbrev: abbrev(m.tid),
			}));

			const coy = (await getCoachAwards(COACH_OF_THE_YEAR)).map((a) => ({
				...a,
				abbrev: abbrev(a.tid),
			}));

			const seasons = new Set<number>([currentSeason]);
			for (const c of coaches) {
				for (const tx of c.transactions) {
					seasons.add(tx.season);
				}
			}

			const teams = g
				.get("teamInfoCache")
				.map((t, tid) => ({ tid, abbrev: t.abbrev, disabled: t.disabled }))
				.filter((t) => !t.disabled)
				.sort((a, b) => a.abbrev.localeCompare(b.abbrev));

			return {
				season,
				currentSeason,
				seasons: [...seasons].sort((a, b) => b - a),
				rows,
				carousel,
				coy,
				coachSystems: systemsOn,
				offenseNames: OFFENSE_NAMES,
				defenseNames: DEFENSE_NAMES,
				roleNames: COACH_ROLE_NAMES,
				teams,
				userAbbrev: abbrev(userTid),
				userTid,
			};
		}
	},
});
