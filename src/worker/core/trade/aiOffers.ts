import { getContractSummary } from "../contract/index.ts";
import {
	conditionSpecText,
	getTradePickConditions,
} from "../../../common/draftPickConditions.ts";
import { PHASE } from "../../../common/constants.ts";
import type { AiTradeOffer, TradeTeams } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { league } from "../index.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import isUntradable from "./isUntradable.ts";
import makeItWork, { withStartingProtections } from "./makeItWork.ts";
import summary from "./summary.ts";
import { choice } from "../../../common/random.ts";
import { getAllGmWeights } from "../gm/index.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";
import create from "./create.ts";
import propose from "./propose.ts";

// AI teams sending trade offers to the user (Trade Offers page). Offers arrive during the regular season (until the
// trade deadline) and in the offseason trading phases, for players on the user's trading block or players/picks AI
// teams want for their own needs. The user can also request offers for specific assets.

// Default for aiTradeOffersExpiration: offers older than this many "days" (user games in the regular season, days of
// free agency) are dropped. In the other offseason phases offers last until the phase changes.
export const OFFER_EXPIRATION_GAMES = 15;
export const MAX_PENDING_OFFERS = 8;
export const MAX_REQUESTED_OFFERS = 3;

// Chance that an offer is about the trading block (when it has something on it) rather than an unsolicited ask
export const TRADING_BLOCK_SHARE = 0.6;

// Lowest value change for the user's team (ValueChangeCalculator, from the user's side) for an offer to be sent. Below -2 the
// trade explanation calls a deal "not close", so an AI team would never accept it the other way around
export const MIN_USER_DV_UNSOLICITED = -2;
export const MIN_USER_DV_TRADING_BLOCK = -4;

// Phases in which AI teams send offers on their own
export const OFFER_PHASES: readonly number[] = [
	PHASE.REGULAR_SEASON,
	PHASE.DRAFT_LOTTERY,
	PHASE.AFTER_DRAFT,
	PHASE.RESIGN_PLAYERS,
	PHASE.FREE_AGENCY,
];

export type OfferTargetCandidate = {
	kind: "player" | "pick";
	id: number;
	age: number;
	value: number;
	onTradingBlock: boolean;
};

export type OfferTarget = {
	candidate: OfferTargetCandidate;
	reason: "tradingBlock" | "contenderNeed" | "rebuilderNeed";
};

// What an AI team would come asking for. Anything on the user's trading block comes first. Otherwise a contender wants a good veteran and a rebuilding team wants young players or picks.
export const chooseOfferTarget = (
	strategy: "contending" | "rebuilding",
	candidates: OfferTargetCandidate[],
	random: (weights: number[]) => number,
	blockFirst: boolean = true,
): OfferTarget | undefined => {
	const pickWeighted = (rows: OfferTargetCandidate[]) => {
		if (rows.length === 0) {
			return;
		}
		const index = random(rows.map((c) => Math.max(c.value, 1)));
		return rows[index];
	};

	const block = candidates.filter((c) => c.onTradingBlock);
	if (blockFirst) {
		const fromBlock = pickWeighted(block);
		if (fromBlock) {
			return { candidate: fromBlock, reason: "tradingBlock" };
		}
	}

	const players = candidates.filter((c) => c.kind === "player");
	if (strategy === "contending") {
		// Contenders want proven players, and ignore the end of the bench
		const sorted = [...players].sort((a, b) => b.value - a.value);
		const top = sorted.slice(0, 8).filter((c) => c.age >= 25);
		const candidate = pickWeighted(top);
		return candidate ? { candidate, reason: "contenderNeed" } : undefined;
	}

	const young = [
		...players.filter((c) => c.age <= 24),
		...candidates.filter((c) => c.kind === "pick"),
	];
	const candidate = pickWeighted(young);
	return candidate ? { candidate, reason: "rebuilderNeed" } : undefined;
};

export const getOfferReasonText = (
	reason: OfferTarget["reason"],
	teamName: string,
	assetName: string,
) => {
	if (reason === "tradingBlock") {
		return `The ${teamName} saw ${assetName} on your trading block and made an offer.`;
	}
	if (reason === "contenderNeed") {
		return `The contending ${teamName} are looking for help for a playoff push and want ${assetName}.`;
	}
	return `The rebuilding ${teamName} are looking for young talent and picks, and want ${assetName}.`;
};

// Probability of an offer on a given day of the regular season or free agency. aiTradeOffersFrequency is roughly offers per 10 games
export const getDailyOfferProbability = (frequency: number) =>
	helpers.bound(frequency / 10, 0, 1);

// Probability of an offer when one of the other offseason trading phases starts
export const getPhaseOfferProbability = (frequency: number) =>
	helpers.bound(frequency / 2, 0, 1);

export const getOfferExpiration = () => {
	const value = featureOption<number>("aiTradeOffersExpiration");
	return typeof value === "number" && value > 0
		? value
		: OFFER_EXPIRATION_GAMES;
};

// How many "days" old an offer is, in the current phase. undefined means the phase has no days (offer lasts until
// the phase changes)
export const getOfferAge = (
	offer: Pick<AiTradeOffer, "gp" | "daysLeft">,
	phase: number,
	gp: number,
	daysLeft: number,
) => {
	if (phase === PHASE.REGULAR_SEASON) {
		return gp - offer.gp;
	}
	if (phase === PHASE.FREE_AGENCY && offer.daysLeft !== undefined) {
		return offer.daysLeft - daysLeft;
	}
	return undefined;
};

const getRosterKey = async (tid: number) => {
	const players = await idb.cache.players.indexGetAll("playersByTid", tid);
	return players
		.map((p) => p.pid)
		.sort((a, b) => a - b)
		.join(",");
};

export const rosterKeyStillValid = (before: string, now: string) => {
	const nowPids = new Set(now.split(","));
	return before
		.split(",")
		.filter((pid) => pid !== "")
		.every((pid) => nowPids.has(pid));
};

export const offersEnabled = () =>
	featureOn("aiTradeOffers") &&
	!g.get("spectator") &&
	!g.get("challengeNoTrades") &&
	!g.get("gameOver");

const canReceiveOffers = () => {
	return (
		featureOn("aiTradeOffers") &&
		g.get("aiTradeOffersFrequency") > 0 &&
		g.get("aiTradesFactor") > 0 &&
		!g.get("spectator") &&
		!g.get("challengeNoTrades") &&
		!g.get("gameOver") &&
		!g.get("otherTeamsWantToHire") &&
		!g.get("forceHistoricalRosters") &&
		!local.autoPlayUntil &&
		OFFER_PHASES.includes(g.get("phase"))
	);
};

const getUserGp = async () => {
	const teamSeason = await idb.cache.teamSeasons.indexGet(
		"teamSeasonsByTidSeason",
		[g.get("userTid"), g.get("season")],
	);
	return teamSeason ? helpers.getTeamSeasonGp(teamSeason) : 0;
};

// Drop offers that are stale or no longer possible, because assets moved
export const pruneAiOffers = async () => {
	const offers = g.get("aiTradeOffers");
	if (offers.length === 0) {
		return;
	}

	const gp = await getUserGp();
	const expiration = getOfferExpiration();
	const keep: AiTradeOffer[] = [];
	for (const offer of offers) {
		const age = getOfferAge(offer, g.get("phase"), gp, g.get("daysLeft"));
		if (
			offer.season !== g.get("season") ||
			offer.phase !== g.get("phase") ||
			(age !== undefined && age >= expiration) ||
			offer.teams[0].tid !== g.get("userTid")
		) {
			continue;
		}

		// The AI team lost a player (trade, release) since the offer was made. Signings don't count, since AI teams sign
		// fill-in players all the time when someone gets hurt
		if (
			offer.rosterKey !== undefined &&
			!rosterKeyStillValid(offer.rosterKey, await getRosterKey(offer.tid))
		) {
			continue;
		}

		let valid = true;
		for (const t of offer.teams) {
			for (const pid of t.pids) {
				const p = await idb.cache.players.get(pid);
				if (!p || p.tid !== t.tid || isUntradable(p).untradable) {
					valid = false;
				}
			}
			for (const dpid of t.dpids) {
				const dp = await idb.cache.draftPicks.get(dpid);
				if (!dp || dp.tid !== t.tid) {
					valid = false;
				}
			}
		}
		if (valid) {
			keep.push(offer);
		}
	}

	if (keep.length !== offers.length) {
		await league.setGameAttributes({ aiTradeOffers: keep });
	}
};

// makeItWork with only the AI team adding assets. When the result breaks the salary cap rules (common, since the user's
// team is often over the cap and AI teams like to send salary back), try again with the AI team's players that are
// too expensive to match left out, so it pays in cheaper players and picks instead
export const makeAiOfferWork = async (
	teams0: TradeTeams,
	valueChangeCalculator: ValueChangeCalculator,
	maxAssetsToAdd: number,
) => {
	const run = async (input: TradeTeams) => {
		const teams = await makeItWork(await withStartingProtections(input), {
			holdUserConstant: true,
			maxAssetsToAdd,
			valueChangeCalculator,
			aiPickConditions: true,
		});
		if (!teams || teams[1].pids.length + teams[1].dpids.length === 0) {
			return { teams: undefined, warning: false };
		}
		const s = await summary(teams);
		return { teams, warning: !!s.warning };
	};

	const first = await run(teams0);
	if (first.teams && !first.warning) {
		return first.teams;
	}
	if (!first.warning) {
		return;
	}

	let userSalary = 0;
	for (const pid of teams0[0].pids) {
		const p = await idb.cache.players.get(pid);
		userSalary += p ? (getContractSummary(p)?.amount ?? 0) : 0;
	}
	const salaryCapType = g.get("salaryCapType");
	const limit =
		salaryCapType === "none"
			? Infinity
			: salaryCapType === "hard"
				? userSalary
				: (userSalary * g.get("softCapTradeSalaryMatch")) / 100 + 100;
	const aiPlayers = await idb.cache.players.indexGetAll(
		"playersByTid",
		teams0[1].tid,
	);
	// Any single player over the limit breaks the rule on his own
	const tooExpensive = aiPlayers
		.filter((p) => (getContractSummary(p)?.amount ?? 0) > limit)
		.map((p) => p.pid);
	const second = await run([
		teams0[0],
		{
			...teams0[1],
			pidsExcluded: [...teams0[1].pidsExcluded, ...tooExpensive],
		},
	]);
	if (second.teams && !second.warning) {
		return second.teams;
	}
};

// Try to build an offer from team tid to the user. Doesn't save anything
export const buildAiOffer = async (
	tid: number,
	valueChangeCalculator: ValueChangeCalculator,
) => {
	const userTid = g.get("userTid");
	const t = await idb.cache.teams.get(tid);
	if (!t || t.disabled || tid === userTid) {
		return;
	}

	const savedTradingBlock = await idb.cache.savedTradingBlock.get(0);
	const blockPids =
		savedTradingBlock?.tid === userTid ? savedTradingBlock.pids : [];
	const blockDpids =
		savedTradingBlock?.tid === userTid ? savedTradingBlock.dpids : [];

	const userPlayers = (
		await idb.cache.players.indexGetAll("playersByTid", userTid)
	).filter((p) => !isUntradable(p).untradable);
	const userPicks = await idb.cache.draftPicks.indexGetAll(
		"draftPicksByTid",
		userTid,
	);

	const candidates: OfferTargetCandidate[] = [
		...userPlayers.map((p) => ({
			kind: "player" as const,
			id: p.pid,
			age: g.get("season") - p.born.year,
			value: p.valueFuzz,
			onTradingBlock: blockPids.includes(p.pid),
		})),
		...userPicks.map((dp) => ({
			kind: "pick" as const,
			id: dp.dpid,
			age: 0,
			// Rough, just for weighting which pick to ask about
			value: dp.round === 1 ? 50 : 25,
			onTradingBlock: blockDpids.includes(dp.dpid),
		})),
	];

	const target = chooseOfferTarget(
		t.strategy,
		candidates,
		(weights) => {
			const indexes = weights.map((_, i) => i);
			return choice(indexes, (i) => weights[i]!);
		},
		Math.random() < TRADING_BLOCK_SHARE,
	);
	if (!target) {
		return;
	}

	const teams0: TradeTeams = [
		{
			tid: userTid,
			pids: target.candidate.kind === "player" ? [target.candidate.id] : [],
			pidsExcluded: [],
			dpids: target.candidate.kind === "pick" ? [target.candidate.id] : [],
			dpidsExcluded: [],
		},
		{
			tid,
			pids: [],
			pidsExcluded: [],
			dpids: [],
			dpidsExcluded: [],
		},
	];

	// Only the AI team adds assets: it's their offer for your player
	const teams = await makeAiOfferWork(teams0, valueChangeCalculator, 4);
	if (!teams) {
		return;
	}

	// Don't send offers that are lopsided against the user by the same math the AI uses to judge its own trades (with the user's
	// team's strategy and roster). Looser for something on the trading block, which the user wants to move
	const userDv = await valueChangeCalculator.evaluate({
		tid: userTid,
		pidsAdd: teams[1].pids,
		pidsRemove: teams[0].pids,
		dpidsAdd: teams[1].dpids,
		dpidsRemove: teams[0].dpids,
		tradingPartnerTid: tid,
		pickConditions: getTradePickConditions(teams),
	});
	if (
		userDv <
		(target.reason === "tradingBlock"
			? MIN_USER_DV_TRADING_BLOCK
			: MIN_USER_DV_UNSOLICITED)
	) {
		return;
	}

	let assetName = "a draft pick";
	if (target.candidate.kind === "player") {
		const p = await idb.cache.players.get(target.candidate.id);
		if (p) {
			assetName = `${p.firstName} ${p.lastName}`;
		}
	} else {
		const dp = await idb.cache.draftPicks.get(target.candidate.id);
		if (dp) {
			assetName = `your ${await helpers.pickDesc(dp, "short")}`;
			// The offer may come with a protection on your pick
			const condition = teams[0].pickConditions?.find(
				(c) => c.dpid === dp.dpid,
			);
			if (condition) {
				assetName += ` (${conditionSpecText(condition)})`;
			}
		}
	}

	const teamInfo = g.get("teamInfoCache")[tid];
	const teamName = teamInfo ? `${teamInfo.region} ${teamInfo.name}` : "???";

	return {
		teams,
		reason: getOfferReasonText(target.reason, teamName, assetName),
		source:
			target.reason === "tradingBlock"
				? ("tradingBlock" as const)
				: ("unsolicited" as const),
	};
};

export const addAiOffer = async (
	tid: number,
	built: {
		teams: TradeTeams;
		reason: string;
		source?: AiTradeOffer["source"];
	},
	notify: boolean,
) => {
	const offers = g.get("aiTradeOffers");
	const id = Math.max(0, ...offers.map((offer) => offer.id + 1));
	const offer: AiTradeOffer = {
		id,
		tid,
		season: g.get("season"),
		phase: g.get("phase"),
		gp: await getUserGp(),
		daysLeft: g.get("daysLeft"),
		rosterKey: await getRosterKey(tid),
		source: built.source,
		teams: built.teams,
		reason: built.reason,
	};

	// One offer per team, newest wins, and only keep a few
	const newOffers = [
		offer,
		...offers.filter((offer2) => offer2.tid !== tid),
	].slice(0, MAX_PENDING_OFFERS);
	await league.setGameAttributes({ aiTradeOffers: newOffers });

	// A notification only, no inbox message: unread messages stop the game from being played, which would be spam here
	if (notify) {
		const url = helpers.leagueUrl(["trade_offers"]);
		await logEvent({
			type: "info",
			text: `Trade offer: ${built.reason} <a href="${url}">View offer</a>`,
			saveToDb: false,
			tids: [g.get("userTid")],
		});
	}

	return offer;
};

// Leagues/seasons for which the user was already told the trade deadline is coming up this session
const deadlineNoticeSeasons = new Set<string>();
export const DEADLINE_NOTICE_DAYS = 7;

const deadlineNotice = async () => {
	const season = g.get("season");
	const noticeKey = `${g.get("lid")}:${season}`;
	if (deadlineNoticeSeasons.has(noticeKey)) {
		return;
	}
	const schedule = await idb.cache.schedule.getAll();
	if (schedule.length === 0) {
		return;
	}
	const today = Math.min(...schedule.map((game) => game.day));
	const deadline = schedule.find(
		(game) => game.awayTid === -3 && game.homeTid === -3,
	);
	if (!deadline) {
		return;
	}
	const daysLeft = deadline.day - today;
	if (daysLeft > DEADLINE_NOTICE_DAYS) {
		return;
	}
	// Reload-safe without saving anything: the notice belongs to the day the window opens (or the season's first day, if
	// the deadline is closer than that), so reloading later in the window doesn't show it again
	if (daysLeft < DEADLINE_NOTICE_DAYS) {
		const teamSeason = await idb.cache.teamSeasons.indexGet(
			"teamSeasonsByTidSeason",
			[g.get("userTid"), season],
		);
		const gp = teamSeason
			? teamSeason.won +
				teamSeason.lost +
				(teamSeason.tied ?? 0) +
				(teamSeason.otl ?? 0)
			: 0;
		if (gp > 0) {
			deadlineNoticeSeasons.add(noticeKey);
			return;
		}
	}
	deadlineNoticeSeasons.add(noticeKey);
	await logEvent({
		type: "info",
		text: `The trade deadline is ${daysLeft <= 1 ? "tomorrow" : `in ${daysLeft} days`}. ${featureOn("tradeMarket") ? `See who AI teams are shopping on the <a href="${helpers.leagueUrl(["trade_market"])}">Trade Market</a>.` : ""}`.trim(),
		saveToDb: false,
		tids: [g.get("userTid")],
	});
};

const sendRandomOffer = async () => {
	const tids = (await idb.cache.teams.getAll())
		.filter((t) => !t.disabled && !g.get("userTids").includes(t.tid))
		.map((t) => t.tid);
	const valueChangeCalculator = new ValueChangeCalculator({ quick: true });

	// AI GM personalities (setting): dealmakers call more often
	const gms = await getAllGmWeights();

	// A few tries, since not every team can make a sensible offer
	for (let i = 0; i < 5; i++) {
		const tid =
			gms.size > 0
				? choice(tids, (tid2) => gms.get(tid2)?.tradeWeight ?? 1)
				: choice(tids);
		if (tid === undefined) {
			return;
		}
		const built = await buildAiOffer(tid, valueChangeCalculator);
		if (built) {
			await addAiOffer(tid, built, true);
			return;
		}
	}
};

// Called when a new phase starts: drop offers from the old phase, and maybe send one at the start of an offseason
// trading phase (free agency days have their own daily roll)
export const aiOffersAtPhase = async (phase: number) => {
	if (g.get("aiTradeOffers").length > 0) {
		await pruneAiOffers();
	}
	if (
		!canReceiveOffers() ||
		phase === PHASE.REGULAR_SEASON ||
		phase === PHASE.FREE_AGENCY
	) {
		return;
	}
	if (
		Math.random() < getPhaseOfferProbability(g.get("aiTradeOffersFrequency"))
	) {
		await sendRandomOffer();
	}
};

// Called every day during the regular season and free agency
const aiOffers = async () => {
	if (
		g.get("phase") === PHASE.REGULAR_SEASON &&
		!g.get("spectator") &&
		!g.get("challengeNoTrades") &&
		!local.autoPlayUntil
	) {
		await deadlineNotice();
	}

	if (!canReceiveOffers()) {
		return;
	}

	await pruneAiOffers();

	if (
		g.get("phase") !== PHASE.REGULAR_SEASON &&
		g.get("phase") !== PHASE.FREE_AGENCY
	) {
		return;
	}

	if (
		Math.random() >= getDailyOfferProbability(g.get("aiTradeOffersFrequency"))
	) {
		return;
	}

	await sendRandomOffer();
};

const tradingAllowedNow = () => {
	const phase = g.get("phase");
	return !(
		(phase >= PHASE.AFTER_TRADE_DEADLINE && phase <= PHASE.PLAYOFFS) ||
		phase === PHASE.FANTASY_DRAFT ||
		phase === PHASE.EXPANSION_DRAFT
	);
};

// The old trading block "what would you give for these" as a request: AI teams answer with offers in the inbox
export const requestAiOffers = async (pids: number[], dpids: number[]) => {
	if (!offersEnabled() || !tradingAllowedNow()) {
		return 0;
	}
	if (pids.length === 0 && dpids.length === 0) {
		return 0;
	}
	await pruneAiOffers();

	const userTid = g.get("userTid");
	const tids = (await idb.cache.teams.getAll())
		.filter((t) => !t.disabled && !g.get("userTids").includes(t.tid))
		.map((t) => t.tid);
	const valueChangeCalculator = new ValueChangeCalculator();

	const names: string[] = [];
	for (const pid of pids) {
		const p = await idb.cache.players.get(pid);
		if (p) {
			names.push(`${p.firstName} ${p.lastName}`);
		}
	}
	for (const dpid of dpids) {
		const dp = await idb.cache.draftPicks.get(dpid);
		if (dp) {
			names.push(`your ${await helpers.pickDesc(dp, "short")}`);
		}
	}
	const assetText = names.length > 0 ? names.join(", ") : "your assets";

	const built: { tid: number; teams: TradeTeams; dv: number }[] = [];
	for (const tid of tids) {
		const teams0: TradeTeams = [
			{
				tid: userTid,
				pids: [...pids],
				pidsExcluded: [],
				dpids: [...dpids],
				dpidsExcluded: [],
			},
			{ tid, pids: [], pidsExcluded: [], dpids: [], dpidsExcluded: [] },
		];
		const teams = await makeAiOfferWork(
			teams0,
			valueChangeCalculator,
			4 + pids.length + dpids.length,
		);
		if (!teams) {
			continue;
		}

		// Rank offers by how much they give, from the user's point of view
		const dv = await valueChangeCalculator.evaluate({
			tid: userTid,
			pidsAdd: teams[1].pids,
			pidsRemove: teams[0].pids,
			dpidsAdd: teams[1].dpids,
			dpidsRemove: teams[0].dpids,
			tradingPartnerTid: tid,
		});
		built.push({ tid, teams, dv });
	}

	built.sort((a, b) => b.dv - a.dv);
	const best = built.slice(0, MAX_REQUESTED_OFFERS);
	// Add worst first, so the best offer ends up on top
	for (const row of [...best].reverse()) {
		const teamInfo = g.get("teamInfoCache")[row.tid];
		const teamName = teamInfo ? `${teamInfo.region} ${teamInfo.name}` : "???";
		await addAiOffer(
			row.tid,
			{
				teams: row.teams,
				reason: `You asked around about ${assetText}. The ${teamName} answered with this offer.`,
				source: "requested",
			},
			false,
		);
	}

	return best.length;
};

export const acceptAiOffer = async (id: number) => {
	await pruneAiOffers();
	const offer = g.get("aiTradeOffers").find((offer) => offer.id === id);
	if (!offer) {
		return {
			accepted: false as const,
			message: "This offer is no longer available.",
			undo: undefined,
		};
	}

	await create(helpers.deepCopy(offer.teams));
	const result = await propose(false);
	if (result.accepted) {
		await dismissAiOffer(id);
		await pruneAiOffers();
		return result;
	}
	return {
		accepted: false as const,
		message:
			result.message ??
			"The trade can't be completed as offered. Try negotiating instead.",
		undo: undefined,
	};
};

export const dismissAiOffer = async (id: number) => {
	await league.setGameAttributes({
		aiTradeOffers: g.get("aiTradeOffers").filter((offer) => offer.id !== id),
	});
};

export default aiOffers;
