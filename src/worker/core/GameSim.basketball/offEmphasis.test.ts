import { assert, describe, test } from "vitest";
import { g } from "../../util/index.ts";
import GameSim from "./index.ts";
import loadTeams from "../game/loadTeams.ts";
import { genTeams, withSeededRandom } from "./simLiveGameForTests.ts";
import {
	AUTO_FIT_MEAN,
	autoEmphasis,
	clampEmphasis,
	EMPHASIS_KEYS,
	type Emphasis,
	emphasisFit,
	emphasisRecommendation,
	emphasisSim,
	FIT_MAKE,
	MIX_GAIN,
	NEUTRAL_EMPHASIS,
	NEUTRAL_EMPHASIS_SIM,
	OFFENSE_SYSTEM_EMPHASIS,
	PRESETS,
	rosterStrengths,
	SIM_BOUND,
	type EmphasisRatings,
} from "../../../common/offEmphasis.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { offEmphasisOn } from "../offEmphasis/index.ts";

/**
 * Offensive Emphasis (featureOffEmphasis, common/offEmphasis.ts): the off state changes nothing, the sim effects are bounded, and the
 * coaches' (auto) choices follow their rosters and systems
 */

const SETTINGS = {
	realisticPossessions: true,
	spacingCreation: true,
	realisticPlayTypes: true,
};

const play = (seed: number, emph?: (tid: number) => any) =>
	withSeededRandom(seed, async () => {
		await genTeams();
		for (const [key, value] of Object.entries(SETTINGS)) {
			g.setWithoutSavingToDB(key as any, value as any);
		}
		const teams = await loadTeams([0, 1], {});
		if (emph) {
			for (const tid of [0, 1]) {
				(teams[tid] as any).offEmphasis = emph(tid);
			}
		}
		const sim = new GameSim({
			gid: seed,
			teams: [teams[0]!, teams[1]!],
			baseInjuryRate: 0,
			doPlayByPlay: false,
			homeCourtFactor: 1,
			allStarGame: false,
			neutralSite: false,
		});
		const result = sim.run();
		return result.team.map((t: any) => ({ ...t.stat }));
	});

const rating = (over: Partial<EmphasisRatings>): EmphasisRatings => ({
	hgt: 50,
	stre: 50,
	spd: 50,
	jmp: 50,
	ins: 50,
	dnk: 50,
	fg: 50,
	tp: 45,
	oiq: 55,
	drb: 50,
	pss: 50,
	...over,
});

describe("off state", () => {
	test("the setting is off in an existing league, and a neutral emphasis plays exactly like none (no extra random numbers)", async () => {
		await genTeams();
		assert.isFalse(offEmphasisOn());
		for (const seed of [1, 2, 3]) {
			const none = await play(seed);
			const neutral = await play(seed, () => ({ ...NEUTRAL_EMPHASIS_SIM }));
			assert.deepEqual(neutral, none);
		}
	});

	test("an emphasis changes the game", async () => {
		const none = await play(4);
		const five = await play(4, () => emphasisSim(PRESETS.fiveOut, 0));
		assert.notDeepEqual(five, none);
	});
});

describe("bounds", () => {
	test("every multiplier stays within ±30% (pace ±4%) and the fit within ±1.5", () => {
		const random = makeSeededRandom(7);
		for (let i = 0; i < 2000; i++) {
			const e = clampEmphasis(
				Object.fromEntries(
					EMPHASIS_KEYS.map((k) => [k, random() * 4 - 2]),
				) as Partial<Emphasis>,
			);
			const z = Object.fromEntries(
				EMPHASIS_KEYS.map((k) => [k, random() * 8 - 4]),
			) as Emphasis;
			const fit = emphasisFit(e, z);
			assert.isAtMost(Math.abs(fit), 1.5);
			const sim = emphasisSim(e, fit);
			for (const [key, value] of Object.entries(sim)) {
				if (key === "make" || key === "fit") {
					continue;
				}
				if (key === "halfCourt") {
					assert.isAtMost(Math.abs(value - 1), 0.04 + 1e-9);
				} else {
					assert.isAtMost(Math.abs(value - 1), SIM_BOUND + 1e-9, key);
				}
			}
			assert.isAtMost(
				Math.abs(sim.make),
				FIT_MAKE * (1.5 + AUTO_FIT_MEAN) + MIX_GAIN + 1e-9,
			);
			for (const k of EMPHASIS_KEYS) {
				assert.isAtMost(Math.abs(e[k]), 1);
			}
		}
	});

	test("fit: leaning into strengths is positive, into weaknesses negative, neutral is 0", () => {
		const z = { pnr: 1.5, iso: 0, post: -1.5, spot: 1, pace: 0, inside: -1 };
		assert.isAbove(emphasisFit(PRESETS.fiveOut, z), 0.5);
		assert.isBelow(emphasisFit(PRESETS.postCentric, z), -0.5);
		assert.strictEqual(emphasisFit(NEUTRAL_EMPHASIS, z), 0);
	});
});

describe("AI choices", () => {
	const shooters = [
		rating({ drb: 70, pss: 72, oiq: 70, tp: 70 }),
		...Array.from({ length: 8 }, () =>
			rating({ tp: 72, hgt: 45, ins: 35, stre: 40, dnk: 40 }),
		),
	];
	const bigs = Array.from({ length: 9 }, () =>
		rating({
			hgt: 72,
			ins: 75,
			stre: 72,
			dnk: 70,
			tp: 25,
			drb: 35,
			pss: 40,
			spd: 38,
		}),
	);

	test("roster strengths read the roster", () => {
		const zs = rosterStrengths(shooters);
		const zb = rosterStrengths(bigs);
		assert.isAbove(zs.spot, 1);
		assert.isBelow(zs.inside, -1);
		assert.isAbove(zb.post, 1);
		assert.isAbove(zb.inside, 1);
		assert.isBelow(zb.spot, -1);
	});

	test("a coach leans to his roster's strengths, and his system tilts it", () => {
		const shoot = autoEmphasis(rosterStrengths(shooters), undefined);
		const big = autoEmphasis(rosterStrengths(bigs), undefined);
		assert.isAbove(shoot.spot, 0.4);
		assert.isBelow(shoot.post, big.post);
		assert.isAbove(big.post, 0.4);
		assert.isAbove(big.inside, 0.4);
		const z = rosterStrengths(shooters);
		assert.isAbove(
			autoEmphasis(z, "post").post,
			autoEmphasis(z, "paceSpace").post,
		);
		assert.isAbove(
			autoEmphasis(z, "sevenSeconds").pace,
			autoEmphasis(z, "post").pace,
		);
		// The coach's choice fits his roster
		assert.isAbove(emphasisFit(shoot, rosterStrengths(shooters)), 0.5);
		assert.isAbove(emphasisFit(big, rosterStrengths(bigs)), 0.5);
		for (const sys of Object.keys(OFFENSE_SYSTEM_EMPHASIS)) {
			for (const roster of [shooters, bigs]) {
				const e = autoEmphasis(rosterStrengths(roster), sys);
				for (const k of EMPHASIS_KEYS) {
					assert.isAtMost(Math.abs(e[k]), 1);
				}
			}
		}
	});

	test("the Staff Report suggests the play type the roster scores well on but runs little", () => {
		const league = {
			prb: { freq: 20, ppp: 0.97, poss: 50000 },
			post: { freq: 4, ppp: 0.73, poss: 10000 },
		};
		const rec = emphasisRecommendation(
			{
				prb: { freq: 15, ppp: 1.05, poss: 900 },
				post: { freq: 4, ppp: 0.74, poss: 200 },
			},
			league,
			NEUTRAL_EMPHASIS,
			NEUTRAL_EMPHASIS,
		);
		assert.strictEqual(rec?.key, "pnr");
		assert.strictEqual(rec?.dir, 1);
		assert.include(rec!.text, "1.05 PPP in PnR");
		assert.include(rec!.text, "runs it 15%");
	});
});
