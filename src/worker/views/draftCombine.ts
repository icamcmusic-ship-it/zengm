import { featureOffError } from "../util/nativeFeatures.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { validateSeason } from "../util/processInputs.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import {
	combineHeld,
	combineRatingsRow,
	getClassCombine,
	getCombineHistory,
	getMedicalReason,
	listedFor,
	medicalsOn,
} from "../core/draftCombine/index.ts";
import {
	athleticScore,
	historyPercentiles,
	measurementStories,
	type HistoryPct,
	type ListedMeasurements,
	type CombineDrills,
	type CombineKey,
	type CombineMeasurements,
	type CombineRank,
	type DraftCombineResult,
	type MedicalGrade,
} from "../../common/draftCombine.ts";
import { PHASE } from "../../common/constants.ts";
import { getPreDraftSchool } from "../../common/preDraft.ts";

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
			// Pre-Draft Injuries & Combine Medicals: as your medical staff reads it
			medical?: { grade: MedicalGrade; reason: string };
			// His school's listing, and the stories when the tape measure disagrees
			listed: ListedMeasurements;
			stories: string[];
			effort?: number;
			// Percentiles against the league's earlier combines (or real NBA combines without enough of them)
			hist: Partial<Record<CombineKey, HistoryPct>>;
		}[] = [];
		const history = await getCombineHistory(season);
		const showMedical = medicalsOn();
		for (const p of c.players) {
			const res = c.results.get(p.pid);
			if (!res) {
				continue;
			}
			const r = combineRatingsRow(p);
			const ranks = c.ranks.get(p.pid) ?? {};
			const listed = listedFor(p);
			players.push({
				pid: p.pid,
				firstName: p.firstName,
				lastName: p.lastName,
				pos: r?.pos ?? "",
				age: p.draft.year - p.born.year,
				college: getPreDraftSchool(p),
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
				listed,
				stories: measurementStories(listed, res.measurements).map(
					(x) => x.text,
				),
				effort: res.effort,
				hist: historyPercentiles(res, history),
				medical:
					showMedical && res.medical
						? { grade: res.medical.grade, reason: getMedicalReason(p) }
						: undefined,
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
			// How many earlier results the all-time percentiles compare with (max over the tests; 0: real NBA combines)
			historyN: Math.max(
				0,
				...players.flatMap((p) => Object.values(p.hist).map((x) => x.n)),
			),
			players,
		};
	},
});
