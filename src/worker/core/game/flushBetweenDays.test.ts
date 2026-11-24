// Long multi-day sims save the cache every FLUSH_EVERY_DAYS days, between two days (the automatic flush is off while games are
// simmed)
import { assert, test } from "vitest";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { FLUSH_EVERY_DAYS, flushBetweenDays } from "./play.ts";

test("the cache is flushed once every FLUSH_EVERY_DAYS days of a long sim", async () => {
	resetG();
	idb.league = mockIDBLeague();
	await resetCache({});
	let flushes = 0;
	idb.cache.flush = () => {
		flushes += 1;
		return Promise.resolve();
	};
	const results: boolean[] = [];
	for (let i = 0; i < 3 * FLUSH_EVERY_DAYS; i++) {
		results.push(await flushBetweenDays());
	}
	// (the counter is module state: the first flush may come earlier if another test played days before)
	assert.strictEqual(flushes, 3);
	assert.strictEqual(results.filter(Boolean).length, 3);
	const last = results.lastIndexOf(true);
	const prev = results.lastIndexOf(true, last - 1);
	assert.strictEqual(last - prev, FLUSH_EVERY_DAYS);
});
