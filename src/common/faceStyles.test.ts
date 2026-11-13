import { generate, svgs, svgsIndex, type FaceConfig } from "facesjs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { registerForkFaceParts } from "./faceParts.ts";
import { HAIR_STYLES, styleFace } from "./faceStyles.ts";
import { makeSeededRandom } from "./random.ts";

const makeFace = (seed: number, race?: "white" | "black"): FaceConfig => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		return generate(undefined, { gender: "male", race });
	} finally {
		Math.random = original;
	}
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("faceStyles", () => {
	registerForkFaceParts();
	const facialHairIds = (svgsIndex as any).facialHair as string[];

	test("deterministic, no random numbers drawn", () => {
		const a = makeFace(1);
		const b = structuredClone(a);
		const spy = vi.spyOn(Math, "random");
		styleFace(a, { age: 22, facialHairIds });
		styleFace(b, { age: 22, facialHairIds });
		expect(a).toEqual(b);
		expect(spy).not.toHaveBeenCalled();
	});

	test("every picked style exists, fits the texture, no aging-only hair", () => {
		// Styles a white (straight or curly hair) face can get
		const nonCoily = new Set(
			HAIR_STYLES.filter((s) => s.textures.some((t) => t !== "coily")).map(
				(s) => s.id,
			),
		);
		const table = svgs as unknown as Record<string, Record<string, string>>;
		const counts = new Map<string, number>();
		for (let i = 0; i < 400; i++) {
			const race = i % 2 === 0 ? "white" : "black";
			const face = styleFace(makeFace(i + 10, race), {
				age: 19 + (i % 20),
				facialHairIds,
			});
			expect(table.hair![face.hair.id]).toBeDefined();
			expect(table.hairBg![face.hairBg.id]).toBeDefined();
			expect(table.facialHair![face.facialHair.id]).toBeDefined();
			expect(face.hair.id).not.toMatch(/recede|thinning|comb-over|widows/);
			if (race === "white") {
				expect(nonCoily.has(face.hair.id)).toBe(true);
			}
			counts.set(face.hair.id, (counts.get(face.hair.id) ?? 0) + 1);
		}
		// A spread of styles, none dominating
		expect(counts.size).toBeGreaterThan(30);
		expect(Math.max(...counts.values())).toBeLessThan(40);
	});
});
