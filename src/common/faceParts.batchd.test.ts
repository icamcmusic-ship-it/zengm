import {
	faceToSvgString,
	generate,
	svgs,
	svgsIndex,
	type FaceConfig,
} from "facesjs";
import { describe, expect, test, vi } from "vitest";
import { BATCH_C_PARTS } from "./faceParts.batchc.ts";
import { BATCH_D_PARTS } from "./faceParts.batchd.ts";
import {
	builtinFacePartIds,
	FORK_FACE_PARTS,
	registerForkFaceParts,
} from "./faceParts.ts";
import { HAIR_NEIGHBOURS } from "./faceEvents.ts";
import {
	HAIR_STYLES,
	STAFF_LOOK_CHANCE,
	STAFF_LOOKS,
	styleFace,
} from "./faceStyles.ts";
import {
	NOSE_BANDAGE_RETURN_DAYS,
	prepareFaceForDisplay,
	wearsNoseBandage,
	withFaceMask,
	withNoseBandage,
} from "./faceRender.ts";
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

const BATCH_D_IDS = new Set(BATCH_D_PARTS.map((part) => part.id));

describe("faceParts batch D", () => {
	registerForkFaceParts();
	const facialHairIds = (svgsIndex as any).facialHair as string[];
	const table = svgs as unknown as Record<string, Record<string, string>>;

	test("append-only: after batch C, fork ids, none is a facesjs id", () => {
		const ids = FORK_FACE_PARTS.map((part) => part.id);
		const lastC = ids.lastIndexOf(BATCH_C_PARTS.at(-1)!.id);
		for (const part of BATCH_D_PARTS) {
			expect(part.id.startsWith("fork-")).toBe(true);
			expect(builtinFacePartIds(part.feature)).not.toContain(part.id);
			expect(ids.indexOf(part.id)).toBeGreaterThan(lastC);
			expect(table[part.feature]![part.id]).toBe(part.svg);
		}
	});

	test("dropped duplicates are not added", () => {
		for (const id of [
			"fork-temple-taper",
			"fork-undercut-long",
			"fork-face-mask",
			"fork-eye-black",
			"fork-sweatband-low",
			"fork-freckles",
			"fork-dimples",
			"fork-side-swept",
		]) {
			expect(BATCH_D_IDS.has(id)).toBe(false);
		}
	});

	test("every part renders on light to dark skin, blond to black hair, fatness 0-1, under a headband", () => {
		const skins = ["#f2d6cb", "#bb876f", "#5c3937"];
		const hairs = ["#e9c67b", "#3D2314", "#000000"];
		for (const part of BATCH_D_PARTS) {
			for (let i = 0; i < 3; i++) {
				const face = makeFace(i + 1);
				face.body.color = skins[i]!;
				face.hair.color = hairs[i]!;
				face.fatness = i / 2;
				(face as any)[part.feature] = {
					...(face as any)[part.feature],
					id: part.id,
				};
				if (part.feature === "hair") {
					face.accessories.id = "headband";
				}
				const svg = faceToSvgString(face);
				expect(svg).not.toContain("$[");
				expect(svg).not.toContain("NaN");
				if (part.svg.includes("$[hairColor]")) {
					expect(svg).toContain(hairs[i]);
				}
			}
		}
	});

	test("generation picks the new hair, young styles fade after 27", () => {
		const youngD = new Set(
			HAIR_STYLES.filter((s) => BATCH_D_IDS.has(s.id) && s.age === "young").map(
				(s) => s.id,
			),
		);
		let young = 0;
		let old = 0;
		const seen = new Set<string>();
		for (let i = 0; i < 3000; i++) {
			const race = i % 2 === 0 ? "white" : "black";
			const base = makeFace(i + 5000, race);
			const a = styleFace(structuredClone(base), { age: 21, facialHairIds });
			const b = styleFace(structuredClone(base), { age: 35, facialHairIds });
			for (const face of [a, b]) {
				if (BATCH_D_IDS.has(face.hair.id)) {
					seen.add(face.hair.id);
				}
				if (BATCH_D_IDS.has(face.facialHair.id)) {
					seen.add(face.facialHair.id);
				}
				expect(face.hair.id).not.toBe("fork-nose-bandage");
				expect(face.accessories.id).not.toBe("fork-nose-bandage");
			}
			young += youngD.has(a.hair.id) ? 1 : 0;
			old += youngD.has(b.hair.id) ? 1 : 0;
		}
		for (const id of [
			"fork-burst-fade",
			"fork-afro-puff",
			"fork-frohawk",
			"fork-goatee-extended",
			"fork-pencil-beard",
		]) {
			expect(seen.has(id), id).toBe(true);
		}
		expect(young).toBeGreaterThan(old * 3);
	});

	test("every new style has neighbours for style events, no existing style lists one", () => {
		for (const style of HAIR_STYLES.filter((s) => BATCH_D_IDS.has(s.id))) {
			const key =
				style.hairBg === undefined ? style.id : `${style.id}+${style.hairBg}`;
			expect(
				HAIR_NEIGHBOURS[key] ?? HAIR_NEIGHBOURS[style.id],
				key,
			).toBeDefined();
		}
		for (const [key, node] of Object.entries(HAIR_NEIGHBOURS)) {
			if (!BATCH_D_IDS.has(key.split("+")[0]!)) {
				for (const near of node.near) {
					expect(
						BATCH_D_IDS.has(near.split("+")[0]!),
						`${key} -> ${near}`,
					).toBe(false);
				}
			}
		}
	});
});

describe("staff-only looks", () => {
	registerForkFaceParts();
	const facialHairIds = (svgsIndex as any).facialHair as string[];

	test("only coaches and GMs 40 and over, players' faces unchanged by the flag", () => {
		const counts = new Map<string, number>();
		const n = 1500;
		for (let i = 0; i < n; i++) {
			const base = makeFace(i + 9000, i % 2 === 0 ? "white" : "black");
			const player = styleFace(structuredClone(base), {
				age: 50,
				facialHairIds,
			});
			const young = styleFace(structuredClone(base), {
				age: 38,
				facialHairIds,
				staff: true,
			});
			expect(young).toEqual(
				styleFace(structuredClone(base), { age: 38, facialHairIds }),
			);
			const staff = styleFace(structuredClone(base), {
				age: 50,
				facialHairIds,
				staff: true,
			});
			const look =
				staff.hair.id === "bald" &&
				staff.facialHair.id !== "none" &&
				staff.glasses.id !== "none"
					? "bald-beard-glasses"
					: staff.hair.id === "bald" &&
						  staff.facialHair.id === "none" &&
						  ["fork-brow-bushy", "fork-brow-thick-straight"].includes(
								staff.eyebrow.id,
						  )
						? "bald-heavy-brows"
						: ["fork-side-part", "parted"].includes(staff.hair.id) &&
							  staff.hair.color !== base.hair.color
							? "side-swept-grey"
							: "other";
			counts.set(look, (counts.get(look) ?? 0) + 1);
			if (look === "side-swept-grey") {
				expect(staff.hairBg.id).toBe("none");
			}
			// Same face for players with and without the flag's default
			expect(player).toEqual(
				styleFace(structuredClone(base), {
					age: 50,
					facialHairIds,
					staff: false,
				}),
			);
		}
		for (const look of STAFF_LOOKS) {
			const share = (counts.get(look) ?? 0) / n;
			expect(share, look).toBeGreaterThan((STAFF_LOOK_CHANCE / 3) * 0.6);
			expect(share, look).toBeLessThan((STAFF_LOOK_CHANCE / 3) * 1.6);
		}
	});

	test("no random numbers drawn", () => {
		const spy = vi.spyOn(Math, "random");
		const base = makeFace(3);
		const a = styleFace(structuredClone(base), {
			age: 55,
			facialHairIds,
			staff: true,
		});
		const b = styleFace(structuredClone(base), {
			age: 55,
			facialHairIds,
			staff: true,
		});
		expect(a).toEqual(b);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe("nose bandage from the injury state", () => {
	test("while out with a nose or facial injury, and for his first days back", () => {
		expect(
			wearsNoseBandage({ type: "Fractured Nose", gamesRemaining: 4 }),
		).toBe(true);
		expect(
			wearsNoseBandage({ type: "Facial Laceration", gamesRemaining: 1 }),
		).toBe(true);
		expect(wearsNoseBandage({ type: "Concussion", gamesRemaining: 4 })).toBe(
			false,
		);
		const healthy = { type: "Healthy", gamesRemaining: 0 };
		expect(
			wearsNoseBandage(healthy, { type: "Fractured Nose", daysBack: 2 }),
		).toBe(true);
		expect(
			wearsNoseBandage(healthy, {
				type: "Fractured Nose",
				daysBack: NOSE_BANDAGE_RETURN_DAYS,
			}),
		).toBe(false);
		// Return window unknown (Injury Depth off): only while out
		expect(
			wearsNoseBandage(healthy, {
				type: "Fractured Nose",
				daysBack: undefined,
			}),
		).toBe(false);
		expect(
			wearsNoseBandage(healthy, { type: "Sprained Ankle", daysBack: 1 }),
		).toBe(false);
		// Out with something else after a nose injury: no bandage
		expect(
			wearsNoseBandage(
				{ type: "Sprained Ankle", gamesRemaining: 3 },
				{ type: "Fractured Nose", daysBack: 1 },
			),
		).toBe(false);
	});

	test("drawn at render time: stored face unchanged, headband kept, under the clear mask", () => {
		registerForkFaceParts();
		const face = makeFace(11);
		face.accessories.id = "headband";
		face.glasses.id = "none";
		const before = JSON.stringify(face);
		const bandaged = withNoseBandage(face);
		expect(JSON.stringify(face)).toBe(before);
		expect(bandaged.accessories.id).toBe("headband");
		const bandageSvg = BATCH_D_PARTS.find(
			(part) => part.id === "fork-nose-bandage",
		)!.svg;
		const svg = faceToSvgString(prepareFaceForDisplay(bandaged));
		expect(svg).toContain("#f7f5f0");
		expect(svg).not.toContain("$[");
		const masked = withNoseBandage(withFaceMask(face));
		const table = svgs as unknown as Record<string, Record<string, string>>;
		expect(table.glasses![masked.glasses.id]).toBe(
			bandageSvg + table.glasses!.facemask,
		);
		// Never listed for editors or generate()
		expect((svgsIndex as any).glasses).not.toContain(masked.glasses.id);
	});
});
