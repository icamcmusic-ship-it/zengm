import { afterAll, assert, describe, test } from "vitest";
import { Rng } from "../../../common/collegeStats/rng.ts";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { numCombineInvites } from "../../../common/draftCombine.ts";
import type { Player } from "../../../common/types.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import genPlayersWithoutSaving from "../draft/genPlayersWithoutSaving.ts";
import { player, team } from "../index.ts";
import { clearScoutingCache } from "../scoutingReports/input.ts";
import { getProspectRooms } from "../scoutingReports/room.ts";
import { afterNewPhase, getClassCombine, redoStoredCombine } from "./index.ts";

const realRandom = Math.random;
afterAll(() => {
	Math.random = realRandom;
	// @ts-expect-error
	idb.league = undefined;
});

const genClass = async () => {
	const rng = new Rng("combineConsensus.test");
	Math.random = () => rng.random();
	resetG();
	idb.league = mockIDBLeague();
	await resetCache({});
	const players = (await genPlayersWithoutSaving(
		2026,
		DEFAULT_LEVEL,
		[],
	)) as Player[];
	for (const [i, p] of players.entries()) {
		p.pid = i;
		p.tid = PLAYER.UNDRAFTED;
		p.draft.year = 2026;
		await player.updateValues(p);
	}
	Math.random = realRandom;
	// Teams, for the user's scouting department
	const teams = helpers.getTeamsDefault().map(team.generate);
	await resetCache({ players, teams });
	clearScoutingCache();
	g.setWithoutSavingToDB("featureScoutingReports" as any, true);
	g.setWithoutSavingToDB("featureScoutRoom" as any, true);
	g.setWithoutSavingToDB("featureLotteryNight", true);
	g.setWithoutSavingToDB("season", 2026);
	g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
	return players;
};

describe("combine invitations", () => {
	test("go out from the scouts' consensus board, are stored, and never change afterwards", async () => {
		const players = await genClass();
		const rooms = await getProspectRooms(players);
		assert.isAbove(
			[...rooms.values()].filter((x) => x.room).length,
			0,
			"the scouts have seen some of the class",
		);
		const key = (p: Player) => rooms.get(p.pid)?.room?.consensus ?? p.valueFuzz;

		const numInvites = numCombineInvites(
			g.get("numActiveTeams") * g.get("numDraftRounds"),
		);
		Math.random = () => {
			throw new Error("Math.random used");
		};
		const holding = await getClassCombine(2026, undefined, true);
		Math.random = realRandom;
		const order = holding.players.slice(0, numInvites);
		// Invited in consensus order
		for (let i = 1; i < order.length; i++) {
			assert.isAtLeast(key(order[i - 1]!), key(order[i]!));
		}
		assert.deepEqual(
			[...holding.invited].sort((a, b) => a - b),
			order.map((p) => p.pid).sort((a, b) => a - b),
		);
		// Not the projected stock order (what invitations went by before)
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		const byStock = (await getClassCombine(2026)).players;
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		assert.notDeepEqual(
			byStock.slice(0, numInvites).map((p) => p.pid),
			order.map((p) => p.pid),
		);
		// Deterministic
		const again = await getClassCombine(2026, undefined, true);
		assert.deepEqual(
			again.players.map((p) => p.pid),
			holding.players.map((p) => p.pid),
		);

		// Held: stored with each invitee's place in the order, read back the same way
		await afterNewPhase(PHASE.DRAFT_LOTTERY);
		for (const [i, p] of order.entries()) {
			const stored = await idb.cache.players.get(p.pid);
			assert.strictEqual(stored!.combine?.inviteRank, i + 1);
		}
		const later = await getClassCombine(2026);
		assert.deepEqual(
			later.players.slice(0, numInvites).map((p) => p.pid),
			order.map((p) => p.pid),
		);

		// Redone after a ratings rebuild: same place in the order
		const pid = order[3]!.pid;
		assert.strictEqual(await redoStoredCombine(2026, [pid]), 1);
		assert.strictEqual(
			(await idb.cache.players.get(pid))!.combine?.inviteRank,
			4,
		);
	});

	test("without the scouts' room: by projected stock, as before", async () => {
		await genClass();
		g.setWithoutSavingToDB("featureScoutRoom", false);
		const withoutRoom = await getClassCombine(2026, undefined, true);
		const live = await getClassCombine(2026, undefined, false);
		assert.deepEqual(
			withoutRoom.players.map((p) => p.pid),
			live.players.map((p) => p.pid),
		);
	});
});
