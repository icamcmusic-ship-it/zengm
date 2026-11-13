// Draw-time layer for the fork's face extensions (common/faceAging.ts ForkFaceExtra), on top of facesjs' display.
//
// facesjs fills every feature with the one hair colour. A greying beard needs its own colour, so for a face with
// fork.beard the facial hair is drawn from a derived part ("<id>~fb", registered once per beard style, never listed in
// svgsIndex so editors and generate() never see it) whose $[hairColor] placeholders are $[faceShave] instead. facesjs
// replaces $[faceShave] with the feature's own "shave" value, so the render copy of the face sets facialHair.shave to the
// beard colour. The stored face is never changed, and a face without fork.beard is passed through untouched.
import type { FaceConfig } from "facesjs";
import { svgs } from "facesjs";
import type { FaceWithExtra } from "./faceAging.ts";

const table = svgs as unknown as Record<string, Record<string, string>>;

// Same rule as facesjs' own colour check (colours end up in innerHTML)
const COLOR_REGEX = /^[\d #%()+,./A-Za-z-]+$/;
const isValidColor = (color: unknown): color is string =>
	typeof color === "string" && COLOR_REGEX.test(color);

const BEARD_SUFFIX = "~fb";

const derivedBeardId = (id: string) => {
	const derived = `${id}${BEARD_SUFFIX}`;
	const facialHair = table.facialHair!;
	if (facialHair[derived] === undefined) {
		const svg = facialHair[id];
		if (svg === undefined) {
			return undefined;
		}
		facialHair[derived] = svg.replaceAll("$[hairColor]", "$[faceShave]");
	}
	return derived;
};

export const prepareFaceForDisplay = (face: FaceConfig): FaceConfig => {
	const beard = (face as FaceWithExtra).fork?.beard;
	if (
		beard === undefined ||
		!isValidColor(beard) ||
		!face.facialHair ||
		face.facialHair.id === "none" ||
		beard === face.hair?.color
	) {
		return face;
	}
	const id = derivedBeardId(face.facialHair.id);
	if (id === undefined) {
		return face;
	}
	return {
		...face,
		facialHair: { ...face.facialHair, id, shave: beard } as any,
	};
};
