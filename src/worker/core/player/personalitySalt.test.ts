// Personality salt: leagues from before Player Traits (playerTraitsSeed 0) get their own personality salt when traits are first turned on,
// so they stop sharing personalities by pid. It moves only personality trait seeds that aren't stored yet, never stored ones, and nothing
// else that reads playerTraitsSeed (trajectories, aging, scouting).
import { afterEach, assert, describe, test } from "vitest";
import { setNewLeagueSaltOverride } from "../../../common/leagueSalt.ts";
import { generateTraitSeeds } from "../../../common/playerTraits/index.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { league } from "../index.ts";
import { getTraitSeeds } from "./traits.ts";
import { trajectoryLatenessOf } from "./trajectory.ts";

const preTraitsLeague = async (players: any[] = []) => {
	resetG();
	g.setWithoutSavingToDB("playerTraits", false);
	g.setWithoutSavingToDB("playerTraitsSeed", 0);
	g.setWithoutSavingToDB("personalityTraitsSalt", 0);
	await resetCache({ players });
};

afterEach(() => {
	// Back to the tests' fixed salt (src/test/setup.ts)
	setNewLeagueSaltOverride(() => 0);
});

describe("personality salt", () => {
	test("no salt: seeds exactly as before", async () => {
		await preTraitsLeague();
		g.setWithoutSavingToDB("playerTraits", true);
		assert.deepStrictEqual(
			getTraitSeeds({ pid: 7 } as any),
			generateTraitSeeds(0, 7),
		);
	});

	test("a salt moves generated seeds, never stored ones, and not the trajectory", async () => {
		await preTraitsLeague();
		g.setWithoutSavingToDB("playerTraits", true);
		const stored = generateTraitSeeds(0, 8);
		const lateness = trajectoryLatenessOf({ pid: 7 });
		g.setWithoutSavingToDB("personalityTraitsSalt", 4242);
		assert.notDeepEqual(
			getTraitSeeds({ pid: 7 } as any),
			generateTraitSeeds(0, 7),
		);
		assert.deepStrictEqual(
			getTraitSeeds({ pid: 8, traits: stored } as any),
			stored,
		);
		assert.strictEqual(trajectoryLatenessOf({ pid: 7 }), lateness);
	});

	test("drawn when Player Traits is first turned on in a pre-traits league", async () => {
		await preTraitsLeague();
		setNewLeagueSaltOverride(() => 4242);
		await league.setGameAttributes({ playerTraits: true });
		assert.strictEqual(g.get("personalityTraitsSalt"), 4242);
		// Two pre-traits leagues now differ for the same pid
		const a = getTraitSeeds({ pid: 3 } as any);
		g.setWithoutSavingToDB("personalityTraitsSalt", 777);
		assert.notDeepEqual(getTraitSeeds({ pid: 3 } as any), a);
	});

	test("not drawn when the league has a seed, or already has stored trait seeds", async () => {
		setNewLeagueSaltOverride(() => 4242);

		await preTraitsLeague();
		g.setWithoutSavingToDB("playerTraitsSeed", 12345);
		await league.setGameAttributes({ playerTraits: true });
		assert.strictEqual(g.get("personalityTraitsSalt"), 0);

		await preTraitsLeague([
			{ pid: 0, tid: 0, traits: generateTraitSeeds(0, 0) },
		]);
		await league.setGameAttributes({ playerTraits: true });
		assert.strictEqual(g.get("personalityTraitsSalt"), 0);
	});
});
