import { featureOffError } from "../util/nativeFeatures.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { player } from "../core/index.ts";
import { defineView } from "../util/defineView.ts";
import { getContractSummaryOrThrow } from "../core/contract/index.ts";
import isUntradable from "../core/trade/isUntradable.ts";
import {
	AVAILABLE_THRESHOLD,
	getAskingPrice,
	getAvailability,
} from "../core/trade/market.ts";
import { ValueChangeCalculator } from "../core/team/ValueChangeCalculator.ts";
import addFirstNameShort from "../util/addFirstNameShort.ts";
import { orderBy } from "../../common/utils.ts";

// Players each AI team is willing to move, with a hint at the asking price
export default defineView({
	id: "tradeMarket",
	load: async ({ updateEvents }) => {
		const featureOff = featureOffError("tradeMarket");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("gameSim") &&
			!updateEvents.has("newPhase")
		) {
			return;
		}

		const userTid = g.get("userTid");
		const season = g.get("season");
		const teams = (await idb.cache.teams.getAll()).filter(
			(t) => !t.disabled && !g.get("userTids").includes(t.tid),
		);

		const valueChangeCalculator = new ValueChangeCalculator({ quick: true });

		const rows = [];
		for (const t of teams) {
			const players = orderBy(
				await idb.cache.players.indexGetAll("playersByTid", t.tid),
				"value",
				"desc",
			);

			const available = [];
			for (const [valueRank, p] of players.entries()) {
				const contract = getContractSummaryOrThrow(p);
				const availability = getAvailability({
					strategy: t.strategy,
					age: season - p.born.year,
					valueRank,
					rosterSize: players.length,
					value: p.value,
					contractAmount: contract.amount,
					contractExp: contract.exp,
					season,
					minContract: g.get("minContract"),
					maxContract: g.get("maxContract"),
					untradable: isUntradable(p).untradable,
				});
				if (availability.score >= AVAILABLE_THRESHOLD) {
					available.push({ p, availability });
				}
			}

			if (available.length === 0) {
				continue;
			}

			// Value of the team's next first round pick, as a yardstick for the asking price
			const picks = orderBy(
				(
					await idb.cache.draftPicks.indexGetAll("draftPicksByTid", t.tid)
				).filter((dp) => dp.round === 1),
				"season",
			);
			let pickValue = 0;
			if (picks[0]) {
				pickValue = -(await valueChangeCalculator.evaluate({
					tid: t.tid,
					pidsAdd: [],
					pidsRemove: [],
					dpidsAdd: [],
					dpidsRemove: [picks[0].dpid],
					tradingPartnerTid: userTid,
				}));
			}

			const formatted = addFirstNameShort(
				await player.formatAll(
					available.map((row) => row.p),
					{
						attrs: [
							"pid",
							"firstName",
							"lastName",
							"age",
							"contract",
							"injury",
							"jerseyNumber",
							"draft",
							"tid",
						],
						ratings: ["ovr", "pot", "skills", "pos"],
						season,
						tid: t.tid,
						showNoStats: true,
						showRookies: true,
						fuzz: true,
					},
				),
			);

			for (const [i, row] of available.entries()) {
				const loss = -(await valueChangeCalculator.evaluate({
					tid: t.tid,
					pidsAdd: [],
					pidsRemove: [row.p.pid],
					dpidsAdd: [],
					dpidsRemove: [],
					tradingPartnerTid: userTid,
				}));
				rows.push({
					...formatted[i]!,
					abbrev: g.get("teamInfoCache")[t.tid]?.abbrev ?? "",
					strategy: t.strategy,
					availability: row.availability.score,
					reasons: row.availability.reasons,
					askingPrice: getAskingPrice(loss, pickValue, t.strategy),
				});
			}
		}

		return {
			challengeNoRatings: g.get("challengeNoRatings"),
			phase: g.get("phase"),
			players: orderBy(rows, "availability", "desc"),
			userTid,
		};
	},
});
