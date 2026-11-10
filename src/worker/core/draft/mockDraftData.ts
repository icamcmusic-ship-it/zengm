/**
 * League data for the mock draft and pro projections (see mockDraft.ts and proProjection.ts): the pick order, the
 * prospects as the AI and the user see them, each team's needs, and a per-season cache of the projections.
 */
import { DRAFT_BY_TEAM_OVR, PHASE, PLAYER } from "../../../common/constants.ts";
import { last } from "../../../common/utils.ts";
import type { DraftPick, Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { player } from "../index.ts";
import { canBeDrafted } from "./canBeDrafted.ts";
import { getNeedLabels, getTeamNeeds } from "./draftNeeds.ts";
import genOrder, { NotEnoughTeamsError } from "./genOrder.ts";
import {
	pickConditionsDryRun,
	runMockDraft,
	type MockSlot,
	type MockTeam,
} from "./mockDraft.ts";
import {
	fuzzedRatings,
	projectProspect,
	type ProProjection,
} from "./proProjection.ts";
import { getFuzz } from "../player/fuzzRating.ts";
import {
	getAiTraitTeamContext,
	getAiTraitValueFactor,
	traitsEnabled,
} from "../player/traits.ts";

const MOCK_ROUNDS = 2;

// The class the mock drafts: this season's, until the draft is over
export const getMockDraftSeason = () =>
	g.get("phase") <= PHASE.DRAFT ? g.get("season") : undefined;

const getProspects = async (season: number) =>
	(
		await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
			[season],
			[season, Infinity],
		])
	).filter((p) => p.tid === PLAYER.UNDRAFTED && canBeDrafted(p));

type OrderSource = "draftOrder" | "lotteryProjection" | "records";

const getSlots = async (
	season: number,
): Promise<{ slots: MockSlot[]; source: OrderSource }> => {
	const existing = await idb.cache.draftPicks.indexGetAll(
		"draftPicksBySeason",
		season,
	);

	let ordered: DraftPick[] | undefined;
	let source: OrderSource = "draftOrder";

	if (existing.length > 0 && existing.every((dp) => dp.pick > 0)) {
		// Lottery done (or no lottery): the real order, minus picks already made
		ordered = existing;
	} else {
		// Before the lottery: one simulated lottery, like the projected Draft Lottery page (nothing is saved)
		try {
			ordered = (await genOrder(true)).draftPicks;
			source = "lotteryProjection";
		} catch (error) {
			if (!(error instanceof NotEnoughTeamsError)) {
				throw error;
			}
		}
	}

	if (!ordered) {
		// Fallback: worst record first, every round
		source = "records";
		const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
			"teamSeasonsBySeasonTid",
			[[season], [season, "Z"]],
		);
		const winp = new Map(
			teamSeasons.map((ts) => [
				ts.tid,
				helpers.calcWinp({
					won: ts.won,
					lost: ts.lost,
					tied: ts.tied,
					otl: ts.otl,
				}),
			]),
		);
		const counts: Record<number, number> = {};
		ordered = [...existing]
			.sort(
				(a, b) =>
					a.round - b.round ||
					(winp.get(a.originalTid) ?? 0.5) - (winp.get(b.originalTid) ?? 0.5),
			)
			.map((dp) => {
				counts[dp.round] = (counts[dp.round] ?? 0) + 1;
				return { ...dp, pick: counts[dp.round]! };
			});
	}

	// Protections and swaps, as a dry run (still pending before the lottery; already resolved after it)
	const futurePicks = (await idb.cache.draftPicks.getAll()).filter(
		(dp) => typeof dp.season === "number" && dp.season > season,
	);
	const teamInfoCache = g.get("teamInfoCache");
	return {
		slots: pickConditionsDryRun({
			draftPicks: ordered,
			futurePicks,
			shortName: (tid) => teamInfoCache[tid]?.abbrev ?? "???",
			rounds: MOCK_ROUNDS,
		}),
		source,
	};
};

const getFuzzedView = (p: Player) => {
	const r = last(p.ratings);
	const fuzz = getFuzz(r.fuzz);
	return fuzzedRatings(r, fuzz);
};

export const getMockDraft = async () => {
	const season = getMockDraftSeason();
	if (season === undefined) {
		return {
			season: g.get("season") + 1,
			message:
				"The mock draft covers the class before its draft. Next season's class can be mocked once the new season starts.",
		} as const;
	}
	if (
		g.get("phase") === PHASE.FANTASY_DRAFT ||
		g.get("expansionDraft").phase === "draft"
	) {
		return {
			season,
			message: "No mock draft during a fantasy or expansion draft.",
		} as const;
	}

	const players = await getProspects(season);
	const { slots, source } = await getSlots(season);

	const useNeeds = !DRAFT_BY_TEAM_OVR && featureOn("aiDraftNeeds");
	const useTraits = !DRAFT_BY_TEAM_OVR && traitsEnabled();

	const tids = [...new Set(slots.map((s) => s.tid))];
	const teams = new Map<number, MockTeam>();
	const teamInfo: Record<
		number,
		{ needs: string[]; strategy: string | undefined }
	> = {};
	const traitContext: Record<
		number,
		{ strategy: any; team: ReturnType<typeof getAiTraitTeamContext> }
	> = {};
	for (const tid of tids) {
		const t = await idb.cache.teams.get(tid);
		const teamPlayers = await idb.cache.players.indexGetAll(
			"playersByTid",
			tid,
		);
		const needs = getTeamNeeds(teamPlayers);
		teams.set(tid, { tid, needs, strategy: t?.strategy });
		teamInfo[tid] = { needs: getNeedLabels(needs), strategy: t?.strategy };
		traitContext[tid] = {
			strategy: t?.strategy,
			team: getAiTraitTeamContext(teamPlayers),
		};
	}

	// The user's scouting list order (fuzzed value), for reach/steal
	const formatted = await player.formatAll(players, {
		attrs: ["pid", "firstName", "lastName", "age", "valueFuzz"],
		ratings: ["ovr", "pot", "pos", "skills"],
		showNoStats: true,
		showRookies: true,
		fuzz: true,
	});
	formatted.sort((a: any, b: any) => b.valueFuzz - a.valueFuzz);
	const scoutRank = new Map<number, number>(
		formatted.map((p: any, i: number) => [p.pid, i + 1]),
	);

	const prospects = players.map((p) => ({
		pid: p.pid,
		value: p.value,
		ratings: p.ratings,
		scoutRank: scoutRank.get(p.pid) ?? players.length,
		traitFactors: useTraits
			? Object.fromEntries(
					tids.map((tid) => [
						tid,
						getAiTraitValueFactor(p, traitContext[tid]!),
					]),
				)
			: undefined,
	}));

	const picks = runMockDraft({ slots, prospects, teams, useNeeds, useTraits });

	const byPid = new Map(formatted.map((p: any) => [p.pid, p]));
	const teamInfoCache = g.get("teamInfoCache");
	return {
		season,
		source,
		useNeeds,
		picks: picks.map((pick) => {
			const p: any = byPid.get(pick.pid);
			const ratings = last(p.ratings) as any;
			return {
				...pick,
				abbrev: teamInfoCache[pick.tid]?.abbrev ?? "",
				originalAbbrev: teamInfoCache[pick.originalTid]?.abbrev ?? "",
				teamNeeds: teamInfo[pick.tid]?.needs ?? [],
				teamStrategy: teamInfo[pick.tid]?.strategy,
				name: `${p.firstName} ${p.lastName}`,
				age: p.age as number,
				pos: ratings.pos as string,
				ovr: ratings.ovr as number,
				pot: ratings.pot as number,
				skills: ratings.skills as string[],
			};
		}),
		numProspects: players.length,
		userTids: g.get("userTids"),
	};
};

// Projections, cached per league, season and ratings (the ratings can be regenerated, or the fuzz scouted down)
const cache = new Map<string, ProProjection>();
let cacheLid: number | undefined;

export const getProProjections = async (pids: number[]) => {
	if (cacheLid !== g.get("lid")) {
		cache.clear();
		cacheLid = g.get("lid");
	}
	const out: Record<number, ProProjection> = {};
	for (const pid of pids) {
		const p = await idb.cache.players.get(pid);
		if (!p || p.tid !== PLAYER.UNDRAFTED) {
			continue;
		}
		const ratings = getFuzzedView(p);
		const key = `${p.draft.year}:${pid}:${JSON.stringify(ratings)}`;
		let projection = cache.get(key);
		if (!projection) {
			const age = ratings.season - p.born.year;
			projection = projectProspect(pid, ratings, age);
			cache.set(key, projection);
		}
		out[pid] = projection;
	}
	return out;
};
