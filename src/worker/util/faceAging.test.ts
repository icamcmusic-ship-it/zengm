import { generate, type FaceConfig } from "facesjs";
import { beforeEach, describe, expect, test } from "vitest";
import { PLAYER } from "../../common/constants.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { resetG } from "../../test/helpers.ts";
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
