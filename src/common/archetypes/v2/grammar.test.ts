import { assert, describe, test } from "vitest";
import { archetypeById } from "../classify.ts";
import { compositionOf, landscapeOf } from "../helpers.ts";
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
import {
	CUSTOM_TESTS,
	floorGap,
	floorMiss,
	RAMP_RAT,
	type WordContext,
} from "./tests.ts";
import { USER_PICKS } from "./userPicks.data.ts";
import { canonOf, classifyV2, rampMu, V2_PARAMS } from "./engine.ts";
import { ELITE_RE, HONEST_ROLES, tierOf } from "./honest.ts";
import { NOUNS, nounScores, nounsOfName } from "./nouns.ts";

describe("archv2 grammar", () => {
	test("every word reads as the concept its test is on (so a name's promises are exactly its words')", () => {
		for (const d of DESCRIPTORS) {
			// (archnouns: the noun names' own words are never tested on a concept)
			if (d.nounOnly) {
				continue;
			}
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
			// (archnouns: the noun names' end words are never tested on a concept)
			if (r.nounOnly) {
				continue;
			}
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
			// (archnouns: the noun names' end words always follow a front word; their whole names are their own)
			if (r.nounOnly) {
				continue;
			}
			for (const group of r.groups) {
				assert.isFalse(short.has(composeName(r, [], group)), r.key);
			}
		}
	});

	test("archv3: every composable name is whole: no empty word, no id, no word twice, and it resolves by its id", () => {
		let n = 0;
		// (the reading's own words; the noun names are checked by nouns.test.ts)
		const descs = DESCRIPTORS.filter((d) => !d.nounOnly);
		for (const r of ROLES) {
			if (r.nounOnly) {
				continue;
			}
			for (const group of r.groups) {
				const combos: (typeof DESCRIPTORS)[number][][] = [[]];
				for (const [i, d] of descs.entries()) {
					combos.push([d]);
					for (const e of descs.slice(i + 1)) {
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

	test("archv5: the user's labels of the archcmp sample are names the grammar says, each read back as its role", () => {
		const picks = USER_PICKS.filter((p) => p.uid.startsWith("archcmp-"));
		assert.strictEqual(picks.length, 20);
		for (const p of picks) {
			const a = archetypeById(p.picked!)!;
			assert.ok(a, p.picked!);
			// (an alias of a build reads as that build: "Perimeter Lockdown" is the Lockdown Defender)
			if (p.picked!.startsWith("v2:")) {
				assert.strictEqual(a.name, p.label, p.picked!);
				const parsed = parseComposedId(p.picked!)!;
				assert.strictEqual(
					parseName(a.name, p.pos).role,
					parsed.role.key,
					a.name,
				);
			} else {
				assert.strictEqual(canonOf(p.label!), p.picked, p.label);
			}
		}
		assert.strictEqual(familyOfName("Glass-Cleaning Prospect", "FC"), "glass");
		assert.strictEqual(familyOfName("Prospect", "GF"), "allAround");
		assert.strictEqual(familyOfName("Paint Beast", "FC"), "postBig");
		assert.strictEqual(familyOfName("Interior Force", "C"), "postBig");
		assert.strictEqual(
			parseName("Sharpshooting Slasher", "SG").descs[0],
			"sharpshooting",
		);
		assert.strictEqual(
			composeName(ROLE_BY_KEY.get("finisher")!, [], "big"),
			"Interior Finisher",
		);
	});

	test("archv5: absolute floors on shooting words, and the low-ovr label", () => {
		const r = (x: Record<string, number>) => x as any;
		assert.isAbove(floorMiss("Stretch Big", r({ tp: 41 })), 0);
		assert.strictEqual(floorMiss("Stretch Big", r({ tp: 45 })), 0);
		assert.isAbove(floorMiss("3 & D Specialist", r({ tp: 52 })), 0);
		assert.strictEqual(floorMiss("3 & D Wing", r({ tp: 54 })), 0);
		assert.isAbove(floorMiss("Catch & Shoot Sniper", r({ tp: 54 })), 0);
		assert.strictEqual(floorMiss("Lockdown Defender", r({ tp: 20 })), 0);
		const flat = {
			hgt: 60,
			stre: 60,
			spd: 60,
			jmp: 60,
			endu: 60,
			ins: 45,
			dnk: 50,
			ft: 40,
			fg: 45,
			tp: 40,
			oiq: 45,
			diq: 45,
			drb: 45,
			pss: 45,
			reb: 50,
		};
		const ctx = (age: number | undefined, x = {}, prospect = false) =>
			({
				cv: {},
				pz: {},
				top3: [],
				bucket: "C",
				style: {},
				r: { ...flat, ...x },
				age,
				prospect,
			}) as unknown as WordContext;
		const prospect = CUSTOM_TESTS.prospectRole!;
		const depth = CUSTOM_TESTS.depthPieceRole!;
		assert.isTrue(prospect(ctx(27), false).pass);
		assert.isFalse(prospect(ctx(28), false).pass);
		assert.isTrue(depth(ctx(28), false).pass);
		assert.isFalse(depth(ctx(27), false).pass);
		// (never a draft prospect; one tool only for a young player)
		assert.isFalse(prospect(ctx(undefined, {}, true), false).pass);
		assert.isTrue(prospect(ctx(21, { reb: 67 }), false).pass);
		assert.isFalse(prospect(ctx(26, { reb: 67 }), false).pass);
		assert.isFalse(prospect(ctx(21, { reb: 67, ins: 60 }), false).pass);
	});

	test("archramp: a word's bars are ramps, in step with the yes/no they replace", () => {
		// The membership: nothing a ramp width below the bar, all of it at the bar; rampLo 0 is the old cliff
		const P = { ...V2_PARAMS, rampLo: 1, rampHi: 0 };
		assert.strictEqual(rampMu(-1, P), 0);
		assert.closeTo(rampMu(-0.5, P), 0.5, 1e-9);
		assert.strictEqual(rampMu(0, P), 1);
		assert.strictEqual(rampMu(3, P), 1);
		assert.strictEqual(rampMu(-Infinity, P), 0);
		const cliff = { ...V2_PARAMS, rampLo: 0 };
		assert.strictEqual(rampMu(-1e-6, cliff), 0);
		assert.strictEqual(rampMu(0, cliff), 1);
		// (centred: half way at the bar)
		assert.closeTo(
			rampMu(0, { ...V2_PARAMS, rampLo: 1, rampHi: 1 }),
			0.5,
			1e-9,
		);

		// An absolute floor: how far below it, one ramp width = RAMP_RAT rating points
		const r = (x: Record<string, number>) => x as any;
		assert.strictEqual(floorGap("Stretch Big", r({ tp: 45 })), 0);
		assert.strictEqual(floorGap("Stretch Big", r({ tp: 43 })), 2);
		assert.strictEqual(floorGap("Lockdown Defender", r({ tp: 20 })), -Infinity);
		const pen = (tp: number) =>
			1 - rampMu(-floorGap("Stretch Big", r({ tp })) / RAMP_RAT, P);
		assert.strictEqual(pen(45), 0);
		assert.isAbove(pen(44), 0);
		assert.isBelow(pen(44), pen(43));
		assert.strictEqual(pen(42), 1);
		assert.strictEqual(pen(30), 1);

		// A test's distance in ramp widths has the sign of its yes/no, moves with the rating, and a yes/no bar (the
		// prospect flag, an age) is never softened
		const flat = {
			hgt: 60,
			stre: 60,
			spd: 60,
			jmp: 60,
			endu: 60,
			ins: 45,
			dnk: 50,
			ft: 40,
			fg: 45,
			tp: 40,
			oiq: 45,
			diq: 45,
			drb: 45,
			pss: 45,
			reb: 50,
		};
		const ctx = (x = {}, age = 30, prospect = false) =>
			({
				cv: {},
				pz: {},
				top3: [],
				bucket: "C",
				style: {},
				r: { ...flat, ...x },
				age,
				prospect,
			}) as unknown as WordContext;
		const depth = CUSTOM_TESTS.depthPieceRole!;
		let last = Infinity;
		for (const dnk of [48, 50, 51, 52, 53, 54, 60]) {
			const t = depth(ctx({ dnk }), false);
			assert.strictEqual(t.pass, t.soft >= 0, `dnk ${dnk}`);
			assert.isAtMost(t.soft, last, `dnk ${dnk}`);
			last = t.soft;
		}
		// (one point over the cap is a near miss, ten is not his word at all)
		assert.isAbove(rampMu(depth(ctx({ dnk: 51 }), false).soft, P), 0);
		assert.strictEqual(rampMu(depth(ctx({ dnk: 60 }), false).soft, P), 0);
		assert.strictEqual(depth(ctx({}, 30, true), false).soft, -Infinity);
		assert.strictEqual(depth(ctx({}, 22), false).soft, -Infinity);
	});

	test('no Prospect or Depth Piece label (the user: "I don\'t want Prospect and Depth Piece anymore")', () => {
		// The user's own picks of the archcmp sample that he had called a Prospect: read like anyone else now, and with the
		// labels back on (lowOvrRoles) they read as before
		const low = USER_PICKS.filter(
			(p) => /Prospect/.test(p.label ?? "") && p.input?.ratings,
		);
		assert.isAtLeast(low.length, 2);
		let was = 0;
		for (const pk of low) {
			const opts = {
				pos: pk.input!.pos,
				age: pk.input!.age,
				srID: `upick:${pk.uid}`,
			};
			const c = classifyV2(pk.input!.ratings, opts);
			assert.notMatch(c.name, /Prospect|Depth Piece/, pk.name);
			assert.notMatch(
				c.alternates.map((a) => a.name).join(" "),
				/Prospect|Depth Piece/,
			);
			if (
				/Prospect|Depth Piece/.test(
					classifyV2(pk.input!.ratings, {
						...opts,
						params: { lowOvrRoles: true, nouns: false },
					}).name,
				)
			) {
				was++;
			}
		}
		assert.isAtLeast(was, 1);
	});

	describe("archreview: absolute gates and honest names", () => {
		const base = {
			hgt: 45,
			stre: 40,
			spd: 45,
			jmp: 45,
			endu: 50,
			ins: 40,
			dnk: 40,
			ft: 50,
			fg: 45,
			tp: 45,
			oiq: 45,
			diq: 45,
			drb: 45,
			pss: 45,
			reb: 40,
		} as any;
		const read = (r: any, o: any = {}) =>
			classifyV2({ ...base, ...r }, { pos: "SG", age: 27, ...o });

		// (archskill, reading 29: never given any more, but a label an older reading stored still reads)
		test("every older reading's honest name composes, reads back, and has its own description and family", () => {
			for (const h of HONEST_ROLES) {
				const role = ROLE_BY_KEY.get(h.key)!;
				assert.ok(role.honest, h.key);
				for (const n of h.names) {
					const id = composedId(role, [], "wing", { [h.key]: n });
					const a = composedArchetype(id)!;
					assert.strictEqual(a.name, n, id);
					assert.strictEqual(a.desc, h.desc);
					assert.include(a.tags, "honest");
				}
			}
		});

		test("tiers: elite words only from ovr 58", () => {
			assert.strictEqual(tierOf(58), "elite");
			assert.strictEqual(tierOf(57), "mid");
			assert.strictEqual(tierOf(49), "low");
			// a great shooter below the top tier is never a Sniper
			const shooter = { tp: 85, fg: 70, ft: 85, oiq: 60 };
			for (const ovr of [40, 48, 52, 58]) {
				assert.notMatch(read(shooter, { ovr }).name, ELITE_RE, `ovr ${ovr}`);
			}
		});

		// archskill (reading 29): no honest, depth or development name: his best skill, however low
		test("no skill over the bar: his best skill's noun, never a depth or development name", () => {
			const weak = { tp: 35, fg: 35, pss: 35, drb: 35, reb: 35 };
			const vet = read(weak, { ovr: 38, age: 31, pot: 38 });
			const kid = read(weak, { ovr: 30, age: 19, pot: 55 });
			for (const c of [vet, kid]) {
				assert.notInclude(c.tags, "honest");
				assert.notMatch(
					c.name,
					/Journeyman|Filler|Camp Body|Ten-Day|Developing|Raw|Project|Specialist/,
				);
				assert.match(c.reason?.gate ?? "", /^skill name/);
				assert.isAtLeast(nounsOfName(c.name)?.nouns.length ?? 0, 1, c.name);
			}
			// (the same player, the same name)
			assert.strictEqual(
				read(weak, { ovr: 38, age: 31, pot: 38 }).name,
				vet.name,
			);
		});

		test("one skill under the top tier: that skill's noun", () => {
			const c = read({ tp: 72 }, { ovr: 44, age: 27, pot: 44 });
			assert.notInclude(c.tags, "honest");
			// (archaudit 2059: Floor Spacer is the non-elite shooter's name)
			assert.match(c.name, /Shooter|Floor Spacer/);
			assert.notMatch(c.name, /Specialist|One-Trick|Gunner/);
		});

		test("a whole weak league has no elite words and every word of a label is true", () => {
			const rng = (i: number) =>
				(((Math.sin(i * 12.9898) * 43758.5453) % 1) + 1) % 1;
			for (let i = 0; i < 120; i++) {
				const r: any = {};
				for (const k of Object.keys(base)) {
					r[k] = Math.round(
						15 + 40 * rng(i * 31 + k.length * 7 + k.charCodeAt(0)),
					);
				}
				const c = classifyV2(
					{ ...base, ...r },
					{
						pos: (["PG", "SG", "SF", "PF", "C"] as const)[i % 5],
						age: 20 + (i % 15),
						ovr: 30 + (i % 25),
						pot: 30 + (i % 25),
					},
				);
				assert.notMatch(c.name, ELITE_RE, c.name);
				// (archnouns: every noun of his name is one he stands well in the league at)
				const sc = nounScores({ ...base, ...r }, undefined, undefined, NOUNS);
				const nn = nounsOfName(c.label);
				// (archskill: never an honest name; a player with no real skill is named by his best skill, however low)
				assert.notInclude(c.tags, "honest");
				if (!/^skill name/.test(c.reason?.gate ?? "") && nn) {
					for (const k of nn.nouns) {
						assert.isAtLeast(
							sc.find((x) => x.key === k)!.pct,
							0.6,
							`${c.label}: ${k}`,
						);
					}
				}
			}
		});

		test("the group cards count players by their position (a composed name's group has no forwards)", () => {
			const role = ROLE_BY_KEY.get(HONEST_ROLES[0]!.key)!;
			const id = composedId(role, [], "wing", {});
			const rows = [
				{ pid: 1, ovr: 50, archetypeId: id, pos: "F" },
				{ pid: 2, ovr: 50, archetypeId: id, pos: "SF" },
				{ pid: 3, ovr: 50, archetypeId: id, pos: "PF" },
			];
			assert.deepStrictEqual(landscapeOf(rows).byGroup, {
				guard: 0,
				wing: 1,
				forward: 2,
				big: 0,
			});
			assert.strictEqual(compositionOf(rows).byGroup.forward, 2);
		});
	});
});
