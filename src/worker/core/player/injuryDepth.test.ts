import { assert, beforeEach, describe, test } from "vitest";
import { g } from "../../util/index.ts";
import { resetG } from "../../../test/helpers.ts";
import { PHASE } from "../../../common/constants.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { injuryBodyPart } from "../../../common/injuryBodyPart.ts";
import injury from "./injury.ts";
import {
	dailyTick,
	getInjuryRiskFactor,
	getRestrictionFactor,
	getRestrictionGames,
	isInjuryProne,
	maybeSameBodyPart,
	onHealed,
	PRONE_FRACTION,
	shouldRest,
} from "./injuryDepth.ts";
import type { Player } from "../../../common/types.ts";

beforeEach(() => {
	resetG();
	g.setWithoutSavingToDB("season", 2025);
	g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
	g.setWithoutSavingToDB("injuryDepth", true);
});

const makePlayer = (pid: number): Player =>
	({
		pid,
		injury: { type: "Healthy", gamesRemaining: 0 },
		injuries: [],
	}) as unknown as Player;

// Seeded RNG so the season model is reproducible
const mulberry32 = (seed: number) => () => {
	seed |= 0;
	seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe("body parts", () => {
	test("default injuries map to body parts", () => {
		assert.strictEqual(injuryBodyPart("Torn ACL"), "Knee");
		assert.strictEqual(injuryBodyPart("Sprained Ankle"), "Ankle");
		assert.strictEqual(injuryBodyPart("Torn Achilles Tendon"), "Ankle");
		assert.strictEqual(injuryBodyPart("Concussion"), "Head");
		assert.strictEqual(injuryBodyPart("Back Spasms"), "Back");
		assert.strictEqual(injuryBodyPart("Fractured Thumb"), "Hand");
		assert.strictEqual(injuryBodyPart("Illness"), "Other");
	});
});

describe("player state", () => {
	test("minutes restriction after a long injury decays to nothing", () => {
		const p = makePlayer(1);
		p.injuries.push({ season: 2025, games: 21, type: "Sprained Knee" });
		onHealed(p);
		assert.strictEqual(p.health?.restrict, getRestrictionGames(21));
		assert.strictEqual(p.health?.bodyPart, "Knee");
		const first = getRestrictionFactor(p.health);
		assert.isBelow(first, 0.7);
		for (let i = 0; i < 3; i++) {
			dailyTick(p);
		}
		assert.isAbove(getRestrictionFactor(p.health), first);
		for (let i = 0; i < 30; i++) {
			dailyTick(p);
		}
		assert.strictEqual(p.health, undefined);
		assert.strictEqual(getRestrictionFactor(p.health), 1);
	});

	test("short injuries get no restriction, one-day knocks nothing at all", () => {
		const p = makePlayer(1);
		p.injuries.push({ season: 2025, games: 3, type: "Bruised Hip" });
		onHealed(p);
		assert.strictEqual(p.health?.restrict, 0);
		const p2 = makePlayer(2);
		p2.injuries.push({ season: 2025, games: 1, type: "Bruised Hip" });
		onHealed(p2);
		assert.strictEqual(p2.health, undefined);
	});

	test("recently returned players are riskier and re-injure the same body part more often", () => {
		const p = makePlayer(3);
		p.injuries.push({ season: 2025, games: 12, type: "Sprained Ankle" });
		const before = getInjuryRiskFactor(p, false);
		onHealed(p);
		assert.isAbove(getInjuryRiskFactor(p, false), before * 1.5);
		assert.isAbove(getInjuryRiskFactor(p, true), getInjuryRiskFactor(p, false));

		const rand = mulberry32(5);
		let same = 0;
		let sameBaseline = 0;
		const n = 4000;
		for (let i = 0; i < n; i++) {
			const inj = injury(DEFAULT_LEVEL);
			if (injuryBodyPart(inj.type) === "Ankle") {
				sameBaseline += 1;
			}
			if (injuryBodyPart(maybeSameBodyPart(p, inj, rand).type) === "Ankle") {
				same += 1;
			}
		}
		assert.isAbove(same / n, sameBaseline / n + 0.3);
	});

	test("about 7% of players are injury prone", () => {
		let prone = 0;
		const n = 20000;
		for (let pid = 0; pid < n; pid++) {
			if (isInjuryProne(makePlayer(pid))) {
				prone += 1;
			}
		}
		assert.closeTo(prone / n, PRONE_FRACTION, 0.01);
	});

	test("load management: per player, team setting and AI policy", () => {
		const base = {
			teamLoadManagement: false,
			aiControlled: false,
			numHealthy: 13,
			rank: 0,
		};
		const p = makePlayer(1000);
		assert.isFalse(shouldRest({ ...base, p, age: 35 }));
		assert.isTrue(
			shouldRest({ ...base, p: { ...p, loadManagement: true }, age: 22 }),
		);
		assert.isTrue(
			shouldRest({ ...base, p, age: 35, teamLoadManagement: true }),
		);
		assert.isTrue(shouldRest({ ...base, p, age: 35, aiControlled: true }));
		assert.isFalse(shouldRest({ ...base, p, age: 25, aiControlled: true }));
		assert.isFalse(
			shouldRest({ ...base, p, age: 35, aiControlled: true, numHealthy: 9 }),
		);
		g.setWithoutSavingToDB("phase", PHASE.PLAYOFFS);
		assert.isFalse(
			shouldRest({ ...base, p: { ...p, loadManagement: true }, age: 35 }),
		);
	});
});

// A season model: 30 teams of 13 players, 82 games, ~18% of games on the second night of a back-to-back. Each game a healthy player
// gets injured with a per-game probability scaled by how much he plays (fewer minutes under a restriction, none when rested), and the
// injury countdown runs per day like in game.play. Used to check the setting keeps league totals about the same (and to calibrate
// NORMALIZATION).
const simSeasons = (enabled: boolean, seed: number, numSeasons: number) => {
	const rand = mulberry32(seed);
	const origRandom = Math.random;
	Math.random = rand;
	try {
		let injuries = 0;
		let gamesMissed = 0;
		let reinjuriesSamePart = 0;
		let rests = 0;
		const PER_GAME = 0.025;
		let pid = 0;
		for (let s = 0; s < numSeasons; s++) {
			for (let t = 0; t < 30; t++) {
				const players = Array.from({ length: 13 }, (_, i) => {
					const p = makePlayer(pid++);
					return {
						p,
						age: 21 + Math.floor(rand() * 16),
						minutes: i < 5 ? 1.4 : i < 10 ? 0.8 : 0.2,
						rank: i,
					};
				});
				let day = 0;
				let lastDay = -10;
				for (let game = 0; game < 82; game++) {
					const gap = rand() < 0.18 ? 1 : rand() < 0.7 ? 2 : 3;
					// Countdown per day
					for (let d = 0; d < gap; d++) {
						day += 1;
						for (const { p } of players) {
							if (p.injury.gamesRemaining > 0) {
								p.injury.gamesRemaining -= 1;
								gamesMissed += d === gap - 1 ? 1 : 0;
							}
							if (enabled) {
								dailyTick(p);
							}
							if (p.injury.type !== "Healthy" && p.injury.gamesRemaining <= 0) {
								if (enabled) {
									onHealed(p);
								}
								p.injury = { type: "Healthy", gamesRemaining: 0 };
							}
						}
					}
					const backToBack = day - lastDay === 1;
					lastDay = day;
					const numHealthy = players.filter(
						({ p }) => p.injury.gamesRemaining === 0,
					).length;
					for (const { p, age, minutes, rank } of players) {
						if (p.injury.gamesRemaining > 0) {
							continue;
						}
						let exposure = minutes;
						if (enabled) {
							if (
								backToBack &&
								shouldRest({
									p,
									age,
									teamLoadManagement: false,
									aiControlled: true,
									numHealthy,
									rank,
								})
							) {
								rests += 1;
								continue;
							}
							exposure *= getRestrictionFactor(p.health);
							exposure *= getInjuryRiskFactor(p, backToBack);
						}
						if (rand() < PER_GAME * exposure) {
							let inj = injury(DEFAULT_LEVEL);
							if (enabled) {
								const returned = p.health?.bodyPart;
								inj = maybeSameBodyPart(p, inj);
								if (returned && injuryBodyPart(inj.type) === returned) {
									reinjuriesSamePart += 1;
								}
							}
							injuries += 1;
							p.injury = inj;
							p.injuries.push({
								season: 2025,
								games: inj.gamesRemaining,
								type: inj.type,
							});
						}
					}
				}
			}
		}
		const teamSeasons = numSeasons * 30;
		return {
			injuriesPerTeamSeason: injuries / teamSeasons,
			gamesMissedPerTeamSeason: gamesMissed / teamSeasons,
			reinjuriesSamePart,
			restsPerTeamSeason: rests / teamSeasons,
		};
	} finally {
		Math.random = origRandom;
	}
};

test("league-wide injury totals stay about the same with the setting on", () => {
	const off = simSeasons(false, 1, 10);
	const on = simSeasons(true, 1, 10);
	console.log("injuryDepth season model, per team-season", { off, on });
	const injRatio = on.injuriesPerTeamSeason / off.injuriesPerTeamSeason;
	const missedRatio =
		on.gamesMissedPerTeamSeason / off.gamesMissedPerTeamSeason;
	assert.isTrue(
		injRatio > 0.92 && injRatio < 1.08,
		`injuries ratio ${injRatio}`,
	);
	assert.isTrue(
		missedRatio > 0.88 && missedRatio < 1.12,
		`games missed ratio ${missedRatio}`,
	);
	assert.isAbove(on.reinjuriesSamePart, 0);
	assert.isAbove(on.restsPerTeamSeason, 0);
});
