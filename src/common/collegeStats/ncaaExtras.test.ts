import { assert, describe, test } from "vitest";
import { COLLEGES } from "./colleges.ts";
import { generateCollegeClass, getNcaaSchools } from "./generate.ts";
import {
	NCAA_SEASON_VERSION,
	getNitGames,
	getTeamPostseason,
	getTeamSummary,
	loser,
	ncaaResultText,
	simulateNcaaSeason,
	winner,
	type NcaaSeason,
} from "./ncaa.ts";
import {
	NUM_VOTERS,
	REGULAR_WEEKS,
	getPollHistory,
	getWeeksAtNo1,
} from "./ncaaPolls.ts";
import { NCAA_SHAPES } from "./ncaaStoryline.ts";
import { Rng, hashString } from "./rng.ts";
import { RATING_KEYS, type CollegeProspect } from "./types.ts";

const contributions = [
	{ key: "1", school: "Duke", boost: 8 },
	{ key: "2", school: "Duke", boost: 5 },
	{ key: "3", school: "Albany", boost: 4 },
	{ key: "4", school: "Kansas", boost: 6 },
];

const makeSeason = (seed = "x", version = NCAA_SEASON_VERSION) =>
	simulateNcaaSeason({ seed, season: 2027, contributions, version });

const SCHOOLS = Object.keys(COLLEGES);

// A class's worth of prospects spread over the schools, the good programs getting more of them
const randomContributions = (seed: string) => {
	const rng = new Rng(seed);
	return Array.from({ length: 70 }, (_, k) => ({
		key: String(k),
		school: SCHOOLS[Math.floor(rng.random() ** 2.2 * SCHOOLS.length)]!,
		boost: Math.max(0.5, Math.min(7, 2.2 + 2 * rng.normal())),
	}));
};

describe("season versions", () => {
	test("a season stored before version 2 is replayed exactly as it was", () => {
		// What the simulation gave before the weekly polls, the NIT and the storylines existed: a hash of the whole season as it was then, and the champion
		const golden: [string, number, string][] = [
			["g0", 1572174054, "Vanderbilt"],
			["g1", 515579271, "Wisconsin"],
			["g2", 648609530, "Duke"],
		];
		for (const [seed, hash, champion] of golden) {
			const season = makeSeason(seed, 1);
			const old = {
				season: season.season,
				teams: season.teams.map(
					({ netRank: _netRank, nitSeed: _nitSeed, nit: _nit, ...t }) => t,
				),
				conferences: season.conferences,
				ap: season.ap,
				tournament: season.tournament,
			};
			assert.strictEqual(hashString(JSON.stringify(old)), hash, seed);
			assert.strictEqual(
				season.teams[season.tournament.champion]!.school,
				champion,
			);
			// The new views are there, around the old results
			assert.strictEqual(season.version, 1);
			assert.strictEqual(season.storyline.shape, "standard");
			assert.strictEqual(season.polls.length, REGULAR_WEEKS + 2);
			assert.isFalse(season.nit.counted);
			assert.isAbove(season.storyline.summary.length, 2);
		}
	});

	test("deterministic for both versions, and the versions differ", () => {
		for (const version of [1, 2]) {
			assert.deepStrictEqual(
				makeSeason("d", version),
				makeSeason("d", version),
			);
		}
		assert.notStrictEqual(
			JSON.stringify(makeSeason("d", 1).tournament),
			JSON.stringify(makeSeason("d", 2).tournament),
		);
		assert.strictEqual(makeSeason("d").version, NCAA_SEASON_VERSION);
	});
});

describe("NIT", () => {
	const check = (season: NcaaSeason) => {
		const { nit, teams } = season;
		assert.strictEqual(nit.field.length, 32);
		assert.strictEqual(new Set(nit.field).size, 32);
		for (const t of nit.field) {
			// No team is in both tournaments
			assert.isUndefined(teams[t]!.bid, teams[t]!.school);
			assert.isUndefined(teams[t]!.ncaa);
			assert.isDefined(teams[t]!.nit);
			assert.isAtLeast(teams[t]!.nitSeed!, 1);
			assert.isAtMost(teams[t]!.nitSeed!, 8);
		}
		assert.strictEqual(teams.filter((t) => t.nitSeed !== undefined).length, 32);
		// Every regular season champion that missed the NCAA tournament is in
		const owed = teams
			.map((t, i) => (t.confRank === 1 && t.bid === undefined ? i : -1))
			.filter((i) => i >= 0);
		assert.sameMembers(nit.autoBids, owed);
		for (const t of owed) {
			assert.include(nit.field, t);
			assert.notStrictEqual(teams[t]!.confTourney, "Champion");
		}

		const games = getNitGames(nit);
		assert.strictEqual(games.length, 31);
		const losers = new Set<number>();
		for (const [, game] of games) {
			assert.notStrictEqual(game.scoreA, game.scoreB);
			assert.include(nit.field, game.a);
			assert.include(nit.field, game.b);
			assert.isFalse(losers.has(game.a));
			assert.isFalse(losers.has(game.b));
			losers.add(loser(game));
		}
		assert.strictEqual(losers.size, 31);
		assert.isFalse(losers.has(nit.champion));
		assert.strictEqual(winner(nit.final), nit.champion);
		assert.strictEqual(teams[nit.champion]!.nit, "Champion");
		assert.strictEqual(teams.filter((t) => t.nit === "Champion").length, 1);

		assert.strictEqual(nit.regions.length, 4);
		for (const rounds of nit.regions) {
			assert.deepStrictEqual(
				rounds.map((r) => r.length),
				[4, 2, 1],
			);
			assert.sameMembers(
				rounds[0]!.flatMap((game) => [game.seedA, game.seedB]),
				[1, 2, 3, 4, 5, 6, 7, 8],
			);
			for (const game of rounds[0]!) {
				assert.strictEqual(game.seedA + game.seedB, 9);
			}
			for (let r = 1; r < 3; r++) {
				for (const [i, game] of rounds[r]!.entries()) {
					assert.sameMembers(
						[game.a, game.b],
						[rounds[r - 1]![2 * i]!, rounds[r - 1]![2 * i + 1]!].map(winner),
					);
				}
			}
		}
		assert.sameMembers(
			nit.semis.flatMap((game) => [game.a, game.b]),
			nit.regions.map((rounds) => winner(rounds[2]![0]!)),
		);
		assert.sameMembers([nit.final.a, nit.final.b], nit.semis.map(winner));
	};

	test("32 teams left out of the NCAA tournament, a valid bracket, one champion", () => {
		for (const seed of ["a", "b", "c", "d", "e", "f"]) {
			check(makeSeason(seed));
			check(makeSeason(seed, 1));
		}
	});

	test("its games count in records and postseason lines from version 2 only", () => {
		const season = makeSeason("n");
		assert.isTrue(season.nit.counted);
		let w = 0;
		let l = 0;
		for (const [i, t] of season.teams.entries()) {
			w += t.w;
			l += t.l;
			const post = getTeamPostseason(season, i);
			const nitGames = post.filter((game) => game.event === "nit");
			if (t.nitSeed === undefined) {
				assert.strictEqual(nitGames.length, 0);
				assert.isUndefined(getTeamSummary(season, i).nit);
				continue;
			}
			assert.isAtLeast(nitGames.length, 1);
			// Out with the first loss, or five wins
			const wins = nitGames.filter(({ game }) => winner(game) === i).length;
			assert.strictEqual(wins, t.nit === "Champion" ? 5 : nitGames.length - 1);
			assert.strictEqual(getTeamSummary(season, i).nit, t.nit);
			// Conference tournament games come first
			assert.isFalse(
				post
					.slice(post.findIndex((game) => game.event === "nit"))
					.some((game) => game.event !== "nit"),
			);
		}
		assert.strictEqual(w, l);

		// Before version 2 the same class's records are what they were without the NIT
		const old = makeSeason("n", 1);
		const champ = old.nit.champion;
		assert.isFalse(
			getTeamPostseason(old, champ).some((game) => game.event === "nit"),
		);
		assert.isUndefined(getTeamSummary(old, champ).nit);
		assert.strictEqual(
			ncaaResultText({ nit: "Semifinals", nitSeed: 3 }),
			"NIT Semifinals (seed 3)",
		);
		assert.strictEqual(
			ncaaResultText({ ncaa: "Round of 64", ncaaSeed: 12 }),
			"Round of 64 (seed 12)",
		);
		assert.isUndefined(ncaaResultText({}));
	});
});

describe("weekly AP poll", () => {
	test("19 polls of 25, points add up, the final one is the AP Top 25", () => {
		for (const version of [1, 2]) {
			const season = makeSeason("p", version);
			const { polls } = season;
			assert.strictEqual(polls.length, REGULAR_WEEKS + 2);
			assert.strictEqual(polls[0]!.label, "Preseason");
			assert.strictEqual(polls.at(-1)!.label, "Final");
			for (const [i, poll] of polls.entries()) {
				assert.strictEqual(poll.week, i);
				assert.strictEqual(poll.ranked.length, 25);
				for (let k = 1; k < 25; k++) {
					assert.isAtMost(poll.ranked[k]!.pts, poll.ranked[k - 1]!.pts);
				}
				assert.strictEqual(
					poll.ranked.reduce((sum, e) => sum + e.firstPlace, 0),
					NUM_VOTERS,
				);
				// Every ballot gives 25 + 24 + ... + 1 points
				assert.strictEqual(
					poll.ranked.reduce((sum, e) => sum + e.pts, 0) +
						poll.others.reduce((sum, e) => sum + e.pts, 0),
					NUM_VOTERS * 325,
				);
				const ranked = new Set(poll.ranked.map((e) => e.team));
				assert.strictEqual(ranked.size, 25);
				for (const other of poll.others) {
					assert.isFalse(ranked.has(other.team));
					assert.isAtMost(other.pts, poll.ranked[24]!.pts);
				}
				if (i === 0) {
					for (const e of poll.ranked) {
						assert.strictEqual(e.w + e.l, 0);
						assert.isUndefined(e.prev);
					}
					continue;
				}
				const prev = polls[i - 1]!;
				for (const e of poll.ranked) {
					const index = prev.ranked.findIndex((x) => x.team === e.team);
					assert.strictEqual(e.prev, index < 0 ? undefined : index + 1);
					if (index >= 0) {
						// Records only grow
						assert.isAtLeast(e.w, prev.ranked[index]!.w);
						assert.isAtLeast(e.l, prev.ranked[index]!.l);
					}
				}
				assert.sameMembers(
					poll.dropped,
					prev.ranked.map((e) => e.team).filter((t) => !ranked.has(t)),
				);
			}

			// The final poll is the one the season has always had
			assert.deepStrictEqual(
				polls.at(-1)!.ranked.map(({ prev: _prev, ...e }) => e),
				season.ap,
			);
			for (const [i, e] of season.ap.entries()) {
				assert.strictEqual(season.teams[e.team]!.apRank, i + 1);
			}

			const no1 = getWeeksAtNo1(polls);
			assert.strictEqual(
				no1.reduce((sum, row) => sum + row.weeks, 0),
				polls.length,
			);
			const history = getPollHistory(polls);
			for (const row of history) {
				assert.strictEqual(row.ranks.length, polls.length);
				assert.strictEqual(row.weeks, row.ranks.filter((r) => r > 0).length);
			}
			assert.strictEqual(
				history.reduce((sum, row) => sum + row.weeks, 0),
				25 * polls.length,
			);
		}
	});

	test("polls follow results: losing does not move a team up, winning does not sink it, the preseason poll means something", () => {
		let losers = 0;
		let losersUp = 0;
		let winners = 0;
		let winnersDown = 0;
		let preseason = 0;
		let preseasonInField = 0;
		for (let i = 0; i < 12; i++) {
			const season = simulateNcaaSeason({
				seed: `poll${i}`,
				season: 2027,
				contributions: randomContributions(`poll${i}`),
			});
			// The weekly polls, not the final one (after the conference tournaments nearly every team has just lost)
			for (let week = 1; week <= REGULAR_WEEKS; week++) {
				const prev = season.polls[week - 1]!;
				for (const [rank, e] of season.polls[week]!.ranked.entries()) {
					if (e.prev === undefined) {
						continue;
					}
					const before = prev.ranked[e.prev - 1]!;
					const wins = e.w - before.w;
					const losses = e.l - before.l;
					if (wins === 0 && losses > 0) {
						losers += 1;
						// Only by teams above it losing more, so never by much
						assert.isAtMost(e.prev - (rank + 1), 3);
						if (e.prev > rank + 1) {
							losersUp += 1;
						}
					} else if (losses === 0 && wins > 0) {
						winners += 1;
						if (rank + 1 - e.prev >= 4) {
							winnersDown += 1;
						}
					}
				}
			}
			for (const e of season.polls[0]!.ranked) {
				preseason += 1;
				if (season.teams[e.team]!.bid) {
					preseasonInField += 1;
				}
			}
			// A preseason No. 1 is one of the best teams there is
			const top = season.teams[season.polls[0]!.ranked[0]!.team]!;
			assert.isAbove(top.w, top.l);
		}
		assert.isAbove(losers, 200);
		assert.isBelow(losersUp / losers, 0.05);
		assert.isBelow(winnersDown / winners, 0.05);
		assert.isAbove(preseasonInField / preseason, 0.7);
	});
});

describe("selection", () => {
	test("NET ranks every team, quadrant records add up to the games it ranks", () => {
		const season = makeSeason("s");
		const ranks = season.net.map((net) => net.rank).sort((a, b) => a - b);
		assert.deepStrictEqual(
			ranks,
			season.teams.map((_, i) => i + 1),
		);
		for (const [i, t] of season.teams.entries()) {
			const net = season.net[i]!;
			assert.strictEqual(t.netRank, net.rank);
			const games = net.quads.reduce((sum, q) => sum + q[0] + q[1], 0);
			// Regular season and conference tournament: everything before the NCAA tournament and the NIT
			const later = getTeamPostseason(season, i).filter(
				(game) => game.event !== "conf",
			).length;
			assert.strictEqual(games, t.w + t.l - later, t.school);
		}
		// The best teams by the NET are good teams
		const top = season.teams.filter((t) => t.netRank! <= 10);
		for (const t of top) {
			assert.isAbove(t.w / (t.w + t.l), 0.65, t.school);
		}
	});

	test("the bubble matches the field", () => {
		for (const version of [1, 2]) {
			for (const seed of ["a", "b", "c", "d", "e"]) {
				const season = makeSeason(seed, version);
				const { selection, teams, tournament } = season;
				assert.strictEqual(selection.field.length, 68);
				assert.strictEqual(new Set(selection.field).size, 68);
				for (const t of selection.field) {
					assert.isDefined(teams[t]!.bid);
				}
				// Seed lines follow the committee's order
				assert.strictEqual(teams[selection.field[0]!]!.ncaaSeed, 1);

				assert.strictEqual(selection.lastFourIn.length, 4);
				assert.strictEqual(selection.lastFourByes.length, 4);
				assert.strictEqual(selection.firstFourOut.length, 4);
				assert.strictEqual(selection.nextFourOut.length, 4);
				for (const t of [...selection.lastFourIn, ...selection.lastFourByes]) {
					assert.strictEqual(teams[t]!.bid, "at-large");
				}
				// The last four in are the at-large teams in the First Four
				const firstFourAtLarge = tournament.firstFour
					.flatMap((game) => [game.a, game.b])
					.filter((t) => teams[t]!.bid === "at-large");
				assert.sameMembers(selection.lastFourIn, firstFourAtLarge);
				for (const t of selection.lastFourByes) {
					assert.notInclude(firstFourAtLarge, t);
				}
				const out = [...selection.firstFourOut, ...selection.nextFourOut];
				assert.strictEqual(new Set(out).size, 8);
				for (const t of out) {
					assert.isUndefined(teams[t]!.bid);
					assert.isUndefined(teams[t]!.ncaa);
				}
				// The first teams out are the top of the NIT
				for (const t of selection.firstFourOut) {
					assert.include(season.nit.field, t);
				}
				for (const { team, reason } of selection.snubs) {
					assert.isUndefined(teams[team]!.bid);
					assert.isAbove(reason.length, 0);
				}
				for (const t of selection.bidThieves) {
					assert.strictEqual(teams[t]!.bid, "auto");
					assert.isTrue(
						teams.some(
							(other) =>
								other.bid === "at-large" && other.conf === teams[t]!.conf,
						),
					);
				}
			}
		}
	});
});

describe("storylines", () => {
	test("calibration over many seeds: shapes differ, the long run stays sensible", () => {
		const N = 320;
		const stats = new Map<
			string,
			{ n: number; oneSeed: number; no1s: number; ppg: number }
		>();
		const add = (key: string, season: NcaaSeason) => {
			const row = stats.get(key) ?? { n: 0, oneSeed: 0, no1s: 0, ppg: 0 };
			row.n += 1;
			if (season.teams[season.tournament.champion]!.ncaaSeed === 1) {
				row.oneSeed += 1;
			}
			row.no1s += getWeeksAtNo1(season.polls).length;
			row.ppg += season.ppg;
			stats.set(key, row);
		};
		let sixteens = 0;
		let unbeaten = 0;
		let unbeatenChampions = 0;
		for (let i = 0; i < N; i++) {
			const season = simulateNcaaSeason({
				seed: `cal${i}`,
				season: 2027,
				contributions: randomContributions(`c${i}`),
			});
			const { storyline } = season;
			add("all", season);
			add(storyline.shape, season);
			add(`scoring:${storyline.scoring}`, season);

			// The bends stay inside realistic bounds
			assert.isAtLeast(storyline.marginSd, 10.5);
			assert.isAtMost(storyline.marginSd, 12.5);
			assert.isAtLeast(storyline.tourneySd, 8);
			assert.isAtMost(storyline.tourneySd, 11);
			assert.isAtLeast(storyline.total, 130);
			assert.isAtMost(storyline.total, 152);
			assert.isAbove(storyline.headline.length, 0);
			assert.isAtLeast(storyline.summary.length, 4);
			for (const sentence of storyline.summary) {
				assert.notMatch(sentence, /undefined|NaN/);
			}

			for (const rounds of season.tournament.regions) {
				for (const game of rounds[0]!) {
					const w = winner(game);
					if ((w === game.a ? game.seedA : game.seedB) === 16) {
						sixteens += 1;
					}
				}
			}
			if (season.ap.some((e) => e.l === 0)) {
				unbeaten += 1;
			}
			if (season.teams[season.tournament.champion]!.l === 0) {
				unbeatenChampions += 1;
			}
		}
		const get = (key: string) => stats.get(key)!;

		// Every shape and scoring environment comes up
		for (const shape of Object.keys(NCAA_SHAPES)) {
			assert.isAbove(get(shape)?.n ?? 0, 10, shape);
		}

		// 1 seeds win the title a little under 60% of the time (real life: about 64% since the field went to 64)
		const oneSeed = get("all").oneSeed / N;
		assert.isAbove(oneSeed, 0.5);
		assert.isBelow(oneSeed, 0.68);
		// A 16 over a 1 about once in 20 years (4 such games a year), an unbeaten team on Selection Sunday about once a decade, an unbeaten champion once in a generation
		assert.isBelow(sixteens / (4 * N), 0.03);
		assert.isBelow(unbeaten / N, 0.15);
		assert.isBelow(unbeatenChampions / N, 0.06);

		// The shapes bend the season the way they say
		const rate = (key: string) => get(key).oneSeed / get(key).n;
		const no1s = (key: string) => get(key).no1s / get(key).n;
		const ppg = (key: string) => get(key).ppg / get(key).n;
		assert.isAbove(rate("dominant"), rate("wideOpen"));
		assert.isAbove(rate("chalk"), rate("wideOpen"));
		assert.isAbove(no1s("wideOpen"), no1s("dominant") + 0.5);
		assert.isAbove(ppg("scoring:explosion"), ppg("scoring:normal") + 3);
		assert.isBelow(ppg("scoring:slog"), ppg("scoring:normal") - 3);
		assert.isAbove(ppg("scoring:normal"), 68);
		assert.isBelow(ppg("scoring:normal"), 74);
	}, 300_000);

	test("a loaded conference gets more teams in, a dominant favorite is the best team", () => {
		let loaded = 0;
		let dominant = 0;
		for (let i = 0; i < 80 && (loaded < 3 || dominant < 3); i++) {
			const args = {
				seed: `shape${i}`,
				season: 2027,
				contributions: randomContributions(`s${i}`),
			};
			const season = simulateNcaaSeason(args);
			const { storyline } = season;
			if (storyline.shape === "loadedConference") {
				loaded += 1;
				// Same class without the storyline: the conference is not as good
				const plain = simulateNcaaSeason({ ...args, version: 1 });
				const strength = (s: NcaaSeason) =>
					s.teams
						.filter((t) => t.conf === storyline.conf)
						.reduce((sum, t) => sum + t.rating, 0);
				assert.isAbove(strength(season), strength(plain));
				assert.include(storyline.summary[0]!, storyline.conf!);
			} else if (storyline.shape === "dominant") {
				dominant += 1;
				const fav = storyline.teams[0]!;
				const best = Math.max(...season.teams.map((t) => t.rating));
				assert.strictEqual(season.teams[fav]!.rating, best);
				assert.include(storyline.summary[0]!, season.teams[fav]!.school);
			}
		}
		assert.isAtLeast(loaded, 3);
		assert.isAtLeast(dominant, 3);
	}, 120_000);
});

const makeProspects = (n: number): CollegeProspect[] => {
	const rng = new Rng("nit prospects");
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
			// Every school has one, so the NIT's teams do too
			college: SCHOOLS[i % SCHOOLS.length]!,
			bornLoc: "Chicago, IL, USA",
		};
	});
};

describe("generateCollegeClass with the NIT", () => {
	test("prospects on NIT teams play its games, which are part of their season, and get its honors", () => {
		const prospects = makeProspects(SCHOOLS.length);
		const honors = new Set<string>();
		// The NIT's Most Outstanding Player has to be good enough, so not every class has one
		for (const seed of ["nit", "nit2", "nit3", "nit4"]) {
			checkClass(prospects, seed, honors);
		}
		assert.include([...honors], "College: NIT Champion");
		assert.include([...honors], "College: NIT Most Outstanding Player");
		assert.include([...honors], "College: NIT All-Tournament Team");
	});
});

const checkClass = (
	prospects: CollegeProspect[],
	seed: string,
	honors: Set<string>,
) => {
	{
		const options = { seed, draftYear: 2027 };
		const schools = getNcaaSchools(prospects, options);
		const ncaaSeason = simulateNcaaSeason({
			seed,
			season: 2027,
			contributions: [...schools].map(([key, school]) => ({
				key,
				school,
				boost: 3,
			})),
		});
		const results = generateCollegeClass(prospects, { ...options, ncaaSeason });

		let numNit = 0;
		for (const result of results) {
			const ncaa = result.ncaa!;
			const team = ncaaSeason.teams.find((t) => t.school === ncaa.school)!;
			const nitGames = ncaa.games.filter((game) => game.event === "nit");
			const last = result.seasons.at(-1)!;
			assert.strictEqual(last.teamGames, team.w + team.l);
			if (team.nitSeed === undefined) {
				assert.strictEqual(nitGames.length, 0);
				assert.isUndefined(ncaa.nit);
				continue;
			}
			numNit += 1;
			assert.strictEqual(ncaa.nit, team.nit);
			assert.strictEqual(ncaa.nitSeed, team.nitSeed);
			assert.isUndefined(ncaa.ncaa);
			assert.isAtLeast(nitGames.length, 1);
			for (const game of nitGames) {
				assert.isDefined(game.seed);
				assert.isDefined(game.oppSeed);
			}
			// The result matches the games
			assert.strictEqual(
				nitGames.at(-1)!.won,
				team.nit === "Champion",
				ncaa.school,
			);
			// Non-conference + conference + postseason (NIT included) = his season
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
			for (const honor of result.honors) {
				if (honor.type.includes("NIT")) {
					honors.add(honor.type);
					if (honor.type === "College: NIT Champion") {
						assert.strictEqual(team.nit, "Champion");
					}
				}
			}
		}
		assert.strictEqual(numNit, 32);
	}
};
