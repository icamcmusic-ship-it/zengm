/**
 * Mock draft (League extras "Mock Draft", basketball). A dry run of the AI draft logic in runPicks.ts: each team on the
 * clock scores every available prospect by value plus the same bounded adjustments the real AI uses (need/strategy from
 * draftNeeds.ts when "AI Drafts by Need" is on, player traits when they are on) and picks with the same weighted random
 * choice (score ** 69). Nothing is saved. Each pick comes with the reason the adjustment points to.
 *
 * Ported in spirit from the Draft Workshop's mock draft (bbgmdraft js/pro.js), but with BBGM's own teams, pick order and
 * AI draft logic instead of invented ones.
 */
import type { DraftPick } from "../../../common/types.ts";
import { helpers } from "../../../common/helpers.ts";
import { resolvePickConditionsPure } from "./pickConditions.ts";
import {
	getDraftAdjustment,
	getDraftTraitAdjustment,
	type TeamNeeds,
} from "./draftNeeds.ts";

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
};

export type MockTeam = {
	tid: number;
	needs: TeamNeeds;
	strategy: "contending" | "rebuilding" | undefined;
	// AI GM personalities (setting): the GM's need vs best available weight, like the real draft
	needScale?: number;
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

const GROUP_NAMES: Record<keyof TeamNeeds, string> = {
	G: "guard",
	F: "wing",
	C: "big",
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

export const runMockDraft = ({
	slots,
	prospects,
	teams,
	useNeeds,
	useTraits,
	random = Math.random,
}: {
	slots: MockSlot[];
	prospects: MockProspect[];
	teams: Map<number, MockTeam>;
	useNeeds: boolean;
	useTraits: boolean;
	random?: () => number;
}): MockPick[] => {
	let pool = [...prospects].sort((a, b) => b.value - a.value);
	const picks: MockPick[] = [];

	for (const slot of slots) {
		if (pool.length === 0) {
			break;
		}
		const team = teams.get(slot.tid);
		const parts = pool.map((p) => {
			const need =
				useNeeds && team
					? getDraftAdjustment(p, team.needs, undefined, team.needScale)
					: 0;
			const needAndStrategy =
				useNeeds && team
					? getDraftAdjustment(p, team.needs, team.strategy, team.needScale)
					: 0;
			const trait =
				useTraits && p.traitFactors?.[slot.tid] !== undefined
					? getDraftTraitAdjustment(p.value, p.traitFactors[slot.tid]!)
					: 0;
			const combine = p.combine ?? 0;
			return {
				p,
				need,
				strategy: needAndStrategy - need,
				trait,
				combine,
				score: Math.max(0, p.value + needAndStrategy + trait + combine),
			};
		});
		const chosen = weightedChoice(parts, (x) => x.score, random);
		const best = pool[0]!;

		const reasons: string[] = [];
		if (chosen.p === best) {
			reasons.push("Best available");
		}
		if (team && chosen.need >= 0.6) {
			reasons.push(
				`Fills the need at ${GROUP_NAMES[topNeedGroup(team.needs)]}`,
			);
		}
		if (team && chosen.strategy >= 0.4) {
			reasons.push(
				team.strategy === "rebuilding"
					? "Rebuilding: bets on the ceiling"
					: "Contending: ready to help now",
			);
		}
		if (chosen.trait >= 0.75) {
			reasons.push("Likes his traits");
		}
		if (chosen.combine >= 0.3) {
			reasons.push("Combine riser");
		}
		if (reasons.length === 0) {
			reasons.push(
				chosen.score >= Math.max(...parts.map((x) => x.score))
					? "Best fit for the team"
					: "Team preference",
			);
		}
		const overall = picks.length + 1;
		const diff = chosen.p.scoutRank - overall;
		if (diff >= 8) {
			reasons.push(`Steal: No. ${chosen.p.scoutRank} on your board`);
		} else if (diff <= -8) {
			reasons.push(`Reach: No. ${chosen.p.scoutRank} on your board`);
		}

		picks.push({
			...slot,
			overall,
			pid: chosen.p.pid,
			scoutRank: chosen.p.scoutRank,
			reasons,
		});
		pool = pool.filter((p) => p !== chosen.p);
	}

	return picks;
};
