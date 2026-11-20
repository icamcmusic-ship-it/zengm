import type { PlayerFeat } from "../../../common/types.ts";
import { g } from "../../util/index.ts";
import { idb } from "../index.ts";
import { MergedStore, type Exclusive, type Query } from "./engine.ts";

export type PlayerFeatsSelector = Exclusive<{ season: number }>;

// The playerFeats store has no season index (adding one would mean a database upgrade), but fids are auto-increment, so
// each season's feats sit in a range of fids. The ranges are found with one pass over the store per league per session,
// then a season query only reads its own range plus anything added since that pass. Old feats never change season, and
// deleting feats only makes a range wider than it needs to be, which is fine since matches still checks the season.
type Ranges = {
	lid: number;
	// Highest fid seen in the pass. Rows above it were added later and are read by every query
	scannedMax: number;
	seasons: Map<number, [number, number]>;
};
let ranges: Ranges | undefined;
let pending: Promise<Ranges> | undefined;

const scan = async (lid: number): Promise<Ranges> => {
	const out: Ranges = { lid, scannedMax: -1, seasons: new Map() };
	for await (const cursor of idb.league
		.transaction("playerFeats")
		.store.iterate()) {
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

const getRanges = async () => {
	const lid = g.get("lid");
	if (ranges?.lid === lid) {
		return ranges;
	}
	if (!pending) {
		pending = scan(lid).finally(() => {
			pending = undefined;
		});
	}
	const r = await pending;
	if (r.lid === lid) {
		ranges = r;
	}
	return r;
};

// For tests and for anything that rewrites the store wholesale (a new league with the same lid would be caught by lid)
export const resetPlayerFeatsRanges = () => {
	ranges = undefined;
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
		for await (const cursor of idb.league
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

		throw new Error("Invalid selector");
	}
}

export default new PlayerFeatsStore("playerFeats");
