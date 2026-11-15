// Advanced stats every 3 days setting (util/advStatsFlush.ts): a short season simmed with advanced stats computed after
// every third game day only (flushed before anything reads them). The advanced stats stored when a sim stops and at the
// end of the playoffs must be exactly what the every-day computation stores: a computation from the same totals.
// (Two leagues in one process do not sim identically, so the every-day league itself is compared in separate
// processes: same-seed simBenchmark runs give the same league hash with the setting on and off.)
import "fake-indexeddb/auto";
import { assert, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { game, league, phase, season } from "../index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { advStats, advStatsRunCount } from "../../util/advStats.ts";

const ADV = [
	"per",
	"ewa",
	"ows",
	"dws",
	"obpm",
	"dbpm",
	"vorp",
	"ortg",
	"drtg",
	"usgp",
	"astp",
	"trbp",
	"onOff100",
];

const snapshot = async (playoffs: boolean) => {
	const players = await idb.cache.players.getAll();
	const rows: unknown[] = [];
	for (const p of players) {
		for (const ps of p.stats) {
			if (ps.season === g.get("season") && ps.playoffs === playoffs) {
				rows.push([
					p.pid,
					ps.tid,
					ps.playoffs,
					ADV.map((key) => (ps as any)[key]),
				]);
			}
		}
	}
	return JSON.stringify(
		rows.sort((a: any, b: any) =>
			a[0] !== b[0] ? a[0] - b[0] : Number(a[2]) - Number(b[2]),
		),
	);
};

// The stored advanced stats of this season (regular season or playoffs rows), then the same rows as the every-day
// computation would leave them: advanced stats recomputed now, in the phase they belong to
const storedAndRecomputed = async (playoffs: boolean) => {
	const stored = await snapshot(playoffs);
	const phase = g.get("phase");
	g.setWithoutSavingToDB(
		"phase",
		playoffs ? PHASE.PLAYOFFS : PHASE.REGULAR_SEASON,
	);
	try {
		await advStats();
	} finally {
		g.setWithoutSavingToDB("phase", phase);
	}
	return { stored, recomputed: await snapshot(playoffs) };
};

test(
	"season-end advanced stats with every-3-days computation are identical to every-day",
	{ timeout: 20 * 60 * 1000 },
	async () => {
		Math.random = makeSeededRandom(7);
		const settings: any = getDefaultSettings();
		settings.advStatsEvery3Days = true;
		settings.numGames = 20;
		settings.numGamesPlayoffSeries = [1, 1, 1, 1];
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
				name: "advStats",
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		assert.strictEqual(g.get("advStatsEvery3Days"), true);

		const play = async (numDays: number) => {
			await lock.set("gameSim", false);
			await game.play(numDays, {});
		};

		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		const runs0 = advStatsRunCount();
		const days0 = await season.getDaysLeftSchedule();
		// Stopping a sim mid-cycle (day 7): a sim leaves them up to date when it stops
		await play(7);
		const mid = await storedAndRecomputed(false);
		assert.ok(mid.stored.length > 100, mid.stored);
		assert.ok(mid.stored.includes("."));
		assert.strictEqual(mid.stored, mid.recomputed);

		// The rest of the regular season and the playoffs, into the draft lottery. Playoff days are skipped too, so the
		// final playoff values come from the flush before the phase change
		await play(await season.getDaysLeftSchedule());
		await play(100);
		assert.strictEqual(g.get("phase"), PHASE.DRAFT_LOTTERY);
		// The setting did skip days: the every-day computation runs once per game day
		const runs = advStatsRunCount() - runs0;
		assert.ok(runs < days0 * 0.75, `${runs} computations for ${days0} days`);

		const end = await storedAndRecomputed(true);
		assert.ok(end.stored.length > 20, end.stored);
		assert.ok(end.stored.includes("."));
		assert.strictEqual(end.stored, end.recomputed);
	},
);
