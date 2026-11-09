import { PHASE } from "../../../common/constants.ts";
import type {
	PickConditionSpec,
	Player,
	TradePickCondition,
	TradeTeams,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import { getContractSummary } from "../contract/index.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import { explainForTeam, type TradeExplanation } from "./explain.ts";
import isUntradable from "./isUntradable.ts";
import processTrade from "./processTrade.ts";
import get from "./get.ts";
import {
	conditionSpecText,
	validatePickConditionSpec,
} from "../../../common/draftPickConditions.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { getNumPicksPerRound } from "./getPickValues.ts";

// Trades with more than 2 teams (the UI does 3), where any team can send assets to any other team. Processed as one 2-team trade event per pair of teams that exchange something, so all the existing trade pages, transactions and trade summaries keep working.

export type MultiTeamAsset = {
	type: "player" | "pick";
	id: number;
	fromTid: number;
	toTid: number;

	// Draft pick condition added in this trade (picks only)
	condition?: PickConditionSpec;
};

// The pick conditions of a multi-team trade, with the receiving team filled in
export const getMultiPickConditions = (
	trade: MultiTeamTrade,
): TradePickCondition[] =>
	trade.assets.flatMap((asset) =>
		asset.type === "pick" && asset.condition
			? [{ ...asset.condition, dpid: asset.id, tid: asset.toTid }]
			: [],
	);

export type MultiTeamTrade = {
	// First is the user's team
	tids: number[];
	assets: MultiTeamAsset[];
};

export type TeamFlow = {
	tid: number;
	pidsIn: number[];
	pidsOut: number[];
	dpidsIn: number[];
	dpidsOut: number[];
};

export const getTeamFlows = (trade: MultiTeamTrade): TeamFlow[] => {
	return trade.tids.map((tid) => {
		const flow: TeamFlow = {
			tid,
			pidsIn: [],
			pidsOut: [],
			dpidsIn: [],
			dpidsOut: [],
		};
		for (const asset of trade.assets) {
			if (asset.toTid === tid) {
				(asset.type === "player" ? flow.pidsIn : flow.dpidsIn).push(asset.id);
			}
			if (asset.fromTid === tid) {
				(asset.type === "player" ? flow.pidsOut : flow.dpidsOut).push(asset.id);
			}
		}
		return flow;
	});
};

// Split into 2-team legs, one per pair of teams that exchange anything. Each leg is in the usual TradeTeams format: teams[i] lists what team i sends to the other team
export const getLegs = (trade: MultiTeamTrade): TradeTeams[] => {
	const legs: TradeTeams[] = [];
	for (let i = 0; i < trade.tids.length; i++) {
		for (let j = i + 1; j < trade.tids.length; j++) {
			const a = trade.tids[i]!;
			const b = trade.tids[j]!;
			const side = (from: number, to: number) => {
				const assets = trade.assets.filter(
					(asset) => asset.fromTid === from && asset.toTid === to,
				);
				const pickConditions = assets.flatMap((x) =>
					x.type === "pick" && x.condition
						? [{ ...x.condition, dpid: x.id, tid: to }]
						: [],
				);
				return {
					tid: from,
					pids: assets.filter((x) => x.type === "player").map((x) => x.id),
					pidsExcluded: [],
					dpids: assets.filter((x) => x.type === "pick").map((x) => x.id),
					dpidsExcluded: [],
					...(pickConditions.length > 0 ? { pickConditions } : {}),
				};
			};
			const leg: TradeTeams = [side(a, b), side(b, a)];
			if (
				leg[0].pids.length +
					leg[0].dpids.length +
					leg[1].pids.length +
					leg[1].dpids.length >
				0
			) {
				legs.push(leg);
			}
		}
	}
	return legs;
};

export type RuleTeam = {
	tid: number;
	name: string;

	// Thousands of dollars
	payrollBefore: number;
	salaryIn: number;
	salaryOut: number;

	rosterBefore: number;
	playersIn: number;
	playersOut: number;

	assetsIn: number;
	assetsOut: number;
};

// Problems that make the trade invalid. Same salary cap rules as 2-team trades, applied to each team's total incoming and outgoing salary
export const getRuleWarnings = (
	teams: RuleTeam[],
	{
		salaryCap,
		salaryCapType,
		softCapTradeSalaryMatch,
		maxRosterSize,
		checkRosterSize,
	}: {
		salaryCap: number;
		salaryCapType: "hard" | "soft" | "none";
		softCapTradeSalaryMatch: number;
		maxRosterSize: number;
		checkRosterSize: boolean;
	},
) => {
	const warnings: string[] = [];
	for (const t of teams) {
		if (t.assetsIn + t.assetsOut === 0) {
			warnings.push(`The ${t.name} are not part of this trade.`);
			continue;
		}

		const payrollAfter = t.payrollBefore + t.salaryIn - t.salaryOut;
		const overCap = payrollAfter > salaryCap;

		if (salaryCapType === "soft" && overCap) {
			const ratio =
				t.salaryOut > 0
					? Math.floor((100 * t.salaryIn) / t.salaryOut)
					: t.salaryIn > 0
						? Infinity
						: 100;
			if (ratio > softCapTradeSalaryMatch) {
				warnings.push(
					`The ${t.name} are over the salary cap, so the players they receive must have a combined salary of less than ${softCapTradeSalaryMatch}% of the salaries of the players they trade away. Currently, that value is ${ratio === Infinity ? "infinite" : `${ratio}%`}.`,
				);
			}
		} else if (
			salaryCapType === "hard" &&
			overCap &&
			payrollAfter > t.payrollBefore
		) {
			warnings.push(
				`This trade is not allowed because it increases the payroll of the ${t.name} by ${helpers.formatCurrency((payrollAfter - t.payrollBefore) / 1000, "M")} and puts them over the salary cap.`,
			);
		}

		const rosterAfter = t.rosterBefore + t.playersIn - t.playersOut;
		if (checkRosterSize && rosterAfter > maxRosterSize) {
			warnings.push(
				`The ${t.name} would have ${rosterAfter} players, more than the maximum of ${maxRosterSize}.`,
			);
		}
	}
	return warnings;
};

// Make sure every asset belongs to the team sending it, goes to another team in the trade, and appears only once
export const validateAssets = async (trade: MultiTeamTrade) => {
	const seen = new Set<string>();
	for (const asset of trade.assets) {
		const key = `${asset.type}-${asset.id}`;
		if (seen.has(key)) {
			return `Asset listed twice`;
		}
		seen.add(key);

		if (
			!trade.tids.includes(asset.fromTid) ||
			!trade.tids.includes(asset.toTid) ||
			asset.fromTid === asset.toTid
		) {
			return "Invalid team for asset";
		}

		if (asset.type === "player") {
			const p = await idb.cache.players.get(asset.id);
			if (!p || p.tid !== asset.fromTid) {
				return "Invalid player";
			}
			if (isUntradable(p).untradable) {
				return `${p.firstName} ${p.lastName} can't be traded right now.`;
			}
		} else {
			const dp = await idb.cache.draftPicks.get(asset.id);
			if (!dp || dp.tid !== asset.fromTid) {
				return "Invalid draft pick";
			}
			if (asset.condition) {
				if (!featureOn("draftPickConditions")) {
					return "Draft pick conditions are turned off";
				}
				const error = validatePickConditionSpec(
					asset.condition,
					dp,
					getNumPicksPerRound(),
				);
				if (error) {
					return error;
				}
				if (asset.condition.type === "swap") {
					const toPicks = await idb.cache.draftPicks.indexGetAll(
						"draftPicksByTid",
						asset.toTid,
					);
					if (
						dp.originalTid === asset.toTid ||
						!toPicks.some(
							(dp2) =>
								dp2.originalTid === asset.toTid &&
								dp2.season === dp.season &&
								dp2.round === dp.round &&
								!dp2.swap,
						)
					) {
						return "A pick swap needs the receiving team's own pick in the same round";
					}
				}
			}
		}
	}
	if (new Set(trade.tids).size !== trade.tids.length) {
		return "Each team can only be in the trade once";
	}
	return;
};

const getTeamOvr = async (playersRaw: Player[]) => {
	const players = await player.formatAll(playersRaw, {
		attrs: ["injury", "pid", "value"],
		fuzz: true,
		ratings: ["ovr", "pos", "ovrs"],
		season: g.get("season"),
	});
	return team.ovr(players);
};

const getName = (tid: number) => {
	const t = g.get("teamInfoCache")[tid];
	return t ? `${t.region} ${t.name}` : "???";
};

export const summaryMulti = async (trade: MultiTeamTrade) => {
	const invalid = await validateAssets(trade);
	const flows = getTeamFlows(trade);

	const playersByTid = new Map<number, Player[]>();
	for (const tid of trade.tids) {
		playersByTid.set(
			tid,
			await idb.cache.players.indexGetAll("playersByTid", tid),
		);
	}
	const allPlayers = [...playersByTid.values()].flat();
	const playerById = new Map(allPlayers.map((p) => [p.pid, p]));

	const contractOf = (pid: number) => {
		const p = playerById.get(pid);
		return p ? getContractSummary(p) : undefined;
	};
	const salary = (pids: number[]) =>
		pids.reduce((memo, pid) => memo + (contractOf(pid)?.amount ?? 0), 0);

	const teams = [];
	const ruleTeams: RuleTeam[] = [];
	for (const flow of flows) {
		const before = playersByTid.get(flow.tid) ?? [];
		const after = [
			...before.filter((p) => !flow.pidsOut.includes(p.pid)),
			...flow.pidsIn
				.map((pid) => playerById.get(pid))
				.filter((p) => p !== undefined),
		];
		const payrollBefore = await team.getPayroll(flow.tid);
		const salaryIn = salary(flow.pidsIn);
		const salaryOut = salary(flow.pidsOut);

		const conditionSuffix = (dpid: number) => {
			const asset = trade.assets.find(
				(a) => a.type === "pick" && a.id === dpid,
			);
			return asset?.condition
				? ` [${conditionSpecText(asset.condition, g.get("teamInfoCache")[asset.toTid]?.abbrev)}]`
				: "";
		};
		const describe = async (
			pids: number[],
			dpids: number[],
			otherTid: (id: number, type: "player" | "pick") => number,
		) => {
			const rows = [];
			for (const pid of pids) {
				const p = playerById.get(pid);
				rows.push({
					type: "player" as const,
					id: pid,
					name: p ? `${p.firstName} ${p.lastName}` : "???",
					contractAmount: (contractOf(pid)?.amount ?? 0) / 1000,
					contractExp: contractOf(pid)?.exp,
					otherTid: otherTid(pid, "player"),
				});
			}
			for (const dpid of dpids) {
				const dp = await idb.cache.draftPicks.get(dpid);
				rows.push({
					type: "pick" as const,
					id: dpid,
					name: dp
						? `${await helpers.pickDesc(dp, "short")}${conditionSuffix(dpid)}`
						: "???",
					contractAmount: 0,
					contractExp: undefined,
					otherTid: otherTid(dpid, "pick"),
				});
			}
			return rows;
		};
		const assetFor = (id: number, type: "player" | "pick") =>
			trade.assets.find((a) => a.id === id && a.type === type)!;

		teams.push({
			tid: flow.tid,
			name: getName(flow.tid),
			payrollBefore: payrollBefore / 1000,
			payrollAfter: (payrollBefore + salaryIn - salaryOut) / 1000,
			ovrBefore: await getTeamOvr(before),
			ovrAfter: await getTeamOvr(after),
			rosterAfter: after.length,
			receive: await describe(
				flow.pidsIn,
				flow.dpidsIn,
				(id, type) => assetFor(id, type).fromTid,
			),
			give: await describe(
				flow.pidsOut,
				flow.dpidsOut,
				(id, type) => assetFor(id, type).toTid,
			),
		});

		ruleTeams.push({
			tid: flow.tid,
			name: getName(flow.tid),
			payrollBefore,
			salaryIn,
			salaryOut,
			rosterBefore: before.length,
			playersIn: flow.pidsIn.length,
			playersOut: flow.pidsOut.length,
			assetsIn: flow.pidsIn.length + flow.dpidsIn.length,
			assetsOut: flow.pidsOut.length + flow.dpidsOut.length,
		});
	}

	const phase = g.get("phase");
	const warnings = invalid
		? [invalid]
		: trade.assets.length === 0
			? []
			: getRuleWarnings(ruleTeams, {
					salaryCap: g.get("salaryCap"),
					salaryCapType: g.get("salaryCapType"),
					softCapTradeSalaryMatch: g.get("softCapTradeSalaryMatch"),
					maxRosterSize: g.get("maxRosterSize"),
					checkRosterSize:
						phase >= PHASE.REGULAR_SEASON && phase <= PHASE.PLAYOFFS,
				});

	return {
		teams,
		warnings,
		enablePropose: trade.assets.length > 0 && warnings.length === 0,
	};
};

// How each AI team in the trade feels about it
export const evaluateMulti = async (
	trade: MultiTeamTrade,
	userTid: number,
	valueChangeCalculator = new ValueChangeCalculator(),
) => {
	const s = await summaryMulti(trade);
	const explanations: TradeExplanation[] = [];
	for (const flow of getTeamFlows(trade)) {
		if (flow.tid === userTid) {
			continue;
		}
		const summaryTeam = s.teams.find((t) => t.tid === flow.tid);
		explanations.push(
			await explainForTeam({
				tid: flow.tid,
				pidsAdd: flow.pidsIn,
				pidsRemove: flow.pidsOut,
				dpidsAdd: flow.dpidsIn,
				dpidsRemove: flow.dpidsOut,
				tradingPartnerTid: userTid,
				pickConditions: getMultiPickConditions(trade),
				ovrBefore: summaryTeam?.ovrBefore,
				ovrAfter: summaryTeam?.ovrAfter,
				payrollBefore:
					summaryTeam !== undefined
						? summaryTeam.payrollBefore * 1000
						: undefined,
				payrollAfter:
					summaryTeam !== undefined
						? summaryTeam.payrollAfter * 1000
						: undefined,
				valueChangeCalculator,
			}),
		);
	}
	return { summary: s, explanations };
};

const listNames = (names: string[]) =>
	names.length <= 1
		? (names[0] ?? "")
		: `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

// Move all the assets, as one 2-team trade event per leg. Returns an undo function
export const processMulti = async (trade: MultiTeamTrade) => {
	const legs = getLegs(trade);
	const note = `Part of a ${trade.tids.length}-team trade with the ${listNames(trade.tids.map(getName))}.`;

	// processTrade's undo resets the trade page to the leg, so remember what was there
	const tradeBefore = helpers.deepCopy(await get());

	const undos: Awaited<ReturnType<typeof processTrade>>[] = [];
	for (const leg of legs) {
		undos.push(await processTrade(leg, undefined, { note }));
	}

	for (const tid of trade.tids) {
		const t = await idb.cache.teams.get(tid);
		const onlyNewPlayers =
			g.get("userTids").includes(tid) &&
			!g.get("spectator") &&
			t &&
			!t.keepRosterSorted;
		await team.rosterAutoSort(tid, onlyNewPlayers);
	}

	return async () => {
		// Check every leg before undoing any, so the trade is never half undone
		for (const undo of undos) {
			const check = await undo({ dryRun: true });
			if (check !== true) {
				return check;
			}
		}
		let ok: boolean | string = true;
		for (const undo of undos.toReversed()) {
			const result = await undo();
			if (result !== true && ok === true) {
				ok = result;
			}
		}
		await idb.cache.trade.put(tradeBefore);
		return ok;
	};
};

export const proposeMulti = async (
	trade: MultiTeamTrade,
	forceTrade: boolean,
) => {
	const phase = g.get("phase");
	if (
		(phase >= PHASE.AFTER_TRADE_DEADLINE && phase <= PHASE.PLAYOFFS) ||
		phase === PHASE.FANTASY_DRAFT ||
		phase === PHASE.EXPANSION_DRAFT
	) {
		return {
			accepted: false,
			message: `Error! You're not allowed to make trades ${phase === PHASE.AFTER_TRADE_DEADLINE ? "after the trade deadline" : "now"}.`,
			explanations: [],
			undo: undefined,
		};
	}

	const userTid = g.get("userTid");
	if (trade.tids[0] !== userTid || trade.tids.length < 3) {
		throw new Error("Invalid multi-team trade");
	}

	const { summary, explanations } = await evaluateMulti(trade, userTid);
	if (summary.warnings.length > 0 && !forceTrade) {
		return {
			accepted: false,
			message: summary.warnings.join(" "),
			explanations,
			undo: undefined,
		};
	}

	const rejecting = explanations.filter((e) => !e.accepts);
	if (rejecting.length > 0 && !forceTrade) {
		return {
			accepted: false,
			message: `Trade rejected by the ${listNames(rejecting.map((e) => e.teamName))}.`,
			explanations,
			undo: undefined,
		};
	}

	const undo = await processMulti(trade);
	return {
		accepted: true,
		message: 'Trade accepted! "Nice doing business with you!"',
		explanations,
		undo,
	};
};
