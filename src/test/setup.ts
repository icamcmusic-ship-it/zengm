import { IDBKeyRange } from "fake-indexeddb";
// @ts-expect-error
import fs from "node:fs/promises";
import { beforeAll } from "vitest";
import { overridePostMessage } from "./overridePostMessage.ts";
import { setNewLeagueSaltOverride } from "../common/leagueSalt.ts";

// When mockIDBLeague is used, sometimes IDBKeyRange still gets called even though there is no actual database
globalThis.IDBKeyRange = IDBKeyRange;

overridePostMessage();

// League salt: leagues made by tests get salt 0, so their values are the same as before salts existed (common/leagueSalt.ts)
setNewLeagueSaltOverride(() => 0);

// Test files share a worker (isolate: false), and many seed Math.random for a deterministic league without putting it back. Start every file with the real one, so a file's randomness never depends on which file happened to run before it in the same worker.
const NATIVE_RANDOM = Symbol.for("zengm.nativeMathRandom");
(globalThis as any)[NATIVE_RANDOM] ??= Math.random;
Math.random = (globalThis as any)[NATIVE_RANDOM];

// Same for the league database: a league (real or mock) left by an earlier file would make code that reads idb.league when
// it's set (idb.merged, getPlayersOfDraftYear, ...) see that other league's players. (Imported here, after every setup file,
// since importing the worker's db before src/worker/index.ts breaks the import order)
beforeAll(async () => {
	// And IndexedDB itself: some files install fake-indexeddb's globals and delete them when they finish (db/migrations,
	// db/merged, newPhaseDraft, ...), which left every later file in the same worker that imported "fake-indexeddb/auto"
	// (a module that only runs once per worker) without indexedDB or IDBDatabase. Put back whatever is missing
	const fakeIndexedDB: any = await import("fake-indexeddb");
	for (const name of [
		"IDBCursor",
		"IDBCursorWithValue",
		"IDBDatabase",
		"IDBIndex",
		"IDBKeyRange",
		"IDBObjectStore",
		"IDBOpenDBRequest",
		"IDBRequest",
		"IDBTransaction",
		"IDBVersionChangeEvent",
	]) {
		if ((globalThis as any)[name] === undefined && fakeIndexedDB[name]) {
			(globalThis as any)[name] = fakeIndexedDB[name];
		}
	}
	if ((globalThis as any).indexedDB === undefined) {
		(globalThis as any).indexedDB = new fakeIndexedDB.IDBFactory();
	}

	const { idb } = await import("../worker/db/index.ts");
	// (closed first, so the next league made with the same lid deletes and recreates its database instead of waiting on this
	// connection, and stop the old cache's automatic flushes, which would write into whatever league is open next)
	idb.cache.stopAutoFlush();
	idb.league?.close();
	// @ts-expect-error
	idb.league = undefined;
	// And the worker's locks: a file that stopped in the middle of a game sim (a failed assertion) leaves gameSim set, and then
	// every later game.play in the same worker returns without playing, so a later file's "play until the phase changes" loop never ends
	const { local, lock } = await import("../worker/util/index.ts");
	lock.reset();
	// And the league's cached state in local, as when the user switches leagues: a league simmed by an earlier file leaves its
	// players' ovr mean and standard deviation there (updateOvrMeanStd), and player.value is scaled by them, so a file that
	// generates players and ranks them by value (draft classes) got different values, and different tops of classes, depending
	// on which file ran before it in the worker
	local.reset();
});

globalThis.fetch = async (url: Parameters<typeof fetch>[0]) => {
	if (typeof url !== "string") {
		throw new Error("Not supported");
	}

	let filePath = url.replace("/gen/", "data/");
	if (filePath.endsWith("real-player-data.json")) {
		filePath = filePath.replace(".json", `.${__SPORT}.json`);
	}

	const data = await fs.readFile(filePath, "utf8");
	return new Response(data);
};

// Removes the need for jsdom in most test files
(globalThis as any).self = globalThis;
(globalThis as any).window = globalThis;
(globalThis as any).location = {};
globalThis.addEventListener = () => {};
