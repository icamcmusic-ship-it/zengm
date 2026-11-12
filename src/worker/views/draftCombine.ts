import { featureOffError } from "../util/nativeFeatures.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { validateSeason } from "../util/processInputs.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import {
	combineHeld,
	combineRatingsRow,
	getClassCombine,
} from "../core/draftCombine/index.ts";
import {
	athleticScore,
	type CombineDrills,
	type CombineKey,
	type CombineMeasurements,
	type CombineRank,
	type DraftCombineResult,
} from "../../common/draftCombine.ts";
import { PHASE } from "../../common/constants.ts";

/**
 * Combine tab of Draft Scouting (Draft Lottery Night & Combine setting): a draft class's measurements, athletic testing and
 * shooting drills. Only measurements and drill results, which are public: no scouting info.
 */
export default defineView({
	id: "draftCombine",
	processInputs: (params: RouteParams<"draftCombine">) => ({
		season: validateSeason(params.season),
	}),
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("lotteryNight");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("gameAttributes") &&
			inputs.season === prevInputs?.season
		) {
			return;
		}
		const { season } = inputs;
		const c = await getClassCombine(season);
		const teamInfoCache = g.get("teamInfoCache");

		const players: {
			pid: number;
			firstName: string;
			lastName: string;
			pos: string;
			age: number;
			college: string;
			draft?: { round: number; pick: number; abbrev: string; tid: number };
			measurements: CombineMeasurements;
			drills?: CombineDrills;
			skipped?: DraftCombineResult["skipped"];
			ranks: Partial<Record<CombineKey, CombineRank>>;
			athletic?: number;
		}[] = [];
		for (const p of c.players) {
			const res = c.results.get(p.pid);
			if (!res) {
				continue;
			}
			const r = combineRatingsRow(p);
			const ranks = c.ranks.get(p.pid) ?? {};
			players.push({
				pid: p.pid,
				firstName: p.firstName,
				lastName: p.lastName,
				pos: r?.pos ?? "",
				age: p.draft.year - p.born.year,
				college: p.college,
				draft:
					p.draft.round > 0 && p.draft.pick > 0 && p.tid >= 0
						? {
								round: p.draft.round,
								pick: p.draft.pick,
								tid: p.draft.tid,
								abbrev: teamInfoCache[p.draft.tid]?.abbrev ?? "",
							}
						: undefined,
				measurements: res.measurements,
				drills: res.drills,
				skipped: res.skipped,
				ranks,
				athletic: athleticScore(ranks),
			});
		}

		return {
			season,
			held: combineHeld(season),
			// The next combine, for the message before it is held
			upcoming:
				season > g.get("season") ||
				(season === g.get("season") && g.get("phase") < PHASE.DRAFT_LOTTERY),
			numProspects: c.players.length,
			players,
		};
	},
});
