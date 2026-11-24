// Era-adjusted stats (common/eraAdjust.ts): the league's regular season team totals by season. Past seasons rarely change,
// so they are read from the database once per league and session (see pastCache); the current season comes from the cache
// on every call.
import {
	ERA_TOTAL_KEYS,
	makeEraAdjuster,
	type EraAdjuster,
	type EraTotals,
} from "../../common/eraAdjust.ts";
import type { TeamStats } from "../../common/types.ts";
import { idb } from "../db/index.ts";
import { changeLog } from "../db/changeLog.ts";
import { g } from "./index.ts";

const empty = (): EraTotals => ({
	gp: 0,
	pts: 0,
	orb: 0,
	drb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tov: 0,
	pf: 0,
	fg: 0,
	fga: 0,
	tp: 0,
	tpa: 0,
	ft: 0,
	fta: 0,
});

const addRows = (out: Map<number, EraTotals>, rows: TeamStats[]) => {
	for (const row of rows) {
		if (row.playoffs) {
			continue;
		}
		let t = out.get(row.season);
		if (!t) {
			t = empty();
			out.set(row.season, t);
		}
		t.gp += row.gp ?? 0;
		for (const k of ERA_TOTAL_KEYS) {
			t[k] += (row as any)[k] ?? 0;
		}
	}
};

// Past seasons' totals, read through the "season, tid" index: all of them once per league and session, then only the
// seasons that became past since. Dropped when the change log says a past season's team stats were written (God Mode, an
// import of team stats) or the cache was refilled (Delete Old Data and anything else that changes the database behind
// the cache's back)
let pastCache:
	| {
			lid: number;
			epoch: number;
			seq: number;
			// Seasons before this one are in totals
			upTo: number;
			totals: Map<number, EraTotals>;
	  }
	| undefined;

const readSeasons = async (
	out: Map<number, EraTotals>,
	from: number | undefined,
	to: number,
) => {
	const range =
		from === undefined
			? IDBKeyRange.upperBound([to], true)
			: IDBKeyRange.bound([from], [to], false, true);
	addRows(
		out,
		(await idb.league
			.transaction("teamStats")
			.store.index("season, tid")
			.getAll(range)) as TeamStats[],
	);
};

const pastStale = () => {
	if (
		!pastCache ||
		pastCache.lid !== g.get("lid") ||
		pastCache.epoch !== changeLog.epoch
	) {
		return true;
	}
	// (a season with no rows is checked too, through the store-wide entry every season check includes)
	for (const s of [...pastCache.totals.keys(), -Infinity]) {
		if (
			s < pastCache.upTo &&
			changeLog.season("teamStats", s) > pastCache.seq
		) {
			return true;
		}
	}
	return false;
};

export const getEraAdjuster = async (): Promise<EraAdjuster> => {
	const season = g.get("season");
	if (pastStale()) {
		const seq = changeLog.seq;
		const past = new Map<number, EraTotals>();
		await readSeasons(past, undefined, season);
		pastCache = {
			lid: g.get("lid"),
			epoch: changeLog.epoch,
			seq,
			upTo: season,
			totals: past,
		};
	} else if (pastCache!.upTo < season) {
		const seq = changeLog.seq;
		await readSeasons(pastCache!.totals, pastCache!.upTo, season);
		pastCache!.upTo = season;
		pastCache!.seq = seq;
	}
	pastCache = pastCache!;
	// (after a season is moved back, a season at or past the current one is not "past")
	const totals = new Map([...pastCache.totals].filter(([s]) => s < season));
	const current = new Map<number, EraTotals>();
	addRows(
		current,
		(await idb.cache.teamStats.getAll()).filter((row) => row.season === season),
	);
	for (const [s, t] of current) {
		totals.set(s, t);
	}
	return makeEraAdjuster(totals);
};
