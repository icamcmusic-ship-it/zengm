import { assert, describe, test } from "vitest";
import { archetypeById } from "../classify.ts";
import { RULES } from "../rulebook.data.ts";
import { promisesOf } from "../score.ts";
import { conceptsOf } from "../twoK/concepts.ts";
import {
	compatible,
	composedArchetype,
	composedId,
	composeName,
	DESC_BY_KEY,
	DESCRIPTORS,
	familyOfName,
	parseComposedId,
	parseName,
	ROLE_BY_KEY,
	ROLES,
} from "./grammar.ts";
import { CUSTOM_TESTS } from "./tests.ts";

describe("archv2 grammar", () => {
	test("every word reads as the concept its test is on (so a name's promises are exactly its words')", () => {
		for (const d of DESCRIPTORS) {
			for (const w of d.names) {
				const keys = conceptsOf(w).map((c) => c.key);
				if (CUSTOM_TESTS[d.concept]) {
					assert.ok(
						keys.every((k) => k === "skill"),
						`${w}: ${keys}`,
					);
				} else {
					assert.ok(keys.includes(d.concept), `${w}: ${keys}`);
				}
			}
		}
		for (const r of ROLES) {
			// (a role on a custom test: its test covers the name's promise, checked by the promise test below)
			if (CUSTOM_TESTS[r.concepts[0]!]) {
				continue;
			}
			for (const w of [...r.names, r.withDesc].filter(Boolean) as string[]) {
				// (every promise of the name is tested; a role may test more than its name says)
				const keys = conceptsOf(w)
					.map((c) => c.key)
					.filter((k) => (RULES[k]?.classes.length ?? 0) > 0);
				for (const k of keys) {
					assert.ok(r.concepts.includes(k), `${w}: ${k} not tested`);
				}
				if (w === r.names[0]) {
					assert.ok(
						keys.includes(r.concepts[0]!),
						`${w}: head ${r.concepts[0]}`,
					);
				}
			}
		}
	});

	test("names follow 2K's order and never repeat a kind of word", () => {
		const pm = ROLE_BY_KEY.get("playmaker")!;
		const name = composeName(
			pm,
			[DESC_BY_KEY.get("midPaint")!, DESC_BY_KEY.get("twoWay")!],
			"guard",
		);
		assert.strictEqual(name, "2-Way Mid-Paint Playmaker");
		assert.isFalse(compatible(pm, [DESC_BY_KEY.get("playmaking")!], "guard"));
		assert.isFalse(
			compatible(
				ROLE_BY_KEY.get("sniper")!,
				[DESC_BY_KEY.get("crafty")!, DESC_BY_KEY.get("physical")!],
				"wing",
			),
		);
		assert.isFalse(
			compatible(
				ROLE_BY_KEY.get("slasher")!,
				[
					DESC_BY_KEY.get("twoWay")!,
					DESC_BY_KEY.get("midPaint")!,
					DESC_BY_KEY.get("glass")!,
				],
				"wing",
			),
		);
		assert.isTrue(
			compatible(
				ROLE_BY_KEY.get("maestro")!,
				[DESC_BY_KEY.get("midPaint")!],
				"wing",
			),
		);
		assert.strictEqual(
			composeName(
				ROLE_BY_KEY.get("maestro")!,
				[DESC_BY_KEY.get("midPaint")!],
				"wing",
			),
			"Mid-Paint Maestro",
		);
		assert.strictEqual(
			composeName(ROLE_BY_KEY.get("burner")!, [], "wing"),
			"Open-Lane Burner",
		);
	});

	test("a composed id round-trips and resolves to an archetype whose promises are its words'", () => {
		const r = ROLE_BY_KEY.get("stretch")!;
		const ds = [DESC_BY_KEY.get("glass")!];
		const id = composedId(r, ds, "big", { glass: "Board-Enforcing" });
		const p = parseComposedId(id)!;
		assert.strictEqual(p.role.key, "stretch");
		assert.deepEqual(
			p.descs.map((d) => d.key),
			["glass"],
		);
		const a = archetypeById(id)!;
		assert.strictEqual(a.name, "Board-Enforcing Stretch");
		assert.deepEqual(a.positions, ["PF", "FC", "C"]);
		assert.ok(a.desc.length > 10);
		assert.deepEqual([...promisesOf(a).all].sort(), ["reb", "shoot"]);
		assert.strictEqual(composedArchetype("v2:nope::big"), undefined);
	});

	test("archv3: a composed id has no empty part, a role alone is a whole name, and the reading-17 form still reads", () => {
		const stretch = ROLE_BY_KEY.get("stretch")!;
		const id = composedId(stretch, [], "big");
		assert.strictEqual(id, "v2:stretch:big");
		assert.notInclude(id, "::");
		assert.strictEqual(archetypeById(id)!.name, "Stretch Big");
		// (the user's pick showed "v2:stretch::big": it reads as the same label)
		assert.strictEqual(archetypeById("v2:stretch::big")!.name, "Stretch Big");
		assert.strictEqual(
			archetypeById("v2:boardEnforcer:twoWay+playmaking:wing:playmaking=1")!
				.name,
			archetypeById(
				composedId(
					ROLE_BY_KEY.get("boardEnforcer")!,
					[DESC_BY_KEY.get("twoWay")!, DESC_BY_KEY.get("playmaking")!],
					"wing",
					{ playmaking: DESC_BY_KEY.get("playmaking")!.names[1] },
				),
			)!.name,
		);
		assert.strictEqual(
			composeName(ROLE_BY_KEY.get("creator")!, [], "guard"),
			"Shot Creator",
		);
		// (a role's short form, said only after a descriptor, is never a name alone)
		const short = new Set(
			ROLES.map((r) => r.withDesc).filter((w): w is string => !!w),
		);
		for (const r of ROLES) {
			for (const group of r.groups) {
				assert.isFalse(short.has(composeName(r, [], group)), r.key);
			}
		}
	});

	test("archv3: every composable name is whole: no empty word, no id, no word twice, and it resolves by its id", () => {
		let n = 0;
		for (const r of ROLES) {
			for (const group of r.groups) {
				const combos: (typeof DESCRIPTORS)[number][][] = [[]];
				for (const [i, d] of DESCRIPTORS.entries()) {
					combos.push([d]);
					for (const e of DESCRIPTORS.slice(i + 1)) {
						combos.push([d, e]);
					}
				}
				for (const c of combos) {
					if (!compatible(r, c, group)) {
						continue;
					}
					n++;
					const nm = composeName(r, c, group);
					const words = nm.split(" ");
					assert.isFalse(words.includes(""), nm);
					assert.notInclude(nm, "v2:");
					assert.strictEqual(new Set(words).size, words.length, nm);
					const id = composedId(r, c, group);
					assert.notInclude(id, "::");
					assert.strictEqual(archetypeById(id)?.name, nm);
				}
			}
		}
		assert.isAbove(n, 500);
	});

	test("2K names parse into a role and descriptors, with a family", () => {
		const p = parseName("2-Way Mid-Paint Playmaker", "PG");
		assert.strictEqual(p.role, "playmaker");
		assert.sameMembers(p.descs, ["twoWay", "midPaint"]);
		assert.strictEqual(parseName("Rim-Rocking Stretch", "C").role, "stretch");
		assert.strictEqual(familyOfName("Rim-Rocking Stretch", "C"), "stretchBig");
		assert.strictEqual(familyOfName("Perimeter Shot Hunter", "SG"), "shooter");
		assert.strictEqual(familyOfName("Open-Lane Burner", "SF"), "slasher");
	});
});
