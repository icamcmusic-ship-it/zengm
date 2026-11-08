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
	SKILL_COMBOS,
	badgeScore,
	badgeTitle,
	getDisplayBadges,
	getSkillBadges,
	capDisplayItems,
	MAX_VISIBLE_BADGES,
	orderDisplayItems,
	visibleOriginalSkills,
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
		assert.isAtLeast(labels.length, 29);
		const comboLabels = SKILL_COMBOS.map((d) => d.label);
		assert.strictEqual(
			new Set([...labels, ...comboLabels]).size,
			labels.length + comboLabels.length,
		);
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
		// No negative badges: a terrible player gets none
		const bad = {
			...base,
			hgt: 10,
			stre: 10,
			spd: 10,
			jmp: 10,
			diq: 5,
			ft: 10,
		};
		assert.deepStrictEqual(getSkillBadges(bad), []);
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

	test("7 cap and toggle helper", () => {
		const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
		const collapsed = capDisplayItems(items, false);
		assert.strictEqual(collapsed.shown.length, MAX_VISIBLE_BADGES);
		assert.strictEqual(MAX_VISIBLE_BADGES, 7);
		assert.isTrue(collapsed.hasMore);
		const expanded = capDisplayItems(items, true);
		assert.deepStrictEqual(expanded.shown, items);
		assert.isTrue(expanded.hasMore);
		const few = capDisplayItems(items.slice(0, 7), false);
		assert.strictEqual(few.shown.length, 7);
		assert.isFalse(few.hasMore);
		// Priority order: combos, remaining originals, other badges
		assert.deepStrictEqual(
			orderDisplayItems(["Di", "Dp", "R"], ["Cs", "Sw"]).map((x) => x.token),
			["Sw", "R", "Cs"],
		);
	});

	test("Dp + Di collapse into Sw (display only)", () => {
		// Average ratings: no extended badges, so only the Dp + Di rule applies
		const tokens = getDisplayBadges(base, ["Di", "Dp"]);
		assert.deepStrictEqual(tokens, ["Sw"]);
		assert.deepStrictEqual(visibleOriginalSkills(["Di", "Dp", "R"], tokens), [
			"R",
		]);
		assert.deepStrictEqual(
			orderDisplayItems(["Di", "Dp", "R"], tokens).map((x) => x.token),
			["Sw", "R"],
		);
		// Only one of them: no combo, original stays
		assert.deepStrictEqual(getDisplayBadges(base, ["Di"]), []);
		assert.deepStrictEqual(visibleOriginalSkills(["Di"], []), ["Di"]);
		// Input skills are not mutated
		const skillsIn = ["Di", "Dp"];
		getDisplayBadges(base, skillsIn);
		assert.deepStrictEqual(skillsIn, ["Di", "Dp"]);
		// No tiers or suffixes: hover is just the name
		assert.strictEqual(badgeTitle("Sw"), "Switchable defender");
		assert.strictEqual(badgeTitle("Cs"), "Catch-and-shoot specialist");
		assert.strictEqual(badgeTitle("Dp"), "Perimeter defender");
	});

	test("greedy pass: largest combos first, each part used once, deterministic", () => {
		// Dp + Di + Bk: the 3-part Defensive anchor wins over Sw and Rp
		const big = { ...base, hgt: 75, jmp: 80 };
		const anchor = getDisplayBadges(big, ["Di", "Dp"]);
		assert.include(anchor, "Da");
		assert.notInclude(anchor, "Sw");
		assert.notInclude(anchor, "Rp");
		assert.notInclude(anchor, "Bk");
		assert.deepStrictEqual(getDisplayBadges({ ...big }, ["Di", "Dp"]), anchor);
		// Shooting family: 3 + FT (+ Cs) is a Sharpshooter, Cs is absorbed
		const shooter = { ...base, tp: 95, ft: 90, oiq: 80 };
		const sharp = getDisplayBadges(shooter, ["3"]);
		assert.include(sharp, "Sp");
		assert.notInclude(sharp, "Cs");
		assert.notInclude(sharp, "FT");
		assert.deepStrictEqual(visibleOriginalSkills(["3"], sharp), []);
		// Without the 3 skill, the badges stay as they are
		assert.include(getDisplayBadges(shooter, []), "Cs");
		// Ps + B: Floor general
		assert.deepStrictEqual(getDisplayBadges(base, ["B", "Ps"]), ["FG"]);
		// Glue guy needs any two of Hi, Gg, Hu, Cn
		const smart = { ...base, oiq: 85, diq: 85, pss: 70, reb: 70 };
		assert.include(getDisplayBadges(smart, []), "Gl");
		// Every displayed label is a known badge or combo, no "+N" or tier suffix
		for (const t of [...anchor, ...sharp]) {
			assert.match(t, /^[\dA-Za-z]+$/);
			assert.isTrue(
				!!SKILL_BADGES_BY_LABEL[t] || SKILL_COMBOS.some((c) => c.label === t),
			);
		}
		// Level 2 combos hide the parts of the level 1 combos they absorb
		const sc = SKILL_COMBOS.find((c) => c.label === "Sc")!;
		assert.strictEqual(sc.level, 2);
		assert.deepStrictEqual(visibleOriginalSkills(["3", "Po", "R"], ["Sc"]), [
			"R",
		]);
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
		const comboCounts: Record<string, number> = {};
		let n = 0;
		for (const p of players.filter((p) => p.tid >= PLAYER.FREE_AGENT)) {
			n += 1;
			const r = last(p.ratings) as any;
			for (const b of getSkillBadges(r)) {
				counts[b] = (counts[b] ?? 0) + 1;
			}
			for (const t of getDisplayBadges(r, r.skills)) {
				comboCounts[t] = (comboCounts[t] ?? 0) + 1;
			}
		}
		assert.isAbove(n, 300);
		const scale = n / 540;
		for (const def of SKILL_BADGES) {
			const count = (counts[def.label] ?? 0) / scale;
			assert.isAtLeast(count, 8, `${def.label} too rare: ${count}`);
			assert.isAtMost(count, 70, `${def.label} too common: ${count}`);
		}
		// Every combo shows up at most ~60 times
		for (const def of SKILL_COMBOS) {
			assert.isAtMost((comboCounts[def.label] ?? 0) / scale, 60, def.label);
		}
	}, 120000);
});
