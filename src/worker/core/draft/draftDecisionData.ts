/**
 * League data for the AI draft decision (draftDecision.ts): what each prospect of a class brings (computed once per draft or mock draft)
 * and what each team on the clock is looking for. Nothing here draws from the game's random numbers.
 */
import { DRAFT_BY_TEAM_OVR, PHASE } from "../../../common/constants.ts";
import { DEFENSE_NAMES, OFFENSE_NAMES } from "../../../common/coachSystems.ts";
import { playerSchemeFit } from "../../../common/coachSystems.ts";
import { athleticScore, combineNudges } from "../../../common/draftCombine.ts";
import { OUTLETS } from "../../../common/draftOutlets.ts";
import { getOverseasLeague } from "../../../common/draftStash.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import {
	combineHeld,
	getClassCombine,
	lotteryNightOn,
	medicalsOn,
} from "../draftCombine/index.ts";
import { getClassBoards, productionSignalFor } from "../draftOutlets/index.ts";
import { getGmWeights } from "../gm/index.ts";
import { gmFinanceStyleOf } from "../gm/finance.ts";
import { getDraftTraitAdjustment, getTeamNeeds, primaryGroup } from "./draftNeeds.ts";
import type { ProspectFacts, TeamDraftContext } from "./draftDecision.ts";
import {
	coachSystemsEnabled,
	fitRatingsOf,
	getCoachProfile,
} from "../staff/systems.ts";
import {
	gmLensAdjustments,
	scoutingReportsOn,
} from "../scoutingReports/index.ts";
import {
	makeAiTraitValueFactorCache,
	traitsEnabled,
} from "../player/traits.ts";

// The new decision runs where AI Drafts by Need is about (basketball); other sports draft by team ovr
export const draftDecisionOn = () => !DRAFT_BY_TEAM_OVR;

const zScores = (xs: (number | undefined)[]) => {
	const vals = xs.filter((x): x is number => x !== undefined);
	if (vals.length < 2) {
		return xs.map(() => undefined);
	}
	const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
	const sd =
		Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) ||
		1;
	return xs.map((x) => (x === undefined ? undefined : (x - mean) / sd));
};

const PRODUCTION_OUTLET = OUTLETS.find((o) => o.lean === "production")?.id;

/**
 * What every prospect of a class brings to the AI's decision. season: the class's draft year. withCombine: the combine counts (the real
 * draft in the draft phase, or a mock draft of a class whose combine was held; never fantasy or expansion drafts).
 */
export const buildClassFacts = async (
	players: Player[],
	season: number,
	withCombine: boolean,
): Promise<Map<number, ProspectFacts>> => {
	const byValue = [...players].sort((a, b) => b.value - a.value);
	const valueRank = new Map(byValue.map((p, i) => [p.pid, i + 1]));

	// Big boards: consensus, production model and how split the outlets are
	const boards =
		players.length > 0 ? await getClassBoards(season).catch(() => undefined) : undefined;
	const consensus = boards?.consensus;
	const prodBoard =
		PRODUCTION_OUTLET !== undefined
			? boards?.boards.get(PRODUCTION_OUTLET)
			: undefined;
	const spreadRaw = players.map((p) => {
		const c = consensus?.get(p.pid);
		return c ? c.spread / (c.avg + 5) : undefined;
	});
	const spreadZ = zScores(spreadRaw);

	// Age-adjusted production vs value, over the prospects with enough minutes
	const prodRaw = players.map((p) =>
		productionSignalFor(p, season - p.born.year),
	);
	const prodZ = zScores(prodRaw);
	const valueZ = zScores(
		players.map((p, i) => (prodRaw[i] !== undefined ? p.value : undefined)),
	);

	// Combine: performance nudge, athleticism, medicals
	let perf = new Map<number, number>();
	const athletic = new Map<number, number>();
	const medical = new Map<number, number>();
	if (withCombine && lotteryNightOn() && combineHeld(season)) {
		const classPlayers = players.filter((p) => p.draft.year === season);
		const c = await getClassCombine(season, classPlayers);
		perf = combineNudges(
			classPlayers.map((p) => p.pid),
			c.results,
		);
		for (const [pid, res] of c.results) {
			if (res.drills) {
				const a = athleticScore(c.ranks.get(pid));
				if (a !== undefined) {
					athletic.set(pid, a);
				}
			}
			if (res.medical && medicalsOn()) {
				medical.set(pid, res.medical.risk);
			}
		}
	}

	const stashOn = __SPORT === "basketball" && featureOn("draftStash");
	const systemsOn = coachSystemsEnabled();

	const out = new Map<number, ProspectFacts>();
	players.forEach((p, i) => {
		const r = p.ratings.at(-1)!;
		out.set(p.pid, {
			pid: p.pid,
			value: p.value,
			age: season - p.born.year,
			ovr: r.ovr,
			pot: r.pot,
			pos: r.pos,
			skills: r.skills,
			valueRank: valueRank.get(p.pid),
			consensusRank: consensus?.get(p.pid)?.rank,
			prodModelRank: prodBoard?.get(p.pid),
			prodZ: prodZ[i],
			valueZ: valueZ[i],
			spread: spreadZ[i],
			combinePerf: perf.get(p.pid),
			athletic: athletic.get(p.pid),
			medicalRisk: medical.get(p.pid),
			stashable: stashOn && getOverseasLeague(p) !== undefined,
			schemeFit: systemsOn ? playerSchemeFit(fitRatingsOf(p)) : undefined,
		});
	});
	return out;
};

// Fantasy and expansion drafts: no class facts beyond value and ratings
export const combineCountsNow = () =>
	g.get("phase") === PHASE.DRAFT && g.get("expansionDraft").phase !== "draft";

/**
 * What an AI team on the clock is looking for. prospects: the players left (for the trait and lens adjustments), getTraitFactor: a
 * shared trait cache (makeAiTraitValueFactorCache).
 */
export const buildTeamDraftContext = async ({
	tid,
	teamPlayers,
	prospects,
	getTraitFactor,
}: {
	tid: number;
	teamPlayers: Player[];
	prospects: Player[];
	getTraitFactor?: ReturnType<typeof makeAiTraitValueFactorCache>;
}): Promise<TeamDraftContext> => {
	const season = g.get("season");
	const t = await idb.cache.teams.get(tid);
	const byValue = [...teamPlayers].sort((a, b) => b.value - a.value);
	const groupCounts = { G: 0, F: 0, C: 0 };
	for (const p of teamPlayers) {
		groupCounts[primaryGroup(p.ratings.at(-1)!.pos)] += 1;
	}
	const youngCore = { G: 0, F: 0, C: 0 };
	for (const p of byValue.slice(0, 10)) {
		if (season - p.born.year <= 25) {
			youngCore[primaryGroup(p.ratings.at(-1)!.pos)] += 1;
		}
	}
	const teamSkills: Record<string, number> = {};
	for (const p of byValue.slice(0, 8)) {
		for (const s of p.ratings.at(-1)!.skills) {
			teamSkills[s] = (teamSkills[s] ?? 0) + 1;
		}
	}

	const weights = await getGmWeights(tid);
	const ctx: TeamDraftContext = {
		tid,
		needs: featureOn("aiDraftNeeds") ? getTeamNeeds(teamPlayers) : undefined,
		groupCounts,
		youngCore,
		teamSkills,
		strategy: t?.strategy,
		rosterSize: teamPlayers.length,
		maxRosterSize: g.get("maxRosterSize"),
		gm: weights
			? {
					traits: weights.traits,
					draftNeedScale: weights.draftNeedScale,
					draftUpside: weights.draftUpside,
				}
			: undefined,
		financeStyle: weights && t?.gm ? gmFinanceStyleOf(t.gm) : undefined,
	};

	if (coachSystemsEnabled()) {
		const coaches = await idb.cache.coaches.indexGetAll("coachesByTid", tid);
		const head = coaches.find((c) => c.role === "head");
		if (head) {
			const profile = getCoachProfile(head);
			ctx.system = {
				off: profile.off,
				def: profile.def,
				offName: OFFENSE_NAMES[profile.off],
				defName: DEFENSE_NAMES[profile.def],
			};
		}
	}

	if (weights && scoutingReportsOn() && prospects.length > 0) {
		const lens = gmLensAdjustments(prospects, weights.traits.analytics);
		ctx.lens = new Map(prospects.map((p, i) => [p.pid, lens[i]!]));
	}

	if (traitsEnabled() && getTraitFactor) {
		const traitTeam = getTraitFactor.teamContext(teamPlayers);
		ctx.trait = new Map(
			prospects.map((p) => [
				p.pid,
				getDraftTraitAdjustment(
					p.value,
					getTraitFactor(p, { strategy: t?.strategy, team: traitTeam }),
				),
			]),
		);
	}

	return ctx;
};
