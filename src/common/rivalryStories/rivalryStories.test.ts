// Rivalry Stories: aggregates against the raw games they come from, the text generators (no ratings, under the challenge or
// not), the newspaper page and the off state.
import { assert, describe, test } from "vitest";
import { buildRivalryStory, streaksOf } from "./aggregate.ts";
import { rivalryGameFromBox } from "./record.ts";
import {
	renewedText,
	rivalryContextLine,
	rivalryPreview,
	rivalryRecaps,
} from "./text.ts";
import { pairOf, type RivalryGame } from "./types.ts";
import type { RivalInput } from "../rivalries/index.ts";
import { makeFixture } from "../newspaper/fixture.ts";
import { buildPaper, paperText } from "../newspaper/index.ts";
import {
	nativeFeatureDefaults,
	nativeFeatureEnabledForSport,
	nativeFeatureNewLeagueDefaults,
} from "../nativeFeatures.ts";

// Deterministic pseudo-random numbers
const rng = (seed: number) => () => {
	seed = (seed * 1103515245 + 12345) % 2147483648;
	return seed / 2147483648;
};

const NAMES = [
	"Ann Ash",
	"Bo Birch",
	"Cy Cole",
	"Di Dunn",
	"Ed Earl",
	"Flo Fox",
];

const makeGames = (seed: number, n: number, a = 2, b = 7): RivalryGame[] => {
	const r = rng(seed);
	const out: RivalryGame[] = [];
	for (let i = 0; i < n; i++) {
		const season = 2025 + Math.floor(i / 4);
		const home = r() < 0.5 ? a : b;
		const away = home === a ? b : a;
		const hPts = 90 + Math.floor(r() * 30);
		let aPts = 90 + Math.floor(r() * 30);
		if (aPts === hPts) {
			aPts += 1;
		}
		const players = NAMES.map((name, j) => {
			const tid = j < 3 ? a : b;
			const fga = 5 + Math.floor(r() * 15);
			return {
				pid: j + 1,
				name,
				tid,
				min: 30,
				pts: Math.floor(r() * 45),
				trb: Math.floor(r() * 12),
				ast: Math.floor(r() * 9),
				fg: Math.floor(fga / 2),
				fga,
				dfga: 4 + Math.floor(r() * 6),
				dfgm: Math.floor(r() * 4),
				onNet: Math.floor(r() * 21) - 10,
			};
		});
		out.push({
			gid: 1000 + i,
			season,
			day: i,
			pair: pairOf(a, b),
			playoffs: false,
			home,
			away,
			hPts,
			aPts,
			ot: r() < 0.1 ? 1 : 0,
			hRec: [20, 20],
			aRec: [20, 20],
			players,
			...(r() < 0.2 ? { marquee: "nationalTv" } : {}),
			...(r() < 0.3
				? { coaches: ["Coach A", "Coach B"] as [string, string] }
				: {}),
		});
	}
	return out;
};

const inputOf = (games: RivalryGame[], a = 2, b = 7): RivalInput => {
	const seasons = [...new Set(games.map((gm) => gm.season))];
	return {
		a,
		b,
		season: Math.max(...seasons),
		series: [
			{
				season: 2026,
				round: 1,
				numRounds: 4,
				winner: b,
				loser: a,
				wWon: 4,
				wLost: 3,
				wSeed: 5,
				lSeed: 4,
			},
		],
		rs: seasons.map((season) => {
			const list = games.filter((gm) => gm.season === season);
			const won = (tid: number) =>
				list.filter((gm) =>
					gm.home === tid ? gm.hPts > gm.aPts : gm.aPts > gm.hPts,
				).length;
			return { season, aW: won(a), bW: won(b), tied: 0 };
		}),
	};
};

const name = (tid: number) => `Team${tid}`;

describe("aggregates match the raw games", () => {
	for (const seed of [1, 2, 3, 4, 5]) {
		test(`seed ${seed}`, () => {
			const games = makeGames(seed, 37);
			// Shuffled: the aggregate must not depend on the order the store returns
			const shuffled = [...games].sort(
				(x, y) => ((x.gid * 7919) % 13) - ((y.gid * 7919) % 13),
			);
			const story = buildRivalryStory({
				input: inputOf(games),
				games: shuffled,
				name,
			});
			const won = (tid: number) =>
				games.filter((gm) =>
					gm.home === tid ? gm.hPts > gm.aPts : gm.aPts > gm.hPts,
				).length;
			assert.strictEqual(story.record.rsA, won(2));
			assert.strictEqual(story.record.rsB, won(7));
			assert.strictEqual(story.record.poA, 3);
			assert.strictEqual(story.record.poB, 4);
			assert.strictEqual(story.record.seriesB, 1);
			assert.strictEqual(story.logged.games, games.length);
			assert.strictEqual(story.ot, games.filter((gm) => gm.ot > 0).length);

			// Eras add up to the whole record
			assert.strictEqual(
				story.eras.reduce((s, e) => s + e.aW, 0),
				story.record.rsA,
			);

			// Streaks, brute force over the games in order
			const order = [...games].sort((x, y) => x.gid - y.gid);
			const winners = order.map((gm) =>
				gm.hPts > gm.aPts ? gm.home : gm.away,
			);
			let cur = 0;
			for (
				let i = winners.length - 1;
				i >= 0 && winners[i] === winners.at(-1);
				i--
			) {
				cur += 1;
			}
			assert.strictEqual(story.current?.n, cur);
			assert.strictEqual(story.current?.tid, winners.at(-1));
			for (const tid of [2, 7]) {
				let best = 0;
				let run = 0;
				for (const w of winners) {
					run = w === tid ? run + 1 : 0;
					best = Math.max(best, run);
				}
				const got = story.longest.find((s) => s.tid === tid)?.n ?? 0;
				assert.strictEqual(got, best, `longest ${tid}`);
			}

			// Duels: total points per player
			for (const d of story.duels) {
				const raw = games
					.flatMap((gm) => gm.players)
					.filter((p) => p.pid === d.pid && p.tid === d.tid);
				assert.strictEqual(d.gp, raw.length);
				assert.strictEqual(
					d.pts,
					raw.reduce((s, p) => s + p.pts, 0),
				);
				assert.strictEqual(d.best, Math.max(...raw.map((p) => p.pts)));
			}
			// Defense: defended FG% per defender
			for (const d of story.defense) {
				const raw = games
					.flatMap((gm) => gm.players)
					.filter((p) => p.pid === d.pid);
				const fga = raw.reduce((s, p) => s + p.dfga!, 0);
				const fgm = raw.reduce((s, p) => s + p.dfgm!, 0);
				assert.strictEqual(d.dfga, fga);
				assert.closeTo(d.pct, fgm / fga, 1e-12);
			}
			for (const d of story.onOff) {
				const raw = games
					.flatMap((gm) => gm.players)
					.filter((p) => p.pid === d.pid);
				assert.strictEqual(
					d.onNet,
					raw.reduce((s, p) => s + p.onNet!, 0),
				);
			}
			// Coaching matchups and marquee counts
			const coached = games.filter((gm) => gm.coaches);
			assert.strictEqual(
				story.coaches.reduce((s, c) => s + c.aW + c.bW, 0),
				coached.length,
			);
			assert.strictEqual(
				story.marquee.nationalTv,
				games.filter((gm) => gm.marquee === "nationalTv").length,
			);
			// Closest games are the smallest margins
			const minMargin = Math.min(
				...games.map((gm) => Math.abs(gm.hPts - gm.aPts)),
			);
			assert.strictEqual(
				Math.abs(story.closestGames[0]!.hPts - story.closestGames[0]!.aPts),
				minMargin,
			);
			// Heat: one row per season with a reason, the playoff meeting named
			assert.strictEqual(
				story.heat.length,
				new Set(games.map((gm) => gm.season)).size,
			);
			assert.isTrue(story.heat.every((h) => h.why.length > 0));
			assert.match(
				story.heat.find((h) => h.season === 2026)!.why.join(" "),
				/won 4-3 \(an upset\)/,
			);
		});
	}

	test("ties end streaks", () => {
		const games = makeGames(9, 6);
		games[5]!.aPts = games[5]!.hPts;
		assert.isUndefined(streaksOf(games).current);
	});
});

describe("record from a box score", () => {
	test("keeps what the pages need", () => {
		const game: any = {
			gid: 5,
			season: 2030,
			day: 12,
			overtimes: 1,
			playoffs: true,
			numGamesToWinSeries: 4,
			marquee: "christmas",
			clutchPlays: ['<a href="/x">Ann Ash</a> made a game-winning shot'],
			teams: [
				{
					tid: 7,
					pts: 101,
					won: 30,
					lost: 10,
					playoffs: { seed: 1, won: 4, lost: 3 },
					players: [
						{
							pid: 1,
							name: "Ann Ash",
							min: 40,
							pts: 33,
							trb: 5,
							ast: 7,
							fg: 12,
							fga: 20,
						},
						{ pid: 2, name: "DNP", min: 0, pts: 0 },
					],
				},
				{
					tid: 2,
					pts: 99,
					won: 25,
					lost: 15,
					playoffs: { seed: 4, won: 3, lost: 4 },
					players: [
						{
							pid: 3,
							name: "Bo Birch",
							min: 38,
							pts: 30,
							trb: 9,
							ast: 2,
							fg: 11,
							fga: 22,
						},
					],
				},
			],
		};
		const rec = rivalryGameFromBox(game, {
			round: 2,
			adv: new Map([[1, [10, 4, 6]]]),
			techs: 2,
		})!;
		assert.strictEqual(rec.pair, "2-7");
		assert.strictEqual(rec.home, 7);
		assert.strictEqual(rec.round, 2);
		assert.deepEqual([rec.hSer, rec.aSer, rec.toWin], [4, 3, 4]);
		assert.strictEqual(rec.players.length, 2);
		assert.deepEqual(
			[rec.players[0]!.dfga, rec.players[0]!.dfgm, rec.players[0]!.onNet],
			[10, 4, 6],
		);
		assert.strictEqual(rec.clutch![0], "Ann Ash made a game-winning shot");
		assert.strictEqual(rec.techs, 2);
		// All-Star games are not logged
		assert.isUndefined(
			rivalryGameFromBox({
				...game,
				teams: [{ ...game.teams[0], tid: -1 }, game.teams[1]],
			}),
		);
	});
});

// The challenge's own regexes (newspaper.noRatings.test.ts)
const RATING_WORDS =
	/\b(rated|ratings?|potential|ovr)\b|\boverall rating|\b\d{2,} overall\b/i;
const RATING_NUMBERS = /\d+\s*(→|->)\s*\d+|\b\d{2}\/\d{2}\b/;

describe("text", () => {
	const all: string[] = [];
	for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
		const games = makeGames(seed, 30);
		const season = 2031;
		const thisSeason = games.filter((gm) => gm.season === season);
		// a clincher, an upset, a heated game
		thisSeason[0]!.playoffs = true;
		thisSeason[0]!.toWin = 4;
		thisSeason[0]!.hSer = thisSeason[0]!.hPts > thisSeason[0]!.aPts ? 4 : 3;
		thisSeason[0]!.aSer = thisSeason[0]!.hPts > thisSeason[0]!.aPts ? 3 : 4;
		thisSeason[1]!.hRec = [5, 30];
		thisSeason[1]!.aRec = [30, 5];
		thisSeason[1]!.hPts = 120;
		thisSeason[1]!.aPts = 100;
		thisSeason[2]!.techs = 4;
		thisSeason[2]!.ejections = 1;
		const recaps = rivalryRecaps({
			games: thisSeason,
			history: games,
			name,
			isRival: () => true,
		});
		const kinds = new Set(recaps.map((x) => x.kind));
		test(`seed ${seed}: recaps of every kind`, () => {
			assert.isTrue(kinds.has("clincher"));
			assert.isTrue(kinds.has("upset"));
			assert.isTrue(kinds.has("heated"));
		});
		const preview = rivalryPreview({
			game: { gid: 1, season, home: 2, away: 7, marquee: "nationalTv" },
			history: games,
			tier: "Heated",
			name,
			allTime: { home: 40, away: 33 },
		});
		const ctx = rivalryContextLine(
			thisSeason.slice(1, 3),
			{ home: 2, away: 7 },
			name,
		);
		all.push(
			...recaps.flatMap((x) => [x.head, x.body]),
			preview.head,
			preview.body,
			ctx ?? "",
		);
	}

	test("no ratings, no broken text", () => {
		for (const t of all) {
			assert.notMatch(t, RATING_WORDS, t);
			assert.notMatch(t, RATING_NUMBERS, t);
			assert.notMatch(t, /\b(undefined|NaN|null|Infinity)\b|\s{2}/, t);
		}
	});

	test("context line", () => {
		const games = makeGames(1, 2);
		games[0]!.hPts = 100;
		games[0]!.aPts = 97;
		games[1]!.hPts = 100;
		games[1]!.aPts = 103;
		for (const gm of games) {
			gm.season = 2030;
		}
		assert.strictEqual(
			rivalryContextLine(games, { home: 2, away: 7 }, name),
			"Third meeting this season; the last two were decided by 3 points.",
		);
		assert.isUndefined(rivalryContextLine([], { home: 2, away: 7 }, name));
	});

	test("renewed", () => {
		const t = renewedText({
			a: 2,
			b: 7,
			season: 2031,
			meetings: [{ season: 2027, winner: 7, wWon: 4, wLost: 2 }],
			name,
		});
		assert.strictEqual(
			t.body,
			"The Team2 and the Team7 meet in the 2031 playoffs, their second series, the first since 2027, when the Team7 won 4-2. The Team7 lead their playoff series 1-0.",
		);
	});
});

describe("newspaper", () => {
	const rivalry = {
		previews: [
			{
				kind: "preview",
				gid: 9,
				season: 2025,
				tids: [0, 3] as [number, number],
				head: "Rivalry night: Team3 at Team0",
				body: "The Team0 host the Team3 in a heated rivalry.",
			},
		],
		recaps: [
			{
				kind: "upset",
				gid: 8,
				season: 2025,
				tids: [3, 0] as [number, number],
				head: "Team3 stun the Team0",
				body: "Team3 120, Team0 100.",
			},
		],
	};
	test("the Rivalry watch page runs with the facts, under the challenge too", () => {
		for (const noRatings of [false, true]) {
			const facts = { ...makeFixture("midseason", 2025), noRatings, rivalry };
			const league = paperText(buildPaper(facts));
			assert.include(league, "Team3 stun the Team0");
			const team = paperText(buildPaper(facts, 3));
			assert.include(team, "Rivalry night: Team3 at Team0");
		}
	});
	test("off: no page without the facts", () => {
		const facts = makeFixture("midseason", 2025);
		for (const tid of [undefined, 3]) {
			const ids = buildPaper(facts, tid).sections.flatMap((sec) =>
				sec.articles.map((a) => a.id),
			);
			assert.isFalse(ids.some((id) => id.startsWith("rivalry-watch")));
		}
	});
});

describe("off state", () => {
	test("off for existing leagues, on for new leagues, needs basketball", () => {
		assert.strictEqual(
			(nativeFeatureDefaults as any).featureRivalryStories,
			false,
		);
		assert.strictEqual(
			(nativeFeatureNewLeagueDefaults() as any).featureRivalryStories,
			true,
		);
		assert.isFalse(
			nativeFeatureEnabledForSport(
				"rivalryStories",
				() => undefined,
				"basketball",
			),
		);
		assert.isFalse(
			nativeFeatureEnabledForSport("rivalryStories", () => true, "football"),
		);
	});
});
