/* eslint-disable no-undef, curly */
// @ts-nocheck
// archuser2k: the user's own NBA 2K archetypes (user2k.data.ts, about 520 players) as the answer key. Not part of the normal
// run: RUN_ARCHETYPE_USER2K=1 with ARCH_U2K_MODE=
// - defs: map every 2K name to our builds (an exact name; else a 2K alias or a merged build's name whose promised skill
//   classes our build keeps; else a 2K name we never adopted; else new) and write twoK/user2kDefs.data.ts: a new build for
//   every unmapped name with enough support (MIN_SUPPORT weighted players, or MIN_DISTINCT and no build with its promises),
//   its profile the centroid of its players' readings (shape relative to his own level, sub-rating leans, positions, size)
//   plus what the name's words promise (twoK/concepts.ts, rulebook.data.ts), as twoK/build2k.script.test.ts makes a 2K
//   build's profile from its converted builds
// - tables: the match tables of the new builds (the reference league calibrate.script.test.ts reads, both rating sets),
//   added to norms.data.ts / normsExpanded.data.ts with no bias (shareTrim.script.test.ts trims them afterwards)
// - map: every other name to its closest build (the builds his 2K positions allow whose promises share the most with the
//   name's, then the best fit for the name's players), written to twoK/user2kMap.data.ts; those names become aliases
// - read (ARCH_U2K_OUT=file): each player's reading now (label, top three builds) as JSON, to compare versions
// - score (ARCH_U2K_BEFORE=file, ARCH_U2K_AFTER=file, ARCH_U2K_OUT=report): top-1 / top-3 / family against the user's
//   labels per split and kind of name, and the notable players' table
// - picks (ARCH_U2K_OUT=file, ARCH_U2K_SPLIT=tune): the players as an archetype pick file (tuning.ts PickFile) for the
//   developer refit (fit.script.test.ts ARCH_PICKS)
// ARCH_U2K_TRAIN_ONLY=1: builds and closest-build mapping from the tune split only (the held-out evaluation); the test
// split is 30% of the players by a hash of the pick id (tuning.ts picksToJudged).
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import {
	ARCHETYPES,
	SCORING_ARCHETYPES,
	classify,
	defaultNorms,
	modelFor,
	scoreAll,
} from "../classify.ts";
import { TWO_K_NAMES } from "../defs.data.ts";
import { MERGED_ARCH14, MERGED_ARCH15, mergedId } from "../merges.data.ts";
import { buildNorms } from "../match.ts";
import {
	isPos,
	namePositions,
	nameContradictsPosition,
	positionFor,
	positionWordOf,
	HARD_BLOCK,
	POSITIONS,
} from "../position.ts";
import { realData, realNorms, realPlayer } from "../real.testutil.ts";
import { RULES } from "../rulebook.data.ts";
import { sampleLeague } from "../sample.testutil.ts";
import { prepare, promisesOf } from "../score.ts";
import { ARCHETYPE_READING_VERSION } from "../helpers.ts";
import {
	applyTuning,
	fitTuning,
	fromPickFile,
	snapshotRows,
	toPickFile,
} from "../tuning.ts";
import { ALL_TIME_W, USER_2K } from "../user2k.data.ts";
import { conceptsOf } from "./concepts.ts";
import { CUSTOM_DEFS } from "../customDefs.data.ts";
import { TWO_K_DEFS } from "./defs2k.data.ts";
import { USER_2K_DEFS } from "./user2kDefs.data.ts";
import { USER_2K_MAP } from "./user2kMap.data.ts";

const MODE = process.env.ARCH_U2K_MODE;
const TRAIN_ONLY = Boolean(process.env.ARCH_U2K_TRAIN_ONLY);
// A name becomes a build with this much support (weighted players: an all-time entry counts ALL_TIME_W) ...
export const MIN_SUPPORT = 3;
// ... or this much when no build his positions allow promises what it does (a distinct role)
export const MIN_DISTINCT = 2;
const OUT = process.env.ARCH_U2K_OUT ?? "/tmp/arch-u2k.txt";
// The real-player trim (ARCH_U2K_MODE=trim): a new build at most this share of real players, of the top 150s
export const REAL_CAP = 0.025;
export const REAL_TOP_CAP = 0.035;
const TRIM_MIN = -1.2;

const slug = (name) =>
	name
		.toLowerCase()
		.replace(/&/g, "and")
		.replace(/[^\da-z]+/g, "-")
		.replace(/^-|-$/g, "");
const norm = (s) =>
	s
		.toLowerCase()
		.replace(/&/g, " and ")
		.replace(/[^\da-z]/g, "");
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const wmean = (xs, ws) =>
	xs.reduce((s, x, i) => s + x * ws[i], 0) / ws.reduce((s, w) => s + w, 0);

// The pick id of a player (and its split: tuning.ts picksToJudged hashes the same id)
export const uidOf = (r) => `2k-${r.slug}-${r.season}`;
export const splitOf = (r) => {
	const uid = uidOf(r);
	let h = 2166136261;
	for (let i = 0; i < uid.length; i++)
		h = Math.imul(h ^ uid.charCodeAt(i), 16777619);
	return (h >>> 0) % 10 < 3 ? "test" : "tune";
};

// 2K position -> the positions of this game (as twoK/build2k.script.test.ts)
const POS_MAP = {
	PG: ["PG", "G"],
	SG: ["G", "SG", "GF"],
	SF: ["GF", "SF", "F"],
	PF: ["F", "PF", "FC"],
	C: ["FC", "C"],
};
const POS5 = ["PG", "SG", "SF", "PF", "C"];
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

// The skill classes a name promises (rulebook.data.ts; "Scorer" aside)
export const nameClasses = (name) =>
	[...new Set(conceptsOf(name).flatMap((c) => RULES[c.key].classes))]
		.filter((c) => c !== "score")
		.sort();
const jaccard = (a, b) => {
	const u = new Set([...a, ...b]);
	return u.size === 0 ? 1 : a.filter((x) => b.includes(x)).length / u.size;
};

// The players, read as a real-players league reads them at the preseason
let playersCache;
export const userPlayers = () => {
	if (playersCache) return playersCache;
	const data = realData();
	const norms = realNorms(defaultNorms(false), false);
	playersCache = USER_2K.filter((r) => r.slug).map((r) => {
		const row = data.d.ratings.find(
			(x) => x.slug === r.slug && x.season === r.season,
		);
		const p = realPlayer(data, row);
		return {
			r,
			p,
			norms,
			w: r.allTime ? ALL_TIME_W : 1,
			split: splitOf(r),
			read: { age: p.age, stats: p.stats },
		};
	});
	return playersCache;
};

// The builds without this round's (the base the names are mapped to)
const USER_IDS = new Set(USER_2K_DEFS.map((d) => d.id));
const baseBuilds = () => ARCHETYPES.filter((a) => !USER_IDS.has(a.id));

// Kind of a 2K name against the base builds: existing / alias-2k / alias-merged / 2k-unadopted / new
export const baseKind = (name) => {
	const own = new Map();
	const alias = new Map();
	for (const a of baseBuilds()) {
		own.set(norm(a.name), a.id);
		for (const n of Object.values(a.posNames ?? {})) own.set(norm(n), a.id);
		for (const n of TWO_K_NAMES[a.id] ?? [])
			if (USER_2K_MAP[n]?.kind !== "alias") alias.set(norm(n), a.id);
	}
	// (a build merged away in arch14/arch15: its name stays an alias of the kept build unless it becomes a build again)
	const mergedTo = new Map(
		[...TWO_K_DEFS, ...CUSTOM_DEFS]
			.filter((d) => MERGED_ARCH14[d.id] ?? MERGED_ARCH15[d.id])
			.map((d) => [norm(d.name), mergedId(d.id)]),
	);
	const merged = new Set(mergedTo.keys());
	const k = norm(name);
	if (own.has(k)) return { kind: "existing", id: own.get(k) };
	if (mergedTo.has(k)) {
		const id = mergedTo.get(k);
		const have = promisesOf(ARCHETYPES.find((a) => a.id === id)).all;
		if (nameClasses(name).every((c) => have.includes(c)))
			return { kind: "alias-merged", id };
		return { kind: "2k-unadopted", folded: id, merged: true };
	}
	const twoK = new Set(
		JSON.parse(
			readFileSync(new URL("./builds2k.json", import.meta.url), "utf8"),
		).builds.map((b) => norm(b.name)),
	);
	if (alias.has(k)) {
		const id = alias.get(k);
		const have = promisesOf(ARCHETYPES.find((a) => a.id === id)).all;
		// (an alias the matcher folded into a build that does not promise what the name does is a 2K name we never adopted)
		if (nameClasses(name).every((c) => have.includes(c)))
			return { kind: merged.has(k) ? "alias-merged" : "alias-2k", id };
		return { kind: "2k-unadopted", folded: id };
	}
	if (twoK.has(k)) return { kind: "2k-unadopted" };
	return { kind: "new" };
};

// Every 2K name with its players and 2K positions
const labels = () => {
	const by = new Map();
	for (const r of USER_2K) {
		const e = by.get(r.arch) ?? { name: r.arch, pos5: new Set(), rows: [] };
		for (const ps of r.pos) e.pos5.add(ps);
		e.rows.push(r);
		by.set(r.arch, e);
	}
	const ps = userPlayers();
	for (const e of by.values()) {
		e.players = ps.filter(
			(x) => x.r.arch === e.name && (!TRAIN_ONLY || x.split === "tune"),
		);
		e.support = e.players.reduce((s, x) => s + x.w, 0);
		// (whether a name is a build of its own goes by all its players: the user's taxonomy, not his ratings; with
		// ARCH_U2K_TRAIN_ONLY the profile and the closest-build mapping read the tune split only)
		e.supportAll = ps
			.filter((x) => x.r.arch === e.name)
			.reduce((s, x) => s + x.w, 0);
		// (2K positions a quarter or more of its players list: one big listed at SF does not open a big's build to wings)
		const n5 = {};
		for (const r of e.rows) for (const p5 of r.pos) n5[p5] = (n5[p5] ?? 0) + 1;
		const pos5 = [...e.pos5].filter(
			(p5) => e.rows.length < 4 || n5[p5] >= 0.25 * e.rows.length,
		);
		e.positions = POSITIONS.filter((p) =>
			pos5.some((p5) => POS_MAP[p5].includes(p)),
		);
		e.pos5 = new Set(pos5);
	}
	return [...by.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
};

// A new build from its players' readings plus its name (twoK/build2k.script.test.ts, with real players for converted builds)
const makeDef = (e, ids) => {
	const concepts = conceptsOf(e.name);
	const prs = e.players.map((x) =>
		prepare(x.p.ratings, x.norms, { ...x.read, pos: x.p.pos }),
	);
	const ws = e.players.map((x) => x.w);
	const w = {};
	for (const d of PROFILE_DIMS) {
		const z =
			prs.length > 0
				? wmean(
						prs.map((pr) => pr.z[d]),
						ws,
					)
				: 0;
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
	const tags = ["user2k"];
	for (const c of concepts) {
		for (const [d, v] of Object.entries(c.w))
			prof[d] = Math.max(prof[d] ?? 0, v);
		for (const [d, v] of Object.entries(c.need ?? {}))
			need[d] = Math.max(need[d] ?? -9, v);
		for (const [d, v] of Object.entries(c.needFor ?? {}))
			needFor[d] = Math.max(needFor[d] ?? -9, v);
		for (const [d, v] of Object.entries(c.xw ?? {}))
			xw[d] = Math.abs(v) > Math.abs(xw[d] ?? 0) ? v : xw[d];
		if (c.tag && !tags.includes(c.tag)) tags.push(c.tag);
	}
	if (concepts.length === 0)
		for (const [d, v] of sorted.filter(([, v]) => v >= 1.5).slice(0, 2))
			prof[d] = Math.max(2, v);
	// Sub-rating leans its players share (subStyle.ts buildWants adds them to what the name's words want)
	const sw = {};
	const subs = prs.map((pr) => pr.style?.sub).filter(Boolean);
	if (subs.length > 0)
		for (const k of Object.keys(subs[0])) {
			const m = mean(subs.map((s) => s[k]));
			// (a light touch: the name's own wants stay the larger part, so a few players' leans do not decide the build)
			if (Math.abs(m) >= 0.75)
				sw[k] = Math.round(Math.max(-2, Math.min(2, m)) * 2) / 8;
		}
	// Positions: the union of its players' 2K positions, narrowed by what the name says
	let positions = e.positions.filter(
		(p) => !nameContradictsPosition(e.name, p),
	);
	if (positions.length === 0) positions = namePositions(e.name) ?? e.positions;
	const i5 = [...e.pos5].map((p5) => POS5.indexOf(p5));
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
	// Size: his players' heights (a little wider for a small sample), or what his positions hold
	const hs = e.players.map((x) => x.p.ratings.hgt).sort((a, b) => a - b);
	const pad = hs.length >= 3 ? 5 : 8;
	const hgt =
		hs.length > 0
			? [
					positions.includes("PG") ? 0 : Math.max(0, hs[0] - pad),
					positions.includes("C") ? 100 : Math.min(100, hs.at(-1) + pad),
				]
			: [positions.includes("PG") ? 0 : 30, positions.includes("C") ? 100 : 70];
	const head = concepts.at(-1);
	const lead = sorted.find(([, v]) => v > 0)?.[0] ?? "oiq";
	const phrases = [...new Set(concepts.map((c) => c.phrase))];
	let desc;
	if (phrases.length > 0) {
		const s =
			phrases.length === 1
				? phrases[0]
				: `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;
		desc = `${s[0].toUpperCase()}${s.slice(1)}.`;
	} else {
		const top = Object.entries(prof)
			.filter(([, v]) => v >= 1.5)
			.sort((x, y) => y[1] - x[1])
			.slice(0, 3)
			.map(([d]) => DIM_WORDS[d]);
		desc = `Stands out for ${top.join(", ") || "a balanced game"}.`;
	}
	let id = slug(e.name);
	if (ids.has(id)) id = `${id}-2k`;
	return {
		id,
		name: e.name,
		aliases: [],
		group,
		family: head?.family ?? FAMILY_OF[lead] ?? "balanced",
		positions,
		hgt,
		w: prof,
		xw,
		need,
		needFor,
		...(Object.keys(sw).length > 0 ? { sw } : {}),
		desc,
		tags,
		builds: e.rows.length,
	};
};

const DIM_WORDS = {
	usg: "scoring load",
	drb: "ball handling",
	pss: "passing",
	rim: "finishing",
	post: "post play",
	mid: "mid-range shooting",
	three: "three-point shooting",
	ft: "free throws",
	reb: "rebounding",
	dint: "interior defense",
	dper: "perimeter defense",
	blk: "shot blocking",
	ath: "athleticism",
	stl: "steals",
	draw: "drawing fouls",
	spd: "speed",
	jmp: "leaping",
	stre: "strength",
	oiq: "offensive feel",
	diq: "defensive feel",
	fin: "finishing",
};

test.skipIf(!process.env.RUN_ARCHETYPE_USER2K)(
	"user 2K archetypes",
	async () => {
		if (MODE === "defs") {
			const out = [];
			const ids = new Set([...TWO_K_DEFS, ...CUSTOM_DEFS].map((d) => d.id));
			const defs = [];
			const kinds = {};
			for (const e of labels()) {
				const k = baseKind(e.name);
				kinds[e.name] = k;
				if (k.kind !== "new" && k.kind !== "2k-unadopted") continue;
				// A distinct role: no base build at his positions promises what the name does
				const cls = nameClasses(e.name);
				const bestJ = Math.max(
					0,
					...baseBuilds()
						.filter((a) => a.positions.some((p) => e.positions.includes(p)))
						.map((a) =>
							jaccard(
								cls,
								promisesOf(a).all.filter((c) => c !== "score"),
							),
						),
				);
				const make =
					// (a name must promise something measurable: a build that promises nothing fits anyone)
					cls.length > 0 &&
					(e.supportAll >= MIN_SUPPORT ||
						(e.supportAll >= MIN_DISTINCT && bestJ < 0.5));
				out.push(
					`${make ? "BUILD" : "     "}\t${k.kind}\t${e.supportAll} (tune ${e.support})\t${e.name}\tclasses ${cls.join(",")}\tbest jaccard ${bestJ.toFixed(2)}`,
				);
				if (make) {
					const d = makeDef(e, ids);
					ids.add(d.id);
					defs.push(d);
				}
			}
			const src = `// GENERATED by twoK/user2k.script.test.ts (RUN_ARCHETYPE_USER2K=1 ARCH_U2K_MODE=defs${TRAIN_ONLY ? " ARCH_U2K_TRAIN_ONLY=1" : ""}) from the user's 2K archetypes (user2k.data.ts). Do not edit by hand.
// archuser2k: the user's 2K names no build of ours carries, with ${MIN_SUPPORT}+ players (or ${MIN_DISTINCT}+ and no build promising
// what the name does): each profile is the centroid of its players' readings plus what the name promises.
import type { TwoKDef } from "../types.ts";

// How each 2K name of the user's list maps to the builds before this round (existing / alias-2k / alias-merged /
// 2k-unadopted / new)
export const USER_2K_KINDS: Record<string, { kind: string; id?: string; folded?: string }> = ${JSON.stringify(kinds)};

export const USER_2K_DEFS: TwoKDef[] = ${JSON.stringify(defs)};
`;
			writeFileSync(new URL("./user2kDefs.data.ts", import.meta.url), src);
			writeFileSync(OUT, out.join("\n") + "\n");
			return;
		}

		if (MODE === "tables") {
			for (const expanded of [false, true]) {
				const file = new URL(
					expanded ? "../normsExpanded.data.ts" : "../norms.data.ts",
					import.meta.url,
				);
				const text = readFileSync(file, "utf8");
				const name = expanded ? "DEFAULT_NORMS_EXPANDED" : "DEFAULT_NORMS";
				const header = text.slice(0, text.indexOf(`export const ${name}`));
				const norms = structuredClone(defaultNorms(expanded));
				const sample = await sampleLeague(8000, "norms-v2", 13, 38, expanded);
				for (const p of sample) p.pos = positionFor(p.ratings, true);
				const archs = SCORING_ARCHETYPES.filter((a) =>
					USER_IDS.has(a.out ?? a.id),
				);
				const { match } = buildNorms(sample, archs, undefined, norms);
				for (const [id, t] of Object.entries(match)) {
					norms.match[id] = t;
					norms.bias[id] = norms.bias[id] ?? 0;
				}
				writeFileSync(
					file,
					`${header}export const ${name}: Norms = ${JSON.stringify(norms)};\n`,
				);
			}
			return;
		}

		// The real-player trim: a build made from a handful of real players fits real players broadly, and the share trim
		// (shareTrim.script.test.ts) only sees generated leagues, the star trim only stars. Each new build is held to
		// REAL_CAP of the real players 2016-2027 and REAL_TOP_CAP of each season's top 150 by a step on its bias (both
		// rating sets), the other builds untouched
		if (MODE === "trim") {
			const data = realData();
			const norms = realNorms(defaultNorms(false), false);
			const all = [];
			for (let season = 2016; season <= 2027; season++) {
				const rows = data.d.ratings.filter((r) => r.season === season);
				const ps = rows
					.map((r) => realPlayer(data, r))
					.sort((a, b) => b.ovr - a.ovr);
				ps.forEach((p, i) => all.push({ p, top: i < 150 }));
			}
			const files = [false, true].map((expanded) => {
				const file = new URL(
					expanded ? "../normsExpanded.data.ts" : "../norms.data.ts",
					import.meta.url,
				);
				const text = readFileSync(file, "utf8");
				const name = expanded ? "DEFAULT_NORMS_EXPANDED" : "DEFAULT_NORMS";
				return {
					file,
					name,
					header: text.slice(0, text.indexOf(`export const ${name}`)),
					norms: structuredClone(defaultNorms(expanded)),
				};
			});
			const out = [];
			const nTop = all.filter((x) => x.top).length;
			for (let iter = 0; iter < 10; iter++) {
				const cnt = {};
				const cntTop = {};
				for (const { p, top } of all) {
					const id = scoreAll(
						p.ratings,
						{ ...norms, bias: files[0].norms.bias },
						ARCHETYPES,
						p.pos,
						undefined,
						{ age: p.age, stats: p.stats },
					).scored[0].a.id;
					cnt[id] = (cnt[id] ?? 0) + 1;
					if (top) cntTop[id] = (cntTop[id] ?? 0) + 1;
				}
				let moved = 0;
				for (const id of USER_IDS) {
					const share = (cnt[id] ?? 0) / all.length;
					const shareTop = (cntTop[id] ?? 0) / nTop;
					const over = Math.max(
						Math.log(share / REAL_CAP),
						Math.log(shareTop / REAL_TOP_CAP),
						0,
					);
					if (over > 0) {
						moved++;
						for (const f of files) {
							for (const a of SCORING_ARCHETYPES) {
								if ((a.out ?? a.id) === id)
									f.norms.bias[a.id] = Math.max(
										TRIM_MIN,
										Math.round(((f.norms.bias[a.id] ?? 0) - 0.3 * over) * 100) /
											100,
									);
							}
						}
					}
				}
				const worst = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
				out.push(
					`round ${iter}: ${moved} builds trimmed; largest ${worst[0]} ${((100 * worst[1]) / all.length).toFixed(1)}%`,
				);
				if (moved === 0) break;
			}
			for (const f of files)
				writeFileSync(
					f.file,
					`${f.header}export const ${f.name}: Norms = ${JSON.stringify(f.norms)};\n`,
				);
			writeFileSync(OUT, out.join("\n") + "\n");
			return;
		}

		// (every build must have its match tables: a stale module cache once dropped some)
		if (MODE !== "defs" && MODE !== "tables") {
			const missing = SCORING_ARCHETYPES.filter(
				(a) =>
					!defaultNorms(false).match[a.id] || !defaultNorms(true).match[a.id],
			).map((a) => a.id);
			if (missing.length > 0)
				throw new Error(`No match tables for ${missing.join(", ")}`);
		}

		if (MODE === "map") {
			const out = [];
			const map = {};
			const model = modelFor(false);
			for (const e of labels()) {
				const own = ARCHETYPES.find((a) => a.name === e.name);
				if (own) {
					map[e.name] = {
						kind: USER_IDS.has(own.id) ? "build" : "existing",
						id: own.id,
					};
					continue;
				}
				const k = baseKind(e.name);
				if (k.kind === "alias-2k" || k.kind === "alias-merged") {
					map[e.name] = { kind: k.kind, id: k.id };
					continue;
				}
				// (a merged build's name that did not become a build again stays with the build it was merged into)
				if (k.merged) {
					map[e.name] = { kind: "alias-merged", id: k.folded };
					continue;
				}
				// The closest build: the most promises in common with the name, then the best fit for its players
				const cls = nameClasses(e.name);
				const cands = ARCHETYPES.filter((a) =>
					a.positions.some((p) => e.positions.includes(p)),
				);
				const js = cands.map((a) =>
					jaccard(
						cls,
						promisesOf(a).all.filter((c) => c !== "score"),
					),
				);
				const bestJ = Math.max(...js);
				// (a name that promises nothing measurable, a nickname like "Showmaker", has no closest build)
				const near = (cls.length === 0 ? [] : cands).filter(
					(_, i) => js[i] >= bestJ - 0.2 && js[i] >= 0.34,
				);
				let pick;
				if (near.length > 0 && e.players.length > 0) {
					const fit = new Map(near.map((a) => [a.id, 0]));
					for (const x of e.players) {
						const s = scoreAll(
							x.p.ratings,
							x.norms,
							ARCHETYPES,
							x.p.pos,
							undefined,
							x.read,
							model,
						).scored;
						for (const sc of s)
							if (fit.has(sc.a.id))
								fit.set(
									sc.a.id,
									fit.get(sc.a.id) +
										x.w *
											(sc.z +
												2 *
													jaccard(
														cls,
														promisesOf(sc.a).all.filter((c) => c !== "score"),
													)),
								);
					}
					pick = [...fit.entries()].sort(
						(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
					)[0][0];
				} else if (near.length > 0) {
					pick = near
						.map((a, i) => ({
							a,
							j: jaccard(
								cls,
								promisesOf(a).all.filter((c) => c !== "score"),
							),
						}))
						.sort(
							(x, y) =>
								y.j - x.j ||
								promisesOf(x.a).all.length - promisesOf(y.a).all.length ||
								(x.a.id < y.a.id ? -1 : 1),
						)[0].a.id;
				}
				map[e.name] = pick
					? { kind: "alias", id: pick }
					: { kind: "unmapped", id: null };
				out.push(
					`${map[e.name].kind}\t${e.support}\t${e.name}\t-> ${pick ? ARCHETYPES.find((a) => a.id === pick).name : "-"}\t(best jaccard ${bestJ.toFixed(2)})`,
				);
			}
			const src = `// GENERATED by twoK/user2k.script.test.ts (RUN_ARCHETYPE_USER2K=1 ARCH_U2K_MODE=map${TRAIN_ONLY ? " ARCH_U2K_TRAIN_ONLY=1" : ""}). Do not edit by hand.
// archuser2k: every 2K name of the user's list (user2k.data.ts) and the build it is: its own name (existing / build: a
// build of this round), a 2K alias, or the closest build (alias: the name becomes one of that build's names for search);
// unmapped: no build his positions allow promises enough of what it does.
export const USER_2K_MAP: Record<string, { kind: string; id: string | null }> = ${JSON.stringify(map)};
`;
			writeFileSync(new URL("./user2kMap.data.ts", import.meta.url), src);
			writeFileSync(OUT, out.sort().join("\n") + "\n");
			return;
		}

		if (MODE === "read") {
			const res = {};
			// (ARCH_U2K_TUNING=pick file: read with the in-game tuning fitted from those picks, tuning.ts fitTuning)
			const model = process.env.ARCH_U2K_TUNING
				? applyTuning(
						modelFor(false),
						fitTuning(
							fromPickFile(
								JSON.parse(readFileSync(process.env.ARCH_U2K_TUNING, "utf8")),
							),
							modelFor,
						),
					)
				: undefined;
			for (const x of userPlayers()) {
				const c = classify(x.p.ratings, {
					norms: x.norms,
					pos: x.p.pos,
					...x.read,
					model,
				});
				const s = scoreAll(
					x.p.ratings,
					x.norms,
					ARCHETYPES,
					x.p.pos,
					undefined,
					x.read,
					model,
				).scored;
				const top = [c.id];
				for (const sc of s) {
					if (top.length >= 3) break;
					if (!top.includes(sc.a.id)) top.push(sc.a.id);
				}
				res[uidOf(x.r)] = {
					id: c.id,
					name: c.name,
					family: c.family,
					top,
					poor: c.score < 0.5 || c.shortfall > 0.25,
					conflict: !ARCHETYPES.find((a) => a.id === c.id).positions.includes(
						x.p.pos,
					),
				};
			}
			writeFileSync(OUT, JSON.stringify(res));
			return;
		}

		if (MODE === "score") {
			const before = JSON.parse(
				readFileSync(process.env.ARCH_U2K_BEFORE, "utf8"),
			);
			const after = JSON.parse(
				readFileSync(process.env.ARCH_U2K_AFTER, "utf8"),
			);
			const byId = new Map(ARCHETYPES.map((a) => [a.id, a]));
			const out = [];
			const famOf = (id) => byId.get(id)?.family;
			const nameOf = (id) => byId.get(id)?.name ?? id;
			const stat = (rd, xs) => {
				let n = 0,
					t1 = 0,
					t3 = 0,
					fam = 0;
				for (const x of xs) {
					const target = USER_2K_MAP[x.r.arch]?.id;
					if (!target) continue;
					const r = rd[uidOf(x.r)];
					n += x.w;
					if (r.id === target) t1 += x.w;
					if (r.top.includes(target)) t3 += x.w;
					if (famOf(r.id) === famOf(target)) fam += x.w;
				}
				const p = (v) => `${((100 * v) / n).toFixed(1)}%`;
				return `top-1 ${p(t1)}, top-3 ${p(t3)}, family ${p(fam)} (n=${n})`;
			};
			const ps = userPlayers();
			const groups = {
				"held-out (test)": ps.filter((x) => x.split === "test"),
				tune: ps.filter((x) => x.split === "tune"),
				all: ps,
				"held-out, name is a build of ours (existing / 2K alias)": ps.filter(
					(x) =>
						x.split === "test" &&
						["existing", "alias-2k", "alias-merged"].includes(
							USER_2K_MAP[x.r.arch]?.kind,
						),
				),
				"held-out, name became a new build": ps.filter(
					(x) => x.split === "test" && USER_2K_MAP[x.r.arch]?.kind === "build",
				),
				"held-out, name is an alias of the closest build": ps.filter(
					(x) => x.split === "test" && USER_2K_MAP[x.r.arch]?.kind === "alias",
				),
				"held-out, current players": ps.filter(
					(x) => x.split === "test" && !x.r.allTime,
				),
				"held-out, all-time teams (half weight)": ps.filter(
					(x) => x.split === "test" && x.r.allTime,
				),
			};
			for (const [k, xs] of Object.entries(groups)) {
				out.push(
					`${k}:\n  before ${stat(before, xs)}\n  after  ${stat(after, xs)}`,
				);
			}
			const unm = Object.entries(USER_2K_MAP)
				.filter(([, v]) => !v.id)
				.map(([k]) => k);
			out.push(`unmapped names (left out): ${unm.join(", ") || "none"}`);
			const changed = ps.filter(
				(x) => before[uidOf(x.r)].id !== after[uidOf(x.r)].id,
			).length;
			out.push(`labels changed: ${changed} of ${ps.length}`);
			for (const [k, rd] of [
				["before", before],
				["after", after],
			]) {
				const vals = ps.map((x) => rd[uidOf(x.r)]);
				const cnt = {};
				for (const v of vals) cnt[v.id] = (cnt[v.id] ?? 0) + 1;
				const top = Object.entries(cnt)
					.sort((a, b) => b[1] - a[1])
					.slice(0, 3);
				out.push(
					`${k}: ${Object.keys(cnt).length} distinct labels, top ${top.map(([id, c]) => `${nameOf(id)} ${c}`).join(", ")}; poor fit ${vals.filter((v) => v.poor).length}; position conflicts ${ps.filter((x) => !byId.get(rd[uidOf(x.r)].id)?.positions.includes(x.p.pos)).length}`,
				);
			}
			out.push("", "notable players: 2K | before | after");
			for (const n of (process.env.ARCH_U2K_NOTABLE ?? "")
				.split(",")
				.filter(Boolean)) {
				const x = ps.find(
					(y) =>
						y.r.name.toLowerCase().includes(n.toLowerCase()) && !y.r.allTime,
				);
				if (!x) {
					out.push(`${n}: not in the list`);
					continue;
				}
				const b = before[uidOf(x.r)];
				const a = after[uidOf(x.r)];
				const target = USER_2K_MAP[x.r.arch]?.id;
				out.push(
					`${x.r.name} (${x.split}) | ${x.r.arch}${target && nameOf(target) !== x.r.arch ? ` (= ${nameOf(target)})` : ""} | ${b.name}${b.id === target ? " *" : ""} | ${a.name}${a.id === target ? " *" : ""}`,
				);
			}
			writeFileSync(OUT, out.join("\n") + "\n");
			return;
		}

		if (MODE === "picks") {
			const picks = [];
			const now = Date.UTC(2026, 10, 15);
			for (const x of userPlayers()) {
				if (
					process.env.ARCH_U2K_SPLIT &&
					x.split !== process.env.ARCH_U2K_SPLIT
				)
					continue;
				const target = USER_2K_MAP[x.r.arch]?.id;
				if (!target || !x.p.pos || !isPos(x.p.pos)) continue;
				const c = classify(x.p.ratings, {
					norms: x.norms,
					pos: x.p.pos,
					...x.read,
				});
				const model = modelFor(false);
				picks.push({
					uid: uidOf(x.r),
					at: now,
					pid: -1,
					name: x.r.name,
					season: x.r.season,
					pos: x.p.pos,
					shown: c.id,
					picked: target,
					...(x.r.allTime ? {} : { better: false }),
					expanded: false,
					v: ARCHETYPE_READING_VERSION,
					rows: snapshotRows(
						x.p.ratings,
						x.norms,
						model,
						[...new Set([c.id, target])],
						x.p.pos,
						undefined,
						x.read,
					),
					input: {
						ratings: x.p.ratings,
						pos: x.p.pos,
						ovr: x.p.ovr,
						age: x.p.age,
						stats: x.p.stats,
						slug: x.r.slug,
						weight: x.w,
					},
				});
			}
			writeFileSync(OUT, JSON.stringify(toPickFile(picks, now)));
			return;
		}
		throw new Error(`ARCH_U2K_MODE: defs, tables, map, read, score or picks`);
	},
	3600000,
);
