import { getCurrentContract } from "../../../common/contracts.ts";
import {
	hasActiveTradeRequest,
	TRADE_REQUEST_VALUE_FACTOR,
} from "../contract/unrest.ts";
import { contractToSummary } from "../contract/index.ts";
import { getContractStartSeason } from "../../util/getContractStartSeason.ts";
import { PHASE } from "../../../common/constants.ts";
import { draft, player, team, trade } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local } from "../../util/index.ts";
import type {
	TradePickValues,
	Player,
	FlatContractInfo,
	PlayerInjury,
	DraftPick,
	DraftPickProtection,
	DraftPickProtectionThen,
	Team,
	TradePickCondition,
} from "../../../common/types.ts";
import { getNumPicksPerRound } from "../trade/getPickValues.ts";
import {
	makeAiTraitValueFactorCache,
	traitsEnabled,
} from "../player/traits.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import { groupByUnique, last } from "../../../common/utils.ts";
import {
	getNumToPick,
	getRoundOrderRule,
	NotEnoughTeamsError,
} from "../draft/genOrder.ts";
import getNumPlayoffTeams from "../season/getNumPlayoffTeams.ts";
import {
	getDraftLotteryProbsCached,
	getFirstRoundSlotProbsCached,
	getSlotPickProbsCached,
	type ProjectedTeam,
} from "./pickProbsCache.ts";
import type { TeamSeasonRecord } from "./getHypotheticalTeam.ts";
import {
	gmPlayerStyleFactor,
	gmPlayerStyleScore,
	gmRiskFactor,
	type GmWeights,
} from "../../../common/gmPersonality.ts";
import { getProStats } from "../../../common/preDraft.ts";
import { getGmWeights } from "../gm/index.ts";

type Asset =
	| {
			type: "player";
			pid?: number;
			value: number;
			contractValue: number;
			injury: PlayerInjury;
			age: number;
			justDrafted: boolean;
	  }
	| {
			type: "pick";
			value: number;
			contractValue: number;
			injury: PlayerInjury;
			age: number;
			dp: DraftPick;
			draftPick: number;
			draftYear: number;

			// Draft pick conditions: chance a protected pick conveys, and whether this is just the right to swap picks
			probConvey?: number;
			swap?: true;
	  };

const zscore = (value: number) =>
	(value - local.playerOvrMean) / local.playerOvrStd;

const ovrIndexToEstWinPercent = (teamOvrIndex: number) => {
	return (
		0.25 +
		(0.5 * (g.get("numActiveTeams") - 1 - teamOvrIndex)) /
			(g.get("numActiveTeams") - 1)
	);
};

// After the regular season, rosters keep changing but the record doesn't, so it says less about how good a team will be in future seasons
const OFFSEASON_RECORD_WEIGHT = 0.25;

// Weighted average of current season record and team rating, based on how much of the current season is complete. futureDraft means this is for a draft after the current season's draft
const getEstWinPercent = ({
	futureDraft,
	teamOvrWinp,
	teamSeason,
}: {
	futureDraft: boolean;
	teamOvrWinp: number;
	teamSeason:
		| {
				won: number;
				lost: number;
				tied: number;
				otl: number;
		  }
		| undefined;
}) => {
	const gp = teamSeason ? helpers.getTeamSeasonGp(teamSeason) : 0;

	if (!teamSeason || gp === 0) {
		// Expansion team?
		return teamOvrWinp;
	}

	let recordWeight = helpers.bound(gp / g.get("numGames"), 0, 1);
	if (futureDraft && g.get("phase") > PHASE.PLAYOFFS) {
		recordWeight = Math.min(recordWeight, OFFSEASON_RECORD_WEIGHT);
	}

	return (
		recordWeight * helpers.calcWinp(teamSeason) +
		(1 - recordWeight) * teamOvrWinp
	);
};

// Uncertainty (standard deviation) in how good a team really is, in units of winning percentage. These are just rough guesses! Uncertainty from the randomness of individual games is handled separately.
const TEAM_QUALITY_STD_CURRENT_SEASON = 0.05;
const TEAM_QUALITY_STD_FUTURE_SEASON = 0.1;

// What the simulation in getFirstRoundSlotProbs needs to know about a team: the results of games already played, how many games are left, and how we expect it to do in those games. Early in the season anything can happen. Late in the season there are few games left to change things, and some things can't change at all, like if a team has already clinched a playoff spot.
const getProjectedTeam = ({
	futureDraft,
	noDraftPick,
	season,
	t,
	teamOvrWinp,
	teamSeason,
	wp,
}: {
	futureDraft: boolean;
	noDraftPick: boolean;

	// See PickEstimates
	season: number;

	t: Pick<Team, "tid" | "cid" | "did">;
	teamOvrWinp: number;
	teamSeason: TeamSeasonRecord | undefined;
	wp: number;
}): ProjectedTeam => {
	// For a future draft, the whole season is left to play
	const currentTeamSeason = futureDraft ? undefined : teamSeason;
	const gp = currentTeamSeason ? helpers.getTeamSeasonGp(currentTeamSeason) : 0;
	const gamesLeft = Math.max(g.get("numGames", season) - gp, 0);

	// For this season, what happened so far is in currentTeamSeason, so this is just about the rest of the season. For a future season, wp already includes everything we know.
	const winp = futureDraft ? wp : teamOvrWinp;

	// Randomness in the results of the remaining games, which is larger when there are fewer games. Bound winp so it never looks like a team has no chance of winning or losing a game.
	const winpBounded = helpers.bound(winp, 0.1, 0.9);
	const varianceGames =
		gamesLeft > 0 ? (winpBounded * (1 - winpBounded)) / gamesLeft : 0;

	const stdTeamQuality = futureDraft
		? TEAM_QUALITY_STD_FUTURE_SEASON
		: TEAM_QUALITY_STD_CURRENT_SEASON;

	return {
		teamSeason: {
			tid: t.tid,
			cid: currentTeamSeason?.cid ?? t.cid,
			did: currentTeamSeason?.did ?? t.did,
			won: currentTeamSeason?.won ?? 0,
			lost: currentTeamSeason?.lost ?? 0,
			otl: currentTeamSeason?.otl ?? 0,
			tied: currentTeamSeason?.tied ?? 0,
			wonDiv: currentTeamSeason?.wonDiv ?? 0,
			lostDiv: currentTeamSeason?.lostDiv ?? 0,
			otlDiv: currentTeamSeason?.otlDiv ?? 0,
			tiedDiv: currentTeamSeason?.tiedDiv ?? 0,
			wonConf: currentTeamSeason?.wonConf ?? 0,
			lostConf: currentTeamSeason?.lostConf ?? 0,
			otlConf: currentTeamSeason?.otlConf ?? 0,
			tiedConf: currentTeamSeason?.tiedConf ?? 0,
		},
		gamesLeft,
		winp,
		winpStd: Math.sqrt(varianceGames + stdTeamQuality ** 2),
		noDraftPick,
	};
};

const MIN_VALUE = bySport({
	baseball: -0.75,
	basketball: -0.5,
	football: -1,
	hockey: -0.5,
});
const MAX_VALUE = bySport({
	baseball: 2.5,
	basketball: 2,
	football: 3,
	hockey: 2,
});
// Like getContractSummary, but for a contract that has different amounts in different seasons, amount is the average of the remaining seasons
const getContractForValuation = (p: Player) => {
	if (p.contractDemand) {
		return p.contractDemand;
	}

	const contract = getCurrentContract(p);
	if (!contract) {
		throw new Error(
			`No contract or contract demand for ${p.firstName} ${p.lastName} (pid ${p.pid})`,
		);
	}

	const summary = contractToSummary(contract);
	const remainingAmounts = contract.amounts.slice(
		Math.max(0, getContractStartSeason() - contract.start),
	);
	if (remainingAmounts.length > 0) {
		summary.amount =
			Math.sumPrecise(remainingAmounts) / remainingAmounts.length;
	}
	return summary;
};

const getContractValue = (
	contract: FlatContractInfo,
	normalizedValue: number,
) => {
	const season = g.get("season");
	const phase = g.get("phase");
	if (
		contract.exp === season ||
		(phase > PHASE.PLAYOFFS && contract.exp === season + 1)
	) {
		// Don't care about expiring contracts
		return 0;
	}

	const salaryCap = g.get("salaryCap");
	const normalizedContractAmount = contract.amount / salaryCap;

	const slope =
		(g.get("maxContract") / salaryCap - g.get("minContract") / salaryCap) /
		(MAX_VALUE - MIN_VALUE);

	const expectedAmount = slope * (normalizedValue - MIN_VALUE);

	const contractValue = expectedAmount - normalizedContractAmount;

	// Don't let contract value exceed 0.1, it's just a small boost or a big penalty
	return Math.min(contractValue, 0.1);
};

// A drafted-here or longtime (3+ seasons) player of this team
const isLongtimePlayer = (p: Player, tid: number) => {
	if (p.draft.tid === tid) {
		return true;
	}
	const seasons = new Set<number>();
	for (const row of getProStats(p)) {
		if (row.tid === tid && !row.playoffs) {
			seasons.add(row.season);
		}
	}
	return seasons.size >= 3;
};

// AI GM personalities: analytics/old-school taste, risk, and loyalty (ownTid set: a player of his own team he'd give up)
export const getGmPlayerFactor = (
	gm: GmWeights,
	p: Player,
	ownTid?: number,
) => {
	const r = p.ratings.at(-1)!;
	const age = g.get("season") - p.born.year;
	const stats = getProStats(p)
		.filter((row) => !row.playoffs)
		.at(-1);
	const hgt = "hgt" in r && typeof r.hgt === "number" ? r.hgt : 50;
	let factor =
		gmPlayerStyleFactor(
			gm,
			gmPlayerStyleScore({
				age,
				ovr: r.ovr,
				pot: r.pot,
				hgt,
				per: stats?.per,
				min: stats?.min,
			}),
		) * gmRiskFactor(gm, { age, ovr: r.ovr, pot: r.pot });
	if (ownTid !== undefined && isLongtimePlayer(p, ownTid)) {
		factor *= gm.loyaltyFactor;
	}
	return factor;
};

const getPlayers = async ({
	add,
	remove,
	pidsAdd,
	pidsRemove,
	tid,
	tradingPartnerTid,
	getTraitFactor,
	gm,
}: {
	add: Asset[];
	remove: Asset[];
	pidsAdd: number[];
	pidsRemove: number[];
	tid: number;
	tradingPartnerTid?: number;
	getTraitFactor: ReturnType<typeof makeAiTraitValueFactorCache>;
	gm?: GmWeights;
}) => {
	const season = g.get("season");
	const phase = g.get("phase");
	const difficultyFudgeFactor = helpers.bound(
		1 + 0.1 * g.get("difficulty"),
		0,
		Infinity,
	); // 2.5% bonus for easy, 2.5% penalty for hard, 10% penalty for insane

	// Fudge factor for AI overvaluing its own players
	const fudgeFactor =
		(tid !== g.get("userTid") && tradingPartnerTid !== g.get("userTid")
			? 1.05
			: 1) * difficultyFudgeFactor;

	// Get players to remove
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);

	// Player traits (setting): a small, bounded adjustment, the same for players coming in and going out so there is nothing to arbitrage. 1 with the setting off
	const traitsOn = traitsEnabled();
	const strategy = traitsOn
		? (await idb.cache.teams.get(tid))?.strategy
		: undefined;
	// The team's own roster as it is now: young players to mentor, and the locker room (ego, temper) a player would join or leave
	const traitTeam = traitsOn ? getTraitFactor.teamContext(players) : undefined;
	const traitFactor = (p: Player) =>
		traitsOn ? getTraitFactor(p, { strategy, team: traitTeam }) : 1;

	// AI GM personalities (setting): how this team's GM sees the player, 1 with the setting off. Loyal GMs ask more for their own
	// longtime players, ruthless ones less
	const gmFactor = (p: Player, own: boolean) =>
		gm ? getGmPlayerFactor(gm, p, own ? tid : undefined) : 1;

	for (const p of players) {
		if (!pidsRemove.includes(p.pid)) {
			continue;
		}

		const value = zscore(p.value);

		// Only apply fudge factor to positive assets
		let fudgedValue = value;
		if (fudgedValue > 0) {
			fudgedValue *= fudgeFactor * traitFactor(p) * gmFactor(p, true);

			// A team gets less for a player who publicly asked out
			if (hasActiveTradeRequest(p)) {
				fudgedValue *= TRADE_REQUEST_VALUE_FACTOR;
			}
		}

		const contract = getContractForValuation(p);
		remove.push({
			type: "player",
			pid: p.pid,
			value: fudgedValue,
			contractValue: getContractValue(contract, value),
			injury: p.injury,
			age: g.get("season") - p.born.year,
			justDrafted: helpers.justDrafted(
				{ draft: p.draft, contract },
				phase,
				season,
			),
		});
	}

	// Get players to add
	for (const pid of pidsAdd) {
		const p = await idb.cache.players.get(pid);
		if (p) {
			const value = zscore(p.value);

			const contract = getContractForValuation(p);
			add.push({
				type: "player",
				pid: p.pid,
				value: value > 0 ? value * traitFactor(p) * gmFactor(p, false) : value,
				contractValue: getContractValue(contract, value),
				injury: p.injury,
				age: g.get("season") - p.born.year,
				justDrafted: helpers.justDrafted(
					{ draft: p.draft, contract },
					phase,
					season,
				),
			});
		}
	}
};

const EXPONENT = bySport({
	baseball: 3,
	basketball: 7,
	football: 3,
	hockey: 3.5,
});

// Value is on a scale where it makes sense to compare players. Trade value is what actually gets added up when evaluating a trade, to account for one great player being worth more than a few good players.
const valueToTradeValue = (value: number) => {
	return value > 1 ? value ** EXPONENT : value;
};
const tradeValueToValue = (tradeValue: number) => {
	return tradeValue > 1 ? tradeValue ** (1 / EXPONENT) : tradeValue;
};

type PickNumber =
	| {
			// Draft order is already set
			type: "known";
			pick: number;
	  }
	| {
			type: "projected";
			futureDraft: boolean;

			// Projected position of the team in the order going into the draft, where 1 is the worst team. This accounts for the effect of this trade on the team
			slot: number;

			// How much this trade changed slot, which is usually 0
			tradeShift: number;

			// How much we should adjust slot by, to account for uncertainty in the future. This is not necessarily an integer
			bias: number;

			// When trading with the user, we intentionally value draft picks differently. This is how much to adjust the pick by, after accounting for the draft lottery or anything else that determines which pick a slot gets. It's applied to the pick rather than the slot because otherwise a draft lottery would weaken it. This is not necessarily an integer
			userTradeShift: number;
	  };

// All numbers returned here are relative to the start of a round
const getPickNumber = async (
	cache: ValueChangeCache,
	dp: DraftPick,
	season: number,
	pidsAdd: number[],
	pidsRemove: number[],
	tid: number,
	tradingPartnerTid?: number,
): Promise<PickNumber> => {
	if (dp.pick > 0) {
		return {
			type: "known",
			pick: dp.pick,
		};
	}

	const numPicksPerRound = getNumPicksPerRound();

	const futureDraft = season > g.get("season");
	const cachedSlot = (futureDraft ? cache.future : cache).estPicks[
		dp.originalTid
	];
	let temp = cachedSlot;

	// Used to know when to overvalue own pick
	const tradeWithUser = tradingPartnerTid === g.get("userTid");

	// if trading with the user, make sure the AI pick is accurately judged
	// based on what players are outgoing in the trade
	// and just use the cached estimated pick if no players are being exchanged
	if (
		tid !== g.get("userTid") &&
		dp.originalTid === tid &&
		tradeWithUser &&
		pidsAdd.length + pidsRemove.length > 0
	) {
		temp = await getModifiedPickRank(
			cache,
			futureDraft,
			tid,
			pidsAdd,
			pidsRemove,
		);
	}
	const slot = temp !== undefined ? temp : numPicksPerRound / 2;

	// tid rather than originalTid, because it's about what the user can control
	const usersPick = dp.tid === g.get("userTid");

	// For future draft picks, add some uncertainty.
	const regressionTarget = (usersPick ? 0.75 : 0.25) * numPicksPerRound;

	// Never let this improve the future projection of user's picks
	let seasons = helpers.bound(season - g.get("season"), 0, 5);
	if (tradeWithUser && seasons > 0) {
		// When trading with the user, expect things to change rapidly
		seasons = helpers.bound(seasons + 1, 0, 5);
	}

	if (seasons === 0 && g.get("phase") < PHASE.PLAYOFFS) {
		// Would be better to base on fraction of season completed, but oh well
		seasons += 0.5;
	}

	// regressionTarget is a pick, so do the regression on the pick this slot gets. They're only different if the best team picks first
	const reverse = getRoundOrderRule(g.get("draftType"), dp.round) === "reverse";
	const projectedPick = reverse ? numPicksPerRound + 1 - slot : slot;

	// Weighted average of projectedPick and regressionTarget. No rounding, because rounding can result in a better team having a more valuable pick
	const regressedPick =
		(projectedPick * (5 - seasons)) / 5 + (regressionTarget * seasons) / 5;

	// Convert back to a slot, since bias is applied to the slot
	const regressedSlot = reverse
		? numPicksPerRound + 1 - regressedPick
		: regressedPick;

	let estPick = regressedPick;
	if (tradeWithUser && seasons > 0) {
		if (usersPick) {
			// Penalty for user draft picks
			const difficultyFactor = 1 + 1.5 * g.get("difficulty");
			estPick = helpers.bound(
				(estPick + numPicksPerRound / 3.5) * difficultyFactor,
				1,
				numPicksPerRound,
			);
		} else {
			// Bonus for AI draft picks
			estPick = helpers.bound(
				estPick - numPicksPerRound / 3.5,
				1,
				numPicksPerRound,
			);
		}
	}

	return {
		type: "projected",
		futureDraft,
		slot,
		tradeShift: cachedSlot !== undefined ? slot - cachedSlot : 0,
		bias: regressedSlot - slot,
		userTradeShift: estPick - regressedPick,
	};
};

// Value of the player we expect to be available at a pick, where pick is the overall pick number, not relative to the start of the round
const getPickValue = (
	cache: ValueChangeCache,
	season: number,
	pick: number,
) => {
	let value;
	const valuesTemp = cache.estValues[season];
	if (valuesTemp) {
		value = valuesTemp[pick - 1];
	}
	if (value === undefined) {
		value = cache.estValues.default[pick - 1];
	}
	if (value === undefined) {
		value = cache.estValues.default.at(-1);
	}
	if (value === undefined) {
		value = 20;
	}

	return zscore(value);
};

// Since rookies can be cut after the draft, value of a draft pick can't be negative
const MIN_PICK_VALUE = 0.1;

// tradeValue rather than value because any averaging over possible picks needs to happen after applying EXPONENT, since that's what actually gets added up to evaluate a trade. Like a 10% chance at a superstar is worth a lot more than a player who is 10% as good as a superstar.
const getPickTradeValue = (
	cache: ValueChangeCache,
	season: number,
	pick: number,
) => {
	return valueToTradeValue(
		Math.max(MIN_PICK_VALUE, getPickValue(cache, season, pick)),
	);
};

// Number of teams in the order going into the draft
const getNumSlots = (cache: ValueChangeCache) => {
	return cache.wps.filter((row) => !row.projectedTeam.noDraftPick).length;
};

// After the regular season is over, we don't need to project where teams will be going into the draft, we can just look. This returns the probability of each pick in the first round, for each first round pick in this season's draft. Keys are dpid, and arrays are 0 indexed (so index 0 is the 1st pick).
const getCurrentFirstRoundPickProbs = async () => {
	// For a random draft, the order from genOrder is just one of many possibilities
	if (getRoundOrderRule(g.get("draftType"), 1) === "random") {
		return;
	}

	let result;
	try {
		result = await draft.genOrder(true);
	} catch (error) {
		if (error instanceof NotEnoughTeamsError) {
			return;
		}

		throw error;
	}
	const { draftLotteryResult, draftPicks } = result;

	const firstRoundPicks = draftPicks.filter((dp) => dp.round === 1);
	const numPicks = firstRoundPicks.length;

	const pickProbs = new Map<number, number[]>();

	if (draftLotteryResult) {
		const { numPlayInTeams } = await getNumPlayoffTeams(g.get("season"));
		const numToPick = getNumToPick(
			draftLotteryResult.draftType,
			draftLotteryResult.result.length,
			numPlayInTeams,
		);
		const lotteryProbs = await getDraftLotteryProbsCached(
			draftLotteryResult,
			numToPick,
		);

		for (const [i, row] of draftLotteryResult.result.entries()) {
			const probs = new Array<number>(numPicks).fill(0);
			let sum = 0;
			for (let pick = 0; pick < numPicks; pick++) {
				const prob = lotteryProbs?.[i]?.[pick] ?? 0;
				probs[pick] = prob;
				sum += prob;
			}

			// If something is wrong with the lottery probabilities, fall back to the simulated lottery result from genOrder below
			if (Math.abs(sum - 1) < 0.01) {
				pickProbs.set(row.dpid, probs);
			}
		}
	}

	// Everybody not in the lottery
	for (const dp of firstRoundPicks) {
		if (!pickProbs.has(dp.dpid) && dp.pick > 0 && dp.pick <= numPicks) {
			const probs = new Array<number>(numPicks).fill(0);
			probs[dp.pick - 1] = 1;
			pickProbs.set(dp.dpid, probs);
		}
	}

	return pickProbs;
};

const getSimulatedSlotProbs = (
	pickEstimates: PickEstimates,
	quick: boolean,
) => {
	pickEstimates.firstRoundSlotProbs ??= getFirstRoundSlotProbsCached(
		pickEstimates.wps.map((row) => row.projectedTeam),
		quick,
		pickEstimates.season,
	);

	return pickEstimates.firstRoundSlotProbs;
};

// Move everything in probs by some number of positions, which does not need to be an integer. Anything that would go past either end of the array stays at that end.
const shiftProbs = (probs: number[], shift: number) => {
	if (shift === 0) {
		return probs;
	}

	const maxIndex = probs.length - 1;
	const shifted = new Array<number>(probs.length).fill(0);
	for (const [i, prob] of probs.entries()) {
		if (prob > 0) {
			// If it's between two positions, split it between them
			const index = i + shift;
			const indexBelow = Math.floor(index);
			const fractionAbove = index - indexBelow;
			shifted[helpers.bound(indexBelow, 0, maxIndex)]! +=
				prob * (1 - fractionAbove);
			shifted[helpers.bound(indexBelow + 1, 0, maxIndex)]! +=
				prob * fractionAbove;
		}
	}

	return shifted;
};

// Probability of a team being in each slot in the order of teams going into the draft, where index 0 is the worst team
const getSlotProbs = async (
	cache: ValueChangeCache,
	dp: DraftPick,
	pickNumber: Extract<PickNumber, { type: "projected" }>,
) => {
	let shift = pickNumber.bias;

	// After the first round the differences between picks are small, so it's not worth worrying about uncertainty
	let slotProbs;
	if (dp.round === 1) {
		const pickEstimates = pickNumber.futureDraft ? cache.future : cache;
		slotProbs = (await getSimulatedSlotProbs(pickEstimates, cache.quick)).get(
			dp.originalTid,
		);
	}

	if (slotProbs) {
		// If this trade changes where we project the team to be, shift everything by that amount
		shift += pickNumber.tradeShift;
	} else {
		// No uncertainty, team is just in its projected slot. -1 is to convert to 0 indexed, like slotProbs
		slotProbs = new Array<number>(getNumSlots(cache)).fill(0);
		slotProbs[0] = 1;
		shift += pickNumber.slot - 1;
	}

	return shiftProbs(slotProbs, shift);
};

// Probability of getting each pick in a round, where index 0 is the first pick in the round
const getPickProbs = async (
	cache: ValueChangeCache,
	dp: DraftPick,
	pickNumber: Extract<PickNumber, { type: "projected" }>,
) => {
	const slotProbs = await getSlotProbs(cache, dp, pickNumber);

	// Because of the draft lottery or other draft types where the worst team doesn't necessarily pick first, a team's pick is not always the same as its slot
	const pickEstimates = pickNumber.futureDraft ? cache.future : cache;
	const slotPickProbs = await getSlotPickProbsCached(
		dp.round,
		slotProbs.length,
		pickEstimates.season,
	);

	if (slotProbs.length !== slotPickProbs.length) {
		throw new TypeError("Iterators had different lengths");
	}

	// Plain loops (hot: AI trades evaluate picks constantly), in the same order as before, so the same sums
	const pickProbs = new Array<number>(slotProbs.length).fill(0);
	for (let j = 0; j < slotProbs.length; j++) {
		const slotProb = slotProbs[j]!;
		if (slotProb > 0) {
			const probs = slotPickProbs[j]!;
			for (let i = 0; i < probs.length; i++) {
				pickProbs[i]! += slotProb * probs[i]!;
			}
		}
	}

	return pickProbs;
};

// Probability of each pick in the round (index 0 is the 1st pick of the round) and the estimated overall pick number
const getPickDistribution = async (
	cache: ValueChangeCache,
	dp: DraftPick,
	season: number,
	pidsAdd: number[],
	pidsRemove: number[],
	tid: number,
	tradingPartnerTid?: number,
) => {
	const pickNumber = await getPickNumber(
		cache,
		dp,
		season,
		pidsAdd,
		pidsRemove,
		tid,
		tradingPartnerTid,
	);

	const numPicksPerRound = getNumPicksPerRound();
	const numPicksBeforeRound = numPicksPerRound * (dp.round - 1);

	// After the regular season is over, we don't need to project the order of teams going into this season's draft
	let currentPickProbs;
	if (
		pickNumber.type === "projected" &&
		dp.season === g.get("season") &&
		dp.round === 1 &&
		g.get("phase") >= PHASE.PLAYOFFS
	) {
		cache.currentFirstRoundPickProbs ??= getCurrentFirstRoundPickProbs();
		try {
			currentPickProbs = (await cache.currentFirstRoundPickProbs)?.get(dp.dpid);
		} catch (error) {
			// Don't keep a rejected promise in the cache, so the next call tries again
			cache.currentFirstRoundPickProbs = undefined;
			throw error;
		}
	}

	if (pickNumber.type === "known" || typeof dp.season !== "number") {
		// We know where this pick is, or it's some weird draft where the normal rules don't apply
		const pick =
			pickNumber.type === "known"
				? pickNumber.pick
				: helpers.bound(
						Math.round(
							pickNumber.slot + pickNumber.bias + pickNumber.userTradeShift,
						),
						1,
						numPicksPerRound,
					);
		return {
			known: true,
			estPick: numPicksBeforeRound + pick,
			numPicksBeforeRound,
			pickProbs: undefined,
		};
	}

	// We don't know where this pick will be, so consider all the possibilities
	// userTradeShift is there because the user has a lot of control over where its picks wind up, and knows more than the AI about how good teams will be. Neither of those matter when the draft order is random.
	const userTradeShift =
		getRoundOrderRule(g.get("draftType"), dp.round) === "random"
			? 0
			: pickNumber.userTradeShift;

	const pickProbs = shiftProbs(
		currentPickProbs ?? (await getPickProbs(cache, dp, pickNumber)),
		userTradeShift,
	);

	let pick = 0;
	for (const [i, prob] of pickProbs.entries()) {
		pick += prob * (i + 1);
	}

	return {
		known: false,
		estPick: numPicksBeforeRound + Math.round(pick),
		numPicksBeforeRound,
		pickProbs,
	};
};

// How much of a pick's value is kept when it is protected, for what's owed instead. A rollover is a later (and also protected) pick, so it's discounted
const PROTECTED_FALLBACK_FACTOR: Record<DraftPickProtectionThen, number> = {
	unprotected: 0.75,
	secondRound: 0.12,
	extinguish: 0,
};

const ROLLOVER_DISCOUNT = 0.85;

// Trade value of a pick with a protection: the pick conveys only outside of the protected range, otherwise something else is owed later
export const protectedTradeValue = (
	pickProbs: number[],
	tradeValues: number[],
	protection: Pick<DraftPickProtection, "top" | "rollover" | "then">,
	// Probability that what's owed instead (rollover pick or 2nd round pick) actually exists when it's due. If the original team no longer owns that pick, the obligation is extinguished
	probFallbackDelivered: number = 1,
): { tradeValue: number; probConvey: number } => {
	let conveyed = 0;
	let probProtected = 0;
	let total = 0;
	for (const [i, prob] of pickProbs.entries()) {
		total += prob * tradeValues[i]!;
		if (i + 1 <= protection.top) {
			probProtected += prob;
		} else {
			conveyed += prob * tradeValues[i]!;
		}
	}
	// A rollover is next season's pick with the next protection in the list, valued the same way (the same team, so the same odds),
	// discounted for the wait. Not a flat share of the pick, which made a pick protected nearly every season (top 29, then top 29, ...)
	// worth more than half an unprotected one
	const fallback: number =
		protection.rollover.length > 0
			? ROLLOVER_DISCOUNT *
				protectedTradeValue(pickProbs, tradeValues, {
					top: protection.rollover[0]!,
					rollover: protection.rollover.slice(1),
					then: protection.then,
				}).tradeValue
			: PROTECTED_FALLBACK_FACTOR[protection.then] * total;
	return {
		tradeValue: conveyed + probProtected * probFallbackDelivered * fallback,
		probConvey: 1 - probProtected,
	};
};

// Chance that a pick still owned by the right team now will still be there when it's needed (it could be traded away later, which extinguishes a rollover or lapses a swap)
export const CONDITION_SURVIVE_PROB = 0.9;

// Probability that the pick owed instead of a protected one (rollover or 2nd round conversion) will be delivered. fallbackOwnerTid is the team that keeps the protected pick.
export const getFallbackDeliveredProb = (
	dp: Pick<DraftPick, "season" | "round" | "originalTid">,
	protection: Pick<DraftPickProtection, "rollover" | "then">,
	fallbackOwnerTid: number,
	allPicks: DraftPick[],
	tradedDpids: Set<number>,
) => {
	if (typeof dp.season !== "number") {
		return 1;
	}
	let round;
	if (protection.rollover.length > 0 || protection.then === "unprotected") {
		round = dp.round;
	} else if (protection.then === "secondRound") {
		round = 2;
	} else {
		// Extinguished anyway
		return 1;
	}
	const season = dp.season + 1;
	const target = allPicks.find(
		(x) =>
			x.season === season &&
			x.originalTid === dp.originalTid &&
			x.round === round,
	);
	if (!target) {
		// Not generated yet (beyond the future draft horizon), so it will be created with the original team
		return allPicks.some((x) => x.season === season)
			? 0
			: CONDITION_SURVIVE_PROB;
	}
	if (
		target.tid !== fallbackOwnerTid ||
		target.protection ||
		target.swap ||
		tradedDpids.has(target.dpid)
	) {
		return 0;
	}
	return CONDITION_SURVIVE_PROB;
};

// Expected trade value of the better (or worse) of two independent picks
export const swapTradeValue = (
	probsA: number[],
	tradeValuesA: number[],
	probsB: number[],
	tradeValuesB: number[],
	type: "max" | "min",
) => {
	let value = 0;
	for (const [i, probA] of probsA.entries()) {
		if (probA <= 0) {
			continue;
		}
		for (const [j, probB] of probsB.entries()) {
			if (probB <= 0) {
				continue;
			}
			const a = tradeValuesA[i]!;
			const b = tradeValuesB[j]!;
			value +=
				probA * probB * (type === "max" ? Math.max(a, b) : Math.min(a, b));
		}
	}
	return value;
};

const getPickInfo = async (
	cache: ValueChangeCache,
	dp: DraftPick,
	rookieSalaries: number[],
	pidsAdd: number[],
	pidsRemove: number[],
	tid: number,
	tradingPartnerTid?: number,
	condition?: TradePickCondition,
	tradedDpids: Set<number> = new Set(),
): Promise<Asset> => {
	const season =
		dp.season === "fantasy" || dp.season === "expansion"
			? g.get("season")
			: dp.season;

	const dist = await getPickDistribution(
		cache,
		dp,
		season,
		pidsAdd,
		pidsRemove,
		tid,
		tradingPartnerTid,
	);
	const { estPick, numPicksBeforeRound } = dist;

	const roundTradeValues = (probs: number[]) =>
		probs.map((_prob, i) =>
			getPickTradeValue(cache, season, numPicksBeforeRound + i + 1),
		);
	const asProbs = (d: typeof dist) => {
		if (d.pickProbs) {
			return d.pickProbs;
		}
		const probs = new Array<number>(getNumPicksPerRound()).fill(0);
		probs[
			helpers.bound(d.estPick - d.numPicksBeforeRound - 1, 0, probs.length - 1)
		] = 1;
		return probs;
	};

	let value;
	if (dist.pickProbs) {
		let tradeValue = 0;
		for (const [i, prob] of dist.pickProbs.entries()) {
			if (prob > 0) {
				tradeValue +=
					prob * getPickTradeValue(cache, season, numPicksBeforeRound + i + 1);
			}
		}
		value = tradeValueToValue(tradeValue);
	} else {
		value = Math.max(MIN_PICK_VALUE, getPickValue(cache, season, estPick));
	}

	// Draft pick conditions: a new one from this trade, or one already on the pick
	let probConvey: number | undefined;
	let swapWithTid: number | undefined;
	let swapType: "max" | "min" | undefined;
	if (condition?.type === "swap" && condition.tid !== undefined) {
		// Only the right to swap is traded
		swapWithTid = condition.tid;
		swapType = "max";
	} else if (!condition && dp.swap) {
		// This pick carries another team's swap right, so it's worth the worse of the two
		swapWithTid = dp.swap.tid;
		swapType = "min";
	}
	// An amended protection replaces the stored one (top 0 removes it)
	const amended = condition?.type === "protection" && condition.amend;
	const protection =
		condition?.type === "protection"
			? amended
				? condition.top > 0
					? { ...condition, tid: dp.protection?.tid }
					: undefined
				: condition
			: dp.protection;
	if (
		typeof dp.season === "number" &&
		(protection || swapWithTid !== undefined)
	) {
		const probs = asProbs(dist);
		const tradeValues = roundTradeValues(probs);
		if (protection) {
			// For a new condition, the team giving the pick away keeps it if protected. For an existing one, protection.tid is that team
			const fallbackOwnerTid =
				condition?.type === "protection" && !amended
					? dp.tid
					: (protection.tid ?? dp.tid);
			const probFallbackDelivered = getFallbackDeliveredProb(
				dp,
				protection,
				fallbackOwnerTid,
				await idb.cache.draftPicks.getAll(),
				tradedDpids,
			);
			const result = protectedTradeValue(
				probs,
				tradeValues,
				protection,
				probFallbackDelivered,
			);
			value = tradeValueToValue(result.tradeValue);
			probConvey = result.probConvey;
		} else if (swapWithTid !== undefined && swapType !== undefined) {
			const otherPick = (
				await idb.cache.draftPicks.indexGetAll("draftPicksByTid", swapWithTid)
			).find(
				(dp2) =>
					dp2.originalTid === swapWithTid &&
					dp2.season === dp.season &&
					dp2.round === dp.round,
			);
			if (otherPick && tradedDpids.has(otherPick.dpid)) {
				// The swapping team's own pick is moving in this trade, so the swap would lapse
				if (swapType === "max") {
					value = 0;
				}
			} else if (otherPick) {
				const otherProbs = asProbs(
					await getPickDistribution(
						cache,
						otherPick,
						season,
						pidsAdd,
						pidsRemove,
						tid,
						tradingPartnerTid,
					),
				);
				const otherTradeValues = roundTradeValues(otherProbs);
				const better = swapTradeValue(
					probs,
					tradeValues,
					otherProbs,
					otherTradeValues,
					swapType,
				);
				if (swapType === "max") {
					// What the swap adds on top of the team's own pick
					let own = 0;
					for (const [i, prob] of otherProbs.entries()) {
						own += prob * otherTradeValues[i]!;
					}
					value = tradeValueToValue(
						CONDITION_SURVIVE_PROB * Math.max(0, better - own),
					);
				} else {
					// The swap could still lapse, then this is just the pick itself
					let unswapped = 0;
					for (const [i, prob] of probs.entries()) {
						unswapped += prob * tradeValues[i]!;
					}
					value = tradeValueToValue(
						CONDITION_SURVIVE_PROB * better +
							(1 - CONDITION_SURVIVE_PROB) * unswapped,
					);
				}
			} else if (swapType === "max") {
				value = 0;
			}
		}
	}

	let contractValue = getContractValue(
		{
			// Could be undefined if there are picks beyond numDraftRounds
			amount:
				rookieSalaries[estPick - 1] ??
				rookieSalaries.at(-1) ??
				g.get("minContract"),
			exp: season + 2,
		},
		getPickValue(cache, season, estPick),
	);
	contractValue = Math.max(0, contractValue);
	if (swapType === "max") {
		contractValue = 0;
	} else if (probConvey !== undefined) {
		contractValue *= probConvey;
	}

	// Ensure there are no tied pick values
	value -= estPick * 1e-10;

	return {
		type: "pick",
		value,
		contractValue,
		injury: {
			type: "Healthy",
			gamesRemaining: 0,
		},
		dp,

		// Would be better to store age in estValues, but oh well
		age: 20,
		draftPick: estPick,
		draftYear: season,
		probConvey,
		swap: swapType === "max" ? true : undefined,
	};
};

const getPicks = async ({
	cache,
	add,
	remove,
	pidsAdd,
	pidsRemove,
	dpidsAdd,
	dpidsRemove,
	tid,
	tradingPartnerTid,
	pickConditions,
}: {
	cache: ValueChangeCache;
	add: Asset[];
	remove: Asset[];
	pidsAdd: number[];
	pidsRemove: number[];
	dpidsAdd: number[];
	dpidsRemove: number[];
	tid: number;
	tradingPartnerTid?: number;
	pickConditions?: TradePickCondition[];
}) => {
	const conditionsByDpid = new Map(
		(pickConditions ?? []).map((c) => [c.dpid, c]),
	);

	const tradedDpids = new Set([...dpidsAdd, ...dpidsRemove]);

	// For each draft pick, estimate its value based on the recent performance of the team
	if (dpidsAdd.length > 0 || dpidsRemove.length > 0) {
		const rookieSalaries = draft.getRookieSalaries();

		for (const dpid of dpidsAdd) {
			const dp = await idb.cache.draftPicks.get(dpid);
			if (!dp) {
				continue;
			}

			const pickInfo = await getPickInfo(
				cache,
				dp,
				rookieSalaries,
				pidsAdd,
				pidsRemove,
				tid,
				tradingPartnerTid,
				conditionsByDpid.get(dpid),
				tradedDpids,
			);
			add.push(pickInfo);
		}

		for (const dpid of dpidsRemove) {
			const dp = await idb.cache.draftPicks.get(dpid);
			if (!dp) {
				continue;
			}

			const pickInfo = await getPickInfo(
				cache,
				dp,
				rookieSalaries,
				pidsAdd,
				pidsRemove,
				tid,
				tradingPartnerTid,
				conditionsByDpid.get(dpid),
				tradedDpids,
			);
			remove.push(pickInfo);
		}

		// Be wary about giving away too many 1st round draft picks!
		if (remove.length > 0) {
			// More value for individual players in basketball, similar to EXPONENT
			const SPORT_FACTOR = bySport({
				baseball: 2.5,
				basketball: 5,
				hockey: 2.5,
				football: 2.5,
			});

			const firstRoundPicks = [];
			const otherPicks = [];
			for (const asset of remove) {
				if (asset.type === "pick") {
					if (asset.dp.round === 1) {
						firstRoundPicks.push(asset);
					} else {
						otherPicks.push(asset);
					}
				}
			}

			// If there are more than 2 picks in the trade, make them a bit more valuable to the AI
			const numBeyond2 = firstRoundPicks.length - 2;
			if (numBeyond2 > 0) {
				for (const pick of firstRoundPicks) {
					if (pick.value > 0) {
						pick.value *= 1 + numBeyond2 / SPORT_FACTOR;
					}
				}
			}

			// Similar but less extreme for other picks
			const numBeyond2Other = otherPicks.length - 2;
			if (numBeyond2Other > 0) {
				for (const pick of otherPicks) {
					if (pick.value > 0) {
						pick.value *= 1 + numBeyond2Other / (SPORT_FACTOR * pick.dp.round);
					}
				}
			}
		}
	}
};

// Per-asset breakdown of sumValues, used to explain trade decisions (see trade/explain.ts)
export type AssetValueDetail = {
	type: "player" | "pick";
	pid?: number;
	dpid?: number;
	age: number;

	// For picks, the estimated pick number and draft year
	draftPick?: number;
	draftYear?: number;

	// Value before any adjustments, in the units of player value z-scores
	baseValue: number;

	// Multiplier from team strategy (rebuilding/contending), 1 if none
	strategyFactor: number;

	// Multiplier from the AI GM's timeline and pick valuation (GM personalities setting), 1 or undefined if none
	gmFactor?: number;

	// Value removed because of injury (only for incoming assets)
	injuryPenalty: number;

	// Contract value, as computed by getContractValue (negative means overpaid)
	contractValue: number;

	// Weight of contract value for this team's strategy
	contractsFactor: number;

	// Final value after all adjustments, and the same thing on the trade value scale that gets summed
	adjustedValue: number;
	tradeValue: number;
};

const sumValues = (
	players: Asset[],
	strategy: string,
	tid: number,
	includeInjuries = false,
	details?: AssetValueDetail[],
	gm?: GmWeights,
) => {
	if (players.length === 0) {
		return 0;
	}

	const season = g.get("season");
	const phase = g.get("phase");

	return players.reduce((memo, p) => {
		let playerValue = p.value;
		const baseValue = p.value;
		let strategyFactor = 1;
		let injuryPenalty = 0;

		const treatAsFutureDraftPick =
			p.type === "pick" && (season !== p.draftYear || phase <= PHASE.PLAYOFFS);

		// These factors don't make sense for negative value players!!!
		if (strategy === "rebuilding") {
			// Value young/cheap players and draft picks more. Penalize expensive/old players
			if (treatAsFutureDraftPick) {
				playerValue *= 1.1;
			} else if (p.age <= 19) {
				playerValue *= 1.075;
			} else if (p.age === 20) {
				playerValue *= 1.05;
			} else if (p.age === 21) {
				playerValue *= 1.0375;
			} else if (p.age === 22) {
				playerValue *= 1.025;
			} else if (p.age === 23) {
				playerValue *= 1.0125;
			} else if (p.age === 27) {
				playerValue *= 0.975;
			} else if (p.age === 28) {
				playerValue *= 0.95;
			} else if (p.age >= 29) {
				playerValue *= 0.9;
			}
		} else if (strategy === "contending") {
			// Much of the value for these players comes from potential, which we don't really care about
			if (treatAsFutureDraftPick) {
				playerValue *= 0.825;
			} else if (p.age <= 19) {
				playerValue *= 0.8;
			} else if (p.age === 20) {
				playerValue *= 0.825;
			} else if (p.age === 21) {
				playerValue *= 0.85;
			} else if (p.age === 22) {
				playerValue *= 0.875;
			} else if (p.age === 23) {
				playerValue *= 0.925;
			} else if (p.age === 24) {
				playerValue *= 0.95;
			}
		}

		if (baseValue !== 0) {
			strategyFactor = playerValue / baseValue;
		}

		// AI GM personalities (setting): the GM's timeline and how he values picks, on top of the team's strategy
		let gmFactor = 1;
		if (gm && playerValue > 0) {
			const before = playerValue;
			if (p.type === "pick") {
				playerValue *= gm.pickFactor;
			}
			if (treatAsFutureDraftPick || p.age <= 23) {
				playerValue *= gm.futureFactor;
			} else if (p.age >= 29) {
				playerValue *= gm.vetFactor;
			}
			gmFactor = playerValue / before;
		}

		// Normalize for injuries
		const valueBeforeInjury = playerValue;
		if (includeInjuries && tid !== g.get("userTid")) {
			// Gamblers discount injuries less, cautious GMs more (setting)
			if (!gm) {
				if (p.injury.gamesRemaining > 75) {
					playerValue -= playerValue * 0.75;
				} else {
					playerValue -= (playerValue * p.injury.gamesRemaining) / 100;
				}
			} else {
				const share =
					p.injury.gamesRemaining > 75 ? 0.75 : p.injury.gamesRemaining / 100;
				playerValue -= playerValue * Math.min(0.9, share * gm.injuryFactor);
			}
		}

		injuryPenalty = valueBeforeInjury - playerValue;

		// Really bad players will just get no PT, but don't to count them as 0 because then AI thinks it can't find a trade
		if (playerValue < 0) {
			playerValue /= 20;
		}

		const contractsFactor =
			(strategy === "rebuilding" ? 2 : 0.5) * (gm?.contractsFactor ?? 1);
		playerValue += contractsFactor * p.contractValue;

		// if a player was just drafted and can be released, they shouldn't have negative value
		if (p.type === "player" && p.justDrafted) {
			playerValue = Math.max(0, playerValue);
		}

		const tradeValue = valueToTradeValue(playerValue);

		if (details) {
			details.push({
				type: p.type,
				pid: p.type === "player" ? p.pid : undefined,
				dpid: p.type === "pick" ? p.dp.dpid : undefined,
				draftPick: p.type === "pick" ? p.draftPick : undefined,
				draftYear: p.type === "pick" ? p.draftYear : undefined,
				age: p.age,
				baseValue,
				strategyFactor,
				gmFactor,
				injuryPenalty,
				contractValue: p.contractValue,
				contractsFactor,
				adjustedValue: playerValue,
				tradeValue,
			});
		}

		return memo + tradeValue;
	}, 0);
};

export const getEstPicks = async (
	teamOvrsSorted: { ovr: number; tid: number }[],
) => {
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);

	const allTeamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[g.get("season")], [g.get("season"), "Z"]],
	);

	const teamInfos = teams.map((t) => {
		let teamOvrIndex = teamOvrsSorted.findIndex((t2) => t2.tid === t.tid);
		if (teamOvrIndex < 0) {
			// This happens if a team has no players on it - just assume they are the worst
			teamOvrIndex = teamOvrsSorted.length - 1;
		}

		return {
			t,
			noDraftPick:
				g.get("challengeNoDraftPicks") && g.get("userTids").includes(t.tid),
			// 25% to 75% based on rank
			teamOvrWinp: ovrIndexToEstWinPercent(teamOvrIndex),
			teamSeason: allTeamSeasons.find((teamSeason) => teamSeason.tid === t.tid),
		};
	});

	// Estimate the order of the picks by team
	const getPickEstimates = (futureDraft: boolean): PickEstimates => {
		const season = futureDraft ? g.get("season") + 1 : g.get("season");

		const wps = teamInfos.map(({ t, noDraftPick, teamOvrWinp, teamSeason }) => {
			const wp = getEstWinPercent({ futureDraft, teamOvrWinp, teamSeason });
			return {
				tid: t.tid,
				wp,
				projectedTeam: getProjectedTeam({
					futureDraft,
					noDraftPick,
					season,
					t,
					teamOvrWinp,
					teamSeason,
					wp,
				}),
			};
		});

		// Get rank order of wps http://stackoverflow.com/a/14834599/786644
		wps.sort((a, b) => a.wp - b.wp);

		// For each team, what is their estimated draft position?
		const estPicks: Record<number, number> = {};
		for (const [i, wp] of wps.entries()) {
			estPicks[wp.tid] = i + 1;
		}

		return {
			estPicks,
			season,
			wps,
		};
	};

	return {
		...getPickEstimates(false),

		// For drafts after the current season's draft
		future: getPickEstimates(true),
	};
};

type PickEstimates = {
	estPicks: Record<number, number>;

	// The season whose settings are used to project the draft order. For a future draft that is next season, because settings for next season can already be different than this season (like in the offseason after teams are added or removed, and the playoffs change to match). There is no way to know about settings after that.
	season: number;
	wps: {
		tid: number;
		wp: number;

		// Same team, in the format needed for getFirstRoundSlotProbs
		projectedTeam: ProjectedTeam;
	}[];

	// Filled in only when needed, since it's slow
	firstRoundSlotProbs?: ReturnType<typeof getFirstRoundSlotProbsCached>;
};

type ValueChangeCache = PickEstimates & {
	estValues: TradePickValues;
	future: PickEstimates;

	// See ValueChangeCalculator
	quick: boolean;

	// Filled in only when needed
	currentFirstRoundPickProbs?: ReturnType<typeof getCurrentFirstRoundPickProbs>;

	teamOvrs: {
		tid: number;
		ovr: number;
	}[];
};

type ToUpdate = {
	draft: boolean;

	// false - no update. "all" - update all teams. number[] = update only these specific teams
	teams: false | "all" | number[];
};

type EvaluateArgs = {
	tid: number;
	pidsAdd: number[];
	pidsRemove: number[];
	dpidsAdd: number[];
	dpidsRemove: number[];
	tradingPartnerTid: number | undefined;

	// New draft pick conditions in this trade (see getTradePickConditions)
	pickConditions?: TradePickCondition[];
};

// tradingPartnerTid is currently just used to determine if this is a trade with the user, so additional fuzz can be applied
export class ValueChangeCalculator {
	private cache: ValueChangeCache | undefined;

	// Less precise draft pick values, for when speed matters more
	private quick: boolean;

	private toUpdate: ToUpdate = {
		draft: true,
		teams: "all",
	};

	// Player traits: a player's trait factor, remembered for the life of this calculator (one AI trade pass, one view
	// request), since the same players are valued over and over
	private getTraitFactor = makeAiTraitValueFactorCache();

	constructor({ quick = false }: { quick?: boolean } = {}) {
		this.quick = quick;
	}

	private async init() {
		await player.updateOvrMeanStd();
		return this.getUpdatedCache();
	}

	private async getUpdatedCache() {
		const toUpdate = { ...this.toUpdate };
		this.toUpdate = { draft: false, teams: false };

		const estValues =
			toUpdate.draft || !this.cache
				? await trade.getPickValues()
				: this.cache.estValues;

		if (toUpdate.teams || !this.cache) {
			const playersByTid = Map.groupBy(
				await idb.cache.players.indexGetAll("playersByTid", [0, Infinity]),
				(p) => p.tid,
			);
			const teamOvrs: {
				tid: number;
				ovr: number;
			}[] = [];
			let prevTeamOvrsByTid;
			for (const [tid, players] of playersByTid) {
				let row;
				if (
					this.cache &&
					Array.isArray(toUpdate.teams) &&
					!toUpdate.teams.includes(tid)
				) {
					if (!prevTeamOvrsByTid) {
						prevTeamOvrsByTid = groupByUnique(this.cache.teamOvrs, "tid");
					}
					row = prevTeamOvrsByTid[tid];
				}

				if (row === undefined) {
					const ovr = team.ovr(
						players.map((p) => ({
							pid: p.pid,
							injury: p.injury,
							value: p.value,
							ratings: {
								ovr: last(p.ratings).ovr,
								ovrs: last(p.ratings).ovrs,
								pos: last(p.ratings).pos,
							},
						})),
					);

					row = { tid, ovr };
				}

				teamOvrs.push(row);
			}
			teamOvrs.sort((a, b) => b.ovr - a.ovr);

			return {
				...(await getEstPicks(teamOvrs)),
				currentFirstRoundPickProbs: undefined,
				estValues,
				quick: this.quick,
				teamOvrs,
			};
		} else {
			return {
				...this.cache,
				estValues,
			};
		}
	}

	invalidateCache(toUpdate: Partial<ToUpdate>) {
		// Merge with existing this.toUpdate - probably never matters vs overwriting, but just to be sure
		if (toUpdate.draft !== undefined) {
			this.toUpdate.draft = this.toUpdate.draft || toUpdate.draft;
		}
		if (toUpdate.teams === "all") {
			this.toUpdate.teams = "all";
		} else if (Array.isArray(toUpdate.teams)) {
			if (Array.isArray(this.toUpdate.teams)) {
				this.toUpdate.teams = Array.from(
					new Set([...this.toUpdate.teams, ...toUpdate.teams]),
				);
			} else if (this.toUpdate.teams === false) {
				this.toUpdate.teams = toUpdate.teams;
			}
		}
	}

	evaluate(args: EvaluateArgs): Promise<number> {
		return this.evaluateInternal(args);
	}

	// Same as evaluate, but also returns how much each asset contributed, for explaining the decision to the user
	async explain(args: EvaluateArgs) {
		const add: AssetValueDetail[] = [];
		const remove: AssetValueDetail[] = [];
		const dv = await this.evaluateInternal(args, { add, remove });
		const t = await idb.cache.teams.get(args.tid);
		return {
			dv,
			strategy: t?.strategy ?? "rebuilding",
			add,
			remove,
		};
	}

	private async evaluateInternal(
		{
			tid,
			pidsAdd,
			pidsRemove,
			dpidsAdd,
			dpidsRemove,
			tradingPartnerTid,
			pickConditions,
		}: EvaluateArgs,
		details?: { add: AssetValueDetail[]; remove: AssetValueDetail[] },
	): Promise<number> {
		if (!this.cache) {
			this.cache = await this.init();
		} else if (this.toUpdate.draft || this.toUpdate.teams) {
			this.cache = await this.getUpdatedCache();
		}

		// Get value and skills for each player on team or involved in the proposed transaction
		const add: Asset[] = [];
		const remove: Asset[] = [];
		const t = await idb.cache.teams.get(tid);

		if (!t) {
			throw new Error("Invalid team");
		}

		const strategy = t.strategy;

		// AI GM personalities (setting), undefined when off or for the user's team
		const gm = await getGmWeights(tid);

		await getPlayers({
			add,
			remove,
			pidsAdd,
			pidsRemove,
			tid,
			tradingPartnerTid,
			getTraitFactor: this.getTraitFactor,
			gm,
		});
		await getPicks({
			cache: this.cache,
			add,
			remove,
			pidsAdd,
			pidsRemove,
			dpidsAdd,
			dpidsRemove,
			tid,
			tradingPartnerTid,
			pickConditions,
		});

		// console.log("ADD");
		const valuesAdd = sumValues(add, strategy, tid, true, details?.add, gm);
		// console.log("Total", valuesAdd);

		// console.log("REMOVE");
		const valuesRemove = sumValues(
			remove,
			strategy,
			tid,
			false,
			details?.remove,
			gm,
		);
		// console.log("Total", valuesRemove);

		return valuesAdd - valuesRemove;
	}
}

const getModifiedPickRank = async (
	cache: ValueChangeCache,
	futureDraft: boolean,
	tid: number,
	pidsAdd: number[],
	pidsRemove: number[],
) => {
	// later we need to find the new ranks of this team's ovr/estimated win%
	// it's cleaner to determine this by temporarily removing the old team info from the cached lists
	const newTeamOvrs = cache.teamOvrs.filter((t) => t.tid !== tid);
	const newWps = (futureDraft ? cache.future : cache).wps.filter(
		(w) => w.tid !== tid,
	);

	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsBySeasonTid",
		[g.get("season"), tid],
	);
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	const playersAfterTrade = players.filter((p) => !pidsRemove.includes(p.pid));
	for (const pid of pidsAdd) {
		const p = await idb.cache.players.get(pid);
		if (p) {
			playersAfterTrade.push(p);
		}
	}
	const playerRatings = playersAfterTrade.map((p) => ({
		pid: p.pid,
		injury: p.injury,
		value: p.value,
		ratings: {
			ovr: last(p.ratings).ovr,
			ovrs: last(p.ratings).ovrs,
			pos: last(p.ratings).pos,
		},
	}));

	const newTeamOvr = team.ovr(playerRatings);
	let newTeamOvrIndex = newTeamOvrs.findIndex((t) => t.ovr < newTeamOvr);
	if (newTeamOvrIndex === -1) {
		// Worst Team (no -1 because we already removed this team from newTeamOvrs)
		newTeamOvrIndex = newTeamOvrs.length;
	}

	const newWp = getEstWinPercent({
		futureDraft,
		teamOvrWinp: ovrIndexToEstWinPercent(newTeamOvrIndex),
		teamSeason,
	});

	let newRank = newWps.findIndex((w) => newWp < w.wp);
	if (newRank === -1) {
		// Best Team (no -1 because we already removed this team from newTeamOvrs)
		newRank = newWps.length;
	}
	newRank += 1; // Index to rank

	return newRank;
};
