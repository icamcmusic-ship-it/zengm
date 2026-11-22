import { featureOffError } from "../util/nativeFeatures.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { PHASE, PLAYER } from "../../common/constants.ts";
import { getPreDraftSchool } from "../../common/preDraft.ts";
import {
	LEAN_NAMES,
	OUTCOME_SEASONS,
	OUTLETS,
} from "../../common/draftOutlets.ts";
import {
	boardKeyName,
	draftOutletsOn,
	getClassBoards,
	getOutletHistory,
	yourBoardFor,
	type BoardKey,
} from "../core/draftOutlets/index.ts";
import { idb } from "../db/index.ts";

/**
 * Big Boards tab of Draft Scouting: every media outlet's big board of a class next to the consensus, your board and (once it happened)
 * the actual draft, plus the outlets' track record. Ranks only: no ratings.
 */
export default defineView({
	id: "bigBoards",
	processInputs: (params: RouteParams<"bigBoards">) => {
		const season =
			params.season !== undefined ? Number.parseInt(params.season) : undefined;
		return {
			season: season === undefined || Number.isNaN(season) ? undefined : season,
		};
	},
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("scoutingReports");
		if (featureOff) {
			return featureOff;
		}
		if (!draftOutletsOn()) {
			return { errorMessage: "Big boards are only in basketball pro leagues." };
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("gameSim") &&
			inputs.season === prevInputs?.season
		) {
			return;
		}
		const current =
			g.get("phase") >= PHASE.DRAFT ? g.get("season") + 1 : g.get("season");
		const season = inputs.season ?? current;
		const c = await getClassBoards(season);
		const history = await getOutletHistory();

		const prospects = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		const seasons = [
			...new Set([
				...prospects.map((p) => p.draft.year),
				...history.map((h) => h.season),
				season,
			]),
		].sort((a, b) => b - a);

		const teamInfoCache = g.get("teamInfoCache");
		const numTeams = g.get("numActiveTeams");
		const shown = 2 * numTeams + 10;
		const rows = [];
		const outletTops: { name: string; pid: number; text: string }[] = [];
		if (c) {
			const your = yourBoardFor(c);
			const byPid = new Map(c.players.map((p) => [p.pid, p]));
			const consensus = [...c.consensus.entries()].sort(
				(a, b) => a[1].rank - b[1].rank,
			);
			for (const [pid, cons] of consensus.slice(0, shown)) {
				const p = byPid.get(pid);
				if (!p) {
					continue;
				}
				const r = p.ratings.at(-1) as any;
				const drafted = p.draft.round > 0 && p.draft.pick > 0 && p.tid >= 0;
				rows.push({
					pid,
					name: `${p.firstName} ${p.lastName}`,
					pos: r?.pos ?? "",
					age: season - p.born.year,
					school: getPreDraftSchool(p),
					consensus: cons,
					ranks: OUTLETS.map((o) => c.boards.get(o.id)?.get(pid) ?? null),
					moves: OUTLETS.map((o) => {
						const now = c.boards.get(o.id)?.get(pid);
						const before = c.prevBoards?.get(o.id)?.get(pid);
						return now !== undefined && before !== undefined
							? before - now
							: null;
					}),
					your: your.get(pid) ?? null,
					pick: drafted
						? {
								round: p.draft.round,
								pick: p.draft.pick,
								overall: (p.draft.round - 1) * numTeams + p.draft.pick,
								abbrev: teamInfoCache[p.draft.tid]?.abbrev ?? "",
							}
						: undefined,
				});
			}
			for (const o of OUTLETS) {
				const b = c.boards.get(o.id);
				const top = b
					? [...b.entries()].find(([, rank]) => rank === 1)?.[0]
					: undefined;
				const p = top !== undefined ? byPid.get(top) : undefined;
				if (p) {
					outletTops.push({
						name: o.name,
						pid: p.pid,
						text: `${p.firstName} ${p.lastName}`,
					});
				}
			}
		}

		const keys: BoardKey[] = [
			...OUTLETS.map((o) => `o${o.id}` as BoardKey),
			"cons",
			"you",
			"draft",
		];
		// Averages over every class with a scorecard
		const average = (kind: "draft" | "outcome") =>
			Object.fromEntries(
				keys.map((key) => {
					const lines = history
						.map((h) => h[kind]?.[key])
						.filter((x) => x !== undefined);
					return [
						key,
						lines.length > 0
							? {
									mae:
										Math.round(
											(10 * lines.reduce((a, x) => a + x.mae, 0)) /
												lines.length,
										) / 10,
									hits:
										Math.round(
											(10 * lines.reduce((a, x) => a + x.hits, 0)) /
												lines.length,
										) / 10,
									n: lines.length,
								}
							: undefined,
					];
				}),
			);

		return {
			season,
			seasons,
			numTeams,
			outlets: OUTLETS.map((o) => ({
				id: o.id,
				name: o.name,
				short: o.short,
				lean: LEAN_NAMES[o.lean],
				description: o.description,
				top: outletTops.find((x) => x.name === o.name),
			})),
			edition: c?.edition.label,
			prevEdition: c?.prevEdition?.label,
			stored: c?.stored ?? false,
			rows,
			history,
			keys: keys.map((key) => ({ key, name: boardKeyName(key) })),
			averages: { draft: average("draft"), outcome: average("outcome") },
			outcomeSeasons: OUTCOME_SEASONS,
		};
	},
});
