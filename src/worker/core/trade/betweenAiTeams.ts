import { idb } from "../../db/index.ts";
import { g, helpers, local } from "../../util/index.ts";
import isUntradable from "./isUntradable.ts";
import makeItWork, { withStartingProtections } from "./makeItWork.ts";
import processTrade from "./processTrade.ts";
import summary from "./summary.ts";
import type { Player, TradeTeams } from "../../../common/types.ts";
import { choice } from "../../../common/random.ts";
import { getTradePickConditions } from "../../../common/draftPickConditions.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import { getContractSummaryOrThrow } from "../contract/index.ts";
import getPayrolls from "../team/getPayrolls.ts";
import {
	capSpace,
	getBuyerProtected,
	getKindWeights,
	getRationale,
	getSalaryDumpCandidates,
	getSalaryFillerPids,
	getVeteranCandidates,
	isBuyer,
	isSeller,
	pickKind,
	wantsToDumpSalary,
	type CandidatePlayer,
	type NeedContext,
	type NeedTradeKind,
	type TeamNeedInfo,
} from "./aiNeeds.ts";

export const getAITids = async () => {
	const teams = await idb.cache.teams.getAll();
	return teams
		.filter((t) => {
			if (t.disabled) {
				return false;
			}

			if (
				(local.autoPlayUntil || g.get("spectator")) &&
				!g.get("challengeNoTrades")
			) {
				return true;
			}
			return !g.get("userTids").includes(t.tid);
		})
		.map((t) => t.tid);
};

const attempt = async (valueChangeCalculator: ValueChangeCalculator) => {
	const aiTids = await getAITids();

	if (aiTids.length === 0) {
		return false;
	}

	const tid = choice(aiTids);
	const otherTids = aiTids.filter((tid2) => tid !== tid2);

	if (otherTids.length === 0) {
		return false;
	}

	const otherTid = choice(otherTids);
	const players = (
		await idb.cache.players.indexGetAll("playersByTid", tid)
	).filter((p) => !isUntradable(p).untradable);
	const draftPicks = await idb.cache.draftPicks.indexGetAll(
		"draftPicksByTid",
		tid,
	);

	if (players.length === 0 && draftPicks.length === 0) {
		return false;
	}

	const r = Math.random();
	const pids: number[] = [];
	const dpids: number[] = [];

	if ((r < 0.7 || draftPicks.length === 0) && players.length > 0) {
		// Weight by player value - good player more likely to be in trade
		const p = choice(players, (p) => p.value);
		if (!p) {
			return false;
		}
		pids.push(p.pid);
	} else if ((r < 0.85 || players.length === 0) && draftPicks.length > 0) {
		dpids.push(choice(draftPicks).dpid);
	} else {
		// Weight by player value - good player more likely to be in trade
		const p = choice(players, (p) => p.value);
		const dp = choice(draftPicks);
		if (!p || !dp) {
			return false;
		}
		pids.push(p.pid);
		dpids.push(dp.dpid);
	}

	const teams0: TradeTeams = [
		{
			dpids,
			dpidsExcluded: [],
			pids,
			pidsExcluded: [],
			tid,
		},
		{
			dpids: [],
			dpidsExcluded: [],
			pids: [],
			pidsExcluded: [],
			tid: otherTid,
		},
	];

	const teams = await makeItWork(await withStartingProtections(teams0), {
		holdUserConstant: false,
		maxAssetsToAdd: 5,
		valueChangeCalculator,
		aiPickConditions: true,
	});

	if (!teams) {
		return false;
	}

	// Don't do trades of just picks, it's weird usually
	if (teams[0].pids.length === 0 && teams[1].pids.length === 0) {
		return false;
	}

	// Don't do trades for nothing, it's weird usually
	if (teams[1].pids.length === 0 && teams[1].dpids.length === 0) {
		return false;
	}

	const tradeSummary = await summary(teams);

	if (tradeSummary.warning) {
		return false;
	}

	// Make sure this isn't a really shitty trade
	const dv2 = await valueChangeCalculator.evaluate({
		tid: teams[0].tid,
		pidsAdd: teams[1].pids,
		pidsRemove: teams[0].pids,
		dpidsAdd: teams[1].dpids,
		dpidsRemove: teams[0].dpids,
		tradingPartnerTid: undefined,
		pickConditions: getTradePickConditions(teams),
	});
	if (Math.abs(dv2) > 15) {
		return false;
	}

	const finalTids: [number, number] = [teams[0].tid, teams[1].tid];
	await processTrade(teams, undefined);

	return finalTids;
};

const getTeamName = (tid: number) => {
	const t = g.get("teamInfoCache")[tid];
	return t ? `${t.region} ${t.name}` : "???";
};

export const getNeedInfo = async (aiTids: number[]) => {
	const teams = (await idb.cache.teams.getAll()).filter((t) =>
		aiTids.includes(t.tid),
	);
	const payrolls = await getPayrolls();
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[g.get("season")], [g.get("season"), "Z"]],
	);

	let gpSum = 0;
	const infos: TeamNeedInfo[] = teams.map((t) => {
		const teamSeason = teamSeasons.find((ts) => ts.tid === t.tid);
		const gp = teamSeason ? helpers.getTeamSeasonGp(teamSeason) : 0;
		gpSum += gp;
		return {
			tid: t.tid,
			strategy: t.strategy,
			payroll: payrolls[t.tid] ?? 0,
			winp: teamSeason && gp > 0 ? helpers.calcWinp(teamSeason) : undefined,
		};
	});

	const ctx: NeedContext = {
		phase: g.get("phase"),
		seasonProgress:
			infos.length > 0 ? gpSum / infos.length / g.get("numGames") : 0,
		tradeDeadline: g.get("tradeDeadline"),
		salaryCap: g.get("salaryCap"),
		luxuryPayroll: g.get("luxuryPayroll"),
		salaryCapType: g.get("salaryCapType"),
	};

	return { infos, ctx };
};

const toCandidates = (players: Player[]): CandidatePlayer[] =>
	players.map((p) => {
		const contract = getContractSummaryOrThrow(p);
		return {
			pid: p.pid,
			age: g.get("season") - p.born.year,
			value: p.value,
			contractAmount: contract.amount,
			contractExp: contract.exp,
		};
	});

const getSalaryFiller = ({
	incoming,
	payroll,
	candidates,
}: {
	incoming: number;
	payroll: number;
	candidates: CandidatePlayer[];
}) =>
	getSalaryFillerPids({
		incoming,
		payroll,
		candidates,
		salaryCap: g.get("salaryCap"),
		salaryCapType: g.get("salaryCapType"),
		softCapTradeSalaryMatch: g.get("softCapTradeSalaryMatch"),
	});

const emptyTeam = (tid: number) => ({
	dpids: [],
	dpidsExcluded: [],
	pids: [],
	pidsExcluded: [],
	tid,
});

// Build a trade (not yet processed) driven by a team need. Returns undefined if no sensible trade was found
export const needAttempt = async (
	valueChangeCalculator: ValueChangeCalculator = new ValueChangeCalculator({
		quick: true,
	}),
	aiTids: number[],
	forceKind?: NeedTradeKind,
	failures?: string[],
) => {
	// Record why no trade happened, for debugging and tests
	const fail = (reason: string) => {
		failures?.push(reason);
		return undefined;
	};

	const { infos, ctx } = await getNeedInfo(aiTids);
	const kind = forceKind ?? pickKind(getKindWeights(infos, ctx), Math.random());
	if (!kind) {
		return fail("noKind");
	}

	let teams0: TradeTeams;
	let mainTid: number;
	let otherTid: number;
	let salary: number | undefined;
	let holdUserConstant: boolean;

	if (kind === "deadlineBuy" || kind === "rebuildSell") {
		const sellers = infos.filter((t) => isSeller(t, ctx));
		// Better teams are more eager to buy
		const buyers = infos.filter((t) => isBuyer(t));
		const seller = choice(sellers);
		const buyer = choice(
			buyers.filter((t) => t.tid !== seller?.tid),
			(t) => (t.winp ?? 0.5) ** 2,
		);
		if (!seller || !buyer) {
			return fail("noSellerOrBuyer");
		}

		const sellerPlayers = (
			await idb.cache.players.indexGetAll("playersByTid", seller.tid)
		).filter((p) => !isUntradable(p).untradable);
		const vets = getVeteranCandidates(toCandidates(sellerPlayers));
		const vet = choice(vets, (p) => p.value);
		if (!vet) {
			return fail("noVeteran");
		}

		const buyerPlayers = (
			await idb.cache.players.indexGetAll("playersByTid", buyer.tid)
		).filter((p) => !isUntradable(p).untradable);
		const protectedPids = getBuyerProtected(toCandidates(buyerPlayers));

		// A buyer over the cap has to send salary back
		const fillerPids = getSalaryFiller({
			incoming: vet.contractAmount,
			payroll: buyer.payroll,
			candidates: toCandidates(buyerPlayers).filter(
				(p) => !protectedPids.has(p.pid),
			),
		});
		if (!fillerPids) {
			return fail("noSalaryFiller");
		}

		mainTid = seller.tid;
		otherTid = buyer.tid;
		holdUserConstant = true;
		teams0 = [
			{ ...emptyTeam(seller.tid), pids: [vet.pid] },
			{
				...emptyTeam(buyer.tid),
				pids: fillerPids,
				pidsExcluded: Array.from(protectedPids),
			},
		];
	} else {
		const dumpers = infos.filter((t) => wantsToDumpSalary(t, ctx));
		const dumper = choice(dumpers);
		if (!dumper) {
			return fail("noDumper");
		}

		const dumperPlayers = (
			await idb.cache.players.indexGetAll("playersByTid", dumper.tid)
		).filter((p) => !isUntradable(p).untradable);
		const candidates = getSalaryDumpCandidates(
			toCandidates(dumperPlayers),
			g.get("season"),
			g.get("minContract"),
			g.get("maxContract"),
		).slice(0, 3);
		const p = choice(candidates);
		if (!p) {
			return fail("noDumpCandidate");
		}

		// Receiving team needs room for the whole contract
		const receivers = infos.filter(
			(t) => t.tid !== dumper.tid && capSpace(t, ctx) >= p.contractAmount,
		);
		const receiver = choice(receivers, (t) =>
			t.strategy === "rebuilding" ? 2 : 1,
		);
		if (!receiver) {
			return fail("noReceiver");
		}

		// Receiving team gives nothing back, the dumping team adds sweeteners
		const receiverPlayers = await idb.cache.players.indexGetAll(
			"playersByTid",
			receiver.tid,
		);
		const receiverPicks = await idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			receiver.tid,
		);

		mainTid = dumper.tid;
		otherTid = receiver.tid;
		salary = p.contractAmount;
		holdUserConstant = false;
		// Sweeteners are draft picks, not more players, which would just eat up the receiving team's cap space
		teams0 = [
			{
				...emptyTeam(dumper.tid),
				pids: [p.pid],
				pidsExcluded: dumperPlayers
					.filter((p2) => p2.pid !== p.pid)
					.map((p2) => p2.pid),
			},
			{
				...emptyTeam(receiver.tid),
				pidsExcluded: receiverPlayers.map((p) => p.pid),
				dpidsExcluded: receiverPicks.map((dp) => dp.dpid),
			},
		];
	}

	const teams = await makeItWork(teams0, {
		holdUserConstant,
		maxAssetsToAdd: 4,
		valueChangeCalculator,
		aiPickConditions: true,
	});
	if (!teams) {
		return fail("makeItWorkFailed");
	}

	if (
		kind !== "salaryDump" &&
		teams[1].pids.length + teams[1].dpids.length === 0
	) {
		return fail("nothingInReturn");
	}

	const tradeSummary = await summary(teams);
	if (tradeSummary.warning) {
		return fail("salaryCapWarning");
	}

	// The main team needs to be OK with this too. A salary dump is allowed to cost some value, that's the point of it
	const dvMain = await valueChangeCalculator.evaluate({
		tid: teams[0].tid,
		pidsAdd: teams[1].pids,
		pidsRemove: teams[0].pids,
		dpidsAdd: teams[1].dpids,
		dpidsRemove: teams[0].dpids,
		tradingPartnerTid: undefined,
		pickConditions: getTradePickConditions(teams),
	});
	if (dvMain < (kind === "salaryDump" ? -4 : -1)) {
		return fail("mainTeamRejects");
	}

	const names = [];
	for (const pid of teams[0].pids) {
		const p = await idb.cache.players.get(pid);
		if (p) {
			names.push(`${p.firstName} ${p.lastName}`);
		}
	}
	let numYoungPlayers = 0;
	for (const pid of teams[1].pids.length > 0 ? teams[1].pids : []) {
		const p = await idb.cache.players.get(pid);
		if (p && g.get("season") - p.born.year <= 25) {
			numYoungPlayers += 1;
		}
	}

	// For a salary dump, the "return" is what the dumping team attached
	const returnTo =
		kind === "salaryDump"
			? {
					numPlayers: teams[0].pids.length - 1,
					numYoungPlayers: 0,
					numPicks: teams[0].dpids.length,
				}
			: {
					numPlayers: teams[1].pids.length,
					numYoungPlayers,
					numPicks: teams[1].dpids.length,
				};

	const note = getRationale({
		kind,
		mainTeam: getTeamName(mainTid),
		otherTeam: getTeamName(otherTid),
		playerNames: names.slice(0, kind === "salaryDump" ? 1 : names.length),
		returnTo,
		salary,
	});

	return { kind, teams, note };
};

// Share of AI-to-AI trade attempts that are need-driven, when that setting is enabled
const NEED_ATTEMPT_SHARE = 0.5;

const DEFAULT_NUM_TEAMS = 30;

const betweenAiTeams = async () => {
	if (g.get("forceHistoricalRosters")) {
		return false;
	}

	// If aiTradesFactor is not an integer, use the fractional part as a probability. Like for 3.5, 50% of the times it will be 3, and 50% will be 4.
	// Also scale so there are fewer trade attempts if there are fewer teams.
	let float = g.get("aiTradesFactor");
	if (__SPORT === "baseball") {
		float *= 0.25;
	}
	if (g.get("numActiveTeams") < DEFAULT_NUM_TEAMS) {
		float *= g.get("numActiveTeams") / DEFAULT_NUM_TEAMS;
	}
	let numAttempts = Math.floor(float);
	const remainder = float % 1;
	if (remainder > 0 && Math.random() < remainder) {
		numAttempts += 1;
	}

	if (numAttempts > 0) {
		// This runs every day when simulating games, so it needs to be fast
		const valueChangeCalculator = new ValueChangeCalculator({ quick: true });

		for (let i = 0; i < numAttempts; i++) {
			let tradeTids: number[] | false | undefined;
			if (g.get("aiTradesNeedBased") && Math.random() < NEED_ATTEMPT_SHARE) {
				const aiTids = await getAITids();
				const result = await needAttempt(valueChangeCalculator, aiTids);
				if (result) {
					tradeTids = [result.teams[0].tid, result.teams[1].tid];
					await processTrade(result.teams, undefined, { note: result.note });
				}
			} else {
				tradeTids = await attempt(valueChangeCalculator);
			}
			if (tradeTids) {
				// Don't need to recompute draft pick value
				valueChangeCalculator.invalidateCache({ teams: tradeTids });
			}
		}
	}
};

export default betweenAiTeams;
