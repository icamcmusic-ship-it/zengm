import { assert, describe, test } from "vitest";
import { buildPaper, paperText } from "./index.ts";
import { Rng, aOrAn, ordinal, polish, record, tidySegs } from "./text.ts";
import type {
	EditionId,
	NPPlayer,
	NPSeries,
	NPTeam,
	NewsFacts,
} from "./types.ts";

const makeFacts = (edition: EditionId): NewsFacts => {
	const r = new Rng("fixture");
	const numTeams = 8;
	const gp = edition === "preseason" ? 0 : edition === "midseason" ? 40 : 82;
	const teams: NPTeam[] = [];
	for (let tid = 0; tid < numTeams; tid++) {
		const won = gp === 0 ? 0 : r.int(20, gp - 20);
		teams.push({
			tid,
			abbrev: `T${tid}`,
			region: `City${tid}`,
			name: `Team${tid}`,
			cid: tid % 2,
			did: tid % 4,
			gp,
			won,
			lost: gp - won,
			pts: gp ? 100 + r.int(0, 15) : undefined,
			oppPts: gp ? 100 + r.int(0, 15) : undefined,
			streak: r.int(-6, 6),
			wonHome: Math.floor(won / 2),
			lostHome: Math.floor((gp - won) / 2),
			wonAway: Math.ceil(won / 2),
			lostAway: Math.ceil((gp - won) / 2),
			playoffRoundsWon:
				edition === "final"
					? tid === 0
						? 3
						: tid === 1
							? 2
							: tid < 4
								? 1
								: -1
					: -1,
			prev: { won: 41, lost: 41, playoffRoundsWon: 0 },
			titles: tid === 0 ? [2020] : [],
			firstSeason: 2020,
		});
	}
	const players: NPPlayer[] = [];
	for (let pid = 0; pid < numTeams * 10; pid++) {
		const tid = pid % numTeams;
		const games = gp ? r.int(Math.floor(gp / 2), gp) : 0;
		players.push({
			pid,
			name: `Player ${pid}`,
			tid,
			age: r.int(19, 36),
			pos: "G",
			ovr: r.int(40, 70),
			pot: r.int(45, 75),
			prevOvr: r.int(40, 70),
			gp: games,
			min: games ? r.int(10, 36) : 0,
			pts: games ? r.int(2, 30) : 0,
			trb: games ? r.int(1, 12) : 0,
			ast: games ? r.int(0, 9) : 0,
			stl: 1,
			blk: 0.5,
			per: 15,
			ws: games ? r.int(0, 12) : 0,
			fgp: 45,
			tpp: 35,
			tp: 1,
			po:
				edition === "final" || edition === "playoffs"
					? {
							gp: 8,
							min: 30,
							pts: 20,
							trb: 5,
							ast: 4,
							stl: 1,
							blk: 1,
							per: 18,
							ws: 1,
							fgp: 47,
							tpp: 36,
							tp: 2,
						}
					: undefined,
			prevLine: { gp: 70, pts: 10, trb: 4, ast: 3, ws: 3 },
			draftYear: 2021,
			draftRound: 1,
			draftPick: (pid % 30) + 1,
			draftTid: tid,
			rookie: pid % 9 === 0,
		});
	}
	const series: NPSeries[][] = [];
	if (edition === "final" || edition === "playoffs") {
		series.push(
			[
				{
					round: 0,
					home: { tid: 0, seed: 1, won: 4 },
					away: { tid: 7, seed: 4, won: 1 },
					gids: [],
				},
				{
					round: 0,
					home: { tid: 1, seed: 1, won: 4 },
					away: { tid: 6, seed: 4, won: 3 },
					gids: [],
				},
				{
					round: 0,
					home: { tid: 2, seed: 2, won: 2 },
					away: { tid: 3, seed: 3, won: 4 },
					gids: [],
				},
				{
					round: 0,
					home: { tid: 4, seed: 2, won: 4 },
					away: { tid: 5, seed: 3, won: 0 },
					gids: [],
				},
			],
			[
				{
					round: 1,
					home: { tid: 0, seed: 1, won: 4 },
					away: { tid: 3, seed: 3, won: 2 },
					gids: [],
				},
				{
					round: 1,
					home: { tid: 1, seed: 1, won: edition === "final" ? 4 : 2 },
					away: { tid: 4, seed: 2, won: 1 },
					gids: [],
				},
			],
		);
		if (edition === "final") {
			series.push([
				{
					round: 2,
					home: { tid: 0, seed: 1, won: 4 },
					away: { tid: 1, seed: 1, won: 3 },
					gids: [1, 2, 3],
				},
			]);
		}
	}
	return {
		leagueName: "Test League",
		seedKey: "abc",
		season: 2025,
		edition,
		numGames: 82,
		numRounds: 3,
		gp,
		userTid: 0,
		confs: [
			{ cid: 0, name: "East" },
			{ cid: 1, name: "West" },
		],
		teams,
		players,
		awards:
			edition === "final"
				? [
						{
							key: "MVP",
							name: "Most Valuable Player",
							pid: 0,
							tid: 0,
							order: [0, 1, 2],
						},
						{ key: "FMVP", name: "Finals MVP", pid: 8, tid: 0, order: [8] },
						{
							key: "ROY",
							name: "Rookie of the Year",
							pid: 9,
							tid: 1,
							order: [9],
						},
					]
				: [],
		teamAwards: [],
		series,
		currentRound: edition === "final" ? 3 : 1,
		champion: edition === "final" ? 0 : undefined,
		runnerUp: edition === "final" ? 1 : undefined,
		games: [
			{
				gid: 3,
				playoffs: true,
				won: { tid: 0, pts: 110 },
				lost: { tid: 1, pts: 101 },
				overtimes: 0,
				stars: [
					{
						pid: 0,
						name: "Player 0",
						tid: 0,
						pts: 35,
						trb: 9,
						ast: 7,
						min: 40,
					},
					{
						pid: 1,
						name: "Player 1",
						tid: 1,
						pts: 28,
						trb: 4,
						ast: 3,
						min: 38,
					},
				],
			},
		],
		feats: [
			{
				pid: 3,
				name: "Player 3",
				tid: 3,
				oppTid: 2,
				gid: 5,
				playoffs: false,
				result: "W",
				score: "120-110",
				pts: 52,
				trb: 10,
				ast: 3,
				stl: 1,
				blk: 0,
			},
		],
		trades: [
			{
				phase: 1,
				tids: [0, 1],
				got: [
					[{ kind: "player", pid: 5, name: "Player 5" }],
					[{ kind: "pick", season: 2026, round: 1, originalTid: 0 }],
				],
				score: 10,
			},
		],
		signings: [
			{
				kind: "freeAgent",
				phase: 8,
				pid: 6,
				name: "Player 6",
				tid: 6,
				amount: 15000,
				exp: 2028,
				score: 5,
			},
		],
		retirees:
			edition === "final"
				? [
						{
							pid: 999,
							name: "Old Guy",
							age: 38,
							tid: 2,
							seasons: 15,
							gp: 1000,
							pts: 18000,
							trb: 5000,
							ast: 3000,
							ws: 100,
							titles: 1,
							mvps: 1,
							allStars: 8,
							hof: false,
						},
					]
				: [],
		draft: [],
		injuries: [
			{
				pid: 7,
				name: "Player 7",
				tid: 7,
				type: "Sprained Ankle",
				gamesRemaining: 5,
			},
		],
		firstSeason: 2020,
	};
};

describe("newspaper engine", () => {
	for (const edition of [
		"preseason",
		"midseason",
		"playoffs",
		"final",
	] as const) {
		test(`${edition} edition has no undefined/NaN and is deterministic`, () => {
			const facts = makeFacts(edition);
			const a = buildPaper(facts);
			const b = buildPaper(makeFacts(edition));
			assert.deepStrictEqual(a, b);
			const text = paperText(a);
			assert.notMatch(text, /undefined|NaN|\[object/);
			assert.isAbove(a.sections.length, 0);
			assert.strictEqual(a.sections[0]!.id, "front");
			assert.strictEqual(a.sections[0]!.articles[0]!.size, "lead");

			const team = buildPaper(facts, 3);
			assert.strictEqual(team.tid, 3);
			assert.notMatch(paperText(team), /undefined|NaN|\[object/);
		});
	}

	test("final edition leads with the champion", () => {
		const paper = buildPaper(makeFacts("final"));
		const text = paperText(paper);
		assert.include(text, "Team0");
		assert.match(paper.sections[0]!.articles[0]!.kicker!, /Championship/);
		assert.ok(paper.sections.some((s) => s.id === "playoffs"));
	});

	test("mid-season copy is in the present tense", () => {
		const text = paperText(buildPaper(makeFacts("midseason")));
		assert.notInclude(text, "won the title");
	});
});

describe("newspaper text helpers", () => {
	test("ordinal", () => {
		assert.strictEqual(ordinal(1), "1st");
		assert.strictEqual(ordinal(2), "2nd");
		assert.strictEqual(ordinal(11), "11th");
		assert.strictEqual(ordinal(23), "23rd");
	});
	test("aOrAn", () => {
		assert.strictEqual(aOrAn("50-32"), "a 50-32");
		assert.strictEqual(aOrAn("80-2"), "an 80-2");
		assert.strictEqual(aOrAn("11-71"), "an 11-71");
	});
	test("record", () => {
		assert.strictEqual(record({ won: 50, lost: 32 }), "50-32");
		assert.strictEqual(record({ won: 50, lost: 30, otl: 2 }), "50-30-2");
	});
	test("polish and tidySegs", () => {
		assert.strictEqual(polish("in 1 games ."), "in 1 game.");
		assert.deepStrictEqual(
			tidySegs(["a ", "b", { pid: 1, t: "X" }, "", " ."]),
			["a b", { pid: 1, t: "X" }, "."],
		);
	});
	test("Rng is seeded", () => {
		assert.strictEqual(new Rng("x").random(), new Rng("x").random());
		assert.notStrictEqual(new Rng("x").random(), new Rng("y").random());
	});
});
