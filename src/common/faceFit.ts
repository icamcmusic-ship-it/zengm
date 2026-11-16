// Facial hair fitted to the head it's drawn on (draw-time, common/faceRender.ts; League Extras "New Face Styles" or "Face
// Aging").
//
// facesjs draws every facial hair part as is, in the same place on every head, and widens the face with fatness by scaling
// the head and the facial hair alike (x only, about the centre of each one's bounding box). The fatness part already lines
// up: every head and every facial hair part (facesjs' and the fork's) is symmetric about x = 200, so both scale about the
// same centre. The jaw doesn't: the parts are drawn for one jaw (facesjs' head1: 103 px from the centre at the mouth, chin
// at y 500), while the heads' jaws run from 100 px (head2) to 135 px (head17) wide at the mouth and their chins from y 500
// to 510. So on a wide jaw a stubble or beard edge stops short of the jaw line, leaving a strip of bare skin; on a narrow
// one it runs past the outline onto the background; a pencil beard line floats inside a square jaw; a chin piece sits too
// high on a long chin.
//
// The fit moves each point of a part from head1's jaw onto this head's jaw, a row at a time and per side:
// - below the mouth (y 440) the rows are stretched so head1's chin (y 500) lands on this head's chin; hanging beards move
//   with the chin;
// - a piece that follows the jaw (stubble, beards, chin straps, sideburns, mutton chops, ...) is widened or narrowed so a
//   point on head1's jaw line lands on this head's, and a point past it (a full beard's volume) stays as far past it.
//   The middle of the face (the mouth and mustache, up to 60 px from the centre) doesn't move. A piece that stays clear of
//   the jaw (mustaches, goatees, soul patches, a handlebar, a horseshoe) only follows the chin.
// - above the jaw (y < 300, where every head has the same outline) nothing moves, so sideburns still meet the hair.
// Curves are cut into short pieces first, so the curve between two moved points follows the new jaw too. The fit only moves
// points: colours (a greying beard's own colour, "~fb") and fatness work as before.
//
// Fatness: a fitted part also gets an invisible full-width anchor, so its bounding box is centred on x = 200 like the
// head's whatever the warp did, and fatness scales both about exactly the same point. That also fixes facesjs' own small
// misfit: some facesjs parts (mutton chops, a chin strap, some sideburns, ...) are up to a pixel off centre, so facesjs
// scales them about a slightly different point than the head. On head1 the anchor is all that's added.
import {
	crossings,
	flatten,
	mapSegments,
	parsePath,
	segmentsToPath,
	subdivide,
	type Point,
	type Segment,
} from "./facePath.ts";

export const FIT_REFERENCE_HEAD = "head1";

const CENTER = 200;
// Above this row every head has the same outline
const JAW_TOP = 300;
// The mouth row: nothing above it moves up or down
const MOUTH_Y = 440;
// Up to this far from the centre (the mouth and mustache) nothing moves sideways
const MIDDLE = 60;
// Width (px) of the band inside the jaw line that keeps its distance to the line
const BAND = 16;
// The widest any part reaches out from the centre (the cheeks are 150 px out; full beards bulge a few px past them)
const OUTER = 156;
// How close (px) a part's edge has to come to head1's jaw line to count as reaching the jaw
const REACH = 12;
const REACH_ROWS = 30;

type Profile = {
	chin: number;
	// Distance from the centre to the outline on each side, per row from JAW_TOP (one entry per px)
	left: number[];
	right: number[];
};

const SKIN_PATH = /<path\b[^>]*\bd="([^"]+)"/;

export const headProfile = (headSvg: string): Profile | undefined => {
	const d = SKIN_PATH.exec(headSvg)?.[1];
	const segments = d === undefined ? undefined : parsePath(d);
	if (!segments) {
		return undefined;
	}
	const lines = flatten(segments, 32);
	let chin = 0;
	for (const line of lines) {
		for (const [, y] of line) {
			chin = Math.max(chin, y);
		}
	}
	if (chin <= MOUTH_Y + 20) {
		return undefined;
	}
	const left: number[] = [];
	const right: number[] = [];
	for (let y = JAW_TOP; y <= Math.ceil(chin); y++) {
		const xs = crossings(lines, Math.min(y, chin - 0.01));
		if (xs.length < 2) {
			left.push(left.at(-1) ?? 0);
			right.push(right.at(-1) ?? 0);
		} else {
			left.push(CENTER - Math.min(...xs));
			right.push(Math.max(...xs) - CENTER);
		}
	}
	return { chin, left, right };
};

const widthAt = (profile: Profile, side: "left" | "right", y: number) => {
	const rows = profile[side];
	const i = Math.max(0, Math.min(rows.length - 1, y - JAW_TOP));
	const i0 = Math.floor(i);
	const i1 = Math.min(rows.length - 1, i0 + 1);
	return rows[i0]! + (rows[i1]! - rows[i0]!) * (i - i0);
};

// Last row whose width is used for everything below it (the outline closes in fast at the very bottom of the chin)
const lastRow = (profile: Profile) => profile.chin - 12;

const verticalMap = (from: Profile, to: Profile) => (y: number) => {
	if (y <= MOUTH_Y) {
		return y;
	}
	if (y <= from.chin) {
		return (
			MOUTH_Y + ((y - MOUTH_Y) * (to.chin - MOUTH_Y)) / (from.chin - MOUTH_Y)
		);
	}
	return y + to.chin - from.chin;
};

// Point mapping from the reference head's jaw to another head's
export const jawWarp = (from: Profile, to: Profile, sideways: boolean) => {
	const vmap = verticalMap(from, to);
	return ([x, y]: Point): Point => {
		const y2 = vmap(y);
		const dx = x - CENTER;
		if (!sideways || dx === 0 || y <= JAW_TOP) {
			return [x, y2];
		}
		const side = dx < 0 ? "left" : "right";
		const row = Math.min(y, lastRow(from));
		const wFrom = widthAt(from, side, row);
		const wTo = widthAt(to, side, vmap(row));
		const d = Math.abs(dx);
		// The middle stays; a band just inside the jaw line keeps its distance to it (a stubble edge, a pencil beard line);
		// in between, stretched to fit
		const a = Math.min(MIDDLE, wFrom / 2, wTo / 2);
		const band = Math.min(BAND, (wFrom - a) / 2, (wTo - a) / 2);
		let d2;
		if (d <= a) {
			d2 = d;
		} else if (d <= wFrom - band) {
			d2 = a + ((d - a) * (wTo - band - a)) / (wFrom - band - a);
		} else if (d <= wFrom) {
			d2 = d + wTo - wFrom;
		} else {
			// Past the jaw line (a full beard's volume): as far past it, but on a wider jaw squeezed so it doesn't reach further
			// out than it did on head1 (past the cheeks)
			d2 =
				wTo +
				(d - wFrom) *
					Math.min(1, Math.max(0, OUTER - wTo) / Math.max(1, OUTER - wFrom));
		}
		return [CENTER + Math.sign(dx) * d2, y2];
	};
};

const PATH_D = /(<path\b[^>]*?\sd=")([^"]+)(")/g;

// Whether a piece (subpath) of a part follows head1's jaw line: an edge of it within REACH px of the outline on at least
// REACH_ROWS rows between the jaw top and the chin. Stubble, beards, chin straps and sideburns do; a horseshoe mustache or
// goatee that only comes near the outline where the chin narrows doesn't. Decided per piece, so a facesjs part that merges
// sideburns and a mustache into one path fits the sideburns to the jaw and leaves the mustache where it is.
export const reachesJaw = (segments: readonly Segment[], ref: Profile) => {
	const lines = flatten(segments);
	let rows = 0;
	for (let y = JAW_TOP + 20; y <= lastRow(ref); y++) {
		const xs = crossings(lines, y);
		if (
			xs.length > 0 &&
			(CENTER - Math.min(...xs) >= widthAt(ref, "left", y) - REACH ||
				Math.max(...xs) - CENTER >= widthAt(ref, "right", y) - REACH)
		) {
			rows += 1;
		}
	}
	return rows >= REACH_ROWS;
};

const subpaths = (segments: readonly Segment[]) => {
	const out: Segment[][] = [];
	for (const seg of segments) {
		if (seg.type === "M" || out.length === 0) {
			out.push([]);
		}
		out.at(-1)!.push(seg);
	}
	return out;
};

// Curves are cut into pieces about this long (px) before their points are moved
const PIECE = 12;

// Invisible, so it draws nothing; it only widens the bounding box symmetrically (see the top)
const ANCHOR = '<path fill="none" d="M0 300H400"/>';

export const fitFacialHairSvg = (
	partSvg: string,
	ref: Profile,
	to: Profile,
) => {
	if (to === ref) {
		// head1: the jaw the parts are drawn for, so only the anchor (a few facesjs parts are a pixel off centre, which
		// shifts them by a fraction of a pixel against the head when fatness narrows the face)
		return `${partSvg}${ANCHOR}`;
	}
	const warps = [jawWarp(ref, to, false), jawWarp(ref, to, true)] as const;
	const body = partSvg.replace(
		PATH_D,
		(whole, start: string, d: string, end: string) => {
			const segments = parsePath(d);
			if (!segments) {
				return whole;
			}
			const fitted = subpaths(segments).flatMap((piece) =>
				mapSegments(
					subdivide(piece, PIECE),
					warps[reachesJaw(piece, ref) ? 1 : 0],
				),
			);
			return `${start}${segmentsToPath(fitted)}${end}`;
		},
	);
	return `${body}${ANCHOR}`;
};
