// Just enough TrueType parsing to embed a font in a PDF (miniPdf.ts): the Unicode -> glyph map (cmap format 4), glyph
// advance widths and a few metrics. The fonts are public/fonts/DejaVuSans*-latin.ttf, subsets of DejaVu Sans (Latin,
// Latin Extended A/B, Latin Extended Additional for Vietnamese, combining marks, common punctuation).

export type TrueTypeFont = {
	bytes: Uint8Array;
	unitsPerEm: number;
	ascent: number;
	descent: number;
	bbox: [number, number, number, number];
	// Advance width of each glyph, in font units
	widths: number[];
	cmap: Map<number, number>;
};

export const parseTrueType = (
	buffer: ArrayBuffer | Uint8Array,
): TrueTypeFont => {
	const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const numTables = view.getUint16(4);
	const tables = new Map<string, number>();
	for (let i = 0; i < numTables; i++) {
		const offset = 12 + 16 * i;
		const tag = String.fromCharCode(...bytes.subarray(offset, offset + 4));
		tables.set(tag, view.getUint32(offset + 8));
	}
	const table = (tag: string) => {
		const offset = tables.get(tag);
		if (offset === undefined) {
			throw new Error(`Font has no ${tag} table`);
		}
		return offset;
	};

	const head = table("head");
	const unitsPerEm = view.getUint16(head + 18);
	const bbox: TrueTypeFont["bbox"] = [
		view.getInt16(head + 36),
		view.getInt16(head + 38),
		view.getInt16(head + 40),
		view.getInt16(head + 42),
	];

	const hhea = table("hhea");
	const ascent = view.getInt16(hhea + 4);
	const descent = view.getInt16(hhea + 6);
	const numberOfHMetrics = view.getUint16(hhea + 34);
	const numGlyphs = view.getUint16(table("maxp") + 4);

	const hmtx = table("hmtx");
	const widths: number[] = [];
	for (let i = 0; i < numGlyphs; i++) {
		widths.push(view.getUint16(hmtx + 4 * Math.min(i, numberOfHMetrics - 1)));
	}

	const cmapTable = table("cmap");
	const numSubtables = view.getUint16(cmapTable + 2);
	let subtable: number | undefined;
	for (let i = 0; i < numSubtables; i++) {
		const platform = view.getUint16(cmapTable + 4 + 8 * i);
		const encoding = view.getUint16(cmapTable + 6 + 8 * i);
		const offset = cmapTable + view.getUint32(cmapTable + 8 + 8 * i);
		if (
			view.getUint16(offset) === 4 &&
			((platform === 3 && encoding === 1) || platform === 0)
		) {
			subtable = offset;
			break;
		}
	}
	if (subtable === undefined) {
		throw new Error("Font has no Unicode cmap");
	}
	const cmap = new Map<number, number>();
	const segCount = view.getUint16(subtable + 6) / 2;
	const endCodes = subtable + 14;
	const startCodes = endCodes + 2 * segCount + 2;
	const idDeltas = startCodes + 2 * segCount;
	const idRangeOffsets = idDeltas + 2 * segCount;
	for (let s = 0; s < segCount; s++) {
		const end = view.getUint16(endCodes + 2 * s);
		const start = view.getUint16(startCodes + 2 * s);
		const delta = view.getInt16(idDeltas + 2 * s);
		const rangeOffset = view.getUint16(idRangeOffsets + 2 * s);
		for (let c = start; c <= end && c !== 0xffff; c++) {
			let glyph;
			if (rangeOffset === 0) {
				glyph = (c + delta) & 0xffff;
			} else {
				const at = idRangeOffsets + 2 * s + rangeOffset + 2 * (c - start);
				glyph = view.getUint16(at);
				if (glyph !== 0) {
					glyph = (glyph + delta) & 0xffff;
				}
			}
			if (glyph !== 0) {
				cmap.set(c, glyph);
			}
		}
	}

	return { bytes, unitsPerEm, ascent, descent, bbox, widths, cmap };
};

// Glyph ids for a string: precomposed letters where the font has them, otherwise the base letter without its accent,
// otherwise "?"
export const textToGlyphs = (font: TrueTypeFont, text: string) => {
	const glyphs: { glyph: number; code: number }[] = [];
	const question = font.cmap.get(63) ?? 0;
	for (const char of text.normalize("NFC")) {
		const code = char.codePointAt(0)!;
		let glyph = font.cmap.get(code);
		let used = code;
		if (glyph === undefined) {
			const base = char.normalize("NFD").codePointAt(0)!;
			glyph = font.cmap.get(base);
			used = base;
		}
		if (glyph === undefined) {
			glyph = question;
			used = 63;
		}
		glyphs.push({ glyph, code: used });
	}
	return glyphs;
};

export const measureText = (font: TrueTypeFont, text: string, size: number) =>
	(textToGlyphs(font, text).reduce(
		(sum, { glyph }) => sum + (font.widths[glyph] ?? 0),
		0,
	) *
		size) /
	font.unitsPerEm;
