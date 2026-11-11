// What the basketball play-by-play says at tip-off about where the teams stand and who is facing a former team (common/pbpFlavor/story.ts):
// each team's record, streak and league rank coming in, and, for each player, whether he has played for the other team. It rides along with
// the game's play-by-play events (and is stored with them, pbpFlavor/store.ts), so the live view and a stored game word it the same.
//
// Cosmetic only: nothing in the game sim reads it, and it is read from the cache once per day of games.
import { PHASE } from "../../common/constants.ts";
import { idb } from "../db/index.ts";
import g from "./g.ts";

// pbpGame, on the home team: for the home team and then the away team, [won, lost, streak (+ wins, - losses; 0 in the playoffs), rank by
// winning percentage (1 = best, tied teams share a rank), number of teams, neutral site (1)]. Never reorder: stored games use it (store.ts)

export const setPbpGameContext = async (
	schedule: readonly {
		homeTid: number;
		awayTid: number;
		finals?: boolean;
	}[],
	teams: Record<number, any>,
) => {
	if (__SPORT !== "basketball") {
		return;
	}
	const season = g.get("season");
	const playoffs = g.get("phase") >= PHASE.PLAYOFFS;
	let rows: {
		tid: number;
		won: number;
		lost: number;
		tied?: number;
		otl?: number;
		streak: number;
	}[] = [];
	try {
		rows = (await idb.cache.teamSeasons.indexGetAll("teamSeasonsBySeasonTid", [
			[season],
			[season, "Z"],
		])) as any;
	} catch (error) {
		// Never worth stopping a game for
		console.error(error);
	}
	const pct = (r: (typeof rows)[number]) => {
		const gp = r.won + r.lost + (r.tied ?? 0) + (r.otl ?? 0);
		return gp > 0 ? (r.won + 0.5 * (r.tied ?? 0)) / gp : 0.5;
	};
	const byTid = new Map(rows.map((r) => [r.tid, r]));
	const active = rows;
	const contextOf = (tid: number, neutral: boolean): number[] | undefined => {
		const r = byTid.get(tid);
		if (!r || !Number.isFinite(r.won) || !Number.isFinite(r.lost)) {
			return undefined;
		}
		const p = pct(r);
		// (1 + the number of teams strictly ahead: tied teams share a rank)
		const rank = 1 + active.filter((o) => pct(o) > p).length;
		return [
			r.won,
			r.lost,
			// (a streak in the playoffs mixes in playoff games: left out)
			playoffs || !Number.isFinite(r.streak) ? 0 : r.streak,
			rank,
			active.length,
			neutral ? 1 : 0,
		];
	};
	for (const matchup of schedule) {
		const home = teams[matchup.homeTid];
		const away = teams[matchup.awayTid];
		if (!home || !away || matchup.homeTid < 0 || matchup.awayTid < 0) {
			continue;
		}
		const neutral =
			playoffs &&
			(g.get("neutralSite") === "playoffs" ||
				(g.get("neutralSite") === "finals" && !!matchup.finals));
		const a = contextOf(matchup.homeTid, neutral);
		const b = contextOf(matchup.awayTid, neutral);
		if (a && b) {
			home.pbpGame = [...a, ...b];
		}
		// Who has played for the other team (loadTeams: pbpTids, the other teams of his regular season stats rows)
		for (const [t, other] of [
			[home, matchup.awayTid],
			[away, matchup.homeTid],
		] as const) {
			for (const p of t.player ?? []) {
				if (
					p.pbpRatings &&
					Array.isArray(p.pbpTids) &&
					p.pbpTids.includes(other)
				) {
					p.pbpRatings.former = 1;
				}
			}
		}
	}
};
