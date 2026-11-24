// Spectator mode (or auto play) turned on during RESIGN_PLAYERS: the user's open re-signing negotiations get the AI's decision
// (re-signed or released) right away, instead of all of them walking at free agency
import { afterEach, assert, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { contractNegotiation, league, player, team } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local } from "../../util/index.ts";
import { getContractSummaryOrThrow } from "../contract/index.ts";
import { getNumPlayersTradedAwayNormalizedAll } from "../player/getNumPlayersTradedAwayNormalized.ts";
import { aiResignNegotiations } from "./newPhaseResignPlayers.ts";
import { userRunsTeam } from "../../util/userRunsTeam.ts";

const realRandom = Math.random;
afterEach(() => {
	Math.random = realRandom;
	local.autoPlayUntil = undefined;
});

const NUM_EXPIRING = 4;

// The user's team (tid 0) with 13 players, NUM_EXPIRING of them in re-signing negotiations as newPhaseResignPlayers leaves them
// (moved to free agency, negotiation open, a rookie among them)
const setup = async () => {
	Math.random = makeSeededRandom(3);
	resetG();
	const season = g.get("season");
	const teams = helpers.getTeamsDefault().slice(0, 3).map(team.generate);
	const players = [];
	for (let i = 0; i < 13; i++) {
		players.push(player.generate(0, 25, season - 3, true, DEFAULT_LEVEL));
	}
	for (let i = 0; i < 12; i++) {
		players.push(player.generate(1, 25, season - 3, true, DEFAULT_LEVEL));
	}
	await resetCache({ players, teams });
	g.setWithoutSavingToDB("phase", PHASE.RESIGN_PLAYERS);

	const userPlayers = await idb.cache.players.indexGetAll("playersByTid", 0);
	const expiring = userPlayers.slice(0, NUM_EXPIRING);
	// One is this year's draft pick: the AI always signs those
	expiring[0]!.draft.year = season;
	const numPlayersTradedAwayNormalized =
		await getNumPlayersTradedAwayNormalizedAll();
	for (const p of expiring) {
		const contract = p.contracts.at(-1)!;
		contract.exp = season;
		p.value = Math.max(p.value, 50);
		p.contractDemand = {
			amount: g.get("minContract"),
			exp: season + 2,
		};
		player.addToFreeAgents(p, numPlayersTradedAwayNormalized);
		await idb.cache.players.put(p);
		const info = await contractNegotiation.create(p.pid, true, 0);
		assert.notStrictEqual(typeof info, "string");
		await idb.cache.negotiations.add(info as any);
	}
	return expiring.map((p) => p.pid);
};

const assertDecided = async (pids: number[]) => {
	assert.strictEqual((await idb.cache.negotiations.getAll()).length, 0);
	let numResigned = 0;
	for (const pid of pids) {
		const p = (await idb.cache.players.get(pid))!;
		if (p.tid === 0) {
			numResigned += 1;
			assert.isAbove(getContractSummaryOrThrow(p).exp, g.get("season"));
		} else {
			assert.strictEqual(p.tid, PLAYER.FREE_AGENT);
		}
	}
	// At least the rookie
	assert.isAtLeast(numResigned, 1);
	const rookie = (await idb.cache.players.get(pids[0]!))!;
	assert.strictEqual(rookie.tid, 0);
};

test("turning on spectator mode while re-signing gives the user's negotiations the AI decision", async () => {
	const pids = await setup();
	await league.setGameAttributes({ spectator: true });
	await assertDecided(pids);
});

test("the user's own negotiations are left alone when he still runs the team", async () => {
	const pids = await setup();
	assert.isTrue(userRunsTeam(0));
	// Another team's tids only
	assert.strictEqual(await aiResignNegotiations([1]), 0);
	assert.strictEqual(
		(await idb.cache.negotiations.getAll()).length,
		pids.length,
	);
});

test("auto play takes over the negotiations the same way", async () => {
	const pids = await setup();
	local.autoPlayUntil = {
		season: g.get("season") + 1,
		phase: PHASE.PRESEASON,
		start: Date.now(),
		resolve: () => {},
		reject: () => {},
	} as any;
	assert.isFalse(userRunsTeam(0));
	assert.strictEqual(
		await aiResignNegotiations(g.get("userTids")),
		pids.length,
	);
	await assertDecided(pids);
});
