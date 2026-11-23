// Era-adjusted stats (common/eraAdjust.ts): the league's regular season team totals by season. Past seasons don't change, so they are read
// from the database once per league; the current season comes from the cache on every call.
import {
	ERA_TOTAL_KEYS,
	makeEraAdjuster,
	type EraAdjuster,
	type EraTotals,
} from "../../common/eraAdjust.ts";
import type { TeamStats } from "../../common/types.ts";
import { idb } from "../db/index.ts";
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

let pastCache: { key: string; totals: Map<number, EraTotals> } | undefined;

export const getEraAdjuster = async (): Promise<EraAdjuster> => {
	const season = g.get("season");
	const key = `${g.get("lid")}|${season}`;
	if (pastCache?.key !== key) {
		const past = new Map<number, EraTotals>();
		const rows = (await idb.league
			.transaction("teamStats")
			.store.getAll()) as TeamStats[];
		addRows(
			past,
			rows.filter((row) => row.season < season),
		);
		pastCache = { key, totals: past };
	}
	const totals = new Map(pastCache.totals);
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
