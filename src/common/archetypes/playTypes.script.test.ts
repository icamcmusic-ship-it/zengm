/* eslint-disable no-undef, curly */
// @ts-nocheck
// arch15: the play-type check (RUN_ARCHETYPE_PLAYTYPES=1, ARCH_PT_DUMP=a league dump from longRun.script.test.ts with
// LONG_RUN_DUMP, ARCH_PT_OUT=report). Reads every player of a simulated league (new-league defaults: Sub-Ratings and
// Advanced Tracking Stats on) as the game does at the preseason, with and without his play types, and reports the league's
// own play-type mix by position (the sim's: post-ups about 3x the NBA's, P&R ball handlers about half, which is why play types
// are read against the league's own mix), how many labels the play types change and to what, and whether the new labels
// keep their names' promises.
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { playTypeProfile, sumAdv } from "../advStats.ts";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import { EXPANDED_RATINGS2 } from "../expandedRatings.ts";
import { archetypeById, classify, defaultNorms } from "./classify.ts";
import { familyOf } from "./families.ts";
import { POS_BUCKET } from "./norms.ts";
import { classValues, prepare, promiseChecks } from "./score.ts";
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
	PT_FEATS,
	playTypesOf,
	ptFeatures,
} from "./subStyle.ts";

test.skipIf(!process.env.RUN_ARCHETYPE_PLAYTYPES)(
	"play types",
	() => {
		const dump = JSON.parse(readFileSync(process.env.ARCH_PT_DUMP, "utf8"));
		// (the preseason after the dumped season: his stats are the seasons before)
		const season = dump.season + 1;
		const players = dump.players.map((p) => {
			const row = p.ratings.at(-1);
			const r = {};
			for (const k of RATING_KEYS) r[k] = row[k];
			const expanded = typeof row.wng === "number";
			if (expanded) {
				r.wng = row.wng;
				r.pdef = row.pdef;
				r.idef = row.idef;
				for (const k of EXPANDED_RATINGS2) r[k] = row[k];
			}
			if (Array.isArray(row.sub)) r.sub = row.sub;
			return { p, r, pos: row.pos, expanded };
		});
		const expanded = players.some((x) => x.expanded);
		const norms = { ...defaultNorms(expanded) };
		const sn = buildSubNorms(players.map((x) => x.r));
		if (sn) norms.sub = sn;
		const statRows = [];
		const ptRows = [];
		for (const x of players) {
			const last = x.p.stats.filter((s) => s.season === season - 1);
			const st = seasonStats(last);
			if (st) statRows.push({ stats: st, pos: x.pos });
			const pt = playTypesOf(playTypeProfile(sumAdv(last)));
			if (pt) ptRows.push({ pt, bucket: POS_BUCKET[x.pos] });
		}
		const statNorms = buildStatNorms(statRows);
		const ptNorms = buildPtNorms(ptRows);
		const out = [
			`players ${players.length}, with play types ${ptRows.length}, expanded ${expanded}, sub norms ${sn ? "league" : "default"}`,
			"league play-type mix (mean share of a player's possessions, 150+ possessions) by position bucket:",
		];
		for (const [b, t] of Object.entries(ptNorms))
			out.push(
				`  ${b}: ${PT_FEATS.map((f) => `${f} ${(100 * t.mean[f]).toFixed(1)}% (PPP ${t.ppp[f].toFixed(2)})`).join(", ")}`,
			);
		let n = 0;
		let changed = 0;
		let famChanged = 0;
		let keptBefore = 0;
		let keptAfter = 0;
		let promN = 0;
		const moves = {};
		const ex = [];
		for (const x of players) {
			const rows = x.p.stats;
			const st = statReading(
				multiSeasonStats(
					[1, 2, 3].map((k) => rows.filter((s) => s.season === season - k)),
				),
				x.pos,
				statNorms,
			);
			const pt = combinePlayTypes(
				[1, 2, 3].map((k) =>
					playTypesOf(
						playTypeProfile(
							sumAdv(rows.filter((s) => s.season === season - k)),
						),
					),
				),
			);
			if (!pt) continue;
			const ptRead = ptFeatures(pt, ptNorms[POS_BUCKET[x.pos]]);
			if (!ptRead) continue;
			const age = season - x.p.born.year;
			const base = { norms, pos: x.pos, age, stats: st };
			const a = classify(x.r, base);
			const b = classify(x.r, { ...base, pt: ptRead });
			n++;
			const cv = classValues(prepare(x.r, norms, { ...base, pt: ptRead }));
			const ok = (id) =>
				Object.values(promiseChecks(archetypeById(id), cv)).every(Boolean);
			promN++;
			if (ok(a.id)) keptBefore++;
			if (ok(b.id)) keptAfter++;
			if (a.id !== b.id) {
				changed++;
				const fa = familyOf(archetypeById(a.id));
				const fb = familyOf(archetypeById(b.id));
				if (fa !== fb) famChanged++;
				const k = `${fa} -> ${fb}`;
				moves[k] = (moves[k] ?? 0) + 1;
				if (ex.length < 60) {
					const top = Object.entries(ptRead.f)
						.filter(([, v]) => Math.abs(v) >= 1)
						.sort((u, v) => Math.abs(v[1]) - Math.abs(u[1]))
						.slice(0, 4)
						.map(([k2, v]) => `${k2} ${v.toFixed(1)}`)
						.join(", ");
					ex.push(
						`${x.p.name} (${x.pos}, ovr ${x.p.ratings.at(-1).ovr}, ${Math.round(pt.poss)} poss, w ${ptRead.w.toFixed(2)}): ${a.name} -> ${b.name} | play types ${top}`,
					);
				}
			}
		}
		const pct = (v, d) => `${((100 * v) / Math.max(1, d)).toFixed(1)}%`;
		out.push(
			`read with play types: ${n}; label changed ${changed} (${pct(changed, n)}), family changed ${famChanged} (${pct(famChanged, n)})`,
			`names keep every promise: without play types ${pct(keptBefore, promN)}, with ${pct(keptAfter, promN)}`,
			`family moves: ${Object.entries(moves)
				.sort((u, v) => v[1] - u[1])
				.slice(0, 12)
				.map(([k, v]) => `${k} ${v}`)
				.join(", ")}`,
			"examples:",
			...ex.map((l) => `  ${l}`),
		);
		writeFileSync(
			process.env.ARCH_PT_OUT ?? "/tmp/arch-pt.txt",
			out.join("\n") + "\n",
		);
	},
	600000,
);
