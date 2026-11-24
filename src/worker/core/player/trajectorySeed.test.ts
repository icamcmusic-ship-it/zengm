// The hidden trajectory (aging curve) from a stored per-player seed: storing it changes nothing, and it follows a player to a new pid,
// league seed or league salt (player import)
import { afterEach, assert, describe, test } from "vitest";
import { setLeagueSaltGetter } from "../../../common/leagueSalt.ts";
import {
	trajectorySeedFor,
	trajectoryU,
	trajectoryUFromSeed,
} from "../../../common/playerTraits/development.ts";
import { resetG } from "../../../test/helpers.ts";
import { g } from "../../util/index.ts";
import { ensureTraits } from "./traits.ts";
import {
	agingCurveOf,
	getTrajectorySeed,
	trajectoryLatenessOf,
} from "./trajectory.ts";

afterEach(() => {
	setLeagueSaltGetter(() =>
		Object.hasOwn(g, "leagueSalt") ? (g.get("leagueSalt") ?? 0) : 0,
	);
});

describe("trajectory seed", () => {
	test("the stored seed gives exactly the draw the pid gave", () => {
		for (const salt of [0, 987654]) {
			setLeagueSaltGetter(() => salt);
			for (const leagueSeed of [0, 12345]) {
				for (let pid = 0; pid < 200; pid++) {
					assert.strictEqual(
						trajectoryUFromSeed(trajectorySeedFor(leagueSeed, pid)),
						trajectoryU(leagueSeed, pid),
					);
				}
			}
		}
	});

	test("ensureTraits stores it without moving anything, and it follows him to a new pid and league", () => {
		resetG();
		g.setWithoutSavingToDB("playerTraits", true);
		g.setWithoutSavingToDB("playerTraitsSeed", 12345);
		const players = Array.from({ length: 50 }, (_, pid) => ({
			pid,
			born: { year: 1990 },
			draft: { year: 2010 },
			ratings: [{ season: 2020 }],
		})) as any[];
		const before = players.map((p) => ({
			curve: agingCurveOf(p),
			lateness: trajectoryLatenessOf(p),
		}));
		for (const p of players) {
			assert.isTrue(ensureTraits(p));
			assert.strictEqual(p.trajectorySeed, trajectorySeedFor(12345, p.pid));
			// Stored once: the next call changes nothing
			assert.isFalse(ensureTraits(p));
		}
		assert.deepStrictEqual(
			players.map((p) => ({
				curve: agingCurveOf(p),
				lateness: trajectoryLatenessOf(p),
			})),
			before,
		);

		// Imported into another league: new pid, league seed and salt
		g.setWithoutSavingToDB("playerTraitsSeed", 999);
		setLeagueSaltGetter(() => 31337);
		const moved = players.map((p) => ({ ...p, pid: p.pid + 1000 }));
		assert.deepStrictEqual(
			moved.map((p) => ({
				curve: agingCurveOf(p),
				lateness: trajectoryLatenessOf(p),
			})),
			before,
		);
		// Without a stored seed he'd have rolled a new one
		const unstored = moved.map((p) => ({ ...p, trajectorySeed: undefined }));
		assert.notDeepEqual(
			unstored.map((p) => getTrajectorySeed(p)),
			moved.map((p) => getTrajectorySeed(p)),
		);
	});
});
