// The fork's own male face parts: original SVG drawn for this fork in facesjs' coordinate system and colour placeholders
// (facesjs itself is Apache-2.0, see node_modules/facesjs/LICENSE; nothing here is copied from its catalog). Registered
// through common/faceParts.ts.
//
// How facesjs places each feature (see its display code):
// - head, hairBg, hair, facialHair, glasses, accessories, eyeLine, miscLine, body: drawn as is in the 400x600 face box
//   (head 50..350 x 100..500, eyes at y 310, brows 270, nose 370, mouth 440).
// - eye, eyebrow, ear, mouth, nose, smileLine: the part's bounding box is centred on a fixed point, so these use local
//   coordinates. Eyes, brows, ears and smile lines are drawn for the left side (the viewer's left) and mirrored for the right.
import type { FacePart } from "./faceParts.ts";

// facesjs heads share one top: these build a head from a lower outline that goes from (350, 300) round the chin to (50, 300)
const HEAD_TOP = "M200 100c100 0 150 60 150 200";
const HEAD_SHAVE =
	'<path fill="$[headShave]" d="M60 300H50c0-140 50-200 150-200s150 60 150 200h-10v-10c0-5-10-20-15-25s-5-55-15-65c-40-40-60 0-110 0s-70-40-110 0c-10 10-10 60-15 65s-15 20-15 25z"/>';
const head = (id: string, lower: string, extra = ""): FacePart => ({
	feature: "head",
	id,
	svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="${HEAD_TOP}${lower}c0-140 50-200 150-200Z"/><path fill="$[faceShave]" d="M200 410c30 0 50 10 50 10 30 0 90-15 90-120h10${lower}h10c0 105 60 120 90 120 0 0 20-10 50-10Z"/>${HEAD_SHAVE}${extra}`,
});

const LINE = 'fill="none" stroke="#000" stroke-linecap="round"';

export const NATIVE_FACE_PARTS: readonly FacePart[] = [
	// Heads
	head(
		"fork-head-square",
		"C350 365 345 425 318 458C292 490 250 500 200 500S108 490 82 458C55 425 50 365 50 300",
	),
	head(
		"fork-head-long",
		"C350 390 305 470 255 500C235 512 165 512 145 500C95 470 50 390 50 300",
	),
	head(
		"fork-head-wide",
		"C353 355 348 405 332 440C310 485 262 502 200 502S90 485 68 440C52 405 47 355 50 300",
	),
	head(
		"fork-head-cleft",
		"C350 370 342 430 312 465C288 492 245 500 212 500C206 500 203 494 200 488C197 494 194 500 188 500C155 500 112 492 88 465C58 430 50 370 50 300",
	),
	head(
		"fork-head-vchin",
		"C350 370 322 438 265 482C238 503 218 510 200 510S162 503 135 482C78 438 50 370 50 300",
	),

	// Ears (left ear, opening to the right)
	{
		feature: "ear",
		id: "fork-ear-round",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="M44 12C32 3 20 0 11 5 3 11 2 28 5 41s12 23 23 25c8 1 16-5 16-5z"/><path ${LINE} stroke-width="3" d="M32 22c-9-5-16 1-14 12s9 15 13 12"/>`,
	},
	{
		feature: "ear",
		id: "fork-ear-small",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="M38 14C27 7 15 7 10 14s-3 26 3 36 25 8 25 8z"/><path ${LINE} stroke-width="3" d="M28 24c-6-2-10 3-8 10"/>`,
	},
	{
		feature: "ear",
		id: "fork-ear-large",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="M48 12C35 1 16-2 7 8-1 20 0 46 9 60s30 18 39 8z"/><path ${LINE} stroke-width="3" d="M36 22c-12-6-22 0-20 14s8 22 16 22m-8-26c5 0 8 4 6 10"/>`,
	},
	{
		feature: "ear",
		id: "fork-ear-lobe",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="M42 10C30 3 16 2 9 9 3 17 4 32 7 42c2 8 0 16 6 22 7 6 16 4 20 0 5-4 9-5 9-5z"/><path ${LINE} stroke-width="3" d="M31 20c-8-3-14 3-12 12s6 12 10 12"/>`,
	},

	// Eyes (left eye)
	{
		feature: "eye",
		id: "fork-eye-almond",
		svg: `<path fill="#fff" stroke="#000" stroke-width="5" d="M3 30C14 14 28 7 42 7s27 8 37 22C67 37 53 40 40 40S14 37 3 30Z"/><circle cx="42" cy="24" r="11"/><circle cx="46" cy="20" r="3" fill="#fff"/>`,
	},
	{
		feature: "eye",
		id: "fork-eye-hooded",
		svg: `<path fill="#fff" stroke="#000" stroke-width="5" d="M3 24C16 16 30 14 42 14s26 4 36 12C66 34 52 36 40 36S14 32 3 24Z"/><path d="M33 16h18c3 5 3 13-2 17-3 2-11 2-14 0-5-4-5-12-2-17Z"/><path ${LINE} stroke-width="7" d="M2 22C16 12 30 9 42 9s28 4 38 16"/><path ${LINE} stroke-width="3" d="M10 8C24 2 46 0 70 8"/>`,
	},
	{
		feature: "eye",
		id: "fork-eye-narrow",
		svg: `<path fill="#fff" stroke="#000" stroke-width="5" d="M3 22C22 11 54 10 77 19 58 30 22 32 3 22Z"/><ellipse cx="41" cy="20" rx="9" ry="8"/><path ${LINE} stroke-width="2" d="M14 33c14 4 34 4 50-1"/>`,
	},
	{
		feature: "eye",
		id: "fork-eye-round",
		svg: `<path fill="#fff" stroke="#000" stroke-width="5" d="M4 28C6 13 20 4 36 4s32 9 33 24-15 20-33 20S2 42 4 28Z"/><circle cx="37" cy="26" r="12"/><circle cx="41" cy="22" r="3.5" fill="#fff"/>`,
	},
	{
		feature: "eye",
		id: "fork-eye-tired",
		svg: `<path fill="#fff" stroke="#000" stroke-width="5" d="M3 26C14 17 28 13 42 13s26 6 36 15C66 36 52 38 40 38S14 34 3 26Z"/><path d="M33 15c-4 5-4 15 0 19 4 4 12 4 16 0 4-4 4-14 0-19z"/><path ${LINE} stroke-width="5" d="M3 24C16 15 30 12 42 12s26 5 36 14"/><path ${LINE} stroke-width="2.5" d="M12 44c14 7 40 7 56-2"/>`,
	},

	// Eyebrows (left brow, inner end on the right)
	{
		feature: "eyebrow",
		id: "fork-brow-straight",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M3 16C22 9 52 6 81 8c3 4 3 9 0 13C52 19 24 21 5 25c-3-3-4-6-2-9Z"/>`,
	},
	{
		feature: "eyebrow",
		id: "fork-brow-arched",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M3 24C16 8 36 2 52 3s26 6 30 12c1 3 0 6-3 7-6-4-16-9-28-9S18 18 6 30c-3-1-4-3-3-6Z"/>`,
	},
	{
		feature: "eyebrow",
		id: "fork-brow-angry",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M3 6c28 1 54 8 79 20 2 3 0 7-4 8C56 26 30 18 4 16 1 13 1 9 3 6Z"/>`,
	},
	{
		feature: "eyebrow",
		id: "fork-brow-bushy",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M3 20 8 12l3 5 5-9 4 6 6-9 4 6 7-8 4 6 7-7 4 6 8-6 3 6 8-5 3 6 6-3c3 6 3 14 0 19-26-3-56 1-77 7-3-2-4-5-3-8Z"/>`,
	},
	{
		feature: "eyebrow",
		id: "fork-brow-thin",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M3 18C20 8 50 4 80 10c1 2 1 4-1 5C52 10 24 14 6 22c-2-1-3-2-3-4Z"/>`,
	},

	// Noses (centred on the nose point)
	{
		feature: "nose",
		id: "fork-nose-button",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="5" stroke-linecap="round" d="M183 372c-12 0-12 16 0 16 5 4 11 6 17 6s12-2 17-6c12 0 12-16 0-16"/><path ${LINE} stroke-width="3" d="M190 386c3 2 6 2 7 0m6 0c1 2 4 2 7 0"/>`,
	},
	{
		feature: "nose",
		id: "fork-nose-bridge",
		svg: `<path ${LINE} stroke-width="5" d="M203 318c3 22 12 44 18 58 4 10-4 16-16 16-6 0-10-1-14-4"/><path ${LINE} stroke-width="4" d="M180 384c-6 0-8 6-3 9"/>`,
	},
	{
		feature: "nose",
		id: "fork-nose-wide",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="5" stroke-linecap="round" d="M172 376c-12 2-10 20 4 18 8 6 16 7 24 5 8 2 16 1 24-5 14 2 16-16 4-18"/><path ${LINE} stroke-width="5" d="M186 348c-4 12-8 22-14 28m42-28c4 12 8 22 14 28"/><ellipse cx="188" cy="390" rx="5" ry="3"/><ellipse cx="212" cy="390" rx="5" ry="3"/>`,
	},
	{
		feature: "nose",
		id: "fork-nose-hooked",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="5" stroke-linecap="round" d="M196 320c6 10 14 30 22 46 6 12 4 24-8 24-6 0-8-4-14-4-6 0-10 4-16 2-8-3-6-14 2-16"/>`,
	},
	{
		feature: "nose",
		id: "fork-nose-flat",
		svg: `<path ${LINE} stroke-width="5" d="M176 380c-8 4-4 14 6 12 6 4 12 4 18 4s12 0 18-4c10 2 14-8 6-12"/><path ${LINE} stroke-width="3" d="M193 372c-3 6-2 10 2 12m10-12c3 6 2 10-2 12"/>`,
	},

	// Mouths (centred on the mouth point)
	{
		feature: "mouth",
		id: "fork-mouth-grin",
		svg: `<path fill="#fff" stroke="#000" stroke-width="5" stroke-linejoin="round" d="M4 6c20 6 72 6 92 0-4 18-22 28-46 28S8 24 4 6Z"/><path ${LINE} stroke-width="2" d="M14 12c22 4 50 4 72 0"/>`,
	},
	{
		feature: "mouth",
		id: "fork-mouth-smirk",
		svg: `<path ${LINE} stroke-width="5" d="M3 14c18 2 40 2 56-2 10-3 16-8 20-12"/><path ${LINE} stroke-width="3" d="M74 4c4 2 6 6 5 10"/>`,
	},
	{
		feature: "mouth",
		id: "fork-mouth-lips",
		svg: `<path fill="#000" fill-opacity=".16" d="M4 12c12-8 24-10 34-6 6-3 12-3 18 0 10-4 22-2 34 6-14 10-30 14-43 14S18 22 4 12Z"/><path ${LINE} stroke-width="4" d="M4 12c20 4 66 4 86 0"/><path ${LINE} stroke-width="2" d="M30 24c12 3 22 3 34 0"/>`,
	},
	{
		feature: "mouth",
		id: "fork-mouth-frown",
		svg: `<path ${LINE} stroke-width="5" d="M3 18C18 6 52 4 72 18"/>`,
	},
	{
		feature: "mouth",
		id: "fork-mouth-shout",
		svg: `<path fill="#2a0f0f" stroke="#000" stroke-width="5" stroke-linejoin="round" d="M8 6c18-6 46-6 64 0 4 14-2 34-32 34S4 20 8 6Z"/><path fill="#fff" d="M12 8c18-4 38-4 56 0l-2 7c-16-3-36-3-52 0Z"/><path fill="#c25454" d="M20 34c8-8 32-8 40 0-10 5-30 5-40 0Z"/>`,
	},

	// Hair
	{
		feature: "hair",
		id: "fork-waves",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M60 300H50v-15c0-125 50-190 150-190s150 65 150 190v15h-10c0-15-5-25-12-32-6-6-3-50-14-60-28-25-64-30-114-30s-86 5-114 30c-11 10-8 54-14 60-7 7-12 17-12 32Z"/><path ${LINE} stroke-width="2.5" stroke-opacity=".55" d="M110 140c20-10 40 8 60-2s40-10 60 0 40-8 60 2m-196 30c25-10 45 8 65-2s45-10 70 0 45-8 65 2M86 202c20-6 38 6 56 0m116 0c18 6 36-6 56 0"/>`,
	},
	{
		feature: "hair",
		id: "fork-twists",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M60 300H50v-15c0-125 50-190 150-190s150 65 150 190v15h-10c0-15-5-25-12-32-6-6-3-50-14-60-28-25-64-30-114-30s-86 5-114 30c-11 10-8 54-14 60-7 7-12 17-12 32Z"/><g fill="$[hairColor]" stroke="#000" stroke-width="3"><circle cx="92" cy="150" r="15"/><circle cx="118" cy="122" r="16"/><circle cx="150" cy="104" r="16"/><circle cx="184" cy="96" r="16"/><circle cx="216" cy="96" r="16"/><circle cx="250" cy="104" r="16"/><circle cx="282" cy="122" r="16"/><circle cx="308" cy="150" r="15"/><circle cx="134" cy="138" r="14"/><circle cx="166" cy="124" r="14"/><circle cx="200" cy="120" r="14"/><circle cx="234" cy="124" r="14"/><circle cx="266" cy="138" r="14"/></g>`,
	},
	{
		feature: "hair",
		id: "fork-side-part",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M60 300H50c-4-90 6-160 50-190 30-20 70-24 100-24 60 0 120 20 140 80 12 36 12 90 10 134h-10c0-15-5-25-12-32-6-6-4-50-14-62-14-16-46-36-96-40-50 4-92 20-110 26-10 6-5 70-12 76-7 7-12 17-12 32Z"/><path ${LINE} stroke-width="3" d="M150 92c-8 30-10 60-6 86"/><path ${LINE} stroke-width="2" stroke-opacity=".5" d="M170 120c40-6 100 4 140 40M180 150c40-2 80 10 110 30"/>`,
	},
	{
		feature: "hair",
		id: "fork-undercut",
		svg: `<path fill="$[hairColor]" fill-opacity=".45" d="M60 300H50v-15c0-125 50-190 150-190s150 65 150 190v15h-10c0-15-5-25-12-32-6-6-3-50-14-60-28-25-64-30-114-30s-86 5-114 30c-11 10-8 54-14 60-7 7-12 17-12 32Z"/><path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M72 214c-8-76 38-132 128-132 76 0 124 34 134 90 3 16 1 32-4 42-22-28-62-40-130-40-56 0-98 14-128 40Z"/><path ${LINE} stroke-width="2" stroke-opacity=".5" d="M120 120c40-16 120-16 170 14M110 150c50-14 130-10 180 14"/>`,
	},
	{
		feature: "hair",
		id: "fork-receding",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M60 300H50v-15c0-125 50-190 150-190s150 65 150 190v15h-10c0-15-5-25-12-32-6-6-4-40-10-60-14-6-24-26-30-46-30-14-60-16-88-16s-58 2-88 16c-6 20-16 40-30 46-6 20-4 54-10 60-7 7-12 17-12 32Z"/>`,
	},
	{
		feature: "hair",
		id: "fork-top-knot",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M60 300H50v-15c0-125 50-190 150-190s150 65 150 190v15h-10c0-15-5-25-12-32-6-6-3-50-14-60-28-25-64-30-114-30s-86 5-114 30c-11 10-8 54-14 60-7 7-12 17-12 32Z"/><path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M172 96c-10-30 6-52 28-52s38 22 28 52c-10 6-46 6-56 0Z"/><path fill="none" stroke="#000" stroke-width="4" d="M174 96c16 5 36 5 52 0"/><path ${LINE} stroke-width="2" stroke-opacity=".5" d="M100 180c30-30 70-50 100-50s70 20 100 50M200 98v32"/>`,
	},

	// Hair behind the head
	{
		feature: "hairBg",
		id: "fork-shoulder-length",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M200 92c-110 0-160 70-162 180-1 70-6 140-20 190 30 10 60 4 80-6l10-140h184l10 140c20 10 50 16 80 6-14-50-19-120-20-190-2-110-52-180-162-180Z"/>`,
	},
	{
		feature: "hairBg",
		id: "fork-locs",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M200 92c-110 0-160 70-162 180 0 50-6 120-12 170 6 8 14 8 18 0 2-40 6-80 10-110l4 140c6 8 14 8 18 0l2-150 6 120c6 8 14 8 18 0l4-130h188l4 130c4 8 12 8 18 0l6-120 2 150c4 8 12 8 18 0l4-140c4 30 8 70 10 110 4 8 12 8 18 0-6-50-12-120-12-170-2-110-52-180-162-180Z"/>`,
	},
	{
		feature: "hairBg",
		id: "fork-low-ponytail",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M200 92c-110 0-160 70-162 180-1 30 4 60 14 80h296c10-20 15-50 14-80-2-110-52-180-162-180Z"/><path fill="$[hairColor]" stroke="#000" stroke-width="4" d="M330 340c24 20 40 60 36 110-2 30-12 52-24 62-2-40-8-70-26-100-8-14-10-40 14-72Z"/>`,
	},

	// Facial hair
	{
		feature: "facialHair",
		id: "fork-mustache",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="2" d="M156 420c10-14 30-18 44-10 14-8 34-4 44 10 4 7-4 12-14 8-10-5-20-6-30-2-10-4-20-3-30 2-10 4-18-1-14-8Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-horseshoe",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="2" d="M150 424c12-16 34-20 50-12 16-8 38-4 50 12 4 6 6 16 6 30v38c0 6-10 8-12 0l-4-40c-2-12-4-16-10-18-10-4-20-5-30-1-10-4-20-3-30 1-6 2-8 6-10 18l-4 40c-2 8-12 6-12 0v-38c0-14 2-24 6-30Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-chin-patch",
		svg: `<path fill="$[hairColor]" stroke="#000" stroke-width="2" d="M186 462c8-3 20-3 28 0l4 22c-4 14-32 14-36 0Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-stubble",
		svg: `<path fill="$[hairColor]" fill-opacity=".3" d="M56 320c4 100 56 170 144 180 88-10 140-80 144-180-8 44-26 82-56 94-24 8-48-14-88-14s-64 22-88 14c-30-12-48-50-56-94Z"/><path fill="$[hairColor]" fill-opacity=".3" d="M150 426c14-14 36-16 50-10 14-6 36-4 50 10-16 2-34-4-50 2-16-6-34 0-50-2Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-full-beard",
		svg: `<path fill="$[hairColor]" fill-rule="evenodd" stroke="#000" stroke-width="2" d="M54 310c0 130 60 210 146 212 86-2 146-82 146-212-8 50-22 86-46 100-26 14-48 4-100 4s-74 10-100-4c-24-14-38-50-46-100Zm110 130c0-16 72-16 72 0s-72 16-72 0Z"/><path fill="$[hairColor]" stroke="#000" stroke-width="2" d="M150 424c14-16 36-20 50-12 14-8 36-4 50 12-14 6-34 2-50 0-16 2-36 6-50 0Z"/>`,
	},

	// Glasses
	{
		feature: "glasses",
		id: "fork-glasses-round",
		svg: `<g fill="rgba(170,190,215,.3)" stroke="#222" stroke-width="6"><circle cx="140" cy="312" r="36"/><circle cx="260" cy="312" r="36"/></g><path fill="none" stroke="#222" stroke-width="6" d="M176 306c10-8 38-8 48 0M104 304 56 290m240 14 48-14"/><path fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" d="M120 296c6-6 14-8 22-8m98 8c6-6 14-8 22-8"/>`,
	},
	{
		feature: "glasses",
		id: "fork-glasses-rect",
		svg: `<g fill="rgba(170,190,215,.3)" stroke="$[primary]" stroke-width="7"><rect width="80" height="46" x="98" y="288" rx="8"/><rect width="80" height="46" x="222" y="288" rx="8"/></g><path fill="none" stroke="#000" stroke-width="2"  d="M98 296h80m44 0h80"/><path fill="none" stroke="$[primary]" stroke-width="7" d="M178 304c12-6 32-6 44 0M98 300H54m248 0h44"/>`,
	},
	{
		feature: "glasses",
		id: "fork-goggles",
		svg: `<path fill="$[primary]" stroke="#000" stroke-width="3" d="M54 299h40v18H54zm252 0h40v18h-40z"/><path fill="rgba(200,220,240,.35)" stroke="#111" stroke-width="7" d="M94 290c30-8 66-8 90 0 10 4 10 36 0 42-24 10-60 10-90 0-10-6-10-38 0-42Zm212 0c-30-8-66-8-90 0-10 4-10 36 0 42 24 10 60 10 90 0 10-6 10-38 0-42Z"/><path fill="none" stroke="#111" stroke-width="7" d="M184 304c8-4 24-4 32 0"/>`,
	},
	{
		feature: "glasses",
		id: "fork-shades",
		svg: `<path fill="#1a1a1a" fill-opacity=".9" stroke="#000" stroke-width="5" d="M96 292h82c4 20-2 44-40 44s-46-26-42-44Zm126 0h82c4 18-4 44-42 44s-44-24-40-44Z"/><path fill="none" stroke="#000" stroke-width="5" d="M178 296c12-6 32-6 44 0M96 294l-42-6m250 6 42-6"/><path fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="3" d="m112 300 10 20m10-20 10 20m94-20 10 20m10-20 10 20"/>`,
	},

	// Accessories
	{
		feature: "accessories",
		id: "fork-thin-headband",
		svg: `<path fill="$[primary]" stroke="#000" stroke-width="3" d="M52 232c30-30 80-46 148-46s118 16 148 46l-4 22c-30-28-78-42-144-42s-114 14-144 42Z"/>`,
	},
	{
		feature: "accessories",
		id: "fork-tied-headband",
		svg: `<path fill="$[primary]" stroke="#000" stroke-width="3" d="M50 226c30-34 82-52 150-52s120 18 150 52l-2 32c-32-32-80-48-148-48s-116 16-148 48Z"/><path fill="$[secondary]" stroke="#000" stroke-width="3" d="M346 232c14 2 24 10 30 24-8 18-12 38-10 60-14-10-20-30-22-50Zm4 14c16 10 24 30 22 60"/>`,
	},
	{
		feature: "accessories",
		id: "fork-durag",
		svg: `<path fill="$[primary]" stroke="#000" stroke-width="4" d="M56 270c-6-110 50-176 144-176s150 66 144 176c-30-40-80-60-144-60s-114 20-144 60Z"/><path fill="none" stroke="#000" stroke-width="2" stroke-opacity=".4" d="M200 96v112M120 116c20 30 30 60 32 94m128-94c-20 30-30 60-32 94"/><path fill="$[primary]" stroke="#000" stroke-width="3" d="M346 254c20 26 28 76 22 124-10-22-18-60-24-104Z"/>`,
	},
	{
		feature: "accessories",
		id: "fork-earrings",
		svg: `<g fill="none" stroke-width="4"><circle cx="40" cy="364" r="9" stroke="#000" stroke-width="7"/><circle cx="40" cy="364" r="9" stroke="#f2c94c"/><circle cx="360" cy="364" r="9" stroke="#000" stroke-width="7"/><circle cx="360" cy="364" r="9" stroke="#f2c94c"/></g>`,
	},
	{
		feature: "accessories",
		id: "fork-bandage",
		svg: `<path fill="#e8c9a0" stroke="#000" stroke-width="2" stroke-linejoin="round" d="m96 258 38-14 5 13-38 14Z"/><path fill="#d4ab7b" d="m111 254 11-4 3 8-11 4Z"/>`,
	},

	// Necks and shoulders (mostly under the jersey)
	{
		feature: "body",
		id: "fork-body-broad",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="M0 600s-4-62 56-76c40-10 70-22 82-46l12-170h100l12 170c12 24 42 36 82 46 60 14 56 76 56 76"/><path ${LINE} stroke-width="3" d="M62 540c30-6 60-14 78-30m198 30c-30-6-60-14-78-30"/>`,
	},
	{
		feature: "body",
		id: "fork-body-lean",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="M20 600s0-56 56-70c36-8 62-20 72-50l10-170h84l10 170c10 30 36 42 72 50 56 14 56 70 56 70"/><path ${LINE} stroke-width="3" d="M182 470c6 8 30 8 36 0"/>`,
	},
	{
		feature: "body",
		id: "fork-body-neck-tattoo",
		svg: `<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="M10 600s0-56 58-72c38-10 66-22 76-50l10-170h92l10 170c10 28 38 40 76 50 58 16 58 72 58 72"/><path fill="none" stroke="#1d3557" stroke-opacity=".7" stroke-width="4" d="M262 462c-12-6-16-20-8-28s22-2 22 10-12 14-16 6M268 492c-8-4-18-2-22 6"/>`,
	},

	// Lines around the eyes
	{
		feature: "eyeLine",
		id: "fork-crows-feet",
		svg: `<path ${LINE} stroke-width="2" d="M92 300l-14-6m14 14H76m16 8-14 6m230-22 14-6m-14 14h16m-16 8 14 6"/>`,
	},
	{
		feature: "eyeLine",
		id: "fork-under-eye",
		svg: `<path ${LINE} stroke-width="2" d="M112 340c18 8 38 8 56 0m64 0c18 8 38 8 56 0"/>`,
	},
	{
		feature: "eyeLine",
		id: "fork-lid-crease",
		svg: `<path ${LINE} stroke-width="2" d="M108 292c18-12 46-14 66-2m52 0c20-12 48-10 66 2"/>`,
	},

	// Smile lines (left side)
	{
		feature: "smileLine",
		id: "fork-smile-deep",
		svg: `<path ${LINE} stroke-width="3" d="M16 2C4 14 1 30 9 46"/>`,
	},
	{
		feature: "smileLine",
		id: "fork-dimple",
		svg: `<path ${LINE} stroke-width="3" d="M3 3c5 6 5 13 0 18"/>`,
	},
	{
		feature: "smileLine",
		id: "fork-smile-double",
		svg: `<path ${LINE} stroke-width="2" d="M16 2C6 12 4 26 10 40M24 8c-8 8-10 18-6 28"/>`,
	},

	// Other lines and marks
	{
		feature: "miscLine",
		id: "fork-brow-scar",
		svg: `<path fill="none" stroke="#7a3b3b" stroke-opacity=".75" stroke-linecap="round" stroke-width="3" d="m118 252 14 34m-16-24 10-4m-6 14 10-4"/>`,
	},
	{
		feature: "miscLine",
		id: "fork-cheek-scar",
		svg: `<path fill="none" stroke="#7a3b3b" stroke-opacity=".7" stroke-linecap="round" stroke-width="3" d="m262 360 32 18"/>`,
	},
	{
		feature: "miscLine",
		id: "fork-forehead-lines",
		svg: `<path ${LINE} stroke-width="2" d="M150 214c30-8 70-8 100 0m-90 16c24-6 56-6 80 0"/>`,
	},
	{
		feature: "miscLine",
		id: "fork-mole",
		svg: `<circle cx="252" cy="402" r="4" fill="#3b2418" fill-opacity=".8"/>`,
	},
];
