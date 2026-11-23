import { assert, describe, test } from "vitest";
import {
	MOV_SCALE,
	PLAYOFF_ROUND_WEIGHT,
	STRENGTH_WEIGHT,
	explainPowerRankings,
	getPowerRankingsParts,
	getPowerRankingsScore,
	sumPowerRankingsParts,
	parseLastTen,
	playoffScore,
} from "./powerRankings.ts";
import { MOV_PRIOR_GAMES, teamStrength } from "../core/seasonOdds/strength.ts";

describe("power rankings score", () => {
	test("parses last ten records", () => {
		assert.deepEqual(parseLastTen("7-3"), { won: 7, played: 10 });
		assert.deepEqual(parseLastTen("2-1"), { won: 2, played: 3 });
		assert.deepEqual(parseLastTen("5-3-2"), { won: 5, played: 10 });
		assert.deepEqual(parseLastTen("0-0"), { won: 0, played: 0 });
		assert.deepEqual(parseLastTen(""), { won: 0, played: 0 });
	});

	test("score is twice the shared strength plus the last ten (-10 + 2 * wins)", () => {
		const base = {
			mov: 4,
			gp: 41,
			ovr: 55,
		};
		const { strength } = teamStrength(base);
		for (let won = 0; won <= 10; won++) {
			const score = getPowerRankingsScore({
				...base,
				lastTen: `${won}-${10 - won}`,
			});
			assert.closeTo(score, STRENGTH_WEIGHT * strength + (-10 + 2 * won), 1e-9);
		}
	});

	test("strength blends roster and margin, margin taking over as games are played", () => {
		// ovr 60 is +3 points per game, ovr 50 is average
		assert.closeTo(teamStrength({ ovr: 60, mov: 0, gp: 0 }).strength, 3, 1e-9);
		assert.closeTo(
			teamStrength({ ovr: 50, mov: 5, gp: MOV_PRIOR_GAMES }).strength,
			2.5 * MOV_SCALE,
			1e-9,
		);
		assert.isAbove(
			teamStrength({ ovr: 50, mov: 5, gp: 82 }).strength,
			teamStrength({ ovr: 50, mov: 5, gp: 20 }).strength,
		);
	});

	test("parts add up, injuries are what the injury-aware rating takes off", () => {
		const parts = getPowerRankingsParts({
			mov: 2,
			gp: 30,
			ovr: 52,
			ovrHealthy: 58,
			lastTen: "6-4",
		});
		assert.isBelow(parts.injuries, 0);
		assert.isAbove(parts.roster, 0);
		assert.closeTo(
			sumPowerRankingsParts(parts),
			getPowerRankingsScore({ mov: 2, gp: 30, ovr: 52, lastTen: "6-4" }),
			1e-9,
		);
	});

	test("why: parts against the league average, roster hidden under No Visible Ratings", () => {
		const zero = { roster: 0, injuries: 0, results: 0, form: 0, playoffs: 0 };
		const teams = [
			{ parts: { ...zero, roster: 10, form: -6 } },
			{ parts: { ...zero, roster: -10, form: 6 } },
		];
		const [a, b] = explainPowerRankings(teams, false);
		assert.strictEqual(a!.parts[0]!.key, "roster");
		assert.strictEqual(a!.text, "Lifted by roster, held back by recent form.");
		assert.strictEqual(b!.text, "Lifted by recent form, held back by roster.");
		const [c] = explainPowerRankings(teams, true);
		assert.isFalse(c!.parts.some((part) => part.key === "roster"));
		assert.strictEqual(c!.text, "Held back by recent form.");
	});

	test("last ten is normalized by games played", () => {
		const base = { mov: 0, gp: 3, ovr: 50 };
		const unbeaten = getPowerRankingsScore({ ...base, lastTen: "3-0" });
		const tenAndOh = getPowerRankingsScore({ ...base, lastTen: "10-0" });
		assert.closeTo(unbeaten, tenAndOh, 1e-9);
		// No games: no recent record term at all (not -10)
		const none = getPowerRankingsScore({ ...base, gp: 0, lastTen: "0-0" });
		assert.closeTo(none, 0, 1e-9);
		// A 2-1 team ranks above a 1-2 team with everything else equal
		assert.isAbove(
			getPowerRankingsScore({ ...base, lastTen: "2-1" }),
			getPowerRankingsScore({ ...base, lastTen: "1-2" }),
		);
	});

	test("rating term uses the rating passed (callers pass the injury-aware one)", () => {
		const base = { mov: 0, gp: 0, lastTen: "0-0" };
		assert.isAbove(
			getPowerRankingsScore({ ...base, ovr: 60 }),
			getPowerRankingsScore({ ...base, ovr: 50 }),
		);
	});

	test("MOV scale is 1 in basketball", () => {
		if (__SPORT === "basketball") {
			assert.strictEqual(MOV_SCALE, 1);
		} else if (__SPORT === "hockey" || __SPORT === "baseball") {
			assert.isAbove(MOV_SCALE, 1);
		}
	});

	test("playoff results: nothing for teams out of the playoffs, rounds and record for the rest", () => {
		const base = {
			mov: 3,
			gp: 82,
			ovr: 55,
			lastTen: "6-4",
		};
		const without = getPowerRankingsScore(base);
		assert.strictEqual(
			getPowerRankingsScore({
				...base,
				playoffs: { roundsWon: -1, won: 0, lost: 0, mov: 0 },
			}),
			without,
		);

		// Champion 16-4 with +8 margin beats a first round exit 1-4 with -6 margin
		const champ = playoffScore({ roundsWon: 4, won: 16, lost: 4, mov: 8 });
		const out = playoffScore({ roundsWon: 0, won: 1, lost: 4, mov: -6 });
		assert.isAbove(champ, 4 * PLAYOFF_ROUND_WEIGHT);
		assert.isBelow(out, 0);
		assert.isAbove(champ - out, 20);

		// A sweep in the first two games counts, but less than over a whole series
		const twoGames = playoffScore({ roundsWon: 0, won: 2, lost: 0, mov: 10 });
		const fourGames = playoffScore({ roundsWon: 1, won: 4, lost: 0, mov: 10 });
		assert.isAbove(twoGames, 0);
		assert.isAbove(fourGames, twoGames + PLAYOFF_ROUND_WEIGHT);
	});
});
