// Key stats of an award: the stats its formula reads, ranked by how much each one moves the score among the players shown
// (the award race candidates, or past winners). Award Races and Award History show the top ones as columns, and a picker
// can add any other stat the game tracks. Display only: award scoring itself is in processAwards.ts.
import { FormulaEvaluator } from "../../util/FormulaEvaluator.ts";
import { hasCol } from "../../../common/getCols.ts";
import {
	AWARD_STATS_ALL,
	AWARD_STATS_PLAIN,
	PLAYOFF_SERIES_AWARD_STATS_ALL,
} from "./getPlayers.ts";
import { defenseAwardFormula } from "./perimeterDefense.ts";
import {
	TRACKING_DERIVED,
	advStatsOn,
	isTrackingAwardVar,
	trackingAwardFormula,
} from "./trackingAwards.ts";

const NESTED_VARIABLES = ["numWon", "numWonConsecutive"];

// Formula variables that scale or gate the score but are not stats worth a column
const NOT_SHOWN = new Set([
	"seasonFraction",
	"teamGp",
	"numWon",
	"numWonConsecutive",
]);

// Shown already by the Record column, so not suggested as a column of its own (still offered in the picker)
const NOT_SUGGESTED = new Set(["winp"]);

// Max number of formula stats suggested as columns, and the number of columns padded to with the award's usual stats
const MAX_SUGGESTED = 5;
const MIN_COLUMNS = 4;

// A formula stat whose share of the score's movement is below this is not suggested (unless nothing else is)
const MIN_SHARE = 0.03;

type AwardFormulaInfo = {
	formula: string;
	formulaByPos?: Record<string, string>;
	numTeams?: number;
	statRange?: unknown;
};

// The formula an award is actually scored with for a player at a position (same as processAwards)
export const effectiveAwardFormula = (
	award: AwardFormulaInfo,
	pos: string | undefined,
) =>
	(pos !== undefined ? award.formulaByPos?.[pos] : undefined) ??
	defenseAwardFormula(award) ??
	trackingAwardFormula(award) ??
	award.formula;

const evaluatorCache = new Map<
	string,
	FormulaEvaluator<string[], string[]> | null
>();

const getEvaluator = (formula: string, playoffSeries: boolean) => {
	const key = `${playoffSeries ? "s" : "n"}${formula}`;
	let evaluator = evaluatorCache.get(key);
	if (evaluator === undefined) {
		try {
			evaluator = new FormulaEvaluator(
				formula,
				playoffSeries ? PLAYOFF_SERIES_AWARD_STATS_ALL : AWARD_STATS_ALL,
				NESTED_VARIABLES,
			);
		} catch {
			// Invalid formula: Award Settings already reports it, here it just has no key stats
			evaluator = null;
		}
		if (evaluatorCache.size > 500) {
			evaluatorCache.clear();
		}
		evaluatorCache.set(key, evaluator);
	}
	return evaluator ?? undefined;
};

// The variables a formula reads, in the order they first appear
export const formulaVariables = (formula: string, playoffSeries: boolean) => {
	const evaluator = getEvaluator(formula, playoffSeries);
	return evaluator ? Array.from(evaluator.usedVariables) : [];
};

export type KeyStatTerm = {
	stat: string;

	// Share of how much the score moves among the players shown, 0 to 1 (all 0 when there is nothing to compare)
	share: number;
};

export type KeyStatRow = {
	stats: Record<string, unknown>;

	// MIP: last season's stats. Each stat's effect is then its change from last season, rather than its distance from the average
	baseline?: Record<string, unknown>;

	formula: string;
};

const toNumber = (value: unknown) => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
};

// Rank the variables of the formula(s) by how much each one moves the score among these rows: for each row, the change in
// score when that one stat is set to the average of the rows (or to last season's value, with a baseline), averaged over
// the rows in absolute value. For a linear formula that is |weight| x the stat's spread; it also works for products,
// min/max and any custom formula, because it only uses the formula evaluator.
export const rankFormulaVariables = ({
	playoffSeries,
	rows,
	formulas,
}: {
	playoffSeries: boolean;
	rows: KeyStatRow[];

	// Every formula the award can use, so variables appear even with no rows
	formulas: string[];
}): KeyStatTerm[] => {
	const variables: string[] = [];
	const seen = new Set<string>();
	for (const formula of [...formulas, ...rows.map((row) => row.formula)]) {
		for (const variable of formulaVariables(formula, playoffSeries)) {
			if (!seen.has(variable) && !NESTED_VARIABLES.includes(variable)) {
				seen.add(variable);
				variables.push(variable);
			}
		}
	}

	// Average over the rows whose formula reads the variable (with formulas by position, others may not)
	const means: Record<string, number> = {};
	for (const variable of variables) {
		let sum = 0;
		let count = 0;
		for (const row of rows) {
			if (
				!getEvaluator(row.formula, playoffSeries)?.usedVariables.has(variable)
			) {
				continue;
			}
			const value = toNumber(row.stats[variable]);
			if (value !== undefined) {
				sum += value;
				count += 1;
			}
		}
		means[variable] = count > 0 ? sum / count : 0;
	}

	const importance: Record<string, number> = {};
	for (const variable of variables) {
		let sum = 0;
		let count = 0;
		for (const row of rows) {
			const evaluator = getEvaluator(row.formula, playoffSeries);
			if (!evaluator || !evaluator.usedVariables.has(variable)) {
				continue;
			}

			let replacement;
			if (row.baseline) {
				replacement = toNumber(row.baseline[variable]);
				if (replacement === undefined) {
					continue;
				}
			} else {
				replacement = means[variable]!;
			}

			try {
				const score = evaluator.evaluate(row.stats as any);
				const scoreReplaced = evaluator.evaluate({
					...row.stats,
					[variable]: replacement,
				} as any);
				const effect = Math.abs(score - scoreReplaced);
				if (Number.isFinite(effect)) {
					sum += effect;
					count += 1;
				}
			} catch {}
		}
		importance[variable] = count > 0 ? sum / count : 0;
	}

	let total = 0;
	for (const variable of variables) {
		total += importance[variable]!;
	}

	const terms = variables.map((stat, i) => ({
		stat,
		share: total > 0 ? importance[stat]! / total : 0,
		i,
	}));
	terms.sort((a, b) => b.share - a.share || a.i - b.i);

	return terms.map(({ stat, share }) => ({ stat, share }));
};

const isShown = (stat: string) => !NOT_SHOWN.has(stat);

// Columns suggested for an award: the formula stats that move the score the most, padded with the award's usual stats
export const suggestKeyStats = (
	terms: KeyStatTerm[],
	fallback: string[],
): string[] => {
	const shown = terms.filter(
		(term) => isShown(term.stat) && !NOT_SUGGESTED.has(term.stat),
	);
	const anyShare = shown.some((term) => term.share > 0);
	const suggested = shown
		.filter((term) => !anyShare || term.share >= MIN_SHARE)
		.slice(0, MAX_SUGGESTED)
		.map((term) => term.stat);

	for (const stat of fallback) {
		if (suggested.length >= MIN_COLUMNS) {
			break;
		}
		if (stat !== "score" && !suggested.includes(stat)) {
			suggested.push(stat);
		}
	}

	return suggested;
};

// Every stat the picker offers for an award
export const pickerStats = (playoffSeries: boolean, formulaStats: string[]) => {
	const base = playoffSeries
		? PLAYOFF_SERIES_AWARD_STATS_ALL
		: AWARD_STATS_PLAIN;
	const trackingOn = advStatsOn();
	const stats = new Set<string>();
	for (const stat of [...base, ...formulaStats]) {
		if (!isShown(stat) || (!trackingOn && isTrackingAwardVar(stat))) {
			continue;
		}
		stats.add(stat);
	}
	return Array.from(stats);
};

// Titles and descriptions of stats with no stat column of their own (formula-only variables)
const SPECIAL_COLS: Record<string, { title: string; desc: string }> = {
	winp: { title: "Win%", desc: "Team winning percentage" },
	teamWs: { title: "Team WS", desc: "Team total win shares" },
	advDef: {
		title: "advDef",
		desc: "Defended FG% and rim protection vs the league, -1 to 1",
	},
	won: { title: "Won", desc: "1 for the series winner, 0 for the loser" },
	seasonFraction: {
		title: "Season%",
		desc: "Fraction of the team's season completed",
	},
	teamGp: { title: "Team G", desc: "Team games played" },
};

export type KeyStatColInfo = Record<string, { title: string; desc?: string }>;

export const colInfoFor = (stats: Iterable<string>): KeyStatColInfo => {
	const derived = new Map(TRACKING_DERIVED);
	const info: KeyStatColInfo = {};
	for (const stat of stats) {
		if (hasCol(`stat:${stat}`)) {
			continue;
		}
		const special = SPECIAL_COLS[stat];
		if (special) {
			info[stat] = special;
			continue;
		}
		const base = stat.endsWith("Playoffs")
			? stat.slice(0, -"Playoffs".length)
			: stat;
		if (base !== stat && hasCol(`stat:${base}`)) {
			info[stat] = { title: `${base} (playoffs)` };
			continue;
		}
		const desc = derived.get(base);
		info[stat] = {
			title: stat,
			desc:
				desc === undefined
					? undefined
					: `${desc}${base === stat ? "" : " (playoffs)"}`,
		};
	}
	return info;
};

export type AwardKeyStats = {
	// What the "Why these stats" note shows
	formula: string;
	byPos: boolean;
	terms: KeyStatTerm[];

	// Default columns
	suggested: string[];

	// Every stat the picker offers
	available: string[];

	colInfo: KeyStatColInfo;
};

export const getAwardKeyStats = ({
	award,
	fallback,
	rows,
}: {
	award: AwardFormulaInfo;
	fallback: string[];
	rows: KeyStatRow[];
}): AwardKeyStats => {
	const playoffSeries = typeof award.statRange === "number";
	const formula = effectiveAwardFormula(award, undefined);
	const formulas = [formula, ...Object.values(award.formulaByPos ?? {})];
	const terms = rankFormulaVariables({ formulas, playoffSeries, rows });
	const suggested = suggestKeyStats(terms, fallback);
	const available = pickerStats(playoffSeries, [
		...suggested,
		...terms.map((term) => term.stat),
	]);
	return {
		formula,
		byPos: award.formulaByPos !== undefined,
		terms,
		suggested,
		available,
		colInfo: colInfoFor([...available, ...terms.map((term) => term.stat)]),
	};
};
