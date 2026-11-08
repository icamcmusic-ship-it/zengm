import { assert, describe, test } from "vitest";
import { PLAYER } from "../constants.ts";
import { resetG } from "../../test/helpers.ts";
import createRandomPlayers from "../../worker/core/league/create/createRandomPlayers.ts";
import skills from "../../worker/core/player/skills.ts";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { last, range } from "../utils.ts";
import {
	SKILL_BADGES,
	SKILL_BADGES_BY_LABEL,
	badgeScore,
	describeBadge,
	getSkillBadges,
	selectBadgesForMode,
	sortBadges,
	type BadgeRatings,
} from "./index.ts";

const base: BadgeRatings = {
	hgt: 50,
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
};

describe("skill badges", () => {
	test("labels are unique and do not clash with original skills", () => {
		const labels = SKILL_BADGES.map((d) => d.label);
		assert.strictEqual(new Set(labels).size, labels.length);
		for (const original of ["3", "A", "B", "Di", "Dp", "Po", "Ps", "R", "V"]) {
			assert.isFalse(labels.includes(original), original);
		}
		assert.isAtLeast(labels.length, 14);
		for (const def of SKILL_BADGES) {
			assert.isAbove(def.meaning.length, 10);
			assert.isTrue(describeBadge(def.label).includes(def.name));
		}
	});

	test("deterministic and order stable", () => {
		const r = { ...base, tp: 95, ft: 90, oiq: 80 };
		assert.deepStrictEqual(getSkillBadges(r), getSkillBadges({ ...r }));
		assert.include(getSkillBadges(r), "Cs");
		assert.include(getSkillBadges(r), "FT");
	});

	test("handpicked archetypes", () => {
		const shooter = { ...base, tp: 95, ft: 90, oiq: 80 };
		assert.include(getSkillBadges(shooter), "Cs");
		const rim = { ...base, hgt: 95, jmp: 85, diq: 70 };
		assert.include(getSkillBadges(rim), "Bk");
		const bad = { ...base, hgt: 10, stre: 10, spd: 10, jmp: 10, diq: 5, ft: 10 };
		assert.include(getSkillBadges(bad), "Ld");
		assert.include(getSkillBadges(bad), "Hk");
		const bigBrick = { ...base, hgt: 85, tp: 15, fg: 20, ft: 25 };
		assert.include(getSkillBadges(bigBrick), "Pb");
		assert.isAbove(
			badgeScore(shooter, SKILL_BADGES_BY_LABEL.Cs!),
			badgeScore(base, SKILL_BADGES_BY_LABEL.Cs!),
		);
		// Average player has no badges besides possibly none
		assert.strictEqual(getSkillBadges(base).length, 0);
	});

	test("existing skills output is unchanged", () => {
		// Pinned outputs of the original skills() for fixed ratings
		assert.deepStrictEqual(skills({ ...base, fuzz: 0 } as any), []);
		assert.deepStrictEqual(
			skills({ ...base, tp: 95, ft: 90, oiq: 80, fuzz: 0 } as any),
			["3"],
		);
		assert.deepStrictEqual(
			skills({ ...base, hgt: 95, jmp: 85, diq: 70, reb: 80, fuzz: 0 } as any),
			["A", "Di", "Dp", "Po", "R"],
		);
		assert.deepStrictEqual(
			skills({ ...base, spd: 90, drb: 90, pss: 90, oiq: 85, fuzz: 0 } as any),
			["B", "Dp", "Ps"],
		);
	});

	test("selectBadgesForMode and sortBadges", () => {
		const all = ["Cs", "Pu", "Mr", "FT", "Fn"];
		assert.deepStrictEqual(selectBadgesForMode(all, "off").shown, []);
		assert.deepStrictEqual(selectBadgesForMode(all, "full").shown, all);
		const compact = selectBadgesForMode(all, "compact");
		assert.deepStrictEqual(compact.shown, ["Cs", "Pu", "Mr"]);
		assert.deepStrictEqual(compact.hidden, ["FT", "Fn"]);
		assert.deepStrictEqual(selectBadgesForMode(undefined, "full").shown, []);
		assert.deepStrictEqual(sortBadges(["Fn", "zzz", "Cs"]), ["Cs", "Fn"]);
	});

	test("league distribution is sensible", async () => {
		resetG();
		const players = await createRandomPlayers({
			activeTids: range(30),
			onlyFreeAgents: false,
			scoutingLevel: DEFAULT_LEVEL,
			teams: range(30).map((tid) => ({ tid })),
		});
		const counts: Record<string, number> = {};
		let n = 0;
		for (const p of players.filter((p) => p.tid >= PLAYER.FREE_AGENT)) {
			n += 1;
			for (const b of getSkillBadges(last(p.ratings) as any)) {
				counts[b] = (counts[b] ?? 0) + 1;
			}
		}
		assert.isAbove(n, 300);
		const scale = n / 540;
		for (const def of SKILL_BADGES) {
			const count = (counts[def.label] ?? 0) / scale;
			assert.isAtLeast(count, 8, `${def.label} too rare: ${count}`);
			assert.isAtMost(count, 70, `${def.label} too common: ${count}`);
		}
	}, 120000);
});
