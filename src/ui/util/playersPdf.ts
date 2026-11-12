// Lazy loaded by "Download players": each player's profile over as many pages as it needs. See common/playerExport.ts for the data.
import type { FaceConfig } from "facesjs";
import { parseTrueType } from "./ttf.ts";
import { display } from "facesjs";
import { DEFAULT_JERSEY, DEFAULT_TEAM_COLORS } from "../../common/constants.ts";
import {
	fileSafeName,
	formatHeight,
	type ExportTable,
	type PlayerExport,
} from "../../common/playerExport.ts";
import {
	MiniPdf,
	PAGE_HEIGHT,
	PAGE_WIDTH,
	approxTextWidth,
	type PdfFonts,
} from "./miniPdf.ts";

const faceToJpeg = async (p: PlayerExport) => {
	if (!p.face || typeof document === "undefined") {
		return;
	}
	try {
		// faceToSvgString is for Node (it fakes a document), so draw into a detached div like the page does
		const div = document.createElement("div");
		display(div, p.face as FaceConfig, {
			teamColors: p.colors ?? DEFAULT_TEAM_COLORS,
			jersey: { id: (p.jersey ?? DEFAULT_JERSEY).split(":")[0]! },
		});
		const svgEl = div.querySelector("svg");
		if (!svgEl) {
			return;
		}
		if (!svgEl.getAttribute("xmlns")) {
			svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		}
		const svg = svgEl.outerHTML;
		// Fixed size instead of 100%, so the image has an intrinsic size to draw
		const sized = svg.replace(
			/width="100%" height="100%"/,
			'width="400" height="600"',
		);
		const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
		const img = new Image();
		img.width = 200;
		img.height = 300;
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error("face"));
			img.src = url;
		});
		const canvas = document.createElement("canvas");
		canvas.width = 200;
		canvas.height = 300;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, 200, 300);
		ctx.drawImage(img, 0, 0, 200, 300);
		const dataURL = canvas.toDataURL("image/jpeg", 0.85);
		const binary = atob(dataURL.split(",")[1]!);
		const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
		return { bytes, width: 200, height: 300 };
	} catch (error) {
		// A face that can't be drawn just leaves the space empty
		console.warn("Could not draw face for PDF", error);
		return;
	}
};

const money = (amount: number) => `$${(amount / 1000).toFixed(2)}M`;

const ratingColor = (value: number) =>
	value >= 70
		? "#2e7d32"
		: value >= 55
			? "#558b2f"
			: value >= 45
				? "#f9a825"
				: "#c62828";

const statsLine = (stats: Record<string, number> | undefined) =>
	stats
		? Object.entries(stats)
				.map(([key, value]) => `${key.toUpperCase()} ${value}`)
				.join("   ")
		: "";

// Text widths from the embedded font's metrics (or an estimate with the Helvetica fallback), set for each PDF
let measure: (text: string, size: number, bold?: boolean) => number =
	approxTextWidth;

const truncate = (
	text: string,
	size: number,
	maxWidth: number,
	bold = false,
) => {
	if (measure(text, size, bold) <= maxWidth) {
		return text;
	}
	let chars = text.length;
	while (
		chars > 1 &&
		measure(`${text.slice(0, chars)}...`, size, bold) > maxWidth
	) {
		chars -= 1;
	}
	return `${text.slice(0, chars)}...`;
};

// Word wrap by approximate width
const wrap = (text: string, size: number, maxWidth: number) => {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		const candidate = line ? `${line} ${word}` : word;
		if (measure(candidate, size) > maxWidth && line) {
			lines.push(line);
			line = word;
		} else {
			line = candidate;
		}
	}
	if (line) {
		lines.push(line);
	}
	return lines;
};

const MARGIN = 36;
const RIGHT = PAGE_WIDTH - MARGIN;
const TOP = 52;
const BOTTOM = PAGE_HEIGHT - 36;

const drawOverview = (
	pdf: MiniPdf,
	p: PlayerExport,
	face: Awaited<ReturnType<typeof faceToJpeg>>,
	accent: string,
) => {
	const textLeft = face ? MARGIN + 110 : MARGIN;
	if (face) {
		pdf.jpeg(face, MARGIN, TOP, 100, 150);
	}
	// Long names get a smaller size before they get cut
	const nameWidth = measure(p.name, 22, true);
	const nameSize =
		nameWidth > RIGHT - textLeft
			? Math.max(14, (22 * (RIGHT - textLeft)) / nameWidth)
			: 22;
	pdf.text(
		textLeft,
		TOP + 22,
		truncate(p.name, nameSize, RIGHT - textLeft, true),
		{ size: nameSize, bold: true },
	);
	const lines = [
		[p.pos, p.team, p.injury ? `Injured: ${p.injury}` : ""],
		[
			`Age ${p.age}`,
			formatHeight(p.hgt),
			`${p.weight} lbs`,
			p.wingspan !== undefined ? `Wingspan rating ${p.wingspan}` : "",
			p.born.loc ? `From ${p.born.loc}` : "",
		],
		[
			p.draft.round > 0
				? `Drafted ${p.draft.year} round ${p.draft.round}, pick ${p.draft.pick}${p.draft.abbrev ? ` by ${p.draft.abbrev}` : ""}`
				: p.draft.year > 0
					? `${p.draft.year} draft${p.tid === -2 ? " prospect" : ", undrafted"}`
					: "",
			p.college ? `College: ${p.college}` : "",
		],
		[
			p.contract
				? `Contract: ${money(p.contract.amount)}/yr thru ${p.contract.exp}`
				: "",
		],
		[p.archetype ? `Archetype: ${p.archetype}` : ""],
		[p.agingCurve ? `Aging curve: ${p.agingCurve}` : ""],
	];
	let ly = TOP + 42;
	for (const parts of lines) {
		const text = parts.filter(Boolean).join("  |  ");
		if (text) {
			pdf.text(textLeft, ly, truncate(text, 10, RIGHT - textLeft), {
				size: 10,
			});
			ly += 15;
		}
	}

	let y = Math.max(ly, face ? TOP + 160 : 0) + 14;
	const heading = (text: string) => {
		pdf.text(MARGIN, y, text, { size: 12, bold: true, color: accent });
		pdf.rect(MARGIN, y + 4, RIGHT - MARGIN, 0.8, "#cccccc");
		y += 20;
	};

	if (p.ratings) {
		heading(`Ratings (${p.season}, as your scouts see them)`);
		const entries = Object.entries(p.ratings).filter(
			([, value]) => typeof value === "number",
		);
		const perCol = Math.ceil(entries.length / 3);
		const colWidth = (RIGHT - MARGIN) / 3;
		const barMax = colWidth - 80;
		entries.forEach(([key, value], i) => {
			const x = MARGIN + Math.floor(i / perCol) * colWidth;
			const yy = y + (i % perCol) * 14;
			pdf.text(x, yy, key.toUpperCase(), { size: 9, bold: true });
			pdf.rect(x + 36, yy - 8, barMax, 9, "#eeeeee");
			pdf.rect(
				x + 36,
				yy - 8,
				(barMax * Math.max(0, Math.min(100, value))) / 100,
				9,
				ratingColor(value),
			);
			pdf.text(x + 42 + barMax, yy, String(value), { size: 9 });
		});
		y += perCol * 14 + 8;
	} else {
		heading("Ratings");
		pdf.text(MARGIN, y, "Hidden (no visible ratings challenge)", { size: 10 });
		y += 20;
	}

	const tags = [
		p.skills.length > 0 ? `Skills: ${p.skills.join(", ")}` : "",
		p.badges.length > 0 ? `Skill badges: ${p.badges.join(", ")}` : "",
		p.seasonStats && Object.keys(p.seasonStats).length > 0
			? `${p.season}: ${statsLine(p.seasonStats)}`
			: "",
		p.careerStats && Object.keys(p.careerStats).length > 0
			? `Career: ${statsLine(p.careerStats)}`
			: "",
		p.awards.length > 0 ? `Awards: ${p.awards.length} (see Awards)` : "",
	].filter(Boolean);
	for (const tag of tags) {
		for (const line of wrap(tag, 10, RIGHT - MARGIN)) {
			if (y < BOTTOM) {
				pdf.text(MARGIN, y, line, { size: 10 });
			}
			y += 14;
		}
	}
};

const TABLE_SIZE = 7.5;
const ROW_HEIGHT = 11;
// Year/Team/Age (or the first column) are repeated when a wide table is split into column groups
const KEY_COLS = 3;

const colWidths = (table: ExportTable) =>
	table.cols.map((col, i) => {
		const widest = Math.max(
			measure(col, TABLE_SIZE, true),
			...table.rows.map((row) =>
				measure(String(row[i] ?? ""), TABLE_SIZE, row[0] === "Career"),
			),
		);
		// Long text columns (trait status, awards) are capped and truncated
		return Math.min(i === table.cols.length - 1 ? 420 : 160, widest + 6);
	});

// Splits a table's columns into groups that fit the page width, each starting with the key columns
const columnGroups = (widths: number[], maxWidth: number) => {
	const keys = Math.min(KEY_COLS, widths.length);
	const keyWidth = widths.slice(0, keys).reduce((a, b) => a + b, 0);
	if (widths.reduce((a, b) => a + b, 0) <= maxWidth) {
		return [widths.map((_, i) => i)];
	}
	const groups: number[][] = [];
	let group: number[] = [];
	let width = keyWidth;
	for (let i = keys; i < widths.length; i++) {
		if (width + widths[i]! > maxWidth && group.length > 0) {
			groups.push(group);
			group = [];
			width = keyWidth;
		}
		group.push(i);
		width += widths[i]!;
	}
	if (group.length > 0) {
		groups.push(group);
	}
	const keyCols = Array.from({ length: keys }, (_, i) => i);
	return groups.map((g) => [...keyCols, ...g]);
};

class Flow {
	y = TOP;
	private pdf: MiniPdf;
	private accent: string;
	constructor(pdf: MiniPdf, accent: string) {
		this.pdf = pdf;
		this.accent = accent;
	}
	newPage() {
		this.pdf.addPage();
		this.y = TOP;
	}
	ensure(height: number) {
		if (this.y + height > BOTTOM) {
			this.newPage();
			return true;
		}
		return false;
	}
	sectionTitle(text: string) {
		this.pdf.text(MARGIN, this.y + 10, text, {
			size: 15,
			bold: true,
			color: this.accent,
		});
		this.y += 26;
	}
	table(table: ExportTable) {
		const widths = colWidths(table);
		for (const [groupIndex, cols] of columnGroups(
			widths,
			RIGHT - MARGIN,
		).entries()) {
			const title = groupIndex > 0 ? `${table.title} (continued)` : table.title;
			const drawHeader = (continued: boolean) => {
				this.pdf.text(
					MARGIN,
					this.y + 9,
					continued ? `${title} (continued)` : title,
					{ size: 10, bold: true },
				);
				this.y += 20;
				let x = MARGIN;
				this.pdf.rect(
					MARGIN,
					this.y - 8.5,
					RIGHT - MARGIN,
					ROW_HEIGHT,
					"#e3e8ef",
				);
				for (const c of cols) {
					this.pdf.text(
						x + 2,
						this.y,
						truncate(table.cols[c]!, TABLE_SIZE, widths[c]! - 3, true),
						{
							size: TABLE_SIZE,
							bold: true,
						},
					);
					x += widths[c]!;
				}
				this.y += ROW_HEIGHT;
			};
			this.ensure(16 + ROW_HEIGHT * 3);
			drawHeader(false);
			table.rows.forEach((row, r) => {
				if (this.ensure(ROW_HEIGHT)) {
					drawHeader(true);
				}
				if (r % 2 === 1) {
					this.pdf.rect(
						MARGIN,
						this.y - 8.5,
						RIGHT - MARGIN,
						ROW_HEIGHT,
						"#f6f7f9",
					);
				}
				const bold = row[0] === "Career";
				let x = MARGIN;
				for (const c of cols) {
					this.pdf.text(
						x + 2,
						this.y,
						truncate(String(row[c] ?? ""), TABLE_SIZE, widths[c]! - 3),
						{
							size: TABLE_SIZE,
							bold,
						},
					);
					x += widths[c]!;
				}
				this.y += ROW_HEIGHT;
			});
			this.y += 12;
		}
	}
}

const gradeHex = (grade: number) => {
	const t = Math.max(0, Math.min(1, grade / 12));
	const stops = [
		[198, 40, 40],
		[239, 160, 40],
		[200, 190, 60],
		[85, 139, 47],
		[46, 125, 50],
	];
	const pos = t * (stops.length - 1);
	const i = Math.min(stops.length - 2, Math.floor(pos));
	const f = pos - i;
	return `#${stops[i]!.map((v, k) =>
		Math.round(v + (stops[i + 1]![k]! - v) * f)
			.toString(16)
			.padStart(2, "0"),
	).join("")}`;
};

const RADAR_PDF = ["shoot", "fin", "pm", "reb", "pd", "id", "ath", "iq"];

// Scouting Reports: the one-page scouting card
const drawScouting = (
	pdf: MiniPdf,
	p: PlayerExport,
	sc: NonNullable<PlayerExport["scouting"]>,
	accent: string,
) => {
	pdf.addPage();
	let y = TOP + 6;
	pdf.text(MARGIN, y + 14, `Scouting report: ${p.name}`, {
		size: 16,
		bold: true,
		color: accent,
	});
	pdf.rect(RIGHT - 70, y - 2, 70, 30, gradeHex(sc.overallGrade));
	pdf.text(RIGHT - 64, y + 19, truncate(sc.overall, 14, 60, true), {
		size: 14,
		bold: true,
		color: "#ffffff",
	});
	y += 32;
	for (const line of [
		[p.pos, sc.archetype ?? "", `By ${sc.byline}`]
			.filter(Boolean)
			.join("  |  "),
		`${sc.rangeLine}  |  Confidence: ${sc.confidence}`,
		sc.reference,
	]) {
		pdf.text(MARGIN, y, truncate(line, 9, RIGHT - MARGIN - 80), {
			size: 9,
			color: "#444444",
		});
		y += 12;
	}
	y += 4;
	// Grade bars, left half
	const top = y;
	const barX = MARGIN + 100;
	const barW = 120;
	for (const gr of sc.grades) {
		const x0 = gr.sub ? MARGIN + 10 : MARGIN;
		pdf.text(x0, y + 7, gr.label, { size: gr.sub ? 7.5 : 8.5, bold: !gr.sub });
		pdf.rect(barX, y, barW, 8, "#eeeeee");
		pdf.rect(
			barX + (barW * gr.lo) / 12,
			y,
			Math.max(2, (barW * (gr.hi - gr.lo)) / 12),
			8,
			"#cfd8dc",
		);
		pdf.rect(
			barX + (barW * gr.grade) / 12 - 1.5,
			y - 1,
			3,
			10,
			gradeHex(gr.grade),
		);
		pdf.text(barX + barW + 6, y + 7, gr.text, {
			size: 8.5,
			bold: true,
			color: gradeHex(gr.grade),
		});
		y += 13;
	}
	// Radar, right
	const cx = RIGHT - 120;
	const cy = top + 90;
	const R = 75;
	const pt = (i: number, v: number) => {
		const a = (Math.PI * 2 * i) / RADAR_PDF.length - Math.PI / 2;
		const d = R * (0.08 + (0.92 * v) / 12);
		return [cx + d * Math.cos(a), cy + d * Math.sin(a)] as const;
	};
	for (const f of [0.5, 1]) {
		pdf.polygon(
			RADAR_PDF.map((_, i) => pt(i, 12 * f)),
			"#bbbbbb",
			{ fill: false, width: 0.6 },
		);
	}
	const byKey = new Map(sc.grades.map((x) => [x.key, x]));
	pdf.polygon(
		RADAR_PDF.map((k, i) => pt(i, byKey.get(k)?.grade ?? 0)),
		"#90caf9",
	);
	pdf.polygon(
		RADAR_PDF.map((k, i) => pt(i, byKey.get(k)?.grade ?? 0)),
		"#1565c0",
		{ fill: false, width: 1.2 },
	);
	RADAR_PDF.forEach((k, i) => {
		const [lx, ly] = pt(i, 14.5);
		const label = byKey.get(k)?.short ?? k;
		pdf.text(lx - measure(label, 7) / 2, ly + 3, label, {
			size: 7,
			color: "#555555",
		});
	});
	// Shot mix, under the radar
	let ry = cy + R + 26;
	if (sc.shotMix) {
		pdf.text(cx - R, ry, "Shot mix", { size: 9, bold: true });
		ry += 5;
		let x = cx - R;
		const colors = ["#0d6efd", "#6f42c1", "#fd7e14", "#20c997"];
		sc.shotMix.forEach((m, i) => {
			const w = (2 * R * m.share) / 100;
			pdf.rect(x, ry, w, 10, colors[i]!);
			x += w;
		});
		ry += 22;
		pdf.text(
			cx - R,
			ry - 4,
			truncate(
				sc.shotMix.map((m) => `${m.label} ${m.share}%`).join(", "),
				7.5,
				2 * R + 40,
			),
			{ size: 7.5 },
		);
		ry += 8;
	}
	for (const comp of sc.comps.slice(0, 3)) {
		for (const line of wrap(comp, 8, 2 * R + 40)) {
			pdf.text(cx - R, ry, line, { size: 8 });
			ry += 10;
		}
	}
	y = Math.max(y, ry) + 8;
	const block = (
		title: string,
		lines: string[],
		color?: (i: number) => string,
	) => {
		if (lines.length === 0 || y > BOTTOM - 20) {
			return;
		}
		pdf.text(MARGIN, y, title, { size: 10, bold: true, color: accent });
		y += 12;
		lines.forEach((line, i) => {
			for (const w of wrap(line, 8.5, RIGHT - MARGIN)) {
				if (y < BOTTOM) {
					pdf.text(MARGIN, y, w, { size: 8.5, color: color?.(i) ?? "#000000" });
				}
				y += 10.5;
			}
		});
		y += 4;
	};
	block(
		"Flags",
		sc.flags.map((f) => `${f.red ? "RED" : "GREEN"}: ${f.text}`),
		(i) => (sc.flags[i]!.red ? "#c62828" : "#2e7d32"),
	);
	block("Bottom line", [sc.bottomLine]);
	for (const sec of sc.sections) {
		block(sec.title, sec.lines);
	}
};

const drawPlayer = (
	pdf: MiniPdf,
	p: PlayerExport,
	face: Awaited<ReturnType<typeof faceToJpeg>>,
	league: string,
) => {
	const accent = p.colors?.[0] ?? "#1f3a5f";
	const firstPage = pdf.numPages;

	pdf.addPage();
	drawOverview(pdf, p, face, accent);
	if (p.scouting) {
		drawScouting(pdf, p, p.scouting, accent);
	}

	// Each section of his profile starts on a new page, like the tabs of the player page
	const flow = new Flow(pdf, accent);
	let section: string | undefined;
	for (const table of p.tables) {
		if (table.section !== section) {
			section = table.section;
			flow.newPage();
			flow.sectionTitle(section);
		}
		flow.table(table);
	}

	// Page headers, now that his page count is known
	const numPages = pdf.numPages - firstPage;
	for (let i = 0; i < numPages; i++) {
		pdf.onPage(firstPage + i);
		pdf.rect(0, 0, PAGE_WIDTH, 6, accent);
		pdf.text(MARGIN, 24, `${p.name}${p.abbrev ? ` - ${p.abbrev}` : ""}`, {
			size: 9,
			bold: true,
			color: "#555555",
		});
		pdf.text(RIGHT - 90, 24, `page ${i + 1} of ${numPages}`, {
			size: 9,
			color: "#555555",
		});
		pdf.text(
			MARGIN,
			PAGE_HEIGHT - 16,
			`${league} - exported from Basketball GM`,
			{
				size: 7,
				color: "#888888",
			},
		);
	}
	pdf.onPage(-1);
};
let fontsPromise: Promise<PdfFonts | undefined> | undefined;

// The Unicode font (public/fonts, about 50 KB per weight), fetched the first time a PDF is made. Without it (offline and
// not cached yet) the PDF falls back to Helvetica, with accents dropped.
export const loadPdfFonts = () => {
	if (!fontsPromise) {
		fontsPromise = (async () => {
			try {
				const [regular, bold] = await Promise.all(
					[
						"/fonts/DejaVuSans-latin.ttf",
						"/fonts/DejaVuSans-Bold-latin.ttf",
					].map(async (url) => {
						const response = await fetch(url);
						if (!response.ok) {
							throw new Error(`${url}: ${response.status}`);
						}
						return parseTrueType(await response.arrayBuffer());
					}),
				);
				return { regular: regular!, bold: bold! };
			} catch (error) {
				console.warn("PDF font not available, using Helvetica", error);
				fontsPromise = undefined;
				return undefined;
			}
		})();
	}
	return fontsPromise;
};

const newPdf = (fonts: PdfFonts | undefined) => {
	const pdf = new MiniPdf(fonts);
	measure = (text, size, bold) => pdf.measure(text, size, bold);
	return pdf;
};

// Yields between players so a big selection doesn't freeze the page. One PDF with every player, or (perPlayer) one PDF
// each, for the zip.
export const playersToPdf = async (
	players: PlayerExport[],
	league: string,
	onProgress?: (done: number) => void,
	fonts?: PdfFonts | null,
) => {
	const usedFonts =
		fonts === null ? undefined : (fonts ?? (await loadPdfFonts()));
	const pdf = newPdf(usedFonts);
	for (const [i, p] of players.entries()) {
		const face = await faceToJpeg(p);
		drawPlayer(pdf, p, face, league);
		onProgress?.(i + 1);
		if (i % 5 === 4) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}
	return pdf.output();
};

export const playersToPdfFiles = async (
	players: PlayerExport[],
	league: string,
	onProgress?: (done: number) => void,
	fonts?: PdfFonts | null,
) => {
	const usedFonts =
		fonts === null ? undefined : (fonts ?? (await loadPdfFonts()));
	const files: { name: string; bytes: Uint8Array }[] = [];
	for (const [i, p] of players.entries()) {
		const pdf = newPdf(usedFonts);
		drawPlayer(pdf, p, await faceToJpeg(p), league);
		files.push({
			name: `${p.pid}_${fileSafeName(p.name)}.pdf`,
			bytes: pdf.output(),
		});
		onProgress?.(i + 1);
		if (i % 5 === 4) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}
	return files;
};
