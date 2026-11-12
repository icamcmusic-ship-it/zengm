// A tiny PDF writer (text, filled rectangles, JPEG images), so "Download players" can make a PDF without a PDF library in
// the bundle. Text uses an embedded Unicode TrueType font when one is given (DejaVu Sans, see ttf.ts), so names like
// Dončić, Şengün, Łukasz, Þórsson or Nguyễn come out right, and falls back to the standard Helvetica (Latin-1 only)
// otherwise. Coordinates are in points from the top left of a US Letter page (landscape, so wide stats tables fit).
import { measureText, textToGlyphs, type TrueTypeFont } from "./ttf.ts";

export const PAGE_WIDTH = 792;
export const PAGE_HEIGHT = 612;

type Image = { bytes: Uint8Array; width: number; height: number };

export type PdfFonts = { regular: TrueTypeFont; bold: TrueTypeFont };

const encoder = new TextEncoder();

// Helvetica in PDF only knows WinAnsi (about Latin-1): strip accents, then replace anything else
export const pdfSafeText = (text: string) =>
	text
		.normalize("NFD")
		.replaceAll(/\p{M}/gu, "")
		.replaceAll(/[‘’]/g, "'")
		.replaceAll(/[“”]/g, '"')
		.replaceAll(/[–—]/g, "-")
		.replaceAll(/[^\u{20}-\u{7E}\u{A0}-\u{FF}]/gu, "?")
		.replaceAll("\\", "\\\\")
		.replaceAll("(", String.raw`\(`)
		.replaceAll(")", String.raw`\)`);

const rgb = (hex: string) => {
	const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
	if (!m) {
		return "0 0 0";
	}
	return [m[1], m[2], m[3]]
		.map((h) => (Number.parseInt(h!, 16) / 255).toFixed(3))
		.join(" ");
};

// Average Helvetica glyph width is about 0.5em; good enough for truncating/centering without an embedded font
export const approxTextWidth = (text: string, size: number) =>
	text.length * size * 0.5;

const hex4 = (n: number) => n.toString(16).padStart(4, "0");

// ToUnicode CMap, so text in the PDF can be searched and copied
const toUnicodeCMap = (used: Map<number, number>) => {
	const entries = Array.from(used.entries());
	const chunks: string[] = [];
	for (let i = 0; i < entries.length; i += 100) {
		const chunk = entries.slice(i, i + 100);
		chunks.push(
			`${chunk.length} beginbfchar\n${chunk
				.map(([glyph, code]) => {
					const utf16 = String.fromCodePoint(code);
					const hex = Array.from({ length: utf16.length }, (_, j) =>
						hex4(utf16.charCodeAt(j)),
					).join("");
					return `<${hex4(glyph)}> <${hex}>`;
				})
				.join("\n")}\nendbfchar`,
		);
	}
	return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${chunks.join("\n")}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
};

export class MiniPdf {
	private pages: string[][] = [];
	private images: Image[] = [];
	private pageImages: number[][] = [];
	private target = -1;
	private fonts: PdfFonts | undefined;
	// glyph -> Unicode code point, per font, for widths and ToUnicode
	private used = {
		regular: new Map<number, number>(),
		bold: new Map<number, number>(),
	};

	constructor(fonts?: PdfFonts) {
		this.fonts = fonts;
	}

	get unicode() {
		return this.fonts !== undefined;
	}

	measure(text: string, size: number, bold = false) {
		if (!this.fonts) {
			return approxTextWidth(text, size);
		}
		return measureText(bold ? this.fonts.bold : this.fonts.regular, text, size);
	}

	addPage() {
		this.pages.push([]);
		this.pageImages.push([]);
		this.target = this.pages.length - 1;
		return this;
	}

	// Draw on an earlier page (page headers with "page x of y", once y is known); -1 for the newest page
	onPage(index: number) {
		this.target = index < 0 ? this.pages.length - 1 : index;
		return this;
	}

	private get current() {
		return this.pages[this.target]!;
	}

	get numPages() {
		return this.pages.length;
	}

	text(
		x: number,
		y: number,
		text: string,
		{
			size = 10,
			bold = false,
			color = "#000000",
		}: { size?: number; bold?: boolean; color?: string } = {},
	) {
		let shown;
		if (this.fonts) {
			const used = bold ? this.used.bold : this.used.regular;
			const glyphs = textToGlyphs(
				bold ? this.fonts.bold : this.fonts.regular,
				text,
			);
			for (const { glyph, code } of glyphs) {
				used.set(glyph, code);
			}
			shown = `<${glyphs.map(({ glyph }) => hex4(glyph)).join("")}>`;
		} else {
			shown = `(${pdfSafeText(text)})`;
		}
		this.current.push(
			`BT ${rgb(color)} rg /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${(PAGE_HEIGHT - y).toFixed(1)} Td ${shown} Tj ET`,
		);
		return this;
	}

	rect(x: number, y: number, w: number, h: number, color: string) {
		this.current.push(
			`${rgb(color)} rg ${x.toFixed(1)} ${(PAGE_HEIGHT - y - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`,
		);
		return this;
	}

	// A closed polygon (filled) or an open/closed line (stroked), in page coordinates from the top left
	polygon(
		points: readonly (readonly [number, number])[],
		color: string,
		{
			fill = true,
			width = 1,
			close = true,
		}: { fill?: boolean; width?: number; close?: boolean } = {},
	) {
		if (points.length < 2) {
			return this;
		}
		const path = points
			.map(
				([x, y], i) =>
					`${x.toFixed(1)} ${(PAGE_HEIGHT - y).toFixed(1)} ${i === 0 ? "m" : "l"}`,
			)
			.join(" ");
		const c = rgb(color);
		this.current.push(
			fill
				? `${c} rg ${path} h f`
				: `${c} RG ${width.toFixed(2)} w ${path}${close ? " h" : ""} S`,
		);
		return this;
	}

	jpeg(image: Image, x: number, y: number, w: number, h: number) {
		const index = this.images.push(image) - 1;
		this.pageImages[this.target]!.push(index);
		this.current.push(
			`q ${w.toFixed(1)} 0 0 ${h.toFixed(1)} ${x.toFixed(1)} ${(PAGE_HEIGHT - y - h).toFixed(1)} cm /Im${index} Do Q`,
		);
		return this;
	}

	output(): Uint8Array<ArrayBuffer> {
		const chunks: Uint8Array[] = [];
		const offsets: number[] = [];
		let length = 0;
		const push = (data: string | Uint8Array) => {
			const bytes = typeof data === "string" ? encoder.encode(data) : data;
			chunks.push(bytes);
			length += bytes.length;
		};
		let numObjects = 0;
		const alloc = () => ++numObjects;
		const writeObj = (n: number, body: string | (string | Uint8Array)[]) => {
			offsets[n] = length;
			push(`${n} 0 obj\n`);
			for (const part of Array.isArray(body) ? body : [body]) {
				push(part);
			}
			push("\nendobj\n");
		};
		const stream = (dict: string, data: Uint8Array) => [
			`<< ${dict} /Length ${data.length} >>\nstream\n`,
			data,
			"\nendstream",
		];

		push("%PDF-1.4\n%âãÏÓ\n");
		const catalog = alloc();
		const pagesObj = alloc();

		const fontObjs: [number, number] = [alloc(), alloc()];
		const writeFonts = () => {
			if (!this.fonts) {
				writeObj(
					fontObjs[0],
					"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
				);
				writeObj(
					fontObjs[1],
					"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
				);
				return;
			}
			for (const [i, key] of (["regular", "bold"] as const).entries()) {
				const font = this.fonts[key];
				const used = this.used[key];
				const name = key === "bold" ? "DejaVuSans-Bold" : "DejaVuSans";
				const scale = 1000 / font.unitsPerEm;
				const cid = alloc();
				const descriptor = alloc();
				const file = alloc();
				const toUnicode = alloc();
				const glyphs = Array.from(used.keys()).sort((a, b) => a - b);
				const w = glyphs
					.map((g) => `${g} [${Math.round((font.widths[g] ?? 0) * scale)}]`)
					.join(" ");
				writeObj(
					fontObjs[i]!,
					`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
				);
				writeObj(
					cid,
					`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap /Identity /DW 600 /W [${w}] >>`,
				);
				const [x0, y0, x1, y1] = font.bbox.map((v) => Math.round(v * scale));
				writeObj(
					descriptor,
					`<< /Type /FontDescriptor /FontName /${name} /Flags 32 /FontBBox [${x0} ${y0} ${x1} ${y1}] /ItalicAngle 0 /Ascent ${Math.round(font.ascent * scale)} /Descent ${Math.round(font.descent * scale)} /CapHeight ${Math.round(font.ascent * scale)} /StemV ${key === "bold" ? 120 : 80} /FontFile2 ${file} 0 R >>`,
				);
				writeObj(file, stream(`/Length1 ${font.bytes.length}`, font.bytes));
				writeObj(toUnicode, stream("", encoder.encode(toUnicodeCMap(used))));
			}
		};

		const imageObjs = this.images.map((image) => {
			const n = alloc();
			writeObj(
				n,
				stream(
					`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
					image.bytes,
				),
			);
			return n;
		});

		const pageObjs = this.pages.map((ops, i) => {
			const page = alloc();
			const content = alloc();
			const xobjects = (this.pageImages[i] ?? [])
				.map((index) => `/Im${index} ${imageObjs[index]} 0 R`)
				.join(" ");
			writeObj(
				page,
				`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjs[0]} 0 R /F2 ${fontObjs[1]} 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> /Contents ${content} 0 R >>`,
			);
			// Content is ASCII (hex glyph ids), or Latin-1 with the Helvetica fallback: write as latin1 bytes so lengths match
			const text = ops.join("\n");
			writeObj(
				content,
				stream(
					"",
					Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff),
				),
			);
			return page;
		});

		// Fonts last, once every page's text has said which glyphs it uses
		writeFonts();
		writeObj(catalog, `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
		writeObj(
			pagesObj,
			`<< /Type /Pages /Count ${pageObjs.length} /Kids [${pageObjs.map((n) => `${n} 0 R`).join(" ")}] >>`,
		);

		const xref = length;
		let xrefText = `xref\n0 ${numObjects + 1}\n0000000000 65535 f \n`;
		for (let n = 1; n <= numObjects; n++) {
			xrefText += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
		}
		push(xrefText);
		push(
			`trailer\n<< /Size ${numObjects + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
		);

		const out = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			out.set(chunk, offset);
			offset += chunk.length;
		}
		return out;
	}
}
