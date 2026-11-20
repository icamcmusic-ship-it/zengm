// AI GM finance styles (core "gmFinance", basketball, with AI GM Personalities and the budget): the worker side. Formulas and styles in
// common/gmFinance.ts. Each helper returns the neutral value (no change) when the feature is off, the team is run by the user or it has
// no GM, so every caller keeps its old code path. No random numbers are drawn here (styles come from a seeded stream keyed on the GM id).
// Kept free of imports from other core modules (ownerOffice, commercial, frontOffice import this file).

import type { OwnerType } from "../../../common/commercial.ts";
import {
	GM_FINANCE_BOUNDS,
	effectiveGmFinanceProfile,
	getGmFinanceStyle,
	type GmFinanceProfile,
	type GmFinanceStyle,
} from "../../../common/gmFinance.ts";
import type { Gm, Team } from "../../../common/types.ts";
import { g, local } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";

export const gmFinanceEnabled = () =>
	__SPORT === "basketball" &&
	featureOn("gmFinance") &&
	featureOn("gmPersonalities") &&
	!!g.get("budget");

const aiRuns = (tid: number) =>
	!(
		g.get("userTids").includes(tid) &&
		!local.autoPlayUntil &&
		!g.get("spectator")
	);

// Like commercial.getOwnerType (not imported, to avoid an import cycle)
const ownerTypeOf = (t: Pick<Team, "commercial">): OwnerType =>
	__SPORT === "basketball" && featureOn("commercial") && !!g.get("budget")
		? (t.commercial?.ownerType ?? "traditional")
		: "traditional";

// A GM's style when the feature is on (for display, news), else undefined
export const gmFinanceStyleOf = (gm: Gm): GmFinanceStyle | undefined =>
	gmFinanceEnabled() ? getGmFinanceStyle(gm) : undefined;

// The finance profile an AI team runs on (its GM's style within its owner's envelope), undefined when it doesn't apply
export const getTeamFinanceProfile = (
	t: Pick<Team, "tid" | "gm" | "commercial">,
): GmFinanceProfile | undefined => {
	if (!t.gm || !gmFinanceEnabled() || !aiRuns(t.tid)) {
		return;
	}
	return effectiveGmFinanceProfile(getGmFinanceStyle(t.gm), ownerTypeOf(t));
};

const clamp = (x: number, min: number, max: number) =>
	x < min ? min : x > max ? max : x;

// Budget levels added to the AI team's spending level (preseason)
export const gmSpendNudge = (t: Pick<Team, "tid" | "gm" | "commercial">) => {
	const p = getTeamFinanceProfile(t);
	return p
		? clamp(p.spend, -GM_FINANCE_BOUNDS.spend, GM_FINANCE_BOUNDS.spend)
		: 0;
};

// Department multipliers (preseason allocation)
export const gmDeptMultipliers = (t: Pick<Team, "tid" | "gm" | "commercial">) =>
	getTeamFinanceProfile(t)?.dept;

// Multiplier on the AI's automatic ticket price
export const gmTicketFactor = (t: Pick<Team, "tid" | "gm" | "commercial">) => {
	const p = getTeamFinanceProfile(t);
	return p
		? clamp(p.ticket, GM_FINANCE_BOUNDS.ticketMin, GM_FINANCE_BOUNDS.ticketMax)
		: 1;
};

// Shifts of the GM's tax tolerance and free agency traits, for his decision weights (gm/index.ts weightsOf)
export const gmTraitShifts = (t: Pick<Team, "tid" | "gm" | "commercial">) => {
	const p = getTeamFinanceProfile(t);
	if (!p) {
		return { taxTolerance: 0, faStars: 0 };
	}
	return {
		taxTolerance: clamp(p.tax, -GM_FINANCE_BOUNDS.tax, GM_FINANCE_BOUNDS.tax),
		faStars: clamp(p.faStars, -0.3, 0.3),
	};
};

// Owner's Office AI project starts: chance and cash reserve (salary caps beyond the cost)
export const gmProjectParams = (
	t: Pick<Team, "tid" | "gm" | "commercial">,
	baseProb: number,
) => {
	const p = getTeamFinanceProfile(t);
	if (!p) {
		return { prob: baseProb, reserve: 1 };
	}
	return {
		prob: Math.min(GM_FINANCE_BOUNDS.projectProbMax, baseProb * p.projectProb),
		reserve: clamp(p.projectReserve, 0.5, 2),
	};
};

// Commercial deals: the GM's preferred style, if any
export const gmDealStyle = (t: Pick<Team, "tid" | "gm" | "commercial">) =>
	getTeamFinanceProfile(t)?.dealStyle;
