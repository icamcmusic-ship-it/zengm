import type { Conditions, TeamFiltered } from "../../../common/types.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { processAwards } from "./processAwards.ts";
import {
	getAwardsByPlayer,
	getLeagueLeaderAwards,
	updatePlayerAwards,
} from "./awardsByPlayer.ts";
import { orderTeams } from "../../util/orderTeams.ts";
import { leaderAwardCategories } from "../../../common/awards.ts";
import { team } from "../index.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";
import { applyVoteToWinners, runVotes, voteInputs } from "./simVote.ts";
import type { SimVote } from "../../../common/awardVote/index.ts";

const teamAwards = async (
	teamsUnsorted: TeamFiltered<
		["tid"],
		[
			"winp",
			"pts",
			"won",
			"lost",
			"tied",
			"otl",
			"wonDiv",
			"lostDiv",
			"tiedDiv",
			"otlDiv",
			"wonConf",
			"lostConf",
			"tiedConf",
			"otlConf",
			"cid",
			"did",
		],
		["pts", "oppPts", "gp"],
		number
	>[],
) => {
	const teams = await orderTeams(teamsUnsorted, teamsUnsorted);
	if (!teams[0]) {
		throw new Error("No teams found");
	}

	const bestRecord = teams[0].tid;

	const bestRecordConfs: Record<number, number> = {};
	for (const conf of g.get("confs", "current")) {
		const teamsConf = await orderTeams(
			teams.filter((t2) => t2.seasonAttrs.cid === conf.cid),
			teams,
		);
		const t = teamsConf[0];
		if (t) {
			bestRecordConfs[conf.cid] = t.tid;
		}
	}

	const bestRecordDivs: Record<number, number> = {};
	for (const div of g.get("divs", "current")) {
		const teamsDiv = await orderTeams(
			teams.filter((t2) => t2.seasonAttrs.did === div.did),
			teams,
		);
		const t = teamsDiv[0];
		if (t) {
			bestRecordDivs[div.did] = t.tid;
		}
	}

	return {
		bestRecord,
		bestRecordConfs,
		bestRecordDivs,
	};
};

const NUM_PLAYERS_TO_STORE_PER_INDIVIDUAL_AWARD = 5;

export const doAwards = async (conditions: Conditions) => {
	const season = g.get("season");
	const awardVoteOn = __SPORT === "basketball" && featureOn("awardVote");

	const teams = await team.getFormattedAll({
		attrs: ["tid"],
		seasonAttrs: [
			"won",
			"lost",
			"tied",
			"otl",
			"wonDiv",
			"lostDiv",
			"tiedDiv",
			"otlDiv",
			"wonConf",
			"lostConf",
			"tiedConf",
			"otlConf",
			"winp",
			"pts",
			"playoffRoundsWon",
			"abbrev",
			"region",
			"name",
			"cid",
			"did",
		],
		stats: ["pts", "oppPts", "gp"],
		season,
		showNoStats: true,
	});
	const bestRecords = await teamAwards(teams);

	const { players, realizedAwards } = await processAwards({
		awards: g.get("awards"),
		// League extras (Award Vote): more candidates for the simulated vote, cut back to the stored number below
		numPlayersPerIndividualAward: awardVoteOn
			? 10
			: NUM_PLAYERS_TO_STORE_PER_INDIVIDUAL_AWARD,
		season,
		statOverridesByMatchup: undefined,

		// For getLeagueLeaderAwards
		extraStatRanges: ["regularSeason"],
		extraStats: leaderAwardCategories.map((row) => row.stat),
	});
	const flatRealizedAwards = realizedAwards.flat();

	let simVote: SimVote[] | undefined;
	if (awardVoteOn) {
		const decides = featureOption<boolean>("featureAwardVoteDecides") === true;
		simVote = runVotes(
			await voteInputs({
				season,
				realizedAwards: flatRealizedAwards,
				players,
				respect: !decides,
			}),
			season,
		);
		if (decides) {
			applyVoteToWinners(flatRealizedAwards, simVote);
		}
		for (const award of flatRealizedAwards) {
			if (award.numTeams === undefined) {
				award.winner = award.winner.slice(
					0,
					NUM_PLAYERS_TO_STORE_PER_INDIVIDUAL_AWARD,
				);
			}
		}
		if (featureOption<boolean>("featureAwardVoteStore") === false) {
			simVote = undefined;
		}
	}

	const awardsByPlayer = [
		...getAwardsByPlayer(flatRealizedAwards, players),
		...(await getLeagueLeaderAwards(players, season)),
	];

	await updatePlayerAwards({
		awardsToDelete: [],
		awardsToSave: awardsByPlayer,
		logEventInfo: {
			conditions,
		},
		season: g.get("season"),
	});

	const awards = {
		season,
		...bestRecords,
		awards: flatRealizedAwards,
		...(simVote && simVote.length > 0 ? { simVote } : {}),
	};
	await idb.cache.awards.put(awards);
};
