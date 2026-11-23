// @ts-nocheck
/* eslint-disable no-undef */
// archfam (reading 28): the user's 2070 league audit (513 rostered players: his verdict, a better fit and other good
// fits, his six best standings) as a scorecard. No player export came with it, so each player is rebuilt from the
// standings the audit quotes ("Top skills (standing)", and the "(NN)" numbers of his reasons): those skills stand where
// he says, a skill his current label or tag names (unquoted) just under his sixth, "N skills at the 90th+" filled in,
// and the rest at most at the 55th. His base ratings follow from the standings (the reference tables), so the honest
// names and the ratings-only checks read about the same player. Each player is read fresh (no last-season label).
// (archskill, reading 29: the new skills stand with his unquoted ones: the audit quotes none of them.)
//   RUN_AUDIT_2070=<audit.csv> [AUDIT_2070_OUT=file.csv] [AUDIT_2070_LEAGUE=<dir of BBGM player exports>]
// Reports: agreement with his "Better fit" and "Other good fits" (exact name, and the same skill families), how many
// Disagree rows get a name he'd accept, distinct names, one-offs, the top name's share, 2-Way names among the two-way
// players, catalog special names held, names that spend two words on one family, and (AUDIT_2070_LEAGUE: an equivalent
// league from real exports, e.g. his 2064 league) the same shares there plus how many labels are kept from last season.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { classifyV2 } from "./engine.ts";
import { setCoverDebug, setCoverFinal } from "./cover.ts";
import { defaultNormsFor } from "../classify.ts";
import { RATING_KEYS } from "../../ratingsBuilds/solver.ts";
import { EXPANDED_RATINGS2 } from "../../expandedRatings.ts";
import { isValidSubArray } from "../../subRatings.ts";
import { ratingQuantiles } from "./gateScale.ts";
import {
	CUSTOM_SPECIALS,
	coverScores,
	NEW_NOUNS,
	nounGroupQuantiles,
	nounsOfName,
	ratingAtPct,
	specialsAt,
	type NounKey,
	type NounPick,
} from "./nouns.ts";
import {
	completeTraitSeeds,
	proSeasonsPlayed,
	traitScores,
	TRAIT_DEFINITIONS,
} from "../../playerTraits/index.ts";

const CSV = process.env.RUN_AUDIT_2070;

const parseCsv = (text: string): Record<string, string>[] => {
	const rows: string[][] = [];
	let row: string[] = [];
	let cur = "";
	let q = false;
	text = text.replace(/^\uFEFF/, "");
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

const SKILL: Record<string, NounKey> = {
	Post: "post",
	"Rim Protection": "rimD",
	"Perimeter D": "perimD",
	Rebounding: "reb",
	"3PT": "three",
	Steals: "steal",
	"Mid-Range": "mid",
	Mid: "mid",
	"Off. IQ": "crafty",
	Finishing: "finish",
	Fin: "finish",
	Strength: "strength",
	Leaping: "jump",
	Speed: "speed",
	Passing: "pass",
	"Shot Creation": "creator",
	Handle: "handle",
};
const ALL: NounKey[] = [
	"three",
	"mid",
	"post",
	"finish",
	"rimD",
	"perimD",
	"steal",
	"handle",
	"creator",
	"pass",
	"reb",
	"speed",
	"jump",
	"strength",
	"crafty",
];
const ATH = new Set(["speed", "jump", "strength"]);
const DEF = new Set(["rimD", "perimD", "steal"]);
const OFF = new Set([
	"three",
	"mid",
	"post",
	"finish",
	"handle",
	"creator",
	"pass",
]);
// The user's families: each counts once
const FAMILY: Record<string, string> = {
	three: "shoot",
	mid: "shoot",
	handle: "create",
	creator: "create",
	perimD: "perim",
	steal: "perim",
	rimD: "rimD",
	post: "post",
	finish: "finish",
	pass: "pass",
	reb: "reb",
	crafty: "crafty",
};
const HGT: Record<string, number> = {
	PG: 30,
	G: 35,
	SG: 38,
	GF: 45,
	SF: 48,
	F: 52,
	PF: 58,
	FC: 62,
	C: 66,
};

// The skills a name says (the user's words too: "Three-Level", "High-IQ", "3 & D", "Iso Sniper", ...)
const namedOf = (name: string): { nouns: Set<string>; twoWay: boolean } => {
	const main = name.split(" · ")[0]!;
	const out = new Set<string>();
	const nn = nounsOfName(main);
	for (const n of nn?.nouns ?? []) {
		out.add(n);
	}
	let twoWay = !!nn?.twoWay || /\b(2|Two)-Way\b/.test(main);
	if (/Three-Level|3-Level/.test(main)) {
		out.add("three");
		out.add("finish");
	}
	if (/High-IQ|Crafty|Cerebral/.test(main)) {
		out.add("crafty");
	}
	if (/3 & D/.test(main)) {
		out.add("three");
		twoWay = true;
	}
	return { nouns: out, twoWay };
};
const familiesOf = (name: string) => {
	const { nouns, twoWay } = namedOf(name);
	const off = new Set<string>();
	let def = twoWay;
	for (const n of nouns) {
		if (DEF.has(n)) {
			def = true;
		} else if (FAMILY[n] && n !== "crafty") {
			off.add(FAMILY[n]);
		}
	}
	return { off: [...off].sort().join("+"), def };
};
const norm = (s: string) =>
	s
		.split(" · ")[0]!
		.toLowerCase()
		.replace(/\btwo-way\b/g, "2-way")
		.replace(/\bthree-level\b/g, "3-level")
		.replace(/\s+/g, " ")
		.trim();

const ratingsOfRow = (row: any) => {
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

// One reading: the label, the pick, the skills its main name names
const readOne = (
	ratings: any,
	o: any,
): { label: string; main: string; pick?: NounPick } => {
	let final: NounPick | undefined;
	setCoverFinal((p) => {
		final = p;
	});
	const c = classifyV2(ratings, o);
	setCoverFinal(undefined);
	return { label: c.label, main: c.label.split(" · ")[0]!, pick: final };
};

const specialKeys = () => {
	const s = new Set<string>();
	for (const pos of ["PG", "G", "SG", "GF", "SF", "F", "PF", "FC", "C"]) {
		for (const sp of specialsAt(pos as any)) {
			s.add(`b:${sp.id}`);
		}
	}
	for (const c of CUSTOM_SPECIALS) {
		s.add(`c:${c.key}`);
	}
	s.add("c:sJack");
	return s;
};
const specialOf = (p: NounPick | undefined): string | undefined =>
	!p
		? undefined
		: p.kind === "special"
			? `b:${p.id}`
			: p.kind === "trait" &&
				  (p.key === "sJack" || CUSTOM_SPECIALS.some((c) => c.key === p.key))
				? `c:${p.key}`
				: p.kind === "composed" &&
					  (p as any).base &&
					  (p as any).base.startsWith("special:")
					? `b:${(p as any).base.slice("special:".length)}`
					: p.kind === "composed" &&
						  (p as any).base &&
						  (p as any).base.startsWith("custom:")
						? `c:${(p as any).base.slice("custom:".length)}`
						: undefined;
// (two words on one family: the main name's skills, two of one family)
const doubleFamily = (p: NounPick | undefined, main: string) => {
	const ns = new Set<string>(
		(p?.main ?? []).filter((n) => FAMILY[n] && n !== "crafty"),
	);
	const seen = new Map<string, number>();
	for (const n of ns) {
		seen.set(FAMILY[n], (seen.get(FAMILY[n]) ?? 0) + 1);
	}
	// (the words themselves, for a name with no pick)
	const w = main;
	const words =
		/Ball-Handling.*Shot-Creating|Shot-Creating.*Ball-Handling|Iso Ball-Handling/.test(
			w,
		) ||
		/\b3PT\b.*Mid-Range|Mid-Range.*\b3PT\b|Sharpshooting.*Mid-Range|Mid-Range.*Sharpshooting/.test(
			w,
		) ||
		/Defensive.*Ball-Hawking|Ball-Hawking.*Defensive|Lockdown.*Ball-Hawking|Ball-Hawking.*Lockdown/.test(
			w,
		);
	// (3-Level is the one word for shooting and finishing)
	if (/Three-Level|3-Level/.test(w)) {
		seen.delete("shoot");
	}
	return words || [...seen.values()].some((k) => k >= 2);
};
const shareStats = (labels: string[]) => {
	const c: Record<string, number> = {};
	for (const l of labels) {
		c[l] = (c[l] ?? 0) + 1;
	}
	const e = Object.entries(c).sort((a, b) => b[1] - a[1]);
	const one = e.filter(([, k]) => k === 1).length;
	return {
		distinct: e.length,
		oneOffNames: one,
		oneOffShareOfNames: one / Math.max(1, e.length),
		top: e[0],
		topShare: (e[0]?.[1] ?? 0) / Math.max(1, labels.length),
		top10: e.slice(0, 10),
	};
};
const pc = (a: number, b: number) =>
	`${((100 * a) / Math.max(1, b)).toFixed(1)}%`;

test.skipIf(!CSV)(
	"2070 audit",
	() => {
		const rows = parseCsv(readFileSync(CSV, "utf8"));
		const outLines: string[] = [];
		const log = (s: string) => outLines.push(s);
		// ---- rebuild each player ----
		const people = rows.map((row) => {
			const pos = row.Pos;
			const ovr = Number(row.OVR);
			const age = Number(row.Age);
			const st: Partial<Record<NounKey, number>> = {};
			for (const part of row["Top skills (standing)"].split(",")) {
				const m = /^\s*(.+?) (\d+)\s*$/.exec(part);
				if (m && SKILL[m[1]!]) {
					st[SKILL[m[1]!]] = Number(m[2]) / 100;
				}
			}
			const listed = Object.values(st);
			const sixth = listed.length > 0 ? Math.min(...listed) : 0.5;
			for (const m of row.Why.matchAll(
				/([A-Z][\w.]*(?: [A-Z][\w.]*)*) \((\d+)\)/g,
			)) {
				const k = SKILL[m[1]!];
				if (k && st[k] === undefined) {
					st[k] = Number(m[2]) / 100;
				}
			}
			for (const m of row.Why.matchAll(/(3PT|Mid|Fin) (\d+)/g)) {
				const k = SKILL[m[1]!];
				if (k && st[k] === undefined) {
					st[k] = Number(m[2]) / 100;
				}
			}
			// (unquoted skills his current label or tag names: just under his sixth, at the 65th at least)
			const cur = `${row["Current archetype"]}${row["Defensive tag"] ? ` · ${row["Defensive tag"]}` : ""}`;
			const curNamed = namedOf(cur).nouns;
			for (const n of nounsOfName(cur)?.nouns ?? []) {
				curNamed.add(n);
			}
			for (const k of curNamed) {
				if (st[k] === undefined && ALL.includes(k as NounKey)) {
					st[k as NounKey] = Math.max(0.66, Math.min(sixth - 0.01, 0.8));
				}
			}
			// ("12 skills at the 90th+")
			const many = /(\d+) skills at the 90th\+/.exec(row.Why);
			if (many) {
				let need =
					Number(many[1]) -
					Object.entries(st).filter(([k, v]) => !ATH.has(k) && v >= 0.9).length;
				for (const k of ALL) {
					if (need <= 0) {
						break;
					}
					if (!ATH.has(k) && st[k] === undefined) {
						st[k] = Math.min(sixth, 0.9);
						need--;
					}
				}
			}
			for (const k of ALL) {
				if (st[k] === undefined) {
					st[k] = Math.max(0.2, Math.min(sixth - 0.03, 0.55));
				}
			}
			// (archskill, reading 29: the audit says nothing of the new skills, which the rebuilt ratings can't stand for
			// either (his height, endurance, sub-ratings and traits are made up): they stand with his unquoted skills, so
			// this scorecard measures the reading's other changes; the new skills are measured on real exports)
			for (const k of NEW_NOUNS) {
				st[k] = Math.max(0.2, Math.min(sixth - 0.03, 0.55));
			}
			const at = (k: string, p: number) =>
				Math.round(Math.max(0, Math.min(100, ratingAtPct(k, p))));
			const dAvg =
				((st.perimD ?? 0.5) + (st.rimD ?? 0.5) + (st.steal ?? 0.5)) / 3;
			const ratings: any = {
				hgt: HGT[pos] ?? 45,
				stre: at("stre", st.strength),
				spd: at("spd", st.speed),
				jmp: at("jmp", st.jump),
				endu: 55,
				ins: at("ins", st.post),
				dnk: at("dnk", st.finish),
				ft: at("ft", Math.max(st.three, st.mid)),
				fg: at("fg", st.mid),
				tp: at("tp", st.three),
				oiq: at("oiq", st.crafty),
				diq: at("diq", dAvg),
				drb: at("drb", Math.max(st.handle, st.creator)),
				pss: at("pss", st.pass),
				reb: at("reb", st.reb),
			};
			ratings.__standings = st;
			return { row, pos, ovr, age, ratings, st, cur };
		});
		const nq = ratingQuantiles(people.map((x) => ({ ...x, ovr: x.ovr })));
		const rq = { ovr: nq.ovr };
		const special = specialKeys();

		// ---- read each one ----
		const out = [
			"player,pos,ovr,verdict,current,engine,better fit,exact,family,accepted,kind,two-way player,2-Way name,double family",
		];
		const res = {
			n: 0,
			reproAll: 0,
			reproFresh: 0,
			freshN: 0,
			exact: 0,
			fam: 0,
			accepted: 0,
			disN: 0,
			disAcc: 0,
			partN: 0,
			partAcc: 0,
			twoWayPlayers: 0,
			twoWayNamed: 0,
			double: 0,
			honest: 0,
		};
		const labels: string[] = [];
		const held = new Set<string>();
		const HIGHLIGHT = [
			"Mohamed Jackson",
			"Samuel Lewis",
			"Tanner Verdugo",
			"Brian Collinsworth",
			"Ryan Pettus",
			"Aaron Harris",
			"Chase Mathias",
			"Kyle Hunter",
			"Ky'Ree Jenkins",
		];
		const hl: string[] = [];
		for (const x of people) {
			const { row } = x;
			res.n++;
			const dbg = (process.env.AUDIT_2070_DEBUG ?? "")
				.split("|")
				.includes(row.Player);
			if (dbg) {
				setCoverDebug((cs, sk) => {
					console.log(
						`DEBUG ${row.Player} ${x.pos}: ${sk
							.filter((s) => s.pct >= 0.6)
							.map((s) => `${s.key} ${Math.round(100 * s.pct)}`)
							.join(", ")}`,
					);
					for (const c of [...cs]
						.sort((a, b) => b.score - a.score)
						.slice(0, 12)) {
						console.log(
							`   ${c.score.toFixed(3)} ${c.pick.kind} ${(c.pick as any).id ?? (c.pick as any).key ?? (c.pick as any).role ?? ""} ${(c.pick as any).name ?? (c.pick as any).descs?.join("+") ?? ""} [${c.main.join(",")}] ${(c.pick as any).defense ?? ""}`,
						);
					}
				});
			}
			const rd = readOne(x.ratings, {
				norms: { ...defaultNormsFor(x.ratings), rq, nq: rq },
				pos: x.pos,
				ovr: x.ovr,
				pot: x.ovr + (x.age <= 22 ? 10 : 0),
				age: x.age,
			});
			if (dbg) {
				setCoverDebug(undefined);
				console.log(
					`   -> ${rd.label} ${JSON.stringify(rd.pick?.explain ?? {})}`,
				);
			}
			const lab = rd.label;
			const main = rd.main;
			labels.push(main);
			const sp = specialOf(rd.pick);
			if (sp && special.has(sp)) {
				held.add(sp);
			}
			if (rd.pick?.kind === "honest") {
				res.honest++;
			}
			if (norm(lab) === norm(row["Current archetype"])) {
				res.reproAll++;
			}
			if (row["Kept from last season"] !== "yes") {
				res.freshN++;
				if (norm(lab) === norm(row["Current archetype"])) {
					res.reproFresh++;
				}
			}
			const better =
				row["Better fit"] === "(keep)"
					? row["Current archetype"]
					: row["Better fit"];
			const ok = [better, ...row["Other good fits"].split(";")]
				.map((s) => s.trim())
				.filter(Boolean);
			const exact = ok.some((o) => norm(o) === norm(main));
			const mf = familiesOf(main);
			const fam = ok.some((o) => {
				const f = familiesOf(o);
				return f.off === mf.off && f.def === mf.def;
			});
			const accepted = exact || fam;
			if (exact) {
				res.exact++;
			}
			if (fam) {
				res.fam++;
			}
			if (accepted) {
				res.accepted++;
			}
			if (row.Verdict === "Disagree") {
				res.disN++;
				if (accepted) {
					res.disAcc++;
				}
			}
			if (row.Verdict === "Partly") {
				res.partN++;
				if (accepted) {
					res.partAcc++;
				}
			}
			// (two-way: his best defensive skill and his best offensive skill at the 80th+)
			const bestD = Math.max(...[...DEF].map((k) => x.st[k] ?? 0));
			const bestO = Math.max(...[...OFF].map((k) => x.st[k] ?? 0));
			const twp = bestD >= 0.8 && bestO >= 0.8;
			const twn = /\b(2|Two)-Way\b|3 & D/.test(main);
			if (twp) {
				res.twoWayPlayers++;
				if (twn) {
					res.twoWayNamed++;
				}
			}
			const dbl = doubleFamily(rd.pick, main);
			if (dbl) {
				res.double++;
			}
			if (HIGHLIGHT.includes(row.Player)) {
				hl.push(
					`  ${row.Player} (${x.pos} ${x.ovr}): ${row["Current archetype"]}${row["Defensive tag"] ? ` · ${row["Defensive tag"]}` : ""} -> ${lab} [his: ${row["Better fit"]}; ${row["Other good fits"]}]${exact ? " EXACT" : fam ? " FAMILY" : ""}`,
				);
			}
			out.push(
				[
					row.Player,
					x.pos,
					x.ovr,
					row.Verdict,
					row["Current archetype"],
					lab,
					row["Better fit"],
					exact ? "yes" : "",
					fam ? "yes" : "",
					accepted ? "yes" : "",
					rd.pick?.kind ?? "",
					twp ? "yes" : "",
					twn ? "yes" : "",
					dbl ? "yes" : "",
				]
					.map((s) => `"${String(s).replaceAll('"', '""')}"`)
					.join(","),
			);
		}
		const ss = shareStats(labels);
		log(
			`== 2070 audit, rebuilt from his standings (${res.n} players, read fresh)`,
		);
		log(
			`rebuild check: engine = his current label ${res.reproAll}/${res.n} (${pc(res.reproAll, res.n)}); labels not kept from last season ${res.reproFresh}/${res.freshN} (${pc(res.reproFresh, res.freshN)})`,
		);
		log(
			`agreement with his better fit / other good fits: exact ${res.exact} (${pc(res.exact, res.n)}), same families ${res.fam} (${pc(res.fam, res.n)}), either ${res.accepted} (${pc(res.accepted, res.n)})`,
		);
		log(
			`Disagree rows now given a name he'd accept: ${res.disAcc}/${res.disN} (${pc(res.disAcc, res.disN)}); Partly rows ${res.partAcc}/${res.partN} (${pc(res.partAcc, res.partN)})`,
		);
		log(
			`names: ${ss.distinct} distinct; held by one player ${ss.oneOffNames} (${pc(ss.oneOffNames, ss.distinct)} of names); top name ${ss.top?.[0]} ${ss.top?.[1]} (${pc(ss.top?.[1] ?? 0, res.n)})`,
		);
		log(`  top 10: ${ss.top10.map(([k, v]) => `${k} ${v}`).join(", ")}`);
		log(
			`2-Way names among two-way players (best D and best offense at the 80th+): ${res.twoWayNamed}/${res.twoWayPlayers} (${pc(res.twoWayNamed, res.twoWayPlayers)})`,
		);
		log(
			`catalog special names held: ${held.size} of ${special.size}; honest names ${res.honest}; names with two words on one family ${res.double}`,
		);
		log("the user's highlighted players:");
		outLines.push(...hl);

		// ---- an equivalent league from real exports ----
		const dir = process.env.AUDIT_2070_LEAGUE;
		if (dir) {
			const players: any[] = [];
			for (const f of readdirSync(dir)) {
				if (f.endsWith(".json")) {
					players.push(
						...JSON.parse(readFileSync(`${dir}/${f}`, "utf8")).players,
					);
				}
			}
			const season = Math.max(
				...players.flatMap((p) => p.ratings.map((r: any) => r.season)),
			);
			const startingSeason = Math.min(
				...players.flatMap((p) => (p.stats ?? []).map((s: any) => s.season)),
			);
			const info = players
				.filter((p) => p.tid >= -1)
				.map((p) => {
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
					const prevRow = p.ratings.find((r: any) => r.season === season - 1);
					return {
						prevRow,
						ratings: ratingsOfRow(row),
						ovr: row.ovr,
						pot: row.pot,
						pos: row.pos,
						age,
						traits,
						prev,
					};
				});
			const lnq = ratingQuantiles(info);
			const lng = nounGroupQuantiles(info);
			const lab2: string[] = [];
			const held2 = new Set<string>();
			let kept = 0;
			let sameAsPrev = 0;
			let withPrev = 0;
			let tw = 0;
			let twN = 0;
			let dbl = 0;
			for (const withPrevLabel of [false, true]) {
				for (const x of info) {
					let fp: NounPick | undefined;
					setCoverFinal((p) => {
						fp = p;
					});
					const c = classifyV2(x.ratings, {
						norms: { ...defaultNormsFor(x.ratings), nq: lnq, ng: lng },
						pos: x.pos,
						ovr: x.ovr,
						pot: x.pot,
						age: x.age,
						traits: x.traits,
						...(withPrevLabel && x.prev
							? {
									previousId: x.prev.id,
									...(x.prev.def ? { previousDefense: x.prev.def } : {}),
								}
							: {}),
					});
					setCoverFinal(undefined);
					const main = c.label.split(" · ")[0]!;
					if (!withPrevLabel) {
						lab2.push(main);
						const sp = specialOf(fp);
						if (sp && special.has(sp)) {
							held2.add(sp);
						}
						if (doubleFamily(fp, main)) {
							dbl++;
						}
						const st: Record<string, number> = {};
						for (const n of [...DEF, ...OFF]) {
							st[n] = 0;
						}
						const reason = (c as any).reason;
						void reason;
					} else if (x.prev) {
						withPrev++;
						if (fp?.explain?.variant === "kept from last season") {
							kept++;
						}
						if (c.id === x.prev.id) {
							sameAsPrev++;
						}
					}
				}
			}
			// (steady state: last season's label read by this reading from last season's ratings, then this season's
			// reading with it: how many labels are kept from last season)
			let ssN = 0;
			let ssKept = 0;
			let ssSame = 0;
			for (const x of info) {
				if (!x.prevRow) {
					continue;
				}
				const pr = classifyV2(ratingsOfRow(x.prevRow), {
					norms: {
						...defaultNormsFor(ratingsOfRow(x.prevRow)),
						nq: lnq,
						ng: lng,
					},
					pos: x.prevRow.pos,
					ovr: x.prevRow.ovr,
					pot: x.prevRow.pot,
					age: x.age - 1,
					traits: x.traits,
				});
				let fp: NounPick | undefined;
				setCoverFinal((p) => {
					fp = p;
				});
				const c = classifyV2(x.ratings, {
					norms: { ...defaultNormsFor(x.ratings), nq: lnq, ng: lng },
					pos: x.pos,
					ovr: x.ovr,
					pot: x.pot,
					age: x.age,
					traits: x.traits,
					previousId: pr.id,
					...((pr as any).defense
						? { previousDefense: (pr as any).defense }
						: {}),
				});
				setCoverFinal(undefined);
				ssN++;
				if (fp?.explain?.variant === "kept from last season") {
					ssKept++;
				}
				if (c.id === pr.id) {
					ssSame++;
				}
			}
			// (two-way players, from the reading's own standings)
			for (let i = 0; i < info.length; i++) {
				const x = info[i]!;
				const sc = coverScores(x.ratings, x.pos, lnq, lng);
				const p = Object.fromEntries(sc.map((s: any) => [s.key, s.pct]));
				const bd = Math.max(...[...DEF].map((k) => p[k]));
				const bo = Math.max(...[...OFF].map((k) => p[k]));
				if (bd >= 0.8 && bo >= 0.8) {
					tw++;
					if (/\b(2|Two)-Way\b|3 & D/.test(lab2[i]!)) {
						twN++;
					}
				}
			}
			const s2 = shareStats(lab2);
			log(
				`== equivalent league: ${dir} (${info.length} on a roster or in free agency, season ${season})`,
			);
			log(
				`names (fresh): ${s2.distinct} distinct; held by one player ${s2.oneOffNames} (${pc(s2.oneOffNames, s2.distinct)} of names); top name ${s2.top?.[0]} ${s2.top?.[1]} (${pc(s2.top?.[1] ?? 0, info.length)})`,
			);
			log(`  top 10: ${s2.top10.map(([k, v]) => `${k} ${v}`).join(", ")}`);
			log(
				`2-Way names among two-way players: ${twN}/${tw} (${pc(twN, tw)}); catalog special names held ${held2.size} of ${special.size}; two words on one family ${dbl}`,
			);
			log(
				`with last season's stored label: kept from last season ${kept}/${withPrev} (${pc(kept, withPrev)}), same id as last season ${sameAsPrev}/${withPrev} (${pc(sameAsPrev, withPrev)})`,
			);
			log(
				`steady state (last season's label read now from last season's ratings): kept from last season ${ssKept}/${ssN} (${pc(ssKept, ssN)}), same id as last season ${ssSame}/${ssN} (${pc(ssSame, ssN)})`,
			);
		}
		console.log(outLines.join("\n"));
		if (process.env.AUDIT_2070_OUT) {
			writeFileSync(process.env.AUDIT_2070_OUT, out.join("\n") + "\n");
			writeFileSync(
				process.env.AUDIT_2070_OUT.replace(/\.csv$/, ".txt"),
				outLines.join("\n") + "\n",
			);
		}
	},
	900000,
);
