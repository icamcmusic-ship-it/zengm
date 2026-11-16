// Small SVG path toolkit for the face parts (facesjs and the fork's): parse a path's "d" (M L H V C S Z, absolute and
// relative, the only commands the face parts use), rewrite it with every point mapped through a function, and flatten it
// to polylines for measuring. Used by common/faceFit.ts to fit facial hair to the head it's drawn on.

export type Point = [number, number];

// Absolute segments: every path becomes moves, cubic curves and closes (lines are degenerate cubics)
export type Segment =
	| { type: "M"; p: Point }
	| { type: "C"; c1: Point; c2: Point; p: Point }
	| { type: "Z" };

const TOKEN =
	/([ACHLMQSTVZachlmqstvz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/g;

const ARITY: Record<string, number> = {
	M: 2,
	L: 2,
	H: 1,
	V: 1,
	C: 6,
	S: 4,
	Z: 0,
};

// undefined for a path with a command this parser doesn't know (arcs, quadratics): such a path is left alone
export const parsePath = (d: string): Segment[] | undefined => {
	const tokens: (number | string)[] = [];
	for (const m of d.matchAll(TOKEN)) {
		tokens.push(m[1] ?? Number(m[2]));
	}
	const out: Segment[] = [];
	let i = 0;
	let cmd = "";
	let x = 0;
	let y = 0;
	let startX = 0;
	let startY = 0;
	// Last cubic's second control point, for S
	let lastC2: Point | undefined;
	while (i < tokens.length) {
		const token = tokens[i];
		if (typeof token === "string") {
			cmd = token;
			i += 1;
		} else if (cmd === "") {
			return undefined;
		}
		const upper = cmd.toUpperCase();
		const arity = ARITY[upper];
		if (arity === undefined) {
			return undefined;
		}
		const rel = cmd !== upper;
		if (upper === "Z") {
			out.push({ type: "Z" });
			x = startX;
			y = startY;
			lastC2 = undefined;
			// "Z" takes no numbers; a number right after it would start an implicit command, which SVG doesn't allow
			if (typeof tokens[i] === "number") {
				return undefined;
			}
			continue;
		}
		const args: number[] = [];
		for (let k = 0; k < arity; k++) {
			const value = tokens[i + k];
			if (typeof value !== "number") {
				return undefined;
			}
			args.push(value);
		}
		i += arity;
		const ox = rel ? x : 0;
		const oy = rel ? y : 0;
		if (upper === "M") {
			x = ox + args[0]!;
			y = oy + args[1]!;
			startX = x;
			startY = y;
			out.push({ type: "M", p: [x, y] });
			lastC2 = undefined;
			// Further pairs after a move are lines
			cmd = rel ? "l" : "L";
		} else if (upper === "L" || upper === "H" || upper === "V") {
			const nx = upper === "V" ? x : ox + args[0]!;
			const ny =
				upper === "H" ? y : upper === "V" ? oy + args[0]! : oy + args[1]!;
			out.push({
				type: "C",
				c1: [x + (nx - x) / 3, y + (ny - y) / 3],
				c2: [x + ((nx - x) * 2) / 3, y + ((ny - y) * 2) / 3],
				p: [nx, ny],
			});
			x = nx;
			y = ny;
			lastC2 = undefined;
		} else {
			let c1: Point;
			let c2: Point;
			let p: Point;
			if (upper === "C") {
				c1 = [ox + args[0]!, oy + args[1]!];
				c2 = [ox + args[2]!, oy + args[3]!];
				p = [ox + args[4]!, oy + args[5]!];
			} else {
				c1 = lastC2 ? [2 * x - lastC2[0], 2 * y - lastC2[1]] : [x, y];
				c2 = [ox + args[0]!, oy + args[1]!];
				p = [ox + args[2]!, oy + args[3]!];
			}
			out.push({ type: "C", c1, c2, p });
			lastC2 = c2;
			x = p[0];
			y = p[1];
		}
	}
	return out;
};

const fmt = (n: number) => {
	const r = Math.round(n * 100) / 100;
	return Object.is(r, -0) ? "0" : String(r);
};

export const segmentsToPath = (segments: readonly Segment[]) => {
	let s = "";
	for (const seg of segments) {
		if (seg.type === "M") {
			s += `M${fmt(seg.p[0])} ${fmt(seg.p[1])}`;
		} else if (seg.type === "C") {
			s += `C${fmt(seg.c1[0])} ${fmt(seg.c1[1])} ${fmt(seg.c2[0])} ${fmt(seg.c2[1])} ${fmt(seg.p[0])} ${fmt(seg.p[1])}`;
		} else {
			s += "Z";
		}
	}
	return s;
};

export const mapSegments = (
	segments: readonly Segment[],
	f: (p: Point) => Point,
): Segment[] =>
	segments.map((seg) =>
		seg.type === "M"
			? { type: "M", p: f(seg.p) }
			: seg.type === "C"
				? { type: "C", c1: f(seg.c1), c2: f(seg.c2), p: f(seg.p) }
				: seg,
	);

// Each cubic cut (de Casteljau) into pieces no longer than about maxLength, so that mapping the points of a piece maps the
// curve between them closely (a long curve's control points can be far from the curve itself)
export const subdivide = (
	segments: readonly Segment[],
	maxLength: number,
	maxPieces = 16,
): Segment[] => {
	const out: Segment[] = [];
	let at: Point = [0, 0];
	let start: Point = [0, 0];
	const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
	const lerp = (a: Point, b: Point, t: number): Point => [
		a[0] + (b[0] - a[0]) * t,
		a[1] + (b[1] - a[1]) * t,
	];
	for (const seg of segments) {
		if (seg.type === "M") {
			out.push(seg);
			at = seg.p;
			start = seg.p;
		} else if (seg.type === "Z") {
			out.push(seg);
			at = start;
		} else {
			// Control polygon length bounds the curve's length
			const length =
				dist(at, seg.c1) + dist(seg.c1, seg.c2) + dist(seg.c2, seg.p);
			const n = Math.min(maxPieces, Math.max(1, Math.ceil(length / maxLength)));
			let p0 = at;
			let c1 = seg.c1;
			let c2 = seg.c2;
			const p3 = seg.p;
			for (let k = n; k > 1; k--) {
				// Split off the first 1/k of what's left
				const t = 1 / k;
				const a = lerp(p0, c1, t);
				const b = lerp(c1, c2, t);
				const c = lerp(c2, p3, t);
				const d = lerp(a, b, t);
				const e = lerp(b, c, t);
				const f = lerp(d, e, t);
				out.push({ type: "C", c1: a, c2: d, p: f });
				p0 = f;
				c1 = e;
				c2 = c;
			}
			out.push({ type: "C", c1, c2, p: p3 });
			at = seg.p;
		}
	}
	return out;
};

// Polylines (one per subpath), each cubic cut into `steps` pieces
export const flatten = (segments: readonly Segment[], steps = 16) => {
	const lines: Point[][] = [];
	let current: Point[] = [];
	let at: Point = [0, 0];
	for (const seg of segments) {
		if (seg.type === "M") {
			if (current.length > 1) {
				lines.push(current);
			}
			current = [seg.p];
			at = seg.p;
		} else if (seg.type === "C") {
			for (let k = 1; k <= steps; k++) {
				const t = k / steps;
				const u = 1 - t;
				current.push([
					u * u * u * at[0] +
						3 * u * u * t * seg.c1[0] +
						3 * u * t * t * seg.c2[0] +
						t * t * t * seg.p[0],
					u * u * u * at[1] +
						3 * u * u * t * seg.c1[1] +
						3 * u * t * t * seg.c2[1] +
						t * t * t * seg.p[1],
				]);
			}
			at = seg.p;
		} else if (current.length > 0) {
			current.push(current[0]!);
			at = current[0]!;
		}
	}
	if (current.length > 1) {
		lines.push(current);
	}
	return lines;
};

// x where the polylines cross the row y
export const crossings = (lines: readonly Point[][], y: number) => {
	const xs: number[] = [];
	for (const line of lines) {
		for (let k = 1; k < line.length; k++) {
			const [x0, y0] = line[k - 1]!;
			const [x1, y1] = line[k]!;
			if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) {
				xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
			}
		}
	}
	return xs;
};
