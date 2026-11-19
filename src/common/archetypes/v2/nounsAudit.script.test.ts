// @ts-nocheck
/* eslint-disable no-undef */
// archnouns: the user's 2048 audit (archetype_audit_2048.csv, unlabeled_prospect_suggestions_2048.csv) as a scorecard.
// RUN_NOUNS_AUDIT=<dir with the two csv files> to run. Reports how many labels pass the user's rules, read with the
// user's own percentiles (the "Best: ... (top N%)" of each row).
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { classifyV2 } from "./engine.ts";
import { fitSubsToBases, flatSubs, SUB_INDEX } from "../../subRatings.ts";
import { nounsOfName, type NounKey } from "./nouns.ts";
import { ELITE_RE } from "./honest.ts";
import type { ArchetypeRatings, Pos } from "../types.ts";

const DIR = process.env.RUN_NOUNS_AUDIT;

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
	PerD: "pdf",
	Lat: "lat",
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

const inputOf = (row: Record<string, string>) => {
	const [base, subs, traits] = row["Key ratings | sub-ratings | traits"]!.split(
		"|",
	).map((x) => x.trim());
	const r: Record<string, number> = {};
	for (const m of base!.matchAll(/([a-z]+)(\d+)/g)) {
		r[m[1]!] = Number(m[2]);
	}
	const ratings = { ...r } as unknown as ArchetypeRatings &
		Record<string, number>;
	const sub = flatSubs(ratings as any);
	for (const m of subs!.matchAll(/([A-Za-z]+)(\d+)/g)) {
		const k = SUB_KEY[m[1]!];
		if (k) {
			sub[SUB_INDEX[k]!] = Number(m[2]);
		}
	}
	(ratings as any).sub = fitSubsToBases(sub, ratings as any);
	const tr: Record<string, number> = {};
	for (const m of traits!.matchAll(/([A-Za-z]+)(\d+)/g)) {
		tr[m[1] === "defVers" ? "defensiveVersatility" : m[1]!] = Number(m[2]);
	}
	const pos = row["Pos/Height"]!.split(" ")[0] as Pos;
	const [ovr, pot] = row["OVR/POT"]!.split("/").map(Number) as [number, number];
	const age = Number(row.Age);
	// the user's best three skills, with their standing
	const best: { noun: NounKey; top: number }[] = [];
	const bm =
		/Best: (.*?)\. (?:Traits|Skills)/.exec(row.Reasoning ?? "")?.[1] ?? "";
	for (const part of bm.split(/\); /)) {
		const m = /^([\d A-Za-z-]+?) \d+ \(top (\d+)%/.exec(part.trim());
		if (m && SKILL_NOUN[m[1]!]) {
			best.push({ noun: SKILL_NOUN[m[1]!]!, top: Number(m[2]) });
		}
	}
	return { ratings, tr, pos, ovr, pot, age, best };
};

const HONESTISH =
	/Specialist|Camp Body|Rotation Filler|Journeyman|Project|Raw|Developing|Lottery|Late Bloomer|Two-Way Contract|Ten-Day|Emergency|Practice Squad|Garbage|Hustle|Junkyard|Energy Big|Pogo|Track Star|Bruiser|Big Body|Wall|Space Eater|Human Screen|Pest|Gnat|Hound|Gunner|Bomber|Merchant|One-Trick|Shot-Only|Dime|Pass-First|Pass-Only|Caretaker|Board Specialist|Glass-Only|Earthbound|Slow-Motion|Empty-Calorie|Clay|Blueprint|Upside|Sleeper|Unfinished|Toolsy|All Tools|All Legs|No Game|Glove|Stopper|Bench|Deep Bench|Ball-Handling Specialist|Closer|Old Head|Connector|Off-Ball Mover|Screen-and-Roll|Jack-of-all-Trades/;

test.skipIf(!DIR)(
	"nouns audit",
	() => {
		const files = [
			"archetype_audit_2048.csv",
			"unlabeled_prospect_suggestions_2048.csv",
		];
		const out: string[] = ["set,player,ovr,pos,engine,user,user best,ok,why"];
		const tally: Record<string, number> = {};
		let n = 0;
		let ok = 0;
		let sameNouns = 0;
		for (const f of files) {
			const rows = parseCsv(readFileSync(`${DIR}/${f}`, "utf8"));
			for (const row of rows) {
				const x = inputOf(row);
				const user =
					row["Correct archetype"] ?? row["Suggested archetype"] ?? "";
				const c = classifyV2(x.ratings, {
					pos: x.pos,
					ovr: x.ovr,
					pot: x.pot,
					age: x.age,
					traits: x.tr as any,
					prospect: f.startsWith("unlabeled"),
				});
				const name = c.label;
				const why: string[] = [];
				const bestNoun = x.best[0];
				const top3 = new Set(x.best.map((b) => b.noun));
				const nn = nounsOfName(name);
				if (ELITE_RE.test(name) && x.ovr < 58) {
					why.push("elite word below 58");
				}
				if (nn && !HONESTISH.test(name.split(" · ")[0]!)) {
					for (const k0 of nn.nouns) {
						// (the user's skills have no shot creation: it is his ball handling)
						const k = k0 === "creator" ? "handle" : k0;
						const b = x.best.find((b) => b.noun === k);
						if (!b && k !== "crafty") {
							why.push(`${k} not in his best three`);
						}
					}
					if (
						bestNoun &&
						bestNoun.top <= 15 &&
						!nn.nouns
							.map((k) => (k === "creator" ? "handle" : k))
							.includes(bestNoun.noun) &&
						!(
							nn.twoWay &&
							(bestNoun.noun === "perimD" || bestNoun.noun === "steal")
						)
					) {
						why.push(`misses best ${bestNoun.noun}`);
					}
				}
				if (
					/Camp Body|Rotation Filler|Journeyman|Filler|Two-Way Contract|Ten-Day|Practice Squad|Emergency/.test(
						name,
					)
				) {
					const strong = x.best.filter((b) => b.top <= 15).length;
					const good = x.best.filter((b) => b.top <= 26).length;
					if (strong >= 1 || good >= 2) {
						why.push("no-skill name with real skills");
					}
				}
				if (
					/Raw|Developing|Project/.test(name) &&
					x.ovr > 30 &&
					x.best.some((b) => b.top <= 30)
				) {
					why.push("development name above 30 with a skill");
				}
				if (
					/Stretch|Four|Five/.test(name) &&
					!["PF", "FC", "C"].includes(x.pos)
				) {
					why.push("big word on a non-big");
				}
				if (
					/Hustle|Junkyard|Energy Big/.test(name) &&
					(x.tr.hustle ?? 0) < 55
				) {
					why.push("hustle trait < 55");
				}
				for (const w of why) {
					tally[
						w
							.replace(/^\w+ not/, "X not")
							.replace(/misses best \w+/, "misses best")
					] =
						(tally[
							w
								.replace(/^\w+ not/, "X not")
								.replace(/misses best \w+/, "misses best")
						] ?? 0) + 1;
				}
				const un = nounsOfName(user);
				if (
					nn &&
					un &&
					[...un.nouns].sort().join() === [...nn.nouns].sort().join()
				) {
					sameNouns++;
				}
				n++;
				if (why.length === 0) {
					ok++;
				}
				out.push(
					[
						f.startsWith("unlabeled")
							? "prospect"
							: row["League file"]!.split(" ")[0],
						row.Player,
						x.ovr,
						x.pos,
						name,
						user,
						x.best.map((b) => `${b.noun}(${b.top})`).join(" "),
						why.length === 0 ? "yes" : "no",
						why.join("; "),
					]
						.map((v) => `"${String(v).replaceAll('"', '""')}"`)
						.join(","),
				);
			}
		}
		writeFileSync(`${DIR}/nouns_audit_result.csv`, out.join("\n"));
		console.log(
			`players ${n}, pass the rules ${ok} (${Math.round((100 * ok) / n)}%), same nouns as the user's label ${sameNouns}`,
		);
		console.log(tally);
	},
	600000,
);
