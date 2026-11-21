// Award key stats on Award Races and Award History: plays a short season in a headless league, then loads both views.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import { game, league, phase } from "../core/index.ts";
import { g, helpers } from "../util/index.ts";
import { getDefaultSettings } from "./newLeague.ts";
import * as views from "./index.ts";
import * as awardSettings from "../api/awardSettings.ts";
import { awardSettingsSchema } from "../../common/types.ts";

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

describe("award key stats views", () => {
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
					name: "awardKeyStats",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						numGames: 6,
						numGamesPlayoffSeries: [1, 1],
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			while (g.get("phase") <= PHASE.PLAYOFFS) {
				await game.play(1, {});
			}
		},
		10 * 60 * 1000,
	);

	test("Award Races: key stats from each formula, and picker stats loaded", async () => {
		const output = await load("awardRaces", {
			season: String(g.get("season")),
		});
		const byShortName = new Map<string, any>(
			output.awardCandidates.map((award: any) => [award.shortName, award]),
		);

		for (const award of output.awardCandidates) {
			assert.isDefined(award.keyStats, award.shortName);
			assert.isAbove(award.keyStats.suggested.length, 0, award.shortName);
			assert.isAbove(award.keyStats.available.length, 50, award.shortName);
		}

		const dpoy = byShortName.get("DPOY");
		const defensive = ["dws", "blk", "stl"];
		assert.isTrue(
			dpoy.keyStats.suggested.some((stat: string) => defensive.includes(stat)),
		);
		assert.notInclude(dpoy.keyStats.suggested, "pts");

		// A stat no formula reads, loaded for the picker
		const mvp = byShortName.get("MVP");
		assert.isAbove(mvp.players.length, 0);
		assert.isNumber(mvp.players[0].currentStats.tov);
		assert.isNumber(mvp.players[0].currentStats.fgp);
	});

	test("Award History: winners with their key stats", async () => {
		const output = await load("awardHistory", { award: "MVP" });
		assert.strictEqual(output.award, "MVP");
		assert.isAbove(output.rows.length, 0);
		const winner = output.rows.find((row: any) => row.rank === 1);
		assert.isDefined(winner);
		assert.isNumber(winner.stats.pts);
		assert.isNumber(winner.stats.ewa);
		assert.isAbove(output.keyStats.suggested.length, 0);
		assert.isTrue(
			output.awardOptions.some((option: any) => option.key === "DPOY"),
		);

		// Playoff series award: its key stats are saved with the award now
		const fmvp = await load("awardHistory", { award: "FMVP" });
		assert.isTrue(fmvp.playoffSeries);
		assert.isAbove(fmvp.rows.length, 0);
		assert.isNumber(fmvp.rows[0].stats.gmsc);
		assert.include(fmvp.keyStats.suggested, "gmsc");

		// Unknown award: the first one
		const unknown = await load("awardHistory", { award: "NOPE" });
		assert.strictEqual(unknown.award, output.awardOptions[0].key);
	});

	test("Season History: each award carries its key stats, and its winner has them", async () => {
		const season = (await load("awardHistory", { award: "MVP" })).rows[0]
			.season;
		const output = await load("history", { season: String(season) });
		const mvp = output.awards.individualAwards.find(
			(award: any) => award.shortName === "MVP",
		);
		assert.isDefined(mvp);
		assert.isAbove(mvp.keyStats.suggested.length, 0);
		for (const stat of mvp.keyStats.suggested) {
			assert.isDefined(
				mvp.winner.stats[stat] ?? mvp.winner.statOverrides?.[stat],
				stat,
			);
		}
		const dpoy = output.awards.individualAwards.find(
			(award: any) => award.shortName === "DPOY",
		);
		assert.isDefined(dpoy?.keyStats);
		// (the defensive award's suggestion is about defense)
		assert.isTrue(
			dpoy.keyStats.suggested.some((stat: string) =>
				["blk", "stl", "drb", "dws", "dpm", "trkDef"].includes(stat),
			),
			dpoy.keyStats.suggested.join(","),
		);
	});

	test("User-chosen stat columns: saved in the award settings, validated, shown on every page", async () => {
		const season = (await load("awardHistory", { award: "MVP" })).rows[0]
			.season;
		const awardsBefore = helpers.deepCopy(g.get("awards"));

		// The Columns menu saves into the award setting (unknown keys are kept as given and dropped when shown)
		const saved = await awardSettings.saveAwardStatCols({
			shortName: "MVP",
			statCols: ["tov", "fgp", "tov", "notAStat", "pts"],
		});
		assert.isTrue(saved);
		const mvpSetting = g.get("awards").find((a) => a.shortName === "MVP");
		assert.deepEqual(mvpSetting?.statCols, ["tov", "fgp", "notAStat", "pts"]);
		assert.isTrue(awardSettingsSchema.safeParse(g.get("awards")).success);
		assert.isFalse(
			await awardSettings.saveAwardStatCols({
				shortName: "NOPE",
				statCols: ["pts"],
			}),
		);

		const expected = ["tov", "fgp", "pts"];
		const races = await load("awardRaces", { season: String(season) });
		const raceMvp = races.awardCandidates.find(
			(a: any) => a.shortName === "MVP",
		);
		assert.deepEqual(raceMvp.keyStats.custom, expected);
		assert.deepEqual(raceMvp.keyStats.shown, expected);
		assert.isNumber(raceMvp.players[0].currentStats.tov);
		// Other awards stay automatic
		const dpoy = races.awardCandidates.find((a: any) => a.shortName === "DPOY");
		assert.isUndefined(dpoy.keyStats.custom);
		assert.deepEqual(dpoy.keyStats.shown, dpoy.keyStats.suggested);

		const history = await load("awardHistory", { award: "MVP" });
		assert.deepEqual(history.keyStats.shown, expected);

		const summary = await load("history", { season: String(season) });
		const summaryMvp = summary.awards.individualAwards.find(
			(a: any) => a.shortName === "MVP",
		);
		assert.deepEqual(summaryMvp.keyStats.shown, expected);
		assert.isNumber(summaryMvp.winner.stats.tov);

		// Award Settings: the edited awards carry their own choice
		const edited = await awardSettings.getAwardCandidates({
			type: "custom",
			season,
			awards: g
				.get("awards")
				.map((a) =>
					a.shortName === "MVP" ? { ...a, statCols: ["blk", "stl"] } : a,
				),
		});
		const editedMvp = edited.awardCandidates
			.flat()
			.find((a) => a.shortName === "MVP");
		assert.deepEqual(editedMvp?.keyStats.shown, ["blk", "stl"]);

		// Deterministic
		const again = await load("awardRaces", { season: String(season) });
		assert.deepEqual(
			again.awardCandidates.map((a: any) => a.keyStats.shown),
			races.awardCandidates.map((a: any) => a.keyStats.shown),
		);

		// Reset to automatic removes the key
		await awardSettings.saveAwardStatCols({
			shortName: "MVP",
			statCols: undefined,
		});
		const reset = g.get("awards").find((a) => a.shortName === "MVP");
		assert.isFalse(reset !== undefined && "statCols" in reset);
		const races2 = await load("awardRaces", { season: String(season) });
		const raceMvp2 = races2.awardCandidates.find(
			(a: any) => a.shortName === "MVP",
		);
		assert.isUndefined(raceMvp2.keyStats.custom);
		assert.deepEqual(raceMvp2.keyStats.shown, raceMvp2.keyStats.suggested);

		await league.setGameAttributes({ awards: awardsBefore });
	});
});
