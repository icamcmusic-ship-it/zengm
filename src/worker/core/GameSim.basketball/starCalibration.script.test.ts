// @ts-nocheck (diagnostic script)
/* eslint-disable no-undef */
// Calibration of superstar seasons and star turnovers (docs/native-features.md, Realistic Rotations / Realistic Turnovers): plays
// whole regular seasons of new leagues (new-league defaults) and prints the season leaders (points, PER, win shares, turnovers) and
// league per-team-game totals. With SC_GOD=88 the best player of team 0 is God Moded up to that ovr first. Run with
// SC_CAL=1 npx vitest run --maxWorkers=2 --project basketball --silent=false <this file>
// (SC_SEEDS=2 leagues per config, SC_SEED0 the first seed, SC_CONFIGS='[{},{"realisticRotations":false}]' settings on top of the
// new-league defaults)
import "fake-indexeddb/auto";
import { test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import { game, league, phase, player, season } from "../index.ts";
import { idb } from "../../db/index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { helpers, lock } from "../../util/index.ts";
import { TURNOVERS } from "./realisticTurnovers.ts";
import { ATTENTION } from "./matchupDefense.ts";

// SC_ATT='{"share":0.3}' changes the defensive attention constants
if (process.env.SC_ATT) {
	Object.assign(ATTENTION, JSON.parse(process.env.SC_ATT));
}
// SC_TOV='{"usagePower":2}' changes the Realistic Turnovers constants
if (process.env.SC_TOV) {
	Object.assign(TURNOVERS, JSON.parse(process.env.SC_TOV));
}

const RATING_KEYS = [
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
];

const godMode = async (target) => {
	const players = await idb.cache.players.indexGetAll("playersByTid", 0);
	players.sort((a, b) => last(b.ratings).ovr - last(a.ratings).ovr);
	const p = players[0];
	const r = last(p.ratings);
	for (let i = 0; i < 100 && r.ovr < target; i++) {
		for (const key of Object.keys(r)) {
			if (
				RATING_KEYS.includes(key) ||
				(typeof r[key] === "number" &&
					/^[a-z]{3}$/.test(key) &&
					!["ovr", "pot", "hgt", "pos"].includes(key) &&
					key !== "fuzz")
			) {
				r[key] = Math.min(100, r[key] + 1);
			}
		}
		r.ovr = player.ovr(r);
	}
	r.locked = true;
	await player.develop(p, 0);
	await player.updateValues(p);
	await idb.cache.players.put(p);
	return { pid: p.pid, ovr: r.ovr };
};

test.skipIf(!process.env.SC_CAL)(
	"seasons",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seeds = Number(process.env.SC_SEEDS ?? 2);
		const seed0 = Number(process.env.SC_SEED0 ?? 1);
		const god = process.env.SC_GOD ? Number(process.env.SC_GOD) : undefined;
		const configs = JSON.parse(process.env.SC_CONFIGS ?? "[{}]");
		let lid = 0;
		for (const config of configs) {
			const tot = { games: 0, pts: 0, tov: 0, stl: 0 };
			const leaders = [];
			for (let seed = seed0; seed < seed0 + seeds; seed++) {
				Math.random = makeSeededRandom(seed);
				const settings: any = { ...getDefaultSettings(), ...config };
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
						name: `sc${seed}`,
						setLeagueCreationStatus: () => {},
						settings,
						shuffleRosters: false,
						startingSeasonFromInput: "2025",
						teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
						tid: 0,
					},
				);
				await league.loadGameAttributes();
				const injected = god ? await godMode(god) : undefined;
				await phase.newPhase(PHASE.REGULAR_SEASON, {});
				await lock.set("gameSim", false);
				await game.play(await season.getDaysLeftSchedule(), {});
				const s = await idb.cache.games.getAll();
				for (const gm of s) {
					if (gm.teams[0].tid < 0) {
						continue;
					}
					tot.games += 1;
					const comb = gm.teams[0].pts + gm.teams[1].pts;
					const maxMin = Math.max(
						...gm.teams.flatMap((t) => t.players.map((p) => p.min)),
					);
					if (!tot.maxGame || comb > tot.maxGame.comb) {
						tot.maxGame = {
							comb,
							ot: gm.overtimes,
							pts: gm.teams.map((t) => t.pts),
							maxMin,
						};
					}
					tot.ot = (tot.ot ?? 0) + gm.overtimes;
					tot.over300 = (tot.over300 ?? 0) + (comb >= 300 ? 1 : 0);
					if (maxMin > (tot.maxMin ?? 0)) {
						tot.maxMin = maxMin;
					}
					for (const t of gm.teams) {
						tot.pts += t.pts;
						tot.tov += t.tov;
						tot.stl += t.stl;
					}
				}
				for (const p of await idb.cache.players.getAll()) {
					const ps = p.stats.filter(
						(r) => !r.playoffs && r.tid >= 0 && r.gp >= 40,
					);
					for (const r of ps) {
						leaders.push({
							seed,
							god: injected?.pid === p.pid ? "*" : "",
							ovr: last(p.ratings).ovr,
							gp: r.gp,
							min: r.min / r.gp,
							pts: r.pts / r.gp,
							tov: r.tov / r.gp,
							usg: r.usgp,
							per: r.per,
							ws: r.ows + r.dws,
							ts: r.pts / (2 * (r.fga + 0.44 * r.fta)),
							fga: r.fga / r.gp,
							fta: r.fta / r.gp,
						});
					}
				}
			}
			const f = (x, d = 1) => x.toFixed(d);
			const fmt = (r) =>
				`s${r.seed}${r.god} ovr ${r.ovr} min ${f(r.min)} pts ${f(r.pts)} fga ${f(r.fga)} fta ${f(r.fta)} usg ${f(r.usg)} tov ${f(r.tov)} ts ${f(r.ts, 3)} per ${f(r.per)} ws ${f(r.ws)}`;
			console.log(
				`CONFIG ${JSON.stringify(config)} god ${god} games ${tot.games} team pts ${f(tot.pts / tot.games / 2, 2)} tov ${f(tot.tov / tot.games / 2, 2)} stl ${f(tot.stl / tot.games / 2, 2)}`,
			);
			console.log(
				`GAMES max ${JSON.stringify(tot.maxGame)} ot/game ${f(tot.ot / tot.games, 3)} 300+ ${tot.over300} maxMin ${f(tot.maxMin)}`,
			);
			for (const key of ["pts", "per", "ws", "tov"]) {
				const top = [...leaders]
					.sort((a, b) => b[key] - a[key])
					.slice(0, 5 * seeds);
				console.log(`TOP ${key}:\n  ${top.map(fmt).join("\n  ")}`);
			}
			const scorers = [...leaders].sort((a, b) => b.pts - a.pts);
			const typical = scorers.slice(2 * seeds, 10 * seeds);
			const m = (k) => typical.reduce((a, r) => a + r[k], 0) / typical.length;
			console.log(
				`TYPICAL (scorers 3-10) pts ${f(m("pts"))} tov ${f(m("tov"), 2)} usg ${f(m("usg"))} per ${f(m("per"))} ws ${f(m("ws"))}`,
			);
			const hiUsg = [...leaders]
				.filter((r) => r.min >= 30)
				.sort((a, b) => b.usg - a.usg)
				.slice(0, 10 * seeds);
			const mu = (k) => hiUsg.reduce((a, r) => a + r[k], 0) / hiUsg.length;
			console.log(
				`TOP USG (10/league) usg ${f(mu("usg"))} pts ${f(mu("pts"))} tov ${f(mu("tov"), 2)}`,
			);
		}
	},
);
