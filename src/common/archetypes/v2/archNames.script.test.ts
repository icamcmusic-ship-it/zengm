// @ts-nocheck
/* eslint-disable no-undef, unicorn/prefer-single-call */
// archnouns4: every name the engine can give, as a CSV for the user's auditing tool: the engine id (or its pattern),
// the role or descriptor key, the display name (front-word and end-word forms, the elite variant), the kind, the
// positions and the gate in plain words, and the promises its words make (nouns.ts WORD_REQ).
// archcov/archfam: every number is read from the code's constants (no hard-coded bars), with the name's own skill
// list, how it enters the coverage score, its flavor bonus, its rarity penalty, what an end word needs from the front
// words, and how it is kept next season (archetype_formulas_v<reading>.csv).
//   RUN_ARCH_NAMES=<out.csv> [ARCH_NAMES_IDS=<audit csv>,<audit csv>] [ARCH_NAMES_IDS_OUT=<ids.csv>]
// With ARCH_NAMES_IDS, every "Engine ID" in those files is also mapped to its exact current display name.
import { writeFileSync } from "node:fs";
import { test } from "vitest";
import { ARCHETYPES } from "../classify.ts";
import { nameAt } from "../posNames.ts";
import { POSITIONS } from "../position.ts";
import { DESC_BY_KEY, ROLE_BY_KEY } from "./grammar.ts";
import { ELITE_RE } from "./honest.ts";
import {
	CUSTOM_SPECIALS,
	END_WORDS,
	NOUN_DESC,
	TRAIT_KEYWORDS,
	ATH_KEYS,
	NEW_NOUNS,
	NEW_OWN,
	NEW_EDGE,
	NEW_MEMBER_EDGE,
	NEW_SKILL_BAR,
	NEW_STRONG_BAR,
	TRAIT_NUDGE,
	SKILL_NOUNS,
	SKILL_BAR,
	listPromiseText,
	specialNounsOf,
	wordNouns,
	type NounKey,
	ATH_WORD_BAR,
	STRONG_BAR,
	TOP_N,
	SUB_LEAN,
	ELITE_PCT,
	ELITE_OVR_PCT,
	ELITE_OVR_FLOOR,
	NOUN_ELITE_OVR,
	GENERIC_PCT,
	ONE_NOUN_OVR,
	JACK_CLEARED,
	STICK_BOOST,
	SPREAD_PEN,
	LONG_MIN,
	TRAIT_WORD_MIN,
	coverBar,
	strongBar,
	familyOf,
	MID_EDGE,
	LEAD_EDGE,
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
	SINGLE_NOUN_EDGE,
	SPECIAL_EDGE,
	STICK_COVER,
	THREE_LEVEL_BAR,
	TWO_WAY_BAR,
} from "./cover.ts";
import { ARCHETYPE_READING_VERSION } from "../helpers.ts";

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
// archskill (reading 29): how each new skill is read, and its family
const NEW_TXT: Record<string, string> = {
	foulDraw:
		"value: mean(free throws, contact finishing sub-rating (or dunk/layup), mean(dunk/layup, dribbling, speed)); a family of its own (offense)",
	cut: `value: mean(spot-up sub-rating (or mid-range), dunk/layup, speed) + ${TRAIT_NUDGE} x (offBall trait - 50) when traits are on; in the finishing family`,
	helpD:
		"value: mean(defensive IQ, defensive IQ, interior D (or height)); in the rim-protection (interior D) family (2-Way covers it)",
	postD:
		"value: mean(interior D sub-rating (or interior D, or defensive IQ), strength, height); in the rim-protection (interior D) family",
	oreb: "value: the offensive-rebounding sub-rating (or expanded offensive rebounding, or rebounding); in the rebounding family",
	length:
		"value: mean(wingspan, 50 + 4 x (wingspan - height)), only with the wingspan rating (Expanded Ratings); a modifier like speed",
	secure: `value: the ball-security sub-rating (or dribbling) + ${TRAIT_NUDGE} x (handle trait - 50) when traits are on; in the creation family`,
	switchD: `value: mean(lateral quickness sub-rating (or speed), perimeter D (or defensive IQ), interior D (or defensive IQ), 100 - 2 x |height - 48|) + ${TRAIT_NUDGE} x (defensiveVersatility trait - 50) when traits are on; in the perimeter-D family`,
	rimRun:
		"value: mean(max-vertical sub-rating (or leaping), height, dunk/layup x2, speed); in the finishing family",
	roll: `value: mean(strength, height, offensive-rebounding sub-rating (or rebounding), contact finishing sub-rating (or dunk/layup)) + ${TRAIT_NUDGE} x (screen trait - 50) when traits are on; in the finishing family`,
	transition:
		"value: mean(speed, dunk/layup, floater sub-rating (or inside scoring)); a modifier like speed",
	motor:
		"value: mean(endurance, motor trait, hustle trait), only when traits are on (visible traits only); a modifier like speed",
};
// archskill: when each skill noun is the noun his skill takes (the first that fits, in this order)
const NOUN_VARIANT_TXT = (): Record<string, string> => ({
	kSharpshooter: `elite at 3PT (elite OVR and top ${Math.round(100 * (1 - ELITE_PCT))}%)`,
	kSpotUpShooter: `sub tcs (catch & shoot 3) leads tod by ${SUB_LEAN}+`,
	kPullUpShooter: `sub tod (off-the-dribble 3) leads tcs by ${SUB_LEAN}+`,
	kShooter: "otherwise",
	kPullUpArtist: `sub pul (pull-up) leads spu (spot-up) by ${SUB_LEAN}+, mid-range top 30%`,
	kMidShooter: "otherwise",
	kCloseScorer: `a guard or wing, sub cls (close shots) leads pst and flt by ${SUB_LEAN}+`,
	kTouchScorer: `a guard or wing, sub flt (floater) leads pst and cls by ${SUB_LEAN}+`,
	kPostScorer: "otherwise",
	kBulldozer: `sub con (contact) leads fns and flt by ${SUB_LEAN}+, strength at the ${P(ATH_WORD_BAR)}`,
	kContactFinisher: `sub con (contact) leads fns and flt by ${SUB_LEAN}+`,
	kAcroFinisher: `sub fns (finesse) leads con and flt by ${SUB_LEAN}+`,
	kTouchFinisher: `sub flt (floater) leads con and fns by ${SUB_LEAN}+`,
	kFinisher: "otherwise",
	kLobThreat: `leaping at the ${P(ATH_WORD_BAR)}`,
	kRimRunner: "otherwise",
	kAndOne: `contact finishing (or dunk/layup) leads free throws by ${SUB_LEAN}+, finishing top 30%`,
	kFtMerchant: `free throws lead contact finishing (or dunk/layup) by ${SUB_LEAN}+`,
	kFoulMagnet: "otherwise",
	kMovementShooter: `spot-up (or mid-range) leads dunk/layup by ${SUB_LEAN}+, 3PT at the ${P(SKILL_BAR)}`,
	kBackdoorCutter: "otherwise",
	kShotBlocker: `sub blk leads idf by ${SUB_LEAN}+`,
	kRimProtector: "otherwise",
	kLowPostWall: `strength at the ${P(ATH_WORD_BAR)}`,
	kPostStopper: "otherwise",
	kDefQB: `elite at help defense (elite OVR and top ${Math.round(100 * (1 - ELITE_PCT))}%)`,
	kHelpAnchor: "a big (PF, FC, C)",
	kHelpDefender: "otherwise",
	kLockdownDefender: `elite at perimeter D (elite OVR, top ${Math.round(100 * (1 - ELITE_PCT))}%, mobile)`,
	kLengthDefender: `length at the ${P(ATH_WORD_BAR)}`,
	kPerimDefender: "otherwise",
	kBallHawk: "always",
	kSwitchDefender: "always",
	kBallHandler:
		"always (and shot creation's noun when its sub-rating is not top 30%)",
	kShotCreator: "shot-creation sub-rating top 30% (or no sub-ratings)",
	kMistakeFree: "always",
	kVisionary: `sub vis (vision) leads acc by ${SUB_LEAN}+`,
	kPrecisionPasser: `sub acc (pass accuracy) leads vis by ${SUB_LEAN}+`,
	kPasser: "otherwise",
	kRebounder: "always",
	kGlassCrasher: "always",
	kShortRoll: "passing top 30%",
	kRollMan: "otherwise",
});
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
		.replace(
			/pctOf\("spd", sub\(r, "lat"\) \?\? r\.spd\) >= \.7/g,
			"lateral quickness (or speed) top 30% of the league",
		)
		.replace(/traits !== undefined and /g, "")
		.replace(
			/(best of \([^)]*\)) >= \.(\d+)/g,
			(_, b, d) => `${b} top ${100 - Number(d.padEnd(2, "0"))}%`,
		)
		.replace(
			/\(?\(?sub\(r, "(\w+)"\) \?\? 0\) > \(sub\(r, "(\w+)"\) \?\? 0\)\)?/g,
			"sub $1 above $2",
		)
		.replace(
			/\(?\(?sub\(r, "(\w+)"\) \?\? 0\) >= \(sub\(r, "(\w+)"\) \?\? 0\)\)?/g,
			"sub $1 at least $2",
		)
		.replace(
			/leadSub\(r, \[\s*([^\]]*)]\) === "(\w+)"/g,
			(_, ks, k) =>
				`sub ${k} leads ${ks
					.replace(/[\s"]/g, "")
					.split(",")
					.filter((x) => x !== k)
					.join("/")} by ${SUB_LEAN}+`,
		)
		.replace(
			/leadSub\(r, \[\s*([^\]]*)]\) !== "(\w+)"/g,
			(_, ks, k) =>
				`sub ${k} does not lead ${ks
					.replace(/[\s"]/g, "")
					.split(",")
					.filter((x) => x !== k)
					.join("/")} by ${SUB_LEAN}+`,
		)
		.replace(
			/athletic\(pct\) < \.5/g,
			"speed and leaping both below the 50th percentile",
		)
		.replace(
			/shown\[0] === "(\w+)"/g,
			(_, k) => `his first front skill is ${LABEL[k] ?? k}`,
		)
		.replace(
			/elite\("(\w+)"\)/g,
			(_, k) =>
				`elite at ${LABEL[k] ?? k} (elite OVR and top ${Math.round(100 * (1 - ELITE_PCT))}%)`,
		)
		.replace(
			/\(traits\?\.(\w+) \?\? \d+\) ([<>]=) (\d+)/g,
			(_, k, op, v) => `trait ${k} ${v}${op === ">=" ? "+" : " or less"}`,
		)
		.replace(/\(r\.endu \?\? 0\) >= (\d+)/g, "endurance $1+")
		.replace(/pos === "(\w+)"/g, "position $1")
		.replace(/pos !== "(\w+)"/g, "not position $1")
		.trim();
// words that are no skill (traits, elite, checks). With no list given, the list its skill words imply.
const promises = (name: string, list?: readonly NounKey[]) =>
	listPromiseText(name, list ?? wordNouns(name)).join("; ");
// (names whose words imply a skill their own list doesn't have: the old word-by-word promises contradicted them)
const contradictions: string[] = [];
const checkWords = (name: string, list: readonly NounKey[]) => {
	const extra = wordNouns(name).filter(
		(n) =>
			!list.includes(n) &&
			!(n === "handle" && list.includes("creator")) &&
			!(n === "creator" && list.includes("handle")),
	);
	if (extra.length > 0) {
		contradictions.push(
			`${name}: words say ${extra.join(", ")}; skills ${list.join(", ")}`,
		);
	}
};
const csv = (rows: unknown[][]) =>
	rows
		.map((r) =>
			r.map((v) => `"${String(v ?? "").replaceAll('"', '""')}"`).join(","),
		)
		.join("\n") + "\n";

const P = (x: number) => `${Math.round(100 * x)}th`;
// (the user's own names whose test reads badly from the code)
const GATE_FIX: Record<string, string> = {
	sSwissArmy:
		"8+ skills (offensive IQ apart; speed, leaping and strength count) at the 70th percentile, one of them at the 85th",
	sPaintWarden:
		"rim protection top 15%, perimeter D top 30%, lateral quickness (or speed) at the league's 60th percentile, trait defensiveVersatility 70+",
	s3LiveDribble:
		"passing and handle top 30%, sub vis above acc, no skill (offensive IQ apart) in the top 10%",
	s3SecondarySwing:
		"shot creation top 30%, passing top 40%, his best skill neither shot creation nor handle",
	s3ClutchCloser:
		"elite OVR (league top 10%, 55+), trait clutch 80+, best scoring skill (3PT, mid-range, finishing, post) top 15%",
	s3StepBackGunner:
		"3PT top 15%, sub tod above tcs, trait shotDiscipline 50 or less (needs traits)",
	s3HighArcGunner:
		"3PT top 25%, sub rng at least tcs and tod, trait shotDiscipline 50 or less (needs traits)",
	s3VolumeSpacer:
		"3PT top 20%, every other skill (offensive IQ apart) at least 0.12 of standing below his 3PT",
	s3FloorSpacer:
		"3PT top 25%, sub tcs above tod by more than 5, at most one other skill (offensive IQ apart) at the 70th percentile",
	s3CompleteTwoWayWing:
		"3+ of (3PT, mid-range, finishing, passing, handle, shot creation) top 30%, perimeter D top 20%",
	s3GlueGuyWing:
		"3+ skills (offensive IQ apart) at the 60th percentile, none (offensive IQ apart) in the top 15%, perimeter D top 30%, trait ego 60+ (when traits are on)",
	s3LockdownAce:
		"elite OVR (league top 10%, 55+) and OVR in the league's top 5%, 3PT, mid-range and finishing top 25%, perimeter D top 10%",
	s3HustleSpark:
		"traits motor and hustle 70+, speed top 30%, OVR below the league's 60th percentile",
	s3SwitchProofHybrid:
		"perimeter D and rim protection top 25%, best scoring skill (3PT, mid-range, finishing, post) top 30%",
	s3AllCourtPrototype:
		"elite OVR (league top 10%, 55+) and OVR in the league's top 5%, 7+ skills (offensive IQ apart) at the 70th percentile",
	s3PressPest: "steals top 15%, speed top 25%, trait motor or hustle 65+",
	s3ClampLock:
		"elite OVR (league top 10%, 55+), perimeter D top 5%, lateral quickness (or speed) at the league's 80th percentile",
	s3BallHawkMenace:
		"steals top 15%, best scoring skill (3PT, mid-range, finishing, post) top 30%, trait motor or competitiveness 70+",
};
const TOPP = (x: number) => `top ${Math.round(100 * (1 - x))}%`;
const ELITE_TXT = `elite OVR (league top ${Math.round(100 * (1 - ELITE_OVR_PCT))}%, never below ${ELITE_OVR_FLOOR}; ${NOUN_ELITE_OVR}+ without a league table)`;
const COVER_TXT = (skills: string, twoWay = false) =>
	`cover(${skills}${twoWay ? ", 2-Way: all his defensive skills" : ""}): for each of his best ${TOP_N} families, (weight + standing/100) x 1 if the name says it (offensive IQ x ${CRAFTY_COVER}, a flavor); minus ${MISS_TOP2} x weight for each of his top 2 (offensive IQ apart) it leaves out; minus ${SECOND_COST} for a 2nd family named, ${EXTRA_COST} for each beyond 2 (a family counts once; 2-Way counts as one; offensive IQ costs nothing)`;
const FAMILY_TXT: Record<string, string> = {
	three: `the shooting family with mid-range: counts once; named 3PT unless mid-range leads it by ${MID_EDGE}`,
	mid: `the shooting family with 3PT: counts once; names it only when it leads 3PT by ${MID_EDGE} (or 3PT doesn't clear); leads his skills only with ${LEAD_EDGE} of edge`,
	handle:
		"the creation family with shot creation: counts once, named by the higher",
	creator: "the creation family with handle: counts once, named by the higher",
	perimD:
		"the perimeter-D family with steals: counts once, named by the higher; 2-Way covers it",
	steal:
		"the perimeter-D family with perimeter D: counts once, named by the higher; 2-Way covers it",
	rimD: "2-Way covers it",
	crafty: `a flavor word: covers ${CRAFTY_COVER} of a skill word, costs nothing to name or leave out, needs ${LEAD_EDGE} of edge to lead and never stands for his best skill`,
};
const RARITY = `${SPREAD_PEN} x the share of the league holding this exact id (e.g. 10% -> -${(SPREAD_PEN * 0.1).toFixed(2)})`;
const STICKY_STD = `kept next season while it still passes every rule with ${STICK_BOOST} slack on every standing (or is the pick at +/-${STICK_BOOST}), still covers his top two skills (families), and scores within ${STICK_COVER} of the new pick`;
const SPEC_FLAVOR = `${SPECIAL_EDGE}`;
const POS_RULES = (n: string): string[] => {
	const extra: string[] = [];
	if (/Stretch/.test(n)) {
		extra.push("Stretch only at PF/FC/C");
	}
	if (/\bFour\b/.test(n)) {
		extra.push("Four only at F/PF");
	}
	if (/\bFive\b/.test(n)) {
		extra.push("Five only at FC/C");
	}
	if (/Three-Level|3-Level/.test(n)) {
		extra.push(
			`3-Level: 3PT, mid-range and finishing all at the ${P(THREE_LEVEL_BAR)}`,
		);
	}
	return extra;
};
const VARIANT_SUB: Record<string, [string, string, string[] | undefined]> = {
	spotUp: [
		"three",
		`sub tcs (catch & shoot 3) leads tod (off-the-dribble 3) by ${SUB_LEAN}+`,
		["guard", "wing"],
	],
	pullUp: [
		"three",
		`sub tod (off-the-dribble 3) leads tcs by ${SUB_LEAN}+ (in a noun name Pull-Up is his 3PT)`,
		["guard", "wing"],
	],
	powerFinishing: [
		"finish",
		`sub con (contact) leads fns (finesse) by ${SUB_LEAN}+`,
		undefined,
	],
	finesse: [
		"finish",
		`sub fns (finesse) leads con (contact) by ${SUB_LEAN}+`,
		undefined,
	],
	closeRange: [
		"post",
		`sub cls (close shots) leads pst (post moves) and flt (floater) by ${SUB_LEAN}+`,
		["guard", "wing"],
	],
	floater: [
		"post",
		`sub flt (floater) leads pst and cls by ${SUB_LEAN}+`,
		["guard", "wing"],
	],
	shifty: [
		"handle",
		`sub hnd (handle) leads sec (ball security) by ${SUB_LEAN}+`,
		undefined,
	],
	steady: [
		"handle",
		`sub sec (ball security) leads hnd by ${SUB_LEAN}+`,
		undefined,
	],
	shotBlocking: ["rimD", `sub blk leads idf by ${SUB_LEAN}+`, undefined],
	twitchy: [
		"speed",
		`sub lat (lateral) leads sls (straight-line) by ${SUB_LEAN}+`,
		undefined,
	],
};
const TRAIT_GATE: Record<string, string> = {
	clutch: "OVR 50+ and clutch 75+",
	savvy: "age 30+ and veteranSavvy 75+ (second word / name variant at age 32+)",
	ironMan: "endurance 70+ and durability 75+",
	versatile: `defensiveVersatility ${TRAIT_WORD_MIN}+`,
	rolling: `a big with finishing at the ${P(GENERIC_PCT)} percentile+ and screen ${TRAIT_WORD_MIN}+`,
	pop: "a big with 3PT at the 70th percentile+ and screen 60+",
	demon: "motor or hustle 80+",
	offBall: `not a big, offBall ${TRAIT_WORD_MIN}+`,
	hustle: `hustle ${TRAIT_WORD_MIN}+`,
};
const END_FIT_TXT: Record<string, string> = {
	eGunner: "the front words name 3PT or mid-range",
	eScorer:
		"the front words name a scoring skill (3PT, mid-range, post, finishing)",
	eCloser:
		"the front words name a scoring skill (3PT, mid-range, post, finishing)",
	eMover: "the front words name 3PT, finishing or mid-range",
	eConnector: "the front words name passing, offensive IQ or handle",
	eSwingman: "the front words name 3PT, finishing, handle or perimeter D",
	eSpark: "the front words name neither post scoring nor rim protection",
};
const END_GATE_FIX: Record<string, string> = {
	eSpacer: `3PT ${TOPP(0.8)}, sub tod not above tcs, and no other skill (offensive IQ apart) in the top 15%`,
	eAce: `OVR ${ELITE_OVR_FLOOR}+ and in the league's top 2%, with 2+ skills (offensive IQ apart) in the top 10%`,
	eScorer:
		"2+ of (3PT, mid-range, finishing, post) top 30%, passing not top 30%, perimeter and rim D both not top 30%",
	eSwingman:
		"position SG, GF or SF, with 2+ of (3PT, finishing, handle, perimeter D) top 30%",
	eGunner:
		"best of (3PT, mid-range) top 30%, and shot discipline 40 or less (needs traits)",
	eMover: "not a big (PF, FC, C), offBall 70+",
	eWorkhorse: "endurance 75+ and durability or motor 70+",
	eSpark:
		"motor or hustle 70+, speed top 30%, OVR below the league's 60th percentile",
	eCutter: "offBall 60+, finishing top 30%, handle not top 50%",
	eCloser: "clutch 75+, OVR 50+, a scoring skill among the front words",
	eConnector:
		"passing and offensive IQ both at the 55th percentile+, no front skill in the top 15%",
	eDimer: "a guard, passing his first front skill, passing top 20%",
	eGeneral:
		"position PG, passing top 15% and elite at it, offensive IQ top 20%, leadership 70+",
	eDriver: `speed and handle both top 30%, sub lat does not lead sls by ${SUB_LEAN}+`,
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
			"skills",
			"fit_score_terms",
			"flavor_bonus",
			"rarity_penalty",
			"end_fit",
			"sticky",
		];
		const rows: unknown[][] = [head];
		const GROUP = "guard|wing|big";
		const L = (ns: readonly string[]) =>
			ns.map((n) => LABEL[n] ?? n).join(", ");
		for (const [k, w] of Object.entries(NOUN_DESC)) {
			const word = (key: string) =>
				DESC_BY_KEY.get(key)?.names.join(" / ") ?? key;
			const forms = [
				word(w.desc),
				...Object.entries(w.byGroup ?? {}).map(([g, d]) => `${g}: ${word(d!)}`),
				...(w.elite ? [`elite: ${word(w.elite)}`] : []),
			].join("; ");
			const ath = ATH_KEYS.has(k as NounKey);
			const isNew = NEW_NOUNS.has(k as NounKey);
			rows.push([
				`v2:<end word>+${w.desc}[+<desc>]:<${GROUP}>`,
				w.desc,
				forms,
				"noun front word",
				"any",
				(isNew ? `${NEW_TXT[k]}; ` : "") +
					(ath
						? `${LABEL[k]} is a modifier, not a skill: a word next to a skill from the ${P(ATH_WORD_BAR)} (or in a catalog name); never a name of its own (reading 29: a player with no real skill is named by his best skill)`
						: `${LABEL[k]}${isNew ? ` (a reading-29 skill: it clears higher, ${P(NEW_SKILL_BAR)} / real ${P(NEW_STRONG_BAR)}${NEW_OWN.has(k as NounKey) ? `, and leads his skills only with ${NEW_EDGE} of edge` : `, and names its family only with ${NEW_MEMBER_EDGE} over the family's word`})` : ""}: standing (lower of league and position) at the ${P(coverBar(k as NounKey))} percentile or better (a real skill from the ${P(strongBar(k as NounKey))}), weight ramping from 0 at the ${P(RAMP_LO)} to 1 at the ${P(RAMP_HI)}, among his ${TOP_N} best skills${w.elite ? `; elite form: ${ELITE_TXT} and top ${Math.round(100 * (1 - ELITE_PCT))}% at it${k === "perimD" ? ", and mobile (lateral quickness or speed at the league median+)" : ""}` : ""}`),
				promises(word(w.desc), [k as NounKey]),
				k,
				ath
					? `+0.1 x weight when named next to a skill`
					: `weight(${LABEL[k]}) + standing/100 when named${FAMILY_TXT[k] ? `; ${FAMILY_TXT[k]}` : ""}`,
				"",
				"",
				"",
				"",
			]);
		}
		for (const [d, [n, txt, groups]] of Object.entries(VARIANT_SUB)) {
			const names = DESC_BY_KEY.get(d)?.names.join(" / ") ?? d;
			rows.push([
				`v2:<end word>+${d}:<${GROUP}>`,
				d,
				names,
				"noun front word (variant)",
				groups ? groups.join("/") : "any",
				`${LABEL[n]}'s word when ${txt} (not when elite at it)`,
				promises(names, [n as NounKey]),
				n,
				"as its noun",
				"",
				"",
				"",
				"",
			]);
		}
		for (const [d, n, txt] of [
			[
				"twoWay",
				"",
				`a prefix any noun name or user's own name may take (the catalog's builds have their own 2-Way forms): his best defensive skill (perimeter D, rim protection, steals) and his best offensive skill (3PT, mid-range, post, finishing, handle, shot creation, passing) both at the ${P(TWO_WAY_BAR)} percentile; it covers all his defensive skills, counts as one skill named, his defensive families count as one among his best ${TOP_N}, and never stands next to a defensive word`,
			],
			[
				"threeLevel",
				"three+mid+finish",
				`one word for shooting and finishing: 3PT, mid-range and finishing all at the ${P(THREE_LEVEL_BAR)} percentile (it replaces the shooting and finishing words; +0.05)`,
			],
			[
				"highlightReel",
				"finish+jump",
				"finishing and leaping both at the 85th percentile (replaces both words)",
			],
			[
				"long",
				"",
				`a one-skill position name with no trait keyword, wingspan ${LONG_MIN}+ over height (Expanded Ratings); or the length skill's word, at the ${P(ATH_WORD_BAR)}`,
			],
		]) {
			const names = DESC_BY_KEY.get(d)?.names.join(" / ") ?? d;
			rows.push([
				`v2:<end word>+${d}:<${GROUP}>`,
				d,
				names,
				"noun front word (variant)",
				"any",
				txt,
				promises(names, n ? (n.split("+") as NounKey[]) : []),
				n.replaceAll("+", ","),
				d === "twoWay"
					? "covers all his defensive families; counts as one skill named"
					: n
						? "as its noun(s)"
						: "none (adds no skill)",
				"",
				"",
				"",
				"",
			]);
		}
		for (const t of TRAIT_KEYWORDS) {
			const front = DESC_BY_KEY.get(t.desc)?.names.join(" / ");
			rows.push([
				`v2:<end word>+${t.desc}+<desc>:<${GROUP}>`,
				t.desc,
				front,
				"trait keyword (front word)",
				"any",
				`one-skill noun names only (in front of the skill word); ${TRAIT_GATE[t.key]}; if several pass, the one furthest over its bar`,
				promises(front ?? "", []),
				"",
				"none (adds no skill)",
				"",
				"",
				"",
				"",
			]);
		}
		// archskill (reading 29): the skill nouns: a one-skill name, or the noun after another skill's front word
		for (const [n, vs] of Object.entries(SKILL_NOUNS)) {
			for (const v of vs ?? []) {
				const r = ROLE_BY_KEY.get(v.key);
				if (!r) {
					continue;
				}
				const name = r.names[0]!;
				rows.push([
					`v2:${v.key}[+<desc>]:<${GROUP}>`,
					v.key,
					name,
					"skill noun",
					"any",
					`the noun of his ${LABEL[n]} when ${NOUN_VARIANT_TXT()[v.key] ?? "otherwise"}; alone: his one skill (a real skill, or his best against the league when he has none); after one front word: that skill's word, another family's (or a modifier at the ${P(ATH_WORD_BAR)})`,
					promises(name, [n as NounKey]),
					n,
					`weight(${LABEL[n]}) + standing/100, like its front word`,
					`+${SINGLE_NOUN_EDGE} alone (over his position word); 0 with a front word`,
					RARITY,
					`never a front word of its own family; no stem said twice (Defensive Help Defender); at most ${MAX_PARTS} skills`,
					STICKY_STD,
				]);
			}
		}
		rows.push([
			`v2:<skill noun>[+<desc>]:<${GROUP}>`,
			"(skill pick)",
			"(his best skill or two)",
			"skill name (no real skill)",
			"any",
			`a player with no real skill (none at the ${P(STRONG_BAR)}), or one at OVR under ${ONE_NOUN_OVR} with no modifier at the ${P(ATH_WORD_BAR)}: his skill families by standing (lower of league and position, whatever its height; a member names its family with ${MID_EDGE} over the head, ${NEW_MEMBER_EDGE} for a reading-29 member clearing its bar; steals and shot creation when higher), the best one's noun; the second one's front word in front of it when the second may be named (its bar) and adds more than it costs (weight + standing/100 - ${SECOND_COST} against ${MISS_TOP2} x weight); else a modifier at the ${P(ATH_WORD_BAR)} in front; the first of these whose words that are no skill keep their promises, else his best skill's plain noun`,
			"only the words that are no skill (traits, elite)",
			"his best one or two",
			"not scored (chosen directly)",
			"",
			"",
			"",
			"re-read each season (not kept on slack)",
		]);
		for (const [key, txt, fit, flav] of [
			["posGuard", "his position is PG, G or SG", "", "0"],
			["posWing", "his position is GF or SF", "", "0"],
			["posForward", "his position is F or PF", "", "0"],
			["posBig", "his position is FC or C", "", "0"],
			[
				"bruiser",
				`a guard or wing (by position group) with strength at the ${P(ATH_WORD_BAR)} percentile`,
				"a front word names post scoring, rebounding or finishing (finishing only if finesse doesn't lead contact by 10+); adds strength to the name's skills",
				"0",
			],
			[
				"enigma",
				"consistency trait 30 or less, OVR 45+",
				"a front word names 3PT, mid-range, post, finishing, handle or shot creation",
				"0",
			],
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
				promises(names, []),
				key === "bruiser" ? "strength" : "",
				"the front words' cover",
				flav,
				RARITY,
				fit,
				STICKY_STD,
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
				`${e.covers ? `says his ${LABEL[e.covers]}: replaces that front word (or, with 1-2 front words in the same domain, offense or defense, adds it when it is among his best ${TOP_N}); ` : ""}${END_GATE_FIX[e.key] ?? plain(e.ok)}`,
				promises(names, e.covers ? [e.covers] : []),
				e.covers ?? "",
				e.covers
					? `the front words' cover plus ${LABEL[e.covers]}`
					: "the front words' cover",
				"0.05",
				RARITY,
				[
					END_FIT_TXT[e.key],
					e.covers
						? `never next to a front word of the ${LABEL[familyOf(e.covers)]} family`
						: "",
					`at most ${MAX_PARTS} skills in the whole name (2-Way counts as one)`,
				]
					.filter(Boolean)
					.join("; "),
				STICKY_STD,
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
			checkWords(names, c.nouns);
			rows.push([
				`v2:${c.key}:<${GROUP}>`,
				c.key,
				names,
				`special (the user's own)${ELITE_RE.test(names) ? " (elite)" : ""}`,
				c.positions.join("/"),
				`${GATE_FIX[c.key] ?? plain(c.test)}; ${c.anyBest ? `a many-skills name: 3+ real skills (families), and (an elite name, with an elite-OVR test) ${MANY_ELITE}+ skills at the ${P(ELITE_SKILL)} percentile or (a broad name) at most ${FLAT_ELITE}; need not name his best` : `its skills (${L(c.nouns)}) among his ${TOP_N} best families and covering his best; may take a 2-Way prefix (no defensive skill or word of its own) when he passes the 2-Way test`}${POS_RULES(names).length ? `; ${POS_RULES(names).join("; ")}` : ""}`,
				promises(names, c.anyBest ? [] : c.nouns),
				c.nouns.join(","),
				c.anyBest
					? `each of his best ${TOP_N} families (offensive IQ apart) covered ${GENERIC_COVER} (an elite name ${ELITE_COVER}); counts as 2 skills named (-${SECOND_COST})`
					: COVER_TXT(L(c.nouns)),
				`${SPEC_FLAVOR} (+0.05 for a name only an elite-OVR player may have)`,
				RARITY,
				"",
				STICKY_STD,
			]);
		}
		rows.push([
			`v2:sJack:<${GROUP}>`,
			"sJack",
			"Jack-Of-All-Trades",
			"special (the user's own)",
			"any",
			`${JACK_CLEARED}+ real skills (families, ${P(STRONG_BAR)} percentile, league and position), his ${JACK_CLEARED}th family (offensive IQ apart) at the ${P(JACK_FLAT)}, at most ${FLAT_ELITE} skills at the ${P(ELITE_SKILL)}, OVR 45+, not a young development player`,
			promises("Jack-Of-All-Trades", []),
			"",
			`each of his best ${TOP_N} families (offensive IQ apart) covered ${GENERIC_COVER}; counts as 2 skills named (-${SECOND_COST})`,
			SPEC_FLAVOR,
			RARITY,
			"",
			STICKY_STD,
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
				checkWords(n, sn.nouns);
				const ps = a.positions.filter((q) => nameAt(a, q) === n);
				const extra: string[] = POS_RULES(n);
				for (const [re, tk, min] of [
					[/Hustle|Hustling|Energy|Junkyard|Gritty|Grinder/, "hustle", 55],
					[
						/Screen|Rolling|Roll Man|Roll-Man|Pick-and-Pop|Popper|Popping/,
						"screen",
						50,
					],
					[/Off-Ball|Cutting/, "offBall", 55],
					[/Motor|Demon|Relentless/, "motor", 55],
					[/Clutch|Ice-Cold|Closer/, "clutch", 55],
					[/Ruthless/, "competitiveness", 55],
					[/Savvy|Veteran|Old Head/, "veteranSavvy", 55],
					[/Iron|Durable/, "durability", 55],
					[/Versatile|Switchable/, "defensiveVersatility", 55],
				] as [RegExp, string, number][]) {
					if (re.test(n)) {
						extra.push(`trait ${tk} ${min}+`);
					}
				}
				const el = ELITE_RE.test(n);
				rows.push([
					a.id,
					a.id,
					n,
					`special (build)${el ? " (elite)" : ""}`,
					ps.join("/"),
					`${sn.twoWay || /3 & D/.test(n) ? `2-Way (his best defensive and best offensive skill both at the ${P(TWO_WAY_BAR)}; it covers all his defensive skills${/3 & D/.test(n) ? "; a 3 & D name without it is about his perimeter D and 3PT" : ""}); ` : ""}its skills (${L(sn.nouns)}) all among his ${TOP_N} best families, covering his best; skills of one family count once${el ? `; ${ELITE_TXT}, elite (top ${Math.round(100 * (1 - ELITE_PCT))}%) at its first skill and at his best skill` : ""}${extra.length ? `; ${extra.join("; ")}` : ""}`,
					promises(n, sn.nouns),
					[...sn.nouns, ...(sn.twoWay ? ["+all defense (2-Way)"] : [])].join(
						",",
					),
					COVER_TXT(L(sn.nouns), sn.twoWay),
					SPEC_FLAVOR,
					RARITY,
					"",
					STICKY_STD,
				]);
			}
		}
		rows.push([
			"(honest names: none since reading 29)",
			"",
			"(no honest, flaw, development or depth name)",
			"honest (retired)",
			"any",
			"reading 29 retires every honest, flaw, development and depth name (Camp Body, Journeyman, Rotation Filler, Empty-Calorie Scorer, Spot-Up Specialist, Raw / Developing / Project names, ...): a one-skill player is named by his skill's noun, a player with no real skill by his best skill or two (the skill pick); a stored honest label is re-read on the version bump",
			"",
			"",
			"",
			"",
			"",
			"",
			"",
		]);
		rows.push([
			"(defensive label: none since reading 28)",
			"",
			"(no defensive tag)",
			"defensive (retired)",
			"any",
			`reading 28 drops the defensive tag: a two-way player's name takes 2-Way (his best defensive and best offensive skill both at the ${P(TWO_WAY_BAR)}), and a player whose best skills are defensive gets a defensive name (Defensive, Ball-Hawking, Shot-Erasing, ... with an end word); last season's stored tag is ignored`,
			"",
			"",
			"",
			"",
			"",
			"",
			"",
		]);
		writeFileSync(process.env.RUN_ARCH_NAMES, csv(rows));
		writeFileSync(
			process.env.RUN_ARCH_NAMES + ".contra.txt",
			contradictions.join("\n"),
		);
		console.log(
			`reading ${ARCHETYPE_READING_VERSION}: ${rows.length - 1} rows; names whose words imply a skill not on their own list: ${contradictions.length}`,
		);
	},
	600000,
);
