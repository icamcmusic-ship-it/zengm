/* eslint-disable no-undef, curly, unicorn/prefer-single-call */
// @ts-nocheck
// Converts the NBA 2K build database (builds2k.json, extracted by tools/archetypes2k/extract2k.py) into BBGM ratings and maps
// every build to an archetype. Writes twoK.data.ts (the 2K names behind each archetype, shown in the archetype popover and on
// the Archetypes page) and a report (ARCH_2K_OUT, default the scratch file below). Not part of the normal run: RUN_ARCHETYPE_2K=1
//
// Translation tables are built here, not taken from the spreadsheet (its tables predate the expanded ratings):
// - 2K side: each 2K stat's percentile among all 1,256 builds (the center of each build's range).
// - BBGM side: each rating's quantiles in a generated league (setting off, and Expanded Ratings on for wng/pdef/idef/oreb/dreb/
//   csh/dsh/bsc), so a build's 2K percentile becomes the BBGM rating at the same percentile.
// - Height: 2K heights are NBA listings, so inches -> hgt is read off the real NBA players in data/ (median hgt per inch).
// Mapping (most specific rating available): Close Shot/Driving Layup/Post Control -> ins, Driving/Standing Dunk -> dnk,
// Midrange -> fg, Three -> tp, Free Throw -> ft, Pass Accuracy -> pss, Ball Handle/Speed With Ball -> drb (and bsc with expanded
// ratings), Speed/Agility -> spd, Vertical -> jmp, Strength -> stre, Interior Defense/Block -> idef, Perimeter Defense/Steal ->
// pdef (diq is their average, as with the setting on), OReb/DReb -> oreb/dreb (reb their average). oiq: the build's offensive
// skill level, endu: ordinary. Three and mid-range are split into catch-and-shoot / off-the-dribble by build-name cues
// ("Shot Creator", "Shot Hunter", "Iso" off the dribble; "Spot-Up", "Sharpshooter", "Stretch" off the catch), else by handle.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { test } from "vitest";
import { quantiles, percentile } from "../norms.ts";
import { ARCHETYPES, classify, scoreAll } from "../classify.ts";
import { DEFAULT_NORMS } from "../norms.data.ts";
import { prepare } from "../score.ts";
import { positionFor } from "../position.ts";
import { sampleLeague } from "../sample.testutil.ts";
import { RATING_KEYS } from "../../ratingsBuilds/solver.ts";
import {
	ballSecurityBase,
	shootingSplitBase,
	splitPair,
} from "../../expandedRatings.ts";

const OUT = process.env.ARCH_2K_OUT ?? "/tmp/claude-0/arch-2k-report.txt";

const DATA = JSON.parse(
	readFileSync(new URL("./builds2k.json", import.meta.url), "utf8"),
);
const STATS: string[] = DATA.stats;
const idx = (s) => STATS.indexOf(s);

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
	bscCue: ["Ball Handle"],
};
const OFF_DRIBBLE =
	/Shot Creator|Shot Hunter|Iso|Creator|Pull-Up|Step|Bucket|Shot-Making|Shot Maker/;
const OFF_CATCH =
	/Spot-Up|Sharpshoot|Stretch|Sniper|Marksman|Catch|Floor Spac|Knockdown|Shooting/;
// Visible traits a 2K name implies (optional tie-breakers only, never needed for the mapping)
const TRAIT_CUES: [RegExp, string][] = [
	[/Lockdown|Clamp|Versatile Defender|Switch/, "defensiveVersatility"],
	[/Glass|Board|Rebound|Cleaner|Crash/, "hustle"],
	[/Off-Ball|Cutter|Movement/, "offBall"],
	[/Screen/, "screen"],
	[/Energy|Motor|Relentless/, "motor"],
	[/Dribble|Handle|Dime|Engine/, "handle"],
];

const center = (v) => (v ? (v[0] + v[1]) / 2 : undefined);

// 2K concepts that no archetype named: each becomes an archetype under its 2K name (ARCH_2K_PROPOSE=1 writes defs2k.data.ts),
// its profile the centroid of the converted builds whose name has the concept, at the 2K positions of its group
const NEW_2K: {
	name: string;
	re: RegExp;
	group: "guard" | "wing" | "forward" | "big";
	desc: string;
}[] = [
	{
		name: "Dot Dispenser",
		re: /Dot Dispenser|Dimer|Diming|Dime/,
		group: "guard",
		desc: "A pass-first table setter who racks up assists.",
	},
	{
		name: "Iso Savant",
		re: /Iso Savant/,
		group: "guard",
		desc: "Lives in isolation: handle, mid-range and the shot to finish it.",
	},
	{
		name: "Offensive Engine",
		re: /Engine/,
		group: "guard",
		desc: "The offense runs through him: scoring, handling and passing.",
	},
	{
		name: "Ankle Taker",
		re: /Ankle/,
		group: "guard",
		desc: "Breaks defenders down off the dribble.",
	},
	{
		name: "Iso Sniper",
		re: /Iso Sniper|3PT-Sniping Creator/,
		group: "guard",
		desc: "Creates his own three off the bounce.",
	},
	{
		name: "Mid-Range Slasher",
		re: /Mid-Range Slasher|Middy Slasher/,
		group: "guard",
		desc: "Attacks the rim and pulls up from the elbow.",
	},
	{
		name: "Mid-Range Menace",
		re: /Menace/,
		group: "wing",
		desc: "Gets to his spots in the mid-range and buries them.",
	},
	{
		name: "Mid-Paint Scorer",
		re: /Mid-Paint/,
		group: "wing",
		desc: "Scores from the mid-range and in the paint.",
	},
	{
		name: "Inside-Out Scorer",
		re: /Inside-Out Scor/,
		group: "wing",
		desc: "Scores at the rim and from three.",
	},
	{
		name: "Edge Enforcer",
		re: /Edge/,
		group: "forward",
		desc: "A physical forward who attacks the basket and defends.",
	},
	{
		name: "Shot-Erasing Lockdown",
		re: /Shot-Erasing|Eraser/,
		group: "forward",
		desc: "Guards the perimeter and erases shots at the rim.",
	},
	{
		name: "Dunk Tank",
		re: /Dunk Tank|Power Dunker|Rim Rocker|Rim-Rocking/,
		group: "forward",
		desc: "Powers through contact for dunks.",
	},
	{
		name: "3-Level Bully",
		re: /3-Level Bully|3-Level-Scoring Bully/,
		group: "forward",
		desc: "Strong enough to bully and skilled enough to score from anywhere.",
	},
	{
		name: "Walking Bucket",
		re: /Walking Bucket/,
		group: "forward",
		desc: "Scores from everywhere on the floor.",
	},
	{
		name: "Glass Guardian",
		re: /Glass Guardian/,
		group: "big",
		desc: "Protects the rim and owns the defensive glass.",
	},
	{
		name: "Board Enforcer",
		re: /Board Enforcer|Board-Enforcing/,
		group: "big",
		desc: "A physical rebounder who controls the paint.",
	},
	{
		name: "Backline Bulldozer",
		re: /Backline/,
		group: "big",
		desc: "Anchors the back line and bulldozes inside.",
	},
	{
		name: "Stretch Anchor",
		re: /Anchor|Backline Stretch/,
		group: "big",
		desc: "Protects the rim and spaces the floor.",
	},
	{
		name: "Pick-Diving Cleaner",
		re: /Pick-Diving|Rim Runner|Rim-Running/,
		group: "big",
		desc: "Dives hard on the pick and cleans the glass.",
	},
	{
		name: "Steel Curtain",
		re: /Steel Curtain|Lockdown Cleaner|Lock & Board/,
		group: "big",
		desc: "A wall on defense, inside and out, who rebounds.",
	},
];
// The family of each (so a hybrid never pairs near-duplicates)
const FAMILY_2K = {
	"Dot Dispenser": "playmaker",
	"Iso Savant": "scorer",
	"Offensive Engine": "playmaker",
	"Ankle Taker": "playmaker",
	"Clamp Thief": "defender",
	"Iso Sniper": "shooter",
	"Mid-Range Slasher": "slasher",
	"Mid-Range Menace": "scorer",
	"Mid-Paint Scorer": "scorer",
	"Inside-Out Scorer": "scorer",
	"Edge Enforcer": "defender",
	"Shot-Erasing Lockdown": "defender",
	"Rim-Reaping Slasher": "slasher",
	"Dunk Tank": "athlete",
	"3-Level Bully": "scorer",
	"Walking Bucket": "scorer",
	"Glass Guardian": "rebounder",
	"Board Enforcer": "rebounder",
	"Backline Bulldozer": "defender",
	"Stretch Anchor": "unicorn",
	"Pick-Diving Cleaner": "athlete",
	"Board-Hunting Slasher": "rebounder",
	"Steel Curtain": "defender",
};
// What a 2K name promises (the label must deliver it): these dimensions anchor the profile, the converted builds add the
// rest (their other strengths at most 1.5, so the name decides what the label is about)
const NAME_CUES: [RegExp, Record<string, number>][] = [
	[/Dot Dispenser|Engine/, { pss: 3 }],
	[/Engine|Iso|Walking Bucket|Scorer|3-Level/, { usg: 2 }],
	[/Ankle|Iso/, { drb: 2.5 }],
	[/Thief/, { stl: 2.5 }],
	[/Clamp|Lockdown|Edge|Curtain/, { dper: 2.5 }],
	[/Sniper|Inside-Out|3-Level|Walking Bucket|Stretch/, { three: 2 }],
	[/Mid-Range|Mid-Paint|3-Level/, { mid: 2.5 }],
	[/Slasher|Inside-Out|Mid-Paint|Pick-Diving/, { rim: 2.5 }],
	[/Dunk/, { rim: 2.5, jmp: 2 }],
	[/Bully|Bulldozer|Enforcer|Tank/, { stre: 2 }],
	[/Guardian|Board|Cleaner/, { reb: 2.5 }],
	[/Guardian|Erasing|Anchor|Backline|Curtain/, { blk: 2.5 }],
];
const GROUP_2K_POS = {
	guard: ["PG", "SG"],
	wing: ["SG", "SF"],
	forward: ["SF", "PF"],
	big: ["PF", "C"],
};
// Profile dimensions a 2K build can say something about (no endurance, styles or height: height is the gate)
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
];
const FAMILY_OF = {
	three: "shooter",
	pss: "playmaker",
	drb: "playmaker",
	rim: "slasher",
	draw: "slasher",
	mid: "scorer",
	usg: "scorer",
	post: "scorer",
	ft: "shooter",
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

test.skipIf(!process.env.RUN_ARCHETYPE_2K)(
	"convert 2K builds",
	async () => {
		const out: string[] = [];
		const builds = DATA.builds;
		// Translation tables by position (2K position <-> the matching BBGM positions), so a guard's 2K block rating is read
		// against guards on both sides, not against a pool that is mostly bigs on one side and mostly guards on the other.
		// 2K percentiles: each stat across the builds at that 2K position
		const POS5 = ["PG", "SG", "SF", "PF", "C"];
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
		// BBGM quantiles, setting off and on, by the 2K position his BBGM position matches (Improved positions)
		const off = await sampleLeague(6000, "twok-off", 13, 38, false);
		const on = await sampleLeague(6000, "twok-on", 13, 38, true);
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
		const qOf = (pop, k) =>
			quantiles(
				pop.map((p) => p.ratings[k]).filter((x) => typeof x === "number"),
			);
		const KEYS = [
			...RATING_KEYS,
			"wng",
			"pdef",
			"idef",
			"oreb",
			"dreb",
			"csh",
			"dsh",
			"bsc",
		];
		const byPos = (pop, keys) =>
			Object.fromEntries(
				POS5.map((ps) => {
					const at5 = pop.filter(
						(p) => TO5[positionFor(p.ratings, true)] === ps,
					);
					return [ps, Object.fromEntries(keys.map((k) => [k, qOf(at5, k)]))];
				}),
			);
		const qOff = byPos(off, RATING_KEYS);
		const qOn = byPos(on, KEYS);
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
		out.push(
			`inches -> hgt (real NBA medians): ${inchesList.map((x) => `${x}:${Math.round(hgtAt[x])}`).join(" ")}`,
		);

		const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
		const convert = (b, expanded) => {
			const q = (expanded ? qOn : qOff)[b.pos];
			const p = {};
			for (const [k, stats] of Object.entries(MAP)) {
				p[k] = mean(stats.map((s) => pct2k(b, s)));
			}
			const r: Record<string, number> = {};
			const val = (k, pk = k) => Math.round(at(q[k], p[pk]));
			r.hgt = Math.round(
				Math.min(100, Math.max(0, hgtOf((b.in[0] + b.in[1]) / 2))),
			);
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
				r[k] = val(k);
			}
			r.endu = Math.round(at(q.endu, 0.5));
			if (expanded) {
				r.pdef = val("pdef");
				r.idef = val("idef");
				r.diq = Math.round((r.pdef + r.idef) / 2);
				r.oreb = val("oreb");
				r.dreb = val("dreb");
				r.reb = Math.round((r.oreb + r.dreb) / 2);
				// No wingspan in 2K: an ordinary one for his height
				r.wng = r.hgt;
				const lean = OFF_DRIBBLE.test(b.name)
					? -6
					: OFF_CATCH.test(b.name)
						? 6
						: Math.round(shootingSplitBase(r));
				const [csh, dsh] = splitPair(r.fg + r.tp, 2 * lean);
				r.csh = csh;
				r.dsh = dsh;
				// Ball handle beyond his speed with the ball reads as a tighter handle
				r.bsc = Math.round(
					Math.min(
						100,
						Math.max(
							0,
							ballSecurityBase(r) +
								8 * (pct2k(b, "Ball Handle") - pct2k(b, "Speed With Ball")),
						),
					),
				);
			} else {
				// diq is the all-around defense, reb the all-around rebounding
				r.diq = Math.round(at(q.diq, (p.pdef + p.idef) / 2));
				r.reb = Math.round(at(q.reb, (p.oreb + p.dreb) / 2));
			}
			return r;
		};
		if (process.env.ARCH_2K_PROPOSE) {
			const defs = [];
			for (const n of NEW_2K) {
				const bs = builds.filter(
					(b) => n.re.test(b.name) && GROUP_2K_POS[n.group].includes(b.pos),
				);
				const zs = bs.map((b) => prepare(convert(b, false), DEFAULT_NORMS).z);
				const hg = bs.map((b) => convert(b, false).hgt).sort((x, y) => x - y);
				const w = {};
				for (const d of PROFILE_DIMS) {
					const z = mean(zs.map((z1) => z1[d]));
					w[d] = Math.max(-3, Math.min(3, Math.round((2 * z) / 0.55) / 2));
				}
				// What the builds are about: their four strongest skills, and at most one clear weakness
				const sorted = Object.entries(w).sort(
					(x, y) => Math.abs(y[1]) - Math.abs(x[1]) || (x[0] < y[0] ? -1 : 1),
				);
				const top = [
					...sorted.filter(([, v]) => v >= 1).slice(0, 4),
					...sorted.filter(([, v]) => v <= -1.5).slice(0, 1),
				];
				// A centroid of many builds is milder than any one of them: scaled so its strongest skill reads 1.5 next to what the
				// name promises
				const k = 1.5 / Math.max(...top.map(([, v]) => v));
				const cue = {};
				for (const [re, dims] of NAME_CUES) {
					if (re.test(n.name)) {
						for (const [d, v] of Object.entries(dims)) {
							cue[d] = Math.max(cue[d] ?? 0, v);
						}
					}
				}
				const prof = { ...cue };
				for (const [d, v] of top) {
					if (prof[d] === undefined && Object.keys(prof).length < 5) {
						prof[d] = Math.max(-1.5, Math.min(1.5, Math.round(2 * v * k) / 2));
					}
				}
				// At least three dimensions: the builds' next strengths
				for (const [d, v] of sorted) {
					if (Object.keys(prof).length >= 3) break;
					if (prof[d] === undefined && v > 0) {
						prof[d] = Math.max(0.5, Math.min(1.5, Math.round(2 * v * k) / 2));
					}
				}
				// The defense rating of the side it defends, with expanded ratings
				const xw = {};
				if (Math.max(prof.dper ?? 0, prof.stl ?? 0) >= 1.5)
					xw.pdef = Math.max(prof.dper ?? 0, prof.stl ?? 0) * 0.75;
				if (Math.max(prof.dint ?? 0, prof.blk ?? 0) >= 1.5)
					xw.idef = Math.max(prof.dint ?? 0, prof.blk ?? 0) * 0.75;
				const lead = top.find(([, v]) => v > 0)?.[0] ?? "oiq";
				defs.push({
					name: n.name,
					group: n.group,
					family: FAMILY_2K[n.name] ?? FAMILY_OF[lead],
					hgt: [Math.max(0, hg[0] - 4), Math.min(100, hg.at(-1) + 4)],
					w: prof,
					xw,
					desc: n.desc,
					builds: bs.length,
				});
				out.push(
					`proposed ${n.name} (${bs.length} builds): ${JSON.stringify(prof)} hgt ${hg[0]}-${hg.at(-1)}`,
				);
			}
			writeFileSync(
				new URL("./defs2k.data.ts", import.meta.url),
				`// GENERATED by twoK/convert2k.script.test.ts (ARCH_2K_PROPOSE=1): archetypes named after NBA 2K builds no archetype named,
// each the centroid of its converted builds' profile. Do not edit by hand (edit NEW_2K in the script and re-run).
export const TWO_K_DEFS: {
	name: string;
	group: "guard" | "wing" | "forward" | "big";
	family: string;
	hgt: [number, number];
	w: Record<string, number>;
	xw: Record<string, number>;
	desc: string;
	builds: number;
}[] = ${JSON.stringify(defs)};
`,
			);
		}
		const traitsOf = (name) => {
			const t = {};
			for (const [re, k] of TRAIT_CUES) if (re.test(name)) t[k] = 72;
			return t;
		};

		// Classify every build (setting off, on, and on with name-cue traits), each at the position the game would give him
		const byName = new Map();
		for (const b of builds) {
			const e = byName.get(b.name) ?? { name: b.name, pos2k: [], rows: [] };
			e.pos2k.push(b.pos);
			for (const mode of ["off", "on", "traits"]) {
				const r = convert(b, mode !== "off");
				const pos = positionFor(r, true);
				const c = classify(r, {
					pos,
					age: 26,
					traits: mode === "traits" ? traitsOf(b.name) : undefined,
				});
				const z = scoreAll(r, undefined, ARCHETYPES, pos, 26).scored[0].z;
				e.rows.push({ mode, id: c.id, label: c.label, pos, z, r });
			}
			byName.set(b.name, e);
		}
		// One archetype per 2K name: the most common primary over its builds and modes (ties: the off setting's first build)
		const aliases: Record<string, string[]> = {};
		const nameTo: Record<string, string> = {};
		let agree = 0;
		let ownCount = 0;
		for (const e of byName.values()) {
			const n = {};
			for (const row of e.rows) n[row.id] = (n[row.id] ?? 0) + 1;
			const best = Object.entries(n).sort(
				(x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1),
			)[0][0];
			if (e.rows.every((row) => row.id === best)) agree++;
			// A name that is an archetype's own name, or has the concept of one named after 2K builds (whose profile its builds
			// make up), belongs to it
			const own =
				ARCHETYPES.find((a) => a.name === e.name) ??
				ARCHETYPES.find(
					(a) =>
						a.tags.includes("2k") &&
						NEW_2K.find((x) => x.name === a.name)?.re.test(e.name),
				);
			const to = own?.id ?? best;
			if (own) ownCount++;
			nameTo[e.name] = to;
			(aliases[to] ??= []).push(e.name);
		}
		for (const l of Object.values(aliases)) l.sort();
		const covered = Object.keys(aliases).length;
		out.push(
			`${builds.length} 2K builds, ${byName.size} distinct names; mapped onto ${covered}/${ARCHETYPES.length} archetypes; names given to their own (2K-named) archetype: ${ownCount}; same archetype for every build and setting of a name: ${agree}/${byName.size}`,
		);
		const exact = [...byName.keys()].filter((nm) =>
			ARCHETYPES.some((a) => a.name === nm),
		);
		out.push(`2K names that are already archetype names: ${exact.join(", ")}`);
		out.push(
			"\n=== archetype <- 2K names\n" +
				ARCHETYPES.map(
					(a) =>
						`${a.id} (${(aliases[a.id] ?? []).length}): ${(aliases[a.id] ?? []).join(" | ")}`,
				).join("\n"),
		);
		out.push(
			"\n=== builds (name: positions -> off / on / traits)\n" +
				[...byName.values()]
					.map(
						(e) =>
							`${e.name} [${e.pos2k.join(",")}]: ${["off", "on", "traits"]
								.map((m) =>
									e.rows
										.filter((r) => r.mode === m)
										.map((r) => `${r.pos} ${r.label}`)
										.join(", "),
								)
								.join(" / ")}`,
					)
					.join("\n"),
		);
		if (process.env.ARCH_2K_DUMP) {
			writeFileSync(
				process.env.ARCH_2K_DUMP,
				JSON.stringify([...byName.values()]),
			);
		}
		mkdirSync(dirname(OUT), { recursive: true });
		writeFileSync(OUT, out.join("\n") + "\n");
		const src = `// GENERATED by twoK/convert2k.script.test.ts from ${builds.length} NBA 2K builds (${byName.size} distinct names): each 2K build converted to BBGM
// ratings and read by the archetype engine; the 2K names whose builds read as each archetype. Do not edit by hand.
export const TWO_K_NAMES: Record<string, string[]> = ${JSON.stringify(
			Object.fromEntries(
				ARCHETYPES.filter((a) => aliases[a.id]).map((a) => [
					a.id,
					aliases[a.id],
				]),
			),
		)};
`;
		writeFileSync(new URL("./twoK.data.ts", import.meta.url), src);
		void existsSync;
	},
	1200000,
);
