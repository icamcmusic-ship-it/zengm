import { assert, describe, test } from "vitest";
import { COMPOSITE_WEIGHTS } from "../../../common/constants.ts";
import { compositeWeightsFor } from "../../../common/expandedRatings.ts";
import { skillCutoffs } from "../../../common/skillCutoffs.ts";
import { badgeComposite } from "../../../common/skillBadges/index.ts";
import { g, helpers } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import compositeRating from "./compositeRating.ts";
import skills, {
	fuzzedSkillRow,
	refreshSkills,
	skillsFromRow,
} from "./skills.ts";

const row = (over: Record<string, number> = {}) =>
	({
		hgt: 60,
		stre: 55,
		spd: 62,
		jmp: 58,
		endu: 50,
		ins: 52,
		dnk: 61,
		ft: 66,
		fg: 64,
		tp: 70,
		oiq: 59,
		diq: 57,
		drb: 68,
		pss: 63,
		reb: 54,
		fuzz: 4,
		ovr: 60,
		pot: 60,
		pos: "G",
		season: 2025,
		skills: [],
		...over,
	}) as any;

describe("skill cutoffs (one table for the labels and the sim's synergy)", () => {
	test("the sim's historical cutoffs", () => {
		// GameSim.basketball updateSynergy reads these: changing them changes game results of existing leagues
		const stock = {
			"3": 0.59,
			A: 0.63,
			B: 0.68,
			Di: 0.57,
			Dp: 0.61,
			Po: 0.61,
			Ps: 0.63,
			R: 0.61,
		};
		for (const flags of [
			{ expanded: false, simFixes: false },
			{ expanded: false, simFixes: true },
			{ expanded: true, simFixes: false },
		]) {
			const c = skillCutoffs(flags);
			for (const [label, cutoff] of Object.entries(stock)) {
				assert.strictEqual(c[label as keyof typeof c], cutoff, label);
			}
		}
		const c = skillCutoffs({ expanded: true, simFixes: true });
		assert.strictEqual(c.Di, 0.595);
		assert.strictEqual(c.Dp, 0.607);
		assert.strictEqual(c.R, 0.62);
		assert.strictEqual(c["3"], 0.59);
	});
});

describe("composite math parity", () => {
	test("badgeComposite equals player.compositeRating for every stock composite", () => {
		const r = row();
		for (const [key, { ratings, weights }] of Object.entries(
			compositeWeightsFor(COMPOSITE_WEIGHTS, false),
		)) {
			// badgeComposite only knows the constant 50
			if (ratings.some((c) => typeof c === "number" && c !== 50)) {
				continue;
			}
			assert.strictEqual(
				badgeComposite(r, {
					ratings: ratings as any,
					weights: weights ?? ratings.map(() => 1),
				}),
				compositeRating(r, ratings, weights, false),
				key,
			);
		}
	});
});

describe("skills", () => {
	test("stored skills don't depend on God Mode", () => {
		resetG();
		const r = row();
		g.setWithoutSavingToDB("godMode", false);
		const before = skills(r);
		g.setWithoutSavingToDB("godMode", true);
		const during = skills(r);
		g.setWithoutSavingToDB("godMode", false);
		assert.deepStrictEqual(during, before);
		// ...and are the skills of the fuzzed ratings
		assert.deepStrictEqual(
			before,
			skillsFromRow(fuzzedSkillRow(r, true), {
				expanded: false,
				simFixes: false,
				subRatingsSim: false,
			}),
		);
	});

	test("a label is exactly where synergy counts half a skill", () => {
		resetG();
		const flags = { expanded: false, simFixes: false, subRatingsSim: false };
		const cutoffs = skillCutoffs(flags);
		const r = row({ fuzz: 0 });
		const sk = skillsFromRow(r, flags);
		for (const [key, { ratings, weights, skill }] of Object.entries(
			COMPOSITE_WEIGHTS,
		)) {
			if (!skill || skill.label === "V") {
				continue;
			}
			const value = compositeRating(r, ratings, weights, false);
			const count = helpers.sigmoid(
				value,
				15,
				cutoffs[skill.label as keyof typeof cutoffs],
			);
			assert.strictEqual(sk.includes(skill.label), count > 0.5, key);
		}
	});

	test("refreshSkills mirrors to the draft copy", () => {
		resetG();
		const r = row();
		const p = { draft: { skills: ["X"] } };
		refreshSkills(p, r, false);
		assert.deepStrictEqual(p.draft.skills, ["X"]);
		refreshSkills(p, r, true);
		assert.deepStrictEqual(p.draft.skills, r.skills);
		assert.deepStrictEqual(r.skills, skills(r));
	});
});
