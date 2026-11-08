import { assert, describe, test } from "vitest";
import { PLAYER } from "../constants.ts";
import {
	MENTOR_MAX_BONUS,
	applyMentorBonus,
	mentorBonuses,
	proSeasonsPlayed,
	teamMentoring,
	veteranExperienceCurve,
	veteranSavvyBadgeScore,
} from "./veteran.ts";
import { traitScores } from "./scores.ts";
import { traitEffects, NEUTRAL_EFFECTS } from "./effects.ts";
import { NEUTRAL_SCORES } from "./scores.ts";
import { scoutTrait, traitUncertainty } from "./scouting.ts";

const row = (season: number, tid = 1, gp = 50, playoffs = false) => ({
	season,
	tid,
	gp,
	playoffs,
});

describe("veteran savvy", () => {
	test("experience curve grows and plateaus around 9 seasons", () => {
		assert.strictEqual(veteranExperienceCurve(0), 0);
		let prev = -1;
		for (let n = 0; n <= 9; n++) {
			const v = veteranExperienceCurve(n);
			assert.isAbove(v, prev);
			prev = v;
		}
		assert.strictEqual(veteranExperienceCurve(9), veteranExperienceCurve(15));
		// Early seasons count more than late ones
		assert.isAbove(
			veteranExperienceCurve(2) - veteranExperienceCurve(1),
			veteranExperienceCurve(8) - veteranExperienceCurve(7),
		);
	});

	test("pro seasons: pre-draft rows, playoffs, 0-gp and current season excluded", () => {
		const p = {
			draft: { year: 2020 },
			stats: [
				row(2019, PLAYER.DOES_NOT_EXIST),
				row(2020, PLAYER.DOES_NOT_EXIST),
				row(2021),
				row(2021, 1, 5, true),
				row(2022, 2, 0),
				row(2023),
				row(2023, 3),
				row(2025),
			],
		};
		assert.strictEqual(proSeasonsPlayed({ p, season: 2025 }), 2);
		assert.strictEqual(proSeasonsPlayed({ p, season: 2026 }), 3);
		// Rookie
		assert.strictEqual(
			proSeasonsPlayed({
				p: { draft: { year: 2025 }, stats: [row(2026)] },
				season: 2026,
			}),
			0,
		);
	});

	test("pro seasons before the league existed count as played", () => {
		const p = { draft: { year: 2015 }, stats: [row(2020)] };
		// 2016-2019 before startingSeason 2020, plus 2020
		assert.strictEqual(
			proSeasonsPlayed({ p, season: 2021, startingSeason: 2020 }),
			5,
		);
		// A row with 0 gp before the league start is respected
		const p2 = { draft: { year: 2015 }, stats: [row(2017, 1, 0)] };
		assert.strictEqual(
			proSeasonsPlayed({ p: p2, season: 2020, startingSeason: 2020 }),
			3,
		);
	});

	test("score grows with pro seasons, independent of years since draft", () => {
		const r = { oiq: 50, diq: 50, pss: 50 };
		const s = (proSeasons: number) =>
			traitScores(r, {}, { age: 27, experience: 4, proSeasons }).veteranSavvy;
		assert.isBelow(s(0), s(3));
		assert.isBelow(s(3), s(8));
		assert.isAtMost(Math.abs(s(10) - s(14)), 0);
		// Other traits do not read proSeasons
		const a = traitScores(r, {}, { age: 27, experience: 4, proSeasons: 0 });
		const b = traitScores(r, {}, { age: 27, experience: 4, proSeasons: 12 });
		assert.strictEqual(a.clutch, b.clutch);
		assert.strictEqual(a.leadership, b.leadership);
	});

	test("effects: neutral at 50, right direction, small", () => {
		const sit = { scoreDiff: 2, timeLeft: 60, period: 4 };
		const neutral = traitEffects({ ...NEUTRAL_SCORES });
		const vet = traitEffects({ ...NEUTRAL_SCORES, veteranSavvy: 90 });
		const green = traitEffects({ ...NEUTRAL_SCORES, veteranSavvy: 10 });
		assert.strictEqual(neutral.foulProneness, NEUTRAL_EFFECTS.foulProneness);
		assert.isAbove(vet.lateGameDecisionQuality(sit), 0);
		assert.isBelow(green.lateGameDecisionQuality(sit), 0);
		assert.isBelow(vet.clutchTurnoverMult(sit), 1);
		assert.isBelow(vet.pressureTurnoverMult(1), 1);
		assert.isAbove(vet.clutchShotModifier(sit), 0);
		assert.isBelow(vet.foulProneness, 1);
		assert.isAbove(vet.chemistryContribution, 0);
		assert.isAtMost(vet.lateGameDecisionQuality(sit), 0.04 + 1e-9);
		// Nothing outside late game
		assert.strictEqual(
			vet.lateGameDecisionQuality({ scoreDiff: 2, timeLeft: 600, period: 2 }),
			0,
		);
	});

	test("scouting: visible, exact once drafted, rookies' estimate is exact", () => {
		assert.strictEqual(
			traitUncertainty({
				key: "veteranSavvy",
				isProspect: false,
				experience: 0,
			}),
			0,
		);
		assert.isAbove(
			traitUncertainty({
				key: "veteranSavvy",
				isProspect: true,
				experience: 0,
			}),
			0,
		);
		const t = scoutTrait({
			key: "veteranSavvy",
			trueScore: 40,
			sd: 0,
			leagueSeed: 1,
			pid: 1,
		});
		assert.isTrue(t.exact);
	});

	test("mentoring: bounded, best mentors help most, centered over mentees", () => {
		assert.strictEqual(teamMentoring([]), 0);
		assert.strictEqual(teamMentoring([50, 55]), 0);
		assert.isAbove(teamMentoring([90]), teamMentoring([70]));
		assert.isAtMost(teamMentoring([100, 100, 100]), MENTOR_MAX_BONUS);
		const raw = new Map([
			[0, teamMentoring([95, 85])],
			[1, teamMentoring([70])],
			[2, 0],
		]);
		const mentees = new Map([
			[0, 3],
			[1, 2],
			[2, 4],
		]);
		const b = mentorBonuses(raw, mentees);
		let total = 0;
		for (const [tid, count] of mentees) {
			total += b.get(tid)! * count;
			assert.isAtMost(Math.abs(b.get(tid)!), MENTOR_MAX_BONUS);
		}
		assert.approximately(total, 0, 1e-9);
		assert.isAbove(b.get(0)!, b.get(1)!);
		assert.isBelow(b.get(2)!, 0);
	});

	test("applyMentorBonus: deterministic, expected value = bonus, height untouched", () => {
		const keys = ["hgt", "oiq", "diq"];
		const r = { hgt: 50, oiq: 50, diq: 100 };
		assert.isTrue(applyMentorBonus(r, 0.4, 0.3, keys));
		assert.deepStrictEqual(r, { hgt: 50, oiq: 51, diq: 100 });
		assert.isFalse(applyMentorBonus(r, 0.4, 0.5, keys));
		assert.isTrue(applyMentorBonus(r, -0.4, 0.1, keys));
		assert.deepStrictEqual(r, { hgt: 50, oiq: 50, diq: 99 });
		assert.isFalse(applyMentorBonus(r, 0, 0, keys));
	});

	test("badge score helper", () => {
		assert.strictEqual(veteranSavvyBadgeScore(50), 0);
		assert.strictEqual(veteranSavvyBadgeScore(75), 0.5);
		assert.strictEqual(veteranSavvyBadgeScore(100), 1);
	});
});
