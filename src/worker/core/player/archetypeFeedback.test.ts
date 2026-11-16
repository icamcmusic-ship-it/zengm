// archfb: the "Doesn't fit?" flow in a league: a pick becomes his label at once (and can be cleared), picks are kept in the
// league (exported with it) and, with the cross-league switch on, browser-wide; reset forgets them; with no feedback the
// reading is exactly the shipped one.
import { assert, beforeEach, describe, test } from "vitest";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { PLAYER } from "../../../common/constants.ts";
import { archetypeById } from "../../../common/archetypes/index.ts";
import { classifyV2 } from "../../../common/archetypes/v2/engine.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { player } from "../index.ts";
import {
	archetypeFor,
	archetypeLabelAt,
	classifyPlayer,
	getLeagueNorms,
	initArchetypesForNewLeague,
	ratingsForArchetype,
	readOptionsFor,
	resetArchetypeNorms,
} from "./archetype.ts";
import {
	activeTuning,
	getGlobalFeedback,
	leagueFeedback,
	refitArchetypeTuning,
	resetArchetypeTuning,
	resetGlobalFeedbackMemory,
	saveGlobalFeedback,
	FEEDBACK_KEY,
} from "./archetypeFeedback.ts";
import api from "../../api/archetypes.ts";
import { last } from "../../../common/utils.ts";
import { ARCHETYPE_READING_VERSION } from "../../../common/archetypes/helpers.ts";
import { fromPickFile } from "../../../common/archetypes/tuning.ts";

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
	);
	return players;
};

const someone = async () =>
	(await idb.cache.players.indexGetAll("playersByTid", [0, Infinity]))[0]!;

const pickOther = async (pid: number) => {
	const o = await api.feedbackOptions({ pid });
	assert.ok(o.enabled);
	assert.ok(
		o.suggestions.length >= 6 && o.suggestions.length <= 8,
		`${o.suggestions.length}`,
	);
	assert.ok(o.all.length > o.suggestions.length);
	return { o, id: o.suggestions[0]!.id };
};

describe("archetype feedback", () => {
	beforeEach(async () => {
		resetG();
		delete (g as any)[FEEDBACK_KEY];
		resetArchetypeNorms();
		resetArchetypeTuning();
		await resetGlobalFeedbackMemory();
		idb.league = mockIDBLeague();
		await resetCache({ players: makePlayers() });
		await initArchetypesForNewLeague();
	});

	test("no feedback: the reading is the shipped one", async () => {
		await refitArchetypeTuning();
		assert.strictEqual(activeTuning().hash, "");
		const norms = await getLeagueNorms();
		for (const p of await idb.cache.players.getAll()) {
			const c = classifyPlayer(p, norms);
			const ratings = ratingsForArchetype(p);
			if (!c || !ratings) {
				continue;
			}
			const row = last(p.ratings) as any;
			const plain = classifyV2(ratings, {
				...(p.srID ? { srID: p.srID } : {}),
				norms,
				ovr: row.ovr,
				pos: row.pos,
				...readOptionsFor(p, row.pos, row.season),
			});
			assert.strictEqual(c.id, plain.id);
		}
	});

	test("a pick becomes his label at once, and undo restores the reading", async () => {
		const p = await someone();
		const norms = await getLeagueNorms();
		const before = archetypeFor(p, norms)!.view.id;
		const { id } = await pickOther(p.pid);
		const res = await api.feedbackSubmit({ pid: p.pid, id });
		assert.ok(res.ok, res.message);
		const now = archetypeFor(p, norms)!;
		assert.strictEqual(now.view.id, id);
		assert.ok(now.user);
		assert.strictEqual(
			archetypeLabelAt(p, g.get("season"), norms),
			now.view.label,
		);
		// Stored with a snapshot of the reading
		const lf = leagueFeedback();
		assert.strictEqual(lf.picks.length, 1);
		assert.strictEqual(lf.picks[0]!.shown, before);
		assert.strictEqual(lf.picks[0]!.rows.length, 2);
		assert.ok(lf.picks[0]!.input.ratings);
		// In the league's game attributes (exported with the league)
		const ga = await idb.cache.gameAttributes.get(FEEDBACK_KEY as any);
		assert.ok(ga);
		// A tuning was fitted
		assert.notStrictEqual(activeTuning().hash, "");
		// Undo
		await api.feedbackClear({ pid: p.pid });
		assert.strictEqual(archetypeFor(p, norms)!.view.id, before);
		assert.strictEqual(leagueFeedback().picks.length, 0);
		assert.strictEqual(activeTuning().hash, "");
		// A pick of a build his position rules out is refused
		const bad = (
			await import("../../../common/archetypes/index.ts")
		).ARCHETYPES.find(
			(a) => !a.positions.includes((last(p.ratings) as any).pos),
		)!;
		assert.ok(!(await api.feedbackSubmit({ pid: p.pid, id: bad.id })).ok);
		// "None of these": recorded, label unchanged
		const none = await api.feedbackSubmit({ pid: p.pid, id: null });
		assert.ok(none.ok);
		assert.strictEqual(archetypeFor(p, norms)!.view.id, before);
	});

	test("prospects can be picked too", async () => {
		const p = (
			await idb.cache.players.indexGetAll("playersByTid", PLAYER.UNDRAFTED)
		)[0]!;
		const { id } = await pickOther(p.pid);
		await api.feedbackSubmit({ pid: p.pid, id });
		assert.strictEqual(archetypeFor(p, await getLeagueNorms())!.view.id, id);
	});

	test("reset, export/import round trip", async () => {
		const p = await someone();
		const { id } = await pickOther(p.pid);
		await api.feedbackSubmit({ pid: p.pid, id, better: true });
		// eslint-disable-next-line unicorn/prefer-structured-clone -- (as a file: a JSON round trip)
		const file = JSON.parse(JSON.stringify(await api.tuningExport()));
		assert.strictEqual(file.picks.length, 1);
		const info = await api.tuningInfo();
		assert.strictEqual(info.usedPicks, 1);
		await api.tuningReset();
		assert.strictEqual(leagueFeedback().picks.length, 0);
		assert.strictEqual((await getGlobalFeedback()).picks.length, 0);
		assert.strictEqual(activeTuning().hash, "");
		// (his own pick stays until cleared)
		assert.strictEqual(archetypeFor(p, await getLeagueNorms())!.view.id, id);
		await api.tuningImport({ file });
		assert.strictEqual(leagueFeedback().picks.length, 1);
		assert.deepStrictEqual(leagueFeedback().picks[0], file.picks[0]);
		assert.notStrictEqual(activeTuning().hash, "");
	});

	// archuser2k: "Archetype tuning only" (Export League and the tuning panel)
	test("tuning-only export: picks, overrides, tuning and snapshots round trip", async () => {
		const p = await someone();
		const { id } = await pickOther(p.pid);
		await api.feedbackSubmit({ pid: p.pid, id, better: true });
		g.setWithoutSavingToDB("lid", 7);
		// eslint-disable-next-line unicorn/prefer-structured-clone -- (as a file: a JSON round trip)
		const file = JSON.parse(
			JSON.stringify(await api.tuningExportOnly({ snapshots: true })),
		);
		assert.strictEqual(file.kind, "bbgm-archetype-tuning");
		assert.strictEqual(file.readingVersion, ARCHETYPE_READING_VERSION);
		assert.strictEqual(file.tuningHash, activeTuning().hash);
		assert.notStrictEqual(file.tuningHash, "");
		assert.strictEqual(file.picks.league.length, 1);
		assert.strictEqual(file.picks.global.length, 1);
		assert.strictEqual(file.overrides[String(p.pid)].id, id);
		const uid = file.picks.league[0].uid;
		assert.ok(file.snapshots[uid].ratings, "the reading inputs, by pick");
		assert.strictEqual(file.picks.league[0].input, undefined);
		// (the developer refit reads it as a pick file)
		assert.strictEqual(
			fromPickFile(file)[0]!.input.ratings.hgt,
			file.snapshots[uid].ratings.hgt,
		);
		// Without snapshots: smaller, and the in-game tuning still refits from the rows
		const lean = await api.tuningExportOnly({ snapshots: false });
		assert.strictEqual(lean.snapshots, undefined);
		// Forget everything, then import it back into the same league
		const pickBefore = leagueFeedback().picks[0];
		await api.tuningReset();
		await api.feedbackClear({ pid: p.pid });
		assert.strictEqual(leagueFeedback().picks.length, 0);
		assert.strictEqual(activeTuning().hash, "");
		const res = await api.tuningImport({ file });
		assert.strictEqual(res.overrides, 1);
		// eslint-disable-next-line unicorn/prefer-structured-clone -- (undefined fields do not survive a file)
		const asFile = (x: unknown) => JSON.parse(JSON.stringify(x));
		assert.deepStrictEqual(
			asFile(leagueFeedback().picks[0]),
			asFile(pickBefore),
		);
		assert.strictEqual(leagueFeedback().overrides[String(p.pid)]!.id, id);
		assert.strictEqual(activeTuning().hash, file.tuningHash);
		assert.strictEqual(archetypeFor(p, await getLeagueNorms())!.view.id, id);
		// Another league: the picks come along, the per-player overrides do not
		await api.tuningReset();
		await api.feedbackClear({ pid: p.pid });
		g.setWithoutSavingToDB("lid", 8);
		const res2 = await api.tuningImport({ file });
		assert.strictEqual(res2.overrides, 0);
		assert.strictEqual(leagueFeedback().picks.length, 1);
		assert.strictEqual(activeTuning().hash, file.tuningHash);
	});

	test("cross-league toggle: browser-wide picks apply only while it is on", async () => {
		const p = await someone();
		const { id } = await pickOther(p.pid);
		await api.feedbackSubmit({ pid: p.pid, id });
		const fromOtherLeague = leagueFeedback().picks.map((x) => ({
			...x,
			uid: `other-${x.uid}`,
		}));
		// A new league: no picks of its own
		g.setWithoutSavingToDB(FEEDBACK_KEY as any, { picks: [], overrides: {} });
		await saveGlobalFeedback({ enabled: true, picks: fromOtherLeague });
		await refitArchetypeTuning();
		assert.notStrictEqual(
			activeTuning().hash,
			"",
			"on: the user's picks follow him",
		);
		await api.setCrossLeague({ enabled: false });
		assert.strictEqual(activeTuning().hash, "", "off: only this league's");
		assert.strictEqual((await getGlobalFeedback()).enabled, false);
		await api.setCrossLeague({ enabled: true });
		assert.notStrictEqual(activeTuning().hash, "");
		// (default on)
		await resetGlobalFeedbackMemory();
		assert.ok((await getGlobalFeedback()).enabled);
		void archetypeById;
	});
});
