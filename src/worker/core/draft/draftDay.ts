import { PHASE, PLAYER } from "../../../common/constants.ts";
import { last } from "../../../common/utils.ts";
import type { Player, TradeTeams } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, trade } from "../index.ts";
import { canBeDrafted } from "./canBeDrafted.ts";
import {
	getDraftAdjustment,
	getNeedLabels,
	getTeamNeeds,
} from "./draftNeeds.ts";

/**
 * Data for the draft-day panel on the Draft page: each AI team's needs and the top of its board, and, for one trading partner, the assets both sides can put in a quick trade. Trades themselves go through the normal trade API (createTrade / tradeCounterOffer / proposeTrade), this only reads.
 */

const getAvailableProspects = async () => {
	let players: Player[];
	if (g.get("phase") === PHASE.FANTASY_DRAFT) {
		players = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
	} else {
		players = (
			await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
				[g.get("season")],
				[g.get("season"), Infinity],
			])
		).filter(canBeDrafted);
	}
	return players.sort((a, b) => b.value - a.value);
};

const BOARD_SIZE = 5;

export const getAITeamBoards = async () => {
	const prospects = await getAvailableProspects();
	const teams = (await idb.cache.teams.getAll()).filter(
		(t) => !t.disabled && !g.get("userTids").includes(t.tid),
	);
	const picks = await idb.cache.draftPicks.getAll();
	const output = [];
	for (const t of teams) {
		const teamPlayers = await idb.cache.players.indexGetAll(
			"playersByTid",
			t.tid,
		);
		const needs = getTeamNeeds(teamPlayers);
		// Same scoring as runPicks for AI teams. Names and order only, no values, so it doesn't reveal true ratings
		const board = prospects
			.slice(0, 40)
			.map((p) => ({
				p,
				score:
					p.value +
					(__SPORT === "basketball"
						? getDraftAdjustment(p, needs, t.strategy)
						: 0),
			}))
			.sort((a, b) => b.score - a.score)
			.slice(0, BOARD_SIZE)
			.map(({ p }) => ({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				pos: last(p.ratings).pos,
			}));
		const currentPicks = picks
			.filter((dp) => dp.tid === t.tid && dp.season === g.get("season"))
			.map((dp) => (dp.pick > 0 ? `${dp.round}-${dp.pick}` : `R${dp.round}`));
		output.push({
			tid: t.tid,
			abbrev: t.abbrev,
			name: `${t.region} ${t.name}`,
			strategy: t.strategy,
			needs: __SPORT === "basketball" ? getNeedLabels(needs) : [],
			board,
			currentPicks,
		});
	}
	return output;
};

const getAssets = async (tid: number) => {
	const picks = await idb.cache.draftPicks.indexGetAll("draftPicksByTid", tid);
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	const playersFormatted = await player.formatAll(players, {
		attrs: ["pid", "firstName", "lastName", "contract", "untradable"],
		ratings: ["ovr", "pot", "pos"],
		season: g.get("season"),
		showNoStats: true,
		showRookies: true,
		fuzz: true,
	});
	return {
		picks: await Promise.all(
			picks
				.sort(
					(a, b) =>
						(a.season === b.season ? 0 : Number(a.season) - Number(b.season)) ||
						a.round - b.round ||
						a.pick - b.pick,
				)
				.map(async (dp) => ({
					dpid: dp.dpid,
					desc: await helpers.pickDesc(dp, "short"),
					current: dp.season === g.get("season"),
				})),
		),
		players: playersFormatted
			.sort((a, b) => b.ratings.ovr - a.ratings.ovr)
			.map((p) => ({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				pos: p.ratings.pos,
				ovr: p.ratings.ovr,
				pot: p.ratings.pot,
				contract: p.contract,
				untradable: p.untradable,
			})),
	};
};

export const getDraftDayTrade = async (otherTid: number) => {
	const { teams } = await trade.get();
	const userTid = g.get("userTid");
	let tradeTeams: TradeTeams = teams;
	if (teams[0].tid !== userTid || teams[1].tid !== otherTid) {
		tradeTeams = [
			{ tid: userTid, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
			{ tid: otherTid, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
		];
	}
	const summary = await trade.summary(tradeTeams);
	return {
		teams: tradeTeams,
		user: await getAssets(userTid),
		other: await getAssets(otherTid),
		warning: summary.warning ?? null,
	};
};
