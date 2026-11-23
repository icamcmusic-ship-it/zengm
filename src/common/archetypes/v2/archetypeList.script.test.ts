// @ts-nocheck
/* eslint-disable no-undef, unicorn/prefer-single-call, unicorn/better-regex */
// archnouns3: docs/archetypes-list.md, generated from the code so it never goes out of date (the user's improvement 4).
// RUN_ARCH_LIST=1 to write it.
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { ARCHETYPES } from "../classify.ts";
import { nameAt } from "../posNames.ts";
import { POSITIONS } from "../position.ts";
import { ROLE_BY_KEY } from "./grammar.ts";
import { ELITE_RE } from "./honest.ts";
import {
	ATH_WORD_BAR,
	CRAFTY_BAR,
	CUSTOM_SPECIALS,
	END_WORDS,
	JACK_CLEARED,
	LEAD_EDGE,
	MID_EDGE,
	NOUN_DESC,
	SKILL_BAR,
	STICK_BOOST,
	TOP_N,
	TRAIT_KEYWORDS,
	WORD_REQ,
	specialNounsOf,
} from "./nouns.ts";
import {
	CRAFTY_COVER,
	ELITE_COVER,
	ELITE_SKILL,
	EXTRA_COST,
	FLAT_ELITE,
	GENERIC_COVER,
	JACK_FLAT,
	MANY_ELITE,
	MAX_PARTS,
	MISS_TOP2,
	RAMP_HI,
	RAMP_LO,
	SECOND_COST,
	SPECIAL_EDGE,
	STICK_COVER,
	THREE_LEVEL_BAR,
	TWO_WAY_BAR,
} from "./cover.ts";

const pctTop = (p: number) => `${Math.round(100 * p)}th percentile`;
import { DESC_BY_KEY, SKILL_NOUN_ROLES } from "./grammar.ts";
import { NEW_SKILL_BAR, NEW_STRONG_BAR, SKILL_NOUNS } from "./nouns.ts";
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
	foulDraw: "foul drawing",
	cut: "cutting",
	helpD: "help defense",
	postD: "post defense",
	oreb: "offensive rebounding",
	length: "length",
	secure: "ball security",
	switchD: "switchability",
	rimRun: "rim running",
	roll: "screen and roll",
	transition: "transition",
	motor: "motor",
};

test.skipIf(!process.env.RUN_ARCH_LIST)(
	"write the archetype list",
	() => {
		const out: string[] = [];
		out.push(`# Archetypes (reading ${ARCHETYPE_READING_VERSION})`);
		out.push("");
		out.push(
			`Generated from the code (\`RUN_ARCH_LIST=1 npx vitest --run --project basketball src/common/archetypes/v2/archetypeList.script.test.ts\`). ★ marks an elite name: OVR in the league's top 10% (never below 55). A label is one name: there is no defensive tag. A two-way player's name takes the prefix 2-Way when his best defensive skill and his best offensive skill are both at the ${pctTop(TWO_WAY_BAR)}; 2-Way covers all his defensive skills.`,
		);
		out.push("");
		out.push("## How a main name is built");
		out.push("");
		out.push(
			`Each skill is read against the league and against his position group (guards, wings, bigs): its standing is the lower of the two, so a skill counts only when it is good outright and good for his position. A skill may be named from the ${pctTop(SKILL_BAR)} (offensive IQ from the ${pctTop(CRAFTY_BAR)}); its weight ramps from nothing at the ${pctTop(RAMP_LO)} to full at the ${pctTop(RAMP_HI)}, so there is no cliff. Speed, leaping, strength, length, transition and motor are modifiers, not skills: they add at most a word next to a skill (from the ${pctTop(ATH_WORD_BAR)}) or appear in a catalog name. Reading 29 added twelve skills read from ratings, sub-ratings and visible traits (foul drawing, cutting, help defense, post defense, offensive rebounding, length, ball security, switchability, rim running, screen and roll, transition, motor); the ones that are skills clear higher (the ${pctTop(NEW_SKILL_BAR)}, a real skill from the ${pctTop(NEW_STRONG_BAR)}), since each reads ratings an older skill also reads.`,
		);
		out.push("");
		out.push(
			`Skills that say the same thing count once, as a family: shooting (3PT and mid-range), creation (handle and shot creation) and perimeter D (perimeter D and steals). A family stands where its best member stands and is named by one word: shooting by 3PT unless mid-range leads it by ${MID_EDGE} of standing, creation and perimeter D by the higher member. No name spends two words on one family; 3-Level is the one word for shooting and finishing, when 3PT, mid-range and finishing are all at the ${pctTop(THREE_LEVEL_BAR)}. Mid-range and offensive IQ need ${LEAD_EDGE} of standing over the next skill to lead; offensive IQ is mostly a flavor word (it covers ${CRAFTY_COVER} of a skill word, costs nothing to name or to leave out).`,
		);
		out.push("");
		out.push(
			`Every name in the catalog (the special names, the user's own names, Jack-Of-All-Trades, and noun names: front words with an end word) is scored by how much of his strengths it covers: the weights of his ${TOP_N} best families it names (2-Way names all his defensive ones), minus ${MISS_TOP2} times the weight of either of his top two it leaves out, minus ${SECOND_COST} for a second skill named and ${EXTRA_COST} for each beyond two (2-Way counts as one; a noun name says at most ${MAX_PARTS}). Its skills must be among his best ${TOP_N} families (with 2-Way, his defensive families count as one) and it must cover his best one (offensive IQ apart). A special name (a build, the user's own names, Jack) gets ${SPECIAL_EDGE} over a noun name that covers the same. The many-skills names are gated by how many elite skills (the ${pctTop(ELITE_SKILL)}) he has: a broad one (Jack-Of-All-Trades, Swiss-Army-Knife) needs at most ${FLAT_ELITE} and covers each of his best ${GENERIC_COVER} of the way, an elite one (Complete All-Court Prototype, the Unicorns) needs ${MANY_ELITE} or more and covers each ${ELITE_COVER}. The best-covering name wins; a near tie goes to the rarer name, never to chance. An end word is picked after the front words and only when it fits them (a Gunner names a jumper; Bruiser a physical skill; Enigma a scoring or creating one). Every skill has a plain noun (Rebounder, Spot-Up Shooter, Contact Finisher, Rim Protector, ...): a one-skill name is that noun, a two-skill name the front word of one skill and the noun of the other ("Glass-Cleaning Contact Finisher"). With no real skill (or one at OVR under 50, with no modifier) he is named by his best skill (or best two) against the league and his position, however low: there are no honest, depth or development names.`,
		);
		out.push("");
		out.push(
			`Last season's label is re-checked every season: it stays only while every rule still holds (with a slack of ${STICK_BOOST} on each standing, so a point of noise doesn't take it away), it still covers his top two skills (families), and this season's best name doesn't cover more by ${STICK_COVER} or more. The label is stored with why it was chosen: the skills it names, their standing and weight, the rule that let it name him, its score, the share of his three biggest strengths it covers, and the closest other name.`,
		);
		out.push("");
		out.push("## Every word keeps its promise");
		out.push("");
		out.push(
			`A name's promises come from its own skill list (a special name's skills, a noun name's front and end words), never from hand-written word rules that can drift: each skill on it at its bar (league and position) and among his best ${TOP_N}, each modifier at its bar. The other words keep these promises:`,
		);
		out.push("");
		for (const w of WORD_REQ) {
			if ("nouns" in w) {
				continue;
			}
			const what =
				"any" in w
					? `${w.why}: one of them among the name's skills`
					: "trait" in w
						? `trait ${w.trait} ${w.min}+`
						: w.why;
			out.push(`- \`${String(w.re).slice(1, 70)}\`: ${what}`);
		}
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
		out.push("## 2-Way and 3-Level");
		out.push("");
		out.push(
			`- **2-Way**: a prefix any noun name or user's own name may take (the catalog's builds have their own 2-Way forms) when his best defensive skill and his best offensive skill are both at the ${pctTop(TWO_WAY_BAR)}. It covers all his defensive skills and counts as one skill named.`,
		);
		out.push(
			`- **3-Level**: one word for shooting and finishing, when 3PT, mid-range and finishing are all at the ${pctTop(THREE_LEVEL_BAR)}.`,
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
			`- **Jack-Of-All-Trades** [any]: ${JACK_CLEARED}+ real skills (families), his ${JACK_CLEARED}th at the ${pctTop(JACK_FLAT)}, at most ${FLAT_ELITE} at the ${pctTop(ELITE_SKILL)}; it covers each of his skills ${GENERIC_COVER} of the way.`,
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
		out.push(`## Skill nouns (${SKILL_NOUN_ROLES.length})`);
		out.push("");
		for (const [n, vs] of Object.entries(SKILL_NOUNS)) {
			out.push(
				`- **${NOUN_LABEL[n] ?? n}**: ${(vs ?? [])
					.map((v) => ROLE_BY_KEY.get(v.key)?.names[0] ?? v.key)
					.join(" / ")}`,
			);
		}
		out.push("");
		writeFileSync(
			new URL("../../../../docs/archetypes-list.md", import.meta.url),
			out.join("\n"),
		);
	},
	600000,
);
