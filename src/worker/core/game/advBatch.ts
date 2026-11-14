import { PHASE } from "../../../common/constants.ts";
import { addAdv, addTeamAdv, type TeamAdv } from "../../../common/advStats.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { isCollege } from "../college/isCollege.ts";

// perf3: Advanced Tracking Stats are added to the season's stats rows every ADV_BATCH_DAYS days of games in pro leagues, instead of after
// every game. Until then each game's numbers wait here, by stats row: a player's summed (integer sums, so the same in any order), a
// team's kept game by game and added in the order they were played, so the in-season lineup pruning (common/advStats.ts addTeamAdv)
// keeps exactly the lineups it would have kept game by game. The waiting games are added before a phase change, when the sim stops,
// when a league closes, and before any page or award that reads tracking stats, so season totals are the same as game by game.
export const ADV_BATCH_DAYS = 3;

let lid: number | undefined;
// (by stats row: a player's row lives on the player object, so his pid too)
type StatsRow = {
	season: number;
	tid: number;
	playoffs: boolean;
	adv?: number[];
};
const players = new Map<StatsRow, { pid: number; sum: number[] }>();
const teams = new Map<
	{ rid?: number; adv?: TeamAdv },
	{ numPlayers: number; games: TeamAdv[] }
>();
let days = 0;

// (off: game by game, as before; for the sim benchmark's comparison)
let enabled = true;
export const setAdvBatchEnabled = (on: boolean) => {
	enabled = on;
};

export const advBatchOn = () =>
	enabled &&
	__SPORT === "basketball" &&
	!isCollege() &&
	(g.get("phase") === PHASE.REGULAR_SEASON ||
		g.get("phase") === PHASE.PLAYOFFS);

const sameLeague = () => {
	if (lid !== g.get("lid")) {
		// (left over from another league, which close() should have added already)
		players.clear();
		teams.clear();
		days = 0;
		lid = g.get("lid");
	}
};

export const queuePlayerAdv = (
	pid: number,
	row: StatsRow,
	adv: readonly number[],
) => {
	sameLeague();
	const q = players.get(row);
	if (q) {
		addAdv(q.sum, adv);
	} else {
		players.set(row, { pid, sum: [...adv] });
	}
};

export const queueTeamAdv = (
	row: { rid?: number; adv?: TeamAdv },
	adv: TeamAdv,
	numPlayers: number,
) => {
	sameLeague();
	const q = teams.get(row);
	if (q) {
		q.games.push(adv);
	} else {
		teams.set(row, { numPlayers, games: [adv] });
	}
};

export const advBatchPending = () =>
	lid === g.get("lid") && (players.size > 0 || teams.size > 0);

// Add everything waiting to the stats rows
export const flushAdvBatch = async () => {
	days = 0;
	if (lid !== g.get("lid")) {
		sameLeague();
		return;
	}
	if (players.size === 0 && teams.size === 0) {
		return;
	}
	const playerRows = [...players];
	const teamRows = [...teams];
	players.clear();
	teams.clear();
	for (const [row, { pid, sum }] of playerRows) {
		const p = await idb.cache.players.get(pid);
		if (!p) {
			continue;
		}
		// (the same row, unless something replaced his stats rows meanwhile)
		const rows = p.stats as unknown as StatsRow[];
		const ps =
			rows.includes(row) || (p.nitStats as unknown[] | undefined)?.includes(row)
				? row
				: rows.findLast(
						(r) =>
							r.season === row.season &&
							r.tid === row.tid &&
							r.playoffs === row.playoffs,
					);
		if (ps) {
			ps.adv = ps.adv ? addAdv(ps.adv, sum) : sum;
			await idb.cache.players.put(p);
		}
	}
	for (const [row, q] of teamRows) {
		const ts =
			(row.rid !== undefined
				? ((await idb.cache.teamStats.get(row.rid)) as typeof row | undefined)
				: undefined) ?? row;
		for (const adv of q.games) {
			ts.adv = addTeamAdv(ts.adv ?? { t: [], lu: [] }, adv, q.numPlayers);
		}
		await idb.cache.teamStats.put(ts as any);
	}
};

// After a day of games: every ADV_BATCH_DAYS days, add them
export const advBatchDayDone = async () => {
	if (!advBatchPending()) {
		days = 0;
		return;
	}
	days += 1;
	if (days >= ADV_BATCH_DAYS) {
		await flushAdvBatch();
	}
};
