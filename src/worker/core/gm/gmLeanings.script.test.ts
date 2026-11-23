// Not a real test: measures whether AI GM leanings and finance styles show up in what teams actually do. Plays new default leagues
// (every core feature on, spectator mode so the AI runs all 30 teams) with a seeded Math.random for a few seasons and writes one JSON
// line per team-season: the GM who ran it (traits, finance style, owner type), trades and picks moved, payroll, luxury tax, roster age
// and record. Skipped unless GM_LEAN is set:
//
//   GM_LEAN=1 GM_LEAN_SEEDS=1,2 GM_LEAN_SEASONS=4 GM_LEAN_OUT=/tmp/lean.jsonl \
//     node_modules/.bin/vitest run --project basketball src/worker/core/gm/gmLeanings.script.test.ts
import "fake-indexeddb/auto";
// @ts-expect-error node types are not in the web tsconfig, but tests run in node
import { appendFileSync, writeFileSync } from "node:fs";
import { assert, describe, test } from "vitest";
import { LEAGUE_DATABASE_VERSION, PHASE } from "../../../common/constants.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { getGmFinanceStyle } from "../../../common/gmFinance.ts";
import { makeSeededRandom } from "../../../common/random.ts";
import { last } from "../../../common/utils.ts";
import type { EventBBGM } from "../../../common/types.ts";
import { draft, freeAgents, game, league, phase, season } from "../index.ts";
import { getDefaultSettings } from "../../views/newLeague.ts";
import { g, helpers, lock } from "../../util/index.ts";
import { idb } from "../../db/index.ts";

const env = (globalThis as any).process.env;
const SEEDS: number[] = String(env.GM_LEAN_SEEDS ?? "1")
	.split(",")
	.map(Number);
const SEASONS = Number(env.GM_LEAN_SEASONS ?? 3);

describe.skipIf(!env.GM_LEAN)("GM leanings measurement", () => {
	test("leagues", { timeout: 24 * 60 * 60 * 1000 }, async () => {
		Date.now = () => 1_700_000_000_000;
		for (const seed of SEEDS) {
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
					name: `lean${seed}`,
					setLeagueCreationStatus: () => {},
					settings: getDefaultSettings() as any,
					shuffleRosters: false,
					startingSeasonFromInput: "2025",
					teamsFromInput: helpers.addPopRank(helpers.getTeamsDefault()),
					tid: 0,
				},
			);
			await league.loadGameAttributes();
			await league.setGameAttributes({ spectator: true });

			// Plays until the phase changes, with an iteration guard
			const playUntil = async (done: () => boolean) => {
				for (let i = 0; i < 400 && !done(); i++) {
					await lock.set("gameSim", false);
					await game.play(Math.max(1, await season.getDaysLeftSchedule()), {});
				}
				assert(done(), "game.play loop guard hit");
			};

			// (season, tid) -> who ran the team this season
			const gmAt = new Map<string, any>();
			const rows: any[] = [];
			const startSeason = g.get("season");
			// Trades: offseason ones count for the next season (the front office that will run it). Recomputed and written after every
			// season (to GM_LEAN_OUT.<seed>), so a run cut short still leaves its finished seasons; the full run is appended to GM_LEAN_OUT
			const writeRows = async (final: boolean) => {
				await idb.cache.flush();
				for (const r of rows) {
					r.trades = 0;
					r.picksOut = 0;
					r.picksIn = 0;
				}
				const events: EventBBGM[] = await idb.league.getAll("events");
				for (const e of events) {
					if (e.type !== "trade") {
						continue;
					}
					const eff = (e.phase ?? 0) > PHASE.PLAYOFFS ? e.season + 1 : e.season;
					e.tids.forEach((tid, side) => {
						const row = rows.find((r) => r.season === eff && r.tid === tid);
						if (!row) {
							return;
						}
						row.trades += 1;
						const got = e.teams?.[side]?.assets ?? [];
						const gave = e.teams?.[side === 0 ? 1 : 0]?.assets ?? [];
						row.picksIn += got.filter((a) => "dpid" in a).length;
						row.picksOut += gave.filter((a) => "dpid" in a).length;
					});
				}
				if (env.GM_LEAN_OUT) {
					const text = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
					writeFileSync(`${env.GM_LEAN_OUT}.${seed}`, text);
					if (final) {
						appendFileSync(env.GM_LEAN_OUT, text);
					}
				}
			};
			for (let s = 0; s < SEASONS; s++) {
				await phase.newPhase(PHASE.REGULAR_SEASON, {});
				const cur = g.get("season");
				for (const t of await idb.cache.teams.getAll()) {
					if (t.gm && !t.disabled) {
						gmAt.set(`${cur}|${t.tid}`, {
							gmid: t.gm.gmid,
							traits: t.gm.traits,
							style: getGmFinanceStyle(t.gm),
							owner: t.commercial?.ownerType ?? "traditional",
							strategy: t.strategy,
						});
					}
				}
				await playUntil(() => g.get("phase") === PHASE.PLAYOFFS);
				// Roster age at the end of the regular season (minutes weighted)
				const ages = new Map<number, number>();
				for (const t of await idb.cache.teams.getAll()) {
					const players = await idb.cache.players.indexGetAll(
						"playersByTid",
						t.tid,
					);
					let sum = 0;
					let w = 0;
					for (const p of players) {
						const ps = p.stats.findLast(
							(x: any) => x.season === cur && !x.playoffs,
						);
						const min = ps?.min ?? 0;
						sum += (cur - p.born.year) * min;
						w += min;
					}
					ages.set(t.tid, w > 0 ? sum / w : Number.NaN);
				}
				await playUntil(() => g.get("phase") > PHASE.PLAYOFFS);
				await phase.newPhase(PHASE.DRAFT, {});
				await draft.runPicks({ type: "untilEnd" }, {});
				await phase.newPhase(PHASE.RESIGN_PLAYERS, {});
				await phase.newPhase(PHASE.FREE_AGENCY, {});
				await freeAgents.play(g.get("daysLeft"), {});
				if (g.get("phase") !== PHASE.PRESEASON) {
					await phase.newPhase(PHASE.PRESEASON, {});
				}
				const cap = g.get("salaryCap", cur);
				const luxuryPayroll = g.get("luxuryPayroll", cur);
				for (const ts of await idb.cache.teamSeasons.indexGetAll(
					"teamSeasonsBySeasonTid",
					[[cur], [cur, "Z"]],
				)) {
					const who = gmAt.get(`${cur}|${ts.tid}`);
					rows.push({
						seed,
						season: cur,
						i: cur - startSeason,
						tid: ts.tid,
						...who,
						payroll: ts.expenses.salary / cap,
						overTax: ts.expenses.salary > luxuryPayroll ? 1 : 0,
						tax: ts.expenses.luxuryTax > 0 ? 1 : 0,
						winp: helpers.calcWinp(ts),
						age: ages.get(ts.tid),
						trades: 0,
						picksOut: 0,
						picksIn: 0,
					});
				}
				await writeRows(false);
				console.log(`GM_LEAN seed ${seed} season ${s} done`);
			}
			await writeRows(true);
		}
	});
});
