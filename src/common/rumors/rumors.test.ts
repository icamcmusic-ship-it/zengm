import { assert, describe, test } from "vitest";
import { makeSeededRandom } from "../random.ts";
import {
	accuracyByLevel,
	accuracyBySeason,
	accuracyByType,
	addToTally,
	calibrate,
	calibrationFactor,
	dailyRate,
	emptyRumorState,
	mixSeed,
	phaseBurst,
	poisson,
	posInDraftGroup,
	pruneRumors,
	rumorKey,
	takenKeys,
	tradeRumorUntil,
	typeWeights,
	weightedIndex,
	MAX_RUMORS,
	modelChance,
	type RumorClock,
} from "./logic.ts";
import { recalibrate } from "./calibration.ts";
import {
	parseRumorText,
	renderRumorText,
	rumorTemplates,
	tokCoach,
	tokGm,
	tokPlayer,
	tokTeam,
} from "./text.ts";
import {
	RUMOR_TYPES,
	RUMOR_TYPE_NAMES,
	rumorLevel,
	type Rumor,
} from "./types.ts";

const clock = (phase: number, extra: Partial<RumorClock> = {}): RumorClock => ({
	phase,
	seasonProgress: 0.3,
	tradeDeadline: 0.6,
	daysLeft: 30,
	...extra,
});

const rumor = (extra: Partial<Rumor> = {}): Rumor => ({
	rid: 0,
	type: "shopping",
	season: 2026,
	phase: 1,
	tick: 1,
	tids: [3],
	pids: [7],
	text: "x",
	confidence: 0.2,
	status: "open",
	until: { season: 2026, phase: 2 },
	...extra,
});

describe("Rumors: pure logic", () => {
	test("the seeded stream is reproducible and differs by day and seed", () => {
		const draw = (seed: number, tick: number) => {
			const random = makeSeededRandom(mixSeed(seed, tick, 1));
			return [random(), random(), random()];
		};
		assert.deepStrictEqual(draw(5, 10), draw(5, 10));
		assert.notDeepEqual(draw(5, 10), draw(5, 11));
		assert.notDeepEqual(draw(5, 10), draw(6, 10));
	});

	test("a few rumors a week in season, more near the deadline and early in free agency", () => {
		const season = dailyRate(clock(1));
		assert.isAbove(season * 7, 2);
		assert.isBelow(season * 7, 5);
		assert.isAbove(dailyRate(clock(1, { seasonProgress: 0.55 })), 2 * season);
		assert.isAbove(dailyRate(clock(8, { daysLeft: 28 })), 2 * season);
		assert.isAbove(
			dailyRate(clock(8, { daysLeft: 28 })),
			dailyRate(clock(8, { daysLeft: 5 })),
		);
		// No daily rumors in phases without days
		assert.strictEqual(dailyRate(clock(5)), 0);
		assert.isAbove(phaseBurst(4), 0);
		assert.isAbove(phaseBurst(8), 0);

		// The Poisson draw averages the rate
		const random = makeSeededRandom(1);
		let total = 0;
		for (let i = 0; i < 4000; i++) {
			total += poisson(1.5, random);
		}
		assert.closeTo(total / 4000, 1.5, 0.1);
		assert.strictEqual(poisson(0, random), 0);
	});

	test("only rumors that can still come true are made", () => {
		// No trade or extension rumors after the deadline or in the playoffs
		for (const phase of [2, 3]) {
			const w = typeWeights(clock(phase));
			assert.strictEqual(w.shopping, 0);
			assert.strictEqual(w.interest, 0);
			assert.strictEqual(w.pick, 0);
			assert.strictEqual(w.extension, 0);
		}
		// No coach or GM rumors early in the season, none in the offseason
		assert.strictEqual(typeWeights(clock(1, { seasonProgress: 0.1 })).coach, 0);
		assert.isAbove(typeWeights(clock(1, { seasonProgress: 0.5 })).coach, 0);
		assert.strictEqual(typeWeights(clock(8)).coach, 0);
		assert.isAbove(typeWeights(clock(8)).freeAgent, 0);
		assert.isAbove(typeWeights(clock(4)).draft, 0);
		assert.strictEqual(typeWeights(clock(6)).draft, 0);

		assert.deepStrictEqual(tradeRumorUntil(2026, 1, true), {
			season: 2026,
			phase: 2,
		});
		assert.deepStrictEqual(tradeRumorUntil(2026, 1, false), {
			season: 2026,
			phase: 3,
		});
		assert.deepStrictEqual(tradeRumorUntil(2026, 8, true), {
			season: 2027,
			phase: 1,
		});
		assert.deepStrictEqual(tradeRumorUntil(2026, 0, true), {
			season: 2026,
			phase: 1,
		});
	});

	test("weightedIndex follows the weights and handles nothing to pick", () => {
		const random = makeSeededRandom(3);
		const counts = [0, 0, 0];
		for (let i = 0; i < 3000; i++) {
			counts[weightedIndex([1, 0, 3], random)]! += 1;
		}
		assert.strictEqual(counts[1], 0);
		assert.closeTo(counts[2]! / counts[0]!, 3, 0.5);
		assert.strictEqual(weightedIndex([], random), -1);
		assert.strictEqual(weightedIndex([0, 0], random), -1);
	});

	test("track record: tallies, accuracy tables and the calibration correction", () => {
		const state = emptyRumorState(1);
		assert.strictEqual(calibrationFactor(state.stats, "shopping"), 1);
		// No track record: the model's chance from the calibration table
		const model = recalibrate("shopping", "request", 0.7);
		assert.strictEqual(
			calibrate(0.7, state.stats, "shopping", "request"),
			Math.round(model * 100) / 100,
		);

		// 40 shopping rumors at 30% (no raw score: the confidence is the model's chance) of which only 4 came true: later ones are
		// marked down, on the odds
		for (let i = 0; i < 40; i++) {
			addToTally(
				state.stats,
				rumor({ confidence: 0.3 }),
				i < 4 ? "confirmed" : "busted",
			);
		}
		assert.deepStrictEqual(state.stats[2026]!.shopping, [4, 36, 12, 12]);
		const factor = calibrationFactor(state.stats, "shopping");
		assert.closeTo(factor, (4 + 10) / (12 + 10), 1e-9);
		const odds = (model / (1 - model)) * factor;
		assert.closeTo(
			calibrate(0.7, state.stats, "shopping", "request"),
			odds / (1 + odds),
			0.005,
		);

		// With a raw score, the tally's last entry is the model's chance, not the shown confidence, so a correction that works doesn't
		// cancel itself out
		addToTally(
			state.stats,
			rumor({ season: 2025, kind: "request", raw: 0.7, confidence: 0.1 }),
			"busted",
		);
		assert.deepStrictEqual(state.stats[2025]!.shopping, [
			0,
			1,
			0.1,
			Math.round(
				modelChance({
					type: "shopping",
					kind: "request",
					raw: 0.7,
					confidence: 0.1,
				}) * 1000,
			) / 1000,
		]);
		// A tally from before the model's chances were recorded
		state.stats[2024] = { pick: [1, 1, 0.5] };
		addToTally(
			state.stats,
			rumor({ season: 2024, type: "pick", confidence: 0.2 }),
			"busted",
		);
		assert.deepStrictEqual(state.stats[2024].pick, [1, 2, 0.7, 0.7]);
		delete state.stats[2024];
		delete state.stats[2025];

		// Other types are untouched, and the correction is bounded
		assert.strictEqual(calibrationFactor(state.stats, "coach"), 1);
		for (let i = 0; i < 400; i++) {
			addToTally(
				state.stats,
				rumor({ type: "gm", confidence: 0.05 }),
				"confirmed",
			);
			addToTally(
				state.stats,
				rumor({ type: "coach", confidence: 0.9 }),
				"busted",
			);
		}
		assert.strictEqual(calibrationFactor(state.stats, "gm"), 2.5);
		assert.strictEqual(calibrationFactor(state.stats, "coach"), 0.25);
		assert.isAtMost(calibrate(0.9, state.stats, "gm"), 0.97);
		assert.isAtLeast(calibrate(0.001, state.stats, "coach"), 0.01);

		const bySeason = accuracyBySeason(state.stats);
		assert.strictEqual(bySeason.length, 1);
		assert.strictEqual(bySeason[0]!.confirmed, 404);
		const byType = accuracyByType(state.stats, RUMOR_TYPE_NAMES);
		assert.strictEqual(byType.length, RUMOR_TYPES.length);
		const shopping = byType.find((row) => row.key === "shopping")!;
		assert.closeTo(shopping.rate!, 0.1, 1e-9);
		assert.closeTo(shopping.expected!, 0.3, 1e-9);
		assert.strictEqual(
			byType.find((row) => row.key === "draft")!.rate,
			undefined,
		);

		const byLevel = accuracyByLevel([
			rumor({ confidence: 0.7, status: "confirmed" }),
			rumor({ confidence: 0.7, status: "busted" }),
			rumor({ confidence: 0.7, status: "open" }),
			rumor({ confidence: 0.05, status: "busted" }),
		]);
		assert.strictEqual(byLevel[0]!.confirmed + byLevel[0]!.busted, 2);
		assert.strictEqual(byLevel[0]!.rate, 0.5);
		assert.strictEqual(byLevel.at(-1)!.busted, 1);
		assert.strictEqual(rumorLevel(0.7).key, "strong");
		assert.strictEqual(rumorLevel(0.4).key, "solid");
		assert.strictEqual(rumorLevel(0.2).key, "speculative");
		assert.strictEqual(rumorLevel(0.01).key, "longShot");
	});

	test("rolling window: current and last season, capped, old seasons of the record dropped", () => {
		const state = emptyRumorState(1);
		for (let i = 0; i < MAX_RUMORS + 50; i++) {
			state.items.push(rumor({ rid: i, season: 2026 }));
		}
		state.items.unshift(rumor({ rid: -1, season: 2024 }));
		state.items.unshift(rumor({ rid: -2, season: 2025 }));
		state.stats[2000] = { shopping: [1, 1, 1] };
		state.stats[2026] = { shopping: [1, 1, 1] };
		pruneRumors(state, 2026);
		assert.strictEqual(state.items.length, MAX_RUMORS);
		assert(!state.items.some((r) => r.season === 2024));
		assert.strictEqual(state.items.at(-1)!.rid, MAX_RUMORS + 49);
		assert.strictEqual(state.stats[2000], undefined);
		assert.notStrictEqual(state.stats[2026], undefined);

		const small = emptyRumorState(1);
		small.items.push(rumor({ season: 2025 }), rumor({ season: 2024 }));
		pruneRumors(small, 2026);
		assert.deepStrictEqual(
			small.items.map((r) => r.season),
			[2025],
		);
	});

	test("the same rumor isn't repeated while open or right after it resolved", () => {
		const state = emptyRumorState(1);
		state.tick = 100;
		state.items.push(
			rumor({ pids: [1], status: "open", tick: 1 }),
			rumor({ pids: [2], status: "busted", tick: 95 }),
			rumor({ pids: [3], status: "busted", tick: 10 }),
			rumor({ type: "coach", cid: 4, status: "busted", tick: 10 }),
			rumor({
				type: "coach",
				cid: 5,
				status: "busted",
				tick: 10,
				season: 2025,
			}),
		);
		const keys = takenKeys(state, 2026);
		assert(keys.has(rumorKey(rumor({ pids: [1] }))));
		assert(keys.has(rumorKey(rumor({ pids: [2] }))));
		assert(!keys.has(rumorKey(rumor({ pids: [3] }))));
		assert(keys.has("coach|4"));
		assert(!keys.has("coach|5"));
		// Interest is per team and player
		assert.notStrictEqual(
			rumorKey(rumor({ type: "interest", tids: [1, 2], pids: [9] })),
			rumorKey(rumor({ type: "interest", tids: [3, 2], pids: [9] })),
		);
	});

	test("draft groups", () => {
		assert(posInDraftGroup("PG", "G"));
		assert(posInDraftGroup("GF", "G"));
		assert(posInDraftGroup("GF", "F"));
		assert(posInDraftGroup("PF", "F"));
		assert(posInDraftGroup("FC", "C"));
		assert(!posInDraftGroup("C", "G"));
		assert(!posInDraftGroup("SF", "C"));
	});
});

describe("Rumors: text", () => {
	test("tokens round trip to links and plain text", () => {
		const text = `The ${tokTeam(3)} have called the ${tokTeam(12)} about ${tokPlayer(77, "Bob {Jr}: Smith")}, says ${tokCoach(4, "Al Coach")} and ${tokGm(3, "Gee Em")}.`;
		const segments = parseRumorText(text);
		assert.deepStrictEqual(
			segments.filter((s) => s.type !== "text"),
			[
				{ type: "team", tid: 3 },
				{ type: "team", tid: 12 },
				{ type: "player", pid: 77, name: "Bob Jr Smith" },
				{ type: "coach", cid: 4, name: "Al Coach" },
				{ type: "gm", tid: 3, name: "Gee Em" },
			],
		);
		assert.strictEqual(
			renderRumorText(text, (tid) => `T${tid}`),
			"The T3 have called the T12 about Bob Jr Smith, says Al Coach and Gee Em.",
		);
		assert.strictEqual(
			renderRumorText(text, (tid) => `T${tid}`, {
				team: (tid, name) => `<${tid}:${name}>`,
				player: (pid, name) => `[${pid}:${name}]`,
			}),
			"The <3:T3> have called the <12:T12> about [77:Bob Jr Smith], says Al Coach and Gee Em.",
		);
	});

	test("every template of every type and kind is a complete sentence with no numbers but the draft year", () => {
		const kinds: Record<string, (string | undefined)[]> = {
			shopping: ["request", "dump", "deadline", "rebuild", "available"],
			interest: ["user", "request", "vet"],
			unhappy: [undefined, "holdout"],
			freeAgent: ["leaning", "finalists"],
		};
		for (const type of RUMOR_TYPES) {
			for (const kind of kinds[type] ?? [undefined]) {
				for (const confidence of [0.05, 0.3, 0.8]) {
					const templates = rumorTemplates({
						type,
						kind,
						confidence,
						t0: tokTeam(1),
						t1: tokTeam(2),
						p: tokPlayer(5, "Some Player"),
						who: tokCoach(6, "Some Coach"),
						year: 2027,
						group: "C",
					});
					assert.isAbove(templates.length, 0);
					for (const template of templates) {
						const plain = renderRumorText(template, (tid) => `Team${tid}`);
						assert.match(plain, /^[A-Z].*\.$/, plain);
						assert.notMatch(plain, /[{}]|undefined|NaN/, plain);
						assert.notMatch(
							plain.replaceAll(/Team\d/g, "").replace("2027", ""),
							/\d/,
							plain,
						);
						if (
							type !== "pick" &&
							type !== "draft" &&
							type !== "coach" &&
							type !== "gm"
						) {
							assert.include(plain, "Some Player");
						}
						assert.include(plain, "Team1");
					}
				}
			}
		}
	});
});
