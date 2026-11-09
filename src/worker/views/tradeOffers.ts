import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import { featureOn } from "../util/nativeFeatures.ts";
import { augmentOffers } from "../api/index.ts";
import isUntradable from "../core/trade/isUntradable.ts";
import {
	getOfferAge,
	getOfferExpiration,
	pruneAiOffers,
} from "../core/trade/aiOffers.ts";
import { ValueChangeCalculator } from "../core/team/ValueChangeCalculator.ts";
import { addInlinePlayerInfo } from "./tradeProposals.ts";
import { defineView } from "../util/defineView.ts";
import { orderBy } from "../../common/utils.ts";

// From the user's point of view: how the offer changes the user's team value
export const getValueHint = (dv: number) => {
	if (dv > 2) {
		return "good" as const;
	}
	if (dv > -2) {
		return "fair" as const;
	}
	return "costly" as const;
};

// Inbox of the offers AI teams made to the user, see core/trade/aiOffers.ts. Replaces Trade Proposals when the
// aiTradeOffers League extra is on
export default defineView({
	id: "tradeOffers",
	load: async ({ updateEvents }) => {
		if (!featureOn("aiTradeOffers")) {
			return { redirectUrl: helpers.leagueUrl(["trade_proposals"]) };
		}

		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("gameSim") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes")
		) {
			return;
		}

		await pruneAiOffers();

		const userTid = g.get("userTid");
		const raw = g
			.get("aiTradeOffers")
			.filter((offer) => offer.teams[0].tid === userTid);
		const augmented = await augmentOffers(raw.map((offer) => offer.teams));

		const teamSeason = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsByTidSeason",
			[userTid, g.get("season")],
		);
		const gp = teamSeason ? helpers.getTeamSeasonGp(teamSeason) : 0;
		const expiration = getOfferExpiration();
		const valueChangeCalculator = new ValueChangeCalculator();

		const offers = [];
		for (const [i, offer] of augmented.entries()) {
			const r = raw[i]!;
			const age = getOfferAge(r, g.get("phase"), gp, g.get("daysLeft"));
			const dv = await valueChangeCalculator.evaluate({
				tid: userTid,
				pidsAdd: r.teams[1].pids,
				pidsRemove: r.teams[0].pids,
				dpidsAdd: r.teams[1].dpids,
				dpidsRemove: r.teams[0].dpids,
				tradingPartnerTid: r.tid,
			});
			offers.push({
				...addInlinePlayerInfo(offer),
				id: r.id,
				reason: r.reason,
				source: r.source ?? ("unsolicited" as const),
				// undefined: lasts until the phase changes
				expiresIn: age === undefined ? undefined : expiration - age,
				valueHint: getValueHint(dv),
			});
		}

		// Assets the user can request offers for
		const userPlayers = orderBy(
			(await idb.cache.players.indexGetAll("playersByTid", userTid)).filter(
				(p) => !isUntradable(p).untradable,
			),
			"valueFuzz",
			"desc",
		).map((p) => ({
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			pos: p.ratings.at(-1)!.pos,
			age: g.get("season") - p.born.year,
		}));
		const userPicks = [];
		for (const dp of await idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			userTid,
		)) {
			userPicks.push({
				dpid: dp.dpid,
				desc: await helpers.pickDesc(dp, "short"),
			});
		}

		const savedTradingBlock = await idb.cache.savedTradingBlock.get(0);

		return {
			offers,
			expiration,
			userPlayers,
			userPicks,
			blockPids:
				savedTradingBlock?.tid === userTid ? savedTradingBlock.pids : [],
		};
	},
});
