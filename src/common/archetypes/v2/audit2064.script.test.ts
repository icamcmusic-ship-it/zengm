// @ts-nocheck
/* eslint-disable no-undef */
// archcov: the user's 2064 league audit (archetype_audit_2064.csv: his verdict on every label of the players on a
// roster or in free agency, with the name that fits better) as a scorecard, read from his league's player exports
// (the BBGM player JSON files next to it), so every input is exact: his true ratings, sub-ratings and expanded
// ratings, his trait scores (from the stored seeds, age and experience), last season's label, and the league's own
// standings (everyone on a roster or in free agency, as getLeagueNorms reads a league).
//   RUN_AUDIT_2064=<dir with the csv and the json exports> [AUDIT_2064_OUT=file.csv] [AUDIT_2064_FRESH=1: no last label]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { classifyV2 } from "./engine.ts";
import { setCoverDebug, setCoverFinal } from "./cover.ts";
import { archetypeById, defaultNormsFor } from "../classify.ts";
import { mergedId } from "../merges.data.ts";
import { RATING_KEYS } from "../../ratingsBuilds/solver.ts";
import { EXPANDED_RATINGS2 } from "../../expandedRatings.ts";
import { isValidSubArray } from "../../subRatings.ts";
import { ratingQuantiles } from "./gateScale.ts";
import {
	defLabelNouns,
	nounGroupQuantiles,
	nounsOfName,
	type NounKey,
	type NounPick,
} from "./nouns.ts";
import {
	completeTraitSeeds,
	proSeasonsPlayed,
	traitScores,
	TRAIT_DEFINITIONS,
} from "../../playerTraits/index.ts";

const DIR = process.env.RUN_AUDIT_2064;

const parseCsv = (text: string): Record<string, string>[] => {
	const rows: string[][] = [];
	let row: string[] = [];
	let cur = "";
	let q = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!;
		if (q) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					cur += '"';
					i++;
				} else {
					q = false;
				}
			} else {
				cur += ch;
			}
		} else if (ch === '"') {
			q = true;
		} else if (ch === ",") {
			row.push(cur);
			cur = "";
		} else if (ch === "\n") {
			row.push(cur);
			rows.push(row);
			row = [];
			cur = "";
		} else if (ch !== "\r") {
			cur += ch;
		}
	}
	if (cur || row.length) {
		row.push(cur);
		rows.push(row);
	}
	const head = rows[0]!;
	return rows
		.slice(1)
		.filter((r) => r.length >= head.length)
		.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]!])));
};

// His ratings as the game reads them for a label (player/archetype.ts ratingsForArchetype: true ratings, expanded
// ratings, sub-ratings)
const ratingsOf = (row: any) => {
	const out: any = {};
	for (const k of RATING_KEYS) {
		out[k] = row[k];
	}
	if (typeof row.pdef === "number" && typeof row.idef === "number") {
		out.wng = row.wng;
		out.pdef = row.pdef;
		out.idef = row.idef;
		for (const k of EXPANDED_RATINGS2) {
			out[k] = row[k];
		}
	}
	if (isValidSubArray(row.sub)) {
		out.sub = row.sub;
	}
	return out;
};

const SKILL: Record<string, NounKey> = {
	"Perimeter D": "perimD",
	"Rim protection": "rimD",
	Steals: "steal",
	Rebounding: "reb",
	Finishing: "finish",
	"Post scoring": "post",
	"Mid-range": "mid",
	"3PT": "three",
	"Ball handling": "handle",
	"Shot creation": "creator",
	Passing: "pass",
	"Off. IQ": "crafty",
	Speed: "speed",
	Leaping: "jump",
	Strength: "strength",
};
const sk = (w: string) => SKILL[w.trim()];
// The user's complaint about a label, read back as checks on a new label: each check is true when it is fixed
const complaintChecks = (
	why: string,
): ((l: {
	main: string;
	def?: string;
	named: Set<NounKey>;
	kind: string;
}) => boolean)[] => {
	const out: ((l: {
		main: string;
		def?: string;
		named: Set<NounKey>;
		kind: string;
	}) => boolean)[] = [];
	for (const m of why.matchAll(/name claims ([\w .]+?), but he's only/g)) {
		const n = sk(m[1]!);
		if (n) {
			out.push((l) => !l.named.has(n));
		}
	}
	for (const m of why.matchAll(/skips his best skill, ([\w .]+?) \d+th/g)) {
		const n = sk(m[1]!);
		if (n) {
			out.push((l) => l.named.has(n));
		}
	}
	for (const m of why.matchAll(/leaves out ([\w .]+?) \d+th/g)) {
		const n = sk(m[1]!);
		if (n) {
			out.push((l) => l.named.has(n));
		}
	}
	for (const m of why.matchAll(/no defensive tag despite ([\w .]+?) \d+th/g)) {
		const n = sk(m[1]!);
		if (n) {
			out.push((l) => l.named.has(n));
		}
	}
	if (/'Gunner' end word/.test(why)) {
		out.push(
			(l) =>
				!/Gunner/.test(l.main) || l.named.has("three") || l.named.has("mid"),
		);
	}
	if (/'specialist' name but/.test(why)) {
		out.push((l) => l.kind !== "honest");
	}
	if (/athlete with no game/.test(why)) {
		out.push((l) => !/No Game|Athlete/.test(l.main));
	}
	for (const m of why.matchAll(/([\w .]+?) is only par for a/g)) {
		const n = sk(m[1]!.replace(/^.*; /, ""));
		if (n) {
			out.push((l) => !l.named.has(n));
		}
	}
	for (const m of why.matchAll(/def label '[^']+' but ([\w ]+?) \d+th/g)) {
		const n = sk(m[1]!);
		if (n) {
			out.push((l) => !(l.def && defLabelNouns(l.def).includes(n)));
		}
	}
	for (const m of why.matchAll(/match his real top skills \(([^)]+)\)/g)) {
		const ns = m[1]!.split(",").map(sk).filter(Boolean) as NounKey[];
		out.push((l) => ns.some((n) => l.named.has(n)));
	}
	for (const m of why.matchAll(/leans on ([\w .]+?) \d+th, which is only/g)) {
		const n = sk(m[1]!);
		if (n) {
			out.push((l) => !l.named.has(n));
		}
	}
	if (/names his athleticism only/.test(why)) {
		out.push((l) =>
			[...l.named].some((n) => !["speed", "jump", "strength"].includes(n)),
		);
	}
	for (const m of why.matchAll(/but his best is ([\w .]+?) \d+th/g)) {
		const n = sk(m[1]!);
		if (n) {
			out.push((l) => l.named.has(n));
		}
	}
	if (/'Switch Defender' but/.test(why)) {
		out.push((l) => !/Switch Defender/.test(l.def ?? ""));
	}
	for (const m of why.matchAll(/his thing is ([\w .]+?), but/g)) {
		const n = sk(m[1]!);
		if (n) {
			out.push((l) => !l.named.has(n));
		}
	}
	return out;
};

const DEF_NOUNS = new Set(["rimD", "perimD", "steal"]);
const nounsOf = (label: string): Set<NounKey> => {
	const out = new Set<NounKey>();
	for (const part of label.split(" · ")) {
		for (const n of nounsOfName(part)?.nouns ?? []) {
			out.add(n === "creator" ? "handle" : n);
		}
	}
	return out;
};

test.skipIf(!DIR)(
	"2064 audit",
	() => {
		const players: any[] = [];
		for (const f of readdirSync(DIR)) {
			if (f.endsWith(".json")) {
				players.push(
					...JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")).players,
				);
			}
		}
		const season = 2064;
		const startingSeason = Math.min(
			...players.flatMap((p) => (p.stats ?? []).map((s: any) => s.season)),
		);
		const info = players.map((p) => {
			const row = p.ratings.at(-1);
			const age = season - p.born.year;
			const experience = Math.max(0, season - (p.draft?.year ?? season));
			const sc = traitScores(row, completeTraitSeeds(p.traits, 0, p.pid), {
				age,
				experience,
				proSeasons: proSeasonsPlayed({ p, season, startingSeason }),
			});
			const traits: Record<string, number> = {};
			for (const [k, v] of Object.entries(sc)) {
				if (k in TRAIT_DEFINITIONS) {
					traits[k] = v as number;
				}
			}
			const prev = (p.archetypes ?? []).find(
				(e: any) => e.season === season - 1,
			);
			const cur = (p.archetypes ?? []).find((e: any) => e.season === season);
			// (how many seasons in a row he has had this season's label)
			let run = 0;
			for (let s = season; ; s--) {
				const e = (p.archetypes ?? []).find((x: any) => x.season === s);
				if (!e || e.id !== cur?.id) {
					break;
				}
				run++;
			}
			return {
				p,
				name: `${p.firstName} ${p.lastName}`,
				ratings: ratingsOf(row),
				ovr: row.ovr,
				pot: row.pot,
				pos: row.pos,
				age,
				traits,
				prev,
				cur,
				run,
			};
		});
		const pool = info.filter((x) => x.p.tid >= -1);
		const listed = info.filter((x) => x.p.tid >= -1 || x.p.tid === -9);
		const nq = ratingQuantiles(pool);
		const ng = nounGroupQuantiles(pool);
		const labelOf = (e: any) => {
			if (!e) {
				return "";
			}
			const a = archetypeById(mergedId(e.id));
			return `${a?.name ?? e.id}${e.def ? ` · ${e.def}` : ""}`;
		};
		const labeled = pool.filter((x) => x.cur);
		const counts: Record<string, number> = {};
		for (const x of labeled) {
			counts[x.cur.id] = (counts[x.cur.id] ?? 0) + 1;
		}
		const common = Object.fromEntries(
			Object.entries(counts).map(([k, v]) => [k, v / labeled.length]),
		);
		const fresh = !!process.env.AUDIT_2064_FRESH;
		const who = process.env.AUDIT_2064_WHO?.split(",") ?? [];
		const read = (x: any) => {
			if (who.includes(x.name)) {
				setCoverDebug((cs, sc) => {
					console.log(
						`${x.name} ${x.pos} ${x.ovr}: ${sc
							.map(
								(s) =>
									`${s.key} ${Math.round(100 * s.league)}/${Math.round(100 * s.group)}`,
							)
							.join(", ")}\n${[...cs]
							.sort((a, b) => b.score - a.score)
							.slice(0, 12)
							.map(
								(c) =>
									`  ${c.score.toFixed(2)} ${c.pick.kind === "special" || c.pick.kind === "trait" ? c.pick.name : c.pick.kind === "composed" ? `${c.pick.role}:${c.pick.descs.join("+")}` : "honest"}${c.pick.defense ? ` · ${c.pick.defense}` : ""} [${c.main.join(",")}]`,
							)
							.join("\n")}`,
					);
				});
			}
			let final: NounPick | undefined;
			setCoverFinal((p) => {
				final = p;
			});
			const c = classifyV2(x.ratings, {
				norms: { ...defaultNormsFor(x.ratings), nq, ng, common },
				pos: x.pos,
				ovr: x.ovr,
				pot: x.pot,
				age: x.age,
				traits: x.traits,
				...(x.prev && !fresh
					? {
							previousId: x.prev.id,
							...(x.prev.def ? { previousDefense: x.prev.def } : {}),
						}
					: {}),
			});
			setCoverDebug(undefined);
			setCoverFinal(undefined);
			if (who.includes(x.name)) {
				console.log(`  => ${c.label} (prev ${labelOf(x.prev)})`);
			}
			const named = new Set<NounKey>(
				(final?.main ?? []).map((n) => n as NounKey),
			);
			const [main, def] = c.label.split(" · ");
			for (const n of def ? defLabelNouns(def) : []) {
				named.add(n);
			}
			return {
				label: c.label,
				main: main!,
				def,
				named,
				kind: final?.kind ?? "",
			};
		};
		const byName = new Map<string, any[]>();
		for (const x of listed) {
			byName.set(x.name, [...(byName.get(x.name) ?? []), x]);
		}
		const rows = parseCsv(
			readFileSync(`${DIR}/archetype_audit_2064.csv`, "utf8"),
		);
		const res = {
			n: 0,
			found: 0,
			repro: 0,
			agree: 0,
			agreeKept: 0,
			agreeSameNouns: 0,
			dis: 0,
			disChanged: 0,
			disExact: 0,
			disNouns: 0,
			defTag: 0,
			defTagOk: 0,
			fixed: 0,
			checks: 0,
			checksOk: 0,
		};
		const unfixed: string[] = [];
		// (every row, read with the user's own standings: his best basketball skill at the 70th percentile or better in
		// both, named by the label; a label naming athleticism only while he has such a skill)
		const rule = {
			n: 0,
			bestBefore: 0,
			bestAfter: 0,
			athBefore: 0,
			athAfter: 0,
		};
		const ATHW =
			/Speedy|High-Flying|High Flyer|Physical|Twitchy|Quick|Bouncy|Burner|Track Star|Pogo|Bruiser|Bulldozer|Glider|Athlete|All Legs|Big Body/;
		const byVerdict: Record<string, [number, number, number, number]> = {};
		const out = [
			"player,pos,ovr,verdict,stored,engine,better fit,exact,same nouns,changed",
		];
		const labels: Record<string, number> = {};
		for (const row of rows) {
			res.n++;
			const cands = byName.get(row.Player) ?? [];
			const x =
				cands.find((c) => c.pos === row.Pos && c.ovr === Number(row.OVR)) ??
				cands[0];
			if (!x) {
				continue;
			}
			res.found++;
			const stored = labelOf(x.cur);
			if (stored === row["Current archetype"]) {
				res.repro++;
			}
			const rd = read(x);
			const lab = rd.label;
			labels[lab.split(" · ")[0]!] = (labels[lab.split(" · ")[0]!] ?? 0) + 1;
			{
				const top = (row["Top skills (league pct / pct within position)"] ?? "")
					.split(",")
					.map((t) => /^(.*?) (\d+)\/(\d+)$/.exec(t.trim()))
					.filter(Boolean)
					.map((m) => ({ n: sk(m![1]!), v: Math.min(+m![2]!, +m![3]!) }))
					.filter((t) => t.n && !["speed", "jump", "strength"].includes(t.n));
				const b = top.sort((a, c) => c.v - a.v)[0];
				if (b && b.v >= 70) {
					rule.n++;
					const before = nounsOf(row["Current archetype"]);
					if (before.has(b.n!) || (b.n === "creator" && before.has("handle"))) {
						rule.bestBefore++;
					}
					if (
						rd.named.has(b.n!) ||
						(b.n === "creator" && rd.named.has("handle"))
					) {
						rule.bestAfter++;
					}
					if (
						ATHW.test(row["Current archetype"]!.split(" · ")[0]!) &&
						![...before].some((n) => !["speed", "jump", "strength"].includes(n))
					) {
						rule.athBefore++;
					}
					if (
						![...rd.named].some(
							(n) => !["speed", "jump", "strength"].includes(n),
						)
					) {
						rule.athAfter++;
					}
				}
			}
			const better = row["Better fit"];
			const v = row.Verdict;
			const exact = better !== "" && lab === better;
			const exactMain =
				better !== "" && lab.split(" · ")[0] === better.split(" · ")[0];
			const bn = nounsOf(better);
			const en = nounsOf(lab);
			const sameNouns =
				bn.size > 0 && [...bn].sort().join() === [...en].sort().join();
			const changed = lab !== row["Current archetype"];
			byVerdict[v] ??= [0, 0, 0, 0];
			byVerdict[v][0]++;
			if (v === "Agree") {
				res.agree++;
				if (!changed) {
					res.agreeKept++;
				}
				const sn = nounsOf(row["Current archetype"]);
				if ([...sn].sort().join() === [...en].sort().join()) {
					res.agreeSameNouns++;
				}
			} else {
				res.dis++;
				if (changed) {
					res.disChanged++;
					byVerdict[v][1]++;
				}
				if (exact || exactMain) {
					res.disExact++;
					byVerdict[v][2]++;
				}
				if (sameNouns) {
					res.disNouns++;
					byVerdict[v][3]++;
				}
				const checks = complaintChecks(row.Why ?? "");
				const ok = checks.filter((f) => f(rd)).length;
				res.checks += checks.length;
				res.checksOk += ok;
				if (ok === checks.length) {
					res.fixed++;
				} else {
					unfixed.push(
						`${row.Player} ${row.Pos} ${row.OVR}: ${row["Current archetype"]} => ${lab} [better: ${better}] (${row.Why})`,
					);
				}
				if (/defensive tag/.test(v)) {
					res.defTag++;
					if (lab.includes(" · ")) {
						res.defTagOk++;
					}
				}
			}
			out.push(
				[
					row.Player,
					row.Pos,
					row.OVR,
					v,
					row["Current archetype"],
					lab,
					better,
					exact || exactMain ? "yes" : "",
					sameNouns ? "yes" : "",
					changed ? "yes" : "",
				]
					.map((s) => `"${String(s).replaceAll('"', '""')}"`)
					.join(","),
			);
		}
		// archcov: the reference set (reference.data.ts, read by reference.test.ts): every row with the user's better fit,
		// his snapshot as the engine reads him, and the league's tables
		if (process.env.AUDIT_2064_REF) {
			const r1 = (v: number) => Math.round(v * 10) / 10;
			const players = rows
				.filter((row) => row["Better fit"])
				.map((row) => {
					const x =
						(byName.get(row.Player) ?? []).find(
							(c) => c.pos === row.Pos && c.ovr === Number(row.OVR),
						) ?? byName.get(row.Player)?.[0];
					return x
						? {
								name: row.Player,
								pos: x.pos,
								ovr: x.ovr,
								pot: x.pot,
								age: x.age,
								ratings: x.ratings,
								traits: x.traits,
								expected: row["Better fit"],
								verdict: row.Verdict,
								why: row.Why,
							}
						: undefined;
				})
				.filter(Boolean);
			const round = (q: any): any =>
				Array.isArray(q)
					? q.map(r1)
					: Object.fromEntries(
							Object.entries(q).map(([k, v]) => [k, round(v)]),
						);
			writeFileSync(
				process.env.AUDIT_2064_REF,
				`// GENERATED by v2/audit2064.script.test.ts (AUDIT_2064_REF=<this file>), then curated by hand: the reference set.
// archcov: players of the user's 2064 league with the label he says fits (his audit's "Better fit"), each as the engine
// reads him (true ratings, sub-ratings, expanded ratings, trait scores), and his league's tables. reference.test.ts
// reruns the engine on them after every rule change and reports how many it names as he does. Edit "expected" (or add
// players) to curate it.
import type { ArchetypeRatings, Pos } from "../types.ts";

export type ReferencePlayer = {
	name: string;
	pos: Pos;
	ovr: number;
	pot: number;
	age: number;
	ratings: ArchetypeRatings;
	traits: Record<string, number>;
	expected: string;
	verdict: string;
	why: string;
};
export const REFERENCE_LEAGUE: {
	nq: Partial<Record<string, number[]>>;
	ng: Partial<Record<string, Partial<Record<string, number[]>>>>;
} = ${JSON.stringify({ nq: round(nq), ng: round(ng) })};
export const REFERENCE_PLAYERS: ReferencePlayer[] = ${JSON.stringify(players, null, "\t")};
`,
			);
		}
		if (process.env.AUDIT_2064_UNFIXED) {
			writeFileSync(process.env.AUDIT_2064_UNFIXED, unfixed.join("\n") + "\n");
		}
		if (process.env.AUDIT_2064_OUT) {
			writeFileSync(process.env.AUDIT_2064_OUT, out.join("\n") + "\n");
		}
		const pc = (a: number, b: number) =>
			`${((100 * a) / Math.max(1, b)).toFixed(0)}%`;
		const top = Object.entries(labels).sort((a, b) => b[1] - a[1]);
		console.log(
			[
				`rows ${res.n}, found ${res.found}, stored label = audit's ${res.repro}`,
				`agreed ${res.agree}: label unchanged ${res.agreeKept} (${pc(res.agreeKept, res.agree)}), same skills ${res.agreeSameNouns} (${pc(res.agreeSameNouns, res.agree)})`,
				`disagreed ${res.dis}: changed ${res.disChanged} (${pc(res.disChanged, res.dis)}), = better fit (main) ${res.disExact} (${pc(res.disExact, res.dis)}), same skills as better fit ${res.disNouns} (${pc(res.disNouns, res.dis)}); missing defensive tag fixed ${res.defTagOk}/${res.defTag}`,
				`the user's complaint fixed (every check of his reason): ${res.fixed}/${res.dis} (${pc(res.fixed, res.dis)}); checks ${res.checksOk}/${res.checks}`,
				`every row, the user's standings: ${rule.n} with a basketball skill at 70+ (league and position); his best named before ${rule.bestBefore} (${pc(rule.bestBefore, rule.n)}), after ${rule.bestAfter} (${pc(rule.bestAfter, rule.n)}); athletic-only or no-skill label before ${rule.athBefore}, after ${rule.athAfter}`,
				`by verdict [n, changed, = better fit, same skills]: ${JSON.stringify(byVerdict)}`,
				`labels ${top.length}, top 10 share ${pc(
					top.slice(0, 10).reduce((s, [, k]) => s + k, 0),
					res.found,
				)}: ${top
					.slice(0, 10)
					.map(([k, n]) => `${k} ${n}`)
					.join(", ")}`,
			].join("\n"),
		);
	},
	600000,
);
