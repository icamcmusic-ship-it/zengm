// The combine after the draft: every invited prospect of the class still counts, drafted or not (they were read from the undrafted
// players only, so once the draft was over the Combine page showed only the invitees who went undrafted, as few as ten)
import "fake-indexeddb/auto";
import { assert, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { numCombineInvites } from "../../../common/draftCombine.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, league } from "../index.ts";
import { g, helpers } from "../../util/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import {
	afterNewPhase as combineAfterNewPhase,
	getClassCombine,
} from "./index.ts";

test(
	"after the draft the class combine still has every invitee",
	{ timeout: 300_000 },
	async () => {
		Math.random = makeSeededRandom(3);
		await league.createStream({}, {
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
			lid: 3,
			name: "combine after draft",
			setLeagueCreationStatus: () => {},
			settings: getDefaultSettings(),
			shuffleRosters: false,
			startingSeasonFromInput: "2025",
			teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
			tid: 0,
		} as any);
		await league.loadGameAttributes();
		const season = g.get("season");
		const numInvites = numCombineInvites(
			g.get("numActiveTeams") * Math.max(1, g.get("numDraftRounds")),
		);

		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		await combineAfterNewPhase(PHASE.DRAFT_LOTTERY);
		const before = await getClassCombine(season);
		const expected = Math.min(numInvites, before.players.length);
		assert.isAbove(expected, 50);
		assert.strictEqual(before.invited.size, expected);

		g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		await draft.genOrder(false);
		g.setWithoutSavingToDB("spectator", true);
		await draft.runPicks({ type: "untilEnd" });
		g.setWithoutSavingToDB("spectator", false);
		g.setWithoutSavingToDB("phase", PHASE.AFTER_DRAFT);

		const after = await getClassCombine(season);
		assert.strictEqual(after.invited.size, expected);
		assert.deepEqual(
			[...after.invited].toSorted((a, b) => a - b),
			[...before.invited].toSorted((a, b) => a - b),
		);
	},
);
