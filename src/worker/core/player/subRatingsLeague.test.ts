// Sub-ratings in a whole league: with the setting on, every base rating (and so the sim, ovr, value, ...) is exactly what it is with the
// setting off, through league creation and a season (games, draft, development: the sub-ratings never draw from the game's random stream);
// every active player has sub-ratings that reproduce his bases; league files round-trip with and without them; the views show them only
// with the setting on.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
	RATINGS,
} from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import {
	isValidSubArray,
	SUB_HISTORY,
	subsMatchBases,
} from "../../../common/subRatings.ts";
import { draft, game, league, phase } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import * as views from "../../views/index.ts";
import updateSubRatingsForLeague from "./updateSubRatingsForLeague.ts";
import { player } from "../index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";

const create = async (
	subRatings: boolean,
	stream: ReadableStream<any> | Record<string, never> = {},
	keptKeys: string[] = [],
) => {
	await league.createStream(stream as any, {
		confs: last(defaultGameAttributes.confs).value,
		divs: last(defaultGameAttributes.divs).value,
		fromFile: {
			gameAttributes: undefined,
			hasRookieContracts: true,
			maxGid: undefined,
			startingSeason: keptKeys.length > 0 ? 2025 : undefined,
			teams: undefined,
			version: LEAGUE_DATABASE_VERSION,
		},
		getLeagueOptions: undefined,
		keptKeys: new Set(keptKeys) as any,
		lid: 0,
		name: "subs",
		setLeagueCreationStatus: () => {},
		settings: {
			...getDefaultSettings(),
			subRatings,
			numGames: 4,
			numGamesPlayoffSeries: [1],
		} as any,
		shuffleRosters: false,
		startingSeasonFromInput: "2025",
		teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
		tid: 0,
	});
	await league.loadGameAttributes();
};

const BASE_KEYS = [...RATINGS, "ovr", "pot", "pos", "skills"] as const;
const basesOf = (ps: any[]) =>
	ps.map((p) =>
		JSON.stringify([
			p.born.year,
			p.ratings.map((r: any) => BASE_KEYS.map((k) => r[k])),
		]),
	);

// Generation (a draft class, as at league creation and each season) and several seasons of development with a fixed random seed:
// identical bases with the setting on and off, so the game's random stream is untouched
const genAndDevelop = async (subRatings: boolean, expanded: boolean) => {
	resetG();
	g.setWithoutSavingToDB("subRatings", subRatings);
	g.setWithoutSavingToDB("expandedRatings", expanded);
	g.setWithoutSavingToDB("ovrV2", true);
	g.setWithoutSavingToDB("realisticAging", true);
	g.setWithoutSavingToDB("improvedPositions", true);
	await resetCache({});
	Math.random = makeSeededRandom(21);
	const players = await draft.genPlayersWithoutSaving(2016, DEFAULT_LEVEL, []);
	const atDraft = basesOf(players);
	for (const p of players) {
		p.tid = 0;
		for (let s = 1; s <= 12; s++) {
			player.addRatingsRow(p);
			p.ratings.at(-1)!.season = 2016 + s;
			await player.develop(p, 1);
		}
	}
	return { players, atDraft, later: basesOf(players) };
};

const playSeason = async () => {
	await phase.newPhase(PHASE.REGULAR_SEASON, {});
	while (g.get("phase") <= PHASE.PLAYOFFS) {
		await game.play(1, {});
	}
	await phase.newPhase(PHASE.DRAFT, {});
	await draft.runPicks({ type: "untilEnd" }, {});
	await phase.newPhase(PHASE.AFTER_DRAFT, {});
	await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
	await phase.newPhase(PHASE.FREE_AGENCY, {});
	await phase.newPhase(PHASE.PRESEASON, {});
};

const load = (id: string, params: Record<string, string>) => {
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

describe("sub-ratings never change the bases", () => {
	for (const expanded of [false, true]) {
		test(
			`generation and 12 seasons of development${expanded ? ", expanded ratings" : ""}`,
			{ timeout: 5 * 60 * 1000 },
			async () => {
				const off = await genAndDevelop(false, expanded);
				const on = await genAndDevelop(true, expanded);
				assert.deepEqual(on.atDraft, off.atDraft);
				assert.deepEqual(on.later, off.later);
				for (const p of on.players) {
					const r = p.ratings.at(-1) as any;
					assert.isTrue(subsMatchBases(r));
					assert.isDefined(p.subP?.b);
					p.ratings.forEach((row: any, i) => {
						if (i < p.ratings.length - SUB_HISTORY) {
							assert.isUndefined(row.sub);
						} else {
							assert.isTrue(subsMatchBases(row));
						}
					});
				}
				for (const p of off.players) {
					assert.isUndefined(p.subP);
					assert.isTrue(p.ratings.every((r: any) => r.sub === undefined));
				}
			},
		);
	}
});

describe("sub-ratings in a league", () => {
	beforeAll(
		async () => {
			Math.random = makeSeededRandom(11);
			await create(true);
			await playSeason();
		},
		20 * 60 * 1000,
	);

	test("every active player has sub-ratings that reproduce his bases, on his last rows only", async () => {
		const players = await idb.cache.players.getAll();
		let n = 0;
		for (const p of players) {
			if (p.tid === PLAYER.RETIRED) {
				continue;
			}
			n += 1;
			assert.isDefined(p.subP, `pid ${p.pid}`);
			const r = last(p.ratings) as any;
			assert.isTrue(subsMatchBases(r), `pid ${p.pid}`);
			p.ratings.forEach((row: any, i) => {
				if (i < p.ratings.length - SUB_HISTORY) {
					assert.isUndefined(row.sub);
				}
			});
		}
		assert.isAbove(n, 300);
		// Generated prospects have a build
		const prospects = players.filter((p) => p.tid === PLAYER.UNDRAFTED);
		assert.isAbove(prospects.length, 50);
		assert.isTrue(prospects.every((p) => p.subP?.b !== undefined));
	});

	test("views: sub-ratings with the setting on, none with it off", async () => {
		const pid = (await idb.cache.players.getAll()).find(
			(p) => p.tid === 0,
		)!.pid;
		const player = await load("player", { pid: String(pid) });
		assert.isTrue(isValidSubArray((player.player.ratings as any[]).at(-1).sub));
		// The hidden growth profile never goes to the UI
		assert.isUndefined((player.player as any).subP);
		const ratings = await load("playerRatings", {});
		assert.isTrue(
			ratings.players.some((p: any) => isValidSubArray(p.ratings.sub)),
		);
		const scouting = await load("draftScouting", {});
		assert.isTrue(
			scouting.seasons[0].players.some(
				(p: any) => p.subHighlights !== undefined,
			),
		);

		await league.setGameAttributes({ subRatings: false });
		const player2 = await load("player", { pid: String(pid) });
		assert.isUndefined((player2.player.ratings as any[]).at(-1).sub);
		await league.setGameAttributes({ subRatings: true });
	});

	test("league files round-trip with sub-ratings, and files without them get them", async () => {
		const players = structuredClone(await idb.cache.players.getAll());
		const before = new Map(
			players.map((p) => [p.pid, JSON.stringify(p.ratings.at(-1))]),
		);
		const streamOf = (ps: typeof players) =>
			new ReadableStream({
				start(controller) {
					for (const p of ps) {
						controller.enqueue({ key: "players", value: p });
					}
					controller.close();
				},
			});

		await create(true, streamOf(players), ["players"]);
		let same = 0;
		for (const p of await idb.cache.players.getAll()) {
			if (before.get(p.pid) === JSON.stringify(p.ratings.at(-1))) {
				same += 1;
			}
		}
		assert.strictEqual(same, before.size);

		// An old file: no sub-ratings anywhere. Bases unchanged, active players get them.
		const stripped = structuredClone(players);
		for (const p of stripped) {
			delete p.subP;
			for (const r of p.ratings) {
				delete (r as any).sub;
			}
		}
		await create(true, streamOf(stripped), ["players"]);
		const imported = await idb.cache.players.getAll();
		for (const p of imported) {
			if (!before.has(p.pid)) {
				// A prospect generated to top up a class
				continue;
			}
			const r = p.ratings.at(-1) as any;
			const old = JSON.parse(before.get(p.pid)!);
			for (const k of RATINGS) {
				assert.strictEqual(r[k], old[k], `pid ${p.pid} ${k}`);
			}
			if (p.tid !== PLAYER.RETIRED) {
				assert.isTrue(subsMatchBases(r), `pid ${p.pid}`);
				assert.strictEqual(p.subP?.n, 1);
			}
		}
		// Idempotent
		assert.strictEqual(await updateSubRatingsForLeague(), 0);
	});
});
