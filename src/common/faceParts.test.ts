import { faceToSvgString, generate, svgs, svgsIndex } from "facesjs";
import { describe, expect, test } from "vitest";
import {
	addRandomForkParts,
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

	test("every fork part renders, recoloured, without error", () => {
		registerForkFaceParts();
		// A few rounds, so each part is drawn over several random faces
		for (const part of [...FORK_FACE_PARTS, ...FORK_FACE_PARTS, ...FORK_FACE_PARTS]) {
			const face = generate(undefined, { gender: "male" });
			face.body.color = "#123456";
			face.hair.color = "#abcdef";
			(face as any)[part.feature] = {
				...(face as any)[part.feature],
				id: part.id,
			};
			const svg = faceToSvgString(face);
			expect(svg).not.toContain("$[");
			expect(svg).not.toContain("NaN");
			expect(svg.length).toBeGreaterThan(100);
			if (part.svg.includes("$[skinColor]")) {
				expect(svg).toContain("#123456");
			}
		}
	});

	test("fork part ids are unique", () => {
		const keys = FORK_FACE_PARTS.map((part) => `${part.feature}/${part.id}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	test("addRandomForkParts mixes parts in, keeps 'none' features", () => {
		const face = generate(undefined, { gender: "male" });
		face.glasses.id = "none";
		const before = face.head.id;
		addRandomForkParts(face, () => 0);
		expect(face.glasses.id).toBe("none");
		expect(face.head.id.startsWith("fork-")).toBe(true);
		expect(before.startsWith("fork-")).toBe(false);
		const face2 = generate(undefined, { gender: "male" });
		const copy = JSON.stringify(face2);
		addRandomForkParts(face2, () => 0.99);
		expect(JSON.stringify(face2)).toBe(copy);
	});
});
