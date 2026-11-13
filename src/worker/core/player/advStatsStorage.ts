// Advanced Tracking Stats (League extras, see docs/native-features.md, common/advStats.ts): keeping the stored records small, and the
// play-type profile helper for other features (archetypes)
import {
	LINEUPS_FINAL,
	playTypeProfile,
	pruneLineups,
	sumAdv,
} from "../../../common/advStats.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";

// A retired player keeps his tracking records for his last few seasons only (like the sub-ratings history)
export const ADV_RETIRED_SEASONS = 3;

export const trimAdvOnRetire = (p: Pick<Player, "stats">) => {
	const seasons = [
		...new Set(p.stats.filter((row) => row.adv).map((row) => row.season)),
	].sort((a, b) => b - a);
	if (seasons.length <= ADV_RETIRED_SEASONS) {
		return;
	}
	const keepFrom = seasons[ADV_RETIRED_SEASONS - 1]!;
	for (const row of p.stats) {
		if (row.adv && row.season < keepFrom) {
			delete row.adv;
		}
	}
};

// After the playoffs: each team-season keeps its LINEUPS_FINAL most used lineups
export const pruneSeasonLineups = async (season: number = g.get("season")) => {
	const numPlayers = g.get("numPlayersOnCourt");
	const rows = await idb.cache.teamStats.getAll();
	for (const row of rows) {
		if (row.season === season && row.adv && row.adv.lu.length > LINEUPS_FINAL) {
			row.adv.lu = pruneLineups(row.adv.lu, numPlayers, LINEUPS_FINAL);
			await idb.cache.teamStats.put(row);
		}
	}
};

// A player's play-type profile (each play type's possessions, frequency, points per possession, FG%, TOV%) for one regular season (all
// his teams), or over every regular season with tracking stats. Undefined without tracking stats. For archetypes (step 4) and others.
export const getPlayTypeProfile = (p: Pick<Player, "stats">, season?: number) =>
	playTypeProfile(
		sumAdv(
			p.stats.filter(
				(row) =>
					!row.playoffs && (season === undefined || row.season === season),
			),
		),
	);
