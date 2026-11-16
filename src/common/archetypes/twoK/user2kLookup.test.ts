import { assert, test } from "vitest";
import { USER_2K } from "../user2k.data.ts";
import { labelSourceOf, user2kLabel } from "./user2kLookup.ts";
import { NATIVE_FEATURES } from "../../nativeFeatures.ts";

test("a real player in the 2K list gets 2K's archetype in the matched seasons only", () => {
	const kyrie = { srID: "irvinky01", lastName: "Irving" };
	// (current entry: the 2027 season it was read at, and 2026)
	assert.strictEqual(user2kLabel(kyrie, 2027), "Iso Savant");
	assert.strictEqual(user2kLabel(kyrie, 2026), "Iso Savant");
	assert.strictEqual(user2kLabel(kyrie, 2028), undefined);
	// (all-time Cavaliers entry: only the season it was matched to)
	assert.strictEqual(user2kLabel(kyrie, 2015), "Iso Savant");
	assert.strictEqual(user2kLabel(kyrie, 2016), undefined);
	assert.strictEqual(user2kLabel(kyrie, 2014), undefined);
});

test("random, fictional and renamed players never match", () => {
	assert.strictEqual(user2kLabel({ lastName: "Irving" }, 2027), undefined);
	assert.strictEqual(
		user2kLabel({ srID: undefined, lastName: "Jokic" }, 2027),
		undefined,
	);
	assert.strictEqual(
		user2kLabel({ srID: "irvinky01", lastName: "Smith" }, 2027),
		undefined,
	);
	assert.strictEqual(
		user2kLabel({ srID: "nobody01", lastName: "Irving" }, 2027),
		undefined,
	);
});

test("every matched entry of the list resolves (names with diacritics and suffixes too)", () => {
	let n = 0;
	for (const r of USER_2K) {
		if (!r.slug || r.season === undefined) {
			continue;
		}
		const parts = r.name.split(" ");
		const lastName = parts.slice(1).join(" ");
		assert.strictEqual(
			user2kLabel({ srID: r.slug, lastName }, r.season),
			r.arch,
			r.name,
		);
		n++;
	}
	assert.ok(n > 600);
	assert.strictEqual(
		user2kLabel({ srID: "jokicni01", lastName: "Jokić" }, 2027),
		"Diming Post Popper",
	);
});

test("the setting defaults to the game's archetypes", () => {
	const f = NATIVE_FEATURES.find((x) => x.id === "archetypes")!;
	const o = (f as any).options.find(
		(x: any) => x.key === "archetypeLabelSource",
	);
	assert.strictEqual(o.default, "game");
	assert.strictEqual(labelSourceOf(undefined), "game");
	assert.strictEqual(labelSourceOf("bogus"), "game");
	assert.strictEqual(labelSourceOf("both"), "both");
});
