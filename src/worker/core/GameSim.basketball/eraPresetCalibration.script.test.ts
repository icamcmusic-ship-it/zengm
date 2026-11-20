// @ts-nocheck (diagnostic script)
// Era preset calibration (Settings > Tendencies > "Select preset based on historical NBA stats", src/ui/views/Settings/gameSimPresets.ts).
// Creates one new league with the new-league defaults (the fork's default League Extras on, League Eras off), plays it into its steady
// state (ERA_CAL_ADVANCE=3 whole seasons, then ERA_CAL_INTO=0.5 of the next regular season, so the rosters have a season's usual
// injuries), then for each season fits the game sim tendency settings so that a sample of games between the league's teams (played like
// the Settings preview: no DB writes, fixed seeds) matches that NBA season's league averages:
//   pace                     -> possessions per 48 minutes (from 1974; before that Basketball-Reference has no pace, so it is fit to
//                               points per team game instead, which pins the possessions given the shooting below)
//   threePointTendencyFactor -> 3PA / FGA        (from 1980, the first season with the line; before that the old value is kept)
//   foulRateFactor           -> FTA / FGA
//   orbFactor                -> ORB%             (from 1974, when offensive rebounds were first counted)
//   turnoverFactor           -> TOV%             (from 1974, the first season with team turnovers and pace on Basketball-Reference)
//   threePointAccuracyFactor -> 3P%              (from 1980; before that the old value is kept)
//   twoPointAccuracyFactor   -> 2P% (= (FG% - 3PA rate * 3P%) / (1 - 3PA rate)), so with 3PA rate and 3P% it gives eFG% and FG%
//                               (before 1980, the sim FG% to FG%)
//   ftAccuracyFactor         -> FT%
// With pace, the shooting, FT rate, ORB% and TOV% matched, points per game (and ORtg) follow; they are reported, not fit (except
// before 1974, see pace). The block and steal factors are kept from the old presets. Where a stat was not counted, its knob keeps the
// nearest later season's fit. Every iteration plays the same balanced set of games (with the next seed) and gives each knob an
// estimate (a damped multiplicative step toward its target); the fit is the average of the last iterations' estimates. Run with
//   ERA_CAL=1 ERA_CAL_OUT=/tmp/era.jsonl npx vitest run --maxWorkers=1 --project basketball <this file>
// Options: ERA_CAL_SEASONS=2026,2025 (default all, newest first; a later season's fit is the next one's starting point, so split a
// parallel run into contiguous ranges), ERA_CAL_GAMES=100 (games per iteration, rounded up to whole round robin rounds),
// ERA_CAL_ITERS=10, ERA_CAL_AVG_ITERS=ITERS/2 (iterations averaged), ERA_CAL_CHECK_GAMES=300 (fresh games, different seed, to report
// the fit), ERA_CAL_SEED=1 (league seed), ERA_CAL_START='{"orbFactor":1.1,...}' (starting knobs for the first season, e.g. the fit of
// the season after it from another run), ERA_CAL_TRACE=1 (also write every iteration). Writes one JSON line per season (fitted values,
// the targets, the check sample's stats and errors), and the presets as TypeScript (ERA_CAL_OUT.ts) to paste into gameSimPresets.ts.
// The presets in gameSimPresets.ts were fit with ERA_CAL_GAMES=210 ERA_CAL_ITERS=16 ERA_CAL_AVG_ITERS=10 ERA_CAL_CHECK_GAMES=510.
import "fake-indexeddb/auto";
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import gameSimPresets from "../../../ui/views/Settings/gameSimPresets.ts";
import { loadMatchups, runPreviewGames } from "../game/previewGameSim.ts";

const env = (globalThis as any).process.env;

// NBA (1947-1949 BAA) league averages by season (season = the year it ends), from Basketball-Reference's league averages table
// (https://www.basketball-reference.com/leagues/NBA_stats_per_game.html, fetched 2026-11-20; 2026 is the complete 2025-26 regular
// season). 3PA rate and FT rate are computed from the per game FGA, 3PA and FTA (Basketball-Reference's "FT/FGA" column is FT, not FTA).
// null where the stat was not counted (pace, ORtg, ORB%, TOV% before 1974; 3P% before 1980), 0 for the 3PA rate before 1980.
// [pace, pts per team game, ORtg, eFG%, FG%, 3P%, FT%, 3PA/FGA, FTA/FGA, ORB%, TOV%]
// prettier-ignore
const TARGETS: Record<number, [number | null, number, number | null, number, number, number | null, number, number, number, number | null, number | null]> = {
	2026: [99.4, 115.6, 115.7, 0.546, 0.471, 0.360, 0.783, 0.415, 0.264, 0.260, 0.127],
	2025: [98.8, 113.8, 114.5, 0.543, 0.467, 0.360, 0.780, 0.422, 0.243, 0.252, 0.126],
	2024: [98.5, 114.2, 115.3, 0.547, 0.474, 0.366, 0.784, 0.395, 0.244, 0.242, 0.121],
	2023: [99.2, 114.7, 114.8, 0.545, 0.475, 0.361, 0.782, 0.387, 0.266, 0.240, 0.125],
	2022: [98.2, 110.6, 112.0, 0.532, 0.461, 0.354, 0.775, 0.400, 0.249, 0.232, 0.123],
	2021: [99.2, 112.1, 112.3, 0.538, 0.466, 0.367, 0.778, 0.391, 0.247, 0.222, 0.124],
	2020: [100.3, 111.8, 110.6, 0.529, 0.460, 0.358, 0.773, 0.384, 0.260, 0.225, 0.128],
	2019: [100.0, 111.2, 110.4, 0.524, 0.461, 0.355, 0.766, 0.359, 0.259, 0.229, 0.124],
	2018: [97.3, 106.3, 108.6, 0.521, 0.460, 0.362, 0.767, 0.337, 0.252, 0.223, 0.130],
	2017: [96.4, 105.6, 108.8, 0.514, 0.457, 0.358, 0.772, 0.316, 0.270, 0.233, 0.127],
	2016: [95.8, 102.7, 106.4, 0.502, 0.452, 0.354, 0.757, 0.285, 0.277, 0.238, 0.132],
	2015: [93.9, 100.0, 105.6, 0.496, 0.449, 0.350, 0.750, 0.268, 0.273, 0.251, 0.133],
	2014: [93.9, 101.0, 106.6, 0.501, 0.454, 0.360, 0.756, 0.259, 0.284, 0.255, 0.136],
	2013: [92.0, 98.1, 105.8, 0.496, 0.453, 0.359, 0.753, 0.244, 0.271, 0.265, 0.137],
	2012: [91.3, 96.3, 104.6, 0.487, 0.448, 0.349, 0.752, 0.226, 0.276, 0.270, 0.138],
	2011: [92.1, 99.6, 107.3, 0.498, 0.459, 0.358, 0.763, 0.222, 0.300, 0.264, 0.134],
	2010: [92.7, 100.4, 107.6, 0.501, 0.461, 0.355, 0.759, 0.222, 0.300, 0.263, 0.133],
	2009: [91.7, 100.0, 108.3, 0.500, 0.459, 0.367, 0.771, 0.224, 0.305, 0.267, 0.133],
	2008: [92.4, 99.9, 107.5, 0.497, 0.457, 0.362, 0.755, 0.222, 0.306, 0.267, 0.132],
	2007: [91.9, 98.7, 106.5, 0.496, 0.458, 0.358, 0.752, 0.212, 0.327, 0.271, 0.142],
	2006: [90.5, 97.0, 106.2, 0.490, 0.454, 0.358, 0.745, 0.203, 0.333, 0.273, 0.137],
	2005: [90.9, 97.2, 106.1, 0.482, 0.447, 0.356, 0.756, 0.197, 0.325, 0.287, 0.136],
	2004: [90.1, 93.4, 102.9, 0.471, 0.439, 0.347, 0.752, 0.187, 0.303, 0.286, 0.142],
	2003: [91.0, 95.1, 103.6, 0.474, 0.442, 0.349, 0.758, 0.182, 0.302, 0.285, 0.140],
	2002: [90.7, 95.5, 104.5, 0.477, 0.445, 0.354, 0.752, 0.181, 0.293, 0.289, 0.136],
	2001: [91.3, 94.8, 103.0, 0.473, 0.443, 0.354, 0.748, 0.170, 0.309, 0.282, 0.141],
	2000: [93.1, 97.5, 104.1, 0.478, 0.449, 0.353, 0.750, 0.167, 0.308, 0.289, 0.142],
	1999: [88.9, 91.6, 102.2, 0.466, 0.437, 0.339, 0.728, 0.169, 0.330, 0.302, 0.146],
	1998: [90.3, 95.6, 105.0, 0.478, 0.450, 0.346, 0.737, 0.159, 0.330, 0.314, 0.145],
	1997: [90.1, 96.9, 106.7, 0.493, 0.455, 0.360, 0.738, 0.212, 0.319, 0.308, 0.148],
	1996: [91.8, 99.5, 107.6, 0.499, 0.462, 0.367, 0.740, 0.200, 0.329, 0.306, 0.147],
	1995: [92.9, 101.4, 108.3, 0.500, 0.466, 0.359, 0.737, 0.188, 0.333, 0.314, 0.146],
	1994: [95.1, 101.5, 106.3, 0.485, 0.466, 0.333, 0.734, 0.117, 0.315, 0.322, 0.143],
	1993: [96.8, 105.3, 108.0, 0.491, 0.473, 0.336, 0.754, 0.105, 0.322, 0.320, 0.140],
	1992: [96.6, 105.3, 108.2, 0.487, 0.472, 0.331, 0.759, 0.087, 0.306, 0.329, 0.136],
	1991: [97.8, 106.3, 107.9, 0.487, 0.474, 0.320, 0.765, 0.081, 0.320, 0.323, 0.139],
	1990: [98.3, 107.0, 108.1, 0.489, 0.476, 0.331, 0.764, 0.076, 0.327, 0.321, 0.139],
	1989: [100.6, 109.2, 107.8, 0.489, 0.477, 0.323, 0.768, 0.074, 0.324, 0.330, 0.145],
	1988: [99.6, 108.2, 108.0, 0.489, 0.480, 0.316, 0.766, 0.057, 0.332, 0.328, 0.143],
	1987: [100.8, 109.9, 108.3, 0.488, 0.480, 0.301, 0.763, 0.053, 0.343, 0.334, 0.143],
	1986: [102.1, 110.2, 107.2, 0.493, 0.487, 0.282, 0.756, 0.037, 0.342, 0.324, 0.149],
	1985: [102.1, 110.8, 107.9, 0.496, 0.491, 0.282, 0.764, 0.035, 0.330, 0.329, 0.149],
	1984: [101.4, 110.1, 107.6, 0.495, 0.492, 0.250, 0.760, 0.027, 0.336, 0.330, 0.150],
	1983: [103.1, 108.5, 104.7, 0.488, 0.485, 0.238, 0.740, 0.026, 0.315, 0.334, 0.158],
	1982: [100.9, 108.6, 106.9, 0.495, 0.491, 0.262, 0.746, 0.026, 0.324, 0.330, 0.150],
	1981: [101.8, 108.1, 105.5, 0.489, 0.486, 0.245, 0.751, 0.023, 0.327, 0.335, 0.156],
	1980: [103.1, 109.3, 105.3, 0.486, 0.481, 0.280, 0.764, 0.031, 0.307, 0.335, 0.155],
	1979: [105.8, 110.3, 103.8, 0.485, 0.485, null, 0.752, 0, 0.309, 0.328, 0.160],
	1978: [106.7, 108.5, 100.9, 0.469, 0.469, null, 0.752, 0, 0.306, 0.318, 0.160],
	1977: [106.5, 106.5, 99.5, 0.465, 0.465, null, 0.751, 0, 0.301, 0.318, 0.165],
	1976: [105.5, 104.3, 98.3, 0.458, 0.458, null, 0.751, 0, 0.293, 0.303, 0.160],
	1975: [104.5, 102.6, 97.7, 0.457, 0.457, null, 0.765, 0, 0.277, 0.302, 0.163],
	1974: [107.8, 105.7, 97.7, 0.459, 0.459, null, 0.771, 0, 0.271, 0.305, 0.165],
	1973: [null, 107.6, null, 0.456, 0.456, null, 0.758, 0, 0.261, null, null],
	1972: [null, 110.2, null, 0.455, 0.455, null, 0.748, 0, 0.327, null, null],
	1971: [null, 112.4, null, 0.449, 0.449, null, 0.745, 0, 0.334, null, null],
	1970: [null, 116.7, null, 0.460, 0.460, null, 0.751, 0, 0.339, null, null],
	1969: [null, 112.3, null, 0.441, 0.441, null, 0.714, 0, 0.354, null, null],
	1968: [null, 116.6, null, 0.446, 0.446, null, 0.720, 0, 0.368, null, null],
	1967: [null, 117.4, null, 0.441, 0.441, null, 0.732, 0, 0.351, null, null],
	1966: [null, 115.5, null, 0.433, 0.433, null, 0.727, 0, 0.361, null, null],
	1965: [null, 110.6, null, 0.426, 0.426, null, 0.721, 0, 0.357, null, null],
	1964: [null, 111.0, null, 0.433, 0.433, null, 0.722, 0, 0.353, null, null],
	1963: [null, 115.3, null, 0.441, 0.441, null, 0.727, 0, 0.355, null, null],
	1962: [null, 118.8, null, 0.426, 0.426, null, 0.727, 0, 0.344, null, null],
	1961: [null, 118.1, null, 0.415, 0.415, null, 0.731, 0, 0.343, null, null],
	1960: [null, 115.3, null, 0.410, 0.410, null, 0.735, 0, 0.329, null, null],
	1959: [null, 108.4, null, 0.395, 0.395, null, 0.756, 0, 0.355, null, null],
	1958: [null, 106.6, null, 0.383, 0.383, null, 0.746, 0, 0.376, null, null],
	1957: [null, 99.6, null, 0.380, 0.380, null, 0.751, 0, 0.390, null, null],
	1956: [null, 99.0, null, 0.387, 0.387, null, 0.745, 0, 0.416, null, null],
	1955: [null, 93.1, null, 0.385, 0.385, null, 0.738, 0, 0.415, null, null],
	1954: [null, 79.5, null, 0.372, 0.372, null, 0.709, 0, 0.438, null, null],
	1953: [null, 82.5, null, 0.370, 0.370, null, 0.716, 0, 0.466, null, null],
	1952: [null, 83.7, null, 0.367, 0.367, null, 0.735, 0, 0.411, null, null],
	1951: [null, 84.1, null, 0.357, 0.357, null, 0.733, 0, 0.400, null, null],
	1950: [null, 80.0, null, 0.340, 0.340, null, 0.712, 0, 0.398, null, null],
	1949: [null, 80.0, null, 0.327, 0.327, null, 0.703, 0, 0.353, null, null],
	1948: [null, 72.7, null, 0.284, 0.284, null, 0.675, 0, 0.281, null, null],
	1947: [null, 67.8, null, 0.279, 0.279, null, 0.641, 0, 0.267, null, null],
};

const T = {
	pace: 0,
	pts: 1,
	ortg: 2,
	efg: 3,
	fg: 4,
	tp: 5,
	ft: 6,
	tpaRate: 7,
	ftRate: 8,
	orb: 9,
	tov: 10,
} as const;

type Row = (typeof TARGETS)[number];
type Stats = Record<string, number>;

// 2P% from FG%, 3P% and the 3PA rate (FG% = (1 - r) * 2P% + r * 3P%)
const twoPct = (fg: number, tp: number | null, r: number) =>
	tp === null || r === 0 ? fg : (fg - r * tp) / (1 - r);

// knob, its target (null: not fit this season, the knob keeps its starting value), the sim stat, and the damping exponent (about 1 /
// the stat's elasticity to the knob, measured: ORB% moves ~4x as much as orbFactor in relative terms, FT rate ~2x foulRateFactor)
const KNOBS: [
	string,
	(row: Row) => number | null,
	(stats: Stats, row: Row) => number,
	(row: Row) => number,
][] = [
	[
		"pace",
		(row) => row[T.pace] ?? row[T.pts],
		// before 1974 (no pace) the possessions are fit to points per game
		(s, row) => (row[T.pace] === null ? s.pts : s.pace),
		(row) => (row[T.pace] === null ? 1 : 0.8),
	],
	[
		"threePointTendencyFactor",
		(row) => row[T.tpaRate] || null,
		(s) => s.tpaRate,
		() => 1,
	],
	["foulRateFactor", (row) => row[T.ftRate], (s) => s.ftRate, () => 0.45],
	["orbFactor", (row) => row[T.orb], (s) => s.orbPct, () => 0.25],
	["turnoverFactor", (row) => row[T.tov], (s) => s.tovPct, () => 0.7],
	["threePointAccuracyFactor", (row) => row[T.tp], (s) => s.tpPct, () => 1],
	[
		"twoPointAccuracyFactor",
		(row) => twoPct(row[T.fg], row[T.tp], row[T.tpaRate]),
		// before 1980 (no line) the sim's few threes count with the twos, so its FG% matches
		(s, row) =>
			row[T.tp] === null ? s.fgPct : twoPct(s.fgPct, s.tpPct, s.tpaRate),
		() => 0.9,
	],
	["ftAccuracyFactor", (row) => row[T.ft], (s) => s.ftPct, () => 1],
];

// sim stat key -> target index, for the reported errors
const REPORT = {
	pace: T.pace,
	pts: T.pts,
	ortg: T.ortg,
	efg: T.efg,
	fgPct: T.fg,
	tpPct: T.tp,
	ftPct: T.ft,
	tpaRate: T.tpaRate,
	ftRate: T.ftRate,
	orbPct: T.orb,
	tovPct: T.tov,
};

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

test.skipIf(!env.ERA_CAL)(
	"era presets",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seed = Number(env.ERA_CAL_SEED ?? 1);
		const games = Number(env.ERA_CAL_GAMES ?? 100);
		const iters = Number(env.ERA_CAL_ITERS ?? 10);
		const checkGames = Number(env.ERA_CAL_CHECK_GAMES ?? 300);
		const avgIters = Number(env.ERA_CAL_AVG_ITERS ?? Math.ceil(iters / 2));
		const advance = Number(env.ERA_CAL_ADVANCE ?? 3);
		const into = Number(env.ERA_CAL_INTO ?? 0.5);
		const seasons = env.ERA_CAL_SEASONS
			? env.ERA_CAL_SEASONS.split(",").map(Number)
			: Object.keys(TARGETS)
					.map(Number)
					.sort((a, b) => b - a);
		const out = (obj) => {
			if (env.ERA_CAL_OUT) {
				appendFileSync(env.ERA_CAL_OUT, `${JSON.stringify(obj)}\n`);
			}
		};

		Math.random = makeSeededRandom(seed);
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
				name: `era${seed}`,
				setLeagueCreationStatus: () => {},
				// Spectator, so every team is run by the AI through the offseasons
				// (League Eras off, so the style doesn't drift while the seasons are played)
				settings: {
					...getDefaultSettings(),
					spectator: true,
					featureLeagueEras: false,
				},
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();

		// Fit on a league in its steady state, not a brand new one: play ERA_CAL_ADVANCE whole seasons (with the offseasons), then
		// ERA_CAL_INTO of the next regular season, so the rosters have a season's usual injured and banged-up players (a new league
		// starts with none, and the games are played from the rosters as they are). The seasons are played with the 2026 preset.
		// Preview games of a brand new league's healthy rosters scored ~3 points per team game more than the same league's real
		// season (injuries ~2.7 of it) and new leagues settle ~1 point lower after their first season, so presets fit that way came
		// out ~4 points short in a league's real seasons.
		await league.setGameAttributes({ ...gameSimPresets[2026] });
		for (let i = 0; i < advance; i++) {
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await lock.set("gameSim", false);
			let guard = 0;
			while (
				g.get("phase") === PHASE.REGULAR_SEASON ||
				g.get("phase") === PHASE.AFTER_TRADE_DEADLINE ||
				g.get("phase") === PHASE.PLAYOFFS
			) {
				await game.play(
					g.get("phase") === PHASE.PLAYOFFS
						? 100
						: await season.getDaysLeftSchedule(),
					{},
				);
				if (++guard > 100) {
					throw new Error("stuck in season");
				}
			}
			await phase.newPhase(PHASE.DRAFT, {});
			await draft.runPicks({ type: "untilEnd" }, {});
			await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
			await phase.newPhase(PHASE.FREE_AGENCY, {});
			guard = 0;
			while (g.get("phase") === PHASE.FREE_AGENCY) {
				await freeAgents.play(30, {});
				if (++guard > 10) {
					throw new Error("stuck in free agency");
				}
			}
		}
		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		await lock.set("gameSim", false);
		const intoDays = Math.round(into * (await season.getDaysLeftSchedule()));
		if (intoDays > 0) {
			await game.play(intoDays, {});
		}
		await lock.set("gameSim", false);
		const injured = (await idb.cache.players.getAll()).filter(
			(p) => p.tid >= 0 && p.injury.gamesRemaining > 0,
		).length;
		console.log(
			JSON.stringify({ season: g.get("season"), advance, into, injured }),
		);

		const tids = (await idb.cache.teams.getAll()).map((t) => t.tid);
		// Balanced matchups: whole round robin rounds (circle method, on a seeded shuffle of the teams, home and away alternating), so
		// every team plays about as many games as every other (a random team mix moves the league averages, e.g. FT rate by ~0.005)
		const makePairs = (n: number, s: number) => {
			const r = makeSeededRandom(s);
			const shuffle = () => {
				const out = [...tids];
				for (let i = out.length - 1; i > 0; i--) {
					const j = Math.floor(r() * (i + 1));
					[out[i], out[j]] = [out[j], out[i]];
				}
				if (out.length % 2 === 1) {
					out.push(undefined);
				}
				return out;
			};
			let order = shuffle();
			const k = order.length;
			const pairs = [];
			for (let round = 0; pairs.length < n; round++) {
				if (round > 0 && round % (k - 1) === 0) {
					order = shuffle();
				}
				const rest = order.slice(1);
				const shift = round % (k - 1);
				const arr = [order[0], ...rest.slice(shift), ...rest.slice(0, shift)];
				for (let i = 0; i < k / 2; i++) {
					const a = arr[i];
					const b = arr[k - 1 - i];
					if (a !== undefined && b !== undefined) {
						pairs.push(round % 2 === 0 ? [a, b] : [b, a]);
					}
				}
			}
			return pairs;
		};
		const fitPairs = makePairs(games, 1000 + seed);
		const checkPairs = makePairs(checkGames, 2000 + seed);
		const play = async (pairs, settings, s) =>
			runPreviewGames(await loadMatchups(pairs, {}), settings, s);

		const fitted = {};
		let prev = env.ERA_CAL_START ? JSON.parse(env.ERA_CAL_START) : undefined;
		for (const season of seasons) {
			const target = TARGETS[season];
			const old = gameSimPresets[season] ?? gameSimPresets[2020];
			const settings = {
				...old,
				foulRateFactor: old.foulRateFactor ?? 1,
			};
			// Start the knobs from the neighboring (later) season's fit: a starting point when there is a target, and the value to keep
			// when the stat was not counted (ORB% and TOV% before 1974). Before 1980 (no line) the old 3PA and 3P% values stay.
			if (prev) {
				for (const [knob] of KNOBS) {
					if (
						knob !== "pace" &&
						!(
							(knob === "threePointTendencyFactor" ||
								knob === "threePointAccuracyFactor") &&
							target[T.tp] === null
						) &&
						prev[knob] !== undefined
					) {
						settings[knob] = prev[knob];
					}
				}
			}
			// Each iteration's games are effectively a fresh sample (a knob change shifts the random draws), and a 200 game sample's
			// league averages move by ~0.005 in FG% or FT rate from one to the next, so the fit averages over many iterations: each one
			// gives an estimate of the knob that would hit the target (knob * (target / stat) ^ exp), and the last avgIters estimates
			// are averaged. The settings themselves follow the estimates, so the later iterations are played near the answer.
			const implied = [];
			for (let it = 0; it < iters; it++) {
				const stats = await play(fitPairs, settings, 3000 + seed + it);
				if (env.ERA_CAL_TRACE) {
					out({ trace: true, season, it, settings, stats });
				}
				const estimate = { ...settings };
				for (const [knob, getTarget, get, exp] of KNOBS) {
					const t = getTarget(target);
					const s = get(stats, target);
					if (t === null || t === 0 || !(s > 0)) {
						continue;
					}
					const ratio = helpers.bound((t / s) ** exp(target), 0.75, 1.33);
					estimate[knob] = settings[knob] * ratio;
				}
				estimate.threePointTendencyFactor = helpers.bound(
					estimate.threePointTendencyFactor,
					0,
					3,
				);
				if (it >= iters - avgIters) {
					implied.push(estimate);
				}
				// Play the next iteration at the running average of the estimates (once averaging has started), else at this estimate
				for (const [knob] of KNOBS) {
					settings[knob] =
						implied.length > 0
							? implied.reduce((sum, row) => sum + row[knob], 0) /
								implied.length
							: estimate[knob];
				}
			}
			const check = await play(checkPairs, settings, 4000 + seed);
			const errors = {};
			for (const [stat, i] of Object.entries(REPORT)) {
				const t = target[i];
				if (t !== null && !(i === T.tpaRate && t === 0)) {
					errors[stat] = round(check[stat] - t, 4);
				}
			}
			const preset = {
				pace: round(settings.pace, 1),
				threePointTendencyFactor: round(settings.threePointTendencyFactor, 3),
				threePointAccuracyFactor: round(settings.threePointAccuracyFactor, 3),
				twoPointAccuracyFactor: round(settings.twoPointAccuracyFactor, 3),
				ftAccuracyFactor: round(settings.ftAccuracyFactor, 3),
				blockFactor: settings.blockFactor,
				stealFactor: settings.stealFactor,
				turnoverFactor: round(settings.turnoverFactor, 3),
				orbFactor: round(settings.orbFactor, 3),
				foulRateFactor: round(settings.foulRateFactor, 3),
			};
			fitted[season] = preset;
			prev = settings;
			const line = { season, target, preset, check, errors };
			out(line);
			console.log(JSON.stringify({ season, errors }));
		}

		const ts = Object.entries(fitted)
			.sort((a, b) => Number(b[0]) - Number(a[0]))
			.map(
				([season, p]) =>
					`\t\t\t\t${season}: {\n${Object.entries(p)
						.map(([k, v]) => `\t\t\t\t\t${k}: ${v},`)
						.join("\n")}\n\t\t\t\t},`,
			)
			.join("\n");
		if (env.ERA_CAL_OUT) {
			appendFileSync(`${env.ERA_CAL_OUT}.ts`, `${ts}\n`);
		}
	},
);
