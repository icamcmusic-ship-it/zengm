// The fork's hair style expansion, batch A: fades, waves, twists, locs, braids, small afro (original SVG in facesjs' 400x600
// face coordinates, registered through common/faceParts.ts; see faceParts.styles.ts for the head geometry).
//
// Fades are drawn as bands of the hair colour at falling opacity, clipped to the shape of short hair, under a solid top. Bands
// (not a gradient) because SVG gradient ids are shared by every face on a page, and a gradient in the hair colour would draw
// every face in the first face's colour. Clip paths only hold geometry, which is the same for every face with that part.
import type { StylePart } from "./faceParts.styles.ts";

// Short hair's outline: the dome and the usual hairline (sideburns at (58, 306) / (342, 306), temples, forehead at y ~200)
const SILHOUETTE =
	"M58 306H48c0-150 52-212 152-212s152 62 152 212h-10c-2-14-10-28-18-34-6-14-6-48-14-64-34-8-72-10-110-10s-76 2-110 10c-8 16-8 50-14 64-8 6-16 20-18 34Z";

const BANDS = [0.6, 0.42, 0.27, 0.15, 0.07];

// Faded sides from y = from down to the sideburns
const fade = (id: string, from: number, strength = 1) => {
	const step = (304 - from) / BANDS.length;
	const rects = [
		`<rect x="40" y="88" width="320" height="${from - 88}" fill-opacity="${Math.min(0.85, BANDS[0]! * strength + 0.1)}"/>`,
		...BANDS.map(
			(o, i) =>
				`<rect x="40" y="${Math.round(from + i * step)}" width="320" height="${Math.ceil(step) + 1}" fill-opacity="${Math.round(o * strength * 100) / 100}"/>`,
		),
	].join("");
	return `<clipPath id="fk-c-${id}"><path d="${SILHOUETTE}"/></clipPath><g clip-path="url(#fk-c-${id})" fill="$[hairColor]">${rects}</g>`;
};

const HAIR = 'fill="$[hairColor]" stroke="#000" stroke-width="4"';
const HAIR3 = 'fill="$[hairColor]" stroke="#000" stroke-width="3"';
const SHADE = 'fill="none" stroke="#000" stroke-linecap="round"';

// Solid tops (the part above the fade)
// Short top reaching the temples (low fade)
const TOP_LOW =
	"M66 222c-4-80 46-130 134-130s138 50 134 130c-10-8-18-18-24-26-32-8-70-10-110-10s-78 2-110 10c-6 8-14 18-24 26Z";
// Top over the crown only (high fade)
const TOP_HIGH =
	"M92 190c2-62 46-98 108-98s106 36 108 98c-30-8-68-10-108-10s-78 2-108 10Z";
// A cropped top with a blunt straight fringe (edgar / French crop)
const TOP_EDGAR =
	"M90 202c-2-70 42-110 110-110s112 40 110 110c-6-6-14-10-22-10H112c-8 0-16 4-22 10Z";

// Bleached / dyed colour (frosted tips, dyed tips)
const BLEACH = "#e9d9a6";

const r1 = (x: number) => Math.round(x * 10) / 10;

// A cap of hair whose outline is made of small rounded lobes (twists, locs, coils): over the top from the left side to the right
// side at height sideY, then back along the fringe (lowest at fringeY in the middle, rising to sideY at the sides). Strand lines
// run from the fringe up toward the crown. lobes: number of lobes over the top / along the fringe.
const lobedCap = ({
	topY = 92,
	sideY,
	fringeY,
	width = 154,
	topLobes = 14,
	fringeLobes = 11,
	lobe = 9,
	tips,
}: {
	topY?: number;
	sideY: number;
	fringeY: number;
	width?: number;
	topLobes?: number;
	fringeLobes?: number;
	lobe?: number;
	tips?: string;
}) => {
	const top: [number, number][] = [];
	for (let i = 0; i <= topLobes; i++) {
		const t = Math.PI - (Math.PI * i) / topLobes;
		top.push([200 + width * Math.cos(t), sideY - (sideY - topY) * Math.sin(t)]);
	}
	const fringe: [number, number][] = [];
	const fringeHalf = width - 10;
	for (let i = 0; i <= fringeLobes; i++) {
		const x = 200 + fringeHalf - (2 * fringeHalf * i) / fringeLobes;
		const u = (x - 200) / fringeHalf;
		fringe.push([x, sideY - (sideY - fringeY) * (1 - u * u)]);
	}
	let d = `M${r1(top[0]![0])} ${r1(top[0]![1])}`;
	for (let i = 1; i < top.length; i++) {
		d += `A${lobe} ${lobe} 0 0 1 ${r1(top[i]![0])} ${r1(top[i]![1])}`;
	}
	d += `L${r1(fringe[0]![0])} ${r1(fringe[0]![1])}`;
	for (let i = 1; i < fringe.length; i++) {
		d += `A${lobe} ${lobe} 0 0 1 ${r1(fringe[i]![0])} ${r1(fringe[i]![1])}`;
	}
	d += "Z";
	const lines = fringe
		.slice(1, -1)
		.map(([x, y]) => {
			const tx = 200 + (x - 200) * 0.55;
			const ty = topY + 26 + Math.abs(x - 200) * 0.18;
			return `M${r1(x)} ${r1(y - 2)}Q${r1((x + tx) / 2 + (x - 200) * 0.12)} ${r1((y + ty) / 2)} ${r1(tx)} ${r1(ty)}`;
		})
		.join("");
	const marks = fringe
		.slice(0, -1)
		.map(([x, y], i) => {
			const [x2] = fringe[i + 1]!;
			const mx = (x + x2) / 2;
			return `M${r1(mx - 4)} ${r1(y - 16)}l7 5m-7 7l7 5`;
		})
		.join("");
	const tipDots =
		tips === undefined
			? ""
			: fringe
					.slice(0, -1)
					.map(([x, y], i) => {
						const [x2, y2] = fringe[i + 1]!;
						return `<ellipse cx="${r1((x + x2) / 2)}" cy="${r1((y + y2) / 2 + lobe * 0.1)}" rx="${r1(lobe * 1.3)}" ry="${r1(lobe * 1.1)}" fill="${tips}" stroke="#000" stroke-width="1"/>`;
					})
					.join("");
	return `<path ${HAIR} d="${d}"/>${tipDots}<path ${SHADE} stroke-width="2" stroke-opacity=".5" d="${lines}"/><path ${SHADE} stroke-width="1.5" stroke-opacity=".4" d="${marks}"/>`;
};

// A rounded strand as a path (facesjs' string renderer measures paths, not rects)
const pill = (x: number, y: number, w: number, h: number) => {
	const r = w / 2;
	return `M${r1(x)} ${r1(y + r)}a${r} ${r} 0 0 1 ${w} 0V${r1(y + h - r)}a${r} ${r} 0 0 1 ${-w} 0Z`;
};

const range = (a: number, b: number, step: number) => {
	const out = [];
	for (let x = a; x <= b; x += step) {
		out.push(x);
	}
	return out;
};

// Hanging locs / braids behind the head (hairBg), left and right of the neck
const hangingStrands = (
	bottom: number,
	w: number,
	gap: number,
	tip?: string,
	braid = false,
) => {
	const left = range(58, 128, gap);
	const right = range(272, 342, gap);
	const one = (x: number) => {
		const top = 210 + Math.abs(x - 200) * 0.1;
		const body = `<path ${HAIR3} d="${pill(x - w / 2, top, w, bottom - top)}"/>`;
		const marks = braid
			? `<path ${SHADE} stroke-width="1.5" stroke-opacity=".5" d="${range(
					top + 14,
					bottom - 10,
					12,
				)
					.map((y) => `M${x - w / 2 + 2} ${y}l${w - 4} 6`)
					.join("")}"/>`
			: "";
		const tipRect =
			tip === undefined
				? ""
				: `<path fill="${tip}" d="${pill(x - w / 2 + 1.5, bottom - 22, w - 3, 20)}"/>`;
		return body + marks + tipRect;
	};
	return [...left, ...right].map(one).join("");
};

// Braid rows going straight back (box braids on top), from the hairline up over the dome
const braidRows = (id: string, count: number, zigzag = false) => {
	const xs = range(
		200 - ((count - 1) / 2) * 26,
		200 + ((count - 1) / 2) * 26,
		26,
	);
	const rows = xs
		.map((x) => {
			const spread = (x - 200) * 0.75;
			const d = zigzag
				? `M${x} 204l${spread * 0.25 + 9} -26l${-18} -26l${spread * 0.25 + 18} -26l${-16} -26l${spread * 0.25 + 8} -26`
				: `M${x} 206c${spread * 0.2} -40 ${spread * 0.6} -80 ${spread} -126`;
			return `<path fill="none" stroke="#000" stroke-width="15" stroke-linecap="round" stroke-linejoin="round" d="${d}"/><path fill="none" stroke="$[hairColor]" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`;
		})
		.join("");
	return `<clipPath id="fk-b-${id}"><path d="${SILHOUETTE}"/></clipPath><g clip-path="url(#fk-b-${id})">${rows}</g><path fill="none" stroke="#000" stroke-width="3" d="M48 306c0-150 52-212 152-212s152 62 152 212"/>`;
};

// Waves: arcs over a top
const waves = (top: number) =>
	`<path ${SHADE} stroke-width="2" stroke-opacity=".55" d="${range(0, 4, 1)
		.map((i) => {
			const y = top + 18 + i * 18;
			const w = 60 + i * 18;
			return `M${200 - w} ${y + 10}c${w * 0.3}-14 ${w * 0.6}-14 ${w} 0s${w * 0.7} 14 ${w} 0`;
		})
		.join("")}"/>`;

export const HAIR_PARTS: readonly StylePart[] = [
	// Short and faded
	{
		feature: "hair",
		id: "fork-low-fade",
		svg: `${fade("low-fade", 226, 0.9)}<path ${HAIR} d="${TOP_LOW}"/>`,
	},
	{
		feature: "hair",
		id: "fork-high-fade",
		svg: `${fade("high-fade", 192, 0.75)}<path ${HAIR} d="${TOP_HIGH}"/>`,
	},
	{
		feature: "hair",
		id: "fork-skin-fade-part",
		svg: `${fade("skin-fade-part", 192, 0.45)}<path ${HAIR} d="${TOP_HIGH}"/><path fill="none" stroke="$[skinColor]" stroke-width="6" stroke-linecap="round" d="M150 182c-4-30 2-60 16-82"/>`,
	},
	{
		feature: "hair",
		id: "fork-high-tight",
		svg: `${fade("high-tight", 170, 0.4)}<path fill="$[hairColor]" fill-opacity=".8" stroke="#000" stroke-width="2" d="M108 184c4-54 42-86 92-86s88 32 92 86c-26-6-58-8-92-8s-66 2-92 8Z"/>`,
	},
	{
		feature: "hair",
		id: "fork-line-up",
		svg: `${fade("line-up", 240, 0.8)}<path ${HAIR} d="M66 236c-6-90 44-142 134-142s140 52 134 142l-12-12-6-38c-36-6-74-8-116-8s-80 2-116 8l-6 38Z"/>`,
	},
	{
		feature: "hair",
		id: "fork-waves-fade",
		svg: `${fade("waves-fade", 214, 0.8)}<path ${HAIR} d="M70 214c-2-76 48-120 130-120s132 44 130 120c-30-14-70-24-130-24S100 200 70 214Z"/>${waves(100)}`,
	},
	{
		feature: "hair",
		id: "fork-edgar",
		svg: `${fade("edgar", 198, 0.4)}<path ${HAIR} d="${TOP_EDGAR}"/><path ${SHADE} stroke-width="1.5" stroke-opacity=".5" d="M122 192v-16m20 16v-18m20 18v-20m20 20v-20m20 20v-20m20 20v-20m20 20v-18m20 18v-16"/>`,
	},
	{
		feature: "hair",
		id: "fork-frosted-tips",
		svg: `${fade("frosted-tips", 214, 0.7)}<path ${HAIR} d="M70 214c-2-76 48-120 130-120s132 44 130 120c-30-14-70-24-130-24S100 200 70 214Z"/><path fill="${BLEACH}" stroke="#000" stroke-width="3" stroke-linejoin="round" d="M100 152L112 134L124 142L138 116L152 136L166 104L180 128L194 98L208 126L222 98L236 128L250 104L264 136L278 116L288 138L300 130L302 152Q200 128 100 152Z"/>`,
	},
	{
		feature: "hair",
		id: "fork-dyed-top",
		svg: `${fade("dyed-top", 192, 0.75)}<path stroke="#000" stroke-width="4" fill="${BLEACH}" d="${TOP_HIGH}"/><path ${SHADE} stroke-width="1.5" stroke-opacity=".35" d="M120 168c10-30 40-52 80-52s70 22 80 52"/>`,
	},
	{
		feature: "hair",
		id: "fork-shaved-part",
		svg: `${fade("shaved-part", 214, 0.7)}<path ${HAIR} d="M70 214c-2-76 48-120 130-120s132 44 130 120c-30-14-70-24-130-24S100 200 70 214Z"/><path fill="none" stroke="$[skinColor]" stroke-width="5.5" stroke-linecap="round" d="M140 194c-6-30 0-62 18-90M122 198c-4-24 0-48 12-70"/>`,
	},
	{
		feature: "hair",
		id: "fork-side-design",
		svg: `${fade("side-design", 214, 0.8)}<path ${HAIR} d="M70 214c-2-76 48-120 130-120s132 44 130 120c-30-14-70-24-130-24S100 200 70 214Z"/><path fill="none" stroke="$[skinColor]" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" d="M78 200l10-12 10 12 10-12 10 12M322 200l-10-12-10 12-10-12-10 12"/>`,
	},
	{
		feature: "hair",
		id: "fork-grey-streak",
		svg: `${fade("grey-streak", 226, 0.9)}<path ${HAIR} d="${TOP_LOW}"/><path fill="#c9c9c9" stroke="#000" stroke-width="1.5" d="M150 104c-14 26-20 54-20 84 10-2 20-2 30-2 0-32 4-60 14-86-8 0-16 2-24 4Z"/>`,
	},

	// Textured / natural
	{
		feature: "hair",
		id: "fork-twists-medium",
		svg: `${lobedCap({ sideY: 286, fringeY: 210, topLobes: 16, fringeLobes: 12, lobe: 10 })}`,
	},
	{
		feature: "hair",
		id: "fork-twists-fade",
		svg: `${fade("twists-fade", 206, 0.75)}${lobedCap({ topY: 84, sideY: 206, fringeY: 196, width: 126, topLobes: 12, fringeLobes: 10, lobe: 9 })}`,
	},
	{
		feature: "hair",
		id: "fork-afro-small",
		svg: `<path ${HAIR} d="M56 280c-14-40-14-84 0-110-6-34 14-60 40-68 8-24 36-38 62-34 14-14 30-18 42-18s28 4 42 18c26-4 54 10 62 34 26 8 46 34 40 68 14 26 14 70 0 110-8-34-18-56-30-68-30-14-70-22-114-22s-84 8-114 22c-12 12-22 34-30 68Z"/>`,
	},
	{
		feature: "hair",
		id: "fork-bantu-knots",
		svg: `${fade("bantu-knots", 200, 0.7)}${[
			[120, 150],
			[200, 124],
			[280, 150],
			[156, 178],
			[244, 178],
			[200, 96],
		]
			.map(
				([x, y]) =>
					`<circle cx="${x}" cy="${y}" r="20" ${HAIR3}/><path ${SHADE} stroke-width="1.5" stroke-opacity=".5" d="M${x! - 12} ${y! - 4}c6-10 18-10 24 0m-20 10c6-8 12-8 18-2"/>`,
			)
			.join("")}`,
	},

	// Locs
	{
		feature: "hair",
		id: "fork-starter-locs",
		svg: `${fade("starter-locs", 210, 0.75)}${lobedCap({ topY: 82, sideY: 214, fringeY: 200, width: 132, topLobes: 14, fringeLobes: 12, lobe: 8 })}`,
	},
	{
		feature: "hair",
		id: "fork-locs-dyed",
		svg: `${fade("locs-dyed", 210, 0.75)}${lobedCap({ topY: 82, sideY: 214, fringeY: 200, width: 132, topLobes: 14, fringeLobes: 12, lobe: 8, tips: BLEACH })}`,
	},
	{
		feature: "hair",
		id: "fork-locs-top",
		svg: `${lobedCap({ topY: 86, sideY: 320, fringeY: 196, width: 160, topLobes: 16, fringeLobes: 13, lobe: 10 })}`,
	},
	{
		feature: "hairBg",
		id: "fork-locs-long",
		svg: hangingStrands(560, 20, 18),
	},
	{
		feature: "hairBg",
		id: "fork-locs-long-dyed",
		svg: hangingStrands(560, 20, 18, BLEACH),
	},

	{
		feature: "hair",
		id: "fork-locs-back",
		svg: `<path ${HAIR} d="M60 290c-10-120 30-190 140-196 110 6 150 76 140 196-6-30-14-56-24-74-34-16-74-22-116-22s-82 6-116 22c-10 18-18 44-24 74Z"/><path ${SHADE} stroke-width="2" stroke-opacity=".55" d="M120 196c4-40 20-70 46-92m-16 94c6-40 20-70 40-96m10 96c-2-40 2-70 10-98m20 98c-4-36-4-66 4-94m22 92c-6-34-10-62-4-88"/>`,
	},

	// Braids
	{
		feature: "hair",
		id: "fork-cornrows-zigzag",
		svg: `${fade("cornrows-zigzag", 214, 0.55)}${braidRows("cornrows-zigzag", 9, true)}`,
	},
	{
		feature: "hair",
		id: "fork-box-braids",
		svg: `${fade("box-braids", 214, 0.55)}${braidRows("box-braids", 9)}<path ${SHADE} stroke-width="1.5" stroke-opacity=".45" d="M122 150h156M110 176h180M134 124h132"/>`,
	},
	{
		feature: "hairBg",
		id: "fork-box-braids-long",
		svg: hangingStrands(520, 14, 13, undefined, true),
	},

	{
		feature: "hair",
		id: "fork-braids-bun",
		svg: `${fade("braids-bun", 214, 0.55)}${braidRows("braids-bun", 9)}<circle cx="200" cy="78" r="30" ${HAIR3}/><path ${SHADE} stroke-width="1.5" stroke-opacity=".5" d="M176 70c10-12 38-12 48 0m-46 14c10 10 34 10 44 0"/>`,
	},
];
