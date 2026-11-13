// perf2: the retired players newPhaseDraft may kill off, read with one getAll, must be the ones (and in the order) the old
// cursor over the "draft.year, retiredYear" index reached, so the random draws for deaths don't change
import * as fakeIndexedDB from "fake-indexeddb";
import { afterAll, beforeAll, expect, test } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { resetG } from "../../../test/helpers.ts";
import { connectLeague, idb } from "../../db/index.ts";
import { getKillCandidates } from "./newPhaseDraft.ts";

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

beforeAll(async () => {
	for (const name of IDB_GLOBALS) {
		(globalThis as any)[name] = fakeIndexedDB[name];
	}
	globalThis.indexedDB = new fakeIndexedDB.IDBFactory();
	resetG();
	idb.league = await connectLeague(7);
});

afterAll(() => {
	idb.league.close();
	// @ts-expect-error
	idb.league = undefined;
	// @ts-expect-error
	delete globalThis.indexedDB;
	for (const name of IDB_GLOBALS) {
		delete (globalThis as any)[name];
	}
});

const SEASON = 2100;

// The old scan, as it was before perf2
const oldCandidates = async (currentSeason: number) => {
	const out: number[] = [];
	for await (const { value: p } of idb.league
		.transaction("players")
		.store.index("draft.year, retiredYear")
		.iterate(IDBKeyRange.bound([currentSeason - 110], [""]))) {
		if (p.tid !== PLAYER.RETIRED) {
			continue;
		}
		out.push(p.pid);
	}
	return out;
};

test("same candidates in the same order as the old index scan", async () => {
	const random = makeSeededRandom(3);
	const draftYears = [
		1900,
		1989,
		1990,
		1991,
		2050,
		2099,
		2100,
		2101,
		undefined,
		"2050",
		Number.NaN,
	];
	const retiredYears = [
		2000,
		2060,
		2099,
		Infinity,
		undefined,
		"x",
		-Infinity,
		Number.NaN,
	];
	const tids = [PLAYER.RETIRED, PLAYER.RETIRED, PLAYER.RETIRED, 0, 5, -1, -2];
	const tx = idb.league.transaction("players", "readwrite");
	for (let pid = 0; pid < 600; pid++) {
		const pick = <T,>(xs: T[]) => xs[Math.floor(random() * xs.length)]!;
		await tx.store.put({
			pid,
			tid: pick(tids),
			draft: { year: pick(draftYears) },
			retiredYear: pick(retiredYears),
			born: { year: 1980 },
		} as any);
	}
	await tx.done;

	const expected = await oldCandidates(SEASON);
	const actual = (await getKillCandidates(SEASON)).map((p) => p.pid);
	expect(expected.length).toBeGreaterThan(50);
	expect(actual).toEqual(expected);
});
