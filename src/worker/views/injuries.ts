import { PHASE } from "../../common/constants.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { getPlayers } from "./playerRatings.ts";
import addFirstNameShort from "../util/addFirstNameShort.ts";
import { idb } from "../db/index.ts";
import { getActualPlayThroughInjuries } from "../core/game/loadTeams.ts";
import { actualPhase } from "../util/actualPhase.ts";
import { bySport } from "../../common/sportFunctions.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { validateTeam } from "../util/processInputs.ts";
import { validateSeason } from "../util/processInputs.ts";
import { getExpectedReturnDayFinder } from "../core/player/injuryRecovery.ts";

const processInputs = (params: RouteParams<"injuries">) => {
	let season: number | "current";

	if (params.season && params.season !== "current") {
		season = validateSeason(params.season);
	} else {
		season = "current";
	}

	return {
		season,
		team: validateTeam(params.team, ["all", "playoffs", "watch"]),
	};
};

export default defineView({
	id: "injuries",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (
			updateEvents.has("firstRun") ||
			((inputs.season === g.get("season") || inputs.season === "current") &&
				(updateEvents.has("gameSim") || updateEvents.has("playerMovement"))) ||
			(updateEvents.has("newPhase") && g.get("phase") === PHASE.PRESEASON) ||
			inputs.season !== prevInputs?.season ||
			inputs.team !== prevInputs?.team
		) {
			const stats = bySport({
				baseball: ["gp", "keyStats"],
				basketball: ["gp", "pts", "trb", "ast"],
				football: ["gp", "keyStats"],
				hockey: ["gp", "keyStats"],
			} as const);

			const players = await getPlayers(
				inputs.season === "current" ? g.get("season") : inputs.season,
				inputs.team,
				["injury", "injuries"],
				["ovr", "pot"],
				[...stats, "jerseyNumber"],
			);

			// Injury outlook: when he's expected back (current season), from the schedule
			const findReturnDay =
				inputs.season === "current"
					? await getExpectedReturnDayFinder()
					: undefined;

			const injuries = [];
			for (const p of players) {
				if (inputs.season === "current") {
					if (p.injury.gamesRemaining > 0) {
						const injury = p.injuries.at(-1);
						injuries.push({
							...p,
							type: p.injury.type,
							games: p.injury.gamesRemaining,
							// Only for this injury's record (its outlook, treatment, re-aggravations)
							outlook: p.injury,
							returnDay: findReturnDay?.(p.tid, p.injury.gamesRemaining),
							missed: p.injury.gamesMissed,
							aggravated:
								injury?.type === p.injury.type ? injury.aggravated : undefined,
							treatment: p.injury.treatment,
							ovrDrop: injury?.ovrDrop,
							potDrop: injury?.potDrop,
							playingThrough: false,
						});
					}
				} else {
					for (const injury of p.injuries) {
						if (injury.season === inputs.season) {
							injuries.push({
								...p,
								type: injury.type,
								games: injury.games,
								outlook: undefined,
								returnDay: undefined,
								missed: injury.missed,
								aggravated: injury.aggravated,
								treatment: injury.treatment,
								ovrDrop: injury.ovrDrop,
								potDrop: injury.potDrop,
								playingThrough: false,
							});
						}
					}
				}
			}

			if (inputs.season === "current") {
				const teams = await idb.cache.teams.getAll();
				const playingThrough: Record<number, number> = {};
				const index = actualPhase() === PHASE.PLAYOFFS ? 1 : 0;
				for (const t of teams) {
					if (t.disabled) {
						continue;
					}

					playingThrough[t.tid] = getActualPlayThroughInjuries(t)[index];
				}

				for (const injury of injuries) {
					const cutoff = playingThrough[injury.tid];
					if (cutoff !== undefined && injury.games <= cutoff) {
						injury.playingThrough = true;
					}
				}
			}

			return {
				team: inputs.team,
				injuries: addFirstNameShort(injuries),
				season: inputs.season,
				stats,
			};
		}
	},
});
