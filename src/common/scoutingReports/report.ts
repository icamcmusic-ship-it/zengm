// The full scouting report: a scout's grades (with ranges when unsure), projection, breakdowns, flags, development plan, team fit and
// bottom line, all from a ScoutInput (what the user's scouts can see). Pure and deterministic.
import {
	categoryScores,
	GRADE_LABELS,
	lowerLabel,
	GROUP_NOUN,
	OVERALL_WEIGHTS,
	peerGroupOf,
	SUB_KEYS,
	type CategoryScores,
} from "./categories.ts";
import {
	formatGradeRange,
	gradeFromPercentile,
	gradeLetter,
	percentileOf,
} from "./grades.ts";
import { gradeLine } from "./lines.ts";
import {
	assignScouts,
	briefOf,
	qualityLabel,
	specialtyMatch,
} from "./scouts.ts";
import {
	andJoin,
	capFirst,
	draftRangeName,
	feetInches,
	money,
	pct,
	roleName,
	tierForOvr,
	Voice,
} from "./text.ts";
import { Rng } from "../ratingsBuilds/rng.ts";
import {
	GRADE_KEYS,
	type FullReport,
	type GradeKey,
	type GradeRow,
	type PeerGroup,
	type ReportFlag,
	type Scout,
	type ScoutBias,
	type ScoutDepartment,
	type ScoutInput,
	type ScoutTake,
} from "./types.ts";

export type PeerTable = {
	label: string;
	scores: Record<GradeKey, number[]>;
	overall: number[];
};

export const overallScore = (scores: CategoryScores, group: PeerGroup) => {
	const w = OVERALL_WEIGHTS[group];
	let sum = 0;
	let wsum = 0;
	for (const key of GRADE_KEYS) {
		sum += w[key] * scores[key];
		wsum += w[key];
	}
	return sum / wsum;
};

// Sorted score lists of a peer group (the draft class's or the league's guards, wings or bigs)
export const buildPeerTable = (
	label: string,
	rows: CategoryScores[],
	group: PeerGroup,
): PeerTable => {
	const scores = {} as Record<GradeKey, number[]>;
	for (const key of GRADE_KEYS) {
		scores[key] = rows.map((r) => r[key]).sort((a, b) => a - b);
	}
	return {
		label,
		scores,
		overall: rows.map((r) => overallScore(r, group)).sort((a, b) => a - b),
	};
};

const BIAS_SHIFT: Record<ScoutBias, Partial<Record<GradeKey, number>>> = {
	none: {},
	athletes: { ath: 5, fin: 2, pd: 1.5 },
	shooters: { cs: 4, od: 3, ft: 2.5 },
	size: { size: 5, id: 2.5, reb: 2 },
	production: {},
	tools: {},
	harsh: {},
	generous: {},
	youth: {},
};

// How much noise a scout adds on top of what the department can see, in rating points
export const scoutSigma = (
	scout: Pick<Scout, "quality">,
	kind: ScoutInput["kind"],
	match: number,
) =>
	(1.2 + 5 * (1 - scout.quality)) *
	(1 - 0.4 * match) *
	(kind === "pro" ? 0.55 : kind === "retired" ? 0.3 : 1);

const isAthletic = (s: CategoryScores) => s.ath >= 60;
const isShooter = (s: CategoryScores) => s.cs >= 58 || s.od >= 58;

const prospectLevel = (input: ScoutInput) => input.preDraft?.level;

const matchInfo = (input: ScoutInput, base: CategoryScores) => ({
	kind: input.kind,
	level: prospectLevel(input),
	athletic: isAthletic(base),
	shooter: isShooter(base),
});

// Generic league aging (public knowledge): what a typical player gains or loses in a year at this age. Never a player's own curve
export const typicalAgingDelta = (age: number) =>
	age <= 20
		? 4
		: age <= 21
			? 3.5
			: age <= 22
				? 2.8
				: age <= 23
					? 2
					: age <= 24
						? 1.4
						: age <= 25
							? 0.8
							: age <= 27
								? 0.2
								: age <= 28
									? -0.3
									: age <= 29
										? -0.8
										: age <= 30
											? -1.3
											: age <= 31
												? -1.8
												: age <= 32
													? -2.3
													: -3;

// Draft Lottery Night & Combine setting: how much of the grade range is left once the combine measured (size) or tested
// (athleticism) him
export const COMBINE_RANGE_MULT = { size: 0.35, ath: 0.5 } as const;

const confidenceOf = (u: number) =>
	u <= 1.5 ? "Very high" : u <= 3 ? "High" : u <= 5 ? "Medium" : "Low";

// A scout's take: grades, overall, projected tiers
export const scoutTake = ({
	input,
	peers,
	scout,
}: {
	input: ScoutInput;
	peers: PeerTable;
	scout: Scout;
}): ScoutTake & { u: number; scores: CategoryScores } => {
	const group = peerGroupOf(input.pos);
	const productionMult =
		scout.bias === "production" ? 1.8 : scout.bias === "tools" ? 0.45 : 1;
	const base = categoryScores({
		ratings: input.ratings,
		production: input.production ?? input.preDraft,
		group,
		traits: input.traits,
		productionMult,
	});
	const match = specialtyMatch(scout, matchInfo(input, base));
	const sigma = scoutSigma(scout, input.kind, match);
	const shifts = BIAS_SHIFT[scout.bias];
	const all =
		scout.bias === "harsh"
			? -2.5
			: scout.bias === "generous"
				? 2.5
				: scout.bias === "youth"
					? input.age <= 20
						? 2.5
						: input.age >= 27
							? -1
							: 0
					: 0;
	const scores = { ...base };
	let noiseSum = 0;
	for (const key of GRADE_KEYS) {
		if (key === "shoot") {
			continue;
		}
		const unit = Math.max(
			-2,
			Math.min(2, new Rng(`${scout.seed}|${input.pid}|${key}`).normal(0, 1)),
		);
		const shift = (shifts[key] ?? 0) + all;
		// The combine measured him: a scout's read of his size/athleticism is mostly the tape measure and the stopwatch
		const tested =
			(key === "size" && input.combineTested?.size) ||
			(key === "ath" && input.combineTested?.ath);
		scores[key] = base[key] + unit * sigma * (tested ? 0.4 : 1) + shift;
		noiseSum += unit * sigma + shift;
	}
	scores.shoot = 0.45 * scores.cs + 0.35 * scores.od + 0.2 * scores.ft;
	const optimism = noiseSum / (GRADE_KEYS.length - 1);

	// Range: what the department can't know (scouting uncertainty) plus this scout's own error, more without ratings
	const noRatings = !input.ratings;
	const u =
		Math.sqrt(input.uncertainty ** 2 + (0.8 * sigma) ** 2) +
		(noRatings ? 6 : 0);
	const half = 1.1 * u;
	const grades = GRADE_KEYS.map((key) => {
		const list = peers.scores[key];
		const grade = gradeFromPercentile(percentileOf(list, scores[key]));
		// Production-only grades are wide; sub-grades too. Combine-measured size and tested athleticism are much narrower
		const combineMult =
			key === "size" && input.combineTested?.size
				? COMBINE_RANGE_MULT.size
				: key === "ath" && input.combineTested?.ath
					? COMBINE_RANGE_MULT.ath
					: 1;
		const h = half * (SUB_KEYS.has(key) ? 1.15 : 1) * combineMult;
		return {
			key,
			grade,
			lo: Math.min(
				grade,
				gradeFromPercentile(percentileOf(list, scores[key] - h)),
			),
			hi: Math.max(
				grade,
				gradeFromPercentile(percentileOf(list, scores[key] + h)),
			),
			score: Math.round(scores[key]),
		};
	});
	const ov = overallScore(scores, group);
	const overall = {
		grade: gradeFromPercentile(percentileOf(peers.overall, ov)),
		lo: gradeFromPercentile(percentileOf(peers.overall, ov - 0.7 * half)),
		hi: gradeFromPercentile(percentileOf(peers.overall, ov + 0.7 * half)),
	};

	const proj = projection(input, optimism, u);
	return {
		scoutId: scout.id,
		grades: grades.map((g) => ({
			...g,
			label: GRADE_LABELS[g.key],
			line: "",
			sub: SUB_KEYS.has(g.key),
		})),
		overall,
		floor: tierForOvr(proj.floor, input.roleScale),
		ceiling: tierForOvr(proj.ceiling, input.roleScale),
		expected: tierForOvr(proj.expected, input.roleScale),
		u,
		scores,
	};
};

// Projected visible ovr: floor, ceiling and expected peak (prospects) or two years out (pros)
export const projection = (input: ScoutInput, optimism: number, u: number) => {
	const s = input.roleScale;
	if (input.kind === "retired") {
		const peak = input.peak?.ovr ?? input.ratings?.ovr ?? s.bench;
		return { floor: peak, ceiling: peak, expected: peak };
	}
	if (input.kind === "prospect") {
		let ovr: number;
		let pot: number;
		if (input.ratings) {
			ovr = input.ratings.ovr;
			pot = input.ratings.pot;
		} else {
			const frac =
				input.projectedPick !== undefined
					? (input.projectedPick - 1) / Math.max(1, input.numPicks)
					: 1.1;
			pot = s.allStar + 2 - frac * (s.allStar - s.bench + 4);
			ovr = pot - 10;
		}
		const young = input.age <= 19 ? 2 : input.age >= 23 ? -1 : 0;
		const expected = pot - 1 + 0.6 * optimism;
		const ceiling = pot + 4 + 1.2 * u + young + 0.6 * optimism;
		const floor = Math.max(
			ovr - 1,
			pot - 8 - 1.2 * u - Math.max(0, young) + 0.6 * optimism,
		);
		return { floor, ceiling, expected };
	}
	let ovr: number;
	if (input.ratings) {
		ovr = input.ratings.ovr;
	} else if (input.production?.per !== undefined) {
		ovr = Math.max(30, Math.min(80, 31.693 + 1.531 * input.production.per));
	} else {
		ovr = s.rotation;
	}
	const delta = typicalAgingDelta(input.age) + typicalAgingDelta(input.age + 1);
	const expected = ovr + delta + 0.4 * optimism;
	const ceiling =
		Math.max(ovr, expected) + 2.5 + (input.age <= 24 ? 2 : 0) + 0.4 * u;
	const floor =
		Math.min(ovr, expected) -
		2.5 -
		(input.injury && input.injury.games > 20 ? 2 : 0) -
		(input.age >= 31 ? 2 : 0) -
		0.4 * u;
	return { floor, ceiling, expected };
};

const INTANGIBLE_KEYS = [
	"workEthic",
	"leadership",
	"clutch",
	"ego",
	"temper",
	"roleAcceptance",
	"consistency",
	"durability",
	"hustle",
	"motor",
	"defensiveVersatility",
	"shotDiscipline",
] as const;

// What a reading says, like a scout would put it
const traitObservation = (key: string, value: number, v: Voice) => {
	const hi = value >= 65;
	const lo = value <= 35;
	const map: Record<string, [string[], string[], string[]]> = {
		workEthic: [
			[
				"First one in the gym, by every account",
				"Teammates rave about his routine",
			],
			["Normal work habits", "Puts in the expected work"],
			["Coaches question his work habits", "Has coasted at times"],
		],
		leadership: [
			[
				"A natural leader; teammates follow him",
				"Vocal and respected in the room",
			],
			["Leads by example, quietly", "Not a vocal leader"],
			["Not a leader yet", "Keeps to himself"],
		],
		clutch: [
			["Wants the ball late and delivers", "Big shots don't rattle him"],
			["Neither rises nor shrinks late", "Ordinary in crunch time"],
			["Shrinks late in close games", "Tight in the clutch"],
		],
		ego: [
			[
				"Big ego; needs the ball and the spotlight",
				"Strong personality that can rub teammates wrong",
			],
			["Healthy confidence", "Confident without being a problem"],
			["Low-maintenance, team-first", "No ego issues"],
		],
		temper: [
			["Short fuse; techs and arguments with officials", "Emotions run hot"],
			["Generally composed", "Keeps his cool most nights"],
			["Even-keeled", "Unflappable"],
		],
		roleAcceptance: [
			["Will take whatever role he's given", "Happy doing the dirty work"],
			["Accepts his role", "No complaints about minutes so far"],
			["Wants a bigger role than he's earned", "Could chafe in a small role"],
		],
		consistency: [
			["Same player every night", "Remarkably consistent"],
			["Normal ups and downs", "Some nights better than others"],
			["Up-and-down game to game", "Hard to know which version shows up"],
		],
		durability: [
			["Built to last; rarely banged up", "Durable frame"],
			["No durability concerns", "Normal wear and tear"],
			["Body breaks down", "Durability is a question"],
		],
		hustle: [
			["Dives on the floor; wins 50-50 balls", "Hustle player"],
			["Normal effort plays", "Competes"],
			["Hustle is lacking", "Doesn't chase loose balls"],
		],
		motor: [
			["Motor never stops", "Plays hard on every possession"],
			["Normal motor", "Effort is fine"],
			["Motor runs hot and cold", "Takes plays off"],
		],
		defensiveVersatility: [
			["Can guard multiple positions", "Switchable defender"],
			["Guards his own position", "Average versatility"],
			["One-position defender", "Struggles to switch"],
		],
		shotDiscipline: [
			["Takes good shots", "Disciplined shot selection"],
			["Normal shot selection", "Mostly good shots"],
			["Forces bad shots", "Shot selection needs work"],
		],
	};
	const entry = map[key];
	if (!entry) {
		return "";
	}
	return v.pick(entry[hi ? 0 : lo ? 2 : 1]);
};

const NEEDS_LINES: Record<GradeKey, string> = {
	shoot: "consistency on his jumper",
	cs: "a quicker, repeatable catch-and-shoot release",
	od: "a pull-up jumper",
	ft: "free throw mechanics",
	fin: "touch and strength at the rim",
	pm: "reading help defense and making the next pass",
	bs: "ball security against pressure",
	reb: "boxing out and pursuing rebounds",
	pd: "lateral quickness and screen navigation",
	id: "positioning and verticality at the rim",
	ath: "strength and conditioning to add burst",
	size: "adding weight to his frame",
	iq: "film work: rotations and reads",
	motor: "conditioning",
};

const gradeOf = (grades: GradeRow[], key: GradeKey) =>
	grades.find((g) => g.key === key)!.grade;

const ROLE_SHAPES: {
	test: (g: (k: GradeKey) => number, group: PeerGroup) => boolean;
	text: string[];
}[] = [
	{
		test: (g, grp) => grp !== "big" && g("pm") >= 9 && g("od") >= 7,
		text: [
			"Primary ball handler running the pick-and-roll",
			"Lead creator with the ball in his hands",
		],
	},
	{
		test: (g) => g("cs") >= 8 && g("pd") >= 7,
		text: [
			"3-and-D wing who spaces the floor and takes the toughest perimeter assignment",
			"Classic 3-and-D role",
		],
	},
	{
		test: (g, grp) => grp === "big" && g("id") >= 8 && g("fin") >= 7,
		text: [
			"Rim-running, rim-protecting center",
			"Vertical spacer and anchor of the defense",
		],
	},
	{
		test: (g, grp) => grp === "big" && g("cs") >= 7,
		text: [
			"Stretch big who pops and pulls rim protectors out of the paint",
			"Pick-and-pop big",
		],
	},
	{
		test: (g) => g("od") >= 8 && g("pm") <= 6,
		text: ["Bench scorer: instant offense off the bench", "Sixth-man scorer"],
	},
	{
		test: (g) => g("cs") >= 8,
		text: [
			"Floor spacer next to a creator",
			"Spot-up shooter in a five-out look",
		],
	},
	{
		test: (g) => g("pd") >= 8 || g("id") >= 8,
		text: [
			"Defensive specialist in the closing lineup",
			"Stopper off the bench",
		],
	},
	{
		test: (g) => g("pm") >= 8,
		text: [
			"Secondary playmaker who keeps the offense humming",
			"Backup point and connector",
		],
	},
	{
		test: (g) => g("reb") >= 9 && g("motor") >= 7,
		text: [
			"Energy big: rebounds, screens and effort",
			"Glass cleaner off the bench",
		],
	},
];

export const idealRoleOf = (grades: GradeRow[], group: PeerGroup, v: Voice) => {
	const g = (k: GradeKey) => gradeOf(grades, k);
	for (const shape of ROLE_SHAPES) {
		if (shape.test(g, group)) {
			return v.pick(shape.text);
		}
	}
	return v.pick([
		`Connector ${GROUP_NOUN[group]} who does a bit of everything`,
		`Rotation ${GROUP_NOUN[group]}: plays within the offense, makes the simple play`,
	]);
};

const shotMixOf = (input: ScoutInput) => {
	const s = input.production;
	if (!s || s.gp < 5 || s.rimA === undefined) {
		return undefined;
	}
	const parts = [
		{ label: "At rim", a: s.rimA, pct: s.rimPct },
		{ label: "Post", a: s.postA ?? 0, pct: s.postPct },
		{ label: "Mid-range", a: s.midA ?? 0, pct: s.midPct },
		{ label: "Three", a: s.tpa, pct: s.tpPct },
	];
	const total = parts.reduce((a, p) => a + p.a, 0);
	if (total <= 0.5) {
		return undefined;
	}
	return parts.map((p) => ({
		label: p.label,
		share: Math.round((100 * p.a) / total),
		pct:
			p.a > 0 && p.pct !== undefined ? Math.round(p.pct * 10) / 10 : undefined,
	}));
};

// Share of his shots he creates himself (a scouting estimate from his handle, pull-up game and assists, not a tracked stat)
const selfCreatedOf = (input: ScoutInput, scores: CategoryScores) => {
	const s = input.production;
	const odLean = scores.od - scores.cs;
	let share = 0.35 + 0.006 * (scores.pm - 50) + 0.007 * odLean;
	if (s && s.min > 0) {
		const usageish = ((s.fga + 0.44 * s.fta + s.tov) * 36) / s.min;
		share += 0.012 * (usageish - 14);
	}
	return Math.round(100 * Math.max(0.08, Math.min(0.85, share)));
};

export const buildReport = ({
	input,
	peers,
	dept,
	numTeams,
	leadId,
}: {
	input: ScoutInput;
	peers: PeerTable;
	dept: ScoutDepartment;
	numTeams: number;
	// Have this scout write the report (the department's usual pick gives the second opinion)
	leadId?: number;
}): FullReport => {
	const group = peerGroupOf(input.pos);
	const noun = GROUP_NOUN[group];
	const base = categoryScores({
		ratings: input.ratings,
		production: input.production ?? input.preDraft,
		group,
		traits: input.traits,
	});
	const assigned = assignScouts(dept, matchInfo(input, base), input.pid);
	const forced = dept.scouts.find((x) => x.id === leadId);
	const lead = forced ?? assigned.lead;
	const second =
		forced && forced.id !== assigned.lead?.id ? assigned.lead : assigned.second;
	if (!lead) {
		throw new Error("Empty scouting department");
	}
	const take = scoutTake({ input, peers, scout: lead });
	const take2 = second ? scoutTake({ input, peers, scout: second }) : undefined;
	const v = new Voice(`report|${input.pid}|${lead.id}|${input.season}`);
	const grades: GradeRow[] = take.grades.map((g) => ({
		...g,
		line: gradeLine(g.key, g.grade, input, (o) => v.child(g.key).pick(o)),
	}));
	const G = (k: GradeKey) => gradeOf(grades, k);
	const L = (k: GradeKey) => {
		const g = grades.find((x) => x.key === k)!;
		return formatGradeRange(g.lo, g.hi);
	};
	const s = input.production;

	// ---- header ----
	const floorText = capFirst(roleName(take.floor, group));
	const ceilingText = capFirst(roleName(take.ceiling, group));
	const confidence = confidenceOf(take.u);
	const looksText =
		input.looks !== undefined
			? input.looks === 0
				? "no in-person looks yet"
				: `${input.looks} in-person ${input.looks === 1 ? "look" : "looks"}`
			: undefined;
	const confidenceNote = [
		looksText,
		`${qualityLabel(dept.quality).toLowerCase()} department (${dept.scouts.length} scouts)`,
		`${lead.name}, ${qualityLabel(lead.quality).toLowerCase()} ${briefOf(lead).title}`,
		input.ratings ? undefined : "ratings hidden: production only",
	]
		.filter(Boolean)
		.join(" · ");
	const comps = input.comps.map((c) => ({
		...c,
		line: `${v.child(`comp${c.pid}`).pick(["Plays like", "Reminds us of", "Shades of", "Think"])} ${c.name} (${c.when}; ${c.outcome})`,
	}));
	const rangeLine = `Floor: ${floorText} · Ceiling: ${ceilingText}`;

	const reference =
		input.kind === "prospect"
			? `Grades are relative to the ${input.draft.year} draft class's ${noun}s.`
			: input.kind === "retired"
				? `Grades are from his peak season${input.peak ? ` (${input.peak.season}, age ${input.peak.age})` : ""}, relative to today's ${noun}s.`
				: `Grades are relative to the league's ${noun}s this season.`;

	// ---- offense ----
	const offense: string[] = [];
	const ov = v.child("offense");
	const shotMix = shotMixOf(input);
	const selfCreated = selfCreatedOf(input, take.scores);
	const scorerType =
		G("od") >= 8 && G("fin") >= 7
			? ov.pick([
					"a three-level scorer",
					"a scorer who can get it from anywhere",
				])
			: G("fin") >= 8 && G("shoot") <= 5
				? ov.pick([
						"an attack-the-rim scorer",
						"a paint scorer who lives at the basket",
					])
				: G("cs") >= 8 && G("od") <= 6
					? ov.pick([
							"a play-finisher who scores off the catch",
							"a spot-up scorer",
						])
					: G("pm") >= 9
						? ov.pick([
								"a setup man first, scorer second",
								"a passer who scores when the defense lets him",
							])
						: ov.pick([
								"a complementary scorer",
								"a secondary option on offense",
							]);
	offense.push(`${capFirst(scorerType)}.`);
	if (shotMix) {
		const top = shotMix.toSorted((a, b) => b.share - a.share)[0]!;
		offense.push(
			`${ov.pick(["Shot diet:", "Where his shots come from:"])} ${shotMix
				.filter((x) => x.share > 0)
				.map(
					(x) =>
						`${x.label.toLowerCase()} ${x.share}%${x.pct !== undefined ? ` (${x.pct}%)` : ""}`,
				)
				.join(
					", ",
				)}. ${top.label === "Three" ? "Most of his work is beyond the arc." : top.label === "At rim" ? "He gets to the basket more than anywhere else." : top.label === "Mid-range" ? "Lives in the mid-range, which is a tough way to be efficient." : "A post-up player in a league that rarely posts up."}`,
		);
	}
	offense.push(
		selfCreated >= 55
			? `Creates about ${selfCreated}% of his own shots (our estimate): he needs the ball to be at his best.`
			: selfCreated <= 25
				? `Only about ${selfCreated}% of his shots are self-created (our estimate): he finishes what others start.`
				: `About ${selfCreated}% self-created, the rest assisted (our estimate): he can do some of both.`,
	);
	if (s && s.min > 0 && s.gp >= 5) {
		const usage =
			s.usg ?? ((s.fga + 0.44 * s.fta + s.tov) * 36 * 2.4) / Math.max(1, s.min);
		offense.push(
			usage >= 26
				? `High usage (${usage.toFixed(1)}%): a featured option${G("bs") <= 4 ? ", and the turnovers come with it" : ""}.`
				: usage <= 15
					? `Low usage (${usage.toFixed(1)}%): fits next to ball-dominant players without needing touches.`
					: `Moderate usage (${usage.toFixed(1)}%): fits as a second or third option.`,
		);
	}

	// ---- defense ----
	const defense: string[] = [];
	const dv = v.child("defense");
	const canGuard: string[] = [];
	if (G("pd") >= 6 && G("ath") >= 5 && group !== "big") {
		canGuard.push("point guards");
	}
	if (G("pd") >= 5 && (group !== "big" || G("ath") >= 8)) {
		canGuard.push("wings");
	}
	if (G("id") >= 6 && (group !== "guard" || G("size") >= 8)) {
		canGuard.push("bigs");
	}
	defense.push(
		canGuard.length > 0
			? `${dv.pick(["Can guard", "Matches up with", "Holds up against"])} ${andJoin(canGuard)}.`
			: dv.pick([
					"Has to be hidden on defense.",
					"No natural matchup at this level yet.",
				]),
	);
	const switchable = G("pd") >= 7 && G("id") >= 5 && G("ath") >= 6;
	defense.push(
		switchable
			? dv.pick([
					"Switchable: you can put him on a screener or a ball handler.",
					"Can switch one through four.",
				])
			: G("pd") >= 7
				? "A perimeter defender, not a switch big."
				: G("id") >= 7
					? "Better in drop coverage than switching onto guards."
					: "A target in switches.",
	);
	if (group === "big" || G("id") >= 8) {
		defense.push(
			G("id") >= 9
				? `Rim protection is real (${L("id")}).`
				: G("id") >= 6
					? `Some rim protection (${L("id")}).`
					: `Not a rim protector (${L("id")}).`,
		);
	}
	defense.push(
		G("iq") >= 8
			? dv.pick([
					"Team defense is sharp: on time with rotations and help.",
					"Smart team defender, a good communicator.",
				])
			: G("iq") <= 4
				? dv.pick([
						"Team defense is behind: late rotations, ball-watching.",
						"Loses track off the ball.",
					])
				: "Team defense is fine.",
	);

	// ---- physical ----
	const physical: string[] = [];
	const pv = v.child("physical");
	physical.push(
		`${feetInches(input.heightInches)}, ${input.weight} lbs${input.combine?.find((c) => c.label === "Wingspan") ? `, ${input.combine.find((c) => c.label === "Wingspan")!.value} wingspan` : ""}.`,
	);
	if (input.ratings) {
		const r = input.ratings;
		physical.push(
			r.stre >= 60
				? pv.pick(["Strong, mature frame.", "Already built like a pro."])
				: r.stre <= 35
					? input.age <= 21
						? pv.pick([
								"Thin, but young enough to fill out.",
								"Wiry frame with room to add muscle.",
							])
						: "Slight frame that may not fill out much more."
					: "Average build.",
		);
	}
	if (input.age <= 20 && input.kind === "prospect") {
		physical.push("Room to grow: still among the youngest in his class.");
	} else if (input.kind === "pro" && input.age >= 30) {
		physical.push(
			"Past the age where athleticism improves; expect it to slip.",
		);
	}
	if (input.combineNotes && input.combineNotes.length > 0) {
		physical.push(`Combine: ${input.combineNotes.join(". ")}.`);
	} else if (input.combine && input.combine.length > 0) {
		const best = input.combine.toSorted((a, b) => b.pct - a.pct)[0]!;
		const worst = input.combine.toSorted((a, b) => a.pct - b.pct)[0]!;
		physical.push(
			`Combine: best in ${best.label.toLowerCase()} (${best.value}, ${best.pct}th percentile), worst in ${worst.label.toLowerCase()} (${worst.value}, ${worst.pct}th).`,
		);
	}

	// ---- intangibles ----
	const iv = v.child("intangibles");
	const intangibles: FullReport["intangibles"] = [];
	for (const key of INTANGIBLE_KEYS) {
		const t = input.traits?.find((x) => x.key === key);
		if (!t) {
			continue;
		}
		if (t.hidden && !t.exact) {
			intangibles.push({
				name: t.name,
				text: iv.pick([
					"Unknown: needs more looks",
					"Unknown: needs more looks. Ask around next season",
					"Unknown: needs more looks; can't tell from the outside",
				]),
				known: false,
			});
		} else {
			const obs = traitObservation(key, t.estimate, iv.child(key));
			intangibles.push({
				name: t.name,
				text: `${obs}${t.exact ? "" : ` (reads ${t.low}-${t.high})`}`,
				known: true,
			});
		}
	}

	// ---- flags ----
	const flags: ReportFlag[] = [];
	const fv = v.child("flags");
	const q = dept.quality;
	const gamesLost = input.injuries.reduce((a, i) => a + i.games, 0);
	const injuryThreshold = q >= 0.6 ? 12 : q >= 0.4 ? 25 : 40;
	if (input.injuries.length > 0 && gamesLost >= injuryThreshold) {
		const parts = new Map<string, number>();
		for (const i of input.injuries) {
			parts.set(i.part, (parts.get(i.part) ?? 0) + 1);
		}
		const repeated = [...parts.entries()]
			.filter(([, n]) => n >= 2)
			.map(([p]) => p.toLowerCase());
		flags.push({
			tone: "red",
			text: `Injury history: ${input.injuries.length} ${input.injuries.length === 1 ? "injury" : "injuries"}, ${gamesLost} games missed (${andJoin([...parts.keys()].map((x) => x.toLowerCase()))})${repeated.length > 0 ? `; repeat ${andJoin(repeated)} problems` : ""}.`,
		});
	}
	if (input.injury && input.injury.games > 0) {
		flags.push({
			tone: "red",
			text: `Currently out: ${input.injury.type} (${input.injury.part.toLowerCase()}), ${input.injury.games} more games.`,
		});
	}
	const shotSample = s ? s.gp * s.tpa : 0;
	if (
		s &&
		s.fta * s.gp >= (q >= 0.55 ? 25 : 50) &&
		shotSample >= (q >= 0.55 ? 30 : 70)
	) {
		if (s.tpPct >= 37 && s.ftPct < 68) {
			flags.push({
				tone: "red",
				text: `Mechanics mismatch: ${pct(s.tpPct)} from three but ${pct(s.ftPct)} at the line. The three-point number may not hold.`,
			});
		} else if (s.tpPct < 31 && s.ftPct >= 80) {
			flags.push({
				tone: "green",
				text: `${pct(s.ftPct)} at the line says the touch is there, even if the threes (${pct(s.tpPct)}) haven't fallen yet.`,
			});
		}
	}
	if (G("bs") <= 3 && (G("pm") >= 6 || (s && s.tov >= 2.5))) {
		flags.push({
			tone: "red",
			text: fv.pick([
				"Turnovers: careless with the ball for how much he has it.",
				"Turnover problem that coaches will have to live with.",
			]),
		});
	}
	const pre = input.preDraft;
	if (input.kind === "prospect") {
		if (pre && pre.gp >= 10) {
			const prodScore =
				pre.min > 0 ? ((pre.pts + pre.trb + pre.ast) * 36) / pre.min : 0;
			if (input.age >= 22 && prodScore < 26) {
				flags.push({
					tone: "red",
					text: `Age vs production: ${input.age} years old and only ${pre.pts.toFixed(1)} points, ${pre.trb.toFixed(1)} rebounds and ${pre.ast.toFixed(1)} assists a game.`,
				});
			} else if (input.age <= 19 && prodScore >= 30) {
				flags.push({
					tone: "green",
					text: `Produced at ${input.age}: ${pre.pts.toFixed(1)} points a game while younger than most of his competition.`,
				});
			}
			if (pre.level === "juco" || pre.level === "other") {
				flags.push({
					tone: "red",
					text: "Competition level: his numbers came against weak opposition.",
				});
			} else if (pre.level === "overseas" && pre.min >= 18) {
				flags.push({
					tone: "green",
					text: `Played real minutes against grown men overseas (${pre.team}).`,
				});
			}
		}
		if (pre && pre.gp >= 10 && input.ratings) {
			const tools = (take.scores.ath + take.scores.size) / 2;
			const prodScore =
				pre.min > 0 ? ((pre.pts + pre.trb + pre.ast) * 36) / pre.min : 0;
			if (tools >= 60 && prodScore < 25) {
				flags.push({
					tone: "red",
					text: fv.pick([
						"Tools ahead of production: the physical gifts haven't shown up in the box score.",
						"All tools, not enough production yet.",
					]),
				});
			} else if (tools <= 42 && prodScore >= 32) {
				flags.push({
					tone: "green",
					text: fv.pick([
						"Production ahead of tools: he finds a way despite average physical gifts.",
						"Produces without elite tools, which tends to translate.",
					]),
				});
			}
		}
	}
	if (G("pd") >= 8 && G("shoot") >= 8) {
		flags.push({
			tone: "green",
			text: fv.pick([
				"Two-way player: shoots it and defends.",
				"Contributes at both ends.",
			]),
		});
	}
	if (G("motor") >= 10) {
		flags.push({
			tone: "green",
			text: "Motor and effort show up every night.",
		});
	}

	// ---- trend (pros) ----
	let trend: "improving" | "declining" | "stable" = "stable";
	let trendLine = "";
	if (input.kind === "pro") {
		const dOvr =
			input.ratings && input.prevRatings
				? input.ratings.ovr - input.prevRatings.ovr
				: 0;
		const prod = (x?: typeof s) =>
			x && x.min > 0 ? ((x.pts + x.trb + 1.5 * x.ast) * 36) / x.min : undefined;
		const a = prod(s);
		const b = prod(input.prevProduction);
		const dProd =
			a !== undefined && b !== undefined && (s?.gp ?? 0) >= 10 ? a - b : 0;
		const score = dOvr + 0.4 * dProd;
		trend = score >= 2.5 ? "improving" : score <= -2.5 ? "declining" : "stable";
		trendLine =
			trend === "improving"
				? `Trending up${dOvr > 0 ? ` (ovr +${dOvr} since last season)` : ""}${dProd >= 2 ? ", with the production to match" : ""}.`
				: trend === "declining"
					? `Trending down${dOvr < 0 ? ` (ovr ${dOvr} since last season)` : ""}${dProd <= -2 ? ", and the numbers are slipping" : ""}.`
					: "Holding steady.";
		if (trend === "declining" && input.age >= 30) {
			flags.push({
				tone: "red",
				text: `Decline phase: ${input.age} and slipping.`,
			});
		}
	}

	// ---- development plan ----
	const development: string[] = [];
	const devv = v.child("development");
	const weights = OVERALL_WEIGHTS[group];
	const needs = grades
		.filter((g) => !g.sub && g.key !== "size")
		.toSorted((a, b) => a.grade - weights[a.key] - (b.grade - weights[b.key]))
		.slice(0, 2);
	if (input.kind !== "retired") {
		const young = input.age <= 23;
		development.push(
			young
				? devv.pick([
						`Still growing: players his age usually add ${Math.round(typicalAgingDelta(input.age) + typicalAgingDelta(input.age + 1))} or so ovr over the next two years.`,
						"Young enough that the next two years should bring real growth.",
					])
				: input.age <= 28
					? "In his prime years; growth from here comes from skill work, not physical development."
					: "On the back nine; the plan is to preserve what he has.",
			(needs[0]?.grade ?? 0) >= 9
				? `Polish: ${andJoin(needs.map((g) => NEEDS_LINES[g.key]))}.`
				: `Needs: ${andJoin(needs.map((g) => NEEDS_LINES[g.key]))}.`,
		);
		const we = input.traits?.find((t) => t.key === "workEthic");
		if (we) {
			development.push(
				we.hidden && !we.exact
					? "Work ethic: unknown. Needs more looks before we bet on the development curve."
					: `Work ethic: ${we.estimate >= 65 ? "a strength, which makes us more confident he gets there" : we.estimate <= 35 ? "a concern; growth may be slower than his age suggests" : "normal"}.`,
			);
		}
		const d = input.development;
		if (d?.philosophy !== undefined && young) {
			development.push(
				d.philosophy >= 0.3
					? `${d.coachName ?? "Our head coach"} is a development coach, which suits a young player like him.`
					: d.philosophy <= -0.3
						? `${d.coachName ?? "Our head coach"} wins now and plays veterans; he may not get the reps to develop here.`
						: `${d.coachName ?? "Our head coach"} balances development and winning.`,
			);
		}
		if (d?.staffDev !== undefined) {
			development.push(
				d.staffDev >= 65
					? "Our player development staff is among the better ones."
					: d.staffDev <= 40
						? "Our player development staff is thin; he may grow slower here."
						: "Our player development staff is average.",
			);
		}
		development.push(
			devv.pick([
				"Aging: we project with the league's typical curve; nobody can tell yet how his body will age.",
				"How he ages is unknowable from here; the timeline assumes a typical career arc.",
			]),
		);
	}

	// ---- team fit ----
	const fit: string[] = [];
	const tf = input.fit;
	if (tf && input.kind !== "retired") {
		const strengths = grades
			.filter((g) => !g.sub && g.grade >= 8)
			.map((g) => g.key);
		const fills = strengths.filter((k) => tf.rosterNeeds.includes(k));
		const doubles = strengths.filter((k) => tf.rosterStrengths.includes(k));
		if (fills.length > 0) {
			fit.push(
				`Fills a need for the ${tf.teamName}: ${andJoin(fills.map((k) => lowerLabel(k)))}.`,
			);
		}
		if (doubles.length > 0 && fills.length === 0) {
			fit.push(
				`Doubles up on what the ${tf.teamName} already do well (${andJoin(doubles.map((k) => lowerLabel(k)))}).`,
			);
		}
		const expectedOvr = input.ratings?.ovr ?? 0;
		const ahead = tf.sameGroup.filter((x) => x.ovr >= expectedOvr + 3);
		if (!input.onUserTeam && ahead.length >= 3) {
			fit.push(
				`Redundancy warning: ${andJoin(ahead.slice(0, 3).map((x) => x.name))} already play his position and are better right now.`,
			);
		} else if (!input.onUserTeam && tf.sameGroup.length <= 2) {
			fit.push(`Thin at ${noun} on our roster, so minutes would be there.`);
		}
		if (tf.systemFit) {
			const f = tf.systemFit;
			fit.push(
				`${f.score >= 60 ? "Good fit" : f.score <= 40 ? "Poor fit" : "Average fit"} (${f.score}) for ${f.coach}'s ${f.offense} offense and ${f.defense} defense.`,
			);
		}
	}

	// ---- pro section ----
	let pro: FullReport["pro"];
	const rv = v.child("pro");
	if (input.kind === "pro") {
		const nowTier = tierForOvr(
			input.ratings?.ovr ?? input.roleScale.rotation,
			input.roleScale,
		);
		const role = capFirst(roleName(nowTier, group));
		const idealRole =
			nowTier >= 6
				? rv.pick([
						"Primary option: build the offense around him",
						"Franchise centerpiece who gets the ball in big moments",
						"First option on a contender",
					])
				: idealRoleOf(grades, group, rv);
		let contract: string | undefined;
		if (input.contract && input.marketValue !== undefined) {
			const diff = input.marketValue - input.contract.amount;
			const rel = diff / Math.max(500, input.contract.amount);
			contract =
				rel >= 0.25
					? `A bargain: paid ${money(input.contract.amount)} a year through ${input.contract.exp}, worth about ${money(input.marketValue)}.`
					: rel <= -0.25
						? `Overpaid: ${money(input.contract.amount)} a year through ${input.contract.exp} for a player worth about ${money(input.marketValue)}.`
						: `Fairly paid at ${money(input.contract.amount)} a year through ${input.contract.exp} (worth about ${money(input.marketValue)}).`;
		} else if (input.marketValue !== undefined) {
			contract = `Free agent; would be worth about ${money(input.marketValue)} a year.`;
		}
		const tops = grades
			.filter((g) => !g.sub)
			.toSorted((a, b) => b.grade - a.grade)
			.slice(0, 2)
			.map((g) => g.key);
		const USE: Partial<Record<GradeKey, string>> = {
			shoot: "keep him on the floor for spacing",
			cs: "spot him up in the corners",
			od: "run him off screens into pull-ups",
			ft: "get him the ball late in close games",
			fin: "put him in actions that end at the rim",
			pm: "let him run pick-and-roll",
			bs: "trust him with the ball late",
			reb: "let him crash the glass",
			pd: "put him on the other team's best perimeter scorer",
			id: "anchor the defense with him at the rim",
			ath: "push the pace with him in transition",
			size: "use his size in mismatches",
			iq: "trust him as a connector in any lineup",
			motor: "use his energy in short, hard stints",
		};
		const usage = `How to use him: ${andJoin(tops.map((k) => USE[k] ?? "keep it simple"))}.`;
		pro = { role, trend, trendLine, idealRole, contract, usage };
	}

	// ---- retired ----
	let retro: string | undefined;
	if (input.kind === "retired") {
		const a = input.awards;
		const honors = [
			a.mvp > 0 ? `${a.mvp}x MVP` : "",
			a.allStar > 0 ? `${a.allStar}x All-Star` : "",
			a.allLeague > 0 ? `${a.allLeague}x All-League` : "",
			a.dpoy > 0 ? `${a.dpoy}x DPOY` : "",
			a.champ > 0 ? `${a.champ}x champion` : "",
		].filter(Boolean);
		retro = `Career in review: peaked as ${roleName(take.expected, group).replace(/^(an?|the) /, "")}${input.peak ? ` (ovr ${input.peak.ovr} at ${input.peak.age})` : ""}${honors.length > 0 ? `; ${honors.join(", ")}` : ""}.`;
	}

	// ---- bottom line ----
	const bv = v.child("bottom");
	const strengthsText = grades
		.filter((g) => !g.sub)
		.toSorted((a, b) => b.grade - a.grade)
		.slice(0, 2)
		.map((g) => `${lowerLabel(g.key)} (${gradeLetter(g.grade)})`);
	const weakText = needs.map(
		(g) => `${lowerLabel(g.key)} (${gradeLetter(g.grade)})`,
	);
	let bottomLine: string;
	if (input.kind === "prospect") {
		const range = draftRangeName(take.expected, numTeams);
		const opener = bv.pick([
			`${input.name} is ${take.expected >= 5 ? "a real talent" : take.expected >= 3 ? "a useful prospect" : "a project"} built on ${andJoin(strengthsText)}.`,
			`The case for ${input.name}: ${andJoin(strengthsText)}.`,
			`What sells us on ${input.name} is ${andJoin(strengthsText)}.`,
		]);
		const worry =
			(needs[0]?.grade ?? 0) >= 9
				? bv.pick([
						`There is no real weakness; if we have to nitpick, it's ${weakText[0]}.`,
						`Hard to find a hole: the "weakest" part of his game is ${weakText[0]}.`,
					])
				: bv.pick([
						`The worry is ${andJoin(weakText)}.`,
						`What has to improve: ${andJoin(weakText)}.`,
						`He'll go as far as his ${GRADE_LABELS[needs[0]?.key ?? "shoot"].toLowerCase()} lets him.`,
					]);
		const conf =
			confidence === "Low"
				? " We haven't seen enough of him to be sure; more looks would tighten this."
				: "";
		bottomLine = `${opener} ${worry} ${rangeLine}. Recommendation: worth ${range}${input.projectedPick !== undefined ? ` (our board has him at No. ${input.projectedPick})` : ""}.${conf}`;
	} else if (input.kind === "pro") {
		const opener = bv.pick([
			`${input.name} is a ${roleName(tierForOvr(input.ratings?.ovr ?? input.roleScale.rotation, input.roleScale), group)} whose best tools are ${andJoin(strengthsText)}.`,
			`Right now ${input.name} gives you ${andJoin(strengthsText)}.`,
		]);
		const plan =
			trend === "improving"
				? "He's getting better; buy now if the price is right."
				: trend === "declining"
					? "The decline has started; avoid long commitments."
					: "What you see is what you'll get for the next couple of years.";
		const money2 =
			input.marketValue !== undefined
				? ` Worth up to ${money(input.marketValue)} a year${input.age >= 30 ? " on a short deal" : input.age <= 25 ? ", and longer is fine" : ""}.`
				: "";
		bottomLine = `${opener} ${plan} Best used as: ${pro!.idealRole.replace(/^./, (c) => c.toLowerCase())}.${money2}`;
	} else {
		bottomLine = `${retro} ${bv.pick(["The tape says he was", "Our files have him as"])} ${andJoin(strengthsText)} at his best.`;
	}

	return {
		pid: input.pid,
		name: input.name,
		kind: input.kind,
		byline: {
			lead: briefOf(lead),
			second: second ? briefOf(second) : undefined,
		},
		header: {
			archetype: input.archetype,
			builds2k: input.builds2k,
			comps,
			floorText,
			ceilingText,
			rangeLine,
			confidence,
			confidenceNote,
		},
		reference,
		grades,
		overall: take.overall,
		offense,
		shotMix,
		selfCreated,
		defense,
		physical,
		combine: input.combine,
		intangibles,
		flags,
		development,
		fit,
		pro,
		retro,
		bottomLine,
		take: stripTake(take),
		secondTake: take2 ? stripTake(take2) : undefined,
	};
};

const stripTake = (t: ReturnType<typeof scoutTake>): ScoutTake => ({
	scoutId: t.scoutId,
	grades: t.grades,
	overall: t.overall,
	floor: t.floor,
	ceiling: t.ceiling,
	expected: t.expected,
});
