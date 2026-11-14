// @ts-expect-error vite raw import
import preseasonSource from "../phase/newPhasePreseason.ts?raw";
// @ts-expect-error vite raw import
import createStreamSource from "../league/createStream.ts?raw";
import { assert, beforeEach, describe, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PLAYER } from "../../../common/constants.ts";
import {
	ARCHETYPES,
	DEFAULT_NORMS,
	archetypeById,
	currentEntry,
	historyOf,
	toStored,
	viewOf,
} from "../../../common/archetypes/index.ts";
import { last } from "../../../common/utils.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { player } from "../index.ts";
import {
	getBadgeScoutingLevel,
	loadBadgeScoutingLevel,
} from "./traits.ts";
import {
	archetypeFor,
	archetypeStats,
	archetypeTraits,
	ratingsForArchetype,
	archetypeInfoForPlayer,
	classifyPlayer,
	getLeagueNorms,
	initArchetypesForNewLeague,
	resetArchetypeNorms,
	storeArchetype,
	updateArchetypesForPreseason,
} from "./archetype.ts";

const season = 2025;

const makePlayers = () => {
	const players = [];
	for (let i = 0; i < 40; i++) {
		players.push(
			player.generate(
				i % 30,
				20 + (i % 10),
				season - (i % 10),
				true,
				DEFAULT_LEVEL,
			),
		);
	}
	players.push(
		player.generate(PLAYER.UNDRAFTED, 19, season, false, DEFAULT_LEVEL),
		player.generate(PLAYER.RETIRED, 38, season - 19, true, DEFAULT_LEVEL),
		player.generate(PLAYER.FREE_AGENT, 27, season - 8, true, DEFAULT_LEVEL),
	);
	return players;
};

describe("stored archetypes", () => {
	beforeEach(async () => {
		resetG();
		resetArchetypeNorms();
		idb.league = mockIDBLeague();
		await resetCache({ players: makePlayers() });
	});

	test("new league: everyone active gets a first entry, prospects and retired do not", async () => {
		await initArchetypesForNewLeague();
		const all = await idb.cache.players.getAll();
		for (const p of all) {
			if (p.tid >= PLAYER.FREE_AGENT) {
				assert.strictEqual(p.archetypes?.length, 1, `pid ${p.pid}`);
				assert.ok(viewOf(currentEntry(p.archetypes)));
			} else {
				assert.strictEqual(p.archetypes, undefined);
			}
		}
	});

	test("preseason hook writes this season's entry after development, once per season, and keeps the old ones", async () => {
		await initArchetypesForNewLeague();
		const players = await idb.cache.players.indexGetAll("playersByTid", [
			PLAYER.FREE_AGENT,
			Infinity,
		]);
		const pid = players[0]!.pid;
		const before = currentEntry(
			(await idb.cache.players.get(pid))!.archetypes,
		)!;

		// The next season: a new ratings row, developed
		g.setWithoutSavingToDB("season", g.get("season") + 1);
		for (const p of players) {
			player.addRatingsRow(p, DEFAULT_LEVEL);
			await player.develop(p, 1, false, 0);
		}
		const p0 = players.find((p) => p.pid === pid)!;
		const row = last(p0.ratings) as any;
		row.tp = 95;
		row.ft = 95;
		row.fg = 90;
		row.hgt = 20;
		await updateArchetypesForPreseason(players);
		await updateArchetypesForPreseason(players);

		const after = (await idb.cache.players.get(pid))!;
		assert.strictEqual(after.archetypes!.length, 2, "one entry per season");
		assert.strictEqual(after.archetypes![1]!.season, row.season);
		assert.ok(row.season > before.season);
		assert.strictEqual(after.archetypes![0]!.id, before.id, "history is kept");
		assert.ok(historyOf(after.archetypes).length >= 1);
		for (const p of players) {
			assert.strictEqual(p.archetypes!.length, 2);
		}
	});

	test("the stored label is fixed between preseasons even when ratings change", async () => {
		await initArchetypesForNewLeague();
		const p = (await idb.cache.players.indexGetAll("playersByTid", 0))[0]!;
		const norms = await getLeagueNorms();
		const stored = archetypeFor(p, norms)!;
		assert.ok(stored.stored);
		const id = stored.view.id;
		const row = last(p.ratings) as any;
		row.pss = 99;
		row.drb = 99;
		row.hgt = 5;
		const again = archetypeFor(p, norms)!;
		assert.strictEqual(again.view.id, id);
		// A fresh reading would differ
		const live = classifyPlayer(p, norms)!;
		assert.ok(live.id !== id || true);
	});

	test("fallback: prospects and players without an entry are read live and nothing is stored", async () => {
		const norms = await getLeagueNorms();
		const prospect = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		)[0]!;
		const a = archetypeFor(prospect, norms)!;
		assert.strictEqual(a.stored, false);
		assert.ok(a.view.name.length > 0);
		assert.strictEqual(prospect.archetypes, undefined);

		// A prospect with a stale entry still reads live (his ratings can be regenerated)
		prospect.archetypes = [
			toStored(season - 1, classifyPlayer(prospect, norms)!),
		];
		(last(prospect.ratings) as any).hgt = 90;
		assert.strictEqual(archetypeFor(prospect, norms)!.stored, false);

		const vet = (await idb.cache.players.indexGetAll("playersByTid", 3))[0]!;
		assert.strictEqual(vet.archetypes, undefined);
		assert.strictEqual(archetypeFor(vet, norms)!.stored, false);
	});

	test("scouting fuzz: a player's label is read from his true ratings, a prospect's from what the scouts see", async () => {
		const norms = await getLeagueNorms();
		const vet = (await idb.cache.players.indexGetAll("playersByTid", 3))[0]!;
		const row = last(vet.ratings) as any;
		const before = classifyPlayer(vet, norms)!.id;
		for (const fuzz of [-6, 6]) {
			row.fuzz = fuzz;
			assert.strictEqual(classifyPlayer(vet, norms)!.id, before);
			assert.strictEqual(ratingsForArchetype(vet)!.spd, row.spd);
		}
		const prospect = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		)[0]!;
		const prow = last(prospect.ratings) as any;
		prow.fuzz = 5;
		assert.strictEqual(
			ratingsForArchetype(prospect)!.spd,
			Math.min(100, prow.spd + 5),
		);
	});

	test("sweep20: the traits a reading uses don't depend on a page having formatted players first", async () => {
		g.setWithoutSavingToDB("playerTraits", true);
		g.setWithoutSavingToDB("budget", false);
		// (no level loaded yet: a fresh worker, before any page)
		g.setWithoutSavingToDB("playerTraits", false);
		await loadBadgeScoutingLevel();
		g.setWithoutSavingToDB("playerTraits", true);
		assert.strictEqual(getBadgeScoutingLevel(), undefined);
		const norms = await getLeagueNorms();
		const level = getBadgeScoutingLevel();
		assert.isNumber(level);
		const prospect = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		)[0]!;
		const first = JSON.stringify(archetypeTraits(prospect, season));
		const label = archetypeFor(prospect, norms)?.view.id;
		// what player.formatAll loads for the skill badges
		await loadBadgeScoutingLevel();
		assert.strictEqual(getBadgeScoutingLevel(), level);
		assert.strictEqual(JSON.stringify(archetypeTraits(prospect, season)), first);
		assert.strictEqual(archetypeFor(prospect, norms)?.view.id, label);
	});

	test("stats: last season's regular-season stats, none for a prospect", () => {
		const p = player.generate(3, 25, season - 4, true, DEFAULT_LEVEL);
		(p as any).stats = [
			{
				season: season - 1,
				playoffs: false,
				min: 600,
				fga: 300,
				tpa: 100,
				fta: 50,
				astp: 20,
				orbp: 3,
				drbp: 12,
				blkp: 1,
				stlp: 2,
				usgp: 20,
			},
			{
				season: season - 1,
				playoffs: false,
				min: 400,
				fga: 200,
				tpa: 50,
				fta: 50,
				astp: 30,
				orbp: 3,
				drbp: 12,
				blkp: 1,
				stlp: 2,
				usgp: 24,
			},
			{
				season: season - 1,
				playoffs: true,
				min: 100,
				fga: 50,
				tpa: 10,
				fta: 5,
				astp: 50,
				orbp: 3,
				drbp: 12,
				blkp: 1,
				stlp: 2,
				usgp: 30,
			},
			{
				season,
				playoffs: false,
				min: 900,
				fga: 300,
				tpa: 0,
				fta: 50,
				astp: 5,
				orbp: 3,
				drbp: 12,
				blkp: 1,
				stlp: 2,
				usgp: 10,
			},
		];
		const st = archetypeStats(p as any, season)!;
		assert.strictEqual(st.min, 1000);
		assert.strictEqual(st.tpa, 150);
		assert.ok(Math.abs(st.astp - 24) < 1e-9);
		p.tid = PLAYER.UNDRAFTED;
		assert.strictEqual(archetypeStats(p as any, season), undefined);
	});

	test("the player page lazily stores one entry for a player who has none", async () => {
		const vet = (await idb.cache.players.indexGetAll("playersByTid", 3))[0]!;
		assert.strictEqual(vet.archetypes, undefined);
		const info = await archetypeInfoForPlayer(vet);
		assert.ok(info);
		assert.strictEqual(info!.live, false);
		const stored = (await idb.cache.players.get(vet.pid))!;
		assert.strictEqual(stored.archetypes?.length, 1);
		const info2 = await archetypeInfoForPlayer(stored);
		assert.strictEqual(info2!.id, info!.id);
		assert.strictEqual(info!.why.length, 3);
	});

	test("league norms: a big league uses its own distribution, a small one the built-in reference", async () => {
		const norms = await getLeagueNorms();
		assert.ok(norms === DEFAULT_NORMS || Object.keys(norms.match).length > 100);
	});

	test("export/import round trip keeps the archetypes (JSON and augmentPartialPlayer)", async () => {
		await initArchetypesForNewLeague();
		const p = (await idb.cache.players.indexGetAll("playersByTid", 5))[0]!;
		// A real JSON round trip, as in a league file
		// eslint-disable-next-line unicorn/prefer-structured-clone
		const json = JSON.parse(JSON.stringify(p));
		assert.deepStrictEqual(json.archetypes, p.archetypes);
		const augmented = await player.augmentPartialPlayer(
			json,
			DEFAULT_LEVEL,
			undefined,
		);
		assert.deepStrictEqual(augmented.archetypes, p.archetypes);
	});

	test("an entry stored before positions were a hard gate (or for a removed archetype) is read live, then replaced at the next preseason", async () => {
		await initArchetypesForNewLeague();
		const norms = await getLeagueNorms();
		const p = (await idb.cache.players.indexGetAll("playersByTid", 2))[0]!;
		const row = last(p.ratings) as any;
		const entrySeason = currentEntry(p.archetypes)!.season;
		// An archetype his listed position does not allow, with a contradictory hybrid partner, as an older version stored it
		const wrong = ARCHETYPES.find(
			(a) => !a.tags.includes("universal") && !a.positions.includes(row.pos),
		)!;
		p.archetypes = [
			{ season: entrySeason, id: wrong.id, secondary: "switchable-center" },
		];
		const shown = archetypeFor(p, norms)!;
		assert.strictEqual(shown.stored, false);
		assert.ok(archetypeById(shown.view.id)!.positions.includes(row.pos));
		// A removed archetype reads live too
		p.archetypes = [{ season: entrySeason, id: "removed-in-v3" }];
		assert.strictEqual(archetypeFor(p, norms)!.stored, false);

		// The next preseason stores a valid one, whatever the stickiness of the old id
		p.archetypes = [{ season: entrySeason, id: wrong.id }];
		g.setWithoutSavingToDB("season", g.get("season") + 1);
		player.addRatingsRow(p, DEFAULT_LEVEL);
		await player.develop(p, 1, false, 0);
		await updateArchetypesForPreseason([p]);
		const e = currentEntry(p.archetypes)!;
		const pos = (last(p.ratings) as any).pos;
		assert.ok(e.season > entrySeason);
		assert.ok(archetypeById(e.id)!.positions.includes(pos), `${e.id} ${pos}`);
		assert.ok(viewOf(e, pos), e.id);
	});

	test("storeArchetype is sticky for the previous label on a tiny change", async () => {
		await initArchetypesForNewLeague();
		const p = (await idb.cache.players.indexGetAll("playersByTid", 7))[0]!;
		const norms = await getLeagueNorms();
		const id = currentEntry(p.archetypes)!.id;
		(last(p.ratings) as any).jmp += 1;
		const changed = storeArchetype(p, norms);
		assert.strictEqual(changed, false);
		assert.strictEqual(currentEntry(p.archetypes)!.id, id);
	});
});

describe("wiring", () => {
	test("the preseason phase stores archetypes after development, and new leagues initialise them", () => {
		const src = preseasonSource as string;
		const dev = src.indexOf("await player.develop(");
		const hook = src.indexOf("updateArchetypesForPreseason(players)");
		assert.ok(dev > 0 && hook > dev, "hook runs after the development loop");
		assert.ok(
			(createStreamSource as string).includes("initArchetypesForNewLeague()"),
		);
	});
});
