// Draft-night trades (League Extras, core): picks move during the draft.
//
// - A pick value chart for every pick still to be made in this draft. It is the number the trade AI itself adds up for a
//   pick whose place in the order is known (ValueChangeCalculator getPickSlotTradeValue, from getPickValues: the value of
//   the prospect expected at that pick in this class), shown in points where a typical No. 1 pick is 1000. A deep class
//   has more points further down, a shallow one fewer.
// - AI-to-AI trades: before an AI pick, now and then a team further down that wants a prospect still on the board (its
//   own board, by need and strategy) who probably won't last until its pick trades up with the team on the clock, paying
//   with its pick plus later picks of this draft or future picks. The team moving down must gain by the trade AI's own
//   valuation (with a margin); the team moving up may overpay a little for the player it wants.
// - Offers to the user: when the user's next pick is close, AI teams behind him may offer to trade up into it and AI
//   teams ahead of him may offer to move down to it. The AI side of every offer gains by the trade AI's valuation, and
//   accepting goes through the normal trade proposal (trade.create + trade.propose), so an offer is never better for
//   the user than what the AI would accept on the Trade page.
//
// Randomness comes from seeded streams (common/ratingsBuilds/rng.ts) keyed by the season and pick, never from the game's
// main random stream, so the AI's draft selections draw exactly as before. Nothing new is stored: the AI trades are
// normal trade events (with a note), offers are recomputed from the league's state, and only declined offers are
// remembered, in memory.
import { PHASE } from "../../../common/constants.ts";
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import type { DraftPick, Player, TradeTeams } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { getGmWeights } from "../gm/index.ts";
import updateOvrMeanStd from "../player/updateOvrMeanStd.ts";
import {
	getPickSlotTradeValue,
	ValueChangeCalculator,
} from "../team/ValueChangeCalculator.ts";
import { getAITids } from "../trade/betweenAiTeams.ts";
import create from "../trade/create.ts";
import getPickValues, { getNumPicksPerRound } from "../trade/getPickValues.ts";
import processTrade from "../trade/processTrade.ts";
import propose from "../trade/propose.ts";
import summary from "../trade/summary.ts";
import { decideDraft } from "./draftDecision.ts";
import {
	buildTeamDraftContext,
	getClassFactsCached,
} from "./draftDecisionData.ts";
import getOrder from "./getOrder.ts";
import { canBeDrafted } from "./canBeDrafted.ts";

// Chart points of a typical No. 1 pick
export const CHART_POINTS = 1000;

// AI-to-AI trades: chance of a trade attempt before an AI pick (first round, later rounds), times the AI-to-AI Trades
// Factor setting. An attempt only becomes a trade when a team wants to move up, the team on the clock is willing and
// the price works for both: about 2 in 5 attempts end in a trade, about 3 trades per draft
export const AI_ATTEMPT_CHANCE_FIRST_ROUND = 0.2;
export const AI_ATTEMPT_CHANCE_LATER = 0.07;
export const MAX_AI_TRADES_PER_DRAFT = 6;

// How far down the order a team trading up can be (picks)
export const MAX_TRADE_UP_JUMP = 10;

// The team moving down gains at least this share of its pick's value (trade AI valuation). The team moving up may lose
// up to TRADE_UP_PREMIUM of what it gives (its own valuation), for a player it wants
export const SELLER_MARGIN_MIN = 0.03;
export const SELLER_MARGIN_MAX = 0.12;
export const TRADE_UP_PREMIUM = 0.4;

// Assets added to a team's own pick to pay for a move up
export const MAX_EXTRA_ASSETS = 2;

// Offers to the user: they start when his next pick is this many picks away or closer (0 = on the clock)
export const OFFER_WINDOW = 3;
export const MAX_UNSOLICITED_OFFERS = 3;
export const MAX_SHOP_OFFERS = 5;
// How far behind the user's pick a team can be to offer to move up into it
export const MAX_OFFER_JUMP = 12;
// The AI side of an offer keeps this share of the pick's value as its edge
export const AI_OFFER_MARGIN = 0.03;
// An AI team trading up doesn't make an offer worth less than this share of the user's pick on the chart
export const MIN_USER_SHARE = 0.8;

export const DRAFT_NIGHT_NOTE_PREFIX = "Draft night: ";

export const draftNightTradesOn = () =>
	featureOn("draftNightTrades") && g.get("phase") === PHASE.DRAFT;

const overallPick = (dp: Pick<DraftPick, "round" | "pick">) =>
	(dp.round - 1) * getNumPicksPerRound() + dp.pick;

export const toPoints = (tradeValue: number, ref: number) =>
	ref > 0 ? Math.round((CHART_POINTS * tradeValue) / ref) : 0;

// Chance of an AI trade attempt before a pick
export const aiAttemptChance = (round: number, aiTradesFactor: number) =>
	helpers.bound(
		(round === 1 ? AI_ATTEMPT_CHANCE_FIRST_ROUND : AI_ATTEMPT_CHANCE_LATER) *
			aiTradesFactor,
		0,
		1,
	);

// A team's board for a draft-night trade: the prospects it likes, best first, with their consensus rank (0 = the best
// prospect left by value)
type BoardEntry = { p: Player; rank: number; score: number };

const getBoard = async (tid: number, prospects: Player[], overall = 1) => {
	const teamPlayers = await idb.cache.players.indexGetAll("playersByTid", tid);
	const top = prospects.slice(0, 30);
	// The same scoring as its pick (draftDecision.ts), so a team trades up for the player it would actually take
	const facts = await getClassFactsCached(prospects, g.get("season"));
	const team = await buildTeamDraftContext({
		tid,
		teamPlayers,
		prospects: top,
	});
	const decisions = decideDraft({
		pool: top.map((p) => facts.get(p.pid)!),
		team,
		overall,
		numTeams: g.get("numActiveTeams"),
	});
	return top
		.map((p, rank): BoardEntry => ({
			p,
			rank,
			score: decisions[rank]!.score,
		}))
		.sort((a, b) => b.score - a.score);
};

// Draft-night trades made in this draft (in memory), for the Why of the picks they moved: the pick a team traded up to and the
// prospect it wanted, and the pick the other team moved down to and the prospect it hoped would last
type DraftNightMove = { kind: "up" | "down"; overall: number; target: number };
const moves = new Map<string, DraftNightMove>();
const moveKey = (dpid: number) => `${g.get("lid")}|${g.get("season")}|${dpid}`;
export const getDraftNightMove = (dpid: number) => moves.get(moveKey(dpid));

// Wants to move up from its pick at index own (in the remaining order) to the pick at index slot: its top prospect is
// probably gone before its own pick (consensus rank < own) but should still be there at slot. Returns the urgency, or 0
export const tradeUpUrgency = (targetRank: number, slot: number, own: number) =>
	targetRank >= slot && targetRank < own ? own - targetRank : 0;

// Remaining prospects of this draft, best first by value
const getProspects = async () => {
	const players = (
		await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
			[g.get("season")],
			[g.get("season"), Infinity],
		])
	).filter(canBeDrafted);
	return players.sort((a, b) => b.value - a.value);
};

// The chart's trade values for this draft, and a typical class's
const getChartContext = async () => {
	await updateOvrMeanStd();
	const estValues = await getPickValues();
	const season = g.get("season");
	const typicalValues = { default: estValues.default };
	const ref = getPickSlotTradeValue(typicalValues, season, 1);
	return {
		season,
		ref,
		value: (overall: number) =>
			getPickSlotTradeValue(estValues, season, overall),
		typical: (overall: number) =>
			getPickSlotTradeValue(typicalValues, season, overall),
	};
};
type ChartContext = Awaited<ReturnType<typeof getChartContext>>;

// Points of a pick on the chart. Future picks get a typical pick in the middle of their round, 10% less per year away
const assetPoints = (chart: ChartContext, dp: DraftPick) => {
	if (dp.season === chart.season && dp.pick > 0) {
		return {
			points: toPoints(chart.value(overallPick(dp)), chart.ref),
			estimate: false,
		};
	}
	const numPicksPerRound = getNumPicksPerRound();
	const overall =
		(dp.round - 1) * numPicksPerRound + Math.ceil(numPicksPerRound / 2);
	const years = typeof dp.season === "number" ? dp.season - chart.season : 1;
	return {
		points: toPoints(chart.typical(overall) * 0.9 ** years, chart.ref),
		estimate: true,
	};
};

export const getPickValueChart = async () => {
	const chart = await getChartContext();
	const teamInfoCache = g.get("teamInfoCache");
	const picks = (await getOrder()).filter(
		(dp) => dp.season === chart.season && dp.pick > 0,
	);
	const rows = picks.map((dp) => {
		const overall = overallPick(dp);
		return {
			dpid: dp.dpid,
			round: dp.round,
			pick: dp.pick,
			overall,
			tid: dp.tid,
			originalTid: dp.originalTid,
			abbrev: teamInfoCache[dp.tid]?.abbrev ?? "",
			originalAbbrev: teamInfoCache[dp.originalTid]?.abbrev ?? "",
			points: toPoints(chart.value(overall), chart.ref),
			typicalPoints: toPoints(chart.typical(overall), chart.ref),
		};
	});
	return { season: chart.season, rows };
};

// Picks a team can add to a package: its other picks of this draft after the one already in, and future picks.
// Protected picks and picks with swap rights stay out, so their conditions never get tangled up in a draft-night deal
const getExtraPicks = async (tid: number, exclude: number[]) => {
	const season = g.get("season");
	return (
		await idb.cache.draftPicks.indexGetAll("draftPicksByTid", tid)
	).filter(
		(dp) =>
			!exclude.includes(dp.dpid) &&
			typeof dp.season === "number" &&
			dp.season >= season &&
			!dp.protection &&
			!dp.swap &&
			(dp.season > season || dp.pick > 0),
	);
};

const teamName = (tid: number) => {
	const t = g.get("teamInfoCache")[tid];
	return t ? `${t.region} ${t.name}` : "???";
};

const emptyTeams = (tid0: number, tid1: number): TradeTeams => [
	{ tid: tid0, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
	{ tid: tid1, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
];

// Value of each pick, alone, to a team (trade AI valuation). A trade of picks only adds up these values (none carries a
// protection or swap), the final deal is still checked with a full evaluation
const pickValuesFor = async (
	vcc: ValueChangeCalculator,
	tid: number,
	dpids: number[],
	tradingPartnerTid: number,
) => {
	const out = new Map<number, number>();
	for (const dpid of dpids) {
		out.set(
			dpid,
			await vcc.evaluate({
				tid,
				pidsAdd: [],
				pidsRemove: [],
				dpidsAdd: [dpid],
				dpidsRemove: [],
				tradingPartnerTid,
			}),
		);
	}
	return out;
};

// Cheapest set of extras (at most MAX_EXTRA_ASSETS) that gets a package's value to need: the cheapest single extra that
// is enough, otherwise the most valuable one and look again. undefined when nothing is enough
export const cheapestTopUp = (
	have: number,
	need: number,
	extras: { id: number; value: number }[],
	maxExtras = MAX_EXTRA_ASSETS,
): number[] | undefined => {
	const chosen: number[] = [];
	let total = have;
	const left = [...extras].sort((a, b) => a.value - b.value || a.id - b.id);
	while (total < need) {
		if (chosen.length >= maxExtras || left.length === 0) {
			return;
		}
		const enough = left.find((x) => total + x.value >= need);
		const next = enough ?? left.at(-1)!;
		chosen.push(next.id);
		total += next.value;
		left.splice(left.indexOf(next), 1);
	}
	return chosen;
};

// Most a payer can add while its own cost stays at most budget: the most valuable extra that fits, repeated
export const mostWithinBudget = (
	budget: number,
	extras: { id: number; value: number }[],
	maxExtras = MAX_EXTRA_ASSETS,
) => {
	const chosen: number[] = [];
	let left = budget;
	const sorted = [...extras].sort((a, b) => b.value - a.value || a.id - b.id);
	for (const x of sorted) {
		if (chosen.length >= maxExtras) {
			break;
		}
		if (x.value <= left) {
			chosen.push(x.id);
			left -= x.value;
		}
	}
	return chosen;
};

const fullDv = (
	vcc: ValueChangeCalculator,
	teams: TradeTeams,
	side: 0 | 1,
	tradingPartnerTid: number | undefined,
) => {
	const other = side === 0 ? 1 : 0;
	return vcc.evaluate({
		tid: teams[side].tid,
		pidsAdd: teams[other].pids,
		pidsRemove: teams[side].pids,
		dpidsAdd: teams[other].dpids,
		dpidsRemove: teams[side].dpids,
		tradingPartnerTid,
	});
};

const countAiTradesThisDraft = async () => {
	const season = g.get("season");
	return (await idb.cache.events.getAll()).filter(
		(e) =>
			e.type === "trade" &&
			e.season === season &&
			e.phase === PHASE.DRAFT &&
			e.note?.startsWith(DRAFT_NIGHT_NOTE_PREFIX),
	).length;
};

// Before the AI pick at the head of the order: maybe an AI team trades up into it. Returns true when the pick changed
// hands
export const maybeAiDraftNightTrade = async (
	order: DraftPick[],
	prospects: Player[],
): Promise<boolean> => {
	const dp = order[0];
	if (
		!dp ||
		!draftNightTradesOn() ||
		dp.season !== g.get("season") ||
		prospects.length < 2
	) {
		return false;
	}
	const season = g.get("season");
	const rng = new Rng(`draftNightTrade|${season}|${dp.dpid}`);
	if (!rng.chance(aiAttemptChance(dp.round, g.get("aiTradesFactor")))) {
		return false;
	}

	const aiTids = await getAITids();
	const sellerTid = dp.tid;
	if (!aiTids.includes(sellerTid)) {
		return false;
	}
	if ((await countAiTradesThisDraft()) >= MAX_AI_TRADES_PER_DRAFT) {
		return false;
	}

	// Teams below that want a prospect who probably won't last until their pick
	const candidates: {
		tid: number;
		own: DraftPick;
		ownIndex: number;
		urgency: number;
		target: number;
	}[] = [];
	const seen = new Set([sellerTid]);
	for (let i = 1; i < order.length && i <= MAX_TRADE_UP_JUMP; i++) {
		const own = order[i]!;
		if (seen.has(own.tid) || !aiTids.includes(own.tid)) {
			continue;
		}
		seen.add(own.tid);
		const board = await getBoard(own.tid, prospects, overallPick(dp));
		const target = board[0];
		if (!target) {
			continue;
		}
		const urgency = tradeUpUrgency(target.rank, 0, i);
		if (urgency > 0) {
			candidates.push({
				tid: own.tid,
				own,
				ownIndex: i,
				urgency,
				target: target.p.pid,
			});
		}
	}
	if (candidates.length === 0) {
		return false;
	}
	const gm = await getGmWeights(sellerTid);
	const buyerGms = new Map<number, number>();
	for (const c of candidates) {
		buyerGms.set(c.tid, (await getGmWeights(c.tid))?.tradeWeight ?? 1);
	}
	const buyer = rng.weighted(
		candidates,
		(c) => c.urgency * (buyerGms.get(c.tid) ?? 1),
	);

	// Is the team on the clock willing to move down? More so when its own top prospect should still be there at the
	// buyer's pick, or it's rebuilding
	const sellerBoard = await getBoard(sellerTid, prospects, overallPick(dp));
	const sellerTarget = sellerBoard[0]!;
	const seller = await idb.cache.teams.get(sellerTid);
	const willing =
		(sellerTarget.rank >= buyer.ownIndex
			? 0.9
			: seller?.strategy === "rebuilding"
				? 0.6
				: 0.45) * (gm?.tradeWeight ?? 1);
	if (!rng.chance(Math.min(1, willing))) {
		return false;
	}

	// Price it: the buyer's pick plus the cheapest extras that give the seller its margin
	const vcc = new ValueChangeCalculator();
	const extras = await getExtraPicks(buyer.tid, [buyer.own.dpid]);
	const sellerValues = await pickValuesFor(
		vcc,
		sellerTid,
		[dp.dpid, buyer.own.dpid, ...extras.map((x) => x.dpid)],
		buyer.tid,
	);
	const slotValue = sellerValues.get(dp.dpid)!;
	const margin = rng.uniform(SELLER_MARGIN_MIN, SELLER_MARGIN_MAX);
	const chosen = cheapestTopUp(
		sellerValues.get(buyer.own.dpid)!,
		slotValue * (1 + margin),
		extras.map((x) => ({ id: x.dpid, value: sellerValues.get(x.dpid)! })),
	);
	if (!chosen) {
		return false;
	}

	const teams = emptyTeams(buyer.tid, sellerTid);
	teams[0].dpids = [buyer.own.dpid, ...chosen];
	teams[1].dpids = [dp.dpid];

	const dvSeller = await fullDv(vcc, teams, 1, buyer.tid);
	if (!(dvSeller >= margin * slotValue * 0.99)) {
		return false;
	}
	const dvBuyer = await fullDv(vcc, teams, 0, sellerTid);
	const buyerSlotValue = (
		await pickValuesFor(vcc, buyer.tid, [dp.dpid], sellerTid)
	).get(dp.dpid)!;
	// What the buyer gives, by its own valuation
	const buyerOut = buyerSlotValue - dvBuyer;
	if (!(dvBuyer >= -TRADE_UP_PREMIUM * buyerOut)) {
		return false;
	}

	const s = await summary(teams);
	if (s.warning) {
		return false;
	}

	const overall = overallPick(dp);
	await processTrade(teams, undefined, {
		note: `${DRAFT_NIGHT_NOTE_PREFIX}the ${teamName(buyer.tid)} traded up to No. ${overall} with the ${teamName(sellerTid)}.`,
	});
	moves.set(moveKey(dp.dpid), { kind: "up", overall, target: buyer.target });
	moves.set(moveKey(buyer.own.dpid), {
		kind: "down",
		overall: overallPick(buyer.own),
		target: sellerTarget.p.pid,
	});
	return true;
};

export type DraftNightOfferAsset = {
	dpid: number;
	desc: string;
	points: number;
	// Future picks: a typical pick of their round, not this draft's chart
	estimate: boolean;
};

export type DraftNightOffer = {
	key: string;
	// tradeUp: the AI team moves up into the user's pick. tradeDown: it moves down from its pick to the user's
	kind: "tradeUp" | "tradeDown";
	tid: number;
	teams: TradeTeams;
	text: string;
	userGives: DraftNightOfferAsset[];
	userGets: DraftNightOfferAsset[];
	userGivesPoints: number;
	userGetsPoints: number;
	shopped: boolean;
};

// Offers the user declined this session, by season and offer key
const declined = new Set<string>();

const offerKey = (teams: TradeTeams) =>
	`${teams[1].tid}|${[...teams[0].dpids].sort((a, b) => a - b).join(",")}|${[
		...teams[1].dpids,
	]
		.sort((a, b) => a - b)
		.join(",")}`;

const describeAssets = async (chart: ChartContext, dpids: number[]) => {
	const out: DraftNightOfferAsset[] = [];
	for (const dpid of dpids) {
		const dp = await idb.cache.draftPicks.get(dpid);
		if (dp) {
			out.push({
				dpid,
				desc: (await helpers.pickDesc(dp, "short")).replace(/<[^>]*>/g, ""),
				...assetPoints(chart, dp),
			});
		}
	}
	return out;
};

const buildOffer = async (
	chart: ChartContext,
	kind: DraftNightOffer["kind"],
	teams: TradeTeams,
	text: string,
	shopped: boolean,
): Promise<DraftNightOffer> => {
	const userGives = await describeAssets(chart, teams[0].dpids);
	const userGets = await describeAssets(chart, teams[1].dpids);
	const sum = (rows: DraftNightOfferAsset[]) =>
		rows.reduce((total, row) => total + row.points, 0);
	return {
		key: offerKey(teams),
		kind,
		tid: teams[1].tid,
		teams,
		text,
		userGives,
		userGets,
		userGivesPoints: sum(userGives),
		userGetsPoints: sum(userGets),
		shopped,
	};
};

const userCanTrade = () =>
	draftNightTradesOn() && !g.get("spectator") && !g.get("challengeNoTrades");

// An AI team behind the user moves up into his pick: its own pick plus as much as it can add while it still gains
// (with its margin) by the trade AI's valuation, with the user as the trading partner
const tradeUpOffer = async ({
	vcc,
	chart,
	userTid,
	userDp,
	buyerTid,
	buyerDp,
	shopped,
}: {
	vcc: ValueChangeCalculator;
	chart: ChartContext;
	userTid: number;
	userDp: DraftPick;
	buyerTid: number;
	buyerDp: DraftPick;
	shopped: boolean;
}) => {
	const extras = await getExtraPicks(buyerTid, [buyerDp.dpid]);
	const values = await pickValuesFor(
		vcc,
		buyerTid,
		[userDp.dpid, buyerDp.dpid, ...extras.map((x) => x.dpid)],
		userTid,
	);
	const slotValue = values.get(userDp.dpid)!;
	const budget = slotValue * (1 - AI_OFFER_MARGIN) - values.get(buyerDp.dpid)!;
	if (!(budget >= 0)) {
		return;
	}
	const chosen = mostWithinBudget(
		budget,
		extras.map((x) => ({ id: x.dpid, value: values.get(x.dpid)! })),
	);
	const teams = emptyTeams(userTid, buyerTid);
	teams[0].dpids = [userDp.dpid];
	teams[1].dpids = [buyerDp.dpid, ...chosen];
	if (!((await fullDv(vcc, teams, 1, userTid)) > 0)) {
		return;
	}
	if ((await summary(teams)).warning) {
		return;
	}
	const offer = await buildOffer(
		chart,
		"tradeUp",
		teams,
		shopped
			? `You shopped your pick at No. ${overallPick(userDp)}. The ${teamName(buyerTid)} offer to move up from No. ${overallPick(buyerDp)}.`
			: `The ${teamName(buyerTid)} want to move up from No. ${overallPick(buyerDp)} to your pick at No. ${overallPick(userDp)}.`,
		shopped,
	);
	if (!(offer.userGetsPoints >= MIN_USER_SHARE * offer.userGivesPoints)) {
		return;
	}
	return offer;
};

// An AI team ahead of the user moves down to his pick: it asks for his pick plus the cheapest extras that give it its
// margin by the trade AI's valuation
const tradeDownOffer = async ({
	vcc,
	chart,
	userTid,
	userDp,
	sellerTid,
	sellerDp,
}: {
	vcc: ValueChangeCalculator;
	chart: ChartContext;
	userTid: number;
	userDp: DraftPick;
	sellerTid: number;
	sellerDp: DraftPick;
}) => {
	const extras = await getExtraPicks(userTid, [userDp.dpid]);
	const values = await pickValuesFor(
		vcc,
		sellerTid,
		[sellerDp.dpid, userDp.dpid, ...extras.map((x) => x.dpid)],
		userTid,
	);
	const slotValue = values.get(sellerDp.dpid)!;
	const chosen = cheapestTopUp(
		values.get(userDp.dpid)!,
		slotValue * (1 + AI_OFFER_MARGIN),
		extras.map((x) => ({ id: x.dpid, value: values.get(x.dpid)! })),
	);
	if (!chosen) {
		return;
	}
	const teams = emptyTeams(userTid, sellerTid);
	teams[0].dpids = [userDp.dpid, ...chosen];
	teams[1].dpids = [sellerDp.dpid];
	if (!((await fullDv(vcc, teams, 1, userTid)) > 0)) {
		return;
	}
	if ((await summary(teams)).warning) {
		return;
	}
	return buildOffer(
		chart,
		"tradeDown",
		teams,
		`The ${teamName(sellerTid)} are open to moving down from No. ${overallPick(sellerDp)} to your pick at No. ${overallPick(userDp)}.`,
		false,
	);
};

// Offers for the user's next pick of this draft, when it's within OFFER_WINDOW picks. With shopDpid, the user is asking
// around about that pick of his: every AI team behind it with a pick of this draft is asked, and the best offers come back
export const getDraftNightOffers = async (shopDpid?: number) => {
	const out = {
		offers: [] as DraftNightOffer[],
		userDpid: undefined as number | undefined,
		picksAway: undefined as number | undefined,
	};
	if (!userCanTrade()) {
		return out;
	}
	const userTid = g.get("userTid");
	const order = (await getOrder()).filter(
		(dp) => dp.season === g.get("season"),
	);
	const userIndex =
		shopDpid !== undefined
			? order.findIndex((dp) => dp.dpid === shopDpid && dp.tid === userTid)
			: order.findIndex((dp) => dp.tid === userTid);
	if (userIndex < 0) {
		return out;
	}
	const userDp = order[userIndex]!;
	out.userDpid = userDp.dpid;
	out.picksAway = userIndex;
	const shopped = shopDpid !== undefined;
	if (!shopped && userIndex > OFFER_WINDOW) {
		return out;
	}

	const aiTids = (await getAITids()).filter(
		(tid) => !g.get("userTids").includes(tid),
	);
	const prospects = await getProspects();
	if (prospects.length === 0) {
		return out;
	}
	const chart = await getChartContext();
	const vcc = new ValueChangeCalculator();
	const season = g.get("season");
	const offers: DraftNightOffer[] = [];

	// Teams behind the user moving up
	const seen = new Set<number>([userTid]);
	const ups: { tid: number; dp: DraftPick; urgency: number }[] = [];
	for (
		let i = userIndex + 1;
		i < order.length && i <= userIndex + MAX_OFFER_JUMP;
		i++
	) {
		const dp = order[i]!;
		if (seen.has(dp.tid) || !aiTids.includes(dp.tid)) {
			continue;
		}
		seen.add(dp.tid);
		const board = await getBoard(dp.tid, prospects);
		const urgency = board[0] ? tradeUpUrgency(board[0].rank, userIndex, i) : 0;
		if (shopped || urgency > 0) {
			ups.push({ tid: dp.tid, dp, urgency });
		}
	}
	for (const up of ups) {
		if (!shopped) {
			const rng = new Rng(
				`draftNightOffer|${season}|${userDp.dpid}|${up.tid}|up`,
			);
			if (!rng.chance(0.6)) {
				continue;
			}
		}
		const offer = await tradeUpOffer({
			vcc,
			chart,
			userTid,
			userDp,
			buyerTid: up.tid,
			buyerDp: up.dp,
			shopped,
		});
		if (offer) {
			offers.push(offer);
		}
	}

	// Teams ahead of the user moving down, when he isn't on the clock yet
	if (!shopped) {
		const downSeen = new Set<number>([userTid]);
		for (let i = 0; i < userIndex; i++) {
			const dp = order[i]!;
			if (downSeen.has(dp.tid) || !aiTids.includes(dp.tid)) {
				continue;
			}
			downSeen.add(dp.tid);
			const board = await getBoard(dp.tid, prospects);
			const t = await idb.cache.teams.get(dp.tid);
			const rng = new Rng(
				`draftNightOffer|${season}|${userDp.dpid}|${dp.tid}|down`,
			);
			// More willing when its top prospect should still be there at the user's pick
			const chance =
				board[0] && board[0].rank >= userIndex
					? 0.6
					: t?.strategy === "rebuilding"
						? 0.3
						: 0.15;
			if (!rng.chance(chance)) {
				continue;
			}
			const offer = await tradeDownOffer({
				vcc,
				chart,
				userTid,
				userDp,
				sellerTid: dp.tid,
				sellerDp: dp,
			});
			if (offer) {
				offers.push(offer);
			}
		}
	}

	// Best for the user first
	offers.sort(
		(a, b) =>
			b.userGetsPoints -
				b.userGivesPoints -
				(a.userGetsPoints - a.userGivesPoints) || a.tid - b.tid,
	);
	out.offers = offers
		.filter((offer) => !declined.has(`${season}|${offer.key}`))
		.slice(0, shopped ? MAX_SHOP_OFFERS : MAX_UNSOLICITED_OFFERS);
	return out;
};

export const declineDraftNightOffer = (key: string) => {
	declined.add(`${g.get("season")}|${key}`);
};

// Accept an offer: the normal trade proposal, so the AI only says yes if the deal still works for it now
export const acceptDraftNightOffer = async (teams: TradeTeams) => {
	if (!userCanTrade()) {
		return {
			accepted: false as const,
			message: "Draft-night trades are not available now.",
			undo: undefined,
		};
	}
	const userTid = g.get("userTid");
	if (teams[0].tid !== userTid || teams[0].pids.length + teams[1].pids.length) {
		return {
			accepted: false as const,
			message: "This offer is no longer available.",
			undo: undefined,
		};
	}
	for (const side of [0, 1] as const) {
		for (const dpid of teams[side].dpids) {
			const dp = await idb.cache.draftPicks.get(dpid);
			if (!dp || dp.tid !== teams[side].tid) {
				return {
					accepted: false as const,
					message: "This offer is no longer available.",
					undo: undefined,
				};
			}
		}
	}
	await create(helpers.deepCopy(teams));
	const result = await propose(false);
	if (result.accepted) {
		return result;
	}
	return {
		accepted: false as const,
		message:
			result.message ??
			"The trade can't be completed as offered. Try the Trade page instead.",
		undo: undefined,
	};
};
