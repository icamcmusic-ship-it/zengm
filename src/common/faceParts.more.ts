// The fork's face style expansion, batch B: medium and long hair, the other features (brows, eyes, noses, ears, mouths,
// skin details) and accessories. Original SVG in facesjs' 400x600 face coordinates, registered through common/faceParts.ts.
// Eyes, brows, ears, noses and mouths use local coordinates: facesjs centres their bounding box on a fixed point (brows at
// (140, 270), eyes (140, 310), ears (55, 325), nose (200, 370), mouth (200, 440)), and mirrors eyes, brows and ears for the
// right side.
import type { StylePart } from "./faceParts.styles.ts";

const HAIR = 'fill="$[hairColor]" stroke="#000" stroke-width="4"';
const HAIR3 = 'fill="$[hairColor]" stroke="#000" stroke-width="3"';
const LINE = 'fill="none" stroke="#000" stroke-linecap="round"';

export const MORE_PARTS: readonly StylePart[] = [
	// ---------------------------------------------------------------------------------------------------------------
	// Medium and long hair
	{
		feature: "hair",
		id: "fork-slick-back",
		svg: `<path ${HAIR} d="M58 300H48c-2-130 40-206 152-206s154 76 152 206h-10c-2-16-8-30-16-38-4-24-8-50-20-66-30-12-66-16-106-16s-76 4-106 16c-12 16-16 42-20 66-8 8-14 22-16 38Z"/><path ${LINE} stroke-width="2" stroke-opacity=".5" d="M120 172c20-40 50-62 80-66m-48 64c14-34 34-54 56-60m-24 62c8-28 20-46 36-54m6 54c4-24 14-42 28-50m8 56c6-20 16-34 28-42"/>`,
	},
	{
		feature: "hair",
		id: "fork-pompadour",
		svg: `<path ${HAIR} d="M58 300H48c-4-120 30-180 80-200 20-30 60-42 96-38 50 4 82 24 96 52 24 30 34 80 32 186h-10c-2-16-8-30-16-38-4-24-8-50-20-66-30-12-66-16-106-16s-76 4-106 16c-12 16-16 42-20 66-8 8-14 22-16 38Z"/><path ${LINE} stroke-width="2" stroke-opacity=".5" d="M112 118c30-32 80-44 130-30m-120 54c34-30 84-40 140-24m-148 54c36-24 90-30 150-12"/>`,
	},
	{
		feature: "hair",
		id: "fork-half-up-bun",
		svg: `<path ${HAIR} d="M52 330H42c-6-150 46-236 158-236s164 86 158 236h-10c-4-40-10-72-22-96-6-12-10-24-14-36-34-8-72-12-112-12s-78 4-112 12c-4 12-8 24-14 36-12 24-18 56-22 96Z"/><path ${LINE} stroke-width="2" stroke-opacity=".5" d="M200 98v80m-40-72c-10 24-14 48-12 72m92-72c10 24 14 48 12 72"/><circle cx="200" cy="74" r="26" ${HAIR3}/><path ${LINE} stroke-width="1.5" stroke-opacity=".5" d="M182 68c10-10 26-10 36 0m-34 12c10 8 24 8 32 0"/>`,
	},
	{
		feature: "hairBg",
		id: "fork-long-wavy",
		svg: `<path ${HAIR} d="M52 240c-14 60-6 120-20 170-8 40 6 80 28 100 18 18 40 20 56 10-10-30-4-60-14-90-8-30-10-70-6-120zm296 0c14 60 6 120 20 170 8 40-6 80-28 100-18 18-40 20-56 10 10-30 4-60 14-90 8-30 10-70 6-120z"/><path ${LINE} stroke-width="2" stroke-opacity=".45" d="M50 300c-8 40 6 80-4 120m14-90c-6 40 8 80 2 120m286-150c8 40-6 80 4 120m-14-90c6 40-8 80-2 120"/>`,
	},
	{
		feature: "hair",
		id: "fork-middle-part-long",
		svg: `<path ${HAIR} d="M52 320H42c-6-150 46-226 158-226s164 76 158 226h-10c-6-46-16-82-36-104-22-24-50-34-76-38-14 10-26 26-36 44-10-18-22-34-36-44-26 4-54 14-76 38-20 22-30 58-36 104Z"/><path ${LINE} stroke-width="2" stroke-opacity=".5" d="M200 104v60m-28-52c-18 20-46 40-70 80m126-80c18 20 46 40 70 80"/>`,
	},
	{
		feature: "hairBg",
		id: "fork-mullet",
		svg: `<path ${HAIR} d="M50 250c-8 80 2 160 26 214 24 16 52 10 64-4-22-40-32-96-30-160zm300 0c8 80-2 160-26 214-24 16-52 10-64-4 22-40 32-96 30-160z"/><path ${LINE} stroke-width="2" stroke-opacity=".45" d="M70 320c0 40 8 80 20 110m240-110c0 40-8 80-20 110"/>`,
	},
	{
		feature: "hair",
		id: "fork-wolf-cut",
		svg: `<path ${HAIR} d="M48 340c-10-40-10-80-4-110-2-90 50-136 156-136s158 46 156 136c6 30 6 70-4 110l-12-30-6 22-10-56c-8-30-20-54-34-66l-12 28-14-36-18 30-20-34-14 34-14-34-20 34-18-30-14 36-12-28c-14 12-26 36-34 66l-10 56-6-22Z"/><path ${LINE} stroke-width="2" stroke-opacity=".45" d="M110 130c-10 20-14 40-12 60m60-74c-6 20-6 40-2 60m48-62c2 20 0 40-4 62m50-56c6 18 8 38 4 58"/>`,
	},
	{
		feature: "hairBg",
		id: "fork-slick-back-long",
		svg: `<path ${HAIR} d="M60 240c-6 70-2 140-6 210 30 20 52 22 72 10-16-50-22-110-20-190zm280 0c6 70 2 140 6 210-30 20-52 22-72 10 16-50 22-110 20-190z"/><path ${LINE} stroke-width="2" stroke-opacity=".45" d="M72 300c-2 40 0 90-4 140m264-140c2 40 0 90 4 140"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Brows (left brow, mirrored)
	{
		feature: "eyebrow",
		id: "fork-brow-unibrow",
		rarity: "rare",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M2 22C15 10 37 4 64 4s46 6 62 12c6 3 6 9 0 10-15-2-31 0-42 0C57 20 29 22 2 22Z"/>`,
	},
	{
		feature: "eyebrow",
		id: "fork-brow-slit",
		rarity: "uncommon",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M2 22C10 12 18 7 26 5l4 14C20 19 10 20 2 22Zm34-18c10-2 20-2 30-1 10 1 14 5 12 11-2 4-6 6-10 6-10-1-18-2-26-1Z"/>`,
	},
	{
		feature: "eyebrow",
		id: "fork-brow-thick-straight",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M2 14C12 6 30 3 50 3s28 2 32 6c3 4 2 12-2 14-10-2-22-3-34-3-16 0-30 2-44 6-2-4-2-8 0-12Z"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Eyes (left eye)
	{
		feature: "eye",
		id: "fork-eye-deep",
		svg: `<path fill="#000" fill-opacity=".14" d="M0 20C12 6 30 0 44 0s32 6 42 20C74 14 60 12 44 12S12 14 0 20Z"/><path fill="#fff" stroke="#000" stroke-width="4" d="M8 30C18 22 30 18 44 18s26 4 36 12C70 38 58 42 44 42S18 38 8 30Z"/><circle cx="44" cy="30" r="9"/><circle cx="47" cy="27" r="2.5" fill="#fff"/><path ${LINE} stroke-width="3" d="M4 16C18 8 30 6 44 6s28 2 40 10"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Noses
	{
		feature: "nose",
		id: "fork-nose-upturned",
		svg: `<path ${LINE} stroke-width="4" d="M30 2c2 14 6 30 16 42 4 6 2 12-4 14"/><path ${LINE} stroke-width="3.5" d="M14 50c4 6 10 8 16 6m24-6c-4 6-10 8-16 6"/><circle cx="23" cy="54" r="2.5"/><circle cx="45" cy="54" r="2.5"/>`,
	},
	{
		feature: "nose",
		id: "fork-nose-crooked",
		rarity: "uncommon",
		svg: `<path ${LINE} stroke-width="4" d="M24 2c4 10 10 18 8 28-2 8-8 14-6 24"/><path ${LINE} stroke-width="3.5" d="M10 56c6 8 16 10 24 8s16-6 20-12"/><path ${LINE} stroke-width="2.5" d="M18 58c2-4 6-6 10-4m14-2c2 2 2 4 0 6"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Ears (left ear)
	{
		feature: "ear",
		id: "fork-ear-cauliflower",
		rarity: "rare",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="M44 12C38 4 26 0 16 4 6 8 2 18 4 28c-4 6-2 14 4 18 0 8 6 14 14 16 8 2 16-2 22-8z"/><path fill="none" stroke="#000" stroke-width="3" stroke-linecap="round" d="M30 16c-8-2-14 4-12 10 2 4-2 8 2 12s10 2 12 6M14 22c4-2 6 0 6 4"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Mouths
	{
		feature: "mouth",
		id: "fork-mouth-gap",
		rarity: "rare",
		svg: `<path fill="#fff" stroke="#000" stroke-width="4" stroke-linejoin="round" d="M4 4c20 10 44 14 66 14S112 14 134 4c-6 18-30 32-64 32S10 22 4 4Z"/><path fill="none" stroke="#000" stroke-width="2.5" d="M66 18v14m6-14v14"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Skin details (miscLine, drawn as is)
	{
		feature: "miscLine",
		id: "fork-acne",
		// Given to young players by the generation rules (faceStyles.ts), not mixed in at random
		special: true,
		svg: `<g fill="#b8574a" fill-opacity=".45"><circle cx="128" cy="380" r="4"/><circle cx="140" cy="392" r="3"/><circle cx="120" cy="396" r="3.5"/><circle cx="272" cy="384" r="4"/><circle cx="262" cy="398" r="3"/><circle cx="214" cy="226" r="3.5"/><circle cx="188" cy="236" r="3"/><circle cx="208" cy="488" r="3"/></g>`,
	},
	{
		feature: "miscLine",
		id: "fork-lip-scar",
		rarity: "uncommon",
		svg: `<path fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round" d="M222 414l-8 34"/><path fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.5" stroke-linecap="round" d="M224 414l-8 34"/>`,
	},
	{
		feature: "miscLine",
		id: "fork-chin-scar",
		rarity: "uncommon",
		svg: `<path fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round" d="M176 486c8 4 18 6 26 4"/><path fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.5" stroke-linecap="round" d="M176 488c8 4 18 6 26 4"/>`,
	},
	{
		feature: "miscLine",
		id: "fork-face-tattoo",
		rarity: "rare",
		svg: `<path fill="#1f2a44" fill-opacity=".8" d="M276 352l4 9 10 1-8 6 3 10-9-6-9 6 3-10-8-6 10-1z"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Accessories and glasses
	{
		feature: "accessories",
		id: "fork-earring-studs",
		rarity: "uncommon",
		svg: `<circle cx="40" cy="346" r="6.5" fill="#dfe6ee" stroke="#000" stroke-width="2.5"/><circle cx="360" cy="346" r="6.5" fill="#dfe6ee" stroke="#000" stroke-width="2.5"/><circle cx="38" cy="344" r="2" fill="#fff"/><circle cx="358" cy="344" r="2" fill="#fff"/>`,
	},
	{
		feature: "accessories",
		id: "fork-bandana",
		rarity: "rare",
		svg: `<path fill="$[primary]" stroke="#000" stroke-width="4" d="M52 226c-2-90 52-140 148-140s150 50 148 140c-40-24-90-34-148-34S92 202 52 226Z"/><path fill="$[primary]" stroke="#000" stroke-width="3" d="M342 214l26 22-6 10-26-14zm-2 4l20 36-10 4-16-30z"/><g fill="#fff" fill-opacity=".8"><circle cx="120" cy="150" r="4"/><circle cx="160" cy="124" r="4"/><circle cx="200" cy="114" r="4"/><circle cx="240" cy="124" r="4"/><circle cx="280" cy="150" r="4"/><circle cx="140" cy="182" r="4"/><circle cx="200" cy="168" r="4"/><circle cx="260" cy="182" r="4"/></g>`,
	},
	{
		feature: "glasses",
		id: "fork-goggles-modern",
		rarity: "uncommon",
		svg: `<path fill="none" stroke="#111" stroke-width="10" d="M60 300c-6 0-10 4-10 10m300-10c6 0 10 4 10 10"/><path fill="#cfe6f5" fill-opacity=".45" stroke="#111" stroke-width="6" stroke-linejoin="round" d="M66 292c40-12 84-14 120-6 8 2 14 10 14 18 0-8 6-16 14-18 36-8 80-6 120 6 4 20-2 40-18 50-34 10-70 10-100-2-8-4-12-12-16-20-4 8-8 16-16 20-30 12-66 12-100 2-16-10-22-30-18-50Z"/><path fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="4" stroke-linecap="round" d="M84 300c20-6 40-8 60-6m112 0c20-2 40 0 60 6"/>`,
	},
];
