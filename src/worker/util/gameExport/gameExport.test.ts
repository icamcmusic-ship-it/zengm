// Per-game download (Game Log, "Download game data"): a short headless spectator season with the play-by-play stored, then the file for
// a regular season game, a playoff game and an "old" game (play-by-play and the recorded context removed), with scouting fuzz and the
// No Visible Ratings challenge. Building the file draws no Math.random.
import "fake-indexeddb/auto";
import { assert, beforeAll, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { gameExportCsvFiles } from "../../../common/gameExport/csv.ts";
import {
	GAME_EXPORT_SCHEMA_VERSION,
	winProbability,
} from "../../../common/gameExport/index.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import type { Game } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import { game as gameCore, league, phase } from "../../core/index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { getPlayer } from "../../views/player.ts";
import { g, helpers } from "../index.ts";
import { buildGameExport } from "./index.ts";
import { seriesWinProb } from "./odds.ts";

const playUntil = async (until: (phase: number) => boolean) => {
	// (a guard: game.play refuses to sim, and this would spin forever, if a roster is short)
	for (let i = 0; !until(g.get("phase")); i++) {
		if (i > 300) {
			throw new Error("season did not finish");
		}
		await gameCore.play(1, {});
	}
};

// Build the file with Math.random replaced by a function that throws
const exportNoRandom = async (gid: number) => {
	const real = Math.random;
	let draws = 0;
	Math.random = () => {
		draws += 1;
		return real();
	};
	try {
		const file = await buildGameExport(gid);
		return { file, draws };
	} finally {
		Math.random = real;
	}
};

let regular: Game;
let playoff: Game | undefined;

describe("game export", () => {
	beforeAll(
		async () => {
			Math.random = makeSeededRandom(11);
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
					name: "gameExport",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						spectator: true,
						storePlayByPlay: true,
						numGames: 12,
						numGamesPlayoffSeries: [3, 3, 3, 3],
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await playUntil((p) => p >= PHASE.PLAYOFFS);
			await playUntil((p) => p > PHASE.PLAYOFFS);
			const games = (await idb.cache.games.getAll()).sort(
				(a, b) => a.gid - b.gid,
			);
			// A late regular season game with the play-by-play stored
			regular = games.findLast(
				(x) => !x.playoffs && x.pbp && x.teams[0].tid >= 0,
			)!;
			playoff = games.findLast(
				(x) => x.playoffs && x.numGamesToWinSeries !== undefined && x.pbp,
			);
		},
		10 * 60 * 1000,
	);

	test("regular season game: every section", { timeout: 120_000 }, async () => {
		assert.isDefined(regular);
		const { file, draws } = await exportNoRandom(regular.gid);
		// (the profiles go through the player page's own code, which may store an archetype; the file itself draws nothing)
		assert.strictEqual(draws, 0, "Math.random draws while building the file");
		assert.strictEqual(file.schemaVersion, GAME_EXPORT_SCHEMA_VERSION);
		assert.strictEqual(file.format, "zengm-game");
		assert.isAbove(Object.keys(file.dataDictionary).length, 20);

		// Pregame
		const { stakes, odds, scheduleLoad, headToHead, venue } = file.pregame;
		assert.strictEqual(stakes.phase, "regularSeason");
		assert.strictEqual(stakes.teams.length, 2);
		for (const t of stakes.teams) {
			assert.isAtLeast(t.gameNumber, 2);
			assert.match(t.record, /^\d+-\d+/);
			assert.isNotNull(t.standings);
			assert.isAtLeast(t.standings!.confRank, 1);
		}
		assert.isAbove(stakes.winProbability.home, 0);
		assert.isBelow(stakes.winProbability.home, 1);
		assert.isNotNull(scheduleLoad);
		for (const s of scheduleLoad!) {
			assert.isNotNull(s.restDays);
			assert.isAtLeast(s.stand.length, 1);
			assert.isNotNull(s.travel.to);
		}
		assert.isNotNull(headToHead);
		assert.isString(venue.city);
		if (odds) {
			assert.strictEqual(odds.kind, "season");
			if (odds.kind === "season") {
				assert.strictEqual(odds.teams.length, 2);
				for (const t of odds.teams) {
					assert.isAtLeast(t.before.playoffs, 0);
					assert.isAtMost(t.after.playoffs, 1);
				}
			}
		} else {
			assert.isTrue(file.unavailable.some((u) => u.path === "pregame.odds"));
		}
		// Same seed both runs: running it again gives the same numbers
		const again = await buildGameExport(regular.gid);
		assert.deepStrictEqual(again.pregame.odds, file.pregame.odds);

		// Teams
		for (const tc of file.teamContext) {
			assert.isNotNull(tc.coaching);
			assert.isNotNull(tc.identity.ortg);
			assert.isNotNull(tc.frontOffice);
			assert.isNotNull(tc.lineups);
			assert.strictEqual(tc.lineups!.starters.length, 5);
			assert.strictEqual(tc.lineups!.closing!.length, 5);
			assert.isAbove(tc.lineups!.groups!.length, 0);
			assert.isAbove(tc.lineups!.onOff!.length, 0);
			assert.isArray(tc.availability.out);
		}

		// Players
		const played = file.playerContext.filter(
			(p) => p.seasonBaseline.thisGame !== null,
		);
		assert.isAbove(played.length, 15);
		let fga = 0;
		let withEnergy = 0;
		let withMatchups = 0;
		for (const p of played) {
			assert.isNotNull(p.profile);
			assert.isString(p.profile!.height);
			assert.isAtMost(p.profile!.badges.length, 6);
			assert.oneOf(p.role.role, ["starter", "bench"]);
			assert.isNotNull(p.fatigue);
			assert.isAbove(p.fatigue!.minByPeriod.length, 0);
			if (p.fatigue!.energyCurve) {
				withEnergy += 1;
				for (const e of p.fatigue!.energyCurve) {
					assert.isAtLeast(e.energy, 0);
					assert.isAtMost(e.energy, 1);
				}
			}
			if (p.matchups && p.matchups.offense.length > 0) {
				withMatchups += 1;
			}
			fga += p.shotChart!.length;
		}
		assert.strictEqual(withEnergy, played.length, "energy curve");
		const boxFga = regular.teams[0].fga + regular.teams[1].fga;
		assert.strictEqual(
			fga,
			boxFga,
			"every field goal attempt in the shot chart",
		);
		if (regular.shotLog) {
			assert.strictEqual(regular.shotLog.length, boxFga, "shot log rows");
			assert.isAbove(withMatchups, 10);
			const shots = file.playerContext.flatMap((p) => p.shotChart ?? []);
			assert.isAbove(
				shots.filter((s: any) => s.playType !== undefined).length,
				0.95 * shots.length,
				"shot log aligned with the play-by-play",
			);
		} else {
			assert.isTrue(
				file.unavailable.some((u) => u.path === "playerContext[].matchups"),
			);
		}

		// Analytics
		const a = file.analytics!;
		assert.isNotNull(a.winProbability);
		const wp = a.winProbability!;
		const final = wp.timeline.at(-1)!;
		const homeWon = regular.teams[0].pts > regular.teams[1].pts;
		assert.strictEqual(final.wp, homeWon ? 1 : 0);
		assert.deepStrictEqual(final.score, [
			regular.teams[0].pts,
			regular.teams[1].pts,
		]);
		assert.isAbove(wp.swings.length, 0);
		assert.isAbove(wp.topPlayers.length, 0);
		assert.isNotNull(a.flow);
		assert.isAtLeast(a.flow!.leadChanges, 0);
		assert.isNotNull(a.clutch);
		for (const [i, s] of a.splits.entries()) {
			const pts = regular.teams[i]!.pts;
			const full = s as any;
			assert.isAtMost(full.paint, pts);
			// (free throws count in transition or half court too, by when they came)
			assert.strictEqual(
				full.transition + full.halfcourt,
				pts,
				"transition + half court = points",
			);
			assert.isAtMost(full.fastBreak, full.transition);
			assert.isAtLeast(full.bench, 0);
		}
		for (const t of a.box.teams) {
			assert.isNotNull(t.ortg);
			assert.isNotNull(t.fourFactors.efg);
			for (const p of t.players) {
				if (p.tsPct !== null) {
					assert.isAtLeast(p.tsPct, 0);
				}
			}
		}

		// No true ratings with the play-by-play's players
		for (const p of file.playByPlay!.players) {
			assert.notProperty(p, "ratings");
		}

		// CSV
		const csv = gameExportCsvFiles({
			...file,
			teams: [
				{ tid: regular.teams[0].tid, abbrev: "HOM" },
				{ tid: regular.teams[1].tid, abbrev: "AWY" },
			],
			playByPlay: {
				lines: [
					{ period: 1, clock: "12:00", text: "Tip", score: { HOM: 0, AWY: 0 } },
				],
			},
		} as any);
		const names = csv.map((f) => f.name);
		for (const name of [
			"box_score.csv",
			"play_by_play.csv",
			"shot_chart.csv",
			"lineups.csv",
			"on_off.csv",
		]) {
			assert.include(names, name);
		}
		const shotCsv = csv.find((f) => f.name === "shot_chart.csv")!.text;
		assert.strictEqual(shotCsv.split("\n").length, boxFga + 1);

		if ((globalThis as any).process?.env?.GAME_EXPORT_DUMP) {
			const fs = await import(/* @vite-ignore */ "node:fs" as string);
			fs.writeFileSync(
				(globalThis as any).process.env.GAME_EXPORT_DUMP,
				JSON.stringify(file, null, 1),
			);
		}
		const size = JSON.stringify(file).length;
		console.log(`game export: ${Math.round(size / 1024)} KB (compact JSON)`);
		assert.isBelow(size, 5_000_000);
	});

	test("playoff game: series", { timeout: 60_000 }, async () => {
		assert.isDefined(playoff);
		const file = await buildGameExport(playoff!.gid);
		assert.strictEqual(file.pregame.stakes.phase, "playoffs");
		const series = file.pregame.series!;
		assert.isNotNull(series);
		assert.strictEqual(series.numGamesToWin, 2);
		assert.isAtLeast(series.gameNumber, 1);
		assert.isAtMost(series.gameNumber, 3);
		const odds = file.pregame.odds;
		assert.isNotNull(odds);
		assert.strictEqual(odds!.kind, "series");
	});

	test("old game without play-by-play: null sections with reasons", async () => {
		const copy: any = helpers.deepCopy(regular);
		delete copy.pbp;
		delete copy.shotLog;
		for (const t of copy.teams) {
			for (const p of t.players) {
				delete p.ctx;
			}
		}
		copy.gid = 10_000_000;
		await idb.cache.games.put(copy);
		try {
			const file = await buildGameExport(copy.gid);
			assert.isUndefined(file.playByPlay);
			assert.isNull(file.analytics!.winProbability);
			assert.isNull(file.analytics!.flow);
			assert.isNull(file.teamContext[0]!.lineups!.closing);
			assert.isNull(file.playerContext[0]!.shotChart);
			const paths = file.unavailable.map((u) => u.path);
			for (const path of [
				"analytics.winProbability",
				"playerContext[].fatigue",
				"playerContext[].shotChart",
				"playerContext[].matchups",
				"playerContext[].fatigue.energyCurve",
			]) {
				assert.include(paths, path);
			}
			for (const u of file.unavailable) {
				assert.isAbove(u.reason.length, 10);
			}
			// The box score part still works
			assert.isNotNull(file.analytics!.box.teams[0]!.ortg);
		} finally {
			await idb.cache.games.delete(copy.gid);
		}
	});

	test(
		"scouting fuzz and No Visible Ratings",
		{ timeout: 60_000 },
		async () => {
			// Fuzz: a big scouting error on one player. His badges are the player page's (read from his ratings as scouted); wingspan is a
			// measurement, which the pages show unfuzzed like height
			const line = regular.teams[1].players.find((p: any) => p.min > 0)!;
			const p = (await idb.cache.players.get(line.pid))!;
			const r = p.ratings.at(-1)! as any;
			r.fuzz = 7;
			await idb.cache.players.put(p);
			let file = await buildGameExport(regular.gid);
			let prof = file.playerContext.find((x) => x.pid === line.pid)!.profile!;
			assert.isTrue(prof.ratingsShown);
			assert.strictEqual(
				prof.wingspan,
				typeof r.wng === "number" ? r.wng : null,
			);
			const page: any = await getPlayer(p);
			assert.deepStrictEqual(
				prof.badges.map((b: any) => b.name),
				(page.tieredBadges?.earned ?? []).slice(0, 6).map((b: any) => b.name),
			);

			// No Visible Ratings: no ratings anywhere, badges as names and tiers only
			await league.setGameAttributes({ challengeNoRatings: true });
			try {
				file = await buildGameExport(regular.gid);
				for (const x of file.playerContext) {
					if (!x.profile) {
						continue;
					}
					assert.isFalse(x.profile.ratingsShown);
					assert.isNull(x.profile.wingspan);
					for (const b of x.profile.badges) {
						assert.hasAllKeys(b, ["name", "tier", "category"]);
					}
				}
				prof = file.playerContext.find((x) => x.pid === line.pid)!.profile!;
				const text = JSON.stringify(file.playerContext);
				assert.notMatch(text, /"(ovr|pot|wng|fuzz)":/);
				for (const pl of file.playByPlay!.players) {
					assert.notProperty(pl, "ratings");
				}
			} finally {
				await league.setGameAttributes({ challengeNoRatings: false });
			}
		},
	);
});

describe("models", () => {
	test("win probability", () => {
		assert.closeTo(winProbability(0, 1, 0), 0.5, 1e-9);
		assert.isAbove(winProbability(0, 1, 5), 0.6);
		assert.strictEqual(winProbability(3, 0, 0), 1);
		assert.isAbove(winProbability(10, 0.1, 0), 0.95);
	});
	test("series odds", () => {
		assert.closeTo(seriesWinProb(0, 0, 4, 0.5), 0.5, 1e-9);
		assert.strictEqual(seriesWinProb(4, 2, 4, 0.3), 1);
		assert.closeTo(seriesWinProb(3, 3, 4, 0.6), 0.6, 1e-9);
	});
});
