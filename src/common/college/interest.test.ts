import { assert, describe, test } from "vitest";
import { makeSeededRandom } from "../random.ts";
import {
	ACTIONS,
	COMMIT_THRESHOLD,
	MAX_INTEREST,
	PITCHES,
	actionGain,
	addInterest,
	bestPitch,
	commitLead,
	fit,
	genPrefs,
	nilBudget,
	pickCommit,
	playingTimeGrade,
	proximityGrade,
	shouldDecommit,
	weeklyBudget,
	weeklyUpdate,
	type Grades,
	type Prefs,
} from "./interest.ts";
import { homeState, sameDivision, schoolState } from "./geography.ts";

const grades = (value: number, overrides: Partial<Grades> = {}): Grades => ({
	pt: value,
	prestige: value,
	proximity: value,
	coach: value,
	winning: value,
	nil: value,
	...overrides,
});

const flat: Prefs = {
	pt: 1 / 6,
	prestige: 1 / 6,
	proximity: 1 / 6,
	coach: 1 / 6,
	winning: 1 / 6,
	nil: 1 / 6,
};

describe("recruiting interest model", () => {
	test("preferences add up to 1 and vary", () => {
		const random = makeSeededRandom(3);
		const tops = new Set<string>();
		for (let i = 0; i < 200; i++) {
			const prefs = genPrefs(random);
			const sum = PITCHES.reduce((a, key) => a + prefs[key], 0);
			assert.approximately(sum, 1, 0.01);
			for (const key of PITCHES) {
				assert.isAtLeast(prefs[key], 0);
			}
			tops.add(bestPitch(prefs, grades(1)));
		}
		assert.strictEqual(
			tops.size,
			PITCHES.length,
			"every pitch is someone's top want",
		);
	});

	test("fit is the weighted grade", () => {
		assert.approximately(fit(flat, grades(0.5)), 0.5, 1e-9);
		const prefs: Prefs = {
			...flat,
			pt: 1,
			prestige: 0,
			proximity: 0,
			coach: 0,
			winning: 0,
			nil: 0,
		};
		assert.approximately(fit(prefs, grades(0, { pt: 0.8 })), 0.8, 1e-9);
	});

	test("the right pitch is worth much more than the wrong one", () => {
		const prefs: Prefs = {
			pt: 0.6,
			prestige: 0.1,
			proximity: 0.1,
			coach: 0.1,
			winning: 0.05,
			nil: 0.05,
		};
		const g = grades(0.5, { pt: 1 });
		const right = actionGain("homeVisit", prefs, g, "pt");
		const wrong = actionGain("homeVisit", prefs, g, "nil");
		assert.isAbove(right, 2.5 * wrong);
		// Visits are worth more than contacts, scouting adds nothing, offers ignore the pitch
		assert.isAbove(
			actionGain("officialVisit", prefs, g, "pt"),
			actionGain("homeVisit", prefs, g, "pt"),
		);
		assert.isAbove(
			actionGain("homeVisit", prefs, g, "pt"),
			actionGain("contact", prefs, g, "pt"),
		);
		assert.strictEqual(actionGain("scout", prefs, g, "pt"), 0);
		assert.strictEqual(
			actionGain("offer", prefs, g, "pt"),
			actionGain("offer", prefs, g),
		);
		// A school that fits him better gains more from the same action
		assert.isAbove(
			actionGain("contact", flat, grades(0.9)),
			actionGain("contact", flat, grades(0.1)),
		);
		for (const action of Object.keys(ACTIONS)) {
			assert.isAtLeast(ACTIONS[action as keyof typeof ACTIONS].cost, 0);
		}
	});

	test("interest saturates, decays when idle and grows from fit", () => {
		assert.isBelow(addInterest(MAX_INTEREST - 1, 1000), MAX_INTEREST + 1e-9);
		assert.isAbove(addInterest(10, 10), addInterest(300, 10) - 300 + 10 - 1e-9);
		const idle = weeklyUpdate(100, { active: false, fitValue: 0 });
		const active = weeklyUpdate(100, { active: true, fitValue: 0 });
		assert.isBelow(idle, 100);
		assert.strictEqual(active, 100);
		assert.isAbove(
			weeklyUpdate(50, { active: true, fitValue: 1 }),
			weeklyUpdate(50, { active: true, fitValue: 0.2 }),
		);
		// Over a season of weekly home visits a well-fitting school passes the threshold; an idle one fades
		let worked = 0;
		let idleSchool = 40;
		for (let week = 0; week < 12; week++) {
			worked = addInterest(
				worked,
				actionGain("homeVisit", flat, grades(0.7), "pt"),
			);
			worked = weeklyUpdate(worked, { active: true, fitValue: 0.7 });
			idleSchool = weeklyUpdate(idleSchool, { active: false, fitValue: 0.3 });
		}
		assert.isAbove(worked, COMMIT_THRESHOLD);
		assert.isBelow(idleSchool, 25);
	});

	test("commitments", () => {
		const spot = () => true;
		// Below the threshold, or no offer: no commitment
		assert.isUndefined(
			pickCommit([{ tid: 1, i: COMMIT_THRESHOLD - 1, o: true }], spot),
		);
		assert.isUndefined(pickCommit([{ tid: 1, i: 90 }], spot));
		// Leader with an offer, far enough ahead
		assert.strictEqual(
			pickCommit(
				[
					{ tid: 2, i: 60, o: true },
					{ tid: 1, i: 90, o: true },
				],
				spot,
			),
			1,
		);
		// Too close: not yet, but later in the year a small lead is enough
		const close = [
			{ tid: 1, i: 90, o: true },
			{ tid: 2, i: 84, o: true },
		];
		assert.isUndefined(pickCommit(close, spot, 0));
		assert.strictEqual(pickCommit(close, spot, 20), 1);
		assert.isAbove(commitLead(0), commitLead(10));
		// No spot left
		assert.isUndefined(pickCommit([{ tid: 1, i: 90, o: true }], () => false));
	});

	test("decommitments", () => {
		assert.isFalse(
			shouldDecommit(
				[
					{ tid: 1, i: 80, o: true },
					{ tid: 2, i: 100, o: true },
				],
				1,
			),
		);
		assert.isTrue(
			shouldDecommit(
				[
					{ tid: 1, i: 50, o: true },
					{ tid: 2, i: 100, o: true },
				],
				1,
			),
		);
		// His school pulled the offer
		assert.isTrue(shouldDecommit([{ tid: 1, i: 80 }], 1));
		// Another school without an offer does not count
		assert.isFalse(
			shouldDecommit(
				[
					{ tid: 1, i: 50, o: true },
					{ tid: 2, i: 100 },
				],
				1,
			),
		);
	});

	test("budgets and grades", () => {
		assert.isAbove(weeklyBudget(95), weeklyBudget(50));
		assert.isAbove(weeklyBudget(70, 0.9), weeklyBudget(70, 0.1));
		assert.isAbove(nilBudget(95), nilBudget(45));
		assert.isAtLeast(nilBudget(35), 20);
		assert.strictEqual(playingTimeGrade(0), 1);
		assert.strictEqual(playingTimeGrade(10), 0);
		assert.strictEqual(proximityGrade("Ohio", "Ohio", true, false), 1);
		assert.isAbove(
			proximityGrade("Ohio", "Indiana", true, false),
			proximityGrade("Ohio", "Texas", false, false),
		);
	});

	test("geography", () => {
		assert.strictEqual(schoolState("Ohio State"), "Ohio");
		assert.strictEqual(schoolState("West Virginia"), "West Virginia");
		assert.strictEqual(schoolState("Arkansas"), "Arkansas");
		assert.strictEqual(schoolState("Duke"), "North Carolina");
		assert.strictEqual(homeState("Ohio, USA"), "Ohio");
		assert.isUndefined(homeState("France"));
		assert.isTrue(sameDivision("Ohio", "Indiana"));
		assert.isFalse(sameDivision("Ohio", "Texas"));
	});
});
