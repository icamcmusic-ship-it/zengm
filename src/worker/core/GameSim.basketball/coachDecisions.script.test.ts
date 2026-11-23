// @ts-nocheck (diagnostic script)
// Coach Decisions calibration: plays seasons of a new random league (new-league defaults plus the 2026 preset, spectator mode: every team
// run by its coach) and prints the league totals per team game, minutes by value rank (mean and SD per game), and how often the coaches'
// calls happen: matchup starter changes, starters by style, earned/lost role changes, rest nights per older star, stoppers, halftime
// changes, playoff lineup changes after a loss, promised roles kept. CD_SETTINGS='{"coachDecisions":false}' plays the same league with the
// setting off (same seed) for the comparison.
//   CD_CAL=1 [CD_SEED=1] [CD_SEASONS=2] [CD_SETTINGS='{}'] [CD_OUT=/tmp/x.jsonl] npx vitest run --project basketball --silent=false <this file>
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
import { FLOW_DIAG, resetFlowDiag } from "./gameFlow.ts";
import { CD_DIAG } from "../staff/coachDecisions.ts";
import { DECISIONS, FORM } from "../../../common/coachDecisions.ts";

const env = (globalThis as any).process.env;
// CD_CONST='{"DECISIONS":{"topKeep":0}}' changes the constants (for tuning)
if (env.CD_CONST) {
	const mods = { DECISIONS, FORM };
	for (const [k, v] of Object.entries(JSON.parse(env.CD_CONST))) {
		Object.assign(mods[k], v);
	}
}

test.skipIf(!env.CD_CAL)(
	"coach decisions calibration",
	{ timeout: 24 * 60 * 60 * 1000 },
	async () => {
		const seed = Number(env.CD_SEED ?? 1);
		const numSeasons = Number(env.CD_SEASONS ?? 2);
		const extra = JSON.parse(env.CD_SETTINGS ?? "{}");
		const out = env.CD_OUT;
		Math.random = makeSeededRandom(seed);
		FLOW_DIAG.on = true;
		CD_DIAG.on = true;
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
				name: `cdCal${seed}`,
				setLeagueCreationStatus: () => {},
				settings,
				shuffleRosters: false,
				startingSeasonFromInput: "2025",
				teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
				tid: 0,
			},
		);
		await league.loadGameAttributes();
		console.log(
			`CD settings coachDecisions=${g.get("coachDecisions")} coachSystems=${g.get("coachSystems")} realisticRotations=${g.get("realisticRotations")}`,
		);

		// The head coaches' game prep and player management (percentiles 5 / 50 / 95)
		{
			const heads = (await idb.cache.coaches.getAll()).filter(
				(c) => c.tid >= 0 && c.role === "head",
			);
			const pct = (xs: number[]) => {
				const s = xs.toSorted((a, b) => a - b);
				return [0.05, 0.5, 0.95]
					.map((q) => s[Math.round(q * (s.length - 1))])
					.join(" / ");
			};
			console.log(
				`CD head coaches prp ${pct(heads.map((c) => c.ratings.prp ?? Number.NaN))} plm ${pct(heads.map((c) => c.ratings.plm ?? Number.NaN))} off ${pct(heads.map((c) => c.ratings.off))} mot ${pct(heads.map((c) => c.ratings.mot))}`,
			);
		}

		for (let i = 0; i < numSeasons; i++) {
			const s = g.get("season");
			resetFlowDiag();
			FLOW_DIAG.counts = {};
			FLOW_DIAG.sums = {};
			CD_DIAG.counts = {};
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
			const regular = { ...CD_DIAG.counts };
			const flow = {
				counts: { ...FLOW_DIAG.counts },
				sums: { ...FLOW_DIAG.sums },
			};

			// League totals per team game
			const sum: Record<string, number> = {};
			const keys = [
				"gp",
				"pts",
				"fga",
				"fg",
				"tpa",
				"tp",
				"tov",
				"fta",
				"ast",
				"orb",
				"drb",
				"pf",
				"stl",
				"blk",
			];
			for (const k of keys) {
				sum[k] = 0;
			}
			for (const ts of await idb.cache.teamStats.getAll()) {
				if (ts.season === s && !ts.playoffs) {
					for (const k of keys) {
						sum[k] += ts[k];
					}
				}
			}
			const per = (k: string) => sum[k] / sum.gp;
			const lg = {
				pts: per("pts"),
				fgp: sum.fg / sum.fga,
				tpaRate: sum.tpa / sum.fga,
				tpp: sum.tp / sum.tpa,
				tov: per("tov"),
				fta: per("fta"),
				ast: per("ast"),
				orb: per("orb"),
				drb: per("drb"),
				pf: per("pf"),
				stl: per("stl"),
				blk: per("blk"),
			};

			// Minutes by value rank (mean, SD per game)
			const minutes: string[] = [];
			const minByRank: { mean: number; sd: number }[] = [];
			for (let r = 0; r < 12; r++) {
				const n = flow.counts[`n:min_r${r}`] ?? 0;
				if (n === 0) {
					continue;
				}
				const m = flow.sums[`min_r${r}`] / n;
				const m2 = (flow.sums[`min2_r${r}`] ?? 0) / n;
				const sd = Math.sqrt(Math.max(0, m2 - m * m));
				minByRank.push({ mean: m, sd });
				minutes.push(`${m.toFixed(1)}/${sd.toFixed(1)}`);
			}

			// Older stars (30+, top 5 of their team by value at the end of the season) and their games missed for rest
			const byTid = new Map<number, any[]>();
			for (const p of await idb.cache.players.getAll()) {
				if (p.tid >= 0) {
					if (!byTid.has(p.tid)) {
						byTid.set(p.tid, []);
					}
					byTid.get(p.tid).push(p);
				}
			}
			let olderStars = 0;
			let promises = 0;
			let promisesJudged = 0;
			let promisesKept = 0;
			for (const ps of byTid.values()) {
				ps.sort((a, b) => b.valueNoPot - a.valueNoPot);
				for (const [rank, p] of ps.entries()) {
					if (rank < 5 && s - p.born.year >= 30) {
						olderStars += 1;
					}
					const pr = p.rolePromise;
					if (pr && pr.tid === p.tid && pr.season === s) {
						promises += 1;
						if (pr.g >= 15) {
							promisesJudged += 1;
							if (pr.ok / pr.g >= 0.6) {
								promisesKept += 1;
							}
						}
					}
				}
			}

			const tg = regular.teamGames ?? 0;
			const rate = (k: string) =>
				((regular[k] ?? 0) / Math.max(1, tg)).toFixed(4);
			const row = {
				kind: "cdSeason",
				seed,
				season: s,
				settings: extra,
				teamGames: tg,
				lg,
				minByRank,
				matchupChangePerTeamGame: rate("matchupChange"),
				swapBig: rate("swap_big"),
				swapSmall: rate("swap_small"),
				swapDefense: rate("swap_defense"),
				styleStarterPerTeamGame: rate("styleStarter"),
				injuryBenchPerTeamGame: rate("injuryBench"),
				stopperPerTeamGame: rate("stopper"),
				roleChangesPerTeamGame: rate("roleChanges"),
				keyMultPlayersPerTeamGame: rate("keyMultPlayers"),
				orderMovesPerTeamGame: rate("orderMoves"),
				orderChangedShare: rate("orderChangedGames"),
				restNights: regular.restNights ?? 0,
				olderStars,
				restNightsPerOlderStar:
					(regular.restNights ?? 0) / Math.max(1, olderStars),
				halftimeChanges: flow.counts.cdHalftime ?? 0,
				halftimePerTeamGame: (
					(flow.counts.cdHalftime ?? 0) / Math.max(1, tg)
				).toFixed(4),
				promises,
				promisesJudged,
				promisesKept,
				promiseStarts: regular.promiseStarts ?? 0,
				restByAge: Object.fromEntries(
					Object.entries(regular).filter(([k]) =>
						k.startsWith("restNightsAge"),
					),
				),
			};
			console.log(`CD SEASON ${JSON.stringify(row)}`);
			console.log(
				`CD ${s} pts ${lg.pts.toFixed(2)} FG% ${lg.fgp.toFixed(4)} 3PAr ${lg.tpaRate.toFixed(4)} 3P% ${lg.tpp.toFixed(4)} TOV ${lg.tov.toFixed(2)} FTA ${lg.fta.toFixed(2)} AST ${lg.ast.toFixed(2)} ORB ${lg.orb.toFixed(2)} PF ${lg.pf.toFixed(2)}\nCD minutes by rank (mean/SD) ${minutes.join(" ")}`,
			);
			if (out) {
				appendFileSync(out, `${JSON.stringify(row)}\n`);
			}

			// Playoffs
			CD_DIAG.counts = {};
			guard = 0;
			while (g.get("phase") === PHASE.PLAYOFFS) {
				await game.play(100, {});
				if (++guard > 50) {
					throw new Error("stuck in playoffs");
				}
			}
			const po = { ...CD_DIAG.counts };
			const prow = {
				kind: "cdPlayoffs",
				seed,
				season: s,
				settings: extra,
				teamGames: po.teamGames ?? 0,
				matchupChange: po.matchupChange ?? 0,
				lossChange: po.lossChange ?? 0,
				stopper: po.stopper ?? 0,
				swapDefense: po.swap_defense ?? 0,
			};
			console.log(`CD PLAYOFFS ${JSON.stringify(prow)}`);
			if (out) {
				appendFileSync(out, `${JSON.stringify(prow)}\n`);
			}

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
	},
);
