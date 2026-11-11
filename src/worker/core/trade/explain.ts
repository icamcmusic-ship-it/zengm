import { idb } from "../../db/index.ts";
import {
	conditionSpecText,
	getTradePickConditions,
} from "../../../common/draftPickConditions.ts";
import type { TradePickCondition } from "../../../common/types.ts";
import { g, helpers } from "../../util/index.ts";
import type { TradeTeams } from "../../../common/types.ts";
import {
	ValueChangeCalculator,
	type AssetValueDetail,
} from "../team/ValueChangeCalculator.ts";
import summary from "./summary.ts";
import { getGmWeights } from "../gm/index.ts";
import { gmStyleLabels } from "../../../common/gmPersonality.ts";

// Everything here is from the point of view of the AI team deciding on the trade. "good" means the term makes the AI team like the trade more, "bad" means less.
export type ExplanationEffect = "good" | "bad" | "neutral";

export type ExplanationTerm = {
	key: "value" | "pick" | "strategy" | "contract" | "injury" | "fit" | "salary";
	text: string;
	effect: ExplanationEffect;
};

export type ExplainedAsset = {
	direction: "receive" | "give";
	type: "player" | "pick";
	pid?: number;
	dpid?: number;
	name: string;

	// Share of the trade value on that side of the deal, 0-100
	share: number;

	terms: ExplanationTerm[];
};

export type TradeExplanation = {
	tid: number;
	teamName: string;
	strategy: string;
	dv: number;
	accepts: boolean;

	// Value received as a percentage of value given up, from the AI's point of view
	valueRatio: number;

	summary: string;
	assets: ExplainedAsset[];
	team: ExplanationTerm[];
};

export type BuildExplanationInput = {
	tid: number;
	teamName: string;
	strategy: string;
	dv: number;
	add: AssetValueDetail[];
	remove: AssetValueDetail[];
	names: Record<string, string>;
	ovrBefore?: number;
	ovrAfter?: number;

	// In thousands of dollars, like the rest of the game
	payrollBefore?: number;
	payrollAfter?: number;
	salaryCap: number;
	salaryCapType: "hard" | "soft" | "none";
	warning?: string | null;

	// AI GM personalities (setting): "Name (Win-now, Analytics)" for a team with a GM
	gm?: { name: string; styleLabels: string[] };
};

const assetKey = (detail: AssetValueDetail) =>
	detail.type === "player" ? `p${detail.pid}` : `dp${detail.dpid}`;

const describeTalent = (value: number) => {
	if (value > 2) {
		return "a franchise-level talent";
	}
	if (value > 1.2) {
		return "a star";
	}
	if (value > 0.5) {
		return "a quality starter";
	}
	if (value > 0) {
		return "a rotation player";
	}
	if (value > -0.5) {
		return "a fringe roster player";
	}
	return "a replacement-level player";
};

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`;

const flip = (effect: ExplanationEffect, give: boolean): ExplanationEffect => {
	if (!give || effect === "neutral") {
		return effect;
	}
	return effect === "good" ? "bad" : "good";
};

export const explainAsset = (
	detail: AssetValueDetail,
	direction: "receive" | "give",
	strategy: string,
	name: string,
	total: number,
): ExplainedAsset => {
	const give = direction === "give";
	const terms: ExplanationTerm[] = [];

	if (detail.type === "player") {
		terms.push({
			key: "value",
			text: `${give ? "Giving up" : "Getting"} ${describeTalent(detail.baseValue)}, age ${detail.age}.`,
			effect: flip(detail.baseValue > 0 ? "good" : "bad", give),
		});
	} else {
		const pickText =
			detail.draftPick !== undefined && detail.draftYear !== undefined
				? `projected around pick #${Math.max(1, Math.round(detail.draftPick))} of the ${detail.draftYear} draft`
				: "a draft pick";
		terms.push({
			key: "pick",
			text: `${give ? "Giving up" : "Getting"} ${pickText}, valued like ${describeTalent(detail.baseValue)}.`,
			effect: flip(detail.baseValue > 0 ? "good" : "neutral", give),
		});
	}

	// Strategy only applies to positive value, see sumValues
	const sf = detail.strategyFactor;
	if (Math.abs(sf - 1) > 0.001 && detail.baseValue > 0) {
		let text;
		if (strategy === "rebuilding") {
			text =
				sf > 1
					? detail.type === "pick"
						? `Rebuilding teams value future picks more (+${pct(sf - 1)}).`
						: `Rebuilding teams value young players more (+${pct(sf - 1)}).`
					: `Rebuilding teams care less about veterans (−${pct(1 - sf)}).`;
		} else {
			text =
				detail.type === "pick"
					? `Contending teams care less about future picks (−${pct(1 - sf)}).`
					: `Contending teams care less about young players' potential (−${pct(1 - sf)}).`;
		}
		terms.push({
			key: "strategy",
			text,
			effect: flip(sf > 1 ? "good" : "bad", give),
		});
	}

	// AI GM personalities (setting)
	const gf = detail.gmFactor ?? 1;
	if (Math.abs(gf - 1) > 0.001 && detail.baseValue > 0) {
		const what =
			detail.type === "pick"
				? "draft picks"
				: detail.age <= 23
					? "young players"
					: "veterans";
		terms.push({
			key: "strategy",
			text:
				gf > 1
					? `Our GM values ${what} more (+${pct(gf - 1)}).`
					: `Our GM values ${what} less (−${pct(1 - gf)}).`,
			effect: flip(gf > 1 ? "good" : "bad", give),
		});
	}

	if (detail.injuryPenalty > 0.001) {
		terms.push({
			key: "injury",
			text: `Injured, so worth less right now (−${pct(detail.injuryPenalty / Math.max(Math.abs(detail.baseValue), 0.01))}).`,
			effect: "bad",
		});
	}

	if (detail.type === "player") {
		const contractEffect = detail.contractsFactor * detail.contractValue;
		const strategyNote =
			strategy === "rebuilding"
				? " Rebuilding teams weigh contracts heavily."
				: "";
		if (detail.contractValue < -0.02) {
			terms.push({
				key: "contract",
				text: give
					? `Overpaid relative to his value, so shedding the contract is a plus.${strategyNote}`
					: `Overpaid relative to his value, so the contract is a burden.${strategyNote}`,
				effect: flip("bad", give),
			});
		} else if (contractEffect > 0.02) {
			terms.push({
				key: "contract",
				text: "Underpaid for his value, a bargain contract.",
				effect: flip("good", give),
			});
		} else if (detail.contractValue === 0) {
			terms.push({
				key: "contract",
				text: "Expiring contract, so salary doesn't matter much.",
				effect: "neutral",
			});
		}
	}

	return {
		direction,
		type: detail.type,
		pid: detail.pid,
		dpid: detail.dpid,
		name,
		share:
			total > 0
				? Math.round((100 * Math.max(detail.tradeValue, 0)) / total)
				: 0,
		terms,
	};
};

export const buildTradeExplanation = (
	input: BuildExplanationInput,
): TradeExplanation => {
	const sum = (rows: AssetValueDetail[]) =>
		rows.reduce((memo, row) => memo + Math.max(row.tradeValue, 0), 0);
	const totalAdd = sum(input.add);
	const totalRemove = sum(input.remove);

	const assets = [
		...input.add.map((detail) =>
			explainAsset(
				detail,
				"receive",
				input.strategy,
				input.names[assetKey(detail)] ?? "Unknown",
				totalAdd,
			),
		),
		...input.remove.map((detail) =>
			explainAsset(
				detail,
				"give",
				input.strategy,
				input.names[assetKey(detail)] ?? "Unknown",
				totalRemove,
			),
		),
	];

	const team: ExplanationTerm[] = [];

	team.push({
		key: "strategy",
		text:
			input.strategy === "rebuilding"
				? "We're rebuilding: we want young players, draft picks and cap flexibility, not expensive veterans."
				: "We're contending: we want players who help us win now, and we don't care as much about the future.",
		effect: "neutral",
	});

	if (input.gm) {
		team.push({
			key: "strategy",
			text: `Our GM, ${input.gm.name}, ${
				input.gm.styleLabels.length > 0
					? `leans ${input.gm.styleLabels.map((x) => x.toLowerCase()).join(", ")}`
					: "has no strong leanings"
			}, which nudges how he values players, picks and contracts.`,
			effect: "neutral",
		});
	}

	if (input.ovrBefore !== undefined && input.ovrAfter !== undefined) {
		const diff = input.ovrAfter - input.ovrBefore;
		if (Math.abs(diff) >= 1) {
			const contending = input.strategy === "contending";
			team.push({
				key: "fit",
				text:
					diff > 0
						? `It makes our rotation better now (team ovr ${Math.round(input.ovrBefore)} → ${Math.round(input.ovrAfter)}).`
						: `It makes our rotation worse now (team ovr ${Math.round(input.ovrBefore)} → ${Math.round(input.ovrAfter)})${contending ? ", which hurts a contender" : ""}.`,
				effect: diff > 0 ? "good" : contending ? "bad" : "neutral",
			});
		} else {
			team.push({
				key: "fit",
				text: "It doesn't change how good our team is right now.",
				effect: "neutral",
			});
		}
	}

	if (input.payrollBefore !== undefined && input.payrollAfter !== undefined) {
		const diff = input.payrollAfter - input.payrollBefore;
		const overCap = input.payrollAfter > input.salaryCap;
		if (Math.abs(diff) >= 1) {
			const amount = helpers.formatCurrency(Math.abs(diff) / 1000, "M");
			let text =
				diff > 0
					? `Adds ${amount} to our payroll`
					: `Saves ${amount} in payroll`;
			if (input.salaryCapType !== "none") {
				text += overCap
					? `, leaving us ${helpers.formatCurrency((input.payrollAfter - input.salaryCap) / 1000, "M")} over the cap.`
					: `, leaving ${helpers.formatCurrency((input.salaryCap - input.payrollAfter) / 1000, "M")} in cap space.`;
			} else {
				text += ".";
			}
			team.push({
				key: "salary",
				text,
				effect:
					diff < 0
						? "good"
						: overCap || input.strategy === "rebuilding"
							? "bad"
							: "neutral",
			});
		}
	}
	if (input.warning) {
		team.push({
			key: "salary",
			text: input.warning,
			effect: "bad",
		});
	}

	const valueRatio =
		totalRemove > 0
			? Math.round((100 * totalAdd) / totalRemove)
			: totalAdd > 0
				? Infinity
				: 100;
	const accepts = input.dv > 0;

	let summaryText;
	if (accepts) {
		summaryText = "They like this deal.";
	} else if (input.add.length === 0) {
		summaryText = "They'd be giving something up for nothing in return.";
	} else if (input.dv > -2) {
		summaryText = `Close: by their math they get about ${valueRatio}% of the value they give up.`;
	} else {
		summaryText = `By their math they only get about ${valueRatio}% of the value they give up.`;
	}

	return {
		tid: input.tid,
		teamName: input.teamName,
		strategy: input.strategy,
		dv: input.dv,
		accepts,
		valueRatio,
		summary: summaryText,
		assets,
		team,
	};
};

const getNames = async (pids: number[], dpids: number[]) => {
	const names: Record<string, string> = {};
	for (const pid of pids) {
		const p = await idb.cache.players.get(pid);
		if (p) {
			names[`p${pid}`] = `${p.firstName} ${p.lastName}`;
		}
	}
	for (const dpid of dpids) {
		const dp = await idb.cache.draftPicks.get(dpid);
		if (dp) {
			names[`dp${dpid}`] = await helpers.pickDesc(dp, "short");
		}
	}
	return names;
};

// Explain how team "tid" sees receiving pidsAdd/dpidsAdd and giving pidsRemove/dpidsRemove
export const explainForTeam = async ({
	tid,
	pidsAdd,
	pidsRemove,
	dpidsAdd,
	dpidsRemove,
	tradingPartnerTid,
	ovrBefore,
	ovrAfter,
	payrollBefore,
	payrollAfter,
	warning,
	valueChangeCalculator = new ValueChangeCalculator(),
	pickConditions,
}: {
	tid: number;
	pidsAdd: number[];
	pidsRemove: number[];
	dpidsAdd: number[];
	dpidsRemove: number[];
	tradingPartnerTid: number | undefined;
	ovrBefore?: number;
	ovrAfter?: number;
	payrollBefore?: number;
	payrollAfter?: number;
	warning?: string | null;
	valueChangeCalculator?: ValueChangeCalculator;
	pickConditions?: TradePickCondition[];
}) => {
	const result = await valueChangeCalculator.explain({
		tid,
		pidsAdd,
		pidsRemove,
		dpidsAdd,
		dpidsRemove,
		tradingPartnerTid,
		pickConditions,
	});
	const names = await getNames(
		[...pidsAdd, ...pidsRemove],
		[...dpidsAdd, ...dpidsRemove],
	);
	for (const c of pickConditions ?? []) {
		const key = `dp${c.dpid}`;
		if (names[key] !== undefined) {
			names[key] +=
				` (${conditionSpecText(c, c.tid !== undefined ? g.get("teamInfoCache")[c.tid]?.abbrev : undefined)})`;
		}
	}
	const teamInfo = g.get("teamInfoCache")[tid];

	return buildTradeExplanation({
		tid,
		teamName: teamInfo ? `${teamInfo.region} ${teamInfo.name}` : "AI team",
		strategy: result.strategy,
		dv: result.dv,
		add: result.add,
		remove: result.remove,
		names,
		ovrBefore,
		ovrAfter,
		payrollBefore,
		payrollAfter,
		salaryCap: g.get("salaryCap"),
		salaryCapType: g.get("salaryCapType"),
		warning,
		gm: await getExplanationGm(tid),
	});
};

// AI GM personalities (setting): the AI team's GM, if he is making the call
const getExplanationGm = async (tid: number) => {
	if (!(await getGmWeights(tid))) {
		return;
	}
	const gm = (await idb.cache.teams.get(tid))?.gm;
	return gm
		? {
				name: `${gm.firstName} ${gm.lastName}`,
				styleLabels: gmStyleLabels(gm.traits),
			}
		: undefined;
};

// Explain a 2 team trade from the AI team's (teams[1]) point of view
const explain = async (teams: TradeTeams) => {
	const s = await summary(teams);
	return explainForTeam({
		tid: teams[1].tid,
		pidsAdd: teams[0].pids,
		pidsRemove: teams[1].pids,
		dpidsAdd: teams[0].dpids,
		dpidsRemove: teams[1].dpids,
		tradingPartnerTid: teams[0].tid,
		pickConditions: getTradePickConditions(teams),
		// summary.teams[i].ovrBefore/ovrAfter are for the team receiving team i's assets
		ovrBefore: s.teams[0].ovrBefore,
		ovrAfter: s.teams[0].ovrAfter,
		payrollBefore: s.teams[1].payrollBeforeTrade * 1000,
		payrollAfter: s.teams[1].payrollAfterTrade * 1000,
		warning: s.warning,
	});
};

export default explain;
