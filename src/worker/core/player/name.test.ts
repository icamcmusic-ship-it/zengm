// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import fs from "node:fs";
import { assert, describe, test } from "vitest";
import { csvParse } from "d3-dsv";
import { HYPHENATED_LAST_NAME_MAX_LENGTH, hyphenateLastName } from "./name.ts";
import addFirstNameShort from "../../util/addFirstNameShort.ts";
import {
	nativeFeatureDefaults,
	nativeFeatureNewLeagueDefaults,
} from "../../../common/nativeFeatures.ts";

const rootUrl = new URL("../../../../", import.meta.url);
const names: {
	countries: Record<
		string,
		{ first: Record<string, number>; last: Record<string, number> }
	>;
	groups: Record<
		string,
		{ first: Record<string, number>; last: Record<string, number> }
	>;
} = JSON.parse(fs.readFileSync(new URL("data/names.json", rootUrl), "utf8"));
const usa = names.countries.USA!;

// Weighted draws from a name table, like getFromCumSumArray in name.ts
const makeDraw = (table: Record<string, number>) => {
	const entries = Object.entries(table);
	const total = entries.reduce((sum, [, count]) => sum + count, 0);
	return () => {
		let rand = Math.random() * total;
		for (const [name, count] of entries) {
			rand -= count;
			if (rand <= 0) {
				return name;
			}
		}
		return entries.at(-1)![0];
	};
};

const sum = (table: Record<string, number>) =>
	Object.values(table).reduce((total, count) => total + count, 0);

describe("names data", () => {
	test("USA has a large pool of first and last names", () => {
		assert.isAbove(Object.keys(usa.first).length, 5000);
		assert.isAbove(Object.keys(usa.last).length, 10800);
	});

	test("USA names are well formed", () => {
		for (const table of [usa.first, usa.last]) {
			for (const [name, count] of Object.entries(table)) {
				assert.match(name, /^'?\p{Lu}[\p{L}'.]*(?:[ -]\p{L}[\p{L}'.]*)*$/u);
				assert(Number.isInteger(count) && count >= 2, name);
			}
		}
		// Miscased spellings merged by tools/names-manual/extra/fixes.json
		for (const name of ["Aj", "Ej", "Cam'ron", "JamesOn", "J"]) {
			assert.strictEqual(usa.first[name], undefined, name);
		}
		for (const name of ["Mclean", "Mcintosh", "El-amin"]) {
			assert.strictEqual(usa.last[name], undefined, name);
		}
		for (const name of Object.keys(usa.last)) {
			assert.notMatch(name, /^Mc[a-z]/, name);
		}
	});

	test("modern and Black American first names have weight", () => {
		for (const name of [
			"Jayden",
			"Jaylen",
			"Jalen",
			"Aiden",
			"Kobe",
			"Ja'Kobe",
			"Keyonte",
			"Deandre",
			"Jamarion",
			"Jose",
			"Mateo",
		]) {
			assert.isAtLeast(usa.first[name] ?? 0, 10, name);
		}
		// Old athlete-data favorites still lead
		assert.isAbove(usa.first.Michael!, usa.first.Jayden!);
		// Added weight is a minority of the pool
		assert.isBelow(sum(usa.first), 120_000);
	});

	test("extra CSVs have no duplicate rows and positive weights", () => {
		const dir = new URL("tools/names-manual/extra/", rootUrl);
		for (const filename of fs.readdirSync(dir)) {
			if (!filename.endsWith(".csv")) {
				continue;
			}
			const rows = csvParse(fs.readFileSync(new URL(filename, dir), "utf8"));
			const seen = new Set<string>();
			for (const row of rows) {
				assert(!seen.has(row.Name!), `${filename}: ${row.Name}`);
				seen.add(row.Name!);
				const count = Number.parseInt(row.Frequency!);
				assert(count >= 1, `${filename}: ${row.Name}`);
				if (filename.startsWith("country-USA-")) {
					// tools/lib/namesHelpers.ts drops USA names seen once
					assert(count >= 2, `${filename}: ${row.Name}`);
				}
			}
		}
	});

	test("behindthename additions (extra/btn) load, stay in the low tail and are attributed", () => {
		const dir = new URL("tools/names-manual/extra/btn/", rootUrl);
		const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".csv"));
		assert.isAbove(files.length, 100);
		let added = 0;
		for (const filename of files) {
			const match = /^country-(.+)-(first|last)\.csv$/.exec(filename)!;
			assert(match, filename);
			const [, country, firstOrLast] = match as unknown as [
				string,
				string,
				"first" | "last",
			];
			const table =
				country === "China"
					? names.groups.chinese![firstOrLast]
					: names.countries[country]![firstOrLast];
			assert(table, filename);
			const rows = csvParse(fs.readFileSync(new URL(filename, dir), "utf8"));
			for (const row of rows) {
				assert.isAtLeast(table[row.Name!] ?? 0, 1, `${filename}: ${row.Name}`);
				added += 1;
			}
		}
		assert.isAbove(added, 12000);
		// Real-athlete names still lead: new names are a small share of the biggest pools
		assert.isAbove(usa.first.Michael!, 100);
		const attribution = fs.readFileSync(
			new URL("tools/names-manual/extra/ATTRIBUTION-behindthename.md", rootUrl),
			"utf8",
		);
		assert.include(attribution, "CC BY-SA 4.0");
		assert.include(attribution, "behindthename.com");
	});

	test("new countries have names", () => {
		for (const country of [
			"Tunisia",
			"Lebanon",
			"Rwanda",
			"Uganda",
			"Barbados",
			"Curaçao",
			"Malaysia",
			"Tonga",
		]) {
			const info = names.countries[country];
			assert(info, country);
			assert.isAtLeast(Object.keys(info.first).length, 14, country);
			assert.isAtLeast(Object.keys(info.last).length, 13, country);
		}
		// Small pools that were very repetitive
		assert.isAtLeast(Object.keys(names.countries.Kosovo!.first).length, 60);
		assert.isAtLeast(
			Object.keys(names.countries["South Sudan"]!.first).length,
			60,
		);
		assert.strictEqual(names.groups.chinese!.last.Zedong, undefined);
		assert.strictEqual(names.countries.Egypt!.first.Qeb, undefined);
	});
});

describe("hyphenateLastName", () => {
	test("joins two different surnames", () => {
		assert.strictEqual(
			hyphenateLastName("Smith", () => "Jones"),
			"Smith-Jones",
		);
	});

	test("skips awkward pairs and falls back to the plain name", () => {
		// Identical or alike
		assert.strictEqual(
			hyphenateLastName("Smith", () => "Smith"),
			"Smith",
		);
		assert.strictEqual(
			hyphenateLastName("Johnson", () => "Johnston"),
			"Johnson",
		);
		// Too long
		assert.strictEqual(
			hyphenateLastName("Washington", () => "Richardson"),
			"Washington",
		);
		// Already compound
		assert.strictEqual(
			hyphenateLastName("Van Dyke", () => "Jones"),
			"Van Dyke",
		);
		assert.strictEqual(
			hyphenateLastName("Jones", () => "St. John"),
			"Jones",
		);
		assert.strictEqual(
			hyphenateLastName("Smith-Jones", () => "Brown"),
			"Smith-Jones",
		);
		// Real players
		assert.strictEqual(
			hyphenateLastName("Pope", () => "Caldwell"),
			"Pope",
		);
		assert.strictEqual(
			hyphenateLastName("Gilchrist", () => "Kidd"),
			"Gilchrist",
		);
	});

	test("retries until a good pair", () => {
		const draws = ["Smith", "Jones"];
		assert.strictEqual(
			hyphenateLastName("Smith", () => draws.shift()!),
			"Smith-Jones",
		);
	});

	test("realistic rate and formatting with the USA surname table", () => {
		const drawLast = makeDraw(usa.last);
		const rate = nativeFeatureNewLeagueDefaults().hyphenatedNamesRate / 100;
		const N = 40_000;
		let numHyphenated = 0;
		const seen = new Set<string>();
		for (let i = 0; i < N; i++) {
			let lastName = drawLast();
			if (Math.random() < rate) {
				lastName = hyphenateLastName(lastName, drawLast);
			}
			if (lastName.includes("-") && !Object.hasOwn(usa.last, lastName)) {
				numHyphenated += 1;
				seen.add(lastName);
				assert.isAtMost(lastName.length, HYPHENATED_LAST_NAME_MAX_LENGTH);
				const [a, b] = lastName.split("-");
				assert.notStrictEqual(a, b);
				assert.match(lastName, /^[A-Z]['A-Za-z]+-[A-Z]['A-Za-z]+$/);
			}
		}
		const fraction = numHyphenated / N;
		assert.isAbove(fraction, 0.005, String(fraction));
		assert.isBelow(fraction, 0.015, String(fraction));
		// Mostly distinct combinations
		assert.isAbove(seen.size, numHyphenated * 0.8);
	});
});

test("hyphenated names are a League Extra: on for new leagues, off for existing ones", () => {
	assert.strictEqual(nativeFeatureDefaults.featureHyphenatedNames, false);
	assert.strictEqual(
		nativeFeatureNewLeagueDefaults().featureHyphenatedNames,
		true,
	);
	assert.strictEqual(nativeFeatureDefaults.hyphenatedNamesRate, 1);
	// Abbreviated form used on small screens
	const lastName = hyphenateLastName("Smith", () => "Jones");
	const [p0, p1] = addFirstNameShort([
		{ firstName: "Jaylen", lastName },
		{ firstName: "Jalen", lastName },
	]);
	assert.strictEqual(`${p0!.firstNameShort} ${lastName}`, "Jay. Smith-Jones");
	assert.strictEqual(`${p1!.firstNameShort} ${lastName}`, "Jal. Smith-Jones");
});
