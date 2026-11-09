import { describe, test } from "vitest";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import fs from "node:fs";
import GameSim from "../core/GameSim.basketball/index.ts";
import { player, team } from "../core/index.ts";
import loadTeams from "../core/game/loadTeams.ts";
import { g, helpers } from "./index.ts";
import { resetCache, resetG } from "../../test/helpers.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import { range } from "../../common/utils.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { PHASE } from "../../common/constants.ts";
import { clutchText } from "../../common/hype/util.ts";
import type {
	HBoxLine,
	HGame,
	HPlayerRaw,
	HRaw,
	HSeries,
} from "../../common/hype/types.ts";

/*
 * Simulated seasons for calibrating the game hype engine without a browser (tools/hypeCalibration/calibrate.ts reads the output).
 * Off unless HYPE_CAL_OUT is set to an output directory:
 *   HYPE_CAL_OUT=/tmp/hype HYPE_CAL_SEASONS=3 vitest run src/worker/util/hypeCalibration.test.ts
 * A 30-team league of random players plays full 82-game seasons with the real game sim (no play-by-play: box scores and clutch plays only), then a 16-team best-of-seven bracket. Each season is saved as the snapshot (HRaw) the engine reads.
 */

const env = (globalThis as any).process?.env ?? {};
const OUT: string | undefined = env.HYPE_CAL_OUT;

const fin = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : 0;

describe.skipIf(!OUT)("hype calibration seasons", () => {
	test("sim", async () => {
		const original = Math.random;
		Math.random = makeSeededRandom(Number(env.HYPE_CAL_SEED ?? 7));
		try {
			resetG();
			const first = 2013;
			g.setWithoutSavingToDB("season", first);
			g.setWithoutSavingToDB("phase", PHASE.REGULAR_SEASON);
			const teamsDefault = helpers.getTeamsDefault();
			const N = teamsDefault.length;
			const players = teamsDefault.flatMap((t) =>
				range(13).map(() =>
					player.generate(
						t.tid,
						19 + Math.floor(Math.random() * 14),
						2010,
						true,
						DEFAULT_LEVEL,
					),
				),
			);
			for (const p of players) {
				p.ratings.at(-1)!.season = first;
				player.develop(p, 0);
				p.valueNoPot = p.ratings.at(-1)!.ovr;
				p.value = p.valueNoPot;
			}
			// starters first
			for (const t of teamsDefault) {
				players
					.filter((p) => p.tid === t.tid)
					.sort((a, b) => b.valueNoPot - a.valueNoPot)
					.forEach((p, i) => (p.rosterOrder = i));
			}
			await resetCache({
				players,
				teams: teamsDefault.map((t) => team.generate(t)),
				teamSeasons: teamsDefault.map((t) => team.genSeasonRow(t)),
				teamStats: teamsDefault.map((t) => team.genStatsRow(t.tid)),
			});
			const loaded = await loadTeams(range(N), {});
			const ovrOf = new Map<number, number>();
			for (const p of players) {
				ovrOf.set(p.pid!, p.ratings.at(-1)!.ovr);
			}
			const sorted = [...ovrOf.values()].sort((a, b) => b - a);
			const cut = sorted[Math.max(4, Math.round(sorted.length * 0.03))]!;
			const teams = teamsDefault.map((t) => ({
				tid: t.tid,
				abbrev: t.abbrev,
				name: `${t.region} ${t.name}`,
				cid: t.cid,
				did: t.did,
			}));
			const series: HSeries[] = [];
			let gid = 0;
			const numSeasons = Number(env.HYPE_CAL_SEASONS ?? 3);
			for (let s = first; s < first + numSeasons; s++) {
				const games: HGame[] = [];
				const rec = range(N).map(() => ({ won: 0, lost: 0 }));
				const play = (
					home: number,
					away: number,
					day: number,
					playoffs: boolean,
				) => {
					const sim = new GameSim({
						gid,
						day,
						teams: [
							structuredClone(loaded[home]!),
							structuredClone(loaded[away]!),
						],
						doPlayByPlay: false,
						homeCourtFactor: 1,
						allStarGame: false,
						baseInjuryRate: 0,
						neutralSite: false,
					} as any);
					const r = sim.run();
					const pts = r.team.map((t) => t.stat.pts as number);
					const win = pts[0]! > pts[1]! ? 0 : 1;
					if (!playoffs) {
						rec[[home, away][win]!]!.won++;
						rec[[home, away][1 - win]!]!.lost++;
					}
					const mt = (i: number): HGame["teams"][number] => {
						const t = r.team[i]!;
						const tid = [home, away][i]!;
						return {
							tid,
							pts: pts[i]!,
							ptsQtrs: [...t.stat.ptsQtrs],
							ovr: (t as unknown as { ovr: number }).ovr,
							won: playoffs ? undefined : rec[tid]!.won,
							lost: playoffs ? undefined : rec[tid]!.lost,
							tied: 0,
							otl: 0,
							players: t.player.map(
								(p): HBoxLine => ({
									pid: p.id,
									name: p.name,
									min: fin(p.stat.min),
									pts: fin(p.stat.pts),
									trb: fin(p.stat.orb) + fin(p.stat.drb),
									ast: fin(p.stat.ast),
									stl: fin(p.stat.stl),
									blk: fin(p.stat.blk),
									tp: fin(p.stat.tp),
									tpa: fin(p.stat.tpa),
									fg: fin(p.stat.fg),
									fga: fin(p.stat.fga),
									ft: fin(p.stat.ft),
									fta: fin(p.stat.fta),
									tov: fin(p.stat.tov),
								}),
							),
						};
					};
					games.push({
						gid,
						season: s,
						day,
						playoffs,
						playIn: false,
						overtimes: r.overtimes,
						teams: [mt(0), mt(1)],
						clutch: r.clutchPlays.map((c) => clutchText(c.text)),
					});
					gid++;
					return win === 0 ? home : away;
				};
				// regular season: 82 rounds of random pairings, most a day apart, some back-to-back
				let day = 0;
				for (let rd = 0; rd < 82; rd++) {
					day += rd % 4 === 3 ? 1 : 2;
					const order = range(N).sort(() => Math.random() - 0.5);
					for (let i = 0; i < N; i += 2) {
						play(order[i]!, order[i + 1]!, day, false);
					}
				}
				// playoffs: top 8 of each conference, 1-8, 4-5, 3-6, 2-7
				const conf = (cid: number) =>
					teams
						.filter((t) => t.cid === cid)
						.map((t) => t.tid)
						.sort((a, b) => rec[b]!.won - rec[a]!.won || a - b)
						.slice(0, 8);
				const seedOf = new Map<number, number>();
				let bracket: number[] = [];
				for (const cid of [0, 1]) {
					const c = conf(cid);
					c.forEach((tid, i) => seedOf.set(tid, i + 1));
					bracket.push(...[0, 7, 3, 4, 2, 5, 1, 6].map((i) => c[i]!));
				}
				for (let round = 0; round < 4; round++) {
					const next: number[] = [];
					for (let i = 0; i < bracket.length; i += 2) {
						let [h, a] = [bracket[i]!, bracket[i + 1]!];
						if (
							seedOf.get(a)! < seedOf.get(h)! ||
							(seedOf.get(a) === seedOf.get(h) && rec[a]!.won > rec[h]!.won)
						) {
							[h, a] = [a, h];
						}
						const info: HSeries = {
							season: s,
							round,
							numRounds: 4,
							numToWin: 4,
							home: { tid: h, seed: seedOf.get(h)!, won: 0 },
							away: { tid: a, seed: seedOf.get(a)!, won: 0 },
							gids: [],
						};
						let k = 0;
						while (info.home.won < 4 && info.away!.won < 4) {
							const homeHome = [0, 1, 4, 6].includes(k);
							info.gids.push(gid);
							const w = homeHome ? play(h, a, 0, true) : play(a, h, 0, true);
							if (w === h) {
								info.home.won++;
							} else {
								info.away!.won++;
							}
							k++;
						}
						series.push(info);
						next.push(info.home.won === 4 ? h : a);
					}
					bracket = next;
				}
				const raw: HRaw = {
					season: s,
					numGames: 82,
					teams,
					games,
					linesComplete: true,
					players: players.map(
						(p): HPlayerRaw => ({
							pid: p.pid!,
							name: `${p.firstName} ${p.lastName}`,
							tid: p.tid,
							draft: {
								year: p.draft.year,
								round: p.draft.round,
								pick: p.draft.pick,
							},
							rows: [],
							ovrBySeason: Object.fromEntries(
								range(first, first + numSeasons).map((x) => [
									x,
									ovrOf.get(p.pid!)!,
								]),
							),
							allStar: [],
							moves: [],
							released: [],
						}),
					),
					series: series.slice(),
					records: {
						seasonLeague: {},
						seasonFranchise: {},
						careerLeague: {},
						careerFranchise: {},
						starCut: { [s]: cut },
						firstSeason: first,
					},
					playoffsByConf: true,
					maxPlayoffSeed: 8,
				};
				fs.mkdirSync(OUT, { recursive: true });
				fs.writeFileSync(
					`${OUT}/node${env.HYPE_CAL_SEED ?? 7}-${s}.json`,
					JSON.stringify(raw),
				);
			}
		} finally {
			Math.random = original;
		}
	}, 3_600_000);
});
