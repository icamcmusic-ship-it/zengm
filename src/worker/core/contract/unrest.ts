import { PHASE } from "../../../common/constants.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { randInt } from "../../../common/random.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import moodInfo from "../player/moodInfo.ts";
import { sumMoodComponents } from "./moodHistory.ts";
import { estimateMarketValue, playerLink, teamLink } from "./options.ts";

// Mood sum (see Mood component) at or below which a star asks to be traded, and above which he withdraws the request
export const TRADE_REQUEST_MOOD = -5;
export const TRADE_REQUEST_WITHDRAW_MOOD = -2;

// Chance that an eligible player requests a trade, each time it's checked (about weekly)
const TRADE_REQUEST_PROB = 0.25;

// Fraction of trade value a team gets for a player who wants out
export const TRADE_REQUEST_VALUE_FACTOR = 0.85;

// Holdouts: unhappy players who are paid much less than they're worth
export const HOLDOUT_MOOD = -3;
export const HOLDOUT_UNDERPAID_RATIO = 1.5;
const HOLDOUT_PROB = 0.2;

export const hasActiveTradeRequest = (
	p: Pick<Player, "tradeRequest" | "tid">,
) => !!p.tradeRequest && p.tradeRequest.tid === p.tid;

export const isHoldingOut = (
	p: Pick<Player, "holdout" | "tid">,
	season: number = g.get("season"),
) =>
	!!p.holdout &&
	p.holdout.tid === p.tid &&
	p.holdout.season === season &&
	p.holdout.gamesRemaining > 0;

// Players good enough that their trade requests make news: top 15% of players on teams by value
const getStarThreshold = (players: Player[]) => {
	const values = players.map((p) => p.value).sort((a, b) => b - a);
	return values[Math.floor(values.length * 0.15)] ?? Infinity;
};

export const shouldRequestTrade = ({
	moodSum,
	isStar,
	signedThisSeason,
}: {
	moodSum: number;
	isStar: boolean;
	signedThisSeason: boolean;
}) => isStar && !signedThisSeason && moodSum <= TRADE_REQUEST_MOOD;

// Check for new trade requests, and withdraw old ones that no longer apply. Called about once a week during the regular season.
export const updateTradeRequests = async () => {
	if (!g.get("tradeRequests")) {
		return;
	}

	const season = g.get("season");
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const starThreshold = getStarThreshold(players);
	const userTids = g.get("userTids");

	for (const p of players) {
		if (p.tradeRequest) {
			if (p.tradeRequest.tid !== p.tid) {
				// Traded, so request granted
				delete p.tradeRequest;
				await idb.cache.players.put(p);
				continue;
			}

			const mood = await moodInfo(p, p.tid);
			if (sumMoodComponents(mood.components) > TRADE_REQUEST_WITHDRAW_MOOD) {
				delete p.tradeRequest;
				await idb.cache.players.put(p);
				await logEvent({
					type: "tradeRequest",
					text: `${playerLink(p)} withdrew his trade request, since he's happier with the ${teamLink(p.tid)} now.`,
					pids: [p.pid],
					tids: [p.tid],
					showNotification: userTids.includes(p.tid),
				});
			}
			continue;
		}

		if (p.value < starThreshold || p.gamesUntilTradable > 0) {
			continue;
		}

		const contract = getCurrentContract(p);
		const signedThisSeason =
			!!contract &&
			(contract.start > season ||
				contract.extensions?.some((row) => row.season === season) ||
				p.transactions?.some(
					(row) => row.season === season && row.tid === p.tid,
				));

		const mood = await moodInfo(p, p.tid);
		if (
			shouldRequestTrade({
				moodSum: sumMoodComponents(mood.components),
				isStar: true,
				signedThisSeason: !!signedThisSeason,
			}) &&
			Math.random() < TRADE_REQUEST_PROB
		) {
			p.tradeRequest = {
				season,
				phase: g.get("phase"),
				tid: p.tid,
			};
			await idb.cache.players.put(p);
			await logEvent({
				type: "tradeRequest",
				text: `${playerLink(p)} has asked the ${teamLink(p.tid)} to trade him.`,
				pids: [p.pid],
				tids: [p.tid],
				score: 20,
				showNotification: userTids.includes(p.tid),
			});
		}
	}
};

export const shouldHoldOut = ({
	moodSum,
	marketValue,
	amount,
	seasonsLeft,
	minContract,
}: {
	moodSum: number;
	marketValue: number;
	amount: number;
	seasonsLeft: number;
	minContract: number;
}) =>
	seasonsLeft >= 2 &&
	moodSum <= HOLDOUT_MOOD &&
	marketValue >= minContract * 2 &&
	marketValue >= amount * HOLDOUT_UNDERPAID_RATIO;

// Before the regular season, some unhappy underpaid players hold out
export const startHoldouts = async () => {
	const frequency = g.get("holdoutFrequency");
	if (!featureOn("holdouts") || !(frequency > 0)) {
		return;
	}

	const season = g.get("season");
	const userTids = g.get("userTids");
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const numGamesFactor = g.get("numGames") / 82;

	for (const p of players) {
		const contract = getCurrentContract(p);
		if (
			!contract ||
			p.draft.year === season - 1 ||
			p.injury.gamesRemaining > 0
		) {
			continue;
		}
		const amount = contract.amounts[season - contract.start];
		if (amount === undefined) {
			continue;
		}
		const marketValue = estimateMarketValue(p);
		if (marketValue < amount * HOLDOUT_UNDERPAID_RATIO) {
			// Skip the expensive mood check
			continue;
		}

		const mood = await moodInfo(p, p.tid);
		if (
			!shouldHoldOut({
				moodSum: sumMoodComponents(mood.components),
				marketValue,
				amount,
				seasonsLeft: getContractExp(contract) - season + 1,
				minContract: g.get("minContract"),
			}) ||
			Math.random() >= Math.min(1, HOLDOUT_PROB * frequency)
		) {
			continue;
		}

		const games = Math.max(1, Math.round(randInt(3, 12) * numGamesFactor));
		p.holdout = {
			season,
			tid: p.tid,
			gamesRemaining: games,
			gamesMissed: 0,
		};
		await idb.cache.players.put(p);
		await logEvent({
			type: "holdout",
			text: `${playerLink(p)} is holding out from the ${teamLink(p.tid)}, unhappy with his ${helpers.formatCurrency(amount / 1000, "M")} salary. He's expected to miss about ${games} ${helpers.plural("game", games)}, unless he gets an extension or a trade.`,
			pids: [p.pid],
			tids: [p.tid],
			score: p.value >= 60 ? 20 : 10,
			showNotification: userTids.includes(p.tid),
		});
	}
};

// After each day of games, holdouts count down. Traded players and players who got extensions are no longer holding out.
export const updateHoldouts = async () => {
	const season = g.get("season");
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	for (const p of players) {
		if (!p.holdout) {
			continue;
		}

		if (p.holdout.tid !== p.tid || p.holdout.season !== season) {
			delete p.holdout;
			await idb.cache.players.put(p);
			continue;
		}

		if (p.holdout.gamesRemaining > 0) {
			p.holdout.gamesRemaining -= 1;
			p.holdout.gamesMissed += 1;
			if (p.holdout.gamesRemaining === 0) {
				await logEvent({
					type: "holdout",
					text: `${playerLink(p)} ended his holdout and reported to the ${teamLink(p.tid)} after missing ${p.holdout.gamesMissed} ${helpers.plural("game", p.holdout.gamesMissed)}.`,
					pids: [p.pid],
					tids: [p.tid],
					showNotification: g.get("userTids").includes(p.tid),
				});
				delete p.holdout;
			}
			await idb.cache.players.put(p);
		}
	}
};

// Holdouts end when the regular season does
export const endHoldouts = async () => {
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	for (const p of players) {
		if (p.holdout) {
			delete p.holdout;
			await idb.cache.players.put(p);
		}
	}
};

export const isRegularSeasonPhase = (phase = g.get("phase")) =>
	phase === PHASE.REGULAR_SEASON || phase === PHASE.AFTER_TRADE_DEADLINE;
