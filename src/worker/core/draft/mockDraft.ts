/**
 * Mock draft (League extras "Mock Draft", basketball). A dry run of the AI draft logic in runPicks.ts: each team on the
 * clock scores every available prospect with the same decision as the real AI (draftDecision.ts: value plus bounded need,
 * fit, timeline, production, combine, medical and GM factors) and picks with the same weighted random choice (score ** 69).
 * Nothing is saved. Each pick comes with the same Why as a real pick (explainPick), plus reach/steal against your board.
 *
 * Ported in spirit from the Draft Workshop's mock draft (bbgmdraft js/pro.js), but with BBGM's own teams, pick order and
 * AI draft logic instead of invented ones.
 */
import type { DraftPick } from "../../../common/types.ts";
import { helpers } from "../../../common/helpers.ts";
import { resolvePickConditionsPure } from "./pickConditions.ts";
import { getDraftTraitAdjustment, type TeamNeeds } from "./draftNeeds.ts";
import {
	decideDraft,
	explainPick,
	type ProspectFacts,
	type TeamDraftContext,
} from "./draftDecision.ts";

export type MockProspect = {
	pid: number;
	// The true value, which the AI drafts by (as in runPicks)
	value: number;
	// True ratings, for the need/strategy adjustment
	ratings: { pos: string; ovr: number; pot: number }[];
	// Rank on the user's (fuzzed) scouting list, 1 = best
	scoutRank: number;
	// Trait value factor for each team (tid -> factor), when player traits are on
	traitFactors?: Record<number, number>;
	// Draft Lottery Night & Combine setting: the AI's combine nudge (value points), as in runPicks
	combine?: number;
	// Age-adjusted pre-draft production against his class (value points, bounded), as in runPicks
	production?: number;
	// Everything the AI reads of him (draftDecisionData.ts buildClassFacts); without it, the fields above
	facts?: ProspectFacts;
};

export type MockTeam = {
	tid: number;
	needs: TeamNeeds;
	strategy: "contending" | "rebuilding" | undefined;
	// AI GM personalities (setting): the GM's need vs best available weight, like the real draft
	needScale?: number;
	// The whole team context of the real draft (draftDecisionData.ts buildTeamDraftContext); without it, the fields above
	ctx?: TeamDraftContext;
};

export type MockSlot = {
	dpid: number;
	round: number;
	pick: number;
	tid: number;
	originalTid: number;
	// What a protection or swap did to this pick
	note?: string;
};

/**
 * Pick protections and swaps for an order (picks with their pick numbers), as a dry run: the same resolution as the real
 * draft (resolvePickConditionsPure, also used by genOrder), on copies, so nothing is saved and no news is logged. Returns
 * the slots of the first `rounds` rounds in order, with who ends up holding each pick and a note on what happened.
 */
export const pickConditionsDryRun = ({
	draftPicks,
	futurePicks,
	shortName,
	rounds,
}: {
	draftPicks: DraftPick[];
	futurePicks: DraftPick[];
	shortName: (tid: number) => string;
	rounds: number;
}): MockSlot[] => {
	const picks = helpers.deepCopy(draftPicks);
	let notes = new Map<DraftPick, string>();
	if (picks.some((dp) => dp.protection || dp.swap)) {
		({ notes } = resolvePickConditionsPure({
			draftPicks: picks,
			futurePicks: helpers.deepCopy(futurePicks),
			teamName: shortName,
			shortName,
		}));
	}
	return picks
		.filter((dp) => dp.pick > 0 && dp.round <= rounds)
		.sort((a, b) => a.round - b.round || a.pick - b.pick)
		.map((dp) => ({
			dpid: dp.dpid,
			round: dp.round,
			pick: dp.pick,
			tid: dp.tid,
			originalTid: dp.originalTid,
			note: notes.get(dp),
		}));
};

export type MockPick = MockSlot & {
	overall: number;
	pid: number;
	scoutRank: number;
	reasons: string[];
};

// Same exponent as the real AI (runPicks.ts): almost always the top score, sometimes the next one
export const SCORE_EXPONENT = 69;

const weightedChoice = <T>(
	items: T[],
	weight: (item: T) => number,
	random: () => number,
) => {
	const weights = items.map(weight);
	// Normalize by the max first, x ** 69 overflows otherwise
	const max = Math.max(...weights);
	if (!(max > 0)) {
		return items[0]!;
	}
	const scaled = weights.map((w) => (w / max) ** SCORE_EXPONENT);
	const total = scaled.reduce((a, b) => a + b, 0);
	let r = random() * total;
	for (let i = 0; i < items.length; i++) {
		r -= scaled[i]!;
		if (r <= 0) {
			return items[i]!;
		}
	}
	return items.at(-1)!;
};

export const topNeedGroup = (needs: TeamNeeds) =>
	(["G", "F", "C"] as const).reduce((a, b) => (needs[b] > needs[a] ? b : a));

const factsOf = (p: MockProspect): ProspectFacts => {
	if (p.facts) {
		return p.facts;
	}
	const r = p.ratings.at(-1)!;
	return {
		pid: p.pid,
		value: p.value,
		age: 20,
		ovr: r.ovr,
		pot: r.pot,
		pos: r.pos,
		skills: [],
		combinePerf: p.combine,
		production: p.production,
	};
};

const contextOf = (
	tid: number,
	team: MockTeam | undefined,
	prospects: MockProspect[],
	useNeeds: boolean,
	useTraits: boolean,
): TeamDraftContext => {
	const base: TeamDraftContext = team?.ctx
		? { ...team.ctx }
		: {
				tid,
				needs: team?.needs,
				// (no roster: no skill need, crowding or stash)
				groupCounts: { G: 2, F: 2, C: 2 },
				youngCore: { G: 0, F: 0, C: 0 },
				teamSkills: { "3": 1, B: 1, Ps: 1, Di: 1, Dp: 1, R: 1, Po: 1, A: 1 },
				strategy: team?.strategy,
				rosterSize: 13,
				maxRosterSize: 15,
				gm:
					team?.needScale !== undefined
						? {
								traits: {
									patience: 0,
									analytics: 0,
									risk: 0,
									taxTolerance: 0,
									pickValue: 0,
									tradeFreq: 0,
									loyalty: 0,
									faStars: 0,
									draftBPA: 0,
									draftUpside: 0,
								},
								draftNeedScale: team.needScale,
								draftUpside: 0,
							}
						: undefined,
			};
	if (!useNeeds) {
		base.needs = undefined;
	}
	if (!team?.ctx || !useTraits) {
		base.trait = useTraits
			? new Map(
					prospects
						.filter((p) => p.traitFactors?.[tid] !== undefined)
						.map((p) => [
							p.pid,
							getDraftTraitAdjustment(p.value, p.traitFactors![tid]!),
						]),
				)
			: undefined;
	}
	return base;
};

export const runMockDraft = ({
	slots,
	prospects,
	teams,
	useNeeds,
	useTraits,
	random = Math.random,
	firstOverall = 1,
	numTeams = Math.max(
		1,
		slots.filter((s) => s.round === slots[0]?.round).length,
	),
}: {
	slots: MockSlot[];
	prospects: MockProspect[];
	teams: Map<number, MockTeam>;
	useNeeds: boolean;
	useTraits: boolean;
	random?: () => number;
	// Overall number of the first slot. 1 = the whole draft; during the draft (Frozen Pre-draft Ranks setting), the next real pick, so a
	// steal or reach compares the pick with the frozen pre-draft rank on the same scale
	firstOverall?: number;
	// Teams per round (the pick scale of the fit factors)
	numTeams?: number;
}): MockPick[] => {
	let pool = [...prospects].sort((a, b) => b.value - a.value);
	const picks: MockPick[] = [];
	const contexts = new Map<number, TeamDraftContext>();

	for (const slot of slots) {
		if (pool.length === 0) {
			break;
		}
		let ctx = contexts.get(slot.tid);
		if (!ctx) {
			ctx = contextOf(
				slot.tid,
				teams.get(slot.tid),
				prospects,
				useNeeds,
				useTraits,
			);
			contexts.set(slot.tid, ctx);
		}
		const overall = firstOverall + picks.length;
		const decisions = decideDraft({
			pool: pool.map(factsOf),
			team: ctx,
			overall,
			numTeams,
		});
		const chosenIndex = weightedChoice(
			decisions.map((_, i) => i),
			(i) => decisions[i]!.score,
			random,
		);
		const chosen = pool[chosenIndex]!;

		const reasons = explainPick({
			decisions,
			chosenPid: chosen.pid,
			team: ctx,
		});
		const diff = chosen.scoutRank - overall;
		if (diff >= 8) {
			reasons.push(`Steal: No. ${chosen.scoutRank} on your board`);
		} else if (diff <= -8) {
			reasons.push(`Reach: No. ${chosen.scoutRank} on your board`);
		}

		picks.push({
			...slot,
			overall,
			pid: chosen.pid,
			scoutRank: chosen.scoutRank,
			reasons,
		});
		pool = pool.filter((p) => p !== chosen);
	}

	return picks;
};
