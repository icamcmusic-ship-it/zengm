import { afterAll, assert, describe, test } from "vitest";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import {
	aiShotPlans,
	doubleTeamProb,
	driftMult,
	kneeAndFloor,
	onCourtShare,
	sagOf,
	scoringAbility,
	seasonDriftMults,
	shareEffect,
	SHOT_SHARE,
	shotPlanMult,
} from "./shotShare.ts";
import {
	ADV,
	newAdv,
	shotDiet,
	shotDietOfGame,
	shotDietText,
} from "../../../common/advStats.ts";
import { range } from "../../../common/utils.ts";

/*
 * Shot Share Model (the shotShareModel setting, shotShare.ts). Off: nothing changes (the fixed-seed box scores of
 * outcomeInvariance.test.ts, where it is off). On: the parts below, and league-wide shot shares calibrated by
 * shotShareCalibration.script.test.ts (see docs/native-features.md).
 */

afterAll(() => {
	resetG();
});

const shares = (w: number[]) => {
	const total = w.reduce((a, b) => a + b, 0);
	return w.map((x) => x / total);
};

describe("pure parts", () => {
	test("scoring ability runs from role player to star", () => {
		assert.strictEqual(scoringAbility(0.1), 0);
		assert.strictEqual(scoringAbility(0.6), 1);
		assert.isAbove(scoringAbility(0.4), scoringAbility(0.3));
	});

	test("lineup-relative knee: five scorers spread, a middling scorer among role players doesn't dominate", () => {
		const five = [1, 1, 1, 1, 1];
		kneeAndFloor(five, [1, 1, 1, 1, 1], 5);
		assert.deepEqual(five, [1, 1, 1, 1, 1]);

		// The same weights: a real star keeps more of his edge than a middling scorer
		const star = [4, 1, 1, 1, 1];
		const middling = [4, 1, 1, 1, 1];
		kneeAndFloor(star, [1, 0, 0, 0, 0], 5);
		kneeAndFloor(middling, [0.3, 0, 0, 0, 0], 5);
		assert.isAbove(shares(star)[0]!, shares(middling)[0]!);
		assert.isBelow(shares(star)[0]!, 0.5);
	});

	test("softer floor: lower for non-scorers", () => {
		const scorer = [10, 10, 10, 10, 0.01];
		const nonScorer = [10, 10, 10, 10, 0.01];
		kneeAndFloor(scorer, [0, 0, 0, 0, 1], 5);
		kneeAndFloor(nonScorer, [0, 0, 0, 0, 0], 5);
		assert.closeTo(shares(scorer)[4]!, 0.05 / 1.05, 0.002);
		assert.closeTo(
			shares(nonScorer)[4]!,
			(0.05 * SHOT_SHARE.floorMin) / (1 + 0.05 * SHOT_SHARE.floorMin),
			0.002,
		);
	});

	test("double teams only above the threshold, bounded", () => {
		assert.strictEqual(doubleTeamProb(0.25), 0);
		assert.strictEqual(doubleTeamProb(SHOT_SHARE.dblRef), 0);
		assert.isAbove(doubleTeamProb(SHOT_SHARE.dblRef + 0.03), 0);
		assert.strictEqual(doubleTeamProb(0.9), SHOT_SHARE.dblMax);
	});

	test("game plan multipliers", () => {
		assert.strictEqual(shotPlanMult(undefined), 1);
		assert.strictEqual(shotPlanMult(0), 1);
		assert.isAbove(shotPlanMult(1), 1);
		assert.isBelow(shotPlanMult(-1), 1);
	});

	test("AI game plans: more shots for a clear top scorer, fewer for non-scorers", () => {
		const players = [
			{ id: 1, valueNoPot: 70, usage: 0.5, injured: false },
			{ id: 2, valueNoPot: 65, usage: 0.35, injured: false },
			{ id: 3, valueNoPot: 60, usage: 0.3, injured: false },
			{ id: 4, valueNoPot: 55, usage: 0.18, injured: false },
			{ id: 5, valueNoPot: 40, usage: 0.1, injured: false },
		];
		const plans = aiShotPlans(players);
		assert.strictEqual(plans.get(1), 1);
		assert.isUndefined(plans.get(2));
		assert.strictEqual(plans.get(4), -1);
		// No clear top scorer: nobody gets more
		players[0]!.usage = 0.36;
		assert.isUndefined(aiShotPlans(players).get(1));
	});

	test("season drift: only a share far above his role, gently", () => {
		assert.strictEqual(driftMult(0.3, 0), 1);
		assert.strictEqual(driftMult(0.29 + SHOT_SHARE.driftTol, 0), 1);
		assert.isBelow(driftMult(0.36, 0), 1);
		assert.isAtLeast(driftMult(0.9, 0), SHOT_SHARE.driftMin);
		// The same share is far above the role of a 5th option
		assert.isBelow(driftMult(0.28, 4), driftMult(0.28, 0));
		assert.closeTo(onCourtShare(20, 35, 88, 240), (20 / 35) * (48 / 88), 1e-9);

		const roster = range(9).map((i) => ({
			id: i,
			valueNoPot: 70 - i,
			usage: 0.45 - 0.02 * i,
			injured: false,
			fga: 400,
			min: 1000,
		}));
		// Everybody shooting the same per minute: the low-usage players are far above their roles
		const drift = seasonDriftMults(roster);
		assert.isUndefined(drift.get(0));
		assert.isBelow(drift.get(8)!, 1);
		// Too early in the season: nothing
		assert.strictEqual(
			seasonDriftMults(roster.map((p) => ({ ...p, min: 20, fga: 8 }))).size,
			0,
		);
	});

	test("spacing sag", () => {
		assert.strictEqual(sagOf(0.6), 0);
		assert.strictEqual(sagOf(0), 1);
		assert.isAbove(sagOf(0.3), 0);
	});

	test("share effect of a modifier", () => {
		const w = [2, 1, 1, 1, 1];
		assert.closeTo(shareEffect(w, [1, 1, 1, 1, 1], 0, 5), 1, 1e-12);
		// Player 0's weight doubled by the modifier: without it his share would be 1/6 instead of 2/6
		assert.closeTo(shareEffect(w, [2, 1, 1, 1, 1], 0, 5), 2 / (6 / 5), 1e-12);
	});

	test("shot diet from the tracking array", () => {
		const adv = newAdv();
		assert.isUndefined(shotDiet(adv));
		adv[ADV.sdNormal] = 6;
		adv[ADV.sdCreated] = 3;
		adv[ADV.sdPutback] = 1;
		adv[ADV.sdDraws] = 9;
		adv[ADV.smPlan] = 9 * 1100;
		const diet = shotDiet(adv)!;
		assert.strictEqual(diet.total, 10);
		assert.closeTo(diet.sources[0]!.pct, 0.6, 1e-12);
		assert.closeTo(
			diet.modifiers.find((m) => m.key === "smPlan")!.mult,
			1.1,
			1e-12,
		);
		assert.strictEqual(
			shotDietText(shotDietOfGame(adv)),
			"Shot diet: 6 normal draw, 3 self-created, 1 putbacks",
		);
		// An old row, before the shot diet existed
		assert.isUndefined(shotDiet(adv.slice(0, ADV.sdNormal)));
	});
});

const NEW_LEAGUE = {
	realisticPossessions: true,
	spacingCreation: true,
	matchupDefense: true,
	realisticPlayTypes: true,
	advStats: true,
	playerTraits: true,
	simFixes: true,
};

const simGames = async (
	settings: Record<string, boolean>,
	seeds: number[],
	edit?: (sim: any) => void,
	run = true,
) => {
	const out = [];
	for (const seed of seeds) {
		out.push(
			await withSeededRandom(seed, async () => {
				await genTeams();
				for (const [key, value] of Object.entries(settings)) {
					g.setWithoutSavingToDB(key as any, value);
				}
				const teams = await loadTeams([0, 1], {});
				const sim: any = new GameSim({
					gid: seed,
					teams: [teams[0]!, teams[1]!],
					baseInjuryRate: g.get("injuryRate"),
					doPlayByPlay: false,
					homeCourtFactor: 1,
					allStarGame: false,
					neutralSite: false,
				});
				edit?.(sim);
				return { sim, result: run ? sim.run() : undefined };
			}),
		);
	}
	return out;
};

const SEEDS = range(6).map((i) => 700 + i * 37);

describe("in the game sim", () => {
	test(
		"games stay sane, and every shot is in the shot diet",
		{ timeout: 300_000 },
		async () => {
			const games = await simGames(
				{ ...NEW_LEAGUE, shotShareModel: true },
				SEEDS,
			);
			let pts = 0;
			for (const { result } of games) {
				for (const t of result.team) {
					pts += t.stat.pts;
					let fga = 0;
					let shots = 0;
					for (const p of t.player) {
						fga += p.stat.fga;
						const diet = shotDiet(p.adv);
						shots += diet?.total ?? 0;
					}
					// (shots: field goal attempts plus shooting fouls on misses)
					assert.isAtLeast(shots, fga);
					assert.isBelow(shots, fga * 1.25);
				}
			}
			const perTeam = pts / (2 * games.length);
			assert.isAbove(perTeam, 85);
			assert.isBelow(perTeam, 135);
		},
	);

	test(
		"league totals stay about the same (points, FG%, 3PA rate, turnovers, free throws)",
		{ timeout: 300_000 },
		async () => {
			const seeds = range(
				Number((globalThis as any).process.env.SS_N ?? 32),
			).map((i) => 300 + i * 53);
			const totals = async (on: boolean) => {
				const sum = { pts: 0, fga: 0, fg: 0, tpa: 0, tov: 0, fta: 0, n: 0 };
				for (const { result } of await simGames(
					{ ...NEW_LEAGUE, shotShareModel: on },
					seeds,
				)) {
					for (const t of result.team) {
						sum.pts += t.stat.pts;
						sum.fga += t.stat.fga;
						sum.fg += t.stat.fg;
						sum.tpa += t.stat.tpa;
						sum.tov += t.stat.tov;
						sum.fta += t.stat.fta;
						sum.n += 1;
					}
				}
				return {
					pts: sum.pts / sum.n,
					fgp: sum.fg / sum.fga,
					tpaRate: sum.tpa / sum.fga,
					tov: sum.tov / sum.n,
					fta: sum.fta / sum.n,
				};
			};
			const off = await totals(false);
			const on = await totals(true);
			assert.closeTo(on.pts, off.pts, 4);
			assert.closeTo(on.fgp, off.fgp, 0.02);
			assert.closeTo(on.tpaRate, off.tpaRate, 0.03);
			assert.closeTo(on.tov, off.tov, 1.5);
			assert.closeTo(on.fta, off.fta, 3);
		},
	);

	test("the same seed plays the same game", { timeout: 300_000 }, async () => {
		const a = await simGames({ ...NEW_LEAGUE, shotShareModel: true }, [5]);
		const b = await simGames({ ...NEW_LEAGUE, shotShareModel: true }, [5]);
		assert.deepEqual(
			a[0]!.result.team.map((t: any) => t.player.map((p: any) => p.stat.fga)),
			b[0]!.result.team.map((t: any) => t.player.map((p: any) => p.stat.fga)),
		);
	});

	test(
		"weights: game plan, hot hand, late clock, roles",
		{ timeout: 300_000 },
		async () => {
			const { sim } = (
				await simGames(
					{ ...NEW_LEAGUE, shotShareModel: true },
					[11],
					undefined,
					false,
				)
			)[0]!;
			sim.ssLate = false;
			const base = shares([...sim.shotShareWeights(0)]);

			// Roles: the 1st option of the five is the one with the highest usage composite
			const usages = sim.playersOnCourt[0].map(
				(p: any) => p.compositeRating.usage,
			);
			const first = usages.indexOf(Math.max(...usages));
			assert.strictEqual(sim.ssTier[0][first], 0);

			// Hot hand
			const p2 = sim.playersOnCourt[0][2];
			p2.ss.hot = 2;
			const hot = shares([...sim.shotShareWeights(0)]);
			assert.isAbove(hot[2]!, base[2]!);
			p2.ss.hot = 0;

			// Game plan
			const fixed = p2.ss.fixed;
			p2.ss.fixed = fixed * SHOT_SHARE.planMore;
			const more = shares([...sim.shotShareWeights(0)]);
			assert.isAbove(more[2]!, base[2]!);
			p2.ss.fixed = fixed;

			// Late clock: the best creator gets more
			sim.ssLate = true;
			const creator = sim.ssCreator[0];
			const late = shares([...sim.shotShareWeights(0)]);
			assert.isAbove(late[creator]!, base[creator]!);
			sim.ssLate = false;
		},
	);

	test(
		"double teams: the doubled star's kick-outs are assisted, catch-and-shoot leaning",
		{ timeout: 300_000 },
		async () => {
			let kicks = 0;
			let assisted = 0;
			const proto = GameSim.prototype as any;
			const orig = proto.getShotInfo;
			proto.getShotInfo = function (args: any) {
				const out = orig.call(this, args);
				if (
					!args.putBack &&
					!args.tipInFromOutOfBounds &&
					this.ssKickFor(args.p) !== undefined
				) {
					kicks += 1;
					if (out.passer === this.ssPickKick) {
						assisted += 1;
					}
				}
				return out;
			};
			try {
				await simGames({ ...NEW_LEAGUE, shotShareModel: true }, SEEDS);
			} finally {
				proto.getShotInfo = orig;
			}
			assert.isAbove(kicks, 0);
			// (the clock can run under a second, when no assist is drawn)
			assert.isAbove(assisted / kicks, 0.9);
		},
	);
});
