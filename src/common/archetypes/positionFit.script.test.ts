/* eslint-disable no-undef, curly, unicorn/prefer-single-call */
// @ts-nocheck
// Fitting/diagnostics for the improved (two-axis) basketball positions. Not part of the normal run: RUN_POSITION_FIT=1
// (writes /tmp/claude-0/position-fit.txt). Prints the reference quantile knots and the fitted centroid biases.
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import { resetG } from "../../test/helpers.ts";
import develop from "../../worker/core/player/develop.ts";
import generate from "../../worker/core/player/generate.ts";
import ovrFn from "../../worker/core/player/ovr.ts";
import { ARCHETYPES, classify } from "./classify.ts";
import {
	POSITIONS,
	POSITION_BIAS,
	POSITION_CENTROIDS,
	ballSkillsRaw,
	improvedPosition,
	positionAxes,
	positionOf,
	posPrior,
	sizeRaw,
} from "./position.ts";

// A pairing is forbidden when the archetype's own prior for the position is null
const archetypeAllows = (c, ps) => {
	const a = ARCHETYPES.find((x) => x.id === c.id);
	return posPrior(a.group, a.pos, ps) !== null;
};

const quantiles = (vals: number[], k: number) => {
	const s = [...vals].sort((a, b) => a - b);
	const out = [];
	for (let i = 0; i <= k; i++) {
		out.push(Math.round(s[Math.round((i / k) * (s.length - 1))] * 100) / 100);
	}
	return out;
};

test.skipIf(!process.env.RUN_POSITION_FIT)(
	"position fit",
	async () => {
		resetG();
		// Reproducible sample
		const seeded = new Rng("pos-fit-random");
		const realRandom = Math.random;
		Math.random = () => seeded.random();
		const out: string[] = [];
		const rng = new Rng("pos-fit-v1");
		// Careers: players developed season by season, so the sample covers every age and stickiness can be measured
		const careers = [];
		while (careers.length < 3000) {
			const p = generate(-1, 19, 2025, false, DEFAULT_LEVEL);
			p.born.year = p.ratings[0].season - 19;
			await develop(p, 0, true);
			const rows = [{ ...p.ratings.at(-1) }];
			const n = rng.int(4, 14);
			for (let y = 1; y <= n; y++) {
				const prev = p.ratings.at(-1);
				p.ratings.push({ ...prev, season: prev.season + 1 });
				await develop(p, 1, false, DEFAULT_LEVEL, true);
				rows.push({ ...p.ratings.at(-1) });
			}
			careers.push(rows);
		}
		const flat = careers.flat();
		out.push(
			`ovr quantiles ${JSON.stringify(
				quantiles(
					flat.map((r) => ovrFn(r)),
					10,
				),
			)} hgt ${JSON.stringify(
				quantiles(
					flat.map((r) => r.hgt),
					10,
				),
			)}`,
		);
		const all = flat.filter((r) => ovrFn(r) >= 38);
		out.push(`rows ${all.length}`);
		out.push(`size knots ${JSON.stringify(quantiles(all.map(sizeRaw), 20))}`);
		out.push(
			`skill knots ${JSON.stringify(quantiles(all.map(ballSkillsRaw), 20))}`,
		);

		// Fit biases so the overall shares match the old formula
		const target = {};
		for (const r of all) {
			const ps = positionOf(r);
			target[ps] = (target[ps] ?? 0) + 1 / all.length;
		}
		const bias = { ...POSITION_BIAS };
		const axes = all.map((r) => positionAxes(r));
		const share = () => {
			const c = {};
			for (const a of axes) {
				const ps = improvedPosition(a, undefined, bias);
				c[ps] = (c[ps] ?? 0) + 1 / all.length;
			}
			return c;
		};
		if (process.env.FIT) {
			// Fit on sticky careers: the shares players actually end up with
			const cax = careers.map((rs) =>
				rs.map((r) => ({ a: positionAxes(r), keep: ovrFn(r) >= 38 })),
			);
			const stickyShare = () => {
				const c = {};
				let n = 0;
				for (const rs of cax) {
					let prev;
					for (const x of rs) {
						prev = improvedPosition(x.a, prev, bias);
						if (x.keep) {
							c[prev] = (c[prev] ?? 0) + 1;
							n++;
						}
					}
				}
				for (const k of Object.keys(c)) c[k] /= n;
				return c;
			};
			for (let it = 0; it < 400; it++) {
				const c = stickyShare();
				for (const p of POSITIONS) {
					bias[p] += 0.02 * Math.log((target[p] ?? 1e-4) / (c[p] ?? 1e-4));
				}
			}
			out.push(
				`fitted bias ${JSON.stringify(Object.fromEntries(POSITIONS.map((p) => [p, Math.round(bias[p] * 1000) / 1000])))}`,
			);
		}
		// Centroids actually used vs mean axes of the old positions
		const mean = {};
		for (let i = 0; i < all.length; i++) {
			const ps = positionOf(all[i]);
			mean[ps] ??= [0, 0, 0];
			mean[ps][0] += axes[i].size;
			mean[ps][1] += axes[i].skill;
			mean[ps][2]++;
		}
		out.push(
			"old-position mean axes " +
				POSITIONS.map(
					(p) =>
						mean[p] &&
						`${p}:(${(mean[p][0] / mean[p][2]).toFixed(2)},${(mean[p][1] / mean[p][2]).toFixed(2)})`,
				).join(" "),
		);
		out.push(`centroids ${JSON.stringify(POSITION_CENTROIDS)}`);

		const newShare = share();
		out.push("| Pos | old % | new % |");
		for (const p of POSITIONS) {
			out.push(
				`| ${p} | ${(100 * (target[p] ?? 0)).toFixed(1)} | ${(100 * (newShare[p] ?? 0)).toFixed(1)} |`,
			);
		}
		// Cross table old -> new
		const cross = {};
		for (const r of all) {
			const k = `${positionOf(r)}>${improvedPosition(positionAxes(r))}`;
			cross[k] = (cross[k] ?? 0) + 1;
		}
		out.push(
			"cross " +
				Object.entries(cross)
					.sort((a, b) => b[1] - a[1])
					.map(([k, v]) => `${k}:${v}`)
					.join(" "),
		);

		// Shares with stickiness along careers
		const sticky = {};
		let ns = 0;
		for (const rows of careers) {
			let prev;
			for (const r of rows) {
				prev = improvedPosition(positionAxes(r), prev);
				if (ovrFn(r) >= 38) {
					sticky[prev] = (sticky[prev] ?? 0) + 1;
					ns++;
				}
			}
		}
		out.push(
			"sticky shares " +
				POSITIONS.map(
					(p) => `${p}:${((100 * (sticky[p] ?? 0)) / ns).toFixed(1)}`,
				).join(" "),
		);
		// Stickiness: changes per player-season (rows after the first)
		const changes = (f) => {
			let ch = 0,
				n = 0;
			for (const rows of careers) {
				let prev;
				for (const r of rows) {
					const ps = f(r, prev);
					if (prev !== undefined) {
						n++;
						if (ps !== prev) ch++;
					}
					prev = ps;
				}
			}
			return ((100 * ch) / n).toFixed(1);
		};
		out.push(
			`changes per player-season: old ${changes((r) => positionOf(r))}% | new no-stick ${changes((r) => improvedPosition(positionAxes(r)))}% | new sticky ${changes((r, prev) => improvedPosition(positionAxes(r), prev))}% | margins ${[0.005, 0.01, 0.015, 0.02, 0.03].map((m) => `${m}:${changes((r, prev) => improvedPosition(positionAxes(r), prev, undefined, m))}`).join(" ")}`,
		);
		// Roster balance proxy: each season index, the players of that index split into 13-man teams by ovr rank (snake)
		const balance = (f) => {
			const per = [];
			for (let y = 0; y < 10; y++) {
				const rows = [];
				for (const rs of careers) {
					let prev;
					for (let i = 0; i <= Math.min(y, rs.length - 1); i++)
						prev = f(rs[i], prev);
					if (rs[y] && ovrFn(rs[y]) >= 38)
						rows.push({ pos: prev, ovr: ovrFn(rs[y]) });
				}
				rows.sort((a, b) => b.ovr - a.ovr);
				const nTeams = Math.floor(rows.length / 13);
				const teams = Array.from({ length: nTeams }, () => []);
				rows.slice(0, nTeams * 13).forEach((r, i) => {
					const k = i % (2 * nTeams);
					teams[k < nTeams ? k : 2 * nTeams - 1 - k].push(r.pos);
				});
				for (const t of teams) per.push(t);
			}
			const G = ["PG", "G"],
				B = ["FC", "C"];
			const noG = per.filter((t) => !t.some((p) => G.includes(p))).length;
			const noB = per.filter((t) => !t.some((p) => B.includes(p))).length;
			const avg = (set) =>
				(
					per.reduce((a, t) => a + t.filter((p) => set.includes(p)).length, 0) /
					per.length
				).toFixed(2);
			return `teams ${per.length}: avg PG/G ${avg(G)}, wings SG/GF/SF ${avg(["SG", "GF", "SF"])}, F/PF ${avg(["F", "PF"])}, FC/C ${avg(B)}; no PG/G ${noG}, no FC/C ${noB}`;
		};
		out.push(`balance old: ${balance((r) => positionOf(r))}`);
		out.push(
			`balance new: ${balance((r, prev) => improvedPosition(positionAxes(r), prev))}`,
		);
		// Agreement with archetypes: forbidden (hard-blocked) and odd pairings
		const SOFT = {
			guard: ["SF"],
			wing: ["FC", "C", "PG"],
			forward: ["SG"],
			big: ["SF"],
		};
		const pairings = (f) => {
			let hard = 0,
				soft = 0;
			const sub = all.filter((_, i) => i % 3 === 0);
			for (const r of sub) {
				const ps = f(r);
				const c = classify(r, { pos: ps });
				if (!archetypeAllows(c, ps)) hard++;
				if (SOFT[c.group].includes(ps)) soft++;
			}
			return `forbidden ${hard}/${sub.length}, odd ${((100 * soft) / sub.length).toFixed(2)}%`;
		};
		out.push(
			`archetypes old: ${pairings((r) => positionOf(r))} | new: ${pairings((r) => improvedPosition(positionAxes(r)))}`,
		);
		Math.random = realRandom;
		mkdirSync("/tmp/claude-0", { recursive: true });
		writeFileSync("/tmp/claude-0/position-fit.txt", out.join("\n") + "\n");
	},
	1_800_000,
);
