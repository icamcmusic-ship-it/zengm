// A tiny PDF writer (text in the standard Helvetica fonts, filled rectangles, JPEG images), so "Download players" can make
// a PDF without a PDF library in the bundle. Coordinates are in points from the top left of a US Letter page (landscape, so wide stats tables fit).

export const PAGE_WIDTH = 792;
export const PAGE_HEIGHT = 612;

type Image = { bytes: Uint8Array; width: number; height: number };

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

// Average Helvetica glyph width is about 0.5em; good enough for truncating/centering
export const approxTextWidth = (text: string, size: number) =>
	text.length * size * 0.5;

export class MiniPdf {
	private pages: string[][] = [];
	private images: Image[] = [];
	private pageImages: number[][] = [];
	private target = -1;

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
		this.current.push(
			`BT ${rgb(color)} rg /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(1)} ${(PAGE_HEIGHT - y).toFixed(1)} Td (${pdfSafeText(text)}) Tj ET`,
		);
		return this;
	}

	rect(x: number, y: number, w: number, h: number, color: string) {
		this.current.push(
			`${rgb(color)} rg ${x.toFixed(1)} ${(PAGE_HEIGHT - y - h).toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`,
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
		const pages = this.pages.map((ops) => ops.join("\n"));
		const chunks: Uint8Array[] = [];
		const offsets: number[] = [];
		let length = 0;
		const push = (data: string | Uint8Array) => {
			const bytes = typeof data === "string" ? encoder.encode(data) : data;
			chunks.push(bytes);
			length += bytes.length;
		};

		// Object numbers: 1 catalog, 2 pages, 3 F1, 4 F2, then images, then (page, content) pairs
		const numImages = this.images.length;
		const firstImage = 5;
		const firstPage = firstImage + numImages;
		const pageObj = (i: number) => firstPage + 2 * i;
		const numObjects = firstPage + 2 * pages.length - 1;

		const startObj = (n: number) => {
			offsets[n] = length;
			push(`${n} 0 obj\n`);
		};

		push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
		startObj(1);
		push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
		startObj(2);
		push(
			`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>\nendobj\n`,
		);
		startObj(3);
		push(
			"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
		);
		startObj(4);
		push(
			"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n",
		);
		this.images.forEach((image, i) => {
			startObj(firstImage + i);
			push(
				`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
			);
			push(image.bytes);
			push("\nendstream\nendobj\n");
		});
		pages.forEach((content, i) => {
			const xobjects = (this.pageImages[i] ?? [])
				.map((index) => `/Im${index} ${firstImage + index} 0 R`)
				.join(" ");
			startObj(pageObj(i));
			push(
				`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ""} >> /Contents ${pageObj(i) + 1} 0 R >>\nendobj\n`,
			);
			// Content is ASCII after pdfSafeText except Latin-1 letters: write as latin1 bytes so lengths match
			const bytes = Uint8Array.from(content, (c) => c.charCodeAt(0) & 0xff);
			startObj(pageObj(i) + 1);
			push(`<< /Length ${bytes.length} >>\nstream\n`);
			push(bytes);
			push("\nendstream\nendobj\n");
		});

		const xref = length;
		let xrefText = `xref\n0 ${numObjects + 1}\n0000000000 65535 f \n`;
		for (let n = 1; n <= numObjects; n++) {
			xrefText += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
		}
		push(xrefText);
		push(
			`trailer\n<< /Size ${numObjects + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
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
