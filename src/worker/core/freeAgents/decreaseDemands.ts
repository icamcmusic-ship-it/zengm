import { PHASE, PLAYER } from "../../../common/constants.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { getContractStartSeason } from "../../util/getContractStartSeason.ts";
import { getContractDemand } from "../contract/index.ts";
import type { Player } from "../../../common/types.ts";
import getPayroll from "../team/getPayroll.ts";
import {
	capExceptionsEnabled,
	getAiCapExceptionCapacity,
} from "../contract/capExceptions.ts";
import { getAllGmWeights } from "../gm/index.ts";

// After the season has already started, free agents ask for a short contract. Very cheap players ask for the shortest possible contract, everyone else asks for an extra season.
export const getInSeasonContractExp = (
	amount: number,
	contractStartSeason: number,
) => {
	if (amount < 1.34 * g.get("minContract")) {
		return contractStartSeason;
	}

	return contractStartSeason + 1;
};

// What the free agent market looks like for demands. A replacement-level player is the last man on a typical AI roster. Each AI team with an open roster spot can pay up to its cap space (unlimited with no salary cap), and the best free agents get the biggest cap spaces: the best one above replacement level can get the most cap space any team has, the second best the second most, and so on. AI teams over the cap only sign minimum contracts (with a hard cap nothing else is possible; with a soft cap and the Salary Cap Exceptions setting, a team's biggest unused exception counts like cap space), so a free agent who is below replacement level or asks for more than his share of cap space is "unwanted" and will sit unsigned unless he comes down.
export const getDemandMarket = async (freeAgents: Player[]) => {
	const salaryCap = g.get("salaryCap");
	const salaryCapType = g.get("salaryCapType");
	const maxRosterSize = g.get("maxRosterSize");
	const minRosterSize = g.get("minRosterSize");
	const userTids = g.get("userTids");

	const exceptions = capExceptionsEnabled();
	const gms = exceptions ? await getAllGmWeights() : undefined;

	const capSpaces: number[] = [];
	const lastManValues: number[] = [];
	const teams = await idb.cache.teams.getAll();
	for (const t of teams) {
		if (t.disabled) {
			continue;
		}
		const roster = await idb.cache.players.indexGetAll("playersByTid", t.tid);
		const values = roster.map((p) => p.value).sort((a, b) => b - a);
		const index = Math.min(values.length, minRosterSize) - 1;
		if (index >= 0) {
			lastManValues.push(values[index]!);
		}
		if (userTids.includes(t.tid) || roster.length >= maxRosterSize) {
			continue;
		}
		if (salaryCapType === "none") {
			capSpaces.push(Infinity);
		} else {
			const payroll = await getPayroll(t.tid);
			// Salary cap exceptions (setting): a team over the cap can still pay one free agent up to its biggest exception
			capSpaces.push(
				exceptions
					? Math.max(
							salaryCap - payroll,
							getAiCapExceptionCapacity(t, payroll, gms!.get(t.tid)),
						)
					: salaryCap - payroll,
			);
		}
	}
	capSpaces.sort((a, b) => b - a);
	lastManValues.sort((a, b) => a - b);
	const replacementValue =
		lastManValues.length > 0
			? lastManValues[Math.floor(lastManValues.length / 2)]!
			: -Infinity;

	const marketByPid = new Map<number, number>();
	const ranked = freeAgents
		.filter((p) => p.value >= replacementValue)
		.sort((a, b) => b.value - a.value);
	for (const [i, p] of ranked.entries()) {
		marketByPid.set(p.pid, Math.max(0, capSpaces[i] ?? 0));
	}

	// Most an AI team could pay him, 0 if none (only the minimum). With no salary cap, any team could pay any good player.
	const getMarket = (p: Player) =>
		salaryCapType === "none" && p.value >= replacementValue
			? Infinity
			: (marketByPid.get(p.pid) ?? 0);

	return {
		getMarket,
		replacementValue,
		unwanted: (p: Player) =>
			p.value < replacementValue || getContractDemand(p).amount > getMarket(p),
	};
};

// Fraction of what an unwanted free agent asks above the minimum that he gives up each day. Below replacement level in the regular season it's fast (from 5x the minimum to the minimum in about 5 days). A better player who's just priced out of the market holds out longer, and everyone is slower in free agency, since there's a month of it and teams still clear space.
const UNWANTED_DECAY = {
	belowReplacement: { regularSeason: 0.5, freeAgency: 0.12 },
	pricedOut: { regularSeason: 0.35, freeAgency: 0.08 },
};

/**
 * Decrease contract demands for all free agents.
 *
 * This is called after each day in the regular season, as free agents become more willing to take smaller contracts.
 *
 * @memberOf core.freeAgents
 * @return {Promise}
 */
const decreaseDemands = async () => {
	const players = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.FREE_AGENT,
	);

	const minContract = g.get("minContract");
	const contractStartSeason = getContractStartSeason();
	const minContractExp = contractStartSeason + g.get("minContractLength") - 1;
	const phase = g.get("phase");
	const inSeason =
		phase === PHASE.REGULAR_SEASON || phase === PHASE.AFTER_TRADE_DEADLINE;
	const market =
		inSeason || phase === PHASE.FREE_AGENCY
			? await getDemandMarket(players)
			: undefined;

	for (const p of players) {
		const contractDemand = getContractDemand(p);
		const unwanted = market?.unwanted(p) ?? false;

		const baseAmount = 50 * Math.sqrt(g.get("maxContract") / 20000);

		// 82 is purposely not defaultGameAttributes.numGames so it works across basketball and football
		const factor =
			g.get("phase") !== PHASE.FREE_AGENCY ? 82 / g.get("numGames") : 1;
		contractDemand.amount -= helpers.bound(
			baseAmount * factor,
			baseAmount,
			Infinity,
		);

		if (unwanted && market) {
			// Nobody is going to pay him this, so come down faster: give up a share of what he asks above the minimum each day
			const belowReplacement = p.value < market.replacementValue;
			const decay =
				UNWANTED_DECAY[belowReplacement ? "belowReplacement" : "pricedOut"][
					inSeason ? "regularSeason" : "freeAgency"
				];
			contractDemand.amount = Math.min(
				contractDemand.amount,
				minContract + (1 - decay) * (contractDemand.amount - minContract),
			);

			// Close enough, just take the minimum
			if (contractDemand.amount < minContract * 1.1) {
				contractDemand.amount = minContract;
			}
		}

		contractDemand.amount = helpers.roundContract(contractDemand.amount);

		if (unwanted && market && p.value >= market.replacementValue) {
			// A good player priced out of the market (asking for more than his share of AI teams' cap space) comes down only as far as what that team could pay. Not rounded, so he fits. But if that's barely more than the minimum, he just takes the minimum like anyone else close to it. Otherwise he'd sit a few thousand dollars above the minimum (like $1.205M with a $1.2M minimum), which over the cap teams can't sign since only exact minimum contracts are allowed over the cap.
			const marketAmount = market.getMarket(p);
			if (marketAmount >= minContract * 1.1) {
				contractDemand.amount = Math.max(
					contractDemand.amount,
					Math.floor(marketAmount),
				);
			}
		}

		if (contractDemand.amount < minContract) {
			contractDemand.amount = minContract;
		}

		if (phase !== PHASE.FREE_AGENCY) {
			contractDemand.exp = getInSeasonContractExp(
				contractDemand.amount,
				contractStartSeason,
			);
		}

		if (contractDemand.exp < minContractExp) {
			contractDemand.exp = minContractExp;
		}

		// Free agents' resistance to signing decays after every regular season game
		p.numDaysFreeAgent += 1;

		// Also, heal.
		if (g.get("phase") <= PHASE.PLAYOFFS) {
			if (p.injury.gamesRemaining > 0) {
				p.injury.gamesRemaining -= 1;
			} else {
				p.injury = {
					type: "Healthy",
					gamesRemaining: 0,
				};
			}
		}
	}

	await idb.cache.players.putAll(players);
};

export default decreaseDemands;
