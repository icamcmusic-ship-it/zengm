import { assert, beforeEach, describe, test } from "vitest";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { PHASE } from "../../../common/constants.ts";
import { DEFAULT_LEVEL, MAX_LEVEL } from "../../../common/budgetLevels.ts";
import {
	formatInjuryRange,
	gameTimeStatus,
	injuryEstimateRange,
	injuryGamesOut,
	injuryOutlookText,
	injurySpread,
} from "../../../common/injuryOutlook.ts";
import { injuryBodyPart } from "../../../common/injuryBodyPart.ts";
import { majorInjurySeverity, MAJOR_INJURIES } from "./careerAging.ts";
import {
	aiTreatment,
	applyInjuryCourse,
	applyTreatmentReturnWindow,
	COURSE_PROB,
	currentInjuryRecord,
	expectedReturnDay,
	finishInjuryRecord,
	gameTimeDecisionPlays,
	injuryCourseRoll,
	injuryRecordGames,
	isTreatmentInjury,
	scaleForTreatment,
} from "./injuryRecovery.ts";
import type { Player, PlayerInjury } from "../../../common/types.ts";

beforeEach(() => {
	resetG();
	g.setWithoutSavingToDB("season", 2025);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("injuryDepth", true);
});

const makePlayer = (pid: number, injury: PlayerInjury): Player =>
	({
		pid,
		tid: 0,
		injury,
		injuries: [
			{ season: 2025, games: injury.gamesRemaining, type: injury.type },
		],
	}) as any;

describe("injury records", () => {
	test("finishInjuryRecord stores the counted games missed on the matching record", () => {
		const p = makePlayer(1, {
			type: "Sprained Ankle",
			gamesRemaining: 0,
			gamesMissed: 6,
		});
		finishInjuryRecord(p);
		assert.strictEqual(p.injuries[0]!.missed, 6);
		assert.strictEqual(injuryRecordGames(p.injuries[0]!), 6);
	});

	test("no count (older injury) or another type: nothing stored", () => {
		const p = makePlayer(1, { type: "Sprained Ankle", gamesRemaining: 0 });
		finishInjuryRecord(p);
		assert.strictEqual(p.injuries[0]!.missed, undefined);
		assert.strictEqual(injuryRecordGames(p.injuries[0]!), 0);

		const p2 = makePlayer(2, {
			type: "Sprained Ankle",
			gamesRemaining: 0,
			gamesMissed: 3,
		});
		p2.injuries[0]!.type = "Bruised Knee";
		assert.strictEqual(currentInjuryRecord(p2), undefined);
		finishInjuryRecord(p2);
		assert.strictEqual(p2.injuries[0]!.missed, undefined);
	});
});

describe("injury outlook", () => {
	test("games out: one less for an injury from this game", () => {
		assert.strictEqual(injuryGamesOut({ gamesRemaining: 5 }), 5);
		assert.strictEqual(
			injuryGamesOut({ gamesRemaining: 5, newThisGame: true }),
			4,
		);
	});

	test("a bigger health budget narrows the estimate", () => {
		const low = injurySpread(1);
		const avg = injurySpread(DEFAULT_LEVEL);
		const high = injurySpread(MAX_LEVEL);
		assert.isAbove(low, avg);
		assert.isAbove(avg, high);
		const wide = injuryEstimateRange({ gamesRemaining: 20, spread: low })!;
		const narrow = injuryEstimateRange({ gamesRemaining: 20, spread: high })!;
		assert.isAbove(wide.hi - wide.lo, narrow.hi - narrow.lo);
		assert.isAtMost(wide.lo, 20);
		assert.isAtLeast(wide.hi, 20);
	});

	test("no spread: exact games, no status, no range", () => {
		assert.strictEqual(gameTimeStatus({ gamesRemaining: 1 }), undefined);
		assert.strictEqual(injuryEstimateRange({ gamesRemaining: 20 }), undefined);
		assert.strictEqual(injuryOutlookText({ gamesRemaining: 20 }), "20 games");
	});

	test("game-time statuses and ranges", () => {
		const spread = 0.3;
		assert.strictEqual(gameTimeStatus({ gamesRemaining: 1, spread }), "Q");
		assert.strictEqual(gameTimeStatus({ gamesRemaining: 2, spread }), "D");
		assert.strictEqual(gameTimeStatus({ gamesRemaining: 3, spread }), "O");
		assert.strictEqual(
			gameTimeStatus({ gamesRemaining: 4, spread }),
			undefined,
		);
		assert.strictEqual(
			injuryOutlookText({ gamesRemaining: 1, spread }),
			"Questionable",
		);
		assert.strictEqual(formatInjuryRange(4, 6), "4-6 games");
		assert.strictEqual(formatInjuryRange(7, 14), "2-4 weeks");
		assert.strictEqual(formatInjuryRange(50, 80), "3-6 months");
	});
});

describe("game-time decisions", () => {
	test("questionable plays about half the time, doubtful about a quarter, out never; the same inputs give the same call", () => {
		const count = (gamesRemaining: number) => {
			let n = 0;
			for (let pid = 0; pid < 4000; pid++) {
				const p = {
					pid,
					injury: { type: "Sprained Ankle", gamesRemaining, spread: 0.3 },
				};
				if (gameTimeDecisionPlays(p, 10, 2025, false)) {
					n += 1;
				}
			}
			return n / 4000;
		};
		assert.approximately(count(1), 0.5, 0.04);
		assert.approximately(count(2), 0.25, 0.04);
		assert.strictEqual(count(3), 0);
		assert.strictEqual(count(10), 0);

		const p = {
			pid: 5,
			injury: { type: "Sprained Ankle", gamesRemaining: 1, spread: 0.3 },
		};
		assert.strictEqual(
			gameTimeDecisionPlays(p, 10, 2025, false),
			gameTimeDecisionPlays(p, 10, 2025, false),
		);
	});
});

describe("setbacks and early returns", () => {
	test("rare, symmetric and recorded", () => {
		let setbacks = 0;
		let early = 0;
		let sum = 0;
		const n = 20000;
		for (let pid = 0; pid < n; pid++) {
			const p = makePlayer(pid, {
				type: "Torn Calf",
				gamesRemaining: 30,
				spread: 0.3,
				gamesMissed: 4,
			});
			const delta = injuryCourseRoll(p, 2025);
			if (delta > 0) {
				setbacks += 1;
			} else if (delta < 0) {
				early += 1;
			}
			sum += delta;
		}
		assert.approximately(setbacks / n, COURSE_PROB, 0.004);
		assert.approximately(early / n, COURSE_PROB, 0.004);
		// Mean-preserving: about 0 per day
		assert.approximately(sum / n, 0, 0.03);

		// Short injuries and injuries without an outlook never change
		const short = makePlayer(1, {
			type: "Sprained Ankle",
			gamesRemaining: 3,
			spread: 0.3,
		});
		const old = makePlayer(1, { type: "Torn Calf", gamesRemaining: 30 });
		for (let i = 0; i < 100; i++) {
			assert.strictEqual(injuryCourseRoll({ ...short, pid: i }, 2025), 0);
			assert.strictEqual(injuryCourseRoll({ ...old, pid: i }, 2025), 0);
		}

		// A setback is added to the injury and its record
		for (let pid = 0; pid < n; pid++) {
			const p = makePlayer(pid, {
				type: "Torn Calf",
				gamesRemaining: 30,
				spread: 0.3,
				gamesMissed: 4,
			});
			const delta = applyInjuryCourse(p, 2025);
			if (delta > 0) {
				assert.strictEqual(p.injury.gamesRemaining, 30 + delta);
				assert.strictEqual(p.injuries[0]!.games, 30 + delta);
				assert.strictEqual(p.injuries[0]!.setbacks, 1);
				break;
			}
		}
	});
});

describe("surgery vs rehab", () => {
	test("major injuries only, AI by strategy, durations and re-injury window", () => {
		assert.isTrue(isTreatmentInjury("Torn ACL", 80));
		assert.isFalse(isTreatmentInjury("Torn ACL", 5));
		assert.isFalse(isTreatmentInjury("Sprained Ankle", 30));
		assert.strictEqual(aiTreatment("contending"), "rehab");
		assert.strictEqual(aiTreatment("rebuilding"), "surgery");
		const surgery = scaleForTreatment(80, undefined, "surgery");
		const rehab = scaleForTreatment(80, undefined, "rehab");
		assert.isAbove(surgery, 80);
		assert.isBelow(rehab, 80);
		assert.strictEqual(scaleForTreatment(surgery, "surgery", "rehab"), rehab);

		const health = {
			restrict: 5,
			restrictTotal: 5,
			returnGames: 15,
			bodyPart: "Knee",
		};
		const p = { health: { ...health } };
		applyTreatmentReturnWindow(p, "surgery");
		assert.isBelow(p.health.returnGames, 15);
		const p2 = { health: { ...health } };
		applyTreatmentReturnWindow(p2, "rehab");
		assert.strictEqual(p2.health.returnGames, 15);
	});
});

describe("custom injury names", () => {
	test("major-injury severity falls back to keywords, body part and length", () => {
		for (const [type, sev] of Object.entries(MAJOR_INJURIES)) {
			assert.strictEqual(majorInjurySeverity(type, 10), sev);
		}
		assert.isDefined(majorInjurySeverity("Ruptured Patellar Tendon", 70));
		assert.isDefined(majorInjurySeverity("Broken Femur", 50));
		assert.isUndefined(majorInjurySeverity("Broken Femur", 5));
		assert.isUndefined(majorInjurySeverity("Broken Finger", 50));
		assert.isDefined(majorInjurySeverity("Mystery Knee Thing", 70));
		// Stock names not in the table stay minor
		assert.isUndefined(majorInjurySeverity("Sprained Ankle", 70));
	});

	test("body parts for synonyms", () => {
		assert.strictEqual(injuryBodyPart("Torn Quad"), "Leg");
		assert.strictEqual(injuryBodyPart("Broken Toes"), "Foot");
		assert.strictEqual(injuryBodyPart("Sore Lumbar"), "Back");
		assert.strictEqual(injuryBodyPart("Separated Clavicle"), "Shoulder");
	});
});

describe("expected return", () => {
	const schedule = [
		{ day: 1, homeTid: 0, awayTid: 1 },
		{ day: 2, homeTid: 2, awayTid: 3 },
		{ day: 3, homeTid: 1, awayTid: 0 },
		{ day: 4, homeTid: 0, awayTid: 2 },
		{ day: 6, homeTid: 3, awayTid: 0 },
	];

	test("countdown runs every day, he plays the first team game at 0", () => {
		// Out 2: misses days 1 and 2 (no game for his team on 2), back day 3
		assert.strictEqual(expectedReturnDay(schedule, 0, 2, 1), 3);
		assert.strictEqual(expectedReturnDay(schedule, 0, 3, 1), 4);
		assert.strictEqual(expectedReturnDay(schedule, 0, 4, 1), 6);
		assert.strictEqual(expectedReturnDay(schedule, 0, 5, 1), undefined);
	});

	test("realistic schedule length: only some days count down", () => {
		const day = expectedReturnDay(schedule, 0, 2, 0.5);
		assert.isTrue(day === undefined || day >= 3);
	});
});
