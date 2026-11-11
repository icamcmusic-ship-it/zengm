/* eslint-disable no-undef, curly, unicorn/prefer-single-call */
// @ts-nocheck
// Diagnostics for the archetype engine over large populations: random-player leagues (developed draft classes), aged
// veterans, raw draft prospects, real NBA ratings (data/real-player-data.basketball.json, when present) and the same players
// season after season. Measures coverage (how good a fit the best archetype is), mismatches between the label and the
// ratings (an independent keyword audit: a "shooter" must actually shoot, a rim protector block shots, ...), position
// conflicts, overused and never-used archetypes and year-to-year stability.
// Not part of the normal run: RUN_ARCHETYPE_DIAG=1 (writes ARCH_DIAG_OUT, default /tmp/claude-0/arch-diag.txt)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
import { ARCHETYPES, classify, defaultNorms, scoreAll } from "./classify.ts";
import { sampleTraits } from "./sample.testutil.ts";
import { compositeValues } from "./composites.ts";
import { buildNorms } from "./match.ts";
import { probit, rawZ } from "./norms.ts";
import { classValues, needShortfall, prepare, twoWaySides } from "./score.ts";
import {
	HARD_BLOCK,
	nameContradictsPosition,
	namesContradict,
	positionFor,
} from "./position.ts";

// ARCH_DIAG_EXPANDED=1: every population with the Expanded Ratings setting on (generated players get wingspan and
// perimeter/interior defense from the generator, real players the derived ones a real-players league gets)
const EXPANDED = Boolean(process.env.ARCH_DIAG_EXPANDED);
const NORMS = defaultNorms(EXPANDED);
// ARCH_DIAG_TRAITS=1: every player also has player traits (the playerTraits setting), visible ones as the archetypes read them
const TRAITS = Boolean(process.env.ARCH_DIAG_TRAITS);
const traitsFor = (p, i, pop) =>
	TRAITS ? sampleTraits(p.ratings, p.age, `diag-traits-${pop}`, i) : undefined;
const newG = () => {
	resetG();
	if (EXPANDED) g.setWithoutSavingToDB("expandedRatings", true);
};
// ARCH_DIAG_TW=file: every strict two-way player whose label is one-way, with what the engine saw
const TW = process.env.ARCH_DIAG_TW ? [] : undefined;
const OUT = process.env.ARCH_DIAG_OUT ?? "/tmp/claude-0/arch-diag.txt";
// ARCH_DIAG_DUMP=file: every labelled player as JSON rows [population, name, pos, age, label], to compare two versions
const DUMP = process.env.ARCH_DIAG_DUMP ? [] : undefined;

// Independent audit of what a label promises: [name pattern, check(ratings, absolute z per dim), what is wrong]
const AUDIT = [
	[
		/Shoot|Sniper|3-and-D|Stretch|Corner|Spot-Up|Pick-and-Pop|Marksman|Gunner|Floor Spacer|Bomber|Step-Back/,
		(r, a) => r.tp >= 50 || a.three >= 0.25,
		"shooting label, cannot shoot (tp < 50)",
	],
	[
		/Rim Protector|Swat|Shot-Block|Anchor|Shot Blocker|Eraser|Paint Protector|Guardian|Erasing|Backline|Curtain/,
		(r, a) => a.blk >= 0.5 && r.hgt >= 45,
		"rim protection label, low blk/hgt",
	],
	[
		/Floor General|Playmak|Pass-First|Point (Forward|Center|God)|Hub|Table Setter|Facilitator|Jumbo|Dot Dispenser|Engine/,
		(r, a) => a.pss >= 0.4,
		"playmaking label, cannot pass",
	],
	[
		/Lockdown|Defensive|Defender|Disruptor|Stopper|Pest|Hawk|Thief|Two-Way|Switch|Perimeter Lock|Point of Attack|Clamp|Curtain/,
		// With expanded ratings: the defense rating of the side the label names (perimeter for these names), else his better one
		(r, a, sz, name) =>
			(r.pdef === undefined
				? r.diq
				: /Lockdown|Stopper|Pest|Hawk|Thief|Disruptor|Perimeter Lock|Point of Attack|Clamp/.test(
							name,
					  )
					? r.pdef
					: /Paint/.test(name)
						? r.idef
						: Math.max(r.pdef, r.idef)) >= 45 &&
			// (a veteran defender is the one label about instincts that outlast the legs)
			(/Veteran/.test(name) || a.dper >= 0 || a.dint >= 0 || a.blk >= 0),
		"defensive label, poor defender",
	],
	[
		/Athletic|High-Flyer|Explosive|Rim-Running|Lob Threat|Freak|Rim Runner/,
		(r, a) => a.ath >= 0.3,
		"athletic label, not athletic",
	],
	[
		/Rebound|Glass|Double-Double|Putback|Board|Box-Out|Cleaner/,
		(r, a, sz) => sz.reb >= 0.3,
		"rebounding label, poor rebounder",
	],
	[
		/Post|Interior Scorer|Paint Beast|Low-Post|Block Bully/,
		(r, a, sz) => sz.post >= 0.3,
		"post label, no post game",
	],
	[
		/Slash|Penetrator|Rim Attacker|Downhill|Driver/,
		(r, a, sz) => sz.rim >= 0 && a.drb >= -0.3,
		"slashing label, cannot attack the rim",
	],
	// Length labels: his wingspan (on the height scale) against his height
	[
		/Long-Armed|Rangy|Long Wing/,
		(r) => r.wng === undefined || r.wng - r.hgt >= 3,
		"length label, ordinary wingspan",
	],
	[
		/Short-Armed/,
		(r) => r.wng !== undefined && r.wng - r.hgt <= -3,
		"short-armed label, ordinary wingspan",
	],
	[
		/Handles|Shot Creator|Shot-Creating|Iso|Shifty|Pressure-Proof|Loose-Handle|Ankle/,
		(r, a) => a.drb >= 0.5,
		"handle label, poor handle",
	],
	[
		/Crafty Finisher|Paint Finisher|Two-Way Finisher|Layup|Dunker/,
		(r, a, sz) => sz.rim >= 0,
		"finishing label, cannot finish",
	],
	[/Chase-Down/, (r, a, sz) => sz.blk >= 0.3, "shot-blocking guard, no blocks"],
];

const ratingsOfRow = (row) => {
	const r = {};
	for (const k of RATING_KEYS) r[k] = row[k];
	if (EXPANDED && typeof row.wng === "number") {
		r.wng = row.wng;
		r.pdef = row.pdef;
		r.idef = row.idef;
		// (the second step: without these the row does not count as having expanded ratings at all)
		for (const k of EXPANDED_RATINGS2) r[k] = row[k];
	}
	return r;
};

const absZ = (r, norms = NORMS) => {
	const v = compositeValues(r);
	const z = {};
	for (const k of Object.keys(v)) z[k] = rawZ(norms.q[k], v[k]);
	return z;
};

// Skill for his size (height's share taken out), computed here so the audit does not depend on the engine version
const sizeZ = (a, norms = NORMS) => {
	const z = {};
	for (const k of Object.keys(a)) {
		const b = norms.beta[k] ?? 0;
		z[k] = (a[k] - b * a.hgt) / Math.max(Math.sqrt(1 - b * b), 0.55);
	}
	return z;
};

// Descriptor agreement: an independent "standout skills" reading of each player (his composite ratings ranked against
// the population's players at his position, as z) against what his label (primary + secondary) features. A label
// features a skill class when its profile weights it >= 2 (in full) or >= 1.5 (half).
const CLASSES = [
	["shoot", ["three"]],
	["mid", ["mid"]],
	["finish", ["rim", "draw"]],
	["post", ["post"]],
	["handle", ["drb"]],
	["pass", ["pss"]],
	["reb", ["reb"]],
	["rimD", ["blk", "dint"]],
	["perD", ["dper", "stl"]],
	["ath", ["ath"]],
	// Not skill classes: defensive IQ, so a defensive standout can be told from speed or size alone (with expanded
	// ratings: the perimeter and the interior defense rating, each for its side)
	["iq", ["diq"]],
	["pd", ["pdef"]],
	["id", ["idef"]],
];
const NOT_CLASS = new Set(["iq", "pd", "id"]);
const DIM2CLASS = {
	three: "shoot",
	mid: "mid",
	rim: "finish",
	draw: "finish",
	post: "post",
	drb: "handle",
	pss: "pass",
	reb: "reb",
	blk: "rimD",
	dint: "rimD",
	dper: "perD",
	stl: "perD",
	ath: "ath",
	spd: "ath",
	jmp: "ath",
};
const claimsOf = (a) => {
	const c = {};
	for (const [d, w] of Object.entries(a.w)) {
		const k = DIM2CLASS[d];
		if (!k) continue;
		const v = w >= 2 ? 1 : w >= 1.5 ? 0.5 : 0;
		if (v > (c[k] ?? 0)) c[k] = v;
	}
	if ((a.w.diq ?? 0) >= 2) {
		const k = a.group === "big" ? "rimD" : "perD";
		c[k] = Math.max(c[k] ?? 0, 0.5);
	}
	// A label keyed on the perimeter or the interior defense rating (defensive IQ without expanded ratings)
	if ((a.w.pdef ?? 0) >= 2) c.perD = Math.max(c.perD ?? 0, 0.5);
	if ((a.w.idef ?? 0) >= 2) c.rimD = Math.max(c.rimD ?? 0, 0.5);
	return c;
};
const BUCKET = {
	PG: "PG",
	G: "PG",
	SG: "SG",
	GF: "W",
	SF: "W",
	F: "F",
	PF: "F",
	FC: "C",
	C: "C",
};
const peerZ = (players) => {
	const vals = players.map((p) => ({
		...compositeValues(p.ratings),
		pdef: (p.ratings.pdef ?? p.ratings.diq) / 100,
		idef: (p.ratings.idef ?? p.ratings.diq) / 100,
	}));
	const by = {};
	players.forEach((p, i) => (by[BUCKET[p.dpos]] ??= []).push(i));
	const zs = players.map(() => ({}));
	for (const idx of Object.values(by)) {
		for (const [k, dims] of CLASSES) {
			for (const d of dims) {
				const sorted = idx.map((i) => vals[i][d]).sort((x, y) => x - y);
				for (const i of idx) {
					const v = vals[i][d];
					let lo = 0;
					let hi = sorted.length;
					while (lo < hi) {
						const m = (lo + hi) >> 1;
						if (sorted[m] < v) lo = m + 1;
						else hi = m;
					}
					let hi2 = lo;
					while (hi2 < sorted.length && sorted[hi2] === v) hi2++;
					const z = probit(
						Math.min(0.995, Math.max(0.005, (lo + hi2) / 2 / sorted.length)),
					);
					zs[i][k] = Math.max(zs[i][k] ?? -9, z);
				}
			}
		}
	}
	return zs;
};
const OFF = new Set(["shoot", "mid", "finish", "post", "handle", "pass"]);
const DEF = new Set(["rimD", "perD"]);
// rows: { p, c (classification), scored } with p.dpos set
const descriptor = (rows, out, pop) => {
	const zs = peerZ(rows.map((r) => r.p));
	const claims = new Map(ARCHETYPES.map((a) => [a.id, claimsOf(a)]));
	let nStand = 0,
		agree = 0,
		better = 0,
		top1 = 0,
		top1Hit = 0,
		lacks = 0;
	const f = {
		sh: 0,
		shMiss: 0,
		pb: 0,
		pbMiss: 0,
		tw: 0,
		twMiss: 0,
		pb2: 0,
		pb2Miss: 0,
		tw2: 0,
		tw2Miss: 0,
		tw3: 0,
		tw3Miss: 0,
	};
	const betterBy = {};
	// Gaps: how well each (position, top-two standout skills) profile is named
	const pairs = {};
	const twLine = (kind, r, z, t2) => {
		const bestZ = r.scored[0].z;
		const alt = r.scored.find((s) => {
			const ca = claims.get(s.a.id);
			return (
				s.z > -50 &&
				Object.keys(ca).some((k) => OFF.has(k) && ca[k] >= 0.5) &&
				Object.keys(ca).some((k) => DEF.has(k) && ca[k] >= 0.5)
			);
		});
		const pp = { ...prepare(r.p.ratings, r.p.norms ?? NORMS), age: r.p.age };
		const ecv = classValues(pp);
		const sides = twoWaySides(ecv, r.p.ratings.hgt);
		TW.push(
			`${kind}|${pop}|${r.p.name ?? ""} ${r.p.dpos} age${r.p.age} hgt${r.p.ratings.hgt} ovr${r.p.ovr} [${t2.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(", ")}; pd ${z.pd.toFixed(1)} id ${z.id.toFixed(1)}] -> ${r.c.label} (z ${bestZ.toFixed(2)}); best two-way label: ${alt ? `${alt.a.id} ${(alt.z - bestZ).toFixed(2)} short ${needShortfall(alt.a, pp, true).toFixed(2)}` : "none"}; engine cv ${t2.map(([k]) => `${k} ${ecv[k].toFixed(1)}`).join(", ")} perD ${ecv.perD.toFixed(1)} rimD ${ecv.rimD.toFixed(1)} sides ${sides.off.toFixed(1)}/${sides.def.toFixed(1)} lvl ${pp.level.toFixed(1)}`,
		);
	};
	rows.forEach((r, i) => {
		const z = zs[i];
		// Star labels (by design for a level of play, not a skill pair) are left out of the three checks below
		const star = r.c.tags.includes("star");
		const cl = { ...claims.get(r.c.id) };
		if (r.c.secondary)
			for (const [k, v] of Object.entries(claims.get(r.c.secondary.id)))
				cl[k] = Math.max(cl[k] ?? 0, 0.75 * v);
		if (
			Object.entries(claims.get(r.c.id)).some(
				([k, v]) => v >= 1 && z[k] < -0.25,
			)
		)
			lacks++;
		const stand = Object.entries(z)
			.filter(([k, v]) => v >= 1 && !NOT_CLASS.has(k))
			.sort((x, y) => y[1] - x[1]);
		const top = stand.slice(0, 2).map(([k]) => k);
		const cov = (c) => top.reduce((t, k) => t + (c[k] ?? 0), 0) / top.length;
		if (top.length) {
			nStand++;
			const c0 = cov(cl);
			agree += c0;
			if (!star) {
				const key = `${BUCKET[r.p.dpos]}:${[...top].sort().join("+")}`;
				const e = (pairs[key] ??= { n: 0, c: 0, labels: {} });
				e.n++;
				e.c += c0;
				if (c0 < 0.75) e.labels[r.c.id] = (e.labels[r.c.id] ?? 0) + 1;
			}
			const bestZ = r.scored.find((s) => s.a.id === r.c.id).z;
			for (const s of r.scored) {
				if (s.z < bestZ - 0.5) break;
				if (s.a.id === r.c.id) continue;
				const ca = claims.get(s.a.id);
				if (Object.entries(ca).some(([k, v]) => v >= 1 && z[k] < 0)) continue;
				if (cov(ca) >= c0 + 0.49) {
					better++;
					betterBy[r.c.id] = (betterBy[r.c.id] ?? 0) + 1;
					break;
				}
			}
		}
		if (stand.length && stand[0][1] >= 1.25) {
			top1++;
			if (cl[stand[0][0]]) top1Hit++;
		}
		if (!star && z.shoot >= 1.5 && r.p.ratings.tp >= 70) {
			f.sh++;
			if (!cl.shoot) f.shMiss++;
		}
		if (
			!star &&
			(BUCKET[r.p.dpos] === "C" || BUCKET[r.p.dpos] === "F") &&
			z.pass >= 1.5 &&
			r.p.ratings.pss >= 55
		) {
			f.pb++;
			if (!cl.pass) f.pbMiss++;
		}
		const t2 = stand.slice(0, 2).filter(([, v]) => v >= 1.2);
		if (
			!star &&
			t2.length === 2 &&
			t2.some(([k]) => OFF.has(k)) &&
			t2.some(([k]) => DEF.has(k))
		) {
			f.tw++;
			const o = Object.keys(cl).some((k) => OFF.has(k) && cl[k] >= 0.5);
			const d =
				Object.keys(cl).some((k) => DEF.has(k) && cl[k] >= 0.5) ||
				/Two-Way|Defend|3-and-D/.test(r.c.label);
			if (!(o && d)) f.twMiss++;
		}
		// Stricter readings of the two checks above. A passing big: a PF/FC/C whose passing is one of his top two standouts.
		// A two-way player: his top two standouts are a skill on offense (finishing only off the center spots) and a real
		// defensive one (with at least his peers' defensive IQ, not speed or size alone).
		if (
			!star &&
			["PF", "FC", "C"].includes(r.p.dpos) &&
			r.p.ratings.pss >= 55 &&
			top.includes("pass") &&
			z.pass >= 1.5
		) {
			f.pb2++;
			if (!cl.pass) f.pb2Miss++;
		}
		const off2 = (k) =>
			OFF.has(k) && (k !== "finish" || BUCKET[r.p.dpos] !== "C");
		if (
			!star &&
			t2.length === 2 &&
			t2.some(([k]) => off2(k)) &&
			t2.some(([k]) => DEF.has(k) && (k === "perD" ? z.pd : z.id) >= 0)
		) {
			f.tw2++;
			const o = Object.keys(cl).some((k) => OFF.has(k) && cl[k] >= 0.5);
			const d =
				Object.keys(cl).some((k) => DEF.has(k) && cl[k] >= 0.5) ||
				/Two-Way|Defend|3-and-D/.test(r.c.label);
			if (!(o && d)) {
				f.tw2Miss++;
				if (TW) twLine("strict", r, z, t2);
			}
		}
		// A real two-way player: a skill on offense well above his peers (one of his top two) and a defense rating
		// (perimeter or interior with expanded ratings, else defensive IQ) as far above them
		const offTop = stand.filter(([k]) => off2(k))[0];
		if (
			!star &&
			offTop &&
			offTop[1] >= 1.2 &&
			top.includes(offTop[0]) &&
			Math.max(z.pd, z.id) >= 1.2
		) {
			f.tw3++;
			const o = Object.keys(cl).some((k) => OFF.has(k) && cl[k] >= 0.5);
			const d =
				Object.keys(cl).some((k) => DEF.has(k) && cl[k] >= 0.5) ||
				/Two-Way|Defend|3-and-D/.test(r.c.label);
			if (!(o && d)) {
				f.tw3Miss++;
				if (TW) twLine("rating", r, z, stand.slice(0, 2));
			}
		}
	});
	out.push(
		`descriptor agreement: ${pct(agree, nStand)}% of top-2 standout skills (vs position peers) named by the label; top standout named ${pct(top1Hit, top1)}%; better fit available ${pct(better, nStand)}%; label features a skill he is below his peers at ${pct(lacks, rows.length)}%`,
	);
	out.push(
		`  least named profiles (position: standout skills, players, share named; most common labels of the unnamed): ${Object.entries(
			pairs,
		)
			.filter(([, e]) => e.n >= 12)
			.sort((x, y) => y[1].n - y[1].c - (x[1].n - x[1].c))
			.slice(0, 28)
			.map(
				([k, e]) =>
					`${k} ${e.n} ${pct(e.c, e.n)}% (${Object.entries(e.labels)
						.sort((x, y) => y[1] - x[1])
						.slice(0, 3)
						.map(([id, v]) => `${id} ${v}`)
						.join(", ")})`,
			)
			.join("; ")}`,
	);
	out.push(
		`  elite shooters not labelled shooters ${f.shMiss}/${f.sh}; passing bigs not labelled playmakers ${f.pbMiss}/${f.pb}; two-way players labelled one-way ${f.twMiss}/${f.tw}; stricter: passing bigs ${f.pb2Miss}/${f.pb2}, two-way ${f.tw2Miss}/${f.tw2}; offense standout + defense rating standout labelled one-way ${f.tw3Miss}/${f.tw3}; hybrids ${pct(rows.filter((r) => r.c.secondary).length, rows.length)}%; most "better fit": ${Object.entries(
			betterBy,
		)
			.sort((x, y) => y[1] - x[1])
			.slice(0, 8)
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`,
	);
};

const pct = (x, n) => ((100 * x) / Math.max(1, n)).toFixed(2);

const analyse = (label, players, out) => {
	const counts = {};
	const zs = [];
	let hard = 0;
	let audited = 0;
	let auditBad = 0;
	let hyb = 0;
	let nameBad = 0;
	let hybBad = 0;
	const nameEx = [];
	const badBy = {};
	const badEx = [];
	const gapEx = [];
	const lowZBy = {};
	const posTab = {};
	const rows = [];
	for (const [i, p] of players.entries()) {
		const ps = p.pos ?? positionFor(p.ratings, true);
		p.traits ??= traitsFor(p, i, label.slice(0, 8));
		const { scored } = scoreAll(
			p.ratings,
			p.norms ?? NORMS,
			ARCHETYPES,
			ps,
			p.age,
			p.traits,
		);
		const c = classify(p.ratings, {
			pos: ps,
			age: p.age,
			norms: p.norms,
			traits: p.traits,
		});
		const best = scored.find((s) => s.a.id === c.id);
		p.dpos = ps;
		rows.push({ p, c, scored });
		counts[c.id] = (counts[c.id] ?? 0) + 1;
		zs.push(best.z);
		if (best.z < 0) {
			lowZBy[c.id] = (lowZBy[c.id] ?? 0) + 1;
			if (gapEx.length < 10 && best.z < -0.5)
				gapEx.push(
					`${p.name ?? ""} ${ps} hgt${p.ratings.hgt} ovr${p.ovr} -> ${c.name} (z ${best.z.toFixed(2)})`,
				);
		}
		if (c.secondary) hyb++;
		// The label's name must not say he plays another position, and a hybrid's two names must not contradict
		if (
			nameContradictsPosition(c.name, ps) ||
			(c.secondary && nameContradictsPosition(c.secondary.name, ps))
		) {
			nameBad++;
			if (nameEx.length < 6) nameEx.push(`${ps} ${c.label}`);
		}
		if (c.secondary && namesContradict(c.name, c.secondary.name)) {
			hybBad++;
			if (nameEx.length < 12) nameEx.push(`hybrid ${ps} ${c.label}`);
		}
		if (DUMP) DUMP.push([label, p.name ?? "", ps, p.age, c.label]);
		posTab[ps] ??= {};
		posTab[ps][c.group] = (posTab[ps][c.group] ?? 0) + 1;
		if (!c.tags.includes("universal") && HARD_BLOCK[c.group].includes(ps))
			hard++;
		// (against the league he is read against)
		const a = absZ(p.ratings, p.norms);
		const sz = sizeZ(a, p.norms);
		let checked = false;
		for (const [re, ok, why] of AUDIT) {
			if (re.test(c.name)) {
				checked = true;
				if (!ok(p.ratings, a, sz, c.name)) {
					auditBad++;
					badBy[c.name] = (badBy[c.name] ?? 0) + 1;
					if (badEx.length < 25)
						badEx.push(
							`${p.name ?? ""} ${ps} hgt${p.ratings.hgt} ovr${p.ovr} -> ${c.name}: ${why} [tp${p.ratings.tp} pss${p.ratings.pss} diq${p.ratings.diq} reb${p.ratings.reb} blk${a.blk.toFixed(1)} ath${a.ath.toFixed(1)}]`,
						);
					break;
				}
			}
		}
		// A trait label must deliver its trait (as the user sees it)
		const ta = ARCHETYPES.find((x) => x.id === c.id);
		if (ta.trait) {
			checked = true;
			if ((p.traits?.[ta.trait.key] ?? 0) < ta.trait.min - 5) {
				auditBad++;
				badBy[c.name] = (badBy[c.name] ?? 0) + 1;
			}
		}
		if (checked) audited++;
	}
	const n = players.length;
	zs.sort((x, y) => x - y);
	const shares = Object.entries(counts)
		.map(([id, k]) => [id, (100 * k) / n])
		.sort((x, y) => y[1] - x[1]);
	const over4 = shares.filter((s) => s[1] > 4);
	// Raw prospects and veterans are not expected in every population
	const unused = ARCHETYPES.filter(
		(a) =>
			!counts[a.id] &&
			!a.age &&
			!a.level &&
			!(a.expanded && !EXPANDED) &&
			!(a.trait && !TRAITS),
	).map((a) => a.id);
	const rare01 = ARCHETYPES.filter(
		(a) => counts[a.id] && counts[a.id] / n < 0.001,
	).length;
	out.push(`\n=== ${label} (n=${n})`);
	out.push(
		`coverage: best-fit z median ${zs[Math.floor(n / 2)].toFixed(2)}, z<0 ${pct(zs.filter((z) => z < 0).length, n)}%, z<-0.5 ${pct(zs.filter((z) => z < -0.5).length, n)}%`,
	);
	out.push(
		`audit mismatches: ${pct(auditBad, n)}% of all players (${auditBad}/${audited} audited labels = ${pct(auditBad, audited)}%)`,
	);
	descriptor(rows, out, label.slice(0, 4));
	out.push(
		`names: position-name contradictions ${nameBad}, contradictory hybrid labels ${hybBad}${nameEx.length ? ` [${nameEx.join("; ")}]` : ""}`,
	);
	out.push(
		`position: hard conflicts ${hard}; hybrids ${pct(hyb, n)}%; pos x group ${JSON.stringify(posTab)}`,
	);
	out.push(
		`distribution: used ${Object.keys(counts).length}/${ARCHETYPES.length}, max ${shares[0][0]} ${shares[0][1].toFixed(2)}%, >4%: ${over4.map((s) => `${s[0]} ${s[1].toFixed(1)}`).join(", ") || "none"}, <0.1%: ${rare01}, unused (excl. raw/veteran) ${unused.length}${unused.length ? ` [${unused.join(" ")}]` : ""}`,
	);
	out.push(
		`top 12: ${shares
			.slice(0, 12)
			.map((s) => `${s[0]} ${s[1].toFixed(1)}`)
			.join(", ")}`,
	);
	const lowShare = Object.entries(lowZBy)
		.map(([id, k]) => [id, k, counts[id]])
		.sort((x, y) => y[1] - x[1])
		.slice(0, 8);
	out.push(
		`catch-alls (most poor-fit picks): ${lowShare.map(([id, k, t]) => `${id} ${k}/${t}`).join(", ")}`,
	);
	out.push(
		`worst audit labels: ${Object.entries(badBy)
			.sort((x, y) => y[1] - x[1])
			.slice(0, 12)
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`,
	);
	out.push("audit examples:\n  " + badEx.join("\n  "));
	out.push("gap examples:\n  " + gapEx.join("\n  "));
	return { counts, unused };
};

// BBGM's generator draws from Math.random: seed it too, so every population (and the metrics) are the same run to run
const seeded = async (seed, f) => {
	const r = new Rng(`${seed}-random`);
	// Not vi.spyOn: a spy records every call, millions of them here
	const orig = Math.random;
	Math.random = () => r.random();
	try {
		return await f();
	} finally {
		Math.random = orig;
	}
};

const genPlayers = (n, seed, minAge, maxAge, minOvr) =>
	seeded(seed, () => genPlayers1(n, seed, minAge, maxAge, minOvr));

const genPlayers1 = async (n, seed, minAge, maxAge, minOvr) => {
	newG();
	const rng = new Rng(seed);
	const out = [];
	while (out.length < n) {
		const k = rng.int(minAge - 19, maxAge - 19);
		const p = generate(-1, 19, 2025 - k, false, DEFAULT_LEVEL);
		if (k > 0) await develop(p, k, true);
		const row = p.ratings.at(-1);
		const o = ovrFn(row);
		if (o < minOvr) continue;
		out.push({ ratings: ratingsOfRow(row), ovr: o, age: 19 + k });
	}
	return out;
};

const realPlayers = () => {
	const file = new URL(
		"../../../data/real-player-data.basketball.json",
		import.meta.url,
	);
	if (!existsSync(file)) return [];
	const d = JSON.parse(readFileSync(file, "utf8"));
	const out = [];
	if (EXPANDED) {
		// As a real-players league with the setting on: derived from the other ratings, one wingspan per player
		const bySlug = {};
		for (const row of d.ratings) (bySlug[row.slug] ??= []).push(row);
		for (const [slug, rows] of Object.entries(bySlug)) {
			rows.sort((x, y) => x.season - y.season);
			fillExpandedRatings({ srID: slug, ratings: rows });
		}
	}
	for (const row of d.ratings) {
		if (row.season < 2016 || row.season > 2025) continue;
		const r = ratingsOfRow(row);
		out.push({
			ratings: r,
			ovr: ovrFn(r),
			name: `${d.bios[row.slug]?.name ?? row.slug} ${row.season}`,
			slug: row.slug,
			season: row.season,
			age: d.bios[row.slug]?.bornYear
				? row.season - d.bios[row.slug].bornYear
				: undefined,
		});
	}
	return out;
};

test.skipIf(!process.env.RUN_ARCHETYPE_DIAG)(
	"diag",
	async () => {
		const out = [
			`archetypes: ${ARCHETYPES.length}, expanded ratings ${EXPANDED ? "ON" : "off"}, player traits ${TRAITS ? "ON" : "off"}`,
		];
		const league = await genPlayers(6000, "diag-v2", 19, 32, 38);
		const all = { counts: {} };
		const r1 = analyse(
			"random players, developed (ages 19-32, ovr>=38)",
			league,
			out,
		);
		await analyse(
			"aged veterans (ages 32-37, ovr>=38)",
			await genPlayers(1500, "diag-old", 32, 37, 38),
			out,
		);
		await analyse(
			"draft prospects (age 19, undeveloped, any ovr)",
			await genPlayers(1500, "diag-pros", 19, 19, 0),
			out,
		);
		await analyse(
			"draft prospects, draftable (age 19, undeveloped, ovr>=40)",
			await genPlayers(1000, "diag-pros40", 19, 19, 40),
			out,
		);
		const real = realPlayers();
		if (real.length) analyse("real NBA ratings 2016-2025", real, out);
		// The same players as a real-players league reads them: each season against that season's own league
		if (real.length) {
			const bySeason = {};
			for (const p of real) (bySeason[p.season] ??= []).push(p);
			const own = [];
			for (const ps of Object.values(bySeason)) {
				const norms = {
					...buildNorms(
						ps.map((p) => ({
							ratings: p.ratings,
							ovr: p.ovr,
							pos: positionFor(p.ratings, true),
						})),
						ARCHETYPES,
						NORMS,
					),
					bias: NORMS.bias,
				};
				for (const p of ps) own.push({ ...p, norms });
			}
			analyse("own-league real NBA ratings 2016-2025", own, out);
		}
		void all;
		// Stability: the same players season after season, with stickiness and sticky improved positions as the game uses them
		const trans = {};
		let life = 0;
		let changes = 0,
			steps = 0,
			groupChanges = 0;
		await seeded("diag-flap", async () => {
			newG();
			const rng2 = new Rng("diag-flap");
			for (let i = 0; i < 6000; i++) {
				const p = generate(-1, 19, 2025 - rng2.int(0, 6), false, DEFAULT_LEVEL);
				const dev = rng2.int(0, 6);
				await develop(p, dev, true);
				let prev;
				let prevPos;
				for (let y = 0; y < 5; y++) {
					await develop(p, 1, false);
					const row = p.ratings.at(-1);
					if (ovrFn(row) < 38) continue;
					const r = ratingsOfRow(row);
					prevPos = positionFor(r, true, prevPos);
					const c = classify(r, {
						previousId: prev?.id,
						pos: prevPos,
						age: 20 + dev + y,
						traits: traitsFor({ ratings: r, age: 20 + dev + y }, i, "flap"),
					});
					if (prev) {
						steps++;
						if (prev.id !== c.id) {
							changes++;
							const k = `${prev.id}>${c.id}`;
							trans[k] = (trans[k] ?? 0) + 1;
							const lifecycle = (x) =>
								x.tags.includes("raw") || x.tags.includes("veteran");
							if (lifecycle(prev) || lifecycle(c)) life++;
						}
						if (prev.group !== c.group) groupChanges++;
					}
					prev = c;
				}
			}
		});
		out.push(
			`\n=== stability: archetype changes ${pct(changes, steps)}% of seasons, group changes ${pct(groupChanges, steps)}% (${steps} player-seasons); of the changes, ${pct(life, changes)}% are lifecycle (raw prospect -> developed, -> veteran). Top: ${Object.entries(
				trans,
			)
				.sort((x, y) => y[1] - x[1])
				.slice(0, 8)
				.map(([k, v]) => `${k} ${v}`)
				.join(", ")}`,
		);
		// Real players: famous examples
		const names = [
			"Stephen Curry",
			"LeBron James",
			"Nikola Jokic",
			"Rudy Gobert",
			"Giannis Antetokounmpo",
			"Kevin Durant",
			"Chris Paul",
			"Draymond Green",
			"Klay Thompson",
			"Joel Embiid",
			"Ben Simmons",
			"Brook Lopez",
			"Marcus Smart",
			"Clint Capela",
			"Kyle Korver",
			"Russell Westbrook",
			"Victor Wembanyama",
			"Luka Doncic",
			"Mikal Bridges",
			"Steven Adams",
			"Tony Allen",
			"Andre Drummond",
		];
		const latest = {};
		for (const p of real)
			if (!latest[p.slug] || latest[p.slug].season < p.season)
				latest[p.slug] = p;
		const ex = [];
		for (const p of Object.values(latest)) {
			if (names.some((nm) => p.name.startsWith(nm + " "))) {
				const ps = positionFor(p.ratings, true);
				const c = classify(p.ratings, {
					pos: ps,
					age: p.age,
					traits: traitsFor(p, 0, p.slug),
				});
				ex.push(`${p.name} ${ps}: ${c.label}`);
			}
		}
		out.push("\n=== real examples\n  " + ex.sort().join("\n  "));
		out.push(
			"\n=== shares (random league)\n" +
				ARCHETYPES.map((a) => [a.id, (100 * (r1.counts[a.id] ?? 0)) / 6000])
					.sort((x, y) => y[1] - x[1])
					.map(([id, s]) => `${id} ${s.toFixed(2)}`)
					.join("\n"),
		);
		mkdirSync(dirname(OUT), { recursive: true });
		writeFileSync(OUT, out.join("\n") + "\n");
		if (DUMP) writeFileSync(process.env.ARCH_DIAG_DUMP, JSON.stringify(DUMP));
		if (TW) writeFileSync(process.env.ARCH_DIAG_TW, TW.join("\n") + "\n");
	},
	1800000,
);
