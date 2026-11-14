/* eslint-disable no-undef, curly */
// @ts-nocheck
/* eslint-disable unicorn/prefer-single-call */
// arch16: build shares where the user sees them (RUN_ARCHETYPE_USERSHARES=1, ARCH_US_OUT=report, ARCH_US_DUMPS=comma list
// of league dumps from longRun.script.test.ts with LONG_RUN_ARCH_DUMP: a new league with the new-league defaults at its first
// preseason, and the same league after three seasons). Each dump is read as the game reads it at the preseason
// (worker/core/player/archetype.ts: the league's own norms, sub-rating and play-type tables, prospects from their scouted
// ratings); the real 2025 ratings as a real-players league reads them. For each population (all players, the top 150 by
// overall, rotation players (a team's top 8), draft prospects): the top 15 builds by share and the share of the generic
// builds (helpers.ts GENERIC_BUILDS). With a dump, how often the reading here matches the stored label (a check on the
// mirror: traits and stickiness are not read here).
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { playTypeProfile, sumAdv } from "../advStats.ts";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import { EXPANDED_RATINGS2 } from "../expandedRatings.ts";
import {
	archetypeById,
	classify,
	defaultNorms,
	isPoorFit,
	SCORING_ARCHETYPES,
} from "./classify.ts";
import { buildNorms } from "./match.ts";
import { POS_BUCKET } from "./norms.ts";
import { DEFAULT_STAT_NORMS } from "./statNorms.data.ts";
import {
	buildStatNorms,
	multiSeasonStats,
	seasonStats,
	statReading,
} from "./stats.ts";
import {
	buildPtNorms,
	buildSubNorms,
	combinePlayTypes,
	playTypesOf,
	ptFeatures,
} from "./subStyle.ts";
import { isGenericBuild } from "./generic.ts";
import { mergedId } from "./merges.data.ts";

const canonicalId = (id) => mergedId(id);
import { realData, realNorms, realPlayer } from "./real.testutil.ts";
import { fuzzSubs } from "../../worker/core/player/subRatings.ts";

const applyFuzz = (x, f) => Math.round(Math.min(100, Math.max(0, x + f)));

const ratingsOf = (p) => {
	const row = p.ratings.at(-1);
	const prospect = p.tid === -2;
	const f = prospect ? (row.fuzz ?? 0) : 0;
	const r = {};
	for (const k of RATING_KEYS)
		r[k] = k === "hgt" ? row[k] : applyFuzz(row[k], f);
	if (typeof row.wng === "number") {
		r.wng = row.wng;
		r.pdef = applyFuzz(row.pdef, f);
		r.idef = applyFuzz(row.idef, f);
		for (const k of EXPANDED_RATINGS2) r[k] = applyFuzz(row[k], f);
	}
	if (Array.isArray(row.sub))
		r.sub = prospect ? fuzzSubs(row.sub, row.fuzz, p) : row.sub;
	return r;
};

export const readLeagueDump = (file) => readDump(file);
const readDump = (file) => {
	const dump = JSON.parse(readFileSync(file, "utf8"));
	const season = dump.season;
	const players = dump.players.map((p) => {
		const row = p.ratings.at(-1);
		return {
			p,
			r: ratingsOf(p),
			pos: row.pos,
			ovr: row.ovr,
			tid: p.tid,
			name: p.name,
		};
	});
	const league = players.filter((x) => x.tid >= -1);
	const expanded = league.some((x) => typeof x.r.wng === "number");
	const reference = defaultNorms(expanded);
	const norms = {
		...buildNorms(
			league.map((x) => ({
				ratings: x.r,
				ovr: x.ovr,
				pos: x.pos,
				age: season - x.p.born.year,
			})),
			SCORING_ARCHETYPES,
			reference,
		),
		bias: reference.bias,
		prospect: reference.prospect,
	};
	const sn = buildSubNorms(league.map((x) => x.r));
	if (sn) norms.sub = sn;
	const statRows = [];
	const ptRows = [];
	for (const x of league) {
		const last = x.p.stats.filter((s) => s.season === season - 1);
		const st = seasonStats(last);
		if (st) statRows.push({ stats: st, pos: x.pos });
		const pt = playTypesOf(playTypeProfile(sumAdv(last)));
		if (pt) ptRows.push({ pt, bucket: POS_BUCKET[x.pos] });
	}
	const own = buildStatNorms(statRows);
	const statNorms = {};
	for (const b of ["PG", "SG", "W", "F", "C"]) {
		const n = statRows.filter(
			(r) => r.stats.min >= 500 && POS_BUCKET[r.pos] === b,
		).length;
		statNorms[b] = n >= 30 ? own[b] : DEFAULT_STAT_NORMS[b];
	}
	const ptNorms = buildPtNorms(ptRows);
	let same = 0;
	let stored = 0;
	for (const x of players) {
		if (x.tid === -2) {
			x.read = { prospect: true };
			x.c = classify(x.r, { norms, pos: x.pos, prospect: true });
			continue;
		}
		const rows = x.p.stats;
		const by = (k) => rows.filter((s) => s.season === season - k);
		const pt = combinePlayTypes(
			[1, 2, 3].map((k) => playTypesOf(playTypeProfile(sumAdv(by(k))))),
		);
		const ptRead = pt ? ptFeatures(pt, ptNorms[POS_BUCKET[x.pos]]) : undefined;
		x.read = {
			age: season - x.p.born.year,
			stats: statReading(multiSeasonStats([1, 2, 3].map(by)), x.pos, statNorms),
			...(ptRead ? { pt: ptRead } : {}),
		};
		x.c = classify(x.r, { norms, ovr: x.ovr, pos: x.pos, ...x.read });
		if (x.p.archetype?.id) {
			stored++;
			if (x.p.archetype.id === x.c.id) same++;
		}
	}
	return { season, players, same, stored, norms };
};

const pct = (v, d) => `${((100 * v) / Math.max(1, d)).toFixed(1)}%`;

const report = (out, label, xs) => {
	const n = xs.length;
	const counts = {};
	let gen = 0;
	let poor = 0;
	const genBy = {};
	for (const x of xs) {
		counts[x.c.id] = (counts[x.c.id] ?? 0) + 1;
		if (isPoorFit(x.c)) poor++;
		if (isGenericBuild(archetypeById(x.c.id))) {
			gen++;
			genBy[x.c.id] = (genBy[x.c.id] ?? 0) + 1;
		}
	}
	const top = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	out.push(
		`## ${label} (n=${n}): generic builds ${pct(gen, n)} (${Object.keys(genBy).length} builds), max ${archetypeById(top[0][0]).name} ${pct(top[0][1], n)}, poor fit ${pct(poor, n)}, builds used ${top.length}`,
	);
	out.push(
		"  top 15: " +
			top
				.slice(0, 15)
				.map(
					([id, k]) =>
						`${archetypeById(id).name}${isGenericBuild(archetypeById(id)) ? "*" : ""} ${pct(k, n)}`,
				)
				.join(", "),
	);
	out.push(
		"  generic: " +
			Object.entries(genBy)
				.sort((a, b) => b[1] - a[1])
				.map(([id, k]) => `${archetypeById(id).name} ${pct(k, n)}`)
				.join(", "),
	);
	return {
		label,
		n,
		gen: gen / n,
		max: top[0][1] / n,
		maxGen: Math.max(0, ...Object.values(genBy)) / n,
	};
};

const populations = (out, tag, players) => {
	const league = players.filter((x) => x.tid >= -1);
	const top150 = [...league].sort((a, b) => b.ovr - a.ovr).slice(0, 150);
	const byTeam = {};
	for (const x of league) if (x.tid >= 0) (byTeam[x.tid] ??= []).push(x);
	const rotation = Object.values(byTeam).flatMap((t) =>
		t.sort((a, b) => b.ovr - a.ovr).slice(0, 8),
	);
	const res = [
		report(out, `${tag}: all players`, league),
		report(out, `${tag}: top 150`, top150),
		report(out, `${tag}: rotation (top 8 per team)`, rotation),
	];
	const pros = players.filter((x) => x.tid === -2);
	if (pros.length) res.push(report(out, `${tag}: draft prospects`, pros));
	return res;
};

test.skipIf(!process.env.RUN_ARCHETYPE_USERSHARES)(
	"user-visible shares",
	() => {
		const out = [];
		const summary = [];
		for (const file of (process.env.ARCH_US_DUMPS ?? "")
			.split(",")
			.filter(Boolean)) {
			const d = readDump(file);
			const tag = `random league ${d.season}`;
			out.push(
				`# ${tag} (${file}): reading here = stored label for ${pct(d.same, d.stored)} of ${d.stored}`,
			);
			summary.push(...populations(out, tag, d.players));
			// What the game stored (stickiness and traits included; removed ids read as their kept build)
			const stored = d.players
				.filter((x) => x.tid >= -1 && x.p.archetype?.id)
				.map((x) => ({
					...x,
					c: { id: canonicalId(x.p.archetype.id), score: 1, shortfall: 0 },
				}))
				.filter((x) => archetypeById(x.c.id));
			summary.push(report(out, `${tag}: stored labels`, stored));
			summary.push(
				report(
					out,
					`${tag}: stored labels, top 150`,
					[...stored].sort((a, b) => b.ovr - a.ovr).slice(0, 150),
				),
			);
		}
		const rd = realData();
		const norms = realNorms(defaultNorms(false), false);
		const real = rd.d.ratings
			.filter((r) => r.season === 2025)
			.map((row) => {
				const p = realPlayer(rd, row);
				return {
					...p,
					tid: 0,
					c: classify(p.ratings, {
						norms,
						pos: p.pos,
						age: p.age,
						stats: p.stats,
					}),
				};
			});
		out.push("# real players 2025");
		summary.push(report(out, "real 2025: all players", real));
		const rtop = [...real].sort((a, b) => b.ovr - a.ovr);
		summary.push(report(out, "real 2025: top 150", rtop.slice(0, 150)));
		summary.push(
			report(out, "real 2025: top 240 (rotation)", rtop.slice(0, 240)),
		);
		out.unshift(
			"| population | n | generic share | largest generic build | largest build |",
			"|---|---|---|---|---|",
			...summary.map(
				(s) =>
					`| ${s.label} | ${s.n} | ${pct(s.gen, 1)} | ${pct(s.maxGen, 1)} | ${pct(s.max, 1)} |`,
			),
			"",
		);
		writeFileSync(
			process.env.ARCH_US_OUT ?? "/tmp/arch-us.txt",
			out.join("\n") + "\n",
		);
	},
	1800000,
);
