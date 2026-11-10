// How heated each pair of teams' rivalry is, for the trash talk in the basketball play-by-play (common/pbpFlavor/trashTalk.ts): the shared
// rivalry score (common/rivalries, the one behind the Rivalries page, the hype score and Storylines), reduced to its two top tiers. The
// level rides along with a game's play-by-play events (and is stored with them), so the live view and a stored game word it the same.
//
// Cosmetic only: nothing in the game sim reads it. Loaded once per season and again when the playoffs start, and kept in memory; the
// playoff series, the head-to-head records and this season's games are read, not every stored box score of past seasons (their close
// games and star duels are the only part of the full score left out, so a level here is never higher than the Rivalries page shows).
import { PHASE } from "../../common/constants.ts";
import { rivalryLevelOfTier } from "../../common/pbpFlavor/trashTalk.ts";
import g from "./g.ts";
import { loadRivalries, pairKey } from "./rivalries.ts";

const NONE = new Map<string, number>();

let cache: { key: string; levels: Map<string, number> } | undefined;

export const getPbpRivalryLevels = async (
	// (replaced in tests)
	load: (
		season: number,
		opts: { storedGames: boolean },
	) => Promise<{ key: string; score: { tier: string } }[]> = loadRivalries,
): Promise<Map<string, number>> => {
	// (only the trash talk uses it, and nobody talks without the Temper trait)
	if (__SPORT !== "basketball" || !g.get("playerTraits")) {
		return NONE;
	}
	const key = `${g.get("lid")}|${g.get("season")}|${g.get("phase") >= PHASE.PLAYOFFS ? 1 : 0}`;
	if (cache?.key === key) {
		return cache.levels;
	}
	const levels = new Map<string, number>();
	try {
		for (const pair of await load(g.get("season"), {
			storedGames: false,
		})) {
			const level = rivalryLevelOfTier(pair.score.tier);
			if (level > 0) {
				levels.set(pair.key, level);
			}
		}
	} catch (error) {
		// Never worth stopping a game for
		console.error(error);
	}
	cache = { key, levels };
	return levels;
};

export const pbpRivalryLevel = (
	levels: Map<string, number>,
	tid0: number,
	tid1: number,
) => (tid0 < 0 || tid1 < 0 ? 0 : (levels.get(pairKey(tid0, tid1)) ?? 0));

export const resetPbpRivalryCache = () => {
	cache = undefined;
};
