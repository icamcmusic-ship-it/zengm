// @ts-nocheck (diagnostic script)
// Era preset calibration (Settings > Tendencies > "Select preset based on historical NBA stats", src/ui/views/Settings/gameSimPresets.ts).
// Creates one new league with the new-league defaults (the fork's default League Extras on), then for each season fits the game sim
// tendency settings so that a sample of games between the league's teams (played like the Settings preview: no DB writes, fixed seeds)
// matches that NBA season's league averages:
//   pace            -> sim possessions per 48 minutes
//   threePointTendencyFactor -> 3PA / FGA        (from 1980, the first season with the line; before that the old value is kept)
//   foulRateFactor  -> FTA / FGA
//   orbFactor       -> ORB%                      (from 1974, when offensive rebounds were first counted)
//   turnoverFactor  -> TOV%                      (from 1978, when turnovers were first counted)
// The accuracy, block and steal factors are kept from the old presets (2021-2026 start from 2020's). Where a stat was not counted,
// its knob keeps the nearest later season's fit. Each knob gets a damped
// multiplicative update per iteration; every iteration plays the same games with the same seed (common random numbers), so it is
// deterministic and converges smoothly. Run with
//   ERA_CAL=1 ERA_CAL_OUT=/tmp/era.jsonl npx vitest run --maxWorkers=1 --project basketball <this file>
// Options: ERA_CAL_SEASONS=2026,2025 (default all), ERA_CAL_GAMES=100 (games per iteration), ERA_CAL_ITERS=10, ERA_CAL_CHECK_GAMES=300
// (fresh games, different seed, to report the fit), ERA_CAL_SEED=1 (league seed). Writes one JSON line per season (fitted values, the
// targets, the check sample's stats and errors), and prints the presets as TypeScript to paste into gameSimPresets.ts.
import "fake-indexeddb/auto";
import { appendFileSync } from "node:fs";
import { test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { league, phase } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { helpers, lock } from "../../util/index.ts";
import gameSimPresets from "../../../ui/views/Settings/gameSimPresets.ts";
import { loadMatchups, runPreviewGames } from "../game/previewGameSim.ts";

const env = (globalThis as any).process.env;

// NBA league averages by season (season = the year it ends), from Basketball-Reference's league averages table, rounded.
// [pace, 3PA/FGA, FTA/FGA, ORB%, TOV%]; null where the stat was not counted that season. Pace before 1974 is Basketball-Reference's
// estimate (the same values the old presets used). 2026 is the 2025-26 season to date.
// prettier-ignore
const TARGETS: Record<number, [number, number, number, number | null, number | null]> = {
	2026: [99.6, 0.425, 0.243, 0.25, 0.124],
	2025: [99.0, 0.421, 0.240, 0.247, 0.125],
	2024: [98.5, 0.391, 0.248, 0.244, 0.122],
	2023: [99.1, 0.387, 0.259, 0.243, 0.125],
	2022: [98.2, 0.395, 0.246, 0.239, 0.124],
	2021: [99.2, 0.392, 0.251, 0.224, 0.124],
	2020: [100.3, 0.384, 0.259, 0.229, 0.128],
	2019: [100.0, 0.359, 0.259, 0.229, 0.126],
	2018: [97.3, 0.337, 0.254, 0.226, 0.131],
	2017: [96.4, 0.316, 0.267, 0.232, 0.127],
	2016: [95.8, 0.285, 0.275, 0.238, 0.132],
	2015: [93.9, 0.268, 0.268, 0.251, 0.136],
	2014: [93.9, 0.259, 0.278, 0.253, 0.136],
	2013: [92.0, 0.243, 0.266, 0.266, 0.136],
	2012: [91.3, 0.226, 0.281, 0.270, 0.137],
	2011: [92.1, 0.222, 0.292, 0.262, 0.132],
	2010: [92.7, 0.222, 0.300, 0.265, 0.133],
	2009: [91.7, 0.224, 0.302, 0.266, 0.133],
	2008: [92.4, 0.222, 0.304, 0.267, 0.132],
	2007: [91.9, 0.211, 0.320, 0.277, 0.139],
	2006: [90.5, 0.200, 0.325, 0.283, 0.133],
	2005: [90.9, 0.195, 0.324, 0.292, 0.135],
	2004: [90.1, 0.186, 0.304, 0.287, 0.138],
	2003: [91.0, 0.186, 0.307, 0.287, 0.138],
	2002: [90.7, 0.181, 0.300, 0.292, 0.133],
	2001: [91.3, 0.172, 0.310, 0.292, 0.137],
	2000: [93.1, 0.168, 0.322, 0.300, 0.138],
	1999: [88.9, 0.169, 0.335, 0.309, 0.144],
	1998: [90.3, 0.155, 0.325, 0.308, 0.143],
	1997: [90.1, 0.201, 0.312, 0.310, 0.144],
	1996: [91.8, 0.200, 0.325, 0.308, 0.144],
	1995: [92.9, 0.182, 0.335, 0.310, 0.144],
	1994: [95.1, 0.122, 0.322, 0.319, 0.143],
	1993: [96.8, 0.104, 0.329, 0.320, 0.137],
	1992: [96.6, 0.086, 0.324, 0.321, 0.136],
	1991: [97.8, 0.077, 0.326, 0.322, 0.138],
	1990: [98.3, 0.071, 0.336, 0.325, 0.140],
	1989: [100.6, 0.064, 0.327, 0.329, 0.141],
	1988: [99.6, 0.050, 0.322, 0.321, 0.140],
	1987: [100.8, 0.044, 0.334, 0.324, 0.141],
	1986: [102.1, 0.030, 0.325, 0.317, 0.147],
	1985: [102.1, 0.030, 0.322, 0.318, 0.146],
	1984: [101.4, 0.020, 0.330, 0.316, 0.146],
	1983: [103.1, 0.019, 0.313, 0.322, 0.153],
	1982: [100.9, 0.023, 0.312, 0.318, 0.149],
	1981: [101.8, 0.019, 0.316, 0.325, 0.152],
	1980: [103.1, 0.028, 0.307, 0.327, 0.152],
	1979: [105.8, 0, 0.313, 0.335, 0.157],
	1978: [106.7, 0, 0.322, 0.334, 0.156],
	1977: [106.5, 0, 0.319, 0.330, null],
	1976: [105.5, 0, 0.318, 0.318, null],
	1975: [104.5, 0, 0.302, 0.318, null],
	1974: [107.8, 0, 0.286, 0.313, null],
	1973: [110.385, 0, 0.287, null, null],
	1972: [109.785, 0, 0.310, null, null],
	1971: [112.988, 0, 0.309, null, null],
	1970: [114.811, 0, 0.313, null, null],
	1969: [114.571, 0, 0.317, null, null],
	1968: [117.058, 0, 0.356, null, null],
	1967: [119.602, 0, 0.366, null, null],
	1966: [118.921, 0, 0.362, null, null],
	1965: [115.617, 0, 0.370, null, null],
	1964: [114.689, 0, 0.365, null, null],
	1963: [117.316, 0, 0.369, null, null],
	1962: [125.168, 0, 0.365, null, null],
	1961: [127.219, 0, 0.361, null, null],
	1960: [126.113, 0, 0.352, null, null],
	1959: [118.68, 0, 0.379, null, null],
	1958: [118.564, 0, 0.392, null, null],
	1957: [109.736, 0, 0.424, null, null],
	1956: [106.17, 0, 0.445, null, null],
	1955: [101, 0, 0.434, null, null],
	1954: [93, 0, 0.464, null, null],
	1953: [95, 0, 0.489, null, null],
	1952: [97, 0, 0.442, null, null],
	1951: [99, 0, 0.424, null, null],
	1950: [99, 0, 0.432, null, null],
	1949: [104, 0, 0.375, null, null],
	1948: [108, 0, 0.351, null, null],
	1947: [104, 0, 0.326, null, null],
};

// knob, the stat it is fit to (index in a TARGETS row), the stat's key in the preview stats, and the damping exponent (about 1 / the
// stat's elasticity to the knob, measured: ORB% moves ~4x as much as orbFactor in relative terms, FT rate ~2x foulRateFactor)
const KNOBS = [
	["pace", 0, "pace", 0.8],
	["threePointTendencyFactor", 1, "tpaRate", 1],
	["foulRateFactor", 2, "ftRate", 0.45],
	["orbFactor", 3, "orbPct", 0.25],
	["turnoverFactor", 4, "tovPct", 0.7],
] as const;

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

test.skipIf(!env.ERA_CAL)(
	"era presets",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seed = Number(env.ERA_CAL_SEED ?? 1);
		const games = Number(env.ERA_CAL_GAMES ?? 100);
		const iters = Number(env.ERA_CAL_ITERS ?? 10);
		const checkGames = Number(env.ERA_CAL_CHECK_GAMES ?? 300);
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
				settings: { ...getDefaultSettings() },
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		await phase.newPhase(PHASE.REGULAR_SEASON, {});
		await lock.set("gameSim", false);

		const tids = (await idb.cache.teams.getAll()).map((t) => t.tid);
		const makePairs = (n: number, s: number) => {
			const r = makeSeededRandom(s);
			const pairs = [];
			for (let i = 0; i < n; i++) {
				const a = Math.floor(r() * tids.length);
				let b = Math.floor(r() * (tids.length - 1));
				if (b >= a) {
					b += 1;
				}
				pairs.push([tids[a], tids[b]]);
			}
			return pairs;
		};
		const fitPairs = makePairs(games, 1000 + seed);
		const checkPairs = makePairs(checkGames, 2000 + seed);
		const play = async (pairs, settings, s) =>
			runPreviewGames(await loadMatchups(pairs, {}), settings, s);

		const fitted = {};
		let prev;
		for (const season of seasons) {
			const target = TARGETS[season];
			const old = gameSimPresets[season] ?? gameSimPresets[2020];
			const settings = {
				...old,
				foulRateFactor: old.foulRateFactor ?? 1,
			};
			// Start the tendency knobs from the neighboring (later) season's fit: a starting point when there is a target, and the value
			// to keep when the stat was not counted (ORB before 1974, TOV before 1978). Before 1980 (no line) the old near-zero 3PA value stays.
			if (prev) {
				for (const [knob, i] of KNOBS) {
					if (knob !== "pace" && target[i] !== 0) {
						settings[knob] = prev[knob];
					}
				}
			}
			const avg = [];
			for (let it = 0; it < iters; it++) {
				const stats = await play(fitPairs, settings, 3000 + seed);
				if (env.ERA_CAL_TRACE) {
					console.log(JSON.stringify({ season, it, settings, stats }));
				}
				for (const [knob, i, stat, exp] of KNOBS) {
					const t = target[i];
					if (t === null || t === 0 || stats[stat] <= 0) {
						continue;
					}
					const ratio = helpers.bound((t / stats[stat]) ** exp, 0.75, 1.33);
					settings[knob] *= ratio;
				}
				settings.threePointTendencyFactor = helpers.bound(
					settings.threePointTendencyFactor,
					0,
					3,
				);
				// Average the knobs over the last 3 iterations (smooths out the sampling noise of a 100 game fit)
				if (it >= iters - 3) {
					avg.push({ ...settings });
				}
			}
			for (const [knob] of KNOBS) {
				settings[knob] =
					avg.reduce((sum, row) => sum + row[knob], 0) / avg.length;
			}
			const check = await play(checkPairs, settings, 4000 + seed);
			const errors = {};
			for (const [, i, stat] of KNOBS) {
				const t = target[i];
				if (t !== null && !(i === 1 && t === 0)) {
					errors[stat] = round(check[stat] - t, 4);
				}
			}
			const preset = {
				pace: round(settings.pace, 1),
				threePointTendencyFactor: round(settings.threePointTendencyFactor, 3),
				threePointAccuracyFactor: settings.threePointAccuracyFactor,
				twoPointAccuracyFactor: settings.twoPointAccuracyFactor,
				ftAccuracyFactor: settings.ftAccuracyFactor,
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
