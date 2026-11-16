// Draw-time layer for the fork's face extensions (common/faceAging.ts ForkFaceExtra), on top of facesjs' display.
//
// facesjs fills every feature with the one hair colour. A greying beard needs its own colour, so for a face with
// fork.beard the facial hair is drawn from a derived part ("<id>~fb", registered once per beard style, never listed in
// svgsIndex so editors and generate() never see it) whose $[hairColor] placeholders are $[faceShave] instead. facesjs
// replaces $[faceShave] with the feature's own "shave" value, so the render copy of the face sets facialHair.shave to the
// beard colour. Dyed or bleached hair (fork.hair) works the same way for the hair and hair behind the head ("~fd"), so the
// brows keep the natural colour. The stored face is never changed, and a face without fork extras is passed through untouched
// unless its facial hair is fitted to its head (fitFacialHair, below).
import type { FaceConfig } from "facesjs";
import { svgs } from "facesjs";
import type { FaceWithExtra } from "./faceAging.ts";
import { BATCH_D_PARTS } from "./faceParts.batchd.ts";
import {
	FIT_REFERENCE_HEAD,
	fitFacialHairSvg,
	headProfile,
} from "./faceFit.ts";

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

// Facial hair fitted to the head's jaw (common/faceFit.ts): a derived part "<id>~fit-<head id>", made once per (facial hair,
// head) and never listed in svgsIndex. Head outlines are measured once per head.
const profiles = new Map<string, ReturnType<typeof headProfile>>();
const profileOf = (headId: string) => {
	if (!profiles.has(headId)) {
		const svg = table.head?.[headId];
		profiles.set(headId, svg === undefined ? undefined : headProfile(svg));
	}
	return profiles.get(headId);
};

const fitFacialHair = (face: FaceConfig): FaceConfig => {
	const part = face.facialHair as { id: string } | undefined;
	const headId = face.head?.id;
	const parts = table.facialHair;
	if (
		!part ||
		part.id === "none" ||
		!parts ||
		parts[part.id] === undefined ||
		headId === undefined
	) {
		return face;
	}
	const id = `${part.id}~fit-${headId}`;
	if (parts[id] === undefined) {
		const ref = profileOf(FIT_REFERENCE_HEAD);
		const to = profileOf(headId);
		if (!ref || !to) {
			return face;
		}
		parts[id] = fitFacialHairSvg(parts[part.id]!, ref, to);
	}
	return { ...face, facialHair: { ...part, id } };
};

export type DisplayOptions = {
	// Fit the facial hair to the head's jaw (League Extras "New Face Styles" or "Face Aging" on). Off, a face that only uses
	// facesjs parts and has no fork extras is drawn exactly as facesjs draws it.
	fitFacialHair?: boolean;
};

export const prepareFaceForDisplay = (
	face: FaceConfig,
	options: DisplayOptions = {},
): FaceConfig => {
	const extra = (face as FaceWithExtra).fork;
	let out = face;
	if (extra) {
		out = recolor(out, "facialHair", extra.beard, "~fb");
		out = recolor(out, "hair", extra.hair, "~fd");
		out = recolor(out, "hairBg", extra.hair, "~fd");
	}
	if (options.fitFacialHair) {
		out = fitFacialHair(out);
	}
	return out;
};

// Facial injuries: a clear protective mask while he's out and for the rest of the season once he's back
const FACIAL_INJURIES = new Set([
	"Bruised Eye",
	"Facial Laceration",
	"Fractured Cheekbone",
	"Fractured Jaw",
	"Fractured Nose",
	"Fractured Orbital Socket",
]);

export const wearsFaceMask = (
	injury: { type: string; gamesRemaining: number } | undefined,
	injuries: readonly { season: number; type: string }[] | undefined,
	season: number,
) =>
	(injury !== undefined &&
		injury.gamesRemaining > 0 &&
		FACIAL_INJURIES.has(injury.type)) ||
	(injuries?.some(
		(row) => row.season === season && FACIAL_INJURIES.has(row.type),
	) ??
		false);

export const withFaceMask = (face: FaceConfig): FaceConfig => ({
	...face,
	glasses: { id: "facemask" },
});

// Nose and facial injuries: a nose bandage while he's out and for his first days back (common/faceParts.batchd.ts,
// League Extras "New Face Styles"). Drawn at render time, never stored, so it's gone once he's healed.
export const NOSE_INJURIES = new Set([
	"Facial Laceration",
	"Fractured Nose",
	"Skate to Face",
]);
// Days (the injury countdown is per day) after his return that he still wears it. Known only with the Injury Depth setting
// (p.health.returnGames counts the days back down from injuryDepth's RETURN_GAMES); otherwise only while he's out.
export const NOSE_BANDAGE_RETURN_DAYS = 10;

export const wearsNoseBandage = (
	injury: { type: string; gamesRemaining: number } | undefined,
	// His last injury and the days since he came back from it, if known
	recent?: { type: string | undefined; daysBack: number | undefined },
) =>
	(injury !== undefined &&
		injury.gamesRemaining > 0 &&
		NOSE_INJURIES.has(injury.type)) ||
	(recent !== undefined &&
		recent.type !== undefined &&
		recent.daysBack !== undefined &&
		recent.daysBack < NOSE_BANDAGE_RETURN_DAYS &&
		NOSE_INJURIES.has(recent.type) &&
		(injury === undefined || injury.gamesRemaining <= 0));

const NOSE_BANDAGE_SVG =
	BATCH_D_PARTS.find((part) => part.id === "fork-nose-bandage")?.svg ?? "";

// Drawn in the glasses slot (under any glasses or the clear mask), so a headband or other accessory stays: a derived part
// "<glasses id>~nb", registered once per glasses style and never listed in svgsIndex
export const withNoseBandage = (face: FaceConfig): FaceConfig => {
	const parts = table.glasses;
	const glasses = face.glasses?.id ?? "none";
	if (!parts) {
		return face;
	}
	const id = `${glasses}~nb`;
	if (parts[id] === undefined) {
		parts[id] = NOSE_BANDAGE_SVG + (parts[glasses] ?? "");
	}
	return { ...face, glasses: { ...face.glasses, id } };
};
