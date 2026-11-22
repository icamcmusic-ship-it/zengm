// Strengths & weaknesses of a prospect's full scouting report: specific, evidence-backed items (situational, consistency and range,
// mechanics, feel, defensive detail, physical projection, motor and character, role translation) on top of the letter grades, each
// with a severity tier, evidence lines (stats, combine, film, trait readings) as deep as our scouting of him, a trend arrow against
// last season's report, whether a weakness can be fixed (and the development plan focus that targets it), and the second scout's
// dissent. Then the swing skill, the NBA role with a risk level, a real-player anchor and the rating-vs-stats contradictions.
//
// Pure and deterministic (seeded wording, seeded scout noise). Reads only the ScoutInput (ratings with the user's scouting fuzz, or
// none under the no visible ratings challenge; visible trait readings and known hidden ones as ranges; public stats, measurements and
// combine results) and the scout's take. Rating-based items need ratings, and their evidence is words ("film"), never a rating number.
import { FOCUSES, type FocusDef } from "../staffDepth/devPlans.ts";
import type { FocusKey } from "../staffDepth/types.ts";
import { SUB_INDEX } from "../subRatings.ts";
import {
	categoryScores,
	GRADE_LABELS,
	OVERALL_WEIGHTS,
	peerGroupOf,
	productionScores,
	productionWeight,
	type CategoryScores,
} from "./categories.ts";
import { gradeLetter, percentileOf, gradeFromPercentile } from "./grades.ts";
import { gradeLine } from "./lines.ts";
import { capFirst, feetInches, roleName, Voice } from "./text.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import {
	GRADE_KEYS,
	type GradeKey,
	type GradeRow,
	type PeerGroup,
	type Scout,
	type ScoutBias,
	type ScoutInput,
	type ScoutTake,
	type SkillEvidence,
	type SkillFamily,
	type SkillItem,
	type SkillReport,
	type SkillSeasonLine,
	type SkillSignals,
	type SkillSplit,
	type SkillTier,
} from "./types.ts";

// How many items a report shows
export const MAX_STRENGTHS = 4;
export const MIN_STRENGTHS = 3;
export const MAX_WEAKNESSES = 3;
export const MIN_WEAKNESSES = 2;

// Magnitude (about 0.5-3) to tier: an item past its threshold starts at 1
export const TIER_ELITE = 2.35;
export const TIER_PLUS = 1.45;

export const TIER_LABELS: Record<SkillTier, string> = {
	elite: "Elite",
	plus: "Plus",
	average: "Average",
	minus: "Minus",
	major: "Major concern",
};

export const tierOf = (side: "strength" | "weakness", m: number): SkillTier =>
	side === "strength"
		? m >= TIER_ELITE
			? "elite"
			: m >= TIER_PLUS
				? "plus"
				: "average"
		: m >= TIER_ELITE
			? "major"
			: m >= TIER_PLUS
				? "minus"
				: "average";

// 0 below start, 1 at start, rising to 2.4 at full (capped a little past it, at 2.68)
const ramp = (x: number, start: number, full: number) =>
	x < start ? 0 : 1 + 1.4 * Math.min(1.2, (x - start) / (full - start));

// "21st", "96th"
export const ordinal = (n: number) => {
	const x = Math.round(n);
	const mod100 = x % 100;
	const suffix =
		mod100 >= 11 && mod100 <= 13
			? "th"
			: x % 10 === 1
				? "st"
				: x % 10 === 2
					? "nd"
					: x % 10 === 3
						? "rd"
						: "th";
	return `${x}${suffix}`;
};

// "a starting wing", "an All-Star", "out of the league"
export const withArticle = (role: string) =>
	role.startsWith("out of")
		? role
		: `${/^[AEIOUaeiou]/.test(role) ? "an" : "a"} ${role}`;

const r1 = (x: number) => x.toFixed(1);
const pctText = (made: number, att: number) =>
	att > 0 ? `${((100 * made) / att).toFixed(1)}%` : "-";

// ---- the lead scout's lean ----

export type ScoutLean = "upside" | "production" | "neutral";

export const leanOf = (bias: ScoutBias): ScoutLean =>
	bias === "tools" ||
	bias === "youth" ||
	bias === "athletes" ||
	bias === "generous"
		? "upside"
		: bias === "production" || bias === "harsh"
			? "production"
			: "neutral";

const LEAN_TEXT: Record<ScoutLean, string> = {
	upside: "leans upside: grades tools and projection first",
	production: "leans production: wants to see it in the numbers",
	neutral: "grades it straight: tools and production alike",
};

// ---- candidates ----

type Cand = {
	key: string;
	// Dedupe: two items sharing a group are never both shown (strongest wins)
	groups: string[];
	family: SkillFamily;
	side: "strength" | "weakness";
	m: number;
	title: string;
	// Wording by strength of the item: [elite/major, plus/minus, average]
	texts: [string[], string[], string[]];
	ev: { src: SkillEvidence["src"]; text: string; p: number }[];
	// Backed by numbers (production scouts like it) / a physical or projection read (upside scouts like it)
	stat?: boolean;
	tools?: boolean;
	// Weaknesses: fixable, and the development plan focus that targets it
	fix?: { fixable: boolean; focus?: FocusKey; note?: string };
	// The grade it is about (trend arrows, swing skill, generic dedupe)
	gradeKey?: GradeKey;
	// From the numbers when there's no grade history: +1 better than last season, -1 worse
	statTrend?: { dir: 1 | -1; text: string };
	generic?: boolean;
	// Never shown next to another item about the same grade (a day-one skill is the grade itself)
	exclusive?: boolean;
};

type X = {
	input: ScoutInput;
	group: PeerGroup;
	sig: SkillSignals;
	r: ScoutInput["ratings"];
	sub: (key: string) => number | undefined;
	G: (k: GradeKey) => number;
	grades: GradeRow[];
	scores: CategoryScores;
	last?: SkillSeasonLine;
	prevSeason?: SkillSeasonLine;
	career?: SkillSeasonLine;
	// Per 40 minutes of his last season
	p40: (s: SkillSeasonLine | SkillSplit, x: number) => number;
	film: boolean;
	selfCreated?: number;
};

const sumSeasons = (
	seasons: SkillSeasonLine[],
): SkillSeasonLine | undefined => {
	if (seasons.length === 0) {
		return undefined;
	}
	const out = { ...seasons.at(-1)! };
	for (const key of [
		"gp",
		"min",
		"pts",
		"orb",
		"drb",
		"ast",
		"tov",
		"stl",
		"blk",
		"pf",
		"fg",
		"fga",
		"tp",
		"tpa",
		"ft",
		"fta",
		"rimA",
		"rim",
		"postA",
		"post",
		"midA",
		"mid",
		"ba",
	] as const) {
		out[key] = seasons.reduce((a, s) => a + s[key], 0);
	}
	return out;
};

// Game score of a stretch of games, per 40 minutes (collegeStats/production.ts gameScoreOf)
const gmsc40 = (s: SkillSplit | SkillSeasonLine) =>
	s.min > 0
		? ((s.pts +
				0.4 * s.fg -
				0.7 * s.fga -
				0.4 * (s.fta - s.ft) +
				0.7 * s.orb +
				0.3 * s.drb +
				s.stl +
				0.7 * s.ast +
				0.7 * s.blk -
				0.4 * s.pf -
				s.tov) *
				40) /
			s.min
		: 0;

const tsPct = (s: SkillSeasonLine) =>
	s.fga + 0.44 * s.fta > 0 ? (100 * s.pts) / (2 * (s.fga + 0.44 * s.fta)) : 0;

const trait = (input: ScoutInput, key: string) => {
	const t = input.traits?.find((x) => x.key === key);
	// Scouted ranges only: a hidden trait counts only once it is known
	if (!t || (t.hidden && !t.exact)) {
		return undefined;
	}
	return t;
};
const traitText = (
	t: {
		name: string;
		low: number;
		high: number;
		exact: boolean;
		estimate: number;
	},
	center?: number,
) =>
	`${t.name} reads ${t.exact ? t.estimate : `${t.low}-${t.high}`} on our trait board${center !== undefined ? ` (class average ${Math.round(center)})` : ""}`;

const filmWord = (v: number) =>
	v >= 70
		? "elite"
		: v >= 58
			? "strong"
			: v >= 45
				? "solid"
				: v >= 35
					? "below average"
					: "poor";

// ---- detectors ----

const situational = (x: X): Cand[] => {
	const out: Cand[] = [];
	const { G, last, r, sig, group } = x;
	// Transition vs half court
	if (r) {
		const tz = 0.55 * G("ath") + 0.25 * G("fin") + 0.2 * G("pd");
		const m = ramp(tz, 8, 11.5);
		if (m > 0) {
			const ev: Cand["ev"] = [];
			if (last && last.min >= 200 && x.p40(last, last.stl) >= 1.7) {
				ev.push({
					src: "stats",
					text: `${r1(x.p40(last, last.stl))} steals per 40 minutes turn into run-outs`,
					p: 2,
				});
			}
			if (sig.combine?.sprintPct !== undefined && sig.combine.sprintPct >= 65) {
				ev.push({
					src: "combine",
					text: `${ordinal(sig.combine.sprintPct)} percentile in the combine sprint`,
					p: 3,
				});
			}
			ev.push({
				src: "film",
				text: `End-to-end speed is ${filmWord(x.sub("sls") ?? r.spd)}; finishes on the move`,
				p: 1,
			});
			out.push({
				key: "transition",
				groups: ["pace"],
				family: "situational",
				side: "strength",
				m,
				title: "Transition weapon",
				texts: [
					[
						"A nightmare in the open floor: every miss is a chance to run",
						"Elite in transition; changes the pace of a game",
					],
					["Dangerous in transition", "Gets easy points running the floor"],
					["Runs the floor well", "Picks up some easy baskets in transition"],
				],
				ev,
				tools: true,
				gradeKey: "ath",
			});
			// ... but can he score when the floor shrinks?
			const hc = G("ath") - (G("od") + G("shoot")) / 2;
			const mh = ramp(hc, 3, 7);
			if (mh > 0 && group !== "big") {
				out.push({
					key: "halfCourt",
					groups: ["halfcourt"],
					family: "situational",
					side: "weakness",
					m: mh,
					title: "Half-court scoring",
					texts: [
						[
							"Disappears in the half court: almost all of his offense comes in the open floor",
							"Once the game slows down, he has nothing to go to",
						],
						[
							"Half-court scoring is a question when the floor shrinks",
							"Needs the game in transition to score",
						],
						[
							"A little less effective in the half court",
							"Half-court game is behind his open-floor game",
						],
					],
					ev: [
						...(last && last.tpa >= 20 && last.tp / last.tpa < 0.33
							? [
									{
										src: "stats" as const,
										text: `${pctText(last.tp, last.tpa)} from three keeps defenses packed in`,
										p: 2,
									},
								]
							: []),
						{
							src: "film",
							text: `Pull-up game is ${filmWord(x.sub("pul") ?? (r.fg + r.drb) / 2)}`,
							p: 1,
						},
					],
					fix: { fixable: true, focus: "pullup" },
					gradeKey: "od",
				});
			}
		}
		const hz = (G("od") + G("iq") + G("pm")) / 3;
		const mo = G("ath") <= 6 ? ramp(hz, 8, 11) : 0;
		if (mo > 0) {
			out.push({
				key: "halfCourtOperator",
				groups: ["halfcourt", "pace"],
				family: "situational",
				side: "strength",
				m: mo,
				title: "Half-court operator",
				texts: [
					[
						"Runs a half-court offense like a veteran: pace, angles, the right read every time",
						"Lives in the half court and controls it",
					],
					[
						"Does his damage in a set offense, not in the open floor",
						"A half-court player who makes reads at his own pace",
					],
					[
						"More comfortable in the half court than on the break",
						"Plays at his own pace in the half court",
					],
				],
				ev: [
					{
						src: "film",
						text: `Pace and feel in pick-and-roll are ${filmWord(((x.sub("vis") ?? r.pss) + r.oiq) / 2)}`,
						p: 1,
					},
					...(last && last.min >= 200 && x.p40(last, last.ast) >= 4
						? [
								{
									src: "stats" as const,
									text: `${r1(x.p40(last, last.ast))} assists per 40 minutes`,
									p: 2,
								},
							]
						: []),
				],
				gradeKey: "pm",
			});
		}
	}

	// Vs zone / vs physical man defense
	if (r) {
		const zb = (G("cs") + G("pm") + G("iq")) / 3;
		const mz = ramp(zb, 8, 11);
		if (mz > 0) {
			out.push({
				key: "zoneBuster",
				groups: ["zone"],
				family: "situational",
				side: "strength",
				m: mz,
				title: "Zone buster",
				texts: [
					[
						"Carves up zones: shoots over them and hits the soft spots",
						"Zone defenses are a gift to him",
					],
					[
						"Punishes zone defenses from the gaps",
						"Good against zones: spaces and finds the open man",
					],
					[
						"Holds his own against zones",
						"Knows where to stand against a zone",
					],
				],
				ev: [
					...(last && last.tpa >= 40 && last.tp / last.tpa >= 0.36
						? [
								{
									src: "stats" as const,
									text: `${pctText(last.tp, last.tpa)} from three on ${last.tpa} attempts`,
									p: 2,
								},
							]
						: []),
					{
						src: "film",
						text: "Finds the gaps and the high post against zones",
						p: 1,
					},
				],
				stat: !!last,
				gradeKey: "cs",
			});
		}
		const zw = 10 - (G("shoot") + G("pm")) / 2;
		const mzw = group !== "big" ? ramp(zw, 5.5, 9) : 0;
		if (mzw > 0) {
			out.push({
				key: "zoneProblem",
				groups: ["zone"],
				family: "situational",
				side: "weakness",
				m: mzw,
				title: "Zones pack the paint on him",
				texts: [
					[
						"Zone defenses take him out of the game: no shot over it, no pass through it",
						"Against a zone he's a spectator",
					],
					[
						"Zones sag off him and dare him to beat them",
						"Teams will zone him and pack the lane",
					],
					["Can get stuck against zone defenses", "Zone looks slow him down"],
				],
				ev: [
					...(last && last.tpa >= 20
						? [
								{
									src: "stats" as const,
									text: `${pctText(last.tp, last.tpa)} from three, ${r1(x.p40(last, last.ast))} assists per 40`,
									p: 2,
								},
							]
						: []),
					{
						src: "film",
						text: "Stands still on the perimeter when the defense zones up",
						p: 1,
					},
				],
				fix: { fixable: true, focus: "three" },
				gradeKey: "shoot",
			});
		}
		// Physical man defense: strength (and how he finishes through contact)
		const bench = sig.combine?.benchPct;
		const weak = 40 - r.stre + (bench !== undefined ? (40 - bench) / 6 : 0);
		const mp = group !== "big" || r.stre < 35 ? ramp(weak, 4, 18) : 0;
		if (mp > 0) {
			out.push({
				key: "physicalMan",
				groups: ["physical"],
				family: "situational",
				side: "weakness",
				m: mp,
				title: "Physical man defense",
				texts: [
					[
						"Physical man defense knocks him off everything: his spots, his drives, his timing",
						"Gets pushed around by physical defenders, badly",
					],
					[
						"Struggles against physical man coverage; gets bumped off his spots",
						"A strong defender takes him out of rhythm",
					],
					[
						"Can be bothered by physical defenders",
						"Needs to get stronger against physical man coverage",
					],
				],
				ev: [
					...(bench !== undefined
						? [
								{
									src: "combine" as const,
									text: `${ordinal(bench)} percentile on the bench press`,
									p: 3,
								},
							]
						: []),
					{
						src: "film",
						text: `Strength is ${filmWord(r.stre)} for his position`,
						p: 1,
					},
				],
				fix: { fixable: true, note: "a strength program, not a skill plan" },
				tools: true,
			});
		}
		const strong = r.stre - 55 + (G("fin") + G("od")) / 2 - 6;
		const ms = ramp(strong, 5, 16);
		if (ms > 0) {
			out.push({
				key: "physicalStrong",
				groups: ["physical"],
				family: "situational",
				side: "strength",
				m: ms,
				title: "Unbothered by physical defense",
				texts: [
					[
						"Physical defenders bounce off him; he gets to his spots anyway",
						"Grown-man strength already: physicality doesn't faze him",
					],
					[
						"Plays through physical man coverage",
						"Strong enough to hold his spots against physical defenders",
					],
					[
						"Handles physical defenders fine",
						"Doesn't get pushed off his spots",
					],
				],
				ev: [
					...(bench !== undefined && bench >= 60
						? [
								{
									src: "combine" as const,
									text: `${ordinal(bench)} percentile on the bench press`,
									p: 3,
								},
							]
						: []),
					{
						src: "film",
						text: `Strength is ${filmWord(r.stre)} for his position`,
						p: 1,
					},
				],
				tools: true,
			});
		}
	}

	// Big games: vs strong opponents (NCAA tournament, better seeds) and conference vs non-conference play
	const season = last ? gmsc40(last) : 0;
	let dPost: number | undefined;
	let postEv: Cand["ev"][number] | undefined;
	const strongGames = (sig.games ?? []).filter((g) => g.strong);
	const strongMin = strongGames.reduce((a, g) => a + g.min, 0);
	if (last && strongGames.length >= 2 && strongMin >= 45 && last.min >= 300) {
		const post = (strongGames.reduce((a, g) => a + g.gmsc, 0) * 40) / strongMin;
		dPost = (post - season) / Math.max(8, Math.abs(season));
		const pts = strongGames.reduce((a, g) => a + g.pts, 0) / strongGames.length;
		postEv = {
			src: "stats",
			text: `${r1(pts)} points a game in ${strongGames.length} games against tournament-level opponents (${r1(last.pts / Math.max(1, last.gp))} on the season)`,
			p: 3,
		};
	}
	let dConf: number | undefined;
	let confEv: Cand["ev"][number] | undefined;
	const sp = sig.splits;
	if (sp && sp.nonConf.min >= 150 && sp.conf.min >= 200) {
		const a = gmsc40(sp.nonConf);
		const b = gmsc40(sp.conf);
		dConf = (b - a) / Math.max(8, Math.abs(a));
		confEv = {
			src: "splits",
			text: `Game score per 40 went from ${r1(a)} in non-conference games to ${r1(b)} in conference play`,
			p: 2,
		};
	}
	const bigGameTrait = trait(x.input, "bigGame");
	if (dPost !== undefined || dConf !== undefined || bigGameTrait) {
		const d =
			dPost !== undefined && dConf !== undefined
				? 0.6 * dPost + 0.4 * dConf
				: (dPost ?? dConf ?? 0);
		const tAdj = bigGameTrait ? (bigGameTrait.estimate - 50) / 100 : 0;
		const up = d + tAdj;
		const ev = [postEv, confEv].filter((e): e is NonNullable<typeof e> => !!e);
		if (bigGameTrait) {
			ev.push({ src: "traits", text: traitText(bigGameTrait), p: 1 });
		}
		if (last && last.strength >= 80) {
			ev.push({
				src: "stats",
				text: `Schedule strength ${Math.round(last.strength)} on the conference scale (75 is an average power conference)`,
				p: 1,
			});
		}
		const mu = ramp(up, 0.1, 0.35);
		const md = ramp(-up, 0.12, 0.4);
		if (mu > 0) {
			out.push({
				key: "bigGame",
				groups: ["bigGame"],
				family: "situational",
				side: "strength",
				m: mu,
				title: "Big-game performer",
				texts: [
					[
						"Rises to the moment: his best games came against the best teams",
						"The bigger the game, the better he played",
					],
					[
						"Played his best against strong opponents",
						"Steps up against better competition",
					],
					[
						"Held up, and then some, against good teams",
						"Didn't shrink against the better teams on the schedule",
					],
				],
				ev,
				stat: true,
			});
		} else if (md > 0) {
			out.push({
				key: "fades",
				groups: ["bigGame"],
				family: "situational",
				side: "weakness",
				m: md,
				title: "Fades against strong opponents",
				texts: [
					[
						"Disappears against good teams; the numbers came against weak opponents",
						"His production falls off a cliff against quality competition",
					],
					[
						"Fades against strong opponents",
						"Numbers dip when the competition gets better",
					],
					[
						"A little quieter against the better teams",
						"Production slips some against good opponents",
					],
				],
				ev,
				stat: true,
				fix: {
					fixable: false,
					note: "a read on competition level, not a skill",
				},
			});
		}
	}
	return out;
};

const consistency = (x: X): Cand[] => {
	const out: Cand[] = [];
	const { sig, last, career, r, G, group } = x;
	// Streaky shooter: non-conference (Nov-Dec) vs conference (Jan-Mar) three-point shooting, and season to season
	let z = 0;
	const ev: Cand["ev"] = [];
	const sp = sig.splits;
	if (sp && sp.nonConf.tpa >= 25 && sp.conf.tpa >= 25) {
		const a = sp.nonConf.tp / sp.nonConf.tpa;
		const b = sp.conf.tp / sp.conf.tpa;
		const p = (sp.nonConf.tp + sp.conf.tp) / (sp.nonConf.tpa + sp.conf.tpa);
		const se = Math.sqrt(
			Math.max(0.15, p * (1 - p)) * (1 / sp.nonConf.tpa + 1 / sp.conf.tpa),
		);
		z = Math.max(z, Math.abs(a - b) / se);
		ev.push({
			src: "splits",
			text: `${pctText(sp.nonConf.tp, sp.nonConf.tpa)} from three in non-conference games (Nov-Dec), ${pctText(sp.conf.tp, sp.conf.tpa)} in conference play (Jan-Mar)`,
			p: 3,
		});
	}
	const shootingSeasons = sig.seasons.filter((s) => s.tpa >= 40);
	if (shootingSeasons.length >= 2) {
		const a = shootingSeasons.at(-2)!;
		const b = shootingSeasons.at(-1)!;
		const pa = a.tp / a.tpa;
		const pb = b.tp / b.tpa;
		const p = (a.tp + b.tp) / (a.tpa + b.tpa);
		const se = Math.sqrt(Math.max(0.15, p * (1 - p)) * (1 / a.tpa + 1 / b.tpa));
		const zs = Math.abs(pa - pb) / se;
		z = Math.max(z, 0.85 * zs);
		ev.push({
			src: "stats",
			text: `${pctText(a.tp, a.tpa)} from three in ${a.season}, ${pctText(b.tp, b.tpa)} in ${b.season}`,
			p: 2,
		});
	}
	const cons = trait(x.input, "consistency");
	if (cons) {
		z += (50 - cons.estimate) / 20;
		ev.push({ src: "traits", text: traitText(cons), p: 1 });
	}
	const ms = ramp(z, 1.6, 3.2);
	if (ms > 0 && (career?.tpa ?? 0) >= 50) {
		out.push({
			key: "streaky",
			groups: ["shotConsistency"],
			family: "consistency",
			side: "weakness",
			m: ms,
			title: "Streaky shooter",
			texts: [
				[
					"Wildly streaky: red-hot for a month, then ice cold for the next",
					"You never know which shooter shows up",
				],
				[
					"Streaky from three; the hot stretches and the cold ones both run long",
					"A streaky shooter month to month",
				],
				[
					"Some streakiness to the jumper",
					"Shooting runs a little hot and cold",
				],
			],
			ev,
			stat: true,
			fix: {
				fixable: true,
				focus: "three",
				note: "repeatable mechanics steady it",
			},
			gradeKey: "shoot",
		});
	} else if (
		z < 0.6 &&
		career &&
		career.tpa >= 90 &&
		career.tp / career.tpa >= 0.355 &&
		ev.length > 0 &&
		shootingSeasons.every((x) => x.tp / x.tpa >= 0.33) &&
		(!sp ||
			sp.nonConf.tpa < 25 ||
			sp.conf.tpa < 25 ||
			Math.min(sp.nonConf.tp / sp.nonConf.tpa, sp.conf.tp / sp.conf.tpa) >=
				0.33)
	) {
		out.push({
			key: "steadyShooter",
			groups: ["shotConsistency"],
			family: "consistency",
			side: "strength",
			m: ramp(career.tp / career.tpa, 0.355, 0.42),
			title: "Steady shooter",
			texts: [
				[
					"Same shooter every month: no slumps, no droughts",
					"Metronome consistency from deep",
				],
				[
					"Consistent from three, month to month and year to year",
					"The jumper doesn't slump",
				],
				["A steady shooter", "Shoots it about the same every night"],
			],
			ev,
			stat: true,
			gradeKey: "shoot",
		});
	}

	// Range: NBA range or limited to the college line
	if (last && last.min >= 250) {
		const tpa40 = x.p40(last, last.tpa);
		const tpp = last.tpa > 0 ? last.tp / last.tpa : 0;
		const rng = x.sub("rng");
		const tcs = x.sub("tcs");
		const score =
			(r ? G("cs") : 7) +
			(tpa40 >= 6 ? 1 : 0) +
			(tpp >= 0.37 && last.tpa >= 50 ? 1 : 0) +
			(rng !== undefined && tcs !== undefined && rng >= tcs + 4 ? 1 : 0);
		const mr = ramp(score, 9.5, 12.5);
		const ev2: Cand["ev"] = [
			{
				src: "stats",
				text: `${r1(tpa40)} three-point attempts per 40 minutes at ${pctText(last.tp, last.tpa)}`,
				p: 2,
			},
		];
		if (sig.combine?.spotUp) {
			ev2.push({
				src: "combine",
				text: `${sig.combine.spotUp[0]} of ${sig.combine.spotUp[1]} in the combine's spot-up drill`,
				p: 3,
			});
		}
		if (r && rng !== undefined) {
			ev2.push({
				src: "film",
				text:
					rng >= 58
						? `Range is ${filmWord(rng)}: the shot looks the same a step behind the line`
						: `Range is ${filmWord(rng)} on film`,
				p: 1,
			});
		}
		if (mr > 0) {
			out.push({
				key: "nbaRange",
				groups: ["range"],
				family: "consistency",
				side: "strength",
				m: mr,
				title: "NBA range",
				texts: [
					[
						"Deep range already: pulls up from 26 feet without a hitch",
						"Range that bends defenses, well past the NBA line",
					],
					[
						"NBA range today; comfortable a step behind the line",
						"The range translates to the NBA line",
					],
					[
						"Range extends to the NBA line",
						"Can stretch it out to NBA distance",
					],
				],
				ev: ev2,
				stat: true,
				gradeKey: "cs",
			});
		}
		const limited =
			group === "big"
				? 0
				: (tpa40 < 2.6 ? 1.2 : 0) +
					(r && rng !== undefined && tcs !== undefined && rng <= tcs - 8
						? 1
						: 0) +
					(r && G("cs") <= 4 ? 0.6 : 0);
		const ml = ramp(limited, 1, 2.6);
		if (ml > 0) {
			out.push({
				key: "limitedRange",
				groups: ["range"],
				family: "consistency",
				side: "weakness",
				m: ml,
				title: "Limited range",
				texts: [
					[
						"No range to speak of: barely looks at the three",
						"His range ends well inside the college line",
					],
					["Range stops at the college line", "Hasn't shown NBA range"],
					[
						"Range is still short of the NBA line",
						"Needs to extend his range a few feet",
					],
				],
				ev: ev2.filter((e) => e.src !== "film" || (rng ?? 99) < 45),
				stat: true,
				fix: { fixable: true, focus: "three" },
				gradeKey: "cs",
			});
		}
	}

	// Free throws as a predictor of three-point growth: "the jumper is real" or "a mirage"
	if (career && career.fta >= 60) {
		const ft = career.ft / career.fta;
		const tp = career.tpa > 0 ? career.tp / career.tpa : 0;
		const ev3: Cand["ev"] = [
			{
				src: "stats",
				text: `${pctText(career.ft, career.fta)} on ${career.fta} free throws, ${pctText(career.tp, career.tpa)} on ${career.tpa} threes before the draft`,
				p: 3,
			},
		];
		const shootingSeasons2 = sig.seasons.filter((s) => s.tpa >= 25);
		let statTrend: Cand["statTrend"];
		if (shootingSeasons2.length >= 2) {
			const a = shootingSeasons2.at(-2)!;
			const b = shootingSeasons2.at(-1)!;
			const d = b.tp / b.tpa - a.tp / a.tpa;
			if (Math.abs(d) >= 0.03) {
				statTrend = {
					dir: d > 0 ? 1 : -1,
					text: `3P% ${pctText(a.tp, a.tpa)} → ${pctText(b.tp, b.tpa)}`,
				};
			}
		}
		const real = ft >= 0.76 && tp < 0.345 ? ramp(ft, 0.76, 0.86) : 0;
		const mirage =
			tp >= 0.37 && ft <= 0.69
				? ramp(0.7 - ft + (career.tpa < 90 ? 0.03 : 0), 0.01, 0.12)
				: 0;
		if (real > 0) {
			out.push({
				key: "jumperReal",
				groups: ["ftPredict", "shotConsistency"],
				family: "consistency",
				side: "strength",
				m: real,
				title: "The jumper is real",
				texts: [
					[
						"The free throw stroke says the threes are coming, and soon",
						"The jumper is real: his touch at the line is elite",
					],
					[
						"The jumper is real: the free throws say the threes will come",
						"Touch at the line points to a shooter in the making",
					],
					[
						"Free throws suggest the three will improve",
						"Good touch at the line; the three should follow",
					],
				],
				ev: ev3,
				stat: true,
				gradeKey: "ft",
				statTrend,
			});
		} else if (mirage > 0) {
			out.push({
				key: "mirage",
				groups: ["ftPredict", "shotConsistency"],
				family: "consistency",
				side: "weakness",
				m: mirage,
				title: "Three-point mirage",
				texts: [
					[
						"The three-point number is a mirage: the free throw stroke says it won't hold",
						"Hot from three, broken at the line: expect the three to crater",
					],
					[
						"The three-point percentage outruns the free throw stroke; likely a mirage",
						"Free throws say the hot three-point shooting won't last",
					],
					[
						"Some regression coming on the threes, going by the free throws",
						"Free throws are a mild warning about the three-point number",
					],
				],
				ev: ev3,
				stat: true,
				fix: { fixable: true, focus: "ft" },
				gradeKey: "ft",
				statTrend,
			});
		}
	}
	return out;
};

const mechanics = (x: X): Cand[] => {
	const out: Cand[] = [];
	const { r, G, sig, last, group, input } = x;
	if (r) {
		// Release speed: catch-and-shoot against range, or touch at the line against the three
		const tcs = x.sub("tcs");
		const rng = x.sub("rng");
		const gap =
			tcs !== undefined && rng !== undefined
				? rng - tcs
				: (r.ft - r.tp - 8) * 0.7;
		const ms = G("cs") <= 7 ? ramp(gap, 8, 20) : 0;
		const ev: Cand["ev"] = [
			{
				src: "film",
				text: "Needs a beat to load the shot; closeouts bother him",
				p: 1,
			},
		];
		if (sig.combine?.spotUp) {
			ev.push({
				src: "combine",
				text: `${sig.combine.spotUp[0]} of ${sig.combine.spotUp[1]} in the timed spot-up drill`,
				p: 3,
			});
		}
		if (ms > 0) {
			out.push({
				key: "slowRelease",
				groups: ["release"],
				family: "mechanics",
				side: "weakness",
				m: ms,
				title: "Slow release",
				texts: [
					[
						"A slow, loopy release that NBA closeouts will smother",
						"The release is so slow he needs a full step of space",
					],
					[
						"Slow release: needs time and space to get it off",
						"Deliberate mechanics; quick closeouts bother him",
					],
					[
						"Release could be a tick quicker",
						"Mechanics are a little slow on the catch",
					],
				],
				ev,
				fix: {
					fixable: true,
					focus: "three",
					note: "release speed is coachable",
				},
				gradeKey: "cs",
			});
		}
		const quick =
			tcs !== undefined && rng !== undefined ? tcs - rng : (r.tp - r.ft) * 0.5;
		const mq = G("cs") >= 8 ? ramp(quick, 4, 14) : 0;
		if (mq > 0) {
			out.push({
				key: "quickRelease",
				groups: ["release"],
				family: "mechanics",
				side: "strength",
				m: mq,
				title: "Quick release",
				texts: [
					[
						"Lightning release: it's gone before the closeout arrives",
						"One of the quickest releases in the class",
					],
					[
						"Quick, compact release off the catch",
						"Gets it off fast against closeouts",
					],
					["Release is quick enough", "Compact shot on the catch"],
				],
				ev: [
					{
						src: "film",
						text: `Catch-and-shoot mechanics are ${filmWord(tcs ?? r.tp)}`,
						p: 1,
					},
				],
				gradeKey: "cs",
			});
		}
		// Low release point: a small shooter, little lift, shots blocked
		const smallFor =
			group === "guard"
				? 75 - input.heightInches
				: group === "wing"
					? 78 - input.heightInches
					: 0;
		const ba40 = last && last.fga >= 150 ? x.p40(last, last.ba) : undefined;
		const lowScore =
			(ba40 !== undefined ? (ba40 - 0.8) * 1.6 : 0) +
			(smallFor > 0 ? 0.35 * smallFor : 0) +
			((x.sub("mxv") ?? r.jmp) < 42 ? 0.6 : 0);
		const ml = group !== "big" && G("shoot") >= 4 ? ramp(lowScore, 1, 2.6) : 0;
		if (ml > 0) {
			out.push({
				key: "lowRelease",
				groups: ["releasePoint"],
				family: "mechanics",
				side: "weakness",
				m: ml,
				title: "Low release point",
				texts: [
					[
						"A low, flat release that length will swallow at the next level",
						"Shoots from his chest; NBA length will block it",
					],
					[
						"Low release point: contestable by longer defenders",
						"Shot gets contested by length because the release is low",
					],
					[
						"Release point could come up a bit",
						"Slightly low release against length",
					],
				],
				ev: [
					...(ba40 !== undefined && ba40 >= 0.8
						? [
								{
									src: "stats" as const,
									text: `${r1(ba40)} of his shots blocked per 40 minutes`,
									p: 3,
								},
							]
						: []),
					{
						src: "film",
						text: `${feetInches(input.heightInches)} with ${filmWord(x.sub("mxv") ?? r.jmp)} lift on the jumper`,
						p: 1,
					},
				],
				fix: {
					fixable: true,
					focus: "pullup",
					note: "raising a release point is slow work",
				},
				gradeKey: "od",
			});
		}
	}

	// Handedness (public) and the handle: lefties get forced right
	const hand = sig.hand;
	if (hand) {
		const handle = r ? (x.sub("hnd") ?? r.drb) : undefined;
		const pmG = r ? G("pm") : 6;
		if (hand === "left") {
			// (handedness alone is never more than a minus)
			const weakSide = r
				? Math.min(
						2.2,
						ramp(9 - pmG + (handle !== undefined && handle < 55 ? 1 : 0), 2, 7),
					)
				: 1;
			if (weakSide > 0 && (group !== "big" || pmG >= 5)) {
				out.push({
					key: "forcedRight",
					groups: ["hand"],
					family: "mechanics",
					side: "weakness",
					m: weakSide,
					title: "Left-hand dominant",
					texts: [
						[
							"Can't go right at all: defenses will force him right every trip",
							"Strictly a left-hand player; take that away and he's stuck",
						],
						[
							"Left-hand dominant: can be forced right",
							"Prefers his left; scouts will force him right",
						],
						[
							"Favors his left hand; the right needs work",
							"A lefty who likes going left",
						],
					],
					ev: [
						{
							src: "film",
							text: "Goes left on most drives and finishes",
							p: 1,
						},
						...(handle !== undefined
							? [
									{
										src: "film" as const,
										text: `Handle is ${filmWord(handle)}`,
										p: 2,
									},
								]
							: []),
					],
					fix: { fixable: true, focus: "handle" },
					gradeKey: "pm",
				});
			} else if (r && pmG >= 9) {
				out.push({
					key: "lefty",
					groups: ["hand"],
					family: "mechanics",
					side: "strength",
					m: ramp(pmG, 9, 12),
					title: "Lefty who goes both ways",
					texts: [
						[
							"A left-hander who is just as dangerous going right: a scouting-report headache",
							"Lefty with a two-way handle",
						],
						[
							"Lefty who can go either way",
							"Left-handed and comfortable going right",
						],
						["Left-handed, with a decent right hand", "Lefty who can go right"],
					],
					ev: [
						{
							src: "film",
							text: `Handle is ${filmWord(handle ?? 50)} with either hand`,
							p: 1,
						},
					],
					gradeKey: "pm",
				});
			}
		} else if (r && group === "guard" && pmG <= 3) {
			out.push({
				key: "goesRight",
				groups: ["hand"],
				family: "mechanics",
				side: "weakness",
				m: ramp(5 - pmG, 2, 5),
				title: "One-handed driver",
				texts: [
					[
						"Goes right every single time: easy to load up against",
						"No left hand at all",
					],
					[
						"Goes right almost every time; can be forced left",
						"Right-hand dominant driver",
					],
					["Leans on his right hand", "The left hand needs work"],
				],
				ev: [
					{ src: "film", text: `Handle is ${filmWord(handle ?? 40)}`, p: 1 },
				],
				fix: { fixable: true, focus: "handle" },
				gradeKey: "pm",
			});
		}
	}

	// Finishes through contact vs avoids it
	if (last && last.fga >= 120) {
		const ftr = last.fta / last.fga;
		const con = x.sub("con");
		const fns = x.sub("fns");
		const shape = con !== undefined && fns !== undefined ? con - fns : 0;
		const ev: Cand["ev"] = [
			{
				src: "stats",
				text: `${r1(x.p40(last, last.fta))} free throw attempts per 40 minutes (${ftr.toFixed(2)} per shot)`,
				p: 3,
			},
		];
		if (r && con !== undefined) {
			ev.push({
				src: "film",
				text: `Contact finishing is ${filmWord(con)}`,
				p: 1,
			});
		}
		const mt = ramp(
			ftr + shape / 100 + (r ? (r.stre - 50) / 200 : 0),
			0.42,
			0.65,
		);
		const ma =
			group !== "big" || ftr < 0.25
				? ramp(
						0.25 - ftr - shape / 120 + (r ? (45 - r.stre) / 250 : 0),
						0,
						0.12,
					)
				: 0;
		if (mt > 0) {
			out.push({
				key: "throughContact",
				groups: ["contact"],
				family: "mechanics",
				side: "strength",
				m: mt,
				title: "Finishes through contact",
				texts: [
					[
						"Seeks out contact and finishes through it: lives at the line",
						"Bodies defenders and still finishes; an and-one machine",
					],
					[
						"Finishes through contact; gets to the line",
						"Doesn't shy from contact at the rim",
					],
					[
						"Willing to take contact at the rim",
						"Gets to the line at a decent rate",
					],
				],
				ev,
				stat: true,
				gradeKey: "fin",
			});
		} else if (ma > 0) {
			out.push({
				key: "avoidsContact",
				groups: ["contact"],
				family: "mechanics",
				side: "weakness",
				m: ma,
				title: "Avoids contact",
				texts: [
					[
						"Shies away from contact entirely: floaters and fadeaways instead of the rim",
						"Allergic to contact at the basket",
					],
					[
						"Avoids contact; settles for finesse finishes",
						"Rarely gets to the line for his touches",
					],
					["Could seek out contact more", "Prefers finesse to contact"],
				],
				ev,
				stat: true,
				fix: {
					fixable: true,
					focus: "finish",
					note: "strength and a mindset as much as skill",
				},
				gradeKey: "fin",
			});
		}
	}
	return out;
};

const feel = (x: X): Cand[] => {
	const out: Cand[] = [];
	const { r, G, last, input, group } = x;
	const ast40 = last && last.min >= 250 ? x.p40(last, last.ast) : undefined;
	const tov40 = last && last.min >= 250 ? x.p40(last, last.tov) : undefined;
	const fga40 = last && last.min >= 250 ? x.p40(last, last.fga) : undefined;
	const atRatio =
		ast40 !== undefined && tov40 !== undefined && tov40 > 0
			? ast40 / tov40
			: undefined;
	const statEv: Cand["ev"] =
		ast40 !== undefined && tov40 !== undefined
			? [
					{
						src: "stats",
						text: `${r1(ast40)} assists and ${r1(tov40)} turnovers per 40 minutes`,
						p: 2,
					},
				]
			: [];
	if (r) {
		// Processing speed
		const late = ramp(5.5 - G("iq") + (G("pm") <= 5 ? 0.6 : 0), 1, 4.5);
		if (late > 0) {
			out.push({
				key: "lateReads",
				groups: ["processing"],
				family: "feel",
				side: "weakness",
				m: late,
				title: "Sees plays a beat late",
				texts: [
					[
						"Processes the game slowly: by the time he sees it, the window is shut",
						"Always a beat behind the play",
					],
					["Sees plays a beat late", "Makes the right read, a beat too late"],
					["Reads can be a little slow", "Processing is a tick behind"],
				],
				ev: [
					{
						src: "film",
						text: `Court vision is ${filmWord(x.sub("vis") ?? r.pss)}; reads come late`,
						p: 1,
					},
					...(atRatio !== undefined && atRatio < 1.1 ? statEv : []),
				],
				fix: {
					fixable: true,
					focus: "playmaking",
					note: "film work speeds it up",
				},
				gradeKey: "iq",
			});
		}
		const early = ramp((G("iq") + G("pm")) / 2, 8.5, 11.5);
		if (early > 0) {
			out.push({
				key: "earlyReads",
				groups: ["processing"],
				family: "feel",
				side: "strength",
				m: early,
				title: "Sees it early",
				texts: [
					[
						"Sees the play two passes ahead; the game is slow for him",
						"Elite processor: the pass is out before the help arrives",
					],
					[
						"Sees plays before they happen",
						"Quick processor who makes the read on time",
					],
					[
						"Makes his reads on time",
						"Good feel for where the help is coming from",
					],
				],
				ev: [
					{
						src: "film",
						text: `Vision is ${filmWord(x.sub("vis") ?? r.pss)}; feel is ${filmWord(r.oiq)}`,
						p: 1,
					},
					...(atRatio !== undefined && atRatio >= 1.8 ? statEv : []),
				],
				gradeKey: "iq",
			});
		}
	}
	// Forces passes into traffic
	if (ast40 !== undefined && tov40 !== undefined) {
		const vis = x.sub("vis");
		const acc = x.sub("acc");
		const risky =
			tov40 -
			0.45 * ast40 -
			1.6 +
			(vis !== undefined && acc !== undefined ? (vis - acc) / 25 : 0);
		const mf = ast40 >= 2.5 ? ramp(risky, 0.3, 2) : 0;
		if (mf > 0) {
			out.push({
				key: "forcesPasses",
				groups: ["passRisk", "processing"],
				family: "feel",
				side: "weakness",
				m: mf,
				title: "Forces passes into traffic",
				texts: [
					[
						"Throws it into traffic over and over; the highlight pass comes with three turnovers",
						"Forces passes that aren't there, constantly",
					],
					[
						"Forces passes into traffic",
						"Tries to thread needles that aren't open",
					],
					["Can force a pass or two", "Some risky passes into traffic"],
				],
				ev: [
					...statEv,
					...(r && vis !== undefined && acc !== undefined && vis > acc + 6
						? [
								{
									src: "film" as const,
									text: "Sees the pass; the delivery isn't there yet",
									p: 1,
								},
							]
						: []),
				],
				stat: true,
				fix: { fixable: true, focus: "playmaking" },
				gradeKey: "bs",
			});
		}
	}
	// Plays within himself vs hunts his own shot
	const sd = trait(input, "shotDiscipline");
	if (last && last.min >= 250 && fga40 !== undefined && ast40 !== undefined) {
		const ts = tsPct(last);
		const within =
			(atRatio !== undefined ? (atRatio - 1.6) / 1.2 : 0) +
			(ts - 54) / 8 +
			(fga40 <= 14 ? 0.3 : 0) +
			(sd ? (sd.estimate - 50) / 25 : 0);
		const hunt =
			(fga40 - 15) / 3 +
			(group === "big" ? 1.2 - ast40 / 2 : 2.8 - ast40) / 1.5 +
			(sd ? (50 - sd.estimate) / 25 : 0) -
			Math.max(0, (ts - 56) / 6);
		const ev: Cand["ev"] = [
			{
				src: "stats",
				text: `${r1(fga40)} shots and ${r1(ast40)} assists per 40 minutes, ${ts.toFixed(1)}% true shooting`,
				p: 2,
			},
		];
		if (sd) {
			ev.push({ src: "traits", text: traitText(sd), p: 1 });
		}
		const mw = ramp(within, 0.9, 2.4);
		const mh = ramp(hunt, 1, 2.6);
		if (mw > 0 && mw >= mh) {
			out.push({
				key: "withinHimself",
				groups: ["selfSel"],
				family: "feel",
				side: "strength",
				m: mw,
				title: "Plays within himself",
				texts: [
					[
						"Never forces it: takes what the defense gives and makes it count",
						"Mature, mistake-free game; knows exactly who he is",
					],
					[
						"Plays within himself; good shots, few mistakes",
						"Takes what the defense gives",
					],
					["Mostly plays within himself", "Rarely forces the issue"],
				],
				ev,
				stat: true,
				gradeKey: "iq",
			});
		} else if (mh > 0) {
			out.push({
				key: "huntsShot",
				groups: ["selfSel", "ballDom"],
				family: "feel",
				side: "weakness",
				m: mh,
				title: "Hunts his own shot",
				texts: [
					[
						"Shot-hunts on every trip: the ball goes in and doesn't come back out",
						"A black hole: shoots first, second and third",
					],
					[
						"Hunts his own shot; the ball sticks",
						"Looks for his shot before the open man",
					],
					["Can get a little shot-happy", "Leans toward his own shot"],
				],
				ev,
				stat: true,
				fix: {
					fixable: true,
					focus: "playmaking",
					note: "a role and habits question as much as skill",
				},
				gradeKey: "pm",
			});
		}
	}
	return out;
};

const defense = (x: X): Cand[] => {
	const out: Cand[] = [];
	const { r, G, last, input, group, sig } = x;
	const stl40 = last && last.min >= 250 ? x.p40(last, last.stl) : undefined;
	const blk40 = last && last.min >= 250 ? x.p40(last, last.blk) : undefined;
	const pf40 = last && last.min >= 250 ? x.p40(last, last.pf) : undefined;
	const fd = trait(input, "foulDiscipline");
	// Gambles for steals
	if (stl40 !== undefined && pf40 !== undefined) {
		const stlS = x.sub("stl");
		const pdf = x.sub("pdf");
		const gamble =
			(stl40 - 2) * 1.2 +
			(pf40 - 3.3) * 0.6 +
			(stlS !== undefined && pdf !== undefined ? (stlS - pdf) / 15 : 0);
		const mg = stl40 >= 1.8 ? ramp(gamble, 0.4, 2.2) : 0;
		const ev: Cand["ev"] = [
			{
				src: "stats",
				text: `${r1(stl40)} steals and ${r1(pf40)} fouls per 40 minutes`,
				p: 2,
			},
		];
		if (mg > 0) {
			out.push({
				key: "gambles",
				groups: ["steals"],
				family: "defense",
				side: "weakness",
				m: mg,
				title: "Gambles for steals",
				texts: [
					[
						"Gambles constantly: the steals are real, so are the open threes behind him",
						"Lives in the passing lanes and leaves his man for dead",
					],
					[
						"Gambles for steals and gets caught out of position",
						"Jumps passing lanes too often",
					],
					[
						"Can gamble a little in the passing lanes",
						"Occasionally chases steals",
					],
				],
				ev: [
					...ev,
					...(r && stlS !== undefined && pdf !== undefined && stlS > pdf + 6
						? [
								{
									src: "film" as const,
									text: "Hands are quicker than his positioning",
									p: 1,
								},
							]
						: []),
				],
				stat: true,
				fix: { fixable: true, focus: "perimD" },
				gradeKey: "pd",
			});
		} else if (stl40 >= 2.2 && pf40 < 3.2) {
			out.push({
				key: "activeHands",
				groups: ["steals"],
				family: "defense",
				side: "strength",
				m: ramp(stl40, 2.2, 3.4),
				title: "Active hands without gambling",
				texts: [
					[
						"Pickpocket who doesn't gamble: the steals come from position",
						"Elite hands and anticipation, under control",
					],
					[
						"Active hands; gets steals without gambling",
						"Disruptive without leaving his man",
					],
					["Gets his hands on the ball", "Some steals, rarely out of position"],
				],
				ev,
				stat: true,
				gradeKey: "pd",
			});
		}
	}
	// Fouls at the rim
	if (pf40 !== undefined && (group === "big" || (r && G("id") >= 6))) {
		const foul = pf40 - 4.4 + (fd ? (50 - fd.estimate) / 30 : 0);
		const mf = ramp(foul, 0.2, 2);
		const ev: Cand["ev"] = [
			{
				src: "stats",
				text: `${r1(pf40)} fouls per 40 minutes${blk40 !== undefined ? `, ${r1(blk40)} blocks` : ""}`,
				p: 3,
			},
		];
		if (fd) {
			ev.push({ src: "traits", text: traitText(fd), p: 1 });
		}
		if (mf > 0) {
			out.push({
				key: "foulProne",
				groups: ["fouls"],
				family: "defense",
				side: "weakness",
				m: mf,
				title: "Foul-prone at the rim",
				texts: [
					[
						"Can't stay on the floor: fouls on every contest",
						"Foul trouble every night; jumps at every fake",
					],
					[
						"Foul-prone at the rim; bites on pump fakes",
						"Picks up cheap fouls contesting at the rim",
					],
					["Can get into foul trouble", "A few too many fouls at the rim"],
				],
				ev,
				stat: true,
				fix: {
					fixable: true,
					focus: "rimD",
					note: "verticality and discipline are teachable",
				},
				gradeKey: "id",
			});
		} else if (blk40 !== undefined && blk40 >= 2.4 && pf40 <= 3.6) {
			out.push({
				key: "cleanRim",
				groups: ["fouls"],
				family: "defense",
				side: "strength",
				m: ramp(blk40 - pf40 / 2, 0.6, 2.6),
				title: "Protects the rim without fouling",
				texts: [
					[
						"Erases shots without fouling: elite timing and verticality",
						"A clean, disciplined shot blocker",
					],
					["Blocks shots without fouling", "Disciplined rim protector"],
					[
						"Contests at the rim without fouling much",
						"Stays vertical at the rim",
					],
				],
				ev,
				stat: true,
				gradeKey: "id",
			});
		}
	}
	if (r) {
		// Good on the ball, lost off it
		const pdf = x.sub("pdf") ?? r.pdef ?? r.diq;
		const lost = (pdf - 50) / 10 + (5 - G("iq"));
		const ml = G("pd") >= 6 ? ramp(lost, 1.5, 4) : 0;
		if (ml > 0) {
			out.push({
				key: "lostOffBall",
				groups: ["defAware"],
				family: "defense",
				side: "weakness",
				m: ml,
				title: "Lost off the ball",
				texts: [
					[
						"Locks up on the ball, then gets completely lost off it: ball-watches, misses rotations",
						"A different defender off the ball, and not in a good way",
					],
					[
						"Good on the ball, lost off it",
						"Sticks to his man, loses him off the ball",
					],
					[
						"Off-ball defense lags his on-ball defense",
						"Some ball-watching off the ball",
					],
				],
				ev: [
					{
						src: "film",
						text: `On-ball defense is ${filmWord(pdf)}; rotations are late`,
						p: 1,
					},
				],
				fix: { fixable: true, focus: "perimD", note: "film work on rotations" },
				gradeKey: "iq",
			});
		}
		// Switch 1-4 / targetable in pick-and-roll
		const lat = x.sub("lat") ?? r.spd;
		const dv = trait(input, "defensiveVersatility");
		const sw =
			(G("pd") + G("ath") + Math.max(G("id"), G("size"))) / 3 +
			(dv ? (dv.estimate - 50) / 25 : 0);
		const msw = group !== "guard" ? ramp(sw, 7.5, 10.5) : 0;
		const swEv: Cand["ev"] = [
			{
				src: "film",
				text: `Lateral quickness is ${filmWord(lat)} for his size`,
				p: 1,
			},
		];
		if (sig.combine?.agilityPct !== undefined) {
			swEv.push({
				src: "combine",
				text: `${ordinal(sig.combine.agilityPct)} percentile in the lane agility drill`,
				p: 3,
			});
		}
		if (sig.combine?.apeIndex !== undefined && sig.combine.apeIndex >= 3) {
			swEv.push({
				src: "combine",
				text: `+${sig.combine.apeIndex.toFixed(1)}" wingspan over his height`,
				p: 2,
			});
		}
		if (dv) {
			swEv.push({ src: "traits", text: traitText(dv), p: 2 });
		}
		if (msw > 0) {
			out.push({
				key: "switch",
				groups: ["switch"],
				family: "defense",
				side: "strength",
				m: msw,
				title: "Can switch 1-4",
				texts: [
					[
						"Switches one through five without a weak link",
						"A true switch defender: guards, wings and bigs",
					],
					["Can switch 1-4", "Switchable across four positions"],
					["Can switch a few positions", "Holds up on most switches"],
				],
				ev: swEv,
				tools: true,
				gradeKey: "pd",
			});
		}
		const target =
			group === "big"
				? 6 - (G("pd") + G("ath")) / 2 + (lat < 40 ? 0.8 : 0)
				: 5.5 - (G("pd") + G("size")) / 2 + (r.stre < 35 ? 0.6 : 0);
		const mt = ramp(target, 1.5, 5);
		if (mt > 0) {
			out.push({
				key: "pnrTarget",
				groups: ["switch"],
				family: "defense",
				side: "weakness",
				m: mt,
				title: "Targetable in pick-and-roll",
				texts: [
					[
						group === "big"
							? "Offenses will hunt him in every pick-and-roll: no feet to switch, no answer in space"
							: "Offenses will screen him into every action and attack him",
						"The first player opposing coaches will target",
					],
					[
						group === "big"
							? "Targetable in pick-and-roll: slow feet in space"
							: "Targetable in pick-and-roll: dies on screens",
						"Will get picked on in pick-and-roll",
					],
					[
						"Can be targeted in some pick-and-roll actions",
						"A mild pick-and-roll liability",
					],
				],
				ev: swEv.filter(
					(e) => e.src !== "combine" || (sig.combine?.agilityPct ?? 100) < 40,
				),
				fix:
					group === "big"
						? { fixable: false, note: "foot speed rarely gets much better" }
						: {
								fixable: true,
								focus: "perimD",
								note: "screen navigation can improve",
							},
				tools: true,
				gradeKey: "pd",
			});
		}
	}
	return out;
};

const physical = (x: X): Cand[] => {
	const out: Cand[] = [];
	const { input, sig, r, group, G } = x;
	const h = input.heightInches;
	const w = sig.combine?.weight ?? input.weight;
	const bmi = (703 * w) / (h * h);
	const ape = sig.combine?.apeIndex;
	const lean = group === "big" ? 24.5 : 23.5;
	// Frame to add weight
	const frame =
		(lean - bmi) / 1.2 +
		(input.age <= 19 ? 0.5 : input.age <= 20 ? 0.25 : 0) +
		(ape !== undefined && ape >= 3 ? 0.3 : 0);
	const mf = input.age <= 21 ? ramp(frame, 0.8, 3.5) : 0;
	const frameEv: Cand["ev"] = [
		{
			src: "stats",
			text: `${w} lbs on a ${feetInches(h)} frame at ${input.age}`,
			p: 2,
		},
	];
	if (
		sig.combine?.weightVsListed !== undefined &&
		Math.abs(sig.combine.weightVsListed) >= 5
	) {
		frameEv.push({
			src: "combine",
			text: `Weighed in ${Math.abs(sig.combine.weightVsListed)} lbs ${sig.combine.weightVsListed > 0 ? "over" : "under"} his listing`,
			p: 3,
		});
	}
	if (mf > 0) {
		out.push({
			key: "frame",
			groups: ["frame"],
			family: "physical",
			side: "strength",
			m: mf,
			title: "Frame to add weight",
			texts: [
				[
					"A frame that can carry 25 more pounds without losing a step",
					"Rail-thin now, built to fill out in a big way",
				],
				["Frame to add 15-20 pounds", "Room on his frame to get much stronger"],
				["Some room to fill out", "Can add weight to his frame"],
			],
			ev: frameEv,
			tools: true,
			gradeKey: "size",
		});
	}
	const maxed =
		(bmi - (group === "big" ? 27 : 25.5)) / 1.2 +
		(input.age >= 23 ? 1 : input.age >= 22 ? 0.5 : 0) +
		(r && r.stre >= 60 && G("ath") <= 5 ? 0.6 : 0);
	const mm = input.age >= 21 ? ramp(maxed, 0.8, 2.8) : 0;
	if (mm > 0) {
		out.push({
			key: "maxedOut",
			groups: ["frame"],
			family: "physical",
			side: "weakness",
			m: mm,
			title: "Maxed-out body",
			texts: [
				[
					"What you see is all there is physically: a finished body at a young age",
					"No physical projection left",
				],
				[
					"Maxed-out body; little physical growth left",
					"Already physically mature; the tools won't grow",
				],
				["Not much physical projection left", "Body is close to finished"],
			],
			ev: frameEv,
			tools: true,
			fix: { fixable: false, note: "physical, not a skill" },
			gradeKey: "ath",
		});
	}
	// Late growth spurt: measured taller than his listing, or a young big still getting coordinated
	const grew = sig.combine?.heightVsListed;
	const spurt =
		(grew !== undefined ? (grew - 0.5) * 1.2 : 0) +
		(input.age <= 19 ? 0.6 : input.age <= 20 ? 0.3 : -1) +
		(r && G("size") >= 8 && G("iq") <= 6 && G("pm") <= 6 ? 0.6 : 0);
	const ms =
		grew !== undefined && grew >= 0.75
			? ramp(spurt, 1, 2.8)
			: r && input.age <= 19 && h >= 80
				? ramp(spurt, 1.1, 2.8) * 0.85
				: 0;
	if (ms > 0) {
		out.push({
			key: "growthSpurt",
			groups: ["growth"],
			family: "physical",
			side: "strength",
			m: ms,
			title: "Late growth spurt",
			texts: [
				[
					"Grew into a new body recently and the coordination is still catching up: the best is well ahead of him",
					"A late growth spurt; the skills haven't caught up to the size yet, and that's exciting",
				],
				[
					"Late growth spurt: coordination still catching up",
					"Still learning his new body; more to come",
				],
				[
					"May still be growing into his body",
					"Coordination still settling after a growth spurt",
				],
			],
			ev: [
				...(grew !== undefined && grew >= 0.75
					? [
							{
								src: "combine" as const,
								text: `Measured ${grew.toFixed(2).replace(/\.?0+$/, "")}" taller in shoes than his listing`,
								p: 3,
							},
						]
					: []),
				...(r
					? [
							{
								src: "film" as const,
								text: `Footwork and handle are ${filmWord((r.drb + r.oiq) / 2)} for his size`,
								p: 1,
							},
						]
					: []),
			],
			tools: true,
			gradeKey: "size",
		});
	}
	// Length plays bigger (or smaller) than his height
	if (ape !== undefined) {
		const ml = ramp(ape, 3.5, 7.5);
		const ms2 = ramp(-ape, -0.5, 3);
		const ev: Cand["ev"] = [
			{
				src: "combine",
				text: `${ape >= 0 ? "+" : ""}${ape.toFixed(1)}" wingspan over his height without shoes`,
				p: 3,
			},
		];
		if (ml > 0) {
			out.push({
				key: "length",
				groups: ["length"],
				family: "physical",
				side: "strength",
				m: ml,
				title: "Length plays bigger than his height",
				texts: [
					[
						"Freakish length: plays like he's four inches taller",
						"Arms for days; his length is a weapon at both ends",
					],
					[
						"Length plays bigger than his height",
						"Long arms make up for his height",
					],
					["Good length for his height", "Plays a bit bigger than his height"],
				],
				ev,
				tools: true,
				gradeKey: "size",
			});
		} else if (ms2 > 0) {
			out.push({
				key: "shortArms",
				groups: ["length"],
				family: "physical",
				side: "weakness",
				m: ms2,
				title: "Short arms",
				texts: [
					[
						"T-rex arms: plays several inches smaller than he measures",
						"Short arms will be a problem at both ends",
					],
					[
						"Short arms; plays smaller than his height",
						"Lacks length for his size",
					],
					["Length is a bit short for his height", "Not much length"],
				],
				ev,
				tools: true,
				fix: { fixable: false, note: "structural" },
				gradeKey: "size",
			});
		}
	}
	return out;
};

const motor = (x: X): Cand[] => {
	const out: Cand[] = [];
	const { input, sig } = x;
	const hustle = trait(input, "hustle");
	const motorT = trait(input, "motor");
	const effortRead = [hustle, motorT].filter(
		(t): t is NonNullable<typeof t> => !!t,
	);
	const coasted = sig.combine?.effort !== undefined && sig.combine.effort < 0.9;
	// Scouted ranges only: the whole range has to be on one side
	// Against his class: traits tied to ratings (motor, hustle) read low on every prospect
	const shift = (key: string) => 50 - (sig.traitCenters?.[key] ?? 50);
	const hardLow = Math.max(0, ...effortRead.map((t) => t.low + shift(t.key)));
	const easyHigh =
		effortRead.length > 0
			? Math.min(...effortRead.map((t) => t.high + shift(t.key)))
			: 100;
	const ev: Cand["ev"] = effortRead.map((t) => ({
		src: "traits" as const,
		text: traitText(t, sig.traitCenters?.[t.key]),
		p: 2,
	}));
	if (coasted) {
		ev.unshift({
			src: "combine",
			text: "Coasted through the combine drills",
			p: 3,
		});
	}
	const mh = ramp(hardLow, 56, 76);
	const mc = Math.max(ramp(42 - easyHigh, 0, 15), coasted ? 1.1 : 0);
	if (mh > 0 && !coasted) {
		out.push({
			key: "playsHard",
			groups: ["effort"],
			family: "motor",
			side: "strength",
			m: mh,
			title: "Plays hard every possession",
			texts: [
				[
					"Relentless: never takes a possession off, at either end",
					"Motor runs hot from tip to buzzer",
				],
				["Plays hard every possession", "Motor is a real plus"],
				["Plays hard", "Good effort level"],
			],
			ev,
			gradeKey: "motor",
		});
	} else if (mc > 0) {
		out.push({
			key: "coasts",
			groups: ["effort"],
			family: "motor",
			side: "weakness",
			m: mc,
			title: "Coasts when ahead",
			texts: [
				[
					"Coasts whenever the game allows it; effort is a real worry",
					"Turns it off when the game feels won",
				],
				[
					"Coasts when ahead; effort comes and goes",
					"Takes possessions off when the game is in hand",
				],
				["Can coast at times", "Effort dips in lopsided games"],
			],
			ev,
			fix: {
				fixable: true,
				note: "the right culture can help; no plan targets it",
			},
			gradeKey: "motor",
		});
	}
	const temper = trait(input, "temper");
	const tShift = shift("temper");
	if (temper && temper.low + tShift >= 60) {
		out.push({
			key: "bodyLanguage",
			groups: ["demeanor"],
			family: "motor",
			side: "weakness",
			m: ramp(temper.low + tShift, 60, 80),
			title: "Body-language concerns",
			texts: [
				[
					"Body language turns ugly when things go wrong: barks at officials and teammates",
					"Sulks, argues, and it spreads",
				],
				[
					"Body-language concerns: frustration shows on the floor",
					"Emotions boil over when things go wrong",
				],
				[
					"Body language can slip in tough stretches",
					"Shows frustration at times",
				],
			],
			ev: [
				{
					src: "traits",
					text: traitText(temper, sig.traitCenters?.temper),
					p: 2,
				},
			],
			fix: { fixable: true, note: "maturity, not a plan" },
		});
	} else if (temper && temper.high + tShift <= 35) {
		out.push({
			key: "composed",
			groups: ["demeanor"],
			family: "motor",
			side: "strength",
			m: ramp(40 - temper.high - tShift, 5, 20),
			title: "Even-keeled",
			texts: [
				["Unflappable: never too high, never too low", "Ice in his veins"],
				["Even-keeled; keeps his composure", "Steady demeanor"],
				["Generally composed", "Keeps his cool"],
			],
			ev: [
				{
					src: "traits",
					text: traitText(temper, sig.traitCenters?.temper),
					p: 2,
				},
			],
		});
	}
	const leader = trait(input, "leadership");
	if (leader && leader.low >= 60) {
		out.push({
			key: "leader",
			groups: ["leader"],
			family: "motor",
			side: "strength",
			m: ramp(leader.low, 60, 80),
			title: "Leader",
			texts: [
				["A natural leader: the locker room follows him", "Born captain"],
				["A leader; teammates follow his lead", "Vocal, respected leader"],
				["Shows leadership", "Leads by example"],
			],
			ev: [{ src: "traits", text: traitText(leader), p: 2 }],
		});
	}
	return out;
};

const DAY_ONE: Partial<Record<GradeKey, string>> = {
	cs: "spot-up shooting",
	pd: "perimeter defense",
	id: "rim protection",
	reb: "rebounding",
	pm: "passing",
	fin: "finishing",
};

const role = (x: X): Cand[] => {
	const out: Cand[] = [];
	const { input, sig, group, r, G, grades, last } = x;
	// College post scorer without NBA size
	const seasonsWithLoc = sig.seasons.filter(
		(s) => s.rimA + s.postA + s.midA > 0,
	);
	const locLast = seasonsWithLoc.at(-1);
	if (locLast && locLast.fga >= 120) {
		const share = locLast.postA / locLast.fga;
		const short = (group === "big" ? 81 : 80) - input.heightInches;
		const mp = short > 0 ? ramp(share + 0.04 * short, 0.26, 0.5) : 0;
		if (mp > 0) {
			out.push({
				key: "postNoSize",
				groups: ["post"],
				family: "role",
				side: "weakness",
				m: mp,
				title: "College post scorer without NBA size",
				texts: [
					[
						"His college offense was post-ups he won't get against NBA size",
						"A college post scorer at a height where nobody posts up in the pros",
					],
					[
						"College post scorer without NBA size; that offense won't translate",
						"Scored in the post in college at a size that won't post up in the NBA",
					],
					[
						"Post game may not translate at his size",
						"Leans on post-ups more than his size allows",
					],
				],
				ev: [
					{
						src: "stats",
						text: `${Math.round(100 * share)}% of his shots were post-ups (${pctText(locLast.post, locLast.postA)})`,
						p: 3,
					},
					{
						src: "stats",
						text: `${feetInches(input.heightInches)} in shoes`,
						p: 2,
					},
				],
				stat: true,
				fix: {
					fixable: false,
					note: "a role change: he needs a new way to score",
				},
				gradeKey: "fin",
			});
		}
	}
	// A skill that translates on day one
	if (r) {
		let best: GradeRow | undefined;
		for (const g of grades) {
			if (
				DAY_ONE[g.key] &&
				(!best ||
					g.grade > best.grade ||
					(g.grade === best.grade && g.lo > best.lo))
			) {
				best = g;
			}
		}
		if (best && best.grade >= 10 && best.lo >= 8) {
			out.push({
				key: `dayOne`,
				exclusive: true,
				groups: ["dayOne"],
				family: "role",
				side: "strength",
				m: ramp(best.grade + (best.lo - best.grade) / 2, 9.5, 12),
				title: `Day-one skill: ${DAY_ONE[best.key]}`,
				texts: [
					[
						`His ${DAY_ONE[best.key]} would play in the NBA tomorrow`,
						`NBA-ready ${DAY_ONE[best.key]}, starting opening night`,
					],
					[
						`Translatable skill from day one: ${DAY_ONE[best.key]}`,
						`His ${DAY_ONE[best.key]} gets him on the floor as a rookie`,
					],
					[
						`His ${DAY_ONE[best.key]} should translate early`,
						`A skill that should play right away: ${DAY_ONE[best.key]}`,
					],
				],
				ev: [
					{
						src: "film",
						text: `Our ${GRADE_LABELS[best.key].toLowerCase()} grade: ${gradeLetter(best.grade)}`,
						p: 1,
					},
				],
				gradeKey: best.key,
			});
		}
	}
	// Needs the ball to be effective
	const sc = x.selfCreated;
	if (sc !== undefined && last && last.min >= 250) {
		const usg = x.p40(last, last.fga + 0.44 * last.fta + last.tov);
		const need = (sc - 50) / 8 + (usg - 18) / 4 + (r ? (6 - G("cs")) / 2.5 : 0);
		const mn = ramp(need, 1, 3);
		if (mn > 0) {
			out.push({
				key: "needsBall",
				groups: ["ballDom"],
				family: "role",
				side: "weakness",
				m: mn,
				title: "Needs the ball to be effective",
				texts: [
					[
						"Useless without the ball: no catch-and-shoot game, no cutting, no screening",
						"Everything runs through him or nothing does",
					],
					[
						"Needs the ball to be effective; little value off it",
						"A ball-dominant player who fades off the ball",
					],
					["Better with the ball in his hands", "Off-ball game is behind"],
				],
				ev: [
					{
						src: "stats",
						text: `${r1(usg)} possessions used per 40 minutes`,
						p: 2,
					},
					{
						src: "film",
						text: `About ${sc}% of his shots self-created (our estimate)`,
						p: 1,
					},
				],
				stat: true,
				fix: {
					fixable: true,
					focus: "three",
					note: "a spot-up shot would make him playable off the ball",
				},
				gradeKey: "cs",
			});
		}
	}
	return out;
};

// Plain grade-based items: what fills the list when nothing more specific applies
const generic = (x: X): Cand[] => {
	const out: Cand[] = [];
	const v = new Voice(`skillsGeneric|${x.input.pid}`);
	for (const g of x.grades) {
		if (g.key === "shoot") {
			continue;
		}
		const strength = g.grade >= 7;
		const weakness = g.grade <= 4;
		const line = gradeLine(g.key, g.grade, x.input, (o) =>
			v.child(g.key).pick(o),
		).replace(/\.$/, "");
		const base = {
			key: `g:${g.key}`,
			groups: [`g:${g.key}`],
			family: "skill" as const,
			title: GRADE_LABELS[g.key],
			texts: [[line], [line], [line]] as Cand["texts"],
			ev: [
				{
					src: "film" as const,
					text: `Our ${GRADE_LABELS[g.key].toLowerCase()} grade: ${g.lo === g.hi ? gradeLetter(g.grade) : `${gradeLetter(g.lo)} to ${gradeLetter(g.hi)}`}`,
					p: 0,
				},
			],
			gradeKey: g.key,
			generic: true,
		};
		// A little under the specific items of the same strength
		out.push({
			...base,
			side: strength ? "strength" : "weakness",
			m: strength
				? 0.55 + 0.42 * (g.grade - 7)
				: weakness
					? 0.55 + 0.45 * (4 - g.grade)
					: 0.1,
			tools: g.key === "ath" || g.key === "size",
			fix: !strength ? fixForGrade(g.key) : undefined,
		});
	}
	return out;
};

const GRADE_FOCUS: Partial<Record<GradeKey, FocusKey>> = {
	cs: "three",
	od: "pullup",
	ft: "ft",
	fin: "finish",
	pm: "playmaking",
	bs: "handle",
	reb: "glass",
	pd: "perimD",
	id: "rimD",
	iq: "playmaking",
};
const fixForGrade = (key: GradeKey): NonNullable<Cand["fix"]> =>
	GRADE_FOCUS[key]
		? { fixable: true, focus: GRADE_FOCUS[key] }
		: key === "size" || key === "ath"
			? { fixable: false, note: "physical" }
			: key === "motor"
				? { fixable: true, note: "conditioning and habits; no plan targets it" }
				: { fixable: true };

// ---- rating vs stats contradictions ----

const CONTRA_KEYS: GradeKey[] = [
	"cs",
	"ft",
	"fin",
	"pm",
	"bs",
	"reb",
	"pd",
	"id",
];

const contradictionsOf = (
	input: ScoutInput,
	group: PeerGroup,
	peers: { scores: Record<GradeKey, number[]> } | undefined,
	v: Voice,
): { key: GradeKey; text: string }[] => {
	const r = input.ratings;
	const s = input.preDraft ?? input.production;
	if (!r || !s || !peers || productionWeight(s) < 0.12) {
		return [];
	}
	const tools = categoryScores({ ratings: r, production: undefined, group });
	const prod = productionScores(s, group);
	const out: { key: GradeKey; text: string; gap: number }[] = [];
	for (const key of CONTRA_KEYS) {
		const p = prod[key];
		if (p === undefined) {
			continue;
		}
		const toolGrade = gradeFromPercentile(
			percentileOf(peers.scores[key], tools[key]),
		);
		const stat = statFor(key, s);
		if (!stat) {
			continue;
		}
		if (p >= 62 && toolGrade <= 5) {
			out.push({
				key,
				gap: p - 50 + (6 - toolGrade) * 4,
				text: v
					.child(key)
					.pick([
						`Great numbers, questionable ${CONTRA_NOUN[key]}: ${stat}, but the film grades it ${gradeLetter(toolGrade)}`,
						`The box score loves his ${GRADE_LABELS[key].toLowerCase()} (${stat}); the tape doesn't (${gradeLetter(toolGrade)})`,
					]),
			});
		} else if (p <= 40 && toolGrade >= 8) {
			out.push({
				key,
				gap: 50 - p + (toolGrade - 7) * 4,
				text: v
					.child(key)
					.pick([
						`The tools say yes, the numbers say not yet: ${GRADE_LABELS[key].toLowerCase()} grades ${gradeLetter(toolGrade)} on film, but ${stat}`,
						`Pretty on tape, ugly in the box score: ${stat} despite a ${gradeLetter(toolGrade)} ${GRADE_LABELS[key].toLowerCase()} grade`,
					]),
			});
		}
	}
	return out.sort((a, b) => b.gap - a.gap).slice(0, 2);
};

const CONTRA_NOUN: Record<GradeKey, string> = {
	shoot: "mechanics",
	cs: "mechanics",
	od: "mechanics",
	ft: "mechanics",
	fin: "finishing tools",
	pm: "vision",
	bs: "handle",
	reb: "rebounding tools",
	pd: "feet",
	id: "rim-protection tools",
	ath: "athleticism",
	size: "size",
	iq: "feel",
	motor: "motor",
};

const statFor = (key: GradeKey, s: NonNullable<ScoutInput["preDraft"]>) => {
	const p36 = (x: number) => (s.min > 0 ? (x * 36) / s.min : 0);
	switch (key) {
		case "cs":
			return s.gp * s.tpa >= 25
				? `${s.tpPct.toFixed(1)}% from three`
				: undefined;
		case "ft":
			return s.gp * s.fta >= 20
				? `${s.ftPct.toFixed(1)}% at the line`
				: undefined;
		case "fin":
			return `${s.fgPct.toFixed(1)}% from the field`;
		case "pm":
			return `${r1(p36(s.ast))} assists per 36`;
		case "bs":
			return `${r1(p36(s.tov))} turnovers per 36`;
		case "reb":
			return `${r1(p36(s.trb))} rebounds per 36`;
		case "pd":
			return `${r1(p36(s.stl))} steals per 36`;
		case "id":
			return `${r1(p36(s.blk))} blocks per 36`;
		default:
			return undefined;
	}
};

// ---- swing skill ----

const SWING_KEYS: GradeKey[] = [
	"shoot",
	"pm",
	"pd",
	"fin",
	"id",
	"bs",
	"ath",
	"iq",
	"reb",
];
const SWING_PHRASE: Record<GradeKey, string> = {
	shoot: "the jumper",
	cs: "the spot-up jumper",
	od: "the pull-up jumper",
	ft: "the free throw stroke",
	fin: "finishing against NBA length",
	pm: "his decision-making with the ball",
	bs: "taking care of the ball",
	reb: "holding his own on the glass",
	pd: "staying in front of NBA guards",
	id: "rim protection",
	ath: "his burst against NBA athletes",
	size: "his frame",
	iq: "his processing speed",
	motor: "his motor",
};

const swingEvidence = (key: GradeKey, x: X): SkillEvidence | undefined => {
	const c = x.career;
	if (key === "shoot" && c && c.fta >= 40) {
		return {
			src: "stats",
			text: `${pctText(c.ft, c.fta)} at the line and ${pctText(c.tp, c.tpa)} from three before the draft`,
		};
	}
	if ((key === "pm" || key === "bs") && x.last && x.last.min >= 200) {
		return {
			src: "stats",
			text: `${r1(x.p40(x.last, x.last.ast))} assists and ${r1(x.p40(x.last, x.last.tov))} turnovers per 40 minutes`,
		};
	}
	if (key === "id" && x.last && x.last.min >= 200) {
		return {
			src: "stats",
			text: `${r1(x.p40(x.last, x.last.blk))} blocks per 40 minutes`,
		};
	}
	if (key === "fin" && x.last && x.last.fga >= 100) {
		return {
			src: "stats",
			text:
				x.last.rimA > 0
					? `${pctText(x.last.rim, x.last.rimA)} at the rim`
					: `${pctText(x.last.fg, x.last.fga)} from the field`,
		};
	}
	if (
		(key === "ath" || key === "pd") &&
		x.sig.combine?.agilityPct !== undefined
	) {
		return {
			src: "combine",
			text: `${ordinal(x.sig.combine.agilityPct)} percentile in the lane agility drill`,
		};
	}
	const g = x.grades.find((gr) => gr.key === key);
	return g
		? {
				src: "film",
				text: `Our grade: ${g.lo === g.hi ? gradeLetter(g.grade) : `${gradeLetter(g.lo)} to ${gradeLetter(g.hi)}`}`,
			}
		: undefined;
};

// ---- the report ----

const certaintyOf = (
	u: number,
	hasRatings: boolean,
): SkillReport["certainty"] =>
	!hasRatings || u > 5.5 ? "hedged" : u > 2.75 ? "measured" : "confident";

// Evidence lines shown per item: more the better we know him
export const evidenceDepth = (u: number, deptQuality: number) =>
	Math.max(
		1,
		Math.min(
			3,
			(u <= 2.75 ? 3 : u <= 5.5 ? 2 : 1) +
				(deptQuality >= 0.7 && u <= 5.5 ? 1 : 0),
		),
	);

const unitNoise = (seed: string) =>
	Math.max(-2, Math.min(2, new Rng(seed).normal(0, 1)));

// How a scout weighs an item: his lean, his bias, his own error
const scoutWeight = (
	c: Cand,
	scout: Pick<Scout, "bias" | "quality" | "seed">,
	pid: number,
	u: number,
) => {
	const lean = leanOf(scout.bias);
	let w = 1;
	if (lean === "upside") {
		w *= c.tools ? 1.25 : c.stat ? 0.9 : 1;
		if (c.side === "weakness" && c.fix?.fixable) {
			w *= 0.85;
		}
	} else if (lean === "production") {
		w *= c.stat ? 1.25 : c.tools ? 0.8 : 1;
		if (scout.bias === "harsh" && c.side === "weakness") {
			w *= 1.1;
		}
	}
	if (
		scout.bias === "shooters" &&
		(c.gradeKey === "cs" || c.gradeKey === "shoot" || c.gradeKey === "ft")
	) {
		w *= c.side === "strength" ? 1.2 : 0.9;
	}
	if (
		scout.bias === "size" &&
		(c.family === "physical" || c.gradeKey === "size")
	) {
		w *= c.side === "strength" ? 1.2 : 0.9;
	}
	const noise =
		unitNoise(`skill|${scout.seed}|${pid}|${c.key}`) *
		0.3 *
		(1.35 - scout.quality) *
		(1 + Math.min(8, u) / 6);
	return c.m * w + noise;
};

const pickItems = (
	cands: (Cand & { score: number })[],
	side: Cand["side"],
	max: number,
	min: number,
	used: Set<string>,
	usedKeys: Map<GradeKey, Cand["side"]>,
) => {
	const out: (Cand & { score: number })[] = [];
	const list = cands
		.filter((c) => c.side === side)
		.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
	for (const c of list) {
		if (out.length >= max) {
			break;
		}
		const threshold = out.length < min ? 0.05 : 0.95;
		if (c.score < threshold) {
			continue;
		}
		if (c.groups.some((g) => used.has(g))) {
			continue;
		}
		if (
			c.gradeKey &&
			out.some(
				(o) =>
					!o.generic &&
					o.gradeKey === c.gradeKey &&
					(o.exclusive || c.exclusive),
			)
		) {
			continue;
		}
		// A plain grade item never repeats a grade a specific item already covers; a specific item replaces the plain one
		if (c.generic && c.gradeKey && usedKeys.has(c.gradeKey)) {
			continue;
		}
		const plain = c.generic
			? -1
			: out.findIndex((o) => o.generic && o.gradeKey === c.gradeKey);
		if (plain >= 0) {
			for (const g of out[plain]!.groups) {
				used.delete(g);
			}
			out[plain] = c;
			for (const g of c.groups) {
				used.add(g);
			}
			continue;
		}
		out.push(c);
		for (const g of c.groups) {
			used.add(g);
		}
		if (c.gradeKey && !usedKeys.has(c.gradeKey)) {
			usedKeys.set(c.gradeKey, side);
		}
	}
	return out;
};

// Every item his facts support, before the scout weighs them (strongest first within a family)
const candidatesOf = (
	input: ScoutInput,
	take: Pick<ScoutTake, "grades"> & { scores: CategoryScores },
	selfCreated: number | undefined,
) => {
	const sig = input.skills ?? { seasons: [] };
	const group = peerGroupOf(input.pos);
	const grades = take.grades;
	const gradeMap = new Map(grades.map((g) => [g.key, g.grade]));
	const r = input.ratings;
	const seasons = sig.seasons.filter((s) => s.gp > 0 && s.min > 0);
	const last = seasons.at(-1);
	const x: X = {
		input,
		group,
		sig,
		r,
		sub: (key) => (r?.sub ? r.sub[SUB_INDEX[key]!] : undefined),
		G: (k) => gradeMap.get(k) ?? 6,
		grades,
		scores: take.scores,
		last,
		prevSeason: seasons.at(-2),
		career: sumSeasons(seasons),
		p40: (s, v) => (s.min > 0 ? (v * 40) / s.min : 0),
		film: !!r,
		selfCreated,
	};
	const cands = [
		...situational(x),
		...consistency(x),
		...mechanics(x),
		...feel(x),
		...defense(x),
		...physical(x),
		...motor(x),
		...role(x),
		...generic(x),
	].filter((c) => c.m > 0);
	return { x, cands };
};

// The items his facts support and their strength before any scout's lean or noise (tests, tuning)
export const skillCandidates = (
	input: ScoutInput,
	take: Pick<ScoutTake, "grades"> & { scores: CategoryScores },
	selfCreated?: number,
) =>
	candidatesOf(input, take, selfCreated).cands.map((c) => ({
		key: c.key,
		side: c.side,
		m: c.m,
		family: c.family,
		groups: c.groups,
		evidence: c.ev.map((e) => ({ src: e.src, text: e.text })),
		fixable: c.fix?.fixable,
	}));

export const buildSkillReport = ({
	input,
	take,
	scout,
	second,
	secondTake,
	deptQuality,
	peers,
	selfCreated,
	floorRole,
	ceilingRole,
	idealRole,
	comp,
}: {
	input: ScoutInput;
	take: ScoutTake & { u: number; scores: CategoryScores };
	scout: Pick<Scout, "id" | "name" | "bias" | "quality" | "seed">;
	second?: Pick<Scout, "id" | "name" | "bias" | "quality" | "seed">;
	secondTake?: ScoutTake & { u: number };
	deptQuality: number;
	peers?: { scores: Record<GradeKey, number[]> };
	selfCreated?: number;
	floorRole: string;
	ceilingRole: string;
	idealRole: string;
	// A league comp line, when there is no real one
	comp?: string;
}): SkillReport | undefined => {
	const sig = input.skills;
	if (!sig) {
		return undefined;
	}
	const { x, cands } = candidatesOf(input, take, selfCreated);
	const { group, grades, r } = x;
	const gradeMap = new Map(grades.map((g) => [g.key, g.grade]));
	const v = new Voice(`skills|${input.pid}|${scout.id}|${input.season}`);
	const lean = leanOf(scout.bias);
	const certainty = certaintyOf(take.u, !!r);
	const depth = evidenceDepth(take.u, deptQuality);

	const scored = cands.map((c) => ({
		...c,
		score: scoutWeight(c, scout, input.pid, take.u),
	}));
	const used = new Set<string>();
	const usedKeys = new Map<GradeKey, Cand["side"]>();
	// Weaknesses first among specific items is not needed: strengths and weaknesses never share a dedupe group
	const strengths = pickItems(
		scored,
		"strength",
		MAX_STRENGTHS,
		MIN_STRENGTHS,
		used,
		usedKeys,
	);
	const weaknesses = pickItems(
		scored,
		"weakness",
		MAX_WEAKNESSES,
		MIN_WEAKNESSES,
		used,
		usedKeys,
	);
	// Fill: a report always has its 3 strengths and 2 weaknesses, from the best and worst grades
	const fill = (side: Cand["side"], list: typeof strengths, min: number) => {
		if (list.length >= min) {
			return;
		}
		const extra = generic(x)
			.filter(
				(c) =>
					!list.some((l) => l.key === c.key) &&
					!(
						c.gradeKey &&
						usedKeys.get(c.gradeKey) ===
							(side === "strength" ? "weakness" : "strength")
					),
			)
			.map((c) => ({ ...c, side, m: 0.6, score: 0.6 }))
			.sort((a, b) => {
				const d = x.G(b.gradeKey!) - x.G(a.gradeKey!);
				return (side === "strength" ? d : -d) || (a.key < b.key ? -1 : 1);
			});
		for (const c of extra) {
			if (list.length >= min) {
				break;
			}
			if (c.gradeKey && usedKeys.has(c.gradeKey)) {
				continue;
			}
			list.push(c);
			usedKeys.set(c.gradeKey!, side);
		}
	};
	fill("strength", strengths, MIN_STRENGTHS);
	fill("weakness", weaknesses, MIN_WEAKNESSES);

	const prevGrades = sig.prev?.grades;
	const hedges = [
		"Early read: ",
		"From limited looks, ",
		"Tentatively: ",
		"Still unconfirmed: ",
	];
	const toItem = (c: (typeof scored)[number], i: number): SkillItem => {
		const iv = v.child(c.key);
		const tier = tierOf(c.side, c.score);
		const band =
			tier === "elite" || tier === "major"
				? 0
				: tier === "plus" || tier === "minus"
					? 1
					: 2;
		let text = iv.pick(c.texts[band]);
		// Scout voice
		const before = text;
		if (lean === "upside") {
			if (c.side === "strength" && c.tools) {
				text += iv.pick([
					", and there's more coming",
					". Projectable",
					", and he's only scratching the surface",
				]);
			} else if (c.side === "weakness" && c.fix?.fixable) {
				text += iv.pick([
					". Coachable, though",
					". We think it gets better",
					". Fixable with reps",
				]);
			}
		} else if (lean === "production") {
			if (c.side === "strength" && c.stat) {
				text += iv.pick([
					". The numbers back it up",
					". Proven, not projected",
					". It shows up in the box score",
				]);
			} else if (c.side === "strength" && c.tools && !c.stat) {
				text += iv.pick([
					", if it ever shows up in the numbers",
					". Tools, for now",
				]);
			} else if (c.side === "weakness" && c.stat) {
				text += iv.pick([
					". It's in the numbers",
					". The stats don't lie here",
				]);
			}
		}
		// Uncertainty language
		if (certainty === "hedged") {
			text = `${iv.pick(hedges)}${text.charAt(0).toLowerCase()}${text.slice(1)}`;
			if (tier === "elite") {
				text += " (could be elite; we need more looks)";
			} else if (tier === "major") {
				text += " (if it holds up)";
			}
		} else if (
			certainty === "confident" &&
			i === 0 &&
			text === before &&
			(tier === "elite" ||
				tier === "major" ||
				tier === "plus" ||
				tier === "minus")
		) {
			text += iv.pick([
				". No doubt about this one",
				". We're sure of it",
				". Seen it all season",
			]);
		}
		text += ".";
		// Evidence: numbers first, film only when we can see him (ratings), as deep as our scouting
		const ev = c.ev
			.filter((e) => e.src !== "film" || x.film)
			.toSorted((a, b) => b.p - a.p)
			.slice(0, depth)
			.map(({ src, text: t }) => ({ src, text: t }));
		// Trend vs last season's report
		let trend: SkillItem["trend"];
		const gi = c.gradeKey ? GRADE_KEYS.indexOf(c.gradeKey) : -1;
		if (prevGrades && gi >= 0 && prevGrades[gi] !== undefined) {
			const d = x.G(c.gradeKey!) - prevGrades[gi]!;
			const from = gradeLetter(prevGrades[gi]!);
			const to = gradeLetter(x.G(c.gradeKey!));
			trend =
				d >= 1
					? {
							dir: "up",
							text: `${GRADE_LABELS[c.gradeKey!]} ${from} → ${to} since ${sig.prev!.season}`,
						}
					: d <= -1
						? {
								dir: "down",
								text: `${GRADE_LABELS[c.gradeKey!]} ${from} → ${to} since ${sig.prev!.season}`,
							}
						: {
								dir: "flat",
								text: `Same ${GRADE_LABELS[c.gradeKey!].toLowerCase()} grade as ${sig.prev!.season} (${to})`,
							};
		} else if (c.statTrend) {
			trend = {
				dir: c.statTrend.dir > 0 ? "up" : "down",
				text: c.statTrend.text,
			};
		}
		// Fixable or structural
		let fix: SkillItem["fix"];
		if (c.side === "weakness") {
			const f =
				c.fix ?? (c.gradeKey ? fixForGrade(c.gradeKey) : { fixable: true });
			const focus: FocusDef | undefined = f.focus
				? FOCUSES[f.focus]
				: undefined;
			const ageNote = input.age >= 23 && f.fixable ? "; harder at his age" : "";
			fix = f.fixable
				? {
						fixable: true,
						text: `Fixable${focus ? `: a "${focus.name}" development plan targets it (${focus.what})` : ""}${f.note ? `${focus ? "; " : ": "}${f.note}` : ""}${ageNote}`,
						focus: focus?.name,
					}
				: { fixable: false, text: `Structural${f.note ? `: ${f.note}` : ""}` };
		}
		// The second scout's take on the same item
		let dissent: string | undefined;
		if (second && secondTake) {
			const s2 = scoutWeight(c, second, input.pid, secondTake.u);
			const t1 = tierRank(c.side, c.score);
			const t2 = tierRank(c.side, s2);
			const lean2 = leanOf(second.bias);
			if (
				Math.abs(t1 - t2) >= 2 ||
				(s2 < 0.5 && c.score >= TIER_PLUS) ||
				(lean2 !== lean &&
					Math.abs(t1 - t2) >= 1 &&
					(c.stat || c.tools) &&
					!c.generic)
			) {
				const why =
					lean2 === "upside"
						? " (he leans upside)"
						: lean2 === "production"
							? " (he wants to see it in the numbers)"
							: "";
				dissent =
					s2 < 0.5
						? `${second.name} disagrees: doesn't see it${why}`
						: `${second.name} sees it as ${TIER_LABELS[tierOf(c.side, s2)].toLowerCase()}${why}`;
			}
		}
		return {
			key: c.key,
			family: c.family,
			side: c.side,
			tier,
			tierLabel: TIER_LABELS[tier],
			title: c.title,
			text,
			evidence: ev,
			trend,
			fix,
			dissent,
		};
	};

	// Swing skill: the skill with the most leverage on his outcome (weight for his position x how unsure we are x how close to the line)
	const w = OVERALL_WEIGHTS[group];
	const weakKeys = new Set(weaknesses.map((c) => c.gradeKey));
	const contradictions = contradictionsOf(
		input,
		group,
		peers,
		v.child("contra"),
	);
	const contraKeys = new Set<GradeKey>(
		contradictions.map((c) =>
			c.key === "cs" || c.key === "ft" ? "shoot" : c.key,
		),
	);
	let swingKey: GradeKey = "shoot";
	let best = -Infinity;
	for (const key of SWING_KEYS) {
		const g = grades.find((gr) => gr.key === key);
		if (!g) {
			continue;
		}
		const mid = 1 - Math.abs(g.grade - 6.5) / 7;
		const lev =
			w[key] *
			(1 + 0.35 * (g.hi - g.lo)) *
			Math.max(0.1, mid) *
			(weakKeys.has(key) ||
			(key === "shoot" && (weakKeys.has("cs") || weakKeys.has("ft")))
				? 1.35
				: 1) *
			(contraKeys.has(key) ? 1.3 : 1);
		if (lev > best) {
			best = lev;
			swingKey = key;
		}
	}
	const sv = v.child("swing");
	const phrase = SWING_PHRASE[swingKey];
	const hi = withArticle(ceilingRole);
	const lo = withArticle(floorRole);
	const swingText =
		hi === lo && ceilingRole.startsWith("out of")
			? `Swing skill: ${phrase}; without a big jump there, there's no path to an NBA roster.`
			: hi === lo
				? sv.pick([
						`Swing skill: ${phrase}. It decides whether he beats the ${ceilingRole} projection.`,
						`Everything hinges on ${phrase}; it's what could move him past ${hi}.`,
					])
				: sv.pick([
						`Swing skill: ${phrase}. If it comes around, he's ${hi}; if it doesn't, ${lo}.`,
						`Everything hinges on ${phrase}: that's the difference between ${hi} and ${lo}.`,
						`The swing skill is ${phrase}. Get it to average and he's ${hi}; leave it where it is and he's ${lo}.`,
					]);

	// NBA role and risk
	const rv = v.child("role");
	let risk = 0;
	const reasons: [number, string][] = [];
	const add = (x2: number, why: string) => {
		risk += x2;
		reasons.push([x2, why]);
	};
	add(Math.min(3, take.u / 2.2), "we haven't seen enough of him");
	add(
		0.45 * Math.max(0, take.ceiling - take.floor - 1),
		"a wide range of outcomes",
	);
	if (input.age >= 22) {
		add(0.7, "old for a prospect");
	}
	const lvl = input.preDraft?.level;
	if (lvl === "juco" || lvl === "other") {
		add(1, "untested against real competition");
	}
	if (sig.ageAdjusted !== undefined) {
		if (sig.ageAdjusted < 9) {
			add(0.7, "thin production for his age");
		} else if (sig.ageAdjusted >= 19) {
			add(-0.5, "");
		}
	}
	const swingGrade = gradeMap.get(swingKey) ?? 6;
	if (swingGrade <= 4) {
		add(1, `${phrase} has to come a long way`);
	}
	const majors = weaknesses.filter(
		(c) => tierOf("weakness", c.score) === "major",
	).length;
	if (majors > 0) {
		add(0.8 * majors, "a major concern in his profile");
	}
	const riskLevel: SkillReport["role"]["risk"] =
		risk < 1.8
			? "Low"
			: risk < 3.2
				? "Moderate"
				: risk < 4.8
					? "High"
					: "Very high";
	const why =
		risk < 1.8
			? "a clear, well-scouted profile"
			: reasons.toSorted((a, b) => b[0] - a[0])[0]![1];
	const archetypeBit =
		input.archetype && sig.archetypeWhy && sig.archetypeWhy.length > 0
			? ` His ${input.archetype} label rests on ${sig.archetypeWhy.slice(0, 2).join(" and ").toLowerCase()}.`
			: "";
	// (a bench-role shape reads oddly for a projected starter or star: "stopper off the bench, most likely an All-Star")
	const shape =
		take.expected >= 4
			? idealRole
					.replace(
						/^Bench scorer: instant offense off the bench$/,
						"Instant-offense scorer",
					)
					.replace(/^Sixth-man scorer$/, "Go-to scorer")
					.replace(/ off the bench$/, "")
			: idealRole;
	const roleText = `${rv.pick(["NBA role:", "Projected NBA role:", "How he plays in the NBA:"])} ${shape.charAt(0).toLowerCase()}${shape.slice(1)}${take.expected <= 1 ? ", if he sticks in the league at all" : `, most likely as ${withArticle(roleName(take.expected, group))}`}.${archetypeBit}`;

	// Comparison anchor
	let anchor: string | undefined;
	const av = v.child("anchor");
	const topStrength = strengths[0];
	if (sig.realComp) {
		const c = sig.realComp;
		anchor = `${av.pick(["Real-world anchor:", "NBA anchor:", "Think of"])} ${c.name} (${c.season}, age ${c.age}), a ${c.similarity} match at the same age, who became ${/^[aeiou]/i.test(c.became) ? "an" : "a"} ${c.became}.${topStrength ? ` Shared thread to watch: ${topStrength.title.charAt(0).toLowerCase()}${topStrength.title.slice(1)}.` : ""}`;
	} else if (comp) {
		anchor = `${av.pick(["Closest in our files:", "Our files' anchor:"])} ${comp}.`;
	}

	const certaintyNote =
		certainty === "hedged"
			? r
				? "Hedged: we haven't seen enough of him to be sure of these reads."
				: "Hedged: production and measurements only."
			: certainty === "measured"
				? "Reasonably sure of these reads; a few more looks would firm them up."
				: "Confident: we've seen plenty of him.";

	return {
		strengths: strengths.map(toItem),
		weaknesses: weaknesses.map(toItem),
		swing: {
			key: swingKey,
			skill: capFirst(phrase),
			text: swingText,
			evidence: swingEvidence(swingKey, x),
		},
		role: { text: roleText, risk: riskLevel, why },
		anchor,
		contradictions: contradictions.map((c) => `${c.text}.`),
		certainty,
		certaintyNote,
		voice: `${scout.name} ${LEAN_TEXT[lean]}`,
	};
};

// Strengths: elite 2, plus 1, average 0, not seen -1 (weaknesses alike)
const tierRank = (side: Cand["side"], m: number) =>
	m < 0.5
		? -1
		: ({ elite: 2, plus: 1, average: 0, minus: 1, major: 2 } as const)[
				tierOf(side, m)
			];
