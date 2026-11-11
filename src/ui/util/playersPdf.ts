// Lazy loaded by "Download players": one US Letter page per player. See common/playerExport.ts for the data.
import type { FaceConfig } from "facesjs";
import { display } from "facesjs";
import { DEFAULT_JERSEY, DEFAULT_TEAM_COLORS } from "../../common/constants.ts";
import {
	formatHeight,
	type ExportTable,
	type PlayerExport,
} from "../../common/playerExport.ts";
import {
	MiniPdf,
	PAGE_HEIGHT,
	PAGE_WIDTH,
	approxTextWidth,
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

const truncate = (text: string, size: number, maxWidth: number) => {
	if (approxTextWidth(text, size) <= maxWidth) {
		return text;
	}
	const chars = Math.max(1, Math.floor(maxWidth / (size * 0.5)) - 1);
	return `${text.slice(0, chars)}...`;
};

// Word wrap by approximate width
const wrap = (text: string, size: number, maxWidth: number) => {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		const candidate = line ? `${line} ${word}` : word;
		if (approxTextWidth(candidate, size) > maxWidth && line) {
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
	pdf.text(textLeft, TOP + 22, truncate(p.name, 22, RIGHT - textLeft), {
		size: 22,
		bold: true,
	});
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
		const longest = Math.max(
			col.length,
			...table.rows.map((row) => String(row[i] ?? "").length),
		);
		// Long text columns (trait status, awards) wrap... no: they get capped and truncated
		return Math.min(
			i === table.cols.length - 1 ? 420 : 160,
			longest * TABLE_SIZE * 0.55 + 8,
		);
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
						truncate(table.cols[c]!.toUpperCase(), TABLE_SIZE, widths[c]! - 3),
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
// Yields between players so a big selection doesn't freeze the page
export const playersToPdf = async (
	players: PlayerExport[],
	league: string,
	onProgress?: (done: number) => void,
) => {
	const pdf = new MiniPdf();
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
