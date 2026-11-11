// Coach's notes (a tab of the Coaches page, coaching systems setting): a head coach's tendencies, how his roster fits his systems, his
// reputation, hot seat and coaching tree, and the league's system trends over the seasons
import {
	DEFENSE_DESCRIPTIONS,
	DEFENSE_NAMES,
	DEFENSE_SYSTEMS,
	OFFENSE_DESCRIPTIONS,
	OFFENSE_NAMES,
	OFFENSE_SYSTEMS,
	describeProfile,
	fitLabel,
	fitToScore,
	rosterSchemeFit,
} from "../../common/coachSystems.ts";
import {
	coachReputation,
	coachSystemsEnabled,
	coachingTree,
	getCoachProfile,
	getTeamCoachSystem,
} from "../core/staff/index.ts";
import {
	fitRatingsOf,
	hotSeatLabel,
	hotSeatNow,
	reputationLabel,
} from "../core/staff/systems.ts";
import { idb } from "../db/index.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import { validateTeam } from "../util/processInputs.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { STAFF_DISABLED_MESSAGE, staffViewEnabled } from "./staffShared.ts";

export default defineView({
	id: "coachNotes",
	processInputs: (params: RouteParams<"coachNotes">) => ({
		tid: validateTeam(params.team),
	}),
	load: async ({ updateEvents, inputs, prevInputs }) => {
		if (!staffViewEnabled()) {
			return { errorMessage: STAFF_DISABLED_MESSAGE };
		}
		if (!coachSystemsEnabled()) {
			return {
				errorMessage:
					"Coaching systems are turned off in this league. You can turn them on in League Settings → League Extras → Game Simulation.",
			};
		}
		const { tid } = inputs;
		if (
			!updateEvents.has("firstRun") &&
			tid === prevInputs?.tid &&
			!updateEvents.has("staff") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("gameSim")
		) {
			return;
		}
		const info = g.get("teamInfoCache")[tid]!;
		const system = await getTeamCoachSystem(tid);
		const coaches = await idb.cache.coaches.getAll();
		const head = coaches.find((c) => c.tid === tid && c.role === "head");

		let coach;
		if (head && system) {
			const profile = getCoachProfile(head);
			const tree = await coachingTree(head.cid);
			const players = (await idb.cache.players.indexGetAll("playersByTid", tid))
				.filter((p) => p.injury.gamesRemaining === 0)
				.sort((a, b) => b.valueNoPot - a.valueNoPot);
			const fit = rosterSchemeFit(players.map(fitRatingsOf));
			const offCoord = coaches.find((c) => c.tid === tid && c.role === "off");
			const defCoord = coaches.find((c) => c.tid === tid && c.role === "def");
			const rep = coachReputation(head);
			const heat = await hotSeatNow(head);
			coach = {
				cid: head.cid,
				name: `${head.firstName} ${head.lastName}`,
				offense: profile.off,
				defense: profile.def,
				offenseName: OFFENSE_NAMES[profile.off],
				defenseName: DEFENSE_NAMES[profile.def],
				offenseDescription: OFFENSE_DESCRIPTIONS[profile.off],
				defenseDescription: DEFENSE_DESCRIPTIONS[profile.def],
				describe: describeProfile(profile),
				adapt: profile.adapt,
				strengths: {
					off: Math.round(
						0.6 * head.ratings.off + 0.4 * (offCoord?.ratings.off ?? 30),
					),
					def: Math.round(
						0.6 * head.ratings.def + 0.4 * (defCoord?.ratings.def ?? 30),
					),
					dev: head.ratings.dev,
					mgmt: profile.mgmt,
					mot: head.ratings.mot,
				},
				install: Math.round(system.install * 100),
				fit: system.fit,
				fitText: fitLabel(system.fit),
				offFit: system.offFit,
				defFit: system.defFit,
				offFits: OFFENSE_SYSTEMS.map((s) => ({
					system: s,
					name: OFFENSE_NAMES[s],
					score: fitToScore(fit.off[s]),
				})).sort((a, b) => b.score - a.score),
				defFits: DEFENSE_SYSTEMS.map((s) => ({
					system: s,
					name: DEFENSE_NAMES[s],
					score: fitToScore(fit.def[s]),
				})).sort((a, b) => b.score - a.score),
				reputation: rep,
				reputationText: reputationLabel(rep),
				hotSeat: heat,
				hotSeatText: hotSeatLabel(heat),
				tree,
			};
		}

		// League trends: head coaches' systems by season
		const trends = new Map<
			number,
			{ off: Record<string, number>; def: Record<string, number> }
		>();
		const add = (season: number, off: string, def: string) => {
			const row = trends.get(season) ?? { off: {}, def: {} };
			row.off[off] = (row.off[off] ?? 0) + 1;
			row.def[def] = (row.def[def] ?? 0) + 1;
			trends.set(season, row);
		};
		const season = g.get("season");
		for (const c of coaches) {
			for (const row of c.stats) {
				if (row.role === "head" && row.off && row.def && row.season < season) {
					add(row.season, row.off, row.def);
				}
			}
			if (c.tid >= 0 && c.role === "head") {
				const p = getCoachProfile(c);
				add(season, p.off, p.def);
			}
		}

		const teams = g
			.get("teamInfoCache")
			.map((t, i) => ({
				tid: i,
				abbrev: t.abbrev,
				region: t.region,
				name: t.name,
				disabled: t.disabled,
			}))
			.filter((t) => !t.disabled);

		return {
			abbrev: info.abbrev,
			region: info.region,
			name: info.name,
			tid,
			coach,
			teams,
			offenseNames: OFFENSE_NAMES,
			defenseNames: DEFENSE_NAMES,
			trends: [...trends.entries()]
				.sort((a, b) => b[0] - a[0])
				.slice(0, 15)
				.map(([season, row]) => ({ season, ...row })),
		};
	},
});
