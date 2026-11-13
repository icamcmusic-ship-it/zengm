// Headless multi-season league with every League Extra on, played through every phase the way the play menu does it
// (phase changes, days of games, the draft, re-signing, free agency days), checking after each step that nothing is left
// stuck (locks, auto play) and that the pages the phase change redirects to still load
import "fake-indexeddb/auto";
import { assert, describe, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import { NATIVE_FEATURES } from "../../../common/nativeFeatures.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, freeAgents, game, league, phase, player } from "../index.ts";
import { getContractDemand } from "../contract/index.ts";
import * as views from "../../views/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, local, lock } from "../../util/index.ts";

const STEP_TIMEOUT = 120_000;

const where = () => `season ${g.get("season")} phase ${g.get("phase")}`;

const step = async (name: string, f: () => Promise<unknown>) => {
	const label = `${name} (${where()})`;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const stuck = new Promise((_resolve, reject) => {
		timer = setTimeout(
			() => reject(new Error(`${label} did not finish`)),
			STEP_TIMEOUT,
		);
	});
	try {
		await Promise.race([f(), stuck]);
	} finally {
		clearTimeout(timer);
	}
	for (const key of ["gameSim", "newPhase", "drafting"] as const) {
		assert.isFalse(lock.get(key), `lock ${key} still set after ${label}`);
	}
	assert.isUndefined(local.autoPlayUntil, label);

	// The playersByTid index matches the players (the Free Agents page once left signed players listed as free agents)
	for (let tid = PLAYER.FREE_AGENT; tid < g.get("numTeams"); tid++) {
		for (const p of await idb.cache.players.indexGetAll("playersByTid", tid)) {
			assert.strictEqual(p.tid, tid, `index entry for ${p.pid} after ${label}`);
		}
	}

	// Every free agent has a contract demand (the Free Agents page and AI signings need it)
	const fas = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.FREE_AGENT,
	);
	for (const p of fas) {
		assert.isDefined(
			p.contractDemand,
			`free agent ${p.pid} without contract demand after ${label}`,
		);
	}
};

const loadView = (id: string, params: Record<string, unknown> = {}) => {
	const view = (views as any)[id];
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	return view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
};

// What a human does when the game refuses to play because of the user's roster size
const fixUserRoster = async () => {
	const tid = g.get("userTid");
	const players = [
		...(await idb.cache.players.indexGetAll("playersByTid", tid)),
	];
	players.sort((a, b) => a.value - b.value);
	while (players.length > g.get("maxRosterSize")) {
		await player.release(players.shift()!, false);
	}
	const fas = [
		...(await idb.cache.players.indexGetAll("playersByTid", PLAYER.FREE_AGENT)),
	];
	fas.sort((a, b) => b.value - a.value);
	while (players.length < g.get("minRosterSize")) {
		const p = fas.shift()!;
		await player.sign(p, tid, getContractDemand(p), g.get("phase"));
		await idb.cache.players.put(p);
		players.push(p);
	}
};

describe("all phases", () => {
	test("seasons", { timeout: 30 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(12);
		const settings: any = getDefaultSettings();
		for (const f of NATIVE_FEATURES) {
			settings[f.key] = true;
		}
		await league.createStream(
			{},
			{
				confs: last(defaultGameAttributes.confs).value,
				divs: last(defaultGameAttributes.divs).value,
				fromFile: {
					gameAttributes: undefined,
					hasRookieContracts: true,
					maxGid: undefined,
					startingSeason: undefined,
					teams: undefined,
					version: LEAGUE_DATABASE_VERSION,
				},
				getLeagueOptions: undefined,
				keptKeys: new Set(),
				lid: 0,
				name: "phases",
				setLeagueCreationStatus: () => {},
				settings: {
					...settings,
					numGames: 6,
					numGamesPlayoffSeries: [1, 1],
					numPlayoffByes: 0,
					numPlayersOnCourt: 5,
				},
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		// The user's team is a real team, so everything that involves it (AI offers, re-signing, ...) runs too
		assert.isFalse(g.get("spectator"));

		const start = g.get("season");
		for (let i = 0; i < 3; i++) {
			assert.strictEqual(g.get("phase"), PHASE.PRESEASON);
			await fixUserRoster();
			await step("regular season", () =>
				phase.newPhase(PHASE.REGULAR_SEASON, {}),
			);
			let days = 0;
			while (g.get("phase") <= PHASE.PLAYOFFS) {
				await fixUserRoster();
				await step(`day ${days}`, () => game.play(1, {}));
				days += 1;
				assert.isBelow(days, 200, where());
			}
			assert.strictEqual(g.get("phase"), PHASE.DRAFT_LOTTERY);
			await step("draft phase", () => phase.newPhase(PHASE.DRAFT, {}));
			await step("draft", () => draft.runPicks({ type: "untilEnd" }, {}));
			assert.strictEqual(g.get("phase"), PHASE.AFTER_DRAFT);
			await step("re-signing", () => phase.newPhase(PHASE.RESIGN_PLAYERS, {}));
			await step("view negotiationList", () => loadView("negotiationList"));
			await step("free agency", () => phase.newPhase(PHASE.FREE_AGENCY, {}));
			await step("view freeAgents", () => loadView("freeAgents"));
			let faDays = 0;
			while (g.get("phase") === PHASE.FREE_AGENCY) {
				await step(`free agency day ${faDays}`, () => freeAgents.play(1, {}));
				await step("view freeAgents", () => loadView("freeAgents"));
				faDays += 1;
				assert.isBelow(faDays, 40, where());
			}
			assert.strictEqual(g.get("season"), start + i + 1);
		}

		// Face Aging: every active player with a generated face was aged at this preseason, with a face history
		const active = await idb.cache.players.indexGetAll("playersByTid", [
			PLAYER.FREE_AGENT,
			Infinity,
		]);
		for (const p of active) {
			if (!p.imgURL) {
				assert.strictEqual(p.faceAging?.s, g.get("season"), `face ${p.pid}`);
			}
		}
		const veteran = active.find((p) => p.draft.year < start);
		assert.isDefined(veteran);
		const view = await loadView("player", { pid: String(veteran!.pid) });
		assert.isAbove(view.faceHistory.length, 0);
	});
});
