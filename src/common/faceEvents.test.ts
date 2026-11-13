import { faceToSvgString, generate, type FaceConfig } from "facesjs";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	ageFaceForSeason,
	agedFields,
	applyAgingFields,
	extractAgingFields,
	faceAgingAfterEdit,
	faceForSeason,
	type FaceAging,
	type FaceAgingOptions,
} from "./faceAging.ts";
import {
	EVERYDAY_GLASSES,
	GOGGLES,
	HAIR_NEIGHBOURS,
	HEADBANDS,
	offCourtFace,
	splitStyleKey,
	styleEventsAt,
	textureOf,
	type HairTexture,
} from "./faceEvents.ts";
import { registerForkFaceParts } from "./faceParts.ts";
import { prepareFaceForDisplay } from "./faceRender.ts";
import { makeSeededRandom } from "./random.ts";

const ON: FaceAgingOptions = {
	speed: "normal",
	hairLoss: true,
	graying: true,
	styleEvents: true,
};
const OFF: FaceAgingOptions = { ...ON, styleEvents: false };

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

const input = (
	pid: number,
	hi: string,
	age: number,
	extra: Partial<Parameters<typeof styleEventsAt>[0]> = {},
) => ({
	seed: pid,
	born: 2000,
	age,
	hi,
	hb: "none",
	beardAt: () => "goatee1",
	ac: "none",
	gl: "none",
	texture: "coily" as HairTexture,
	thinningAge: Infinity,
	...extra,
});

describe("faceEvents", () => {
	test("deterministic, never Math.random", () => {
		const spy = vi.spyOn(Math, "random");
		const a = styleEventsAt(input(7, "fork-twists", 34));
		const b = styleEventsAt(input(7, "fork-twists", 34));
		expect(a).toEqual(b);
		expect(spy).not.toHaveBeenCalled();
	});

	test("every neighbour is a known style", () => {
		for (const node of Object.values(HAIR_NEIGHBOURS)) {
			for (const key of node.near) {
				expect(HAIR_NEIGHBOURS[key], key).toBeDefined();
			}
		}
	});

	test("rates: a change every few seasons, mostly near his signature look, textures respected", () => {
		let seasons = 0;
		let hairEvents = 0;
		let atSignature = 0;
		let nearIt = 0;
		const textures: HairTexture[] = ["coily", "curly", "straight"];
		const starts: Record<HairTexture, string> = {
			coily: "fork-waves-fade",
			curly: "curly2",
			straight: "crop",
		};
		for (let pid = 0; pid < 600; pid++) {
			const texture = textures[pid % 3]!;
			const hi = starts[texture];
			const out = styleEventsAt(input(pid, hi, 34, { texture }));
			const seen = out.events.filter(
				(e) => e.kind !== "headband" && e.kind !== "beard",
			);
			hairEvents += seen.length;
			seasons += 34 - 21 + 1;
			for (const e of seen) {
				const { hi: id } = splitStyleKey(e.to);
				const letter = { coily: "c", curly: "u", straight: "s" }[texture];
				expect(HAIR_NEIGHBOURS[e.to]?.t ?? HAIR_NEIGHBOURS[id]!.t).toContain(
					letter,
				);
			}
			for (let age = 21; age <= 34; age++) {
				const now = styleEventsAt(input(pid, hi, age, { texture })).hi;
				if (now === hi) {
					atSignature += 1;
				}
				if (now === hi || HAIR_NEIGHBOURS[hi]!.near.includes(now)) {
					nearIt += 1;
				}
			}
		}
		// About one hair change every 6-10 seasons, and he's usually in his signature look
		expect(hairEvents / seasons).toBeGreaterThan(0.08);
		expect(hairEvents / seasons).toBeLessThan(0.18);
		expect(atSignature / seasons).toBeGreaterThan(0.45);
		expect(nearIt / seasons).toBeGreaterThan(0.7);
	});

	test("twists grow into locs, never the other way by a nearby step", () => {
		expect(HAIR_NEIGHBOURS["fork-twists-medium"]!.near).toContain(
			"fork-starter-locs",
		);
		expect(
			HAIR_NEIGHBOURS["fork-locs-top+fork-locs-long"]!.near.some((key) =>
				key.includes("twists"),
			),
		).toBe(false);
	});

	test("thinning players only cut it shorter, and his hairline still shows", () => {
		for (let pid = 0; pid < 300; pid++) {
			const out = styleEventsAt(
				input(pid, "fork-locs-top", 40, {
					hb: "fork-locs-long",
					thinningAge: 28,
				}),
			);
			for (const e of out.events) {
				if (
					e.season - 2000 >= 28 &&
					e.kind !== "beard" &&
					e.kind !== "headband"
				) {
					expect(["fork-buzz", "short-fade", "bald"]).toContain(e.to);
				}
			}
		}
		// Through face aging: once his hairline has moved, nothing long is drawn behind the head
		for (let pid = 0; pid < 200; pid++) {
			const face = makeFace(pid + 900);
			face.hair.id = "fork-locs-top";
			face.hairBg.id = "fork-locs-long";
			const base = extractAgingFields(face);
			const f = agedFields(base, { seed: pid, age: 44, born: 1980 }, ON);
			if (f.hi.startsWith("fork-rece") || f.hi === "short-bald") {
				expect(f.hb).toBe("none");
			}
		}
	});

	test("headbands come and go, off once retired", () => {
		let wearing = 0;
		let changes = 0;
		for (let pid = 0; pid < 400; pid++) {
			const out = styleEventsAt(input(pid, "short-fade", 32));
			changes += out.events.filter((e) => e.kind === "headband").length;
			if (HEADBANDS.includes(out.ac!)) {
				wearing += 1;
			}
			const retired = styleEventsAt(
				input(pid, "short-fade", 40, {
					ac: "headband",
					retiredYear: 2035,
				}),
			);
			expect(retired.ac).toBe("none");
		}
		expect(changes).toBeGreaterThan(100);
		expect(wearing / 400).toBeGreaterThan(0.08);
		expect(wearing / 400).toBeLessThan(0.4);
	});

	test("goggles after an eye injury: the next season, for good with some chance; never in retirement", () => {
		let forGood = 0;
		for (let pid = 0; pid < 300; pid++) {
			const at = (age: number) =>
				styleEventsAt(
					input(pid, "short-fade", age, { eyeInjurySeasons: [2026] }),
				).gl;
			expect(at(26)).toBe("none");
			expect(GOGGLES).toContain(at(27));
			if (GOGGLES.includes(at(31)!)) {
				forGood += 1;
			}
			expect(
				styleEventsAt(
					input(pid, "short-fade", 36, {
						eyeInjurySeasons: [2026],
						retiredYear: 2034,
					}),
				).gl,
			).not.toMatch(/goggles/);
		}
		expect(forGood / 300).toBeGreaterThan(0.25);
		expect(forGood / 300).toBeLessThan(0.5);
	});

	test("glasses: rare while playing, likelier with every year of retirement, staff too", () => {
		let active = 0;
		let retired45 = 0;
		let retired65 = 0;
		let staff = 0;
		for (let pid = 0; pid < 500; pid++) {
			if (
				EVERYDAY_GLASSES.includes(styleEventsAt(input(pid, "short", 33)).gl!)
			) {
				active += 1;
			}
			const r45 = styleEventsAt(input(pid, "short", 45, { retiredYear: 2035 }));
			const r65 = styleEventsAt(input(pid, "short", 65, { retiredYear: 2035 }));
			if (EVERYDAY_GLASSES.includes(r45.gl!)) {
				retired45 += 1;
				// Once on, they stay on
				expect(r65.gl).toBe(r45.gl);
			}
			if (EVERYDAY_GLASSES.includes(r65.gl!)) {
				retired65 += 1;
			}
			if (
				EVERYDAY_GLASSES.includes(
					styleEventsAt(input(pid, "short", 55, { staff: true })).gl!,
				)
			) {
				staff += 1;
			}
		}
		expect(active).toBe(0);
		expect(retired45).toBeGreaterThan(50);
		expect(retired65).toBeGreaterThan(retired45 * 1.5);
		expect(staff).toBeGreaterThan(80);
	});

	test("a retired player's face today: no headband, eye black or goggles; his generated glasses stay", () => {
		const face = makeFace(5);
		for (const ac of ["headband", "fork-bandana", "eye-black"]) {
			expect(
				offCourtFace({ ...face, accessories: { id: ac } }).accessories.id,
			).toBe("none");
		}
		expect(
			offCourtFace({ ...face, accessories: { id: "fork-earring-studs" } })
				.accessories.id,
		).toBe("fork-earring-studs");
		expect(
			offCourtFace({ ...face, glasses: { id: "fork-goggles" } }).glasses.id,
		).toBe("none");
		expect(
			offCourtFace({ ...face, glasses: { id: "glasses1-secondary" } }).glasses
				.id,
		).toBe("glasses1-secondary");
	});

	test("texture from the style or the skin", () => {
		expect(textureOf("#ad6453", "short-fade")).toBe("coily");
		expect(textureOf("#f2d6cb", "short-fade")).toBe("straight");
		expect(textureOf("#f2d6cb", "curly2")).toBe("curly");
		expect(textureOf("#f2d6cb", "fork-locs-top", "fork-locs-long")).toBe(
			"coily",
		);
	});
});

describe("face aging with style events", () => {
	test("off: exactly the faces from before style events", () => {
		for (let pid = 0; pid < 60; pid++) {
			const base = extractAgingFields(makeFace(pid + 50));
			const ctx = { seed: pid, age: 20 + (pid % 25), born: 1990 };
			const { styleEvents: _, ...old } = OFF;
			expect(agedFields(base, ctx, OFF)).toEqual(agedFields(base, ctx, old));
		}
	});

	test("edited faces keep the user's style", () => {
		let face = makeFace(11);
		let aging: FaceAging | undefined;
		for (let season = 2020; season <= 2026; season++) {
			const r = ageFaceForSeason(
				face,
				aging,
				{ seed: 3, born: 2000, season },
				ON,
			)!;
			face = r.face;
			aging = r.aging;
		}
		face = { ...face, hair: { ...face.hair, id: "fork-mohawk" } };
		const allowed = faceAgingAfterEdit(aging, face, 26, true);
		let f: FaceConfig = face;
		let a: FaceAging | undefined = allowed;
		for (let season = 2027; season <= 2040; season++) {
			const r: { face: FaceConfig; aging: FaceAging } = ageFaceForSeason(
				f,
				a,
				{ seed: 3, born: 2000, season, texture: "straight" },
				{
					...ON,
					hairLoss: false,
				},
			)!;
			f = r.face;
			a = r.aging;
			expect(f.hair.id).toBe("fork-mohawk");
			expect(f.accessories.id).toBe(face.accessories.id);
			expect(f.glasses.id).toBe(face.glasses.id);
		}
	});

	test("a career: snapshots rebuild every season, prospects leave none, stays small and draws", () => {
		registerForkFaceParts();
		let face = makeFace(21);
		face.hair.id = "fork-twists-fade";
		face.hairBg.id = "none";
		let aging: FaceAging | undefined;
		const faces: Record<number, FaceConfig> = {};
		for (let season = 2018; season <= 2050; season++) {
			const r = ageFaceForSeason(
				face,
				aging,
				{
					seed: 77,
					born: 1999,
					season,
					texture: "coily",
					// Prospect until the 2019 draft, retired after 2036
					record: season > 2019,
					retiredYear: season > 2036 ? 2036 : undefined,
					eyeInjurySeasons: [2027],
				},
				ON,
			)!;
			face = r.face;
			aging = r.aging;
			faces[season] = face;
			expect(faceToSvgString(prepareFaceForDisplay(face))).toContain("<svg");
		}
		const seasons = Object.keys(aging!.h).map(Number);
		expect(Math.min(...seasons)).toBe(2020);
		for (let season = 2020; season <= 2050; season++) {
			expect(extractAgingFields(faceForSeason(face, aging, season))).toEqual(
				extractAgingFields(faces[season]!),
			);
		}
		expect(GOGGLES).toContain(faces[2028]!.glasses.id);
		expect(JSON.stringify(aging).length).toBeLessThan(2500);
	});

	test("faces aged before accessories were tracked pick them up from the face", () => {
		const face = makeFace(31);
		face.accessories.id = "headband";
		const { ac: _a, gl: _g, ...oldBase } = extractAgingFields(face);
		const old: FaceAging = { b: oldBase, h: { 2020: oldBase }, s: 2020 };
		const r = ageFaceForSeason(
			face,
			old,
			{ seed: 1, born: 1995, season: 2021 },
			ON,
		)!;
		expect(r.aging.b.ac).toBe("headband");
		expect(faceForSeason(r.face, r.aging, 2020).accessories.id).toBe(
			"headband",
		);
		expect(applyAgingFields(face, {}).accessories.id).toBe("headband");
	});
});
