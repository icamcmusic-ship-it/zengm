/**
 * AI draft decision (basketball): how an AI team scores each prospect still on the board, and the "Why" behind the pick it makes.
 * Pure, shared by the real draft (runPicks.ts), the Mock Draft (mockDraft.ts) and draft-night trade boards (draftNightTrades.ts).
 *
 * A prospect's score is his value (the true value the AI drafts by, as always) plus bounded adjustments in value points. Two kinds:
 *
 * - Fit (scaled by the pick: 0.3 at No. 1, full from about pick 19, 1.15 in later rounds, so the best player available dominates the top of
 *   the draft and needs matter more later): positional need, archetype/skill need, roster crowding, timeline (contender floor / rebuilder
 *   ceiling, from projection cones), positional scarcity in what's left, coach system fit, draft-and-stash, the GM's finance style.
 * - Information (not scaled): age-adjusted production (draft/production.ts) and the outlets' consensus (what the AI reads beyond value), combine athleticism and
 *   performance, medical risk, scout disagreement (outlet spread) through the GM's risk tolerance, the GM's lens, upside lean and traits.
 *
 * The total is capped (±1.2 value points at No. 1, up to ±3.5 from the second round), so a prospect clearly better by value still goes
 * first; only near ties are decided by fit. The weights are in FACTOR_WEIGHTS and docs/native-features.md.
 *
 * The "Why" (explainPick) is computed from the same parts: the factors where the chosen prospect beat the best alternative (the best
 * player by value when he isn't it, else the runner-up by score), largest first, deduped, at most 4, never with a hidden number.
 */
import { coneNumbers } from "../../../common/scoutingReports/cone.ts";
import {
	MEDICAL_DRAFT_PENALTY,
	medicalGradeOf,
} from "../../../common/draftCombine.ts";
import { gmDraftUpsideAdjustment } from "../../../common/gmPersonality.ts";
import type { GmFinanceStyle } from "../../../common/gmFinance.ts";
import type { GmTraits } from "../../../common/types.gm.ts";
import {
	getDraftAdjustment,
	primaryGroup,
	type Group,
	type TeamNeeds,
} from "./draftNeeds.ts";

export type ProspectFacts = {
	pid: number;
	// True value (the AI's board, as always)
	value: number;
	age: number;
	ovr: number;
	pot: number;
	pos: string;
	skills: string[];
	// Rank by value in his class when the draft started (1 = best)
	valueRank?: number;
	// Big boards (media outlets): the consensus rank and the production outlet's rank, 0/undefined = off the board
	consensusRank?: number;
	prodModelRank?: number;
	// Age-adjusted pre-draft production against his class (draft/production.ts getDraftProductionNudges), value points, ±1.5
	production?: number;
	// Scout disagreement: how far apart the outlets' boards are on him (z over the class; positive = more split)
	spread?: number;
	// Combine: the performance nudge (value points, averages zero over the class) and the athletic score (percentile)
	combinePerf?: number;
	athletic?: number;
	// Pre-draft injuries & combine medicals: his actual medical risk (what the AI drafts on)
	medicalRisk?: number;
	// Draft-and-stash: his last season before the draft was with a club overseas
	stashable?: boolean;
	// Coach systems: how he fits each offense and defense system (playerSchemeFit, in standard deviations)
	schemeFit?: { off: Record<string, number>; def: Record<string, number> };
};

export type TeamDraftContext = {
	tid: number;
	// Positional need (undefined: AI Drafts by Need is off, so no fit factors)
	needs?: TeamNeeds;
	// Players under contract by the group they mostly play
	groupCounts: Record<Group, number>;
	// Young (25 or under) players in the top 10 of the roster by group
	youngCore: Record<Group, number>;
	// How many of the top 8 players have each skill label
	teamSkills: Record<string, number>;
	strategy?: "contending" | "rebuilding";
	rosterSize: number;
	maxRosterSize: number;
	// AI GM personalities
	gm?: { traits: GmTraits; draftNeedScale: number; draftUpside: number };
	financeStyle?: GmFinanceStyle;
	// Head coach's systems (coach systems setting)
	system?: { off: string; def: string; offName: string; defName: string };
	// Precomputed per prospect: player traits nudge, the GM's analytics/old-school lens
	trait?: Map<number, number>;
	lens?: Map<number, number>;
	// Draft-night trade that brought this pick: traded up for target, or moved down hoping target lasts
	move?: { kind: "up" | "down"; overall: number; target: number };
};

export type FactorKey =
	| "need"
	| "skill"
	| "crowd"
	| "timeline"
	| "scarcity"
	| "scheme"
	| "stash"
	| "finance"
	| "production"
	| "consensus"
	| "athletic"
	| "combine"
	| "medical"
	| "uncertainty"
	| "gmUpside"
	| "lens"
	| "traits";

export type ProspectDecision = {
	facts: ProspectFacts;
	parts: Partial<Record<FactorKey, number>>;
	adj: number;
	score: number;
	cone: { floor: number; median: number; ceiling: number };
};

// The weights, in value points (each factor's maximum before the pick scale and the total cap)
export const FACTOR_WEIGHTS = {
	// Positional need: getDraftAdjustment (draftNeeds.ts), ±2, times the GM's need scale
	needMax: 2,
	// Each skill the prospect has that none of the top 8 players has (at most 2)
	skillPer: 0.3,
	// Three or more young players at his position in the top 10: minutes blocked
	crowd3: -0.5,
	crowd2: -0.2,
	// Per point above the average of the players near the top of what is left: contenders half cone floor, half ovr now (ready now);
	// rebuilders the cone ceiling. Capped
	timelinePer: 0.08,
	timelineMax: 1.2,
	// He is the last (or second last) of his position near the top of what's left, for a team that needs it
	scarcity1: 0.4,
	scarcity2: 0.2,
	// Per standard deviation of fit to the head coach's systems
	schemePer: 0.25,
	schemeMax: 0.5,
	// Draft-and-stash pick (after No. 10) for a full roster or a contender; frugal GMs like the cheap rights more
	stash: 0.5,
	stashFrugal: 0.25,
	// Development-first front office: per point of ceiling above the pool's average
	financePer: 0.04,
	financeMax: 0.4,
	// Age-adjusted production nudge (±1.5, draft/production.ts) times 1 + this × the GM's analytics lean (+ more for an analytics front office)
	productionAnalytics: 0.4,
	productionFinance: 0.2,
	// Per rank the consensus has him above his value rank (old-school GMs trust it more)
	consensusPer: 0.02,
	consensusMaxRanks: 20,
	// Per 25 percentile points of combine athleticism above the middle
	athleticPer: 0.2,
	// Gambler (+) / cautious (-) GM per standard deviation of scout disagreement
	uncertaintyPer: 0.3,
} as const;

// The pick scale of the fit factors: best player available at the top, needs matter more later
export const pickScale = (overall: number, numTeams: number) =>
	overall > numTeams
		? 1.15
		: 0.3 + 0.7 * Math.min(1, (overall - 1) / Math.max(1, 0.6 * numTeams));

// Cap on the total adjustment, value points
export const adjustmentCap = (overall: number, numTeams: number) =>
	1.2 + 2.3 * Math.min(1, (overall - 1) / Math.max(1, numTeams));

const clamp = (x: number, lo: number, hi: number) =>
	x < lo ? lo : x > hi ? hi : x;

const TRACKED_SKILLS = ["3", "B", "Ps", "Di", "Dp", "R", "Po", "A"];

// A prospect's cone, the way an AI front office would draw it (true ratings; the outlets' disagreement widens it)
export const aiCone = (f: ProspectFacts) =>
	coneNumbers({
		ovr: f.ovr,
		pot: f.pot,
		age: f.age,
		u: 2.5 + 1.5 * Math.max(0, f.spread ?? 0),
		optimism: 0,
	});

/**
 * Score every prospect left (pool, best value first) for a team at an overall pick.
 */
export const decideDraft = ({
	pool,
	team,
	overall,
	numTeams,
}: {
	pool: ProspectFacts[];
	team: TeamDraftContext;
	overall: number;
	numTeams: number;
}): ProspectDecision[] => {
	const scale = pickScale(overall, numTeams);
	const cap = adjustmentCap(overall, numTeams);
	const traits = team.gm?.traits;
	const analytics = traits?.analytics ?? 0;
	const risk = traits?.risk ?? 0;
	const patience = traits?.patience ?? 0;
	const needScale = team.gm?.draftNeedScale ?? 1;
	const W = FACTOR_WEIGHTS;

	const sorted = [...pool].sort((a, b) => b.value - a.value);
	const cones = new Map(sorted.map((f) => [f.pid, aiCone(f)]));
	// Cone averages of the players near the top of what's left
	const near = sorted.slice(0, Math.min(sorted.length, 30));
	const meanOf = (key: "floor" | "ceiling") =>
		near.reduce((a, f) => a + cones.get(f.pid)![key], 0) /
		Math.max(1, near.length);
	const meanFloor = meanOf("floor");
	const meanCeiling = meanOf("ceiling");
	const meanOvr =
		near.reduce((a, f) => a + f.ovr, 0) / Math.max(1, near.length);
	const topIndex = new Map(sorted.map((f, i) => [f.pid, i]));

	return pool.map((f): ProspectDecision => {
		const cone = cones.get(f.pid)!;
		const parts: Partial<Record<FactorKey, number>> = {};
		const group = primaryGroup(f.pos);

		if (team.needs) {
			parts.need =
				scale *
				getDraftAdjustment(
					{ value: f.value, ratings: [f] },
					team.needs,
					undefined,
					needScale,
				);
			const lacking = f.skills.filter(
				(s) => TRACKED_SKILLS.includes(s) && !(team.teamSkills[s]! > 0),
			);
			parts.skill =
				scale * W.skillPer * Math.min(2, lacking.length) * needScale;
			const young = team.youngCore[group];
			parts.crowd =
				scale *
				needScale *
				(young >= 3 ? W.crowd3 : young === 2 ? W.crowd2 : 0);

			if (team.strategy) {
				const align = team.strategy === "contending" ? -patience : patience;
				const x =
					team.strategy === "contending"
						? 0.5 * (cone.floor - meanFloor) + 0.5 * (f.ovr - meanOvr)
						: cone.ceiling - meanCeiling;
				parts.timeline =
					scale *
					(1 + 0.4 * align) *
					clamp(W.timelinePer * x, -W.timelineMax, W.timelineMax);
			}

			// Scarcity: few others like him near the top of what's left, at a position the team needs
			const idx = topIndex.get(f.pid)!;
			if (idx < 12 && team.needs[group] > 0.03) {
				let others = 0;
				for (const other of sorted.slice(0, 9)) {
					if (other !== f && primaryGroup(other.pos) === group) {
						others += 1;
					}
				}
				parts.scarcity =
					scale * (others === 0 ? W.scarcity1 : others === 1 ? W.scarcity2 : 0);
			}

			if (
				f.stashable &&
				overall > 10 &&
				(team.rosterSize >= team.maxRosterSize ||
					team.strategy === "contending")
			) {
				parts.stash =
					scale *
					(W.stash + (team.financeStyle === "frugal" ? W.stashFrugal : 0));
			}
		}

		if (team.system && f.schemeFit) {
			const fit =
				0.6 * (f.schemeFit.off[team.system.off] ?? 0) +
				0.4 * (f.schemeFit.def[team.system.def] ?? 0);
			parts.scheme =
				scale * clamp(W.schemePer * fit, -W.schemeMax, W.schemeMax);
		}

		if (team.financeStyle === "development") {
			parts.finance =
				scale *
				clamp(
					W.financePer * (cone.ceiling - meanCeiling),
					-W.financeMax,
					W.financeMax,
				);
		}

		if (f.production) {
			// Analytics GMs (and analytics-first front offices) lean on it more, old-school ones less
			parts.production =
				f.production *
				clamp(
					1 +
						W.productionAnalytics * analytics +
						(team.financeStyle === "analytics" ? W.productionFinance : 0),
					0.5,
					1.6,
				);
		}
		if (f.consensusRank && f.valueRank) {
			parts.consensus =
				W.consensusPer *
				clamp(
					f.valueRank - f.consensusRank,
					-W.consensusMaxRanks,
					W.consensusMaxRanks,
				) *
				(1 - 0.5 * analytics);
		}
		if (f.athletic !== undefined) {
			parts.athletic =
				W.athleticPer *
				clamp((f.athletic - 50) / 25, -2, 2) *
				(1 - 0.3 * analytics);
		}
		if (f.combinePerf) {
			parts.combine = f.combinePerf;
		}
		if (f.medicalRisk !== undefined) {
			parts.medical =
				-MEDICAL_DRAFT_PENALTY[medicalGradeOf(f.medicalRisk)] *
				(1 - 0.4 * risk);
		}
		if (traits && f.spread !== undefined) {
			parts.uncertainty = W.uncertaintyPer * risk * clamp(f.spread, -2, 2);
		}
		if (team.gm) {
			parts.gmUpside = gmDraftUpsideAdjustment(team.gm, f);
		}
		const lens = team.lens?.get(f.pid);
		if (lens) {
			parts.lens = lens;
		}
		const trait = team.trait?.get(f.pid);
		if (trait) {
			parts.traits = trait;
		}

		let raw = 0;
		for (const x of Object.values(parts)) {
			raw += x!;
		}
		const adj = clamp(raw, -cap, cap);
		// A capped total scales every part alike, so the Why stays true to what moved the score
		if (raw !== 0 && adj !== raw) {
			const k = adj / raw;
			for (const key of Object.keys(parts) as FactorKey[]) {
				parts[key]! *= k;
			}
		}
		return {
			facts: f,
			parts,
			adj,
			score: Math.max(0, f.value + adj),
			cone,
		};
	});
};

// ---- Why ----

const GROUP_NAMES: Record<Group, [string, string]> = {
	G: ["guard", "guards"],
	F: ["wing", "wings"],
	C: ["big", "bigs"],
};

const SKILL_PHRASES: Record<string, string> = {
	"3": "shooting",
	B: "ball handling",
	Ps: "playmaking",
	Di: "rim protection",
	Dp: "perimeter defense",
	R: "rebounding",
	Po: "post scoring",
	A: "athleticism",
};

export const BEST_AVAILABLE_REASON = "Best player available on their board";

// Smallest difference in a factor (value points) that counts as moving the decision. Medicals only for a red flag (a minor concern is
// common and small), traits only when clearly ahead (nearly every prospect has some trait nudge)
const MIN_DELTA = 0.15;
const MIN_DELTA_BY_KEY: Partial<Record<FactorKey, number>> = {
	medical: 0.6,
	traits: 0.3,
};
// A medical penalty this big is a red flag (MEDICAL_DRAFT_PENALTY, even for a gambler GM)
const RED_FLAG_PARTS = -0.6;

const factorText = (
	key: FactorKey,
	chosen: ProspectDecision,
	alt: ProspectDecision | undefined,
	team: TeamDraftContext,
): string | undefined => {
	const c = chosen.parts[key] ?? 0;
	const a = alt?.parts[key] ?? 0;
	const own = c >= Math.abs(a) || c > 0.1;
	const group = primaryGroup(chosen.facts.pos);
	const [one, many] = GROUP_NAMES[group];
	const traits = team.gm?.traits;
	switch (key) {
		case "need": {
			if (own) {
				const n = team.groupCounts[group];
				return n === 0
					? `Fills a need at ${one} (no ${many} under contract)`
					: n === 1
						? `Fills a need at ${one} (only one ${one} under contract)`
						: `Fills a need at ${one}`;
			}
			return alt
				? `Already deep at ${GROUP_NAMES[primaryGroup(alt.facts.pos)][0]}`
				: undefined;
		}
		case "skill": {
			const lacking = chosen.facts.skills.filter(
				(s) => SKILL_PHRASES[s] && !(team.teamSkills[s]! > 0),
			);
			return own && lacking[0]
				? `Adds ${SKILL_PHRASES[lacking[0]]} they lack`
				: undefined;
		}
		case "crowd":
			return alt
				? `Minutes blocked for the other option: crowded at ${GROUP_NAMES[primaryGroup(alt.facts.pos)][0]}`
				: undefined;
		case "timeline": {
			if (team.strategy === "contending") {
				return "Contender: ready to play now";
			}
			const width = chosen.cone.ceiling - chosen.cone.floor;
			return width >= 18
				? "Upside swing (wide cone, high ceiling)"
				: "Rebuilding: bets on the ceiling";
		}
		case "scarcity":
			return `Last ${one} of his tier left on the board`;
		case "scheme": {
			const fit = chosen.facts.schemeFit;
			if (!team.system || !fit) {
				return undefined;
			}
			const off = 0.6 * (fit.off[team.system.off] ?? 0);
			const def = 0.4 * (fit.def[team.system.def] ?? 0);
			return off >= def
				? `Fits their ${team.system.offName} system`
				: `Fits their ${team.system.defName} defense`;
		}
		case "stash":
			return team.rosterSize >= team.maxRosterSize
				? "Draft-and-stash: no roster spot"
				: "Draft-and-stash while they contend";
		case "finance":
			return "Development-first front office likes his ceiling";
		case "production": {
			if (!own) {
				return "Better production for his age than the other option";
			}
			const rank = chosen.facts.prodModelRank;
			if (traits && traits.analytics >= 0.35 && rank && rank <= 15) {
				return `Their GM loves analytics: production model #${rank}`;
			}
			return team.financeStyle === "analytics"
				? "Analytics front office: productive for his age"
				: "Productive for his age";
		}
		case "consensus":
			return own && chosen.facts.consensusRank
				? `Consensus big board likes him (No. ${chosen.facts.consensusRank})`
				: "Big boards were cooler on the other option";
		case "athletic":
			return own && (chosen.facts.athletic ?? 0) >= 80
				? "Elite combine athlete"
				: "Better athlete at the combine";
		case "combine":
			return own ? "Combine riser" : "The other option slipped at the combine";
		case "medical":
			return "Passed on a prospect with a medical red flag";
		case "uncertainty":
			return own
				? "Gambler GM: scouts split on him, big range"
				: "Cautious GM: steered clear of a prospect the scouts are split on";
		case "gmUpside":
			return (team.gm?.draftUpside ?? 0) >= 0
				? "Their GM loves upside"
				: "Their GM prefers ready-now prospects";
		case "lens":
			return analyticsOf(team) >= 0
				? "Their analytics GM likes his profile"
				: "Their old-school GM likes his tools";
		case "traits":
			return "Likes his traits";
	}
};

const analyticsOf = (team: TeamDraftContext) => team.gm?.traits.analytics ?? 0;

/**
 * The top factors that moved the pick, as plain lines: 1 to 4, deduped, derived from the same parts the score used.
 */
export const explainPick = ({
	decisions,
	chosenPid,
	team,
}: {
	decisions: ProspectDecision[];
	chosenPid: number;
	team: TeamDraftContext;
}): string[] => {
	const chosen = decisions.find((d) => d.facts.pid === chosenPid);
	if (!chosen) {
		return [];
	}
	const others = decisions.filter((d) => d !== chosen);
	const bpa = others.reduce<ProspectDecision | undefined>(
		(best, d) => (!best || d.facts.value > best.facts.value ? d : best),
		undefined,
	);
	const isBpa = !bpa || chosen.facts.value >= bpa.facts.value;
	// Who he was picked over: the best player by value when he isn't it, else the runner-up by score
	const alt = isBpa
		? others.reduce<ProspectDecision | undefined>(
				(best, d) => (!best || d.score > best.score ? d : best),
				undefined,
			)
		: bpa;

	const reasons: string[] = [];
	const add = (text: string | undefined) => {
		if (text && !reasons.includes(text)) {
			reasons.push(text);
		}
	};

	if (isBpa) {
		add(BEST_AVAILABLE_REASON);
	}
	if (team.move && team.move.target === chosenPid) {
		add(
			team.move.kind === "up"
				? `Traded up to No. ${team.move.overall} to get him`
				: "Moved down and still got their guy",
		);
	}

	const deltas = (Object.keys(chosen.parts) as FactorKey[])
		.concat(
			alt
				? (Object.keys(alt.parts) as FactorKey[]).filter(
						(k) => !(k in chosen.parts),
					)
				: [],
		)
		.map((key) => ({
			key,
			delta: (chosen.parts[key] ?? 0) - (alt?.parts[key] ?? 0),
		}))
		.filter((x) => x.delta >= (MIN_DELTA_BY_KEY[x.key] ?? MIN_DELTA))
		.sort((a, b) => b.delta - a.delta);
	for (const { key } of deltas) {
		if (reasons.length >= 4) {
			break;
		}
		add(factorText(key, chosen, alt, team));
	}

	// A risk he carried that they took anyway
	if (reasons.length < 4 && (chosen.parts.medical ?? 0) <= RED_FLAG_PARTS) {
		add("Medical flag lowered him, they took the risk");
	}

	if (reasons.length === 0) {
		// Not the best by value and nothing in his favor beyond a near tie: the draw went his way
		add("Close call on their board");
	} else if (isBpa && reasons.length === 1 && alt) {
		if (chosen.facts.value - alt.facts.value >= 2) {
			add("Clear gap to the next player on their board");
		}
	}
	return reasons.slice(0, 4);
};
