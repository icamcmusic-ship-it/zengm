/* eslint-disable no-undef, curly */
// @ts-nocheck
// archv3: the archgaps gap dump (claude/native-archgaps gapsCluster.script.test.ts) on the v2 reading: every player's
// v2 label (and whether its family voters agreed, whether it is composed) with the reading features, for clustering
// offline (scratchpad archgaps cluster.py) (RUN_ARCHETYPE_GAPDUMP=1, ARCH_GAPDUMP_OUT=file.jsonl, ARCH_GAPDUMP_DUMPS=comma list of longRun LONG_RUN_ARCH_DUMP
// files). Populations: generated leagues (three seeds, veterans), draft prospects (generated, and the real draft classes),
// simulated leagues from longRun dumps (with play types), real NBA players (the 2026-27 preseason with 2025-26 stats) and
// every real player's peak season. One JSON line per player: his reading (blended class values, blended dimensions,
// sub-rating leans, play types), his label and its fit / confidence / margin / shortfall, the next builds, the rulebook's
// verdict and, for the nearest builds, which words' bars he misses. The user's 2K label where his list has him.
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { DEFAULT_LEVEL } from "../../budgetLevels.ts";
import { Rng } from "../../ratingsBuilds/rng.ts";
import { RATING_KEYS } from "../../ratingsBuilds/solver.ts";
import { resetG } from "../../../test/helpers.ts";
import develop from "../../../worker/core/player/develop.ts";
import generate from "../../../worker/core/player/generate.ts";
import ovrFn from "../../../worker/core/player/ovr.ts";
import { ensureSubs } from "../../../worker/core/player/subRatings.ts";
import { g } from "../../../worker/util/index.ts";
import {
	ARCHETYPES,
	archetypeById,
	classify,
	defaultNorms,
	isPoorFit,
	scoreAll,
} from "../classify.ts";
import { isGenericBuild } from "../generic.ts";
import { positionFor } from "../position.ts";
import { realData, realNorms, realPlayer } from "../real.testutil.ts";
import {
	barValue,
	buildRules,
	ruleJudge,
	ruleShortfall,
	skillOrder,
} from "../rulebook.ts";
import { WORD_RULES } from "../rulebook.data.ts";
import { classValues, prepare } from "../score.ts";
import { USER_2K } from "../user2k.data.ts";
import { readLeagueDump } from "../userShares.script.test.ts";
import { classifyV2 } from "./engine.ts";

const NORMS = defaultNorms(false);

const gen = async (n, seed, minAge, maxAge, minOvr) => {
	resetG();
	g.setWithoutSavingToDB("improvedPositions", true);
	g.setWithoutSavingToDB("subRatings", true);
	const rr = new Rng(`${seed}-random`);
	const orig = Math.random;
	Math.random = () => rr.random();
	const out = [];
	try {
		const rng = new Rng(seed);
		while (out.length < n) {
			const k = rng.int(minAge - 19, maxAge - 19);
			const p = generate(-1, 19, 2025 - k, false, DEFAULT_LEVEL);
			if (k > 0) await develop(p, k, true);
			else ensureSubs(p);
			const row = p.ratings.at(-1);
			const o = ovrFn(row);
			if (o < minOvr) continue;
			const r = {};
			for (const key of RATING_KEYS) r[key] = row[key];
			if (row.sub) r.sub = row.sub;
			out.push({ ratings: r, ovr: o, age: 19 + k });
		}
	} finally {
		Math.random = orig;
	}
	return out;
};

const r2 = (x) => Math.round(x * 100) / 100;
const round = (o) =>
	o
		? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r2(v)]))
		: undefined;

// Which words of a build he misses, and by how much (z on the blended class scale)
const wordMisses = (a, inp) => {
	const r = buildRules(a);
	const v = (k) => inp.cv[k] ?? 0;
	const out = [];
	for (const w of r.words) {
		for (const k of w.bar.classes) {
			const b = barValue(k, w.bar.support);
			if (b > -Infinity && v(k) < b)
				out.push(`${w.key}:${k}<sup ${r2(b - v(k))}`);
		}
		if (w.head) {
			const m = Math.min(
				...w.bar.classes.map((k) =>
					Math.max(0, barValue(k, w.bar.lead) - v(k)),
				),
			);
			if (m > 0) out.push(`${w.key}:lead ${r2(m)}`);
		}
		if (w.bar.sub && inp.style?.sub)
			for (const [k, min] of Object.entries(w.bar.sub)) {
				const x = inp.style.sub[k] ?? 0;
				if (x < min) out.push(`${w.key}:sub.${k} ${r2(min - x)}`);
			}
	}
	if (r.sniper && v("shoot") < barValue("shoot", WORD_RULES.sniper.bar))
		out.push("sniper:shoot");
	if (r.air && v("ath") < barValue("ath", WORD_RULES.air.bar))
		out.push("air:ath");
	const top = skillOrder(inp.cv).slice(0, 3);
	if (r.headClasses.length && !r.headClasses.some((k) => top.includes(k)))
		out.push(`head-not-top3(${r.headClasses.join("/")})`);
	return out;
};

test.skipIf(!process.env.RUN_ARCHETYPE_GAPDUMP)(
	"gap dump (v2)",
	async () => {
		const u2k = new Map();
		for (const u of USER_2K)
			if (u.slug) u2k.set(`${u.slug}|${u.season}`, u.arch);
		const rows = [];
		const emit = (pop, p, norms, read) => {
			const pos = p.pos ?? positionFor(p.ratings, true);
			const cc = classify(p.ratings, { norms, pos, ovr: p.ovr, ...read });
			const c = classifyV2(p.ratings, {
				norms,
				pos,
				ovr: p.ovr,
				...read,
				...(p.slug ? { srID: p.slug } : {}),
			});
			const composed = c.id.startsWith("v2:");
			const sa = scoreAll(p.ratings, norms, ARCHETYPES, pos, undefined, read);
			const pr = prepare(p.ratings, norms, { ...read, pos });
			const cv = classValues(pr);
			const live = sa.scored.filter((s) => s.z > -50);
			const inp = { cv, style: pr.style };
			const allowed = ARCHETYPES.filter((a) => a.positions.includes(pos));
			const rule = ruleJudge(allowed, inp);
			// (the classes alone: the sub-rating and play-type bars aside)
			const ruleCls = ruleJudge(allowed, { cv });
			const near = live.slice(0, 5).map((s) => ({
				id: s.a.id,
				name: s.a.name,
				z: r2(s.z),
				raw: r2(s.raw),
				short: r2(s.short),
				ca: r2(s.catchAll ?? 0),
				gen: isGenericBuild(s.a) ? 1 : 0,
				rs: r2(ruleShortfall(s.a, inp).short),
				rsc: r2(ruleShortfall(s.a, { cv }).short),
				miss: wordMisses(s.a, inp),
			}));
			const top = live[0];
			const second = live[1];
			rows.push({
				pop,
				name: p.name,
				slug: p.slug,
				season: p.season,
				pos,
				hgt: p.ratings.hgt,
				ovr: p.ovr,
				age: p.age ?? read.age,
				ratings: Object.fromEntries(RATING_KEYS.map((k) => [k, p.ratings[k]])),
				id: c.id,
				label: c.name,
				fit: composed ? cc.fit : c.fit,
				score: c.score,
				short: c.shortfall,
				conf: c.confidence,
				classic: cc.name,
				agreed: c.v2.agreed ? 1 : 0,
				composed: composed ? 1 : 0,
				margin: top && second ? r2(top.z - second.z) : 9,
				poor: !composed && isPoorFit(c) ? 1 : 0,
				gen: isGenericBuild(archetypeById(c.id)) || !!c.fitNote ? 1 : 0,
				genTop: top && isGenericBuild(top.a) ? 1 : 0,
				fitNote: c.fitNote,
				custom: c.custom ? 1 : 0,
				near,
				rule: rule.ids,
				ruleOk: rule.qualified ? 1 : 0,
				ruleCls: ruleCls.ids,
				// every build his position allows whose class bars he meets (the classes alone)
				qual: allowed
					.filter((a) => ruleShortfall(a, { cv }).short <= 1e-9)
					.map((a) => a.id),
				ruleClsOk: ruleCls.qualified ? 1 : 0,
				ruleShortCls: r2(ruleShortfall(archetypeById(c.id), { cv }).short),
				ruleShort: r2(ruleShortfall(archetypeById(c.id), inp).short),
				labelMiss: wordMisses(archetypeById(c.id), inp),
				cv: round(cv),
				b: round(pr.b),
				lvl: r2(pr.pzLevel),
				sub: round(pr.style.sub),
				pt: pr.style.pt
					? { w: r2(pr.style.pt.w), f: round(pr.style.pt.f) }
					: undefined,
				stw: read.stats ? r2(read.stats.w) : undefined,
				u2k: p.slug ? u2k.get(`${p.slug}|${p.season}`) : undefined,
			});
		};

		// (a) generated leagues: three seeds of a league (19-32), and veterans
		for (const seed of ["gapsA", "gapsB", "gapsC"]) {
			for (const p of await gen(1500, `${seed}-league`, 19, 32, 40))
				emit(`gen-${seed}`, p, NORMS, { age: p.age });
		}
		for (const p of await gen(800, "gapsV-vets", 31, 36, 40))
			emit("gen-vets", p, NORMS, { age: p.age });
		// (c) generated draft prospects
		for (const p of await gen(1200, "gapsP-pros", 19, 19, 40))
			emit("gen-prospects", p, NORMS, { prospect: true });
		// simulated leagues (longRun dumps): read as the game reads them, play types included
		for (const file of (process.env.ARCH_GAPDUMP_DUMPS ?? "")
			.split(",")
			.filter(Boolean)) {
			const d = readLeagueDump(file);
			const tag = file.split("/").pop().replace(".json", "");
			for (const x of d.players) {
				if (x.tid < -2) continue;
				emit(
					x.tid === -2 ? `sim-prospects` : `sim-${tag}`,
					{ ratings: x.r, ovr: x.ovr, pos: x.pos, name: x.name },
					d.norms,
					x.read,
				);
			}
		}
		// (b) real players
		const data = realData();
		const rn = realNorms(NORMS, false);
		const bySlug = new Map();
		for (const r of data.d.ratings) {
			if (!bySlug.has(r.slug)) bySlug.set(r.slug, []);
			bySlug.get(r.slug).push(r);
		}
		const current = new Set();
		for (const r of data.d.ratings) {
			if (r.season !== 2027 || r.slug.startsWith("dp_")) continue;
			const p = realPlayer(data, r);
			current.add(r.slug);
			emit("real-2027", p, rn, { age: p.age, stats: p.stats });
		}
		// real draft prospects (the coming classes)
		for (const [slug, rs] of bySlug) {
			if (!slug.startsWith("dp_")) continue;
			const r = rs.at(-1);
			const p = realPlayer(data, r);
			emit("real-prospects", p, rn, { prospect: true });
		}
		// every other real player's peak season (by overall; rotation level and up)
		for (const [slug, rs] of bySlug) {
			if (slug.startsWith("dp_")) continue;
			const cands = rs.filter((r) => r.season <= 2026);
			if (!cands.length) continue;
			let bestRow;
			let bo = -1;
			for (const r of cands) {
				const o = ovrFn(r);
				if (o > bo) {
					bo = o;
					bestRow = r;
				}
			}
			if (bo < 47) continue;
			const best = realPlayer(data, bestRow);
			emit(current.has(slug) ? "real-peak-active" : "real-peak", best, rn, {
				age: best.age,
				stats: best.stats,
			});
		}
		writeFileSync(
			process.env.ARCH_GAPDUMP_OUT ?? "/tmp/arch-gapdump.jsonl",
			rows.map((r) => JSON.stringify(r)).join("\n"),
		);
	},
	3600000,
);
