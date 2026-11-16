import { describe, expect, test } from "vitest";
import { display, generate, type FaceConfig } from "facesjs";
import { prepareFaceForDisplay } from "../../common/faceRender.ts";
import { OFFSCREEN_FACE_ATTRIBUTE, faceToSvgMarkup } from "./faceSvg.ts";

// The face as the player page draws it: into a visible element in the document
const onPage = (face: FaceConfig) => {
	const div = document.createElement("div");
	div.style.width = "400px";
	div.style.height = "600px";
	document.body.append(div);
	try {
		display(div, face);
		const svg = div.querySelector("svg")!;
		svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		return svg.outerHTML;
	} finally {
		div.remove();
	}
};

// The old export path: a detached div, where getBBox measures zero
const detached = (face: FaceConfig) => {
	const div = document.createElement("div");
	display(div, face);
	const svg = div.querySelector("svg")!;
	svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
	return svg.outerHTML;
};

// Bounding box of each drawn feature, measured on the page
const boxes = (markup: string) => {
	const div = document.createElement("div");
	div.style.width = "400px";
	div.style.height = "600px";
	div.innerHTML = markup;
	document.body.append(div);
	try {
		return [...div.querySelector("svg")!.children]
			.filter((el): el is SVGGElement => el.tagName === "g")
			.map((g) => {
				const b = g.getBoundingClientRect();
				const svgBox = div.querySelector("svg")!.getBoundingClientRect();
				return { x: b.x - svgBox.x, width: b.width };
			});
	} finally {
		div.remove();
	}
};

const makeFace = (fatness: number, facialHair: string, fit: boolean) => {
	const face = generate({ race: "white" }, { gender: "male" }) as FaceConfig;
	face.fatness = fatness;
	face.head = { id: "head12", shave: "rgba(0,0,0,0)" } as FaceConfig["head"];
	face.facialHair = { id: facialHair } as FaceConfig["facialHair"];
	face.accessories = { id: "none" } as FaceConfig["accessories"];
	return prepareFaceForDisplay(face, { fitFacialHair: fit });
};

describe("faceToSvgMarkup", () => {
	for (const fatness of [0, 0.5, 1]) {
		for (const [facialHair, fit] of [
			["none", false],
			["beard1", true],
		] as const) {
			test(`draws like the page (fatness ${fatness}, ${fit ? "fitted beard" : "no beard"})`, () => {
				const face = makeFace(fatness, facialHair, fit);
				const markup = faceToSvgMarkup(face)!;
				expect(markup).toBe(onPage(face));
				expect(document.querySelector(`[${OFFSCREEN_FACE_ATTRIBUTE}]`)).toBe(
					null,
				);

				// Head (and beard) alone, so the measured boxes are just those
				const headOnly = { ...face } as any;
				for (const key of Object.keys(face)) {
					if (
						key !== "head" &&
						key !== "facialHair" &&
						typeof (face as any)[key] === "object" &&
						(face as any)[key]?.id !== undefined
					) {
						headOnly[key] = { ...(face as any)[key], id: "__skip" };
					}
				}
				const [head, ...rest] = boxes(faceToSvgMarkup(headOnly)!);
				expect(head!.x + head!.width / 2).toBeCloseTo(200, 0);
				const reference = boxes(onPage(headOnly))[0]!;
				expect(head!.width).toBeCloseTo(reference.width, 1);
				for (const box of rest) {
					expect(box.x + box.width / 2).toBeCloseTo(200, 0);
				}
			});
		}
	}

	test("a detached div (the old path) gets fatness wrong", () => {
		const face = makeFace(0, "none", false);
		expect(detached(face)).not.toBe(onPage(face));
	});

	test("draws into a container attached to the document", () => {
		const observer = new MutationObserver(() => {});
		observer.observe(document.body, { childList: true });
		faceToSvgMarkup(makeFace(0.5, "none", false));
		const records = observer.takeRecords();
		observer.disconnect();
		const isContainer = (node: Node) =>
			node instanceof HTMLElement &&
			node.hasAttribute(OFFSCREEN_FACE_ATTRIBUTE);
		// Added to the document while drawing, and removed again afterwards
		expect(records.some((r) => [...r.addedNodes].some(isContainer))).toBe(true);
		expect(records.some((r) => [...r.removedNodes].some(isContainer))).toBe(
			true,
		);
	});
});
