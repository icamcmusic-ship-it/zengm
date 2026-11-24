// AI Roster Balance (the aiRosterBalance setting, basketball): hardship signings. Like the NBA's hardship exception, an AI team with 4+
// players out who have missed 3+ games and are out for a while yet (one more for each such player past 3), or down to fewer than 8
// players who can play in the next few games, signs a cheap free agent (the minimum, to the end of the season) and releases him once it
// no longer qualifies, unless its roster has room to keep him. Up to 3 over the maximum roster (they do not count against it), no
// random numbers. Called from team.checkRosterSizes before each regular season game day. See docs/native-features.md.
import { PHASE } from "../../../common/constants.ts";
import type { Player } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { player } from "../index.ts";
import getPayroll from "../team/getPayroll.ts";
import { scaleGamesToSeason } from "../season/scheduleDayScale.ts";
import { rosterBalanceOn, sortByNeed } from "./rosterBalance.ts";

export const HARDSHIP = {
	// The NBA's rule: this many players out ...
	nbaOut: 4,
	// ... each of whom has missed this many games ...
	nbaMissed: 3,
	// ... and is out for at least this many more (the NBA's "two more weeks"). One signing for each such player past nbaOut - 1
	nbaRemaining: 6,
	// Or short-handed: fewer than this many players available ...
	minHealthy: 8,
	// ... counting the ones back within this many games, so it's short-handed for a stretch, not one night
	lookaheadGames: 3,
	// Released once this many others are healthy (one more than minHealthy, so the next injury doesn't sign him right back) and
	// fewer than nbaOut others are out (any injury: one back from his injury ends it, as in the NBA)
	releaseHealthy: 9,
	// Kept instead when the roster has at least this many open spots with him on it
	keepOpenSpots: 2,
	// Like the NBA's hardship exception, up to this many over the maximum roster (they don't count against it, team/checkRosterSizes.ts)
	extraSpots: 3,
};

// The NBA rule's games missed and games still out are for an 82-game season: scaled to the league's season length (at least 1)
export const nbaMissedGames = () => scaleGamesToSeason(HARDSHIP.nbaMissed);
export const nbaRemainingGames = () =>
	scaleGamesToSeason(HARDSHIP.nbaRemaining);

// The games his team has played without him since his current injury, and whether he counts for the NBA rule. Injuries from before
// the counter: the recorded length - games remaining - 1 (the countdown also runs at the end of the day he got hurt), 0 if not on record
export const gamesMissed = (p: Player) => {
	if (p.injury.gamesMissed !== undefined) {
		return p.injury.gamesMissed;
	}
	const rec = p.injuries?.at(-1);
	return rec !== undefined && rec.type === p.injury.type
		? Math.max(0, rec.games - p.injury.gamesRemaining - 1)
		: 0;
};
export const nbaHardshipOut = (p: Player) =>
	p.injury.gamesRemaining >= nbaRemainingGames() &&
	gamesMissed(p) >= nbaMissedGames();

// Counts for the calibration script (rosterBalance.script.test.ts)
export const hardshipDiag = {
	signed: 0,
	released: 0,
	kept: 0,
	// Team-days short-handed (by the lookahead, or by the NBA rule) and how many of them with no roster spot to sign one
	shortDays: 0,
	nbaDays: 0,
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

	// Healthy again: release or keep the hardship signings (down to the NBA rule's count while 4+ others are still out)
	const hardship = players.filter((p) => isHardshipPlayer(p, tid));
	if (hardship.length > 0) {
		const others = players.filter((p) => !hardship.includes(p));
		const healthyOthers = others.filter(
			(p) => p.injury.gamesRemaining === 0,
		).length;
		const keepNba = Math.max(
			0,
			others.filter((p) => p.injury.gamesRemaining > 0).length -
				(HARDSHIP.nbaOut - 1),
		);
		if (healthyOthers >= HARDSHIP.releaseHealthy && hardship.length > keepNba) {
			for (const p of hardship
				.toSorted((a, b) => a.value - b.value)
				.slice(0, hardship.length - keepNba)) {
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

	// Short-handed (the hardship signings so far count as available): sign one more for each player missing. The NBA rule: one for
	// each player out past 3
	const available = players.filter(
		(p) => p.injury.gamesRemaining < HARDSHIP.lookaheadGames,
	).length;
	const nbaSpots =
		players.filter((p) => !isHardshipPlayer(p, tid) && nbaHardshipOut(p))
			.length -
		(HARDSHIP.nbaOut - 1);
	const numHardship = players.filter((p) => isHardshipPlayer(p, tid)).length;
	let numToSign = Math.min(
		Math.max(HARDSHIP.minHealthy - available, nbaSpots - numHardship),
		maxRosterSize + HARDSHIP.extraSpots - players.length,
	);
	if (nbaSpots > 0) {
		hardshipDiag.nbaDays += 1;
	}
	if (available < HARDSHIP.minHealthy || nbaSpots > numHardship) {
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
