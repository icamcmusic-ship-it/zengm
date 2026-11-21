// @ts-nocheck
/* eslint-disable no-undef */
// archnouns4: the user's 2053 league audit (archetype_audit_L1_2053.csv: the labels he reviewed, with his verdict on
// the main and the defensive label; unlabeled_suggestions_L1_2053.csv: his names for players with no or a weak label)
// as a scorecard. RUN_AUDIT_L1=<dir with the two csv files> (AUDIT_L1_OUT=file.csv for every row).
// Each row is read as the game reads it in his league: his ratings, sub-ratings and traits, and the league's standings,
// rebuilt from the standings the audit quotes ("finishing 92 (top 0%)", "ball handling (drb) 52 only top 33%"), so a
// noun clears where the user says it does. The check is the user's: every word of the main and the defensive label
// keeps its promise (nouns.ts namePromises: a skill word's skill in the top 30% and among his three best, a trait word's
// trait at its bar, an elite word an elite ovr), and the label says his best skill when it is in the top 15%.
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { classifyV2 } from "./engine.ts";
import { fitSubsToBases, flatSubs, SUB_INDEX } from "../../subRatings.ts";
import {
	WORD_REQ,
	namePromises,
	nounScores,
	nounsOfName,
	type NounKey,
} from "./nouns.ts";
import { GATE_REF } from "./gateScale.data.ts";
import { percentileIn, RQ_POINTS } from "./gateScale.ts";
import { defaultNormsFor } from "../classify.ts";
import { hasUpside } from "./honest.ts";

const DIR = process.env.RUN_AUDIT_L1;

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

const SUB_KEY: Record<string, string> = {
	Blk: "blk",
	Stl: "stl",
	IntD: "idf",
	PerD: "pdf",
	Lat: "lat",
	Sprt: "sls",
	Crt: "crt",
	Vert: "mxv",
};
const SKILL_NOUN: Record<string, NounKey> = {
	passing: "pass",
	speed: "speed",
	leaping: "jump",
	"rim protection": "rimD",
	strength: "strength",
	"perimeter D": "perimD",
	"ball handling": "handle",
	rebounding: "reb",
	"post scoring": "post",
	"3PT shooting": "three",
	finishing: "finish",
	"mid-range": "mid",
	steals: "steal",
};
// The league table each noun is read against (nouns.ts NOUN_VALUE, expanded ratings on)
const NOUN_TABLE: Partial<Record<NounKey, string>> = {
	three: "tp",
	mid: "fg",
	post: "ins",
	finish: "dnk",
	rimD: "idef",
	perimD: "pdef",
	steal: "diq",
	handle: "drb",
	pass: "pss",
	reb: "reb",
	speed: "spd",
	jump: "jmp",
	strength: "stre",
};
// The elite tier in his league: ovr 58 (the audit: "top-10% + 55 floor" = 58)
const ELITE_OVR = 58;

const inputOf = (row: Record<string, string>) => {
	const [base, subs, traits] = row["Key ratings | sub-ratings | traits"]!.split(
		"|",
	).map((x) => x.trim());
	const r: Record<string, number> = {};
	for (const m of base!.matchAll(/([a-z]+)(\d+)/g)) {
		r[m[1]!] = Number(m[2]);
	}
	const ratings = { ...r } as any;
	const sub = flatSubs(ratings);
	for (const m of subs!.matchAll(/([\d&A-Za-z]+?)(\d+)(?:\s|$)/g)) {
		const k = SUB_KEY[m[1]!];
		if (k) {
			sub[SUB_INDEX[k]!] = Number(m[2]);
		}
	}
	ratings.sub = fitSubsToBases(sub, ratings);
	const tr: Record<string, number> = {};
	for (const m of (traits ?? "").matchAll(/([A-Za-z]+)(\d+)/g)) {
		tr[m[1] === "defVers" ? "defensiveVersatility" : m[1]!] = Number(m[2]);
	}
	const pos = row["Pos/Height"]!.split(" ")[0];
	const [ovr, pot] = row["OVR/POT"]!.split("/").map(Number) as [number, number];
	const age = Number(row.Age);
	const reason = row.Reasoning ?? "";
	const best: { noun: NounKey; v: number; top: number }[] = [];
	const bm = /Best: (.*?)\. (?:Traits|Skills)/.exec(reason)?.[1] ?? "";
	for (const part of bm.split(/\); /)) {
		const m = /^([\d A-Za-z-]+?) (\d+) \(top (\d+)%/.exec(part.trim());
		if (m && SKILL_NOUN[m[1]!]) {
			best.push({
				noun: SKILL_NOUN[m[1]!]!,
				v: Number(m[2]),
				top: Number(m[3]),
			});
		}
	}
	const clearing = new Set(
		(/Skills clearing the bar: ([ ,A-Za-z]+)\./.exec(reason)?.[1] ?? "")
			.split(",")
			.map((x) => x.trim())
			.filter(Boolean) as NounKey[],
	);
	const elite = /elite tier/.test(reason) && ovr >= ELITE_OVR;
	return { ratings, tr, pos, ovr, pot, age, best, clearing, elite };
};

// The standings the audit quotes: (value, top %) per noun
const quotedStandings = (rows: Record<string, string>[]) => {
	const pairs: Partial<Record<NounKey, [number, number][]>> = {};
	const add = (name: string, v: number, top: number) => {
		const n = SKILL_NOUN[name];
		if (n) {
			(pairs[n] ??= []).push([v, 1 - top / 100]);
		}
	};
	for (const row of rows) {
		const text = Object.values(row).join(" ; ");
		for (const m of text.matchAll(
			/([ 3A-Za-z-]+?) (?:\([/A-Za-z]+\) )?(\d+) \(top (\d+)%/g,
		)) {
			add(m[1]!.trim().replace(/^.*(?:skill|Best): /, ""), +m[2]!, +m[3]!);
		}
		for (const m of text.matchAll(
			/([ 3A-Za-z-]+?) \([/A-Za-z]+\) (\d+) only top (\d+)% of league/g,
		)) {
			add(m[1]!.trim().replace(/^.*; /, ""), +m[2]!, +m[3]!);
		}
	}
	return pairs;
};
// A league table (RQ_POINTS quantiles) from quoted standings: pooled to be monotone, the reference table's ends
const tableFrom = (pairs: [number, number][], ref: number[]) => {
	const ps = [...pairs].sort((a, b) => a[0] - b[0]);
	// pool adjacent violators on the standing
	const blocks: { v: number; p: number; n: number }[] = [];
	for (const [v, p] of ps) {
		blocks.push({ v, p, n: 1 });
		while (blocks.length > 1 && blocks.at(-2)!.p > blocks.at(-1)!.p) {
			const b = blocks.pop()!;
			const a = blocks.pop()!;
			blocks.push({
				v: (a.v * a.n + b.v * b.n) / (a.n + b.n),
				p: (a.p * a.n + b.p * b.n) / (a.n + b.n),
				n: a.n + b.n,
			});
		}
	}
	const pts = [
		{ v: Math.min(ref[0]!, blocks[0]?.v ?? ref[0]!), p: 0 },
		...blocks.map((b) => ({ v: b.v, p: b.p })),
		{ v: Math.max(ref.at(-1)!, blocks.at(-1)?.v ?? 0) + 0.5, p: 1 },
	];
	return Array.from({ length: RQ_POINTS }, (_, i) => {
		const q = i / (RQ_POINTS - 1);
		for (let j = 1; j < pts.length; j++) {
			if (q <= pts[j]!.p) {
				const a = pts[j - 1]!;
				const b = pts[j]!;
				const t = b.p > a.p ? (q - a.p) / (b.p - a.p) : 1;
				return Math.round((a.v + (b.v - a.v) * t) * 10) / 10;
			}
		}
		return pts.at(-1)!.v;
	});
};

// The nouns a name says, word by word (the checker's own reading), and as the engine reads its own names
const saidNouns = (name: string): Set<NounKey> => {
	const out = new Set<NounKey>();
	for (const w of WORD_REQ) {
		if ("nouns" in w && w.re.test(name)) {
			for (const n of w.nouns) {
				out.add(n);
			}
		}
	}
	if (/Two-Way|2-Way/.test(name)) {
		out.add("perimD");
	}
	// (and what the engine's own names say: the user's special names, nicknames)
	for (const n of nounsOfName(name)?.nouns ?? []) {
		out.add(n === "creator" ? "handle" : n);
	}
	return out;
};

const DEF_NOUNS = new Set(["rimD", "perimD", "steal"]);

test.skipIf(!DIR)(
	"2053 audit",
	() => {
		const fA = "archetype_audit_L1_2053.csv";
		const fB = "unlabeled_suggestions_L1_2053.csv";
		const sets = [fA, fB].map((f) => ({
			f,
			rows: parseCsv(readFileSync(`${DIR}/${f}`, "utf8")),
		}));
		const pairs = quotedStandings(sets.flatMap((s) => s.rows));
		const rq: Record<string, number[]> = { ...GATE_REF };
		for (const [n, ps] of Object.entries(pairs)) {
			const k = NOUN_TABLE[n as NounKey]!;
			if (ps!.length >= 8) {
				rq[k] = tableFrom(ps!, GATE_REF[k] ?? GATE_REF.drb);
			}
		}
		// (the elite tier: his league's top 10% from ovr 58)
		rq.ovr = GATE_REF.ovr!.map((v) => v - 3);

		const out = [
			"set,tier,player,ovr,pos,engine,engine defense,user,user defense,user best,ok main,ok defense,problems",
		];
		const tally: Record<string, number> = {};
		const res = {
			n: 0,
			okMain: 0,
			okDef: 0,
			nDef: 0,
			exact: 0,
			sameNouns: 0,
			defMissing: 0,
		};
		const byTier: Record<string, [number, number]> = {};
		const labelCount: Record<string, number> = {};
		let highFlyer = 0;
		for (const { f, rows } of sets) {
			for (const row of rows) {
				const x = inputOf(row);
				const c = classifyV2(x.ratings, {
					norms: { ...defaultNormsFor(x.ratings), rq, nq: rq },
					pos: x.pos,
					ovr: x.ovr,
					pot: x.pot,
					age: x.age,
					traits: x.tr,
				});
				const [main, def] = c.label.split(" · ");
				labelCount[main!] = (labelCount[main!] ?? 0) + 1;
				if (/High-Flying|High Flyer|Flyer/.test(main!)) {
					highFlyer++;
				}
				const scores = nounScores(x.ratings, rq);
				const pct = Object.fromEntries(scores.map((s) => [s.key, s.pct]));
				const ctx = {
					cleared: x.clearing,
					top3: new Set(x.best.slice(0, 3).map((b) => b.noun)),
					pct: (k: NounKey) => pct[k],
					crtPct: x.ratings.sub
						? percentileIn(rq.drb!, x.ratings.sub[SUB_INDEX.crt!])
						: undefined,
					traits: x.tr,
					eliteOvr: x.elite,
					mobile:
						Math.max(
							percentileIn(
								rq.spd!,
								x.ratings.sub?.[SUB_INDEX.lat!] ?? x.ratings.spd,
							),
							percentileIn(rq.spd!, x.ratings.spd),
						) >= 0.5,
					ovr: x.ovr,
					upside: hasUpside({ age: x.age, ovr: x.ovr, pot: x.pot }),
				};
				const probs = namePromises(main!, ctx).map((p) => `main ${p}`);
				const said = new Set([
					...saidNouns(main!),
					...(def ? saidNouns(def) : []),
				]);
				const b0 = x.best[0];
				// (a development name is about his tools and upside, not one skill)
				if (
					b0 &&
					b0.top <= 15 &&
					!said.has(b0.noun) &&
					!/\bRaw\b|Developing|Project|Athlete|Tools/.test(main!)
				) {
					probs.push(`misses his best skill (${b0.noun}, top ${b0.top}%)`);
				}
				const defProbs = def
					? namePromises(def, { ...ctx, top3: ctx.cleared }).map(
							(p) => `defense ${p}`,
						)
					: [];
				const defStrong = x.best.some(
					(b) => DEF_NOUNS.has(b.noun) && b.top <= 15,
				);
				if (
					!def &&
					defStrong &&
					!said.has(x.best.find((b) => DEF_NOUNS.has(b.noun))!.noun)
				) {
					res.defMissing++;
				}
				for (const p of [...probs, ...defProbs]) {
					const k = p.replace(/\(.*\)/, "").replace(/\d+/g, "N");
					tally[k] = (tally[k] ?? 0) + 1;
				}
				const user = (
					row["Correct archetype"] ??
					row["Suggested archetype"] ??
					""
				).trim();
				const userDef = (
					row["Correct defensive label"] ??
					row["Suggested defensive label"] ??
					""
				).trim();
				const okMain = probs.length === 0;
				const okDef = defProbs.length === 0;
				res.n++;
				if (okMain) {
					res.okMain++;
				}
				if (def) {
					res.nDef++;
					if (okDef) {
						res.okDef++;
					}
				}
				if (main === user) {
					res.exact++;
				}
				const un = saidNouns(user);
				const en = saidNouns(main!);
				if (un.size > 0 && [...un].sort().join() === [...en].sort().join()) {
					res.sameNouns++;
				}
				const tier =
					f === fB ? "unlabeled" : row["League file"]!.split(" ")[0]!;
				byTier[tier] ??= [0, 0];
				byTier[tier][0]++;
				if (okMain) {
					byTier[tier][1]++;
				}
				out.push(
					[
						f === fB ? "unlabeled" : "audit",
						tier,
						row.Player,
						x.ovr,
						x.pos,
						main,
						def ?? "",
						user,
						userDef,
						x.best.map((b) => `${b.noun}(${b.top})`).join(" "),
						okMain ? "yes" : "no",
						def ? (okDef ? "yes" : "no") : "",
						[...probs, ...defProbs].join("; "),
					]
						.map((v) => `"${String(v).replaceAll('"', '""')}"`)
						.join(","),
				);
			}
		}
		if (process.env.AUDIT_L1_OUT) {
			writeFileSync(process.env.AUDIT_L1_OUT, out.join("\n") + "\n");
		}
		const pc = (a: number, b: number) =>
			`${((100 * a) / Math.max(1, b)).toFixed(0)}%`;
		const top = Object.entries(labelCount).sort((a, b) => b[1] - a[1]);
		console.log(
			[
				`players ${res.n}: main label keeps its promises ${res.okMain} (${pc(res.okMain, res.n)}); defensive labels ${res.nDef}, ok ${res.okDef} (${pc(res.okDef, res.nDef)}); no defensive label with a top-15% defensive best skill ${res.defMissing}`,
				`same name as the user's ${res.exact}, same nouns ${res.sameNouns}; High-Flying / High Flyer names ${highFlyer} (${pc(highFlyer, res.n)})`,
				`by tier: ${Object.entries(byTier)
					.map(([k, [n, ok]]) => `${k} ${pc(ok, n)} of ${n}`)
					.join(", ")}`,
				`top labels: ${top
					.slice(0, 10)
					.map(([k, v]) => `${k} ${v}`)
					.join(", ")}`,
				`problems: ${JSON.stringify(Object.entries(tally).sort((a, b) => b[1] - a[1]))}`,
			].join("\n"),
		);
	},
	600000,
);
