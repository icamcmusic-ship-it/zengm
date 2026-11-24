import { generate, type FaceConfig } from "facesjs";
import { beforeEach, describe, expect, test } from "vitest";
import { PLAYER } from "../../common/constants.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { resetG } from "../../test/helpers.ts";
import {
	ageFaceForSeason,
	extractAgingFields,
	faceForSeason,
	SPARSE_FATNESS,
} from "../../common/faceAging.ts";
import { textureOf } from "../../common/faceEvents.ts";
import {
	agePlayerFace,
	faceAgingOnCustomize,
	freshFaceAging,
} from "./faceAging.ts";
import g from "./g.ts";

const makeFace = (seed: number): FaceConfig => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		return generate(undefined, { gender: "male" });
	} finally {
		Math.random = original;
	}
};

const makePlayer = (face: FaceConfig, age = 30) => ({
	pid: 7 as number | undefined,
	born: { year: g.get("season") - age, loc: "" },
	face,
	imgURL: "",
	stats: [] as any[],
	weight: 220,
	tid: PLAYER.FREE_AGENT,
	faceAging: undefined as any,
});

beforeEach(() => {
	resetG();
});

describe("faceAgingOnCustomize", () => {
	test("a new player's generated face isn't locked, and is aged on save", () => {
		const p = makePlayer(makeFace(1));
		p.pid = undefined;
		p.faceAging = freshFaceAging(p.face);
		const age = faceAgingOnCustomize(p as any, undefined, g.get("season"));
		expect(age).toBe(true);
		expect(p.faceAging.e).toBeUndefined();
		expect(p.faceAging.h).toEqual({});

		// Then aged to his age, with no lock
		p.pid = 7;
		expect(agePlayerFace(p as any, g.get("season"))).toBe(true);
		expect(p.faceAging.e).toBeUndefined();
		expect(p.faceAging.s).toBe(g.get("season"));
	});

	test("a randomized face replaces an existing player's aging state, unlocked", () => {
		const prev = makePlayer(makeFace(2));
		agePlayerFace(prev as any, g.get("season"));
		const p = { ...prev, face: makeFace(3) };
		p.faceAging = { ...freshFaceAging(p.face), a: 1 };
		expect(faceAgingOnCustomize(p as any, prev as any, g.get("season"))).toBe(
			true,
		);
		expect(p.faceAging).toEqual(freshFaceAging(p.face));
	});

	test("a generated face edited before saving is still locked", () => {
		const p = makePlayer(makeFace(4));
		p.faceAging = freshFaceAging(p.face);
		p.face = { ...p.face, hair: { ...p.face.hair, color: "#123456" } };
		expect(faceAgingOnCustomize(p as any, undefined, g.get("season"))).toBe(
			false,
		);
		expect(p.faceAging.e).toBe(1);
	});
});

describe("agePlayerFace", () => {
	test("no write when only the season marker would move", () => {
		const p = makePlayer(makeFace(5), 40);
		const season = g.get("season");
		expect(agePlayerFace(p as any, season)).toBe(true);
		const face = JSON.stringify(p.face);
		const aging = JSON.stringify(p.faceAging);

		// Same season again: nothing to do
		expect(agePlayerFace(p as any, season)).toBe(false);

		// A stale marker (the write was skipped last time): worked out again, same face and snapshots, so no write
		p.faceAging.s = season - 1;
		expect(agePlayerFace(p as any, season)).toBe(false);
		expect(JSON.stringify(p.face)).toBe(face);
		expect(JSON.stringify({ ...p.faceAging })).toBe(aging);
	});
});

describe("retired players' sparse history", () => {
	test("fewer snapshots, same faces at the snapshot seasons, close in between", () => {
		const options = {
			speed: "strong" as const,
			hairLoss: true,
			graying: true,
			styleEvents: true,
		};
		for (const seed of [11, 12, 13, 14]) {
			const start = g.get("season");
			const retiredYear = start + 4;
			const end = retiredYear + 30;
			const make = () => ({
				...makePlayer(makeFace(seed), 30),
				pid: seed,
				tid: PLAYER.FREE_AGENT as number,
				retiredYear: undefined as number | undefined,
			});
			const sparse = make();
			const full = make();
			for (let season = start; season <= end; season++) {
				if (season > retiredYear) {
					sparse.tid = PLAYER.RETIRED;
					sparse.retiredYear = retiredYear;
				}
				agePlayerFace(sparse as any, season, options);

				// The full history: every season recorded (as before)
				const res = ageFaceForSeason(
					full.face,
					full.faceAging,
					{
						seed: full.pid,
						born: full.born.year,
						minutes: 0,
						weight: full.weight,
						texture: textureOf(
							full.face.body?.color,
							full.faceAging?.b.hi ?? full.face.hair.id,
							full.faceAging?.b.hb ?? full.face.hairBg?.id,
						),
						retiredYear: sparse.retiredYear,
						eyeInjurySeasons: [],
						season,
					},
					options,
				)!;
				full.face = res.face;
				full.faceAging = res.aging;
			}

			// Same face today
			expect(extractAgingFields(sparse.face)).toEqual(
				extractAgingFields(full.face),
			);
			const sparseSeasons = Object.keys(sparse.faceAging.h).map(Number);
			const fullSeasons = Object.keys(full.faceAging.h).map(Number);
			expect(sparseSeasons.length).toBeLessThan(fullSeasons.length);
			const after = (seasons: number[]) =>
				seasons.filter((s) => s > retiredYear).length;
			expect(after(sparseSeasons)).toBeLessThanOrEqual(
				after(fullSeasons) * 0.6,
			);

			for (let season = start; season <= end; season++) {
				const a = extractAgingFields(
					faceForSeason(sparse.face, sparse.faceAging, season),
				);
				// Rebuilt from the last snapshot season at or before it: the full history's face then
				const last = Math.max(...sparseSeasons.filter((s) => s <= season));
				const b = extractAgingFields(
					faceForSeason(full.face, full.faceAging, last),
				);
				expect(a).toEqual(b);
				// And close to the full history's face that season
				const c = extractAgingFields(
					faceForSeason(full.face, full.faceAging, season),
				);
				expect(Math.abs(a.ft - c.ft)).toBeLessThan(SPARSE_FATNESS + 0.001);
				// Everything but the hair/beard colour and fatness exactly
				const { hc: _h1, bc: _b1, ft: _f1, ...restA } = a;
				const { hc: _h2, bc: _b2, ft: _f2, ...restC } = c;
				expect(restA).toEqual(restC);
				if (season <= retiredYear + 1) {
					expect(a).toEqual(c);
				}
			}
		}
	});
});
