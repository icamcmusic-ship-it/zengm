/* eslint-disable no-undef */
// @ts-nocheck
// Diagnostics for position shares in a random league (improved positions) against real NBA listings. Not part of the normal
// run: RUN_SG_SHARES=1 (SG_OUT=file for the report, SG_SEEDS=n leagues, SG_SEASONS=n career seasons). Prints:
// - real NBA listed shares (2016-2025 player-seasons) and the rating profile of each listed position (ratings-only axes),
// - a new random league (new-league defaults) at creation: all players and rostered players, and the same profiles,
// - careers: rostered player-seasons over SG_SEASONS seasons of the population model (SG_FULL=1: the full engine, games
//   and stats, with each season's shares, the shares of players who came in through the draft and of rookies, playmaking
//   read with vs without stats by position, position changes since last season and the league's assist% + usage%/10
//   quantiles; SG_DUMP=file writes every rostered player-season's raw position readings for sgdriftFit.script.test.ts),
// - draft classes: share of the top 60 by value at 6'3" or shorter.
import { appendFileSync, writeFileSync } from "node:fs";
import { afterAll, test } from "vitest";
import { PLAYER } from "../constants.ts";
import { resetG } from "../../test/helpers.ts";
import { idb } from "../../worker/db/index.ts";
import {
	OFF,
	createLeague,
	mulberry32,
	runLeague,
} from "../../test/ratingInflation/harness.ts";
import { runPopModel } from "../../test/ratingInflation/popModel.ts";
import { TOGGLES } from "../../test/ratingInflation/toggles.ts";
import {
	POSITIONS,
	positionAxes,
	positionRaw,
	positionStats,
} from "./position.ts";
import { realData } from "./real.testutil.ts";
import { SCORER_MIX } from "../../worker/core/player/genRatings.basketball.ts";

const OUT = process.env.SG_OUT ?? "/tmp/sg-shares.txt";
const KEYS = [
	"stre",
	"spd",
	"jmp",
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

const { cache, league } = idb;
afterAll(() => {
	idb.cache = cache;
	idb.league = league;
	resetG();
});

const shares = (list: string[]) => {
	const out = {};
	for (const pos of POSITIONS) {
		out[pos] =
			Math.round(
				(1000 * list.filter((x) => x === pos).length) /
					Math.max(1, list.length),
			) / 10;
	}
	return out;
};

const fmtShares = (label: string, list: string[]) =>
	`${label.padEnd(28)} n=${String(list.length).padStart(6)} ${POSITIONS.map((p) => `${p} ${shares(list)[p].toFixed(1).padStart(4)}`).join("  ")}`;

const profile = (rows: { pos: string; r: any }[]) => {
	const lines = [];
	lines.push(
		`${"pos".padEnd(4)} ${"n".padStart(6)} ${"in".padStart(5)} ${["len", "play", "skill"].map((x) => x.padStart(5)).join(" ")} ${KEYS.map((k) => k.padStart(4)).join(" ")}`,
	);
	for (const pos of POSITIONS) {
		const rs = rows.filter((x) => x.pos === pos).map((x) => x.r);
		if (rs.length === 0) {
			continue;
		}
		const m = (f) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
		const axes = rs.map((r) => positionAxes(r));
		const ma = (k) => axes.reduce((a, x) => a + x[k], 0) / axes.length;
		lines.push(
			`${pos.padEnd(4)} ${String(rs.length).padStart(6)} ${m(
				(r) => positionRaw(r).inches,
			)
				.toFixed(1)
				.padStart(
					5,
				)} ${ma("length").toFixed(1).padStart(5)} ${ma("play").toFixed(2).padStart(5)} ${ma("skill").toFixed(2).padStart(5)} ${KEYS.map(
				(k) =>
					m((r) => r[k])
						.toFixed(0)
						.padStart(4),
			).join(" ")}`,
		);
	}
	return lines.join("\n");
};

// Height bands (inches) x position
const heightTable = (rows: { pos: string; r: any }[]) => {
	const lines = [];
	for (const [lo, hi] of [
		[0, 74],
		[74, 76],
		[76, 78],
		[78, 80],
		[80, 82],
		[82, 99],
	]) {
		const list = rows.filter((x) => {
			const inches = 66 + 0.27 * x.r.hgt;
			return inches >= lo && inches < hi;
		});
		lines.push(
			fmtShares(
				`  ${lo}-${hi} in (${((100 * list.length) / rows.length).toFixed(1)}%)`,
				list.map((x) => x.pos),
			),
		);
	}
	return lines.join("\n");
};

test.skipIf(!process.env.RUN_SG_SHARES)(
	"SG shares",
	async () => {
		writeFileSync(OUT, "");
		if (process.env.SG_STOCK) {
			// BBGM's player type mix (before the scorer type)
			SCORER_MIX.length = 0;
		}
		const log = (s: string) => {
			appendFileSync(OUT, `${s}\n`);
		};
		const settings = {
			...OFF,
			...TOGGLES[process.env.SG_CONFIG ?? "newDefaults"],
		};
		log(`config ${process.env.SG_CONFIG ?? "newDefaults"}`);

		// Real NBA
		const { d } = realData();
		const real = [];
		for (const row of d.ratings) {
			const listed = d.bios[row.slug]?.pos;
			if (
				row.season < 2016 ||
				row.season > 2025 ||
				!POSITIONS.includes(listed)
			) {
				continue;
			}
			real.push({ pos: listed, r: row });
		}
		log(
			fmtShares(
				"real NBA listed 2016-2025",
				real.map((x) => x.pos),
			),
		);
		log("real NBA listed, profile (ratings-only axes)");
		log(profile(real));
		log(heightTable(real));

		const seeds = Number(process.env.SG_SEEDS ?? 3);
		const seasons = Number(process.env.SG_SEASONS ?? 10);
		const createAll = [];
		const createRostered = [];
		const createRows = [];
		const createAllRows = [];
		const careers = [];
		const smallTop60 = [];
		const classesSeen = new Set();
		const draftClasses = async (label) => {
			const prospects = (await idb.cache.players.indexGetAll(
				"playersByTid",
				PLAYER.UNDRAFTED,
			)) as any[];
			const byYear = Object.groupBy(prospects, (p) => p.draft.year);
			for (const [year, ps] of Object.entries(byYear)) {
				const key = `${label}-${year}`;
				// Only classes about to be drafted (complete and developed)
				if (classesSeen.has(key) || Number(year) !== g_season()) {
					continue;
				}
				classesSeen.add(key);
				const top = [...ps].sort((a, b) => b.value - a.value).slice(0, 60);
				smallTop60.push(top.filter((p) => p.hgt <= 75).length / top.length);
			}
		};
		let g_season = () => 0;
		const lastPos = new Map();
		let startSeason;
		const moves = new Map();
		const pending = [];
		for (let seed = 1; seed <= seeds; seed++) {
			const origRandom = Math.random;
			Math.random = mulberry32(1000 + seed);
			try {
				await createLeague(settings);
			} finally {
				Math.random = origRandom;
			}
			const { g } = await import("../../worker/util/index.ts");
			g_season = () => g.get("season");
			for (const p of (await idb.cache.players.getAll()) as any[]) {
				if (p.tid === PLAYER.UNDRAFTED) {
					continue;
				}
				const r = p.ratings.at(-1);
				createAll.push(r.pos);
				createAllRows.push({ pos: r.pos, r });
				if (p.tid >= 0) {
					createRostered.push(r.pos);
					createRows.push({ pos: r.pos, r });
				}
			}
			// Draft classes of a new league (current season's class)
			await draftClasses(`c${seed}`);

			if (seasons > 0 && process.env.SG_FULL) {
				// The full engine (games, stats: positions read assist and usage rates)
				await runLeague({
					config: "sg",
					settings,
					seed: 1000 + seed,
					seasons,
					onSeason: async () => {
						// (lastPos, moves: position changes since last season, for players rostered both times)
						// Rostered positions this season, and playmaking (percentile) read with vs without his stats
						const season = g_season();
						const list = [];
						const drafted = [];
						const rookies = [];
						startSeason ??= season;
						const play = {};
						const statVals = [];
						for (const p of (await idb.cache.players.indexGetAll(
							"playersByTid",
							[0, Infinity],
						)) as any[]) {
							const r = p.ratings.at(-1);
							careers.push(r.pos);
							list.push(r.pos);
							if (p.draft.year >= startSeason) {
								drafted.push(r.pos);
							}
							if (p.draft.year === season - 1) {
								rookies.push(r.pos);
							}
							const before = lastPos.get(p.pid);
							if (before !== undefined && before !== r.pos) {
								const k = `${before}>${r.pos}`;
								moves.set(k, (moves.get(k) ?? 0) + 1);
							}
							lastPos.set(p.pid, r.pos);
							const st = positionStats(p.stats, season);
							if (st && st.min >= 500) {
								statVals.push(st.astp + 0.1 * st.usgp);
							}
							if (process.env.SG_DUMP) {
								// The axes as next preseason reads them (this season's stats), for offline fits
								const st1 = positionStats(p.stats, season + 1);
								const raw = positionRaw(r);
								appendFileSync(
									process.env.SG_DUMP,
									`${JSON.stringify({
										seed,
										season,
										pid: p.pid,
										pos: r.pos,
										draftYear: p.draft.year,
										r: Object.fromEntries(
											[
												...KEYS,
												"hgt",
												"ovr",
												"bsc",
												"pdef",
												"idef",
												"wsp",
												"dreb",
												"oreb",
											]
												.filter((k) => r[k] !== undefined)
												.map((k) => [k, r[k]]),
										),
										raw,
										st: st1 ?? null,
									})}\n`,
								);
							}
							const withStats = positionAxes(r, st).play;
							const noStats = positionAxes(r).play;
							(play[r.pos] ??= []).push([withStats, noStats]);
						}
						log(fmtShares(`seed ${seed} season ${season}, rostered`, list));
						log(fmtShares(`  drafted in the league`, drafted));
						log(fmtShares(`  rookies (first season)`, rookies));
						const pl = POSITIONS.map((pos) => {
							const xs = play[pos] ?? [];
							const a =
								xs.reduce((t, x) => t + x[0], 0) / Math.max(1, xs.length);
							const b =
								xs.reduce((t, x) => t + x[1], 0) / Math.max(1, xs.length);
							return `${pos} ${a.toFixed(2)}/${b.toFixed(2)}`;
						});
						log(`  play with/without stats: ${pl.join("  ")}`);
						log(
							`  moves: ${[...moves]
								.sort((a, b) => b[1] - a[1])
								.slice(0, 12)
								.map(([k, n]) => `${k} ${n}`)
								.join("  ")}`,
						);
						moves.clear();
						statVals.sort((x, y) => x - y);
						const q = [0.1, 0.25, 0.5, 0.75, 0.9].map((f) =>
							statVals[Math.floor(f * (statVals.length - 1))]?.toFixed(2),
						);
						log(`  ast%+usg%/10 (500+ min) q10/25/50/75/90: ${q.join(" ")}`);
					},
				});
				await Promise.all(pending);
			} else if (seasons > 0) {
				await runPopModel({
					config: "sg",
					settings,
					seed: 1000 + seed,
					seasons,
					onSeason: () => {},
					onRegularSeason: async (players) => {
						for (const p of players) {
							if (p.tid >= 0) {
								careers.push(p.ratings.at(-1).pos);
							}
						}
						await draftClasses(`s${seed}`);
					},
				});
			}
		}
		log("");
		const m = (rows, k) =>
			(rows.reduce((a, x) => a + x.r[k], 0) / rows.length).toFixed(2);
		log(
			`creation mean ovr/pot: all ${m(createAllRows, "ovr")}/${m(createAllRows, "pot")}, rostered ${m(createRows, "ovr")}/${m(createRows, "pot")}`,
		);
		log(fmtShares("creation, all players", createAll));
		log(fmtShares("creation, rostered", createRostered));
		log(fmtShares(`careers ${seasons} seasons, rostered`, careers));
		const mean =
			smallTop60.reduce((a, b) => a + b, 0) / Math.max(1, smallTop60.length);
		log(
			`draft top 60 at 6'3" or shorter: ${(100 * mean).toFixed(1)}% (${smallTop60.length} classes)`,
		);
		log("creation rostered, profile by assigned position");
		log(profile(createRows));
		log(heightTable(createRows));
		log("creation all players (no prospects), by height");
		log(heightTable(createAllRows));
		for (const [label, rows] of [
			["rostered", createRows],
			["all", createAllRows],
		]) {
			const line = [];
			for (const [lo, hi] of [
				[0, 74],
				[74, 76],
				[76, 78],
				[78, 80],
				[80, 82],
				[82, 99],
			]) {
				const rs = rows.filter(
					(x) => 66 + 0.27 * x.r.hgt >= lo && 66 + 0.27 * x.r.hgt < hi,
				);
				line.push(
					`${lo}-${hi}: ovr ${(rs.reduce((a, x) => a + x.r.ovr, 0) / rs.length).toFixed(1)}`,
				);
			}
			log(`mean ovr ${label}: ${line.join("  ")}`);
		}
	},
	3_600_000,
);
