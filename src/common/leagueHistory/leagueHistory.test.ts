import { assert, describe, test } from "vitest";
import type { WLeague, WPlayer, WStat, WTeamSeason } from "../wrapped/types.ts";
import { buildRedraft, classStealsBusts } from "./redraft.ts";
import { buildPickValue } from "./pickValue.ts";
import { buildFamilies, familyOf, surname } from "./families.ts";
import { buildHomeCourt, extremes } from "./homeCourt.ts";
import { buildEconomics } from "./economics.ts";
import { buildJerseyNumbers, cmpNumber } from "./jerseyNumbers.ts";
import { gini, quantile } from "./util.ts";

const stat = (
	season: number,
	tid: number,
	gp: number,
	ws: number,
	gs = 0,
	pts = 0,
): WStat => ({
	season,
	tid,
	gp,
	gs,
	min: gp * 20,
	pts,
	trb: 0,
	ast: 0,
	stl: 0,
	blk: 0,
	tov: 0,
	tp: 0,
	tpa: 0,
	fg: 0,
	fga: 0,
	ft: 0,
	fta: 0,
	per: 15,
	ws,
	bpm: 0,
	vorp: 0,
});

const player = (
	pid: number,
	draft: { year: number; round: number; pick: number; tid?: number },
	stats: WStat[],
	extra: Partial<WPlayer> = {},
): WPlayer => ({
	pid,
	name: `Player ${pid}`,
	firstName: "Player",
	lastName: `${pid}`,
	bornYear: 1990,
	bornLoc: "USA",
	college: "",
	draft: { tid: 0, ...draft },
	tid: -1,
	retiredYear: 2025,
	hof: false,
	awards: [],
	stats,
	po: [],
	injuries: [],
	ovr: {},
	moves: [],
	relatives: [],
	...extra,
});

const teamSeason = (
	tid: number,
	season: number,
	extra: Partial<WTeamSeason> = {},
): WTeamSeason => ({
	tid,
	season,
	abbrev: `T${tid}`,
	region: `City${tid}`,
	name: `Team${tid}`,
	colors: ["#000", "#fff", "#888"],
	won: 41,
	lost: 41,
	tied: 0,
	otl: 0,
	playoffRoundsWon: -1,
	gp: 82,
	pts: 0,
	oppPts: 0,
	...extra,
});

const league = (
	players: WPlayer[],
	teamSeasons: WTeamSeason[],
	extra: Partial<WLeague> = {},
): WLeague => ({
	startingSeason: 2020,
	season: 2026,
	currentComplete: true,
	userTid: 0,
	numPlayoffRounds: {},
	teamSeasons,
	players,
	series: [],
	games: [],
	...extra,
});

// 4 teams every season, so 4 picks per round
const fourTeams = (from: number, to: number) => {
	const out: WTeamSeason[] = [];
	for (let season = from; season <= to; season++) {
		for (let tid = 0; tid < 4; tid++) {
			out.push(teamSeason(tid, season));
		}
	}
	return out;
};

describe("util", () => {
	test("gini and quantile", () => {
		assert.strictEqual(gini([100, 200, 300, 400]), 0.25);
		assert.strictEqual(gini([5, 5, 5]), 0);
		assert.strictEqual(gini([]), null);
		assert.strictEqual(quantile([1, 2, 3, 4], 0.5), 2.5);
		assert.strictEqual(quantile([], 0.5), null);
	});
});

describe("redraft", () => {
	// The 2020 class, by overall pick: career WS 10, 50, never played, 5, 30, 2, 0 (played), 60, and an undrafted player with 20
	const ws2020 = [10, 50, null, 5, 30, 2, 0, 60];
	const players: WPlayer[] = ws2020.map((ws, i) =>
		player(
			i + 1,
			{ year: 2020, round: i < 4 ? 1 : 2, pick: (i % 4) + 1, tid: i % 4 },
			ws === null ? [] : [stat(2021, 0, 50, ws / 2), stat(2022, 1, 50, ws / 2)],
		),
	);
	players.push(
		player(9, { year: 2020, round: 0, pick: 0 }, [stat(2022, 2, 60, 20)]),
		// Undrafted and never played: left out
		player(10, { year: 2020, round: 0, pick: 0 }, []),
		// 2024: only 2 seasons since, still developing
		player(11, { year: 2024, round: 1, pick: 1 }, [stat(2025, 0, 70, 8)]),
		// Drafted before the league began: partial
		player(12, { year: 2015, round: 1, pick: 3 }, [stat(2020, 0, 70, 4)]),
	);
	const L = league(players, fourTeams(2020, 2026));
	const R = buildRedraft(L);

	test("classes", () => {
		assert.deepEqual(R.years, [2015, 2020, 2024]);
		assert.isTrue(R.classes.get(2015)!.partial);
		assert.isTrue(R.classes.get(2024)!.developing);
		const c = R.classes.get(2020)!;
		assert.isFalse(c.partial);
		assert.isFalse(c.developing);
		assert.strictEqual(c.seasonsSince, 6);
		assert.strictEqual(c.perRound, 4);
		assert.strictEqual(c.drafted, 8);
		assert.strictEqual(c.undrafted, 1);
	});

	test("redraft order, slots and moves", () => {
		const c = R.classes.get(2020)!;
		// 60, 50, 30, 20 (undrafted), 10, 5, 2, then the two zeros by original pick
		assert.deepEqual(
			c.entries.map((x) => x.pid),
			[8, 2, 5, 9, 1, 4, 6, 3, 7],
		);
		const byPid = new Map(c.entries.map((x) => [x.pid, x]));
		assert.strictEqual(byPid.get(8)!.pick, 8);
		assert.strictEqual(byPid.get(8)!.delta, 7);
		assert.strictEqual(byPid.get(9)!.pick, null);
		// Undrafted counts from one past the last pick: 9 - 4
		assert.strictEqual(byPid.get(9)!.delta, 5);
		assert.strictEqual(byPid.get(1)!.delta, -4);
		assert.isFalse(byPid.get(3)!.played);
		assert.strictEqual(byPid.get(3)!.ws, 0);
		assert.isTrue(byPid.get(7)!.played);
	});

	test("steals, busts and who should have gone first", () => {
		const sb = classStealsBusts(R.classes.get(2020)!);
		assert.deepEqual(
			sb.steals.map((x) => x.pid),
			[8, 9, 5],
		);
		assert.deepEqual(
			sb.busts.map((x) => x.pid),
			[3, 1, 4],
		);
		// Only the mature, full 2020 class is in the all-time lists
		assert.deepEqual(
			R.steals.map((x) => x.pid),
			[8, 9, 5],
		);
		assert.deepEqual(
			R.busts.map((x) => x.pid),
			[3, 1, 4],
		);
		assert.strictEqual(R.ones.length, 1);
		assert.strictEqual(R.ones[0]!.actual!.pid, 1);
		assert.strictEqual(R.ones[0]!.redraft!.pid, 8);
	});
});

describe("pick value", () => {
	// Classes 2020-2022, 8 picks each. Career WS = 2 * (9 - pick) + (year - 2020). Everyone plays only 2023.
	const players: WPlayer[] = [];
	let pid = 0;
	for (const year of [2020, 2021, 2022]) {
		for (let k = 1; k <= 8; k++) {
			players.push(
				player(
					pid,
					{ year, round: k <= 4 ? 1 : 2, pick: ((k - 1) % 4) + 1 },
					[stat(2023, k % 4, 30, 2 * (9 - k) + (year - 2020), k <= 2 ? 30 : 0)],
					{
						awards:
							year === 2020 && k === 1
								? [{ season: 2023, type: "All-Star" }]
								: [],
					},
				),
			);
			pid += 1;
		}
	}
	players.push(
		player(pid, { year: 2021, round: 0, pick: 0 }, [stat(2023, 0, 30, 5)]),
	);
	// Short 2023 season, so the 6 starters' 180 starts cover it (4 teams x 10 games x 5 starters x 90%)
	const teamSeasons = fourTeams(2020, 2026).map((ts) =>
		ts.season === 2023 ? { ...ts, won: 5, lost: 5 } : ts,
	);
	const V = buildPickValue(league(players, teamSeasons))!;

	test("maturity and slots", () => {
		assert.strictEqual(V.mature, 4);
		assert.strictEqual(V.from, 2020);
		assert.strictEqual(V.to, 2022);
		assert.strictEqual(V.numPicks, 24);
		assert.strictEqual(V.maxPick, 8);
		const s1 = V.slots[0]!;
		assert.strictEqual(s1.pick, 1);
		assert.strictEqual(s1.n, 3);
		assert.strictEqual(s1.mean, 17);
		assert.strictEqual(s1.median, 17);
		assert.strictEqual(s1.p25, 16.5);
		assert.strictEqual(s1.p75, 17.5);
		assert.strictEqual(s1.max, 18);
		assert.strictEqual(V.slots[7]!.mean, 3);
	});

	test("hit rates", () => {
		const s1 = V.slots[0]!;
		assert.deepEqual(s1.played, { hit: 3, n: 3 });
		assert.deepEqual(s1.allStar, { hit: 1, n: 3 });
		assert.deepEqual(s1.starter, { hit: 3, n: 3 });
		assert.deepEqual(V.slots[2]!.starter, { hit: 0, n: 3 });
		assert.strictEqual(V.gsFrom, 2023);
	});

	test("starts not on file are unknown, not misses", () => {
		const V2 = buildPickValue(league(players, fourTeams(2020, 2026)))!;
		assert.deepEqual(V2.slots[0]!.starter, { hit: 0, n: 0 });
		assert.strictEqual(V2.gsFrom, null);
	});

	test("bands and undrafted", () => {
		assert.deepEqual(
			V.bands.map((b) => b.label),
			["1-3", "4-8"],
		);
		assert.strictEqual(V.bands[0]!.mean, 15);
		assert.strictEqual(V.bands[1]!.mean, 7);
		assert.strictEqual(V.undrafted.n, 1);
		assert.strictEqual(V.undrafted.mean, 5);
	});

	test("no mature class", () => {
		assert.isNull(
			buildPickValue(
				league(players.slice(0, 8), teamSeasons, { season: 2022 }),
			),
		);
	});
});

describe("families", () => {
	// Grandfather 1, his sons 2 and 3 (brothers), 2's son 4. Player 5 is unrelated.
	const players = [
		player(
			1,
			{ year: 1990, round: 1, pick: 1 },
			[stat(2020, 0, 80, 10, 0, 1000)],
			{
				bornYear: 1960,
				relatives: [
					{ type: "son", pid: 2 },
					{ type: "son", pid: 3 },
				],
			},
		),
		player(
			2,
			{ year: 2019, round: 1, pick: 2 },
			[stat(2021, 0, 80, 5, 0, 800), stat(2022, 0, 80, 5, 0, 800)],
			{
				bornYear: 1990,
				relatives: [
					{ type: "father", pid: 1 },
					{ type: "brother", pid: 3 },
					{ type: "son", pid: 4 },
				],
				awards: [{ season: 2021, type: "All-Star" }],
			},
		),
		player(
			3,
			{ year: 2019, round: 1, pick: 3 },
			[stat(2021, 0, 80, 3, 0, 500), stat(2022, 1, 80, 3, 0, 500)],
			{
				bornYear: 1992,
				relatives: [
					{ type: "father", pid: 1 },
					{ type: "brother", pid: 2 },
				],
			},
		),
		player(
			4,
			{ year: 2023, round: 1, pick: 1 },
			[stat(2024, 2, 80, 30, 0, 2000)],
			{
				lastName: "Smith Jr.",
				name: "Joe Smith Jr.",
				tid: 2,
				relatives: [{ type: "father", pid: 2 }],
			},
		),
		player(5, { year: 2019, round: 1, pick: 4 }, [stat(2021, 1, 80, 40)]),
	];
	const teamSeasons = [
		teamSeason(0, 2021, { playoffRoundsWon: 2 }),
		teamSeason(1, 2021, { playoffRoundsWon: 0 }),
	];
	const F = buildFamilies(
		league(players, teamSeasons, { numPlayoffRounds: { 2021: 2 } }),
	);

	test("one family over three generations", () => {
		assert.strictEqual(F.families.length, 1);
		assert.strictEqual(F.related, 4);
		const f = F.families[0]!;
		assert.strictEqual(f.id, 4);
		assert.strictEqual(f.name, "Smith");
		assert.strictEqual(f.totals.gens, 3);
		assert.deepEqual(
			f.gens.map((g) => g.map((m) => m.pid)),
			[[1], [2, 3], [4]],
		);
		assert.strictEqual(f.totals.ws, 56);
		assert.strictEqual(f.totals.pts, 5600);
		assert.strictEqual(f.totals.allStar, 1);
		// 2 and 3 were on the 2021 champion
		assert.strictEqual(f.totals.titles, 2);
		assert.strictEqual(f.totals.titleSeasons, 1);
		assert.strictEqual(f.totals.first, 2020);
		assert.strictEqual(f.totals.last, 2024);
		assert.strictEqual(familyOf(F, 3)?.id, 4);
		assert.isUndefined(familyOf(F, 5));
	});

	test("pairs", () => {
		assert.deepEqual(F.fatherSon.map((x) => [x.a, x.b]).sort(), [
			[1, 2],
			[1, 3],
			[2, 4],
		]);
		assert.strictEqual(F.brothers.length, 1);
		const b = F.brothers[0]!;
		assert.strictEqual(b.a, 2);
		assert.strictEqual(b.b, 3);
		assert.deepEqual(b.together, [2021]);
		assert.deepEqual(b.against, [2022]);
		assert.deepEqual(b.overlap, [2021, 2022]);
	});

	test("surname", () => {
		assert.strictEqual(surname({ lastName: "Smith Jr.", name: "" }), "Smith");
		assert.strictEqual(
			surname({ lastName: "Van Dyke III", name: "" }),
			"Van Dyke",
		);
	});
});

describe("home court", () => {
	const D = buildHomeCourt({
		teamSeasons: [
			{
				tid: 0,
				season: 2021,
				wonHome: 30,
				lostHome: 11,
				wonAway: 20,
				lostAway: 21,
			},
			{
				tid: 1,
				season: 2021,
				wonHome: 25,
				lostHome: 16,
				wonAway: 15,
				lostAway: 26,
			},
			// No games yet: unknown, not 0-0
			{
				tid: 0,
				season: 2022,
				wonHome: 0,
				lostHome: 0,
				wonAway: 0,
				lostAway: 0,
			},
		],
		games: [
			{
				season: 2021,
				playoffs: false,
				neutralSite: false,
				home: { tid: 0, pts: 100 },
				away: { tid: 1, pts: 90 },
			},
			{
				season: 2021,
				playoffs: false,
				neutralSite: false,
				home: { tid: 1, pts: 95 },
				away: { tid: 0, pts: 99 },
			},
			{
				season: 2021,
				playoffs: false,
				neutralSite: true,
				home: { tid: 1, pts: 100 },
				away: { tid: 0, pts: 80 },
			},
			{
				season: 2021,
				playoffs: false,
				neutralSite: false,
				home: { tid: 1, pts: 90 },
				away: { tid: 0, pts: 90 },
			},
			{
				season: 2021,
				playoffs: true,
				neutralSite: false,
				home: { tid: 0, pts: 110 },
				away: { tid: 1, pts: 100 },
			},
		],
		series: [
			{
				season: 2021,
				rounds: [
					[
						{ home: { tid: 0, won: 4 }, away: { tid: 3, won: 2 } },
						{ home: { tid: 1, won: 1 }, away: { tid: 2, won: 4 } },
					],
					[{ home: { tid: 0, won: 4 }, away: { tid: 2, won: 3 } }],
				],
			},
			// Still being played
			{
				season: 2022,
				rounds: [[{ home: { tid: 0, won: 1 }, away: { tid: 1, won: 0 } }]],
			},
		],
		completeSeasons: new Set([2021]),
	});

	test("splits", () => {
		assert.deepEqual(
			D.seasons.map((s) => s.season),
			[2021],
		);
		const s = D.seasons[0]!;
		assert.strictEqual(s.hw, 55);
		assert.strictEqual(s.hl, 27);
		assert.strictEqual(s.p, 55 / 82);
		assert.strictEqual(D.total.p, 55 / 82);
		assert.strictEqual(D.eras.length, 1);
		assert.strictEqual(D.eras[0]!.decade, 2020);
		const t0 = D.teams.find((t) => t.tid === 0)!;
		assert.strictEqual(t0.homeP, 30 / 41);
		assert.strictEqual(t0.gap, 30 / 41 - 20 / 41);
	});

	test("box scores leave out neutral sites and ties", () => {
		assert.deepEqual(D.box, { g: 2, hw: 1, margin: 3 });
		assert.deepEqual(D.po, { g: 1, hw: 1, margin: 10 });
		assert.deepEqual(D.seasons[0]!.box, { g: 2, hw: 1, margin: 3 });
	});

	test("series, finished playoffs only", () => {
		assert.strictEqual(D.series.n, 3);
		assert.strictEqual(D.series.won, 2);
		assert.deepEqual(D.series.byRound, [
			{ back: 0, n: 1, won: 1 },
			{ back: 1, n: 2, won: 1 },
		]);
	});

	test("extremes", () => {
		assert.strictEqual(extremes(D.teamSeasons, "homeP", "best")[0]!.tid, 0);
		assert.strictEqual(extremes(D.teamSeasons, "roadP", "worst")[0]!.tid, 1);
	});
});

describe("economics", () => {
	const ts = (
		tid: number,
		season: number,
		payroll: number,
		extra: { luxuryTax?: number; playoffRoundsWon?: number } = {},
	) => ({
		tid,
		season,
		payroll,
		luxuryTax: extra.luxuryTax ?? 0,
		playoffRoundsWon: extra.playoffRoundsWon ?? -1,
	});
	const E = buildEconomics({
		teamSeasons: [
			// 2020: no payrolls
			...[0, 1, 2, 3].map((tid) => ts(tid, 2020, -1)),
			ts(0, 2021, 100, { playoffRoundsWon: 2 }),
			ts(1, 2021, 200),
			ts(2, 2021, 300),
			ts(3, 2021, 400, { luxuryTax: 50 }),
			ts(0, 2022, 200),
			ts(1, 2022, 300),
			ts(2, 2022, 400),
			ts(3, 2022, 500, { luxuryTax: 75, playoffRoundsWon: 2 }),
			// 3 of 4 known is enough; the playoffs aren't over
			ts(0, 2023, 300, { playoffRoundsWon: 2 }),
			ts(1, 2023, 300),
			ts(2, 2023, 300),
			ts(3, 2023, -1),
		],
		numPlayoffRounds: { 2020: 2, 2021: 2, 2022: 2, 2023: 2 },
		completeSeasons: new Set([2020, 2021, 2022]),
	});

	test("seasons", () => {
		assert.deepEqual(E.unknownSeasons, [2020]);
		assert.deepEqual(
			E.seasons.map((s) => s.season),
			[2021, 2022, 2023],
		);
		const s = E.seasons[0]!;
		assert.strictEqual(s.mean, 250);
		assert.strictEqual(s.median, 250);
		assert.strictEqual(s.spread, 300);
		assert.strictEqual(s.ratio, 4);
		assert.strictEqual(s.gini, 0.25);
		assert.strictEqual(s.top.tid, 3);
		assert.strictEqual(s.taxPayers, 1);
		assert.strictEqual(s.taxTotal, 50);
		assert.isNull(s.growth);
		assert.strictEqual(E.seasons[1]!.growth, 0.4);
		assert.strictEqual(E.seasons[2]!.n, 3);
		assert.strictEqual(E.seasons[2]!.gini, 0);
	});

	test("champions and taxes", () => {
		assert.deepEqual(
			E.champions.map((c) => [c.season, c.rank, c.of]),
			[
				[2021, 4, 4],
				[2022, 1, 4],
			],
		);
		assert.strictEqual(E.cheapestChampions[0]!.season, 2021);
		assert.strictEqual(E.cheapestChampions[0]!.rel, 0.4);
		assert.strictEqual(E.summary!.topPaidWon, 1);
		assert.strictEqual(E.summary!.decided, 2);
		assert.strictEqual(E.summary!.meanRank, 2.5);
		assert.closeTo(E.summary!.cagr!, Math.sqrt(300 / 250) - 1, 1e-12);
		assert.deepEqual(E.taxByTeam, [
			{ tid: 3, times: 2, total: 125, last: 2022 },
		]);
		assert.strictEqual(E.taxes[0]!.amount, 75);
	});
});

describe("jersey numbers by team", () => {
	const rows = (
		tid: number,
		number: string | undefined,
		seasons: number[],
		value: number,
	) => seasons.map((season) => ({ season, tid, number, gp: 70, value }));
	const J = buildJerseyNumbers(
		[
			{
				pid: 1,
				name: "Star",
				hof: false,
				tid: 1,
				allStarSeasons: [2021, 2024],
				rows: [
					...rows(0, "23", [2020, 2021, 2022, 2023], 15),
					...rows(1, "3", [2024], 5),
				],
			},
			{
				pid: 2,
				name: "Legend",
				hof: true,
				tid: -2,
				allStarSeasons: [],
				rows: rows(0, "10", [2015, 2016, 2017, 2018, 2019], 10),
			},
			{
				pid: 3,
				name: "Backup",
				hof: false,
				tid: 0,
				allStarSeasons: [],
				rows: rows(0, "23", [2024, 2025], 4),
			},
			{
				pid: 4,
				name: "Unknown",
				hof: false,
				tid: 0,
				allStarSeasons: [],
				rows: rows(0, undefined, [2025], 1),
			},
		],
		[
			{
				tid: 0,
				retired: [{ number: "10", seasonRetired: 2026, pid: 2, text: "" }],
			},
			{
				tid: 1,
				retired: [{ number: "99", seasonRetired: 2000, text: "Old Timer" }],
			},
		],
		{ defaultBar: 40, minBar: 20, maxBar: 100 },
	);

	test("numbers by team", () => {
		const t0 = J.byTeam.get(0)!;
		assert.deepEqual(
			t0.map((x) => x.number),
			["10", "23"],
		);
		const n23 = t0[1]!;
		assert.strictEqual(n23.wearers, 2);
		assert.strictEqual(n23.seasons, 6);
		assert.strictEqual(n23.top[0]!.pid, 1);
		assert.strictEqual(n23.top[0]!.value, 60);
		assert.isFalse(n23.retired);
		assert.isTrue(t0[0]!.retired);
		assert.strictEqual(J.knownRows, 12);
		assert.strictEqual(J.unknownRows, 1);
	});

	test("retired numbers and candidates", () => {
		assert.strictEqual(J.retired.length, 2);
		const legend = J.retired[0]!;
		assert.deepEqual(
			[
				legend.tid,
				legend.number,
				legend.pid,
				legend.wore,
				legend.value,
				legend.seasons,
			],
			[0, "10", 2, true, 50, 5],
		);
		const old = J.retired[1]!;
		assert.strictEqual(old.pid, null);
		assert.strictEqual(old.wore, null);
		assert.strictEqual(old.name, "Old Timer");
		assert.strictEqual(J.bar, 40);
		assert.strictEqual(J.candidates.length, 1);
		const c = J.candidates[0]!;
		assert.deepEqual(
			[
				c.pid,
				c.tid,
				c.number,
				c.value,
				c.seasons,
				c.allStar,
				c.active,
				c.stillHere,
			],
			[1, 0, "23", 60, 4, 1, true, false],
		);
	});

	test("number order", () => {
		assert.deepEqual(["10", "0", "A", "00", "5"].sort(cmpNumber), [
			"0",
			"00",
			"5",
			"10",
			"A",
		]);
	});
});
