import { assert, describe, test } from "vitest";
import {
	applyBaseEditToSubs,
	applySubEdit,
	baseFromSubs,
	fitGroup,
	flatSubs,
	NUM_SUBS,
	refitSubs,
	SUB_BASES,
	SUB_DEFS,
	SUB_GROUPS,
	SUB_INDEX,
	subOffsets,
	subsMatchBases,
} from "./subRatings.ts";
import {
	developSubs,
	generateSubShape,
	neutralSubShape,
	syncRowSubs,
} from "./subRatingsGen.ts";
import { Rng } from "./ratingsBuilds/rng.ts";

const randomRow = (rng: Rng, expanded = false) => {
	const r: Record<string, any> = {
		season: 2025,
		hgt: rng.int(0, 100),
		stre: rng.int(10, 90),
		spd: rng.int(10, 90),
		jmp: rng.int(10, 90),
		endu: rng.int(10, 90),
		ins: rng.int(10, 90),
		dnk: rng.int(10, 90),
		ft: rng.int(10, 90),
		fg: rng.int(10, 90),
		tp: rng.int(0, 100),
		oiq: rng.int(10, 90),
		diq: rng.int(0, 100),
		drb: rng.int(10, 90),
		pss: rng.int(10, 90),
		reb: rng.int(10, 90),
	};
	if (expanded) {
		r.wng = Math.min(100, Math.max(0, r.hgt + rng.int(-10, 10)));
		const half = rng.int(-8, 8);
		r.pdef = Math.min(100, Math.max(0, r.diq + half));
		r.idef = Math.min(100, Math.max(0, 2 * r.diq - r.pdef));
		r.diq = Math.round((r.pdef + r.idef) / 2);
		const rh = rng.int(-6, 6);
		r.oreb = Math.min(100, Math.max(0, r.reb + rh));
		r.dreb = Math.min(100, Math.max(0, 2 * r.reb - r.oreb));
		r.reb = Math.round((r.oreb + r.dreb) / 2);
		const sum = r.fg + r.tp;
		r.csh = Math.min(100, Math.round(sum / 2) + rng.int(-6, 6));
		r.dsh = sum - r.csh;
		r.bsc = rng.int(10, 90);
	}
	return r;
};

describe("sub-ratings data model", () => {
	test("weights of each base sum to 100, every sub belongs to one base", () => {
		assert.strictEqual(SUB_DEFS.length, NUM_SUBS);
		assert.strictEqual(NUM_SUBS, 25);
		let n = 0;
		for (const g of SUB_GROUPS) {
			assert.strictEqual(
				g.w.reduce((a, b) => a + b, 0),
				100,
			);
			assert.isAtLeast(g.idx.length, 2);
			assert.isAtMost(g.idx.length, 4);
			n += g.idx.length;
		}
		assert.strictEqual(n, NUM_SUBS);
	});

	test("fitGroup always reproduces the target within bounds", () => {
		const rng = new Rng("fit");
		for (let k = 0; k < 5000; k++) {
			const g = SUB_GROUPS[rng.int(0, SUB_GROUPS.length - 1)]!;
			const x = g.idx.map(() => rng.uniform(-30, 130));
			const target = rng.int(0, 100);
			const flex = g.idx.map(() => rng.uniform(0, 2));
			const out = fitGroup(x, g.w, target, flex);
			const sub = new Array<number>(NUM_SUBS).fill(0);
			g.idx.forEach((i, j) => {
				sub[i] = out[j]!;
			});
			assert.strictEqual(baseFromSubs(sub, g.base), target);
			for (const v of out) {
				assert.isTrue(Number.isInteger(v) && v >= 0 && v <= 100);
			}
		}
	});

	test("refit keeps the shape when a base moves", () => {
		const rng = new Rng("refit");
		const r = randomRow(rng);
		r.tp = 50;
		const sub = flatSubs(r);
		const i = SUB_INDEX.rng!;
		const j = SUB_INDEX.tod!;
		sub[i] = 60;
		sub[j] = 38;
		const fixed = refitSubs(sub, r);
		const before = subOffsets(fixed, r);
		r.tp = 56;
		const moved = refitSubs(fixed, r);
		assert.isTrue(subsMatchBases({ ...r, sub: moved }));
		const after = subOffsets(moved, r);
		for (const k of [i, j, SUB_INDEX.tcs!]) {
			assert.isAtMost(Math.abs(after[k]! - before[k]!), 1);
		}
		// Never mutates
		assert.notStrictEqual(moved, fixed);
	});

	test("customize player: a sub edit moves its base, a base edit moves its subs", () => {
		const rng = new Rng("edit");
		const r = randomRow(rng, true);
		r.sub = generateSubShape(r, 1).sub;
		const edited = applySubEdit(r, SUB_INDEX.stl!, 99);
		assert.strictEqual(edited.sub[SUB_INDEX.stl!], 99);
		assert.isTrue(subsMatchBases(edited));
		assert.strictEqual(edited.diq, Math.round((edited.pdef + edited.idef) / 2));
		const reb = applySubEdit(r, SUB_INDEX.orb!, 80);
		assert.strictEqual(reb.oreb, 80);
		assert.strictEqual(reb.reb, Math.round((reb.oreb + reb.dreb) / 2));
		const typing = applySubEdit(r, SUB_INDEX.blk!, "");
		assert.strictEqual(typing.diq, r.diq);
		const base = applyBaseEditToSubs({ ...r, tp: 77 }, "tp");
		assert.isTrue(subsMatchBases(base));
	});
});

describe("sub-ratings generation and development", () => {
	test("generated and neutral shapes reproduce every base, deterministically", () => {
		const rng = new Rng("gen");
		for (let k = 0; k < 400; k++) {
			const r = randomRow(rng, k % 2 === 0);
			const a = generateSubShape(r, k, { background: "oneAndDone" });
			const b = generateSubShape(r, k, { background: "oneAndDone" });
			assert.deepEqual(a, b);
			assert.isTrue(subsMatchBases({ ...r, sub: a.sub }));
			const n = neutralSubShape(r, k);
			assert.isTrue(subsMatchBases({ ...r, sub: n.sub }));
			// Expanded ratings: the rebounding subs are oreb/dreb, ball security bsc (unless the fit had to move it)
			if (typeof r.oreb === "number") {
				assert.strictEqual(a.sub[SUB_INDEX.orb!], r.oreb);
				assert.strictEqual(a.sub[SUB_INDEX.drd!], r.dreb);
			}
		}
	});

	test("syncing is idempotent", () => {
		const rng = new Rng("sync");
		for (let k = 0; k < 300; k++) {
			const r = randomRow(rng, k % 2 === 0);
			r.sub = generateSubShape(r, k).sub;
			syncRowSubs(r);
			const once = [...r.sub];
			assert.isFalse(syncRowSubs(r));
			assert.deepEqual(r.sub, once);
		}
	});

	test("development spreads a base change over the subs, keeps bases, fades blocks and vertical with age", () => {
		const rng = new Rng("dev");
		let fadeDrop = 0;
		let holdDrop = 0;
		for (let k = 0; k < 300; k++) {
			const r = randomRow(rng);
			for (const b of SUB_BASES) {
				r[b] = 60;
			}
			const { sub, info } = generateSubShape(r, k);
			info.g = 0;
			let s = sub;
			for (let age = 30; age <= 35; age++) {
				const before = SUB_BASES.map((b) => r[b]);
				for (const b of SUB_BASES) {
					r[b] -= 2;
				}
				r.season += 1;
				s = developSubs(s, r, before, age, info);
				assert.isTrue(subsMatchBases({ ...r, sub: s }));
			}
			const off0 = subOffsets(sub, {
				...r,
				...Object.fromEntries(SUB_BASES.map((b) => [b, 60])),
			});
			const off1 = subOffsets(s, r);
			fadeDrop += off0[SUB_INDEX.blk!]! - off1[SUB_INDEX.blk!]!;
			fadeDrop += off0[SUB_INDEX.mxv!]! - off1[SUB_INDEX.mxv!]!;
			holdDrop += off0[SUB_INDEX.idf!]! - off1[SUB_INDEX.idf!]!;
			holdDrop += off0[SUB_INDEX.stj!]! - off1[SUB_INDEX.stj!]!;
		}
		// Relative to their base, blocks and max vertical end up lower than interior D and standing reach
		assert.isAbove(fadeDrop / 600, holdDrop / 600 + 2);
	});
});
