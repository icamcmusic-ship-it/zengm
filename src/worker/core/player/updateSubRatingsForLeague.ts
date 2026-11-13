import { PLAYER } from "../../../common/constants.ts";
import { isValidSubArray, subsMatchBases } from "../../../common/subRatings.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import loadDataBasketball from "../realRosters/loadData.basketball.ts";
import { ensureSubs, subRatingsOn } from "./subRatings.ts";

type MaybeReal = {
	real?: boolean;
	srID?: string;
	subLean?: string;
	subP?: { n?: 1; rs?: 0 | 1; v: number };
	tid: number;
};

// A real player (from real rosters, or a league file of them) whose shape hasn't been read from his real stats yet
const needsRealLean = (p: MaybeReal) =>
	p.real === true &&
	typeof p.srID === "string" &&
	p.subLean === undefined &&
	(!p.subP || (p.subP.n === 1 && p.subP.rs === undefined));

// The stored stats-derived leans of real players (tools/realSubRatings.ts), from the real players data file: his latest ratings row up to
// this season. Only loaded when some real player still needs one.
const attachRealLeans = async (players: MaybeReal[]) => {
	const want = players.filter(
		(p) => p.tid !== PLAYER.RETIRED && needsRealLean(p),
	);
	if (want.length === 0) {
		return false;
	}
	let data;
	try {
		data = await loadDataBasketball();
	} catch {
		// Offline: they keep a neutral shape, and get another try next time
		return false;
	}
	const season = g.get("season");
	const slugs = new Set(want.map((p) => p.srID!));
	const best = new Map<string, { season: number; lean?: string }>();
	for (const r of data.ratings) {
		if (!slugs.has(r.slug) || r.season > season) {
			continue;
		}
		const prev = best.get(r.slug);
		if (!prev || r.season > prev.season) {
			best.set(r.slug, { season: r.season, lean: r.subLean });
		}
	}
	for (const p of want) {
		const lean = best.get(p.srID!)?.lean;
		if (lean !== undefined) {
			p.subLean = lean;
		}
	}
	return true;
};

// Sub-ratings turned on in a league, or a league opened (or created from a file or real rosters) with the setting on: every player who
// isn't retired gets his sub-ratings filled in once from his ratings (real players: a shape from their real stats; others a neutral shape
// plus a lean from his size and physicals, seeded by his pid; draft prospects of generated classes get their generated shape), and rows
// whose bases changed while the setting was off are brought back in sync, keeping their shape. Bases are never changed. Retired players
// are left alone (their pages show bases only). With the setting off, real players' unread leans are dropped (nothing else changes).
// Returns the number of players changed.
const updateSubRatingsForLeague = async () => {
	if (__SPORT !== "basketball") {
		return 0;
	}
	const players = await idb.cache.players.getAll();
	if (!subRatingsOn()) {
		for (const p of players) {
			if ((p as MaybeReal).subLean !== undefined) {
				delete (p as MaybeReal).subLean;
				await idb.cache.players.put(p);
			}
		}
		return 0;
	}
	const loaded = await attachRealLeans(players as MaybeReal[]);
	let n = 0;
	for (const p of players) {
		if (p.tid === PLAYER.RETIRED) {
			continue;
		}
		let changed = ensureSubs(p as any);
		const pr = p as MaybeReal;
		if (loaded && pr.subP && needsRealLean(pr)) {
			// A real player with no stats to read: he keeps his neutral shape, and isn't looked up again
			pr.subP.rs = 0;
			changed = true;
		}
		if (changed) {
			n += 1;
			await idb.cache.players.put(p);
		}
	}
	return n;
};

// Whether any player who isn't retired is missing his sub-ratings or has them out of sync, or is a real player whose shape hasn't been
// read from his stats yet (cheap check before the update)
export const subRatingsNeedUpdate = async () => {
	if (__SPORT !== "basketball" || !subRatingsOn()) {
		return false;
	}
	const players = await idb.cache.players.getAll();
	return players.some((p) => {
		if (p.tid === PLAYER.RETIRED) {
			return false;
		}
		const r = p.ratings.at(-1) as any;
		return (
			!p.subP ||
			!isValidSubArray(r.sub) ||
			!subsMatchBases(r) ||
			needsRealLean(p as MaybeReal)
		);
	});
};

export default updateSubRatingsForLeague;
