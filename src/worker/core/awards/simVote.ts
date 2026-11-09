// Simulated media vote for a season's awards (League extras: Award Vote, basketball). Built from processAwards' output so
// the candidates and scores are exactly the ones BBGM decides awards with. See common/awardVote.
import {
	simulateVote,
	type SimVote,
	type VoteAwardInput,
	type VoteCandidate,
} from "../../../common/awardVote/index.ts";
import type { Award } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { processAwards } from "./processAwards.ts";

type Players = Awaited<ReturnType<typeof processAwards>>["players"];

// Awards a media vote makes sense for: league-wide, regular season
export const votableAward = (award: Award) =>
	award.group === undefined && award.statRange === undefined;

const kindOf = (award: Award): VoteAwardInput["kind"] =>
	award.numTeams !== undefined
		? "team"
		: award.actAs === "mvp" || award.shortName === "MVP"
			? "mvp"
			: "player";

const defendingWinners = async (season: number) => {
	const prev = await idb.merged.awards.get(season - 1);
	const out: Record<string, Set<number>> = {};
	for (const award of prev?.awards ?? []) {
		if (award.numTeams === undefined && award.group === undefined) {
			const pid = award.winner[0]?.pid;
			if (pid !== undefined) {
				out[award.shortName] = new Set([pid]);
			}
		}
	}
	return out;
};

const candidateOf = (
	p: Players[number],
	shortName: string,
	defending: Set<number> | undefined,
): VoteCandidate | undefined => {
	const cs = p.currentStats.regularSeason as Record<string, any> | undefined;
	const score = p.scores[shortName];
	if (!cs || score === undefined || !Number.isFinite(score)) {
		return undefined;
	}
	const teamGp = typeof cs.teamGp === "number" ? cs.teamGp : undefined;
	return {
		pid: p.pid,
		tid: cs.tid ?? p.tid,
		name: p.name,
		score,
		teamWinp: typeof cs.winp === "number" ? cs.winp : undefined,
		pts: typeof cs.pts === "number" ? cs.pts : undefined,
		gpFrac:
			teamGp && typeof cs.gp === "number"
				? Math.min(1, cs.gp / teamGp)
				: undefined,
		defending: defending?.has(p.pid) ?? false,
	};
};

// The vote inputs of every votable award. respect: make the vote agree with the realized winners.
export const voteInputs = async ({
	season,
	realizedAwards,
	players,
	respect,
}: {
	season: number;
	realizedAwards: Award[];
	players: Players;
	respect: boolean;
}): Promise<VoteAwardInput[]> => {
	const byPid = new Map(players.map((p) => [p.pid, p]));
	const defending = await defendingWinners(season);
	const out: VoteAwardInput[] = [];
	for (const award of realizedAwards) {
		if (!votableAward(award)) {
			continue;
		}
		const kind = kindOf(award);
		const def = defending[award.shortName];
		let pids: number[];
		let respectOrder: VoteAwardInput["respect"];
		let teamSize: number | undefined;
		if (award.numTeams !== undefined) {
			const teams = award.winner.map((team) =>
				team.map((p) => p.pid).filter((pid) => pid !== undefined),
			);
			teamSize = Math.max(1, ...award.winner.map((t) => t.length));
			pids = teams.flat();
			// Near misses, for awards without eligibility filters
			if (!award.rookie && !award.bench && !award.mip) {
				const extra = players
					.filter((p) => !pids.includes(p.pid))
					.filter((p) => Number.isFinite(p.scores[award.shortName]))
					.sort(
						(a, b) => b.scores[award.shortName]! - a.scores[award.shortName]!,
					)
					.slice(0, 5)
					.map((p) => p.pid);
				pids = [...pids, ...extra];
			}
			respectOrder = teams;
		} else {
			pids = award.winner.map((p) => p.pid).filter((pid) => pid !== undefined);
			respectOrder = pids.slice(0, 1);
		}
		const candidates = pids
			.map((pid) => byPid.get(pid))
			.filter((p) => p !== undefined)
			.map((p) => candidateOf(p, award.shortName, def))
			.filter((c) => c !== undefined);
		if (candidates.length === 0) {
			continue;
		}
		out.push({
			shortName: award.shortName,
			name: award.name,
			kind,
			numTeams: award.numTeams,
			teamSize,
			candidates,
			respect: respect ? respectOrder : undefined,
		});
	}
	return out;
};

export const runVotes = (inputs: VoteAwardInput[], season: number) =>
	inputs
		.map((input) => simulateVote(input, { seed: season }))
		.filter((x) => x !== undefined);

// A season's simulated vote computed from scratch (the live race, or a past season without a stored vote)
export const computeSimVotes = async (
	season: number,
	respect: boolean,
): Promise<SimVote[]> => {
	const awards = g
		.get("awards")
		.filter((a) => a.group === undefined && a.statRange === undefined);
	const { players, realizedAwards } = await processAwards({
		awards,
		extraStatRanges: [],
		extraStats: [],
		numPlayersPerIndividualAward: 10,
		season,
		statOverridesByMatchup: undefined,
	});
	if (respect) {
		// Respect the stored winners when there are any
		const stored = await idb.merged.awards.get(season);
		if (stored) {
			for (const award of realizedAwards.flat()) {
				const s = stored.awards.find(
					(a) => a.shortName === award.shortName && a.group === undefined,
				);
				if (s && s.numTeams === undefined && award.numTeams === undefined) {
					const first = s.winner[0]?.pid;
					const rest = award.winner.filter((p) => p.pid !== first);
					const w = award.winner.find((p) => p.pid === first);
					if (w) {
						award.winner = [w, ...rest];
					}
				} else if (
					s &&
					s.numTeams !== undefined &&
					award.numTeams !== undefined
				) {
					award.winner = s.winner;
				}
			}
		}
	}
	const inputs = await voteInputs({
		season,
		realizedAwards: realizedAwards.flat(),
		players,
		respect,
	});
	return runVotes(inputs, season);
};

// Reorder individual award winners by the simulated vote (only when "use simulated vote to decide awards" is on)
export const applyVoteToWinners = (awards: Award[], votes: SimVote[]) => {
	for (const award of awards) {
		if (award.numTeams !== undefined || !votableAward(award)) {
			continue;
		}
		const vote = votes.find((v) => v.shortName === award.shortName);
		if (!vote) {
			continue;
		}
		const rank = new Map(vote.rows.map((r) => [r.pid, r.rank]));
		const winners = award.winner.filter((p) => p.pid !== undefined);
		const empty = award.winner.filter((p) => p.pid === undefined);
		winners.sort(
			(a, b) => (rank.get(a.pid!) ?? Infinity) - (rank.get(b.pid!) ?? Infinity),
		);
		award.winner = [...winners, ...empty];
	}
};
