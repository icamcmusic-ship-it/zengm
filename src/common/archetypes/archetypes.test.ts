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
	tierFromPercentile,
	toStored,
	viewOf,
	withEntry,
	type ArchetypeRatings,
} from "./index.ts";
import { sampleLeague } from "./sample.testutil.ts";
import { fillExpandedRatings } from "../expandedRatings.ts";
import {
	HARD_BLOCK,
	POSITIONS,
	archetypePrior,
	nameContradictsPosition,
	namePositions,
	positionFor,
	positionOf,
	positionWordOf,
	posPrior,
} from "./position.ts";
import { buildNorms } from "./match.ts";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { readFileSync } from "node:fs";
import { coverOf } from "./score.ts";
import { isPoorFit, POOR_FIT_SCORE } from "./classify.ts";
import { TWO_K_NAMES } from "./defs.data.ts";
import { TWO_K_DEFS } from "./twoK/defs2k.data.ts";
import { CUSTOM_DEFS } from "./customDefs.data.ts";
import { GOLD } from "./gold.data.ts";
import { realData, realNorms, realPlayer } from "./real.testutil.ts";
import { DEFAULT_NORMS_EXPANDED } from "./normsExpanded.data.ts";
import { catchAllShortfall, promiseChecks, promisesOf } from "./score.ts";
import { SCORING_ARCHETYPES, scoreAll, scoreTerms } from "./classify.ts";
import { statReading, STATS_W, STATS_W_MORE } from "./stats.ts";
import { MERGED, mergedId } from "./merges.data.ts";
import { nameAt } from "./posNames.ts";
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

describe("archetype table: every archetype is an NBA 2K build", () => {
	test("size, unique ids and names, valid profiles", () => {
		assert.ok(
			// (arch15: 145 more merges, five new builds)
			ARCHETYPES.length >= 180 && ARCHETYPES.length <= 400,
			`${ARCHETYPES.length}`,
		);
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
			assert.ok(a.desc.length > 5, a.id);
			// (the all-around star build has no profile: score.ts allAroundQuality)
			assert.ok(
				Object.keys(a.w).length >= 3 || a.tags.includes("allAround"),
				a.id,
			);
			// (a custom build is not a 2K name)
			assert.strictEqual(a.tags.includes("2k"), !a.custom, a.id);
			// No lifecycle or level gates: the same build at any level
			assert.ok(!("level" in a) && !("age" in a), a.id);
		}
		for (const g of GROUPS) {
			assert.ok(ARCHETYPES.filter((a) => a.group === g).length >= 20, g);
		}
	});

	test("the 2K list covers every 2K build name exactly once, as an archetype or as one of its aliases", () => {
		const builds = JSON.parse(
			readFileSync(new URL("./twoK/builds2k.json", import.meta.url), "utf8"),
		).builds as { name: string }[];
		const all = new Set(builds.map((b) => b.name));
		const seen: string[] = [];
		for (const d of TWO_K_DEFS) {
			seen.push(d.name, ...d.aliases);
		}
		assert.strictEqual(seen.length, new Set(seen).size);
		assert.deepStrictEqual([...new Set(seen)].sort(), [...all].sort());
		for (const id of Object.keys(TWO_K_NAMES)) {
			assert.ok(archetypeById(id), id);
		}
	});

	test("merged builds: gone from the list, their names aliases of the kept build, stored labels read as it", () => {
		const names = new Map(
			[...TWO_K_DEFS, ...CUSTOM_DEFS].map((d) => [d.id, d.name]),
		);
		for (const [from, to0] of Object.entries(MERGED)) {
			// (arch15: a build may have been merged into one that was merged later)
			const to = mergedId(to0);
			assert.strictEqual(archetypeById(from), undefined, from);
			assert.ok(archetypeById(to), to);
			assert.ok(TWO_K_NAMES[to]!.includes(names.get(from)!), from);
			const v = viewOf({ season: 2025, id: from, v: 12 });
			assert.strictEqual(v?.id, to, from);
		}
		assert.strictEqual(
			ARCHETYPES.length,
			TWO_K_DEFS.length + CUSTOM_DEFS.length - Object.keys(MERGED).length,
		);
	});
});

describe("classification", () => {
	// arch11: a user's player, a low-level, very tall big who rebounds and passes a little but cannot shoot at all (mid-range
	// 14, three 9, free throws 16). His ratings are low and flat, so on the level-relative reading nothing looks weak; a
	// scorer's or shooter's name must still never be his, however he is read.
	test("a tall rebounder with no shot never gets a scoring or shooting name", () => {
		const sample: ArchetypeRatings = {
			hgt: 84,
			stre: 55,
			spd: 39,
			jmp: 46,
			endu: 20,
			ins: 38,
			dnk: 49,
			ft: 16,
			fg: 14,
			tp: 9,
			oiq: 30,
			diq: 36,
			drb: 34,
			pss: 47,
			reb: 58,
		};
		const expanded: ArchetypeRatings = {
			...sample,
			wng: 81,
			pdef: 34,
			idef: 38,
			oreb: 64,
			dreb: 52,
			csh: 6,
			dsh: 17,
			bsc: 43,
		};
		const scoring = new Set(["score", "shoot", "mid"]);
		for (const r of [sample, expanded]) {
			for (const shift of [-6, 0, 6]) {
				const shifted = { ...r };
				for (const k of Object.keys(shifted) as Exclude<
					keyof ArchetypeRatings,
					"sub"
				>[]) {
					if (k !== "hgt" && k !== "wng") {
						shifted[k] = Math.max(0, Math.min(100, shifted[k]! + shift));
					}
				}
				for (const opts of [{}, { prospect: true }, { age: 22 }, { age: 33 }]) {
					const c = classify(shifted, { pos: "C", ...opts });
					const a = archetypeById(c.id)!;
					const pr = promisesOf(a);
					assert.ok(
						!pr.all.some((k) => scoring.has(k)) &&
							!pr.keys.some((k) =>
								[
									"threeLevel",
									"insideOut",
									"catchShoot",
									"shotHunt",
									"scorer",
								].includes(k),
							),
						`${c.name} (${JSON.stringify(opts)}, shift ${shift})`,
					);
				}
			}
		}
	});
	test("custom builds: thirty-four (less the merged ones), not 2K names, never 2K aliases, positions their profile is played at", () => {
		const custom = ARCHETYPES.filter((a) => a.custom);
		// (arch15: five new builds from the gap analysis)
		assert.strictEqual(CUSTOM_DEFS.length, 34);
		assert.strictEqual(
			custom.length,
			34 - CUSTOM_DEFS.filter((d) => MERGED[d.id]).length,
		);
		const twoK = new Set(
			TWO_K_DEFS.flatMap((d) => [d.name, ...d.aliases]).map((n) =>
				n.toLowerCase(),
			),
		);
		for (const a of custom) {
			assert.ok(!twoK.has(a.name.toLowerCase()), a.name);
			// (a custom build may carry the names of the builds merged into it: merges.data.ts)
			for (const n of TWO_K_NAMES[a.id] ?? []) {
				// (arch15: and its names at other position groups)
				if (Object.values(a.posNames ?? {}).includes(n)) {
					continue;
				}
				assert.ok(
					Object.keys(MERGED).some(
						(id) =>
							mergedId(id) === a.id &&
							[...TWO_K_DEFS, ...CUSTOM_DEFS].some(
								(d) => d.id === id && (d.name === n || d.aliases.includes(n)),
							),
					),
					`${a.id}: ${n}`,
				);
			}
			assert.ok(a.positions.length >= 2, a.id);
			// (the all-around star build promises everything and names nothing: read apart, see below)
			if (!a.tags.includes("allAround")) {
				assert.ok(promisesOf(a).all.length >= 1, a.id);
			}
		}
	});

	test("all-around star build: only a balanced elite player, never a specialist or a prospect", () => {
		const id = "do-it-all-superstar";
		assert.ok(archetypeById(id));
		// (a generated 95: elite at nearly everything)
		const star = R({
			hgt: 53,
			stre: 95,
			spd: 73,
			jmp: 67,
			endu: 100,
			ins: 75,
			dnk: 97,
			ft: 100,
			fg: 100,
			tp: 100,
			oiq: 100,
			diq: 99,
			drb: 86,
			pss: 85,
			reb: 84,
		});
		assert.strictEqual(classify(star, { pos: "GF", age: 28 }).id, id);
		assert.notStrictEqual(
			classify(star, { pos: "GF", age: 19, prospect: true }).id,
			id,
		);
		// The same level spent on one thing is a specialist: an elite shooter, a playmaker, a rim protector
		const specialists = [
			R({
				hgt: 40,
				tp: 100,
				ft: 95,
				fg: 85,
				oiq: 90,
				spd: 70,
				drb: 70,
				pss: 60,
				diq: 55,
				endu: 80,
			}),
			R({
				hgt: 30,
				pss: 100,
				drb: 95,
				oiq: 95,
				spd: 90,
				tp: 70,
				fg: 70,
				ft: 80,
				diq: 60,
				endu: 80,
			}),
			R({
				hgt: 75,
				diq: 100,
				jmp: 85,
				reb: 95,
				stre: 90,
				ins: 70,
				dnk: 85,
				endu: 80,
				oiq: 60,
			}),
		];
		for (const r of specialists) {
			assert.notStrictEqual(classify(r, { age: 28 }).id, id);
		}
		// ... and an ordinary player with the same even shape is not a star
		const even = Object.fromEntries(
			Object.entries(star).map(([k, v]) => [
				k,
				k === "hgt" ? v : (v as number) - 45,
			]),
		) as ArchetypeRatings;
		assert.notStrictEqual(classify(even, { pos: "GF", age: 28 }).id, id);
	});

	test("is deterministic, one build (no hybrids), alternates are other builds", () => {
		const r = R({ pss: 85, drb: 80, oiq: 78, hgt: 25, spd: 70 });
		const a = classify(r, { ovr: 60 });
		const b = classify({ ...r }, { ovr: 60 });
		assert.deepStrictEqual(a, b);
		assert.ok(archetypeById(a.id));
		assert.strictEqual(a.label, a.name);
		assert.ok(!("secondary" in a));
		assert.ok(a.alternates.length <= 2);
		for (const x of a.alternates) {
			assert.notStrictEqual(x.id, a.id);
		}
		assert.strictEqual(a.why.length, 3);
		assert.ok(a.confidence >= 0 && a.confidence <= 1);
		assert.ok(a.tier);
		// (a guard's build, or a playmaker's open to any perimeter position)
		assert.ok(a.group === "guard" || a.family === "playmaker", a.name);
	});

	test("height gates keep a tall player out of guard archetypes and vice versa", () => {
		// (multi-position 2K builds are in the "wing" group, so the gate is read on the build's positions)
		const tall = classify(R({ hgt: 85, reb: 80, stre: 70, ins: 65 }));
		assert.ok(archetypeById(tall.id)!.positions.includes("C"), tall.id);
		assert.notStrictEqual(tall.group, "guard", tall.id);
		const small = classify(R({ hgt: 8, pss: 80, drb: 80, spd: 75 }));
		assert.ok(archetypeById(small.id)!.positions.includes("PG"), small.id);
		assert.notStrictEqual(small.group, "big", small.id);
	});

	test("level-invariant: the same shape scaled up or down reads as the same build", async () => {
		const lg = (await league()).slice(0, 600);
		let same = 0;
		let n = 0;
		for (const p of lg) {
			const ps = positionOf(p.ratings);
			const base = classify(p.ratings, { pos: ps }).id;
			for (const shift of [-6, 6]) {
				const r = { ...p.ratings };
				for (const k of RATING_KEYS) {
					if (k !== "hgt") {
						r[k] = Math.max(0, Math.min(100, r[k] + shift));
					}
				}
				n++;
				if (classify(r, { pos: ps }).id === base) {
					same++;
				}
			}
		}
		// (clamping at 0 and 100, and BBGM's composites not being linear, change the shape a little)
		assert.ok(same / n > 0.6, `${same}/${n}`);
	}, 120000);

	test("the label names his standout skills", () => {
		// [what he is, ratings, the skill classes the label must feature]
		const cases: [string, Partial<ArchetypeRatings>, string[]][] = [
			[
				"shooting guard",
				{ hgt: 30, tp: 88, ft: 82, fg: 70, ins: 35, dnk: 30, reb: 35 },
				["shoot"],
			],
			[
				"lob catcher who blocks shots",
				{ hgt: 68, dnk: 88, jmp: 88, diq: 70, tp: 15, fg: 30, pss: 35 },
				// (arch15: a rim runner, named for his bounce)
				["ath"],
			],
			[
				"rebounding big",
				{ hgt: 70, reb: 90, stre: 75, tp: 20, fg: 30, pss: 35, drb: 30 },
				["reb"],
			],
		];
		for (const [label, o, want] of cases) {
			const c = classify(R(o));
			const cover = coverOf(archetypeById(c.id)!);
			for (const k of want) {
				assert.ok((cover[k] ?? 0) > 0, `${label}: ${c.label} lacks ${k}`);
			}
		}
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
		// (may be the first test to generate the sample league)
	}, 120000);

	test("every player gets a build; poor fits are flagged, not relabelled", async () => {
		const lg = await league();
		let poor = 0;
		for (const p of lg) {
			const c = classify(p.ratings, { pos: positionOf(p.ratings) });
			assert.ok(archetypeById(c.id), c.id);
			if (isPoorFit(c)) {
				poor++;
			}
			assert.strictEqual(
				isPoorFit(c),
				c.score < POOR_FIT_SCORE || c.shortfall > 0.25,
			);
		}
		assert.ok(poor / lg.length < 0.1, `${poor}/${lg.length}`);
	}, 120000);

	test("real players get their build", () => {
		const data = realData();
		const misses: string[] = [];
		for (const [slug, season, want] of PINNED) {
			const row = data.d.ratings.find(
				(x: any) => x.slug === slug && x.season === season,
			);
			assert.ok(row, `${slug} ${season}`);
			// As a real-players league reads him: his position, age and last season's stats
			const p = realPlayer(data, row);
			// (arch15: his sub-ratings read against the real players', as a real-players league reads them)
			const c = classify(p.ratings, {
				norms: realNorms(DEFAULT_NORMS, false),
				pos: p.pos,
				age: p.age,
				stats: p.stats,
			});
			if (c.id !== mergedId(want)) {
				misses.push(`${slug} ${season}: ${c.id} (want ${want})`);
			}
			// With the Expanded Ratings setting on (wingspan and perimeter/interior defense derived as a real-players league
			// derives them) he must still get a build allowed at his position
			const ex = { ...p.ratings } as unknown as Record<string, number>;
			fillExpandedRatings({ srID: slug, ratings: [ex] });
			const ce = classify(ex as ArchetypeRatings, {
				norms: realNorms(DEFAULT_NORMS_EXPANDED, true),
				pos: p.pos,
				age: p.age,
				stats: p.stats,
			});
			assert.ok(archetypeById(ce.id)!.positions.includes(p.pos));
		}
		assert.deepStrictEqual(misses, []);
	});

	test("gold set: real players across eras get a build that fits their role", () => {
		const data = realData();
		let listed = 0;
		let role = 0;
		for (const [slug, season, ok, spec] of GOLD) {
			const row = data.d.ratings.find(
				(x: any) => x.slug === slug && x.season === season,
			);
			assert.ok(row, `${slug} ${season}`);
			for (const id of ok) {
				assert.ok(archetypeById(mergedId(id)), id);
			}
			const p = realPlayer(data, row);
			const c = classify(p.ratings, {
				norms: realNorms(DEFAULT_NORMS, false),
				pos: p.pos,
				age: p.age,
				stats: p.stats,
			});
			if (ok.map(mergedId).includes(c.id)) {
				listed++;
			}
			const pr = promisesOf(archetypeById(c.id)!);
			if (
				spec
					.split("|")
					.some((alt) =>
						alt
							.split("+")
							.every((t) =>
								t.startsWith("L:")
									? pr.lead.includes(t.slice(2))
									: pr.all.includes(t),
							),
					)
			) {
				role++;
			}
		}
		assert.ok(GOLD.length >= 100, `${GOLD.length}`);
		// Floors a little under the tuned rates (metrics.script.test.ts): see docs/native-features.md for why they are not
		// higher
		assert.ok(
			role / GOLD.length >= GOLD_ROLE_FLOOR,
			`role ${role}/${GOLD.length}`,
		);
		assert.ok(
			listed / GOLD.length >= GOLD_LISTED_FLOOR,
			`listed ${listed}/${GOLD.length}`,
		);
	});

	test("stats: weight grows with minutes, none without; usage and assists read as creating", () => {
		const st = {
			min: 2000,
			fga: 1200,
			tpa: 500,
			fta: 300,
			astp: 40,
			orbp: 2,
			drbp: 12,
			blkp: 0.5,
			stlp: 2,
			usgp: 32,
		};
		assert.strictEqual(statReading(st, "PG")!.w, STATS_W + STATS_W_MORE * 0.2);
		// (arch14: a bigger sample, up to STATS_W_MORE more)
		assert.strictEqual(
			statReading({ ...st, min: 5000 }, "PG")!.w,
			STATS_W + STATS_W_MORE,
		);
		assert.strictEqual(statReading({ ...st, min: 1000 }, "PG")!.w, STATS_W);
		assert.ok(
			Math.abs(statReading({ ...st, min: 500 }, "PG")!.w - STATS_W / 2) < 1e-9,
		);
		assert.strictEqual(statReading({ ...st, min: 0 }, "PG"), undefined);
		assert.strictEqual(statReading(undefined, "PG"), undefined);
		const r = statReading(st, "PG")!;
		assert.ok(r.z.drb! > 1, `${r.z.drb}`);
		const offBall = statReading({ ...st, astp: 5, usgp: 12 }, "PG")!;
		assert.ok(offBall.z.drb! < -1, `${offBall.z.drb}`);
	});

	test("age: a veteran who lost speed and bounce keeps the build his skills say", async () => {
		const lg = (await league()).filter((p) => p.age >= 24 && p.age <= 29);
		let kept = 0;
		let keptNoAge = 0;
		const sample = lg.slice(0, 400);
		for (const p of sample) {
			const ps = positionOf(p.ratings);
			const base = classify(p.ratings, { pos: ps, age: p.age }).id;
			// Five years on: athleticism down, skills where they were
			const old = { ...p.ratings };
			for (const k of ["spd", "jmp", "endu"] as const) {
				old[k] = Math.max(0, old[k] - 12);
			}
			if (classify(old, { pos: ps, age: 35 }).id === base) {
				kept++;
			}
			if (classify(old, { pos: ps }).id === base) {
				keptNoAge++;
			}
		}
		assert.ok(kept > keptNoAge, `${kept} vs ${keptNoAge}`);
		assert.ok(kept / sample.length > 0.6, `${kept}/${sample.length}`);
	}, 120000);

	test("prospects read against prospect tables spread across builds", async () => {
		const pros = await sampleLeague(800, "prospects-spread", 0, 40);
		const counts: Record<string, number> = {};
		for (const p of pros) {
			const id = classify(p.ratings, {
				pos: positionFor(p.ratings, true),
				prospect: true,
			}).id;
			counts[id] = (counts[id] ?? 0) + 1;
		}
		const max = Math.max(...Object.values(counts)) / pros.length;
		// (arch15: 201 builds, a merged build holds all its profiles' players)
		assert.ok(max < 0.09, `max share ${max}`);
	}, 120000);

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
				ARCHETYPES.filter(
					(a) =>
						!a.tags.includes("universal") && archetypePrior(a, ps) !== null,
				).map((a) => a.group),
			);
			assert.ok(groups.size >= 2, ps);
		}
		for (const a of ARCHETYPES) {
			if (a.tags.includes("universal")) {
				continue;
			}
			for (const ps of HARD_BLOCK[a.group]) {
				assert.strictEqual(archetypePrior(a, ps), null, a.id + ps);
			}
		}
		for (const ps of ["PG", "G", "SG"] as const) {
			assert.strictEqual(posPrior("big", undefined, ps), null);
		}
		assert.strictEqual(posPrior("guard", undefined, "C"), null);
	});

	test("zero hard position mismatches over a generated league, true, fuzzed and with small-league norms", async () => {
		const lg = await league();
		const small = buildNorms(
			lg.slice(0, 400),
			SCORING_ARCHETYPES,
			DEFAULT_NORMS,
		);
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
				if (
					!c.tags.includes("universal") &&
					HARD_BLOCK[c.group].includes(shownPos)
				) {
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
		// Builds are read relative to his own level, so a uniform +4 mostly keeps the build
		assert.ok(same / lg.length > 0.85, `${same}/${lg.length}`);
	}, 120000);

	// Hand-made players everyone would label the same way: the build must feature that skill and allow his position
	const FIXTURES: [string, Partial<ArchetypeRatings>, string][] = [
		["classic PG", { hgt: 25, pss: 85, drb: 80, oiq: 75, spd: 70 }, "pass"],
		["sharpshooter", { hgt: 35, tp: 85, ft: 80, fg: 65 }, "shoot"],
		["slasher", { hgt: 35, spd: 80, jmp: 80, dnk: 80, tp: 30 }, "finish"],
		[
			"lockdown defender",
			{ hgt: 38, diq: 85, spd: 75, stre: 55, ins: 35, dnk: 35, fg: 40 },
			"perD",
		],
		[
			"stretch 5",
			{ hgt: 72, tp: 75, ft: 72, ins: 45, reb: 50, jmp: 40, diq: 40 },
			"shoot",
		],
		[
			"rim protector",
			{ hgt: 70, jmp: 70, diq: 80, stre: 60, ins: 35, fg: 30, tp: 20, ft: 40 },
			"rimD",
		],
		[
			"glass cleaner",
			{ hgt: 68, reb: 85, stre: 75, tp: 20, fg: 30, ins: 40 },
			"reb",
		],
	];
	for (const [label, o, skill] of FIXTURES) {
		test(`fixture: ${label}`, () => {
			const r = R(o);
			const c = classify(r);
			const a = archetypeById(c.id)!;
			assert.ok(
				(coverOf(a)[skill] ?? 0) > 0,
				`${label} (${positionOf(r)}) -> ${c.id}`,
			);
			assert.ok(a.positions.includes(positionOf(r)), c.id);
		});
	}
});

describe("name promises (arch14)", () => {
	test("a build's holders keep what its name promises", async () => {
		const by: Record<string, { n: number; worst: number[] }> = {};
		for (const p of (await league()).slice(0, 2000)) {
			const pos = positionFor(p.ratings, true);
			const c = classify(p.ratings, { pos, age: p.age });
			const { cv } = scoreAll(
				p.ratings,
				DEFAULT_NORMS,
				ARCHETYPES,
				pos,
				undefined,
				{
					age: p.age,
				},
			);
			const checks = Object.values(promiseChecks(archetypeById(c.id)!, cv));
			const b = (by[c.id] ??= { n: 0, worst: [] });
			b.n++;
			b.worst.push(checks.every(Boolean) ? 1 : 0);
		}
		let kept = 0;
		let n = 0;
		for (const [id, b] of Object.entries(by)) {
			const share = b.worst.reduce((a, x) => a + x, 0) / b.n;
			kept += share * b.n;
			n += b.n;
			if (b.n >= 15) {
				assert.ok(share >= 0.7, `${id} ${share} (${b.n})`);
			}
		}
		assert.ok(kept / n >= 0.93, `${kept / n}`);
	}, 120000);

	test("catch-all builds earn their breadth: a Versatile Scorer scores at all three levels and creates", async () => {
		let n = 0;
		let ok = 0;
		const players = (await league()).slice(0, 2000);
		for (const p of players) {
			const pos = positionFor(p.ratings, true);
			const c = classify(p.ratings, { pos, age: p.age });
			if (c.id !== "versatile-scorer") {
				continue;
			}
			const t = scoreTerms(
				p.ratings,
				DEFAULT_NORMS,
				ARCHETYPES,
				pos,
				undefined,
				{
					age: p.age,
				},
			);
			n++;
			if (catchAllShortfall(archetypeById(c.id)!, t.p, t.cv) < 0.05) {
				ok++;
			}
		}
		assert.ok(n === 0 || ok / n >= 0.9, `${ok}/${n}`);
		assert.ok(n / players.length <= 0.01, `${n}`);
	}, 120000);
});

describe("distribution over a generated league", () => {
	test("no archetype dominates, nearly all are used, and it is not just position", async () => {
		const lg = await league();
		const counts: Record<string, number> = {};
		for (const p of lg) {
			const c = classify(p.ratings, { ovr: p.ovr });
			counts[c.id] = (counts[c.id] ?? 0) + 1;
		}
		const max = Math.max(...Object.values(counts)) / lg.length;
		// (arch10: a little more room, the custom post-scoring and rebounding builds cover crowded profiles)
		assert.ok(max < 0.05, `max share ${max}`);
		const used = Object.keys(counts).length;
		assert.ok(
			used >= ARCHETYPES.length * 0.85,
			`used ${used}/${ARCHETYPES.length}`,
		);
	}, 120000);
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
		const pickable = ARCHETYPES.filter(
			(a) => !a.rare && !a.trait && !a.expanded,
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
					(archetypePrior(a, ps) ?? -9) > -1,
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

describe("positions are a hard gate", () => {
	test("every archetype lists its 2K positions; the name agrees and the group allows them", () => {
		for (const a of ARCHETYPES) {
			assert.ok(a.positions.length > 0, a.id);
			assert.strictEqual(new Set(a.positions).size, a.positions.length, a.id);
			for (const ps of a.positions) {
				assert.ok(POSITIONS.includes(ps), a.id);
				// (arch15: the name he is shown at that position)
				assert.ok(
					!nameContradictsPosition(nameAt(a, ps), ps),
					`${nameAt(a, ps)} at ${ps}`,
				);
				assert.ok(!HARD_BLOCK[a.group].includes(ps), `${a.name} at ${ps}`);
			}
		}
		// Every position keeps a real choice of builds
		for (const ps of POSITIONS) {
			const here = ARCHETYPES.filter((a) => a.positions.includes(ps));
			assert.ok(here.length >= 45, `${ps} ${here.length}`);
			assert.ok(new Set(here.map((a) => a.family)).size >= 7, ps);
		}
	});

	test("what a name says about position", () => {
		assert.deepStrictEqual(namePositions("Lockdown Guard"), ["PG", "G", "SG"]);
		assert.deepStrictEqual(namePositions("Backup Point Guard"), ["PG", "G"]);
		assert.deepStrictEqual(namePositions("Point of Attack Defender"), null);
		assert.deepStrictEqual(namePositions("Point Forward"), [
			"GF",
			"SF",
			"F",
			"PF",
		]);
		assert.deepStrictEqual(namePositions("Two-Way Point Forward"), [
			"GF",
			"SF",
			"F",
			"PF",
		]);
		assert.deepStrictEqual(namePositions("Point Center"), ["FC", "C"]);
		assert.deepStrictEqual(namePositions("Switchable Center"), ["FC", "C"]);
		assert.deepStrictEqual(namePositions("Stretch Five"), ["FC", "C"]);
		assert.deepStrictEqual(namePositions("Switchable Big"), ["PF", "FC", "C"]);
		assert.deepStrictEqual(namePositions("Big Guard"), ["PG", "G", "SG"]);
		assert.deepStrictEqual(namePositions("Versatile Big Wing"), [
			"SG",
			"GF",
			"SF",
			"F",
		]);
		assert.deepStrictEqual(namePositions("Stretch Four"), ["F", "PF", "FC"]);
		assert.deepStrictEqual(namePositions("Switchable Forward"), [
			"SF",
			"F",
			"PF",
			"FC",
		]);
		assert.strictEqual(namePositions("Glue Guy"), null);
		assert.strictEqual(positionWordOf("Point Forward"), "forward");
		assert.strictEqual(positionWordOf("Stretch Four"), "forward");
		assert.strictEqual(positionWordOf("Rim Protector"), null);
		assert.deepStrictEqual(namePositions("Point Four"), ["F", "PF", "FC"]);
		assert.strictEqual(namePositions("Big Glide"), null);
		assert.strictEqual(namePositions("Big Smooth"), null);
		assert.ok(nameContradictsPosition("Switchable Center", "PF"));
		assert.ok(!nameContradictsPosition("Switchable Big", "PF"));
	});

	test("over a generated league at every position: the build passes the gate and the name fits", async () => {
		const lg = (await league()).slice(0, 1500);
		let n = 0;
		for (const p of lg) {
			const own = positionFor(p.ratings, true);
			// His own position, and every other one he could be listed at (custom positions, an old league's)
			for (const ps of [own, ...POSITIONS.filter((x) => x !== own)].slice(
				0,
				n % 3 === 0 ? POSITIONS.length : 1,
			)) {
				n++;
				const c = classify(p.ratings, { pos: ps });
				const a = archetypeById(c.id)!;
				assert.ok(a.positions.includes(ps), `${ps} ${c.label}`);
				assert.ok(!nameContradictsPosition(c.name, ps), `${ps} ${c.label}`);
				// A previous label his position no longer allows is never kept, however sticky
				const blocked = ARCHETYPES.find((x) => !x.positions.includes(ps))!;
				const again = classify(p.ratings, {
					pos: ps,
					previousId: blocked.id,
					stickiness: 99,
				});
				assert.ok(archetypeById(again.id)!.positions.includes(ps), ps);
			}
		}
	}, 120000);

	test("stored entries: unknown ids, labels his position no longer allows, old hybrid partners", () => {
		const center = ARCHETYPES.find(
			(a) => a.positions.includes("C") && !a.positions.includes("PG"),
		)!;
		const guard = ARCHETYPES.find(
			(a) => a.positions.includes("PG") && !a.positions.includes("C"),
		)!;
		// A hybrid partner stored by an older version is ignored
		assert.strictEqual(
			viewOf({ season: 2025, id: center.id, secondary: guard.id }, "C")?.label,
			center.name,
		);
		// A build his position does not allow is no view at all: the caller reads him live until the next preseason
		assert.strictEqual(viewOf({ season: 2025, id: center.id }, "PG"), null);
		// A removed archetype (the old non-2K labels)
		assert.strictEqual(viewOf({ season: 2025, id: "no-such-archetype" }), null);
		assert.strictEqual(viewOf({ season: 2025, id: "journeyman-guard" }), null);
		// Old ids that are 2K builds are kept
		assert.strictEqual(
			viewOf({ season: 2025, id: "walking-bucket" })?.name,
			"Walking Bucket",
		);
	});
});

describe("storage helpers", () => {
	const c = classify(R({ hgt: 25, pss: 85, drb: 80, oiq: 78 }), { ovr: 55 });
	test("toStored / viewOf round trip and history", () => {
		const e = toStored(2025, c);
		assert.strictEqual(viewOf(e)?.id, c.id);
		const list = withEntry(withEntry(undefined, e), {
			...e,
			season: 2027,
			id: "walking-bucket",
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
		const slasher = ARCHETYPES.find(
			(a) => a.group === "wing" && a.family === "slasher",
		)!;
		const same = Array.from({ length: 10 }, (_, i) => ({
			pid: i,
			ovr: 60 - i,
			archetypeId: slasher.id,
		}));
		const comp = compositionOf(same);
		const kinds = comp.warnings.map((w) => w.kind);
		assert.ok(
			kinds.includes("playmaking") &&
				kinds.includes("size") &&
				kinds.includes("duplicates"),
		);
		const pick = (f: (a: (typeof ARCHETYPES)[number]) => boolean) =>
			ARCHETYPES.find(f)!.id;
		const ok = compositionOf(
			[
				pick((a) => a.group === "guard" && a.family === "playmaker"),
				pick((a) => a.group === "guard" && a.family === "shooter"),
				pick((a) => a.group === "wing" && a.family === "defender"),
				pick((a) => a.group === "forward" && a.family === "shooter"),
				pick((a) => a.group === "big" && a.family === "defender"),
				pick((a) => a.group === "big" && a.family === "rebounder"),
				pick((a) => a.group === "wing" && a.family === "slasher"),
				pick((a) => a.group === "wing" && a.family === "scorer"),
				pick((a) => a.group === "forward" && a.family === "athlete"),
			].map((id, i) => ({ pid: i, ovr: 70 - i, archetypeId: id })),
		);
		assert.deepStrictEqual(ok.warnings, []);
		assert.strictEqual(compositionOf([]).warnings.length, 0);
	});
});

// Gold set floors (see the gold set test)
const GOLD_ROLE_FLOOR = 0.6;
const GOLD_LISTED_FLOOR = 0.4;

// [Basketball-Reference slug, season, the build he gets]: real ratings from data/, read as a real-players league reads him
// (the position the game shows, his age and the previous season's stats)
// (arch15: re-pinned with sub-ratings, merged builds and the fitted model: LeBron, Giannis, Durant, Draymond, Klay, Capela,
// Korver, Westbrook and Luka changed)
const PINNED: [string, number, string][] = [
	["curryst01", 2025, "deep-range-sniper"], // Stephen Curry
	["jamesle01", 2025, "mid-paint-point-four"], // LeBron James
	["jokicni01", 2025, "post-dimming-board-enforcer"], // Nikola Jokić
	["goberru01", 2025, "backline-power-finisher"], // Rudy Gobert
	["antetgi01", 2025, "crashing-mid-paint-scorer"], // Giannis Antetokounmpo
	["duranke01", 2025, "crafty-mid-paint-scorer"], // Kevin Durant
	["paulch01", 2025, "ball-hawking-3-and-d-point"], // Chris Paul
	["greendr01", 2025, "shot-erasing-board-enforcer"], // Draymond Green
	["thompkl01", 2025, "catch-and-shoot-3pt-sniper"], // Klay Thompson
	["embiijo01", 2025, "slashing-mid-range-maestro"], // Joel Embiid
	["lopezbr01", 2025, "backline-pick-and-popper"], // Brook Lopez
	["capelca01", 2025, "physical-defensive-rebounder"], // Clint Capela
	["korveky01", 2021, "deep-range-sniper"], // Kyle Korver
	["westbru01", 2025, "board-hunting-middy-slasher"], // Russell Westbrook
	["wembavi01", 2025, "shot-erasing-mid-paint-maestro"], // Victor Wembanyama
	["doncilu01", 2025, "diming-3-level-scorer"], // Luka Dončić (arch13: his three fixed, 53 -> 71)
	["bridgmi01", 2025, "crafty-mid-post-scorer"], // Mikal Bridges
	["adamsst01", 2025, "physical-board-enforcer"], // Steven Adams
	["allento01", 2018, "ball-hawking-mid-paint-scorer"], // Tony Allen
	["drumman01", 2025, "paint-scoring-crasher"], // Andre Drummond
];
