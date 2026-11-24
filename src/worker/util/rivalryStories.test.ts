// Rivalry Stories in a headless league: nothing is logged with the setting off; with it on every game is logged (the
// days played while it was off are backfilled from their box scores), the log matches the box scores, the rivalry page's
// story matches the raw games and loads fast, and the Newspaper and Games to Watch pick it up.
import "fake-indexeddb/auto";
// @ts-expect-error
import { appendFileSync } from "node:fs";
import { pruneStoredRivalryGame } from "../../common/rivalryStories/compact.ts";
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
import {
	ensureBackfill,
	pairGames,
	pruneRivalryLog,
	recordRivalryGames,
	resetRivalryStoriesSession,
	rivalrySeasonRows,
	seasonGames,
} from "./rivalryStories.ts";
import { pairHighBefore } from "../../common/rivalryStories/text.ts";
import type { RivalryGame } from "../../common/rivalryStories/types.ts";
import { loadRivalries } from "./rivalries.ts";

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
		const logged = await seasonGames(g.get("season"));
		assert.strictEqual(logged.length, games.length);
		// Stored compact: no names, player lines as tuples. The names come back when read.
		const stored = await idb.league.transaction("rivalryGames").store.getAll();
		assert.isTrue(stored.every((x) => x.pl && !x.players));
		const bytes = (list: unknown[]) =>
			list.reduce<number>((t, x) => t + JSON.stringify(x).length, 0) /
			list.length;
		const line = `rivalry log bytes/game: ${bytes(logged).toFixed(0)} as read (the old stored shape) -> ${bytes(stored).toFixed(0)} stored -> ${bytes(stored.map((x) => pruneStoredRivalryGame(x)!)).toFixed(0)} pruned (old seasons)`;
		console.log(line);
		const env = (globalThis as any).process.env;
		if (env.RIVALRY_SIZE_OUT) {
			appendFileSync(env.RIVALRY_SIZE_OUT, `${line}\n`);
		}
		assert.isBelow(bytes(stored), 0.6 * bytes(logged));
		const byGid = new Map(logged.map((x) => [x.gid, x]));
		for (const gm of games) {
			const rec = byGid.get(gm.gid)!;
			assert.isDefined(rec, `${gm.gid}`);
			assert.strictEqual(rec.home, gm.teams[0].tid);
			assert.strictEqual(rec.hPts, gm.teams[0].pts);
			assert.strictEqual(rec.aPts, gm.teams[1].pts);
			assert.strictEqual(rec.playoffs, !!gm.playoffs);
			const top = Math.max(...gm.teams[0].players.map((p: any) => p.pts));
			for (const p of rec.players) {
				const box = gm.teams
					.flatMap((t) => t.players as any[])
					.find((x) => x.pid === p.pid);
				// Names are looked up when the log is read: his name now, which may have gained a suffix since (a son made him
				// "Sr."), while the box score keeps the name of the day
				assert.isTrue(
					p.name === box.name || p.name.startsWith(`${box.name} `),
					`${p.name} vs ${box.name}`,
				);
			}
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
		// Playoff record is from the series, so play-in games (one game to win) are not in it
		const won = (tid: number, playoffs: boolean) =>
			mine.filter(
				(gm) =>
					!!gm.playoffs === playoffs &&
					!(playoffs && gm.numGamesToWinSeries === 1) &&
					gm.won.tid === tid,
			).length;
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

	test("the rivalry score reads the same close games and star duels from the log as from the box scores", async () => {
		await ensureBackfill();
		const on = await loadRivalries();
		await league.setGameAttributes({ featureRivalryStories: false });
		const off = await loadRivalries();
		await league.setGameAttributes({ featureRivalryStories: true });
		const key = (list: typeof on) =>
			list
				.map((e) => [
					e.key,
					e.input.closeGames!.map((x) => x.season).sort(),
					e.input.starDuels,
					e.score.score,
				])
				.sort((x, y) => String(x[0]).localeCompare(String(y[0])));
		assert.deepEqual(key(on), key(off));
		assert.isAbove(
			on.reduce((s, e) => s + e.input.closeGames!.length, 0),
			10,
		);
		// and faster: the box scores are not read
		const t0 = performance.now();
		await loadRivalries();
		const tOn = performance.now() - t0;
		console.log(`loadRivalries from the log: ${tOn.toFixed(0)} ms`);
	});

	test("the season rows keep each pair's high, the same as reading the games", async () => {
		await ensureBackfill();
		const season = g.get("season");
		const logged = await seasonGames(season);
		const fromGames = pairHighBefore(
			[{ season: season + 1 }] as RivalryGame[],
			logged,
		);
		const row = (await rivalrySeasonRows()).find((r) => r.season === season);
		assert.isDefined(row?.highs);
		assert.deepEqual(new Map(Object.entries(row!.highs!)), fromGames);
		assert.isAbove(fromGames.size, 10);
	});

	test("a day played again (crash in a multi-day sim) isn't counted twice in the season rows", async () => {
		await ensureBackfill();
		const before = structuredClone(await rivalrySeasonRows());
		// The same games come back with the same gids
		const games = (await allGames()).sort((x, y) => y.gid - x.gid).slice(0, 8);
		await recordRivalryGames(games.map((gm) => ({ gid: gm.gid }) as any));
		assert.deepEqual(await rivalrySeasonRows(), before);
	});

	test("games played while the setting was off are backfilled in the same session", async () => {
		await ensureBackfill();
		const total = await logCount();
		// As if the last day had been played with the setting off: its games are not in the log
		const last = (await allGames()).sort((x, y) => y.gid - x.gid)[0]!;
		await idb.league
			.transaction("rivalryGames", "readwrite")
			.store.delete(last.gid);
		await league.setGameAttributes({ featureRivalryStories: false });
		await recordRivalryGames([{ gid: last.gid } as any]);
		await league.setGameAttributes({ featureRivalryStories: true });
		await ensureBackfill();
		assert.strictEqual(await logCount(), total);
	});

	test("newspaper and storylines run with the setting", async () => {
		const out = await load("newspaper", {
			season: String(g.get("season")),
		});
		assert.isUndefined(out.error);
	});

	test("old records (full player rows with names) are still read", async () => {
		const [rec] = await idb.league
			.transaction("rivalryGames")
			.store.getAll(undefined, 1);
		const [read] = (await seasonGames(g.get("season"))).filter(
			(x) => x.gid === rec!.gid,
		);
		const { pl: _pl, ...rest } = rec!;
		await idb.league
			.transaction("rivalryGames", "readwrite")
			.store.put({ ...rest, players: read!.players });
		resetRivalryStoriesSession();
		const [again] = (await seasonGames(g.get("season"))).filter(
			(x) => x.gid === rec!.gid,
		);
		assert.deepEqual(again, read);
	});

	test("pruning old seasons keeps the games, their top scorers and the rivalry score", async () => {
		await ensureBackfill();
		const scoreOf = async () =>
			(await loadRivalries()).map((e) => [e.key, e.score.score]);
		const before = await scoreOf();
		const rowsBefore = await rivalrySeasonRows();
		const gamesBefore = await seasonGames(g.get("season"));
		// As if this season were more than the kept seasons ago
		const n = await pruneRivalryLog(-1);
		assert.strictEqual(n, gamesBefore.length);
		assert.strictEqual(await pruneRivalryLog(-1), 0, "a second run is a no-op");
		const after = await seasonGames(g.get("season"));
		assert.strictEqual(after.length, gamesBefore.length);
		const byGid = new Map(gamesBefore.map((x) => [x.gid, x]));
		for (const gm of after) {
			const old = byGid.get(gm.gid)!;
			assert.strictEqual(gm.cut, 1);
			assert.strictEqual(gm.hPts, old.hPts);
			assert.isAtMost(gm.players.length, 6);
			for (const tid of [gm.home, gm.away]) {
				const top = (list: RivalryGame["players"]) =>
					Math.max(0, ...list.filter((p) => p.tid === tid).map((p) => p.pts));
				assert.strictEqual(top(gm.players), top(old.players));
			}
		}
		assert.deepEqual(await scoreOf(), before);
		// The season rows are only marked
		assert.deepEqual(
			(await rivalrySeasonRows()).map(({ cut: _cut, ...row }) => row),
			rowsBefore,
		);
		// A stored box score of a pruned season isn't logged (or counted) again
		const last = (await allGames()).sort((x, y) => y.gid - x.gid)[0]!;
		await idb.league
			.transaction("rivalryGames", "readwrite")
			.store.delete(last.gid);
		resetRivalryStoriesSession();
		await ensureBackfill();
		assert.strictEqual(
			(await seasonGames(g.get("season"))).length,
			gamesBefore.length - 1,
		);
		assert.deepEqual(await scoreOf(), before);
		const [a, b] = after[0]!.pair.split("-").map(Number) as [number, number];
		assert.isAbove((await pairGames(a, b)).length, 0);
		const page = await load("rivalries", { pair: after[0]!.pair });
		assert.isDefined(page.selected.story);
	});

	test("off again: the page has no story", async () => {
		await league.setGameAttributes({ featureRivalryStories: false });
		const out = await load("rivalries", {});
		assert.isUndefined(out.selected?.story);
		await league.setGameAttributes({ featureRivalryStories: true });
	});
});
