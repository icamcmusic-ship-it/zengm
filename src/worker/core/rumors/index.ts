/**
 * Rumors (League extras, `featureRumors`). A rumor mill built from what AI teams are actually planning: the sellers, buyers and salary
 * dumps of the need-based AI trades, the Trade Market, trade requests and holdouts, the free agent market, extension talks, the coaching
 * and GM hot seats and draft needs. Each rumor has a confidence and is later marked confirmed or didn't happen.
 *
 * It only reads the league. It never changes a team or a player and never draws from Math.random: its own seeded stream (league rumor
 * seed + day counter) decides how many rumors, which ones and how they are worded, and while it runs Math.random is swapped for that
 * stream, so even a helper that draws a random number can't move the sim's sequence. AI decisions are the same with it on or off
 * (rumors.test.ts).
 */
import { PHASE } from "../../../common/constants.ts";
import {
	getContractExp,
	getCurrentContract,
} from "../../../common/contracts.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	addToTally,
	calibrate,
	dailyRate,
	emptyRumorState,
	mixSeed,
	momentValue,
	phaseBurst,
	poisson,
	posInDraftGroup,
	pruneRumors,
	rumorKey,
	takenKeys,
	tradeRumorUntil,
	typeWeights,
	weightedIndex,
	type RumorClock,
} from "../../../common/rumors/logic.ts";
import {
	renderRumorText,
	rumorTemplates,
	tokCoach,
	tokGm,
	tokPlayer,
	tokTeam,
	type RumorTextInput,
} from "../../../common/rumors/text.ts";
import {
	RUMOR_TYPES,
	type Rumor,
	type RumorMoment,
	type RumorState,
	type RumorType,
} from "../../../common/rumors/types.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { featureOn, featureOption } from "../../util/nativeFeatures.ts";
import { getContractSummaryOrThrow } from "../contract/index.ts";
import {
	getExtensionDemand,
	getExtensionIneligibleReason,
} from "../contract/extension.ts";
import { sumMoodComponents } from "../contract/moodHistory.ts";
import { estimateMarketValue } from "../contract/options.ts";
import {
	hasActiveTradeRequest,
	isHoldingOut,
	shouldHoldOut,
	TRADE_REQUEST_MOOD,
} from "../contract/unrest.ts";
import { isCollege } from "../college/isCollege.ts";
import { getNeedLabels, getTeamNeeds } from "../draft/draftNeeds.ts";
import { getFreeAgentMarket } from "../freeAgents/market.ts";
import { gmEnabled, projectedFireProb } from "../gm/index.ts";
import league from "../league/index.ts";
import moodInfo from "../player/moodInfo.ts";
import { coachSystemsEnabled, hotSeatNow } from "../staff/systems.ts";
import { staffEnabled } from "../staff/index.ts";
import {
	getSalaryDumpCandidates,
	getVeteranCandidates,
	gmTradeWeight,
	isBuyer,
	isDeadlineWindow,
	isSeller,
	wantsToDumpSalary,
	type CandidatePlayer,
} from "../trade/aiNeeds.ts";
import { getAITids, getNeedInfo } from "../trade/betweenAiTeams.ts";
import isUntradable from "../trade/isUntradable.ts";
import { AVAILABLE_THRESHOLD, getAvailability } from "../trade/market.ts";

export const rumorsEnabled = () => featureOn("rumors");

const readState = (): RumorState | undefined => {
	try {
		return g.get("rumors");
	} catch {
		return undefined;
	}
};

// No Math.random here either: the clock is only used for the seed of a league's first rumor day
const newSeed = () => {
	let lid = 0;
	try {
		lid = g.get("lid") ?? 0;
	} catch {}
	return (Date.now() ^ Math.imul(lid + 1, 0x9e3779b1)) | 0;
};

export const getRumorState = (): RumorState =>
	helpers.deepCopy(readState() ?? emptyRumorState(newSeed()));

const now = (): RumorMoment => ({
	season: g.get("season"),
	phase: g.get("phase"),
});

const playerName = (p: Pick<Player, "firstName" | "lastName">) =>
	`${p.firstName} ${p.lastName}`.trim();

const tradedAway = (p: Player, fromTid: number, since: RumorMoment) => {
	if (p.tid === fromTid || p.tid < 0) {
		return false;
	}
	const last = p.transactions?.at(-1);
	return (
		last?.type === "trade" &&
		last.tid === p.tid &&
		momentValue(last) >= momentValue(since)
	);
};

type Draft = Omit<
	Rumor,
	"rid" | "season" | "phase" | "tick" | "text" | "status" | "confidence"
> & {
	// Chance it comes true, before the track record correction
	raw: number;
	weight: number;
	text: Omit<RumorTextInput, "type" | "kind" | "confidence">;
};

type Ctx = Awaited<ReturnType<typeof makeCtx>>;

const toCandidates = (players: Player[], season: number): CandidatePlayer[] =>
	players.map((p) => {
		const contract = getContractSummaryOrThrow(p);
		return {
			pid: p.pid,
			age: season - p.born.year,
			value: p.value,
			contractAmount: contract.amount,
			contractExp: contract.exp,
		};
	});

// Everything the gatherers share, read once per rumor day
const makeCtx = async () => {
	const season = g.get("season");
	const phase = g.get("phase");
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const aiTids = await getAITids();
	const aiSet = new Set(aiTids);
	const need = await getNeedInfo(aiTids);
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const byTid = new Map<number, Player[]>();
	for (const p of players) {
		const list = byTid.get(p.tid);
		if (list) {
			list.push(p);
		} else {
			byTid.set(p.tid, [p]);
		}
	}
	for (const list of byTid.values()) {
		list.sort((a, b) => b.value - a.value);
	}
	const values = players.map((p) => p.value).sort((a, b) => b - a);
	// Players worth a rumor: about the 4 best per team, and stars as the Trade Requests setting defines them
	const notable = values[Math.min(values.length - 1, teams.length * 4)] ?? 0;
	const star = values[Math.floor(values.length * 0.15)] ?? Infinity;

	const hasDeadline = g.get("tradeDeadline") < 1;
	const clock: RumorClock = {
		phase,
		seasonProgress: need.ctx.seasonProgress,
		tradeDeadline: g.get("tradeDeadline"),
		daysLeft: g.get("daysLeft"),
	};
	// Whether AI teams trade at all
	const aiTrades = g.get("aiTradesFactor") > 0 && aiTids.length > 1;
	const moodSums = new Map<number, number>();
	const moodSum = async (p: Player) => {
		let sum = moodSums.get(p.pid);
		if (sum === undefined) {
			sum = sumMoodComponents((await moodInfo(p, p.tid)).components);
			moodSums.set(p.pid, sum);
		}
		return sum;
	};

	return {
		season,
		phase,
		teams,
		aiTids,
		aiSet,
		need,
		infoByTid: new Map(need.infos.map((info) => [info.tid, info])),
		players,
		byTid,
		notable,
		star,
		hasDeadline,
		clock,
		aiTrades,
		moodSum,
		tradeUntil: tradeRumorUntil(season, phase, hasDeadline),
		// Days of games left before the deadline (or the end of the season), about two days per game
		daysToDeadline: Math.max(
			0,
			(Math.min(1, g.get("tradeDeadline")) - need.ctx.seasonProgress) *
				g.get("numGames") *
				2,
		),
	};
};

const tradable = (ctx: Ctx, tid: number) =>
	(ctx.byTid.get(tid) ?? []).filter((p) => !isUntradable(p).untradable);

const pTok = (p: Player) => tokPlayer(p.pid, playerName(p));

// Players AI teams are ready to move: trade requests, sellers' veterans, salary dumps, and the Trade Market's most available players
const gatherShopping = (ctx: Ctx): Draft[] => {
	const out: Draft[] = [];
	if (!ctx.aiTrades) {
		return out;
	}
	const needBased = !!featureOn("aiNeedTrades");
	const window = isDeadlineWindow(ctx.need.ctx);
	const seen = new Set<number>();
	const add = (p: Player, kind: string, raw: number, weight: number) => {
		if (seen.has(p.pid)) {
			return;
		}
		seen.add(p.pid);
		out.push({
			type: "shopping",
			kind,
			tids: [p.tid],
			pids: [p.pid],
			fromTid: p.tid,
			until: ctx.tradeUntil,
			untilTick: undefined,
			raw,
			weight,
			text: { t0: tokTeam(p.tid), p: pTok(p) },
		});
	};

	if (needBased) {
		for (const p of ctx.need.requesters) {
			add(p, "request", 0.7, 8);
		}
	}
	for (const info of ctx.need.infos) {
		const roster = tradable(ctx, info.tid);
		const byPid = new Map(roster.map((p) => [p.pid, p]));
		const candidates = toCandidates(roster, ctx.season);
		if (needBased && isSeller(info, ctx.need.ctx)) {
			for (const c of getVeteranCandidates(candidates)) {
				add(
					byPid.get(c.pid)!,
					window ? "deadline" : "rebuild",
					window ? 0.12 : 0.07,
					(window ? 3 : 1.5) * gmTradeWeight(info),
				);
			}
		}
		if (needBased && wantsToDumpSalary(info, ctx.need.ctx)) {
			const dumps = getSalaryDumpCandidates(
				candidates,
				ctx.season,
				g.get("minContract"),
				g.get("maxContract"),
			).slice(0, 2);
			for (const c of dumps) {
				add(byPid.get(c.pid)!, "dump", 0.08, 1.5 * gmTradeWeight(info));
			}
		}
		// The Trade Market's view of the roster, for the classic value-for-value trades
		for (const [valueRank, p] of roster.entries()) {
			if (p.value < ctx.notable) {
				break;
			}
			const contract = getContractSummaryOrThrow(p);
			const availability = getAvailability({
				strategy: info.strategy,
				age: ctx.season - p.born.year,
				valueRank,
				rosterSize: roster.length,
				value: p.value,
				contractAmount: contract.amount,
				contractExp: contract.exp,
				season: ctx.season,
				minContract: g.get("minContract"),
				maxContract: g.get("maxContract"),
				untradable: false,
			});
			if (availability.score >= AVAILABLE_THRESHOLD + 10) {
				add(p, "available", 0.05, 0.6);
			}
		}
	}
	return out;
};

// Buyers calling about sellers' veterans (AI to AI), and AI teams that like one of the user's players
const gatherInterest = (ctx: Ctx): Draft[] => {
	const out: Draft[] = [];
	if (!ctx.aiTrades) {
		return out;
	}
	const window = isDeadlineWindow(ctx.need.ctx);
	if (featureOn("aiNeedTrades")) {
		const buyers = ctx.need.infos.filter((t) => isBuyer(t));
		const targets: { p: Player; kind: string }[] = [];
		for (const p of ctx.need.requesters) {
			targets.push({ p, kind: "request" });
		}
		for (const info of ctx.need.infos) {
			if (!isSeller(info, ctx.need.ctx)) {
				continue;
			}
			const roster = tradable(ctx, info.tid);
			const byPid = new Map(roster.map((p) => [p.pid, p]));
			for (const c of getVeteranCandidates(toCandidates(roster, ctx.season))) {
				const p = byPid.get(c.pid)!;
				if (!targets.some((row) => row.p.pid === p.pid)) {
					targets.push({ p, kind: "vet" });
				}
			}
		}
		for (const { p, kind } of targets) {
			const teams = kind === "request" ? ctx.need.infos : buyers;
			for (const buyer of teams) {
				if (buyer.tid === p.tid) {
					continue;
				}
				const winp = buyer.winp ?? 0.5;
				out.push({
					type: "interest",
					kind,
					tids: [buyer.tid, p.tid],
					pids: [p.pid],
					fromTid: p.tid,
					until: ctx.tradeUntil,
					raw: kind === "request" ? 0.06 : window ? 0.035 : 0.02,
					weight:
						(kind === "request"
							? 0.3 * (buyer.strategy === "contending" ? 2 : 1) * (0.2 + winp)
							: winp ** 2 * (window ? 2 : 1)) *
						gmTradeWeight(buyer) *
						Math.max(1, p.value - 40),
					text: { t0: tokTeam(buyer.tid), t1: tokTeam(p.tid), p: pTok(p) },
				});
			}
		}
	}

	// The user's players: what an AI team would come asking for (like its unsolicited offers), contenders want good veterans and
	// rebuilding teams young players. Confirmed by an offer for him, or a trade to that team
	const userTid = g.get("userTid");
	if (
		!ctx.aiSet.has(userTid) &&
		featureOn("aiTradeOffers") &&
		g.get("aiTradeOffersFrequency") > 0 &&
		(ctx.phase <= PHASE.REGULAR_SEASON || ctx.phase >= PHASE.DRAFT_LOTTERY)
	) {
		const roster = tradable(ctx, userTid);
		const top = roster.slice(0, 8);
		for (const info of ctx.need.infos) {
			for (const p of top) {
				const age = ctx.season - p.born.year;
				if (info.strategy === "contending" ? age < 25 : age > 24) {
					continue;
				}
				out.push({
					type: "interest",
					kind: "user",
					tids: [info.tid, userTid],
					pids: [p.pid],
					fromTid: userTid,
					until: ctx.tradeUntil,
					untilTick: undefined,
					user: true,
					raw: 0.05,
					weight: 0.15 * gmTradeWeight(info) * Math.max(1, p.value - 40),
					text: { t0: tokTeam(info.tid), t1: tokTeam(userTid), p: pTok(p) },
				});
			}
		}
	}
	return out;
};

// Buyers with their own next first round pick to spend
const gatherPick = async (ctx: Ctx): Promise<Draft[]> => {
	const out: Draft[] = [];
	if (!ctx.aiTrades || !featureOn("aiNeedTrades")) {
		return out;
	}
	// The next draft: this season's until it happens, then next season's
	const draftSeason = ctx.phase > PHASE.DRAFT ? ctx.season + 1 : ctx.season;
	for (const info of ctx.need.infos) {
		if (!isBuyer(info)) {
			continue;
		}
		const picks = await idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			info.tid,
		);
		const dp = picks.find(
			(row) =>
				row.round === 1 &&
				row.season === draftSeason &&
				row.originalTid === info.tid,
		);
		if (!dp) {
			continue;
		}
		const winp = info.winp ?? 0.5;
		out.push({
			type: "pick",
			tids: [info.tid],
			pids: [],
			dpid: dp.dpid,
			until:
				ctx.phase > PHASE.DRAFT
					? ctx.tradeUntil
					: momentValue(ctx.tradeUntil) <
						  momentValue({ season: draftSeason, phase: PHASE.DRAFT })
						? ctx.tradeUntil
						: { season: draftSeason, phase: PHASE.DRAFT },
			raw: 0.05,
			weight: winp ** 2 * gmTradeWeight(info),
			text: { t0: tokTeam(info.tid), year: draftSeason },
		});
	}
	return out;
};

// Stars whose mood is near the point where they ask out, and (before the season) underpaid players who could hold out
const gatherUnhappy = async (ctx: Ctx): Promise<Draft[]> => {
	const out: Draft[] = [];
	// College mode: no contracts to hold out over and no trades to ask for
	if (isCollege()) {
		return out;
	}
	const requestsOn = !!featureOn("tradeRequests");
	const inSeason =
		ctx.phase === PHASE.REGULAR_SEASON ||
		ctx.phase === PHASE.AFTER_TRADE_DEADLINE;

	if (ctx.phase === PHASE.PRESEASON) {
		const frequency = g.get("holdoutFrequency");
		if (featureOn("holdouts") && frequency > 0) {
			for (const p of ctx.players) {
				const contract = getCurrentContract(p);
				const amount = contract?.amounts[ctx.season - contract.start];
				if (
					!contract ||
					amount === undefined ||
					p.draft.year === ctx.season - 1 ||
					p.injury.gamesRemaining > 0 ||
					isHoldingOut(p, ctx.season)
				) {
					continue;
				}
				const marketValue = estimateMarketValue(p);
				if (marketValue < amount * 1.5) {
					continue;
				}
				if (
					!shouldHoldOut({
						moodSum: await ctx.moodSum(p),
						marketValue,
						amount,
						seasonsLeft: getContractExp(contract) - ctx.season + 1,
						minContract: g.get("minContract"),
					})
				) {
					continue;
				}
				out.push({
					type: "unhappy",
					kind: "holdout",
					tids: [p.tid],
					pids: [p.pid],
					fromTid: p.tid,
					until: { season: ctx.season, phase: PHASE.REGULAR_SEASON },
					user: ctx.aiSet.has(p.tid) ? undefined : true,
					raw: Math.min(0.9, 0.2 * frequency),
					weight: Math.max(1, p.value - 35),
					text: { t0: tokTeam(p.tid), p: pTok(p) },
				});
			}
		}
		return out;
	}

	for (const p of ctx.players) {
		if (
			p.value < ctx.star ||
			hasActiveTradeRequest(p) ||
			p.gamesUntilTradable > 0
		) {
			continue;
		}
		const sum = await ctx.moodSum(p);
		const gap = sum - TRADE_REQUEST_MOOD;
		if (gap > 2.5) {
			continue;
		}
		// Each weekly check an eligible star asks out with some chance, so one already past the line usually does within weeks
		const raw =
			requestsOn && inSeason ? (gap <= 0 ? 0.5 : gap <= 1 ? 0.2 : 0.1) : 0.06;
		out.push({
			type: "unhappy",
			tids: [p.tid],
			pids: [p.pid],
			fromTid: p.tid,
			until: { season: ctx.season, phase: PHASE.DRAFT_LOTTERY },
			untilTick: undefined,
			user: ctx.aiSet.has(p.tid) ? undefined : true,
			raw,
			weight: (gap <= 0 ? 3 : 1) * Math.max(1, p.value - 40),
			text: { t0: tokTeam(p.tid), p: pTok(p) },
		});
	}
	return out;
};

// AI teams extend good players in the last season of their contracts who are willing to stay
const gatherExtension = async (ctx: Ctx): Promise<Draft[]> => {
	const out: Draft[] = [];
	if (!featureOn("contractExtensions") || ctx.phase !== PHASE.REGULAR_SEASON) {
		return out;
	}
	const salaryCapType = g.get("salaryCapType");
	for (const info of ctx.need.infos) {
		let rank = 0;
		for (const p of (ctx.byTid.get(info.tid) ?? []).slice(0, 7)) {
			const contract = getCurrentContract(p);
			if (
				!contract ||
				getContractExp(contract) !== ctx.season ||
				ctx.season - p.born.year > 31 ||
				getExtensionIneligibleReason(p, info.tid) !== undefined
			) {
				continue;
			}
			const demand = getExtensionDemand(p, contract);
			const mood = await moodInfo(p, info.tid, {
				contractAmount: demand.amount,
			});
			if (!mood.willing) {
				continue;
			}
			// Teams don't extend into the luxury tax or over a hard cap (roughly: this season's payroll plus the raise)
			const after =
				info.payroll -
				getContractSummaryOrThrow(p).amount +
				mood.contractAmount;
			const blocked =
				(salaryCapType === "hard" && after > g.get("salaryCap")) ||
				(salaryCapType === "soft" && after > g.get("luxuryPayroll"));
			// 5% of teams look at their expiring players each day, and sign the first one they can
			const perDay = 0.05 / (1 + rank);
			const raw = blocked
				? 0.08
				: 0.85 * (1 - (1 - perDay) ** Math.max(5, ctx.daysToDeadline));
			rank += 1;
			out.push({
				type: "extension",
				// Over the tax or a hard cap: a different bet, calibrated on its own
				kind: blocked ? "blocked" : undefined,
				tids: [info.tid],
				pids: [p.pid],
				fromTid: info.tid,
				exp: getContractExp(contract),
				until: { season: ctx.season, phase: PHASE.AFTER_TRADE_DEADLINE },
				raw,
				weight: Math.max(1, p.value - 40) * (blocked ? 0.3 : 1),
				text: { t0: tokTeam(info.tid), p: pTok(p) },
			});
		}
	}
	return out;
};

// Where the best free agents are headed, from the free agent market (each AI team's top target, next in line and fallback)
const gatherFreeAgent = async (ctx: Ctx): Promise<Draft[]> => {
	const out: Draft[] = [];
	const freeAgents = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER_FREE_AGENT,
	);
	if (freeAgents.length === 0) {
		return out;
	}
	const market = await getFreeAgentMarket(freeAgents);
	const sorted = freeAgents.toSorted((a, b) => b.value - a.value).slice(0, 25);
	// A free agent rumor made in free agency can come true until the next regular season starts
	const until: RumorMoment =
		ctx.phase >= PHASE.DRAFT_LOTTERY
			? { season: ctx.season + 1, phase: PHASE.REGULAR_SEASON }
			: ctx.phase === PHASE.PRESEASON
				? { season: ctx.season, phase: PHASE.REGULAR_SEASON }
				: { season: ctx.season, phase: PHASE.PLAYOFFS };
	for (const p of sorted) {
		const info = market[p.pid];
		if (!info || info.teams.length === 0) {
			continue;
		}
		const total = info.teams.reduce((sum, t) => sum + t.probPerDay, 0);
		const first = info.teams[0]!;
		const second = info.teams[1];
		const weight = Math.max(1, p.value - 35);
		// His chance to end up with a team is its share of the interest, less the chance the market moves on first
		const share =
			(first.probPerDay / total) * (first.tier === "topTarget" ? 0.55 : 0.3);
		out.push({
			type: "freeAgent",
			kind: "leaning",
			tids: [first.tid],
			pids: [p.pid],
			fromTid: -1,
			until,
			raw: share,
			weight,
			text: { t0: tokTeam(first.tid), p: pTok(p) },
		});
		if (second) {
			out.push({
				type: "freeAgent",
				kind: "finalists",
				tids: [first.tid, second.tid],
				pids: [p.pid],
				fromTid: -1,
				until,
				raw:
					((first.probPerDay + second.probPerDay) / total) *
					(first.tier === "topTarget" ? 0.6 : 0.35),
				weight: weight * 0.7,
				text: {
					t0: tokTeam(first.tid),
					t1: tokTeam(second.tid),
					p: pTok(p),
				},
			});
		}
	}
	return out;
};

const PLAYER_FREE_AGENT = -1;

// Head coaches of AI teams the owner is losing patience with
const gatherCoach = async (ctx: Ctx): Promise<Draft[]> => {
	const out: Draft[] = [];
	if (!staffEnabled() || ctx.phase > PHASE.PLAYOFFS) {
		return out;
	}
	const systems = coachSystemsEnabled();
	for (const tid of ctx.aiTids) {
		const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
		const c = coaches.find((row) => row.role === "head");
		if (!c) {
			continue;
		}
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			ctx.season,
			tid,
		]);
		const gp = ts ? helpers.getTeamSeasonGp(ts) : 0;
		if (!ts || gp < 10) {
			continue;
		}
		const pct = helpers.calcWinp(ts);
		const tenure = c.stats.filter(
			(row) => row.tid === tid && row.role === "head",
		).length;
		let fireProb = 0;
		if (c.contract.exp <= ctx.season) {
			// Expiring contract: he usually stays if the team is decent
			fireProb = pct >= 0.45 ? 0.2 : 0.6;
		} else if (systems) {
			const heat = await hotSeatNow(c);
			// He has to finish a season before the owner acts
			fireProb =
				heat > 0.5
					? Math.min(0.75, 1.5 * (heat - 0.5)) * (tenure >= 1 ? 1 : 0.6)
					: 0;
		} else if (tenure >= 1 && pct < 0.4) {
			fireProb = 0.5;
		} else if (pct < 0.3) {
			fireProb = 0.4;
		} else if (
			tenure >= 2 &&
			pct < 0.5 &&
			c.stats.slice(-2).every((row) => row.playoffRoundsWon < 0)
		) {
			fireProb = 0.3;
		}
		if (fireProb < 0.15) {
			continue;
		}
		out.push({
			type: "coach",
			tids: [tid],
			pids: [],
			cid: c.cid,
			until: { season: ctx.season, phase: PHASE.DRAFT_LOTTERY },
			raw: fireProb * 0.85,
			weight: fireProb,
			text: {
				t0: tokTeam(tid),
				who: tokCoach(c.cid, `${c.firstName} ${c.lastName}`),
			},
		});
	}
	return out;
};

// AI GMs whose job security, with the season in progress counted, would get them fired
const gatherGm = async (ctx: Ctx): Promise<Draft[]> => {
	const out: Draft[] = [];
	if (!gmEnabled() || ctx.phase > PHASE.PLAYOFFS) {
		return out;
	}
	for (const t of ctx.teams) {
		const gm = t.gm;
		if (!gm || !ctx.aiSet.has(t.tid)) {
			continue;
		}
		const ts = await idb.cache.teamSeasons.indexGet("teamSeasonsBySeasonTid", [
			ctx.season,
			t.tid,
		]);
		const gp = ts ? helpers.getTeamSeasonGp(ts) : 0;
		if (!ts || gp < 10) {
			continue;
		}
		// The season so far, projected to a full one, judged the way the owner will judge it after the playoffs (gm/index.ts)
		const scale = g.get("numGames") / gp;
		const fireProb = await projectedFireProb(t, ctx.teams, {
			season: ctx.season,
			won: ts.won * scale,
			lost: ts.lost * scale,
			tied: (ts.tied ?? 0) * scale,
			otl: (ts.otl ?? 0) * scale,
			playoffRoundsWon: ctx.phase === PHASE.PLAYOFFS ? ts.playoffRoundsWon : -1,
		});
		if (fireProb < 0.15) {
			continue;
		}
		out.push({
			type: "gm",
			tids: [t.tid],
			pids: [],
			gmid: gm.gmid,
			until: { season: ctx.season, phase: PHASE.DRAFT_LOTTERY },
			raw: fireProb * 0.8,
			weight: fireProb,
			text: {
				t0: tokTeam(t.tid),
				who: tokGm(t.tid, `${gm.firstName} ${gm.lastName}`),
			},
		});
	}
	return out;
};

// What AI teams with a first round pick need most (their roster, never the prospects' hidden ratings)
const gatherDraft = async (ctx: Ctx): Promise<Draft[]> => {
	const out: Draft[] = [];
	if (__SPORT !== "basketball" || ctx.phase > PHASE.DRAFT) {
		return out;
	}
	const picks = await idb.cache.draftPicks.indexGetAll(
		"draftPicksBySeason",
		ctx.season,
	);
	const groupOf: Record<string, string> = {
		Guard: "G",
		"Wing/forward": "F",
		Big: "C",
	};
	// How often a first round pick is a guard, wing or big
	const baseRate: Record<string, number> = { G: 0.42, F: 0.45, C: 0.25 };
	const byNeeds = featureOn("aiDraftNeeds");
	for (const tid of ctx.aiTids) {
		if (!picks.some((dp) => dp.round === 1 && dp.tid === tid)) {
			continue;
		}
		const needs = getTeamNeeds(ctx.byTid.get(tid) ?? []);
		const label = getNeedLabels(needs)[0];
		const group = label ? groupOf[label] : undefined;
		if (!group) {
			continue;
		}
		out.push({
			type: "draft",
			tids: [tid],
			pids: [],
			group,
			until: { season: ctx.season, phase: PHASE.AFTER_DRAFT },
			raw: baseRate[group]! + (byNeeds ? 0.08 : 0),
			weight: 1 + 5 * needs[group as "G" | "F" | "C"],
			text: { t0: tokTeam(tid), group },
		});
	}
	return out;
};

const GATHERERS: Record<RumorType, (ctx: Ctx) => Draft[] | Promise<Draft[]>> = {
	shopping: gatherShopping,
	interest: gatherInterest,
	pick: gatherPick,
	unhappy: gatherUnhappy,
	extension: gatherExtension,
	freeAgent: gatherFreeAgent,
	coach: gatherCoach,
	gm: gatherGm,
	draft: gatherDraft,
};

const resolveOne = async (
	r: Rumor,
	state: RumorState,
): Promise<{ status: "confirmed" | "busted"; outcome: string } | undefined> => {
	const at = now();
	const since: RumorMoment = { season: r.season, phase: r.phase };
	const expired =
		momentValue(at) >= momentValue(r.until) ||
		(r.untilTick !== undefined && state.tick >= r.untilTick);
	const confirmed = (outcome: string) => ({
		status: "confirmed" as const,
		outcome,
	});
	const busted = (outcome: string) => ({ status: "busted" as const, outcome });
	const p =
		r.pids[0] === undefined
			? undefined
			: await idb.cache.players.get(r.pids[0]);
	const fromTid = r.fromTid ?? -1;

	switch (r.type) {
		case "shopping": {
			if (!p || p.tid < 0) {
				return busted(
					p && p.tid === PLAYER_FREE_AGENT
						? "He became a free agent instead."
						: "He's out of the league.",
				);
			}
			if (tradedAway(p, fromTid, since)) {
				return confirmed(`Traded to the ${tokTeam(p.tid)}.`);
			}
			if (p.tid !== fromTid) {
				return busted(`He signed with the ${tokTeam(p.tid)} instead.`);
			}
			return expired ? busted("No trade.") : undefined;
		}
		case "interest": {
			const tid = r.tids[0]!;
			if (!p || p.tid < 0) {
				return busted("No deal.");
			}
			if (p.tid === tid && tradedAway(p, fromTid, since)) {
				return confirmed(`The ${tokTeam(tid)} traded for him.`);
			}
			if (p.tid !== fromTid) {
				return busted(`He went to the ${tokTeam(p.tid)} instead.`);
			}
			if (r.kind === "user") {
				const offer = g
					.get("aiTradeOffers")
					.find(
						(row) =>
							row.tid === tid &&
							row.teams[0].pids.includes(p.pid) &&
							(row.season > r.season ||
								(row.season === r.season && row.phase >= r.phase)),
					);
				if (offer) {
					return confirmed(`The ${tokTeam(tid)} made an offer for him.`);
				}
			}
			return expired ? busted("No deal.") : undefined;
		}
		case "pick": {
			const dp =
				r.dpid === undefined
					? undefined
					: await idb.cache.draftPicks.get(r.dpid);
			if (dp && dp.tid !== r.tids[0]) {
				return confirmed(`Traded to the ${tokTeam(dp.tid)}.`);
			}
			return !dp || expired ? busted("They kept the pick.") : undefined;
		}
		case "unhappy": {
			if (!p || p.tid === PLAYER_FREE_AGENT || p.tid < -1) {
				return p?.tid === PLAYER_FREE_AGENT
					? confirmed("He left as a free agent.")
					: busted("He's out of the league.");
			}
			if (r.kind === "holdout") {
				if (p.holdout?.season === r.season && p.holdout.tid === fromTid) {
					return confirmed("He held out.");
				}
				if (tradedAway(p, fromTid, since)) {
					return confirmed(`Traded to the ${tokTeam(p.tid)}.`);
				}
				return expired ? busted("He reported on time.") : undefined;
			}
			if (p.tid === fromTid && hasActiveTradeRequest(p)) {
				return confirmed("He asked to be traded.");
			}
			if (p.tid === fromTid && isHoldingOut(p)) {
				return confirmed("He held out.");
			}
			if (tradedAway(p, fromTid, since)) {
				return confirmed(`Traded to the ${tokTeam(p.tid)}.`);
			}
			if (p.tid !== fromTid) {
				return confirmed(`He left for the ${tokTeam(p.tid)}.`);
			}
			return expired ? busted("He stayed, and never asked out.") : undefined;
		}
		case "extension": {
			if (!p || p.tid !== fromTid) {
				return busted("No extension.");
			}
			const contract = getCurrentContract(p);
			if (
				contract &&
				(contract.extensions?.some((row) => row.season === r.season) ||
					(r.exp !== undefined && getContractExp(contract) > r.exp))
			) {
				return confirmed(`Extended through ${getContractExp(contract)}.`);
			}
			return expired ? busted("No extension.") : undefined;
		}
		case "freeAgent": {
			if (!p || p.tid < -1) {
				return busted("He's out of the league.");
			}
			if (p.tid >= 0) {
				return r.tids.includes(p.tid)
					? confirmed(`Signed with the ${tokTeam(p.tid)}.`)
					: busted(`He signed with the ${tokTeam(p.tid)} instead.`);
			}
			return expired ? busted("He's still unsigned.") : undefined;
		}
		case "coach": {
			const c =
				r.cid === undefined ? undefined : await idb.cache.coaches.get(r.cid);
			if (!c || c.tid !== r.tids[0]) {
				return confirmed("He's out as coach.");
			}
			return expired ? busted("He kept his job.") : undefined;
		}
		case "gm": {
			const t = await idb.cache.teams.get(r.tids[0]!);
			if (!t || t.gm?.gmid !== r.gmid) {
				return confirmed("He's out as general manager.");
			}
			return expired ? busted("He kept his job.") : undefined;
		}
		case "draft": {
			if (!expired) {
				return undefined;
			}
			const drafted = (
				await idb.cache.players.indexGetAll("playersByTid", [
					PLAYER_FREE_AGENT,
					Infinity,
				])
			)
				.filter(
					(row) =>
						row.draft.year === r.season &&
						row.draft.tid === r.tids[0] &&
						row.draft.round === 1,
				)
				.sort((a, b) => a.draft.pick - b.draft.pick);
			const first = drafted[0];
			if (!first) {
				return busted("They didn't make a first-round pick.");
			}
			const pos = first.ratings.at(-1)!.pos;
			const text = `They took ${pTok(first)} (${pos}) with pick ${first.draft.pick}.`;
			return posInDraftGroup(pos, r.group ?? "")
				? confirmed(text)
				: busted(text);
		}
	}
};

// Mark open rumors that came true or ran out. Returns whether anything changed
const resolveRumors = async (state: RumorState) => {
	let changed = false;
	const at = now();
	for (const r of state.items) {
		if (r.status !== "open") {
			continue;
		}
		const result = await resolveOne(r, state);
		if (result) {
			r.status = result.status;
			r.outcome = result.outcome;
			r.resolved = at;
			addToTally(state.stats, r, result.status);
			changed = true;
		}
	}
	return changed;
};

const teamName = (tid: number) => {
	const t = g.get("teamInfoCache")[tid];
	return t ? `${t.region} ${t.name}` : "???";
};

const notify = async (rumors: Rumor[]) => {
	if (
		rumors.length === 0 ||
		!featureOption<boolean>("rumorsNotify") ||
		local.autoPlayUntil ||
		g.get("spectator")
	) {
		return;
	}
	const url = helpers.leagueUrl(["rumors"]);
	for (const r of rumors) {
		await logEvent({
			type: "info",
			text: `Rumor: ${renderRumorText(r.text, teamName)} <a href="${url}">Rumors</a>`,
			saveToDb: false,
			tids: [g.get("userTid")],
		});
	}
};

const makeRumors = async (
	state: RumorState,
	count: number,
	random: () => number,
) => {
	const created: Rumor[] = [];
	if (count <= 0) {
		return created;
	}
	const ctx = await makeCtx();
	const weights = typeWeights(ctx.clock);
	const cache = new Map<RumorType, Draft[]>();
	const taken = takenKeys(state, ctx.season);
	const userTid = g.get("userTid");
	const userControlled = !ctx.aiSet.has(userTid);

	for (let i = 0; i < count; i++) {
		// A type with nothing to report passes its turn to another one
		const left = { ...weights };
		for (let attempt = 0; attempt < 4; attempt++) {
			const typeIndex = weightedIndex(
				RUMOR_TYPES.map((type) => left[type]),
				random,
			);
			if (typeIndex < 0) {
				break;
			}
			const type = RUMOR_TYPES[typeIndex]!;
			let drafts = cache.get(type);
			if (!drafts) {
				drafts = await GATHERERS[type](ctx);
				cache.set(type, drafts);
			}
			const open = drafts.filter(
				(draft) => !taken.has(rumorKey({ ...draft, type })),
			);
			const index = weightedIndex(
				open.map((draft) => draft.weight),
				random,
			);
			if (index < 0) {
				left[type] = 0;
				continue;
			}
			const { raw, weight: _weight, text, ...rest } = open[index]!;
			const confidence = calibrate(raw, state.stats, type, rest.kind);
			const templates = rumorTemplates({
				...text,
				type,
				kind: rest.kind,
				confidence,
			});
			const rumor: Rumor = {
				...rest,
				rid: state.nextRid,
				season: ctx.season,
				phase: ctx.phase,
				tick: state.tick,
				text: templates[Math.floor(random() * templates.length)]!,
				confidence,
				raw: Math.round(raw * 1000) / 1000,
				status: "open",
			};
			if (
				userControlled &&
				(rumor.user ||
					rumor.tids.includes(userTid) ||
					rumor.fromTid === userTid)
			) {
				rumor.user = true;
			}
			state.nextRid += 1;
			state.items.push(rumor);
			taken.add(rumorKey(rumor));
			created.push(rumor);
			break;
		}
	}
	return created;
};

// One step of the rumor mill: resolve what can be resolved, then (maybe) start new rumors
const run = async (event: "day" | "phase") => {
	if (!rumorsEnabled() || g.get("phase") < PHASE.PRESEASON) {
		return;
	}
	const state = getRumorState();
	state.tick += 1;
	const random = makeSeededRandom(
		mixSeed(state.seed, state.tick, event === "day" ? 1 : 2),
	);

	// Nothing in here may move the sim's random sequence
	const realRandom = Math.random;
	Math.random = random;
	let created: Rumor[] = [];
	try {
		await resolveRumors(state);
		const count =
			event === "day"
				? poisson(dailyRate(await clockNow()), random)
				: phaseBurst(g.get("phase"));
		created = await makeRumors(state, count, random);
		pruneRumors(state, g.get("season"));
	} finally {
		Math.random = realRandom;
	}

	await league.setGameAttributes({ rumors: state });
	await notify(created.filter((r) => r.user));
};

// The clock without the rest of the context, so a day with no new rumors costs next to nothing
const clockNow = async (): Promise<RumorClock> => {
	const phase = g.get("phase");
	let seasonProgress = 0;
	if (phase >= PHASE.REGULAR_SEASON && phase <= PHASE.PLAYOFFS) {
		const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
			"teamSeasonsBySeasonTid",
			[[g.get("season")], [g.get("season"), "Z"]],
		);
		let gp = 0;
		for (const ts of teamSeasons) {
			gp += helpers.getTeamSeasonGp(ts);
		}
		seasonProgress =
			teamSeasons.length > 0 ? gp / teamSeasons.length / g.get("numGames") : 0;
	}
	return {
		phase,
		seasonProgress,
		tradeDeadline: g.get("tradeDeadline"),
		daysLeft: g.get("daysLeft"),
	};
};

const safely = async (event: "day" | "phase") => {
	try {
		await run(event);
	} catch (error) {
		// Background flavor: a bug here must not stop the season
		console.error("Error in rumors", error);
	}
};

// After each day of games or free agency
export const afterDay = () => safely("day");

// After a phase change (the new phase is set)
export const atPhase = () => safely("phase");

export default {
	afterDay,
	atPhase,
	getRumorState,
	rumorsEnabled,
};
