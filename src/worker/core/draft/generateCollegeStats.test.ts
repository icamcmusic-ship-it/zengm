import { assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { draft, player } from "../index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	getPreDraftAwards,
	hasPreDraftStats,
} from "../../../common/preDraft.ts";
import {
	generateCollegeStats,
	removeCollegeStats,
} from "./generateCollegeStats.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import type { Player } from "../../../common/types.ts";

const SEASON = 2026;

let prospects: Player[];
beforeEach(async () => {
	resetG();
	g.setWithoutSavingToDB("season", SEASON);
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	g.setWithoutSavingToDB("generateCollegeStats", false);
	const players = await genPlayersWithoutSaving(SEASON, DEFAULT_LEVEL, []);
	prospects = players.map((p, i) => {
		p.born.loc = i % 6 === 0 ? "Belgrade, Serbia" : "Chicago, IL, USA";
		p.college = i % 3 === 0 ? "" : ["Duke", "Kansas", "Gonzaga"][i % 3]!;
		return { ...p, pid: i };
	}) as Player[];
	await resetCache({ players: prospects });
	for (const p of prospects) {
		await player.updateValues(p);
	}
});

const getProspects = () =>
	idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED);

describe("generateCollegeStats", () => {
	test("gives prospects college rows and honors, leaves ratings and value alone", async () => {
		const before = structuredClone(
			(await getProspects()).map((p) => ({
				ratings: p.ratings,
				value: p.value,
				valueFuzz: p.valueFuzz,
				valueNoPot: p.valueNoPot,
				valueNoPotFuzz: p.valueNoPotFuzz,
				draft: p.draft,
				contractDemand: p.contractDemand,
				tid: p.tid,
				born: p.born,
			})),
		);

		const output = await generateCollegeStats({
			draftYear: SEASON,
			seed: "abc",
		});
		assert.strictEqual(output.numPlayers, prospects.length);
		assert(output.numSeasons > prospects.length / 2);

		const after = await getProspects();
		assert.deepStrictEqual(
			after.map((p) => ({
				ratings: p.ratings,
				value: p.value,
				valueFuzz: p.valueFuzz,
				valueNoPot: p.valueNoPot,
				valueNoPotFuzz: p.valueNoPotFuzz,
				draft: p.draft,
				contractDemand: p.contractDemand,
				tid: p.tid,
				born: p.born,
			})),
			before,
		);

		// Value is also unchanged if recomputed with the college rows there
		for (const p of after) {
			const value = p.value;
			await player.updateValues(p);
			assert.strictEqual(p.value, value);
		}

		let numWith = 0;
		for (const p of after) {
			if (p.stats.length === 0) {
				continue;
			}
			numWith += 1;
			assert(hasPreDraftStats(p));
			for (const row of p.stats) {
				assert.strictEqual(row.tid, PLAYER.DOES_NOT_EXIST);
				assert.strictEqual(row.playoffs, false);
				assert(row.season <= SEASON);
				assert(typeof row.teamName === "string" && row.teamName !== "");
			}
			assert.strictEqual(p.stats.at(-1)!.season, SEASON);
			// Never a pro award
			assert.strictEqual(getPreDraftAwards(p).length, p.awards.length);

			const pf = await player.format(p, {
				attrs: ["experience", "awards"],
				stats: ["season", "pts", "gp"],
				showNoStats: true,
			});
			assert.strictEqual(pf!.experience, 0);
			assert.strictEqual(pf!.awards.length, 0);
			assert.strictEqual(pf!.careerStats.gp, 0);
		}
		assert(numWith > 30);

		// A prospect with a blank college got one
		assert(after.every((p) => p.college !== "" || p.stats.length === 0));
	});

	test("same seed, same output. Regenerating replaces rather than appends", async () => {
		await generateCollegeStats({ draftYear: SEASON, seed: "abc" });
		const first = structuredClone(await getProspects());
		await generateCollegeStats({ draftYear: SEASON, seed: "abc" });
		const second = await getProspects();
		assert.deepStrictEqual(
			second.map((p) => [p.stats, p.awards, p.college]),
			first.map((p) => [p.stats, p.awards, p.college]),
		);

		await generateCollegeStats({ draftYear: SEASON, seed: "other" });
		const third = await getProspects();
		// Different seed, different seasons, but still no more rows than seasons of eligibility
		assert.notStrictEqual(
			JSON.stringify(third.map((p) => p.stats)),
			JSON.stringify(first.map((p) => p.stats)),
		);
		for (const p of third) {
			assert(p.stats.length <= 4);
			assert.strictEqual(
				new Set(p.stats.map((row) => row.season)).size,
				p.stats.length,
			);
		}
	});

	test("onlyMissing leaves prospects with rows alone", async () => {
		const p0 = prospects[1]!;
		await generateCollegeStats({ draftYear: SEASON, seed: "abc" });
		const rowsBefore = structuredClone(p0.stats);
		// Add a new prospect with nothing
		const newPlayers = await genPlayersWithoutSaving(SEASON, DEFAULT_LEVEL, []);
		const extra = { ...newPlayers[0]!, pid: 999, college: "Duke" } as Player;
		await idb.cache.players.add(extra);

		const output = await generateCollegeStats({
			draftYear: SEASON,
			seed: "different",
			onlyMissing: true,
		});
		// Only the prospects with nothing yet (the ones whose college was not skipped by being idle)
		assert(output.numPlayers >= 1);
		assert(output.numPlayers < prospects.length);
		assert.deepStrictEqual(p0.stats, rowsBefore);
		assert(hasPreDraftStats(extra));
	});

	test("classes further out get projected ratings and their own seasons", async () => {
		const future = (
			await genPlayersWithoutSaving(SEASON + 2, DEFAULT_LEVEL, [])
		).map((p, i) => ({ ...p, pid: 1000 + i, college: "Kansas" })) as Player[];
		await idb.cache.players.addAll(future);
		await generateCollegeStats({ draftYear: SEASON + 2, seed: "abc" });
		const rows = future.flatMap((p) => p.stats);
		assert(rows.length > 0);
		assert(
			rows.every((row) => row.season <= SEASON + 2 && row.season >= SEASON - 2),
		);
		// The current class was left alone
		assert(
			(await getProspects())
				.filter((p) => p.draft.year === SEASON)
				.every((p) => p.stats.length === 0),
		);
	});

	test("removeCollegeStats takes them back off", async () => {
		await generateCollegeStats({ draftYear: SEASON, seed: "abc" });
		const output = await removeCollegeStats(SEASON);
		assert(output.numPlayers > 0);
		for (const p of await getProspects()) {
			assert.strictEqual(p.stats.length, 0);
			assert.strictEqual(p.awards.length, 0);
		}
	});

	test("does not touch drafted players", async () => {
		const drafted = prospects[2]!;
		drafted.tid = 3;
		await idb.cache.players.put(drafted);
		await generateCollegeStats({ draftYear: SEASON, seed: "abc" });
		assert.strictEqual(drafted.stats.length, 0);
	});
});

describe("drafted prospects start their pro career fresh", () => {
	test("experience 0 until a pro season, career totals pro only, value unchanged by the college rows", async () => {
		await generateCollegeStats({ draftYear: SEASON, seed: "abc" });
		const p = (await getProspects()).find((p) => p.stats.length >= 2)!;
		assert(p);
		const numCollegeRows = p.stats.length;
		const valueBefore = p.value;

		// Drafted by team 3
		p.tid = 3;
		p.draft.tid = 3;
		p.draft.round = 1;
		p.draft.pick = 5;
		await idb.cache.players.put(p);

		const pf0 = await player.format(p, { attrs: ["experience"] });
		assert.strictEqual(pf0!.experience, 0);

		// New season: first game adds a pro row after the college rows
		g.setWithoutSavingToDB("season", SEASON + 1);
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		player.addStatsRow(p, SEASON + 1, false);
		assert.strictEqual(p.stats.length, numCollegeRows + 1);
		const proRow = p.stats.at(-1)!;
		assert.strictEqual(proRow.tid, 3);
		assert.strictEqual(proRow.season, SEASON + 1);
		proRow.gp = 60;
		proRow.min = 1500;
		proRow.pts = 700;
		proRow.per = 14;

		const pf = await player.format(p, {
			attrs: ["experience"],
			stats: ["season", "pts", "gp"],
			statType: "totals",
		});
		assert.strictEqual(pf!.experience, 1);
		assert.strictEqual(pf!.stats.length, 1);
		assert.strictEqual(pf!.careerStats.gp, 60);
		assert.strictEqual(pf!.careerStats.pts, 700);

		// Value only looks at the pro season
		await player.updateValues(p);
		const withCollege = p.value;
		const p2 = {
			...p,
			stats: p.stats.filter((row) => row.tid === 3),
		} as Player;
		await player.updateValues(p2);
		assert.strictEqual(withCollege, p2.value);
		assert(Number.isFinite(valueBefore));
	});
});

describe("setting for new draft classes", () => {
	test("a newly generated draft class gets college stats only when the setting is on", async () => {
		for (const enabled of [false, true]) {
			await resetCache({});
			idb.league = mockIDBLeague();
			g.setWithoutSavingToDB("generateCollegeStats", enabled);
			await draft.genPlayers(SEASON + 1, DEFAULT_LEVEL);
			const players = await getProspects();
			assert(players.length > 50);
			const numWith = players.filter((p) => hasPreDraftStats(p)).length;
			if (enabled) {
				// Everyone but the prospects who didn't play anywhere
				assert(numWith > players.length * 0.8, `${numWith}/${players.length}`);
			} else {
				assert.strictEqual(numWith, 0);
			}
		}
	});
});

describe("college season (featureCollegeSeason)", () => {
	test("prospects carry their team's season, it can be rebuilt, and onlyMissing keeps it", async () => {
		idb.league = mockIDBLeague();
		g.setWithoutSavingToDB("featureCollegeSeason" as any, true);
		await generateCollegeStats({ draftYear: SEASON, seed: "abc" });

		const players = await getProspects();
		const marked = players.filter((p) => p.collegeSeason);
		// Duke, Kansas, Gonzaga, and blank colleges of American-born prospects
		assert(marked.length >= (players.length * 2) / 3, `${marked.length}`);
		const { getCollegeSeason } = await import("./collegeSeason.ts");
		const built = (await getCollegeSeason(SEASON))!;
		assert.strictEqual(built.players.length, marked.length);
		for (const p of marked) {
			const stored = p.collegeSeason!;
			assert.strictEqual(stored.season, SEASON);
			assert.strictEqual(stored.seed, "abc");
			const team = built.season.teams.find((t) => t.school === stored.school)!;
			assert.strictEqual(stored.summary.w, team.w);
			assert.strictEqual(stored.summary.ncaa, team.ncaa);
			const row = p.stats.find(
				(r) => r.season === SEASON && r.tid === PLAYER.DOES_NOT_EXIST,
			) as any;
			assert.strictEqual(row.teamName, stored.school);
			assert.isAtLeast(row.gp, stored.summary.games.length);
			const pts = stored.summary.games.reduce((sum, game) => sum + game.pts, 0);
			assert.isAtMost(pts, row.pts);
		}

		// A new prospect only gets stats: the season doesn't change
		const before = JSON.stringify(built.season);
		const newcomer = { ...structuredClone(prospects[1]!), pid: 1000 };
		newcomer.stats = [];
		newcomer.awards = [];
		await idb.cache.players.put(newcomer);
		await generateCollegeStats({
			draftYear: SEASON,
			seed: "other",
			onlyMissing: true,
		});
		const p1000 = (await idb.cache.players.get(1000))!;
		assert.strictEqual(p1000.collegeSeason?.seed, "abc");
		assert.strictEqual(p1000.collegeSeason?.boost, 0);
		assert.strictEqual(
			JSON.stringify((await getCollegeSeason(SEASON))!.season),
			before,
		);

		await removeCollegeStats(SEASON);
		assert.strictEqual(
			(await getProspects()).filter((p) => p.collegeSeason).length,
			0,
		);
		assert.isUndefined(await getCollegeSeason(SEASON));
	});

	test("a class from before season versions is rebuilt the old way, and stays that way", async () => {
		idb.league = mockIDBLeague();
		g.setWithoutSavingToDB("featureCollegeSeason" as any, true);
		await generateCollegeStats({ draftYear: SEASON, seed: "abc" });
		const { getCollegeSeason } = await import("./collegeSeason.ts");

		// New classes are stored with the current version: NIT games count
		const current = (await getCollegeSeason(SEASON))!;
		assert.strictEqual(current.season.version, 3);
		assert.isTrue(current.season.nit.counted);
		for (const p of current.players) {
			assert.strictEqual(p.collegeSeason!.v, 3);
			// Version 3 stores the position, so a guards' or big men's year is rebuilt the same way
			assert.isString(p.collegeSeason!.pos);
			const team = current.season.teams.find(
				(t) => t.school === p.collegeSeason!.school,
			)!;
			assert.strictEqual(p.collegeSeason!.summary.nit, team.nit);
		}
		// The same class twice is the same object (cached)
		assert.strictEqual((await getCollegeSeason(SEASON))!.season, current.season);

		// What an old class looks like: no version on the prospects
		for (const p of current.players) {
			delete p.collegeSeason!.v;
			await idb.cache.players.put(p);
		}
		const old = (await getCollegeSeason(SEASON))!;
		assert.strictEqual(old.season.version, 1);
		assert.isFalse(old.season.nit.counted);
		assert.strictEqual(old.season.storyline.shape, "standard");
		assert.strictEqual(old.season.polls.length, 19);

		// A prospect added later joins the old season as it is
		const before = JSON.stringify(old.season);
		const newcomer = { ...structuredClone(prospects[1]!), pid: 1001 };
		newcomer.stats = [];
		newcomer.awards = [];
		delete newcomer.collegeSeason;
		await idb.cache.players.put(newcomer);
		await generateCollegeStats({
			draftYear: SEASON,
			seed: "other",
			onlyMissing: true,
		});
		const p1001 = (await idb.cache.players.get(1001))!;
		assert.isDefined(p1001.collegeSeason);
		assert.isUndefined(p1001.collegeSeason!.v);
		assert.isUndefined(p1001.collegeSeason!.summary.nit);
		const again = (await getCollegeSeason(SEASON))!;
		assert.strictEqual(again.season.version, 1);
		assert.strictEqual(JSON.stringify(again.season), before);

		await removeCollegeStats(SEASON);
	});
});
