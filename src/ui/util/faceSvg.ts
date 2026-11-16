// Draws a facesjs face to an SVG string outside React, for exports (PDFs) that embed it as an image.
//
// facesjs centres and scales features (fatness, head and fitted beard anchors, see common/faceFit.ts) with getBBox, and a
// browser measures an element that isn't in the document as zero size, so a face drawn into a detached div comes out off
// centre or the wrong width. The face is drawn into a container that is in the document, at facesjs' own 400x600 size, but
// off screen and invisible (visibility, not display: none, which also measures as zero), and removed again once serialized.
import { display, type FaceConfig } from "facesjs";

type Overrides = Parameters<typeof display>[2];

export const OFFSCREEN_FACE_ATTRIBUTE = "data-offscreen-face";

const makeContainer = () => {
	const div = document.createElement("div");
	div.setAttribute(OFFSCREEN_FACE_ATTRIBUTE, "");
	div.setAttribute("aria-hidden", "true");
	Object.assign(div.style, {
		position: "fixed",
		left: "-10000px",
		top: "0",
		width: "400px",
		height: "600px",
		visibility: "hidden",
		pointerEvents: "none",
		overflow: "hidden",
	});
	return div;
};

// The face's <svg> markup (with xmlns, so it works as a standalone image), or undefined if facesjs drew nothing
export const faceToSvgMarkup = (
	face: FaceConfig,
	overrides?: Overrides,
): string | undefined => {
	const div = makeContainer();
	(document.body ?? document.documentElement).append(div);
	try {
		display(div, face, overrides);
		const svgEl = div.querySelector("svg");
		if (!svgEl) {
			return;
		}
		if (!svgEl.getAttribute("xmlns")) {
			svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		}
		return svgEl.outerHTML;
	} finally {
		div.remove();
	}
};
