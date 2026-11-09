import { PHASE } from "../../../common/constants.ts";
import { orderBy } from "../../../common/utils.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, local } from "../../util/index.ts";
import { getContractDemand } from "../contract/index.ts";
import getPayroll from "../team/getPayroll.ts";
import getBest from "./getBest.ts";

// How interested an AI team is in a free agent, from autoSign: every day each team (unless it skips that day) signs the best free agent it can fit, so his chances depend on where he is on each team's list
export type MarketTier = "topTarget" | "backup" | "fallback";

export type FreeAgentMarketTeam = {
	tid: number;
	tier: MarketTier;
	// Chance this team signs him on the next day, if nobody else does first
	probPerDay: number;
};

export type FreeAgentMarket = {
	teams: FreeAgentMarketTeam[];
	numInterested: number;
	// Chance he signs with some AI team on the next day
	probSignedNextDay: number;
	// Team most likely to sign him, if any
	likelyTid: number | undefined;
	// What AI teams would pay (his contract demand, before mood), thousands of dollars
	aiOffer: number;
};

// Chance a team acts on a given day, matching autoSign
export const getProbTeamActs = (strategy: string) => {
	if (__SPORT === "basketball") {
		return 1 - (strategy === "rebuilding" ? 0.9 : 0.75);
	}
	return 0.5;
};

const TIER_FACTOR: Record<MarketTier, number> = {
	topTarget: 1,
	backup: 0.4,
	fallback: 0.15,
};
const TIERS: MarketTier[] = ["topTarget", "backup", "fallback"];

export const combineMarket = (
	teams: FreeAgentMarketTeam[],
	aiOffer: number,
): FreeAgentMarket => {
	let probNone = 1;
	let likely: FreeAgentMarketTeam | undefined;
	for (const t of teams) {
		probNone *= 1 - t.probPerDay;
		if (!likely || t.probPerDay > likely.probPerDay) {
			likely = t;
		}
	}
	return {
		teams: orderBy(teams, "probPerDay", "desc"),
		numInterested: teams.length,
		probSignedNextDay: 1 - probNone,
		likelyTid: likely?.tid,
		aiOffer,
	};
};

// For each free agent, which AI teams want him and how likely each is to sign him soon. This runs getBest a few times per team, like autoSign would over the next few days, without signing anyone.
export const getFreeAgentMarket = async (freeAgents: Player[]) => {
	const output: Record<number, FreeAgentMarket> = {};
	const phase = g.get("phase");
	const signingAllowed =
		phase === PHASE.FREE_AGENCY ||
		phase === PHASE.REGULAR_SEASON ||
		phase === PHASE.AFTER_TRADE_DEADLINE ||
		phase === PHASE.PRESEASON;
	if (freeAgents.length === 0) {
		return output;
	}

	const byPid = new Map<number, FreeAgentMarketTeam[]>();
	if (signingAllowed) {
		const sorted = orderBy(freeAgents, "value", "desc");
		const teams = await idb.cache.teams.getAll();
		const userTids = g.get("userTids");
		for (const t of teams) {
			if (
				t.disabled ||
				(userTids.includes(t.tid) &&
					!local.autoPlayUntil &&
					!g.get("spectator"))
			) {
				continue;
			}
			if (
				g.get("forceHistoricalRosters") &&
				(await idb.cache.players.indexGetAll("playersByTid", t.tid)).length >=
					g.get("minRosterSize")
			) {
				continue;
			}

			// A copy, since players are added to it below
			const roster = [
				...(await idb.cache.players.indexGetAll("playersByTid", t.tid)),
			];
			let payroll = await getPayroll(t.tid);
			let available = sorted;
			const probActs = getProbTeamActs(t.strategy);

			for (const tier of TIERS) {
				const p = getBest(roster, available, payroll);
				if (!p) {
					break;
				}
				const list = byPid.get(p.pid) ?? [];
				list.push({
					tid: t.tid,
					tier,
					probPerDay: probActs * TIER_FACTOR[tier],
				});
				byPid.set(p.pid, list);

				available = available.filter((p2) => p2 !== p);
				roster.push(p);
				payroll += getContractDemand(p).amount;
			}
		}
	}

	for (const p of freeAgents) {
		output[p.pid] = combineMarket(
			byPid.get(p.pid) ?? [],
			p.contractDemand?.amount ?? g.get("minContract"),
		);
	}

	return output;
};
