import { assert, describe, test } from "vitest";
import { COLLEGES, CONFERENCES } from "./colleges.ts";
import { generateCollegeClass, getNcaaSchools } from "./generate.ts";
import {
	getProspectBoost,
	getTeamPostseason,
	loser,
	ncaaResultText,
	seedOrder,
	simulateNcaaSeason,
	winner,
	type NcaaGame,
	type NcaaSeason,
} from "./ncaa.ts";
import { Rng } from "./rng.ts";
import { RATING_KEYS, type CollegeProspect } from "./types.ts";

const contributions = [
	{ key: "1", school: "Duke", boost: 8 },
	{ key: "2", school: "Duke", boost: 5 },
	{ key: "3", school: "Albany", boost: 4 },
	{ key: "4", school: "Kansas", boost: 6 },
];

const makeSeason = (seed = "x") =>
	simulateNcaaSeason({ seed, season: 2027, contributions });

// Every real game of the NCAA tournament, in order
const ncaaGames = (season: NcaaSeason) => [
	...season.tournament.firstFour,
	...season.tournament.regions.flat().flat(),
	...season.tournament.finalFour,
	season.tournament.final,
];

describe("simulateNcaaSeason", () => {
	test("deterministic per seed, and contributions order does not matter", () => {
		const a = makeSeason();
		const b = simulateNcaaSeason({
			seed: "x",
			season: 2027,
			contributions: [...contributions].reverse(),
		});
		assert.deepStrictEqual(a, b);
		assert.notDeepEqual(
			JSON.stringify(a),
			JSON.stringify(makeSeason("other seed")),
		);
	});

	test("every school plays, records add up", () => {
		const season = makeSeason();
		assert.strictEqual(season.teams.length, Object.keys(COLLEGES).length);
		let w = 0;
		let l = 0;
		for (const t of season.teams) {
			w += t.w;
			l += t.l;
			assert.isAtLeast(t.w + t.l, 25, t.school);
			assert.isAtMost(t.w + t.l, 42, t.school);
			assert.isAtLeast(t.confW + t.confL, 12, t.school);
		}
		assert.strictEqual(w, l);
		// Conference records are balanced inside each conference
		for (const conf of season.conferences) {
			let cw = 0;
			let cl = 0;
			for (const t of conf.standings) {
				cw += season.teams[t]!.confW;
				cl += season.teams[t]!.confL;
			}
			assert.strictEqual(cw, cl, conf.name);
		}
	});

	test("68 team field: 32 auto bids from conference tournament champions, 36 at-large, seeds 1-16 in 4 regions", () => {
		const season = makeSeason();
		const field = season.teams.filter((t) => t.bid !== undefined);
		assert.strictEqual(field.length, 68);
		const auto = field.filter((t) => t.bid === "auto");
		assert.strictEqual(auto.length, season.conferences.length);
		assert.strictEqual(season.conferences.length, 32);
		assert.strictEqual(field.length - auto.length, 36);
		for (const conf of season.conferences) {
			const champ = season.teams[conf.champion]!;
			assert.strictEqual(champ.bid, "auto");
			assert.strictEqual(champ.conf, conf.name);
			assert.strictEqual(champ.confTourney, "Champion");
			assert.strictEqual(winner(conf.tourney.at(-1)![0]!), conf.champion);
			assert.isDefined(CONFERENCES[conf.name]);
		}

		// 4 teams per seed line, plus the First Four's extra 2 teams on two lines
		const perLine = new Map<number, number>();
		for (const t of field) {
			assert.isDefined(t.ncaaSeed);
			assert.isDefined(t.region);
			perLine.set(t.ncaaSeed!, (perLine.get(t.ncaaSeed!) ?? 0) + 1);
		}
		for (let line = 1; line <= 16; line++) {
			assert.strictEqual(
				perLine.get(line),
				line === 11 || line === 16 ? 6 : 4,
				`line ${line}`,
			);
		}
		const ff = season.tournament.firstFour;
		assert.strictEqual(ff.length, 4);
		for (const game of ff) {
			assert.strictEqual(season.teams[game.a]!.ncaaSeed, game.seed);
			assert.strictEqual(season.teams[game.b]!.ncaaSeed, game.seed);
		}
		assert.sameMembers(
			ff.map((game) => game.seed),
			[11, 11, 16, 16],
		);
	});

	test("bracket is valid: each team plays until it loses, one champion", () => {
		const season = makeSeason();
		const games = ncaaGames(season);
		assert.strictEqual(games.length, 67);
		const losses = new Map<number, number>();
		for (const game of games) {
			assert.notStrictEqual(game.scoreA, game.scoreB);
			assert.isAbove(game.b, -1);
			const l = loser(game);
			losses.set(l, (losses.get(l) ?? 0) + 1);
		}
		// 67 different losers, the champion never lost
		assert.strictEqual(losses.size, 67);
		for (const count of losses.values()) {
			assert.strictEqual(count, 1);
		}
		const champion = season.tournament.champion;
		assert.isFalse(losses.has(champion));
		assert.strictEqual(season.teams[champion]!.ncaa, "Champion");
		assert.strictEqual(
			season.teams.filter((t) => t.ncaa === "Champion").length,
			1,
		);

		// Region round of 64 has seeds 1-16 once each, and the seeds always add to 17
		for (const rounds of season.tournament.regions) {
			assert.strictEqual(rounds.length, 4);
			assert.deepStrictEqual(
				rounds.map((r) => r.length),
				[8, 4, 2, 1],
			);
			for (const game of rounds[0]!) {
				assert.strictEqual(game.seedA + game.seedB, 17);
			}
			// Winners advance
			for (let r = 1; r < 4; r++) {
				for (const [i, game] of rounds[r]!.entries()) {
					const prev = [rounds[r - 1]![2 * i]!, rounds[r - 1]![2 * i + 1]!];
					assert.sameMembers([game.a, game.b], prev.map(winner));
				}
			}
		}
		const [semi1, semi2] = season.tournament.finalFour as [NcaaGame, NcaaGame];
		assert.sameMembers(
			[season.tournament.final.a, season.tournament.final.b],
			[winner(semi1), winner(semi2)],
		);
	});

	test("conference tournaments: every team in, single winner", () => {
		const season = makeSeason();
		for (const conf of season.conferences) {
			const teamsIn = new Set<number>();
			for (const game of conf.tourney[0]!) {
				teamsIn.add(game.a);
				if (game.b >= 0) {
					teamsIn.add(game.b);
				}
			}
			assert.strictEqual(
				teamsIn.size,
				conf.name === "Ivy" ? 4 : conf.standings.length,
				conf.name,
			);
			assert.strictEqual(conf.tourney.at(-1)!.length, 1);
		}
	});

	test("AP Top 25", () => {
		const season = makeSeason();
		assert.strictEqual(season.ap.length, 25);
		for (let i = 1; i < 25; i++) {
			assert.isAtMost(season.ap[i]!.pts, season.ap[i - 1]!.pts);
		}
		assert.strictEqual(
			season.ap.reduce((sum, e) => sum + e.firstPlace, 0),
			62,
		);
	});

	test("prospects make their teams better", () => {
		let withBoost = 0;
		let without = 0;
		for (let i = 0; i < 5; i++) {
			const a = simulateNcaaSeason({
				seed: `s${i}`,
				season: 2027,
				contributions: [{ key: "1", school: "Albany", boost: 20 }],
			});
			const b = simulateNcaaSeason({
				seed: `s${i}`,
				season: 2027,
				contributions: [],
			});
			const albany = (s: NcaaSeason) =>
				s.teams.find((t) => t.school === "Albany")!;
			withBoost += albany(a).w;
			without += albany(b).w;
		}
		assert.isAbove(withBoost, without);
		assert.isAbove(getProspectBoost(2), getProspectBoost(0));
	});

	test("seedOrder pairs top and bottom seeds", () => {
		assert.deepStrictEqual(seedOrder(4), [1, 4, 2, 3]);
		const order = seedOrder(16);
		for (let i = 0; i < 16; i += 2) {
			assert.strictEqual(order[i]! + order[i + 1]!, 17);
		}
		assert.strictEqual(
			ncaaResultText({ ncaa: "Elite Eight", ncaaSeed: 3 }),
			"Elite Eight (seed 3)",
		);
	});
});

const makeProspects = (n: number): CollegeProspect[] => {
	const rng = new Rng("ncaa prospects");
	return Array.from({ length: n }, (_, i) => {
		const talent = rng.normal(0, 1);
		const ratings: any = {};
		for (const key of RATING_KEYS) {
			ratings[key] = Math.max(
				5,
				Math.min(95, 40 + 9 * talent + 8 * rng.normal()),
			);
		}
		return {
			key: String(i),
			age: 19 + (i % 4),
			ovr: Math.round(44 + 8 * talent),
			pot: 60,
			pos: "SF",
			ratings,
			college: ["Duke", "Kansas", "Gonzaga", "Albany", "", "Yale"][i % 6]!,
			bornLoc: "Chicago, IL, USA",
		};
	});
};

describe("generateCollegeClass with a college season", () => {
	test("draft year season includes his team's games and his postseason games, with consistent totals", () => {
		const prospects = makeProspects(60);
		const options = { seed: "x", draftYear: 2027 };
		const schools = getNcaaSchools(prospects, options);
		const ncaaSeason = simulateNcaaSeason({
			seed: "x",
			season: 2027,
			contributions: [...schools].map(([key, school]) => ({
				key,
				school,
				boost: 4,
			})),
		});
		const results = generateCollegeClass(prospects, {
			...options,
			ncaaSeason,
		});
		const again = generateCollegeClass(prospects, {
			...options,
			ncaaSeason,
		});
		assert.deepStrictEqual(results, again);

		let numWithGames = 0;
		let numTourneyHonors = 0;
		for (const result of results) {
			if (!schools.has(result.key)) {
				assert.isUndefined(result.ncaa);
				continue;
			}
			const ncaa = result.ncaa!;
			assert.strictEqual(ncaa.school, result.school);
			const team = ncaaSeason.teams.find((t) => t.school === ncaa.school)!;
			const last = result.seasons.at(-1)!;
			assert.strictEqual(last.season, 2027);
			assert.strictEqual(last.teamGames, team.w + team.l);
			assert.isUndefined(last.postseasonBoxes);
			const post = getTeamPostseason(
				ncaaSeason,
				ncaaSeason.teams.indexOf(team),
			);
			assert.strictEqual(ncaa.games.length, post.length);
			assert.isAtLeast(last.stats.gp!, ncaa.games.length);
			assert.isAtMost(last.stats.gp!, last.teamGames);
			// Postseason lines are part of the season totals
			for (const key of ["pts", "ast", "fga", "tp"] as const) {
				const sum = ncaa.games.reduce((total, game) => total + game[key], 0);
				assert.isAtMost(sum, last.stats[key]!);
			}
			// Non-conference + conference + postseason = his season
			const splits = ncaa.splits!;
			assert.strictEqual(
				splits.nonConf.gp + splits.conf.gp + ncaa.games.length,
				last.stats.gp,
			);
			for (const key of ["pts", "ast", "fga", "tp"] as const) {
				const post = ncaa.games.reduce((total, game) => total + game[key], 0);
				assert.strictEqual(
					splits.nonConf[key] + splits.conf[key] + post,
					last.stats[key],
				);
			}
			assert.isAtMost(splits.conf.gp, team.confW + team.confL);
			if (ncaa.games.length > 0) {
				numWithGames += 1;
			}
			numTourneyHonors += result.honors.filter((h) =>
				/Tournament|NCAA|Champion/.test(h.type),
			).length;
		}
		assert.isAbove(numWithGames, 20);
		assert.isAbove(numTourneyHonors, 0);
	});

	test("without a college season, nothing changes", () => {
		const prospects = makeProspects(20);
		const results = generateCollegeClass(prospects, {
			seed: "x",
			draftYear: 2027,
		});
		for (const result of results) {
			assert.isUndefined(result.ncaa);
		}
	});
});
