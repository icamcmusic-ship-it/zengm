// The fork's main model in every league (forceCoreFeatures.ts): an older league, made with every core League Extra off,
// gets them on when it is loaded, with the conversions turning them on runs (expanded ratings and sub-ratings derived,
// coaching staffs and AI GMs made); a league that stored no play-by-play keeps storing none; a college league keeps
// college mode's own exceptions; a second load changes nothing.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PLAYER } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import {
	NATIVE_FEATURES,
	nativeCoreSettingsFor,
	nativeFeatureEnabled,
	nativeFeatureNewLeagueDefaults,
	type NativeFeatureDef,
	type NativeFeatureId,
} from "../../../common/nativeFeatures.ts";
import { hasExpandedRatings } from "../../../common/expandedRatings.ts";
import { isValidSubArray } from "../../../common/subRatings.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers } from "../../util/index.ts";
import { league } from "../index.ts";
import forceCoreFeatures, { coreFeatureChanges } from "./forceCoreFeatures.ts";

const defs: readonly NativeFeatureDef[] = NATIVE_FEATURES;
const core = defs.filter((f) => f.core);
const on = (f: NativeFeatureDef) =>
	nativeFeatureEnabled(f.id as NativeFeatureId, (key) =>
		Object.hasOwn(g, key) ? g.get(key as any) : undefined,
	);

describe("core League Extras", () => {
	test("registry: the core features, all on in a new league", () => {
		const ids = new Set(core.map((f) => f.id));
		for (const id of [
			"realisticPossessions",
			"simFixes",
			"matchupDefense",
			"starClutchCal",
			"expandedRatings",
			"subRatings",
			"ovrV2",
			"playerTraits",
			"coachingStaff",
			"scoutingReports",
			"realisticEconomy",
		]) {
			assert.isTrue(ids.has(id), id);
		}
		// Still settings: preferences, rules and pages
		for (const id of [
			"holdouts",
			"tradeRequests",
			"aiTradeOffers",
			"unretire",
			"customShotClock",
			"oneAndOne",
			"newspaper",
		]) {
			assert.isFalse(ids.has(id), id);
		}
		// Gone: Spread Out Matchups (only ran without the realistic schedule), player nicknames
		assert.isFalse(defs.some((f) => f.id === ("spreadMatchups" as string)));
		assert.isFalse(defs.some((f) => f.id === ("playerNicknames" as string)));
		const fresh = nativeFeatureNewLeagueDefaults() as Record<string, unknown>;
		for (const f of core) {
			if (!f.existing) {
				assert.strictEqual(fresh[f.key], true, f.key);
			}
		}
		// A college league keeps college mode's exceptions; another sport only its own features
		const college = nativeCoreSettingsFor("basketball", true);
		assert.isFalse(college.realisticSchedule);
		assert.isFalse(college.featureGmPersonalities);
		assert.isTrue(college.realisticPossessions);
		const hockey = nativeCoreSettingsFor("hockey", false);
		assert.isUndefined(hockey.realisticPossessions);
		assert.isTrue(hockey.contractOptions);
		// (the Referee Crews option is core too)
		assert.isTrue(
			nativeCoreSettingsFor("basketball", false).scheduleLoadRefVariance,
		);
	});

	describe("an older league with every core feature off", () => {
		beforeAll(async () => {
			Math.random = makeSeededRandom(7);
			const off: Record<string, unknown> = {};
			for (const f of core) {
				off[f.key] = false;
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
					lid: 0,
					name: "old league",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						...off,
						// (stored no play-by-play: the old switch off, the scope still "all")
						storePlayByPlay: false,
						pbpStore: "all",
						numGames: 4,
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			// (as an old league is: written before these settings existed, so everything is off and nothing derived)
			await league.setGameAttributes(off as any);
			for (const c of await idb.cache.coaches.getAll()) {
				await idb.cache.coaches.delete(c.cid);
			}
		}, 300_000);

		test("before: the features are off", () => {
			assert.isTrue(core.every((f) => !on(f) || f.key === "storePlayByPlay"));
			assert.isNotEmpty(Object.keys(coreFeatureChanges()));
		});

		test("load: every core feature on, the conversions run, play-by-play storage as it was", async () => {
			const changed = await forceCoreFeatures();
			assert.include(changed, "simFixes");
			assert.include(changed, "expandedRatings");
			for (const f of core) {
				if (f.key === "storePlayByPlay") {
					continue;
				}
				assert.isTrue(on(f), f.key);
				assert.strictEqual(g.get(f.key as any), true, f.key);
			}
			assert.isTrue(g.get("scheduleLoadRefVariance" as any));
			// Expanded ratings and sub-ratings derived for every active player
			const players = (await idb.cache.players.getAll()).filter(
				(p) => p.tid !== PLAYER.RETIRED,
			);
			assert.isNotEmpty(players);
			for (const p of players) {
				const r = p.ratings.at(-1)!;
				assert.isTrue(hasExpandedRatings(r), `${p.pid} expanded`);
				assert.isTrue(isValidSubArray((r as any).sub), `${p.pid} subs`);
			}
			// Coaching staffs for every team
			const coaches = await idb.cache.coaches.getAll();
			const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
			for (const t of teams) {
				assert.isTrue(
					coaches.some((c) => c.tid === t.tid),
					`team ${t.tid} has a staff`,
				);
			}
			// The league stored no play-by-play: it still stores none
			assert.strictEqual(g.get("pbpStore"), "none");
			assert.isFalse(g.get("storePlayByPlay"));
		}, 300_000);

		test("a second load changes nothing", async () => {
			assert.deepStrictEqual(await forceCoreFeatures(), []);
		});

		test("a college league keeps college mode's exceptions", () => {
			const before = g.get("leagueType" as any);
			g.setWithoutSavingToDB("leagueType" as any, "college");
			try {
				const changes = coreFeatureChanges() as Record<string, unknown>;
				// on here, so they would be turned off for college (as college mode makes them)
				assert.strictEqual(changes.realisticSchedule, false);
				assert.strictEqual(changes.featureGmPersonalities, false);
				assert.isUndefined(changes.realisticPossessions);
			} finally {
				g.setWithoutSavingToDB("leagueType" as any, before);
			}
		});
	});
});
