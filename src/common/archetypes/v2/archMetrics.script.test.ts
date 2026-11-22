// @ts-nocheck
/* eslint-disable no-undef */
// archcov: the label metrics the user tracks, on one of his leagues (BBGM player JSON exports in a directory), every
// player on a roster or in free agency read fresh (no last-season label), as after a new reading version:
// - name frequency: distinct names, the top-10 share, every name held by more than 3% of the league
// - robustness: every rating (base, expanded, non-zero sub-ratings; not height) moved by a random -2..+2, three draws:
//   how many labels change, read fresh and read with his own label as last season's (the game's year to year reading)
// - fit: the share of his three biggest strengths his label names (the reason stored with it), on average
// - athletic-led names, High-Flyer names, the bigs' names
//   RUN_ARCH_METRICS=<dir> npx vitest --run --project basketball src/common/archetypes/v2/archMetrics.script.test.ts
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { classifyV2 } from "./engine.ts";
import { defaultNormsFor } from "../classify.ts";
import { RATING_KEYS } from "../../ratingsBuilds/solver.ts";
import { EXPANDED_RATINGS2 } from "../../expandedRatings.ts";
import { isValidSubArray } from "../../subRatings.ts";
import { ratingQuantiles } from "./gateScale.ts";
import * as N from "./nouns.ts";
import * as C from "./cover.ts";

(globalThis as any).__coverDebug = (C as any).setCoverDebug;
import {
	completeTraitSeeds,
	proSeasonsPlayed,
	traitScores,
	TRAIT_DEFINITIONS,
} from "../../playerTraits/index.ts";

const DIR = process.env.RUN_ARCH_METRICS;

const ratingsOf = (row: any) => {
	const out: any = {};
	for (const k of RATING_KEYS) {
		out[k] = row[k];
	}
	if (typeof row.pdef === "number" && typeof row.idef === "number") {
		out.wng = row.wng;
		out.pdef = row.pdef;
		out.idef = row.idef;
		for (const k of EXPANDED_RATINGS2) {
			out[k] = row[k];
		}
	}
	if (isValidSubArray(row.sub)) {
		out.sub = row.sub;
	}
	return out;
};
// (a fixed random draw)
const rng = (seed: number) => {
	let s = seed >>> 0;
	return () => {
		s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
		s ^= s >>> 13;
		return (s >>> 0) / 4294967296;
	};
};
const clamp = (v: number) => Math.max(0, Math.min(100, v));
const noisy = (r: any, rand: () => number) => {
	const d = () => Math.floor(rand() * 5) - 2;
	const out = { ...r };
	for (const k of Object.keys(r)) {
		if (typeof r[k] === "number" && k !== "hgt" && k !== "wng") {
			out[k] = clamp(r[k] + d());
		}
	}
	if (Array.isArray(r.sub)) {
		out.sub = r.sub.map((v: number) => (v > 0 ? clamp(v + d()) : v));
	}
	return out;
};
const ATHW =
	/^(Speedy|High-Flying|Physical|Twitchy|Quick-Footed|Bouncy|Highlight-Reel|Open-Lane|Raw Athlete|All Legs|Big Body|Wing-Running|Track Star|Bulldozer|Bruiser|Pogo)|\bBruiser$/;

test.skipIf(!DIR)(
	"label metrics on a league",
	() => {
		const players: any[] = [];
		for (const f of readdirSync(DIR)) {
			if (f.endsWith(".json")) {
				players.push(
					...JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")).players,
				);
			}
		}
		const season = Math.max(...players.map((p) => p.ratings.at(-1).season));
		const startingSeason = Math.min(
			...players.flatMap((p) => (p.stats ?? []).map((s: any) => s.season)),
		);
		const pool = players
			.filter((p) => p.tid >= -1)
			.map((p) => {
				const row = p.ratings.at(-1);
				const age = season - p.born.year;
				const sc = traitScores(row, completeTraitSeeds(p.traits, 0, p.pid), {
					age,
					experience: Math.max(0, season - (p.draft?.year ?? season)),
					proSeasons: proSeasonsPlayed({ p, season, startingSeason }),
				});
				const traits = Object.fromEntries(
					Object.entries(sc).filter(([k]) => k in TRAIT_DEFINITIONS),
				);
				return {
					ratings: ratingsOf(row),
					ovr: row.ovr,
					pot: row.pot,
					pos: row.pos,
					age,
					traits,
				};
			});
		const nq = ratingQuantiles(pool);
		const ng = (N as any).nounGroupQuantiles?.(pool);
		const read = (x: any, r = x.ratings, prev?: any) =>
			classifyV2(r, {
				norms: { ...defaultNormsFor(r), nq, ...(ng ? { ng } : {}) },
				pos: x.pos,
				ovr: x.ovr,
				pot: x.pot,
				age: x.age,
				traits: x.traits,
				...(prev
					? {
							previousId: prev.id,
							...(prev.defense ? { previousDefense: prev.defense } : {}),
						}
					: {}),
			});
		const base = pool.map((x) => read(x));
		const n = pool.length;
		const pc = (a: number, b = n) =>
			`${((100 * a) / Math.max(1, b)).toFixed(1)}%`;
		const mains = base.map((c) => c.label.split(" · ")[0]);
		const freq: Record<string, number> = {};
		for (const m of mains) {
			freq[m] = (freq[m] ?? 0) + 1;
		}
		const top = Object.entries(freq).sort((a, b) => b[1] - a[1]);
		const over3 = top.filter(([, k]) => k / n > 0.03);
		const bigs = pool
			.map((x, i) => ({ x, m: mains[i] }))
			.filter((y) => ["PF", "FC", "C"].includes(y.x.pos));
		const bigNames = new Set(bigs.map((y) => y.m));
		const fits = base
			.map((c) => c.reason?.fit)
			.filter((f) => typeof f === "number");
		// Robustness
		let changed = 0;
		let changedMain = 0;
		let changedSticky = 0;
		let steps = 0;
		for (let draw = 0; draw < 3; draw++) {
			pool.forEach((x, i) => {
				const rand = rng(1000 * draw + i + 1);
				const r2 = noisy(x.ratings, rand);
				const a = read(x, r2);
				const who =
					draw === 0 &&
					(process.env.ARCH_METRICS_WHO ?? "")
						.split(",")
						.includes(base[i].label);
				if (who) {
					(globalThis as any).__coverDebug?.((cs: any[], sc: any[]) => {
						console.log(
							`   [${sc.map((q) => `${q.key} ${Math.round(100 * q.pct)}`).join(" ")}]\n${[
								...cs,
							]
								.sort((p, q) => q.score - p.score)
								.slice(0, 6)
								.map(
									(c) =>
										`     ${c.score.toFixed(2)} ${c.pick.name ?? `${c.pick.role}:${c.pick.descs}`} ${c.pick.defense ?? ""} [${c.main}]`,
								)
								.join("\n")}`,
						);
					});
				}
				const b = read(x, r2, base[i]);
				if (who) {
					(globalThis as any).__coverDebug?.(undefined);
					console.log(`  WHO ${base[i].label} -> ${b.label}`);
				}
				steps++;
				changed += a.label !== base[i].label ? 1 : 0;
				changedMain +=
					a.label.split(" · ")[0] !== base[i].label.split(" · ")[0] ? 1 : 0;
				changedSticky += b.label !== base[i].label ? 1 : 0;
				if (
					process.env.ARCH_METRICS_DUMP &&
					b.label !== base[i].label &&
					draw === 0
				) {
					console.log(`  ${x.pos} ${x.ovr}: ${base[i].label} -> ${b.label}`);
				}
			});
		}
		console.log(
			[
				`players ${n}: distinct main names ${top.length}, top-10 share ${pc(top.slice(0, 10).reduce((s, [, k]) => s + k, 0))}`,
				`names held by more than 3%: ${over3.map(([k, v]) => `${k} ${pc(v)}`).join(", ") || "none"}`,
				`athletic-led ${pc(mains.filter((m) => ATHW.test(m)).length)}, High-Flyer ${pc(mains.filter((m) => /High-Flying|Flyer|Highlight/.test(m)).length)}; bigs ${bigs.length}: ${bigNames.size} distinct names`,
				`robustness (ratings -2..+2, 3 draws, ${steps} reads): label changed fresh ${pc(changed, steps)} (main ${pc(changedMain, steps)}), with last season's label ${pc(changedSticky, steps)}`,
				fits.length > 0
					? `fit: his three biggest strengths named, on average ${pc(
							fits.reduce((s, f) => s + f, 0),
							fits.length,
						)} (all three: ${pc(fits.filter((f) => f >= 0.999).length, fits.length)})`
					: "fit: (no reasons stored)",
			].join("\n"),
		);
	},
	1_200_000,
);
