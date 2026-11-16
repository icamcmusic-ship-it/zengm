// God Mode "Re-roll league salt": leagueSaltHistory is optional with no default, so a league's first re-roll must not read it
// through g.get (which throws on an unset key), and its event needs tids to be saved. sweep10: the button failed in every
// league ("Attempt to get g.leagueSaltHistory", then "Saved event must include pids or tids").
import { afterAll, assert, beforeAll, describe, test } from "vitest";
import { setNewLeagueSaltOverride } from "../../../common/leagueSalt.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { league } from "../index.ts";

const rerollSalt = () => league.rerollSalt();
let next = 0;
beforeAll(async () => {
	resetG();
	idb.league = mockIDBLeague();
	await resetCache({});
	// Tests make leagues with salt 0 (test/setup.ts): draw distinct salts here
	setNewLeagueSaltOverride(() => {
		next += 1;
		return 1000 + next;
	});
});
afterAll(() => {
	setNewLeagueSaltOverride(() => 0);
	g.setWithoutSavingToDB("leagueSalt", 0);
	// @ts-expect-error
	idb.league = undefined;
});

describe("rerollSalt", () => {
	test("first re-roll works with no history, the next ones append to it", async () => {
		g.setWithoutSavingToDB("leagueSalt", 0);
		delete (g as any).leagueSaltHistory;
		assert.isFalse(Object.hasOwn(g, "leagueSaltHistory"));

		const first = await rerollSalt();
		assert.deepStrictEqual(first, { from: 0, to: 1001 });
		assert.strictEqual(g.get("leagueSalt"), 1001);

		const second = await rerollSalt();
		assert.deepStrictEqual(second, { from: 1001, to: 1002 });
		assert.deepStrictEqual(
			g.get("leagueSaltHistory")!.map((h) => [h.from, h.to]),
			[
				[0, 1001],
				[1001, 1002],
			],
		);
		// Both re-rolls are in the event log
		const events = (await idb.cache.events.getAll()).filter((e) =>
			e.text?.startsWith("League salt re-rolled"),
		);
		assert.strictEqual(events.length, 2);
	});
});
