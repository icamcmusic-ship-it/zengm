import { bySport } from "./sportFunctions.ts";

type LegacyRow = {
	tid: number;
	gp?: number;
	playoffs?: boolean;
	ewa?: number;
	war?: number;
	av?: number;
	ps?: number;
};

/**
 * A retired player's legacy team (Hall of Fame page and plaques, ballot rows, the player page's colors): the team he gave the most
 * value for, the sport's value stat (EWA, WAR, AV, PS) summed over his regular season and playoff rows with it. Ties (and stats
 * without the value stat) go to the team he played the most regular season games for, then the lower tid. -1 with no team rows.
 */
export const legacyTidOf = (stats: readonly LegacyRow[]) => {
	const value = new Map<number, number>();
	const gp = new Map<number, number>();
	for (const row of stats) {
		if (!(row.tid >= 0)) {
			continue;
		}
		const v = bySport({
			baseball: row.war,
			basketball: row.ewa,
			football: row.av,
			hockey: row.ps,
		});
		value.set(row.tid, (value.get(row.tid) ?? 0) + (Number(v) || 0));
		if (!row.playoffs) {
			gp.set(row.tid, (gp.get(row.tid) ?? 0) + (row.gp ?? 0));
		}
	}
	let best = -1;
	for (const tid of value.keys()) {
		if (
			best < 0 ||
			value.get(tid)! > value.get(best)! ||
			(value.get(tid) === value.get(best) &&
				((gp.get(tid) ?? 0) > (gp.get(best) ?? 0) ||
					((gp.get(tid) ?? 0) === (gp.get(best) ?? 0) && tid < best)))
		) {
			best = tid;
		}
	}
	return best;
};
