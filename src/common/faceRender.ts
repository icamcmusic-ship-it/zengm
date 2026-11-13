// Draw-time layer for the fork's face extensions (common/faceAging.ts ForkFaceExtra), on top of facesjs' display.
//
// facesjs fills every feature with the one hair colour. A greying beard needs its own colour, so for a face with
// fork.beard the facial hair is drawn from a derived part ("<id>~fb", registered once per beard style, never listed in
// svgsIndex so editors and generate() never see it) whose $[hairColor] placeholders are $[faceShave] instead. facesjs
// replaces $[faceShave] with the feature's own "shave" value, so the render copy of the face sets facialHair.shave to the
// beard colour. Dyed or bleached hair (fork.hair) works the same way for the hair and hair behind the head ("~fd"), so the
// brows keep the natural colour. The stored face is never changed, and a face without fork extras is passed through untouched.
import type { FaceConfig } from "facesjs";
import { svgs } from "facesjs";
import type { FaceWithExtra } from "./faceAging.ts";

const table = svgs as unknown as Record<string, Record<string, string>>;

// Same rule as facesjs' own colour check (colours end up in innerHTML)
const COLOR_REGEX = /^[\d #%()+,./A-Za-z-]+$/;
const isValidColor = (color: unknown): color is string =>
	typeof color === "string" && COLOR_REGEX.test(color);

// Derived parts are made once per (feature, id): the same SVG with the hair colour placeholder read from the feature's own
// "shave" value instead
const derivedId = (feature: string, id: string, suffix: string) => {
	const derived = `${id}${suffix}`;
	const parts = table[feature];
	if (!parts) {
		return undefined;
	}
	if (parts[derived] === undefined) {
		const svg = parts[id];
		if (svg === undefined) {
			return undefined;
		}
		parts[derived] = svg.replaceAll("$[hairColor]", "$[faceShave]");
	}
	return derived;
};

// Draws a feature in its own colour, when it has one that differs from the hair colour
const recolor = (
	face: FaceConfig,
	feature: "facialHair" | "hair" | "hairBg",
	color: string | undefined,
	suffix: string,
): FaceConfig => {
	const part = face[feature] as { id: string } | undefined;
	if (
		color === undefined ||
		!isValidColor(color) ||
		!part ||
		part.id === "none" ||
		color === face.hair?.color
	) {
		return face;
	}
	const id = derivedId(feature, part.id, suffix);
	if (id === undefined) {
		return face;
	}
	return { ...face, [feature]: { ...part, id, shave: color } };
};

export const prepareFaceForDisplay = (face: FaceConfig): FaceConfig => {
	const extra = (face as FaceWithExtra).fork;
	if (!extra) {
		return face;
	}
	let out = recolor(face, "facialHair", extra.beard, "~fb");
	out = recolor(out, "hair", extra.hair, "~fd");
	out = recolor(out, "hairBg", extra.hair, "~fd");
	return out;
};
