// AI draft decision (draftDecision.ts): best player available dominates the top of the draft, needs and fit decide near ties later,
// every factor is bounded, and the Why is derived from the factors that actually moved the pick.
import { assert, describe, test } from "vitest";
import {
	BEST_AVAILABLE_REASON,
	FACTOR_WEIGHTS,
	adjustmentCap,
	decideDraft,
	explainPick,
	pickScale,
	type ProspectFacts,
	type TeamDraftContext,
} from "./draftDecision.ts";

const prospect = (
	pid: number,
	value: number,
	pos: string,
	extra: Partial<ProspectFacts> = {},
): ProspectFacts => ({
	pid,
	value,
	age: 20,
	ovr: 45,
	pot: 58,
	pos,
	skills: [],
	...extra,
});

const team = (extra: Partial<TeamDraftContext> = {}): TeamDraftContext => ({
	tid: 0,
	needs: { G: 0, F: 0, C: 0 },
	groupCounts: { G: 5, F: 5, C: 3 },
	youngCore: { G: 0, F: 0, C: 0 },
	teamSkills: { "3": 2, B: 2, Ps: 2, Di: 2, Dp: 2, R: 2, Po: 2, A: 2 },
	rosterSize: 13,
	maxRosterSize: 15,
	...extra,
});

const best = (decisions: ReturnType<typeof decideDraft>) =>
	decisions.reduce((a, b) => (b.score > a.score ? b : a));

describe("AI draft decision", () => {
	test("pick scale and cap: best available at the top, needs matter more later", () => {
		assert.closeTo(pickScale(1, 30), 0.3, 1e-9);
		assert.closeTo(pickScale(19, 30), 1, 1e-9);
		assert.strictEqual(pickScale(40, 30), 1.15);
		assert.closeTo(adjustmentCap(1, 30), 1.2, 1e-9);
		assert.closeTo(adjustmentCap(31, 30), 3.5, 1e-9);
	});

	test("a need never beats a clear value gap at No. 1, but breaks a near tie late", () => {
		const needsBig = team({
			needs: { G: -0.3, F: 0, C: 0.4 },
			groupCounts: { G: 6, F: 5, C: 1 },
		});
		const pool = [prospect(1, 64, "PG"), prospect(2, 62.5, "C")];
		const top = decideDraft({ pool, team: needsBig, overall: 1, numTeams: 30 });
		assert.strictEqual(best(top).facts.pid, 1);
		assert.include(
			explainPick({ decisions: top, chosenPid: 1, team: needsBig }),
			BEST_AVAILABLE_REASON,
		);

		const late = decideDraft({
			pool: [prospect(1, 50, "PG"), prospect(2, 49, "C")],
			team: needsBig,
			overall: 25,
			numTeams: 30,
		});
		assert.strictEqual(best(late).facts.pid, 2);
		const why = explainPick({ decisions: late, chosenPid: 2, team: needsBig });
		assert.include(why, "Fills a need at big (only one big under contract)");
		assert.notInclude(why, BEST_AVAILABLE_REASON);
	});

	test("every adjustment stays within the cap, and the parts add up to it", () => {
		const t = team({
			needs: { G: 0.5, F: -0.5, C: 0.5 },
			strategy: "rebuilding",
			gm: {
				traits: {
					patience: 1,
					analytics: 1,
					risk: 1,
					taxTolerance: 0,
					pickValue: 0,
					tradeFreq: 0,
					loyalty: 0,
					faStars: 0,
					draftBPA: -1,
					draftUpside: 1,
				},
				draftNeedScale: 1.75,
				draftUpside: 0.06,
			},
			financeStyle: "development",
		});
		const pool = [
			prospect(1, 55, "C", {
				age: 18,
				pot: 75,
				production: 1.5,
				athletic: 99,
				combinePerf: 0.75,
				spread: 2,
				skills: ["Di", "R"],
				stashable: true,
			}),
			prospect(2, 55, "SF", { medicalRisk: 3, production: -1.5 }),
		];
		for (const overall of [1, 15, 45]) {
			for (const d of decideDraft({ pool, team: t, overall, numTeams: 30 })) {
				const cap = adjustmentCap(overall, 30);
				assert.isAtMost(Math.abs(d.adj), cap + 1e-9);
				const sum = Object.values(d.parts).reduce((a, b) => a + b!, 0);
				assert.closeTo(sum, d.adj, 1e-9);
			}
		}
	});

	test("contenders want the floor, rebuilders the ceiling", () => {
		const pool = [
			prospect(1, 50, "SF", { age: 23, ovr: 50, pot: 54 }),
			prospect(2, 50, "SF", { age: 19, ovr: 40, pot: 60 }),
		];
		const contender = team({ strategy: "contending" });
		const rebuilder = team({ strategy: "rebuilding" });
		const c = decideDraft({ pool, team: contender, overall: 20, numTeams: 30 });
		const r = decideDraft({ pool, team: rebuilder, overall: 20, numTeams: 30 });
		assert.strictEqual(best(c).facts.pid, 1);
		assert.strictEqual(best(r).facts.pid, 2);
		assert.include(
			explainPick({ decisions: c, chosenPid: 1, team: contender }),
			"Contender: ready to play now",
		);
		assert.isTrue(
			explainPick({ decisions: r, chosenPid: 2, team: rebuilder }).some(
				(line) => line.includes("ceiling"),
			),
		);
	});

	test("medical risk, stash, scheme fit, production and the analytics GM show up in the Why", () => {
		const analyticsGm = {
			traits: {
				patience: 0,
				analytics: 0.8,
				risk: -0.5,
				taxTolerance: 0,
				pickValue: 0,
				tradeFreq: 0,
				loyalty: 0,
				faStars: 0,
				draftBPA: 0,
				draftUpside: 0,
			},
			draftNeedScale: 1,
			draftUpside: 0,
		};
		const t = team({
			gm: analyticsGm,
			strategy: "contending",
			rosterSize: 15,
			system: {
				off: "paceSpace",
				def: "switch",
				offName: "Pace & Space",
				defName: "Switch Everything",
			},
		});
		const pool = [
			prospect(1, 50, "SF", { medicalRisk: 3 }),
			prospect(2, 49.6, "SG", {
				production: 1,
				prodModelRank: 3,
				stashable: true,
				schemeFit: { off: { paceSpace: 2 }, def: { switch: 1 } },
			}),
		];
		const decisions = decideDraft({ pool, team: t, overall: 22, numTeams: 30 });
		assert.strictEqual(best(decisions).facts.pid, 2);
		const why = explainPick({ decisions, chosenPid: 2, team: t });
		assert.isAtMost(why.length, 4);
		assert.strictEqual(new Set(why).size, why.length);
		assert.include(why, "Their GM loves analytics: production model #3");
		assert.include(why, "Draft-and-stash: no roster spot");
		assert.include(why, "Passed on a prospect with medical concerns");

		// Taking the flagged player anyway says so
		const risky = explainPick({ decisions, chosenPid: 1, team: t });
		assert.include(risky, BEST_AVAILABLE_REASON);
		assert.include(risky, "Medical flag lowered him, they took the risk");
	});

	test("the Why only lists factors that favored the pick, never hidden numbers", () => {
		const t = team({
			needs: { G: 0.4, F: 0, C: -0.3 },
			strategy: "rebuilding",
		});
		const pool = Array.from({ length: 20 }, (_, i) =>
			prospect(i, 60 - i * 0.4, ["PG", "SF", "C", "PF"][i % 4]!, {
				age: 19 + (i % 4),
				pot: 50 + (i % 7) * 3,
				athletic: (i * 37) % 100,
			}),
		);
		const decisions = decideDraft({ pool, team: t, overall: 12, numTeams: 30 });
		for (const d of decisions.slice(0, 8)) {
			const why = explainPick({ decisions, chosenPid: d.facts.pid, team: t });
			assert.isAtLeast(why.length, 1);
			assert.isAtMost(why.length, 4);
			for (const line of why) {
				// Board ranks ("No. 3", "#3") are public; no ratings or value points
				assert.notMatch(line.replace(/(No\. |#)\d+/g, ""), /\d/);
			}
		}
		assert.isAbove(FACTOR_WEIGHTS.needMax, 0);
	});
});
