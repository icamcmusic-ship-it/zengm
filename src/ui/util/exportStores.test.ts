// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { readFileSync } from "node:fs";
import { assert, test } from "vitest";
import { EXPORT_STORES_BY_KEY } from "./exportStores.ts";

// Every store of the league database (interface LeagueDB in worker/db/connectLeague.ts) is written by some Export League
// option, so a newly added store is not silently left out of league files
test("every league database store is in some export option", () => {
	const src: string = readFileSync(
		new URL("../../worker/db/connectLeague.ts", import.meta.url),
		"utf8",
	);
	const start = src.indexOf("export interface LeagueDB");
	const body = src.slice(start, src.indexOf("\n}\n", start));
	const stores = [...body.matchAll(/^\t(\w+): {$/gm)].map((m) => m[1]!);
	assert.isAbove(stores.length, 20);
	const exported = new Set<string>(Object.values(EXPORT_STORES_BY_KEY).flat());
	assert.deepStrictEqual(
		stores.filter((store) => !exported.has(store)),
		[],
	);
	// Rivalry Stories: the log and its season rows travel together
	assert.includeMembers(EXPORT_STORES_BY_KEY.headToHead, [
		"rivalryGames",
		"rivalrySeasons",
	]);
});
