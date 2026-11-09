import { assert, beforeAll, describe, test } from "vitest";
import { PHASE, PLAYER } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { AI_TRAIT_MAX_ADJ } from "../../../common/playerTraits/index.ts";
import { mockIDBLeague, resetCache, resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, local } from "../../util/index.ts";
import { player, team } from "../index.ts";
import { ValueChangeCalculator } from "../team/ValueChangeCalculator.ts";
import { getDraftTraitAdjustment } from "../draft/draftNeeds.ts";
import { getAiTraitValueFactor, setTraitScores } from "./traits.ts";
import type { Player } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";

describe("AI trait valuation in a league", () => {
	let players: Player[];
	beforeAll(async () => {
		resetG();
		g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
		g.setWithoutSavingToDB("playerTraitsSeed", 77);
		const season = g.get("season");
		players = [];
		let pid = 0;
		for (let tid = 0; tid < g.get("numTeams"); tid++) {
			for (let i = 0; i < 13; i++) {
				const p = player.generate(
					tid,
					22 + (i % 12),
					season - 4,
					true,
					DEFAULT_LEVEL,
				) as Player;
				p.pid = pid++;
				// Spread of values like a real league
				p.value = 40 + ((tid * 7 + i * 5) % 30);
				p.valueNoPot = p.value;
				last(p.ratings).ovr = p.value;
				players.push(p);
			}
		}
		await resetCache({
			players,
			teams: helpers.getTeamsDefault().map(team.generate),
		});
		idb.league = mockIDBLeague();
		local.playerOvrMeanStdStale = true;
	});

	test("setting off: exactly no effect", () => {
		g.setWithoutSavingToDB("playerTraits", false);
		for (const p of players) {
			assert.strictEqual(
				getAiTraitValueFactor(p, { strategy: "contending", numYoung: 5 }),
				1,
			);
		}
	});

	test("setting on: bounded, averages ~1 over the league (no value/contract inflation)", () => {
		g.setWithoutSavingToDB("playerTraits", true);
		let sum = 0;
		let sumWeighted = 0;
		let sumValue = 0;
		let sumContract = 0;
		for (const p of players) {
			const f = getAiTraitValueFactor(p);
			assert.isAtMost(Math.abs(f - 1), AI_TRAIT_MAX_ADJ + 1e-9);
			sum += f;
			sumWeighted += f * p.value;
			sumValue += p.value;
			sumContract += getAiTraitValueFactor(p, { contract: true });
		}
		assert.closeTo(sum / players.length, 1, 0.015);
		assert.closeTo(sumWeighted / sumValue, 1, 0.015);
		assert.closeTo(sumContract / players.length, 1, 0.01);
	});

	test("trades: an injury prone player is worth less to the AI than the same player as an iron man", async () => {
		g.setWithoutSavingToDB("playerTraits", true);
		const p = (await idb.cache.players.indexGetAll("playersByTid", 1)).sort(
			(a, b) => b.value - a.value,
		)[0]!;
		const evaluate = () =>
			new ValueChangeCalculator().evaluate({
				tid: 0,
				pidsAdd: [p.pid],
				pidsRemove: [],
				dpidsAdd: [],
				dpidsRemove: [],
				tradingPartnerTid: 2,
			});

		setTraitScores(p, { durability: 10 });
		await idb.cache.players.put(p);
		const prone = await evaluate();
		setTraitScores(p, { durability: 90 });
		await idb.cache.players.put(p);
		const iron = await evaluate();
		assert.isAbove(iron, prone);

		g.setWithoutSavingToDB("playerTraits", false);
		const off1 = await evaluate();
		setTraitScores(p, { durability: 10 });
		await idb.cache.players.put(p);
		const off2 = await evaluate();
		assert.strictEqual(off1, off2);
	});

	test("draft prospects use scouted readings, and the draft nudge is capped", () => {
		g.setWithoutSavingToDB("playerTraits", true);
		const p = player.generate(
			PLAYER.UNDRAFTED,
			19,
			g.get("season"),
			false,
			DEFAULT_LEVEL,
		) as Player;
		p.pid = 100000;
		const f = getAiTraitValueFactor(p);
		assert.isAtMost(Math.abs(f - 1), AI_TRAIT_MAX_ADJ);
		assert.isAtMost(Math.abs(getDraftTraitAdjustment(70, 1.07)), 1.5);
		assert.strictEqual(getDraftTraitAdjustment(50, 1), 0);
		assert.isBelow(getDraftTraitAdjustment(50, 0.98), 0);
	});
});
