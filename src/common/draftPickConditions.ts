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
	if (p.top <= 0) {
		return "unprotected";
	}
	const parts = [`top ${p.top} protected`];
	for (const top of p.rollover) {
		parts.push(`top ${top}`);
	}
	parts.push(THEN_TEXT[p.then]);
	return `${parts[0]}${parts.length > 1 ? ` (then ${parts.slice(1).join(", then ")})` : ""}`;
};

export const conditionSpecText = (spec: PickConditionSpec, abbrev?: string) => {
	if (spec.type === "protection") {
		if (spec.amend) {
			return spec.top <= 0
				? "protection removed"
				: `protection changed to ${protectionText(spec)}`;
		}
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
	// For changing a protection already on the pick (spec.amend): the teams in the trade, and the team receiving the pick
	amendInfo?: { participants: number[]; toTid: number | undefined },
): string | undefined => {
	if (typeof dp.season !== "number") {
		return "Only picks in a regular draft can have conditions.";
	}
	if (spec.type === "protection" && spec.amend) {
		const protection = dp.protection as { tid?: number } | undefined;
		if (!protection || protection.tid === undefined) {
			return "This pick has no protection to change.";
		}
		if (dp.pick !== undefined && dp.pick > 0) {
			return "The draft order is already set.";
		}
		if (
			!amendInfo ||
			!amendInfo.participants.includes(protection.tid) ||
			protection.tid === amendInfo.toTid
		) {
			return "Only the team holding the protection can change it, so it has to be in the trade.";
		}
		if (spec.top <= 0) {
			return spec.top === 0 && spec.rollover.length === 0
				? undefined
				: "Invalid protection.";
		}
		return validatePickConditionSpec(
			{ ...spec, amend: undefined },
			{ ...dp, protection: undefined, swap: undefined },
			numPicksPerRound,
		);
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

type ProtectionSpec = Extract<PickConditionSpec, { type: "protection" }>;

const ASK_TOPS = [1, 3, 5, 8, 10, 14];

// Changes the AI can ask for on a protection the other team put on its own pick in a trade, from smallest to largest:
// shorter rollover, "unprotected" fallback, lower top-N, and finally no protection at all (undefined)
export const getProtectionLoosenings = (
	spec: ProtectionSpec,
	// Loosening a protection already stored on the pick: the results replace it, and removing it is top 0
	amend?: boolean,
): (ProtectionSpec | undefined)[] => {
	if (amend) {
		return getProtectionLoosenings({ ...spec, amend: undefined }).map((x) =>
			x
				? { ...x, amend: true as const }
				: {
						type: "protection" as const,
						top: 0,
						rollover: [],
						then: "unprotected" as const,
						amend: true as const,
					},
		);
	}
	const out: (ProtectionSpec | undefined)[] = [];
	if (spec.rollover.length > 0) {
		out.push({ ...spec, rollover: spec.rollover.slice(0, -1) });
	}
	if (spec.then !== "unprotected") {
		out.push({ ...spec, then: "unprotected" });
	}
	for (const top of ASK_TOPS.filter((top) => top < spec.top).reverse()) {
		out.push({
			...spec,
			top,
			rollover: spec.rollover.map((x) => Math.min(x, top)),
		});
	}
	out.push(undefined);
	return out;
};

// Protections the AI may accept on a 1st round pick it receives, when it's getting more than it needs
export const getAcceptableProtections = (
	numPicksPerRound: number,
): ProtectionSpec[] =>
	[3, 5, 10]
		.filter((top) => top < numPicksPerRound / 2)
		.map((top) => ({
			type: "protection" as const,
			top,
			rollover: [],
			then: "unprotected" as const,
		}));

// Text for the AI asking to change a condition on one of the other team's picks, like "the top 10 protection on your 2027 1st lowered to top 5"
export const pickConditionChangeText = (
	before: PickConditionSpec | undefined,
	after: PickConditionSpec | undefined,
	pickText: string,
) => {
	if (after?.type === "protection" && after.amend) {
		// before is the protection stored on the pick
		const removed = after.top <= 0;
		if (before?.type === "protection") {
			if (removed) {
				return `They want the existing top ${before.top} protection on ${pickText} removed.`;
			}
			if (
				after.top < before.top &&
				after.then === before.then &&
				after.rollover.length === before.rollover.length
			) {
				return `They want the existing top ${before.top} protection on ${pickText} lowered to top ${after.top}.`;
			}
		}
		return removed
			? `They want the existing protection on ${pickText} removed.`
			: `They want the existing protection on ${pickText} changed to ${protectionText(after)}.`;
	}
	if (before?.type === "protection" && !after) {
		return `They want the top ${before.top} protection on ${pickText} removed.`;
	}
	if (!before && after) {
		return `They'll accept ${conditionSpecText(after)} on ${pickText}.`;
	}
	if (before?.type === "protection" && after?.type === "protection") {
		if (
			after.top < before.top &&
			after.then === before.then &&
			after.rollover.length === before.rollover.length
		) {
			return `They want the top ${before.top} protection on ${pickText} lowered to top ${after.top}.`;
		}
		return `They want the protection on ${pickText} changed from ${protectionText(before)} to ${protectionText(after)}.`;
	}
	return undefined;
};

const specKey = (c: PickConditionSpec | undefined) =>
	c ? JSON.stringify({ ...c, dpid: undefined, tid: undefined }) : "";

// Conditions on the user's (teams[0]) picks that changed between two versions of a trade
export const getPickConditionChanges = (
	before: Pick<TradeTeams[number], "dpids" | "pickConditions">,
	after: Pick<TradeTeams[number], "dpids" | "pickConditions">,
) => {
	const changes: {
		dpid: number;
		before: TradePickCondition | undefined;
		after: TradePickCondition | undefined;
	}[] = [];
	for (const dpid of after.dpids) {
		if (!before.dpids.includes(dpid)) {
			continue;
		}
		const b = before.pickConditions?.find((c) => c.dpid === dpid);
		const a = after.pickConditions?.find((c) => c.dpid === dpid);
		if (specKey(b) !== specKey(a)) {
			changes.push({ dpid, before: b, after: a });
		}
	}
	return changes;
};
