// Player traits: loyalty, role acceptance and money vs winning in mood and contract demands, and the over-the-cap minimum contract rules
// staying intact with them on.
import { assert, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import type { MoodComponents, Player } from "../../../common/types.ts";
import { resetCache, resetG } from "../../../test/helpers.ts";
import { g, helpers } from "../../util/index.ts";
import { player, team } from "../index.ts";
import moodInfo from "./moodInfo.ts";
import { getPersonalityScores, setTraitScores } from "./traits.ts";
import { PERSONALITY_AMPLITUDES } from "../../../common/playerTraits/index.ts";

const USER_TID = 0;

const setup = async () => {
	resetG();
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("userTid", USER_TID);
	g.setWithoutSavingToDB("userTids", [USER_TID]);
	g.setWithoutSavingToDB("numTeams", 2);
	g.setWithoutSavingToDB("numActiveTeams", 2);
	g.setWithoutSavingToDB("playerTraits", true);
	g.setWithoutSavingToDB("playerTraitsSeed", 12345);
	const teams = helpers
		.getTeamsDefault()
		.slice(0, 2)
		.map((t) => team.generate(t));
	await resetCache({ teams });
	const players: Player[] = [];
	for (const [i, tid] of [USER_TID, PLAYER.FREE_AGENT].entries()) {
		const p = player.generate(tid, 27, 2015, true, DEFAULT_LEVEL) as Player;
		p.pid = i;
		await player.develop(p, 0);
		await player.updateValues(p);
		players.push(p);
	}
	await resetCache({ players: players as any, teams });
	player.addToFreeAgents(players[1]!, {});
	return { onTeam: players[0]!, freeAgent: players[1]! };
};

// Every component positive, so the bad-mood surcharge on the asking price is off and only the traits move it
const happy =
	(teamPerformance = 1) =>
	(c: MoodComponents) => {
		c.marketSize = 1;
		c.facilities = 1;
		c.teamPerformance = teamPerformance;
		c.hype = 1;
		c.loyalty = 1;
		c.trades = 0;
		c.playingTime = 0;
	};

describe("personality traits", () => {
	test("loyalty: discount to re-sign with his team, premium when disloyal, bounded", async () => {
		const { onTeam } = await setup();
		const amount = 5 * g.get("minContract");
		const asking = async (loyalty: number) => {
			setTraitScores(onTeam as any, { loyalty });
			const mood = await moodInfo(onTeam, USER_TID, {
				contractAmount: amount,
				adjustComponents: happy(),
			});
			return mood;
		};
		const loyal = await asking(95);
		const disloyal = await asking(5);
		assert.isBelow(loyal.contractAmount, disloyal.contractAmount);
		const max = PERSONALITY_AMPLITUDES.loyaltyResignDiscount;
		assert.isAtLeast(loyal.contractAmount, amount * (1 - max) - 10);
		assert.isAtMost(disloyal.contractAmount, amount * (1 + max) + 10);
		// Happier to stay
		assert.isAbove(loyal.components.loyalty, disloyal.components.loyalty);
		assert.isAtLeast(disloyal.components.loyalty, 0);
	});

	test("role acceptance: scales the playing time penalty only", async () => {
		const { onTeam } = await setup();
		const playingTime = async (roleAcceptance: number, value: number) => {
			setTraitScores(onTeam as any, { roleAcceptance });
			const mood = await moodInfo(onTeam, USER_TID, {
				adjustComponents: (c) => {
					c.playingTime = value;
				},
			});
			return mood.components.playingTime;
		};
		const accepting = await playingTime(95, -2);
		const demanding = await playingTime(5, -2);
		assert.isAbove(accepting, -2);
		assert.isBelow(demanding, -2);
		assert.isAtLeast(
			accepting,
			-2 * (1 - PERSONALITY_AMPLITUDES.rolePlayingTime) - 1e-9,
		);
		assert.isAtLeast(
			demanding,
			-2 * (1 + PERSONALITY_AMPLITUDES.rolePlayingTime) - 1e-9,
		);
		// Plenty of minutes: no change
		assert.strictEqual(await playingTime(5, 1), 1);
	});

	test("money vs winning: ring chasers want winners and take less to join one, never below the minimum", async () => {
		const { freeAgent } = await setup();
		const amount = 5 * g.get("minContract");
		const offer = (moneyVsWinning: number, teamPerformance: number) => {
			setTraitScores(freeAgent as any, { moneyVsWinning });
			return moodInfo(freeAgent, USER_TID, {
				contractAmount: amount,
				adjustComponents: happy(teamPerformance),
			});
		};
		const chaser = await offer(95, 2);
		const mercenary = await offer(5, 2);
		assert.isBelow(chaser.contractAmount, mercenary.contractAmount);
		assert.isAtLeast(
			chaser.contractAmount,
			amount * (1 - PERSONALITY_AMPLITUDES.ringChaserDiscount) - 10,
		);
		assert.isAbove(
			chaser.components.teamPerformance,
			mercenary.components.teamPerformance,
		);
		// A bad team: no discount, and not hated more than without the trait
		const chaserBad = await offer(95, -1);
		assert.strictEqual(chaserBad.components.teamPerformance, -1);
		assert.strictEqual(chaserBad.contractAmount, amount);

		// Minimum contract: still the minimum, still signs
		setTraitScores(freeAgent as any, { moneyVsWinning: 95 });
		const min = await moodInfo(freeAgent, USER_TID, {
			contractAmount: g.get("minContract"),
			adjustComponents: (c) => {
				c.teamPerformance = -4;
				c.trades = -8;
				c.playingTime = -6;
			},
		});
		assert.strictEqual(min.contractAmount, g.get("minContract"));
		assert.isTrue(min.willing);
	});

	test("personality scores are deterministic and backfilled for players with older stored seeds", async () => {
		const { onTeam } = await setup();
		const before = getPersonalityScores(onTeam as any);
		// An older league: only the original 17 seeds stored
		const stored = { ...(onTeam as any).traits };
		delete stored.loyaltySeed;
		delete stored.roleAcceptanceSeed;
		delete stored.moneyVsWinningSeed;
		delete stored.motorSeed;
		delete stored.defensiveVersatilitySeed;
		(onTeam as any).traits = stored;
		const after = getPersonalityScores(onTeam as any);
		assert.deepEqual(after, getPersonalityScores(onTeam as any));
		assert.isNumber(after.loyalty);
		assert.isDefined(before);
	});
});
