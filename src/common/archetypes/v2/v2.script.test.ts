/* eslint-disable no-undef, curly, unicorn/prefer-single-call */
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
import { appendFileSync, writeFileSync } from "node:fs";
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
import { BUCKET_OF, encodeX, FEAT_FROM_FAMX, metaOf, N_FEATS } from "./knn.ts";

const MODE = process.env.ARCH_V2_MODE;
const OUT = process.env.ARCH_V2_OUT ?? "/tmp/claude-0/archv2-report.txt";
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
				for (const [k, xs] of Object.entries(by[b]))
					peers[b][k] = quantiles(xs);
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
				const s = scoreAll(
					x.p.ratings,
					x.norms,
					ARCHETYPES,
					x.p.pos,
					undefined,
					x.read,
				);
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
				const mean = Array.from(
					{ length: N_FEATS },
					(_, i) => xs.reduce((s, x) => s + x[i], 0) / Math.max(1, xs.length),
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
						(v - scale[BUCKET_OF[r.pos]].mean[i]) /
						scale[BUCKET_OF[r.pos]].sd[i],
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

		if (MODE === "shares") {
			// archv3: v2's label shares in a random league and the real players 2016-2025 (ARCH_V2_IDS: the builds to list),
			// the max share, generic share, and athletic names on players below their position's median athleticism
			const { ATH_NAME_RE } = await import("../score.ts");
			const { peerPct } = await import("./tests.ts");
			const ids = (
				process.env.ARCH_V2_IDS ??
				"glue-wing,glue-guard,steady-game-manager,energy-big"
			).split(",");
			const out = [JSON.stringify(PARAMS ?? {})];
			const pops = {
				"random league": await genPlayers(3000, "metrics-league", 19, 32, 38),
				"real 2016-2025": realPop(2016, 2025),
			};
			for (const [label, ps] of Object.entries(pops)) {
				const counts = {};
				const dbg = {};
				const ex = {};
				let ath = 0,
					athLow = 0,
					generic = 0,
					composed = 0;
				for (const p of ps) {
					const res = ENGINES.v2(p, p.slug ? { srID: p.slug } : {});
					counts[res.id] = (counts[res.id] ?? 0) + 1;
					for (const id of ids) {
						if ((id === res.id || id === canonOf(res.name)) && p.name) {
							const k = `example ${id}`;
							dbg[k] = dbg[k] ?? 0;
							if ((ex[id] ??= []).length < 4) ex[id].push(`${p.name} ${p.pos}`);
						}
					}
					const cn = canonOf(res.name);
					if (cn !== res.id) counts[cn] = (counts[cn] ?? 0) + 1;
					if (isGenericBuild({ id: res.id })) generic++;
					if (res.id.startsWith("v2:")) composed++;
					for (const r of [
						"glueWing",
						"glueGuard",
						"switchDefender",
						"floaterGuard",
						"rawHandler",
					])
						if (res.c.v2.roles.includes(r))
							dbg[`passes ${r}`] = (dbg[`passes ${r}`] ?? 0) + 1;
					if (process.env.ARCH_V2_DEBUG) {
						for (const id of ids) {
							const ci = res.c.v2.candidates.findIndex((c) => c.canon === id);
							if (ci < 0) continue;
							const key = `${id} cand (classic ${res.c.v2.candidates.find((c) => c.classic)?.canon === id ? "yes" : "no"}) rank ${ci === 0 ? "0" : ci < 3 ? "1-2" : "3+"} gap ${ci === 0 ? 0 : (res.c.v2.candidates[0].score - res.c.v2.candidates[ci].score).toFixed(1)}`;
							dbg[key] = (dbg[key] ?? 0) + 1;
							if (ci > 0)
								dbg[`${id} lost to ${res.c.v2.candidates[0].name}`] =
									(dbg[`${id} lost to ${res.c.v2.candidates[0].name}`] ?? 0) +
									1;
						}
					}
					if (ATH_NAME_RE.test(res.name)) {
						ath++;
						const s = scoreAll(
							p.ratings,
							p.norms,
							ARCHETYPES,
							p.pos,
							undefined,
							readOf(p),
						);
						if (peerPct(BUCKET_OF[s.pos], "ath", s.cv.ath ?? 0) < 0.5) {
							athLow++;
							const k = `athLow ${res.name}${res.id.startsWith("v2:") ? " (composed)" : res.c.v2.candidates.find((c) => c.classic)?.id === res.id ? " (classic)" : ""}`;
							dbg[k] = (dbg[k] ?? 0) + 1;
						}
					}
				}
				const n = ps.length;
				const sh = Object.entries(counts).sort((a, b) => b[1] - a[1]);
				const nm = (id) => archetypeById(id)?.name ?? id;
				out.push(
					`${label} (n=${n}): ${ids.map((id) => `${nm(id)} ${pct(counts[id] ?? 0, n)}`).join(", ")}; max share ${nm(sh[0][0])} ${pct(sh[0][1], n)}; generic ${pct(generic, n)}; composed ${pct(composed, n)}; athletic names ${pct(ath, n)}, on players below median athleticism ${pct(athLow, n)} (${pct(athLow, ath)} of them)`,
				);
				for (const [k, v] of Object.entries(dbg)
					.filter(([k2]) => !k2.startsWith("example"))
					.sort((a, b) => b[1] - a[1])
					.slice(0, process.env.ARCH_V2_DEBUG ? 40 : 4))
					out.push(`  ${v} ${k}`);
				for (const [id, xs] of Object.entries(ex))
					out.push(`  examples ${nm(id)}: ${xs.join(", ")}`);
				writeFileSync(OUT, out.join("\n") + "\n");
			}
			return;
		}
		if (MODE === "labels") {
			// archv5: the user's labels of the archcmp sample (userPicks.data.ts "archcmp-" picks) read leave-one-out (his own
			// pick never votes for him): the label against the user's
			const { USER_PICKS } = await import("./userPicks.data.ts");
			const out = [JSON.stringify(PARAMS ?? {})];
			let ok = 0,
				fam = 0,
				n = 0;
			for (const pk of USER_PICKS.filter((x) => x.uid.startsWith("archcmp-"))) {
				const p = pk.input;
				const want = nameAt(archetypeById(mergedId(pk.picked)), p.pos);
				const c = classifyV2(p.ratings, {
					norms: NORMS,
					pos: p.pos,
					age: p.age,
					params: PARAMS,
					srID: `upick:${pk.uid}`,
				});
				n++;
				const hit = c.id === mergedId(pk.picked);
				if (hit) ok++;
				const fw = familyOfName(want, p.pos);
				const fc = familyOfName(c.name, p.pos);
				if (fw === fc) fam++;
				out.push(
					`${pk.name} ${p.pos} age ${p.age} ovr ${p.ovr}: user ${pk.label}${want !== pk.label ? ` (= ${want})` : ""} | now ${c.name}${hit ? " OK" : fw === fc ? " (same family)" : ""}; runners-up ${c.alternates.map((x) => x.name).join(", ")}`,
				);
			}
			out.push(`as labeled ${ok}/${n}, same family ${fam}/${n}`);
			writeFileSync(OUT, out.join("\n") + "\n");
			return;
		}
		if (MODE === "promise") {
			// archv5: the draft prospects whose label breaks a promise
			const pros = (await genPlayers(1000, "metrics-pros", 19, 19, 40)).map(
				(p) => ({ ...p, prospect: true, age: undefined }),
			);
			const out = [];
			for (const p of pros) {
				const res = ENGINES.v2(p);
				const s = scoreAll(
					p.ratings,
					p.norms,
					ARCHETYPES,
					p.pos,
					undefined,
					readOf(p),
				);
				const a = archetypeById(res.id);
				if (!(a && promiseMiss(a, s.cv) <= 1e-9))
					out.push(
						`${p.pos} ${res.name} [${res.id}] miss ${a ? promiseMiss(a, s.cv).toFixed(2) : "?"}`,
					);
			}
			writeFileSync(OUT, out.join("\n") + "\n");
			return;
		}
		if (MODE === "stab") {
			// archv5: stability under a uniform shift of +-3 (as the eval) and churn, with what changes most
			const league = (
				await genPlayers(3000, "metrics-league", 19, 32, 38)
			).slice(0, 1000);
			const out = [JSON.stringify(PARAMS ?? {})];
			let same = 0,
				n = 0;
			const flips = {};
			for (const p of league) {
				const base = ENGINES.v2(p);
				for (const sgn of [-3, 3]) {
					const r = { ...p.ratings };
					for (const k of RATING_KEYS)
						if (k !== "hgt") r[k] = Math.max(0, Math.min(100, r[k] + sgn));
					if (r.sub)
						r.sub = r.sub.map((x) => Math.max(0, Math.min(100, x + sgn)));
					const res = ENGINES.v2({ ...p, ratings: r });
					n++;
					if (res.id === base.id) same++;
					else {
						const k = `${base.name} -> ${res.name}`;
						flips[k] = (flips[k] ?? 0) + 1;
					}
				}
			}
			out.push(`stability +-3: same label ${pct(same, n)}`);
			for (const [k, v] of Object.entries(flips)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 15))
				out.push(`  ${v} ${k}`);
			await churnAll(out, ["v2"]);
			writeFileSync(OUT, out.join("\n") + "\n");
			return;
		}
		if (MODE === "archv5") {
			// archv5: the new names' shares (the user's labels: Paint Beast, Prospect, ...), the low-ovr label's share, and the
			// labels the absolute floors change (tests.ts ABS_FLOORS: the label with floors against floorPen 0), among all and
			// among stars (real players ovr 60+, the 2025 top 150)
			const { floorMiss } = await import("./tests.ts");
			const { parseComposedId } = await import("./grammar.ts");
			const NEW_NAMES = (
				process.env.ARCH_V5_NAMES ??
				"Paint Beast|Interior Force|Interior Finisher|Athletic Finisher|Slashing Playmaker|Shot-Creating Slasher|Slashing Wing|Playmaking Shot Creator|High-Flying Shot Creator|Offensive-Minded Guard|Lockdown Defender|3 & D Wing|Sharpshooting|3-Level Scorer|Post Playmaker|Prospect|Depth Piece"
			).split("|");
			const LOW = new Set(["prospect", "depthPiece"]);
			const league = await genPlayers(3000, "metrics-league", 19, 32, 38);
			const vets = await genPlayers(1000, "metrics-vets", 32, 37, 38);
			const pros = (await genPlayers(1000, "metrics-pros", 19, 19, 40)).map(
				(p) => ({ ...p, prospect: true, age: undefined }),
			);
			const real = realPop(2016, 2025);
			const top150 = real
				.filter((p) => p.season === 2025)
				.sort((a, b) => b.ovr - a.ovr)
				.slice(0, 150);
			const pops = {
				"random league": league,
				veterans: vets,
				"draft prospects": pros,
				"real 2016-2025": real,
				"real stars (ovr 60+)": real.filter((p) => p.ovr >= 60),
				"real 2025 top 150": top150,
			};
			const out = [JSON.stringify(PARAMS ?? {})];
			const off = { ...(PARAMS ?? {}), floorPen: 0 };
			for (const [label, ps] of Object.entries(pops)) {
				const n = ps.length;
				const byName = {};
				const ex = {};
				let low = 0,
					relabel = 0,
					offFail = 0;
				const relEx = [];
				for (const p of ps) {
					const extra = p.slug ? { srID: p.slug } : {};
					const res = ENGINES.v2(p, extra);
					const role = parseComposedId(res.id)?.role.key;
					if (role && LOW.has(role)) low++;
					for (const w of NEW_NAMES) {
						if (res.name.includes(w)) {
							byName[w] = (byName[w] ?? 0) + 1;
							if ((ex[w] ??= []).length < 5)
								ex[w].push(
									`${p.name ?? "?"}${p.season ? ` ${p.season}` : ""} ${p.pos} ${p.age ?? ""} ovr ${p.ovr ?? "?"} (${res.name})`,
								);
						}
					}
					const r0 = classifyV2(p.ratings, {
						...readOf(p),
						params: off,
						...extra,
					});
					if (floorMiss(r0.name, p.ratings) > 0) {
						offFail++;
						if (r0.id !== res.id) {
							relabel++;
							if (relEx.length < 8)
								relEx.push(
									`${p.name ?? "?"}${p.season ? ` ${p.season}` : ""} ${p.pos} ovr ${p.ovr ?? "?"} tp ${p.ratings.tp}: ${r0.name} -> ${res.name}`,
								);
						}
					}
				}
				out.push(
					`${label} (n=${n}): low-ovr label ${pct(low, n)}; floor-failing labels without floors ${pct(offFail, n)}, relabeled by the floors ${pct(relabel, n)}`,
				);
				out.push(
					`  new names: ${NEW_NAMES.map((w) => `${w} ${pct(byName[w] ?? 0, n)}`).join(", ")}`,
				);
				for (const [w, xs] of Object.entries(ex))
					out.push(`  examples ${w}: ${xs.join("; ")}`);
				if (relEx.length) out.push(`  floor relabels: ${relEx.join("; ")}`);
				writeFileSync(OUT, out.join("\n") + "\n");
			}
			return;
		}
		if (MODE === "who") {
			// archv3: what decided some real players' labels (ARCH_V2_WHO="Name Season,...": voters, family scores, candidates)
			const data = realData();
			const fold = (x) =>
				x
					.normalize("NFD")
					.replace(/[\u0300-\u036f]/g, "")
					.toLowerCase();
			const out = [];
			for (const w of process.env.ARCH_V2_WHO.split(",")) {
				const m = w.trim().match(/^(.*) (\d{4})$/);
				const slug = Object.entries(data.d.bios).find(
					([, b]) => b.name && fold(b.name) === fold(m[1]),
				)?.[0];
				const row = data.d.ratings.find(
					(r) => r.slug === slug && r.season === Number(m[2]),
				);
				if (!row) {
					out.push(`${w}: not found`);
					continue;
				}
				const p = { ...realPlayer(data, row, ratingsOfRow), norms: REAL_NORMS };
				const res = ENGINES.v2(
					p,
					process.env.ARCH_V2_WHO_SELF ? {} : { srID: p.slug },
				);
				const v = res.c.v2;
				out.push(
					`${w} (${p.pos}): ${res.name} [${res.id}] fam ${v.family} voters ${JSON.stringify(v.voters)} roles ${v.roles.join(",")}`,
				);
				out.push(
					`  famScore ${Object.entries(v.famScore)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 4)
						.map(([k, x]) => `${k} ${x.toFixed(2)}`)
						.join(", ")}; knn canon ${Object.entries(v.votes.canon)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 4)
						.map(([k, x]) => `${k} ${x.toFixed(2)}`)
						.join(", ")}`,
				);
				for (const c of [...v.candidates]
					.sort((a, b) => b.score - a.score)
					.slice(0, 8))
					out.push(
						`  ${c.score.toFixed(2)} ${c.name} [${c.family}${c.classic ? ", classic" : ""}]`,
					);
			}
			writeFileSync(OUT, out.join("\n") + "\n");
			return;
		}
		if (MODE === "composed") {
			// archv3: the composed names v2 gives (random league and real 2016-2025): each with how often, example players,
			// the earlier reading's label for them and how far the best preset was
			const pops = {
				league: await genPlayers(3000, "metrics-league", 19, 32, 38),
				vets: await genPlayers(1000, "metrics-vets", 32, 37, 38),
				pros: (await genPlayers(1000, "metrics-pros", 19, 19, 40)).map((p) => ({
					...p,
					prospect: true,
					age: undefined,
				})),
				real: realPop(2016, 2025),
			};
			const by = {};
			// (every composed name among the candidates, chosen or not: the grammar audit)
			const pool = {};
			let n = 0;
			for (const [label, ps] of Object.entries(pops)) {
				for (const p of ps) {
					n++;
					const res = ENGINES.v2(p, p.slug ? { srID: p.slug } : {});
					const top = res.c.v2.candidates.find((c) => c.id.startsWith("v2:"));
					if (top) pool[top.name] = (pool[top.name] ?? 0) + 1;
					if (!res.id.startsWith("v2:")) continue;
					const cl = res.c.v2.candidates.find((c) => c.classic);
					const bestBuild = res.c.v2.candidates.find(
						(c) => !c.id.startsWith("v2:"),
					);
					const e = (by[res.name] ??= { n: 0, ex: [], ids: new Set() });
					e.n++;
					e.ids.add(res.id);
					if (e.ex.length < 3)
						e.ex.push(
							`${p.name ?? `gen#${n}`}${p.season ? ` ${p.season}` : ""} ${p.pos} (earlier: ${cl?.name}; best preset ${bestBuild?.name} ${(res.c.v2.candidates[0].score - (bestBuild?.score ?? 0)).toFixed(2)} behind)`,
						);
				}
			}
			const out = [
				`composed: ${Object.values(by).reduce((s, e) => s + e.n, 0)} of ${n} players, ${Object.keys(by).length} names`,
			];
			for (const [nm, e] of Object.entries(by).sort((a, b) => b[1].n - a[1].n))
				out.push(`${e.n}\t${nm}\t${[...e.ids].join(" ")}\t${e.ex.join(" | ")}`);
			out.push(
				"",
				`audit pool: ${Object.keys(pool).length} composed candidate names`,
			);
			for (const [nm, k] of Object.entries(pool).sort((a, b) => b[1] - a[1]))
				out.push(`${k}\t${nm}`);
			writeFileSync(OUT, out.join("\n") + "\n");
			return;
		}
		if (MODE === "churn") {
			const out = [JSON.stringify(PARAMS ?? {})];
			await churnAll(out, ["v2"]);
			writeFileSync(OUT, out.join("\n") + "\n");
			return;
		}
		if (MODE === "picks") {
			// archv3: the user's picks (a tuning export, ARCH_V2_PICKS) read as the game reads them: his tuning fitted from all
			// the picks on the model, the picks as labeled players, the player himself left out
			const { readFileSync } = await import("node:fs");
			const { applyTuning, fitTuning } = await import("../tuning.ts");
			const { modelFor } = await import("../classify.ts");
			const { pickKey, refsFromPicks } = await import("./picks.ts");
			const f = JSON.parse(readFileSync(process.env.ARCH_V2_PICKS, "utf8"));
			const byUid = new Map();
			for (const p of [...f.picks.global, ...f.picks.league])
				byUid.set(p.uid, { ...p, input: f.snapshots[p.uid] });
			const picks = [...byUid.values()];
			const tuning = fitTuning(picks, modelFor);
			const refs = refsFromPicks(picks);
			const lines = [`tuning n=${tuning.n} hash ${tuning.hash}`];
			for (const p of picks) {
				const inp = p.input;
				const [lid, pid] = p.uid.split("-");
				const expanded = typeof inp.ratings.wng === "number";
				const base = {
					pos: inp.pos,
					age: inp.age,
					prospect: inp.prospect,
					stats: inp.stats,
					pt: inp.pt,
					traits: inp.traits,
					norms: defaultNorms(expanded),
				};
				const plain = classifyV2(inp.ratings, { ...base, params: PARAMS });
				const tuned = classifyV2(inp.ratings, {
					...base,
					params: PARAMS,
					model: applyTuning(modelFor(expanded), tuning),
					extraRefs: refs,
					pickKey: pickKey(lid, pid),
				});
				const want = archetypeById(p.picked);
				if (process.env.ARCH_V2_DEBUG) {
					const fs2 = Object.entries(tuned.v2.famScore)
						.sort((a, b) => b[1] - a[1])
						.slice(0, 4)
						.map(([k, v]) => `${k} ${v.toFixed(2)}`);
					lines.push(
						`  voters ${JSON.stringify(tuned.v2.voters)} fam ${fs2.join(", ")}`,
					);
					for (const c of tuned.v2.candidates.slice(0, 8))
						lines.push(
							`  ${c.score.toFixed(2)} ${c.name} [${c.family}${c.classic ? ", classic" : ""}]`,
						);
					const pc = tuned.v2.candidates.find((c) => c.canon === p.picked);
					const { promiseMiss } = await import("../score.ts");
					const sc0 = scoreAll(
						inp.ratings,
						base.norms,
						ARCHETYPES,
						inp.pos,
						inp.traits,
						base,
					);
					lines.push(
						`  promiseMiss picked ${promiseMiss(archetypeById(p.picked), sc0.cv).toFixed(2)} positions ${archetypeById(p.picked).positions}`,
					);
					lines.push(
						`  picked: ${pc ? `${pc.score.toFixed(2)} ${pc.family} rank ${tuned.v2.candidates.indexOf(pc)}` : "not a candidate"}`,
					);
				}
				lines.push(
					`${p.name} ${p.season} ${inp.pos}: picked ${want ? nameAt(want, inp.pos) : p.picked} | shown then ${p.shown} | now ${plain.name} [${plain.id}] | with his tuning and picks ${tuned.name} [${tuned.id}]${tuned.id === p.picked ? " OK" : ""}; alternates ${tuned.alternates.map((a) => a.name).join(", ")}`,
				);
			}
			writeFileSync(OUT, lines.join("\n") + "\n");
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
				// (archv5: ARCH_V2_HITS=file, each held-out player's label and whether it is a hit)
				if (process.env.ARCH_V2_HITS && engine === "v2")
					appendFileSync(
						process.env.ARCH_V2_HITS,
						`${x.slug ?? x.key ?? x.name} | ${res.name} | t1 ${tg.canon.includes(top1) ? 1 : 0} t3 ${res.top.some((c) => tg.canon.includes(c)) ? 1 : 0} fam ${tg.fam.includes(familyOfName(res.name, x.pos)) ? 1 : 0} | want ${tg.names?.join(" / ")}\n`,
					);
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
				fam: ids.map((id) =>
					familyOfName(nameAt(archetypeById(id), x.pos), x.pos),
				),
				names: ids.map((id) => nameAt(archetypeById(id), x.pos)),
			};
		};
		// (held out: the neighbours come from the tune split only, and never the player himself)
		const heldOut = (x) => ({ srID: x.slug ?? x.key, knn: { tuneOnly: true } });
		const loo = (x) => ({ srID: x.slug ?? x.key });

		if (MODE === "voters") {
			// Which family voter is right how often, per position bucket and per family it says (tune split, the neighbours
			// leave-one-out from the tune split), and where the target build ranks among v2's and the classic reading's
			// candidates
			const xs = [
				...u2k
					.filter((x) => x.split === (process.env.ARCH_V2_SPLIT ?? "tune"))
					.map((x) => ({ x, tg: t2k(x), src: "2k" })),
				...judged
					.filter((x) => x.j.split === (process.env.ARCH_V2_SPLIT ?? "tune"))
					.map((x) => ({ x, tg: tJ(x), src: "judged" })),
			];
			{
				const { shippedRefs, standardize: stdz } = await import("./knn.ts");
				const refs = shippedRefs();
				const ds = [];
				for (const x of u2k.slice(0, 40)) {
					const r = refs.find((y) => y.key === x.slug);
					if (!r) continue;
					const s0 = scoreAll(
						x.ratings,
						x.norms,
						ARCHETYPES,
						x.pos,
						undefined,
						readOf(x),
					);
					const z = stdz(FEAT_FROM_FAMX(s0.famX), BUCKET_OF[s0.pos]);
					let d = 0;
					const big = [];
					for (let i = 0; i < z.length; i++) {
						d += (z[i] - r.x[i]) ** 2;
						if (Math.abs(z[i] - r.x[i]) > 0.3)
							big.push(`${i}:${z[i].toFixed(2)}/${r.x[i]}`);
					}
					ds.push(
						`${x.slug} ${s0.pos}/${r.pos} d=${Math.sqrt(d).toFixed(2)} ${big.join(" ")}`,
					);
				}
				writeFileSync(OUT + ".self", ds.join("\n"));
			}
			const V = ["classic", "knn", "rule", "probs"];
			const acc = {};
			const rows = [];
			for (const { x, tg, src } of xs) {
				const res = ENGINES.v2(x, {
					srID: x.slug ?? x.key,
					knn: { tuneOnly: true },
				});
				const cl = ENGINES.classic(x);
				const b = BUCKET_OF[res.c.v2 ? x.pos : x.pos] ?? "?";
				const w = (x.w ?? 1) * (src === "judged" ? 0.5 : 1);
				const vs = res.c.v2.voters;
				const row = { b, src, w, tg: tg.fam, vs, fs: res.c.v2.famScore };
				rows.push(row);
				for (const v of V) {
					const f = vs[v];
					if (!f) continue;
					const ok = tg.fam.includes(f) ? 1 : 0;
					for (const key of [
						`${v}|${b}|*`,
						`${v}|${b}|${f}`,
						`${v}|*|*`,
						`${v}|*|${f}`,
					]) {
						acc[key] ??= { n: 0, ok: 0 };
						acc[key].n += w;
						acc[key].ok += ok * w;
					}
				}
				// target's rank among candidates
				const rk = res.c.v2.candidates.findIndex((c) =>
					tg.canon.includes(c.canon),
				);
				const rc = cl.top.findIndex((c) => tg.canon.includes(c));
				for (const [nm, r] of [
					["v2rank", rk],
					["clrank", rc],
				]) {
					const key = `${nm}|${r < 0 ? "none" : r < 3 ? r : r < 6 ? "3-5" : r < 10 ? "6-9" : "10+"}`;
					acc[key] ??= { n: 0, ok: 0 };
					acc[key].n += w;
				}
				// all disagree vs agree
				const set = new Set([vs.classic, vs.knn, vs.rule].filter(Boolean));
				const key = `agree|${set.size}`;
				acc[key] ??= { n: 0, ok: 0 };
				acc[key].n += w;
				acc[key].ok += tg.fam.includes(res.c.v2.family) ? w : 0;
			}
			if (process.env.ARCH_V2_WRITE_REL) {
				// Smoothed: a family the voter says rarely leans on the voter's accuracy at that position, which leans on its
				// accuracy overall
				const M = 4;
				const rel = {};
				for (const v of V) {
					const all = acc[`${v}|*|*`];
					const g0 = (all.ok + M * 0.4) / (all.n + M);
					rel[v] = {};
					for (const b of POS_BUCKETS) {
						const ab = acc[`${v}|${b}|*`] ?? { n: 0, ok: 0 };
						const rb = (ab.ok + M * g0) / (ab.n + M);
						rel[v][b] = { "*": Math.round(rb * 1000) / 1000 };
						for (const [k, a] of Object.entries(acc)) {
							const [v2, b2, f] = k.split("|");
							if (v2 !== v || b2 !== b || f === "*") continue;
							rel[v][b][f] =
								Math.round(((a.ok + M * rb) / (a.n + M)) * 1000) / 1000;
						}
					}
				}
				writeFileSync(
					new URL("./voters.data.ts", import.meta.url),
					`// GENERATED by v2/v2.script.test.ts (RUN_ARCHETYPE_V2=1 ARCH_V2_MODE=voters ARCH_V2_WRITE_REL=1). Do not edit by hand.
// archv3: how often each family voter is right, per position bucket and per family it says ("*": any family it says),
// measured on the tune split of the user's 2K list and the judged key (the neighbours leave-one-out from the tune split),
// smoothed toward the voter's accuracy at that position and overall. The engine weighs each voter's family by this.
import type { Family } from "../families.ts";
import type { PosBucket } from "../types.ts";

export type Voter = "classic" | "knn" | "rule" | "probs";
// prettier-ignore
export const VOTER_REL: Record<Voter, Record<PosBucket, Partial<Record<Family | "*", number>>>> = ${JSON.stringify(rel)};
`,
				);
			}
			const lines = Object.entries(acc)
				.sort((a, b) => (a[0] < b[0] ? -1 : 1))
				.map(([k, a]) => `${k}\t${a.n.toFixed(1)}\t${pct(a.ok, a.n)}`);
			writeFileSync(OUT, lines.join("\n") + "\n");
			writeFileSync(OUT + ".json", JSON.stringify(rows));
			return;
		}
		if (MODE === "tune") {
			const tune2k = u2k.filter((x) => x.split === "tune");
			const tuneJ = judged.filter((x) => x.j.split === "tune");
			const grid = JSON.parse(process.env.ARCH_V2_GRID ?? "[{}]");
			const out = [];
			for (const pr of grid) {
				const ex = (x) => ({ ...loo(x), params: { ...PARAMS, ...pr } });
				const a = accuracy("v2", tune2k, t2k, null, ex);
				const b = accuracy("v2", tuneJ, tJ, null, ex);
				out.push(
					`${JSON.stringify(pr)}\n  2K tune ${fmt(a)}\n  judged tune ${fmt(b)}\n  objective ${(a.fam + a.t3 + 0.5 * (b.fam + b.t3)).toFixed(4)}`,
				);
				for (const [k, v] of Object.entries(dbg)
					.sort((a, b) => b[1] - a[1])
					.slice(0, process.env.ARCH_V2_DEBUG ? 40 : 4))
					out.push(`  ${v} ${k}`);
				writeFileSync(OUT, out.join("\n") + "\n");
			}
			return;
		}

		const out = [
			`archv2 report (sub-ratings ${SUBS_ON ? "on" : "off"}), params ${JSON.stringify({ ...V2_PARAMS, ...PARAMS })}`,
		];
		const groups2k = {
			"user 2K held-out, current": u2k.filter(
				(x) => x.split === "test" && !x.r.allTime,
			),
			"user 2K held-out, all-time (half weight)": u2k.filter(
				(x) => x.split === "test" && x.r.allTime,
			),
			"user 2K held-out, all": u2k.filter((x) => x.split === "test"),
		};
		for (const [k, xs] of Object.entries(groups2k)) {
			out.push(`${k}:`);
			for (const e of ["classic", "v2"])
				out.push(
					`  ${e.padEnd(7)} ${fmt(accuracy(e, xs, t2k, null, e === "v2" ? heldOut : () => ({})))}`,
				);
		}
		{
			const xs = judged.filter((x) => x.j.split === "test");
			out.push("judged key held-out:");
			for (const e of ["classic", "v2"])
				out.push(
					`  ${e.padEnd(7)} ${fmt(accuracy(e, xs, tJ, null, e === "v2" ? heldOut : () => ({})))}`,
				);
		}
		// v2 on the tune split, leave-one-out (for reference: not held out)
		{
			const xs = u2k.filter((x) => x.split === "tune");
			out.push(
				`user 2K tune split (leave-one-out, reference): classic ${fmt(accuracy("classic", xs, t2k, null, () => ({})))}; v2 ${fmt(accuracy("v2", xs, t2k, null, loo))}`,
			);
		}
		writeFileSync(OUT, out.join("\n") + "\n");
		if (process.env.ARCH_V2_QUICK) return;

		// ---- populations ----
		const league = await genPlayers(3000, "metrics-league", 19, 32, 38);
		const vets = await genPlayers(1000, "metrics-vets", 32, 37, 38);
		const pros = (await genPlayers(1000, "metrics-pros", 19, 19, 40)).map(
			(p) => ({
				...p,
				prospect: true,
				age: undefined,
			}),
		);
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
					const s = scoreAll(
						p.ratings,
						p.norms,
						ARCHETYPES,
						p.pos,
						undefined,
						readOf(p),
					);
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
						if (r.sub)
							r.sub = r.sub.map((x) => Math.max(0, Math.min(100, x + sgn)));
						const res = ENGINES[e]({ ...p, ratings: r });
						n++;
						if (res.id === p[`res_${e}`].id) same++;
					}
				}
				out.push(`stability +-${dd}: same label ${pct(same, n)}`);
			}
			writeFileSync(OUT, out.join("\n") + "\n");
		}
		await churnAll(out);
		writeFileSync(OUT, out.join("\n") + "\n");
		notables(out);
		writeFileSync(OUT, out.join("\n") + "\n");
	},
	3600000,
);

// Churn: the same players season after season, previous label and position carried, aging read
const churnAll = async (out, engines = ["classic", "v2"]) => {
	for (const e of engines) {
		let changes = 0,
			steps = 0;
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
						if (prev.id !== res.id) {
							changes++;
							if (process.env.ARCH_V2_DEBUG && res.c.v2) {
								const pc = res.c.v2.candidates.find((c) => c.id === prev.id);
								const f = res.c.v2.candidates[0];
								out.push(
									`  ${prev.name} -> ${res.name} | prev ${pc ? `${pc.score.toFixed(2)} ${pc.family}` : "absent"} new ${f.score.toFixed(2)} ${f.family} fam ${res.c.v2.family} prevFam ${prev.c.v2?.family}`,
								);
							}
						}
					}
					prev = res;
				}
			}
		});
		out.push(
			`churn ${e}: ${pct(changes, steps)} of seasons change label (${steps} player-seasons)`,
		);
		writeFileSync(OUT, out.join("\n") + "\n");
	}
};

// Notable players (current season of the user's list when there, else his latest season in the data)
const notables = (out) => {
	const u2k = userPlayers().map((x) => ({
		...x.p,
		norms: x.norms,
		age: x.read.age,
		stats: x.read.stats,
		r: x.r,
	}));
	const NOTABLE = (
		process.env.ARCH_V2_NOTABLE ??
		"Jokic,Stephen Curry,Kevin Durant,LeBron James,Giannis,Gilgeous-Alexander,Luka,Embiid,Jayson Tatum,Jalen Brunson,Kyrie Irving,Donovan Mitchell,Rudy Gobert,Draymond Green,Evan Mobley,Alperen,Tyrese Haliburton,Cade Cunningham,Anthony Edwards,Victor Wembanyama,Brook Lopez,Clint Capela,Alex Caruso,Tyler Herro,Tyrese Maxey,Karl-Anthony Towns,Zion Williamson,Ja Morant,Domantas Sabonis,Paolo Banchero"
	).split(",");
	const data = realData();
	const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
	out.push("", "notable players | 2K | Classic | v2 (family; agreed?)");
	for (const n of NOTABLE) {
		let x = u2k.find((y) => !y.r.allTime && fold(y.r.name).includes(fold(n)));
		if (!x) {
			// (an exact full name first: "Victor Wembanyama", not a relative whose name contains it)
			const bios = Object.entries(data.d.bios).filter(([, b]) => b.name);
			const slug = (bios.find(([, b]) => fold(b.name) === fold(n)) ??
				bios.find(([, b]) => fold(b.name).includes(fold(n))))?.[0];
			const row = slug
				? data.d.ratings
						.filter((r) => r.slug === slug)
						.sort((a, b) => b.season - a.season)[0]
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
			`${x.r ? `${x.r.name} ${x.season}` : x.name} (${x.pos}) | ${x.r?.arch ?? "-"} | ${c.name} | ${v.name} (${v.c.v2.family}${v.c.v2.agreed ? "" : "; safe"})`,
		);
	}
};
