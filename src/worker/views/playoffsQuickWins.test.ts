// Series odds on the playoff bracket and the Semifinals (conference finals) MVP in the series-end news and Series Recaps: plays a
// short season with 3 best-of-3 rounds in a headless league.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import { game, league, phase } from "../core/index.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "../util/index.ts";
import { getDefaultSettings } from "./newLeague.ts";
import * as views from "./index.ts";

const load = async (id: string, params: Record<string, string>) => {
	const view = (views as any)[id];
	assert.isDefined(view, id);
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	return await view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
};

describe("playoff quick wins", () => {
	beforeAll(
		async () => {
			Math.random = makeSeededRandom(11);
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
					name: "playoffQuickWins",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						numGames: 6,
						numGamesPlayoffSeries: [3, 3, 3],
						numPlayoffByes: 0,
						playIn: false,
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			while (g.get("phase") < PHASE.PLAYOFFS) {
				await game.play(1, {});
			}
		},
		10 * 60 * 1000,
	);

	test("series odds for each unfinished series of the round in progress", async () => {
		assert.strictEqual(g.get("phase"), PHASE.PLAYOFFS);
		const output = await load("playoffs", {});
		assert.isDefined(output.seriesOdds);
		const { round, byTid } = output.seriesOdds;
		assert.strictEqual(round, 0);
		for (const series of output.series[0]) {
			const home = byTid[series.home.tid] ?? 0;
			const away = byTid[series.away.tid] ?? 0;
			assert.closeTo(home + away, 1, 1e-9);
		}

		// Past seasons get none
		const past = await load("playoffs", {
			season: String(g.get("season") - 1),
		});
		assert.isUndefined(past.seriesOdds);
	});

	test("Semifinals MVP named at the end of each conference final, same as the award", async () => {
		const season = g.get("season");
		while (g.get("phase") === PHASE.PLAYOFFS) {
			await game.play(1, {});
		}

		const playoffSeries = (await idb.cache.playoffSeries.get(season))!;
		const confFinals = playoffSeries.series[1]!;
		assert.strictEqual(confFinals.length, 2);

		const events = await idb.merged.events.getAll({ season });
		const awards = (await idb.cache.awards.get(season))!;

		for (const series of confFinals) {
			const tids = [series.home.tid, series.away!.tid];
			const award = awards.awards.find(
				(a) =>
					a.shortName === "SFMVP" &&
					a.group?.type === "playoffSeries" &&
					tids.includes(a.group.tids[0]),
			)!;
			assert.isDefined(award);
			const pid = (award as any).winner[0].pid as number;

			const news = events.find(
				(e) =>
					e.type === "playoffs" &&
					e.text?.includes("Semifinals MVP") &&
					e.tids?.includes(series.home.tid),
			);
			assert.isDefined(news, "series-end news names the Semifinals MVP");
			assert.include(news!.pids ?? [], pid);

			const recaps = await load("seriesRecaps", {
				season: String(season),
				pair: `${Math.min(...tids)}-${Math.max(...tids)}`,
			});
			assert.strictEqual(recaps.seriesAwards.length, 1);
			assert.strictEqual(recaps.seriesAwards[0].pid, pid);
			assert.strictEqual(recaps.seriesAwards[0].name, "Semifinals MVP");
		}

		// Power rankings snapshots went on through the playoffs
		const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
			"teamSeasonsBySeasonTid",
			[[season], [season, "Z"]],
		);
		assert.isTrue(
			teamSeasons.some((ts) =>
				ts.powerRankHistory?.some((row) => row.playoffs),
			),
		);

		// Not for the finals (it has the Finals MVP) or the first round
		const firstRound = playoffSeries.series[0]![0]!;
		const recaps = await load("seriesRecaps", {
			season: String(season),
			pair: `${Math.min(firstRound.home.tid, firstRound.away!.tid)}-${Math.max(firstRound.home.tid, firstRound.away!.tid)}`,
		});
		assert.strictEqual(recaps.seriesAwards.length, 0);
	});

	test("Statistical Feats: each feat's kinds and the filter options", async () => {
		const p = (await idb.cache.players.indexGetAll("playersByTid", 0))[0]!;
		await idb.cache.playerFeats.add({
			pid: p.pid,
			name: `${p.firstName} ${p.lastName}`,
			pos: "G",
			season: g.get("season"),
			tid: 0,
			oppTid: 1,
			playoffs: true,
			gid: 0,
			stats: {
				gs: 1,
				min: 40,
				fg: 20,
				fga: 30,
				tp: 4,
				tpa: 8,
				ft: 8,
				fta: 9,
				orb: 2,
				drb: 9,
				ast: 10,
				tov: 2,
				stl: 1,
				blk: 0,
				pf: 2,
				pts: 52,
			},
			result: "W",
			score: "120-110",
			overtimes: 0,
			numPeriods: 4,
			factor: 1,
		});
		const output = await load("playerFeats", {});
		const feat = output.feats.find((f: any) => f.pid === p.pid && f.gid === 0);
		assert.deepStrictEqual(feat.kinds, ["tripleDouble", "pts50"]);
		assert.strictEqual(feat.type, "playoffs");
		const kindKeys = output.kindOptions.map((k: any) => k.key);
		assert.includeMembers(kindKeys, ["tripleDouble", "pts50"]);
		assert.include(
			output.typeOptions.map((t: any) => t.key),
			"playoffs",
		);
		// Every feat qualified for something
		for (const f of output.feats) {
			assert.isAbove(f.kinds.length, 0, JSON.stringify(f.stats));
		}
	});
});
