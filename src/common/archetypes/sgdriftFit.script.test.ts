/* eslint-disable no-undef */
// @ts-nocheck
// sgdrift: re-fit POSITION_BIAS on the axes of full-engine random leagues (stats read against the league's own quantiles)
// against the real NBA's listed shares, with the real-NBA accuracy and the 2025 star targets as constraints. Not part of the
// normal run: SG_FIT_DUMP=<jsonl from sgShares.script.test.ts with SG_DUMP> (SG_FIT_OUT=report file).
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { test } from "vitest";
import {
	PLAY_STATS,
	POSITION_CENTROIDS,
	POSITION_BIAS,
	POSITIONS,
	axesFromRaw,
	improvedPosition,
	playStatKnots,
	positionAxes,
	positionStats,
} from "./position.ts";
import { realData } from "./real.testutil.ts";

const REAL = {
	PG: 12.1,
	G: 11.7,
	SG: 12.9,
	GF: 14.0,
	SF: 7.9,
	F: 9.2,
	PF: 8.8,
	FC: 12.3,
	C: 11.1,
};
const ORDER = ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"];
const STARS = {
	gilgesh01: ["PG", "G"],
	doncilu01: ["PG", "G", "GF"],
	cunnica01: ["PG", "G", "GF"],
	jamesle01: ["SF", "F"],
	duranke01: ["SF", "F"],
	jokicni01: ["C", "FC"],
	curryst01: ["PG"],
	antetgi01: ["F", "PF", "FC"],
	greendr01: ["PF", "F"],
	halibty01: ["PG"],
};

test.skipIf(!process.env.SG_FIT_DUMP)(
	"sgdrift bias fit",
	() => {
		const OUT = process.env.SG_FIT_OUT ?? "/tmp/sgdrift-fit.txt";
		writeFileSync(OUT, "");
		const log = (s) => appendFileSync(OUT, `${s}\n`);
		const rows = readFileSync(process.env.SG_FIT_DUMP, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l));
		// League knots per league-season, as leaguePlayStatKnots
		const knots = new Map();
		for (const [k, list] of Object.entries(
			Object.groupBy(rows, (r) => `${r.seed}|${r.season}`),
		)) {
			knots.set(
				k,
				playStatKnots(
					list
						.filter((r) => r.st && r.st.min >= 500)
						.map((r) => r.st.astp + 0.1 * r.st.usgp),
				),
			);
		}
		const minSeason = Math.min(...rows.map((r) => r.season));
		let league;
		const buildLeague = () => {
			league = rows.map((r) => ({
				// players who came in through the draft: what the league turns into
				late: r.season - minSeason >= 4 && r.draftYear >= minSeason,
				axes: axesFromRaw(
					r.raw,
					r.st ?? undefined,
					knots.get(`${r.seed}|${r.season}`),
				),
			}));
		};
		buildLeague();

		const data = realData();
		let real = [];
		let stars = [];
		const buildReal = () => {
			real = [];
			stars = [];
			for (const row of data.d.ratings) {
				const listed = data.d.bios[row.slug]?.pos;
				const isStar = STARS[row.slug] && row.season === 2025;
				if ((row.season < 2016 || !ORDER.includes(listed)) && !isStar) {
					continue;
				}
				const stats = (data.st.stats[row.slug] ?? []).filter(
					(x) => x.season < row.season,
				);
				const axes = positionAxes(row, positionStats(stats, row.season));
				if (isStar) {
					stars.push({ slug: row.slug, axes });
				}
				if (row.season >= 2016 && ORDER.includes(listed)) {
					real.push({ listed, axes });
				}
			}
		};
		buildReal();

		// archetypes.test.ts's pinned real players: their builds read their positions, so those stay put
		const pinnedSrc = readFileSync(
			new URL("./archetypes.test.ts", import.meta.url),
			"utf8",
		);
		const pinned = [
			...pinnedSrc.matchAll(/\["([\da-z]+)", (\d{4}), "[\da-z-]+"]/g),
		].map((m) => [m[1], Number(m[2])]);
		const pinnedAxes = [];
		for (const [slug, season] of pinned) {
			const row = data.d.ratings.find(
				(r) => r.slug === slug && r.season === season,
			);
			if (!row) {
				continue;
			}
			const stats = (data.st.stats[slug] ?? []).filter(
				(x) => x.season < season,
			);
			pinnedAxes.push({
				slug,
				season,
				axes: positionAxes(row, positionStats(stats, season)),
			});
		}
		const pinnedBase = new Map(
			process.env.SG_FIT_PINNED_BASE
				? JSON.parse(readFileSync(process.env.SG_FIT_PINNED_BASE, "utf8"))
				: [],
		);
		const pinnedNow = () =>
			pinnedAxes.map((x) => [
				`${x.slug} ${x.season}`,
				improvedPosition(x.axes),
			]);
		const pinnedOk = () =>
			pinnedNow().every(
				([k, p]) => !pinnedBase.has(k) || pinnedBase.get(k) === p,
			);
		if (process.env.SG_FIT_PINNED_WRITE) {
			writeFileSync(
				process.env.SG_FIT_PINNED_WRITE,
				JSON.stringify(pinnedNow()),
			);
		}
		log(`pinned: ${pinnedAxes.length}`);

		const evalAll = () => {
			const sh = { all: {}, late: {} };
			let nAll = 0;
			let nLate = 0;
			for (const x of league) {
				const p = improvedPosition(x.axes);
				sh.all[p] = (sh.all[p] ?? 0) + 1;
				nAll++;
				if (x.late) {
					sh.late[p] = (sh.late[p] ?? 0) + 1;
					nLate++;
				}
			}
			let err = 0;
			for (const pos of POSITIONS) {
				sh.all[pos] = (100 * (sh.all[pos] ?? 0)) / nAll;
				sh.late[pos] = (100 * (sh.late[pos] ?? 0)) / nLate;
				err += (sh.all[pos] - REAL[pos]) ** 2 + (sh.late[pos] - REAL[pos]) ** 2;
			}
			let adj = 0;
			let exact = 0;
			for (const x of real) {
				const p = improvedPosition(x.axes);
				if (p === x.listed) {
					exact++;
				}
				if (Math.abs(ORDER.indexOf(p) - ORDER.indexOf(x.listed)) <= 1) {
					adj++;
				}
			}
			const starsOk = stars.every((s) =>
				STARS[s.slug].includes(improvedPosition(s.axes)),
			);
			return {
				sh,
				err,
				adj: adj / real.length,
				exact: exact / real.length,
				starsOk,
			};
		};
		const fmt = (sh) =>
			POSITIONS.map((p) => `${p} ${sh[p].toFixed(1)}`).join(" ");
		const report = (label, e) =>
			log(
				`${label}: err ${e.err.toFixed(1)} adj ${(100 * e.adj).toFixed(2)} exact ${(100 * e.exact).toFixed(2)} stars ${e.starsOk}\n  all  ${fmt(e.sh.all)}\n  late ${fmt(e.sh.late)}\n  bias ${JSON.stringify(POSITION_BIAS)}\n  centroids ${["PG", "G", "SG", "GF"].map((p) => p + " " + POSITION_CENTROIDS[p].map((x) => x.toFixed(3)).join("/")).join(" ")}\n  stars ${stars.map((x) => x.slug + ":" + improvedPosition(x.axes)).join(" ")}`,
			);
		const ADJ_MIN = Number(process.env.SG_FIT_ADJ ?? 0.825);
		// The unit tests' axes (position.test.ts)
		const AX = [
			[
				{ inches: 75, length: 75, skill: 0.65, play: 0.8, fromStats: 1 },
				["PG"],
			],
			[{ inches: 75, length: 75, skill: 0.65, play: 0.8, fromStats: 0 }, ["G"]],
			[
				{ inches: 75, length: 73.5, skill: 0.65, play: 0.97, fromStats: 0 },
				["PG"],
			],
			[
				{ inches: 76, length: 75.5, skill: 0.6, play: 0.95, fromStats: 1 },
				["PG"],
			],
			[
				{ inches: 76, length: 76.5, skill: 0.6, play: 0.3, fromStats: 1 },
				["SG"],
			],
			[{ inches: 85.5, length: 86, skill: 0.1, play: 0.2 }, ["C"]],
			[{ inches: 80.5, length: 81, skill: 0.2, play: 0.2 }, ["PF", "F", "SF"]],
			[{ inches: 73, length: 73, skill: 0.9, play: 0.95 }, ["PG"]],
		];
		const fixturesOk = () =>
			AX.every(([a, want]) => want.includes(improvedPosition(a))) &&
			improvedPosition({ inches: 84, length: 84, skill: 0.8, play: 0.9 }) !==
				"C";
		const ok = (e) =>
			fixturesOk() &&
			pinnedOk() &&
			(process.env.SG_FIT_NOSTARS || e.starsOk) &&
			e.adj >= ADJ_MIN;
		const W = process.env.SG_FIT_W ? Number(process.env.SG_FIT_W) : undefined;
		if (W !== undefined) {
			PLAY_STATS.w = W;
			buildLeague();
			buildReal();
		}
		if (process.env.SG_FIT_START_ORIG) {
			// fixes4's values
			Object.assign(POSITION_BIAS, {
				PG: -0.27,
				G: -0.23,
				SG: -0.2,
				GF: 1.12,
				SF: -0.1,
				F: -0.66,
				PF: 0.34,
				FC: 0.52,
				C: -0.61,
			});
			POSITION_CENTROIDS.PG = [74.59, 0.89, 0.65];
			POSITION_CENTROIDS.G = [75.39, 0.64, 0.68];
			POSITION_CENTROIDS.SG = [76.28, 0.42, 0.61];
			POSITION_CENTROIDS.GF = [77.99, 0.55, 0.51];
		}
		let cur = evalAll();
		report(`before (w ${PLAY_STATS.w})`, cur);
		for (const step of [0.2, 0.1, 0.05, 0.02]) {
			for (let round = 0; round < 8; round++) {
				let improved = false;
				const params = [
					...POSITIONS.map((pos) => [POSITION_BIAS, pos, 1]),
					...(process.env.SG_FIT_CENTROIDS
						? ["PG", "G", "SG", "GF"].flatMap((pos) => [
								[POSITION_CENTROIDS[pos], 1, 0.1],
								[POSITION_CENTROIDS[pos], 0, 1],
							])
						: []),
				];
				for (const [obj, k, scale] of params) {
					for (const d of [step * scale, -step * scale]) {
						obj[k] += d;
						const e = evalAll();
						if (ok(e) && e.err < cur.err - 1e-9) {
							cur = e;
							improved = true;
						} else {
							obj[k] -= d;
						}
					}
				}
				if (!improved) {
					break;
				}
			}
		}
		for (const pos of POSITIONS) {
			POSITION_BIAS[pos] = Math.round(POSITION_BIAS[pos] * 100) / 100;
		}
		report("after", evalAll());
		log(
			`pinned changed: ${pinnedNow()
				.filter(([k, p]) => pinnedBase.has(k) && pinnedBase.get(k) !== p)
				.map(([k, p]) => `${k} ${pinnedBase.get(k)}->${p}`)
				.join(", ")}`,
		);
	},
	3_600_000,
);
