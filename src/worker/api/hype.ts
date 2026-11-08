// Worker API for game hype. Computed on request, lazily and cached (see util/hypeData.ts), so the views that show it stay fast.
import type { ChaseRow, HypeLite } from "../../common/hype/index.ts";
import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { featureOn } from "../util/nativeFeatures.ts";
import {
	hypeChases,
	hypeForGids,
	hypeForUpcoming,
	upcomingTargets,
} from "../util/hypeData.ts";

export type HypeBoard = {
	enabled: boolean;
	// The next days of games, each sorted by must-watch score
	days: { day: number; games: HypeLite[] }[];
	chases: ChaseRow[];
	// The most recent day of finished games with the verdict on each
	recent: HypeLite[];
};

// League extras: hype is only computed while the feature is on
const enabled = () => featureOn("hype");

// Finished games of the latest day (current season)
const recentGids = async () => {
	const games = await idb.cache.games.getAll();
	let maxDay = -1;
	for (const gm of games) {
		if (gm.teams[0].tid >= 0 && (gm.day ?? 0) > maxDay) {
			maxDay = gm.day ?? 0;
		}
	}
	return games
		.filter(
			(gm) =>
				gm.teams[0].tid >= 0 &&
				gm.teams[1].tid >= 0 &&
				(gm.day ?? 0) === maxDay &&
				gm.season === g.get("season"),
		)
		.map((gm) => gm.gid);
};

const hype = {
	// Upcoming days, the record chases and (optionally) last day's results
	board: async ({
		days = 2,
		chases = 0,
		recent = false,
	}: {
		days?: number;
		chases?: number;
		recent?: boolean;
	} = {}): Promise<HypeBoard> => {
		if (!enabled()) {
			return { enabled: false, days: [], chases: [], recent: [] };
		}
		const up = await upcomingTargets(days);
		const outDays: HypeBoard["days"] = [];
		for (const d of up.days) {
			const games = await hypeForUpcoming(d.games);
			games.sort((a, b) => b.score - a.score || a.gid - b.gid);
			outDays.push({ day: d.day, games });
		}
		const recentGames: HypeLite[] = [];
		if (recent) {
			const gids = await recentGids();
			const map = await hypeForGids(gids);
			recentGames.push(
				...Object.values(map).sort(
					(a, b) => b.watch - a.watch || a.gid - b.gid,
				),
			);
		}
		return {
			enabled: true,
			days: outDays,
			chases: chases > 0 ? await hypeChases(chases) : [],
			recent: recentGames,
		};
	},

	// Hype of games by gid (upcoming or finished)
	forGids: ({
		gids,
	}: {
		gids: number[];
	}): Promise<Record<number, HypeLite>> => {
		if (!enabled() || gids.length === 0) {
			return Promise.resolve({});
		}
		return hypeForGids(gids);
	},
};

export default hype;
