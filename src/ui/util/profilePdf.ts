// Lazy loaded by "Export profile": one PDF per profile page (Overview, Ratings, Stats, Game Log, ...), drawn with the
// "Download players" PDF code. See common/playerProfileExport.ts for the data.
import {
	PROFILE_SECTIONS,
	profileFileName,
	type PlayerProfileExport,
	type ProfileSection,
} from "../../common/playerProfileExport.ts";
import type { PdfFonts } from "./miniPdf.ts";
import type { PlayerExport } from "../../common/playerExport.ts";
import {
	BOTTOM,
	Flow,
	MARGIN,
	RIGHT,
	drawOverview,
	drawPageHeaders,
	drawScouting,
	faceToJpeg,
	loadPdfFonts,
	newPdf,
	readableAccent,
} from "./playersPdf.ts";

const drawSection = async (
	profile: PlayerProfileExport,
	section: ProfileSection,
	fonts: PdfFonts | undefined,
) => {
	const pdf = newPdf(fonts);
	const card = profile.card;
	const accent = readableAccent(card?.colors?.[0]);
	const flow = new Flow(pdf, accent);

	// Continues on the card's last page when there is room
	const after = (y: number, title: string) => {
		if (y + 60 > BOTTOM) {
			flow.newPage();
		} else {
			flow.y = y + 4;
		}
		flow.sectionTitle(title);
	};
	if (section.key === "overview" && card) {
		// The card (face, bio, ratings bars, stat lines), then the rest of the Overview's facts
		pdf.addPage();
		after(drawOverview(pdf, card, await faceToJpeg(card), accent), "Details");
	} else if (section.key === "scouting" && card && profile.scoutingPage) {
		// The scouting card (grades, radar, shot mix, comparisons, report sections), then the grade notes
		after(drawScouting(pdf, card, profile.scoutingPage, accent), "Grade notes");
	} else {
		flow.newPage();
		flow.sectionTitle(section.title);
	}

	if (section.note) {
		flow.paragraph(section.note, { size: 9, color: "#555555" });
		flow.y += 6;
	}
	if (section.facts.length > 0) {
		flow.facts(section.facts);
	}
	for (const line of section.lines) {
		flow.paragraph(line);
	}
	if (section.lines.length > 0) {
		flow.y += 8;
	}
	for (const table of section.tables) {
		flow.table(table);
	}

	// Legacy: his face in each season it changed (Face Aging), like the player page's "Then and Now"
	const faces = (section.data as any)?.faceHistory as
		| {
				season: number;
				label?: string;
				face: unknown;
				colors?: string[];
				jersey?: string;
		  }[]
		| undefined;
	if (section.key === "legacy" && faces && faces.length > 0) {
		const width = 70;
		const height = 105;
		const perRow = Math.max(1, Math.floor((RIGHT - MARGIN) / (width + 12)));
		flow.ensure(30 + height);
		flow.sectionTitle("Then and now");
		for (let i = 0; i < faces.length; i += perRow) {
			flow.ensure(height + 20);
			const top = flow.y;
			for (const [j, entry] of faces.slice(i, i + perRow).entries()) {
				const x = MARGIN + j * (width + 12);
				const jpeg = await faceToJpeg({
					face: entry.face,
					colors: entry.colors,
					jersey: entry.jersey,
				} as PlayerExport);
				if (jpeg) {
					pdf.jpeg(jpeg, x, top, width, height);
				}
				pdf.text(
					x,
					top + height + 10,
					`${entry.season}${entry.label === "prime" ? " (prime)" : ""}`,
					{ size: 8 },
				);
			}
			flow.y = top + height + 20;
		}
	}

	const p = profile.player;
	drawPageHeaders(
		pdf,
		0,
		`${p.name}${p.abbrev ? ` - ${p.abbrev}` : ""} - ${section.title}`,
		`${profile.league.name}, ${profile.league.season} ${profile.league.phaseName} - exported from ${profile.generator}`,
		accent,
	);
	return pdf.output();
};

// One PDF per section, in the profile's order, named like 01_overview.pdf
export const profileToPdfFiles = async (
	profile: PlayerProfileExport,
	onProgress?: (done: number, total: number) => void,
	fonts?: PdfFonts | null,
) => {
	const usedFonts =
		fonts === null ? undefined : (fonts ?? (await loadPdfFonts()));
	const files: { name: string; bytes: Uint8Array }[] = [];
	// Sections with nothing to show (no facts, lines or tables, only a note like "No awards yet.") get no PDF; the Overview and
	// Scouting cards always have something
	const keys = PROFILE_SECTIONS.map((s) => s.key).filter((key) => {
		const section = profile.sections[key];
		return (
			section !== undefined &&
			(key === "overview" ||
				(key === "scouting" && profile.scoutingPage !== undefined) ||
				section.facts.length > 0 ||
				section.lines.length > 0 ||
				section.tables.length > 0)
		);
	});
	for (const [i, key] of keys.entries()) {
		files.push({
			name: profileFileName(
				PROFILE_SECTIONS.findIndex((s) => s.key === key),
				key,
				"pdf",
			),
			bytes: await drawSection(profile, profile.sections[key]!, usedFonts),
		});
		onProgress?.(i + 1, keys.length);
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	return files;
};
