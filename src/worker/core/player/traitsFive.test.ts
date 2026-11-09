// Work ethic, aging curve (secret), big-game, ego and temper: determinism, no rating inflation, secrecy of the aging curve, and the sim hooks.
import { afterEach, assert, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { g, helpers } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { player, team } from "../index.ts";
import customizePlayer from "../../views/customizePlayer.ts";
import playerView from "../../views/player.ts";
import playerTraitsView from "../../views/playerTraits.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { last, range } from "../../../common/utils.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	AGING_CURVE_INFO,
	AGING_CURVE_SHARES,
	AI_TRAIT_WEIGHTS,
	TRAIT_KEYS,
	agingCurveDelta,
	agingCurveForPlayer,
	centerDevelopment,
	completeTraitSeeds,
	egoTradeRequestMoodShift,
	egoTradeRequestProbMult,
	generateTraitSeeds,
	lockerRoomMood,
	traitEffects,
	NEUTRAL_SCORES,
	type AgingCurve,
	type TraitScores,
} from "../../../common/playerTraits/index.ts";
import { getTraitSeeds } from "./traits.ts";
import moodComponents from "./moodComponents.ts";

const NEW_KEYS = ["workEthic", "bigGame", "ego", "temper"] as const;

const AGING_WORDS = [
	"agingCurve",
	"aging curve",
	"Aging curve",
	...Object.values(AGING_CURVE_INFO).map((info) => info.name),
	"bloomer",
	"gracefully",
];

const assertNoAgingCurve = (x: unknown, what: string) => {
	const json = JSON.stringify(x);
	for (const word of AGING_WORDS) {
		assert.notInclude(json, word, `${what} leaks the aging curve (${word})`);
	}
};

const loadView = (view: any, inputs: any) =>
	view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: undefined,
		prevOutput: undefined,
	});

afterEach(() => {
	resetG();
});

describe("seeds", () => {
	test("new traits have deterministic seeds, and are backfilled into older stored traits without moving the others", () => {
		const a = generateTraitSeeds(77, 5);
		const b = generateTraitSeeds(77, 5);
		assert.deepStrictEqual(a, b);
		for (const key of NEW_KEYS) {
			assert.isNumber(a[`${key}Seed`]);
		}
		// An existing league's player with only the old seeds stored
		const old: any = { ...a, clutchSeed: 2.5 };
		for (const key of NEW_KEYS) {
			delete old[`${key}Seed`];
		}
		const complete = completeTraitSeeds(old, 77, 5);
		assert.strictEqual(complete.clutchSeed, 2.5);
		for (const key of NEW_KEYS) {
			assert.strictEqual(complete[`${key}Seed`], a[`${key}Seed`]);
		}
	});

	test("the aging curve is deterministic, has the documented shares and is never stored", () => {
		const counts: Record<AgingCurve, number> = {
			early: 0,
			late: 0,
			graceful: 0,
			normal: 0,
		};
		const N = 20000;
		for (let pid = 0; pid < N; pid++) {
			const curve = agingCurveForPlayer(3, pid);
			assert.strictEqual(curve, agingCurveForPlayer(3, pid));
			counts[curve] += 1;
		}
		for (const curve of Object.keys(counts) as AgingCurve[]) {
			assert.closeTo(counts[curve] / N, AGING_CURVE_SHARES[curve], 0.015);
		}
		// Not a trait key, not in stored seeds, not valued by the AI
		assert.notInclude(TRAIT_KEYS as readonly string[], "agingCurve");
		assertNoAgingCurve(generateTraitSeeds(3, 1), "stored seeds");
		assertNoAgingCurve(AI_TRAIT_WEIGHTS, "AI weights");
	});
});

describe("development (work ethic, aging curve)", () => {
	test("the aging curve is centered at every age", () => {
		for (let age = 18; age <= 42; age++) {
			let mean = 0;
			for (const curve of Object.keys(AGING_CURVE_SHARES) as AgingCurve[]) {
				mean += AGING_CURVE_SHARES[curve] * agingCurveDelta(curve, age);
			}
			assert.closeTo(mean, 0, 1e-9, `age ${age}`);
		}
		// Early bloomers grow faster young and decline sooner, late bloomers the opposite, graceful agers decline slower
		assert.isAbove(agingCurveDelta("early", 20), agingCurveDelta("late", 20));
		assert.isBelow(agingCurveDelta("early", 28), agingCurveDelta("late", 28));
		assert.isAbove(
			agingCurveDelta("graceful", 33),
			agingCurveDelta("normal", 33),
		);
	});

	test("development plans are centered on the league", () => {
		const rows = range(300).map((i) => ({
			pid: i,
			age: 19 + (i % 18),
			workEthicZ: Math.sin(i) * 0.8 + 0.1,
			agingDelta: agingCurveDelta(agingCurveForPlayer(9, i), 19 + (i % 18)),
		}));
		const plans = centerDevelopment(rows);
		// dropScale is linear in the centered z, so its mean is exactly neutral
		let dropMean = 0;
		for (const plan of plans.values()) {
			dropMean += plan.dropScale;
		}
		assert.closeTo(dropMean / plans.size, 1, 1e-9);
	});

	test("no rating inflation, and gym rats develop more than lazy players", async () => {
		resetG();
		g.setWithoutSavingToDB("playerTraits", true);
		g.setWithoutSavingToDB("playerTraitsSeed", 11);
		const season = g.get("season");
		const original = Math.random;
		try {
			Math.random = makeSeededRandom(42);
			const players: any[] = range(1500).map((i) => {
				const age = 19 + (i % 17);
				const p: any = player.generate(
					PLAYER.FREE_AGENT,
					age,
					season - age + 19,
					false,
					DEFAULT_LEVEL,
				);
				p.pid = i;
				player.initTraits(p);
				return p;
			});
			const plans = player.getTraitDevelopment(players, season + 1);
			assert.strictEqual(plans.size, players.length);

			// Same random numbers with and without the traits: the difference is the traits alone
			const run = async (withTraits: boolean) => {
				Math.random = makeSeededRandom(7);
				const changes: number[] = [];
				for (const p0 of players) {
					const p = helpers.deepCopy(p0);
					const before = (last(p.ratings) as any).ovr as number;
					player.addRatingsRow(p, DEFAULT_LEVEL);
					await player.develop(
						p,
						1,
						false,
						DEFAULT_LEVEL,
						true,
						undefined,
						withTraits ? plans.get(p.pid) : undefined,
					);
					changes.push((last(p.ratings) as any).ovr - before);
				}
				return changes;
			};
			const off = await run(false);
			const on = await run(true);
			const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
			assert.closeTo(mean(on), mean(off), 0.15);

			// Work ethic, young players: top third vs bottom third
			const byWorkEthic = players
				.map((p, i) => ({
					i,
					age: season + 1 - p.born.year,
					score: player.getPlayerTraitScores(p).workEthic,
				}))
				.filter((x) => x.age <= 24)
				.sort((a, b) => a.score - b.score);
			const third = Math.floor(byWorkEthic.length / 3);
			const diff = (x: typeof byWorkEthic) =>
				mean(x.map(({ i }) => on[i]! - off[i]!));
			assert.isAbove(
				diff(byWorkEthic.slice(-third)),
				diff(byWorkEthic.slice(0, third)) + 0.3,
			);
		} finally {
			Math.random = original;
		}
	});

	test("nothing with the setting off", () => {
		resetG();
		g.setWithoutSavingToDB("playerTraits", false);
		const p: any = {
			...player.generate(PLAYER.FREE_AGENT, 22, 2025, false, DEFAULT_LEVEL),
			pid: 1,
		};
		assert.strictEqual(player.getTraitDevelopment([p], 2026).size, 0);
		assert.strictEqual(player.getLockerRoomMood(p, [p]), 0);
		assert.deepStrictEqual(player.getEgoTradeRequestInfo(p), {
			moodShift: 0,
			probMult: 1,
		});
	});
});

describe("ego", () => {
	test("locker room mood and trade requests", () => {
		assert.strictEqual(lockerRoomMood([]), 0);
		assert.strictEqual(lockerRoomMood([50, 50, 50]), 0);
		assert.isAbove(lockerRoomMood([80, 75]), 0);
		assert.isBelow(lockerRoomMood([20, 25]), 0);
		assert.isAtLeast(lockerRoomMood(range(15).map(() => 0)), -2.5);
		// Divas ask for trades sooner and more often
		assert.isAbove(egoTradeRequestMoodShift(10), 0);
		assert.isAbove(egoTradeRequestProbMult(10), 1);
		assert.isBelow(egoTradeRequestProbMult(90), 1);
		assert.strictEqual(egoTradeRequestProbMult(50), 1);
	});

	test("a teammate's ego shows up in the Locker room mood component, not his own", async () => {
		resetG();
		g.setWithoutSavingToDB("playerTraits", true);
		g.setWithoutSavingToDB("playerTraitsSeed", 3);
		idb.league = mockIDBLeague();
		const mk = (pid: number, egoSeed: number) => {
			const p: any = player.generate(0, 26, 2020, false, DEFAULT_LEVEL);
			p.pid = pid;
			player.initTraits(p);
			p.traits.egoSeed = egoSeed;
			return p;
		};
		const teams = helpers.getTeamsDefault().slice(0, 2).map(team.generate);
		const lockerRoom = async (myEgo: number, teammatesEgo: number) => {
			const players = [mk(0, myEgo), mk(1, teammatesEgo), mk(2, teammatesEgo)];
			await resetCache({
				players,
				teams,
				teamSeasons: teams.map((t) => team.genSeasonRow(t)),
			});
			const components = await moodComponents(players[0], 0);
			return components.lockerRoom;
		};
		// Divas around a team-first player hurt his mood, and the other way around
		assert.isBelow(await lockerRoom(3, -3), -0.5);
		assert.isAbove(await lockerRoom(-3, 3), 0.3);
		// His own ego doesn't count
		assert.closeTo(await lockerRoom(-3, 0), 0, 1e-9);
	});
});

describe("sim hooks", () => {
	const scores = (over: Partial<TraitScores>): TraitScores => ({
		...NEUTRAL_SCORES,
		...over,
	});

	test("big-game and temper effects are neutral at 50 and have the right sign", () => {
		const neutral = traitEffects(NEUTRAL_SCORES);
		assert.strictEqual(neutral.bigGameShotDelta, 0);
		assert.strictEqual(neutral.bigGameTurnoverMult, 1);
		assert.strictEqual(neutral.techProneness, 1);
		const riser = traitEffects(scores({ bigGame: 90 }));
		assert.isAbove(riser.bigGameShotDelta, 0);
		assert.isAbove(riser.bigGameFtDelta, 0);
		assert.isBelow(riser.bigGameTurnoverMult, 1);
		const hothead = traitEffects(scores({ temper: 10 }));
		assert.isAbove(hothead.techProneness, 1);
		assert.isAbove(hothead.flagrantProneness, 1);
		const sit = { scoreDiff: 1, timeLeft: 60, period: 4 };
		assert.isBelow(hothead.clutchShotModifier(sit), 0);
		assert.isAbove(hothead.clutchTurnoverMult(sit), 1);
		// Temper does nothing early in games
		assert.strictEqual(
			hothead.clutchShotModifier({ scoreDiff: 1, timeLeft: 600, period: 2 }),
			0,
		);
	});
});

describe("aging curve secrecy", () => {
	const setup = async (tid: number) => {
		resetG();
		g.setWithoutSavingToDB("playerTraits", true);
		g.setWithoutSavingToDB("playerTraitsSeed", 21);
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		idb.league = mockIDBLeague();
		const p: any = {
			...player.generate(
				tid === PLAYER.RETIRED ? PLAYER.FREE_AGENT : tid,
				tid === PLAYER.UNDRAFTED ? 19 : 33,
				tid === PLAYER.UNDRAFTED ? g.get("season") : 2010,
				false,
				DEFAULT_LEVEL,
			),
			pid: 0,
		};
		p.tid = tid;
		if (tid === PLAYER.RETIRED) {
			p.retiredYear = g.get("season");
		}
		player.initTraits(p);
		player.updateValues(p);
		const teams = helpers.getTeamsDefault().slice(0, 2).map(team.generate);
		await resetCache({
			players: [p],
			teams,
			teamSeasons: teams.map((t) => team.genSeasonRow(t)),
		});
		return p;
	};

	for (const [label, tid] of [
		["active player", 0],
		["free agent", PLAYER.FREE_AGENT],
		["draft prospect", PLAYER.UNDRAFTED],
	] as const) {
		test(`never shown for a ${label}, not even in God Mode`, async () => {
			for (const godMode of [false, true]) {
				const p = await setup(tid);
				g.setWithoutSavingToDB("godMode", godMode);
				assertNoAgingCurve(p, "stored player");
				assertNoAgingCurve(
					player.getPlayerTraitsForUI(p, { includeExact: true }),
					"getPlayerTraitsForUI",
				);
				const traitsPage = await loadView(playerTraitsView, { pid: 0 });
				assert.isDefined(traitsPage.playerTraits);
				assertNoAgingCurve(traitsPage, "Traits page");
				assertNoAgingCurve(
					await loadView(playerView, { pid: 0, season: undefined }),
					"player page",
				);
				assertNoAgingCurve(
					await loadView(customizePlayer, { pid: 0, type: undefined }),
					"Customize Player",
				);
			}
		});
	}

	test("revealed on the Traits page once he retires", async () => {
		const p = await setup(PLAYER.RETIRED);
		const curve = agingCurveForPlayer(21, 0);
		const traitsPage = await loadView(playerTraitsView, { pid: 0 });
		assert.strictEqual(traitsPage.playerTraits.agingCurve.curve, curve);
		assert.strictEqual(
			traitsPage.playerTraits.agingCurve.name,
			AGING_CURVE_INFO[curve].name,
		);
		// Still nothing stored on the player
		assertNoAgingCurve(p, "stored player");
		assertNoAgingCurve(getTraitSeeds(p), "seeds");
	});
});
