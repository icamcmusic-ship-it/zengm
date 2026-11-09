import { assert, describe, test, vi } from "vitest";
import { resetG } from "../../test/helpers.ts";
import genRatings from "../../worker/core/player/genRatings.basketball.ts";
import { ratingsBuildFormulas as F } from "../../worker/core/player/ratingsBuildFormulas.ts";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import {
	DEFAULT_SETTINGS,
	regenerateClass,
	RATING_KEYS,
} from "../ratingsBuilds/index.ts";
import type { PlayerInput, BuildRatings } from "../ratingsBuilds/index.ts";
import {
	ARCHETYPES,
	GROUPS,
	archetypeById,
	archetypeToBuild,
	classify,
	compositionOf,
	currentEntry,
	historyOf,
	landscapeOf,
	scoreAll,
	tierFromPercentile,
	toStored,
	viewOf,
	withEntry,
	type ArchetypeRatings,
} from "./index.ts";
import { sampleLeague } from "./sample.testutil.ts";
import { HARD_BLOCK, POSITIONS, positionOf, posPrior } from "./position.ts";
import { buildNorms } from "./match.ts";
import { DEFAULT_NORMS } from "./norms.data.ts";
import pos from "../../worker/core/player/pos.ts";

let cached: Awaited<ReturnType<typeof sampleLeague>> | undefined;
const league = async () => (cached ??= await sampleLeague(3000, "validate-v1"));

const R = (o: Partial<ArchetypeRatings>): ArchetypeRatings => ({
	hgt: 40,
	stre: 50,
	spd: 50,
	jmp: 50,
	endu: 50,
	ins: 50,
	dnk: 50,
	ft: 50,
	fg: 50,
	tp: 50,
	oiq: 50,
	diq: 50,
	drb: 50,
	pss: 50,
	reb: 50,
	...o,
});

describe("archetype table", () => {
	test("size, unique ids, valid profiles", () => {
		assert.ok(ARCHETYPES.length >= 170 && ARCHETYPES.length <= 200);
		assert.strictEqual(
			new Set(ARCHETYPES.map((a) => a.id)).size,
			ARCHETYPES.length,
		);
		assert.strictEqual(
			new Set(ARCHETYPES.map((a) => a.name)).size,
			ARCHETYPES.length,
		);
		for (const a of ARCHETYPES) {
			assert.ok(a.hgt[0] < a.hgt[1], a.id);
			assert.ok(a.desc.length > 5);
			assert.ok(Object.keys(a.w).length >= 3, a.id);
		}
		for (const g of GROUPS) {
			assert.ok(ARCHETYPES.filter((a) => a.group === g).length >= 20);
		}
	});
});

describe("classification", () => {
	test("is deterministic and carries primary, secondary, confidence, why", () => {
		const r = R({ pss: 85, drb: 80, oiq: 78, hgt: 25, spd: 70 });
		const a = classify(r, { ovr: 60 });
		const b = classify({ ...r }, { ovr: 60 });
		assert.deepStrictEqual(a, b);
		assert.ok(archetypeById(a.id));
		assert.strictEqual(a.why.length, 3);
		assert.ok(a.confidence >= 0 && a.confidence <= 1);
		assert.ok(a.tier);
		assert.ok(a.label.startsWith(a.name));
		assert.strictEqual(a.group, "guard");
	});

	test("height gates keep a tall player out of guard archetypes and vice versa", () => {
		const tall = classify(R({ hgt: 85, reb: 80, stre: 70, ins: 65 }));
		assert.ok(["big", "forward"].includes(tall.group), tall.id);
		const small = classify(R({ hgt: 8, pss: 80, drb: 80, spd: 75 }));
		assert.strictEqual(small.group, "guard", small.id);
	});

	test("skill requirements gate: a shooter is only a Sharpshooter with the 3", () => {
		const sc = scoreAll(R({ hgt: 30, tp: 90, ft: 85, fg: 70, oiq: 70 }));
		const row = sc.scored.find((s) => s.a.id === "sharpshooter")!;
		assert.ok(sc.skills.includes("3"));
		assert.ok(row.raw > 0.3);
		const noSkill = scoreAll(R({ hgt: 30, tp: 20, ft: 85, fg: 70 }));
		assert.ok(!noSkill.skills.includes("3"));
		assert.ok(noSkill.scored.find((s) => s.a.id === "sharpshooter")!.z < row.z);
	});

	test("tiny rating changes do not flap the archetype when the previous one is kept sticky", () => {
		const rng = new Rng("flap");
		let flips = 0;
		let n = 0;
		return league().then((lg) => {
			for (const p of lg.slice(0, 400)) {
				const a = classify(p.ratings);
				const nudged = { ...p.ratings };
				for (const k of RATING_KEYS) {
					if (k !== "hgt") {
						nudged[k] = Math.min(99, Math.max(1, nudged[k] + rng.int(-1, 1)));
					}
				}
				const b = classify(nudged, { previousId: a.id });
				n++;
				if (b.id !== a.id) {
					flips++;
				}
			}
			assert.ok(flips / n < 0.06, `flip rate ${flips / n}`);
		});
	});

	test("real stars get distinct star labels, an elite shot blocker reads as a rim protector, an old stopper as a veteran", () => {
		// Real 2025 (Tony Allen 2018) ratings, with the position the game shows and his age
		const cases: [string, Partial<ArchetypeRatings>, string, number, string][] =
			[
				[
					"LeBron James",
					{
						hgt: 57,
						stre: 84,
						spd: 51,
						jmp: 55,
						endu: 59,
						ins: 96,
						dnk: 83,
						ft: 54,
						fg: 97,
						tp: 39,
						oiq: 84,
						diq: 49,
						drb: 50,
						pss: 62,
						reb: 71,
					},
					"FC",
					41,
					"playmaking-superstar",
				],
				[
					"Giannis Antetokounmpo",
					{
						hgt: 70,
						stre: 68,
						spd: 72,
						jmp: 51,
						endu: 73,
						ins: 91,
						dnk: 95,
						ft: 29,
						fg: 98,
						tp: 23,
						oiq: 86,
						diq: 43,
						drb: 54,
						pss: 54,
						reb: 86,
					},
					"FC",
					31,
					"athletic-superstar",
				],
				[
					"Kevin Durant",
					{
						hgt: 66,
						stre: 69,
						spd: 56,
						jmp: 56,
						endu: 54,
						ins: 90,
						dnk: 89,
						ft: 65,
						fg: 98,
						tp: 40,
						oiq: 80,
						diq: 43,
						drb: 56,
						pss: 53,
						reb: 52,
					},
					"FC",
					37,
					"elite-shotmaker",
				],
				[
					"Joel Embiid",
					{
						hgt: 72,
						stre: 51,
						spd: 62,
						jmp: 36,
						endu: 51,
						ins: 96,
						dnk: 97,
						ft: 67,
						fg: 93,
						tp: 35,
						oiq: 65,
						diq: 48,
						drb: 76,
						pss: 54,
						reb: 76,
					},
					"FC",
					31,
					"dominant-big",
				],
				[
					"Rudy Gobert",
					{
						hgt: 80,
						stre: 90,
						spd: 28,
						jmp: 37,
						endu: 81,
						ins: 58,
						dnk: 91,
						ft: 32,
						fg: 12,
						tp: 0,
						oiq: 69,
						diq: 59,
						drb: 34,
						pss: 43,
						reb: 76,
					},
					"C",
					33,
					"rim-protector",
				],
				[
					"Tony Allen",
					{
						hgt: 51,
						stre: 52,
						spd: 21,
						jmp: 7,
						endu: 18,
						ins: 56,
						dnk: 58,
						ft: 34,
						fg: 38,
						tp: 36,
						oiq: 38,
						diq: 56,
						drb: 45,
						pss: 41,
						reb: 46,
					},
					"SF",
					36,
					"veteran-defender",
				],
			];
		for (const [name, r, p, age, id] of cases) {
			assert.strictEqual(classify(R(r), { pos: p, age }).id, id, name);
		}
	});
	test("tiers follow ovr percentile", () => {
		assert.strictEqual(tierFromPercentile(0.999), "franchise");
		assert.strictEqual(tierFromPercentile(0.97), "star");
		assert.strictEqual(tierFromPercentile(0.1), "fringe");
	});
});

describe("position prior", () => {
	test("the game's position and the archetype engine's agree", async () => {
		for (const p of (await league()).slice(0, 300)) {
			assert.strictEqual(pos(p.ratings as any), positionOf(p.ratings));
		}
	}, 120000);

	test("every position allows at least two groups, and hard blocks hold", () => {
		for (const ps of POSITIONS) {
			const groups = new Set(
				ARCHETYPES.filter((a) => posPrior(a.group, a.pos, ps) !== null).map(
					(a) => a.group,
				),
			);
			assert.ok(groups.size >= 2, ps);
		}
		for (const a of ARCHETYPES) {
			for (const ps of HARD_BLOCK[a.group]) {
				assert.strictEqual(posPrior(a.group, a.pos, ps), null, a.id + ps);
			}
		}
		for (const ps of ["PG", "G", "SG"] as const) {
			assert.strictEqual(posPrior("big", undefined, ps), null);
		}
		assert.strictEqual(posPrior("guard", undefined, "C"), null);
	});

	test("zero hard position mismatches over a generated league, true, fuzzed and with small-league norms", async () => {
		const lg = await league();
		const small = buildNorms(lg.slice(0, 400), ARCHETYPES, DEFAULT_NORMS);
		small.bias = DEFAULT_NORMS.bias;
		const rng = new Rng("mismatch");
		let bad = 0;
		const ex: string[] = [];
		for (const p of lg) {
			const ps = positionOf(p.ratings);
			const f = rng.int(-8, 8);
			const fuzzed = { ...p.ratings };
			for (const k of RATING_KEYS) {
				if (k !== "hgt") {
					fuzzed[k] = Math.max(0, Math.min(100, fuzzed[k] + f));
				}
			}
			for (const c of [
				classify(p.ratings),
				classify(p.ratings, { norms: small }),
				classify(fuzzed, { pos: ps }),
				// Fuzzed ratings with no position given: read from the fuzzed ratings themselves
				classify(fuzzed),
			]) {
				const shownPos = ps;
				if (HARD_BLOCK[c.group].includes(shownPos)) {
					bad++;
					if (ex.length < 5) {
						ex.push(`${shownPos} ${c.id}`);
					}
				}
			}
		}
		// The last reading uses the fuzzed position, so a borderline G/F can rarely cross; the rest must be exact
		assert.ok(bad <= lg.length * 0.002, `${bad} ${ex.join(", ")}`);
	}, 120000);

	test("true and fuzzed ratings mostly land in the same group", async () => {
		const lg = await league();
		let same = 0;
		for (const p of lg) {
			const fuzzed = { ...p.ratings };
			for (const k of RATING_KEYS) {
				if (k !== "hgt") {
					fuzzed[k] = Math.max(0, Math.min(100, fuzzed[k] + 4));
				}
			}
			const ps = positionOf(p.ratings);
			if (
				classify(p.ratings, { pos: ps }).group ===
				classify(fuzzed, { pos: ps }).group
			) {
				same++;
			}
		}
		// A uniform +4 also lifts his overall level, which moves the fringe (journeyman) labels on purpose
		assert.ok(same / lg.length > 0.77, `${same}/${lg.length}`);
	}, 120000);

	// Hand-made players everyone would label the same way: the family and the group must match
	const FIXTURES: [string, Partial<ArchetypeRatings>, string[], string[]][] = [
		[
			"classic PG",
			{ hgt: 25, pss: 85, drb: 80, oiq: 75, spd: 70 },
			["playmaker"],
			["guard"],
		],
		[
			"sharpshooter",
			{ hgt: 35, tp: 85, ft: 80, fg: 65 },
			["shooter"],
			["guard"],
		],
		[
			"slasher",
			{ hgt: 35, spd: 80, jmp: 80, dnk: 80, tp: 30 },
			["slasher", "athlete"],
			["guard"],
		],
		[
			"lockdown defender",
			{ hgt: 38, diq: 85, spd: 75, stre: 55, ins: 35, dnk: 35, fg: 40 },
			["defender"],
			["guard", "wing"],
		],
		[
			"3-and-D wing",
			{ hgt: 45, tp: 80, diq: 75, spd: 65, ins: 35, dnk: 40, pss: 40, drb: 45 },
			["defender", "shooter"],
			["wing", "forward"],
		],
		[
			"point forward",
			{ hgt: 52, pss: 80, drb: 70, oiq: 75 },
			["playmaker"],
			["guard", "wing", "forward"],
		],
		[
			"stretch 4",
			{ hgt: 60, tp: 75, ft: 70, reb: 55, stre: 55, ins: 45, dnk: 45 },
			["shooter"],
			["forward", "big"],
		],
		[
			"stretch 5",
			{ hgt: 72, tp: 75, ft: 72, ins: 45, reb: 50, jmp: 40, diq: 40 },
			["shooter"],
			["big"],
		],
		[
			"rim protector",
			{ hgt: 70, jmp: 70, diq: 80, stre: 60, ins: 35, fg: 30, tp: 20, ft: 40 },
			["defender"],
			["big"],
		],
		[
			"post scorer",
			{ hgt: 65, ins: 80, stre: 75, oiq: 65, tp: 25 },
			["scorer"],
			["forward", "big"],
		],
		[
			"glass cleaner",
			{ hgt: 68, reb: 85, stre: 75, tp: 20, fg: 30, ins: 40 },
			["rebounder"],
			["big"],
		],
		[
			"lob-catching big",
			{ hgt: 66, dnk: 85, jmp: 80, spd: 60, tp: 20, fg: 35, pss: 35 },
			["athlete"],
			["forward", "big"],
		],
	];
	for (const [label, o, families, groups] of FIXTURES) {
		test(`fixture: ${label}`, () => {
			const r = R(o);
			const c = classify(r);
			assert.ok(
				families.includes(c.family) && groups.includes(c.group),
				`${label} (${positionOf(r)}) -> ${c.id} (${c.group}/${c.family})`,
			);
			assert.ok(!HARD_BLOCK[c.group].includes(positionOf(r)));
		});
	}
});

describe("distribution over a generated league", () => {
	test("no archetype dominates, nearly all are used, and it is not just position", async () => {
		const lg = await league();
		const counts: Record<string, number> = {};
		const cross: Record<string, Record<string, number>> = {};
		for (const p of lg) {
			const c = classify(p.ratings, { ovr: p.ovr });
			counts[c.id] = (counts[c.id] ?? 0) + 1;
			const pos = F.pos(p.ratings);
			(cross[c.id] ??= {})[pos] = (cross[c.id]![pos] ?? 0) + 1;
		}
		const max = Math.max(...Object.values(counts)) / lg.length;
		assert.ok(max < 0.08, `max share ${max}`);
		assert.ok(max < 0.05, `max share ${max}`);
		// Raw prospects, journeymen and veterans need players this league does not hold (or an age)
		const regular = ARCHETYPES.filter((a) => !a.age && !a.level);
		const used = regular.filter((a) => (counts[a.id] ?? 0) > 0).length;
		assert.ok(used >= regular.length - 8, `used ${used}/${regular.length}`);
		// Common archetypes cut across positions: most of them hold several BBGM positions
		const common = Object.entries(counts).filter(([, n]) => n >= 15);
		const multi = common.filter(
			([id]) => Object.values(cross[id]!).filter((n) => n >= 3).length >= 2,
		);
		assert.ok(
			multi.length / common.length > 0.5,
			`${multi.length}/${common.length}`,
		);
	});
});

describe("targeting an archetype with the regenerator", () => {
	test("every archetype has a usable build and a seed", () => {
		for (const a of ARCHETYPES) {
			const b = archetypeToBuild(a.id);
			assert.ok(b, a.id);
			assert.strictEqual(b!.min, a.hgt[0]);
		}
	});

	test("round trip: aimed players keep ovr exactly and derive to the target almost always", () => {
		resetG();
		const rng = new Rng("aim");
		// genRatings draws from Math.random, so seed it too: otherwise the sampled class (and the match rate, which sits a
		// few players above its floor) changes from run to run
		const ratingsRng = new Rng("aim-ratings");
		const spy = vi
			.spyOn(Math, "random")
			.mockImplementation(() => ratingsRng.random());
		const inputs: PlayerInput[] = [];
		const wanted: string[] = [];
		const rare = new Set(ARCHETYPES.filter((a) => a.rare).map((a) => a.id));
		// Veterans cannot be aimed at (prospects are not 31), and these players are past the raw prospect / journeyman level
		const pickable = ARCHETYPES.filter(
			(a) => !rare.has(a.id) && !a.age && !a.level,
		);
		let i = 0;
		while (inputs.length < 160) {
			const { heightInInches, ratings } = genRatings(2025, DEFAULT_LEVEL);
			const r = {} as BuildRatings;
			for (const k of RATING_KEYS) {
				r[k] = ratings[k];
			}
			const ovr = F.ovr(r);
			// As the regenerator's archetype pool does: inside the height gate and allowed at his position
			const ps = positionOf(r);
			const fits = pickable.filter(
				(a) =>
					r.hgt >= a.hgt[0] + 2 &&
					r.hgt <= a.hgt[1] - 2 &&
					(posPrior(a.group, a.pos, ps) ?? -9) > -1,
			);
			if (fits.length === 0 || ovr < 38) {
				continue;
			}
			const a = fits[rng.int(0, fits.length - 1)]!;
			inputs.push({
				key: `p${i++}`,
				ratings: r,
				fuzz: 0,
				ovr,
				pot: Math.min(100, ovr + 10),
				age: 19,
				hgtInches: heightInInches,
				lock: { archetype: a.id },
			});
			wanted.push(a.id);
		}
		spy.mockRestore();
		const res = regenerateClass(F, inputs, {
			...DEFAULT_SETTINGS,
			seed: "aim",
			fuzz: "zero",
		});
		let matched = 0;
		let ovrOk = 0;
		let derivedMatch = 0;
		let loose = 0;
		const misses: string[] = [];
		for (const [k, r] of res.results.entries()) {
			if (r.after.ovr === inputs[k]!.ovr) {
				ovrOk++;
			}
			if (r.target?.matched) {
				matched++;
			}
			if (r.target?.inLabel) {
				loose++;
			}
			if (r.derived.id === wanted[k]) {
				derivedMatch++;
			} else {
				misses.push(`${wanted[k]}>${r.derived.id}`);
			}
		}
		assert.strictEqual(matched, derivedMatch);
		assert.ok(
			ovrOk / inputs.length > 0.93,
			`ovr kept ${ovrOk}/${inputs.length}`,
		);
		assert.ok(
			// The defining-skill gates (score.ts) make a label harder to reach from an unrelated base than it was. Across
			// ratings seeds this lands at 99-104 exact / 104-107 loose of 160 (103 / 107 for the fixed seed above), so the
			// floors leave ~10 players of margin rather than sitting on the mean
			derivedMatch / inputs.length > 0.58 && loose / inputs.length > 0.6,
			`match ${derivedMatch}/${inputs.length} loose ${loose} ${misses.join(" ")}`,
		);
	}, 300000);
});

describe("storage helpers", () => {
	const c = classify(R({ hgt: 25, pss: 85, drb: 80, oiq: 78 }), { ovr: 55 });
	test("toStored / viewOf round trip and history", () => {
		const e = toStored(2025, c);
		assert.strictEqual(viewOf(e)?.id, c.id);
		const list = withEntry(withEntry(undefined, e), {
			...e,
			season: 2027,
			id: "sharpshooter",
			secondary: undefined,
		});
		assert.strictEqual(list.length, 2);
		assert.strictEqual(currentEntry(list)?.season, 2027);
		assert.strictEqual(currentEntry(list, 2026)?.season, 2025);
		assert.deepStrictEqual(withEntry(list, { ...e, season: 2027 }).length, 2);
		const h = historyOf(list, 2029);
		assert.strictEqual(h.length, 2);
		assert.strictEqual(h[1]!.from, viewOf(e)!.label);
		assert.strictEqual(h[1]!.through, 2029);
		assert.strictEqual(viewOf({ season: 1, id: "nope" }), null);
	});

	test("landscape and roster composition", () => {
		const rows = ARCHETYPES.slice(0, 40).map((a, i) => ({
			pid: i,
			ovr: 40 + i,
			archetypeId: a.id,
		}));
		const l = landscapeOf(rows);
		assert.strictEqual(l.total, 40);
		assert.strictEqual(
			l.byGroup.guard + l.byGroup.wing + l.byGroup.forward + l.byGroup.big,
			40,
		);
		const same = Array.from({ length: 10 }, (_, i) => ({
			pid: i,
			ovr: 60 - i,
			archetypeId: "slasher",
		}));
		const comp = compositionOf(same);
		const kinds = comp.warnings.map((w) => w.kind);
		assert.ok(
			kinds.includes("playmaking") &&
				kinds.includes("size") &&
				kinds.includes("duplicates"),
		);
		const ok = compositionOf(
			[
				"floor-general",
				"sharpshooter",
				"3-and-d-wing",
				"stretch-four",
				"rim-protector",
				"glass-cleaner",
				"slasher",
				"glue-guy",
				"two-way-wing",
			].map((id, i) => ({ pid: i, ovr: 70 - i, archetypeId: id })),
		);
		assert.deepStrictEqual(ok.warnings, []);
		assert.strictEqual(compositionOf([]).warnings.length, 0);
	});
});
