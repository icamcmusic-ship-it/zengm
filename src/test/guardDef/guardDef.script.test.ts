// @ts-nocheck (node-only script, like src/test/ratingInflation/run.script.test.ts)
/* eslint-disable no-undef */
// Guard defense audit (docs/native-features.md, "Perimeter defense"): sims leagues headlessly with the real engine and dumps,
// per season, every rotation player's position, height, defensive ratings/stats and All-Defensive/DPOY results.
// Run with RUN_GUARD_DEF=1. Env: GD_CONFIGS (off,expanded,...), GD_SEEDS, GD_SEASONS, GD_OUT, GD_EXTRA (JSON settings, e.g.
// {"perimeterDefense":true})
import { appendFileSync, mkdirSync } from "node:fs";
import { test } from "vitest";
import { PHASE } from "../../common/constants.ts";
import { OFF, createLeague, mulberry32 } from "../ratingInflation/harness.ts";
import { TOGGLES } from "../ratingInflation/toggles.ts";
import { idb } from "../../worker/db/index.ts";
import { g, local } from "../../worker/util/index.ts";
import { startAutoPlay } from "../../worker/core/league/autoPlay.ts";

test.skipIf(!process.env.RUN_GUARD_DEF)(
	"guard defense sims",
	async () => {
		if (globalThis.IDBRequest === undefined) {
			await import("fake-indexeddb/auto");
		}
		const configs = (process.env.GD_CONFIGS ?? "off,expanded").split(",");
		const seeds = (process.env.GD_SEEDS ?? "1").split(",").map(Number);
		const seasons = Number(process.env.GD_SEASONS ?? 3);
		const outDir = process.env.GD_OUT ?? "/tmp/guardDef";
		mkdirSync(outDir, { recursive: true });
		for (const seed of seeds) {
			for (const config of configs) {
				const file = `${outDir}/${config}-${seed}.jsonl`;
				const origRandom = Math.random;
				Math.random = mulberry32(seed);
				try {
					await createLeague({
						...OFF,
						...TOGGLES[config],
						...JSON.parse(process.env.GD_EXTRA ?? "{}"),
					});
					for (let i = 0; i < seasons; i++) {
						const season = g.get("season");
						await startAutoPlay(season, PHASE.DRAFT_LOTTERY, {});
						const players = await idb.cache.players.getAll();
						const winpByTid: Record<number, number> = {};
						for (const ts of await idb.cache.teamSeasons.indexGetAll(
							"teamSeasonsBySeasonTid",
							[[season], [season, "Z"]],
						)) {
							const gp = ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0);
							winpByTid[ts.tid] = gp > 0 ? ts.won / gp : 0;
						}
						const rows = [];
						for (const p of players) {
							const ps = p.stats.findLast(
								(s) => s.season === season && !s.playoffs,
							);
							const r = p.ratings.findLast((r) => r.season === season);
							if (!ps || !r || ps.gp < 20) {
								continue;
							}
							const awards = (p.awards ?? [])
								.filter((a) => a.season === season)
								.map((a) => a.shortName + (a.rank ?? "") + (a.type ?? ""));
							rows.push({
								pid: p.pid,
								name: `${p.firstName} ${p.lastName}`,
								pos: r.pos,
								winp: winpByTid[ps.tid],
								hgtIn: p.hgt,
								hgt: r.hgt,
								ovr: r.ovr,
								diq: r.diq,
								pdef: r.pdef,
								idef: r.idef,
								wng: r.wng,
								spd: r.spd,
								jmp: r.jmp,
								skills: r.skills,
								gp: ps.gp,
								min: ps.min,
								stl: ps.stl,
								blk: ps.blk,
								drb: ps.drb,
								tov: ps.tov,
								pts: ps.pts,
								fg: ps.fg,
								fga: ps.fga,
								dws: ps.dws,
								dbpm: ps.dbpm,
								drtg: ps.drtg,
								awards,
							});
						}
						appendFileSync(
							file,
							JSON.stringify({ config, seed, season, rows }) + "\n",
						);
						console.log(config, seed, season);
						await startAutoPlay(season + 1, PHASE.PRESEASON, {});
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
