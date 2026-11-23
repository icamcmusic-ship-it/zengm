// Other sports get the generic parts: a few weeks of a headless spectator football league, then the season pack (games, team
// game logs, standings) and the team export, whose basketball-only sections (lineups, shot profile) are skipped with the reason
import "fake-indexeddb/auto";
import { assert, beforeAll, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import {
	buildSeasonPack,
	seasonPackCSVFiles,
} from "../../../common/seasonExport.ts";
import {
	teamExportCSVFiles,
	teamExportToJSON,
} from "../../../common/teamExport.ts";
import { last } from "../../../common/utils.ts";
import { game, league, phase } from "../../core/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../index.ts";
import { getTeamSeasonExport } from "../teamExport/index.ts";
import { getSeasonPackGames, getSeasonPackInfo } from "./index.ts";

const SEASON = 2025;

beforeAll(async () => {
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
			name: "season export football",
			setLeagueCreationStatus: () => {},
			settings: { ...getDefaultSettings(), spectator: true } as any,
			shuffleRosters: false,
			startingSeasonFromInput: String(SEASON),
			teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
			tid: 0,
		},
	);
	await league.loadGameAttributes();
	await phase.newPhase(PHASE.REGULAR_SEASON, {});
	// Two weeks (a guard: game.play refuses to sim if a roster is short)
	for (let i = 0; i < 2; i++) {
		await game.play(1, {});
	}
	assert.strictEqual(g.get("phase"), PHASE.REGULAR_SEASON);
}, 300_000);

test("football: season pack and team export, generic parts only", async () => {
	const info = await getSeasonPackInfo({ season: SEASON });
	assert.isAbove(info.gids.length, 0);
	const chunk = await getSeasonPackGames({ season: SEASON, gids: info.gids });
	const pack = buildSeasonPack(info, [chunk]);
	assert.strictEqual(pack.league.sport, "football");
	assert.strictEqual(pack.teamLogs.length, 2 * pack.games.length);
	assert.isAbove(pack.standingsHistory.length, 0);
	assert.isFalse(JSON.stringify(pack).includes('"ovr"'));
	assert.strictEqual(seasonPackCSVFiles(pack).length, 5);

	const x = (await getTeamSeasonExport({ tid: 1, season: SEASON }))!;
	assert.isDefined(x);
	assert.deepEqual(
		x.skipped.map((s) => s.key),
		["lineups", "shotProfile"],
	);
	for (const key of [
		"overview",
		"roster",
		"splits",
		"staff",
		"results",
	] as const) {
		assert.isDefined(x.sections[key], key);
	}
	const roster = x.sections.roster!;
	assert.include(roster.tables[0]!.cols, "Skills");
	assert.notInclude(roster.tables[0]!.cols, "Archetype");
	assert.isTrue(
		x.sections.staff!.notes.some((n) => n.includes("Basketball GM")),
	);
	assert.isAbove(teamExportCSVFiles(x).length, 3);
	JSON.parse(teamExportToJSON(x));
}, 120_000);
