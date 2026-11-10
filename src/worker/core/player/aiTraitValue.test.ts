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
import {
	getAiTraitTeamContext,
	getAiTraitValueFactor,
	makeAiTraitValueFactorCache,
	setTraitScores,
} from "./traits.ts";
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

	describe("team context (ego, temper, work ethic, big-game)", () => {
		const roster = (tid: number) => players.filter((p) => p.tid === tid);
		// Fresh copies, so nothing leaks into the other tests through the shared player objects
		const makeTeam = (tid: number, ego: number, temper = 50) =>
			roster(tid).map((p0) => {
				const p = helpers.deepCopy(p0);
				setTraitScores(p, { ego, temper });
				return p;
			});
		const makePlayer = (traits: Parameters<typeof setTraitScores>[1]) => {
			const p = helpers.deepCopy(players[0]!);
			p.pid = 200000;
			p.tid = 29;
			setTraitScores(p, { ego: 50, temper: 50, ...traits });
			return p;
		};

		test("setting off: no context, exactly no effect", () => {
			g.setWithoutSavingToDB("playerTraits", false);
			assert.strictEqual(getAiTraitTeamContext(roster(0)), undefined);
			const getFactor = makeAiTraitValueFactorCache();
			g.setWithoutSavingToDB("playerTraits", true);
			const team = getAiTraitTeamContext(makeTeam(0, 10, 10));
			g.setWithoutSavingToDB("playerTraits", false);
			for (const p of [makePlayer({ ego: 5, temper: 5 }), ...roster(1)]) {
				for (const strategy of ["contending", "rebuilding"] as const) {
					assert.strictEqual(getAiTraitValueFactor(p, { strategy, team }), 1);
					assert.strictEqual(getFactor(p, { strategy, team }), 1);
				}
			}
		});

		test("a big ego is worth less to a team that already has big egos, most of all to a contender", () => {
			g.setWithoutSavingToDB("playerTraits", true);
			const diva = makePlayer({ ego: 10 });
			const calm = getAiTraitTeamContext(makeTeam(0, 50))!;
			const divas = getAiTraitTeamContext(makeTeam(0, 10))!;
			const toCalm = getAiTraitValueFactor(diva, { team: calm });
			const toDivas = getAiTraitValueFactor(diva, { team: divas });
			const toFragileContender = getAiTraitValueFactor(diva, {
				team: divas,
				strategy: "contending",
			});
			assert.isBelow(toDivas, toCalm);
			assert.isBelow(toFragileContender, toDivas);
			assert.isAtLeast(toFragileContender, 1 - AI_TRAIT_MAX_ADJ - 1e-9);

			// ...and the same locker room pays more for a team-first player
			const teamFirst = makePlayer({ ego: 90 });
			assert.isAbove(
				getAiTraitValueFactor(teamFirst, { team: divas }),
				getAiTraitValueFactor(teamFirst, { team: calm }),
			);
		});

		test("a hot head is worth less to a contender and to a team of hot heads", () => {
			g.setWithoutSavingToDB("playerTraits", true);
			const hotHead = makePlayer({ temper: 10 });
			const calm = getAiTraitTeamContext(makeTeam(0, 50, 50))!;
			const hot = getAiTraitTeamContext(makeTeam(0, 50, 10))!;
			const base = getAiTraitValueFactor(hotHead, { team: calm });
			assert.isBelow(getAiTraitValueFactor(hotHead, { team: hot }), base);
			assert.isBelow(
				getAiTraitValueFactor(hotHead, { team: calm, strategy: "contending" }),
				base,
			);
		});

		test("a team values its own player the same going out as coming in (nothing to arbitrage)", () => {
			g.setWithoutSavingToDB("playerTraits", true);
			const teamPlayers = makeTeam(0, 10, 10);
			const p = teamPlayers[3]!;
			const withHim = getAiTraitTeamContext(teamPlayers)!;
			const withoutHim = getAiTraitTeamContext(
				teamPlayers.filter((p2) => p2 !== p),
			)!;
			for (const strategy of ["contending", "rebuilding"] as const) {
				assert.closeTo(
					getAiTraitValueFactor(p, { strategy, team: withHim }),
					getAiTraitValueFactor(p, {
						strategy,
						team: { ...withoutHim, numYoung: withHim.numYoung },
					}),
					1e-12,
				);
			}
		});

		test("the cached version agrees with the uncached one", () => {
			g.setWithoutSavingToDB("playerTraits", true);
			const getFactor = makeAiTraitValueFactorCache();
			const teamPlayers = makeTeam(2, 20, 30);
			assert.deepEqual(
				getFactor.teamContext(teamPlayers),
				getAiTraitTeamContext(teamPlayers),
			);
			const team = getFactor.teamContext(teamPlayers);
			for (const p of roster(3)) {
				assert.strictEqual(
					getFactor(p, { strategy: "contending", team }),
					getAiTraitValueFactor(p, { strategy: "contending", team }),
				);
			}
		});

		test("averages ~1 over the league when every team values every other team's players", () => {
			g.setWithoutSavingToDB("playerTraits", true);
			const getFactor = makeAiTraitValueFactorCache();
			let sum = 0;
			let sumOwn = 0;
			let n = 0;
			let nOwn = 0;
			for (let tid = 0; tid < g.get("numTeams"); tid++) {
				const team = getFactor.teamContext(roster(tid));
				const strategy = tid % 2 === 0 ? "contending" : "rebuilding";
				for (const p of players) {
					const f = getFactor(p, { strategy, team });
					assert.isAtMost(Math.abs(f - 1), AI_TRAIT_MAX_ADJ + 1e-9);
					if (p.tid === tid) {
						sumOwn += f;
						nOwn += 1;
					} else if (p.pid % 7 === tid % 7) {
						sum += f;
						n += 1;
					}
				}
			}
			assert.closeTo(sum / n, 1, 0.015);
			assert.closeTo(sumOwn / nOwn, 1, 0.015);
		});

		test("trades: the AI gives less for a big ego when its own locker room is already full of them", async () => {
			g.setWithoutSavingToDB("playerTraits", true);
			const p = (await idb.cache.players.indexGetAll("playersByTid", 1)).sort(
				(a, b) => b.value - a.value,
			)[0]!;
			setTraitScores(p, { ego: 5, durability: 50 });
			await idb.cache.players.put(p);
			const evaluate = () =>
				new ValueChangeCalculator().evaluate({
					tid: 0,
					pidsAdd: [p.pid],
					pidsRemove: [],
					dpidsAdd: [],
					dpidsRemove: [],
					tradingPartnerTid: 2,
				});
			const setTeamEgo = async (ego: number) => {
				for (const p2 of await idb.cache.players.indexGetAll(
					"playersByTid",
					0,
				)) {
					setTraitScores(p2, { ego });
					await idb.cache.players.put(p2);
				}
			};

			await setTeamEgo(50);
			const calm = await evaluate();
			await setTeamEgo(5);
			const divas = await evaluate();
			assert.isBelow(divas, calm);

			// Setting off: the locker room changes nothing
			g.setWithoutSavingToDB("playerTraits", false);
			const off1 = await evaluate();
			await setTeamEgo(50);
			const off2 = await evaluate();
			assert.strictEqual(off1, off2);
		});
	});
});
