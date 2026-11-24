import { player, team } from "../index.ts";
import { conditionSpecText } from "../../../common/draftPickConditions.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import type {
	Player,
	TradeSummary,
	PickConditionSpec,
	TradeTeams,
} from "../../../common/types.ts";
import { orderBy } from "../../../common/utils.ts";
import isUntradable from "./isUntradable.ts";
import { analyticsProjection } from "../../../common/frontOffice.ts";
import {
	frontOfficeEnabled,
	getNewDeptLevelLastThree,
} from "../frontOffice/index.ts";
import { getStashedPlayers } from "../draftStash/index.ts";
import { getGmWeights } from "../gm/index.ts";
import { pickTradeDisabledPlayerException } from "../contract/capExceptions.ts";

const getTeamOvr = async (playersRaw: Player[]) => {
	const players = await player.formatAll(playersRaw, {
		attrs: ["injury", "pid", "value"],
		fuzz: true,
		ratings: ["ovr", "pos", "ovrs"],
		season: g.get("season"),
	});

	return team.ovr(players);
};

/**
 * Create a summary of the trade, for eventual display to the user.
 *
 * @memberOf core.trade
 * @param {Array.<Object>} teams Array of objects containing the assets for the two teams in the trade. The first object is for the user's team and the second is for the other team. Values in the objects are tid (team ID), pids (player IDs) and dpids (draft pick IDs).
 * @return {Promise.Object} Resolves to an object contianing the trade summary.
 */
const summary = async (teams: TradeTeams): Promise<TradeSummary> => {
	const tids = [teams[0].tid, teams[1].tid] as const;
	const pids = [teams[0].pids, teams[1].pids] as const;
	const dpids = [teams[0].dpids, teams[1].dpids] as const;
	const s: TradeSummary = {
		teams: [
			{
				name: "",
				ovrAfter: 0,
				ovrBefore: 0,
				payrollAfterTrade: 0,
				payrollBeforeTrade: 0,
				picks: [],
				total: 0,
				trade: [],
			},
			{
				name: "",
				ovrAfter: 0,
				ovrBefore: 0,
				payrollAfterTrade: 0,
				payrollBeforeTrade: 0,
				picks: [],
				total: 0,
				trade: [],
			},
		],
		warning: null,
	};

	// Calculate properties of the trade
	const playersAfter: [Player[], Player[]] = [[], []];
	for (const i of [0, 1] as const) {
		const playersBefore = await idb.cache.players.indexGetAll(
			"playersByTid",
			tids[i],
		);
		// Draft-and-stash: rights to players abroad can be in the trade, but they are not on the roster (no ovr, no salary)
		const rights = await getStashedPlayers(tids[i]);
		const playersOrdered = orderBy(
			[...playersBefore, ...rights].filter(
				(p) => pids[i].includes(p.pid) && !isUntradable(p).untradable,
			),
			"valueFuzz",
			"desc",
		);
		const players = await player.formatAll(playersOrdered, {
			attrs: ["pid", "name", "contract", "draft"],
			season: g.get("season"),
			tid: tids[i],
			showRookies: true,
			showNoStats: true,
		});
		s.teams[i].trade = players;

		// Front Office Budget: the user's analytics projection of next season's ovr for the players he'd receive
		if (frontOfficeEnabled() && tids[i] !== g.get("userTid")) {
			const level = await getNewDeptLevelLastThree("analytics", {
				tid: g.get("userTid"),
			});
			for (const p of s.teams[i].trade) {
				const raw = playersOrdered.find((p2) => p2.pid === p.pid);
				const r = raw?.ratings.at(-1);
				if (raw && r && !g.get("challengeNoRatings")) {
					const fuzz = g.get("godMode") ? 0 : (r.fuzz ?? 0);
					const { lo, hi } = analyticsProjection({
						ovr: r.ovr + fuzz,
						fuzz,
						age: g.get("season") - raw.born.year,
						level,
					});
					p.analytics = { lo, hi };
				}
			}
		}
		s.teams[i].total = s.teams[i].trade.reduce(
			(memo, p) => memo + p.contract.amount,
			0,
		);

		const picks = await idb.cache.draftPicks.indexGetAll(
			"draftPicksByTid",
			tids[i],
		);
		for (const dp of picks) {
			if (dpids[i].includes(dp.dpid)) {
				const condition = teams[i].pickConditions?.find(
					(c) => c.dpid === dp.dpid,
				);
				let conditionSpec: PickConditionSpec | undefined;
				if (condition) {
					const { dpid, tid, ...spec } = condition;
					conditionSpec = spec;
				}
				s.teams[i].picks.push({
					dpid: dp.dpid,
					desc: await helpers.pickDesc(dp, "short"),
					condition: conditionSpec,
					conditionText: conditionSpec
						? conditionSpecText(
								conditionSpec,
								g.get("teamInfoCache")[tids[i === 0 ? 1 : 0]]?.abbrev,
							)
						: undefined,
					canHaveCondition:
						featureOn("draftPickConditions") &&
						typeof dp.season === "number" &&
						dp.pick === 0 &&
						!dp.protection &&
						!dp.swap,
					pick: dp.pick,
					round: dp.round,
					season: dp.season,
				});
			}
		}

		const j = i === 0 ? 1 : 0;
		s.teams[j].ovrBefore = await getTeamOvr(playersBefore);

		playersAfter[j].push(
			...playersBefore.filter(
				(p) => !(pids[i].includes(p.pid) && !isUntradable(p).untradable),
			),
		);
		playersAfter[i].push(
			...playersBefore.filter(
				(p) => pids[i].includes(p.pid) && !isUntradable(p).untradable,
			),
		);
	}
	for (const i of [0, 1] as const) {
		s.teams[i].ovrAfter = await getTeamOvr(playersAfter[i]);
	}

	const overCap: [boolean, boolean] = [false, false];
	const ratios: [number, number] = [0, 0];
	for (const j of [0, 1] as const) {
		const k = j === 0 ? 1 : 0;
		s.teams[j].name = `${g.get("teamInfoCache")[tids[j]]?.region} ${
			g.get("teamInfoCache")[tids[j]]?.name
		}`;

		if (s.teams[j].total > 0) {
			ratios[j] = Math.floor((100 * s.teams[k].total) / s.teams[j].total);
		} else if (s.teams[k].total > 0) {
			ratios[j] = Infinity;
		} else {
			ratios[j] = 100;
		}

		s.teams[j].payrollBeforeTrade = (await team.getPayroll(tids[j])) / 1000;
		s.teams[j].payrollAfterTrade =
			s.teams[j].payrollBeforeTrade + s.teams[k].total - s.teams[j].total;

		if (s.teams[j].payrollAfterTrade > g.get("salaryCap") / 1000) {
			overCap[j] = true;
		}
	}

	const softCapTradeSalaryMatch = g.get("softCapTradeSalaryMatch");

	// Salary cap exceptions: a disabled player exception lets a team over the cap take in one expiring contract outside salary matching
	const usesDisabledPlayerException = async (j: 0 | 1) => {
		const k = j === 0 ? 1 : 0;
		const t = await idb.cache.teams.get(tids[j]);
		return (
			!!t &&
			pickTradeDisabledPlayerException(
				t,
				Math.round(s.teams[j].payrollBeforeTrade * 1000),
				s.teams[k].trade.map((p) => ({
					pid: p.pid,
					amount: Math.round(p.contract.amount * 1000),
					exp: p.contract.exp,
				})),
				Math.round(s.teams[j].total * 1000),
			) !== undefined
		);
	};
	const softCapFails: [boolean, boolean] = [false, false];
	for (const j of [0, 1] as const) {
		softCapFails[j] =
			g.get("salaryCapType") === "soft" &&
			ratios[j] > softCapTradeSalaryMatch &&
			overCap[j] &&
			!(await usesDisabledPlayerException(j));
	}
	const softCapCondition = softCapFails[0] || softCapFails[1];

	const overCapAndIncreasing = (i: 0 | 1) =>
		overCap[i] && s.teams[i].payrollAfterTrade > s.teams[i].payrollBeforeTrade;

	const hardCapCondition =
		g.get("salaryCapType") === "hard" &&
		(overCapAndIncreasing(0) || overCapAndIncreasing(1));

	if (softCapCondition) {
		// Which team is at fault?;
		const j = softCapFails[0] ? 0 : 1;
		s.warning = `The ${s.teams[j].name} are over the salary cap, so the players it receives must have a combined salary of less than ${softCapTradeSalaryMatch}% of the salaries of the players it trades away.  Currently, that value is ${ratios[j] === Infinity ? "infinite" : `${ratios[j]}%`}.`;
		s.warningAmount = ratios[j];
	} else if (hardCapCondition) {
		const j = overCapAndIncreasing(0) ? 0 : 1;
		const amountIncrease =
			s.teams[j].payrollAfterTrade - s.teams[j].payrollBeforeTrade;
		const amountOverCap =
			s.teams[j].payrollAfterTrade - g.get("salaryCap") / 1000;
		s.warning = `This trade is not allowed because it increases the payroll of the ${
			s.teams[j].name
		} by ${helpers.formatCurrency(
			amountIncrease,
			"M",
		)} and puts them over the salary cap by ${helpers.formatCurrency(
			amountOverCap,
			"M",
		)}.`;
		s.warningAmount = amountOverCap;
	} else if (g.get("salaryCapType") !== "hard" && g.get("luxuryTax") > 0) {
		// AI GM personalities: a tax-averse GM takes on no salary that leaves his team over the luxury tax line
		const luxuryPayroll = g.get("luxuryPayroll") / 1000;
		for (const j of [0, 1] as const) {
			const { payrollAfterTrade, payrollBeforeTrade } = s.teams[j];
			if (
				payrollAfterTrade > luxuryPayroll &&
				payrollAfterTrade > payrollBeforeTrade &&
				(await getGmWeights(tids[j]))?.refusesTax
			) {
				s.warning = `The ${s.teams[j].name}' general manager won't take on salary that puts them over the luxury tax (${helpers.formatCurrency(luxuryPayroll, "M")}).`;
				s.warningAmount = payrollAfterTrade - luxuryPayroll;
				break;
			}
		}
	}

	return s;
};

export default summary;
