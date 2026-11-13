/* eslint-disable no-undef, curly */
// @ts-nocheck
// arch14: the name-promise report (RUN_ARCHETYPE_PROMISES=1, ARCH_PROMISES_OUT=file, ARCH_EXPANDED=1 for expanded ratings).
// For every build, the share of its holders (a random league of 3,000, the real NBA 2016-2025 with stats, 1,000 draft
// prospects) who keep each promise in its name (score.ts promiseChecks: every promised skill at least ordinary for him on
// the blended scale, an elite three for a sniper's name). The target is 90% per build and promise; builds held by fewer
// than 10 players are listed apart. archetypes.test.ts holds a floor on a generated league.
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import { EXPANDED_RATINGS2, fillExpandedRatings } from "../expandedRatings.ts";
import { ARCHETYPES, classify, defaultNorms, scoreAll } from "./classify.ts";
import { positionFor } from "./position.ts";
import { realData, realPlayer } from "./real.testutil.ts";
import { sampleLeague } from "./sample.testutil.ts";
import { promiseChecks } from "./score.ts";

const EXPANDED = Boolean(process.env.ARCH_EXPANDED);
const NORMS = defaultNorms(EXPANDED);
export const TARGET = 0.9;

export const promiseReport = (players) => {
	const by = {};
	for (const p of players) {
		const read = { age: p.age, stats: p.stats, prospect: p.prospect };
		const c = classify(p.ratings, { norms: NORMS, pos: p.pos, ...read });
		const { cv } = scoreAll(
			p.ratings,
			NORMS,
			ARCHETYPES,
			p.pos,
			undefined,
			read,
		);
		const a = ARCHETYPES.find((x) => x.id === c.id);
		const b = (by[a.id] ??= { a, n: 0, met: {} });
		b.n++;
		for (const [k, ok] of Object.entries(promiseChecks(a, cv))) {
			b.met[k] = (b.met[k] ?? 0) + (ok ? 1 : 0);
		}
	}
	return Object.values(by).map((b) => {
		const shares = Object.fromEntries(
			Object.entries(b.met).map(([k, m]) => [k, m / b.n]),
		);
		const min = Math.min(1, ...Object.values(shares));
		return { id: b.a.id, name: b.a.name, n: b.n, shares, min };
	});
};

test.skipIf(!process.env.RUN_ARCHETYPE_PROMISES)(
	"name promises",
	async () => {
		const league = (
			await sampleLeague(3000, "metrics-league-promises", 13, 38, EXPANDED)
		).map((p) => ({
			...p,
			pos: positionFor(p.ratings, true),
		}));
		const pros = (
			await sampleLeague(1000, "metrics-pros-promises", 0, 40, EXPANDED)
		).map((p) => ({
			...p,
			age: undefined,
			prospect: true,
			pos: positionFor(p.ratings, true),
		}));
		const data = realData();
		if (EXPANDED) {
			const bySlug = {};
			for (const row of data.d.ratings) (bySlug[row.slug] ??= []).push(row);
			for (const [slug, rows] of Object.entries(bySlug)) {
				rows.sort((x, y) => x.season - y.season);
				fillExpandedRatings({ srID: slug, ratings: rows });
			}
		}
		const rOf = (row) => {
			const r = {};
			for (const k of RATING_KEYS) r[k] = row[k];
			if (EXPANDED && typeof row.wng === "number") {
				r.wng = row.wng;
				r.pdef = row.pdef;
				r.idef = row.idef;
				for (const k of EXPANDED_RATINGS2) r[k] = row[k];
			}
			return r;
		};
		const real = data.d.ratings
			.filter((r) => r.season >= 2016 && r.season <= 2025)
			.map((r) => realPlayer(data, r, rOf));
		const rep = promiseReport([...league, ...real, ...pros]);
		const big = rep.filter((r) => r.n >= 10).sort((a, b) => a.min - b.min);
		const below = big.filter((r) => r.min < TARGET);
		const holders = rep.reduce((t, r) => t + r.n, 0);
		const keptAll = rep.reduce((t, r) => t + r.n * r.min, 0);
		const out = [
			`name promises (expanded ratings ${EXPANDED ? "ON" : "off"}): ${big.length} builds with 10+ holders, ${big.length - below.length} keep every promise for ${TARGET * 100}%+ of their holders; ${below.length} below; holders weighted by their build's worst promise: ${((100 * keptAll) / holders).toFixed(1)}%`,
			"below the target (build, holders, share per promise):",
			...below.map(
				(r) =>
					`  ${r.name} (${r.n}): ${Object.entries(r.shares)
						.map(([k, v]) => `${k} ${(100 * v).toFixed(0)}%`)
						.join(", ")}`,
			),
			"all builds with 10+ holders:",
			...big.map(
				(r) =>
					`  ${r.name} (${r.n}): ${Object.entries(r.shares)
						.map(([k, v]) => `${k} ${(100 * v).toFixed(0)}%`)
						.join(", ")}`,
			),
			`fewer than 10 holders: ${rep
				.filter((r) => r.n < 10)
				.map((r) => `${r.name} (${r.n}, worst ${(100 * r.min).toFixed(0)}%)`)
				.join(", ")}`,
		];
		writeFileSync(
			process.env.ARCH_PROMISES_OUT ?? "/tmp/claude-0/arch-promises.txt",
			out.join("\n") + "\n",
		);
	},
	1800000,
);
