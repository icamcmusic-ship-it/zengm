// @ts-nocheck (diagnostic script)
// Bench shot share, regular season vs playoffs: plays seasons (with their playoffs) of a new random league (new-league defaults plus the
// 2026 preset) and prints, from the box scores, the bench's (gs = 0) share of team minutes, FGA, points and possessions used, the bench's
// and starters' FGA per 36, the 6th-8th men's (the bench by minutes in each game) FGA per 36, and how often a bench player with 15+
// minutes took 0-2 shots. BENCH_OUT writes one JSON line per league (to pool several seeds).
//   BENCH_SHOTS=1 [BENCH_SEED=1] [BENCH_SEASONS=2] [BENCH_SETTINGS='{}'] [BENCH_OUT=/tmp/x.jsonl]
//   npx vitest run --project basketball --silent=false <this file>
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
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
import { FLOW_DIAG } from "./gameFlow.ts";

const env = (globalThis as any).process.env;

const emptyAcc = () => ({
	games: 0,
	teamMin: 0,
	benchMin: 0,
	teamFga: 0,
	benchFga: 0,
	teamPts: 0,
	benchPts: 0,
	teamUse: 0,
	benchUse: 0,
	starterMin: 0,
	starterFga: 0,
	b68Min: 0,
	b68Fga: 0,
	b15: 0,
	b15Low: 0,
	top1Min: 0,
	top1Fga: 0,
});

// From one game's box score
const addGame = (acc, game) => {
	acc.games += 1;
	for (const t of game.teams) {
		const bench = [];
		let best;
		for (const p of t.players) {
			const use = p.fga + 0.44 * p.fta + p.tov;
			acc.teamMin += p.min;
			acc.teamFga += p.fga;
			acc.teamPts += p.pts;
			acc.teamUse += use;
			if (p.gs) {
				acc.starterMin += p.min;
				acc.starterFga += p.fga;
				if (!best || p.fga + p.fta * 0.44 > best.fga + best.fta * 0.44) {
					best = p;
				}
			} else {
				acc.benchMin += p.min;
				acc.benchFga += p.fga;
				acc.benchPts += p.pts;
				acc.benchUse += use;
				bench.push(p);
				if (p.min >= 15) {
					acc.b15 += 1;
					if (p.fga <= 2) {
						acc.b15Low += 1;
					}
				}
			}
		}
		if (best) {
			acc.top1Min += best.min;
			acc.top1Fga += best.fga;
		}
		bench.sort((a, b) => b.min - a.min);
		for (const p of bench.slice(0, 3)) {
			acc.b68Min += p.min;
			acc.b68Fga += p.fga;
		}
	}
};

const summarize = (acc) => ({
	games: acc.games,
	benchMinShare: acc.benchMin / acc.teamMin,
	benchFgaShare: acc.benchFga / acc.teamFga,
	benchPtsShare: acc.benchPts / acc.teamPts,
	benchUseShare: acc.benchUse / acc.teamUse,
	benchFga36: (36 * acc.benchFga) / acc.benchMin,
	starterFga36: (36 * acc.starterFga) / acc.starterMin,
	ratio: acc.benchFga / acc.benchMin / (acc.starterFga / acc.starterMin),
	b68Fga36: (36 * acc.b68Fga) / acc.b68Min,
	b68Min: acc.b68Min / (2 * acc.games),
	low15: acc.b15Low / acc.b15,
	topFga36: (36 * acc.top1Fga) / acc.top1Min,
	topMin: acc.top1Min / (2 * acc.games),
});

const fmt = (label, s) =>
	`${label} games ${s.games} bench share min ${s.benchMinShare.toFixed(3)} FGA ${s.benchFgaShare.toFixed(3)} pts ${s.benchPtsShare.toFixed(3)} use ${s.benchUseShare.toFixed(3)} | FGA/36 bench ${s.benchFga36.toFixed(2)} starters ${s.starterFga36.toFixed(2)} ratio ${s.ratio.toFixed(3)} | 6th-8th FGA/36 ${s.b68Fga36.toFixed(2)} (min ${s.b68Min.toFixed(1)} per team-game for 3) | 15+ min bench with 0-2 FGA ${s.low15.toFixed(3)} | top starter FGA/36 ${s.topFga36.toFixed(2)} min ${s.topMin.toFixed(1)}`;

test.skipIf(!env.BENCH_SHOTS)(
	"bench shot share",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seed = Number(env.BENCH_SEED ?? 1);
		const numSeasons = Number(env.BENCH_SEASONS ?? 2);
		const extra = JSON.parse(env.BENCH_SETTINGS ?? "{}");
		const out = env.BENCH_OUT;
		Math.random = makeSeededRandom(seed);
		FLOW_DIAG.on = true;
		const settings: any = {
			...getDefaultSettings(),
			...gameSimPresets[2026],
			spectator: true,
			...extra,
		};
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
				name: `benchShots${seed}`,
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();

		const acc = { reg: emptyAcc(), po: emptyAcc() };
		const seen = new Set();
		const collect = async () => {
			for (const gm of await idb.cache.games.getAll()) {
				if (seen.has(gm.gid)) {
					continue;
				}
				seen.add(gm.gid);
				addGame(gm.playoffs ? acc.po : acc.reg, gm);
			}
		};
		for (let i = 0; i < numSeasons; i++) {
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await lock.set("gameSim", false);
			let guard = 0;
			while (
				g.get("phase") === PHASE.REGULAR_SEASON ||
				g.get("phase") === PHASE.AFTER_TRADE_DEADLINE
			) {
				await game.play(await season.getDaysLeftSchedule(), {});
				if (++guard > 50) {
					throw new Error("stuck");
				}
			}
			await collect();
			guard = 0;
			while (g.get("phase") === PHASE.PLAYOFFS) {
				await game.play(100, {});
				if (++guard > 50) {
					throw new Error("stuck in playoffs");
				}
			}
			await collect();
			if (i === numSeasons - 1) {
				break;
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
		const reg = summarize(acc.reg);
		const po = summarize(acc.po);
		console.log(
			[`BENCH seed ${seed}`, fmt("  REG", reg), fmt("  PO ", po)].join("\n"),
		);
		console.log(
			`FLOW bench ${JSON.stringify(Object.fromEntries(Object.entries(FLOW_DIAG.counts).filter(([k]) => k.startsWith("bench"))))}`,
		);
		if (out) {
			appendFileSync(
				out,
				`${JSON.stringify({ seed, reg: acc.reg, po: acc.po })}\n`,
			);
		}
	},
);
