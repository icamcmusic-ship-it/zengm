import type { PlayerFeat } from "../../../common/types.ts";
import { idb } from "../index.ts";
import { MergedStore, type Exclusive, type Query } from "./engine.ts";

export type PlayerFeatsSelector = Exclusive<
	| { season: number }
	// Feats with fid above this, for readers that keep what they read before and only need what was added since
	| { fidAbove: number }
>;

// The playerFeats store has no season index (adding one would mean a database upgrade), but fids are auto-increment, so
// each season's feats sit in a range of fids. The ranges are found with one pass over the store per league connection,
// then a season query only reads its own range plus anything added since that pass. Old feats never change season, and
// deleting feats only makes a range wider than it needs to be, which is fine since matches still checks the season.
//
// The ranges belong to one database connection (idb.league), not to a lid: importing a league over an existing one
// replaces the store under the same lid and connects again, so a new connection always means a new pass.
type LeagueDb = typeof idb.league;
type Ranges = {
	db: LeagueDb;
	// Highest fid seen in the pass. Rows above it were added later and are read by every query
	scannedMax: number;
	seasons: Map<number, [number, number]>;
};
let ranges: Ranges | undefined;
let pending: { db: LeagueDb; promise: Promise<Ranges> } | undefined;

const scan = async (db: LeagueDb): Promise<Ranges> => {
	const out: Ranges = { db, scannedMax: -1, seasons: new Map() };
	for await (const cursor of db.transaction("playerFeats").store.iterate()) {
		const f = cursor.value;
		out.scannedMax = Math.max(out.scannedMax, f.fid);
		const r = out.seasons.get(f.season);
		if (r) {
			r[0] = Math.min(r[0], f.fid);
			r[1] = Math.max(r[1], f.fid);
		} else {
			out.seasons.set(f.season, [f.fid, f.fid]);
		}
	}
	return out;
};

const getRanges = async (): Promise<Ranges> => {
	for (;;) {
		const db = idb.league;
		if (ranges?.db === db) {
			return ranges;
		}
		// A pass still running for another connection (a league switch or import while it ran) is no use here
		if (pending?.db !== db) {
			const p: { db: LeagueDb; promise: Promise<Ranges> } = {
				db,
				promise: scan(db).finally(() => {
					if (pending === p) {
						pending = undefined;
					}
				}),
			};
			pending = p;
		}
		const r = await pending.promise;
		if (r.db === idb.league) {
			ranges = r;
			return r;
		}
		// The connection changed while waiting: start over for the new one
	}
};

// For tests and for anything that rewrites the store wholesale without connecting again
export const resetPlayerFeatsRanges = () => {
	ranges = undefined;
	pending = undefined;
};

async function* seasonRows(season: number) {
	const r = await getRanges();
	const own = r.seasons.get(season);
	const bounds: IDBKeyRange[] = [];
	if (own) {
		bounds.push(IDBKeyRange.bound(own[0], own[1]));
	}
	bounds.push(IDBKeyRange.lowerBound(r.scannedMax, true));
	for (const bound of bounds) {
		for await (const cursor of r.db
			.transaction("playerFeats")
			.store.iterate(bound)) {
			yield cursor;
		}
	}
}

class PlayerFeatsStore extends MergedStore<"playerFeats", PlayerFeatsSelector> {
	protected override toQuery(
		selector: PlayerFeatsSelector | undefined,
	): Query<PlayerFeat> | undefined {
		if (selector === undefined) {
			return undefined;
		}

		if (selector.season !== undefined) {
			const season = selector.season;
			return {
				fromDb: () => seasonRows(season),
				matches: (f) => f.season === season,
			};
		}

		if (selector.fidAbove !== undefined) {
			const fid = selector.fidAbove;
			return {
				fromDb: () =>
					idb.league
						.transaction("playerFeats")
						.store.iterate(IDBKeyRange.lowerBound(fid, true)),
				matches: (f) => f.fid > fid,
			};
		}

		throw new Error("Invalid selector");
	}
}

export default new PlayerFeatsStore("playerFeats");
