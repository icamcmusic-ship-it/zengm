import { openDB, type IDBPDatabase } from "@dumbmatter/idb";

// Per-season results of a few league pages that read every box score of a season (Best Games, and the reduced box scores
// that Home Court, Rivalries and Team History read, see gameSummaries.ts), kept in a database of their own so that a past
// season is read once, not once per session. JSON strings, which IndexedDB stores and returns much faster than nested
// objects.
//
// Best effort, like wrappedPersist.ts: if the database can't be opened or an operation fails, there's no cache. What keeps
// it correct:
// - every entry has a version (of the code that made it) and the number of box scores its season had, which the reader
//   compares to the league's, and some a signature of whatever else they depend on (team names, say)
// - the change log (db/changeLog.ts) calls forgetSeason for every write to the box scores of a past season, and
//   forgetLeague when the league may have changed behind the cache's back or is deleted

const DB_NAME = "page-cache";
const STORE = "seasons";

export type PageKind = "sums" | "best";

type Entry = { v: number; count: number; sig: string; json: string };

let dbPromise: Promise<IDBPDatabase<unknown> | undefined> | undefined;
let dbFactory: IDBFactory | undefined;
const OPEN_TIMEOUT_MS = 10000;
const TIMEOUT_MS = 20000;

const getDb = () => {
	const factory = typeof indexedDB === "undefined" ? undefined : indexedDB;
	if (factory !== dbFactory) {
		dbFactory = factory;
		dbPromise = undefined;
	}
	if (!factory) {
		return Promise.resolve(undefined);
	}
	dbPromise ??= (async () => {
		try {
			const opening = openDB(DB_NAME, 1, {
				upgrade(db) {
					if (!db.objectStoreNames.contains(STORE)) {
						db.createObjectStore(STORE);
					}
				},
				blocking() {
					void opening.then((db) => db.close());
					dbPromise = undefined;
				},
			});
			const timeout = new Promise<undefined>((resolve) => {
				const t = setTimeout(() => resolve(undefined), OPEN_TIMEOUT_MS);
				(t as { unref?: () => void }).unref?.();
			});
			return (await Promise.race([opening, timeout])) as unknown as
				| IDBPDatabase<unknown>
				| undefined;
		} catch {
			return undefined;
		}
	})();
	return dbPromise;
};

// One operation at a time, in order, so a read never overtakes the forget that was meant to drop what it would read
let chain: Promise<unknown> = Promise.resolve();
const run = <T>(
	fallback: T,
	f: (db: IDBPDatabase<unknown>) => Promise<T>,
): Promise<T> => {
	const timeout = new Promise<T>((resolve) => {
		const t = setTimeout(() => resolve(fallback), TIMEOUT_MS);
		(t as { unref?: () => void }).unref?.();
	});
	const p = chain.then(() =>
		Promise.race([
			(async () => {
				try {
					const db = await getDb();
					return db ? await f(db) : fallback;
				} catch {
					return fallback;
				}
			})(),
			timeout,
		]),
	);
	chain = p;
	return p;
};

export const loadPage = <T>(
	lid: number,
	kind: PageKind,
	season: number,
	expected: { v: number; count: number; sig: string },
) =>
	run<T | undefined>(undefined, async (db) => {
		const e = (await db.get(STORE, [lid, kind, season])) as Entry | undefined;
		if (
			!e ||
			e.v !== expected.v ||
			e.count !== expected.count ||
			e.sig !== expected.sig
		) {
			return undefined;
		}
		return JSON.parse(e.json) as T;
	});

export const savePage = (
	lid: number,
	kind: PageKind,
	season: number,
	meta: { v: number; count: number; sig: string },
	value: unknown,
) =>
	run(undefined, async (db) => {
		const e: Entry = { ...meta, json: JSON.stringify(value) };
		await db.put(STORE, e, [lid, kind, season]);
	});

// Is there an entry (of any version)? For the background warm-up, which skips seasons already done
export const hasPage = (lid: number, kind: PageKind, season: number) =>
	run(false, async (db) => {
		return (await db.getKey(STORE, [lid, kind, season])) !== undefined;
	});

const KINDS: PageKind[] = ["sums", "best"];

export const forgetSeason = (lid: number, season: number) =>
	run(undefined, async (db) => {
		const tx = db.transaction(STORE, "readwrite");
		for (const kind of KINDS) {
			void tx.store.delete([lid, kind, season]);
		}
		await tx.done;
	});

export const forgetLeague = (lid: number) =>
	run(undefined, async (db) => {
		await db.delete(STORE, IDBKeyRange.bound([lid], [lid, []]));
	});

// Delete Old Data: the database's size (JSON length of its entries, every league) and clearing it (every league; the pages
// just read their seasons again)
export const cacheBytes = () =>
	run(0, async (db) => {
		let bytes = 0;
		for await (const cursor of db.transaction(STORE).store) {
			bytes += (cursor.value as Entry).json.length + 40;
		}
		return bytes;
	});

export const clearAll = () =>
	run(undefined, async (db) => {
		await db.clear(STORE);
	});
