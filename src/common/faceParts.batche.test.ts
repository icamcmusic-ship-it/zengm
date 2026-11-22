import {
	faceToSvgString,
	generate,
	svgs,
	svgsIndex,
	type FaceConfig,
} from "facesjs";
import { describe, expect, test, vi } from "vitest";
import { BATCH_D_PARTS } from "./faceParts.batchd.ts";
import { BATCH_E_PARTS } from "./faceParts.batche.ts";
import {
	builtinFacePartIds,
	FORK_FACE_PARTS,
	registerForkFaceParts,
} from "./faceParts.ts";
import { facialHairTier, HAIR_NEIGHBOURS } from "./faceEvents.ts";
import { parsePath } from "./facePath.ts";
import { prepareFaceForDisplay } from "./faceRender.ts";
import { facialHairRarity, HAIR_STYLES, styleFace } from "./faceStyles.ts";
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

const BATCH_E_IDS = new Set(BATCH_E_PARTS.map((part) => part.id));
const ofFeature = (feature: string) =>
	BATCH_E_PARTS.filter((part) => part.feature === feature).map((p) => p.id);

describe("faceParts batch E", () => {
	registerForkFaceParts();
	const facialHairIds = (svgsIndex as any).facialHair as string[];
	const table = svgs as unknown as Record<string, Record<string, string>>;

	test("append-only: after batch D, fork ids, none is a facesjs id, face parts only", () => {
		const ids = FORK_FACE_PARTS.map((part) => part.id);
		const lastD = ids.lastIndexOf(BATCH_D_PARTS.at(-1)!.id);
		for (const part of BATCH_E_PARTS) {
			expect(part.id.startsWith("fork-")).toBe(true);
			expect(builtinFacePartIds(part.feature)).not.toContain(part.id);
			expect(ids.indexOf(part.id)).toBeGreaterThan(lastD);
			expect(table[part.feature]![part.id]).toBe(part.svg);
			// No gear: accessories, glasses, body and lines are not part of this batch
			expect([
				"hair",
				"hairBg",
				"facialHair",
				"eye",
				"eyebrow",
				"ear",
				"nose",
				"mouth",
				"head",
			]).toContain(part.feature);
		}
	});

	test("the target counts per feature", () => {
		expect(ofFeature("hair").length).toBeGreaterThanOrEqual(12);
		expect(ofFeature("facialHair").length).toBeGreaterThanOrEqual(6);
		expect(ofFeature("eye").length).toBeGreaterThanOrEqual(4);
		expect(ofFeature("eyebrow").length).toBeGreaterThanOrEqual(4);
		expect(ofFeature("ear").length).toBeGreaterThanOrEqual(3);
		expect(ofFeature("nose").length).toBeGreaterThanOrEqual(3);
		expect(ofFeature("mouth").length).toBeGreaterThanOrEqual(3);
		expect(ofFeature("head").length).toBeGreaterThanOrEqual(2);
	});

	test("dropped candidates are not added", () => {
		for (const id of [
			"fork-eye-squint",
			"fork-brow-sparse",
			"fork-nose-arrow",
			"fork-mouth-closed-smile",
		]) {
			expect(BATCH_E_IDS.has(id)).toBe(false);
		}
	});

	test("facial hair and heads use only path commands the jaw fit reads, and no clip paths", () => {
		for (const part of BATCH_E_PARTS) {
			if (part.feature !== "facialHair" && part.feature !== "head") {
				continue;
			}
			expect(part.svg).not.toContain("clip-path");
			for (const m of part.svg.matchAll(/\sd="([^"]+)"/g)) {
				expect(parsePath(m[1]!), part.id).toBeDefined();
			}
		}
	});

	test("hair is centred: facesjs scales it for fatness about its middle", () => {
		// Same transform on the head and the hair at every fatness (an off-centre part would slide sideways on a thin face)
		for (const id of ofFeature("hair")) {
			for (const fatness of [0, 0.5, 1]) {
				const face = makeFace(3);
				face.fatness = fatness;
				face.hair.id = id;
				const transforms = [
					...faceToSvgString(face).matchAll(/<g transform="([^"]*)">/g),
				].map((m) => m[1]!);
				const scale = (t: string) =>
					/^scale\(([\d.]+) 1\) translate\([\d.e-]+ 0\)$/.exec(t)?.[1];
				const fat = transforms.filter(
					(t) => scale(t) !== undefined && Number(scale(t)) < 1,
				);
				const centre = (t: string) => {
					const [, s, tx] =
						/scale\(([\d.]+) 1\) translate\(([\d.e-]+) 0\)/.exec(t)!;
					// scale(s) translate(tx): the fixed point is x = s * tx / (1 - s)
					return (Number(s) * Number(tx)) / (1 - Number(s));
				};
				if (fatness < 1) {
					// (the head, the hair)
					expect(fat.length).toBeGreaterThanOrEqual(2);
					for (const t of fat) {
						expect(Math.abs(centre(t) - 200), `${id} ${t}`).toBeLessThan(0.5);
					}
				}
			}
		}
	});

	test("every part renders on light to dark skin, blond to black and grey hair, fatness 0-1, with a beard and fitted", () => {
		const skins = ["#f2d6cb", "#bb876f", "#5c3937", "#f0c5a3"];
		const hairs = ["#e9c67b", "#3D2314", "#000000", "#c4c6ca"];
		const heads = ["head2", "head17", "fork-head-long", "fork-head-vchin"];
		for (const part of BATCH_E_PARTS) {
			for (let i = 0; i < 4; i++) {
				const face = makeFace(i + 1);
				face.body.color = skins[i]!;
				face.hair.color = hairs[i]!;
				face.fatness = i / 3;
				face.head.id = heads[i]!;
				face.facialHair.id = i % 2 ? "fork-full-beard" : "none";
				(face as any)[part.feature] = {
					...(face as any)[part.feature],
					id: part.id,
				};
				const svg = faceToSvgString(
					prepareFaceForDisplay(face, { fitFacialHair: true }),
				);
				expect(svg).not.toContain("$[");
				expect(svg).not.toContain("NaN");
				if (part.svg.includes("$[hairColor]")) {
					expect(svg).toContain(hairs[i]);
				}
			}
		}
	});

	test("facial hair: fork catalogue, rarity and fullness tiers", () => {
		const beards = ofFeature("facialHair");
		expect(beards.length).toBe(6);
		expect(facialHairRarity("fork-beard-coily")).toBe("common");
		expect(facialHairRarity("fork-beard-forked")).toBe("rare");
		expect(facialHairRarity("fork-beard-spade")).toBe("uncommon");
		expect(facialHairTier("fork-beard-faded")).toBe(3);
		for (const id of [
			"fork-beard-coily",
			"fork-beard-forked",
			"fork-beard-spade",
		]) {
			expect(facialHairTier(id)).toBe(4);
		}
		expect(facialHairTier("fork-stache-scruff")).toBe(2);
		expect(facialHairTier("fork-imperial")).toBe(2);
	});

	test("generation picks the new parts, young styles fade after 27, nothing common", () => {
		const hairE = HAIR_STYLES.filter((s) => BATCH_E_IDS.has(s.id));
		expect(hairE.every((s) => s.rarity !== "common")).toBe(true);
		const youngE = new Set(
			hairE.filter((s) => s.age === "young").map((s) => s.id),
		);
		let young = 0;
		let old = 0;
		let anyE = 0;
		const seen = new Set<string>();
		const n = 3000;
		for (let i = 0; i < n; i++) {
			const race = i % 2 === 0 ? "white" : "black";
			const base = makeFace(i + 7000, race);
			const a = styleFace(structuredClone(base), { age: 21, facialHairIds });
			const b = styleFace(structuredClone(base), { age: 35, facialHairIds });
			for (const face of [a, b]) {
				for (const feature of [
					"hair",
					"facialHair",
					"eye",
					"eyebrow",
					"ear",
					"nose",
					"mouth",
					"head",
				]) {
					const id = (face as any)[feature].id as string;
					if (BATCH_E_IDS.has(id)) {
						seen.add(id);
					}
				}
			}
			young += youngE.has(a.hair.id) ? 1 : 0;
			old += youngE.has(b.hair.id) ? 1 : 0;
			anyE += BATCH_E_IDS.has(a.hair.id) ? 1 : 0;
		}
		for (const id of [
			"fork-feed-in-braids",
			"fork-locs-fringe",
			"fork-afro-taper",
			"fork-flow",
			"fork-two-block",
			"fork-beard-coily",
			"fork-stache-scruff",
			"fork-eye-upturned",
			"fork-brow-worried",
			"fork-nose-roman",
			"fork-head-angular",
		]) {
			expect(seen.has(id), id).toBe(true);
		}
		expect(young).toBeGreaterThan(old * 3);
		// A modest share of young players' hair, so the older styles keep theirs
		expect(anyE / n).toBeLessThan(0.15);
	});

	test("every new style has neighbours for style events, no older style lists one", () => {
		for (const style of HAIR_STYLES.filter((s) => BATCH_E_IDS.has(s.id))) {
			expect(HAIR_NEIGHBOURS[style.id], style.id).toBeDefined();
		}
		for (const [key, node] of Object.entries(HAIR_NEIGHBOURS)) {
			for (const near of BATCH_E_IDS.has(key) ? node.near : []) {
				expect(
					HAIR_NEIGHBOURS[near] ?? HAIR_NEIGHBOURS[near.split("+")[0]!],
					`${key} -> ${near}`,
				).toBeDefined();
			}
			if (!BATCH_E_IDS.has(key.split("+")[0]!)) {
				for (const near of node.near) {
					expect(
						BATCH_E_IDS.has(near.split("+")[0]!),
						`${key} -> ${near}`,
					).toBe(false);
				}
			}
		}
	});

	test("no random numbers drawn", () => {
		const spy = vi.spyOn(Math, "random");
		const base = makeFace(5, "black");
		expect(
			styleFace(structuredClone(base), { age: 22, facialHairIds }),
		).toEqual(styleFace(structuredClone(base), { age: 22, facialHairIds }));
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});
