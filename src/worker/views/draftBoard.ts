import { featureOffError } from "../util/nativeFeatures.ts";
import { PHASE, PLAYER } from "../../common/constants.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { last } from "../../common/utils.ts";
import { defineView } from "../util/defineView.ts";
import { player } from "../core/index.ts";
import { getScoutReport } from "../core/draft/scouting.ts";
import { getPreDraftAwards, getPreDraftStats } from "../../common/preDraft.ts";
import { getPreDraftLabel } from "../../common/collegeStats/overseas.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import addFirstNameShort from "../util/addFirstNameShort.ts";
import { featureOn } from "../util/nativeFeatures.ts";
import { confidenceFromFactor } from "../../common/staffDepth/regions.ts";
import { getPreDraftRanks } from "../core/draft/preDraftRanks.ts";
import { storedMedicalView } from "../core/draftCombine/index.ts";
import {
	getProspectRooms,
	summarizeRoom,
} from "../core/scoutingReports/room.ts";
import { getRealComps } from "../core/draft/realComps.ts";

/**
 * The user's draft board planner: one draft class, with the user's ranks, tiers and notes next to everything known about each prospect (fuzzed ratings, build, college/overseas stats and honors, scout report).
 */
export default defineView({
	id: "draftBoard",
	processInputs: (params: RouteParams<"draftBoard">) => {
		const season =
			params.season !== undefined ? Number.parseInt(params.season) : undefined;
		return {
			season: season === undefined || Number.isNaN(season) ? undefined : season,
		};
	},
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("draftBoard");
		if (featureOff) {
			return featureOff;
		}
		const inputSeason = inputs.season;
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("gameAttributes") &&
			!updateEvents.has("staff") &&
			inputSeason === prevInputs?.season
		) {
			return;
		}

		const fantasyDraft = g.get("phase") === PHASE.FANTASY_DRAFT;
		const tid = fantasyDraft ? PLAYER.UNDRAFTED_FANTASY_TEMP : PLAYER.UNDRAFTED;
		const firstSeason =
			g.get("season") + (g.get("phase") >= PHASE.RESIGN_PLAYERS ? 1 : 0);
		const allProspects = await idb.cache.players.indexGetAll(
			"playersByTid",
			tid,
		);
		const seasons = [...new Set(allProspects.map((p) => p.draft.year))].sort(
			(a, b) => a - b,
		);
		const season =
			inputSeason ?? (fantasyDraft ? g.get("season") : firstSeason);
		const players = allProspects.filter(
			(p) => fantasyDraft || p.draft.year === season,
		);

		const formatted = await player.formatAll(players, {
			attrs: ["pid", "firstName", "lastName", "age", "valueFuzz", "watch"],
			ratings: ["ovr", "pot", "skills", "pos"],
			showNoStats: true,
			showRookies: true,
			fuzz: true,
		});
		const byPid = new Map(players.map((p) => [p.pid, p]));
		const scoutingSystem = featureOn("scoutingSystem");

		// Frozen Pre-draft Ranks setting: during and after this class's draft, the scouts' order is the one it had when the draft started
		const preDraftRanks = fantasyDraft
			? undefined
			: await getPreDraftRanks(season);
		const maxPreDraftRank = Math.max(
			0,
			...[...(preDraftRanks?.values() ?? [])].map((x) => x.r),
		);

		// Scout Consensus & Flags
		const rooms = fantasyDraft ? undefined : await getProspectRooms(players);
		// Real Player Comps
		const realComps = await getRealComps(players);

		const prospects = addFirstNameShort(
			formatted
				.sort((a, b) => b.valueFuzz - a.valueFuzz)
				.map((pa, i) => {
					const p = byPid.get(pa.pid)!;
					const ratings = last(pa.ratings) as any;
					const preDraft = getPreDraftStats(p) as any[];
					const lastRow = preDraft.at(-1);
					let preDraftLine: string | undefined;
					let preDraftLabel: string | undefined;
					if (lastRow && lastRow.gp > 0) {
						const per = (key: string) => (lastRow[key] / lastRow.gp).toFixed(1);
						preDraftLabel = getPreDraftLabel(lastRow.teamName);
						preDraftLine = `${per("pts")} pts, ${((lastRow.orb + lastRow.drb) / lastRow.gp).toFixed(1)} reb, ${per("ast")} ast`;
					}
					return {
						pid: pa.pid,
						firstName: pa.firstName,
						lastName: pa.lastName,
						age: pa.age,
						watch: pa.watch,
						ovr: ratings.ovr as number,
						pot: ratings.pot as number,
						skills: ratings.skills as string[],
						badges: (ratings as any).badges as string[] | undefined,
						pos: ratings.pos as string,
						valueRank: preDraftRanks
							? (preDraftRanks.get(pa.pid)?.r ?? maxPreDraftRank + i + 1)
							: i + 1,
						build: p.ratingsBuild?.name,
						comps: realComps.get(pa.pid),
						school: lastRow?.teamName ?? p.college ?? "",
						preDraftLabel,
						preDraftLine,
						numHonors: getPreDraftAwards(p).length,
						scoutReport: scoutingSystem ? getScoutReport(p) : undefined,
						// Pre-Draft Injuries & Combine Medicals: his medical grade, once his combine was held
						medical: storedMedicalView(p),
						board: p.draftBoard ?? {},
						room: rooms?.has(pa.pid)
							? summarizeRoom(rooms.get(pa.pid)!)
							: undefined,
					};
				}),
		);

		// Scouting Director & Regions: the Director keeps the board up to date (with its weekly change summaries)
		const depthOn = featureOn("scoutingDepth");
		const userTeam = depthOn
			? await idb.cache.teams.get(g.get("userTid"))
			: undefined;
		const depth =
			depthOn && userTeam
				? {
						boardDelegation:
							userTeam.staffDepth?.delegation?.board ?? ("auto" as const),
						log: [...(userTeam.staffDepth?.boardLog ?? [])]
							.reverse()
							.slice(0, 4),
						confidence: Object.fromEntries(
							players.map((p) => [
								p.pid,
								confidenceFromFactor(p.scoutLooks?.a ?? 1),
							]),
						),
					}
				: undefined;

		return {
			season,
			seasons,
			prospects,
			draftBoardAutoDraft: g.get("draftBoardAutoDraft"),
			frozenRanks: preDraftRanks !== undefined,
			scoutingSystem,
			depth,
		};
	},
});
