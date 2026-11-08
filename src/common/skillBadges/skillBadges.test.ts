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
	comboTier,
	describeBadge,
	getDisplayBadges,
	getSkillBadges,
	parseToken,
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
		assert.isAtLeast(labels.length, 30);
		const comboLabels = SKILL_COMBOS.map((d) => d.label);
		assert.strictEqual(
			new Set([...labels, ...comboLabels]).size,
			labels.length + comboLabels.length,
		);
		for (const def of SKILL_BADGES) {
			// Warning flags are told apart only by a lower-case label
			assert.strictEqual(
				def.label === def.label.toLowerCase(),
				!!def.flag,
				def.label,
			);
		}
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
		const bad = {
			...base,
			hgt: 10,
			stre: 10,
			spd: 10,
			jmp: 10,
			diq: 5,
			ft: 10,
		};
		assert.include(getSkillBadges(bad), "ld");
		assert.include(getSkillBadges(bad), "hk");
		const bigBrick = { ...base, hgt: 85, tp: 15, fg: 20, ft: 25 };
		assert.include(getSkillBadges(bigBrick), "pb");
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
		// Priority order: combos, originals, positives, flags
		assert.deepStrictEqual(
			orderDisplayItems(["Di", "Dp", "R"], ["hk", "Cs", "Sw+"]).map(
				(x) => x.token,
			),
			["Sw+", "R", "Cs", "hk"],
		);
	});

	test("Dp + Di collapse into Sw (display only)", () => {
		const r = { ...base, spd: 70, diq: 70 };
		const tokens = getDisplayBadges(r, ["Di", "Dp"]);
		const sw = tokens.find((t) => parseToken(t).label === "Sw");
		assert.isDefined(sw);
		assert.deepStrictEqual(visibleOriginalSkills(["Di", "Dp", "R"], tokens), [
			"R",
		]);
		// Only one of them: no combo, original stays
		const onlyDi = getDisplayBadges(r, ["Di"]);
		assert.isUndefined(onlyDi.find((t) => parseToken(t).label === "Sw"));
		assert.deepStrictEqual(visibleOriginalSkills(["Di"], onlyDi), ["Di"]);
		// Input skills are not mutated
		const skillsIn = ["Di", "Dp"];
		getDisplayBadges(r, skillsIn);
		assert.deepStrictEqual(skillsIn, ["Di", "Dp"]);
	});

	test("combos consume their components and take the first match", () => {
		const shooter = { ...base, tp: 95, ft: 90, oiq: 80 };
		const tokens = getDisplayBadges(shooter, ["3"]);
		const labels = tokens.map((t) => parseToken(t).label);
		assert.include(labels, "Es");
		assert.notInclude(labels, "Cs");
		assert.deepStrictEqual(visibleOriginalSkills(["3"], tokens), []);
		// Without the 3 skill, Cs stays as is
		assert.include(getDisplayBadges(shooter, []), "Cs");
		// Floor general
		const pg = { ...base, spd: 85, drb: 85, pss: 85, oiq: 80 };
		assert.include(
			getDisplayBadges(pg, ["B", "Ps"]).map((t) => parseToken(t).label),
			"FG",
		);
		// Combos first, then positives, then flags; no "+N" overflow token
		for (const t of getDisplayBadges(shooter, ["3"])) {
			assert.notMatch(t, /^\+\d/);
		}
	});

	test("combo tiers grow with the margin past the cutoff", () => {
		const weak = { ...base, hgt: 50, spd: 70, diq: 60, stre: 55 };
		const strong = { ...base, hgt: 85, spd: 90, diq: 95, stre: 80, jmp: 80 };
		assert.strictEqual(comboTier(weak, ["Dp", "Di"]), 1);
		assert.strictEqual(comboTier(strong, ["Dp", "Di"]), 3);
		const token = getDisplayBadges(strong, ["Di", "Dp"]).find(
			(t) => parseToken(t).label === "Sw",
		)!;
		assert.strictEqual(token, "Sw++");
		assert.deepStrictEqual(parseToken("Sw+"), { label: "Sw", tier: 2 });
		// Hover text is just the name, like the original skills
		assert.strictEqual(badgeTitle("Sw++"), "Switchable defender (Gold)");
		assert.strictEqual(badgeTitle("Cs"), "Catch-and-shoot specialist");
		assert.strictEqual(badgeTitle("hk"), "Hack-a target");
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
				const { label } = parseToken(t);
				comboCounts[label] = (comboCounts[label] ?? 0) + 1;
			}
		}
		assert.isAbove(n, 300);
		const scale = n / 540;
		for (const def of SKILL_BADGES) {
			const count = (counts[def.label] ?? 0) / scale;
			assert.isAtLeast(count, 8, `${def.label} too rare: ${count}`);
			assert.isAtMost(count, 70, `${def.label} too common: ${count}`);
		}
		// Sw (Dp + Di) is common enough to matter, every combo shows up at most ~60 times
		assert.isAtLeast((comboCounts.Sw ?? 0) / scale, 5);
		for (const def of SKILL_COMBOS) {
			assert.isAtMost((comboCounts[def.label] ?? 0) / scale, 60, def.label);
		}
	}, 120000);
});
