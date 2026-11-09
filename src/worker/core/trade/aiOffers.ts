import { conditionSpecText } from "../../../common/draftPickConditions.ts";
import { PHASE } from "../../../common/constants.ts";
import type { AiTradeOffer, TradeTeams } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import {
	g,
	helpers,
	local,
	logEvent,
	updatePlayMenu,
} from "../../util/index.ts";
import { league } from "../index.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import isUntradable from "./isUntradable.ts";
import makeItWork, { withStartingProtections } from "./makeItWork.ts";
import summary from "./summary.ts";
import { choice } from "../../../common/random.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

// AI teams sending trade offers to the user during the season

// Offers older than this many of the user's games are dropped
export const OFFER_EXPIRATION_GAMES = 15;
export const MAX_PENDING_OFFERS = 5;

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
): OfferTarget | undefined => {
	const pickWeighted = (rows: OfferTargetCandidate[]) => {
		if (rows.length === 0) {
			return;
		}
		const index = random(rows.map((c) => Math.max(c.value, 1)));
		return rows[index];
	};

	const block = candidates.filter((c) => c.onTradingBlock);
	const fromBlock = pickWeighted(block);
	if (fromBlock) {
		return { candidate: fromBlock, reason: "tradingBlock" };
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

// Probability of an offer on a given day of the regular season. aiTradeOffersFrequency is roughly offers per 10 games
export const getDailyOfferProbability = (frequency: number) =>
	helpers.bound(frequency / 10, 0, 1);

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
		g.get("phase") === PHASE.REGULAR_SEASON
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
	const keep: AiTradeOffer[] = [];
	for (const offer of offers) {
		if (
			offer.season !== g.get("season") ||
			offer.phase !== g.get("phase") ||
			gp - offer.gp > OFFER_EXPIRATION_GAMES ||
			offer.teams[0].tid !== g.get("userTid")
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

	const target = chooseOfferTarget(t.strategy, candidates, (weights) => {
		const indexes = weights.map((_, i) => i);
		return choice(indexes, (i) => weights[i]!);
	});
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
	const teams = await makeItWork(await withStartingProtections(teams0), {
		holdUserConstant: true,
		maxAssetsToAdd: 4,
		valueChangeCalculator,
		aiPickConditions: true,
	});
	if (!teams || teams[1].pids.length + teams[1].dpids.length === 0) {
		return;
	}

	const s = await summary(teams);
	if (s.warning) {
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
	};
};

export const addAiOffer = async (
	tid: number,
	built: { teams: TradeTeams; reason: string },
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
		teams: built.teams,
		reason: built.reason,
	};

	// One offer per team, newest wins, and only keep a few
	const newOffers = [
		offer,
		...offers.filter((offer2) => offer2.tid !== tid),
	].slice(0, MAX_PENDING_OFFERS);
	await league.setGameAttributes({ aiTradeOffers: newOffers });

	if (notify) {
		const teamInfo = g.get("teamInfoCache")[tid];
		const url = helpers.leagueUrl(["trade_proposals"]);
		await idb.cache.messages.add({
			read: false,
			from: teamInfo ? `${teamInfo.region} GM` : "AI GM",
			year: g.get("season"),
			subject: "Trade offer",
			text: `<p>${built.reason}</p><p><a href="${url}">See the offer on the Trade Proposals page.</a></p>`,
		});
		await logEvent({
			type: "info",
			text: `${built.reason} <a href="${url}">View offer</a>`,
			saveToDb: false,
			tids: [g.get("userTid")],
		});
		await updatePlayMenu();
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

// Called every day during the regular season
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
		Math.random() >= getDailyOfferProbability(g.get("aiTradeOffersFrequency"))
	) {
		return;
	}

	const tids = (await idb.cache.teams.getAll())
		.filter((t) => !t.disabled && !g.get("userTids").includes(t.tid))
		.map((t) => t.tid);
	const valueChangeCalculator = new ValueChangeCalculator({ quick: true });

	// A few tries, since not every team can make a sensible offer
	for (let i = 0; i < 3; i++) {
		const tid = choice(tids);
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

export const dismissAiOffer = async (id: number) => {
	await league.setGameAttributes({
		aiTradeOffers: g.get("aiTradeOffers").filter((offer) => offer.id !== id),
	});
};

export default aiOffers;
