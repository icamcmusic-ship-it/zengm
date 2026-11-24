import { DRAFT_BY_TEAM_OVR, PHASE, PLAYER } from "../../../common/constants.ts";
import afterPicks from "./afterPicks.ts";
import { canBeDrafted } from "./canBeDrafted.ts";
import getOrder from "./getOrder.ts";
import selectPlayer from "./selectPlayer.ts";
import { idb } from "../../db/index.ts";
import { g, local, lock } from "../../util/index.ts";
import type {
	Conditions,
	Player,
	PlayerWithoutKey,
} from "../../../common/types.ts";
import { player, team } from "../index.ts";
import { last } from "../../../common/utils.ts";
import { choice } from "../../../common/random.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import {
	getDraftNightMove,
	maybeAiDraftNightTrade,
} from "./draftNightTrades.ts";
import { prepareWholeRoster } from "../team/ovr.ts";
import { makeAiTraitValueFactorCache } from "../player/traits.ts";
import {
	decideDraft,
	explainPick,
	type ProspectDecision,
	type ProspectFacts,
	type TeamDraftContext,
} from "./draftDecision.ts";
import {
	buildClassFacts,
	getClassFactsCached,
	buildTeamDraftContext,
} from "./draftDecisionData.ts";

// Top ranked prospect on the user's draft board who is still available
export const getDraftBoardPick = <T extends { draftBoard?: { rank?: number } }>(
	players: T[],
) => {
	let best: T | undefined;
	for (const p of players) {
		const rank = p.draftBoard?.rank;
		if (rank !== undefined && (!best || rank < best.draftBoard!.rank!)) {
			best = p;
		}
	}
	return best;
};

// Picks per round of the draft under way, for the AI's pick scale (draftDecision.ts pickScale/adjustmentCap): an expansion draft numbers
// each round 1..(expansion teams), as in selectPlayer.ts, so its round 2 starts right after the expansion teams' first picks
export const picksPerRound = () => {
	const expansionDraft = g.get("expansionDraft");
	return expansionDraft.phase === "draft"
		? Math.max(1, expansionDraft.expansionTids.length)
		: g.get("numActiveTeams");
};

export const getTeamOvrDiffs = (
	teamPlayers: PlayerWithoutKey[],
	players: PlayerWithoutKey[],
) => {
	if (!DRAFT_BY_TEAM_OVR) {
		return [];
	}

	const teamPlayers2 = teamPlayers.map((p) => {
		const ratings = last(p.ratings);
		return {
			injury: p.injury,
			value: p.value,
			ratings: {
				ovr: player.fuzzRating(ratings.ovr, ratings.fuzz),
				ovrs: player.fuzzOvrs(ratings.ovrs, ratings.fuzz),
				pos: ratings.pos,
			},
		};
	});

	const prepared = prepareWholeRoster?.(teamPlayers2);
	const baseline =
		prepared?.baseline ??
		team.ovr(teamPlayers2, {
			wholeRoster: true,
		});

	return players.map((p) => {
		const ratings = last(p.ratings);
		const p2 = {
			injury: p.injury,
			value: p.value,
			ratings: {
				ovr: player.fuzzRating(ratings.ovr, ratings.fuzz),
				ovrs: player.fuzzOvrs(ratings.ovrs, ratings.fuzz),
				pos: ratings.pos,
			},
		};
		const newOvr =
			prepared?.withPlayer(p2) ??
			team.ovr([...teamPlayers2, p2], {
				wholeRoster: true,
			});

		return newOvr - baseline;
	});
};

/**
 * Simulate draft picks until it's the user's turn or the draft is over.
 *
 * This could be made faster by passing a transaction around, so all the writes for all the picks are done in one transaction. But when calling selectPlayer elsewhere (i.e. in testing or in response to the user's pick), it needs to be sure that the transaction is complete before continuing. So I would need to create a special case there to account for it. Given that this isn't really *that* slow now, that probably isn't worth the complexity. Although... team.rosterAutoSort does precisely this... so maybe it would be a good idea...
 *
 * @memberOf core.draft
 * @param {boolean} onlyOne If true, only do one pick. If false, do all picks until the user's next pick. Default false.
 * @return {Promise.[Array.<Object>, Array.<number>]} Resolves to an array of player IDs who were drafted during this function call, in order.
 */
const runPicks = async (
	action:
		| {
				type: "onePick" | "untilYourNextPick" | "untilEnd";
		  }
		| {
				type: "untilPick";
				dpid: number;
		  },
	conditions?: Conditions,
) => {
	if (lock.get("drafting")) {
		return [];
	}

	await lock.set("drafting", true);
	const pids: number[] = [];

	// Player traits: nobody's ratings change during the draft, so each prospect's trait factor is computed once
	const getTraitFactor = makeAiTraitValueFactorCache();
	let draftPicks = await getOrder();

	const expansionDraft = g.get("expansionDraft");

	// Draft-night trades: picks already considered for an AI trade-up in this run
	const triedDraftNightTrade = new Set<number>();

	let playersAll: Player[];
	if (g.get("phase") === PHASE.FANTASY_DRAFT) {
		playersAll = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
	} else if (expansionDraft.phase === "draft") {
		playersAll = (
			await idb.cache.players.indexGetAll("playersByTid", [0, Infinity])
		).filter(canBeDrafted);
	} else {
		playersAll = (
			await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
				[g.get("season")],
				[g.get("season"), Infinity],
			])
		).filter(canBeDrafted);
	}
	playersAll.sort((a, b) => b.value - a.value);

	// The AI's read of every prospect (combine, medicals, production, big boards, ...): nobody's changes during the draft, so it is
	// computed once, at the first AI pick. Fantasy and expansion drafts: value and ratings only
	const regularDraft =
		g.get("phase") === PHASE.DRAFT && expansionDraft.phase !== "draft";
	let classFacts: Map<number, ProspectFacts> | undefined;

	// Called after either the draft is over or it's the user's pick
	const afterDoneAuto = async () => {
		await lock.set("drafting", false);

		// Is draft over?
		await afterPicks(draftPicks.length === 0, conditions);
		return pids;
	};

	// This will actually draft "untilUserOrEnd"
	const autoSelectPlayer = async (): Promise<number[]> => {
		if (draftPicks[0]) {
			const expansionDraft2 = g.get("expansionDraft"); // Get again, might have changed
			if (
				expansionDraft2.phase === "draft" &&
				expansionDraft2.numPerTeam !== undefined
			) {
				// Keep logic in sync with draft.ts
				const tidsOverLimit: number[] = [];
				for (const [tidString, numPerTeam] of Object.entries(
					expansionDraft2.numPerTeamDrafted,
				)) {
					if (numPerTeam >= expansionDraft2.numPerTeam) {
						const tid = Number.parseInt(tidString);
						tidsOverLimit.push(tid);
					}
				}
				if (tidsOverLimit.length > 0) {
					playersAll = playersAll.filter((p) => !tidsOverLimit.includes(p.tid));
				}
			}

			// If there are no players, delete the rest of the picks and draft is done
			if (playersAll.length === 0) {
				for (const dp of draftPicks) {
					await idb.cache.draftPicks.delete(dp.dpid);
				}
				draftPicks = await getOrder();
				return afterDoneAuto();
			}

			const dp = draftPicks[0];

			const singleUserPickInSpectatorMode =
				g.get("spectator") && action.type === "onePick";
			const pauseForUserPick =
				g.get("userTids").includes(dp.tid) &&
				!local.autoPlayUntil &&
				!singleUserPickInSpectatorMode &&
				action.type !== "untilEnd" &&
				action.type !== "untilPick";

			const pauseForDpid =
				action.type === "untilPick" && dp.dpid === action.dpid;

			if (pauseForUserPick || pauseForDpid) {
				return afterDoneAuto();
			}

			// Draft-night trades: maybe an AI team trades up into this pick (seeded, at most one try per pick). Then the
			// order is read again, since the pick and maybe others changed hands
			if (!triedDraftNightTrade.has(dp.dpid)) {
				triedDraftNightTrade.add(dp.dpid);
				if (await maybeAiDraftNightTrade(draftPicks, playersAll)) {
					draftPicks = await getOrder();
					return autoSelectPlayer();
				}
			}

			draftPicks.shift();

			const teamPlayers = await idb.cache.players.indexGetAll(
				"playersByTid",
				dp.tid,
			);
			const teamOvrDiffs = await getTeamOvrDiffs(teamPlayers, playersAll);
			// In spectator mode or during auto play the AI runs the user's team, so it drafts like any AI team (never by true value)
			const userTeam =
				g.get("userTids").includes(dp.tid) &&
				!g.get("spectator") &&
				!local.autoPlayUntil;

			// Basketball: value plus the AI's bounded draft factors (need, fit, timeline, production, combine, medicals, GM...), see
			// draftDecision.ts. User teams drafting on auto take the best player by value, as before
			let decisions: ProspectDecision[] | undefined;
			let teamCtx: TeamDraftContext | undefined;
			if (!DRAFT_BY_TEAM_OVR && !userTeam) {
				classFacts ??= regularDraft
					? await getClassFactsCached(playersAll, g.get("season"))
					: await buildClassFacts(playersAll, g.get("season"), false);
				teamCtx = await buildTeamDraftContext({
					tid: dp.tid,
					teamPlayers,
					prospects: playersAll,
					getTraitFactor,
				});
				teamCtx.move = getDraftNightMove(dp.dpid);
				const numTeams = picksPerRound();
				decisions = decideDraft({
					pool: playersAll.map((p) => classFacts!.get(p.pid)!),
					team: teamCtx,
					overall: (dp.round - 1) * numTeams + dp.pick,
					numTeams,
				});
			}

			const score = (p: Player, i: number) => {
				if (DRAFT_BY_TEAM_OVR) {
					return (teamOvrDiffs[i]! + 0.05 * p.value) ** 40;
				}

				return (decisions?.[i]?.score ?? Math.max(0, p.value)) ** 69;
			};

			// The user's own draft board, when auto drafting for the user
			const boardPick =
				userTeam &&
				featureOn("draftBoard") &&
				// Scouting Director & Regions: the Director's board is the draft-day auto pick
				(g.get("draftBoardAutoDraft") || featureOn("scoutingDepth"))
					? getDraftBoardPick(playersAll)
					: undefined;

			const selection = boardPick ?? choice(playersAll, score);

			// Why: the factors that moved the pick, from the same parts as the score
			const why =
				decisions && teamCtx
					? explainPick({ decisions, chosenPid: selection.pid, team: teamCtx })
					: !DRAFT_BY_TEAM_OVR && userTeam && regularDraft
						? [
								boardPick
									? "Top of your draft board"
									: "Auto draft: best available",
							]
						: undefined;

			const pid = selection.pid;
			await selectPlayer(dp, pid, why);
			pids.push(pid);
			playersAll = playersAll.filter((p) => p !== selection); // Delete from the list of undrafted players

			if (action.type !== "onePick") {
				return autoSelectPlayer();
			}
		}

		return afterDoneAuto();
	};

	return autoSelectPlayer();
};

export default runPicks;
