// Rivalry Stories speed in long leagues (skipped unless RIVALRY_BENCH is set). Simulating 10-20 seasons headlessly takes
// too long, so this builds a league, plays three real days for box score templates, then writes N past seasons of realistic
// size (1,230 regular season games and a 16-team best-of-7 playoff per season: box scores for the seasons the default
// "Save Old Box Scores" keeps, or all of them with RIVALRY_BENCH_BOX=all; the rivalryGames log and rivalrySeasons rows as the
// after-game hook writes them; head-to-heads, playoff series and team seasons) and the current season half played. Then it
// times, from a fresh session each time (no backfill done, nothing memoized): the backfill, the rivalry score, the
// Rivalries page for the pair that met most, the newspaper's Rivalry watch facts and Games to Watch.
//
// RIVALRY_BENCH=1 RIVALRY_BENCH_SEASONS=20 [RIVALRY_BENCH_BOX=all] RIVALRY_BENCH_OUT=out.txt \
//   node_modules/.bin/vitest run src/worker/util/rivalryStories.bench.test.ts
import "fake-indexeddb/auto";
// @ts-expect-error
import { appendFileSync } from "node:fs";
import { assert, beforeAll, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../common/constants.ts";
import { defaultGameAttributes } from "../../common/defaultGameAttributes.ts";
import { makeSeededRandom } from "../../common/random.ts";
import { last } from "../../common/utils.ts";
import type { Game, HeadToHead, PlayoffSeries } from "../../common/types.ts";
import { rivalryGameFromBox } from "../../common/rivalryStories/record.ts";
import {
	addToRivalrySeasons,
	type RivalryGame,
	type RivalrySeason,
} from "../../common/rivalryStories/types.ts";
import { game, league, phase } from "../core/index.ts";
import { idb } from "../db/index.ts";
import { g, helpers } from "./index.ts";
import { getDefaultSettings } from "../views/newLeague.ts";
import * as views from "../views/index.ts";
import hype from "../api/hype.ts";
import {
	ensureBackfill,
	getRivalryNewsFacts,
	resetRivalryStoriesSession,
} from "./rivalryStories.ts";
import { loadRivalries } from "./rivalries.ts";
import { cancelPageWarm } from "./pageWarm.ts";

const env = (globalThis as any).process.env;
const SEASONS = Number(env.RIVALRY_BENCH_SEASONS ?? 10);
const BOX_ALL = env.RIVALRY_BENCH_BOX === "all";
const NUM_TEAMS = 30;
// Results go to the console and, with RIVALRY_BENCH_OUT, to that file (the test runner hides the console of passing tests)
const report = (line: string) => {
	console.log(line);
	if (env.RIVALRY_BENCH_OUT) {
		appendFileSync(env.RIVALRY_BENCH_OUT, `${line}\n`);
	}
};

const load = (id: string, params: Record<string, string>) => {
	const view = (views as any)[id];
	const inputs = view.processInputs ? view.processInputs(params, {}) : {};
	return view.load({
		inputs,
		updateEvents: new Set(["firstRun"]),
		prevInputs: inputs,
		prevOutput: {},
		conditions: {},
	});
};

const rand = (lo: number, hi: number) =>
	lo + Math.floor(Math.random() * (hi - lo + 1));

const shuffle = <T>(xs: T[]) => {
	for (let i = xs.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[xs[i], xs[j]] = [xs[j]!, xs[i]!];
	}
	return xs;
};

describe.skipIf(!env.RIVALRY_BENCH)("rivalry stories bench", () => {
	const counts = { games: 0, box: 0 };
	let current = 0;

	beforeAll(
		async () => {
			Math.random = makeSeededRandom(7);
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
					name: "bench",
					setLeagueCreationStatus: () => {},
					settings: {
						...getDefaultSettings(),
						featureRivalries: true,
						featureRivalryStories: true,
						featureHype: true,
					} as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2045",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			await phase.newPhase(PHASE.REGULAR_SEASON, {});
			await game.play(3, {});
			current = g.get("season");
			await league.setGameAttributes({ startingSeason: current - SEASONS });

			const templates = (await idb.cache.games.getAll()).filter(
				(gm) => gm.teams[0].tid >= 0,
			);
			assert.isAbove(templates.length, 0);
			const rosters = new Map<number, { pid: number; name: string }[]>();
			for (let tid = 0; tid < NUM_TEAMS; tid++) {
				const ps = await idb.cache.players.indexGetAll("playersByTid", tid);
				rosters.set(
					tid,
					ps.map((p) => ({ pid: p.pid, name: `${p.firstName} ${p.lastName}` })),
				);
			}
			const tsNow = await idb.cache.teamSeasons.indexGetAll(
				"teamSeasonsBySeasonTid",
				[[current], [current, "Z"]],
			);

			let gid = 100000;
			const rounds = new Map<number, number>();
			const box = (
				season: number,
				day: number,
				home: number,
				away: number,
				rec: Map<number, [number, number]>,
				po?: { hW: number; aW: number; round: number },
			) => {
				const tpl = templates[gid % templates.length]!;
				const gm: Game = structuredClone(tpl);
				gm.gid = gid++;
				if (po) {
					rounds.set(gm.gid, po.round);
				}
				gm.season = season;
				gm.day = day;
				gm.playoffs = !!po;
				const hPts = rand(92, 128);
				let aPts = rand(92, 128);
				if (aPts === hPts) {
					aPts += 1;
				}
				gm.overtimes = Math.random() < 0.06 ? 1 : 0;
				const winner = hPts > aPts ? home : away;
				[home, away].forEach((tid, i) => {
					const t = gm.teams[i]!;
					const src = tpl.teams[i]!;
					t.tid = tid;
					t.pts = i === 0 ? hPts : aPts;
					const r = rec.get(tid)!;
					if (!po) {
						r[tid === winner ? 0 : 1] += 1;
					}
					t.won = r[0];
					t.lost = r[1];
					const roster = rosters.get(tid)!;
					t.players = src.players.map((p: any, k: number) => ({
						...p,
						pid: roster[k % roster.length]!.pid,
						name: roster[k % roster.length]!.name,
					}));
					if (po) {
						(t as any).playoffs = {
							seed: 1,
							won: i === 0 ? po.hW : po.aW,
							lost: i === 0 ? po.aW : po.hW,
						};
					} else {
						delete (t as any).playoffs;
					}
				});
				gm.won = { tid: winner, pts: Math.max(hPts, aPts) } as any;
				gm.lost = {
					tid: winner === home ? away : home,
					pts: Math.min(hPts, aPts),
				} as any;
				gm.numGamesToWinSeries = po ? 4 : undefined;
				return gm;
			};

			const writeSeason = async (season: number, half: boolean) => {
				const rec = new Map<number, [number, number]>();
				for (let tid = 0; tid < NUM_TEAMS; tid++) {
					rec.set(tid, [0, 0]);
				}
				const pairs: [number, number][] = [];
				for (let a = 0; a < NUM_TEAMS; a++) {
					for (let b = a + 1; b < NUM_TEAMS; b++) {
						pairs.push([a, b], [b, a]);
					}
				}
				const extra = shuffle(
					pairs
						.filter(([a, b]) => a < b)
						.map(([a, b]) => [a, b] as [number, number]),
				).slice(0, 1230 - pairs.length);
				const matchups = shuffle([...pairs, ...extra]);
				const games: Game[] = [];
				const n = half ? matchups.length / 2 : matchups.length;
				for (let i = 0; i < n; i++) {
					const [h, a] = matchups[i]!;
					games.push(box(season, 1 + Math.floor(i / 15), h, a, rec));
				}
				const h2h: HeadToHead = { season, regularSeason: {}, playoffs: {} };
				for (const gm of games) {
					const [t0, t1] = gm.teams;
					const a = Math.min(t0.tid, t1.tid);
					const b = Math.max(t0.tid, t1.tid);
					h2h.regularSeason[a] ??= {};
					const r = (h2h.regularSeason[a]![b] ??= {
						won: 0,
						lost: 0,
						tied: 0,
						otl: 0,
						otw: 0,
						pts: 0,
						oppPts: 0,
					});
					const aPts = t0.tid === a ? t0.pts : t1.pts;
					const bPts = t0.tid === a ? t1.pts : t0.pts;
					r[aPts > bPts ? "won" : "lost"] += 1;
					r.pts += aPts;
					r.oppPts += bPts;
				}
				let ps: PlayoffSeries | undefined;
				const roundsWon = new Map<number, number>();
				if (!half) {
					// 16 best records, 1 v 16 ... best of 7
					let alive = [...rec.entries()]
						.sort((x, y) => y[1][0] - x[1][0])
						.slice(0, 16)
						.map(([tid], i) => ({ tid, seed: i + 1 }));
					for (const t of alive) {
						roundsWon.set(t.tid, 0);
					}
					ps = { season, currentRound: 3, series: [] };
					let day = 100;
					for (let round = 0; alive.length > 1; round++) {
						const next: typeof alive = [];
						const series: PlayoffSeries["series"][number] = [];
						for (let i = 0; i < alive.length / 2; i++) {
							const hi = alive[i]!;
							const lo = alive[alive.length - 1 - i]!;
							let hW = 0;
							let aW = 0;
							for (let k = 0; hW < 4 && aW < 4; k++) {
								const homeIsHi = [0, 1, 4, 6].includes(k);
								const homeT = homeIsHi ? hi : lo;
								const awayT = homeIsHi ? lo : hi;
								const gm = box(season, day + k, homeT.tid, awayT.tid, rec, {
									hW: homeIsHi ? hW : aW,
									aW: homeIsHi ? aW : hW,
									round,
								});
								const hiWon = gm.won.tid === hi.tid;
								if (hiWon) {
									hW += 1;
								} else {
									aW += 1;
								}
								gm.teams[0].playoffs!.won = homeIsHi ? hW : aW;
								gm.teams[1].playoffs!.won = homeIsHi ? aW : hW;
								games.push(gm);
							}
							const w = hW === 4 ? hi : lo;
							roundsWon.set(w.tid, round + 1);
							next.push(w);
							series.push({
								home: { tid: hi.tid, seed: hi.seed, cid: 0, won: hW },
								away: { tid: lo.tid, seed: lo.seed, cid: 0, won: aW },
							});
						}
						ps.series.push(series);
						alive = next.sort((x, y) => x.seed - y.seed);
						day += 8;
					}
				}

				const records: RivalryGame[] = [];
				for (const gm of games) {
					records.push(rivalryGameFromBox(gm, { round: rounds.get(gm.gid) })!);
				}
				const keepBox =
					BOX_ALL ||
					season >=
						current -
							(defaultGameAttributes.saveOldBoxScores.pastSeasons as number);
				const stores = [
					"rivalryGames",
					"rivalrySeasons",
					"headToHeads",
					"teamSeasons",
					"games",
					"playoffSeries",
				] as const;
				const tx = idb.league.transaction(stores as any, "readwrite");
				for (const r of records) {
					void tx.objectStore("rivalryGames").put(r);
				}
				const rows = new Map<number, RivalrySeason>();
				for (const row of addToRivalrySeasons(rows, records)) {
					void tx.objectStore("rivalrySeasons").put(row);
				}
				if (!half) {
					void tx.objectStore("headToHeads").put(h2h);
					void tx.objectStore("playoffSeries").put(ps!);
					for (const ts of tsNow) {
						const copy: any = structuredClone(ts);
						delete copy.rid;
						copy.season = season;
						copy.won = rec.get(ts.tid)![0];
						copy.lost = rec.get(ts.tid)![1];
						copy.playoffRoundsWon = roundsWon.get(ts.tid) ?? -1;
						void tx.objectStore("teamSeasons").add(copy);
					}
				}
				if (keepBox) {
					for (const gm of games) {
						void tx.objectStore("games").put(gm);
					}
					counts.box += games.length;
				}
				await tx.done;
				counts.games += games.length;
			};

			for (let s = current - SEASONS; s < current; s++) {
				await writeSeason(s, false);
			}
			await writeSeason(current, true);
			await idb.cache.flush();
			report(
				`bench league: ${SEASONS} past seasons + half of ${current}, ${counts.games} logged games, ${counts.box} stored box scores`,
			);
		},
		60 * 60 * 1000,
	);

	const time = async (label: string, f: () => Promise<unknown>, reps = 3) => {
		const out: number[] = [];
		for (let i = 0; i < reps; i++) {
			resetRivalryStoriesSession();
			// The backfill runs once a session; time the other reads after it, as a session's later page views see them
			if (label !== "backfill") {
				await ensureBackfill();
			}
			// Let the previous step's garbage be collected (the bench league's box scores are all in memory with
			// fake-indexeddb), so it isn't charged to the next read
			(globalThis as any).gc?.();
			await new Promise((resolve) => setTimeout(resolve, 300));
			const t0 = performance.now();
			await f();
			out.push(performance.now() - t0);
		}
		out.sort((a, b) => a - b);
		report(
			`BENCH seasons=${SEASONS} box=${BOX_ALL ? "all" : "default"} ${label}: median ${out[Math.floor(reps / 2)]!.toFixed(0)} ms (${out.map((x) => x.toFixed(0)).join(", ")})`,
		);
	};

	test(
		"timings",
		async () => {
			// The background page warm-up (pageWarm.ts: Best Games' plays, game summaries) reads every stored box score after a
			// league loads; stop it and let its current season finish, so its work isn't charged to whatever read runs then
			cancelPageWarm();
			await new Promise((resolve) => setTimeout(resolve, 8000));
			await time("backfill", () => ensureBackfill());
			await time("rivalry score (loadRivalries)", () => loadRivalries());
			const pairs = await loadRivalries();
			const top = pairs[0]!;
			await time(`rivalries pair page (${top.key})`, () =>
				load("rivalries", { pair: top.key }),
			);
			await time("newspaper Rivalry watch, current season", () =>
				getRivalryNewsFacts(current),
			);
			await time("newspaper Rivalry watch, last season", () =>
				getRivalryNewsFacts(current - 1),
			);
			await time("Games to Watch (hype board, 2 days)", () =>
				hype.board({ days: 2 }),
			);
			const out = await load("rivalries", { pair: top.key });
			assert.isAbove(out.selected.story.logged.games, SEASONS * 2);
		},
		60 * 60 * 1000,
	);
});
