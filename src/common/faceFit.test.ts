import { faceToSvgString, svgs, svgsIndex, type FaceConfig } from "facesjs";
import { describe, expect, test } from "vitest";
import {
	FIT_REFERENCE_HEAD,
	fitFacialHairSvg,
	headProfile,
	reachesJaw,
} from "./faceFit.ts";
import { crossings, flatten, parsePath, segmentsToPath } from "./facePath.ts";
import { registerForkFaceParts } from "./faceParts.ts";
import { prepareFaceForDisplay } from "./faceRender.ts";
import {
	agedFields,
	applyAgingFields,
	DEFAULT_FACE_AGING_OPTIONS,
	extractAgingFields,
} from "./faceAging.ts";

registerForkFaceParts();
const table = svgs as unknown as Record<string, Record<string, string>>;
const index = svgsIndex as unknown as Record<string, string[]>;

// Ids as listed (derived render parts like "~fb" or "~fit-" are never listed)
const BEARDS = index.facialHair!.filter((id) => id !== "none");
const HEADS = index.head!.filter((id) => !id.startsWith("female"));
const FATNESS = [0, 0.25, 0.5, 0.75, 1];
const STUBBLE = [
	"fork-stubble",
	"fork-heavy-stubble",
	"fork-patchy-stubble",
	"fork-goatee-stubble",
	"fork-pencil-beard",
];

const face = (facialHair: string, head: string, fatness: number): FaceConfig =>
	({
		fatness,
		body: { id: "none", color: "#f2d6cb", size: 1 },
		hair: { id: "none", color: "#3d2314" },
		head: { id: head, shave: "rgba(0,0,0,0)" },
		facialHair: { id: facialHair },
		accessories: { id: "none" },
		teamColors: ["#000", "#000", "#000"],
	}) as unknown as FaceConfig;

// The head and facial hair as facesjs draws them: each wrapper's transform and its paths' polylines, in face coordinates
const drawn = (f: FaceConfig) => {
	const svg = faceToSvgString(f);
	const groups = [
		...svg.matchAll(
			/<g transform="([^"]*)">([\S\s]*?)\n<\/g>\n(?=<g transform=|<\/svg>)/g,
		),
	].map((m) => {
		const nums = (m[1]!.match(/-?[\d.]+(?:e-?\d+)?/g) ?? []).map(Number);
		// facesjs' fatness wrapper: scale(sx 1) translate(tx 0)
		const [sx = 1, , tx = 0] = nums;
		const lines = [...m[2]!.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)]
			.filter((p) => !p[0].includes('fill="none" d="M0 300H400"'))
			.flatMap((p) => flatten(parsePath(p[1]!)!))
			.map((line) =>
				line.map(([x, y]) => [sx * (x + tx), y] as [number, number]),
			);
		return { transform: m[1]!, lines };
	});
	return groups;
};

// Just the wrappers' transforms (head, then facial hair)
const transforms = (f: FaceConfig) =>
	[...faceToSvgString(f).matchAll(/<g transform="([^"]*)">/g)].map((m) =>
		// The bounding box centres differ by float noise at most
		m[1]!.replaceAll(/(\d+\.\d{6})\d+/g, "$1"),
	);

const edges = (lines: [number, number][][], y: number) => {
	const xs = crossings(lines, y);
	return xs.length === 0 ? undefined : [Math.min(...xs), Math.max(...xs)];
};

// The head's skin outline only (the first path of the head part)
const headLines = (head: string, fatness: number) => {
	const [group] = drawn(face("none", head, fatness));
	return group!.lines.slice(0, 1);
};

describe("facePath", () => {
	test("parses and rewrites every head and facial hair path without changing its shape", () => {
		for (const feature of ["head", "facialHair"]) {
			for (const svg of Object.values(table[feature]!)) {
				for (const m of svg.matchAll(/\sd="([^"]+)"/g)) {
					const segments = parsePath(m[1]!);
					expect(segments).toBeDefined();
					const again = parsePath(segmentsToPath(segments!))!;
					const a = flatten(segments!).flat();
					const b = flatten(again).flat();
					expect(b.length).toBe(a.length);
					for (let i = 0; i < a.length; i++) {
						expect(Math.abs(a[i]![0] - b[i]![0])).toBeLessThan(0.02);
						expect(Math.abs(a[i]![1] - b[i]![1])).toBeLessThan(0.02);
					}
				}
			}
		}
	});
});

describe("facial hair fitted to the head", { timeout: 120_000 }, () => {
	test("off (New Face Styles and Face Aging off): a facesjs face is passed through untouched", () => {
		for (const head of ["head2", "head12", "head17"]) {
			const f = face("beard1", head, 0.5);
			expect(prepareFaceForDisplay(f)).toBe(f);
			expect(prepareFaceForDisplay(f, { fitFacialHair: false })).toBe(f);
		}
	});

	test("head1 (the jaw the parts are drawn for): the same paths, only the centring anchor added", () => {
		for (const beard of BEARDS) {
			const out = prepareFaceForDisplay(face(beard, FIT_REFERENCE_HEAD, 0.5), {
				fitFacialHair: true,
			});
			expect(table.facialHair![out.facialHair.id]).toBe(
				`${table.facialHair![beard]}<path fill="none" d="M0 300H400"/>`,
			);
		}
	});

	test("facial hair gets the same fatness transform as the head, on every head and fatness", () => {
		// facesjs parts whose bounding box is a little off centre: facesjs scales them about a slightly different point
		const offCentre = new Set<string>();
		for (const head of HEADS) {
			for (const fatness of FATNESS) {
				for (const beard of BEARDS) {
					for (const fit of [false, true]) {
						const [h, b] = transforms(
							prepareFaceForDisplay(face(beard, head, fatness), {
								fitFacialHair: fit,
							}),
						);
						if (fit) {
							expect(b, `${beard} on ${head} at ${fatness}`).toBe(h);
						} else if (b !== h) {
							offCentre.add(beard);
						}
					}
				}
			}
		}
		// facesjs' own misfit, which the fit fixes (mutton chops, a chin strap, ...)
		expect(offCentre).toContain("mutton");
		expect(offCentre).toContain("chin-strap");
	});

	test("stubble stays on the face and reaches the jaw line, on every head and fatness", () => {
		const misfits = { before: 0, after: 0 };
		for (const head of HEADS) {
			for (const fatness of FATNESS) {
				const outline = headLines(head, fatness);
				const ref = headLines(FIT_REFERENCE_HEAD, fatness);
				for (const beard of STUBBLE) {
					const refBeard = drawn(face(beard, FIT_REFERENCE_HEAD, fatness))[1]!
						.lines;
					for (const fit of [false, true]) {
						const lines = drawn(
							prepareFaceForDisplay(face(beard, head, fatness), {
								fitFacialHair: fit,
							}),
						)[1]!.lines;
						let worst = 0;
						for (let y = 330; y <= 440; y += 5) {
							const e = edges(lines, y);
							const h = edges(outline, y);
							const r = edges(ref, y);
							const rb = edges(refBeard, y);
							if (!e || !h || !r || !rb) {
								continue;
							}
							// The beard's edge sits as far inside (or past) this jaw line as head1's (within 5 px: a row-by-row fit is a few px off
							// on a sloped edge at a sharp jaw corner, like head3's)
							for (const [side, t, refOffset] of [
								[0, h[0]! - e[0]!, r[0]! - rb[0]!],
								[1, e[1]! - h[1]!, rb[1]! - r[1]!],
							] as const) {
								if (Math.abs(refOffset) <= 10 && (side === 0 ? e[0]! : e[1]!)) {
									worst = Math.max(worst, Math.abs(t - refOffset));
								}
							}
						}
						if (worst > 5) {
							misfits[fit ? "after" : "before"] += 1;
						}
						if (fit) {
							expect(
								worst,
								`${beard} on ${head} at ${fatness}`,
							).toBeLessThanOrEqual(5);
						}
					}
				}
			}
		}
		// The bug: without the fit, stubble misses the jaw line on most heads
		expect(misfits.before).toBeGreaterThan(100);
		expect(misfits.after).toBe(0);
	});

	test("beards stay within the head's width and follow the chin", () => {
		for (const head of HEADS) {
			for (const fatness of FATNESS) {
				const outline = headLines(head, fatness);
				const headXs = outline.flat().map((p) => p[0]);
				const headYs = outline.flat().map((p) => p[1]);
				const [minX, maxX] = [Math.min(...headXs), Math.max(...headXs)];
				const chin = Math.max(...headYs);
				for (const beard of BEARDS) {
					const lines = drawn(
						prepareFaceForDisplay(face(beard, head, fatness), {
							fitFacialHair: true,
						}),
					)[1]!.lines;
					const xs = lines.flat().map((p) => p[0]);
					// (the huge beard's sides bulge 4 px past the cheeks by design)
					const msg = `${beard} on ${head} at ${fatness}`;
					expect(Math.min(...xs), msg).toBeGreaterThanOrEqual(minX - 5);
					expect(Math.max(...xs), msg).toBeLessThanOrEqual(maxX + 5);
					// A stubble or chin piece ends at this head's chin, not head1's
					if (
						["fork-stubble", "fork-chin-patch", "goatee-thin"].includes(beard)
					) {
						const ys = lines.flat().map((p) => p[1]);
						expect(Math.max(...ys)).toBeLessThanOrEqual(chin + 0.5);
						expect(Math.max(...ys)).toBeGreaterThan(chin - 12);
					}
				}
			}
		}
	});

	test("mustaches, the middle of the face and everything above the jaw stay where they are", () => {
		const ref = headProfile(table.head![FIT_REFERENCE_HEAD]!)!;
		for (const head of HEADS) {
			const to = headProfile(table.head![head]!)!;
			for (const beard of BEARDS) {
				const before = table.facialHair![beard]!;
				const after = fitFacialHairSvg(before, ref, to);
				const a = [...before.matchAll(/\sd="([^"]+)"/g)].flatMap((m) =>
					flatten(parsePath(m[1]!)!).flat(),
				);
				const b = [...after.matchAll(/\sd="([^"]+)"/g)]
					.filter((m) => m[1] !== "M0 300H400")
					.flatMap((m) => flatten(parsePath(m[1]!)!).flat());
				// Sideburns still meet the hair: nothing above the jaw moves
				const top = (points: [number, number][]) =>
					points
						.filter(([, y]) => y < 299)
						.map(([x, y]) => `${Math.round(x)},${Math.round(y)}`);
				const bTop = new Set(top(b as [number, number][]));
				for (const p of top(a as [number, number][])) {
					expect(bTop.has(p), `${beard} on ${head}: ${p}`).toBe(true);
				}
			}
			for (const mustache of [
				"mustache1",
				"mustache-thin",
				"fork-mustache",
				"fork-handlebar",
				"fork-walrus",
			]) {
				const before = table.facialHair![mustache]!;
				expect(
					reachesJaw(parsePath(/\sd="([^"]+)"/.exec(before)![1]!)!, ref),
				).toBe(false);
				const after = fitFacialHairSvg(before, ref, to);
				const box = (svg: string) => {
					const points = [...svg.matchAll(/\sd="([^"]+)"/g)]
						.filter((m) => m[1] !== "M0 300H400")
						.flatMap((m) => flatten(parsePath(m[1]!)!).flat());
					return [
						Math.min(...points.map((p) => p[0])),
						Math.max(...points.map((p) => p[0])),
						Math.min(...points.map((p) => p[1])),
						Math.max(...points.map((p) => p[1])),
					];
				};
				const [b0, b1] = [box(before), box(after)];
				for (let i = 0; i < 4; i++) {
					expect(
						Math.abs(b0[i]! - b1[i]!),
						`${mustache} on ${head}`,
					).toBeLessThan(
						// the walrus and handlebar hang just below the mouth row
						i === 3 ? 2.5 : 0.5,
					);
				}
			}
		}
	});

	test("a greying beard keeps its own colour and the fitted shape", () => {
		const f = {
			...face("fork-boxed-beard", "fork-head-narrow-jaw", 0.5),
			fork: { beard: "#8a8a8a" },
		} as FaceConfig;
		const out = prepareFaceForDisplay(f, { fitFacialHair: true });
		expect(out.facialHair.id).toBe(
			"fork-boxed-beard~fb~fit-fork-head-narrow-jaw",
		);
		expect(out.facialHair.shave).toBe("#8a8a8a");
		const grey = table.facialHair![out.facialHair.id]!;
		const plain =
			table.facialHair![
				prepareFaceForDisplay(
					face("fork-boxed-beard", "fork-head-narrow-jaw", 0.5),
					{ fitFacialHair: true },
				).facialHair.id
			]!;
		expect(grey).toContain("$[faceShave]");
		expect(grey).toBe(plain.replaceAll("$[hairColor]", "$[faceShave]"));
		// The stored face is never changed
		expect(f.facialHair.id).toBe("fork-boxed-beard");
	});

	test("with face aging, the beard follows the fullness he gains (19 to 40)", () => {
		const base = {
			...face("fork-heavy-stubble", "fork-head-cheekbones", 0.3),
			eyeLine: { id: "none" },
			smileLine: { id: "none", size: 1 },
			miscLine: { id: "none" },
			glasses: { id: "none" },
		} as FaceConfig;
		let last = -1;
		for (const age of [19, 25, 30, 35, 40]) {
			const fields = agedFields(
				extractAgingFields(base),
				{ seed: 4242, age, born: 2000, weight: 260 } as never,
				{ ...DEFAULT_FACE_AGING_OPTIONS, styleEvents: false },
			);
			const aged = applyAgingFields(structuredClone(base), {
				...fields,
				fh: "fork-heavy-stubble",
			});
			expect(aged.fatness).toBeGreaterThanOrEqual(last);
			last = aged.fatness;
			// (drawn without the lines, so the head and facial hair are the only parts)
			const groups = drawn(
				prepareFaceForDisplay(
					face(aged.facialHair.id, aged.head.id, aged.fatness),
					{ fitFacialHair: true },
				),
			);
			expect(groups[1]!.transform).toBe(groups[0]!.transform);
		}
		expect(last).toBeGreaterThan(0.3);
	});
});
