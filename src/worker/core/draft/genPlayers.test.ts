import { assert, test } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { draft } from "../index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";

test("generate 70 players for the draft", async () => {
	resetG();
	await resetCache({});
	idb.league = mockIDBLeague();
	await draft.genPlayers(g.get("season"), DEFAULT_LEVEL);
	const players = await idb.cache.players.indexGetAll(
		"playersByDraftYearRetiredYear",
		[[g.get("season")], [g.get("season"), Infinity]],
	);
	assert.strictEqual(players.length, 70); // 70 players in a draft class

	for (const p of players) {
		assert.strictEqual(p.tid, PLAYER.UNDRAFTED);
	}

	// @ts-expect-error
	idb.league = undefined;
});

test("arch13: small guards' skill polish only with the sim-calibrated ovr, only at 6'3\" or shorter", async () => {
	const { smallGuardPolish, SMALL_GUARD_SKILL } =
		await import("./genPlayersWithoutSaving.ts");
	const { player } = await import("../index.ts");
	resetG();
	const make = (hgt: number) => {
		const p = player.generate(PLAYER.UNDRAFTED, 19, 2026, false, DEFAULT_LEVEL);
		p.hgt = hgt;
		return p;
	};
	const skills = (p: any) => ["drb", "pss", "oiq"].map((k) => p.ratings[0][k]);
	for (const [on, hgt, add] of [
		[true, 73, SMALL_GUARD_SKILL],
		[true, 75, SMALL_GUARD_SKILL / 2],
		[true, 76, 0],
		[false, 73, 0],
	] as const) {
		g.setWithoutSavingToDB("ovrV2", on);
		const p = make(hgt);
		const before = skills(p);
		smallGuardPolish(p);
		assert.deepStrictEqual(
			skills(p),
			before.map((x) => Math.min(100, x + add)),
			`${on} ${hgt}`,
		);
	}
});
