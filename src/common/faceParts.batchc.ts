// The fork's face style expansion, batch C (see docs/native-features.md "Faces"). facesjs 5.0.4 is the latest release and its
// repository has no parts beyond it, so everything here is an original design, in facesjs' 400x600 face coordinates and
// colour placeholders, registered through common/faceParts.ts. Eyes, brows, ears, noses and mouths use local coordinates
// (facesjs centres their bounding box on a fixed point and mirrors eyes, brows and ears for the right side).
import { head } from "./faceParts.native.ts";
import type { StylePart } from "./faceParts.styles.ts";

const HAIR = 'fill="$[hairColor]" stroke="#000" stroke-width="4"';
const BEARD = 'fill="$[hairColor]" stroke="#000" stroke-width="2"';
const LINE = 'fill="none" stroke="#000" stroke-linecap="round"';
const SKIN = 'fill="$[skinColor]" stroke="#000" stroke-width="6"';

// Small coils on top of a short cut: rows of rings over the crown (fixed positions, no randomness)
const coils = () => {
	const rings: string[] = [];
	const rows = [
		{ y: 124, from: 150, to: 250 },
		{ y: 146, from: 112, to: 288 },
		{ y: 168, from: 92, to: 308 },
		{ y: 190, from: 84, to: 316 },
	];
	for (const [i, row] of rows.entries()) {
		const offset = i % 2 === 0 ? 0 : 9;
		for (let x = row.from + offset; x <= row.to; x += 18) {
			rings.push(`<circle cx="${x}" cy="${row.y}" r="6.5"/>`);
		}
	}
	return `<g fill="none" stroke="#000" stroke-opacity=".4" stroke-width="2">${rings.join("")}</g>`;
};

// A row of curls along a path of points, as small loops
const curls = (points: readonly (readonly [number, number])[]) =>
	`<path ${LINE} stroke-width="2" stroke-opacity=".5" d="${points
		.map(([x, y]) => `M${x - 6} ${y}a6 6 0 1 1 6 6`)
		.join("")}"/>`;

// The facesjs body outline (shoulders show beside the jersey: x 10..90 and 310..390, y 520..600)
const BODY =
	'<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="M10 600s0-50 60-70 70-50 70-50l60-180 60 180s10 30 70 50 60 70 60 70"/>';

export const BATCH_C_PARTS: readonly StylePart[] = [
	// ---------------------------------------------------------------------------------------------------------------
	// Hair
	{
		feature: "hair",
		id: "fork-curtains",
		rarity: "uncommon",
		svg: `<path ${HAIR} d="M58 300H48C44 170 88 94 200 94S356 170 352 300H342C340 262 334 236 318 218C300 232 276 240 258 236C236 222 214 186 200 152C186 186 164 222 142 236C124 240 100 232 82 218C66 236 60 262 58 300Z"/><path ${LINE} stroke-width="2" stroke-opacity=".5" d="M200 152C222 128 262 120 304 142M200 152C178 128 138 120 96 142M226 200C250 216 276 226 302 228M174 200C150 216 124 226 98 228"/>`,
	},
	{
		feature: "hair",
		id: "fork-french-crop",
		svg: `<path ${HAIR} d="M60 300H50v-15c0-125 50-190 150-190s150 65 150 190v15h-10c0-15-5-25-12-32-6-6-6-30-10-50C300 214 250 212 200 212S100 214 82 218c-4 20-4 44-10 50-7 7-12 17-12 32Z"/><path ${LINE} stroke-width="2" stroke-opacity=".5" d="M112 214l4-14m30 12l3-16m32 15l2-16m36 16l-2-16m32 17l-3-16m30 18l-4-14M130 150c20-14 46-20 70-20m24 4c22 4 40 12 54 22"/>`,
	},
	{
		feature: "hair",
		id: "fork-caesar",
		svg: `<path fill="$[hairColor]" fill-opacity=".8" stroke="#000" stroke-opacity=".6" stroke-width="2.5" d="M66 300H58C56 170 100 104 200 104S344 170 342 300H334C332 270 326 250 316 236C312 222 310 212 306 206C270 203 236 203 200 203S130 203 94 206C90 212 88 222 84 236C74 250 68 270 66 300Z"/><path ${LINE} stroke-width="1.5" stroke-opacity=".35" d="M110 204l2-8m22 8l1-8m22 8v-8m22 8v-8m22 8v-8m22 8v-8m22 8l-1-8m22 8l-2-8"/>`,
	},
	{
		feature: "hair",
		id: "fork-coils-short",
		svg: `<path ${HAIR} d="M60 300H50v-15c0-125 50-196 150-196s150 71 150 196v15h-10c0-15-5-25-12-32-6-6-5-40-12-60-30-12-74-16-116-16s-86 4-116 16c-7 20-6 54-12 60-7 7-12 17-12 32Z"/>${coils()}`,
	},
	{
		feature: "hair",
		id: "fork-curly-mop",
		rarity: "uncommon",
		svg: `<path ${HAIR} d="M56 300H46C40 200 60 120 110 96c30-20 60-24 90-24s60 4 90 24c50 24 70 104 64 204H344c-2-30-8-58-20-76-8 14-20 18-28 10-8 12-22 14-30 4-10 10-24 10-32 0-10 10-24 10-34 0-10 10-24 10-34 0-8 10-22 10-32 0-8 10-22 8-30-4-8 8-20 4-28-10-12 18-18 46-20 76Z"/>${curls(
			[
				[120, 120],
				[160, 100],
				[204, 94],
				[248, 102],
				[286, 122],
				[100, 166],
				[146, 148],
				[192, 140],
				[240, 146],
				[290, 166],
				[124, 196],
				[176, 186],
				[226, 188],
				[276, 198],
			],
		)}`,
	},
	{
		feature: "hairBg",
		id: "fork-curls-long",
		rarity: "rare",
		svg: `<path ${HAIR} d="M50 230c-18 40-22 90-12 130-10 20-8 46 6 62 2 22 20 38 42 36 16 14 40 10 50-6-14-26-22-60-22-100-4-40-2-80 4-110zm300 0c18 40 22 90 12 130 10 20 8 46-6 62-2 22-20 38-42 36-16 14-40 10-50-6 14-26 22-60 22-100 4-40 2-80-4-110z"/>${curls(
			[
				[58, 300],
				[64, 360],
				[84, 420],
				[112, 446],
				[342, 300],
				[336, 360],
				[316, 420],
				[288, 446],
			],
		)}`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Facial hair
	{
		feature: "facialHair",
		id: "fork-goatee-stubble",
		svg: `<path fill="$[hairColor]" fill-opacity=".3" d="M54 316c4 104 58 182 146 190 88-8 142-86 146-190-8 46-24 84-52 98-26 10-50-12-94-12s-68 22-94 12c-28-14-44-52-52-98Z"/><path ${BEARD} fill-rule="evenodd" d="M160 448c-4 30 14 58 40 60s44-30 40-60c-8 8-22 10-40 10s-32-2-40-10Zm22 10c0 8 36 8 36 0s-36-8-36 0Z"/><path ${BEARD} d="M148 428c14-18 38-22 52-12 14-10 38-6 52 12-14 6-36 2-52 0-16 2-38 6-52 0Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-fu-manchu",
		svg: `<path ${BEARD} d="M200 418c14-8 36-8 48 2 8 8 10 30 12 60 2 20 0 34-4 40-4-16-6-30-10-46-4-20-10-34-24-38-8-2-16-2-22-2s-14 0-22 2c-14 4-20 18-24 38-4 16-6 30-10 46-4-6-6-20-4-40 2-30 4-52 12-60 12-10 34-10 48-2Z"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Brows (left brow, inner end on the right)
	{
		feature: "eyebrow",
		id: "fork-brow-tapered",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M4 20C30 10 60 4 92 4c14 0 26 4 32 10 3 6 0 12-6 12-20-4-44-6-70-4-16 1-30 0-44-2Z"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Eyes (left eye)
	{
		feature: "eye",
		id: "fork-eye-monolid",
		svg: `<path fill="#fff" stroke="#000" stroke-width="4" d="M4 22C18 12 32 8 46 8s28 4 40 12C76 30 62 34 46 34S16 30 4 22Z"/><circle cx="46" cy="21" r="8.5"/><circle cx="49" cy="18" r="2.3" fill="#fff"/><path ${LINE} stroke-width="5" d="M4 22C18 10 32 6 46 6s30 4 40 14"/>`,
	},
	{
		feature: "eye",
		id: "fork-eye-downturned",
		svg: `<path fill="#fff" stroke="#000" stroke-width="4" d="M2 30C10 16 26 8 44 8s34 8 42 18C74 30 58 34 42 34S14 34 2 30Z"/><circle cx="46" cy="22" r="9"/><circle cx="49" cy="19" r="2.5" fill="#fff"/><path ${LINE} stroke-width="2.5" d="M6 20C16 6 30 0 46 0s30 6 38 16"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Noses
	{
		feature: "nose",
		id: "fork-nose-pointed",
		svg: `<path ${LINE} stroke-width="4" d="M26 2c2 18 4 34 12 48 3 6 0 10-6 10"/><path ${LINE} stroke-width="3.5" d="M10 52c4 6 10 8 16 8m26-8c-4 6-8 8-14 8"/>`,
	},
	{
		feature: "nose",
		id: "fork-nose-bulb",
		rarity: "uncommon",
		svg: `<path ${LINE} stroke-width="4" d="M32 2c0 14-2 26-4 34"/><path ${LINE} stroke-width="4" d="M20 40c-12 2-18 12-12 20 4 4 10 4 14 0m28-20c12 2 18 12 12 20-4 4-10 4-14 0M22 60c4 4 8 6 14 6s10-2 14-6"/><path ${LINE} stroke-width="2.5" stroke-opacity=".6" d="M28 42c6-4 12-4 16 0"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Ears (left ear)
	{
		feature: "ear",
		id: "fork-ear-pointed",
		rarity: "rare",
		svg: `<path ${SKIN} d="M44 16C36 6 22 0 4-4c4 12 0 26 2 40s10 22 20 26c8 2 18-4 18-4z"/><path ${LINE} stroke-width="3" d="M32 22C24 14 16 10 12 8m18 18c-8-2-14 4-12 12s8 12 12 10"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Mouths
	{
		feature: "mouth",
		id: "fork-mouth-mouthguard",
		rarity: "rare",
		svg: `<path fill="$[primary]" stroke="#000" stroke-width="4" stroke-linejoin="round" d="M4 6c24 10 48 14 68 14s44-4 68-14c-8 22-34 36-68 36S12 28 4 6Z"/><path fill="#fff" fill-opacity=".35" d="M22 14c18 6 32 8 50 8s32-2 50-8c-6 6-24 14-50 14S28 20 22 14Z"/>`,
	},
	{
		feature: "mouth",
		id: "fork-mouth-pursed",
		rarity: "uncommon",
		svg: `<path fill="#000" fill-opacity=".14" stroke="#000" stroke-width="3" stroke-linejoin="round" d="M8 10c10-6 24-6 32 0 8-6 22-6 32 0-8 8-20 14-32 14S16 18 8 10Z"/><path ${LINE} stroke-width="3.5" d="M6 10c12 4 22 5 34 5s22-1 34-5"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Heads (the shared facesjs top, a new jaw)
	head(
		"fork-head-cheekbones",
		"C352 340 344 380 326 410C306 450 262 494 220 502C210 504 190 504 180 502C138 494 94 450 74 410C56 380 48 340 50 300",
	),
	head(
		"fork-head-narrow-jaw",
		"C346 380 324 460 280 492C258 506 228 508 200 508S142 506 120 492C76 460 54 380 50 300",
	),

	// ---------------------------------------------------------------------------------------------------------------
	// Skin details (miscLine, drawn as is)
	{
		feature: "miscLine",
		id: "fork-nose-scar",
		rarity: "uncommon",
		svg: `<path fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="4" stroke-linecap="round" d="M186 344l26-8"/><path fill="none" stroke="#000" stroke-opacity=".35" stroke-width="1.5" stroke-linecap="round" d="M186 346l26-8"/>`,
	},
	{
		feature: "miscLine",
		id: "fork-teardrop-tattoo",
		rarity: "rare",
		svg: `<path fill="#1f2a44" fill-opacity=".8" d="M118 340c4 7 7 11 7 15a7 7 0 0 1-14 0c0-4 3-8 7-15Z"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Accessories
	{
		feature: "accessories",
		id: "fork-nasal-strip",
		rarity: "rare",
		svg: `<rect x="174" y="342" width="52" height="13" rx="6" fill="#e2c7a6" stroke="#000" stroke-width="2"/><path fill="none" stroke="#000" stroke-opacity=".3" stroke-width="1.5" d="M184 348.5h32"/>`,
	},
	{
		feature: "accessories",
		id: "fork-headband-stripe",
		rarity: "uncommon",
		svg: `<g stroke="#000"><path fill="$[primary]" stroke-width="4" d="M350 280c-10 0-30-50-150-50S60 280 50 280c-10-10-10-40 0-50 0 0 30-50 150-50s150 50 150 50c10 10 10 40 0 50Z"/><path fill="none" stroke="$[secondary]" stroke-width="6" d="M50 246c24-22 64-44 150-44s126 22 150 44M50 264c24-20 64-40 150-40s126 20 150 40"/></g>`,
	},
	{
		feature: "accessories",
		id: "fork-earring-single",
		rarity: "uncommon",
		svg: `<path fill="#f2d16b" stroke="#000" stroke-width="2.5" d="M356 344l6 8-6 8-6-8z"/><circle cx="355" cy="349" r="1.6" fill="#fff"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Body (tattoos on the shoulders beside the jersey)
	{
		feature: "body",
		id: "fork-body-shoulder-tattoo",
		rarity: "uncommon",
		svg: `${BODY}<path fill="none" stroke="#1d3557" stroke-opacity=".7" stroke-width="4" stroke-linecap="round" d="M30 566c10-8 24-10 36-6M26 580c12-8 28-10 42-6M40 552l6 8 6-10"/>`,
	},
	{
		feature: "body",
		id: "fork-body-arm-script",
		rarity: "rare",
		svg: `${BODY}<path fill="none" stroke="#1d3557" stroke-opacity=".7" stroke-width="3" stroke-linecap="round" d="M326 562c4-6 8-6 8 0s4 6 8 0 6-6 8 0 4 6 8 0 6-6 8 2m-36 18c4-4 8-4 10 0s6 4 10 0 6-4 10 0"/>`,
	},
];
