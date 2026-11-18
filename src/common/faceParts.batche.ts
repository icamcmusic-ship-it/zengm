// The fork's face style expansion, batch E (see docs/native-features.md "Faces"). Face parts only (hair, facial hair, eyes,
// brows, ears, noses, mouths, heads), no gear. Original designs in facesjs' 400x600 face coordinates and colour placeholders
// (nothing copied from facesjs' catalog), registered through common/faceParts.ts. Eyes, brows, ears, noses and mouths use
// local coordinates (facesjs centres their bounding box on a fixed point and mirrors eyes, brows and ears for the right side).
//
// Facial hair is fitted to each head's jaw at draw time (common/faceFit.ts), which only reads paths made of M L H V C S Z:
// so facial hair here uses no arcs, quadratics, circles or clip paths (a clip path id is shared by every face on a page,
// and the fitted shape differs per head).
import { BANDS, BLEACH, range, SILHOUETTE } from "./faceParts.hair.ts";
import { head } from "./faceParts.native.ts";
import type { StylePart } from "./faceParts.styles.ts";

const HAIR = 'fill="$[hairColor]" stroke="#000" stroke-width="4"';
const HAIR3 = 'fill="$[hairColor]" stroke="#000" stroke-width="3"';
const BEARD = 'fill="$[hairColor]" stroke="#000" stroke-width="2"';
const SHADE = 'fill="none" stroke="#000" stroke-linecap="round"';
const SKIN = 'fill="$[skinColor]" stroke="#000" stroke-width="6"';

type P = [number, number];

const r1 = (x: number) => Math.round(x * 10) / 10;
const pt = ([x, y]: P) => `${r1(x)} ${r1(y)}`;

// A circle as a path (facesjs' string renderer measures paths; not for facial hair, see the top)
const circ = (cx: number, cy: number, r: number) =>
	`M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

// ---------------------------------------------------------------------------------------------------------------------
// Hair helpers

// Short sides at one low opacity (shaved under a longer top), clipped to the shape of short hair
const shavedSides = (id: string, opacity: number) =>
	`<clipPath id="fk-e-${id}"><path d="${SILHOUETTE}"/></clipPath><g clip-path="url(#fk-e-${id})" fill="$[hairColor]"><path fill-opacity="${opacity}" d="M40 88h320v220H40Z"/></g>`;

// Faded sides from y = from down to the sideburns (bands, like the batch A fades)
const fadeSides = (id: string, from: number, strength = 1) => {
	const step = (304 - from) / BANDS.length;
	const bands = BANDS.map(
		(o, i) =>
			`<path fill-opacity="${Math.round(o * strength * 100) / 100}" d="M40 ${Math.round(from + i * step)}h320v${Math.ceil(step) + 1}H40Z"/>`,
	).join("");
	return `<clipPath id="fk-e-${id}"><path d="${SILHOUETTE}"/></clipPath><g clip-path="url(#fk-e-${id})" fill="$[hairColor]"><path fill-opacity="${Math.min(0.85, BANDS[0]! * strength + 0.1)}" d="M40 88h320v${from - 88}H40Z"/>${bands}</g>`;
};

// A braid or cornrow along a path: black edge, hair colour, and short bars across it for the plaits
const plait = (d: string, w: number, bar = 3, gap = 7) =>
	`<path fill="none" stroke="#000" stroke-width="${w + 4}" stroke-linecap="round" stroke-linejoin="round" d="${d}"/><path fill="none" stroke="$[hairColor]" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" d="${d}"/><path fill="none" stroke="#000" stroke-opacity=".4" stroke-width="${w - 2}" stroke-dasharray="${bar} ${gap}" d="${d}"/>`;

// Scalp under rows of braids: the short-hair outline reaches a few px past the head at the temples, where the background would
// show between the rows
const SCALP = `<path fill="$[skinColor]" d="${SILHOUETTE}"/>`;

// The dome's outer edge, drawn over rows that are clipped to it
const DOME_EDGE =
	'<path fill="none" stroke="#000" stroke-width="3" d="M48 306c0-150 52-212 152-212s152 62 152 212"/>';

// Curls: small loops at points
const curls = (points: readonly P[], size = 6) =>
	`<path ${SHADE} stroke-width="2" stroke-opacity=".5" d="${points
		.map(([x, y]) => `M${x - size} ${y}a${size} ${size} 0 1 1 ${size} ${size}`)
		.join("")}"/>`;

// A closed outline through points, each step a small round lobe bulging to the left of the direction of travel (outward
// for a clockwise outline on screen)
const lobed = (points: readonly P[], lobe: number) => {
	let d = `M${pt(points[0]!)}`;
	for (let i = 1; i < points.length; i++) {
		d += `A${lobe} ${lobe} 0 0 1 ${pt(points[i]!)}`;
	}
	return `${d}Z`;
};

// Points on an ellipse arc (angles in degrees, 180 = left, 270 = top, 360 = right; y down)
const arcPoints = (
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	from: number,
	to: number,
	n: number,
): P[] =>
	range(0, n, 1).map((i) => {
		const a = ((from + ((to - from) * i) / n) * Math.PI) / 180;
		return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
	});

// Curved cornrows: concentric rows round a point above and right of the head, so they leave the hairline sweeping up and to
// the right and wrap round the right side
const cornrowsCurved = () => {
	const rows = range(70, 400, 24)
		.map((r) => plait(`M${380 - r} 24A${r} ${r} 0 0 0 380 ${24 + r}`, 10, 2, 6))
		.join("");
	return `${SCALP}${fadeSides("crv", 214, 0.5)}<clipPath id="fk-e-crv-rows"><path d="${SILHOUETTE}"/></clipPath><g clip-path="url(#fk-e-crv-rows)">${rows}</g>${DOME_EDGE}`;
};

// Feed-in (stitch) braids: four thick braids straight back, leaning in toward the crown
const feedInBraids = () => {
	const rows = [118, 170, 230, 282]
		.map((x) => {
			const top = 200 + (x - 200) * 0.45;
			return plait(
				`M${x} 214C${x} 170 ${r1((x + top) / 2)} 120 ${r1(top)} 80`,
				22,
				3,
				7,
			);
		})
		.join("");
	return `${SCALP}${fadeSides("feed", 214, 0.45)}<clipPath id="fk-e-feed-rows"><path d="${SILHOUETTE}"/></clipPath><g clip-path="url(#fk-e-feed-rows)">${rows}</g>${DOME_EDGE}`;
};

// Braided mohawk: three cornrows down the middle of the head over shaved sides
const braidedMohawk = () => {
	const rows = [170, 200, 230]
		.map((x) =>
			plait(
				`M${x} 212C${x} 170 ${r1(200 + (x - 200) * 0.7)} 120 ${r1(200 + (x - 200) * 0.5)} 86`,
				12,
				2,
				6,
			),
		)
		.join("");
	return `${shavedSides("mohawk", 0.3)}<clipPath id="fk-e-mohawk-rows"><path d="${SILHOUETTE}"/></clipPath><g clip-path="url(#fk-e-mohawk-rows)">${rows}</g>`;
};

// Locs from the crown falling forward over the forehead, over a tapered cap
const locsFringe = () => {
	const xs = range(92, 308, 18);
	// Outer locs first, so the middle ones lie on top
	const order = [...xs].sort((a, b) => Math.abs(b - 200) - Math.abs(a - 200));
	const locs = order
		.map((x) => {
			const i = xs.indexOf(x);
			const top: P = [200 + (x - 200) * 0.35, 104 + Math.abs(x - 200) * 0.12];
			const end = 248 - Math.abs(x - 200) * 0.26 - (i % 2 ? 8 : 0);
			const d = `M${pt(top)}C${pt([top[0], top[1] + 40])} ${x} ${r1(end - 56)} ${x} ${r1(end)}`;
			return `<path fill="none" stroke="#000" stroke-width="17" stroke-linecap="round" d="${d}"/><path fill="none" stroke="$[hairColor]" stroke-width="13" stroke-linecap="round" d="${d}"/><path fill="none" stroke="#000" stroke-opacity=".3" stroke-width="9" stroke-dasharray="2 9" d="${d}"/>`;
		})
		.join("");
	return `${fadeSides("locs-fringe", 214, 0.6)}<path ${HAIR} d="M70 214c-2-76 48-120 130-120s132 44 130 120c-30-14-70-24-130-24S100 200 70 214Z"/>${locs}`;
};

// Locs pulled up into a high ponytail: smooth sides drawn up to a band on top, locs spraying out and falling over the head
// (symmetric ends: facesjs scales the hair for fatness about the middle of its bounding box)
const locsHighPonytail = () => {
	const ends: P[] = [
		[50, 214],
		[350, 214],
		[74, 168],
		[326, 168],
		[104, 132],
		[296, 132],
		[140, 104],
		[260, 104],
		[178, 78],
		[222, 78],
	];
	const locs = ends
		.map(([x, y]) => {
			const dx = x - 200;
			const c: P = [200 + dx * 0.55, 10 + Math.abs(dx) * 0.06];
			return plait(`M200 70Q${pt(c)} ${x} ${y}`, 12, 2, 6);
		})
		.join("");
	return `<path ${HAIR} d="${SILHOUETTE}"/><path ${SHADE} stroke-width="2" stroke-opacity=".45" d="M90 214C110 160 150 110 192 84M132 204C150 156 170 116 196 88M200 200V92M268 204C250 156 230 116 204 88M310 214C290 160 250 110 208 84M62 280C70 200 120 120 188 82M338 280C330 200 280 120 212 82"/>${locs}<path fill="#1b1b1b" stroke="#000" stroke-width="2" d="M184 68h32v14h-32Z"/>`;
};

// Points on a rounded-square arc (a superellipse: n 2 is an ellipse, higher is squarer), angles as arcPoints
const squirclePoints = (
	cx: number,
	cy: number,
	rx: number,
	ry: number,
	n: number,
	from: number,
	to: number,
	count: number,
): P[] =>
	range(0, count, 1).map((i) => {
		const a = ((from + ((to - from) * i) / count) * Math.PI) / 180;
		const c = Math.cos(a);
		const s = Math.sin(a);
		return [
			cx + rx * Math.sign(c) * Math.abs(c) ** (2 / n),
			cy + ry * Math.sign(s) * Math.abs(s) ** (2 / n),
		];
	});

// Rounded afro over a tapered fade with a sharp line-up
const afroTaper = () => {
	const top = squirclePoints(200, 222, 128, 150, 2.8, 180, 360, 30);
	const outline = `${lobed(top, 7).slice(0, -1)}C312 212 262 204 200 204S88 212 72 222Z`;
	const texture = range(0, 40, 1)
		.map((i): P => [96 + ((i * 53) % 208), 84 + ((i * 37) % 116)])
		.filter(
			([x, y]) =>
				((x - 200) / 116) ** 2 + ((y - 222) / 140) ** 2 < 1 && y < 194,
		);
	return `${fadeSides("afro-taper", 222, 0.8)}<path ${HAIR} d="${outline}"/>${curls(texture, 4)}`;
};

// Loose curls on top falling onto the forehead, over a high fade
const curlyFringe = () => {
	const top = arcPoints(200, 218, 128, 124, 180, 360, 16);
	// Fringe, right to left: curls hanging lowest left of the middle
	const fringe: P[] = range(0, 9, 1).map((i) => {
		const x = 318 - (236 * i) / 9;
		const u = (x - 182) / 136;
		return [x, 218 + 30 * (1 - u * u)];
	});
	let d = lobed(top, 14).slice(0, -1);
	for (const p of fringe) {
		d += `A13 13 0 0 1 ${pt(p)}`;
	}
	d += "Z";
	return `${fadeSides("curly-fringe", 216, 0.6)}<path ${HAIR} d="${d}"/>${curls(
		[
			[132, 132],
			[178, 112],
			[226, 114],
			[270, 134],
			[108, 176],
			[154, 160],
			[202, 152],
			[250, 160],
			[294, 182],
			[130, 214],
			[178, 206],
			[226, 210],
		],
	)}`;
};

// Curls pulled up into a bun on the crown over faded sides (the top is drawn back toward the bun)
const curlyTopKnot = () => {
	const bun = lobed(arcPoints(200, 70, 40, 34, 0, 360, 16), 9);
	return `${fadeSides("curly-knot", 222, 0.55)}<path ${HAIR} d="M68 222c-4-80 46-128 132-128s136 48 132 128c-8-6-16-14-22-22-12-8-26-14-40-16-22-4-46-6-70-6s-48 2-70 6c-14 2-28 8-40 16-6 8-14 16-22 22Z"/><path ${SHADE} stroke-width="2" stroke-opacity=".45" d="M86 206c10-40 40-80 84-100c-6 4-12 10-12 18M130 194c8-34 30-66 56-86M200 184c-4-28-2-56 2-80M270 194c-8-34-30-66-56-86M314 206c-10-40-40-80-84-100c6 4 12 10 12 18"/><path ${HAIR3} d="${bun}"/>${curls(
		[
			[180, 60],
			[204, 50],
			[226, 62],
			[214, 84],
			[188, 84],
			[200, 68],
		],
		5,
	)}`;
};

// The flow: medium length, swept back off the forehead, over the ears and flipping out at the neck
const FLOW =
	"M26 352C18 352 16 344 20 336C28 316 34 290 38 258C42 150 100 88 200 88S358 150 362 258C366 290 372 316 380 336C384 344 382 352 374 352C362 352 352 344 344 332C340 302 336 264 320 236C300 212 250 196 200 196S100 212 80 236C64 264 60 302 56 332C48 344 38 352 26 352Z";

// Long fringe swept from a part on the left across the forehead to a point over the right brow, short sides
const SWOOP =
	"M72 224C66 142 118 92 200 92S334 142 328 216C324 234 316 248 304 258C290 240 262 222 222 214C184 206 150 204 128 202C106 202 88 210 72 224Z";

// Two-block cut: a piecey fringe of pointed locks over shaved sides
const twoBlock = () => {
	const tips: P[] = [];
	const n = 11;
	for (let i = 0; i <= n; i++) {
		const x = 332 - (264 * i) / n;
		const lift = Math.abs(x - 200) * 0.12;
		tips.push([x, (i % 2 === 0 ? 226 : 250) - lift]);
	}
	const fringe = tips
		.slice(1)
		.map(
			(p, i) =>
				`Q${pt([(tips[i]![0] + p[0]) / 2 + 2, Math.max(tips[i]![1], p[1]) - 6])} ${pt(p)}`,
		)
		.join("");
	return `${shavedSides("two-block", 0.35)}<path ${HAIR} d="M66 240C56 144 110 88 200 88S344 144 334 240L${pt(tips[0]!)}${fringe}L66 240Z"/><path ${SHADE} stroke-width="2" stroke-opacity=".45" d="${tips
		.filter((_, i) => i % 2 === 1)
		.map(
			([x, y]) =>
				`M${r1(x)} ${r1(y - 8)}C${r1(x - 2)} ${r1(y - 50)} ${r1(200 + (x - 200) * 0.7)} 130 ${r1(200 + (x - 200) * 0.5)} 104`,
		)
		.join("")}"/>`;
};

// Split dye: a short cut, bleached on the right half (drawn as its own shape: a clip path would be shared by every face on the
// page)
const SPLIT_TOP =
	"M66 226C62 144 112 94 200 94S338 144 334 226C324 218 316 208 310 200C278 192 240 190 200 190S122 192 90 200C84 208 76 218 66 226Z";
const SPLIT_RIGHT =
	"M200 94C288 94 338 144 334 226C324 218 316 208 310 200C278 192 240 190 200 190Z";
const splitDye = () =>
	`${fadeSides("split", 228, 0.85)}<path fill="$[hairColor]" d="${SPLIT_TOP}"/><path fill="${BLEACH}" d="${SPLIT_RIGHT}"/><path fill="none" stroke="#000" stroke-width="4" d="${SPLIT_TOP}"/><path ${SHADE} stroke-width="2" stroke-opacity=".5" d="M200 96v92"/>`;

// ---------------------------------------------------------------------------------------------------------------------
// Facial hair helpers (paths of M L H V C S Z only, see the top)

type Cubic = [P, P, P, P];

const cubicAt = ([p0, p1, p2, p3]: Cubic, t: number): P => {
	const u = 1 - t;
	const a = u * u * u;
	const b = 3 * u * u * t;
	const c = 3 * u * t * t;
	const d = t * t * t;
	return [
		a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
		a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
	];
};

// The part of a cubic from t to 1 (de Casteljau)
const cubicFrom = (q: Cubic, t: number): Cubic => {
	const lerp = (a: P, b: P): P => [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
	];
	const ab = lerp(q[0], q[1]);
	const bc = lerp(q[1], q[2]);
	const cd = lerp(q[2], q[3]);
	const abc = lerp(ab, bc);
	const bcd = lerp(bc, cd);
	return [lerp(abc, bcd), bcd, cd, q[3]];
};

// t where a cubic that runs downward reaches row y
const tAtY = (q: Cubic, y: number) => {
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (cubicAt(q, mid)[1] < y) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return (lo + hi) / 2;
};

const mirror = ([x, y]: P): P => [400 - x, y];

// A jaw edge (left half, top to chin) as a path from row y round the chin and up the right side to row y
const jawFrom = (left: Cubic, y: number) => {
	const [a, b, c, d] = cubicFrom(left, tAtY(left, y));
	return {
		start: a,
		end: mirror(a),
		d: `M${pt(a)}C${pt(b)} ${pt(c)} ${pt(d)}C${pt(mirror(c))} ${pt(mirror(b))} ${pt(mirror(a))}`,
	};
};

// The mouth, left bare in a beard (as the fork's full beard)
const MOUTH_HOLE = "M164 440C164 424 236 424 236 440S164 456 164 440Z";

// The stubble edge of the fork's stubble parts (left half): cheek at (54, 316) to the chin at (200, 506)
const STUBBLE_JAW: Cubic = [
	[54, 316],
	[58, 420],
	[112, 498],
	[200, 506],
];
// The full beard's cheek line, from the right cheek round under the mouth to the left cheek
const CHEEK_LINE =
	"C338 360 324 396 300 410C274 424 252 414 200 414S126 424 100 410C76 396 62 360 54 310Z";

const STUBBLE =
	"M54 316C58 420 112 498 200 506C288 498 342 420 346 316C338 362 322 400 294 414C268 424 244 402 200 402S132 424 106 414C78 400 62 362 54 316Z";
const MUSTACHE =
	"M150 424C164 408 186 404 200 412C214 404 236 408 250 424C236 430 216 426 200 424C184 426 164 430 150 424Z";

// Faded beard: dense along the jaw and chin, thinning out up the cheeks to the sideburns
const beardFaded = () => {
	const band = (y: number, inner: string) => {
		const jaw = jawFrom(STUBBLE_JAW, y);
		return `${jaw.d}${inner}Z`;
	};
	const mid = jawFrom(STUBBLE_JAW, 372);
	const low = jawFrom(STUBBLE_JAW, 414);
	const midInner = `C${pt([mid.end[0] - 6, 400])} 300 424 268 428C246 432 226 438 200 438S154 432 132 428C100 424 ${pt([mid.start[0] + 6, 400])} ${pt(mid.start)}`;
	const lowInner = `C${pt([low.end[0] - 10, 432])} 290 450 260 452C240 454 224 460 200 460S160 454 140 452C110 450 ${pt([low.start[0] + 10, 432])} ${pt(low.start)}`;
	return `<path fill="$[hairColor]" fill-opacity=".28" fill-rule="evenodd" d="${STUBBLE}${MOUTH_HOLE}"/><path fill="$[hairColor]" fill-opacity=".38" fill-rule="evenodd" d="${band(372, midInner)}${MOUTH_HOLE}"/><path fill="$[hairColor]" fill-opacity=".6" fill-rule="evenodd" d="${band(414, lowInner)}${MOUTH_HOLE}"/><path fill="none" stroke="#000" stroke-opacity=".7" stroke-width="2" d="${low.d}"/><path ${BEARD} d="${MUSTACHE}"/>`;
};

// Lobes along a cubic (outward = left of the direction of travel on screen), as cubic bumps
const lobesAlong = (q: Cubic, n: number, h: number) => {
	let d = "";
	let prev = cubicAt(q, 0);
	for (let i = 1; i <= n; i++) {
		const p = cubicAt(q, i / n);
		const dx = p[0] - prev[0];
		const dy = p[1] - prev[1];
		const len = Math.hypot(dx, dy) || 1;
		const nx = (dy / len) * h;
		const ny = (-dx / len) * h;
		d += `C${pt([prev[0] + dx * 0.15 + nx, prev[1] + dy * 0.15 + ny])} ${pt([p[0] - dx * 0.15 + nx, p[1] - dy * 0.15 + ny])} ${pt(p)}`;
		prev = p;
	}
	return d;
};

const reverseCubic = ([a, b, c, d]: Cubic): Cubic => [d, c, b, a];
const mirrorCubic = (q: Cubic): Cubic => q.map(mirror) as Cubic;

// Coily beard: a full beard with a tightly curled, bumpy edge (kept a few px inside the usual beard edge so the bumps stay
// on the face)
const beardCoily = () => {
	const left: Cubic = [
		[58, 310],
		[58, 436],
		[116, 512],
		[200, 514],
	];
	const right = reverseCubic(mirrorCubic(left));
	const outer = `M${pt(left[0])}${lobesAlong(left, 14, -5)}${lobesAlong(right, 14, -5)}`;
	const coils = [
		[86, 380],
		[110, 430],
		[140, 474],
		[176, 494],
		[224, 494],
		[260, 474],
		[290, 430],
		[314, 380],
		[200, 478],
		[120, 400],
		[280, 400],
	]
		.map(
			([x, y]) =>
				`M${x! - 5} ${y}C${x! - 3} ${y! - 5} ${x! + 3} ${y! - 5} ${x! + 5} ${y}`,
		)
		.join("");
	return `<path ${BEARD} fill-rule="evenodd" d="${outer}C${pt([340, 360])} 324 396 300 410C274 424 252 414 200 414S126 424 100 410C76 396 64 360 58 310Z${MOUTH_HOLE}"/><path ${SHADE} stroke-width="2" stroke-opacity=".35" d="${coils}"/><path ${BEARD} d="M148 426C160 408 186 402 200 410C214 402 240 408 252 426C246 434 234 432 226 430C218 434 208 432 200 428C192 432 182 434 174 430C166 432 154 434 148 426Z"/>`;
};

// Forked beard: a full beard parting into two points below the chin
const BEARD_FORKED = `M54 310C54 420 96 492 154 520C160 538 168 556 178 570C186 558 194 548 200 540C206 548 214 558 222 570C232 556 240 538 246 520C304 492 346 420 346 310${CHEEK_LINE}`;

// Spade beard: a full beard grown a little below the chin, squared off at the bottom
const BEARD_SPADE = `M54 310C54 410 76 474 112 510C126 532 140 548 160 552C180 556 220 556 240 552C260 548 274 532 288 510C324 474 346 410 346 310${CHEEK_LINE}`;

// ---------------------------------------------------------------------------------------------------------------------

export const BATCH_E_PARTS: readonly StylePart[] = [
	// ---------------------------------------------------------------------------------------------------------------
	// Hair
	{
		feature: "hair",
		id: "fork-cornrows-curved",
		rarity: "rare",
		svg: cornrowsCurved(),
	},
	{
		feature: "hair",
		id: "fork-feed-in-braids",
		rarity: "uncommon",
		svg: feedInBraids(),
	},
	{
		feature: "hair",
		id: "fork-braided-mohawk",
		rarity: "rare",
		svg: braidedMohawk(),
	},
	{
		feature: "hair",
		id: "fork-locs-fringe",
		rarity: "uncommon",
		svg: locsFringe(),
	},
	{
		feature: "hair",
		id: "fork-locs-high-ponytail",
		rarity: "rare",
		svg: locsHighPonytail(),
	},
	{
		feature: "hair",
		id: "fork-afro-taper",
		rarity: "uncommon",
		svg: afroTaper(),
	},
	{
		feature: "hair",
		id: "fork-curly-fringe",
		rarity: "uncommon",
		svg: curlyFringe(),
	},
	{
		feature: "hair",
		id: "fork-curly-top-knot",
		rarity: "rare",
		svg: curlyTopKnot(),
	},
	{
		feature: "hair",
		id: "fork-flow",
		rarity: "uncommon",
		svg: `<path ${HAIR} d="${FLOW}"/><path ${SHADE} stroke-width="2" stroke-opacity=".45" d="M118 206C128 160 160 124 200 112M156 198C166 156 186 126 214 108M236 198C246 160 264 132 290 120M80 236C70 270 66 300 62 330M320 236C330 270 334 300 338 330M98 220C90 170 120 120 170 100"/>`,
	},
	{
		feature: "hair",
		id: "fork-side-swoop",
		rarity: "uncommon",
		svg: `${fadeSides("swoop", 222, 0.55)}<path ${HAIR} d="${SWOOP}"/><path ${SHADE} stroke-width="2" stroke-opacity=".5" d="M138 198C134 160 142 124 162 98M164 202C200 196 250 204 290 236M170 176C214 172 262 184 304 220M176 150C220 146 266 160 312 196"/>`,
	},
	{
		feature: "hair",
		id: "fork-two-block",
		rarity: "uncommon",
		svg: twoBlock(),
	},
	{
		feature: "hair",
		id: "fork-split-dye",
		rarity: "rare",
		svg: splitDye(),
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Facial hair
	{
		feature: "facialHair",
		id: "fork-beard-faded",
		rarity: "uncommon",
		svg: beardFaded(),
	},
	{
		feature: "facialHair",
		id: "fork-beard-coily",
		svg: beardCoily(),
	},
	{
		feature: "facialHair",
		id: "fork-beard-forked",
		rarity: "rare",
		svg: `<path ${BEARD} fill-rule="evenodd" d="${BEARD_FORKED}${MOUTH_HOLE}"/><path ${SHADE} stroke-width="2" stroke-opacity=".45" d="M176 520C180 536 182 548 180 560M224 520C220 536 218 548 220 560M200 480V530"/><path ${BEARD} d="${MUSTACHE}"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-beard-spade",
		rarity: "uncommon",
		svg: `<path ${BEARD} fill-rule="evenodd" d="${BEARD_SPADE}${MOUTH_HOLE}"/><path ${SHADE} stroke-width="2" stroke-opacity=".45" d="M150 500C156 520 164 536 172 546M250 500C244 520 236 536 228 546M200 474V548"/><path ${BEARD} d="${MUSTACHE}"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-stache-scruff",
		svg: `<path fill="$[hairColor]" fill-opacity=".26" d="${STUBBLE}"/><path ${BEARD} d="M144 430C148 410 176 400 200 408C224 400 252 410 256 430C258 440 250 446 242 444C228 438 214 434 200 436C186 434 172 438 158 444C150 446 142 440 144 430Z"/>`,
	},
	{
		feature: "facialHair",
		id: "fork-imperial",
		rarity: "rare",
		svg: `<path ${BEARD} d="M200 414C214 404 236 404 250 414C262 422 278 416 296 392C294 414 284 430 262 434C240 438 222 428 200 428C178 428 160 438 138 434C116 430 106 414 104 392C122 416 138 422 150 414C164 404 186 404 200 414Z"/><path ${BEARD} d="M188 468C194 464 206 464 212 468C214 484 208 500 200 514C192 500 186 484 188 468Z"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Eyes (left eye, outer corner on the left)
	{
		feature: "eye",
		id: "fork-eye-upturned",
		svg: `<path fill="#fff" stroke="#000" stroke-width="4" d="M2 10C14 6 30 4 46 8C62 12 74 20 82 30C68 36 52 38 38 34C24 30 12 22 2 10Z"/><path d="${circ(44, 21, 9)}"/><path fill="#fff" d="${circ(47, 18, 2.4)}"/><path ${SHADE} stroke-width="5" d="M1 9C14 4 30 2 46 6C62 10 74 18 83 28"/>`,
	},
	{
		feature: "eye",
		id: "fork-eye-intense",
		svg: `<path fill="#fff" stroke="#000" stroke-width="4" d="M3 14H80C76 28 60 36 42 36S8 28 3 14Z"/><path d="${circ(44, 22, 10)}"/><path fill="#fff" d="${circ(48, 22, 2.5)}"/><path ${SHADE} stroke-width="6" d="M1 13H82"/>`,
	},
	{
		feature: "eye",
		id: "fork-eye-smiling",
		rarity: "rare",
		svg: `<path ${SHADE} stroke-width="6" d="M4 30C14 14 28 8 42 8S70 14 80 30"/><path ${SHADE} stroke-width="2.5" stroke-opacity=".55" d="M20 36C32 40 52 40 64 36"/>`,
	},
	{
		feature: "eye",
		id: "fork-eye-light",
		rarity: "rare",
		svg: `<path fill="#fff" stroke="#000" stroke-width="4" d="M3 26C14 14 28 8 42 8S68 14 79 26C67 34 53 37 40 37S14 33 3 26Z"/><path fill="#6f9474" stroke="#2c3b2f" stroke-width="2" d="${circ(43, 22, 11)}"/><path d="${circ(43, 22, 5)}"/><path fill="#fff" d="${circ(47, 18, 2.4)}"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Brows (left brow, inner end on the right)
	{
		feature: "eyebrow",
		id: "fork-brow-worried",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M3 26C18 22 36 18 52 13C64 10 72 6 80 2C84 5 84 11 81 14C70 19 58 23 46 26C32 29 18 31 5 33C2 31 1 28 3 26Z"/>`,
	},
	{
		feature: "eyebrow",
		id: "fork-brow-short",
		svg: `<path fill="none" d="M0 16H84"/><path fill="$[hairColor]" stroke="#000" d="M34 14C46 8 64 5 80 7C84 11 84 18 80 22C66 20 50 20 36 23C32 21 31 17 34 14Z"/>`,
	},
	{
		feature: "eyebrow",
		id: "fork-brow-peaked",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M3 25L30 7C34 4 38 4 42 5L80 12C84 14 84 20 80 22L42 16C38 15 36 16 33 18L8 31C4 31 2 28 3 25Z"/>`,
	},
	{
		feature: "eyebrow",
		id: "fork-brow-s-curve",
		svg: `<path fill="$[hairColor]" stroke="#000" d="M3 24C14 14 26 9 40 9C54 9 62 15 72 13C76 12 79 10 82 8C84 12 84 17 81 20C76 23 70 24 62 23C52 22 46 18 38 19C26 20 16 26 6 31C3 30 2 27 3 24Z"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Ears (left ear, opening to the right)
	{
		feature: "ear",
		id: "fork-ear-protruding",
		svg: `<path fill="none" d="M-4 36H78"/><path ${SKIN} d="M50 12C38 2 20-2 8 4C-2 10-4 30 0 44C4 58 16 68 30 68C40 68 48 62 50 58Z"/><path ${SHADE} stroke-width="3" d="M38 20C28 12 16 14 12 26S16 50 28 54M30 28C24 28 22 36 26 40"/>`,
	},
	{
		feature: "ear",
		id: "fork-ear-attached",
		svg: `<path ${SKIN} d="M44 10C32 2 16 0 8 8C0 16 2 34 6 44C10 54 22 60 44 66Z"/><path ${SHADE} stroke-width="3" d="M34 20C26 14 16 16 14 26S18 44 26 48"/>`,
	},
	{
		feature: "ear",
		id: "fork-ear-detailed",
		svg: `<path ${SKIN} d="M44 12C34 4 22 0 12 4C2 10 2 30 4 42C6 54 16 64 28 64C36 64 44 58 44 58Z"/><path ${SHADE} stroke-width="2.5" d="M36 14C28 8 18 8 13 14C8 22 9 36 12 44M34 22C28 22 24 28 26 36C27 42 24 48 20 50M26 30L20 24M40 42C36 42 34 46 36 50"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Noses
	{
		feature: "nose",
		id: "fork-nose-long",
		svg: `<path ${SHADE} stroke-width="4" d="M26 0C26 28 27 52 28 68"/><path ${SHADE} stroke-width="4" d="M18 72C14 84 22 94 34 94S54 84 50 72"/><path ${SHADE} stroke-width="3.5" d="M8 80C4 88 10 96 18 92M60 80C64 88 58 96 50 92"/>`,
	},
	{
		feature: "nose",
		id: "fork-nose-roman",
		svg: `<path ${SHADE} stroke-width="4" d="M20 0C22 10 30 16 32 26C34 40 38 56 46 66C50 72 46 78 38 78"/><path ${SHADE} stroke-width="3.5" d="M8 70C12 76 18 78 26 76M56 68C54 74 50 77 44 78"/>`,
	},
	{
		feature: "nose",
		id: "fork-nose-soft",
		svg: `<path fill="#000" fill-opacity=".16" d="M30 0C32 14 32 26 28 36C24 28 24 12 30 0Z"/><path fill="#000" fill-opacity=".22" d="M6 40C14 50 26 54 36 54S58 50 66 40C60 54 50 60 36 60S12 54 6 40Z"/><path ${SHADE} stroke-width="3.5" d="M16 44C22 50 50 50 56 44"/><path ${SHADE} stroke-width="3.5" d="M22 48C24 50 28 50 30 48M42 48C44 50 48 50 50 48"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Mouths
	{
		feature: "mouth",
		id: "fork-mouth-tongue",
		rarity: "rare",
		svg: `<path fill="#3a1414" stroke="#000" stroke-width="5" stroke-linejoin="round" d="M4 4C30 12 70 12 96 4C92 24 74 36 50 36S8 24 4 4Z"/><path fill="#fff" d="M12 8C36 14 64 14 88 8L86 15C62 20 38 20 14 15Z"/><path fill="#d9666b" stroke="#000" stroke-width="3" d="M34 24C34 44 40 56 50 56S66 44 66 24C58 28 42 28 34 24Z"/><path ${SHADE} stroke-width="2" stroke-opacity=".4" d="M50 30V46"/>`,
	},
	{
		feature: "mouth",
		id: "fork-mouth-gritted",
		rarity: "uncommon",
		svg: `<path fill="#fff" stroke="#000" stroke-width="5" stroke-linejoin="round" d="M4 8C20 2 80 2 96 8C98 16 96 24 94 28C76 34 24 34 6 28C4 24 2 16 4 8Z"/><path ${SHADE} stroke-width="2.5" d="M6 18C30 20 70 20 94 18"/><path ${SHADE} stroke-width="1.8" stroke-opacity=".6" d="M24 6V30M38 5V31M50 5V31M62 5V31M76 6V30"/>`,
	},
	{
		feature: "mouth",
		id: "fork-mouth-bite-lip",
		rarity: "rare",
		svg: `<path fill="#fff" stroke="#000" stroke-width="3" stroke-linejoin="round" d="M26 8C38 13 62 13 74 8L72 21C60 25 40 25 28 21Z"/><path ${SHADE} stroke-width="1.5" stroke-opacity=".5" d="M40 12V23M50 13V24M60 12V23"/><path ${SHADE} stroke-width="5" d="M4 8C30 2 70 2 96 8"/><path ${SHADE} stroke-width="4" d="M16 20C30 34 70 34 84 20"/>`,
	},

	// ---------------------------------------------------------------------------------------------------------------
	// Heads (the shared facesjs top, a new jaw)
	head(
		"fork-head-angular",
		"C350 340 348 372 344 396L312 456C300 474 270 494 244 500L156 500C130 494 100 474 88 456L56 396C52 372 50 340 50 300",
	),
	head(
		"fork-head-strong-chin",
		"C350 372 336 430 306 462C284 484 262 492 246 496C240 506 228 510 200 510S160 506 154 496C138 492 116 484 94 462C64 430 50 372 50 300",
		`<path ${SHADE} stroke-width="3" stroke-opacity=".45" d="M182 482C194 487 206 487 218 482"/>`,
	),
];
