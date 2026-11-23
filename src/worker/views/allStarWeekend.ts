// All-Star weekend page (basketball): the All-Star vote, the Rising Stars game, the skills challenge and the tournament's
// semifinals, from the season's stored AllStars object. Only names, teams, votes, times and box scores: no ratings.
import { allStar } from "../core/index.ts";
import { defineView } from "../util/defineView.ts";
import { g, helpers } from "../util/index.ts";
import { PHASE } from "../../common/constants.ts";
import { validateSeasonOnly } from "../util/processInputs.ts";
import { getTeamInfoBySeason } from "../util/getTeamInfoBySeason.ts";
import type { AllStars } from "../../common/types.ts";

const abbrevs = async (allStars: AllStars) => {
	const tids = new Set<number>();
	const add = (p: { tid: number }) => tids.add(p.tid);
	allStars.votes?.forEach(add);
	allStars.risingStars?.teams.flat().forEach(add);
	allStars.risingStars?.game?.players.flat().forEach(add);
	allStars.skills?.players.forEach(add);
	allStars.tournament?.teams.flat().forEach(add);
	for (const semi of allStars.tournament?.semis ?? []) {
		semi.game?.players.flat().forEach(add);
	}
	const out: Record<number, string> = {};
	for (const tid of tids) {
		out[tid] =
			tid >= 0
				? ((await getTeamInfoBySeason(tid, allStars.season))?.abbrev ??
					helpers.getAbbrev(tid))
				: "FA";
	}
	return out;
};

export default defineView({
	id: "allStarWeekend",
	processInputs: validateSeasonOnly,
	load: async ({ inputs: { season }, updateEvents, prevInputs }) => {
		if (__SPORT !== "basketball") {
			throw new Error("Not implemented");
		}

		if (
			updateEvents.has("firstRun") ||
			updateEvents.has("gameSim") ||
			updateEvents.has("gameAttributes") ||
			season !== prevInputs?.season
		) {
			const allStars = await allStar.getOrCreate(season);
			if (allStars === undefined) {
				if (season === g.get("season") && g.get("phase") < PHASE.PLAYOFFS) {
					return {
						redirectUrl: helpers.leagueUrl(["all_star", "weekend", season - 1]),
					};
				}
				const returnValue = {
					errorMessage: "All-Star weekend not found",
				};
				return returnValue;
			}

			const confNames: Record<number, string> = {};
			for (const conf of g.get("confs", season)) {
				confNames[conf.cid] = conf.name;
			}

			return {
				abbrevs: await abbrevs(allStars),
				confNames,
				gid: allStars.gid,
				mvp: allStars.mvp,
				risingStars: allStars.risingStars,
				score: allStars.score,
				season,
				skills: allStars.skills,
				teamNames: allStars.teamNames,
				tournament: allStars.tournament,
				type: allStars.type,
				votes: allStars.votes,
			};
		}
	},
});
