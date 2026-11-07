import { assert, beforeEach, describe, test } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import {
	DEFAULT_SETTINGS,
	RATING_KEYS,
} from "../../../common/ratingsBuilds/index.ts";
import type { PlayerRatings } from "../../../common/types.basketball.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { draft } from "../index.ts";
import ovr from "../player/ovr.ts";
import pos from "../player/pos.ts";
import skills from "../player/skills.ts";
import {
	applyRegenerate,
	getProspects,
	previewRegenerate,
	restoreOriginalRatings,
	undoRegenerate,
} from "./regenerateRatings.ts";

const settings = (extra: Record<string, any> = {}) => ({
	...DEFAULT_SETTINGS,
	seed: "worker-test",
	...extra,
});

const getClass = async () => {
	const players = await getProspects(g.get("season"));
	return players.sort((a, b) => a.pid - b.pid);
};

const ratingsOf = (r: PlayerRatings) => {
	const out: Record<string, number> = {};
	for (const key of RATING_KEYS) {
		out[key] = r[key];
	}
	return out;
};

describe("regenerate ratings (worker)", () => {
	beforeEach(async () => {
		resetG();
		await resetCache({});
		idb.league = mockIDBLeague();
		await draft.genPlayers(g.get("season"), DEFAULT_LEVEL);
	});

	test("preview reports every overall unchanged and writes nothing", async () => {
		const before = helpers.deepCopy(await getClass());
		const preview = await previewRegenerate({
			draftYear: g.get("season"),
			settings: settings(),
			locks: {},
			pids: null,
		});
		assert.strictEqual(preview.rows.length, 70);
		assert.strictEqual(preview.numOvrChanged, 0);
		assert.ok(preview.numChanged > 40);
		for (const row of preview.rows) {
			assert.ok(row.ovrUnchanged);
			assert.ok(row.potUnchanged);
		}
		assert.deepStrictEqual(await getClass(), before);
	});

	test("applying leaves ovr, pot and height unchanged and keeps everything consistent", async () => {
		const before = helpers.deepCopy(await getClass());
		await applyRegenerate({
			draftYear: g.get("season"),
			settings: settings(),
			locks: {},
			pids: null,
		});
		const after = await getClass();
		assert.strictEqual(after.length, 70);

		let changed = 0;
		for (const [i, p] of after.entries()) {
			const b = before[i]!;
			const rb = last(b.ratings) as PlayerRatings;
			const ra = last(p.ratings) as PlayerRatings;

			assert.strictEqual(ra.ovr, rb.ovr, "ovr");
			assert.strictEqual(ra.pot, rb.pot, "pot");
			assert.strictEqual(ra.hgt, rb.hgt, "hgt rating");
			assert.strictEqual(p.hgt, b.hgt, "listed height");
			assert.strictEqual(ra.fuzz, rb.fuzz, "fuzz kept");
			assert.strictEqual(ra.season, rb.season);

			// Consistent with the game's own functions
			assert.strictEqual(ovr(ra), ra.ovr);
			assert.strictEqual(pos(ra), ra.pos);
			assert.deepStrictEqual(skills(ra), ra.skills);

			// Draft-time copies and values follow
			assert.strictEqual(p.draft.ovr, ra.ovr);
			assert.strictEqual(p.draft.pot, ra.pot);
			assert.deepStrictEqual(p.draft.skills, ra.skills);
			assert.ok(Number.isFinite(p.value) && Number.isFinite(p.valueFuzz));
			assert.strictEqual(p.tid, PLAYER.UNDRAFTED);

			assert.ok(p.ratingsBuild);
			assert.deepStrictEqual(p.ratingsBuild.base, ratingsOf(rb));
			assert.deepStrictEqual(p.ratingsBuild.applied, ratingsOf(ra));

			if (JSON.stringify(ratingsOf(ra)) !== JSON.stringify(ratingsOf(rb))) {
				changed++;
			}
		}
		assert.ok(changed > 40, `only ${changed} changed`);
	});

	test("same seed and settings give the same class", async () => {
		const players = await getClass();
		const p1 = await previewRegenerate({
			draftYear: g.get("season"),
			settings: settings(),
			locks: {},
			pids: null,
		});
		const p2 = await previewRegenerate({
			draftYear: g.get("season"),
			settings: settings(),
			locks: {},
			pids: null,
		});
		assert.deepStrictEqual(p1, p2);
		assert.strictEqual(players.length, 70);
	});

	test("regenerating twice starts from the original, so it never compounds", async () => {
		const season = g.get("season");
		const original = helpers.deepCopy(await getClass());

		await applyRegenerate({
			draftYear: season,
			settings: settings({ seed: "A" }),
			locks: {},
			pids: null,
		});
		await applyRegenerate({
			draftYear: season,
			settings: settings({ seed: "B" }),
			locks: {},
			pids: null,
		});
		const twice = helpers.deepCopy(await getClass());

		// Put the originals back and apply B once
		await resetCache({});
		for (const p of original) {
			await idb.cache.players.put(helpers.deepCopy(p));
		}
		await applyRegenerate({
			draftYear: season,
			settings: settings({ seed: "B" }),
			locks: {},
			pids: null,
		});
		const once = await getClass();

		for (const [i, p] of once.entries()) {
			assert.deepStrictEqual(
				ratingsOf(last(p.ratings) as PlayerRatings),
				ratingsOf(last(twice[i]!.ratings) as PlayerRatings),
			);
			assert.strictEqual(p.ratingsBuild?.name, twice[i]!.ratingsBuild?.name);
		}
	});

	test("only selected prospects change, locked ones are skipped, drafted players are never touched", async () => {
		const season = g.get("season");
		const before = helpers.deepCopy(await getClass());
		const [a, b, c, d] = before;

		// d is already drafted
		const drafted = await idb.cache.players.get(d!.pid);
		drafted!.tid = 0;
		await idb.cache.players.put(drafted!);
		const draftedBefore = helpers.deepCopy(drafted!);

		const res = await applyRegenerate({
			draftYear: season,
			settings: settings(),
			locks: { [b!.pid]: { skip: true } },
			pids: [a!.pid, b!.pid, d!.pid],
		});
		assert.strictEqual(res.applied, 1);

		const get = async (pid: number) => (await idb.cache.players.get(pid))!;
		assert.ok((await get(a!.pid)).ratingsBuild);
		assert.deepStrictEqual(await get(b!.pid), b);
		assert.deepStrictEqual(await get(c!.pid), c);
		assert.deepStrictEqual(await get(d!.pid), draftedBefore);
	});

	test("locks: a locked build and pinned ratings are respected through the worker", async () => {
		const season = g.get("season");
		const [a, b] = await getClass();
		const ra = { ...(last(a!.ratings) as PlayerRatings) };
		await applyRegenerate({
			draftYear: season,
			settings: settings(),
			locks: {
				[a!.pid]: { build: "Stretch Big", pinKeys: ["tp", "ft"] },
			},
			pids: [a!.pid],
		});
		const pa = (await idb.cache.players.get(a!.pid))!;
		assert.strictEqual(pa.ratingsBuild?.name, "Stretch Big");
		assert.strictEqual((last(pa.ratings) as PlayerRatings).tp, ra.tp);
		assert.strictEqual((last(pa.ratings) as PlayerRatings).ft, ra.ft);
		assert.strictEqual((last(pa.ratings) as PlayerRatings).ovr, ra.ovr);
		assert.strictEqual(
			(await idb.cache.players.get(b!.pid))!.ratingsBuild,
			undefined,
		);
	});

	test("relative ovr and pot locks", async () => {
		const season = g.get("season");
		const players = await getClass();
		const target = players.find(
			(p) => (last(p.ratings) as PlayerRatings).ovr > 30,
		)!;
		const rt = { ...(last(target.ratings) as PlayerRatings) };
		await applyRegenerate({
			draftYear: season,
			settings: settings(),
			locks: { [target.pid]: { ovrDelta: -4, potDelta: 3 } },
			pids: [target.pid],
		});
		const after = last(
			(await idb.cache.players.get(target.pid))!.ratings,
		) as PlayerRatings;
		assert.strictEqual(after.ovr, rt.ovr - 4);
		assert.strictEqual(ovr(after), rt.ovr - 4);
		assert.strictEqual(after.pot, rt.pot + 3);
	});

	test("undo restores the last apply exactly", async () => {
		const season = g.get("season");
		const before = helpers.deepCopy(await getClass());
		await applyRegenerate({
			draftYear: season,
			settings: settings(),
			locks: {},
			pids: null,
		});
		const mid = await getClass();
		assert.notDeepEqual(mid, before);
		const res = await undoRegenerate();
		assert.strictEqual(res.restored, 70);
		assert.deepStrictEqual(await getClass(), before);
		assert.strictEqual((await undoRegenerate()).restored, 0);
	});

	test("restore originals works after the undo stack is gone", async () => {
		const season = g.get("season");
		const before = helpers.deepCopy(await getClass());
		await applyRegenerate({
			draftYear: season,
			settings: settings(),
			locks: {},
			pids: null,
		});
		await undoRegenerate();
		await applyRegenerate({
			draftYear: season,
			settings: settings({ fuzz: "zero", pot: "estimate" }),
			locks: {},
			pids: null,
		});
		const res = await restoreOriginalRatings({ draftYear: season, pids: null });
		assert.strictEqual(res.restored, 70);
		for (const [i, p] of (await getClass()).entries()) {
			const b = before[i]!;
			assert.deepStrictEqual(
				ratingsOf(last(p.ratings) as PlayerRatings),
				ratingsOf(last(b.ratings) as PlayerRatings),
			);
			assert.strictEqual(
				(last(p.ratings) as PlayerRatings).fuzz,
				(last(b.ratings) as PlayerRatings).fuzz,
			);
			assert.strictEqual(
				(last(p.ratings) as PlayerRatings).ovr,
				(last(b.ratings) as PlayerRatings).ovr,
			);
			assert.strictEqual(p.ratingsBuild, undefined);
			assert.strictEqual(p.hgt, b.hgt);
		}
	});

	test("fuzz and pot modes", async () => {
		const season = g.get("season");
		await applyRegenerate({
			draftYear: season,
			settings: settings({ fuzz: "zero" }),
			locks: {},
			pids: null,
		});
		for (const p of await getClass()) {
			assert.strictEqual((last(p.ratings) as PlayerRatings).fuzz, 0);
		}
		await applyRegenerate({
			draftYear: season,
			settings: settings({ fuzz: "regenerate", pot: "estimate" }),
			locks: {},
			pids: null,
		});
		let nonZero = 0;
		for (const p of await getClass()) {
			const r = last(p.ratings) as PlayerRatings;
			if (r.fuzz !== 0) {
				nonZero++;
			}
			assert.ok(r.pot >= r.ovr && r.pot <= 100);
			assert.strictEqual(p.draft.pot, r.pot);
		}
		assert.ok(nonZero > 50);
	});
});
