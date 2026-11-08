import * as fakeIndexedDB from "fake-indexeddb";
import { openDB } from "@dumbmatter/idb";
import { afterEach, assert, beforeEach, test } from "vitest";
import { LEAGUE_DATABASE_VERSION } from "../../../common/constants.ts";
import { resetG } from "../../../test/helpers.ts";
import connectLeague from "../connectLeague.ts";

// Version 76 adds the coaches object store (coaching staff) and turns the coachingStaff setting off for existing leagues

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

test("version 76 migration adds coaches store and keeps the budget slider for existing leagues", async () => {
	assert.strictEqual(LEAGUE_DATABASE_VERSION, 76);

	// A version 75 league, only the stores this migration touches
	const old = await openDB("league1", 75, {
		upgrade(db) {
			db.createObjectStore("gameAttributes", { keyPath: "key" });
		},
	});
	await old.put("gameAttributes", { key: "season", value: 2030 });
	old.close();

	const db = await connectLeague(1);
	assert.strictEqual(db.version, 76);
	assert.isTrue(db.objectStoreNames.contains("coaches"));

	const tx = db.transaction(["coaches", "gameAttributes"], "readwrite");
	assert.deepEqual([...tx.objectStore("coaches").indexNames], ["tid"]);
	const cid = await tx.objectStore("coaches").add({ tid: 3 } as any);
	assert.deepEqual(await tx.objectStore("coaches").index("tid").getAllKeys(3), [
		cid,
	]);

	assert.deepEqual(
		await tx.objectStore("gameAttributes").get("coachingStaff"),
		{
			key: "coachingStaff",
			value: false,
		},
	);
	assert.strictEqual(
		(await tx.objectStore("gameAttributes").get("season"))?.value,
		2030,
	);
	await tx.done;
	db.close();
});

test("new leagues get the coaches store and no coachingStaff override", async () => {
	const db = await connectLeague(2);
	assert.isTrue(db.objectStoreNames.contains("coaches"));
	assert.isUndefined(await db.get("gameAttributes", "coachingStaff"));
	db.close();
});
