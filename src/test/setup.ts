import { IDBKeyRange } from "fake-indexeddb";
// @ts-expect-error
import fs from "node:fs/promises";
import { beforeAll } from "vitest";
import { overridePostMessage } from "./overridePostMessage.ts";

// When mockIDBLeague is used, sometimes IDBKeyRange still gets called even though there is no actual database
globalThis.IDBKeyRange = IDBKeyRange;

overridePostMessage();

// Test files share a worker (isolate: false), and many seed Math.random for a deterministic league without putting it back. Start every file with the real one, so a file's randomness never depends on which file happened to run before it in the same worker.
const NATIVE_RANDOM = Symbol.for("zengm.nativeMathRandom");
(globalThis as any)[NATIVE_RANDOM] ??= Math.random;
Math.random = (globalThis as any)[NATIVE_RANDOM];

// Same for the league database: a league (real or mock) left by an earlier file would make code that reads idb.league when
// it's set (idb.merged, getPlayersOfDraftYear, ...) see that other league's players. (Imported here, after every setup file,
// since importing the worker's db before src/worker/index.ts breaks the import order)
beforeAll(async () => {
	const { idb } = await import("../worker/db/index.ts");
	// @ts-expect-error
	idb.league = undefined;
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
