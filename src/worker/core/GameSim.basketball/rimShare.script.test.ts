// @ts-nocheck (diagnostic script)
// Shot mix by position (Game Sim Fixes, rim selection): plays RIM_DAYS days of the regular season of new leagues with the new-league
// defaults and prints, by position group and height, the share of FGA at the rim (putbacks and tip-ins included, as in NBA "within
// 3 ft") / mid-range / post / three, plus league totals. Run with
// RIM=1 RIM_SEEDS=1,2 RIM_DAYS=20 npx vitest run --maxWorkers=2 --project basketball --silent=false <this file>
// (RIM_SELECT='{"ratings":[...],"weights":[...]}' replaces shootingAtRimSelect). New-league defaults, 2 seeds x 20 days (285 games):
// C 51% rim (37% without putbacks), FC 49%, PF 35%, F 39%, SF/GF 30%, guards 24%, league 32%
import "fake-indexeddb/auto";
import { test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { game, league, phase } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import { SIM_FIX_COMPOSITE_WEIGHTS } from "./simSettings.ts";
import GameSim from "./index.ts";

const env = (globalThis as any).process.env;
if (env.RIM_SELECT) {
	Object.assign(
		SIM_FIX_COMPOSITE_WEIGHTS.shootingAtRimSelect,
		JSON.parse(env.RIM_SELECT),
	);
}

// Putbacks and tip-ins chosen by getShotInfo, by pid (they're counted in fgaAtRim; shooting fouls without a make aren't FGA, so this
// is approximate)
let putbacks = new Map();
const origGetShotInfo = GameSim.prototype.getShotInfo;
GameSim.prototype.getShotInfo = function (...args) {
	const out = origGetShotInfo.apply(this, args);
	if (out.type === "putBack" || out.type === "tipIn") {
		const pid = args[0].p.id;
		putbacks.set(pid, (putbacks.get(pid) ?? 0) + 1);
	}
	return out;
};

const GROUPS = {
	C: ["C"],
	FC: ["FC"],
	PF: ["PF"],
	F: ["F"],
	"SF/GF": ["SF", "GF"],
	G: ["PG", "SG", "G"],
};
const HGT = ["hgt70+", "hgt60-69", "hgt50-59", "hgt40-49", "hgt<40"];
const hgtBucket = (hgt) =>
	hgt >= 70
		? HGT[0]
		: hgt >= 60
			? HGT[1]
			: hgt >= 50
				? HGT[2]
				: hgt >= 40
					? HGT[3]
					: HGT[4];
const KEYS = [
	"fga",
	"fg",
	"fgaAtRim",
	"fgAtRim",
	"fgaMidRange",
	"fgaLowPost",
	"tpa",
	"tp",
	"fta",
	"pts",
	"putback",
];

test.skipIf(!env.RIM)(
	"rim share by position",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seeds = (env.RIM_SEEDS ?? "1").split(",").map(Number);
		const numDays = Number(env.RIM_DAYS ?? 30);
		const agg = {};
		let teamGames = 0;
		let lid = 0;
		for (const seed of seeds) {
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
					lid: lid++,
					name: `rim${seed}`,
					setLeagueCreationStatus: () => {},
					settings: { ...getDefaultSettings(), spectator: true },
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			const s = g.get("season");
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await lock.set("gameSim", false);
			putbacks = new Map();
			await game.play(numDays, {});
			for (const p of await idb.cache.players.getAll()) {
				const rt = last(p.ratings);
				const grp =
					Object.keys(GROUPS).find((k) => GROUPS[k].includes(rt.pos)) ?? rt.pos;
				for (const row of p.stats) {
					if (row.season !== s || row.playoffs || row.tid < 0) {
						continue;
					}
					for (const bucket of [grp, hgtBucket(rt.hgt), "LEAGUE"]) {
						agg[bucket] ??= Object.fromEntries(KEYS.map((k) => [k, 0]));
						for (const k of KEYS) {
							agg[bucket][k] +=
								k === "putback" ? (putbacks.get(p.pid) ?? 0) : (row[k] ?? 0);
						}
					}
				}
			}
			for (const ts of await idb.cache.teamStats.getAll()) {
				if (ts.season === s && !ts.playoffs) {
					teamGames += ts.gp;
				}
			}
		}
		const fmt = (name, a) => {
			const pct = (x) => ((100 * x) / a.fga).toFixed(1).padStart(5);
			return `${name.padEnd(9)} fga ${String(a.fga).padStart(6)} rim ${pct(a.fgaAtRim)} mid ${pct(a.fgaMidRange)} post ${pct(a.fgaLowPost)} three ${pct(a.tpa)} (putback ${pct(a.putback)}, rim w/o ${pct(a.fgaAtRim - a.putback)}) | FG% ${pct(a.fg)} rimFG% ${((100 * a.fgAtRim) / a.fgaAtRim).toFixed(1)}`;
		};
		const lines = [`team games ${teamGames}`];
		for (const k of [...Object.keys(GROUPS), "LEAGUE", ...HGT]) {
			if (agg[k]) {
				lines.push(fmt(k, agg[k]));
			}
		}
		const L = agg.LEAGUE;
		lines.push(
			`per team game: PTS ${(L.pts / teamGames).toFixed(1)} FGA ${(L.fga / teamGames).toFixed(1)} FG% ${((100 * L.fg) / L.fga).toFixed(1)} 3PA rate ${((100 * L.tpa) / L.fga).toFixed(1)} FTA ${(L.fta / teamGames).toFixed(1)}`,
		);
		console.log(lines.join("\n"));
	},
);
