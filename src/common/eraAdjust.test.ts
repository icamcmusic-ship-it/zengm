import { assert, test } from "vitest";
import {
	careerEraFactor,
	makeEraAdjuster,
	type EraTotals,
} from "./eraAdjust.ts";
import { buildBook, type RBPlayer } from "./recordsBook.ts";

// Team totals of a season with this many points, rebounds, ... per team game (30 teams × 82 games)
const season = (ptsPg: number, fgp = 0.47): EraTotals => {
	const gp = 30 * 82;
	const fga = 88 * gp;
	return {
		gp,
		pts: ptsPg * gp,
		orb: 10 * gp,
		drb: 34 * gp,
		ast: 25 * gp,
		stl: 7.5 * gp,
		blk: 5 * gp,
		tov: 14 * gp,
		pf: 20 * gp,
		fg: fgp * fga,
		fga,
		tp: 12 * gp,
		tpa: 34 * gp,
		ft: 17 * gp,
		fta: 22 * gp,
	};
};

test("era factors: relative to each season's league average, on the all-time average's scale", () => {
	const adj = makeEraAdjuster(
		new Map([
			[2000, season(95, 0.44)],
			[2001, season(105, 0.46)],
			[2002, season(115, 0.48)],
		]),
	);
	// all-time average 105 points per team game
	assert.closeTo(adj.factor(2000, "pts"), 105 / 95, 1e-9);
	assert.closeTo(adj.factor(2001, "pts"), 1, 1e-9);
	assert.closeTo(adj.factor(2002, "pts"), 105 / 115, 1e-9);
	// a percentage, by the league's rate (FG% here in percent units: the factor is unitless)
	assert.closeTo(adj.factor(2000, "fgp"), 0.46 / 0.44, 1e-9);
	// the same rebounding every season: nothing
	assert.closeTo(adj.factor(2000, "trb"), 1, 1e-9);
	// not adjusted: advanced stats, minutes; and seasons without data
	assert.strictEqual(adj.factor(2000, "per"), 1);
	assert.strictEqual(adj.factor(2000, "min"), 1);
	assert.strictEqual(adj.factor(1990, "pts"), 1);
	// TS%: the league's rate
	const ts = adj.leagueRate(2001, "tsp")!;
	assert.closeTo(ts, 105 / (2 * (88 + 0.44 * 22)), 1e-9);
	// a career: weighted by games
	assert.closeTo(
		careerEraFactor(adj, "pts", [
			{ season: 2000, gp: 60 },
			{ season: 2002, gp: 20 },
		]),
		(60 * (105 / 95) + 20 * (105 / 115)) / 80,
		1e-9,
	);
	// one season: every factor is 1
	const one = makeEraAdjuster(new Map([[2000, season(95)]]));
	assert.closeTo(one.factor(2000, "pts"), 1, 1e-9);
});

test("era-adjusted records book: the low-scoring era's scorer moves up, TS+ added, single games and teams left out", () => {
	const adj = makeEraAdjuster(
		new Map([
			[2000, season(90)],
			[2001, season(120)],
		]),
	);
	// The same 2,000 points, one in each season; a lower raw total in the low-scoring season
	const row = (s: number, pts: number) => ({
		season: s,
		tid: 0,
		playoffs: false,
		gp: 80,
		pts,
		trb: 400,
		ast: 300,
		stl: 80,
		blk: 40,
		tp: 100,
		tsa: 1500,
	});
	const players: RBPlayer[] = [
		{ pid: 1, name: "Old", tid: -3, rows: [row(2000, 1900)] },
		{ pid: 2, name: "New", tid: 0, rows: [row(2001, 2100)] },
	];
	const ctx = {
		season: 2001,
		numGames: () => 82,
		teamGamesNow: 82,
		regularSeasonDone: true,
	};
	const raw = buildBook({
		players,
		teamSeasons: [],
		state: undefined,
		ctx,
		scope: {},
	});
	const rawPts = raw
		.find((s) => s.id === "season")!
		.lists.find((l) => l.id === "season:pts")!;
	assert.strictEqual(rawPts.rows[0]!.pid, 2);
	assert.isTrue(raw.some((s) => s.id === "game"));

	const eraPlayers = players.map((p) => ({
		...p,
		rows: p.rows.map((r) => {
			const out: any = { ...r, ptsRaw: r.pts };
			for (const k of ["pts", "trb", "ast", "stl", "blk", "tp"] as const) {
				out[k] = r[k] * adj.factor(r.season, k);
			}
			out.xpts = 2 * r.tsa * adj.leagueRate(r.season, "tsp")!;
			return out;
		}),
	}));
	const era = buildBook({
		players: eraPlayers,
		teamSeasons: [],
		state: undefined,
		ctx,
		scope: {},
		era: true,
	});
	const eraPts = era
		.find((s) => s.id === "season")!
		.lists.find((l) => l.id === "season:pts")!;
	assert.strictEqual(eraPts.rows[0]!.pid, 1);
	assert.closeTo(eraPts.rows[0]!.v, 1900 * (105 / 90), 1e-6);
	assert.isFalse(era.some((s) => s.id === "game" || s.id === "team"));
	const tsPlus = era
		.find((s) => s.id === "season")!
		.lists.find((l) => l.id === "season:tsplus")!;
	// (the same attempts: the old scorer was far more efficient for his era)
	assert.strictEqual(tsPlus.rows[0]!.pid, 1);
	assert.isAbove(tsPlus.rows[0]!.v, 100);
});
