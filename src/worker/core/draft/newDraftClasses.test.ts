import { assert, beforeEach, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { draft, player } from "../index.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { getPreDraftStats, hasPreDraftStats } from "../../../common/preDraft.ts";
import {
	generateCollegeStatsAllClasses,
	processNewDraftClasses,
} from "./generateCollegeStats.ts";
import {
	applyRegenerateAllClasses,
	previewRegenerateAllClasses,
	restoreOriginalRatingsAllClasses,
	undoRegenerate,
} from "./regenerateRatings.ts";
import genPlayersWithoutSaving from "./genPlayersWithoutSaving.ts";
import type { Player } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";

const SEASON = 2026;
const YEARS = [SEASON, SEASON + 1, SEASON + 2];

const getProspects = () =>
	idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED);

let basePlayers: Player[] | undefined;

const setup = async () => {
	resetG();
	g.setWithoutSavingToDB("season", SEASON);
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	g.setWithoutSavingToDB("generateCollegeStats", false);
	g.setWithoutSavingToDB("rerandomizeDraftClassRatings", false);
	g.setWithoutSavingToDB("draftClassRegenSettings", undefined);
	// Generated once, so every test (and a re-run within a test) starts from the same players
	if (!basePlayers) {
		let pid = 0;
		basePlayers = [];
		for (const year of YEARS) {
			const players = await genPlayersWithoutSaving(year, DEFAULT_LEVEL, []);
			for (const p of players.slice(0, 25)) {
				basePlayers.push({ ...p, pid: pid++ } as Player);
			}
		}
		// One drafted player, who must never be touched
		const drafted = structuredClone(basePlayers[0]!);
		drafted.pid = 999;
		drafted.tid = 0;
		basePlayers.push(drafted);
	}
	const all = structuredClone(basePlayers);
	await resetCache({ players: all });
	for (const p of all) {
		await player.updateValues(p);
	}
};

beforeEach(setup);

const ratingsSnapshot = async () =>
	JSON.stringify(
		(await getProspects()).map((p) => [p.pid, last(p.ratings), p.hgt]),
	);

describe("all classes buttons", () => {
	test("stats for every class, only missing vs replace", async () => {
		const { classes } = await generateCollegeStatsAllClasses({
			seed: "s",
			onlyMissing: true,
		});
		assert.deepStrictEqual(
			classes.map((c) => c.draftYear),
			YEARS,
		);
		for (const year of YEARS) {
			const players = (await getProspects()).filter(
				(p) => p.draft.year === year,
			);
			assert.isAbove(players.filter(hasPreDraftStats).length, 15);
		}
		const withStats = (await getProspects()).filter(hasPreDraftStats);
		const statsOf = async () =>
			JSON.stringify(
				await Promise.all(
					withStats.map(async (p) =>
						getPreDraftStats((await idb.cache.players.get(p.pid))!),
					),
				),
			);
		const before = await statsOf();
		// Only missing: prospects with stats keep them on a second run, even with another seed
		await generateCollegeStatsAllClasses({ seed: "other", onlyMissing: true });
		assert.strictEqual(await statsOf(), before);
		// Replace: another seed gives other stats
		await generateCollegeStatsAllClasses({ seed: "other", onlyMissing: false });
		assert.notStrictEqual(await statsOf(), before);
		const drafted = await idb.cache.players.get(999);
		assert.isFalse(hasPreDraftStats(drafted!));
	});

	test("regenerate ratings for every class, one undo, restore originals", async () => {
		const original = await ratingsSnapshot();
		const draftedBefore = JSON.stringify(
			(await idb.cache.players.get(999))!.ratings,
		);
		const settings = { seed: "x", variation: 3 };
		const preview = await previewRegenerateAllClasses({ settings });
		assert.strictEqual(preview.classes.length, 3);
		assert.isAbove(preview.classes[0]!.numChanged, 0);
		// Preview changes nothing
		assert.strictEqual(await ratingsSnapshot(), original);

		const { classes } = await applyRegenerateAllClasses({ settings });
		for (const c of classes) {
			assert.isAbove(c.applied, 0);
		}
		const prospects = await getProspects();
		assert(prospects.every((p) => p.ratingsBuild));
		// ovr unchanged
		const applied = await ratingsSnapshot();
		assert.notStrictEqual(applied, original);
		assert.strictEqual(
			JSON.stringify((await idb.cache.players.get(999))!.ratings),
			draftedBefore,
		);

		await undoRegenerate();
		assert.strictEqual(await ratingsSnapshot(), original);

		await applyRegenerateAllClasses({ settings });
		assert.strictEqual(await ratingsSnapshot(), applied, "deterministic");
		const { restored } = await restoreOriginalRatingsAllClasses();
		assert.strictEqual(restored, prospects.length);
		assert(
			(await getProspects()).every((p) => p.ratingsBuild === undefined),
		);
	});
});

describe("new draft class settings", () => {
	test("both off: nothing happens", async () => {
		const original = await ratingsSnapshot();
		await processNewDraftClasses();
		assert.strictEqual(await ratingsSnapshot(), original);
		assert((await getProspects()).every((p) => !hasPreDraftStats(p)));
	});

	test("re-randomize first, then stats from the new ratings; deterministic per class", async () => {
		g.setWithoutSavingToDB("rerandomizeDraftClassRatings", true);
		g.setWithoutSavingToDB("generateCollegeStats", true);
		g.setWithoutSavingToDB("lid", 7);
		await processNewDraftClasses();
		const prospects = await getProspects();
		assert(prospects.every((p) => p.ratingsBuild?.seed.startsWith("league-7")));
		assert.isAbove(prospects.filter(hasPreDraftStats).length, 50);
		const first = JSON.stringify(
			prospects.map((p) => [last(p.ratings), getPreDraftStats(p)]),
		);

		// Stats were generated from the regenerated ratings: the same as generating them afterwards from scratch
		const statsNow = JSON.stringify(prospects.map((p) => getPreDraftStats(p)));
		await generateCollegeStatsAllClasses({ seed: "unused", onlyMissing: true });
		assert.strictEqual(
			JSON.stringify((await getProspects()).map((p) => getPreDraftStats(p))),
			statsNow,
		);

		// Same league + class years = same result
		await setup();
		g.setWithoutSavingToDB("rerandomizeDraftClassRatings", true);
		g.setWithoutSavingToDB("generateCollegeStats", true);
		g.setWithoutSavingToDB("lid", 7);
		await processNewDraftClasses();
		assert.strictEqual(
			JSON.stringify(
				(await getProspects()).map((p) => [
					last(p.ratings),
					getPreDraftStats(p),
				]),
			),
			first,
		);

		// Running it again doesn't regenerate anyone a second time
		const again = await ratingsSnapshot();
		await processNewDraftClasses();
		assert.strictEqual(await ratingsSnapshot(), again);

		const drafted = await idb.cache.players.get(999);
		assert.isUndefined(drafted!.ratingsBuild);
		assert.isFalse(hasPreDraftStats(drafted!));
	});

	test("saved league default settings are used", async () => {
		g.setWithoutSavingToDB("rerandomizeDraftClassRatings", true);
		g.setWithoutSavingToDB("draftClassRegenSettings", { seed: "saved" });
		await processNewDraftClasses([SEASON]);
		const prospects = await getProspects();
		const thisClass = prospects.filter((p) => p.draft.year === SEASON);
		assert(thisClass.every((p) => p.ratingsBuild?.seed === `saved|${SEASON}`));
		// Only the given class
		assert(
			prospects
				.filter((p) => p.draft.year !== SEASON)
				.every((p) => !p.ratingsBuild),
		);
	});

	test("a newly generated class gets re-randomized and stats; a topped-off imported class keeps its ratings", async () => {
		await resetCache({});
		idb.league = mockIDBLeague();
		g.setWithoutSavingToDB("rerandomizeDraftClassRatings", true);
		g.setWithoutSavingToDB("generateCollegeStats", true);
		await draft.genPlayers(SEASON + 3, DEFAULT_LEVEL);
		const players = await getProspects();
		assert(players.length > 50);
		assert(players.every((p) => p.ratingsBuild));
		assert.isAbove(players.filter(hasPreDraftStats).length, players.length * 0.8);
	});
});
