// @ts-nocheck
/* eslint-disable no-undef, unicorn/prefer-single-call */
// archnouns4: every name the engine can give, as a CSV for the user's auditing tool: the engine id (or its pattern),
// the role or descriptor key, the display name (front-word and end-word forms, the elite variant), the kind, the
// positions and the gate in plain words, and the promises its words make (nouns.ts WORD_REQ).
//   RUN_ARCH_NAMES=<out.csv> [ARCH_NAMES_IDS=<audit csv>,<audit csv>] [ARCH_NAMES_IDS_OUT=<ids.csv>]
// With ARCH_NAMES_IDS, every "Engine ID" in those files is also mapped to its exact current display name.
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { ARCHETYPES, archetypeById } from "../classify.ts";
import { nameAt } from "../posNames.ts";
import { POSITIONS } from "../position.ts";
import { DEFENSE_TEXT } from "./defenseLabels.ts";
import { DESC_BY_KEY, ROLE_BY_KEY } from "./grammar.ts";
import { ELITE_RE, HONEST_ROLES } from "./honest.ts";
import {
	CUSTOM_SPECIALS,
	END_WORDS,
	NOUN_DESC,
	TRAIT_KEYWORDS,
	WORD_REQ,
	specialNounsOf,
} from "./nouns.ts";
import { mergedId } from "../merges.data.ts";

const LABEL: Record<string, string> = {
	three: "3PT",
	mid: "mid-range",
	post: "post scoring",
	finish: "finishing",
	rimD: "rim protection",
	perimD: "perimeter D",
	steal: "steals",
	handle: "handle",
	creator: "shot creation",
	pass: "passing",
	reb: "rebounding",
	speed: "speed",
	jump: "leaping",
	strength: "strength",
	crafty: "offensive IQ",
};
const pctWord = (v: string) => {
	const x = v === "ELITE_PCT" ? 0.92 : Number(v);
	return Number.isFinite(x) ? `top ${Math.round((1 - x) * 100)}%` : v;
};
// A gate's code, in words
const plain = (fn: unknown): string =>
	String(fn)
		.replace(/^\s*\(?{?[^)]*}?\)?\s*=>\s*/, "")
		.replace(/\s+/g, " ")
		.replace(
			/(?:c\.)?pct\.(\w+) >= ([\w.]+)/g,
			(_, k, v) => `${LABEL[k] ?? k} ${pctWord(v)}`,
		)
		.replace(
			/(?:c\.)?pct\.(\w+) < ([\w.]+)/g,
			(_, k, v) => `${LABEL[k] ?? k} not ${pctWord(v)}`,
		)
		.replace(
			/(?:c\.)?pct\.(\w+) <= (?:c\.)?pct\.(\w+) - ([\d.]+)/g,
			(_, a, b, d) => `${LABEL[a] ?? a} ${d} or more below ${LABEL[b] ?? b}`,
		)
		.replace(
			/Math\.max\(((?:c\.)?pct\.\w+(?:, )?)+\)/g,
			(m) =>
				`best of (${[...m.matchAll(/pct\.(\w+)/g)].map((x) => LABEL[x[1]] ?? x[1]).join(", ")})`,
		)
		.replace(
			/elite\(c\)|c\.eliteOvr|eliteOvr/g,
			"elite OVR (league top 10%, 55+)",
		)
		.replace(/tr\(c, "(\w+)"\) >= (\d+)/g, "trait $1 $2+")
		.replace(
			/\(?(?:c\.)?traits\??\.?\[?"?(\w+)"?]? \?\? \d+\)? >= (\w+)/g,
			"trait $1 $2+",
		)
		.replace(/TRAIT_WORD_MIN/g, "70")
		.replace(
			/lead\((?:c\.)?r, "(\w+)", "(\w+)"(?:, (\d+))?\)/g,
			(_, a, b, d) => `sub ${a} above ${b}${d ? ` by ${d}+` : ""}`,
		)
		.replace(/subGe\((?:c\.)?r, ((?:"\w+"(?:, )?)+)\)/g, (_, xs) => {
			const [a, ...o] = xs.replaceAll('"', "").split(", ");
			return `sub ${a} at least ${o.join(", ")}`;
		})
		.replace(/tallForPos\((?:c\.)?r, (?:c\.)?pos\)/g, "tall for his position")
		.replace(/shortForPos\((?:c\.)?r, (?:c\.)?pos\)/g, "short for his position")
		.replace(/(?:c\.)?ovrPct >= ([\d.]+)/g, (_, v) => `OVR ${pctWord(v)}`)
		.replace(/(?:c\.)?ovr >= (\w+)/g, "OVR $1+")
		.replace(/ELITE_OVR_FLOOR/g, "55")
		.replace(/ONE_NOUN_OVR/g, "50")
		.replace(
			/count\(c, ([\d.]+)\) >= (\d+)/g,
			(_, v, n) => `${n}+ skills ${pctWord(v)}`,
		)
		.replace(/ && /g, " and ")
		.replace(/ \|\| /g, " or ")
		.replace(/c\.|\(c\)/g, "")
		.trim();
const promises = (name: string) =>
	WORD_REQ.filter((w) => w.re.test(name))
		.map((w) =>
			"nouns" in w
				? `${w.why} top 30% and one of his 3 best`
				: "any" in w
					? `${w.why}: one in the top 30%`
					: "trait" in w
						? `trait ${w.trait} ${w.min}+`
						: w.why,
		)
		.join("; ");
const csv = (rows: unknown[][]) =>
	rows
		.map((r) =>
			r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","),
		)
		.join("\n") + "\n";
const DEF_GATE: Record<string, string> = {
	"Help-Side Roamer": "rim protection and steals both top 20%, not a big",
	"Switch Defender":
		"rim protection and perimeter D both top 20%, trait defensiveVersatility 55+",
	"Swatting Guard": "a guard with rim protection top 15%",
	"Shot Eraser":
		"rim protection his lead defensive skill, elite (top 8%, elite OVR)",
	"Shot Blocker":
		"rim protection his lead defensive skill, sub blk 6+ above idf",
	"Post Defender":
		"rim protection his lead defensive skill, sub idf 6+ above blk",
	"Rim Protector": "rim protection his lead defensive skill",
	"Perimeter Stalker": "perimeter D top 20%, trait motor or hustle 65+",
	"Point-of-Attack Pest":
		"perimeter D and steals, one top 15%, trait hustle 55+",
	Pest: "perimeter D and steals, both below top 15%, trait hustle 55+",
	"Lockdown Defender": "perimeter D elite (top 8%, elite OVR) and mobile",
	"Cerebral Defender": "perimeter D top 8%, elite OVR, not mobile",
	"On-Ball Stopper": "perimeter D, lateral quickness top 30%",
	"Perimeter Defender": "perimeter D",
	"Ball-Hawking Menace":
		"steals top 15%, trait competitiveness, motor or hustle 70+",
	"Passing-Lane Interceptor": "steals top 15%, sub stl above pdf",
	"Ball Hawk": "steals",
};

test.skipIf(!process.env.RUN_ARCH_NAMES)(
	"write the archetype names",
	() => {
		const head = [
			"engine_id_pattern",
			"key",
			"display_name",
			"kind",
			"positions",
			"gate",
			"word_promises",
		];
		const rows: unknown[][] = [head];
		const GROUP = "guard|wing|big";
		for (const [k, w] of Object.entries(NOUN_DESC)) {
			const word = (key: string) =>
				DESC_BY_KEY.get(key)?.names.join(" / ") ?? key;
			const forms = [
				word(w.desc),
				...Object.entries(w.byGroup ?? {}).map(([g, d]) => `${g}: ${word(d!)}`),
				...(w.elite ? [`elite: ${word(w.elite)}`] : []),
			].join("; ");
			rows.push([
				`v2:<end word>+${w.desc}[+<desc>]:<${GROUP}>`,
				w.desc,
				forms,
				"noun front word",
				"any",
				`${LABEL[k]} in the league's top 30% and among his three best skills${k === "jump" ? " (leaping: top 10%, ranked a little below a skill at the same standing)" : ""}${w.elite ? "; elite form: elite OVR (league top 10%, 55+) and top 8% at it" : ""}`,
				promises(word(w.desc)),
			]);
		}
		for (const [d, k] of [
			["spotUp", "three: sub C&S 3 6+ above off-the-dribble 3"],
			["pullUp", "three: sub off-the-dribble 3 6+ above C&S 3"],
			["powerFinishing", "finishing: sub contact 6+ above finesse"],
			["finesse", "finishing: sub finesse 6+ above contact"],
			[
				"closeRange",
				"post: sub close shots leads post moves and floater by 6+",
			],
			["floater", "post: sub floater leads by 6+"],
			["shifty", "handle: sub handle 6+ above ball security"],
			["steady", "handle: sub ball security 6+ above handle"],
			["shotBlocking", "rim protection: sub blk 6+ above idf"],
			["postDefending", "rim protection: sub idf 6+ above blk"],
			["twitchy", "speed: sub lateral 6+ above straight-line"],
			[
				"twoWay",
				"perimeter D (not elite) next to an offensive noun, 2-Way test",
			],
			["highlightReel", "finishing and leaping both top 15%"],
			["long", "one noun, wingspan 7+ over height (Expanded Ratings)"],
		]) {
			const names = DESC_BY_KEY.get(d)?.names.join(" / ") ?? d;
			rows.push([
				`v2:<end word>+${d}:<${GROUP}>`,
				d,
				names,
				"noun front word (variant)",
				"any",
				k,
				promises(names),
			]);
		}
		for (const t of TRAIT_KEYWORDS) {
			const front = DESC_BY_KEY.get(t.desc)?.names.join(" / ");
			const end = ROLE_BY_KEY.get(t.role)?.names.join(" / ");
			rows.push([
				`v2:<end word>+${t.desc}+<desc>:<${GROUP}>`,
				t.desc,
				front,
				"trait keyword (front word)",
				"any",
				`the ${t.key} trait over its bar: ${plain(t.over)}`,
				promises(front ?? ""),
			]);
			rows.push([
				`v2:${t.role}:<${GROUP}>`,
				t.role,
				end,
				"trait keyword (name)",
				"any",
				`no skill in the top 30%; the ${t.key} trait over its bar`,
				promises(end ?? ""),
			]);
		}
		for (const [key, txt] of [
			["posGuard", "his position (PG, G, SG)"],
			["posWing", "his position (GF, SF)"],
			["posForward", "his position (F, PF)"],
			["posBig", "his position (FC, C)"],
			["bruiser", "a guard or wing whose best skill is strength"],
			["enigma", "trait consistency 30 or less, OVR 45+"],
		]) {
			const r = ROLE_BY_KEY.get(key);
			const names = r
				? [...new Set([...r.names, ...Object.values(r.byGroup ?? {})])].join(
						" / ",
					)
				: key;
			rows.push([
				`v2:${key}+<desc>[+<desc>]:<${GROUP}>`,
				key,
				names,
				"end word (position)",
				"any",
				txt,
				promises(names),
			]);
		}
		for (const e of END_WORDS) {
			const r = ROLE_BY_KEY.get(e.key);
			if (!r) {
				continue;
			}
			const names = [
				...new Set([...r.names, ...Object.values(r.byGroup ?? {})]),
			].join(" / ");
			rows.push([
				`v2:${e.key}+<desc>[+<desc>]:<${GROUP}>`,
				e.key,
				names,
				`end word${ELITE_RE.test(names) ? " (elite)" : ""}`,
				"any",
				`${e.covers ? `says his ${LABEL[e.covers]} (that noun among the two his name shows); ` : ""}${plain(e.ok)}`,
				promises(names),
			]);
		}
		for (const c of CUSTOM_SPECIALS) {
			const r = ROLE_BY_KEY.get(c.key);
			if (!r) {
				continue;
			}
			const names = [
				...new Set([r.names[0], ...Object.values(r.byGroup ?? {})]),
			].join(" / ");
			rows.push([
				`v2:${c.key}:<${GROUP}>`,
				c.key,
				names,
				`special (the user's own)${ELITE_RE.test(names) ? " (elite)" : ""}`,
				c.positions.join("/"),
				`${plain(c.test)}; ${c.anyBest ? "a many-skills name (need not have his best skill, never over a top-7% standout)" : `its skills (${c.nouns.map((n) => LABEL[n]).join(", ")}) among his three best and with his best`}`,
				promises(names),
			]);
		}
		rows.push([
			`v2:sJack:<${GROUP}>`,
			"sJack",
			"Jack-Of-All-Trades",
			"special (the user's own)",
			"any",
			"4+ skills in the top 30%, none in the top 10%, OVR 45+, not a young player with upside at OVR 30-",
			promises("Jack-Of-All-Trades"),
		]);
		const seen = new Set<string>();
		for (const a of ARCHETYPES) {
			for (const p of POSITIONS) {
				if (!a.positions.includes(p)) {
					continue;
				}
				const n = nameAt(a, p);
				const sn = specialNounsOf(n);
				if (!sn || seen.has(`${a.id}|${n}`) || a.expanded || a.trait) {
					continue;
				}
				seen.add(`${a.id}|${n}`);
				const ps = a.positions.filter((q) => nameAt(a, q) === n);
				rows.push([
					a.id,
					a.id,
					n,
					`special (build)${ELITE_RE.test(n) ? " (elite)" : ""}`,
					ps.join("/"),
					`${sn.twoWay ? "2-Way (perimeter or rim D 60+ and top 40%, no defensive label); " : ""}its skills (${sn.nouns.map((x) => LABEL[x]).join(", ")}) all among his three best, with his best${ELITE_RE.test(n) ? "; elite OVR and top 8% at its first skill" : ""}`,
					promises(n),
				]);
			}
		}
		for (const h of HONEST_ROLES) {
			const r = ROLE_BY_KEY.get(h.key);
			const names = r?.names ?? h.names;
			names.forEach((n, i) => {
				rows.push([
					`v2:${h.key}:<${GROUP}>${i > 0 ? `:${h.key}=${i}` : ""}`,
					h.key,
					n,
					"honest",
					Object.entries(h.byGroup ?? {})
						.filter(([, ns]) => (ns as string[]).includes(n))
						.map(([g]) => g)
						.join("/") || "any",
					`${h.desc} (one skill at OVR under 50, or none; development names at OVR 30 or below with upside)`,
					promises(n),
				]);
			});
		}
		for (const [n, t] of Object.entries(DEFENSE_TEXT)) {
			rows.push([
				"(defensive label: stored in the entry's def field)",
				n,
				`${n} (may take Long: wingspan 7+ over height; or Switchable: defensiveVersatility 70+)`,
				"defensive",
				"any",
				`${DEF_GATE[n] ?? t.desc}; a defensive skill among his three best, or top 15% within 0.05 of his best`,
				promises(n),
			]);
		}
		writeFileSync(process.env.RUN_ARCH_NAMES, csv(rows));

		if (process.env.ARCH_NAMES_IDS) {
			const ids = new Map<string, string>();
			for (const f of process.env.ARCH_NAMES_IDS.split(",")) {
				const text = readFileSync(f, "utf8");
				for (const m of text.matchAll(
					/(?:^|,)((?:v2:[^\n",]+)|(?:[\da-z]+(?:-[\d&a-z]+)+))(?=,)/gm,
				)) {
					const id = m[1]!;
					if (!ids.has(id) && (id.startsWith("v2:") || archetypeById(id))) {
						const a = archetypeById(mergedId(id));
						ids.set(id, a ? a.name : "(no longer exists)");
					}
				}
			}
			writeFileSync(
				process.env.ARCH_NAMES_IDS_OUT ??
					process.env.RUN_ARCH_NAMES.replace(/\.csv$/, "_ids.csv"),
				csv([
					["engine_id", "display_name"],
					...[...ids].sort(([a], [b]) => a.localeCompare(b)),
				]),
			);
		}
	},
	600000,
);
