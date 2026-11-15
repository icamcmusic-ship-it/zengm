// Rivalry Stories in a headless league: nothing is logged with the setting off; with it on every game is logged (the
// days played while it was off are backfilled from their box scores), the log matches the box scores, the rivalry page's
// story matches the raw games and loads fast, and the Newspaper and Games to Watch pick it up.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import type { Game } from "../../common/types.ts";
import { game, league, phase } from "../core/index.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "./index.ts";
import { getDefaultSettings } from "../views/newLeague.ts";
import * as views from "../views/index.ts";
import { ensureBackfill, seasonGames } from "./rivalryStories.ts";

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

const allGames = async () => {
	const map = new Map<number, Game>();
	for await (const { value } of idb.league
		.transaction("games")
		.store.iterate()) {
		map.set(value.gid, value);
	}
	for (const gm of await idb.cache.games.getAll()) {
		map.set(gm.gid, gm);
	}
	return [...map.values()].filter(
		(gm) => gm.teams[0].tid >= 0 && gm.teams[1].tid >= 0,
	);
};

const logCount = () => idb.league.transaction("rivalryGames").store.count();

describe("rivalry stories in a league", () => {
	let countWhileOff = -1;
	beforeAll(
		async () => {
			Math.random = makeSeededRandom(11);
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
					name: "rivalry",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						featureRivalries: true,
						featureRivalryStories: false,
						numGames: 24,
						numGamesPlayoffSeries: [3, 3],
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await game.play(3, {});
			countWhileOff = await logCount();
			await league.setGameAttributes({ featureRivalryStories: true });
			while (g.get("phase") <= PHASE.PLAYOFFS) {
				await game.play(5, {});
			}
		},
		10 * 60 * 1000,
	);

	test("off: nothing logged", () => {
		assert.strictEqual(countWhileOff, 0);
	});

	test("on: every game logged, matching its box score", async () => {
		const before = await logCount();
		const games = await allGames();
		assert.isBelow(before, games.length, "the days played while off");
		await ensureBackfill();
		const logged = await idb.league.transaction("rivalryGames").store.getAll();
		assert.strictEqual(logged.length, games.length);
		const byGid = new Map(logged.map((x) => [x.gid, x]));
		for (const gm of games) {
			const rec = byGid.get(gm.gid)!;
			assert.isDefined(rec, `${gm.gid}`);
			assert.strictEqual(rec.home, gm.teams[0].tid);
			assert.strictEqual(rec.hPts, gm.teams[0].pts);
			assert.strictEqual(rec.aPts, gm.teams[1].pts);
			assert.strictEqual(rec.playoffs, !!gm.playoffs);
			const top = Math.max(...gm.teams[0].players.map((p: any) => p.pts));
			assert.strictEqual(
				Math.max(
					...rec.players.filter((p) => p.tid === rec.home).map((p) => p.pts),
				),
				top,
			);
		}
		// Tracking stats (on for new leagues) come along for games logged after the game
		assert.isTrue(
			logged.some((x) => x.players.some((p) => p.dfga !== undefined)),
		);
		assert.strictEqual(
			(await seasonGames(g.get("season"))).length,
			games.length,
		);
	});

	test("the rivalry page's story matches the raw games, fast", async () => {
		const games = await allGames();
		// The pair that met most, playoffs included
		const counts = new Map<string, number>();
		for (const gm of games) {
			const a = Math.min(gm.teams[0].tid, gm.teams[1].tid);
			const b = Math.max(gm.teams[0].tid, gm.teams[1].tid);
			counts.set(`${a}-${b}`, (counts.get(`${a}-${b}`) ?? 0) + 1);
		}
		const [pair] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0]!;
		const [a, b] = pair.split("-").map(Number) as [number, number];
		await load("rivalries", { pair }); // warm up
		const t0 = performance.now();
		const out = await load("rivalries", { pair });
		const ms = performance.now() - t0;
		const story = out.selected.story;
		assert.isDefined(story);
		const mine = games.filter(
			(gm) =>
				[gm.teams[0].tid, gm.teams[1].tid].includes(a) &&
				[gm.teams[0].tid, gm.teams[1].tid].includes(b),
		);
		assert.strictEqual(story.logged.games, mine.length);
		const won = (tid: number, playoffs: boolean) =>
			mine.filter((gm) => !!gm.playoffs === playoffs && gm.won.tid === tid)
				.length;
		assert.strictEqual(story.record.rsA, won(a, false));
		assert.strictEqual(story.record.rsB, won(b, false));
		assert.strictEqual(story.record.poA, won(a, true));
		assert.strictEqual(story.record.poB, won(b, true));
		const pts = new Map<string, number>();
		for (const gm of mine) {
			for (const t of gm.teams) {
				for (const p of t.players as any[]) {
					if (p.min > 0) {
						const k = `${p.pid}|${t.tid}`;
						pts.set(k, (pts.get(k) ?? 0) + p.pts);
					}
				}
			}
		}
		for (const d of story.duels) {
			assert.strictEqual(d.pts, pts.get(`${d.pid}|${d.tid}`));
		}
		assert.isBelow(ms, 2000, `rivalries view took ${ms} ms`);
		console.log(`rivalries view (pair ${pair}): ${ms.toFixed(0)} ms`);
	});

	test("newspaper and storylines run with the setting", async () => {
		const out = await load("newspaper", {
			season: String(g.get("season")),
		});
		assert.isUndefined(out.error);
	});

	test("off again: the page has no story", async () => {
		await league.setGameAttributes({ featureRivalryStories: false });
		const out = await load("rivalries", {});
		assert.isUndefined(out.selected?.story);
		await league.setGameAttributes({ featureRivalryStories: true });
	});
});
