import { faceToSvgString, generate, type FaceConfig } from "facesjs";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	ageFaceForSeason,
	agedFields,
	extractAgingFields,
	faceAgingAfterEdit,
	faceGenes,
	familyFaceGenes,
	faceForSeason,
	faceHistory,
	facialHairTier,
	hairLossStageOf,
	type FaceAging,
} from "./faceAging.ts";
import { registerForkFaceParts } from "./faceParts.ts";
import { prepareFaceForDisplay } from "./faceRender.ts";
import { makeSeededRandom } from "./random.ts";

const OPTIONS = { speed: "normal", hairLoss: true, graying: true } as const;

const makeFace = (seed: number): FaceConfig => {
	const original = Math.random;
	Math.random = makeSeededRandom(seed);
	try {
		return generate(undefined, { gender: "male" });
	} finally {
		Math.random = original;
	}
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("faceAging", () => {
	test("deterministic and never uses Math.random", () => {
		const face = makeFace(1);
		const spy = vi.spyOn(Math, "random");
		const ctx = { seed: 42, age: 33, born: 1990, minutes: 20000 };
		const a = agedFields(extractAgingFields(face), ctx, OPTIONS);
		const b = agedFields(extractAgingFields(face), ctx, OPTIONS);
		expect(a).toEqual(b);
		expect(spy).not.toHaveBeenCalled();
	});

	test("young players have no lines and little facial hair; hair loss only goes one way", () => {
		let withFacialHair = 0;
		for (let pid = 0; pid < 200; pid++) {
			const face = makeFace(pid + 100);
			const base = extractAgingFields(face);
			const young = agedFields(
				base,
				{ seed: pid, age: 19, born: 2000 },
				OPTIONS,
			);
			expect(young.el).toBe("none");
			expect(young.ml === "none" || !young.ml.startsWith("forehead")).toBe(
				true,
			);
			expect(young.sl).toBe("none");
			if (facialHairTier(young.fh) >= 2) {
				withFacialHair += 1;
			}
			let stage = 0;
			for (let age = 19; age <= 45; age++) {
				const f = agedFields(base, { seed: pid, age, born: 2000 }, OPTIONS);
				const s = hairLossStageOf(f.hi);
				expect(s).toBeGreaterThanOrEqual(stage);
				stage = s;
			}
		}
		expect(withFacialHair).toBeLessThan(30);
	});

	test("options: no hair loss, no greying", () => {
		const face = makeFace(7);
		const base = extractAgingFields(face);
		for (let pid = 0; pid < 50; pid++) {
			const f = agedFields(
				base,
				{ seed: pid, age: 45, born: 1980 },
				{ speed: "strong", hairLoss: false, graying: false },
			);
			expect(f.hi).toBe(base.hi);
			expect(f.hc).toBe(base.hc);
		}
	});

	test("snapshots rebuild past seasons, edits lock", () => {
		let face = makeFace(3);
		const generated = face;
		let aging: FaceAging | undefined;
		const faces: Record<number, FaceConfig> = {};
		for (let season = 2020; season <= 2040; season++) {
			const result = ageFaceForSeason(
				face,
				aging,
				{ seed: 5, born: 2001, season },
				OPTIONS,
			);
			expect(result).toBeDefined();
			face = result!.face;
			aging = result!.aging;
			faces[season] = face;
			// Same season twice: nothing more
			expect(
				ageFaceForSeason(face, aging, { seed: 5, born: 2001, season }, OPTIONS),
			).toBeUndefined();
		}
		for (let season = 2020; season <= 2040; season++) {
			expect(extractAgingFields(faceForSeason(face, aging, season))).toEqual(
				extractAgingFields(faces[season]!),
			);
		}
		expect(faceHistory(face, aging).length).toBeGreaterThan(2);
		expect(aging!.b).toEqual(extractAgingFields(generated));
		// Small: the whole state stays well under a couple of KB
		expect(JSON.stringify(aging).length).toBeLessThan(2000);

		const locked = faceAgingAfterEdit(aging, face, 40, false);
		expect(
			ageFaceForSeason(
				face,
				locked,
				{ seed: 5, born: 2001, season: 2041 },
				OPTIONS,
			),
		).toBeUndefined();
		const allowed = faceAgingAfterEdit(aging, face, 40, true);
		const next = ageFaceForSeason(
			face,
			allowed,
			{ seed: 5, born: 2001, season: 2041 },
			OPTIONS,
		);
		expect(next).toBeDefined();
		// The user's beard style is kept
		expect(next!.face.facialHair.id).toBe(face.facialHair.id);

		// An edit with aging allowed: later seasons' faces are rebuilt from the edited face, not the one before the edit
		const editedFace: FaceConfig = {
			...face,
			hair: {
				...face.hair,
				id: face.hair.id === "afro" ? "short" : "afro",
				color: "#ff0000",
			},
		};
		let editedAging: FaceAging | undefined = faceAgingAfterEdit(
			aging,
			editedFace,
			40,
			true,
			2041,
		);
		let current = editedFace;
		const edFaces: Record<number, FaceConfig> = { 2041: editedFace };
		for (let season = 2042; season <= 2046; season++) {
			const result = ageFaceForSeason(
				current,
				editedAging,
				{ seed: 5, born: 2001, season },
				OPTIONS,
			);
			if (result) {
				current = result.face;
				editedAging = result.aging;
			}
			edFaces[season] = current;
		}
		for (let season = 2041; season <= 2046; season++) {
			expect(faceForSeason(current, editedAging, season).hair.color).toBe(
				edFaces[season]!.hair.color,
			);
		}
		// Before the edit: still the old face
		expect(
			extractAgingFields(faceForSeason(current, editedAging, 2030)),
		).toEqual(extractAgingFields(faces[2030]!));
	});

	test("every aged face draws, with a separate beard colour", () => {
		registerForkFaceParts();
		for (let pid = 0; pid < 40; pid++) {
			const face = makeFace(pid + 500);
			const aged = agedFields(
				extractAgingFields(face),
				{ seed: pid, age: 30 + (pid % 20), born: 1980 },
				OPTIONS,
			);
			const drawn = prepareFaceForDisplay({
				...face,
				hair: { ...face.hair, id: aged.hi, color: aged.hc },
				facialHair: { id: aged.fh },
				fork: aged.bc ? { beard: aged.bc } : undefined,
			} as FaceConfig);
			const svg = faceToSvgString(drawn);
			expect(svg).toContain("<svg");
			if (aged.bc && aged.fh !== "none") {
				expect(svg).toContain(aged.bc);
			}
		}
	});
});

describe("family resemblance", () => {
	test("no family seed: his own genes, unchanged", () => {
		for (let seed = 0; seed < 50; seed++) {
			expect(familyFaceGenes(seed)).toEqual(faceGenes(seed));
			expect(familyFaceGenes(seed, seed)).toEqual(faceGenes(seed));
		}
	});

	test("relatives share hair loss and greying far more often than strangers", () => {
		const n = 2000;
		let sameLossFamily = 0;
		let sameLossStrangers = 0;
		let greyFamily = 0;
		let greyStrangers = 0;
		for (let i = 0; i < n; i++) {
			const father = faceGenes(100000 + i);
			const son = familyFaceGenes(200000 + i, 100000 + i);
			const stranger = faceGenes(300000 + i);
			const bald = (x: number) => x > 0.5;
			sameLossFamily += bald(son.hairLoss) === bald(father.hairLoss) ? 1 : 0;
			sameLossStrangers +=
				bald(stranger.hairLoss) === bald(father.hairLoss) ? 1 : 0;
			greyFamily += Math.abs(son.greyStart - father.greyStart) <= 2 ? 1 : 0;
			greyStrangers +=
				Math.abs(stranger.greyStart - father.greyStart) <= 2 ? 1 : 0;
			// The rest of his genes are his own
			expect(son.eyeLine).toBe(faceGenes(200000 + i).eyeLine);
		}
		expect(sameLossFamily / n).toBeGreaterThan(sameLossStrangers / n + 0.15);
		expect(greyFamily / n).toBeGreaterThan(greyStrangers / n + 0.3);
	});

	test("the family seed reaches aging", () => {
		const base = extractAgingFields(makeFace(3));
		let differ = 0;
		for (let seed = 0; seed < 40; seed++) {
			const ctx = { seed, age: 50, born: 1950 };
			const own = agedFields(base, ctx, OPTIONS);
			const fam = agedFields(base, { ...ctx, familySeed: 999 }, OPTIONS);
			if (own.hc !== fam.hc || own.hi !== fam.hi) {
				differ += 1;
			}
		}
		expect(differ).toBeGreaterThan(10);
	});
});
