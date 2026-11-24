import { featureOn } from "../../util/nativeFeatures.ts";
import { PHASE, PLAYER, POSITION_COUNTS } from "../../../common/constants.ts";
import {
	contractNegotiation,
	draft,
	league,
	player,
	team,
	freeAgents,
} from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local, logEvent } from "../../util/index.ts";
import { userRunsTeam } from "../../util/userRunsTeam.ts";
import type { Conditions, PhaseReturn } from "../../../common/types.ts";
import {
	getContractDemand,
	getContractSummaryOrThrow,
} from "../contract/index.ts";
import { last, orderBy } from "../../../common/utils.ts";
import { getNumPlayersTradedAwayNormalizedAll } from "../player/getNumPlayersTradedAwayNormalized.ts";
import { bySport } from "../../../common/sportFunctions.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import { autoPlayStopsAt } from "../league/autoPlay.ts";
import { getAllGmWeights } from "../gm/index.ts";
import * as college from "../college/index.ts";
import { careerAgingOn, usefulVeteran } from "../player/careerAging.ts";
import type { Player } from "../../../common/types.ts";

// Career Aging: would this expiring veteran be in his team's top 13 for next season, and does he take the minimum from it?
const keepVeteranOnMinimum = async (p: Player, payroll: number | undefined) => {
	const t = await idb.cache.teams.get(p.tid);
	if (!t) {
		return false;
	}
	const minContract = g.get("minContract");
	if (
		g.get("salaryCapType") === "hard" &&
		(payroll === undefined || payroll + minContract > g.get("salaryCap"))
	) {
		return false;
	}
	const season = g.get("season");
	const roster = (
		await idb.cache.players.indexGetAll("playersByTid", p.tid)
	).filter(
		(p2) => p2.pid !== p.pid && getContractSummaryOrThrow(p2).exp > season,
	);
	if (roster.length >= g.get("maxRosterSize")) {
		return false;
	}
	if (
		!usefulVeteran(
			p,
			roster.map((p2) => p2.value),
			t.strategy,
		)
	) {
		return false;
	}
	const mood = await player.moodInfo(p, p.tid, { contractAmount: minContract });
	return mood.willing;
};

export const FREE_AGENCY_DAYS = 30;

// With a soft cap or no cap, AI teams only re-sign their best AVOID_TAX_MIN_RANK players (by value) into the luxury tax
const AVOID_TAX_MIN_RANK = 3;

// Figure out how many players are needed at each position, beyond who is already signed
type PositionInfo = Record<
	string,
	{
		count: number;
		maxValue: number;
	}
>;

type AiResignContext = {
	positionInfoByTid: Map<number, PositionInfo>;
	payrollsByTid: Map<number, number>;
	avoidTax: boolean;
	avoidTaxMinRank: number;
	teamValueRank: Map<number, number>;
	gms: Awaited<ReturnType<typeof getAllGmWeights>>;
	valueChangeCalculator: ValueChangeCalculator;
	numPlayersTradedAwayNormalized: Record<number, number>;
};

// The team state the AI re-sign decisions read: players are everyone on the teams in tids (expiring included), expiringPids
// who is up for a new deal. Payrolls are read now, so build this before anyone in expiringPids is re-signed
const makeAiResignContext = async (
	players: Player[],
	expiringPids: Set<number>,
	tids: number[],
	numPlayersTradedAwayNormalized: Record<number, number>,
): Promise<AiResignContext> => {
	const positionInfoByTid = new Map<number, PositionInfo>();

	if (Object.keys(POSITION_COUNTS).length > 0) {
		for (const tid of tids) {
			const positionInfo: PositionInfo = {};
			for (const [pos, count] of Object.entries(POSITION_COUNTS)) {
				positionInfo[pos] = {
					count,
					maxValue: 0,
				};
			}
			positionInfoByTid.set(tid, positionInfo);
		}

		for (const p of players) {
			// Only expiring contracts and hard cap rookies!
			if (expiringPids.has(p.pid)) {
				continue;
			}

			const positionInfo = positionInfoByTid.get(p.tid);
			const pos = last(p.ratings).pos;

			if (positionInfo !== undefined && positionInfo[pos] !== undefined) {
				positionInfo[pos].count -= 1;
				if (p.value > positionInfo[pos].maxValue) {
					positionInfo[pos].maxValue = p.value;
				}
			}
		}
	}

	const payrollsByTid = new Map<number, number>();

	// Soft cap or no cap: AI teams don't re-sign role players into the luxury tax (cap health). Stars still get re-signed. With no cap the
	// tax is the only brake, and without this payrolls ran away (half the league in the tax, a team 2x the cap and $400M in debt)
	const avoidTax = g.get("salaryCapType") !== "hard" && g.get("luxuryTax") > 0;
	// Competitive Balance (setting): only the two best go into the tax
	// League Parity (setting): only the best one
	const avoidTaxMinRank = featureOn("parityBalance")
		? 1
		: featureOn("competitiveBalance")
			? AVOID_TAX_MIN_RANK - 1
			: AVOID_TAX_MIN_RANK;
	const teamValueRank = new Map<number, number>();
	if (avoidTax) {
		const byTid = Map.groupBy(players, (p) => p.tid);
		for (const teamPlayers of byTid.values()) {
			for (const [i, p] of teamPlayers
				.toSorted((a, b) => b.value - a.value)
				.entries()) {
				teamValueRank.set(p.pid, i);
			}
		}
	}

	if (g.get("salaryCapType") === "hard" || avoidTax) {
		for (const tid of tids) {
			// Payroll for next season, so it doesn't include expiring contracts or unsigned draft picks. Explicit season because the phase isn't updated to RESIGN_PLAYERS until after newPhaseResignPlayers, so the default payroll season would still be this season.
			payrollsByTid.set(tid, await team.getPayroll(tid, g.get("season") + 1));
		}
	}

	return {
		positionInfoByTid,
		payrollsByTid,
		avoidTax,
		avoidTaxMinRank,
		teamValueRank,
		// AI GM personalities (setting): tax tolerance moves how deep into the roster a team re-signs into the luxury tax. Empty when off
		gms: await getAllGmWeights(),
		valueChangeCalculator: new ValueChangeCalculator(),
		numPlayersTradedAwayNormalized,
	};
};

// Rookies first, then by value, team by team
const orderExpiring = (players: Player[]) =>
	orderBy(
		players,
		[
			"tid",
			(p) => {
				return p.draft.year === g.get("season") ? 1 : -1;
			},
			"value",
		],
		["asc", "desc", "desc"],
	).map((p) => p.pid);

/**
 * The AI's re-signing decision for one expiring player, still on his team: re-sign him (his demand, or a Career Aging minimum
 * deal) or send him to free agency. Used for AI teams when the phase starts, and for a user team the AI takes over during the
 * phase (spectator mode or auto play turned on with re-signing negotiations still open).
 */
export const aiResignPlayer = async (ctx: AiResignContext, p: Player) => {
	const contractDemand = getContractDemand(p);

	const draftPick = p.draft.year === g.get("season");

	if (draftPick && !g.get("draftPickAutoContract")) {
		contractDemand.amount /= 2;

		if (contractDemand.amount < g.get("minContract")) {
			contractDemand.amount = g.get("minContract");
		} else {
			contractDemand.amount = helpers.roundContract(contractDemand.amount);
		}

		contractDemand.rookie = true;
	}

	let reSignPlayer = true;

	const contract = {
		...contractDemand,
	};
	const payroll = ctx.payrollsByTid.get(p.tid);

	const positionInfo = ctx.positionInfoByTid.get(p.tid);
	const pos = last(p.ratings).pos;

	if (g.get("salaryCapType") === "hard") {
		if (payroll === undefined) {
			throw new Error(
				"Payroll should always be defined if there is a hard cap",
			);
		}
		if (contract.amount + payroll > g.get("salaryCap")) {
			reSignPlayer = false;
		}

		// Don't go beyond roster needs by position
		if (
			bySport({
				baseball: true,
				basketball: false,
				football: true,
				hockey: true,
			}) &&
			positionInfo !== undefined &&
			positionInfo[pos] !== undefined &&
			positionInfo[pos].count <= 0 &&
			positionInfo[pos].maxValue > p.value
		) {
			reSignPlayer = false;
		}

		// Always sign rookies
		if (draftPick) {
			reSignPlayer = true;
		}
	}

	if (
		ctx.avoidTax &&
		!draftPick &&
		payroll !== undefined &&
		contract.amount + payroll > g.get("luxuryPayroll") &&
		(ctx.teamValueRank.get(p.pid) ?? 0) >=
			ctx.avoidTaxMinRank + (ctx.gms.get(p.tid)?.avoidTaxRankShift ?? 0)
	) {
		reSignPlayer = false;
	}

	// AI GM personalities: a tax-averse GM only pays his best players over the salary cap
	if (
		ctx.avoidTax &&
		g.get("salaryCapType") === "soft" &&
		!draftPick &&
		payroll !== undefined &&
		contract.amount + payroll > g.get("salaryCap") &&
		(ctx.teamValueRank.get(p.pid) ?? 0) >=
			(ctx.gms.get(p.tid)?.overCapResignRank ?? Infinity)
	) {
		reSignPlayer = false;
	}

	if (reSignPlayer) {
		const mood = await player.moodInfo(p, p.tid, {
			contractAmount: contractDemand.amount,
		});

		// Player must be willing to sign (includes draft picks and first year after expansion, from moodInfo)
		if (!mood.willing) {
			reSignPlayer = false;
		} else {
			// Is team better off without him?
			const dv = await ctx.valueChangeCalculator.evaluate({
				tid: p.tid,
				pidsAdd: [],
				pidsRemove: [p.pid],
				dpidsAdd: [],
				dpidsRemove: [],
				tradingPartnerTid: undefined,
			});

			// Skip re-signing some low value players, otherwise teams fill up their rosters too readily. A big spender (AI GM
			// personalities) keeps his (same random draws either way)
			const skipBadPlayer =
				contract.amount < g.get("minContract") * 2 &&
				Math.random() < 0.5 &&
				(ctx.gms.get(p.tid)?.avoidTaxRankShift ?? 0) < 2;

			// More randomness if hard cap
			const whatever =
				g.get("salaryCapType") === "hard" ? Math.random() > 0.1 : true;

			if (draftPick || (mood.willing && dv < 0 && !skipBadPlayer && whatever)) {
				await player.sign(p, p.tid, contract, PHASE.RESIGN_PLAYERS);

				if (positionInfo !== undefined && positionInfo[pos] !== undefined) {
					positionInfo[pos].count -= 1;
					if (p.value > positionInfo[pos].maxValue) {
						positionInfo[pos].maxValue = p.value;
					}
				}

				if (payroll !== undefined) {
					ctx.payrollsByTid.set(p.tid, contract.amount + payroll);
				}

				// Need to recompute team value stuff now that a player was signed
				await ctx.valueChangeCalculator.invalidateCache({
					teams: [p.tid],
				});
			} else {
				reSignPlayer = false;
			}
		}
	}

	// Career Aging: a useful veteran his team let go is kept on a one season minimum deal (if he is willing)
	if (
		!reSignPlayer &&
		!draftPick &&
		careerAgingOn() &&
		(await keepVeteranOnMinimum(p, ctx.payrollsByTid.get(p.tid)))
	) {
		reSignPlayer = true;
		const minContract = g.get("minContract");
		await player.sign(
			p,
			p.tid,
			{ amount: minContract, exp: g.get("season") + 1 },
			PHASE.RESIGN_PLAYERS,
		);
		const payroll = ctx.payrollsByTid.get(p.tid);
		if (payroll !== undefined) {
			ctx.payrollsByTid.set(p.tid, payroll + minContract);
		}
		await ctx.valueChangeCalculator.invalidateCache({ teams: [p.tid] });
	}

	if (!reSignPlayer) {
		player.addToFreeAgents(p, ctx.numPlayersTradedAwayNormalized);
	}

	await idb.cache.players.put(p);
};

/**
 * The AI takes over a user team during RESIGN_PLAYERS (spectator mode turned on, or auto play started): his open re-signing
 * negotiations get the same decision an AI team's expiring players got when the phase started, instead of all walking at free
 * agency. Each player goes back on his team (where the AI path expects him) before the decision.
 */
export const aiResignNegotiations = async (tids: number[]) => {
	if (g.get("phase") !== PHASE.RESIGN_PLAYERS || college.isCollege()) {
		return 0;
	}

	const negotiations = (await idb.cache.negotiations.getAll()).filter(
		(negotiation) => negotiation.resigning && tids.includes(negotiation.tid),
	);
	if (negotiations.length === 0) {
		return 0;
	}

	const expiring: Player[] = [];
	for (const negotiation of negotiations) {
		await idb.cache.negotiations.delete(negotiation.pid);
		const p = await idb.cache.players.get(negotiation.pid);
		if (!p || p.tid !== PLAYER.FREE_AGENT) {
			continue;
		}
		p.tid = negotiation.tid;
		await idb.cache.players.put(p);
		expiring.push(p);
	}
	if (expiring.length === 0) {
		return 0;
	}

	const negotiationTids = Array.from(new Set(expiring.map((p) => p.tid)));
	const players: Player[] = [];
	for (const tid of negotiationTids) {
		players.push(...(await idb.cache.players.indexGetAll("playersByTid", tid)));
	}
	const ctx = await makeAiResignContext(
		players,
		new Set(expiring.map((p) => p.pid)),
		negotiationTids,
		await getNumPlayersTradedAwayNormalizedAll(),
	);

	for (const pid of orderExpiring(expiring)) {
		const p = await idb.cache.players.get(pid);
		if (p) {
			await aiResignPlayer(ctx, p);
		}
	}

	return expiring.length;
};

const newPhaseResignPlayers = async (
	conditions: Conditions,
): Promise<PhaseReturn> => {
	// College mode: this phase is the recruiting period before signing day
	if (college.isCollege()) {
		return college.newPhaseRecruiting(conditions);
	}

	// In case some weird situation results in games still in the schedule, clear them
	await idb.cache.schedule.clear();

	// Clear any negotiations that still somehow exist, except if it's a re-signing negotiation for the user, because that could be from a prior failed attempt to run this function and we want to keep those guys. (Would rather have phase updates be transactional, but oh well.)
	const existingNegotiations = await idb.cache.negotiations.getAll();
	const userTids = g.get("userTids");
	for (const negotiation of existingNegotiations) {
		if (negotiation.resigning && userTids.includes(negotiation.tid)) {
			continue;
		}

		await idb.cache.negotiations.delete(negotiation.pid);
	}

	const repeatSeasonType = g.get("repeatSeason")?.type;

	// Reset contract demands of current free agents and undrafted players
	// KeyRange only works because PLAYER.UNDRAFTED is -2 and PLAYER.FREE_AGENT is -1
	const existingFreeAgents = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.FREE_AGENT,
	);
	const undraftedPlayers =
		!repeatSeasonType && !g.get("forceHistoricalRosters")
			? (
					await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
						[g.get("season")],
						[g.get("season"), Infinity],
					])
				).filter((p) => p.tid === PLAYER.UNDRAFTED)
			: [];

	const numPlayersTradedAwayNormalized =
		await getNumPlayersTradedAwayNormalizedAll();
	const playersToMakeFreeAgents = [...existingFreeAgents, ...undraftedPlayers];
	for (const p of playersToMakeFreeAgents) {
		player.addToFreeAgents(p, numPlayersTradedAwayNormalized);
	}
	await idb.cache.players.putAll(playersToMakeFreeAgents);

	// Re-sign players on user's team, and some AI players
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);

	const expiringPlayers = players.filter(
		(p) => getContractSummaryOrThrow(p).exp <= g.get("season"),
	);
	const expiringPids = orderExpiring(expiringPlayers);

	const allTids = Array.from({ length: g.get("numTeams") }, (_, tid) => tid);
	// Built before demands are normalized (they'd make expiring contracts look like next season's)
	const aiContext = await makeAiResignContext(
		players,
		new Set(expiringPids),
		allTids,
		numPlayersTradedAwayNormalized,
	);

	await freeAgents.normalizeContractDemands({
		type: "includeExpiringContracts",
	});

	await contractNegotiation.cancelAll();

	for (const pid of expiringPids) {
		// Re-fetch players, because normalizeContractDemands might have changed some objects
		const p = await idb.cache.players.get(pid);
		if (!p) {
			continue;
		}

		if (
			userRunsTeam(p.tid) ||
			(g.get("userTids").includes(p.tid) &&
				!g.get("spectator") &&
				local.autoPlayUntil &&
				autoPlayStopsAt(
					local.autoPlayUntil,
					g.get("season"),
					PHASE.RESIGN_PLAYERS,
				))
		) {
			const tid = p.tid;

			player.addToFreeAgents(p, numPlayersTradedAwayNormalized);

			await idb.cache.players.put(p);
			const info = await contractNegotiation.create(p.pid, true, tid);

			if (typeof info === "string") {
				logEvent(
					{
						type: "refuseToSign",
						text: info,
						pids: [p.pid],
						tids: [tid],
					},
					conditions,
				);
			} else {
				await idb.cache.negotiations.add(info);
			}
		} else {
			await aiResignPlayer(aiContext, p);
		}
	}

	const draftProspects = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);

	if (repeatSeasonType === "players") {
		// Bump up age of draft prospects, so they stay the same
		for (const p of draftProspects) {
			p.draft.year += 1;
			p.born.year += 1;
			last(p.ratings).season += 1;
			await player.updateValues(p);
		}
		await idb.cache.players.putAll(draftProspects);
	} else {
		// Bump up future draft classes (not simultaneous so tid updates don't cause race conditions)
		for (const p of draftProspects) {
			if (p.draft.year !== g.get("season") + 1) {
				continue;
			}

			p.ratings[0].fuzz /= Math.sqrt(2);
			await player.develop(p, 0); // Update skills/pot based on fuzz

			await player.updateValues(p);
			await idb.cache.players.put(p);
		}

		for (const p of draftProspects) {
			if (p.draft.year !== g.get("season") + 2) {
				continue;
			}

			p.ratings[0].fuzz /= Math.sqrt(2);
			await player.develop(p, 0); // Update skills/pot based on fuzz

			await player.updateValues(p);
			await idb.cache.players.put(p);
		}

		// Fill the oldest new year to a full class, while leaving existing players in that draft class in place (stock behavior)
		await draft.genPlayers(g.get("season") + 3);

		// And any other missing upcoming classes, up to the numDraftClasses setting
		await draft.topUpDraftClasses(g.get("season"), PHASE.RESIGN_PLAYERS);
	}

	// Delete any old undrafted players that still somehow exist
	const toRemove = [];
	for (const p of draftProspects) {
		if (p.draft.year <= g.get("season")) {
			toRemove.push(p.pid);
		}
	}
	await player.remove(toRemove);

	// Set daysLeft here because this is "basically" free agency, so some functions based on daysLeft need to treat it that way (such as the trade AI being more reluctant)
	await league.setGameAttributes({
		daysLeft: FREE_AGENCY_DAYS,
	});

	return {
		redirect: {
			url: helpers.leagueUrl(["negotiation"]),
			text: "Re-sign players",
		},
		updateEvents: ["playerMovement"],
	};
};

export default newPhaseResignPlayers;
