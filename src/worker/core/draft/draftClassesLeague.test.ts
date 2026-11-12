// Headless multi-season league: the number of upcoming draft classes stays at numDraftClasses (default 7) through every phase
import "fake-indexeddb/auto";
import { assert, describe, test } from "vitest";
import {
	LEAGUE_DATABASE_VERSION,
	PHASE,
	PLAYER,
} from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, league, player } from "../index.ts";
import { getRequiredDraftYears } from "./topUpDraftClasses.ts";
import { startAutoPlay } from "../league/autoPlay.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../../util/index.ts";
import { idb } from "../../db/index.ts";

const counts = async () => {
	const ps = await idb.cache.players.indexGetAll(
		"playersByTid",
		PLAYER.UNDRAFTED,
	);
	const m: Record<number, number> = {};
	for (const p of ps) {
		m[p.draft.year] = (m[p.draft.year] ?? 0) + 1;
	}
	return m;
};

describe("draft classes", () => {
	test("sim", { timeout: 60 * 60 * 1000 }, async () => {
		Math.random = makeSeededRandom(1);
		// An earlier test file in this worker may have left a mock league behind
		// @ts-expect-error
		idb.league = undefined;
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
				name: "dc",
				setLeagueCreationStatus: () => {},
				settings: {
					...getDefaultSettings(),
					numGames: 2,
					numGamesPlayoffSeries: [1],
				},
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		assert.strictEqual(g.get("numDraftClasses"), 7);

		// Exactly the required upcoming years, each a full class
		const check = async (label: string) => {
			const c = await counts();
			const years = getRequiredDraftYears();
			assert.deepStrictEqual(
				Object.keys(c).map(Number),
				years,
				`${label}: ${JSON.stringify(c)}`,
			);
			for (const year of years) {
				assert.isAtLeast(c[year]!, 50, `${label} ${year}`);
			}
		};
		await check("created");

		const start = g.get("season");
		for (let i = 0; i < 2; i++) {
			for (const ph of [PHASE.DRAFT, PHASE.RESIGN_PLAYERS]) {
				await startAutoPlay(start + i, ph, {});
				await check(`${start + i} phase ${ph}`);
			}
			await startAutoPlay(start + i + 1, PHASE.PRESEASON, {});
			await check(`${start + i + 1} preseason`);
		}

		// An existing league with only 3 classes (stock BBGM) gets topped up to 7, which is also the default when the setting was never saved
		const ps = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		await player.remove(
			ps.filter((p) => p.draft.year > g.get("season") + 2).map((p) => p.pid),
		);
		assert.strictEqual(Object.keys(await counts()).length, 3);
		const generated = await draft.topUpDraftClasses();
		assert.strictEqual(generated.length, 4);
		await check("topped up");
		// Nothing more to do, so nothing is regenerated
		assert.strictEqual((await draft.topUpDraftClasses()).length, 0);

		// Lower setting: no new classes, existing ones kept
		await league.setGameAttributes({ numDraftClasses: 3 });
		assert.strictEqual((await draft.topUpDraftClasses()).length, 0);
	});
});
