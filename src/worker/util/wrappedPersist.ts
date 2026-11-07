import { openDB, type IDBPDatabase } from "@dumbmatter/idb";
import type { WGame, WPlayer } from "../../common/wrapped/types.ts";

// The converted pieces of the Wrapped and Storylines snapshot that are slow to read and never change once a player has retired or a season is over, kept in a database of their own so that the next session doesn't have to read the league again. It holds JSON strings, which IndexedDB stores and returns much faster than the nested objects they came from.
//
// Everything here is best effort: if the database can't be opened or a read or write fails, there's just no cache. What keeps it correct:
// - a version (derived from the code that converts the data, see wrappedData.ts), so a different conversion never reads old entries
// - the change log (db/changeLog.ts) calls the forget* functions for every write to a retired player or a past season's box scores, before the league's own write is saved
// - box scores also store how many games the season had, which the loader compares to the league

const DB_NAME = "wrapped-cache";

type CacheDB = IDBPDatabase<unknown>;

let dbPromise: Promise<CacheDB | undefined> | undefined;

const getDb = () => {
	dbPromise ??= (async () => {
		try {
			return (await openDB(DB_NAME, 1, {
				upgrade(db) {
					db.createObjectStore("meta");
					db.createObjectStore("players");
					db.createObjectStore("games");
				},
			})) as unknown as CacheDB;
		} catch {
			return undefined;
		}
	})();
	return dbPromise;
};

// One operation at a time, in the order they were asked for, so a read never overtakes the write that was meant to drop what it would read. Errors are swallowed: a failed operation just means nothing is cached.
let chain: Promise<unknown> = Promise.resolve();
const run = <T>(fallback: T, f: (db: CacheDB) => Promise<T>): Promise<T> => {
	const p = chain.then(async () => {
		try {
			const db = await getDb();
			return db ? await f(db) : fallback;
		} catch {
			return fallback;
		}
	});
	chain = p;
	return p;
};

const lidRange = (lid: number) =>
	IDBKeyRange.bound([lid, -Infinity], [lid, Infinity]);

export type Persisted = {
	players: Map<number, WPlayer>;
	games: Map<number, { count: number; list: WGame[] }>;
};

// Entries for a league are only good for one version of the converter
export const loadPersisted = (lid: number, version: string) =>
	run<Persisted>({ players: new Map(), games: new Map() }, async (db) => {
		const players = new Map<number, WPlayer>();
		const games = new Map<number, { count: number; list: WGame[] }>();

		if ((await db.get("meta", lid)) !== version) {
			const tx = db.transaction(["meta", "players", "games"], "readwrite");
			await Promise.all([
				tx.objectStore("players").delete(lidRange(lid)),
				tx.objectStore("games").delete(lidRange(lid)),
				tx.objectStore("meta").put(version, lid),
				tx.done,
			]);
			return { players, games };
		}

		const readAll = async (
			storeName: "players" | "games",
			chunk: number,
			f: (key: [number, number], value: any) => void,
		) => {
			// In pieces, since a huge result can fail ("Maximum IPC message size exceeded"), but in one transaction so keys and values match
			const store = db.transaction(storeName).store;
			let lower: [number, number] = [lid, -Infinity];
			let open = false;
			for (;;) {
				const range = IDBKeyRange.bound(lower, [lid, Infinity], open);
				const [keys, values] = await Promise.all([
					store.getAllKeys(range, chunk),
					store.getAll(range, chunk),
				]);
				keys.forEach((key, i) => f(key as [number, number], values[i]));
				if (keys.length < chunk) {
					break;
				}
				lower = keys.at(-1) as [number, number];
				open = true;
			}
		};
		await readAll("players", 500, (key, value) => {
			players.set(key[1], JSON.parse(value as string) as WPlayer);
		});
		await readAll("games", 3, (key, value) => {
			games.set(key[1], { count: value.count, list: JSON.parse(value.json) });
		});
		return { players, games };
	});

export const savePlayers = (lid: number, entries: [number, WPlayer][]) =>
	run(undefined, async (db) => {
		const tx = db.transaction("players", "readwrite");
		for (const [pid, wp] of entries) {
			void tx.store.put(JSON.stringify(wp), [lid, pid]);
		}
		await tx.done;
	});

export const saveGames = (
	lid: number,
	season: number,
	count: number,
	list: WGame[],
) =>
	run(undefined, async (db) => {
		await db.put("games", { count, json: JSON.stringify(list) }, [lid, season]);
	});

// Drop entries that are no longer right (or never will be): a retired player who was written to, a season whose box scores were written to
export const forgetPlayers = (lid: number, pids: number[]) =>
	run(undefined, async (db) => {
		const tx = db.transaction("players", "readwrite");
		for (const pid of pids) {
			void tx.store.delete([lid, pid]);
		}
		await tx.done;
	});

export const forgetGames = (lid: number, season: number) =>
	run(undefined, async (db) => {
		await db.delete("games", [lid, season]);
	});

// Everything for a league, like when it is deleted or may have been changed behind the cache's back
export const forgetLeague = (lid: number) =>
	run(undefined, async (db) => {
		const tx = db.transaction(["meta", "players", "games"], "readwrite");
		await Promise.all([
			tx.objectStore("players").delete(lidRange(lid)),
			tx.objectStore("games").delete(lidRange(lid)),
			tx.objectStore("meta").delete(lid),
			tx.done,
		]);
	});
