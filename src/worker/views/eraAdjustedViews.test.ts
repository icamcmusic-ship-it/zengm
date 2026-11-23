// Era-adjusted League Leaders and Records Book (common/eraAdjust.ts): two short seasons of a headless league, then the views with the
// toggle off and on. Also checks that the preseason wrote zone tendencies (player/zoneTendencies.ts) and the games their travel sites.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
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
	while (g.get("phase") <= PHASE.PLAYOFFS) {
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
