import { assert, describe, test } from "vitest";
import {
	csvEscape,
	exportShowsRatings,
	fileSafeName,
	playersToCSVRows,
	playersToJSON,
	rectangularize,
	toCSV,
	type PlayerExport,
} from "./playerExport.ts";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { readFileSync } from "node:fs";
import { MiniPdf, pdfSafeText } from "../ui/util/miniPdf.ts";
import { playersToPdf, playersToPdfFiles } from "../ui/util/playersPdf.ts";
import { parseTrueType, textToGlyphs } from "../ui/util/ttf.ts";
import { crc32, makeZip } from "../ui/util/zip.ts";

const loadFonts = () => ({
	regular: parseTrueType(readFileSync("public/fonts/DejaVuSans-latin.ttf")),
	bold: parseTrueType(readFileSync("public/fonts/DejaVuSans-Bold-latin.ttf")),
});

const makePlayer = (overrides: Partial<PlayerExport> = {}): PlayerExport => ({
	pid: 1,
	name: 'Jo "The Rock" O,Neil',
	tid: 0,
	team: "Atlanta Gold Club",
	abbrev: "ATL",
	pos: "C",
	age: 24,
	born: { year: 2001, loc: "Zürich, Switzerland" },
	hgt: 83,
	weight: 250,
	draft: { year: 2020, round: 1, pick: 3, abbrev: "ATL" },
	contract: { amount: 12500, exp: 2027 },
	season: 2025,
	ratings: { ovr: 60, pot: 65, hgt: 80 },
	skills: ["Di", "R"],
	badges: [],
	traits: [{ name: "Clutch", reading: "40-70?", exact: false }],
	seasonStats: { gp: 10, pts: 15.5 },
	careerStats: { gp: 100, pts: 12.1 },
	awards: ["2024 All-Star"],
	tables: [
		{
			section: "Stats",
			title: "Per Game",
			cols: ["Year", "Team", "Age", "gp", "pts"],
			rows: Array.from({ length: 80 }, (_, i) => [2000 + i, "ATL", 20, 82, 10]),
		},
	],
	...overrides,
});

describe("CSV", () => {
	test("escapes commas, quotes, newlines and formulas", () => {
		assert.strictEqual(csvEscape("plain"), "plain");
		assert.strictEqual(csvEscape("a,b"), '"a,b"');
		assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""');
		assert.strictEqual(csvEscape("two\nlines"), '"two\nlines"');
		assert.strictEqual(csvEscape(" padded"), '" padded"');
		assert.strictEqual(csvEscape("=SUM(A1)"), "'=SUM(A1)");
		assert.strictEqual(csvEscape("-5"), "-5");
		assert.strictEqual(csvEscape("-"), "-");
		assert.strictEqual(csvEscape(-5.5), "-5.5");
		assert.strictEqual(csvEscape(null), "");
		assert.strictEqual(csvEscape(undefined), "");
	});

	test("rectangularize pads ragged rows", () => {
		assert.deepStrictEqual(rectangularize([["a"], ["b", "c"]]), [
			["a", ""],
			["b", "c"],
		]);
		assert.strictEqual(
			toCSV([
				["a", "b,c"],
				[1, 2],
			]),
			'a,"b,c"\n1,2',
		);
	});

	test("file names are safe", () => {
		assert.strictEqual(
			fileSafeName("Records Book: Most/Points"),
			"Records_Book_MostPoints",
		);
		assert.strictEqual(fileSafeName("???"), "table");
	});

	test("players CSV has one row per player and the union of columns", () => {
		const rows = playersToCSVRows([
			makePlayer(),
			makePlayer({ pid: 2, ratings: undefined, traits: undefined }),
		]);
		assert.strictEqual(rows.length, 3);
		const header = rows[0] as string[];
		assert.include(header, "OVR");
		assert.include(header, "Clutch");
		assert.strictEqual(rows[1]![header.indexOf("Clutch")], "40-70?");
		// Hidden ratings stay blank, not 0
		assert.strictEqual(rows[2]![header.indexOf("OVR")], "");
		assert.strictEqual(rows[1]![header.indexOf("Contract ($M)")], 12.5);
		for (const row of rows) {
			assert.strictEqual(row.length, header.length);
		}
	});

	test("readable JSON parses back", () => {
		const parsed = JSON.parse(
			playersToJSON([makePlayer()], { league: "L", exportedSeason: 2025 }),
		);
		assert.strictEqual(parsed.format, "zengm-visible-players");
		assert.strictEqual(parsed.players.length, 1);
	});
});

describe("visibility", () => {
	test("no visible ratings challenge hides ratings except for retired players", () => {
		assert.isTrue(exportShowsRatings(false, 3, -3));
		assert.isFalse(exportShowsRatings(true, 3, -3));
		assert.isFalse(exportShowsRatings(true, -2, -3));
		assert.isTrue(exportShowsRatings(true, -3, -3));
	});
});

const countPages = (bytes: Uint8Array) =>
	(new TextDecoder("latin1").decode(bytes).match(/\/Type \/Page\b/g) ?? [])
		.length;

describe("PDF", () => {
	test("pdfSafeText strips accents and escapes", () => {
		assert.strictEqual(pdfSafeText("Dončić (x)"), String.raw`Doncic \(x\)`);
		assert.strictEqual(pdfSafeText("姚明"), "??");
	});

	test("MiniPdf writes a valid xref with N pages", () => {
		const pdf = new MiniPdf();
		pdf.addPage().text(10, 10, "a");
		pdf.addPage().rect(0, 0, 10, 10, "#ff0000");
		const bytes = pdf.output();
		const text = new TextDecoder("latin1").decode(bytes);
		assert.match(text, /^%PDF-1\.4/);
		assert.match(text, /\/Count 2/);
		assert.strictEqual(countPages(bytes), 2);
		const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
		assert.strictEqual(text.slice(startxref, startxref + 4), "xref");
	});

	test("a long stats table continues across pages, each player starts a new page", async () => {
		const bytes = await playersToPdf(
			[makePlayer(), makePlayer({ pid: 2, tables: [] })],
			"Test",
			undefined,
			null,
		);
		const text = new TextDecoder("latin1").decode(bytes);
		// Player 1: overview + 2 stats pages (80 rows), player 2: overview only
		assert.strictEqual(countPages(bytes), 4);
		assert.include(text, "page 3 of 3");
		assert.include(text, "page 1 of 1");
		assert.include(text, String.raw`Per Game \(continued\)`);
	});
});

describe("Unicode PDF font", () => {
	const NAMES =
		"Dončić Šarić Žižić Şengün Yılmaz Doğan Łukasz Świątek Jonušas Kėdainis Þórsson Guðmundsson Nguyễn Thị Hằng";

	test("every letter of these names has its own glyph", () => {
		const { regular, bold } = loadFonts();
		const question = regular.cmap.get(63);
		for (const font of [regular, bold]) {
			for (const { glyph, code } of textToGlyphs(font, NAMES)) {
				assert.notStrictEqual(glyph, 0);
				if (code !== 63) {
					assert.notStrictEqual(glyph, question);
				}
			}
			// Precomposed where the font has them, not stripped to the base letter
			const codes = textToGlyphs(font, "ễ").map((g) => g.code);
			assert.deepStrictEqual(codes, ["ễ".codePointAt(0)]);
		}
	});

	test("embeds the font and maps glyphs back to Unicode", () => {
		const pdf = new MiniPdf(loadFonts());
		pdf.addPage().text(10, 10, NAMES, { bold: true });
		pdf.text(10, 30, NAMES);
		const text = new TextDecoder("latin1").decode(pdf.output());
		assert.include(text, "/FontFile2");
		assert.include(text, "/Identity-H");
		// ToUnicode has č (U+010D), ı (U+0131), Ł (U+0141), Þ (U+00DE), ễ (U+1EC5)
		for (const hex of ["010d", "0131", "0141", "00de", "1ec5"]) {
			assert.include(text, `<${hex}>`);
		}
		assert.notInclude(text, "/Helvetica");
	});

	test("measures with the font's widths", () => {
		const pdf = new MiniPdf(loadFonts());
		assert.isAbove(pdf.measure("WWWW", 10), pdf.measure("iiii", 10) * 2);
	});
});

describe("zip", () => {
	test("crc32", () => {
		assert.strictEqual(
			crc32(new TextEncoder().encode("123456789")),
			0xcbf43926,
		);
	});

	test("one PDF per player, stored", async () => {
		const files = await playersToPdfFiles(
			[makePlayer(), makePlayer({ pid: 2, name: "Luka Dončić", tables: [] })],
			"Test",
			undefined,
			loadFonts(),
		);
		const zip = makeZip(files);
		const view = new DataView(zip.buffer);
		assert.strictEqual(view.getUint32(0, true), 0x04034b50);
		const end = zip.length - 22;
		assert.strictEqual(view.getUint32(end, true), 0x06054b50);
		assert.strictEqual(view.getUint16(end + 10, true), 2);
		assert.deepStrictEqual(
			files.map((f) => f.name),
			["1_Jo_The_Rock_ONeil.pdf", "2_Luka_Dončić.pdf"],
		);
	});
});
