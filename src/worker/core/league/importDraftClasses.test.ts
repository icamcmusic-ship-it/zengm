import "fake-indexeddb/auto";
import { assert, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PLAYER } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { league } from "../index.ts";
import { idb } from "../../db/index.ts";
import { helpers } from "../../util/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";

const create = async (
	stream: ReadableStream<any> | Record<string, never>,
	keptKeys: string[],
	lid: number,
) => {
	await league.createStream(stream as any, {
		confs: last(defaultGameAttributes.confs).value,
		divs: last(defaultGameAttributes.divs).value,
		fromFile: {
			gameAttributes: undefined,
			hasRookieContracts: true,
			maxGid: undefined,
			startingSeason: keptKeys.length > 0 ? 2025 : undefined,
			teams: undefined,
			version: LEAGUE_DATABASE_VERSION,
		},
		getLeagueOptions: undefined,
		keptKeys: new Set(keptKeys) as any,
		lid,
		name: `import ${lid}`,
		setLeagueCreationStatus: () => {},
		settings: {
			...getDefaultSettings(),
			rerandomizeDraftClassRatings: true,
			featureRatingsRegenerator: true,
		} as any,
		shuffleRosters: false,
		startingSeasonFromInput: "2025",
		teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
		tid: 0,
	});
	await league.loadGameAttributes();
};

// "Re-randomize ratings when a new draft class is created" rebuilt every prospect of an imported league file (their ratings all
// changed but height, pot and ovr), since league creation treated every class as new
test(
	"importing a league file keeps its draft prospects' ratings with Re-randomize draft class ratings on",
	{
		timeout: 10 * 60 * 1000,
	},
	async () => {
		Math.random = makeSeededRandom(4);
		await create({}, [], 0);
		const players = structuredClone(await idb.cache.players.getAll());
		const prospects = players.filter((p) => p.tid === PLAYER.UNDRAFTED);
		assert.isAbove(prospects.length, 0);
		// Pretend these were never regenerated (a league that turned the setting on later)
		for (const p of prospects) {
			delete p.ratingsBuild;
		}
		const before = new Map(
			prospects.map((p) => [p.pid, JSON.stringify(p.ratings.at(-1))]),
		);

		const stream = new ReadableStream({
			start(controller) {
				for (const p of players) {
					controller.enqueue({ key: "players", value: p });
				}
				controller.close();
			},
		});
		await create(stream, ["players"], 1);
		const imported = await idb.cache.players.indexGetAll(
			"playersByTid",
			PLAYER.UNDRAFTED,
		);
		let same = 0;
		for (const p of imported) {
			if (before.get(p.pid) === JSON.stringify(p.ratings.at(-1))) {
				same += 1;
			}
			assert.isUndefined(p.ratingsBuild, `pid ${p.pid}`);
		}
		assert.strictEqual(same, before.size);
	},
);
