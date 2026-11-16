// The fork's face style expansion, batch D (see docs/native-features.md "Faces"). Original designs in facesjs' 400x600 face
// coordinates and colour placeholders (nothing copied from facesjs' catalog), registered through common/faceParts.ts.
// Eyes, brows, ears, noses and mouths use local coordinates (facesjs centres their bounding box on a fixed point).
//
// Gear tied to injuries (the nose bandage) is drawn at render time from the injury state (common/faceRender.ts), never stored.
import {
	BANDS,
	BLEACH,
	lobedCap,
	range,
	SILHOUETTE,
} from "./faceParts.hair.ts";
import type { StylePart } from "./faceParts.styles.ts";

const HAIR = 'fill="$[hairColor]" stroke="#000" stroke-width="4"';
const HAIR3 = 'fill="$[hairColor]" stroke="#000" stroke-width="3"';
const BEARD = 'fill="$[hairColor]" stroke="#000" stroke-width="2"';
const SHADE = 'fill="none" stroke="#000" stroke-linecap="round"';

// A circle as a path (facesjs' string renderer measures paths)
const circ = (cx: number, cy: number, r: number) =>
	`M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

// Short sides at one low opacity (shaved under a longer top), clipped to the shape of short hair
const shavedSides = (id: string, opacity: number) =>
	`<clipPath id="fk-d-${id}"><path d="${SILHOUETTE}"/></clipPath><g clip-path="url(#fk-d-${id})" fill="$[hairColor]"><path fill-opacity="${opacity}" d="M40 88h320v220H40Z"/></g>`;

// Faded sides from y = from down to the sideburns (like the batch A fades, with an id of its own)
const fadeSides = (id: string, from: number, strength = 1) => {
	const step = (304 - from) / BANDS.length;
	const bands = BANDS.map(
		(o, i) =>
			`<path fill-opacity="${Math.round(o * strength * 100) / 100}" d="M40 ${Math.round(from + i * step)}h320v${Math.ceil(step) + 1}H40Z"/>`,
	).join("");
	return `<clipPath id="fk-d-${id}"><path d="${SILHOUETTE}"/></clipPath><g clip-path="url(#fk-d-${id})" fill="$[hairColor]"><path fill-opacity="${Math.min(0.85, BANDS[0]! * strength + 0.1)}" d="M40 88h320v${from - 88}H40Z"/>${bands}</g>`;
};

// Burst fade: the hair fades out in rings around each ear (centre (55, 330) / (345, 330)), the top and back keep their length
const EAR_L: [number, number] = [55, 330];
const EAR_R: [number, number] = [345, 330];
const BURST_RINGS = [122, 102, 86, 72];
const BURST_OPACITY = [0.55, 0.32, 0.14];
const burstFade = () => {
	const rings = BURST_OPACITY.map(
		(o, i) =>
			`<path fill-opacity="${o}" fill-rule="evenodd" d="${circ(...EAR_L, BURST_RINGS[i]!)}${circ(...EAR_L, BURST_RINGS[i + 1]!)}${circ(...EAR_R, BURST_RINGS[i]!)}${circ(...EAR_R, BURST_RINGS[i + 1]!)}"/>`,
	).join("");
	return `<clipPath id="fk-d-burst"><path d="${SILHOUETTE}"/></clipPath><clipPath id="fk-d-burst-top"><path clip-rule="evenodd" d="M20 60H380V360H20Z${circ(...EAR_L, BURST_RINGS[0]!)}${circ(...EAR_R, BURST_RINGS[0]!)}"/></clipPath><g clip-path="url(#fk-d-burst)" fill="$[hairColor]">${rings}</g><g clip-path="url(#fk-d-burst-top)"><path ${HAIR} d="${SILHOUETTE}"/></g><path ${SHADE} stroke-width="2" stroke-opacity=".45" d="M130 150c22-16 48-22 70-22s48 6 70 22M112 176c26-14 58-20 88-20s62 6 88 20"/>`;
};

// Leopard rosettes for a bleached buzz: a dark broken ring round a spot of his own colour
const ROSETTES: [number, number][] = [
	[120, 150],
	[168, 122],
	[222, 118],
	[274, 144],
	[96, 196],
	[150, 176],
	[204, 166],
	[256, 184],
	[306, 200],
	[78, 246],
	[322, 248],
];
const rosettes = () =>
	ROSETTES.map(
		([x, y], i) =>
			`<path fill="$[hairColor]" d="${circ(x, y, 6)}"/><path fill="none" stroke="#2b1d12" stroke-opacity=".75" stroke-width="3.5" stroke-linecap="round" d="M${x - 9} ${y + (i % 2 ? 2 : -2)}a9 9 0 0 1 12-8m6 6a9 9 0 0 1-4 11m-6 2a9 9 0 0 1-9-5"/>`,
	).join("");

// Loose wet curls over a Jheri curl
const JHERI_CURLS: [number, number][] = [
	[110, 130],
	[156, 112],
	[204, 106],
	[250, 114],
	[294, 132],
	[88, 184],
	[134, 162],
	[184, 150],
	[234, 152],
	[282, 166],
	[316, 196],
	[70, 248],
	[330, 254],
];

// One braid, top to bottom along x, as linked lobes (Viking braids, braided chin beard)
const braid = (x: number, top: number, bottom: number, w: number) => {
	const step = w * 0.9;
	const lobes = range(top, bottom - step, step)
		.map(
			(y, i) =>
				`<path ${HAIR3} d="M${x} ${y}c${(i % 2 ? -1 : 1) * w * 0.7} ${step * 0.15} ${(i % 2 ? -1 : 1) * w * 0.6} ${step * 0.9} 0 ${step * 1.1}c${(i % 2 ? 1 : -1) * w * 0.45} -${step * 0.25} ${(i % 2 ? 1 : -1) * w * 0.5} -${step * 0.85} 0 -${step * 1.1}Z"/>`,
		)
		.join("");
	return lobes;
};

// The facesjs body outline (as in batch C): the neck shows between the jaw and the jersey collar, about y 495..540
const BODY =
	'<path fill="$[skinColor]" stroke="#000" stroke-width="6" d="M10 600s0-50 60-70 70-50 70-50l60-180 60 180s10 30 70 50 60 70 60 70"/>';

export const BATCH_D_PARTS: readonly StylePart[] = [
	// ---------------------------------------------------------------------------------------------------------------
	// Hair
	{
		feature: "hair",
		id: "fork-burst-fade",
		svg: burstFade(),
	},
	{
		feature: "hair",
		id: "fork-frohawk",
		rarity: "rare",
		svg: `${fadeSides("frohawk", 210, 0.45)}${lobedCap({ topY: 44, sideY: 210, fringeY: 214, width: 64, topLobes: 10, fringeLobes: 4, lobe: 8 })}`,
	},
	{
		feature: "hair",
		id: "fork-bowl-cut",
		rarity: "rare",
		svg: `${shavedSides("bowl", 0.35)}<path ${HAIR} d="M44 270C34 150 92 80 200 80s166 70 156 190c-6-4-14-10-20-14-10-10-18-6-26-10-34-14-70-18-110-18s-76 4-110 18c-8 4-16 0-26 10-6 4-14 10-20 14Z"/><path ${SHADE} stroke-width="2" stroke-opacity=".45" d="M90 236c4-30 14-56 30-76m30 66c2-34 8-66 20-92m30 88V122m30 104c-2-34-8-66-20-92m60 102c-4-30-14-56-30-76"/>`,
	},
	{
		feature: "hair",
		id: "fork-viking-braids",
		rarity: "rare",
		svg: `${shavedSides("viking", 0.3)}<path ${HAIR} d="M146 212c-10-60-4-112 54-122 58 10 64 62 54 122-16-6-34-8-54-8s-38 2-54 8Z"/>${braid(200, 100, 214, 34)}<path ${SHADE} stroke-width="2" stroke-opacity=".45" d="M164 120c-8 26-10 56-6 84m84-84c8 26 10 56 6 84"/>`,
	},
	{
		feature: "hairBg",
		id: "fork-viking-braids-long",
		rarity: "rare",
		svg: `${braid(354, 280, 520, 30)}${braid(46, 280, 520, 30)}<path fill="#6b4a2b" stroke="#000" stroke-width="2" d="M336 500h36v10h-36zM28 500h36v10H28z"/>`,
	},
	{
		feature: "hair",
		id: "fork-afro-puff",
		rarity: "uncommon",
		svg: `${lobedCap({ topY: 8, sideY: 124, fringeY: 130, width: 84, topLobes: 16, fringeLobes: 6, lobe: 11 })}${fadeSides("puff", 214, 0.7)}<path ${HAIR} d="M64 260c-6-100 40-160 136-160s142 60 136 160c-8-20-14-40-20-56-36-12-74-16-116-16s-80 4-116 16c-6 16-12 36-20 56Z"/><path fill="#111" stroke="#000" stroke-width="2" d="M146 112c34-10 74-10 108 0l-4 12c-30-8-70-8-100 0Z"/>`,
	},
	{
		feature: "hair",
		id: "fork-jheri-curl",
		rarity: "rare",
		svg: `<path ${HAIR} d="M42 318C28 190 82 86 200 86S372 190 358 318c-8-4-12-10-14-18-4-28-10-52-22-72${"c-8 12-22 12-30.5 0".repeat(8)}c-12 20-18 44-22 72-2 8-6 14-14 18Z"/><path ${SHADE} stroke-width="2" stroke-opacity=".5" d="${JHERI_CURLS.map(
			([x, y]) => `M${x - 7} ${y}a7 7 0 1 1 7 7`,
		).join(
			"",
		)}"/><path fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="5" stroke-linecap="round" d="M120 118c20-12 40-16 58-16m48 6c18 4 34 12 46 22M78 214c2-20 8-36 16-50m228 50c-2-20-8-36-16-50"/>`,
	},
	{
		feature: "hair",
		id: "fork-high-top-slanted",
		rarity: "rare",
		svg: `${fadeSides("slant", 214, 0.6)}<path ${HAIR} d="M88 214c-4-50-8-110-6-168 4-6 10-8 16-8l210 34c8 2 12 6 12 12 0 44-2 88-6 130-34-10-72-14-114-14s-78 4-112 14Z"/><path ${SHADE} stroke-width="2" stroke-opacity=".4" d="M98 52l206 34M120 120c50-6 110-4 160 6"/>`,
	},
	{
		feature: "hair",
		id: "fork-buzz-leopard",
		rarity: "rare",
		svg: `<path fill="${BLEACH}" fill-opacity=".9" d="M60 300v-10c0-5 10-20 15-25s5-55 15-65c25-30 60-40 110-40s85 10 110 40c10 10 10 60 15 65s15 20 15 25v10h-6c-2-30-14-120-134-120S68 270 66 300z"/><path fill="${BLEACH}" fill-opacity=".9" d="M66 300C64 140 104 96 200 96s136 44 134 204c-6-30-10-60-20-80-10-10-6-30-20-40-30-20-64-26-94-26s-64 6-94 26c-14 10-10 30-20 40-10 20-14 50-20 80Z"/>${rosettes()}`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Gear
	{
		feature: "accessories",
		id: "fork-nose-bandage",
		// Drawn on a player while he's out with (or just back from) a nose or facial injury (common/faceRender.ts); never
		// generated, can be picked by hand
		special: true,
		svg: `<path fill="#e7d8c2" stroke="#000" stroke-width="2" stroke-linejoin="round" d="M140 352l120-14 2 16-120 14Z"/><path fill="#f7f5f0" stroke="#000" stroke-width="2" d="M181 338h38v36h-38Z"/><path fill="none" stroke="#b9b2a6" stroke-width="2" d="M187 348h26m-26 8h26m-26 8h26"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Face and body
	{
		feature: "accessories",
		id: "fork-septum-ring",
		rarity: "rare",
		svg: `<path fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" d="M189 396a11 10 0 0 0 22 0"/><path fill="none" stroke="#d6d9de" stroke-width="3.5" stroke-linecap="round" d="M189 396a11 10 0 0 0 22 0"/>`,
	},
	{
		feature: "accessories",
		id: "fork-brow-piercing",
		rarity: "rare",
		svg: `<path fill="none" stroke="#000" stroke-width="2" d="M302 252l4 26"/><path fill="#d6d9de" stroke="#000" stroke-width="2" d="${circ(301, 250, 4.5)}${circ(307, 281, 4.5)}"/>`,
	},
	{
		feature: "accessories",
		id: "fork-ear-gauges",
		rarity: "rare",
		svg: `<path fill="#1b1b1b" stroke="#000" stroke-width="3" d="${circ(40, 364, 10)}${circ(360, 364, 10)}"/><path fill="none" stroke="#9aa0a6" stroke-width="3" d="${circ(40, 364, 7)}${circ(360, 364, 7)}"/>`,
	},
	{
		feature: "mouth",
		id: "fork-mouth-grill",
		rarity: "rare",
		svg: `<path fill="#3a1414" stroke="#000" stroke-width="4" stroke-linejoin="round" d="M2 4c34 10 102 10 136 0-6 26-36 40-68 40S8 30 2 4Z"/><path fill="#e3b341" stroke="#000" stroke-width="2" d="M14 9c30 7 82 7 112 0-2 8-6 13-10 15-28 5-64 5-92 0-4-2-8-7-10-15Z"/><path fill="none" stroke="#7a5a10" stroke-width="2" d="M34 13v12m18-10v12m18-12v12m18-12v12m18-14v12"/><path fill="none" stroke="#fff6cc" stroke-opacity=".8" stroke-width="2" stroke-linecap="round" d="M40 15h6m30 0h6"/>`,
	},

	{
		// On the side of the neck between the jaw and the collar (the older fork-body-neck-tattoo sits under the jaw, where the head
		// covers it)
		feature: "body",
		id: "fork-body-neck-ink",
		rarity: "rare",
		svg: `${BODY}<path fill="#10141f" fill-opacity=".18" stroke="#10141f" stroke-opacity=".7" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M248 498l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1Z"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Facial hair
	{
		feature: "facialHair",
		id: "fork-goatee-extended",
		svg: `<path ${BEARD} fill-rule="evenodd" d="M104 432c10 40 40 72 96 76 56-4 86-36 96-76-14 14-32 22-50 22-10 0-20-6-46-6s-36 6-46 6c-18 0-36-8-50-22Zm62 26c4 10 64 10 68 0-12-6-56-6-68 0Z"/><path ${BEARD} d="M148 426c14-18 38-22 52-12 14-10 38-6 52 12 2 8-2 16-6 22-12-12-30-14-46-10-16-4-34-2-46 10-4-6-8-14-6-22Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-braided-chin",
		rarity: "rare",
		svg: `<path ${BEARD} fill-rule="evenodd" d="M150 452c6 34 26 56 50 58s44-24 50-58c-12 10-30 14-50 14s-38-4-50-14Zm28 18c4 10 40 10 44 0-10-4-34-4-44 0Z"/>${braid(200, 500, 590, 22)}<path fill="#6b4a2b" stroke="#000" stroke-width="2" d="M190 572h20v8h-20z"/><path ${BEARD} d="M150 426c14-16 36-20 50-12 14-8 36-4 50 12-14 6-34 2-50 0-16 2-36 6-50 0Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-pencil-beard",
		rarity: "uncommon",
		svg: `<path fill="none" stroke="#000" stroke-width="7" stroke-linecap="round" d="M60 310c4 90 54 170 140 182 86-12 136-92 140-182"/><path fill="none" stroke="$[hairColor]" stroke-width="4" stroke-linecap="round" d="M60 310c4 90 54 170 140 182 86-12 136-92 140-182"/><path fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" d="M98 420c14 4 26 0 34-10m170 10c-14 4-26 0-34-10M156 424c14-6 30-8 44-4 14-4 30-2 44 4"/><path fill="none" stroke="$[hairColor]" stroke-width="3" stroke-linecap="round" d="M98 420c14 4 26 0 34-10m170 10c-14 4-26 0-34-10M156 424c14-6 30-8 44-4 14-4 30-2 44 4"/>`,
	},
];
