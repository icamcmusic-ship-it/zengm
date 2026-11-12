import * as fakeIndexedDB from "fake-indexeddb";
import { openDB } from "@dumbmatter/idb";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { resetCache, resetG } from "../../test/helpers.ts";
import { idb } from "../db/index.ts";
import { g } from "./index.ts";
import {
	loadState,
	resetLeagueAchievementsStoreForTests,
	saveState,
	type SavedState,
} from "./leagueAchievementsStore.ts";

const IDB_GLOBALS = [
	"IDBCursor",
	"IDBCursorWithValue",
	"IDBDatabase",
	"IDBIndex",
	"IDBKeyRange",
	"IDBObjectStore",
	"IDBOpenDBRequest",
	"IDBRequest",
	"IDBTransaction",
] as const;

const state = (startingSeason: number): SavedState => ({
	v: 1,
	startingSeason,
	seen: { "champ-1": [2021, 3] },
	log: [{ id: "champ-1", season: 2021, phase: 3, who: "Someone" }],
});

// Test files share globals in a worker (isolate: false), so put back exactly what was there before (setup.ts defines IDBKeyRange for everyone)
const previousGlobals = new Map<string, PropertyDescriptor | undefined>();

beforeAll(() => {
	for (const name of [...IDB_GLOBALS, "indexedDB"]) {
		previousGlobals.set(
			name,
			Object.getOwnPropertyDescriptor(globalThis, name),
		);
	}
	for (const name of IDB_GLOBALS) {
		(globalThis as any)[name] = fakeIndexedDB[name];
	}
	globalThis.indexedDB = new fakeIndexedDB.IDBFactory();
});

afterAll(() => {
	for (const [name, descriptor] of previousGlobals) {
		if (descriptor) {
			Object.defineProperty(globalThis, name, descriptor);
		} else {
			delete (globalThis as any)[name];
		}
	}
	resetLeagueAchievementsStoreForTests();
});

beforeEach(async () => {
	resetLeagueAchievementsStoreForTests();
	// A fresh legacy database for each test
	globalThis.indexedDB = new fakeIndexedDB.IDBFactory();
	resetG();
	delete (g as any).leagueAchievements;
	g.setWithoutSavingToDB("lid", 7);
	g.setWithoutSavingToDB("startingSeason", 2020);
	await resetCache({});
});

test("the state is kept in the league's gameAttributes store, so export carries it", async () => {
	expect(await loadState(7, 2020)).toBeUndefined();
	await saveState(7, state(2020));
	const row = await idb.cache.gameAttributes.get("leagueAchievements" as any);
	expect(row?.value).toEqual(state(2020));
	expect(await loadState(7, 2020)).toEqual(state(2020));
	// another league's start doesn't match
	expect(await loadState(7, 2019)).toBeUndefined();
});

test("a state from the old separate database is moved into the league once", async () => {
	const old = await openDB("league-achievements", 1, {
		upgrade(db) {
			db.createObjectStore("leagues");
		},
	});
	await old.put("leagues", JSON.stringify(state(2020)), 8);
	g.setWithoutSavingToDB("lid", 8);
	old.close();

	expect(await loadState(8, 2020)).toEqual(state(2020));
	const row = await idb.cache.gameAttributes.get("leagueAchievements" as any);
	expect(row?.value).toEqual(state(2020));

	const again = await openDB("league-achievements", 1);
	expect(await again.get("leagues", 8)).toBeUndefined();
	again.close();
});
