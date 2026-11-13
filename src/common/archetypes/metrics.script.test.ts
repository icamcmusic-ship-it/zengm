/* eslint-disable no-undef, curly, unicorn/prefer-single-call */
// @ts-nocheck
// The archetype engine's tuning metrics (RUN_ARCHETYPE_METRICS=1, written to ARCH_METRICS_OUT): the gold set's hit rate
// (gold.data.ts), year-to-year churn (with stickiness and age, as the game stores labels), share spread (max share, entropy)
// and poor fit per population, prospects' max share, and how stable a label is when every rating but height moves by 3 or
// 6 (builds should mostly ignore overall). ARCH_EXPANDED=1: the same with the Expanded Ratings setting on.
// ARCH_SPOT=file: the human spot-check (top 50 by overall in a random league and in the real 2025 ratings).
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL } from "../budgetLevels.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import { resetG } from "../../test/helpers.ts";
import develop from "../../worker/core/player/develop.ts";
import generate from "../../worker/core/player/generate.ts";
import ovrFn from "../../worker/core/player/ovr.ts";
import { EXPANDED_RATINGS2, fillExpandedRatings } from "../expandedRatings.ts";
import { g } from "../../worker/util/index.ts";
import {
	ARCHETYPES,
	archetypeById,
	classify,
	defaultNorms,
	isPoorFit,
	scoreAll,
} from "./classify.ts";
import { GOLD } from "./gold.data.ts";
import { mergedId } from "./merges.data.ts";
import { positionFor } from "./position.ts";
import { promisesOf } from "./score.ts";
import {
	realNorms,
	realPlayer as realPlayerOf,
	SUBS_ON,
} from "./real.testutil.ts";
import { ensureSubs } from "../../worker/core/player/subRatings.ts";

const EXPANDED = Boolean(process.env.ARCH_EXPANDED);
const NORMS = defaultNorms(EXPANDED);
const OUT = process.env.ARCH_METRICS_OUT ?? "/tmp/claude-0/arch-metrics.txt";

const newG = () => {
	resetG();
	// Generated as in a new league (Improved Positions on: the scorer guard type); ARCH_STOCK_GEN=1: BBGM's player types
	if (!process.env.ARCH_STOCK_GEN)
		g.setWithoutSavingToDB("improvedPositions", true);
	if (EXPANDED) g.setWithoutSavingToDB("expandedRatings", true);
	// arch15: with Sub-Ratings on (the new-league default) unless ARCH_NO_SUBS=1
	if (SUBS_ON) g.setWithoutSavingToDB("subRatings", true);
};
const ratingsOfRow = (row) => {
	const r = {};
	for (const k of RATING_KEYS) r[k] = row[k];
	if (EXPANDED && typeof row.wng === "number") {
		r.wng = row.wng;
		r.pdef = row.pdef;
		r.idef = row.idef;
		for (const k of EXPANDED_RATINGS2) r[k] = row[k];
	}
	if (SUBS_ON && Array.isArray(row.sub)) r.sub = row.sub;
	return r;
};
const seeded = async (seed, f) => {
	const r = new Rng(`${seed}-random`);
	const orig = Math.random;
	Math.random = () => r.random();
	try {
		return await f();
	} finally {
		Math.random = orig;
	}
};
const genPlayers = (n, seed, minAge, maxAge, minOvr) =>
	seeded(seed, async () => {
		newG();
		const rng = new Rng(seed);
		const out = [];
		while (out.length < n) {
			const k = rng.int(minAge - 19, maxAge - 19);
			const p = generate(-1, 19, 2025 - k, false, DEFAULT_LEVEL);
			if (k > 0) await develop(p, k, true);
			else if (SUBS_ON) ensureSubs(p);
			const row = p.ratings.at(-1);
			const o = ovrFn(row);
			if (o < minOvr) continue;
			out.push({ ratings: ratingsOfRow(row), ovr: o, age: 19 + k });
		}
		return out;
	});

const pct = (x, n) => ((100 * x) / Math.max(1, n)).toFixed(1);

const REAL_NORMS = realNorms(NORMS, EXPANDED);
const read = (p) => ({
	pos: p.pos ?? positionFor(p.ratings, true),
	age: p.age,
	stats: p.stats,
	prospect: p.prospect,
	// (real players' sub-ratings are read against each other, as a real-players league reads them)
	norms: p.slug ? REAL_NORMS : NORMS,
});

const population = (label, players, out) => {
	const counts = {};
	const poorBy = {};
	let poor = 0;
	for (const p of players) {
		const c = classify(p.ratings, read(p));
		p.c = c;
		counts[c.id] = (counts[c.id] ?? 0) + 1;
		if (isPoorFit(c)) {
			poor++;
			poorBy[c.id] = (poorBy[c.id] ?? 0) + 1;
		}
	}
	const n = players.length;
	const shares = Object.entries(counts).sort((x, y) => y[1] - x[1]);
	let h = 0;
	for (const [, k] of shares) h -= (k / n) * Math.log(k / n);
	out.push(
		`${label} (n=${n}): poor fit ${pct(poor, n)}%, max share ${shares[0][0]} ${pct(shares[0][1], n)}%, entropy ${h.toFixed(2)} (effective builds ${Math.exp(h).toFixed(0)}), used ${shares.length}; top: ${shares
			.slice(0, 5)
			.map(([id, k]) => `${id} ${pct(k, n)}`)
			.join(", ")}; poor fit by build: ${Object.entries(poorBy)
			.sort((x, y) => y[1] - x[1])
			.slice(0, 5)
			.map(([id, k]) => `${id} ${k}`)
			.join(", ")}`,
	);
	return { poor: poor / n, max: shares[0][1] / n, h };
};

const realData = () => {
	const d = JSON.parse(
		readFileSync(
			new URL(
				"../../../data/real-player-data.basketball.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	const st = JSON.parse(
		readFileSync(
			new URL(
				"../../../data/real-player-stats.basketball.json",
				import.meta.url,
			),
			"utf8",
		),
	);
	if (EXPANDED) {
		const bySlug = {};
		for (const row of d.ratings) (bySlug[row.slug] ??= []).push(row);
		for (const [slug, rows] of Object.entries(bySlug)) {
			rows.sort((x, y) => x.season - y.season);
			fillExpandedRatings({ srID: slug, ratings: rows });
		}
	}
	return { d, st };
};

// A real player as a real-players league reads him at the preseason: that season's ratings, the previous season's stats
const realPlayer = (d, st, row) => realPlayerOf({ d, st }, row, ratingsOfRow);

const specOk = (a, spec) =>
	spec.split("|").some((alt) =>
		alt.split("+").every((t) => {
			const pr = promisesOf(a);
			return t.startsWith("L:")
				? pr.lead.includes(t.slice(2))
				: pr.all.includes(t);
		}),
	);

test.skipIf(!process.env.RUN_ARCHETYPE_METRICS)(
	"metrics",
	async () => {
		const out = [
			`archetypes ${ARCHETYPES.length}, expanded ratings ${EXPANDED ? "ON" : "off"}`,
		];
		const { d, st } = realData();
		// Gold set
		let hit = 0;
		let specHit = 0;
		const miss = [];
		// Role fits that are not among his listed builds (candidates for the list)
		const unlisted = [];
		for (const [slug, season, ok, spec] of GOLD) {
			const row = d.ratings.find((x) => x.slug === slug && x.season === season);
			const p = realPlayer(d, st, row);
			const c = classify(p.ratings, read(p));
			if (ok.map(mergedId).includes(c.id)) hit++;
			else if (specOk(archetypeById(c.id), spec))
				unlisted.push(
					`${p.name} ${p.pos} -> ${c.name} [${c.id}] (listed: ${ok.join(", ")})`,
				);
			if (specOk(archetypeById(c.id), spec)) specHit++;
			else
				miss.push(
					`${p.name} ${p.pos} -> ${c.name} (want ${spec}: ${ok.join(", ")})`,
				);
		}
		out.push(
			`gold set: ${pct(hit, GOLD.length)}% get a listed build, ${pct(specHit, GOLD.length)}% a build that fits the role (n=${GOLD.length})`,
		);
		if (process.env.ARCH_GOLD_ONLY) {
			out.push("gold misses:\n  " + miss.join("\n  "));
			out.push("role fits not listed:\n  " + unlisted.join("\n  "));
			writeFileSync(OUT, out.join("\n") + "\n");
			return;
		}
		// Populations
		const league = await genPlayers(3000, "metrics-league", 19, 32, 38);
		const vets = await genPlayers(1000, "metrics-vets", 32, 37, 38);
		const pros = (await genPlayers(1000, "metrics-pros", 19, 19, 40)).map(
			(p) => ({ ...p, prospect: true, age: undefined }),
		);
		const real = d.ratings
			.filter((r) => r.season >= 2016 && r.season <= 2025)
			.map((r) => realPlayer(d, st, r));
		const m = {
			league: population("random league (19-32, ovr>=38)", league, out),
			vets: population("veterans (32-37)", vets, out),
			pros: population("draft prospects, draftable (ovr>=40)", pros, out),
			real: population("real NBA 2016-2025 (with stats)", real, out),
		};
		// Concentration among the real 2025 stars: the top 150 by overall
		{
			const top = real
				.filter((p) => p.season === 2025)
				.sort((a, b) => b.ovr - a.ovr)
				.slice(0, 150);
			const counts = {};
			for (const p of top) {
				const id = classify(p.ratings, read(p)).id;
				counts[id] = (counts[id] ?? 0) + 1;
			}
			const [id, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
			out.push(`real 2025 top 150: max share ${id} ${pct(n, top.length)}%`);
		}
		// Perturbation: every rating but height moves by d (the same players, read again)
		for (const dd of [3, 6]) {
			let same = 0;
			let n = 0;
			for (const p of league.slice(0, 1500)) {
				for (const s of [-dd, dd]) {
					const r = { ...p.ratings };
					for (const k of RATING_KEYS)
						if (k !== "hgt") r[k] = Math.max(0, Math.min(100, r[k] + s));
					// (the sub-ratings move with their bases)
					if (r.sub)
						r.sub = r.sub.map((x) => Math.max(0, Math.min(100, x + s)));
					const c = classify(r, read(p));
					n++;
					if (c.id === p.c.id) same++;
				}
			}
			out.push(
				`perturbation +-${dd} on every rating but height: same build ${pct(same, n)}%`,
			);
		}
		// Churn: the same players season after season, sticky labels and positions, aging read
		let changes = 0;
		let steps = 0;
		await seeded("metrics-flap", async () => {
			newG();
			const rng2 = new Rng("metrics-flap");
			for (let i = 0; i < 6000; i++) {
				const age0 = 19;
				const p = generate(-1, 19, 2025 - rng2.int(0, 6), false, DEFAULT_LEVEL);
				const dev = rng2.int(0, 10);
				await develop(p, dev, true);
				let prev;
				let prevPos;
				let prevR;
				for (let y = 0; y < 5; y++) {
					await develop(p, 1, false);
					const row = p.ratings.at(-1);
					if (ovrFn(row) < 38) continue;
					const r = ratingsOfRow(row);
					prevPos = positionFor(r, true, prevPos, { previousRatings: prevR });
					prevR = r;
					const c = classify(r, {
						norms: NORMS,
						previousId: prev?.id,
						pos: prevPos,
						age: age0 + dev + y + 1,
					});
					if (prev) {
						steps++;
						if (prev.id !== c.id) changes++;
					}
					prev = c;
				}
			}
		});
		out.push(
			`churn: ${pct(changes, steps)}% of seasons change build (${steps} player-seasons)`,
		);
		out.push(
			`summary: gold ${pct(hit, GOLD.length)}% (role ${pct(specHit, GOLD.length)}%), churn ${pct(changes, steps)}%, max share league ${pct(m.league.max, 1)}% / real ${pct(m.real.max, 1)}% / prospects ${pct(m.pros.max, 1)}%, poor fit league ${pct(m.league.poor, 1)}% / vets ${pct(m.vets.poor, 1)}% / prospects ${pct(m.pros.poor, 1)}% / real ${pct(m.real.poor, 1)}%`,
		);
		out.push("gold misses:\n  " + miss.join("\n  "));
		// The pinned stars
		const pins = GOLD.slice(0, 20).map(([slug, season]) => {
			const p = realPlayer(
				d,
				st,
				d.ratings.find((x) => x.slug === slug && x.season === season),
			);
			const c = classify(p.ratings, read(p));
			return `${p.name} ${p.pos}: ${c.name} [${c.alternates.map((a) => a.name).join(", ")}] fit ${c.fit} sim ${c.score}`;
		});
		out.push("pinned stars:\n  " + pins.join("\n  "));
		writeFileSync(OUT, out.join("\n") + "\n");
		if (process.env.ARCH_SPOT) {
			const spot = [];
			const top = (label, ps, n = 50) => {
				spot.push(
					`=== ${label}: top ${n} by overall (build; runners-up; similarity, fit z)`,
				);
				for (const p of [...ps].sort((x, y) => y.ovr - x.ovr).slice(0, n)) {
					const r = read(p);
					const c = classify(p.ratings, r);
					const sc = scoreAll(
						p.ratings,
						r.norms,
						ARCHETYPES,
						r.pos,
						undefined,
						r,
					).scored;
					spot.push(
						`${p.name ?? "generated"} (${r.pos}, ovr ${p.ovr}, age ${p.age ?? "?"}${p.stats ? `, stats ${Math.round(p.stats.w * 100)}%` : ""}): ${c.name}${isPoorFit(c) ? " [poor fit]" : ""} -- runners-up: ${sc
							.slice(1, 4)
							.map((s) => `${s.a.name} (${s.z.toFixed(2)})`)
							.join(", ")} -- similarity ${c.score}, fit ${c.fit}`,
					);
				}
				spot.push("");
			};
			top("random league", league);
			top(
				"real 2025 ratings",
				d.ratings
					.filter((r) => r.season === 2025)
					.map((r) => realPlayer(d, st, r)),
				75,
			);
			writeFileSync(process.env.ARCH_SPOT, spot.join("\n") + "\n");
		}
	},
	1800000,
);
