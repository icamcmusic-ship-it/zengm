// The fork's face style expansion (see docs/native-features.md "Faces"): original SVG in facesjs' 400x600 face coordinates and
// colour placeholders, registered through common/faceParts.ts. Head geometry used below (shared by every facesjs head):
// dome from (50, 300) over (200, 100) to (350, 300); the usual hairline runs from the sideburns at (60, 300) / (340, 300)
// up past the temples at about (90, 205) / (310, 205) to the middle of the forehead at about (200, 200). Eyes are at y 310,
// brows 270, nose 370, mouth 440, the chin about 500.
//
// Each part has a rarity tier for random generation (common/faceStyles.ts) and an optional "aging" flag for parts that only
// face aging hands out (receding hairlines, thinning).
import type { FacePart } from "./faceParts.ts";

export type StylePart = FacePart & {
	// Only given by face aging (or the user), never by random generation
	agingOnly?: true;
	// Given by a specific generation rule only (e.g. acne for young players), never mixed in at random
	special?: true;
	// How often random mixing picks it among the fork's parts of its feature (default common)
	rarity?: "common" | "uncommon" | "rare";
};

const HAIR = 'fill="$[hairColor]" stroke="#000" stroke-width="4"';
const BEARD = 'fill="$[hairColor]" stroke="#000" stroke-width="2"';

// Outer edge of short hair: up the right side, over the top, down the left side (ends at (340, 300) going right to left)
const DOME = "M60 300H50v-15c0-125 50-190 150-190s150 65 150 190v15h-10";
// The sides below the temples, right then left (used to close a hairline)
const RIGHT_SIDE = "c0-15-5-25-12-32c-6-6-5-40-12-58";
const LEFT_SIDE = "c-7 18-6 52-12 58c-7 7-12 17-12 32Z";

export const STYLE_PARTS: readonly StylePart[] = [
	// ---------------------------------------------------------------------------------------------------------------
	// Thinning / older hair (face aging stages; also selectable in Customize Player)
	{
		feature: "hair",
		id: "fork-recede-light",
		agingOnly: true,
		svg: `<path ${HAIR} d="${DOME}${RIGHT_SIDE}c-8-6-14-16-18-30c-30 6-60 14-98 14s-68-8-98-14c-4 14-10 24-18 30${LEFT_SIDE}"/>`,
	},
	{
		feature: "hair",
		id: "fork-widows-peak",
		agingOnly: true,
		svg: `<path ${HAIR} d="${DOME}${RIGHT_SIDE}c-8-6-14-18-18-34c-26 6-56 10-78 18l-20 18-20-18c-22-8-52-12-78-18c-4 16-10 28-18 34${LEFT_SIDE}"/>`,
	},
	{
		feature: "hair",
		id: "fork-recede-medium",
		agingOnly: true,
		svg: `<path ${HAIR} d="${DOME}c0-15-5-25-12-32c-6-6-4-40-10-62c-10-14-24-50-34-70c-20 10-50 32-84 32s-64-22-84-32c-10 20-24 56-34 70c-6 22-4 56-10 62c-7 7-12 17-12 32Z"/>`,
	},
	{
		feature: "hair",
		id: "fork-thinning-crown",
		agingOnly: true,
		svg: `<path fill="$[hairColor]" fill-opacity=".38" d="M92 200c0-60 48-96 108-96s108 36 108 96c-20-34-58-52-108-52s-88 18-108 52Z"/><path fill="none" stroke="$[hairColor]" stroke-width="3" stroke-linecap="round" stroke-opacity=".7" d="M140 132c20-8 40-10 60-10m10 4c24 0 40 6 54 14m-118 14c22-10 44-12 66-10"/><path ${HAIR} d="M60 300H50v-15c0-125 50-190 150-190s150 65 150 190v15h-10c0-15-5-25-12-32-6-6-5-40-12-60-6-56-56-96-116-96S90 152 84 208c-7 20-6 54-12 60-7 7-12 17-12 32Z"/>`,
	},
	{
		feature: "hair",
		id: "fork-comb-over",
		agingOnly: true,
		svg: `<path ${HAIR} d="M60 300H50v-15c0-125 50-190 150-190s150 65 150 190v15h-10c0-15-5-25-12-32-6-6-5-40-12-60-6-56-56-96-116-96S90 152 84 208c-7 20-6 54-12 60-7 7-12 17-12 32Z"/><path fill="none" stroke="$[hairColor]" stroke-width="5" stroke-linecap="round" d="M96 196c40-60 120-74 210-40M100 214c50-56 130-62 206-30M104 176c50-50 120-58 186-30"/><path fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-opacity=".6" d="M98 202c40-56 120-68 206-36"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Stubble and beards
	{
		feature: "facialHair",
		id: "fork-heavy-stubble",
		svg: `<path fill="$[hairColor]" fill-opacity=".48" d="M54 316c4 104 58 182 146 190 88-8 142-86 146-190-8 46-24 84-52 98-26 10-50-12-94-12s-68 22-94 12c-28-14-44-52-52-98Z"/><path fill="$[hairColor]" fill-opacity=".48" d="M148 428c14-18 38-22 52-12 14-10 38-6 52 12-16 4-36-2-52 4-16-6-36 0-52-4Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-patchy-stubble",
		svg: `<g fill="$[hairColor]" fill-opacity=".38"><path d="M70 372c10 30 26 48 42 54-4-26-20-44-42-54Z"/><path d="M330 372c-10 30-26 48-42 54 4-26 20-44 42-54Z"/><path d="M166 470c10 18 24 26 34 26s24-8 34-26c-14 6-24 8-34 8s-20-2-34-8Z"/><path d="M160 426c12-8 26-10 34-6-6 6-22 10-34 6Zm80 0c-12-8-26-10-34-6 6 6 22 10 34 6Z"/></g>`,
	},
	{
		feature: "facialHair",
		id: "fork-chin-stubble",
		svg: `<path fill="$[hairColor]" fill-opacity=".45" d="M150 462c10 30 30 44 50 44s40-14 50-44c-16 12-32 16-50 16s-34-4-50-16Z"/><path fill="$[hairColor]" fill-opacity=".45" d="M152 428c14-16 36-20 48-12 12-8 34-4 48 12-14 4-34 0-48 4-14-4-34 0-48-4Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-boxed-beard",
		svg: `<path ${BEARD} fill-rule="evenodd" d="M56 312c0 96 22 150 52 176 26 20 60 26 92 26s66-6 92-26c30-26 52-80 52-176-10 46-26 82-54 96-24 10-46-6-90-6s-66 16-90 6c-28-14-44-50-54-96Zm110 132c0-18 68-18 68 0s-68 18-68 0Z"/><path ${BEARD} d="M148 426c14-18 38-22 52-12 14-10 38-6 52 12-14 6-36 2-52 0-16 2-38 6-52 0Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-lineup-beard",
		svg: `<path ${BEARD} fill-rule="evenodd" d="M54 300h8c4 34 10 64 22 88l36-6c18-4 44-2 80-2s62-2 80 2l36 6c12-24 18-54 22-88h8c0 110-24 170-56 196-24 18-56 24-90 24s-66-6-90-24c-32-26-56-86-56-196Zm112 144c0-18 68-18 68 0s-68 18-68 0Z"/><path ${BEARD} d="M148 426c14-18 38-22 52-12 14-10 38-6 52 12-14 6-36 2-52 0-16 2-38 6-52 0Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-beard-line",
		svg: `<path ${BEARD} fill-rule="evenodd" d="M56 312c0 96 22 150 52 176 26 20 60 26 92 26s66-6 92-26c30-26 52-80 52-176-10 46-26 82-54 96-24 10-46-6-90-6s-66 16-90 6c-28-14-44-50-54-96Zm110 132c0-18 68-18 68 0s-68 18-68 0Z"/><path ${BEARD} d="M148 426c14-18 38-22 52-12 14-10 38-6 52 12-14 6-36 2-52 0-16 2-38 6-52 0Z"/><path fill="none" stroke="$[skinColor]" stroke-width="5" stroke-linecap="round" d="M290 378l26 26"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-huge-beard",
		svg: `<path ${BEARD} fill-rule="evenodd" d="M50 300H62C64 350 76 390 100 402C128 414 150 400 200 400S272 414 300 402C324 390 336 350 338 300H350C354 420 344 486 320 526C300 560 262 586 236 592C222 596 212 598 200 598S178 596 164 592C138 586 100 560 80 526C56 486 46 420 50 300ZM166 444c0-18 68-18 68 0s-68 18-68 0Z"/><path fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-opacity=".45" d="M118 500c10 30 24 50 40 70m84 0c16-20 30-40 40-70m-82 34v50"/><path ${BEARD} d="M144 428c14-20 40-24 56-14 16-10 42-6 56 14-16 6-38 2-56 0-18 2-40 6-56 0Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-anchor",
		svg: `<path ${BEARD} d="M184 462c4 0 10 2 16 2s12-2 16-2c2 16 8 24 20 28-10 14-24 22-36 22s-26-8-36-22c12-4 18-12 20-28Z"/><path ${BEARD} d="M150 428c12-16 36-20 50-12 14-8 38-4 50 12-14 4-34 0-50 2-16-2-36 2-50-2Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-handlebar",
		svg: `<path ${BEARD} d="M200 418c16-10 40-10 54 0 10 8 12 20 26 22 8 0 12-8 8-16 10 6 10 24-6 28-20 4-30-12-44-18-14-4-28-2-38-2s-24-2-38 2c-14 6-24 22-44 18-16-4-16-22-6-28-4 8 0 16 8 16 14-2 16-14 26-22 14-10 38-10 54 0Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-walrus",
		svg: `<path ${BEARD} d="M200 410c22-10 52-8 64 8 8 10 8 24 4 36-6-8-12-10-20-10-6 8-10 10-14 4-6 6-12 6-16 0-6 6-12 6-18 0-6 6-12 6-18 0-4 6-10 6-16 0-4 6-8 4-14-4-8 0-14 2-20 10-4-12-4-26 4-36 12-16 42-18 64-8Z"/>`,
	},
];
