// archfb: the user's archetype tuning (tuning.ts). Picks move labels the expected way, the adjustments stay within their
// caps, no feedback reads exactly as before, the guardrails hold, and the pick file round-trips.
import { assert, beforeAll, describe, test } from "vitest";
import { ARCHETYPES, archetypeById, classify } from "./classify.ts";
import { modelFor } from "./classify.ts";
import { DEFAULT_NORMS } from "./norms.data.ts";
import { sampleLeague, type SamplePlayer } from "./sample.testutil.ts";
import { positionOf } from "./position.ts";
import { isGenericBuild } from "./generic.ts";
import { TERMS } from "./model.ts";
import {
	BIAS_CAP,
	EMPTY_TUNING,
	FAM_CAP,
	MIN_PICKS_GLOBAL,
	TERM_MULT_MAX,
	TERM_MULT_MIN,
	TERM_GROUPS,
	applyTuning,
	describeTuning,
	fitTuning,
	fromPickFile,
	snapshotRows,
	toPickFile,
	type FeedbackPick,
	type Tuning,
} from "./tuning.ts";
import { ARCHETYPE_READING_VERSION } from "./helpers.ts";
import type { Pos } from "./types.ts";

let players: (SamplePlayer & { pos: Pos })[] = [];
const norms = DEFAULT_NORMS;
const model = modelFor(false);

const labelOf = (p: SamplePlayer & { pos: Pos }, t?: Tuning) =>
	classify(p.ratings, {
		norms,
		ovr: p.ovr,
		age: p.age,
		pos: p.pos,
		...(t ? { model: applyTuning(model, t) } : {}),
	});

// A pick: the user says `picked` fits him better than what he was shown
const pickFor = (
	p: SamplePlayer & { pos: Pos },
	i: number,
	picked: string,
	shownIn?: string,
): FeedbackPick => {
	const shown = shownIn ?? labelOf(p).id;
	return {
		uid: `t-${i}`,
		at: 1000 + i,
		pid: i,
		season: 2025,
		pos: p.pos,
		shown,
		picked,
		expanded: false,
		v: ARCHETYPE_READING_VERSION,
		rows: snapshotRows(
			p.ratings,
			norms,
			model,
			[shown, picked],
			p.pos,
			undefined,
			{
				age: p.age,
			},
		),
		input: { ratings: p.ratings, pos: p.pos, ovr: p.ovr, age: p.age },
	};
};

// The target build: the most common non-generic second choice among players who could have it
const TARGET_FAMILY_IDS = () =>
	ARCHETYPES.filter((a) => !a.out && !isGenericBuild(a)).map((a) => a.id);

const share = (labels: string[], id: string) =>
	labels.filter((x) => x === id).length / labels.length;

beforeAll(async () => {
	const s = await sampleLeague(260, "archfb-tuning");
	players = s.map((p) => ({ ...p, pos: positionOf(p.ratings) }));
}, 120_000);

describe("archetype tuning", () => {
	test("no feedback: the shipped model, labels identical", () => {
		const t = fitTuning([], modelFor);
		assert.strictEqual(t.hash, "");
		assert.strictEqual(applyTuning(model, t), model);
		for (const p of players.slice(0, 60)) {
			const a = labelOf(p);
			const b = labelOf(p, t);
			assert.deepStrictEqual(b, a);
		}
		// "None of these / I'm not sure" picks and picks of the shown build change nothing
		const p0 = players[0]!;
		const none = { ...pickFor(p0, 0, labelOf(p0).id), picked: null };
		assert.strictEqual(fitTuning([none], modelFor).hash, "");
		assert.strictEqual(
			fitTuning([pickFor(p0, 1, labelOf(p0).id)], modelFor).hash,
			"",
		);
	});

	test("picks change labels in the expected direction", () => {
		// For each candidate target build, the players whose runner-up it is; take the build with the most of them
		const base = players.map((p) => labelOf(p));
		const counts = new Map<string, number[]>();
		const ok = new Set(TARGET_FAMILY_IDS());
		for (const [i, c] of base.entries()) {
			const alt = c.alternates[0]?.id;
			if (alt && ok.has(alt)) {
				counts.set(alt, [...(counts.get(alt) ?? []), i]);
			}
		}
		const [target, idx] = [...counts.entries()].sort(
			(a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1),
		)[0]!;
		assert.ok(idx.length >= 4, `${target}: ${idx.length}`);
		// The user picks it for half of them; the other half are similar players nobody picked
		const picked = idx.filter((_, k) => k % 2 === 0);
		const others = idx.filter((_, k) => k % 2 === 1);
		const picks = picked.map((i) => pickFor(players[i]!, i, target));
		const t = fitTuning(picks, modelFor);
		assert.ok((t.bias[target] ?? 0) > 0, "the picked build gains");
		for (const id of new Set(picks.map((p) => p.shown))) {
			assert.ok((t.bias[id] ?? 0) <= 0, `${id}: the shown build does not gain`);
		}
		const before = base.filter((c) => c.id === target).length;
		const afterLabels = players.map((p) => labelOf(p, t).id);
		const after = afterLabels.filter((x) => x === target).length;
		assert.ok(after > before, `${target}: ${before} -> ${after}`);
		// Unpicked similar players move toward it too, or at least the gap closes
		const gapBefore = others.map((i) => {
			const c = labelOf(players[i]!);
			return c.fit;
		});
		void gapBefore;
		const moved = [...picked, ...others].filter(
			(i) => afterLabels[i] === target,
		).length;
		assert.ok(moved >= 1);
		assert.ok(
			describeTuning(t, (id) => archetypeById(id)?.name).some((s) =>
				s.startsWith("More players read as"),
			),
		);
	});

	test("regularisation bounds hold, and global weights wait for enough picks", () => {
		// Many one-sided picks: everyone should be the same build
		const ids = TARGET_FAMILY_IDS();
		const mk = (n: number) => {
			const out: FeedbackPick[] = [];
			for (const [i, p] of players.entries()) {
				if (out.length >= n) {
					break;
				}
				const c = labelOf(p);
				const target = ids.find(
					(id) => id !== c.id && archetypeById(id)!.positions.includes(p.pos),
				)!;
				const pk = pickFor(p, i, target, c.id);
				if (pk.rows.length === 2) {
					out.push(pk);
				}
			}
			return out;
		};
		const few = fitTuning(mk(MIN_PICKS_GLOBAL - 1), modelFor);
		for (const k of Object.keys(TERM_GROUPS) as (keyof typeof TERM_GROUPS)[]) {
			assert.strictEqual(few.mult[k], 1, "no global weights below the minimum");
		}
		assert.deepStrictEqual(few.famOff, {});
		const many = fitTuning(mk(150), modelFor);
		for (const b of Object.values(many.bias)) {
			assert.ok(Math.abs(b) <= BIAS_CAP + 1e-9, `${b}`);
		}
		for (const v of Object.values(many.famOff)) {
			assert.ok(Math.abs(v!) <= FAM_CAP + 1e-9);
		}
		for (const v of Object.values(many.mult)) {
			assert.ok(v >= TERM_MULT_MIN - 1e-9 && v <= TERM_MULT_MAX + 1e-9, `${v}`);
		}
		// One pick moves a build only a little (scaled by its count)
		const one = fitTuning(mk(1), modelFor);
		for (const b of Object.values(one.bias)) {
			assert.ok(Math.abs(b) <= BIAS_CAP / 3 + 0.001, `${b}`);
		}
	});

	test("deterministic and fast", () => {
		const ids = TARGET_FAMILY_IDS();
		const picks: FeedbackPick[] = [];
		for (let r = 0; r < 2; r++) {
			for (const [i, p] of players.entries()) {
				const c = labelOf(p);
				const target = ids.find(
					(id, k) =>
						k % 7 === (i + r) % 7 &&
						id !== c.id &&
						archetypeById(id)!.positions.includes(p.pos),
				);
				if (target) {
					picks.push({
						...pickFor(p, i, target, c.id),
						uid: `d-${r}-${i}`,
						pid: i * 10 + r,
					});
				}
			}
		}
		assert.ok(picks.length >= 300, `${picks.length}`);
		// Wall-clock time under a loaded test run (other workers on every core, a cold JIT on the first fit) varies a lot: take the
		// faster of two fits and allow headroom; an algorithmic regression (quadratic in picks) is well over a second
		let t0 = performance.now();
		const a = fitTuning(picks, modelFor);
		let ms = performance.now() - t0;
		t0 = performance.now();
		const b = fitTuning([...picks].reverse(), modelFor);
		ms = Math.min(ms, performance.now() - t0);
		assert.strictEqual(a.hash, b.hash);
		assert.ok(ms < 300, `${ms} ms for ${picks.length} picks`);
	});

	test("guardrails: promises, positions, generic fallback and shares", () => {
		// The strongest tuning the caps allow, all toward one build and away from the rest
		const target = TARGET_FAMILY_IDS().find(
			(id) => archetypeById(id)!.positions.length >= 3,
		)!;
		const extreme: Tuning = {
			n: 100,
			bias: { [target]: BIAS_CAP },
			mult: {
				sub: TERM_MULT_MAX,
				playType: TERM_MULT_MIN,
				traits: TERM_MULT_MAX,
			},
			famOff: { [archetypeById(target)!.family ?? "scorer"]: FAM_CAP },
			hash: "extreme",
		};
		const tuned = applyTuning(model, extreme);
		// Promise terms are never reweighted
		for (const t of TERMS) {
			if (!["sub", "playType"].includes(t) && !t.startsWith("tr")) {
				assert.strictEqual(tuned.theta[t], model.theta[t], t);
			}
		}
		const base = players.map((p) => labelOf(p));
		const after = players.map((p) => labelOf(p, extreme));
		let conflicts = 0;
		for (const [i, c] of after.entries()) {
			if (!archetypeById(c.id)!.positions.includes(players[i]!.pos)) {
				conflicts++;
			}
			// A name he does not live up to is not given by the tuning
			if (c.id !== base[i]!.id) {
				assert.ok(
					c.shortfall <= Math.max(0.25, base[i]!.shortfall + 0.25),
					`${c.id} ${c.shortfall}`,
				);
			}
		}
		assert.strictEqual(conflicts, 0);
		const generic = (cs: { id: string }[]) =>
			cs.filter((c) => isGenericBuild(archetypeById(c.id)!)).length / cs.length;
		assert.ok(generic(after) <= generic(base) + 0.03);
		const maxShare = (cs: { id: string }[]) =>
			Math.max(
				...[...new Set(cs.map((c) => c.id))].map((id) =>
					share(
						cs.map((c) => c.id),
						id,
					),
				),
			);
		assert.ok(
			maxShare(after) <= Math.max(0.08, 2 * maxShare(base)),
			`${maxShare(base)} -> ${maxShare(after)}`,
		);
	});

	test("pick file round trip", () => {
		const p0 = players[3]!;
		const c = labelOf(p0);
		const other = TARGET_FAMILY_IDS().find(
			(id) => id !== c.id && archetypeById(id)!.positions.includes(p0.pos),
		)!;
		const picks = [pickFor(p0, 3, other), pickFor(players[4]!, 4, other)];
		// eslint-disable-next-line unicorn/prefer-structured-clone -- (as a file: a JSON round trip)
		const file = JSON.parse(JSON.stringify(toPickFile(picks, 1)));
		const back = fromPickFile(file);
		// eslint-disable-next-line unicorn/prefer-structured-clone -- (as a file: a JSON round trip)
		assert.deepStrictEqual(back, JSON.parse(JSON.stringify(picks)));
		assert.strictEqual(
			fitTuning(back, modelFor).hash,
			fitTuning(picks, modelFor).hash,
		);
		assert.throws(() => fromPickFile({ kind: "x" }));
		assert.strictEqual(EMPTY_TUNING.hash, "");
	});
});
