import { featureOffError } from "../util/nativeFeatures.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { g } from "../util/index.ts";
import { validateTeam } from "../util/processInputs.ts";
import { getTradeGrades } from "../util/valueData.ts";
import {
	rankSides,
	reportCards,
	type GradeSide,
} from "../../common/valueGrades/tradeGrader.ts";

export const TRADE_GRADER_TABS = ["best", "cards", "team", "season"] as const;
export type TradeGraderTab = (typeof TRADE_GRADER_TABS)[number];

const processInputs = (params: RouteParams<"tradeGrader">) => {
	const tab: TradeGraderTab = TRADE_GRADER_TABS.includes(
		params.tab as TradeGraderTab,
	)
		? (params.tab as TradeGraderTab)
		: "best";
	let team = validateTeam(params.team, ["all"]);
	if (tab === "team" && team === "all") {
		team = g.get("userTid");
	}
	let season: number | "all" = "all";
	if (params.season !== undefined && params.season !== "all") {
		const s = Number.parseInt(params.season);
		if (!Number.isNaN(s)) {
			season = s;
		}
	}
	return { tab, team, season };
};

const LIMIT = 100;

export default defineView({
	id: "tradeGrader",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("tradeGrader");
		if (featureOff) {
			return featureOff;
		}
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "The Trade grader is only available for basketball.",
			};
		}
		if (
			!(
				updateEvents.has("firstRun") ||
				updateEvents.has("gameSim") ||
				updateEvents.has("newPhase") ||
				updateEvents.has("playerMovement") ||
				inputs.tab !== prevInputs?.tab ||
				inputs.team !== prevInputs?.team ||
				inputs.season !== prevInputs?.season
			)
		) {
			return;
		}

		const G = await getTradeGrades();
		const { tab, team } = inputs;
		let season = inputs.season;
		if (tab === "season" && season === "all") {
			season = G.seasons.at(-1) ?? g.get("season");
		}
		const allSides = G.trades.flatMap((t) => t.sides);
		const graded = allSides.filter((s) => s.grade !== null).length;
		const partial = allSides.some((s) => s.partial);
		const open = G.trades.filter((t) => t.open).length;

		const inFilter = (s: GradeSide) =>
			(team === "all" || s.tid === team) &&
			(season === "all" || s.season === season);

		let wins: GradeSide[] = [];
		let losses: GradeSide[] = [];
		let cards = G.cards;
		let teamSides: GradeSide[] = [];
		let teamCard = null;
		let teamRank = null;
		let seasonTrades: typeof G.trades = [];

		if (tab === "best") {
			const ranked = rankSides(allSides.filter(inFilter));
			wins = ranked.filter((s) => s.net! > 0).slice(0, LIMIT);
			losses = ranked
				.filter((s) => s.net! < 0)
				.reverse()
				.slice(0, LIMIT);
		} else if (tab === "cards") {
			if (season !== "all") {
				cards = reportCards(allSides.filter((s) => s.season === season));
			}
			cards = cards.filter(
				(c) => c.graded > 0 && (team === "all" || c.tid === team),
			);
		} else if (tab === "team" && team !== "all") {
			teamCard = G.cards.find((c) => c.tid === team) ?? null;
			const ranked = G.cards
				.filter((c) => c.graded > 0)
				.sort((a, b) => b.net - a.net || a.tid - b.tid);
			const k = ranked.findIndex((c) => c.tid === team);
			teamRank = k >= 0 ? { rank: k + 1, of: ranked.length } : null;
			teamSides = allSides
				.filter(inFilter)
				.sort((a, b) => b.eid - a.eid || a.i - b.i);
		} else if (tab === "season") {
			seasonTrades = G.trades.filter(
				(t) => t.season === season && (team === "all" || t.tids.includes(team)),
			);
			const gap = (t: (typeof G.trades)[number]) =>
				t.sides[0].net === null ? -1 : Math.abs(t.sides[0].net);
			seasonTrades.sort((a, b) => gap(b) - gap(a) || a.eid - b.eid);
			cards = reportCards(
				G.trades.filter((t) => t.season === season).flatMap((t) => t.sides),
			).filter((c) => c.graded > 0);
		}

		return {
			tab,
			team,
			season,
			seasons: G.seasons,
			numTrades: G.trades.length,
			numSides: allSides.length,
			graded,
			partial,
			open,
			wins,
			losses,
			cards,
			teamCard,
			teamRank,
			teamSides,
			seasonTrades,
			userTid: g.get("userTid"),
		};
	},
});
