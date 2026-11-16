/* eslint-disable no-undef, curly */
// @ts-nocheck
// archv2: the v2 engine's data and its before (Classic) / after (v2) report. Not part of the normal run:
// RUN_ARCHETYPE_V2=1 with ARCH_V2_MODE=
// - data: the position-peer percentile tables (peers.data.ts: a random league and the real players 2016-2025, read as the
//   game reads them) and the labeled players' feature table (knn.data.ts: the user's 2K list, the judged key)
// - eval (ARCH_V2_OUT=file): held-out accuracy against the user's 2K list (current and all-time apart) and the judged key
//   (30% test split; the neighbours from the tune split only, never a player's own label), churn, stability under a
//   uniform rating shift, share caps, generic share, poor fit, position conflicts, name promises and the notable players,
//   for both engines. ARCH_V2_PARAMS='{"fK":1,...}' overrides the engine's parameters; ARCH_V2_QUICK=1 only the accuracy.
// - tune: a small grid of the engine's parameters scored on the tune split (leave-one-out), to pick V2_PARAMS
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
import { mergedId } from "../merges.data.ts";
import { POS_BUCKETS } from "../norms.ts";
import { positionFor } from "../position.ts";
import { nameAt } from "../posNames.ts";
import { SIM_SUB_NORMS } from "../judgedSim.data.ts";
import {
	generatedSubs,
	realData,
	realNorms,
	realPlayer,
	SUBS_ON,
} from "../real.testutil.ts";
import { SKILL_CLASS_KEYS } from "../rulebook.ts";
import { promiseMiss } from "../score.ts";
import { judgedPlayers } from "../fit.script.test.ts";
import { userPlayers } from "../twoK/user2k.script.test.ts";
import { canonOf, classifyV2, V2_PARAMS } from "./engine.ts";
import { familyOfName } from "./grammar.ts";
import {
	BUCKET_OF,
	encodeX,
	FEAT_FROM_FAMX,
	metaOf,
	N_FEATS,
	POS_LIST,
} from "./knn.ts";

const MODE = process.env.ARCH_V2_MODE;
const OUT =
	process.env.ARCH_V2_OUT ?? "/tmp/claude-0/archv2-report.txt";
const NORMS = defaultNorms(false);
const REAL_NORMS = realNorms(NORMS, false);
const PARAMS = process.env.ARCH_V2_PARAMS
	? JSON.parse(process.env.ARCH_V2_PARAMS)
	: undefined;

const newG = () => {
	resetG();
	g.setWithoutSavingToDB("improvedPositions", true);
	if (SUBS_ON) g.setWithoutSavingToDB("subRatings", true);
};
const ratingsOfRow = (row) => {
	const r = {};
	for (const k of RATING_KEYS) r[k] = row[k];
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
			const ratings = ratingsOfRow(row);
			out.push({
				ratings,
				ovr: o,
				age: 19 + k,
				pos: positionFor(ratings, true),
				norms: NORMS,
			});
		}
		return out;
	});
const realPop = (lo, hi) => {
	const data = realData();
	return data.d.ratings
		.filter((r) => r.season >= lo && r.season <= hi)
		.map((r) => {
			const p = realPlayer(data, r, ratingsOfRow);
			return { ...p, norms: REAL_NORMS };
		});
};
const readOf = (p) => ({
	norms: p.norms,
	pos: p.pos,
	age: p.age,
	stats: p.stats,
	prospect: p.prospect,
	pt: p.pt,
});

const pct = (x, n) => `${((100 * x) / Math.max(1e-9, n)).toFixed(1)}%`;
const quantiles = (xs, n = 21) => {
	const s = [...xs].sort((a, b) => a - b);
	return Array.from({ length: n }, (_, i) => {
		const t = (i / (n - 1)) * (s.length - 1);
		const lo = Math.floor(t);
		const hi = Math.min(s.length - 1, lo + 1);
		return Math.round((s[lo] + (t - lo) * (s[hi] - s[lo])) * 100) / 100;
	});
};

// The two engines on one player: label id, name, family, the top three (canonical) and the classification
const ENGINES = {
	classic: (p, extra = {}) => {
		const r = readOf(p);
		const c = classify(p.ratings, { ...r, ...extra });
		const sc = scoreAll(
			p.ratings,
			r.norms,
			ARCHETYPES,
			r.pos,
			undefined,
			r,
		).scored;
		const top = [c.id];
		for (const s of sc) {
			if (top.length >= 3) break;
			if (!top.includes(s.a.id)) top.push(s.a.id);
		}
		return { c, id: c.id, name: c.name, top, poor: isPoorFit(c) };
	},
	v2: (p, extra = {}) => {
		const r = readOf(p);
		const c = classifyV2(p.ratings, {
			...r,
			params: PARAMS,
			...extra,
		});
		const top = [];
		for (const x of c.v2.candidates) {
			if (top.length >= 3) break;
			if (!top.includes(x.canon)) top.push(x.canon);
		}
		return {
			c,
			id: c.id,
			name: c.name,
			top,
			// (a composed name passed every word's test; a build keeps the classic poor-fit reading)
			poor: c.v2.composed ? false : isPoorFit(c),
		};
	},
};
const canonOfLabel = (res) =>
	res.id.startsWith("v2:") ? canonOf(res.name) : mergedId(res.id);

test.skipIf(!process.env.RUN_ARCHETYPE_V2)(
	"archv2",
	async () => {
		if (MODE === "data") {
			// Position-peer percentiles
			const league = await genPlayers(3000, "archv2-peers", 19, 32, 38);
			const real = realPop(2016, 2025);
			const by = {};
			for (const p of [...league, ...real]) {
				const r = readOf(p);
				const s = scoreAll(p.ratings, r.norms, ARCHETYPES, r.pos, undefined, r);
				const b = BUCKET_OF[s.pos];
				by[b] ??= {};
				for (const k of [...SKILL_CLASS_KEYS, "stre", "def", "score"])
					(by[b][k] ??= []).push(s.cv[k]);
			}
			const peers = {};
			for (const b of POS_BUCKETS) {
				peers[b] = {};
				for (const [k, xs] of Object.entries(by[b])) peers[b][k] = quantiles(xs);
			}
			writeFileSync(
				new URL("./peers.data.ts", import.meta.url),
				`// GENERATED by v2/v2.script.test.ts (RUN_ARCHETYPE_V2=1 ARCH_V2_MODE=data). Do not edit by hand.
// archv2: per position bucket, the 0th, 5th, ..., 100th percentile of each blended class value (score.ts classValues) among
// a random league (3,000 players, 19-32, ovr 38+) and the real players 2016-2025 (with their stats), read as the game reads
// them: what "top X% at his position" means for a word's test (tests.ts).
import type { PosBucket } from "../types.ts";

export const PEER_QUANTILES: Partial<Record<PosBucket, Record<string, number[]>>> = ${JSON.stringify(peers)};
`,
			);
			// The labeled players
			const rows = [];
			for (const x of userPlayers()) {
				const s = scoreAll(x.p.ratings, x.norms, ARCHETYPES, x.p.pos, undefined, x.read);
				rows.push({
					key: x.r.slug,
					name: x.r.arch,
					pos: s.pos,
					src: x.r.allTime ? "2kAllTime" : "2k",
					split: x.split,
					raw: FEAT_FROM_FAMX(s.famX),
				});
			}
			for (const jp of judgedPlayers(false, NORMS)) {
				const a = archetypeById(mergedId(jp.j.ids[0]));
				if (!a) continue;
				rows.push({
					key: jp.j.slug ?? jp.j.key,
					name: nameAt(a, jp.pos),
					pos: jp.pos,
					src: "judged",
					split: jp.j.split,
					raw: FEAT_FROM_FAMX(jp.famX),
				});
			}
			const scale = {};
			for (const b of POS_BUCKETS) {
				const xs = rows.filter((r) => BUCKET_OF[r.pos] === b).map((r) => r.raw);
				const mean = Array.from({ length: N_FEATS }, (_, i) =>
					xs.reduce((s, x) => s + x[i], 0) / Math.max(1, xs.length),
				);
				const sd = Array.from({ length: N_FEATS }, (_, i) =>
					Math.max(
						0.05,
						Math.sqrt(
							xs.reduce((s, x) => s + (x[i] - mean[i]) ** 2, 0) /
								Math.max(1, xs.length - 1),
						),
					),
				);
				scale[b] = {
					mean: mean.map((v) => Math.round(v * 1000) / 1000),
					sd: sd.map((v) => Math.round(v * 1000) / 1000),
				};
			}
			const names = [...new Set(rows.map((r) => r.name))].sort();
			const std = rows.map((r) =>
				r.raw.map(
					(v, i) =>
						(v - scale[BUCKET_OF[r.pos]].mean[i]) / scale[BUCKET_OF[r.pos]].sd[i],
				),
			);
			writeFileSync(
				new URL("./knn.data.ts", import.meta.url),
				`// GENERATED by v2/v2.script.test.ts (RUN_ARCHETYPE_V2=1 ARCH_V2_MODE=data). Do not edit by hand.
// archv2: the labeled players the reading votes with (knn.ts): ${rows.length} rows, the user's NBA 2K list (user2k.data.ts,
// current and all-time) and the judged key's first builds (judged.data.ts, judgedSim.data.ts). Per row: KNN_KEYS his
// real-player id or judged key (leave-one-out), KNN_META "name index, position bucket, source, split, position", KNN_X
// his standardized features (knn.ts FEAT_FROM_FAMX, by his position bucket with KNN_SCALE) as int8 / 20 in base64.
// prettier-ignore
export const KNN_NAMES: string[] = ${JSON.stringify(names)};
// prettier-ignore
export const KNN_KEYS: string[] = ${JSON.stringify(rows.map((r) => r.key))};
// prettier-ignore
export const KNN_META = ${JSON.stringify(
					rows
						.map((r) =>
							metaOf({
								nameIdx: names.indexOf(r.name),
								bucket: POS_BUCKETS.indexOf(BUCKET_OF[r.pos]),
								src: r.src,
								split: r.split,
								pos: r.pos,
							}),
						)
						.join(";"),
				)};
// prettier-ignore
export const KNN_X = ${JSON.stringify(encodeX(std))};
// prettier-ignore
export const KNN_SCALE: Record<string, { mean: number[]; sd: number[] }> = ${JSON.stringify(scale)};
`,
			);
			return;
		}

		// ---- accuracy against the labeled players ----
		const u2k = userPlayers().map((x) => ({
			...x.p,
			norms: x.norms,
			age: x.read.age,
			stats: x.read.stats,
			r: x.r,
			w: x.w,
			split: x.split,
		}));
		const judged = judgedPlayers(false, NORMS).map((jp) => {
			// (the judged players read as the fit reads them)
			const data = realData();
			let p;
			if (jp.j.slug) {
				const row = data.d.ratings.find(
					(x) => x.slug === jp.j.slug && x.season === jp.j.season,
				);
				p = { ...realPlayer(data, row, ratingsOfRow), norms: REAL_NORMS };
			} else if (jp.j.src === "sim") {
				p = {
					ratings: { ...jp.j.ratings },
					pos: jp.pos,
					age: jp.j.age,
					norms: { ...NORMS, sub: SIM_SUB_NORMS },
					stats: jp.j.read?.stats,
					pt: jp.j.read?.pt,
				};
			} else {
				const ratings = { ...jp.j.ratings };
				const sub = generatedSubs(ratings, jp.j.key);
				if (sub) ratings.sub = sub;
				p = {
					ratings,
					pos: jp.pos,
					age: jp.j.age,
					prospect: jp.j.prospect,
					norms: NORMS,
				};
			}
			return { ...p, j: jp.j, key: jp.j.slug ?? jp.j.key };
		});

		const accuracy = (engine, xs, target, keyOf, extra) => {
			let n = 0,
				t1 = 0,
				t3 = 0,
				fam = 0,
				exact = 0;
			for (const x of xs) {
				const res = ENGINES[engine](x, extra(x));
				const tg = target(x);
				const w = x.w ?? 1;
				n += w;
				const top1 = canonOfLabel(res);
				if (tg.canon.includes(top1)) t1 += w;
				if (res.top.some((c) => tg.canon.includes(c))) t3 += w;
				if (tg.fam.includes(familyOfName(res.name, x.pos))) fam += w;
				if (tg.names?.some((nm) => nm.toLowerCase() === res.name.toLowerCase()))
					exact += w;
			}
			return { n, t1: t1 / n, t3: t3 / n, fam: fam / n, exact: exact / n };
		};
		const fmt = (a) =>
			`top-1 ${pct(a.t1, 1)}, top-3 ${pct(a.t3, 1)}, family ${pct(a.fam, 1)}, exact 2K name ${pct(a.exact, 1)} (n=${a.n})`;
		const t2k = (x) => ({
			canon: [canonOf(x.r.arch)],
			fam: [familyOfName(x.r.arch, x.pos)],
			names: [x.r.arch],
		});
		const tJ = (x) => {
			const ids = x.j.ids.map(mergedId);
			return {
				canon: ids,
				fam: ids.map((id) => familyOfName(nameAt(archetypeById(id), x.pos), x.pos)),
				names: ids.map((id) => nameAt(archetypeById(id), x.pos)),
			};
		};
		// (held out: the neighbours come from the tune split only, and never the player himself)
		const heldOut = (x) => ({ srID: x.slug ?? x.key, knn: { tuneOnly: true } });
		const loo = (x) => ({ srID: x.slug ?? x.key });

		if (MODE === "tune") {
			const tune2k = u2k.filter((x) => x.split === "tune");
			const tuneJ = judged.filter((x) => x.j.split === "tune");
			const grid = JSON.parse(process.env.ARCH_V2_GRID ?? "[{}]");
			const out = [];
			for (const pr of grid) {
				const ex = (x) => ({ ...loo(x), params: { ...PARAMS, ...pr } });
				const a = accuracy("v2", tune2k, t2k, null, ex);
				const b = accuracy("v2", tuneJ, tJ, null, ex);
				out.push(`${JSON.stringify(pr)}\n  2K tune ${fmt(a)}\n  judged tune ${fmt(b)}\n  objective ${(a.fam + a.t3 + 0.5 * (b.fam + b.t3)).toFixed(4)}`);
				writeFileSync(OUT, out.join("\n") + "\n");
			}
			return;
		}

		const out = [`archv2 report (sub-ratings ${SUBS_ON ? "on" : "off"}), params ${JSON.stringify({ ...V2_PARAMS, ...PARAMS })}`];
		const groups2k = {
			"user 2K held-out, current": u2k.filter((x) => x.split === "test" && !x.r.allTime),
			"user 2K held-out, all-time (half weight)": u2k.filter((x) => x.split === "test" && x.r.allTime),
			"user 2K held-out, all": u2k.filter((x) => x.split === "test"),
		};
		for (const [k, xs] of Object.entries(groups2k)) {
			out.push(`${k}:`);
			for (const e of ["classic", "v2"])
				out.push(`  ${e.padEnd(7)} ${fmt(accuracy(e, xs, t2k, null, e === "v2" ? heldOut : () => ({})))}`);
		}
		{
			const xs = judged.filter((x) => x.j.split === "test");
			out.push("judged key held-out:");
			for (const e of ["classic", "v2"])
				out.push(`  ${e.padEnd(7)} ${fmt(accuracy(e, xs, tJ, null, e === "v2" ? heldOut : () => ({})))}`);
		}
		// v2 on the tune split, leave-one-out (for reference: not held out)
		{
			const xs = u2k.filter((x) => x.split === "tune");
			out.push(`user 2K tune split (leave-one-out, reference): classic ${fmt(accuracy("classic", xs, t2k, null, () => ({})))}; v2 ${fmt(accuracy("v2", xs, t2k, null, loo))}`);
		}
		writeFileSync(OUT, out.join("\n") + "\n");
		if (process.env.ARCH_V2_QUICK) return;

		// ---- populations ----
		const league = await genPlayers(3000, "metrics-league", 19, 32, 38);
		const vets = await genPlayers(1000, "metrics-vets", 32, 37, 38);
		const pros = (await genPlayers(1000, "metrics-pros", 19, 19, 40)).map((p) => ({
			...p,
			prospect: true,
			age: undefined,
		}));
		const real = realPop(2016, 2025);
		const real2025 = real.filter((p) => p.season === 2025);
		const top150 = [...real2025].sort((a, b) => b.ovr - a.ovr).slice(0, 150);
		const pops = {
			"random league": league,
			veterans: vets,
			"draft prospects": pros,
			"real 2016-2025": real,
			"real 2025 top 150": top150,
		};
		for (const e of ["classic", "v2"]) {
			out.push(`== ${e}`);
			for (const [label, ps] of Object.entries(pops)) {
				const counts = {};
				let poor = 0,
					generic = 0,
					conflict = 0,
					promise = 0,
					composed = 0,
					low = 0;
				for (const p of ps) {
					const res = ENGINES[e](p, p.slug ? { srID: p.slug } : {});
					p[`res_${e}`] = res;
					counts[res.id] = (counts[res.id] ?? 0) + 1;
					if (res.poor) poor++;
					if (isGenericBuild({ id: res.id })) generic++;
					const a = archetypeById(res.id);
					if (!a || !a.positions.includes(p.pos)) conflict++;
					const s = scoreAll(p.ratings, p.norms, ARCHETYPES, p.pos, undefined, readOf(p));
					if (a && promiseMiss(a, s.cv) <= 1e-9) promise++;
					if (res.id.startsWith("v2:")) composed++;
					if (res.c.v2 && !res.c.v2.agreed) low++;
				}
				const n = ps.length;
				const sh = Object.entries(counts).sort((a, b) => b[1] - a[1]);
				let h = 0;
				for (const [, k] of sh) h -= (k / n) * Math.log(k / n);
				const nm = (id) => archetypeById(id)?.name ?? id;
				out.push(
					`${label} (n=${n}): max share ${nm(sh[0][0])} ${pct(sh[0][1], n)}, effective labels ${Math.exp(h).toFixed(0)}, distinct ${sh.length}, generic ${pct(generic, n)}, poor fit ${pct(poor, n)}, position conflicts ${conflict}, name promises kept ${pct(promise, n)}${e === "v2" ? `, composed ${pct(composed, n)}, families disagree (safe label) ${pct(low, n)}` : ""}; top: ${sh
						.slice(0, 5)
						.map(([id, k]) => `${nm(id)} ${pct(k, n)}`)
						.join(", ")}`,
				);
			}
			// Stability under a uniform shift
			for (const dd of [3, 6]) {
				let same = 0,
					n = 0;
				for (const p of league.slice(0, 1000)) {
					for (const sgn of [-dd, dd]) {
						const r = { ...p.ratings };
						for (const k of RATING_KEYS)
							if (k !== "hgt") r[k] = Math.max(0, Math.min(100, r[k] + sgn));
						if (r.sub) r.sub = r.sub.map((x) => Math.max(0, Math.min(100, x + sgn)));
						const res = ENGINES[e]({ ...p, ratings: r });
						n++;
						if (res.id === p[`res_${e}`].id) same++;
					}
				}
				out.push(`stability +-${dd}: same label ${pct(same, n)}`);
			}
			writeFileSync(OUT, out.join("\n") + "\n");
		}
		// Churn: the same players season after season, previous label and position carried, aging read
		for (const e of ["classic", "v2"]) {
			let changes = 0,
				steps = 0,
				close = 0;
			await seeded("metrics-flap", async () => {
				newG();
				const rng2 = new Rng("metrics-flap");
				for (let i = 0; i < 2000; i++) {
					const p = generate(-1, 19, 2025 - rng2.int(0, 6), false, DEFAULT_LEVEL);
					const dev = rng2.int(0, 10);
					await develop(p, dev, true);
					let prev, prevPos, prevR;
					for (let y = 0; y < 5; y++) {
						await develop(p, 1, false);
						const row = p.ratings.at(-1);
						if (ovrFn(row) < 38) continue;
						const r = ratingsOfRow(row);
						prevPos = positionFor(r, true, prevPos, { previousRatings: prevR });
						prevR = r;
						const res = ENGINES[e](
							{ ratings: r, pos: prevPos, age: 20 + dev + y, norms: NORMS },
							{ previousId: prev?.id },
						);
						if (prev) {
							steps++;
							if (prev.id !== res.id) changes++;
						}
						prev = res;
					}
				}
			});
			out.push(`churn ${e}: ${pct(changes, steps)} of seasons change label (${steps} player-seasons)`);
			writeFileSync(OUT, out.join("\n") + "\n");
		}
		// Notable players (current season of the user's list when there, else his latest season in the data)
		const NOTABLE = (process.env.ARCH_V2_NOTABLE ??
			"Jokic,Stephen Curry,Kevin Durant,LeBron James,Giannis,Gilgeous-Alexander,Luka,Embiid,Jayson Tatum,Jalen Brunson,Kyrie Irving,Donovan Mitchell,Rudy Gobert,Draymond Green,Evan Mobley,Alperen,Tyrese Haliburton,Cade Cunningham,Anthony Edwards,Wembanyama,Brook Lopez,Clint Capela,Alex Caruso,Tyler Herro,Tyrese Maxey,Karl-Anthony Towns,Zion Williamson,Ja Morant,Domantas Sabonis,Paolo Banchero").split(",");
		const data = realData();
		const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
		out.push("", "notable players | 2K | Classic | v2 (family; agreed?)");
		for (const n of NOTABLE) {
			let x = u2k.find((y) => !y.r.allTime && fold(y.r.name).includes(fold(n)));
			if (!x) {
				const slug = Object.entries(data.d.bios).find(([, b]) => b.name && fold(b.name).includes(fold(n)))?.[0];
				const row = slug
					? data.d.ratings.filter((r) => r.slug === slug).sort((a, b) => b.season - a.season)[0]
					: undefined;
				if (!row) {
					out.push(`${n}: not found`);
					continue;
				}
				x = { ...realPlayer(data, row, ratingsOfRow), norms: REAL_NORMS };
			}
			const c = ENGINES.classic(x);
			const v = ENGINES.v2(x, { srID: x.slug });
			out.push(
				`${x.r?.name ?? x.name} ${x.season ?? ""} (${x.pos}) | ${x.r?.arch ?? "-"} | ${c.name} | ${v.name} (${v.c.v2.family}${v.c.v2.agreed ? "" : "; safe"})`,
			);
		}
		writeFileSync(OUT, out.join("\n") + "\n");
	},
	3600000,
);
