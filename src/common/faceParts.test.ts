import { generate, svgs, svgsIndex } from "facesjs";
import { describe, expect, test } from "vitest";
import {
	builtinFacePartIds,
	FORK_FACE_PARTS,
	isFacePartRegistered,
	registerFacePart,
	registerForkFaceParts,
} from "./faceParts.ts";

describe("faceParts", () => {
	const hairBefore = { ...(svgs as any).hair };
	const indexBefore = [...(svgsIndex as any).hair];

	test("registering appends without changing facesjs parts", () => {
		registerForkFaceParts();
		for (const part of FORK_FACE_PARTS) {
			expect(isFacePartRegistered(part.feature, part.id)).toBe(true);
			expect((svgs as any)[part.feature][part.id]).toBe(part.svg);
		}
		const index = (svgsIndex as any).hair as string[];
		expect(index.slice(0, indexBefore.length)).toEqual(indexBefore);
		for (const [id, svg] of Object.entries(hairBefore)) {
			expect((svgs as any).hair[id]).toBe(svg);
		}
		expect(builtinFacePartIds("hair")).toEqual(indexBefore);
	});

	test("append-only: first registration wins, facesjs ids and unprefixed ids are refused", () => {
		expect(registerFacePart({ ...FORK_FACE_PARTS[0]!, svg: "<g/>" })).toBe(
			false,
		);
		expect((svgs as any).hair[FORK_FACE_PARTS[0]!.id]).toBe(
			FORK_FACE_PARTS[0]!.svg,
		);
		expect(() =>
			registerFacePart({ feature: "hair", id: "short", svg: "<g/>" }),
		).toThrow();
		expect(() =>
			registerFacePart({ feature: "hair", id: "fork-x", svg: "" }),
		).not.toThrow();
		expect(() =>
			registerFacePart({ feature: "hair", id: "mine", svg: "<g/>" }),
		).toThrow();
	});

	test("generate never picks a fork part", () => {
		registerForkFaceParts();
		for (let i = 0; i < 300; i++) {
			const face = generate(undefined, {
				gender: i % 2 === 0 ? "male" : "female",
			});
			expect(face.hair.id.startsWith("fork-")).toBe(false);
		}
	});
});
