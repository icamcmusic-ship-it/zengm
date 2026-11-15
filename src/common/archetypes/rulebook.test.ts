// archrules: the judging rulebook (rulebook.data.ts) and the name promises (score.ts) are one set of rules
import { describe, expect, test } from "vitest";
import { ARCHETYPES } from "./classify.ts";
import { isGenericBuild } from "./generic.ts";
import { JUDGED } from "./judged.data.ts";
import { JUDGED_SIM } from "./judgedSim.data.ts";
import { RULES, WORD_RULES } from "./rulebook.data.ts";
import { buildRules, requiredClasses, ruleJudge } from "./rulebook.ts";
import { RULE_KEY } from "./ruleKey.data.ts";
import { promiseChecks, promisesOf } from "./score.ts";
import { CONCEPTS } from "./twoK/concepts.ts";

describe("archetype rulebook", () => {
	test("every word of the build vocabulary has a rule", () => {
		expect(Object.keys(RULES).sort()).toEqual(
			CONCEPTS.map((c) => c.key).sort(),
		);
	});

	test("a name promises exactly what the rulebook requires", () => {
		for (const a of ARCHETYPES) {
			expect([...promisesOf(a).all].sort(), a.name).toEqual(
				requiredClasses(a).sort(),
			);
			// (the elite-shot promise is the rulebook's sniper word)
			const checks = promiseChecks(a, {});
			expect("elite" in checks, a.name).toBe(buildRules(a).sniper);
			expect(buildRules(a).sniper, a.name).toBe(
				WORD_RULES.sniper.re.test(a.name),
			);
		}
	});

	test("the judge is deterministic and never falls back to a generic build", () => {
		const cv = {
			shoot: 1.2,
			mid: 0.2,
			finish: -0.3,
			post: -0.8,
			handle: 0.4,
			pass: 0.1,
			reb: -0.5,
			rimD: -0.6,
			perD: 0.9,
			ath: 0.3,
			stre: 0,
			def: 0.9,
			score: 1.2,
		};
		const builds = ARCHETYPES.filter((a) => a.positions.includes("SG"));
		const a = ruleJudge(builds, { cv });
		const b = ruleJudge([...builds].reverse(), { cv });
		expect(a).toEqual(b);
		expect(a.ids.length).toBeGreaterThanOrEqual(1);
		expect(a.ids.length).toBeLessThanOrEqual(3);
		const flat = Object.fromEntries(Object.keys(cv).map((k) => [k, -1.5]));
		const none = ruleJudge(builds, { cv: flat });
		expect(none.qualified).toBe(false);
		for (const id of none.ids) {
			expect(isGenericBuild({ id }), id).toBe(false);
		}
	});

	test("the rule key covers every judged player with 1-3 builds", () => {
		for (const j of [...JUDGED, ...JUDGED_SIM]) {
			const ids = RULE_KEY[j.key];
			expect(ids, j.key).toBeDefined();
			expect(ids!.length).toBeGreaterThanOrEqual(1);
			expect(ids!.length).toBeLessThanOrEqual(3);
		}
	});
});
