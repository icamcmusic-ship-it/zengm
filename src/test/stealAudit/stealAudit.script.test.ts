// @ts-nocheck (node-only script, like src/test/guardDef/guardDef.script.test.ts)
/* eslint-disable no-undef */
// Steals audit (docs/native-features.md, "Perimeter defense"): sims random-player leagues headlessly with the real engine and
// dumps, per season, team totals (stl, tov, pts, fg, fga) and every player's position, minutes, steals and awards.
// Run with RUN_STEAL_AUDIT=1. Env: SA_CONFIGS (off,newDefaults,... from ratingInflation/toggles.ts), SA_SEEDS, SA_SEASONS,
// SA_OUT, SA_EXTRA (JSON settings applied on top, e.g. {"perimeterDefense":false}), SA_TAG (file name suffix)
import { appendFileSync, mkdirSync } from "node:fs";
import { test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { OFF, createLeague, mulberry32 } from "../ratingInflation/harness.ts";
import { TOGGLES } from "../ratingInflation/toggles.ts";
import { idb } from "../../worker/db/index.ts";
import { g, local } from "../../worker/util/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";

test.skipIf(!process.env.RUN_STEAL_AUDIT)(
	"steals audit sims",
	async () => {
		if (globalThis.IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const configs = (process.env.SA_CONFIGS ?? "off,newDefaults").split(",");
		const seeds = (process.env.SA_SEEDS ?? "1").split(",").map(Number);
		const seasons = Number(process.env.SA_SEASONS ?? 1);
		const outDir = process.env.SA_OUT ?? "/tmp/stealAudit";
		const tag = process.env.SA_TAG ?? "";
		mkdirSync(outDir, { recursive: true });
		for (const seed of seeds) {
			for (const config of configs) {
				const file = `${outDir}/${config}${tag}-${seed}.jsonl`;
				const origRandom = Math.random;
				Math.random = mulberry32(seed);
				try {
					await createLeague({
						...OFF,
						...TOGGLES[config],
						...JSON.parse(process.env.SA_EXTRA ?? "{}"),
					});
					for (let i = 0; i < seasons; i++) {
						const season = g.get("season");
						await startAutoPlay(season, PHASE.DRAFT_LOTTERY, {});
						const teams = [];
						for (const ts of await idb.cache.teamStats.getAll()) {
							if (ts.season !== season || ts.playoffs) {
								continue;
							}
							teams.push({
								tid: ts.tid,
								gp: ts.gp,
								stl: ts.stl,
								tov: ts.tov,
								pts: ts.pts,
								fg: ts.fg,
								fga: ts.fga,
								tp: ts.tp,
								tpa: ts.tpa,
								blk: ts.blk,
								poss: ts.poss,
							});
						}
						const players = await idb.cache.players.getAll();
						const rows = [];
						for (const p of players) {
							const ps = p.stats.findLast(
								(s) => s.season === season && !s.playoffs,
							);
							const r = p.ratings.findLast((r) => r.season === season);
							if (!ps || !r || ps.gp < 1) {
								continue;
							}
							rows.push({
								pid: p.pid,
								pos: r.pos,
								ovr: r.ovr,
								hgt: r.hgt,
								spd: r.spd,
								diq: r.diq,
								pdef: r.pdef,
								wng: r.wng,
								gp: ps.gp,
								min: ps.min,
								stl: ps.stl,
								blk: ps.blk,
								tov: ps.tov,
								dws: ps.dws,
								awards: (p.awards ?? [])
									.filter((a) => a.season === season)
									.map((a) => a.type ?? `${a.shortName}${a.rank}`),
							});
						}
						appendFileSync(
							file,
							JSON.stringify({ config, seed, season, teams, rows }) + "\n",
						);
						console.log(config, seed, season);
						if (i < seasons - 1) {
							await startAutoPlay(season + 1, PHASE.PRESEASON, {});
						}
					}
				} finally {
					Math.random = origRandom;
					local.autoPlayUntil = undefined;
				}
			}
		}
	},
	24 * 3600 * 1000,
);
