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
import { ARCHETYPES, classify, scoreAll } from "./classify.ts";
import { compositeValues } from "./composites.ts";
import { DEFAULT_NORMS } from "./norms.data.ts";
import { probit, rawZ } from "./norms.ts";
import { HARD_BLOCK, positionFor } from "./position.ts";

const OUT = process.env.ARCH_DIAG_OUT ?? "/tmp/claude-0/arch-diag.txt";

// Independent audit of what a label promises: [name pattern, check(ratings, absolute z per dim), what is wrong]
const AUDIT = [
	[
		/Shoot|Sniper|3-and-D|Stretch|Corner|Spot-Up|Pick-and-Pop|Marksman|Gunner|Floor Spacer|Bomber/,
		(r, a) => r.tp >= 50 || a.three >= 0.25,
		"shooting label, cannot shoot (tp < 50)",
	],
	[
		/Rim Protector|Swat|Shot-Block|Anchor|Shot Blocker|Eraser|Paint Protector/,
		(r, a) => a.blk >= 0.5 && r.hgt >= 45,
		"rim protection label, low blk/hgt",
	],
	[
		/Floor General|Playmak|Pass-First|Point (Forward|Center|God)|Hub|Table Setter|Facilitator|Jumbo/,
		(r, a) => a.pss >= 0.4,
		"playmaking label, cannot pass",
	],
	[
		/Lockdown|Defensive|Stopper|Pest|Hawk|Thief|Two-Way|Switch|Perimeter Lock|Point of Attack/,
		(r, a) => r.diq >= 45 && (a.dper >= 0 || a.dint >= 0 || a.blk >= 0),
		"defensive label, poor defender",
	],
	[
		/Athletic|High-Flyer|Explosive|Rim-Running|Lob Threat|Freak|Rim Runner/,
		(r, a) => a.ath >= 0.3,
		"athletic label, not athletic",
	],
	[
		/Rebound|Glass|Double-Double|Putback|Board/,
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
	[
		/Handles|Shot Creator|Shot-Creating|Iso|Shifty/,
		(r, a) => a.drb >= 0.5,
		"handle label, poor handle",
	],
];

const ratingsOfRow = (row) => {
	const r = {};
	for (const k of RATING_KEYS) r[k] = row[k];
	return r;
};

const absZ = (r) => {
	const v = compositeValues(r);
	const z = {};
	for (const k of Object.keys(v)) z[k] = rawZ(DEFAULT_NORMS.q[k], v[k]);
	return z;
};

// Skill for his size (height's share taken out), computed here so the audit does not depend on the engine version
const sizeZ = (a) => {
	const z = {};
	for (const k of Object.keys(a)) {
		const b = DEFAULT_NORMS.beta[k] ?? 0;
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
];
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
	const vals = players.map((p) => compositeValues(p.ratings));
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
const descriptor = (rows, out) => {
	const zs = peerZ(rows.map((r) => r.p));
	const claims = new Map(ARCHETYPES.map((a) => [a.id, claimsOf(a)]));
	let nStand = 0,
		agree = 0,
		better = 0,
		top1 = 0,
		top1Hit = 0,
		lacks = 0;
	const f = { sh: 0, shMiss: 0, pb: 0, pbMiss: 0, tw: 0, twMiss: 0 };
	const betterBy = {};
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
			.filter(([, v]) => v >= 1)
			.sort((x, y) => y[1] - x[1]);
		const top = stand.slice(0, 2).map(([k]) => k);
		const cov = (c) => top.reduce((t, k) => t + (c[k] ?? 0), 0) / top.length;
		if (top.length) {
			nStand++;
			const c0 = cov(cl);
			agree += c0;
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
	});
	out.push(
		`descriptor agreement: ${pct(agree, nStand)}% of top-2 standout skills (vs position peers) named by the label; top standout named ${pct(top1Hit, top1)}%; better fit available ${pct(better, nStand)}%; label features a skill he is below his peers at ${pct(lacks, rows.length)}%`,
	);
	out.push(
		`  elite shooters not labelled shooters ${f.shMiss}/${f.sh}; passing bigs not labelled playmakers ${f.pbMiss}/${f.pb}; two-way players labelled one-way ${f.twMiss}/${f.tw}; most "better fit": ${Object.entries(
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
	const badBy = {};
	const badEx = [];
	const gapEx = [];
	const lowZBy = {};
	const posTab = {};
	const rows = [];
	for (const p of players) {
		const ps = p.pos ?? positionFor(p.ratings, true);
		const { scored } = scoreAll(
			p.ratings,
			DEFAULT_NORMS,
			ARCHETYPES,
			ps,
			p.age,
		);
		const c = classify(p.ratings, { pos: ps, age: p.age });
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
		posTab[ps] ??= {};
		posTab[ps][c.group] = (posTab[ps][c.group] ?? 0) + 1;
		if (HARD_BLOCK[c.group].includes(ps)) hard++;
		const a = absZ(p.ratings);
		const sz = sizeZ(a);
		let checked = false;
		for (const [re, ok, why] of AUDIT) {
			if (re.test(c.name)) {
				checked = true;
				if (!ok(p.ratings, a, sz)) {
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
		(a) => !counts[a.id] && !a.age && !a.level,
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
	descriptor(rows, out);
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
	resetG();
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
		const out = [`archetypes: ${ARCHETYPES.length}`];
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
		void all;
		// Stability: the same players season after season, with stickiness and sticky improved positions as the game uses them
		const trans = {};
		let life = 0;
		let changes = 0,
			steps = 0,
			groupChanges = 0;
		await seeded("diag-flap", async () => {
			resetG();
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
				const c = classify(p.ratings, { pos: ps, age: p.age });
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
	},
	1800000,
);
