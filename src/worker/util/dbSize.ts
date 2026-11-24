import { idb } from "../db/index.ts";
import { cacheBytes as pageCacheBytes } from "./pagePersist.ts";
import { cacheBytes as wrappedCacheBytes } from "./wrappedPersist.ts";

// The league database's size by object store, as the JSON length of its records (close to what IndexedDB keeps on disk,
// before compression). Record by record, so the whole database is never one string in memory. Reads every record, so it
// is only run when asked (Delete Old Data, the long run script).
export const leagueStoreBytes = async () => {
	const stores: Record<string, number> = {};
	let total = 0;
	const db = idb.league as any;
	for (const store of db.objectStoreNames as any as string[]) {
		let bytes = 0;
		for await (const cursor of db.transaction(store).store) {
			bytes += JSON.stringify(cursor.value).length;
		}
		stores[store] = bytes;
		total += bytes;
	}
	return { total, stores };
};

// Delete Old Data: the league's stores and the two cache databases shared by all leagues (page-cache, wrapped-cache)
export const storageSizes = async () => {
	const [league, pageCache, wrappedCache] = await Promise.all([
		leagueStoreBytes(),
		pageCacheBytes(),
		wrappedCacheBytes(),
	]);
	return { league, pageCache, wrappedCache };
};
