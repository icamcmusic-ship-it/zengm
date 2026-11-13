// A new random-players league with a hard cap starts with every team under the cap (at creation and on opening day), with the
// League Extras off and on
import "fake-indexeddb/auto";
import { afterAll, assert, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { NATIVE_FEATURES } from "../../../common/nativeFeatures.ts";
import { league, phase, team } from "../index.ts";
import { PHASE } from "../../../common/constants.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../../util/index.ts";

const realRandom = Math.random;
afterAll(() => {
	Math.random = realRandom;
});

const create = async (
	salaryCapType: "hard" | "soft",
	seed: number,
	extras: boolean,
) => {
	Math.random = makeSeededRandom(seed);
	const settings: any = getDefaultSettings();
	if (extras) {
		for (const f of NATIVE_FEATURES) {
			settings[f.key] = true;
		}
	}
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
			lid: seed,
			name: "hardcap",
			setLeagueCreationStatus: () => {},
			settings: { ...settings, salaryCapType },
			shuffleRosters: false,
			startingSeasonFromInput: "2025",
			teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
			tid: 0,
		},
	);
	await league.loadGameAttributes();
	const payrolls: number[] = [];
	for (const t of await idb.cache.teams.getAll()) {
		payrolls.push(await team.getPayroll(t.tid));
	}
	await phase.newPhase(PHASE.REGULAR_SEASON, {});
	for (const t of await idb.cache.teams.getAll()) {
		payrolls.push(await team.getPayroll(t.tid));
	}
	return payrolls;
};

describe("hard cap at league creation", () => {
	test("no team starts over the hard cap", { timeout: 10 * 60 * 1000 }, async () => {
		for (const [seed, extras] of [
			[1, false],
			[2, true],
		] as const) {
			const payrolls = await create("hard", seed, extras);
			const cap = g.get("salaryCap");
			const over = payrolls.filter((x) => x > cap);
			assert.deepEqual(over, []);
		}
	});
});
