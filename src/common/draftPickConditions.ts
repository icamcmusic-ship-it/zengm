// Draft pick conditions (League Extras: featureDraftPickConditions). Shared text/validation helpers, used by the
// worker and the UI. The resolution logic lives in worker/core/draft/pickConditions.ts.

import type {
	DraftPickProtection,
	DraftPickProtectionThen,
	PickConditionSpec,
	TradePickCondition,
	TradeTeams,
} from "./types.ts";

export const THEN_TEXT: Record<DraftPickProtectionThen, string> = {
	unprotected: "unprotected",
	secondRound: "converts to a 2nd round pick",
	extinguish: "extinguished",
};

const MAX_ROLLOVER = 4;

export const protectionText = (
	p: Pick<DraftPickProtection, "top" | "rollover" | "then">,
) => {
	const parts = [`top ${p.top} protected`];
	for (const top of p.rollover) {
		parts.push(`top ${top}`);
	}
	parts.push(THEN_TEXT[p.then]);
	return `${parts[0]}${parts.length > 1 ? ` (then ${parts.slice(1).join(", then ")})` : ""}`;
};

export const conditionSpecText = (spec: PickConditionSpec, abbrev?: string) => {
	if (spec.type === "protection") {
		return protectionText(spec);
	}
	return abbrev ? `swap rights to ${abbrev}` : "swap rights";
};

// Text for conditions stored on a draft pick
export const draftPickConditionText = (
	dp: { protection?: DraftPickProtection; swap?: { tid: number } },
	getAbbrev: (tid: number) => string | undefined,
) => {
	const parts: string[] = [];
	if (dp.protection) {
		const abbrev = getAbbrev(dp.protection.tid);
		parts.push(
			`${protectionText(dp.protection)}${abbrev ? `, else to ${abbrev}` : ""}`,
		);
	}
	if (dp.swap) {
		parts.push(`${getAbbrev(dp.swap.tid) ?? "???"} can swap`);
	}
	return parts.join("; ");
};

// Problem with adding this condition to this pick, or undefined if it's fine
export const validatePickConditionSpec = (
	spec: PickConditionSpec,
	dp: {
		season: number | string;
		round: number;
		protection?: unknown;
		swap?: unknown;
		pick?: number;
	},
	numPicksPerRound: number,
): string | undefined => {
	if (typeof dp.season !== "number") {
		return "Only picks in a regular draft can have conditions.";
	}
	if (dp.protection || dp.swap) {
		return "This pick already has a condition.";
	}
	if (dp.pick !== undefined && dp.pick > 0) {
		return "The draft order is already set.";
	}
	if (spec.type === "protection") {
		if (dp.round !== 1) {
			return "Only 1st round picks can be protected.";
		}
		const tops = [spec.top, ...spec.rollover];
		if (spec.rollover.length > MAX_ROLLOVER) {
			return `At most ${MAX_ROLLOVER} rollover years.`;
		}
		for (const top of tops) {
			if (
				!Number.isInteger(top) ||
				top < 1 ||
				top >= Math.max(2, numPicksPerRound)
			) {
				return `Protections must be between 1 and ${numPicksPerRound - 1}.`;
			}
		}
		if (!Object.hasOwn(THEN_TEXT, spec.then)) {
			return "Invalid protection.";
		}
	}
	return undefined;
};

export const parseRollover = (text: string) =>
	text
		.split(/[\s,>→-]+/)
		.filter((x) => x !== "")
		.map((x) => Number.parseInt(x))
		.filter((x) => !Number.isNaN(x));

// All the conditions in a 2-team trade, with the receiving team filled in
export const getTradePickConditions = (
	teams: Pick<TradeTeams[number], "tid" | "dpids" | "pickConditions">[],
): TradePickCondition[] => {
	const out: TradePickCondition[] = [];
	for (const [i, t] of teams.entries()) {
		const other = teams.length === 2 ? teams[i === 0 ? 1 : 0] : undefined;
		for (const c of t.pickConditions ?? []) {
			if (t.dpids.includes(c.dpid)) {
				out.push({ ...c, tid: c.tid ?? other?.tid });
			}
		}
	}
	return out;
};
