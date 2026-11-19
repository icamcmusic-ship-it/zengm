// @ts-nocheck
/* eslint-disable no-undef, unicorn/prefer-single-call, unicorn/better-regex */
// archnouns3: docs/archetypes-list.md, generated from the code so it never goes out of date (the user's improvement 4).
// RUN_ARCH_LIST=1 to write it.
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { ARCHETYPES } from "../classify.ts";
import { nameAt } from "../posNames.ts";
import { POSITIONS } from "../position.ts";
import { DEFENSE_TEXT } from "./defenseLabels.ts";
import { ROLE_BY_KEY } from "./grammar.ts";
import { ELITE_RE, HONEST_ROLES } from "./honest.ts";
import {
	CUSTOM_SPECIALS,
	END_WORDS,
	NOUN_DESC,
	TRAIT_KEYWORDS,
	specialNounsOf,
} from "./nouns.ts";
import { DESC_BY_KEY } from "./grammar.ts";
import { ARCHETYPE_READING_VERSION } from "../helpers.ts";

const star = (name: string) => (ELITE_RE.test(name) ? "★ " : "");
const NOUN_LABEL: Record<string, string> = {
	three: "3PT",
	mid: "mid-range",
	post: "inside",
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

test.skipIf(!process.env.RUN_ARCH_LIST)(
	"write the archetype list",
	() => {
		const out: string[] = [];
		out.push(`# Archetypes (reading ${ARCHETYPE_READING_VERSION})`);
		out.push("");
		out.push(
			"Generated from the code (`RUN_ARCH_LIST=1 npx vitest --run --project basketball src/common/archetypes/v2/archetypeList.script.test.ts`). ★ marks an elite name: OVR in the league's top 15% (never below 55). A label is a main name, plus a defensive label after a · when a defensive skill is among his best.",
		);
		out.push("");
		out.push("## How a main name is built");
		out.push("");
		out.push(
			"Each skill is a noun scored by his standing in the league that season. His name is, in order: one of the special names below whose skills are all among his three best (and include his best); else his two best nouns' front words and an end word (his position, or one of the end words below); else, with one skill at low OVR or none, an honest name.",
		);
		out.push("");
		out.push("## Front words of the nouns");
		out.push("");
		for (const [k, w] of Object.entries(NOUN_DESC)) {
			const word = (key) => DESC_BY_KEY.get(key)?.names[0] ?? key;
			const elite = w.elite ? ` · elite: ★ ${word(w.elite)}` : "";
			const big = w.byGroup?.big ? ` · bigs: ${word(w.byGroup.big)}` : "";
			out.push(`- **${NOUN_LABEL[k] ?? k}**: ${word(w.desc)}${big}${elite}`);
		}
		out.push("");
		out.push(`## End words (${END_WORDS.length})`);
		out.push("");
		for (const e of END_WORDS) {
			const r = ROLE_BY_KEY.get(e.key);
			if (r) {
				out.push(
					`- ${star(r.names[0])}**${r.names[0]}**${e.covers ? ` (says his ${NOUN_LABEL[e.covers]})` : ""}: ${r.desc ?? ""}`,
				);
			}
		}
		out.push("");
		out.push(`## Defensive labels (${Object.keys(DEFENSE_TEXT).length})`);
		out.push("");
		for (const [name, t] of Object.entries(DEFENSE_TEXT)) {
			out.push(`- ${star(name)}**${name}**: ${t.desc}`);
		}
		out.push("");
		out.push(
			"Any of them may take Long (long arms) or Switchable (defensive versatility 70+) in front.",
		);
		out.push("");
		out.push(
			`## Special names: the user's own (${CUSTOM_SPECIALS.length + 1})`,
		);
		out.push("");
		for (const c of CUSTOM_SPECIALS) {
			const r = ROLE_BY_KEY.get(c.key);
			if (!r) {
				continue;
			}
			const names = [r.names[0], ...Object.values(r.byGroup ?? {})].join(" / ");
			const nouns = c.nouns.map((n) => NOUN_LABEL[n]).join(", ");
			out.push(
				`- ${star(names)}**${names}** [${c.positions.join("/")}]${nouns ? ` (${nouns})` : ""}: ${r.desc ?? ""}`,
			);
		}
		out.push(
			"- **Jack-Of-All-Trades** [any]: 5+ skills in the top 40%, none in the top 10%.",
		);
		out.push("");
		const builds: string[] = [];
		for (const a of ARCHETYPES) {
			const names = new Set(POSITIONS.map((p) => nameAt(a, p)));
			for (const n of names) {
				const sn = specialNounsOf(n);
				if (sn) {
					builds.push(
						`- ${star(n)}**${n}** [${a.positions.join("/")}] (${[...(sn.twoWay ? ["2-Way"] : []), ...sn.nouns.map((x) => NOUN_LABEL[x])].join(", ")})`,
					);
				}
			}
		}
		builds.sort((a, b) =>
			a.replace(/[★ *-]/g, "").localeCompare(b.replace(/[★ *-]/g, "")),
		);
		out.push(
			`## Special names: builds whose words are all nouns (${builds.length})`,
		);
		out.push("");
		out.push(...new Set(builds));
		out.push("");
		out.push(`## Trait keywords (${TRAIT_KEYWORDS.length})`);
		out.push("");
		for (const t of TRAIT_KEYWORDS) {
			const front = DESC_BY_KEY.get(t.desc)?.names.join(" / ");
			const end = ROLE_BY_KEY.get(t.role)?.names.join(" / ");
			out.push(`- **${t.key}**: in front: ${front}; as a name: ${end}`);
		}
		out.push("");
		out.push(`## Honest names (${HONEST_ROLES.length} kinds)`);
		out.push("");
		for (const h of HONEST_ROLES) {
			out.push(`- ${h.names.join(", ")}: ${h.desc}`);
		}
		out.push("");
		writeFileSync(
			new URL("../../../../docs/archetypes-list.md", import.meta.url),
			out.join("\n"),
		);
	},
	600000,
);
