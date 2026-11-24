// Era-adjusted League Leaders and Records Book (common/eraAdjust.ts): two short seasons of a headless league, then the views with the
// toggle off and on. Also checks that the preseason wrote zone tendencies (player/zoneTendencies.ts) and the games their travel sites.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import { isPreDraftStatsRow } from "../../common/preDraft.ts";
import { draft, game, league, phase } from "../core/index.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import { getEraAdjuster } from "../util/eraBaselines.ts";
import { getDefaultSettings } from "./newLeague.ts";
import * as views from "./index.ts";

const load = (id: string, params: Record<string, string>) => {
	const view = (views as any)[id];
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	return view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
};

const playSeason = async () => {
	await phase.newPhase(PHASE.REGULAR_SEASON, {});
	// (a guard: game.play refuses to sim, and this would spin forever, if a roster is short)
	for (let i = 0; g.get("phase") <= PHASE.PLAYOFFS; i++) {
		if (i > 500) {
			throw new Error("season did not finish");
		}
		await game.play(1, {});
	}
};

describe("era-adjusted views", () => {
	beforeAll(
		async () => {
			Math.random = makeSeededRandom(5);
			await league.createStream(
				{},
				{
					confs: last(defaultGameAttributes.confs).value,
					divs: last(defaultGameAttributes.divs).value,
					fromFile: {
						gameAttributes: undefined,
						hasRookieContracts: true,
						maxGid: undefined,
						startingSeason: undefined,
						teams: undefined,
						version: LEAGUE_DATABASE_VERSION,
					},
					getLeagueOptions: undefined,
					keptKeys: new Set(),
					lid: 0,
					name: "era",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						featureRecordsBook: true,
						// (AI-run user team, so its roster is filled in the offseason like everyone else's)
						spectator: true,
						numGames: 6,
						numGamesPlayoffSeries: [1],
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			await playSeason();
			await phase.newPhase(PHASE.DRAFT, {});
			await draft.runPicks({ type: "untilEnd" }, {});
			await phase.newPhase(PHASE.AFTER_DRAFT, {});
			await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
			await phase.newPhase(PHASE.FREE_AGENCY, {});
			await phase.newPhase(PHASE.PRESEASON, {});
			// (a different scoring environment in the second season, so the two seasons' factors differ)
			await league.setGameAttributes({ threePointTendencyFactor: 2 });
			await playSeason();
		},
		10 * 60 * 1000,
	);

	test("leaders: the same players, values times their season's factor", async () => {
		const adj = await getEraAdjuster();
		assert.deepStrictEqual(adj.seasons, [2025, 2026]);
		assert.notStrictEqual(adj.factor(2025, "tp"), adj.factor(2026, "tp"));

		const params = {
			season: "all",
			statType: "totals",
			playoffs: "regularSeason",
		};
		const raw = await load("leaders", params);
		const era = await load("leaders", { ...params, era: "era" });
		assert.isFalse(raw.era);
		assert.isTrue(era.era);
		const cat = (out: any, stat: string) =>
			out.categories.find((c: any) => c.stat === stat);
		for (const stat of ["pts", "tp", "fgp"]) {
			const eraCat = cat(era, stat);
			assert.isAbove(eraCat.leaders.length, 0, stat);
			for (const l of eraCat.leaders) {
				const rawLeader = cat(raw, stat).leaders.find(
					(r: any) => r.pid === l.pid && r.season === l.season,
				);
				if (rawLeader) {
					assert.closeTo(
						l.stat,
						rawLeader.stat * adj.factor(l.season, stat),
						1e-6,
					);
				}
			}
		}
		// advanced stats: unchanged
		const per = cat(era, "per").leaders[0];
		const rawPer = cat(raw, "per").leaders[0];
		assert.strictEqual(per.stat, rawPer.stat);

		// careers too
		const career = await load("leaders", {
			season: "career",
			statType: "totals",
			playoffs: "regularSeason",
			era: "era",
		});
		assert.isAbove(cat(career, "pts").leaders.length, 0);
	});

	test("leaders: a career is each season adjusted and added up, like the Records Book", async () => {
		const adj = await getEraAdjuster();
		const cat = (out: any, stat: string) =>
			out.categories.find((c: any) => c.stat === stat);
		// His regular season pro rows, each adjusted by its season's factor
		const seasonRows = async (pid: number) => {
			const p = (await idb.getCopy.players({ pid }, "noCopyCache"))!;
			return p.stats.filter(
				(row) => !row.playoffs && !isPreDraftStatsRow(row, p.draft.year),
			);
		};
		const sum = (rows: any[], f: (row: any) => number) =>
			rows.reduce((total, row) => total + f(row), 0);

		const totals = await load("leaders", {
			season: "career",
			statType: "totals",
			playoffs: "regularSeason",
			era: "era",
		});
		const perGame = await load("leaders", {
			season: "career",
			statType: "perGame",
			playoffs: "regularSeason",
			era: "era",
		});
		let checked = 0;
		for (const stat of ["pts", "tp", "trb"]) {
			for (const l of cat(totals, stat).leaders.slice(0, 5)) {
				const rows = await seasonRows(l.pid);
				const value = (row: any) =>
					stat === "trb" ? row.orb + row.drb : row[stat];
				const adjusted = sum(
					rows,
					(row) => value(row) * adj.factor(row.season, stat),
				);
				assert.closeTo(l.stat, adjusted, 1e-6, stat);
				checked += 1;
			}
			for (const l of cat(perGame, stat).leaders.slice(0, 5)) {
				const rows = await seasonRows(l.pid);
				const value = (row: any) =>
					stat === "trb" ? row.orb + row.drb : row[stat];
				const adjusted = sum(
					rows,
					(row) => value(row) * adj.factor(row.season, stat),
				);
				assert.closeTo(
					l.stat,
					adjusted / sum(rows, (row) => row.gp),
					1e-6,
					stat,
				);
				checked += 1;
			}
		}
		// A percentage: his adjusted makes over his attempts
		for (const l of cat(perGame, "tpp").leaders.slice(0, 5)) {
			const rows = await seasonRows(l.pid);
			const adjusted = sum(
				rows,
				(row) => row.tp * adj.factor(row.season, "tpp"),
			);
			assert.closeTo(
				l.stat,
				(100 * adjusted) / sum(rows, (row) => row.tpa),
				1e-6,
			);
			checked += 1;
		}
		assert.isAbove(checked, 10);
	});

	test("records book: era-adjusted lists with TS+, no single games or team records", async () => {
		const raw = await load("recordsBook", { team: "all" });
		const era = await load("recordsBook", { team: "all", era: "era" });
		assert.isTrue(raw.sections.some((s: any) => s.id === "game"));
		assert.isFalse(era.sections.some((s: any) => s.id === "game"));
		const season = era.sections.find((s: any) => s.id === "season");
		const ts = season.lists.find((l: any) => l.id === "season:tsplus");
		assert.isDefined(ts);
		for (const row of ts.rows) {
			assert.isAbove(row.v, 50);
			assert.isBelow(row.v, 200);
		}
	});

	test("zone tendencies and travel sites were written", async () => {
		const players = await idb.cache.players.getAll();
		const withZt = players.filter((p) => (last(p.ratings) as any).zt);
		assert.isAbove(withZt.length, 0);
		const teamSeasons = (await idb.cache.teamSeasons.getAll()).filter(
			(ts) => ts.season === g.get("season"),
		);
		assert.isTrue(teamSeasons.every((ts) => ts.lastGameSite !== undefined));
	});
});
