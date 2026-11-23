// AI Roster Balance (the aiRosterBalance setting, basketball): hardship signings. An AI team down to fewer than 8 players who can play
// in the next few games signs a cheap free agent (the minimum, to the end of the season) and releases him once it is healthy again,
// unless its roster has room to keep him. Up to 2 over the maximum roster (they do not count against it), no random numbers. Called from team.checkRosterSizes before
// each regular season game day. See docs/native-features.md.
import { PHASE } from "../../../common/constants.ts";
import type { Player } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { player } from "../index.ts";
import getPayroll from "../team/getPayroll.ts";
import { rosterBalanceOn, sortByNeed } from "./rosterBalance.ts";

export const HARDSHIP = {
	// Fewer than this many players available ...
	minHealthy: 8,
	// ... counting the ones back within this many games, so it's short-handed for a stretch, not one night
	lookaheadGames: 3,
	// Released once this many others are healthy (one more than minHealthy, so the next injury doesn't sign him right back)
	releaseHealthy: 9,
	// Kept instead when the roster has at least this many open spots with him on it
	keepOpenSpots: 2,
	// Like the NBA's hardship exception, up to this many over the maximum roster (they don't count against it, team/checkRosterSizes.ts)
	extraSpots: 2,
};

// Counts for the calibration script (rosterBalance.script.test.ts)
export const hardshipDiag = {
	signed: 0,
	released: 0,
	kept: 0,
	// Team-days short-handed (by the lookahead) and how many of them with no roster spot to sign one
	shortDays: 0,
	noRoom: 0,
};

export const isHardshipPlayer = (p: Player, tid: number) =>
	p.hardship !== undefined &&
	p.hardship.tid === tid &&
	p.hardship.season === g.get("season");

// players: the team's roster (changed in place). freeAgents: free agents asking for the minimum, best first (signed ones are taken out).
// releasedPIDs: the released ones are added (their contract demands get normalized like other cuts)
export const hardshipMoves = async (
	tid: number,
	players: Player[],
	freeAgents: Player[],
	releasedPIDs: number[] = [],
) => {
	const phase = g.get("phase");
	if (
		!rosterBalanceOn() ||
		(phase !== PHASE.REGULAR_SEASON && phase !== PHASE.AFTER_TRADE_DEADLINE)
	) {
		return;
	}
	const maxRosterSize = g.get("maxRosterSize");
	const season = g.get("season");

	// Healthy again: release or keep the hardship signings
	const hardship = players.filter((p) => isHardshipPlayer(p, tid));
	if (hardship.length > 0) {
		const healthyOthers = players.filter(
			(p) => p.injury.gamesRemaining === 0 && !hardship.includes(p),
		).length;
		if (healthyOthers >= HARDSHIP.releaseHealthy) {
			for (const p of hardship.toSorted((a, b) => a.value - b.value)) {
				if (players.length <= maxRosterSize - HARDSHIP.keepOpenSpots) {
					delete p.hardship;
					await idb.cache.players.put(p);
					hardshipDiag.kept += 1;
				} else {
					await player.release(p, false);
					players.splice(players.indexOf(p), 1);
					releasedPIDs.push(p.pid);
					hardshipDiag.released += 1;
				}
			}
			return;
		}
	}

	// Short-handed (the hardship signings so far count as available): sign one more for each player missing
	const available = players.filter(
		(p) => p.injury.gamesRemaining < HARDSHIP.lookaheadGames,
	).length;
	let numToSign = Math.min(
		HARDSHIP.minHealthy - available,
		maxRosterSize + HARDSHIP.extraSpots - players.length,
	);
	if (available < HARDSHIP.minHealthy) {
		hardshipDiag.shortDays += 1;
		if (numToSign <= 0) {
			hardshipDiag.noRoom += 1;
		}
	}
	const minContract = g.get("minContract");
	while (numToSign > 0) {
		if (
			g.get("salaryCapType") === "hard" &&
			(await getPayroll(tid)) + minContract > g.get("salaryCap")
		) {
			return;
		}
		const p = sortByNeed(
			players.map((p2) => last(p2.ratings).pos),
			freeAgents.filter((p2) => p2.injury.gamesRemaining === 0),
			(p2) => last(p2.ratings).pos,
			(p2) => p2.value,
		)[0];
		if (!p) {
			return;
		}
		freeAgents.splice(freeAgents.indexOf(p), 1);
		await player.sign(p, tid, { amount: minContract, exp: season }, phase);
		p.hardship = { tid, season };
		await idb.cache.players.put(p);
		players.push(p);
		hardshipDiag.signed += 1;
		numToSign -= 1;
	}
};
