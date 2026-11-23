import { assert, test } from "vitest";
import {
	MAX_SHIFT,
	ROTATION,
	nextTalentCenter,
	rotationMeans,
	shiftRatingsForSim,
	talentShift,
} from "./talentCenter.ts";
import { SUB_DEFS } from "../../../common/subRatings.ts";

const row = (ovr: number, tp: number) => ({ ovr, tp, oiq: 50, hgt: 60 });

test("rotationMeans averages each team's top players by ovr, and only rostered players", () => {
	const players = [
		// Team 0: ROTATION players at tp 60 and a bench player at tp 0 (left out)
		...Array.from({ length: ROTATION }, () => ({
			tid: 0,
			ratings: [row(60, 60)],
		})),
		{ tid: 0, ratings: [row(40, 0)] },
		// Team 1: one player
		{ tid: 1, ratings: [row(55, 30)] },
		// A free agent (left out)
		{ tid: -1, ratings: [row(70, 100)] },
	];
	const m = rotationMeans(players as any);
	assert.closeTo(m.tp!, (ROTATION * 60 + 30) / (ROTATION + 1), 1e-3);
	assert.strictEqual(m.oiq, 50);
	assert.strictEqual(m.hgt, 60);
});

test("the first record anchors the league; the shift is anchor - now, bounded, and only for the record's season", () => {
	const c1 = nextTalentCenter(undefined, 2025, { tp: 50, oiq: 50 });
	assert.deepEqual(c1.ref, { tp: 50, oiq: 50 });
	assert.isUndefined(talentShift(c1, 2025));
	const c2 = nextTalentCenter(c1, 2040, { tp: 53, oiq: 70, wng: 40 });
	// The anchor stays; a rating seen for the first time is anchored then
	assert.deepEqual(c2.ref, { tp: 50, oiq: 50, wng: 40 });
	const shift = talentShift(c2, 2040)!;
	assert.closeTo(shift.tp!, -3, 1e-9);
	assert.strictEqual(shift.oiq, -MAX_SHIFT);
	assert.isUndefined(shift.wng);
	// A stale record (another season) shifts nothing
	assert.isUndefined(talentShift(c2, 2041));
});

test("shiftRatingsForSim shifts the ratings and their sub-ratings, within 0-100, and leaves the row alone", () => {
	const sub = SUB_DEFS.map(() => 99);
	const r = { tp: 98, oiq: 40, hgt: 50, ovr: 60, sub };
	const out = shiftRatingsForSim(r, { tp: 5, diq: -2 });
	assert.strictEqual(out.tp, 100);
	assert.strictEqual(out.oiq, 40);
	assert.strictEqual(out.ovr, 60);
	assert.strictEqual(r.tp, 98);
	for (const [i, def] of SUB_DEFS.entries()) {
		const want = def.base === "tp" ? 100 : def.base === "diq" ? 97 : 99;
		assert.strictEqual(out.sub[i], want, def.key);
	}
	assert.strictEqual(shiftRatingsForSim(r, undefined), r);
});
