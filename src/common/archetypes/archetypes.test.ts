import { assert, describe, test } from "vitest";
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
		assert.ok(ARCHETYPES.length >= 100 && ARCHETYPES.length <= 150);
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

	test("tiers follow ovr percentile", () => {
		assert.strictEqual(tierFromPercentile(0.999), "franchise");
		assert.strictEqual(tierFromPercentile(0.97), "star");
		assert.strictEqual(tierFromPercentile(0.1), "fringe");
	});
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
		const used = ARCHETYPES.filter((a) => (counts[a.id] ?? 0) > 0).length;
		assert.ok(used >= ARCHETYPES.length - 12, `used ${used}`);
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
		const inputs: PlayerInput[] = [];
		const wanted: string[] = [];
		const rare = new Set(ARCHETYPES.filter((a) => a.rare).map((a) => a.id));
		const pickable = ARCHETYPES.filter((a) => !rare.has(a.id));
		let i = 0;
		while (inputs.length < 160) {
			const { heightInInches, ratings } = genRatings(2025, DEFAULT_LEVEL);
			const r = {} as BuildRatings;
			for (const k of RATING_KEYS) {
				r[k] = ratings[k];
			}
			const ovr = F.ovr(r);
			const fits = pickable.filter(
				(a) => r.hgt >= a.hgt[0] + 2 && r.hgt <= a.hgt[1] - 2,
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
		const res = regenerateClass(F, inputs, {
			...DEFAULT_SETTINGS,
			seed: "aim",
			fuzz: "zero",
		});
		let matched = 0;
		let ovrOk = 0;
		let derivedMatch = 0;
		let loose = 0;
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
			}
		}
		assert.strictEqual(matched, derivedMatch);
		assert.ok(
			ovrOk / inputs.length > 0.93,
			`ovr kept ${ovrOk}/${inputs.length}`,
		);
		assert.ok(
			derivedMatch / inputs.length > 0.7 && loose / inputs.length > 0.8,
			`match ${derivedMatch}/${inputs.length}`,
		);
	}, 120000);
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
