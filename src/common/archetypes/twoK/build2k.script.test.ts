/* eslint-disable no-undef, curly */
// @ts-nocheck
// Builds the archetype set from the NBA 2K build database (builds2k.json, extracted by tools/archetypes2k/extract2k.py; 1,256
// builds, 857 distinct names). Writes twoK/defs2k.data.ts: every archetype is a 2K build name. Not part of the normal run:
// RUN_ARCHETYPE_2K=1 (report: ARCH_2K_OUT).
//
// 1. Each build is converted to BBGM ratings with translation tables built here: a 2K stat's percentile among the builds at
//    that 2K position becomes the BBGM rating at the same percentile among generated players at the matching positions;
//    inches -> hgt from the real NBA players in data/.
//    Mapping: Close Shot/Driving Layup/Post Control -> ins, dunks -> dnk, Midrange -> fg, Three -> tp, Free Throw -> ft, Pass
//    Accuracy -> pss, Ball Handle/Speed With Ball -> drb, Speed/Agility -> spd, Vertical -> jmp, Strength -> stre, Interior
//    Defense/Block and Perimeter Defense/Steal -> diq, OReb/DReb -> reb (each mostly the better of the two). No wingspan
//    in 2K.
// 2. Each converted build is read the way a player is (score.ts prepare): z per dimension, for his size, RELATIVE TO HIS
//    OWN LEVEL. A name's profile is the centroid of its builds' shapes, plus what the name promises (twoK/concepts.ts).
// 3. Same name at several 2K positions = one archetype with the union of the positions. Names that say the same thing
//    (same concepts, same position word) or whose profiles are all but identical are merged: the name with the most
//    builds is the archetype, the others its alternate names.
// 4. Labels the matcher never (or hardly ever) gives to anyone in large populations (random leagues with and without
//    expanded ratings, draft prospects, real NBA ratings) are merged into their nearest neighbour, until none is left.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test } from "vitest";
import { quantiles, percentile } from "../norms.ts";
import { scoreAll } from "../classify.ts";
import { toArchetype } from "../defs.data.ts";
import { buildNorms } from "../match.ts";
import { DEFAULT_NORMS } from "../norms.data.ts";
import { DEFAULT_NORMS_EXPANDED } from "../normsExpanded.data.ts";
import { DIM_LABELS } from "../composites.ts";
import { prepare } from "../score.ts";
import {
	HARD_BLOCK,
	namePositions,
	positionFor,
	positionWordOf,
	POSITIONS,
} from "../position.ts";
import { sampleLeague } from "../sample.testutil.ts";
import { RATING_KEYS } from "../../ratingsBuilds/solver.ts";
import { fillExpandedRatings } from "../../expandedRatings.ts";
import ovrFn from "../../../worker/core/player/ovr.ts";
import { conceptsOf, SPECIAL_DESCS } from "./concepts.ts";

const OUT = process.env.ARCH_2K_OUT ?? "/tmp/claude-0/arch-2k-report.txt";
// Merge threshold on the squared distance between two profiles (weights are in steps of 0.5)
const MERGE_D2 = Number(process.env.ARCH_2K_MERGE ?? 1.5);
// A label must be given to at least this many of the pooled sample players, and this many of the random league
const MIN_POOL = Number(process.env.ARCH_2K_MIN_POOL ?? 6);
const MIN_LEAGUE = Number(process.env.ARCH_2K_MIN_LEAGUE ?? 3);

const DATA = JSON.parse(
	readFileSync(new URL("./builds2k.json", import.meta.url), "utf8"),
);
const OLD_IDS: string[] = JSON.parse(
	readFileSync(
		new URL("../../../../tools/archetypes2k/old-ids.json", import.meta.url),
		"utf8",
	),
);
// Old archetypes that are the same thing as a 2K build under another spelling keep their id
const SAME_AS_OLD: Record<string, string> = {
	"3-Level Scorer": "three-level-scorer",
};
const STATS: string[] = DATA.stats;
const idx = (s) => STATS.indexOf(s);
const slug = (name) =>
	name
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/[^\da-z]+/g, "-")
		.replace(/^-|-$/g, "");

// 2K stat -> BBGM rating(s)
const MAP = {
	ins: ["Close Shot", "Driving Layup", "Post Control"],
	dnk: ["Driving Dunk", "Standing Dunk"],
	fg: ["Midrange Shot"],
	tp: ["Threepoint Shot"],
	ft: ["Free Throw"],
	pss: ["Pass Accuracy"],
	drb: ["Ball Handle", "Speed With Ball"],
	spd: ["Speed", "Agility"],
	jmp: ["Vertical"],
	stre: ["Strength"],
	pdef: ["Perimeter Defense", "Steal"],
	idef: ["Interior Defense", "Block"],
	oreb: ["Offensive Rebound"],
	dreb: ["Defensive Rebound"],
	oiq: ["Close Shot", "Midrange Shot", "Threepoint Shot", "Pass Accuracy"],
};
// 2K position -> the positions of this game
const POS_MAP = {
	PG: ["PG", "G"],
	SG: ["G", "SG", "GF"],
	SF: ["GF", "SF", "F"],
	PF: ["F", "PF", "FC"],
	C: ["FC", "C"],
};
const POS5 = ["PG", "SG", "SF", "PF", "C"];
const TO5 = {
	PG: "PG",
	G: "PG",
	SG: "SG",
	GF: "SF",
	SF: "SF",
	F: "PF",
	PF: "PF",
	FC: "C",
	C: "C",
};
// Profile dimensions a 2K build says something about (no endurance, styles or height: height is the gate)
const PROFILE_DIMS = [
	"usg",
	"drb",
	"pss",
	"rim",
	"post",
	"mid",
	"three",
	"ft",
	"reb",
	"dint",
	"dper",
	"blk",
	"ath",
	"stl",
	"draw",
	"spd",
	"jmp",
	"stre",
	"oiq",
	"diq",
	"fin",
];
const FAMILY_OF = {
	three: "shooter",
	ft: "shooter",
	pss: "playmaker",
	drb: "playmaker",
	rim: "slasher",
	draw: "slasher",
	fin: "slasher",
	mid: "scorer",
	usg: "scorer",
	post: "scorer",
	dper: "defender",
	stl: "defender",
	dint: "defender",
	blk: "defender",
	diq: "defender",
	reb: "rebounder",
	ath: "athlete",
	jmp: "athlete",
	spd: "athlete",
	stre: "hustle",
	oiq: "skilled",
};
const center = (v) => (v ? (v[0] + v[1]) / 2 : undefined);
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

test.skipIf(!process.env.RUN_ARCHETYPE_2K)(
	"build the 2K archetype set",
	async () => {
		const out: string[] = [];
		const builds = DATA.builds;
		const q2k = {};
		for (const ps of POS5) {
			const at5 = builds.filter((b) => b.pos === ps);
			q2k[ps] = STATS.map((s, i) =>
				quantiles(
					at5.map((b) => center(b.s[i])).filter((x) => x !== undefined),
				),
			);
		}
		const pct2k = (b, s) => {
			const v = center(b.s[idx(s)]);
			return v === undefined ? 0.5 : percentile(q2k[b.pos][idx(s)], v);
		};
		const off = await sampleLeague(6000, "twok-off", 13, 38, false);
		const qOf = (pop, k) =>
			quantiles(
				pop.map((p) => p.ratings[k]).filter((x) => typeof x === "number"),
			);
		for (const p of off) p.pos = positionFor(p.ratings, true);
		const qOff = Object.fromEntries(
			POS5.map((ps) => {
				const at5 = off.filter((p) => TO5[p.pos] === ps);
				return [
					ps,
					Object.fromEntries(RATING_KEYS.map((k) => [k, qOf(at5, k)])),
				];
			}),
		);
		const at = (q, p) => {
			const x = Math.min(1, Math.max(0, p)) * (q.length - 1);
			const lo = Math.floor(x);
			const hi = Math.ceil(x);
			return q[lo] + (q[hi] - q[lo]) * (x - lo);
		};
		// Inches -> hgt from real NBA players (median per inch, interpolated)
		const real = JSON.parse(
			readFileSync(
				new URL(
					"../../../../data/real-player-data.basketball.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		const byIn = {};
		for (const r of real.ratings) {
			if (r.season < 2016 || r.season > 2025) continue;
			const h = real.bios[r.slug]?.height;
			if (h) (byIn[h] ??= []).push(r.hgt);
		}
		const hgtAt = {};
		for (const [h, xs] of Object.entries(byIn)) {
			if (xs.length >= 5) hgtAt[h] = quantiles(xs, 3)[1];
		}
		const inchesList = Object.keys(hgtAt)
			.map(Number)
			.sort((a, b) => a - b);
		const hgtOf = (inches) => {
			const lo = inchesList.filter((x) => x <= inches).at(-1) ?? inchesList[0];
			const hi = inchesList.find((x) => x >= inches) ?? inchesList.at(-1);
			if (lo === hi) return hgtAt[lo] + (inches - lo) * 3.7;
			return hgtAt[lo] + ((hgtAt[hi] - hgtAt[lo]) * (inches - lo)) / (hi - lo);
		};
		const clampH = (h) => Math.round(Math.min(100, Math.max(0, h)));
		const convert = (b) => {
			const q = qOff[b.pos];
			const p = {};
			for (const [k, stats] of Object.entries(MAP)) {
				p[k] = mean(stats.map((s) => pct2k(b, s)));
			}
			const r: Record<string, number> = {};
			r.hgt = clampH(hgtOf((b.in[0] + b.in[1]) / 2));
			for (const k of [
				"stre",
				"spd",
				"jmp",
				"ins",
				"dnk",
				"ft",
				"fg",
				"tp",
				"oiq",
				"drb",
				"pss",
			]) {
				r[k] = Math.round(at(q[k], p[k]));
			}
			r.endu = Math.round(at(q.endu, 0.5));
			// diq is the all-around defense, reb the all-around rebounding: mostly the build's better side (a lockdown guard
			// with no interior defense is still a defender, a defensive rebounder who never crashes still a rebounder)
			const lead = (x, y) => 0.75 * Math.max(x, y) + 0.25 * Math.min(x, y);
			r.diq = Math.round(at(q.diq, lead(p.pdef, p.idef)));
			r.reb = Math.round(at(q.reb, lead(p.oreb, p.dreb)));
			// Which side of the floor the build defends is read from the 2K stats (BBGM's own composites split diq by speed and size)
			return { r, side: p.pdef - p.idef };
		};

		// ---- one candidate per distinct name
		const byName = new Map();
		for (const b of builds) {
			const e = byName.get(b.name) ?? {
				name: b.name,
				pos2k: [],
				zs: [],
				hg: [],
				side: [],
			};
			const { r, side } = convert(b);
			e.pos2k.push(b.pos);
			e.zs.push(prepare(r, DEFAULT_NORMS).z);
			e.hg.push(clampH(hgtOf(b.in[0])), clampH(hgtOf(b.in[1])));
			e.side.push(side);
			byName.set(b.name, e);
		}
		if (process.env.ARCH_2K_LIFT) {
			// What each word of the 2K vocabulary means in the data: mean shape of the builds whose name has the word
			const words = {};
			for (const e of byName.values()) {
				for (const w of new Set(e.name.split(/ +/))) {
					(words[w] ??= []).push(...e.zs);
				}
			}
			out.push(
				"=== word -> strongest dimensions of its builds (z vs own level)",
			);
			for (const [w, zs] of Object.entries(words).sort(
				(x, y) => y[1].length - x[1].length,
			)) {
				if (zs.length < 3) continue;
				const m = PROFILE_DIMS.map((d) => [d, mean(zs.map((z) => z[d]))]).sort(
					(x, y) => y[1] - x[1],
				);
				out.push(
					`${w} (${zs.length}): ${m
						.slice(0, 5)
						.map(([d, v]) => `${d} ${v.toFixed(2)}`)
						.join(", ")} | ${m
						.slice(-2)
						.map(([d, v]) => `${d} ${v.toFixed(2)}`)
						.join(", ")}`,
				);
			}
		}
		const candidates = [];
		const contradictions = [];
		for (const e of byName.values()) {
			const concepts = conceptsOf(e.name);
			const w = {};
			for (const d of PROFILE_DIMS) {
				const z = mean(e.zs.map((z1) => z1[d]));
				w[d] = Math.max(-3, Math.min(3, Math.round((2 * z) / 0.55) / 2));
			}
			const sorted = Object.entries(w).sort(
				(x, y) => Math.abs(y[1]) - Math.abs(x[1]) || (x[0] < y[0] ? -1 : 1),
			);
			const prof = {};
			for (const [d, v] of sorted.filter(([, v]) => v >= 1).slice(0, 6))
				prof[d] = v;
			for (const [d, v] of sorted.filter(([, v]) => v <= -1).slice(0, 2))
				prof[d] = v;
			const need = {};
			const needFor = {};
			const xw = {};
			const tags = [];
			for (const c of concepts) {
				for (const [d, v] of Object.entries(c.w)) {
					if (w[d] <= 0 && v >= 2)
						contradictions.push(`${e.name}: ${c.key} ${d} ${w[d]}`);
					prof[d] = Math.max(prof[d] ?? 0, v);
				}
				for (const [d, v] of Object.entries(c.need ?? {}))
					need[d] = Math.max(need[d] ?? -9, v);
				for (const [d, v] of Object.entries(c.needFor ?? {}))
					needFor[d] = Math.max(needFor[d] ?? -9, v);
				for (const [d, v] of Object.entries(c.xw ?? {}))
					xw[d] = Math.abs(v) > Math.abs(xw[d] ?? 0) ? v : xw[d];
				if (c.tag && !tags.includes(c.tag)) tags.push(c.tag);
			}
			// A name with no concept (a nickname): the builds decide, and its two strongest skills are what it promises
			if (concepts.length === 0) {
				for (const [d, v] of sorted.filter(([, v]) => v >= 1.5).slice(0, 2)) {
					prof[d] = Math.max(2, v);
				}
			}
			// The defense rating of the side the builds defend, with expanded ratings (a refinement, never a floor of its own)
			const side = mean(e.side);
			if (
				concepts.some((c) => c.key === "twoWay") &&
				xw.pdef === undefined &&
				xw.idef === undefined
			) {
				if (side > 0.1) xw.pdef = 1.5;
				else if (side < -0.1) xw.idef = 1.5;
			}
			// Positions: the union of its builds' 2K positions, narrowed by what the name itself says
			let positions = POSITIONS.filter((ps) =>
				e.pos2k.some((p5) => POS_MAP[p5].includes(ps)),
			);
			const named = namePositions(e.name);
			if (named) {
				const both = positions.filter((ps) => named.includes(ps));
				positions = both.length > 0 ? both : named;
			}
			const i5 = e.pos2k.map((p5) => POS5.indexOf(p5));
			const m5 = mean(i5);
			let group =
				positionWordOf(e.name) ??
				(Math.max(...i5) <= 1
					? "guard"
					: m5 >= 3.5
						? "big"
						: Math.min(...i5) >= 2 && m5 >= 2.5
							? "forward"
							: "wing");
			if (HARD_BLOCK[group].some((ps) => positions.includes(ps))) {
				const ok = positions.filter((ps) => !HARD_BLOCK[group].includes(ps));
				if (positionWordOf(e.name) && ok.length > 0) positions = ok;
				else group = "wing";
			}
			const hg = [...e.hg].sort((x, y) => x - y);
			const head = concepts.at(-1);
			const lead = sorted.find(([, v]) => v > 0)?.[0] ?? "oiq";
			const phrases = [...new Set(concepts.map((c) => c.phrase))];
			let desc = SPECIAL_DESCS[e.name];
			if (!desc && phrases.length > 0) {
				const s =
					phrases.length === 1
						? phrases[0]
						: `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;
				desc = `${s[0].toUpperCase()}${s.slice(1)}.`;
			}
			if (!desc) {
				const top = Object.entries(prof)
					.filter(([, v]) => v >= 1.5)
					.sort((x, y) => y[1] - x[1])
					.slice(0, 3)
					.map(([d]) => DIM_LABELS[d].toLowerCase());
				desc = `Stands out for ${top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top.at(-1)}` : (top[0] ?? "a balanced game")}.`;
			}
			candidates.push({
				name: e.name,
				aliases: [],
				group,
				family: head?.family ?? FAMILY_OF[lead] ?? "balanced",
				positions,
				hgt: [
					positions.includes("PG") ? 0 : Math.max(0, hg[0] - 5),
					positions.includes("C") ? 100 : Math.min(100, hg.at(-1) + 5),
				],
				w: prof,
				xw,
				need,
				needFor,
				desc,
				tags,
				builds: e.zs.length,
				keys: concepts
					.map((c) => c.key)
					.sort()
					.join("+"),
				word: positionWordOf(e.name),
			});
		}
		out.push(
			`${builds.length} builds, ${candidates.length} names; name promises the builds contradict: ${contradictions.length}\n  ${contradictions.join("\n  ")}`,
		);

		// ---- merge names that say the same thing
		const d2 = (x, y) => {
			let d = 0;
			for (const k of PROFILE_DIMS) d += ((x.w[k] ?? 0) - (y.w[k] ?? 0)) ** 2;
			return d;
		};
		const overlap = (x, y) =>
			x.positions.some((ps) => y.positions.includes(ps));
		const oldIdOf = (c) =>
			SAME_AS_OLD[c.name] ??
			(OLD_IDS.includes(slug(c.name)) ? slug(c.name) : undefined);
		candidates.sort(
			(x, y) =>
				(oldIdOf(y) ? 1 : 0) - (oldIdOf(x) ? 1 : 0) ||
				y.builds - x.builds ||
				x.name.length - y.name.length ||
				(x.name < y.name ? -1 : 1),
		);
		const absorb = (rep, c, unionPositions) => {
			rep.aliases.push(c.name, ...c.aliases);
			rep.builds += c.builds;
			if (unionPositions) {
				const named = namePositions(rep.name);
				for (const ps of c.positions) {
					if (
						!rep.positions.includes(ps) &&
						(!named || named.includes(ps)) &&
						!HARD_BLOCK[rep.group].includes(ps)
					)
						rep.positions.push(ps);
				}
				rep.hgt = [
					Math.min(rep.hgt[0], c.hgt[0]),
					Math.max(rep.hgt[1], c.hgt[1]),
				];
			}
		};
		let reps = [];
		for (const c of candidates) {
			const same = reps.find(
				(r) =>
					slug(r.name) === slug(c.name) ||
					(r.word === c.word &&
						((c.keys !== "" && r.keys === c.keys && d2(r, c) <= 6) ||
							(d2(r, c) <= MERGE_D2 && overlap(r, c)))),
			);
			if (same) absorb(same, c, true);
			else reps.push(c);
		}
		out.push(`after merging names that say the same thing: ${reps.length}`);

		// ---- drop labels the matcher never gives to anyone
		const realRows = [];
		const bySlug = {};
		for (const row of real.ratings) (bySlug[row.slug] ??= []).push(row);
		for (const row of real.ratings) {
			if (row.season < 2016 || row.season > 2025 || row.season % 2) continue;
			const r = {};
			for (const k of RATING_KEYS) r[k] = row[k];
			realRows.push({ ratings: r, ovr: ovrFn(r), pos: positionFor(r, true) });
		}
		void bySlug;
		void fillExpandedRatings;
		const prospects = (await sampleLeague(1500, "twok-pros", 0, 30, false)).map(
			(p) => ({ ...p, pos: positionFor(p.ratings, true) }),
		);
		const on = (await sampleLeague(4000, "twok-on", 13, 38, true)).map((p) => ({
			...p,
			pos: positionFor(p.ratings, true),
		}));
		const pools = [
			{ rows: off, base: DEFAULT_NORMS, league: true },
			{ rows: prospects, base: DEFAULT_NORMS },
			{ rows: realRows, base: DEFAULT_NORMS },
			{ rows: on, base: DEFAULT_NORMS_EXPANDED },
		];
		const total = pools.reduce((s, p) => s + p.rows.length, 0);
		for (let round = 0; round < 12; round++) {
			const arch = reps.map((r) => toArchetype({ ...r, id: slug(r.name) }));
			const counts = {};
			const league = {};
			const tables = {};
			for (const pool of pools) {
				// (tables from the random league of that setting; no calibration bias yet)
				const key = pool.base === DEFAULT_NORMS ? "off" : "on";
				tables[key] ??= {
					...buildNorms(key === "off" ? off : on, arch, undefined, pool.base),
					bias: {},
				};
				for (const p of pool.rows) {
					const id = scoreAll(p.ratings, tables[key], arch, p.pos).scored[0].a
						.id;
					counts[id] = (counts[id] ?? 0) + 1;
					if (pool.league) league[id] = (league[id] ?? 0) + 1;
				}
			}
			const weak = reps.filter(
				(r) =>
					(counts[slug(r.name)] ?? 0) < MIN_POOL ||
					(league[slug(r.name)] ?? 0) < MIN_LEAGUE,
			);
			out.push(
				`round ${round}: ${reps.length} labels, ${weak.length} given to fewer than ${MIN_POOL} of ${total} sample players (or ${MIN_LEAGUE} of the random league)`,
			);
			mkdirSync(dirname(OUT), { recursive: true });
			writeFileSync(OUT, out.join("\n") + "\n");
			if (weak.length === 0) break;
			// The least used half of them go first, so two near-twins are not both dropped in one round
			weak.sort(
				(x, y) =>
					(counts[slug(x.name)] ?? 0) - (counts[slug(y.name)] ?? 0) ||
					(x.name < y.name ? -1 : 1),
			);
			const zero = weak.filter((r) => !counts[slug(r.name)]);
			const drop = new Set(
				zero.length > 0
					? zero
					: weak.slice(0, Math.max(1, Math.ceil(weak.length / 2))),
			);
			const keep = reps.filter((r) => !drop.has(r));
			for (const c of drop) {
				const near = keep
					.filter((r) => overlap(r, c))
					.sort((x, y) => d2(x, c) - d2(y, c) || (x.name < y.name ? -1 : 1))[0];
				if (near) absorb(near, c, false);
			}
			reps = keep;
		}

		// ---- write
		const ids = new Set();
		const defs = reps
			.map((r) => {
				const id = oldIdOf(r) ?? slug(r.name);
				if (ids.has(id)) throw new Error(`duplicate id ${id}`);
				ids.add(id);
				// (a floor of 0 is a floor: "at least his own level")
				const clean = (o, keepZero = false) =>
					Object.fromEntries(
						Object.entries(o)
							.filter(([, v]) => v !== undefined && (keepZero || v !== 0))
							.sort((x, y) => (x[0] < y[0] ? -1 : 1)),
					);
				return {
					id,
					name: r.name,
					aliases: [...new Set(r.aliases)].sort(),
					group: r.group,
					family: r.family,
					positions: POSITIONS.filter((ps) => r.positions.includes(ps)),
					hgt: r.hgt,
					w: clean(r.w),
					xw: clean(r.xw),
					need: clean(r.need, true),
					needFor: clean(r.needFor, true),
					desc: r.desc,
					tags: r.tags,
					builds: r.builds,
				};
			})
			.sort((x, y) => (x.name < y.name ? -1 : 1));
		const kept = defs.filter((d) => OLD_IDS.includes(d.id)).map((d) => d.id);
		out.push(
			`final: ${defs.length} archetypes carrying ${defs.reduce((s, d) => s + 1 + d.aliases.length, 0)} 2K names; ids kept from the old set: ${kept.length} (${kept.join(", ")})`,
		);
		for (const ps of POSITIONS) {
			out.push(
				`  ${ps}: ${defs.filter((d) => d.positions.includes(ps)).length} labels`,
			);
		}
		writeFileSync(
			new URL("./defs2k.data.ts", import.meta.url),
			`// GENERATED by twoK/build2k.script.test.ts (RUN_ARCHETYPE_2K=1) from ${builds.length} NBA 2K builds (${byName.size} distinct names). Every
// archetype is a 2K build name: its profile is the centroid of its converted builds (shape relative to the build's own level)
// plus what the name promises (twoK/concepts.ts), its positions the builds' 2K positions, \`aliases\` the other 2K names that
// say the same thing or that the matcher could not tell apart. Do not edit by hand.
import type { TwoKDef } from "../types.ts";

export const TWO_K_DEFS: TwoKDef[] = ${JSON.stringify(defs)};
`,
		);
		mkdirSync(dirname(OUT), { recursive: true });
		writeFileSync(OUT, out.join("\n") + "\n");
	},
	3600000,
);
