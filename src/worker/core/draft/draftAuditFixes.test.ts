// Draft audit (review 3) bug fixes: expansion pick scale, "our guy" verdicts, Big Boards perception noise, class facts that don't depend
// on when they were built, the Mock Draft's scouted view, and regenerated prospects' pre-draft story.
import "fake-indexeddb/auto";
import { assert, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import {
	consensusBoard,
	outletBoards,
	FINAL_EDITION,
} from "../../../common/draftOutlets.ts";
import { Rng } from "../../../common/collegeStats/rng.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { DEFAULT_SETTINGS } from "../../../common/ratingsBuilds/index.ts";
import { last } from "../../../common/utils.ts";
import { resetG } from "../../../test/helpers.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { draft, league } from "../index.ts";
import { afterNewPhase as combineAfterNewPhase } from "../draftCombine/index.ts";
import { afterNewPhase as outletsAfterNewPhase } from "../draftOutlets/index.ts";
import { ourGuyVerdict } from "../staffDepth/scouting.ts";
import {
	buildClassFacts,
	getClassFactsCached,
	wholeClassOf,
} from "./draftDecisionData.ts";
import { getMockDraft, perceivedProspect } from "./mockDraftData.ts";
import { applyRegenerate, undoRegenerate } from "./regenerateRatings.ts";
import { picksPerRound } from "./runPicks.ts";

describe("pure fixes", () => {
	test("B1: an expansion draft's rounds are the expansion teams' picks", () => {
		resetG();
		g.setWithoutSavingToDB("numActiveTeams", 32);
		assert.strictEqual(picksPerRound(), 32);
		g.setWithoutSavingToDB("expansionDraft", {
			phase: "draft",
			numPerTeam: 14,
			numPerTeamDrafted: {},
			expansionTids: [30, 31],
			availablePids: [],
		} as any);
		assert.strictEqual(picksPerRound(), 2);
		g.setWithoutSavingToDB("expansionDraft", { phase: "setup" });
	});

	test("B2: only a first-round pick can be judged a bust", () => {
		const base = { allStar: false, peak: 45, seasonsSince: 4 };
		assert.strictEqual(ourGuyVerdict({ ...base, firstRounder: true }), "bust");
		assert.strictEqual(ourGuyVerdict({ ...base, firstRounder: false }), "miss");
		assert.strictEqual(
			ourGuyVerdict({ ...base, peak: 50, firstRounder: false }),
			"solid",
		);
		assert.strictEqual(
			ourGuyVerdict({ ...base, peak: 66, firstRounder: false }),
			"star",
		);
		assert.isUndefined(
			ourGuyVerdict({ ...base, seasonsSince: 2, firstRounder: true }),
		);
	});

	test("Big Boards: the final consensus is no better than the user's scouts at the default budget", () => {
		// Class standard deviation units: values ~ N(0, 1). The user's scouts at the default budget miss by about 0.3 of that (fuzz sd
		// about 2 ovr)
		const SCOUT_SD = 0.3;
		const spearman = (a: Map<number, number>, b: Map<number, number>) => {
			let d2 = 0;
			for (const [pid, r] of a) {
				d2 += (r - b.get(pid)!) ** 2;
			}
			const n = a.size;
			return 1 - (6 * d2) / (n * (n * n - 1));
		};
		const rankBy = (xs: { pid: number; x: number }[]) =>
			new Map(
				[...xs]
					.sort((a, b) => b.x - a.x || a.pid - b.pid)
					.map((p, i) => [p.pid, i + 1]),
			);
		let consensusRho = 0;
		let scoutRho = 0;
		const N = 40;
		for (let c = 0; c < N; c++) {
			const rng = new Rng(`boardsTest|${c}`);
			const prospects = Array.from({ length: 70 }, (_, pid) => ({
				pid,
				value: rng.normal(0, 1),
				age: 19 + Math.floor(4 * rng.random()),
				upside: rng.normal(0, 1),
				production: rng.normal(0, 1),
				athletic: 50 + 15 * rng.normal(0, 1),
			}));
			const truth = rankBy(prospects.map((p) => ({ pid: p.pid, x: p.value })));
			const boards = outletBoards({
				prospects,
				seed: "test",
				draftYear: 2030 + c,
				edition: FINAL_EDITION,
			});
			const consensus = new Map(
				[...consensusBoard(boards)].map(([pid, row]) => [pid, row.rank]),
			);
			const scouts = rankBy(
				prospects.map((p) => ({
					pid: p.pid,
					x: p.value + SCOUT_SD * rng.normal(0, 1),
				})),
			);
			consensusRho += spearman(consensus, truth) / N;
			scoutRho += spearman(scouts, truth) / N;
		}
		assert.isAtMost(consensusRho, scoutRho);
	});
});

const makeLeague = async (seed: number) => {
	Math.random = makeSeededRandom(seed);
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
		lid: seed,
		name: "draft audit fixes",
		setLeagueCreationStatus: () => {},
		settings: getDefaultSettings(),
		shuffleRosters: false,
		startingSeasonFromInput: "2025",
		teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
		tid: 0,
	} as any);
	await league.loadGameAttributes();
};

const undrafted = async (season: number) =>
	(
		await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
			[season],
			[season, Infinity],
		])
	).filter((p) => p.draft.year === season && p.tid < 0 && p.draft.round <= 0);

describe("in a league", { timeout: 600_000 }, () => {
	test("B7, B5 and the Mock Draft's scouted view", async () => {
		await makeLeague(7);
		const season = g.get("season");

		// B7: a rebuilt prospect's college stats and stored combine follow his new ratings, and Undo puts them back
		g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
		await combineAfterNewPhase(PHASE.DRAFT_LOTTERY);
		const withStory = (await undrafted(season))
			.filter((p) => p.preDraftCareer && p.combine?.season === season)
			.slice(0, 6);
		assert.isAbove(withStory.length, 0);
		const before = new Map(
			withStory.map((p) => [
				p.pid,
				helpers.deepCopy({ stats: p.stats, combine: p.combine }),
			]),
		);
		await applyRegenerate({
			draftYear: season,
			settings: { ...DEFAULT_SETTINGS, seed: "audit-fixes" },
			locks: {},
			pids: withStory.map((p) => p.pid),
		});
		let statsChanged = 0;
		let combineChanged = 0;
		for (const p of withStory) {
			const now = (await idb.cache.players.get(p.pid))!;
			const old = before.get(p.pid)!;
			if (!p.ratingsBuild) {
				continue;
			}
			if (JSON.stringify(now.stats) !== JSON.stringify(old.stats)) {
				statsChanged += 1;
			}
			if (JSON.stringify(now.combine) !== JSON.stringify(old.combine)) {
				combineChanged += 1;
			}
		}
		assert.isAbove(statsChanged, 0);
		assert.isAbove(combineChanged, 0);
		await undoRegenerate();
		for (const p of withStory) {
			const now = (await idb.cache.players.get(p.pid))!;
			const old = before.get(p.pid)!;
			assert.deepEqual(now.stats, old.stats);
			assert.deepEqual(now.combine, old.combine);
		}

		// The draft
		await outletsAfterNewPhase(PHASE.DRAFT);
		g.setWithoutSavingToDB("phase", PHASE.DRAFT);
		await draft.genOrder(false);

		// Mock Draft: the prospects as the user's scouts see them
		const pool = await undrafted(season);
		const fuzzed = pool.find((p) => p.valueFuzz !== p.value)!;
		assert.isDefined(fuzzed);
		const seen = perceivedProspect(fuzzed);
		assert.strictEqual(seen.value, fuzzed.valueFuzz);
		assert.notStrictEqual(
			last(seen.ratings).ovr === last(fuzzed.ratings).ovr &&
				last(seen.ratings).pot === last(fuzzed.ratings).pot &&
				last(seen.ratings).hgt === last(fuzzed.ratings).hgt,
			true,
		);
		const mock = await getMockDraft();
		assert.isTrue("picks" in mock && (mock.picks?.length ?? 0) > 0);

		// B5: the facts the AI built at the start of the draft are the same as ones rebuilt (after a reload) from the players left
		const atStart = await getClassFactsCached(pool, season);
		g.setWithoutSavingToDB("spectator", true);
		for (let i = 0; i < 20; i++) {
			await draft.runPicks({ type: "onePick" });
		}
		g.setWithoutSavingToDB("spectator", false);
		const left = await undrafted(season);
		assert.strictEqual(left.length, pool.length - 20);
		const rebuilt = await buildClassFacts(
			await wholeClassOf(left, season),
			season,
			true,
		);
		for (const p of left) {
			const a = atStart.get(p.pid)!;
			const b = rebuilt.get(p.pid)!;
			assert.strictEqual(b.valueRank, a.valueRank);
			assert.strictEqual(b.consensusRank, a.consensusRank);
			assert.strictEqual(b.production, a.production);
			assert.strictEqual(b.spread, a.spread);
			assert.strictEqual(b.combinePerf, a.combinePerf);
		}
		// (before the fix, ranks were counted among the players left: the best left was No. 1)
		const best = [...left].sort((a, b) => b.value - a.value)[0]!;
		assert.isAbove(rebuilt.get(best.pid)!.valueRank!, 1);
	});
});
