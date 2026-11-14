/* eslint-disable unicorn/prefer-single-call */
/* eslint-disable no-undef, curly */
// @ts-nocheck
// arch14: fits the reading's weights to the judged set (judged.data.ts) and writes fitted.data.ts (RUN_ARCHETYPE_FIT=1) or,
// with ARCH_EXPANDED=1, fittedExpanded.data.ts (players read with expanded ratings: real ones filled as a real-players
// league fills them, generated ones the same way). Not part of the normal run.
// 1. Every judged player's terms for every build his position allows (classify.ts scoreTerms), read as the game reads him
//    (real players: that season's ratings, the position the game shows, the last three seasons' stats).
// 2. The family classifier: multinomial logistic regression of the families of his judged builds on his features
//    (model.ts FAM_FEATS), L2-regularised.
// 3. The build ranker: the weights of the terms (regularised toward the hand settings, 1), of the promised skill classes and
//    the family biases (toward 0) and of the family's log probability, by a ranking loss: -log of the softmax mass of his
//    judged builds (first pick weight 1, then 0.7, 0.5) over every build he may have.
// 4. Five-fold cross-validation on the tuning split picks the regularisation, the family gate (tau, gate) and the close-call
//    rule (tieMargin, tieStatsK) by top-1 agreement (then loss); the final fit uses the whole tuning split. The test split is
//    only scored. ARCH_FIT_OUT=file: the report (before -> after per split, families, per-population).
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { RATING_KEYS } from "../ratingsBuilds/solver.ts";
import { EXPANDED_RATINGS2, fillExpandedRatings } from "../expandedRatings.ts";
import {
	ARCHETYPES,
	defaultNorms,
	scoreTerms,
	statAlignment,
} from "./classify.ts";
import { FAMILIES } from "./families.ts";
import { JUDGED as JUDGED_BASE } from "./judged.data.ts";
import { JUDGED_SIM, SIM_SUB_NORMS } from "./judgedSim.data.ts";
// arch17: plus the simulated league's players, read with their play types
const JUDGED = [...JUDGED_BASE, ...JUDGED_SIM];
import {
	CLASS_FEATS,
	FAM_FEATS,
	TERMS,
	STYLE_PRIOR,
	TRAIT_PRIOR,
	familyProbs,
} from "./model.ts";
import { positionFor } from "./position.ts";
import { generateTraitSeeds } from "../playerTraits/seeds.ts";
import { traitScores } from "../playerTraits/scores.ts";
import {
	generatedSubs,
	realData,
	realNorms,
	realPlayer,
} from "./real.testutil.ts";
import { modelFor } from "./classify.ts";
import { mergedId } from "./merges.data.ts";
import { promiseChecks, promisesOf } from "./score.ts";

const EXPANDED = Boolean(process.env.ARCH_EXPANDED);
const NORMS = defaultNorms(EXPANDED);
const T = 0.7;
const PICK_W = [1, 0.7, 0.5];
const FOLDS = 5;

const ratingsOfRow = (row) => {
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

// The judged players as the game reads them, with their terms
export const judgedPlayers = (expanded = EXPANDED, norms = NORMS) => {
	const data = realData();
	if (expanded && !data.filled) {
		const bySlug = {};
		for (const row of data.d.ratings) (bySlug[row.slug] ??= []).push(row);
		for (const [slug, rows] of Object.entries(bySlug)) {
			rows.sort((x, y) => x.season - y.season);
			fillExpandedRatings({ srID: slug, ratings: rows });
		}
		data.filled = true;
	}
	const rOf = (row) => {
		const r = {};
		for (const k of RATING_KEYS) r[k] = row[k];
		if (expanded && typeof row.wng === "number") {
			r.wng = row.wng;
			r.pdef = row.pdef;
			r.idef = row.idef;
			for (const k of EXPANDED_RATINGS2) r[k] = row[k];
		}
		return r;
	};
	// arch14: player traits as a league with the Player Traits setting would give him (seeded by his key; every trait,
	// hidden ones too), so the trait terms can be fitted. ARCH_FIT_NO_TRAITS=1: none (the setting off)
	const traitsOf = (j, ratings, age, i) =>
		process.env.ARCH_FIT_NO_TRAITS
			? undefined
			: traitScores(ratings, generateTraitSeeds(`judged-${j.key}`, i), {
					age: age ?? 19,
					experience: Math.max(0, (age ?? 19) - 20),
				});
	return JUDGED.map((j, ji) => {
		let read;
		let ratings;
		let pos = j.pos;
		let nm = norms;
		if (j.src === "sim") {
			ratings = { ...j.ratings };
			nm = { ...norms, sub: SIM_SUB_NORMS };
			pos = j.pos;
			read = { ...j.read, age: j.age };
		} else if (j.slug) {
			nm = realNorms(norms, expanded);
			const row = data.d.ratings.find(
				(x) => x.slug === j.slug && x.season === j.season,
			);
			const p = realPlayer(data, row, rOf);
			ratings = p.ratings;
			pos = p.pos;
			read = { age: p.age, stats: p.stats };
		} else {
			ratings = { ...j.ratings };
			if (expanded) {
				const row = { ...ratings };
				fillExpandedRatings({ srID: `judged-${j.key}`, ratings: [row] });
				ratings = rOf(row);
			}
			const sub = generatedSubs(ratings, j.key);
			if (sub) ratings.sub = sub;
			// (the position the game gives him now: the position model may have moved since he was judged)
			pos = positionFor(ratings, true);
			read = { age: j.age, prospect: j.prospect };
		}
		const t = scoreTerms(
			ratings,
			nm,
			ARCHETYPES,
			pos,
			traitsOf(j, ratings, read.age, ji),
			read,
		);
		// (arch15: each profile is read as its build: a build merged in arch15 has more than one row)
		const rows = t.rows
			.filter((r) => !r.blocked)
			.map((r) => ({ ...r, a: r.pub }));
		const ids = [...new Set(j.ids.map(mergedId))];
		const pickIdx = [];
		const pickW = [];
		ids.forEach((id, k) =>
			rows.forEach((r, ri) => {
				if (r.a.id === id) {
					pickIdx.push(ri);
					pickW.push(PICK_W[k] ?? 0.5);
				}
			}),
		);
		const famSet = new Set(
			ids.map((id) => rows.find((r) => r.a.id === id)?.fam).filter(Boolean),
		);
		return {
			j,
			style: t.p.style,
			cv: t.cv,
			pos,
			rows,
			pickIdx,
			pickW,
			ids,
			famSet,
			famX: t.famX,
			stats: read.stats,
			pop:
				j.src === "league" || j.src === "prospect" || j.src === "sim"
					? j.src
					: j.season >= 2016
						? "real 2016+"
						: "real <2016",
		};
	});
};

// ---- the family classifier ----
const fitFamily = (players, lambda, iters = 300) => {
	const nF = FAMILIES.length;
	const nX = FAM_FEATS.length;
	const W = FAMILIES.map(() => new Array(nX).fill(0));
	const m = FAMILIES.map(() => new Array(nX).fill(0));
	const v = FAMILIES.map(() => new Array(nX).fill(0));
	const lr = 0.05;
	for (let it = 1; it <= iters; it++) {
		const g = FAMILIES.map(() => new Array(nX).fill(0));
		for (const p of players) {
			const open = FAMILIES.map((f) => p.rows.some((r) => r.fam === f));
			const logits = W.map((w, fi) =>
				open[fi] ? w.reduce((t, wi, i) => t + wi * p.famX[i], 0) : -Infinity,
			);
			const mx = Math.max(...logits);
			const e = logits.map((l) => Math.exp(l - mx));
			const s = e.reduce((a, b) => a + b, 0);
			const pr = e.map((x) => x / s);
			const qs = FAMILIES.map((f, fi) => (p.famSet.has(f) ? pr[fi] : 0));
			const qsum = qs.reduce((a, b) => a + b, 0) || 1;
			for (let fi = 0; fi < nF; fi++) {
				const d = pr[fi] - qs[fi] / qsum;
				if (d === 0) continue;
				for (let i = 0; i < nX; i++) g[fi][i] += d * p.famX[i];
			}
		}
		for (let fi = 0; fi < nF; fi++)
			for (let i = 0; i < nX; i++) {
				const gr =
					g[fi][i] / players.length + (i === 0 ? 0 : lambda * W[fi][i]);
				m[fi][i] = 0.9 * m[fi][i] + 0.1 * gr;
				v[fi][i] = 0.999 * v[fi][i] + 0.001 * gr * gr;
				W[fi][i] -=
					(lr * (m[fi][i] / (1 - 0.9 ** it))) /
					(Math.sqrt(v[fi][i] / (1 - 0.999 ** it)) + 1e-8);
			}
	}
	return Object.fromEntries(FAMILIES.map((f, fi) => [f, W[fi]]));
};

// log P(family) per player per build row, under a family model
const famLogP = (players, famW) =>
	players.map((p) => {
		const pr = familyProbs({ famW }, p.famX);
		const open = new Set(p.rows.map((r) => r.fam));
		let s = 0;
		FAMILIES.forEach((f, i) => open.has(f) && (s += pr[i]));
		const byFam = Object.fromEntries(
			FAMILIES.map((f, i) => [f, Math.log(Math.max(1e-6, pr[i] / s))]),
		);
		const top = FAMILIES.filter((f) => open.has(f)).sort(
			(a, b) => byFam[b] - byFam[a],
		)[0];
		return { byFam, top, topP: Math.exp(byFam[top]) };
	});

// ---- the build ranker ----
// params: theta (TERMS), cls (CLASS_FEATS), famBias (FAMILIES), gamma
const NT = TERMS.length;
const NC = CLASS_FEATS.length;
const NFAM = FAMILIES.length;
const NP = NT + NC + NFAM + 1;
const FAM_I = Object.fromEntries(FAMILIES.map((f, i) => [f, i]));
const toModel = (w, famW, extra) => ({
	theta: Object.fromEntries(TERMS.map((t, i) => [t, w[i]])),
	cls: Object.fromEntries(CLASS_FEATS.map((c, i) => [c, w[NT + i]])),
	famBias: Object.fromEntries(FAMILIES.map((f, i) => [f, w[NT + NC + i]])),
	famW,
	gamma: w[NP - 1],
	...extra,
});
const prior0 = () => [
	...TERMS.map((t) =>
		t.startsWith("tr") ? TRAIT_PRIOR : (STYLE_PRIOR[t] ?? 1),
	),
	...CLASS_FEATS.map(() => 0),
	...FAMILIES.map(() => 0),
	0,
];
const scoresOf = (p, lp, w) =>
	p.rows.map((r) => {
		let s = r.base + w[NT + NC + FAM_I[r.fam]] + w[NP - 1] * lp.byFam[r.fam];
		for (let i = 0; i < NT; i++) if (r.f[i] !== 0) s += w[i] * r.f[i];
		for (let i = 0; i < NC; i++) if (r.cls[i] !== 0) s += w[NT + i] * r.cls[i];
		return s;
	});
const fitRanker = (players, lps, lambda, iters = 400) => {
	const w = prior0();
	const w0 = prior0();
	const m = new Array(NP).fill(0);
	const v = new Array(NP).fill(0);
	const lr = 0.02;
	for (let it = 1; it <= iters; it++) {
		const g = new Array(NP).fill(0);
		players.forEach((p, pi) => {
			if (p.pickIdx.length === 0) return;
			const lp = lps[pi];
			const s = scoresOf(p, lp, w);
			const mx = Math.max(...s);
			const e = s.map((x) => Math.exp((x - mx) / T));
			const Z = e.reduce((a, b) => a + b, 0);
			const q = new Array(s.length).fill(0);
			let qz = 0;
			p.pickIdx.forEach((ri, k) => {
				q[ri] = p.pickW[k] * e[ri];
				qz += q[ri];
			});
			p.rows.forEach((r, ri) => {
				const d = (e[ri] / Z - q[ri] / qz) / T;
				if (Math.abs(d) < 1e-9) return;
				for (let i = 0; i < NT; i++) if (r.f[i] !== 0) g[i] += d * r.f[i];
				for (let i = 0; i < NC; i++)
					if (r.cls[i] !== 0) g[NT + i] += d * r.cls[i];
				g[NT + NC + FAM_I[r.fam]] += d;
				g[NP - 1] += d * lp.byFam[r.fam];
			});
		});
		const n = players.length;
		for (let i = 0; i < NP; i++) {
			const gr = g[i] / n + lambda * (w[i] - w0[i]);
			m[i] = 0.9 * m[i] + 0.1 * gr;
			v[i] = 0.999 * v[i] + 0.001 * gr * gr;
			w[i] -=
				(lr * (m[i] / (1 - 0.9 ** it))) /
				(Math.sqrt(v[i] / (1 - 0.999 ** it)) + 1e-8);
		}
	}
	return w;
};

// The pick under params, the family gate and the close-call rule (as classify.ts does it)
const pickOf = (p, lp, w, x) => {
	const s = scoresOf(p, lp, w).map(
		(z, ri) =>
			z -
			(x.gate > 0 && lp.topP >= x.tau && p.rows[ri].fam !== lp.top
				? x.gate
				: 0),
	);
	const order = s.map((z, i) => i).sort((a, b) => s[b] - s[a]);
	let first = order[0];
	const second = order[1];
	if (
		p.stats &&
		second !== undefined &&
		s[first] - s[second] < x.tieMargin &&
		x.tieStatsK *
			(statAlignment(p.rows[second].a, p.stats) -
				statAlignment(p.rows[first].a, p.stats)) >
			s[first] - s[second]
	)
		first = second;
	return { first, order };
};
const evaluate = (players, lps, w, x) => {
	let n = 0,
		t1 = 0,
		t3 = 0,
		fam = 0,
		first = 0,
		loss = 0;
	const byPop = {};
	players.forEach((p, pi) => {
		if (p.pickIdx.length === 0) return;
		const { first: f, order } = pickOf(p, lps[pi], w, x);
		const hit = p.pickIdx.includes(f);
		n++;
		if (hit) t1++;
		const distinct = [];
		for (const i of order) {
			if (!distinct.some((d) => p.rows[d].a.id === p.rows[i].a.id))
				distinct.push(i);
			if (distinct.length === 3) break;
		}
		if (distinct.some((i) => p.pickIdx.includes(i))) t3++;
		if (p.famSet.has(p.rows[f].fam)) fam++;
		if (p.rows[f].a.id === p.ids[0]) first++;
		const b = (byPop[p.pop] ??= { n: 0, t1: 0, fam: 0 });
		b.n++;
		if (hit) b.t1++;
		if (p.famSet.has(p.rows[f].fam)) b.fam++;
		const s = scoresOf(p, lps[pi], w);
		const mx = Math.max(...s);
		const Z = s.reduce((a, z) => a + Math.exp((z - mx) / T), 0);
		const qz = p.pickIdx.reduce(
			(a, ri, k) => a + p.pickW[k] * Math.exp((s[ri] - mx) / T),
			0,
		);
		loss += -Math.log(qz / Z);
	});
	return {
		n,
		top1: t1 / n,
		top3: t3 / n,
		fam: fam / n,
		first: first / n,
		loss: loss / n,
		byPop,
	};
};

const pct = (x) => `${(100 * x).toFixed(1)}%`;
// (the hand settings had no trait terms)
const handW = () =>
	TERMS.map((t) =>
		t.startsWith("tr") ? 0 : t === "sub" || t === "playType" ? 0 : 1,
	).concat(
		CLASS_FEATS.map(() => 0),
		FAMILIES.map(() => 0),
		[0],
	);
const handLp = (players) =>
	players.map(() => ({
		byFam: Object.fromEntries(FAMILIES.map((f) => [f, 0])),
		top: undefined,
		topP: 0,
	}));
const HAND_X = { tau: 1.01, gate: 0, tieMargin: 0, tieStatsK: 0 };

test.skipIf(!process.env.RUN_ARCHETYPE_FIT)(
	"fit the reading to the judged set",
	() => {
		const all = judgedPlayers();
		const tune = all.filter((p) => p.j.split === "tune");
		const testSet = all.filter((p) => p.j.split === "test");
		const out = [
			`judged ${all.length} (tune ${tune.length}, test ${testSet.length}), expanded ratings ${EXPANDED ? "ON" : "off"}`,
		];
		const hw = handW();
		const show = (label, e) =>
			`${label}: top-1 ${pct(e.top1)} (first pick ${pct(e.first)}), top-3 ${pct(e.top3)}, family ${pct(e.fam)}, loss ${e.loss.toFixed(3)} (n=${e.n}); ${Object.entries(
				e.byPop,
			)
				.map(
					([k, b]) =>
						`${k} ${pct(b.t1 / b.n)} / fam ${pct(b.fam / b.n)} (n=${b.n})`,
				)
				.join(", ")}`;
		// arch15: the shipped model (fitted.data.ts / fittedExpanded.data.ts) as it reads now
		{
			const m = structuredClone(
				process.env.ARCH_MODEL
					? JSON.parse(readFileSync(process.env.ARCH_MODEL, "utf8"))
					: modelFor(EXPANDED),
			);
			// (ARCH_THETA="sub=0.3,match=1.1": try other term weights)
			for (const kv of (process.env.ARCH_THETA ?? "").split(",")) {
				const [k, v] = kv.split("=");
				if (k && v !== undefined) m.theta[k] = Number(v);
			}
			const wm = [
				...TERMS.map((t) => m.theta[t] ?? 0),
				...CLASS_FEATS.map((c) => m.cls[c] ?? 0),
				...FAMILIES.map((f) => m.famBias[f] ?? 0),
				m.gamma,
			];
			const xm = {
				tau: m.tau,
				gate: m.gate,
				tieMargin: m.tieMargin,
				tieStatsK: m.tieStatsK,
			};
			const lpOf = (ps) =>
				m.gamma === 0 && m.gate === 0 ? handLp(ps) : famLogP(ps, m.famW);
			out.push(show("shipped, tune", evaluate(tune, lpOf(tune), wm, xm)));
			out.push(show("shipped, test", evaluate(testSet, lpOf(testSet), wm, xm)));
			// arch15: the re-judging dossier: every judged player whose reading with sub-ratings disagrees with the judge,
			// with the sub-rating evidence for each build (subStyle.ts subTerm, before weighting)
			if (process.env.ARCH_FIT_DOSSIER) {
				const SI = TERMS.indexOf("sub");
				const lines = [];
				all.forEach((p) => {
					const lp = lpOf([p])[0];
					const { first, order } = pickOf(p, lp, wm, xm);
					const subs = p.style.sub
						? Object.entries(p.style.sub)
								.filter(([, v]) => Math.abs(v) >= 1)
								.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
								.map(([k, v]) => `${k} ${v.toFixed(1)}`)
								.join(", ")
						: "none";
					const cls = Object.entries(p.cv)
						.filter(([k]) => !["def", "score", "stre"].includes(k))
						.sort((x, y) => y[1] - x[1])
						.slice(0, 4)
						.map(([k, v]) => `${k} ${v.toFixed(1)}`)
						.join(", ");
					const show = (i) =>
						`${p.rows[i].a.name} [${p.rows[i].fam}] sub ${p.rows[i].f[SI].toFixed(2)}`;
					const judged = p.pickIdx.map(show).join(" / ");
					const hit = p.pickIdx.includes(first);
					lines.push(
						`${hit ? "ok  " : "MISS"} ${p.j.split} ${p.pop} | ${p.j.key} (${p.pos}) | classes ${cls} | subs ${subs}\n    judged: ${judged}\n    model:  ${order
							.slice(0, 4)
							.map(show)
							.join(" / ")}`,
					);
				});
				writeFileSync(process.env.ARCH_FIT_DOSSIER, lines.join("\n") + "\n");
				const js = all.map((p) => {
					const lp = lpOf([p])[0];
					const { first, order } = pickOf(p, lp, wm, xm);
					const top2 = Object.entries(p.cv)
						.filter(([k]) => !["def", "score", "stre"].includes(k))
						.sort((x, y) => y[1] - x[1])
						.slice(0, 2)
						.map(([k]) => k);
					const info = (i) => ({
						id: p.rows[i].a.id,
						name: p.rows[i].a.name,
						fam: p.rows[i].fam,
						sub: p.rows[i].f[SI],
						lead: promisesOf(p.rows[i].a).lead,
						kept: Object.values(promiseChecks(p.rows[i].a, p.cv)).every(
							Boolean,
						),
					});
					return {
						key: p.j.key,
						split: p.j.split,
						pop: p.pop,
						ids: p.j.ids,
						judged: p.pickIdx.map(info),
						model: order.slice(0, 5).map(info),
						first: p.rows[first].a.id,
						top2,
						hasSub: !!p.style.sub,
					};
				});
				writeFileSync(
					process.env.ARCH_FIT_DOSSIER + ".json",
					JSON.stringify(js),
				);
			}
			if (process.env.ARCH_FIT_EVAL) {
				const lines = all.map((p, pi) => {
					const lp = lpOf([p])[0];
					const { first, order } = pickOf(p, lp, wm, xm);
					const hit = p.pickIdx.includes(first);
					return `${hit ? "ok  " : "MISS"}\t${p.j.split}\t${p.pop}\t${p.j.key}\t${p.j.pos}\tgot ${p.rows[first].a.name} [${p.rows[first].fam}]\tjudged ${p.j.ids.map((id) => ARCHETYPES.find((q) => q.id === id)?.name ?? id).join(" / ")}\trunners ${order
						.slice(1, 4)
						.map((i) => p.rows[i].a.name)
						.join(", ")}`;
				});
				writeFileSync(
					process.env.ARCH_FIT_OUT ?? "/tmp/arch-fit-eval.txt",
					out.join("\n") + "\n" + lines.join("\n") + "\n",
				);
				return;
			}
		}
		out.push(show("before, tune", evaluate(tune, handLp(tune), hw, HAND_X)));
		out.push(
			show("before, test", evaluate(testSet, handLp(testSet), hw, HAND_X)),
		);
		// Cross-validation folds over the tuning split (fixed: by position in the list)
		const folds = tune.map((_, i) => i % FOLDS);
		const grid = [];
		for (const lamF of [0.003, 0.01])
			for (const lam of [0.3, 1, 3]) grid.push({ lamF, lam });
		const xs = [];
		for (const tau of [1.01, 0.8, 0.65, 0.5])
			for (const gate of tau > 1 ? [0] : [0.25, 0.5, 1])
				for (const tieMargin of [0, 0.15, 0.3])
					for (const tieStatsK of tieMargin > 0 ? [1, 2, 4] : [0])
						xs.push({ tau, gate, tieMargin, tieStatsK });
		let best;
		for (const g of grid) {
			// per fold: fit on the rest, score the fold under every gate / close-call setting
			const foldRes = [];
			for (let k = 0; k < FOLDS; k++) {
				const tr = tune.filter((_, i) => folds[i] !== k);
				const va = tune.filter((_, i) => folds[i] === k);
				const famW = fitFamily(tr, g.lamF);
				const w = fitRanker(tr, famLogP(tr, famW), g.lam);
				const lpVa = famLogP(va, famW);
				foldRes.push(xs.map((x) => evaluate(va, lpVa, w, x)));
			}
			for (const [xi, x] of xs.entries()) {
				const n = foldRes.reduce((a, r) => a + r[xi].n, 0);
				const top1 = foldRes.reduce((a, r) => a + r[xi].top1 * r[xi].n, 0) / n;
				const loss = foldRes.reduce((a, r) => a + r[xi].loss * r[xi].n, 0) / n;
				const fam = foldRes.reduce((a, r) => a + r[xi].fam * r[xi].n, 0) / n;
				const cand = { ...g, ...x, top1, loss, fam };
				if (
					!best ||
					top1 > best.top1 + 1e-9 ||
					(Math.abs(top1 - best.top1) < 1e-9 && loss < best.loss)
				)
					best = cand;
			}
			out.push(
				`cv lamF ${g.lamF} lam ${g.lam}: best top-1 so far ${pct(best.top1)}`,
			);
		}
		out.push(`chosen: ${JSON.stringify(best)}`);
		const famW = fitFamily(tune, best.lamF);
		const w = fitRanker(tune, famLogP(tune, famW), best.lam);
		const x = {
			tau: best.tau,
			gate: best.gate,
			tieMargin: best.tieMargin,
			tieStatsK: best.tieStatsK,
		};
		out.push(show("after, tune", evaluate(tune, famLogP(tune, famW), w, x)));
		out.push(
			show("after, test", evaluate(testSet, famLogP(testSet, famW), w, x)),
		);
		// ablations on the test split: without the trait terms (Player Traits off), without the family terms, without the
		// close-call rule
		const wt = [...w];
		TERMS.forEach((t, i) => t.startsWith("tr") && (wt[i] = 0));
		out.push(
			show(
				"after, test, traits off",
				evaluate(testSet, famLogP(testSet, famW), wt, x),
			),
		);
		const w0 = [...w];
		w0[NP - 1] = 0;
		out.push(
			show(
				"after, test, no family terms",
				evaluate(testSet, famLogP(testSet, famW), w0, { ...x, gate: 0 }),
			),
		);
		out.push(
			show(
				"after, test, no close-call rule",
				evaluate(testSet, famLogP(testSet, famW), w, { ...x, tieMargin: 0 }),
			),
		);
		const r4 = (v) => Math.round(v * 1000) / 1000;
		const model = toModel(
			w.map(r4),
			Object.fromEntries(
				Object.entries(famW).map(([f, ws]) => [f, ws.map(r4)]),
			),
			x,
		);
		out.push(`weights: ${TERMS.map((t, i) => `${t} ${r4(w[i])}`).join(", ")}`);
		out.push(
			`skill classes: ${CLASS_FEATS.map((c, i) => `${c} ${r4(w[NT + i])}`).join(", ")}`,
		);
		out.push(
			`family biases: ${FAMILIES.map((f, i) => `${f} ${r4(w[NT + NC + i])}`).join(", ")}; gamma ${r4(w[NP - 1])}`,
		);
		// per-player listing of the test split (judge vs before vs after)
		const lpT = famLogP(testSet, famW);
		const hl = handLp(testSet);
		const rowsOut = testSet.map((p, pi) => {
			const b = p.rows[pickOf(p, hl[pi], hw, HAND_X).first].a.name;
			const a = p.rows[pickOf(p, lpT[pi], w, x).first].a.name;
			return `${p.j.key}\t${p.j.pos}\t${b}\t${p.j.ids.map((id) => ARCHETYPES.find((q) => q.id === mergedId(id))?.name ?? id).join(" / ")}\t${a}`;
		});
		if (process.env.ARCH_FIT_OUT) {
			writeFileSync(
				process.env.ARCH_FIT_OUT + ".model.json",
				JSON.stringify(model),
			);
			writeFileSync(process.env.ARCH_FIT_OUT, out.join("\n") + "\n");
			writeFileSync(
				process.env.ARCH_FIT_OUT + ".test.tsv",
				rowsOut.join("\n") + "\n",
			);
		}
		const src = `// GENERATED by fit.script.test.ts (RUN_ARCHETYPE_FIT=1${EXPANDED ? ", ARCH_EXPANDED=1" : ""}) from the judged set (judged.data.ts). Do not edit by hand.
// ${out.filter((l) => l.startsWith("before") || l.startsWith("after")).join("\n// ")}
import type { FittedModel } from "./model.ts";

export const ${EXPANDED ? "FITTED_EXPANDED" : "FITTED"}: FittedModel = ${JSON.stringify(model)};
`;
		if (!process.env.ARCH_FIT_DRY)
			writeFileSync(
				new URL(
					EXPANDED ? "./fittedExpanded.data.ts" : "./fitted.data.ts",
					import.meta.url,
				),
				src,
			);
	},
	3600000,
);
