/* eslint-disable no-undef */
// @ts-nocheck
// archdiag: how the archetype labels fit what players are and do, in a league made with the current code. Not part of
// the normal run:
//   RUN_ARCH_DIAG=<out dir> [ARCH_DIAG_SEASONS=3] [ARCH_DIAG_SEED=1] [ARCH_DIAG_CONFIG=newDefaults] [ARCH_DIAG_REAL=2026] \
//     npx vitest --run --project basketball --maxWorkers=2 src/worker/core/player/archetypeDiag.script.test.ts
// Random players: a new league with the settings a new league gets (src/test/ratingInflation/toggles.ts), full seasons
// simmed (src/test/ratingInflation/harness.ts runLeague). After each season (at the draft lottery) every rostered player
// is dumped: ratings (base, expanded, sub-ratings), traits, that season's box score and shot zones, the label in force
// that season (stored at its preseason, as the UI shows it), its why bullets, the noun pick and the noun standings, and
// flags from the user's rules (v2/nounsAudit.script.test.ts, docs/native-features.md) and from his stats. Writes
// league_labels.csv (last season), league_labels_all.csv (every season), label_history.csv and summary.txt.
// ARCH_DIAG_REAL=<season>: real players of that season (data/real-player-*.json) read as a real-players league would,
// with that season's real stats: real_labels.csv.
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { PLAYER } from "../../../common/constants.ts";
import { isPos } from "../../../common/archetypes/position.ts";
import { POS_BUCKET } from "../../../common/archetypes/norms.ts";
import { seasonStats } from "../../../common/archetypes/stats.ts";
import { currentEntry, viewOf } from "../../../common/archetypes/helpers.ts";
import { defaultNormsFor } from "../../../common/archetypes/classify.ts";
import { classifyV2 } from "../../../common/archetypes/v2/engine.ts";
import { ratingQuantiles } from "../../../common/archetypes/v2/gateScale.ts";
import {
	nounScores,
	nounsOfName,
	pickNouns,
} from "../../../common/archetypes/v2/nouns.ts";
import { ELITE_RE } from "../../../common/archetypes/v2/honest.ts";
import { SUB_DEFS } from "../../../common/subRatings.ts";
import { OFF, runLeague } from "../../../test/ratingInflation/harness.ts";
import { TOGGLES } from "../../../test/ratingInflation/toggles.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import {
	archetypeInfoForPlayer,
	archetypeTraits,
	getLeagueNorms,
	ratingsForArchetype,
} from "./archetype.ts";

const OUT = process.env.RUN_ARCH_DIAG;
const SEASONS = Number(process.env.ARCH_DIAG_SEASONS ?? 3);
const SEED = Number(process.env.ARCH_DIAG_SEED ?? 1);
const CONFIG = process.env.ARCH_DIAG_CONFIG ?? "newDefaults";
const REAL = process.env.ARCH_DIAG_REAL;

const BASE = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
];
const EXP = ["wng", "pdef", "idef", "oreb", "dreb", "csh", "dsh", "bsc"];
const SUBS = SUB_DEFS.map((d) => d.key);
const subOf = (r, k) => {
	const i = SUBS.indexOf(k);
	return Array.isArray(r.sub) && typeof r.sub[i] === "number"
		? r.sub[i]
		: undefined;
};
const avg = (xs) => {
	const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
	return v.length ? v.reduce((a, b) => a + b, 0) / v.length : undefined;
};
const r1 = (x, d = 1) =>
	typeof x === "number" && Number.isFinite(x) ? Number(x.toFixed(d)) : "";

// The user's skills (his audit's "Best: ..."), each read against its OWN distribution in the league (not against the
// engine's tables), so they say where he stands at each skill independently of the noun engine
const SKILLS = {
	three: (r) => r.tp,
	mid: (r) => r.fg,
	post: (r) => r.ins,
	finish: (r) => r.dnk,
	rimD: (r) => avg([subOf(r, "blk"), r.idef ?? r.diq]),
	perimD: (r) => avg([subOf(r, "pdf"), r.pdef ?? r.diq]),
	steal: (r) => subOf(r, "stl") ?? avg([r.diq, r.spd]),
	handle: (r) => r.drb,
	pass: (r) => r.pss,
	reb: (r) => r.reb,
	speed: (r) => r.spd,
	jump: (r) => r.jmp,
	strength: (r) => r.stre,
};
const pctIn = (sorted, v) => {
	if (v === undefined || sorted.length === 0) return 0;
	let lo = 0;
	let hi = sorted.length;
	while (lo < hi) {
		const m = (lo + hi) >> 1;
		if (sorted[m] < v) lo = m + 1;
		else hi = m;
	}
	let hi2 = lo;
	while (hi2 < sorted.length && sorted[hi2] === v) hi2++;
	return (lo + hi2) / 2 / sorted.length;
};

const HONESTISH =
	/Specialist|Camp Body|Rotation Filler|Journeyman|Project|Raw|Developing|Lottery|Late Bloomer|Two-Way Contract|Ten-Day|Emergency|Practice Squad|Garbage|Hustle|Junkyard|Energy Big|Pogo|Track Star|Bruiser|Big Body|Wall|Space Eater|Human Screen|Pest|Gnat|Hound|Gunner|Bomber|Merchant|One-Trick|Shot-Only|Dime|Pass-First|Pass-Only|Caretaker|Board Specialist|Glass-Only|Earthbound|Slow-Motion|Empty-Calorie|Connector|Jack-Of-All-Trades/;
const STAR_BAD =
	/Specialist|Camp Body|Rotation Filler|Journeyman|Project|Raw|Developing|Late Bloomer|Two-Way Contract|Ten-Day|Emergency|Practice Squad|Garbage|Connector|Jack-Of-All-Trades|Secondary|Role Player|Bench|Spark|Depth|Reserve/;
const NO_SKILL =
	/Camp Body|Rotation Filler|Journeyman|Filler|Two-Way Contract|Ten-Day|Practice Squad|Emergency|Depth|Reserve|Connector/;
const DEV = /Raw|Developing|Project|Prospect|Lottery|Late Bloomer/;
const BIGPOS = new Set(["PF", "FC", "C"]);
const GUARDPOS = new Set(["PG", "G", "SG"]);

// One player's stats for a season (regular season rows summed)
const statsOf = (rows) => {
	rows = rows.filter((r) => !r.playoffs && (r.min ?? 0) > 0);
	if (rows.length === 0) return undefined;
	const sum = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0);
	const gp = sum("gp");
	const min = sum("min");
	const s = seasonStats(rows);
	const fga = sum("fga");
	const tpa = sum("tpa");
	const zones = sum("fgaAtRim") + sum("fgaLowPost") + sum("fgaMidRange");
	return {
		gp,
		min,
		mpg: min / Math.max(1, gp),
		ppg: sum("pts") / Math.max(1, gp),
		tpag: tpa / Math.max(1, gp),
		tppct: tpa > 0 ? sum("tp") / tpa : undefined,
		tpa36: min > 0 ? (36 * tpa) / min : undefined,
		tpar: fga > 0 ? tpa / fga : undefined,
		ftag: sum("fta") / Math.max(1, gp),
		ftr: fga > 0 ? sum("fta") / fga : undefined,
		apg: sum("ast") / Math.max(1, gp),
		rpg: (sum("orb") + sum("drb")) / Math.max(1, gp),
		bpg: sum("blk") / Math.max(1, gp),
		spg: sum("stl") / Math.max(1, gp),
		astp: s?.astp,
		trbp: s ? (s.orbp + s.drbp) / 2 : undefined,
		blkp: s?.blkp,
		stlp: s?.stlp,
		usgp: s?.usgp,
		dbpm: s?.dbpm,
		rimr: zones > 0 && fga > 0 ? sum("fgaAtRim") / fga : undefined,
		postr: zones > 0 && fga > 0 ? sum("fgaLowPost") / fga : undefined,
		midr: zones > 0 && fga > 0 ? sum("fgaMidRange") / fga : undefined,
	};
};
const STAT_KEYS = [
	"tpa36",
	"tpar",
	"ftr",
	"astp",
	"trbp",
	"blkp",
	"stlp",
	"usgp",
	"dbpm",
	"rimr",
	"postr",
	"midr",
];
const QUAL_MIN = 800;

// The nouns of a defensive label
const defNouns = (def) => {
	if (!def) return [];
	if (/Switch Defender/.test(def)) return ["perimD", "rimD"];
	if (/Help-Side Roamer/.test(def)) return ["rimD", "steal"];
	if (/Pest/.test(def)) return ["perimD", "steal"];
	if (/Shot Blocker|Post Defender|Rim Protector|Swatting|Eraser/.test(def))
		return ["rimD"];
	if (/Perimeter|Stopper|Cerebral|Lockdown|Stalker/.test(def))
		return ["perimD"];
	if (/Hawk|Menace|Interceptor/.test(def)) return ["steal"];
	return [];
};

// Flags for one row (`L` the league context: own-distribution skill tables, stat tables by bucket, ovr table)
const flagsOf = (x, L) => {
	const f = [];
	const [main, def] = x.label.split(" · ");
	const mainNouns = new Set(
		(nounsOfName(main)?.nouns ?? []).map((n) => (n === "creator" ? "handle" : n)),
	);
	const allNouns = new Set([...mainNouns, ...defNouns(def)]);
	const best = x.best; // [{noun, top}] top = 100 * (1 - pct), best first
	const top3 = new Set(best.slice(0, 3).map((b) => b.noun));
	const ovrPct = pctIn(L.ovr, x.ovr);
	const twoSlots = !!def;
	const defInBest = best
		.slice(0, 3)
		.filter((b) => ["perimD", "rimD", "steal"].includes(b.noun)).length;

	// --- the user's rules (nounsAudit.script.test.ts), with skills read against the league's own distribution
	if (ELITE_RE.test(x.label) && ovrPct < 0.85) f.push("R:elite-word-not-elite");
	if (!HONESTISH.test(main) && !(twoSlots && defInBest > 0)) {
		for (const k of mainNouns) {
			if (!top3.has(k) && k !== "crafty") f.push(`R:noun-not-top3(${k})`);
		}
		if (
			best[0] &&
			best[0].top <= 15 &&
			!allNouns.has(best[0].noun) &&
			!(
				nounsOfName(main)?.twoWay &&
				["perimD", "steal"].includes(best[0].noun)
			)
		)
			f.push(`R:misses-best(${best[0].noun})`);
	}
	if (NO_SKILL.test(main)) {
		const strong = best.filter((b) => b.top <= 15).length;
		const good = best.filter((b) => b.top <= 26).length;
		if (strong >= 1 || good >= 2) f.push("R:no-skill-name-with-skills");
	}
	if (DEV.test(main) && x.ovr > 30 && best.some((b) => b.top <= 30))
		f.push("R:dev-name-with-skill");
	if (DEV.test(main) && x.age >= 25) f.push("R:dev-name-age25+");
	if (/Stretch|\bFour\b|\bFive\b/.test(main) && !BIGPOS.has(x.pos))
		f.push("R:big-word-non-big");
	if (/\bGuard\b|Point\b|Dimer|Floor General/.test(main) && BIGPOS.has(x.pos))
		f.push("R:guard-word-on-big");
	if (/\bBig\b|Five|Center|Rim Protector/.test(main) && GUARDPOS.has(x.pos))
		f.push("R:big-word-on-guard");
	if (/Hustle|Junkyard|Energy Big/.test(main) && (x.traits?.hustle ?? 0) < 55)
		f.push("R:hustle-trait<55");
	if (ovrPct >= 0.9 && (STAR_BAD.test(main) || mainNouns.size === 0))
		f.push("R:star-generic-name");
	// (athletic nouns crowding out a skill: his name says speed / leaping / strength while a skill he is in the league's
	// top 5% at goes unnamed)
	const ATH = ["speed", "jump", "strength"];
	if ([...mainNouns].some((n) => ATH.includes(n))) {
		const skill = best.find(
			(b) => !ATH.includes(b.noun) && b.top <= 5 && !allNouns.has(b.noun),
		);
		if (skill) f.push(`A:athletic-over-skill(${skill.noun})`);
	}
	if (ovrPct >= 0.9 && mainNouns.size === 0 && !def)
		f.push("R:star-no-skill-in-name");

	// --- label vs what he did (that season, qualified minutes; standings within his position bucket)
	const st = x.st;
	if (st && st.min >= QUAL_MIN) {
		const P = (k) => {
			const t = L.stat[POS_BUCKET[x.pos]]?.[k];
			return t && st[k] !== undefined ? pctIn(t, st[k]) : undefined;
		};
		const shooterWord =
			mainNouns.has("three") ||
			/Shoot|Sniper|Spacer|Deadeye|Stretch|Logo|Bomber|Gunner|Splash|Range/.test(
				main,
			);
		if (shooterWord) {
			if ((st.tpa36 ?? 0) < 3 || (P("tpa36") ?? 1) < 0.3)
				f.push("S:shooter-label-low-3PA");
			if ((st.tpag ?? 0) * st.gp >= 100 && (st.tppct ?? 1) < 0.32)
				f.push("S:shooter-label-poor-3P%");
		} else if (
			(P("tpa36") ?? 0) >= 0.9 &&
			(st.tppct ?? 0) >= 0.37 &&
			st.tpag * st.gp >= 150
		) {
			f.push("S:volume-shooter-unnamed");
		}
		if (allNouns.has("rimD")) {
			if ((P("blkp") ?? 1) < 0.3) f.push("S:rimD-label-low-blk%");
		} else if ((P("blkp") ?? 0) >= 0.9 && st.bpg >= 1)
			f.push("S:shotblocker-unnamed");
		if (allNouns.has("perimD") || allNouns.has("steal")) {
			if ((P("stlp") ?? 1) < 0.3 && (P("dbpm") ?? 1) < 0.4)
				f.push("S:perimD-label-poor-defense-stats");
		}
		if (allNouns.has("pass")) {
			if ((P("astp") ?? 1) < 0.3) f.push("S:pass-label-low-ast%");
		} else if ((P("astp") ?? 0) >= 0.9 && (st.astp ?? 0) >= 25)
			f.push("S:playmaker-unnamed");
		if (allNouns.has("reb")) {
			if ((P("trbp") ?? 1) < 0.3) f.push("S:reb-label-low-reb%");
		} else if ((P("trbp") ?? 0) >= 0.93 && st.rpg >= 8)
			f.push("S:rebounder-unnamed");
		if (allNouns.has("finish") && st.rimr !== undefined) {
			if ((P("rimr") ?? 1) < 0.3 && (P("ftr") ?? 1) < 0.4)
				f.push("S:finisher-label-few-rim-shots");
		}
		if (allNouns.has("post") && st.postr !== undefined) {
			if ((P("postr") ?? 1) < 0.3) f.push("S:post-label-few-post-shots");
		}
		if (allNouns.has("mid") && st.midr !== undefined) {
			if ((P("midr") ?? 1) < 0.3) f.push("S:mid-label-few-midrange");
		}
		if (
			(allNouns.has("handle") || /Creat|Iso|Shot Hunter/.test(main)) &&
			(P("usgp") ?? 1) < 0.25
		)
			f.push("S:creator-label-low-usage");
		if (
			ovrPct >= 0.9 &&
			(st.ppg ?? 0) >= 20 &&
			!["three", "mid", "post", "finish", "handle"].some((k) =>
				mainNouns.has(k),
			) &&
			!/Bucket|Scorer|Ace|Engine|Maestro/.test(main)
		)
			f.push("S:top-scorer-no-scoring-word");
	}
	// --- prospect-variety builds
	if (BIGPOS.has(x.pos) && x.r.tp >= L.tp80 && !mainNouns.has("three"))
		f.push("B:stretch-big-not-shooter");
	if (!BIGPOS.has(x.pos) && best[0]?.noun === "rimD" && !allNouns.has("rimD"))
		f.push("B:small-rim-protector-unnamed");
	return f;
};

const headers = [
	"league",
	"season",
	"pid",
	"name",
	"tid",
	"pos",
	"age",
	"ovr",
	"pot",
	...BASE,
	...EXP,
	...SUBS.map((k) => `s_${k}`),
	"traits",
	"gp",
	"min",
	"mpg",
	"ppg",
	"3pa_g",
	"3p%",
	"3pa36",
	"3par",
	"fta_g",
	"ftr",
	"apg",
	"rpg",
	"bpg",
	"spg",
	"ast%",
	"trb%",
	"blk%",
	"stl%",
	"usg%",
	"dbpm",
	"rim_share",
	"post_share",
	"mid_share",
	"label",
	"main",
	"defense",
	"conf",
	"noun_kind",
	"label_nouns",
	"engine_nouns_top5",
	"engine_nouns_all",
	"own_skill_best3",
	"own_skill_all",
	"history",
	"why",
	"flags",
];
const csvCell = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;

const rowOut = (league, x) => [
	league,
	x.season,
	x.pid,
	x.name,
	x.tid,
	x.pos,
	x.age,
	x.ovr,
	x.pot,
	...BASE.map((k) => x.r[k] ?? ""),
	...EXP.map((k) => x.r[k] ?? ""),
	...SUBS.map((k) => subOf(x.r, k) ?? ""),
	x.traits
		? Object.entries(x.traits)
				.map(([k, v]) => `${k}${Math.round(v)}`)
				.join(" ")
		: "",
	x.st?.gp ?? "",
	r1(x.st?.min, 0),
	r1(x.st?.mpg),
	r1(x.st?.ppg),
	r1(x.st?.tpag),
	r1(x.st?.tppct, 3),
	r1(x.st?.tpa36),
	r1(x.st?.tpar, 3),
	r1(x.st?.ftag),
	r1(x.st?.ftr, 3),
	r1(x.st?.apg),
	r1(x.st?.rpg),
	r1(x.st?.bpg),
	r1(x.st?.spg),
	r1(x.st?.astp),
	r1(x.st?.trbp),
	r1(x.st?.blkp),
	r1(x.st?.stlp),
	r1(x.st?.usgp),
	r1(x.st?.dbpm),
	r1(x.st?.rimr, 3),
	r1(x.st?.postr, 3),
	r1(x.st?.midr, 3),
	x.label,
	x.label.split(" · ")[0],
	x.label.split(" · ")[1] ?? "",
	x.conf ?? "",
	x.kind ?? "",
	(nounsOfName(x.label)?.nouns ?? []).join(" "),
	x.scores
		.slice(0, 5)
		.map((s) => `${s.key}:${Math.round(100 * s.pct)}`)
		.join(" "),
	x.scores.map((s) => `${s.key}:${Math.round(100 * s.pct)}`).join(" "),
	x.best
		.slice(0, 3)
		.map((b) => `${b.noun}:top${b.top}`)
		.join(" "),
	x.best.map((b) => `${b.noun}:top${b.top}`).join(" "),
	x.history ?? "",
	(x.why ?? []).join(" | "),
	x.flags.join(" "),
];

// League context: own-distribution skill tables, stat tables by position bucket, ovr table
const contextOf = (xs) => {
	const skill = {};
	for (const [k, fn] of Object.entries(SKILLS)) {
		skill[k] = xs
			.map((x) => fn(x.r))
			.filter((v) => v !== undefined)
			.sort((a, b) => a - b);
	}
	const stat = {};
	for (const x of xs) {
		if (!x.st || x.st.min < QUAL_MIN) continue;
		const b = (stat[POS_BUCKET[x.pos]] ??= {});
		for (const k of STAT_KEYS) {
			const v = x.st[k];
			if (typeof v === "number" && Number.isFinite(v)) (b[k] ??= []).push(v);
		}
	}
	for (const b of Object.values(stat))
		for (const k of Object.keys(b)) b[k].sort((p, q) => p - q);
	const tps = xs.map((x) => x.r.tp).sort((a, b) => a - b);
	return {
		skill,
		stat,
		ovr: xs.map((x) => x.ovr).sort((a, b) => a - b),
		tp80: tps[Math.floor(0.8 * (tps.length - 1))],
	};
};
const finish = (xs) => {
	const L = contextOf(xs);
	for (const x of xs) {
		x.best = Object.entries(SKILLS)
			.map(([noun, fn]) => ({
				noun,
				pct: pctIn(L.skill[noun], fn(x.r)),
			}))
			.sort((a, b) => b.pct - a.pct)
			.map((b) => ({ noun: b.noun, top: Math.round(100 * (1 - b.pct)) }));
		x.flags = flagsOf(x, L);
	}
	return L;
};

const summary = (title, xs) => {
	const out = [`== ${title}: ${xs.length} players`];
	const tally = {};
	for (const x of xs)
		for (const f of new Set(
			x.flags.map((f) => f.replace(/\(.*\)/, "")),
		))
			tally[f] = (tally[f] ?? 0) + 1;
	const pass = xs.filter(
		(x) => !x.flags.some((f) => f.startsWith("R:")),
	).length;
	const passAll = xs.filter((x) => x.flags.length === 0).length;
	out.push(
		`user-rules pass: ${pass} (${((100 * pass) / xs.length).toFixed(1)}%), no flag at all: ${passAll} (${((100 * passAll) / xs.length).toFixed(1)}%)`,
	);
	for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]))
		out.push(`  ${k}: ${v} (${((100 * v) / xs.length).toFixed(1)}%)`);
	for (const part of ["main", "defense", "label"]) {
		const c = {};
		for (const x of xs) {
			const [m, d] = x.label.split(" · ");
			const k = part === "main" ? m : part === "defense" ? (d ?? "-") : x.label;
			c[k] = (c[k] ?? 0) + 1;
		}
		const sh = Object.entries(c).sort((a, b) => b[1] - a[1]);
		out.push(
			`${part}: ${sh.length} distinct; top: ${sh
				.slice(0, 12)
				.map(([n, k]) => `${n} ${k}`)
				.join(", ")}`,
		);
	}
	const kinds = {};
	for (const x of xs) kinds[x.kind] = (kinds[x.kind] ?? 0) + 1;
	out.push(`noun pick kinds: ${JSON.stringify(kinds)}`);
	return out;
};

test.skipIf(!OUT)(
	"archetype diagnosis",
	async () => {
		mkdirSync(OUT, { recursive: true });
		const lines = [];
		const all = [];
		const hist = new Map();
		let last = [];
		await runLeague({
			config: CONFIG,
			settings: { ...OFF, ...TOGGLES[CONFIG] },
			seed: SEED,
			seasons: SEASONS,
			onSeason: async () => {
				const season = g.get("season");
				if (lines.length === 0) {
					lines.push(
						`config ${CONFIG} seed ${SEED}: ${["archetypes", "subRatings", "expandedRatings", "playerTraits", "advStats", "ovrV2", "improvedPositions"].map((k) => { let v; try { v = featureOn(k); } catch { v = "?"; } let gv; try { gv = g.get(k); } catch { gv = "unset"; } return `${k} ${v}/${gv}`; }).join(", ")}`,
					);
				}
				const norms = await getLeagueNorms(true);
				const rq = norms.nq ?? norms.rq;
				const players = await idb.cache.players.indexGetAll("playersByTid", [
					0,
					Infinity,
				]);
				const xs = [];
				for (const p of players) {
					const r = ratingsForArchetype(p);
					if (!r) continue;
					const row = p.ratings.at(-1);
					const info = await archetypeInfoForPlayer(p);
					if (!info) continue;
					const pos = isPos(row.pos) ? row.pos : "F";
					const traits = archetypeTraits(p, season);
					const np = pickNouns({
						r,
						pos,
						ovr: row.ovr,
						pot: row.pot,
						age: season - p.born.year,
						traits,
						rq,
						...(norms.common ? { common: norms.common } : {}),
					});
					const h = (p.archetypes ?? [])
						.map((e) => `${e.season}:${viewOf(e, row.pos)?.label ?? e.id}`)
						.join(" > ");
					hist.set(p.pid, {
						name: p.firstName === "FirstName" ? `p${p.pid}` : `${p.firstName} ${p.lastName}`,
						entries: (p.archetypes ?? []).map((e) => ({
							season: e.season,
							label: viewOf(e, row.pos)?.label ?? e.id,
						})),
					});
					xs.push({
						season,
						pid: p.pid,
						name: p.firstName === "FirstName" ? `p${p.pid}` : `${p.firstName} ${p.lastName}`,
						tid: p.tid,
						pos,
						age: season - p.born.year,
						ovr: row.ovr,
						pot: row.pot,
						r,
						traits,
						st: statsOf((p.stats ?? []).filter((s) => s.season === season)),
						label: info.label,
						conf: info.conf,
						kind: np.kind,
						scores: nounScores(r, rq),
						history: h,
						why: info.whyBullets,
					});
				}
				finish(xs);
				lines.push(...summary(`random league, season ${season}`, xs));
				all.push(...xs);
				last = xs;
			},
		});
		writeFileSync(
			`${OUT}/league_labels.csv`,
			[headers, ...last.map((x) => rowOut("random", x))]
				.map((r) => r.map(csvCell).join(","))
				.join("\n") + "\n",
		);
		writeFileSync(
			`${OUT}/league_labels_all.csv`,
			[headers, ...all.map((x) => rowOut("random", x))]
				.map((r) => r.map(csvCell).join(","))
				.join("\n") + "\n",
		);
		// Stability: stored labels season over season
		let steps = 0;
		let changes = 0;
		let mainChanges = 0;
		let defChanges = 0;
		const hrows = [["pid", "name", "seasons", "labels"]];
		for (const [pid, h] of hist) {
			const es = h.entries;
			for (let i = 1; i < es.length; i++) {
				steps++;
				if (es[i].label !== es[i - 1].label) changes++;
				if (es[i].label.split(" · ")[0] !== es[i - 1].label.split(" · ")[0])
					mainChanges++;
				if (es[i].label.split(" · ")[1] !== es[i - 1].label.split(" · ")[1])
					defChanges++;
			}
			hrows.push([pid, h.name, es.length, es.map((e) => `${e.season}:${e.label}`).join(" > ")]);
		}
		lines.push(
			`== stability (stored labels, season to season): ${steps} steps, label changed ${changes} (${((100 * changes) / Math.max(1, steps)).toFixed(1)}%), main name changed ${mainChanges} (${((100 * mainChanges) / Math.max(1, steps)).toFixed(1)}%), defensive label changed ${defChanges} (${((100 * defChanges) / Math.max(1, steps)).toFixed(1)}%)`,
		);
		writeFileSync(
			`${OUT}/label_history.csv`,
			hrows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n",
		);

		// Real players
		if (REAL) {
			const { realData, realPlayer, realNorms } = await import(
				"../../../common/archetypes/real.testutil.ts"
			);
			const season = Number(REAL);
			const data = realData();
			const rows = data.d.ratings.filter((r) => r.season === season);
			const ps = rows
				.map((row) => ({ row, rp: realPlayer(data, row) }))
				.map(({ row, rp }) => ({
					row,
					rp,
					st: statsOf(
						(data.st.stats[row.slug] ?? []).filter(
							(s) => s.season === season,
						),
					),
				}))
				.filter((x) => x.st && x.st.min > 0);
			const q = ratingQuantiles(
				ps.map((x) => ({ ratings: x.rp.ratings, ovr: x.rp.ovr })),
			);
			const xs = [];
			for (const { row, rp, st } of ps) {
				const norms = {
					...realNorms(defaultNormsFor(rp.ratings), false),
					rq: q,
					nq: q,
				};
				const c = classifyV2(rp.ratings, {
					norms,
					pos: rp.pos,
					ovr: rp.ovr,
					age: rp.age,
					srID: row.slug,
				});
				const np = pickNouns({
					r: rp.ratings,
					pos: rp.pos,
					ovr: rp.ovr,
					age: rp.age,
					rq: q,
				});
				xs.push({
					season,
					pid: row.slug,
					name: rp.name,
					tid: "",
					pos: rp.pos,
					age: rp.age,
					ovr: rp.ovr,
					pot: "",
					r: rp.ratings,
					st,
					label: c.label,
					conf: Math.round(100 * c.confidence),
					kind: np.kind,
					scores: nounScores(rp.ratings, q),
					why: (c.why ?? []).map(
						(w) => `${w.label} ${r1(w.z, 2)}`,
					),
				});
			}
			finish(xs);
			lines.push(...summary(`real players ${season}`, xs));
			writeFileSync(
				`${OUT}/real_labels.csv`,
				[headers, ...xs.map((x) => rowOut("real", x))]
					.map((r) => r.map(csvCell).join(","))
					.join("\n") + "\n",
			);
		}
		writeFileSync(`${OUT}/summary.txt`, lines.join("\n") + "\n");
		console.log(lines.join("\n"));
	},
	6 * 3600 * 1000,
);
