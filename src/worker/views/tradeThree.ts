import { featureOffError } from "../util/nativeFeatures.ts";
import { featureOn } from "../util/nativeFeatures.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import { player } from "../core/index.ts";
import { defineView } from "../util/defineView.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import addFirstNameShort from "../util/addFirstNameShort.ts";
import { orderBy } from "../../common/utils.ts";

// URL is like /trade_three/3-7 for the user's team plus teams 3 and 7
const processInputs = (params: RouteParams<"tradeThree">) => {
	const otherTids = (params.tids ?? "")
		.split("-")
		.map((x) => Number.parseInt(x))
		.filter((x) => !Number.isNaN(x));
	return { otherTids };
};

export default defineView({
	id: "tradeThree",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		const featureOff = featureOffError("threeTeamTrades");
		if (featureOff) {
			return featureOff;
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("newPhase") &&
			inputs.otherTids.join("-") !== prevInputs?.otherTids.join("-")
		) {
			return;
		}

		const userTid = g.get("userTid");
		const allTeams = (await idb.cache.teams.getAll()).filter(
			(t) => !t.disabled,
		);
		const otherTeams = allTeams.filter((t) => t.tid !== userTid);

		// Fill in any missing/invalid teams with the first valid ones
		const otherTids: number[] = [];
		for (const tid of inputs.otherTids) {
			if (
				otherTeams.some((t) => t.tid === tid) &&
				!otherTids.includes(tid) &&
				otherTids.length < 2
			) {
				otherTids.push(tid);
			}
		}
		for (const t of otherTeams) {
			if (otherTids.length >= 2) {
				break;
			}
			if (!otherTids.includes(t.tid)) {
				otherTids.push(t.tid);
			}
		}

		const tids = [userTid, ...otherTids];
		const teams = [];
		for (const tid of tids) {
			const t = allTeams.find((t) => t.tid === tid);
			const playersRaw = orderBy(
				await idb.cache.players.indexGetAll("playersByTid", tid),
				"rosterOrder",
			);
			const players = addFirstNameShort(
				await player.formatAll(playersRaw, {
					attrs: [
						"pid",
						"firstName",
						"lastName",
						"age",
						"contract",
						"injury",
						"untradable",
						"jerseyNumber",
						"draft",
					],
					ratings: ["ovr", "pot", "skills", "pos"],
					season: g.get("season"),
					tid,
					showNoStats: true,
					showRookies: true,
					fuzz: true,
				}),
			);
			const picksRaw = await idb.merged.draftPicks.getAll({ tid });
			const picks = [];
			for (const dp of orderBy(picksRaw, ["season", "round"])) {
				picks.push({
					dpid: dp.dpid,
					desc: await helpers.pickDesc(dp, "short"),
					canHaveCondition:
						featureOn("draftPickConditions") &&
						typeof dp.season === "number" &&
						dp.pick === 0 &&
						!dp.protection &&
						!dp.swap,
				});
			}
			const info = g.get("teamInfoCache")[tid];
			teams.push({
				tid,
				abbrev: info?.abbrev ?? "",
				name: info ? `${info.region} ${info.name}` : "",
				strategy: t?.strategy ?? "rebuilding",
				players,
				picks,
			});
		}

		return {
			challengeNoRatings: g.get("challengeNoRatings"),
			teamOptions: otherTeams.map((t) => {
				const info = g.get("teamInfoCache")[t.tid];
				return {
					tid: t.tid,
					name: info ? `${info.region} ${info.name}` : String(t.tid),
				};
			}),
			teams,
		};
	},
});
