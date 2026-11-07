import { assert, beforeEach, test } from "vitest";
import { PLAYER, PHASE } from "../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../test/helpers.ts";
import { g } from "../util/index.ts";
import { idb } from "../db/index.ts";
import { player } from "../core/index.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { makeBlankPreDraftStatsRow } from "../core/player/normalizePreDraft.ts";
import api from "./index.ts";

beforeEach(async () => {
	resetG();
	g.setWithoutSavingToDB("season", 2026);
	g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
	g.setWithoutSavingToDB("budget", false);
	await resetCache({});
	idb.league = mockIDBLeague();
});

const makeUploadedPlayer = (pid: number, draftYear: number) => {
	const base = player.generate(
		PLAYER.UNDRAFTED,
		19,
		draftYear,
		false,
		DEFAULT_LEVEL,
	);
	const p: any = structuredClone({ ...base, pid });
	p.stats = [
		{ ...makeBlankPreDraftStatsRow(draftYear - 1), gp: 30, pts: 400 },
		{ ...makeBlankPreDraftStatsRow(draftYear), gp: 30, pts: 600 },
	];
	p.awards = [{ season: draftYear, type: "Wooden Award" }];
	return p;
};

test("Draft -> Import keeps pre-draft stats rows and honors, and replaces the class", async () => {
	const uploadedFile = {
		version: 70,
		startingSeason: 2026,
		players: [makeUploadedPlayer(0, 2026), makeUploadedPlayer(1, 2026)],
	};

	// Import it twice: the class is replaced, so no duplicates the second time
	for (let i = 0; i < 2; i++) {
		await api.main.handleUploadedDraftClass({
			uploadedFile: structuredClone(uploadedFile),
			draftYear: 2026,
		});
	}

	const players = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const imported = players.filter((p) => p.awards.length > 0);
	assert.strictEqual(imported.length, 2);

	for (const p of imported) {
		assert.strictEqual(p.draft.year, 2026);
		assert.deepStrictEqual(
			p.stats.map((row) => [row.season, row.tid, row.pts]),
			[
				[2025, PLAYER.DOES_NOT_EXIST, 400],
				[2026, PLAYER.DOES_NOT_EXIST, 600],
			],
		);
		assert.deepStrictEqual(p.awards, [{ season: 2026, type: "Wooden Award" }]);

		const pf = await player.format(p, { attrs: ["experience"] });
		assert.strictEqual(pf!.experience, 0);
	}

	// The rest of the class is generated players, without pre-draft rows
	for (const p of players.filter((p) => p.awards.length === 0)) {
		assert.strictEqual(p.stats.length, 0);
	}
});

test("importing a class into a later draft year shifts the seasons", async () => {
	const uploadedFile = {
		version: 70,
		startingSeason: 2026,
		players: [makeUploadedPlayer(0, 2026)],
	};
	await api.main.handleUploadedDraftClass({
		uploadedFile,
		draftYear: 2028,
	});

	const players = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const imported = players.find((p) => p.awards.length > 0)!;
	assert.deepStrictEqual(
		imported.stats.map((row) => row.season),
		[2027, 2028],
	);
	assert.deepStrictEqual(imported.awards, [
		{ season: 2028, type: "Wooden Award" },
	]);
});
