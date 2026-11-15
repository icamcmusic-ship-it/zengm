import * as fakeIndexedDB from "fake-indexeddb";
import { openDB } from "@dumbmatter/idb";
import { afterEach, assert, beforeEach, test } from "vitest";
import { LEAGUE_DATABASE_VERSION } from "../../../common/constants.ts";
import { resetG } from "../../../test/helpers.ts";
import connectLeague from "../connectLeague.ts";

// Version 77 adds the rivalryGames object store (Rivalry Stories), indexed by pair and season

const IDB_GLOBALS = [
	"IDBCursor",
	"IDBCursorWithValue",
	"IDBDatabase",
	"IDBIndex",
	"IDBObjectStore",
	"IDBOpenDBRequest",
	"IDBRequest",
	"IDBTransaction",
] as const;

beforeEach(() => {
	resetG();
	for (const name of IDB_GLOBALS) {
		(globalThis as any)[name] = fakeIndexedDB[name];
	}
	globalThis.indexedDB = new fakeIndexedDB.IDBFactory();
});

afterEach(() => {
	// @ts-expect-error
	delete globalThis.indexedDB;
	for (const name of IDB_GLOBALS) {
		delete (globalThis as any)[name];
	}
});

test("version 77 migration adds the rivalryGames store", async () => {
	assert.isAtLeast(LEAGUE_DATABASE_VERSION, 77);

	const old = await openDB("league1", 76, {
		upgrade(db) {
			db.createObjectStore("gameAttributes", { keyPath: "key" });
		},
	});
	old.close();

	const db = await connectLeague(1);
	assert.isTrue(db.objectStoreNames.contains("rivalryGames"));
	const tx = db.transaction("rivalryGames", "readwrite");
	assert.deepEqual([...tx.store.indexNames].sort(), ["pair", "season"]);
	await tx.store.put({ gid: 4, pair: "1-5", season: 2030 } as any);
	assert.deepEqual(await tx.store.index("pair").getAllKeys("1-5"), [4]);
	assert.deepEqual(await tx.store.index("season").getAllKeys(2030), [4]);
	await tx.done;
	db.close();
});

test("new leagues get the rivalryGames store", async () => {
	const db = await connectLeague(2);
	assert.isTrue(db.objectStoreNames.contains("rivalryGames"));
	db.close();
});
