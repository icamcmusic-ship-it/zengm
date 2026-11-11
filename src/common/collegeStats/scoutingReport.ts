import { Rng } from "./rng.ts";

/**
 * A short written scouting report for a player's College/Overseas page: strengths, weaknesses and a projection.
 *
 * It is written only from what it is given, and it must only be given what the user can already see: ratings as his scouts see them (with scouting fuzz applied, or none at all when ratings are hidden), the archetype label shown elsewhere, his measurements and his pre-draft production. Never true ratings, player traits or anything else hidden. The same input always gives the same report.
 */

export type ReportRatings = {
	hgt: number;
	stre: number;
	spd: number;
	jmp: number;
	endu: number;
	ins: number;
	dnk: number;
	ft: number;
	fg: number;
	tp: number;
	oiq: number;
	diq: number;
	drb: number;
	pss: number;
	reb: number;
	ovr: number;
	pot: number;
};

// His last pre-draft season, per game
export type ReportProduction = {
	team: string;
	classYear?: string;
	gp: number;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tov: number;
	fgPct: number;
	tpPct: number;
	tpa: number;
	ftPct: number;
	fta: number;
};

export type ScoutingReportInput = {
	pid: number;
	pos: string;
	// At the draft
	age: number;
	heightInches: number;
	// As the user's scouts see them. undefined when ratings are hidden (then the report is written from production alone)
	ratings: ReportRatings | undefined;
	archetype?: string;
	production?: ReportProduction;
	// Where he went, or where the user's board has him now. undefined: not in the picks
	pick: number | undefined;
	numPicks: number;
	drafted: boolean;
	// How many times the user's staff scouted him (scouting system), undefined when there is no scouting system
	looks?: number;
	story?: string;
};

export type ScoutingReport = {
	summary: string;
	strengths: string[];
	weaknesses: string[];
	projection: string;
	// What the report is based on
	basis: string;
};

type Group = "guard" | "wing" | "big";

const groupOf = (pos: string): Group =>
	pos.includes("C") || pos === "PF"
		? "big"
		: pos === "PG" || pos === "SG" || pos === "G"
			? "guard"
			: "wing";

// What a typical draft prospect of each kind looks like
const TYPICAL: Record<Group, Omit<ReportRatings, "ovr" | "pot">> = {
	guard: {
		hgt: 30,
		stre: 35,
		spd: 58,
		jmp: 50,
		endu: 40,
		ins: 30,
		dnk: 42,
		ft: 48,
		fg: 45,
		tp: 45,
		oiq: 40,
		diq: 38,
		drb: 55,
		pss: 50,
		reb: 30,
	},
	wing: {
		hgt: 46,
		stre: 43,
		spd: 50,
		jmp: 50,
		endu: 40,
		ins: 38,
		dnk: 48,
		ft: 45,
		fg: 44,
		tp: 42,
		oiq: 40,
		diq: 40,
		drb: 42,
		pss: 38,
		reb: 40,
	},
	big: {
		hgt: 65,
		stre: 52,
		spd: 38,
		jmp: 45,
		endu: 38,
		ins: 50,
		dnk: 52,
		ft: 40,
		fg: 38,
		tp: 25,
		oiq: 40,
		diq: 44,
		drb: 25,
		pss: 28,
		reb: 55,
	},
};

type Trait = {
	key: string;
	// How far above (or below) a typical prospect of his kind, in rating points
	value: (r: ReportRatings, typical: (typeof TYPICAL)[Group]) => number;
	// How much it matters for each kind of player
	weight: Record<Group, number>;
	good: string[];
	bad: string[];
};

const diff =
	(...keys: (keyof (typeof TYPICAL)[Group])[]) =>
	(r: ReportRatings, typical: (typeof TYPICAL)[Group]) => {
		let sum = 0;
		for (const key of keys) {
			sum += r[key] - typical[key];
		}
		return sum / keys.length;
	};

const TRAITS: Trait[] = [
	{
		key: "size",
		value: diff("hgt"),
		weight: { guard: 0.9, wing: 1, big: 1.1 },
		good: [
			"Excellent size for his position",
			"Has the size and length teams want at his position",
		],
		bad: [
			"Undersized for his position",
			"Gives up size to most players he will be matched with",
		],
	},
	{
		key: "athleticism",
		value: diff("spd", "jmp"),
		weight: { guard: 1.1, wing: 1.1, big: 0.9 },
		good: [
			"Explosive athlete who plays above the rim and gets out in transition",
			"Top-tier athlete: quick first step and real lift",
		],
		bad: [
			"Below-average athlete who will struggle to create separation",
			"Lacks burst and lift against pro athletes",
		],
	},
	{
		key: "strength",
		value: diff("stre"),
		weight: { guard: 0.6, wing: 0.8, big: 1.1 },
		good: [
			"Strong, physically mature frame that holds up through contact",
			"Already has a pro body",
		],
		bad: [
			"Needs to add strength; gets moved off his spots",
			"Thin frame that has to fill out",
		],
	},
	{
		key: "motor",
		value: diff("endu"),
		weight: { guard: 0.5, wing: 0.5, big: 0.5 },
		good: [
			"Well conditioned; can carry heavy minutes without fading",
			"Motor runs for the whole game",
		],
		bad: [
			"Conditioning is a question; production dips in long stretches",
			"Tires late in games",
		],
	},
	{
		key: "finishing",
		value: diff("dnk", "ins"),
		weight: { guard: 0.8, wing: 1, big: 1.2 },
		good: [
			"Finishes through and over defenders at the rim",
			"Efficient scorer around the basket",
		],
		bad: [
			"Has trouble finishing in traffic",
			"Limited scorer around the basket",
		],
	},
	{
		key: "three",
		value: diff("tp"),
		weight: { guard: 1.2, wing: 1.2, big: 0.7 },
		good: [
			"Dangerous three-point shooter who has to be guarded at the line",
			"Reliable range out to the three-point line",
		],
		bad: [
			"Three-point shot is not a threat yet",
			"Defenses will leave him open beyond the arc",
		],
	},
	{
		key: "midrange",
		value: diff("fg", "ft"),
		weight: { guard: 0.8, wing: 0.8, big: 0.6 },
		good: [
			"Soft touch: makes pull-ups and free throws",
			"Polished mid-range game and a dependable free throw shooter",
		],
		bad: [
			"Touch is inconsistent, at the line and off the dribble",
			"Shaky free throw shooter with little in-between game",
		],
	},
	{
		key: "feel",
		value: diff("oiq"),
		weight: { guard: 1, wing: 1, big: 0.9 },
		good: [
			"Advanced feel on offense; makes the right read",
			"High basketball IQ: plays within the offense and rarely forces it",
		],
		bad: [
			"Raw feel for the game; decisions come a beat late",
			"Still learning how to play within an offense",
		],
	},
	{
		key: "defense",
		value: diff("diq"),
		weight: { guard: 1, wing: 1.1, big: 1.1 },
		good: [
			"Disciplined, instinctive defender",
			"Reads the game well on defense and is rarely out of position",
		],
		bad: [
			"Loses his man and his assignments on defense",
			"Defensive awareness lags well behind his offense",
		],
	},
	{
		key: "handle",
		value: diff("drb"),
		weight: { guard: 1.2, wing: 0.9, big: 0.3 },
		good: [
			"Tight handle; gets where he wants with the ball",
			"Can create his own shot off the dribble",
		],
		bad: [
			"Loose handle that pressure can take away",
			"Not a threat to create off the dribble",
		],
	},
	{
		key: "passing",
		value: diff("pss"),
		weight: { guard: 1.2, wing: 0.8, big: 0.5 },
		good: [
			"Sees the floor and delivers on time",
			"Willing, accurate passer who makes teammates better",
		],
		bad: ["Limited vision as a passer", "Does not create much for teammates"],
	},
	{
		key: "rebounding",
		value: diff("reb"),
		weight: { guard: 0.4, wing: 0.8, big: 1.2 },
		good: ["Relentless on the glass", "Rebounds well outside his area"],
		bad: [
			"Poor rebounder for his position",
			"Does not finish possessions on the glass",
		],
	},
];

const pct = (x: number) => `${x.toFixed(1)}%`;

// Something from his production that backs up a strength or weakness. Only when the number agrees with the line: a scout's grade and a box score can disagree, and then the grade stands alone
const statNote = (
	key: string,
	good: boolean,
	s: ReportProduction | undefined,
): string | undefined => {
	if (!s || s.gp < 8 || s.min < 15) {
		return undefined;
	}
	const per40 = (x: number) => (x * 40) / s.min;
	if (key === "three" && s.tpa >= 1 && (good ? s.tpPct >= 35 : s.tpPct < 33)) {
		return `${pct(s.tpPct)} from three on ${s.tpa.toFixed(1)} attempts a game`;
	}
	if (
		key === "midrange" &&
		s.fta >= 1 &&
		(good ? s.ftPct >= 77 : s.ftPct < 70)
	) {
		return `${pct(s.ftPct)} at the line`;
	}
	if (key === "passing" && (good ? per40(s.ast) >= 5 : per40(s.ast) < 3)) {
		return `${s.ast.toFixed(1)} assists a game`;
	}
	if (key === "rebounding" && (good ? per40(s.trb) >= 10 : per40(s.trb) < 8)) {
		return `${s.trb.toFixed(1)} rebounds a game`;
	}
	if (key === "finishing" && good && s.fgPct >= 50) {
		return `${pct(s.fgPct)} from the field`;
	}
	if (key === "handle" && !good && per40(s.tov) >= 3.5) {
		return `${s.tov.toFixed(1)} turnovers a game`;
	}
	if (key === "defense" && good && per40(s.stl + s.blk) >= 3) {
		return `${s.stl.toFixed(1)} steals and ${s.blk.toFixed(1)} blocks a game`;
	}
};

// Strengths and weaknesses that show in the box score, for when ratings are hidden
const productionTraits = (s: ReportProduction, group: Group) => {
	const per40 = (x: number) => (s.min > 0 ? (x * 40) / s.min : 0);
	const strengths: string[] = [];
	const weaknesses: string[] = [];
	if (per40(s.pts) >= 22) {
		strengths.push(`High-volume scorer (${s.pts.toFixed(1)} points a game)`);
	} else if (per40(s.pts) < 11 && s.min >= 15) {
		weaknesses.push(
			`Limited scoring punch (${s.pts.toFixed(1)} points a game)`,
		);
	}
	if (s.tpa >= 3 && s.tpPct >= 37.5) {
		strengths.push(
			`Proven shooter: ${pct(s.tpPct)} from three on ${s.tpa.toFixed(1)} attempts a game`,
		);
	} else if (group !== "big" && (s.tpa < 1 || s.tpPct < 30)) {
		weaknesses.push(
			s.tpa < 1 ? "Barely shot the three" : `Shot ${pct(s.tpPct)} from three`,
		);
	}
	if (per40(s.trb) >= (group === "big" ? 12 : group === "wing" ? 9 : 7)) {
		strengths.push(`Productive rebounder (${s.trb.toFixed(1)} a game)`);
	} else if (group === "big" && per40(s.trb) < 8.5) {
		weaknesses.push(
			`Light on the glass for a big (${s.trb.toFixed(1)} rebounds a game)`,
		);
	}
	if (per40(s.ast) >= (group === "guard" ? 6.5 : 4.5)) {
		strengths.push(`Creates for others (${s.ast.toFixed(1)} assists a game)`);
	}
	if (per40(s.stl + s.blk) >= 3.6) {
		strengths.push(
			`Makes plays on defense (${s.stl.toFixed(1)} steals, ${s.blk.toFixed(1)} blocks a game)`,
		);
	}
	if (s.fta >= 2 && s.ftPct < 62) {
		weaknesses.push(`Poor free throw shooter (${pct(s.ftPct)})`);
	}
	if (per40(s.tov) >= 4.2) {
		weaknesses.push(`Turnover prone (${s.tov.toFixed(1)} a game)`);
	}
	if (s.min < 16 && s.gp >= 10) {
		weaknesses.push(
			`Small sample: only ${s.min.toFixed(1)} minutes a game last season`,
		);
	}
	return { strengths, weaknesses };
};

const feetInches = (inches: number) =>
	`${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;

const GROUP_NAME: Record<Group, string> = {
	guard: "guard",
	wing: "wing",
	big: "big man",
};

export const getScoutingReport = (
	input: ScoutingReportInput,
): ScoutingReport => {
	const rng = new Rng(`scouting-report|${input.pid}`);
	const group = groupOf(input.pos);
	const r = input.ratings;
	const s = input.production;
	const variant = (options: string[]) =>
		options[Math.floor(rng.random() * options.length)]!;

	let strengths: string[] = [];
	let weaknesses: string[] = [];
	if (r) {
		const typical = TYPICAL[group];
		const scored = TRAITS.map((trait) => ({
			trait,
			// Always drawn, so the wording of one line does not depend on which others made the report
			text: [variant(trait.good), variant(trait.bad)] as const,
			score: (trait.value(r, typical) / 10) * trait.weight[group],
		}));
		const line = (x: (typeof scored)[number], good: boolean) => {
			const note = statNote(x.trait.key, good, s);
			return `${x.text[good ? 0 : 1]}${note ? ` (${note})` : ""}.`;
		};
		const best = scored
			.filter((x) => x.score >= 0.45)
			.sort((a, b) => b.score - a.score);
		const worst = scored
			.filter((x) => x.score <= -0.45)
			.sort((a, b) => a.score - b.score);
		strengths = best.slice(0, 3).map((x) => line(x, true));
		weaknesses = worst.slice(0, 3).map((x) => line(x, false));
		// Everybody gets at least one of each: the best and worst part of his own game
		const sorted = [...scored].sort((a, b) => b.score - a.score);
		if (strengths.length === 0) {
			strengths = [
				`No standout skill yet; the best part of his game: ${line(sorted[0]!, true).replace(/^./, (c) => c.toLowerCase())}`,
			];
		}
		if (weaknesses.length === 0) {
			weaknesses = [
				`No glaring hole; the area to work on: ${line(sorted.at(-1)!, false).replace(/^./, (c) => c.toLowerCase())}`,
			];
		}
	} else if (s && s.gp > 0) {
		const fromStats = productionTraits(s, group);
		strengths = fromStats.strengths.slice(0, 3).map((x) => `${x}.`);
		weaknesses = fromStats.weaknesses.slice(0, 3).map((x) => `${x}.`);
		if (strengths.length === 0) {
			strengths = ["Nothing in his production stands out."];
		}
		if (weaknesses.length === 0) {
			weaknesses = ["No obvious hole in his production."];
		}
	}

	// Summary
	const kind = input.archetype ?? GROUP_NAME[group];
	const article = /^[aeiou]/i.test(kind) ? "An" : "A";
	let summary = `${article} ${feetInches(input.heightInches)} ${kind}${
		input.archetype ? ` (${input.pos})` : ""
	}, ${input.age} years old at the draft.`;
	if (s && s.gp > 0) {
		summary += ` ${s.classYear ? `As a ${classWord(s.classYear)} at` : "Last season with"} ${s.team} he averaged ${s.pts.toFixed(1)} points, ${s.trb.toFixed(1)} rebounds and ${s.ast.toFixed(1)} assists in ${s.min.toFixed(1)} minutes over ${s.gp} games.`;
	}

	// Projection
	const range =
		input.pick === undefined
			? "outside the draft"
			: input.pick <= 5
				? "at the very top of the draft"
				: input.pick <= Math.max(6, Math.round(input.numPicks * 0.23))
					? "in the lottery"
					: input.pick <= input.numPicks / 2
						? "in the first round"
						: "in the second round";
	let projection: string;
	if (r) {
		const ceiling =
			r.pot >= 72
				? "franchise-player upside"
				: r.pot >= 64
					? "the upside of an All-Star"
					: r.pot >= 57
						? "the upside of a quality starter"
						: r.pot >= 50
							? "the upside of a rotation player"
							: r.pot >= 44
								? "a ceiling as an end-of-bench player"
								: "a long shot to stick in the league";
		const ready =
			r.ovr >= 55
				? "ready to start from day one"
				: r.ovr >= 48
					? "ready for rotation minutes as a rookie"
					: r.ovr >= 42
						? "a year or two from helping a team"
						: "a long-term project";
		const gap = r.pot - r.ovr;
		const growth =
			input.age >= 22 && gap <= 6
				? " Close to a finished product at his age."
				: input.age <= 19 && gap >= 12
					? " Young, with a lot of room to grow."
					: "";
		projection = `${capitalize(ready)}, with ${ceiling}.${growth}`;
	} else {
		projection = "";
	}
	projection += `${projection ? " " : ""}${
		input.drafted
			? input.pick === undefined
				? "Went undrafted."
				: `Went ${range}.`
			: input.pick === undefined
				? "Our board has him going undrafted."
				: `Our board has him ${range}.`
	}`;

	const storyNote = input.story ? STORY_NOTES[input.story] : undefined;
	if (storyNote) {
		projection += ` ${storyNote}`;
	}

	const basis = [
		r ? "Our scouts' grades" : "Ratings hidden: production only",
		input.looks !== undefined
			? input.looks === 0
				? "not scouted in person, so less certain"
				: `${input.looks} scouting ${input.looks === 1 ? "look" : "looks"}`
			: undefined,
		s && s.gp > 0 ? "pre-draft production" : undefined,
	]
		.filter(Boolean)
		.join(", ");

	return { summary, strengths, weaknesses, projection, basis: `${basis}.` };
};

// What his story (public knowledge about his career) adds to the projection
const STORY_NOTES: Record<string, string> = {
	bust: "The recruiting pedigree says there is more in there than he has shown.",
	unranked: "Has beaten every projection made about him so far.",
	lateBloomer: "One big season is a small sample to draft on.",
	project: "A bet on size, and on patience.",
	smallSchoolScorer:
		"The question is whether it translates against bigger, better defenders.",
	olderIntl: "What you see is close to what you get.",
	reclass: "A year younger than his class, which is a year of growth to come.",
	injury: "The medical report will matter as much as the tape.",
};

const capitalize = (text: string) => text.replace(/^./, (c) => c.toUpperCase());

const classWord = (cls: string) => {
	const rs = cls.startsWith("RS ");
	const word =
		{
			"Fr.": "freshman",
			"So.": "sophomore",
			"Jr.": "junior",
			"Sr.": "senior",
			"Gr.": "fifth-year senior",
		}[cls.replace(/^RS /, "")] ?? "player";
	return `${rs && word !== "fifth-year senior" ? "redshirt " : ""}${word}`;
};
