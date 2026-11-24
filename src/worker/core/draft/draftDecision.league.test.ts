// AI draft decision in a league: every AI pick gets a Why (stored on the player and in the news), draft outcomes stay sane. The CI run
// drafts one class; the measurement over several seeded drafts is opt in:
//
//   RUN_DRAFT_DECISION=1 [DRAFT_DECISION_SEEDS=8] npx vitest --run --project basketball src/worker/core/draft/draftDecision.league.test.ts
import "fake-indexeddb/auto";
import { assert, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, league } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { afterNewPhase as combineAfterNewPhase } from "../draftCombine/index.ts";
import { afterNewPhase as outletsAfterNewPhase } from "../draftOutlets/index.ts";
import { BEST_AVAILABLE_REASON } from "./draftDecision.ts";

const env = (globalThis as any).process.env;

const draftOnce = async (seed: number) => {
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
		name: "draft decision",
		setLeagueCreationStatus: () => {},
		settings: getDefaultSettings(),
		shuffleRosters: false,
		startingSeasonFromInput: "2025",
		teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
		tid: 0,
	} as any);
	await league.loadGameAttributes();
	const season = g.get("season");

	// The combine (lottery phase) and the outlets' final boards (draft phase), as the phase changes would
	g.setWithoutSavingToDB("phase", PHASE.DRAFT_LOTTERY);
	await combineAfterNewPhase(PHASE.DRAFT_LOTTERY);
	await outletsAfterNewPhase(PHASE.DRAFT);
	g.setWithoutSavingToDB("phase", PHASE.DRAFT);

	const before = (
		await idb.cache.players.indexGetAll("playersByDraftYearRetiredYear", [
			[season],
			[season, Infinity],
		])
	).filter((p) => p.draft.year === season);
	const valueRank = new Map(
		[...before].sort((a, b) => b.value - a.value).map((p, i) => [p.pid, i + 1]),
	);

	await draft.genOrder(false);
	// The AI makes every pick, the user's too: in spectator mode the user's team drafts like any AI team
	g.setWithoutSavingToDB("spectator", true);
	await draft.runPicks({ type: "untilEnd" });
	g.setWithoutSavingToDB("spectator", false);

	const numTeams = g.get("numActiveTeams");
	const drafted = (await idb.cache.players.getAll())
		.filter((p) => p.draft.year === season && p.draft.round > 0)
		.map((p) => ({
			p,
			overall: (p.draft.round - 1) * numTeams + p.draft.pick,
			rank: valueRank.get(p.pid)!,
		}))
		.sort((a, b) => a.overall - b.overall);
	const events = (await idb.cache.events.getAll()).filter(
		(e) => e.type === "draft",
	);
	return { drafted, numTeams, events, userTid: g.get("userTid") };
};

test("every AI pick has a truthful, short Why; the news carries it", async () => {
	const { drafted, events, userTid } = await draftOnce(1);
	assert.isAbove(drafted.length, 40);
	for (const { p } of drafted) {
		const why = p.draft.why;
		assert.isDefined(why, `pick ${p.draft.round}-${p.draft.pick}`);
		assert.isAtLeast(why!.length, 1);
		assert.isAtMost(why!.length, 4);
		assert.strictEqual(new Set(why).size, why!.length);
		for (const line of why!) {
			assert.notMatch(line.replace(/(No\. |#)\d+/g, ""), /\d/);
		}
	}
	assert.isTrue(events.some((e) => e.text?.includes(" Why: ")));
	// The best player by value goes first, and says so
	const first = drafted[0]!;
	assert.isAtMost(first.rank, 3);
	if (first.rank === 1 && first.p.draft.tid !== userTid) {
		assert.include(first.p.draft.why!, BEST_AVAILABLE_REASON);
	}
}, 240_000);

test.skipIf(!env.RUN_DRAFT_DECISION)(
	"measured over several drafts",
	async () => {
		const seeds = Number(env.DRAFT_DECISION_SEEDS ?? 8);
		let top3Top5 = 0;
		let top3N = 0;
		let devR1 = 0;
		let devAll = 0;
		let nR1 = 0;
		let nAll = 0;
		let reaches = 0;
		let needReaches = 0;
		let bpaPicks = 0;
		const reasonCounts = new Map<string, number>();
		for (let seed = 1; seed <= seeds; seed++) {
			const { drafted, numTeams } = await draftOnce(seed);
			const byOverall = new Map(drafted.map((x) => [x.p.pid, x.overall]));
			for (const x of drafted.filter((x) => x.rank <= 3)) {
				top3N += 1;
				if ((byOverall.get(x.p.pid) ?? Infinity) <= 5) {
					top3Top5 += 1;
				}
			}
			const taken = new Set<number>();
			for (const x of drafted) {
				const dev = Math.abs(x.overall - x.rank);
				devAll += dev;
				nAll += 1;
				if (x.overall <= numTeams) {
					devR1 += dev;
					nR1 += 1;
				}
				// A reach: 3 or more players better by value were still on the board
				let better = 0;
				for (const y of drafted) {
					if (y.rank < x.rank && !taken.has(y.p.pid)) {
						better += 1;
					}
				}
				taken.add(x.p.pid);
				if (better === 0) {
					bpaPicks += 1;
				}
				const why = x.p.draft.why ?? [];
				if (better >= 3) {
					reaches += 1;
					if (why.some((line) => /need|lack|Last |crowded/.test(line))) {
						needReaches += 1;
					}
				}
				for (const line of why) {
					const key = line
						.replace(/\(.*\)/, "")
						.replace(/(No\. |#)\d+/g, "N")
						.trim();
					reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
				}
			}
		}
		const lines = [
			`seeds ${seeds}`,
			`top-3 by value drafted top-5: ${((100 * top3Top5) / top3N).toFixed(1)}%`,
			`mean |pick - value rank|: round 1 ${(devR1 / nR1).toFixed(2)}, all ${(devAll / nAll).toFixed(2)}`,
			`best available by value: ${((100 * bpaPicks) / nAll).toFixed(1)}% of picks`,
			`reaches (3+ better left): ${((100 * reaches) / nAll).toFixed(1)}% of picks, need-based ${((100 * needReaches) / nAll).toFixed(1)}%`,
			"reasons:",
			...[...reasonCounts]
				.sort((a, b) => b[1] - a[1])
				.map(([k, n]) => `  ${n}\t${k}`),
		];
		console.log(lines.join("\n"));
	},
	3_600_000,
);
