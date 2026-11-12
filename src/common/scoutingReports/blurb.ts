// Short forms of a scouting report: one-line blurbs (trade window, free agents), the hover card (Mock Draft, Draft Board), rumors
// ("Scouts are split on X") and opponent scouting. Also the AI GM's evaluation lens. Pure.
import { GRADE_LABELS, lowerLabel, peerGroupOf } from "./categories.ts";
import { formatGradeRange, gradeLetter } from "./grades.ts";
import { capFirst, roleName, Voice } from "./text.ts";
import type { FullReport, GradeKey, ScoutTake } from "./types.ts";

export type ScoutHover = {
	pid: number;
	name: string;
	overall: string;
	grades: { key: GradeKey; label: string; grade: string }[];
	range: string;
	bottomLine: string;
	byline: string;
};

const HOVER_KEYS: GradeKey[] = [
	"shoot",
	"fin",
	"pm",
	"reb",
	"pd",
	"id",
	"ath",
	"iq",
];

export const hoverOf = (r: FullReport): ScoutHover => ({
	pid: r.pid,
	name: r.name,
	overall: formatGradeRange(r.overall.lo, r.overall.hi),
	grades: HOVER_KEYS.map((key) => {
		const g = r.grades.find((x) => x.key === key)!;
		return {
			key,
			label: GRADE_LABELS[key],
			grade: formatGradeRange(g.lo, g.hi),
		};
	}),
	range: r.header.rangeLine,
	bottomLine: r.bottomLine,
	byline: `${r.byline.lead.name}, ${r.byline.lead.title}`,
});

// One line, short: "B+ wing: A- shooter, C+ defender. Rotation wing to starter. Fairly paid."
export const blurbOf = (r: FullReport, pos: string) => {
	const v = new Voice(`blurb|${r.pid}|${r.byline.lead.id}`);
	const main = r.grades.filter((g) => !g.sub);
	const best = main.toSorted((a, b) => b.grade - a.grade)[0]!;
	const worst = main.toSorted((a, b) => a.grade - b.grade)[0]!;
	const group = peerGroupOf(pos);
	const noun = group === "big" ? "big" : group === "guard" ? "guard" : "wing";
	const parts = [
		`${gradeLetter(r.overall.grade)} ${noun}: ${gradeLetter(best.grade)} ${lowerLabel(best.key)}, ${gradeLetter(worst.grade)} ${lowerLabel(worst.key)}.`,
	];
	if (r.take.floor === r.take.ceiling) {
		parts.push(`${capFirst(roleName(r.take.floor, group))}.`);
	} else {
		parts.push(
			`${capFirst(roleName(r.take.floor, group))} ${v.pick(["to", "up to", "with a ceiling of"])} ${roleName(r.take.ceiling, group)}.`,
		);
	}
	if (r.pro?.trend && r.pro.trend !== "stable") {
		parts.push(r.pro.trend === "improving" ? "Trending up." : "Trending down.");
	}
	if (r.pro?.contract) {
		const c = r.pro.contract;
		parts.push(
			c.startsWith("A bargain")
				? "A bargain."
				: c.startsWith("Overpaid")
					? "Overpaid."
					: c.startsWith("Free agent")
						? c.replace(/^Free agent; would be worth/, "Worth")
						: "Fairly paid.",
		);
	}
	const red = r.flags.find((f) => f.tone === "red");
	if (red) {
		parts.push(`Flag: ${red.text.split(":")[0]!.toLowerCase()}.`);
	}
	return parts.join(" ");
};

// Rumors: when two scouts' takes on a player are far apart. undefined when they agree
export const scoutsSplit = (
	name: string,
	pos: string,
	takes: {
		scout: string;
		take: Pick<ScoutTake, "ceiling" | "expected" | "overall">;
	}[],
	seed: string,
) => {
	if (takes.length < 2) {
		return undefined;
	}
	const sorted = takes.toSorted((a, b) => b.take.expected - a.take.expected);
	const hi = sorted[0]!;
	const lo = sorted.at(-1)!;
	const spread = hi.take.expected - lo.take.expected;
	const gradeSpread = hi.take.overall.grade - lo.take.overall.grade;
	if (spread < 2 && gradeSpread < 3) {
		return undefined;
	}
	const group = peerGroupOf(pos);
	const v = new Voice(`split|${seed}`);
	const text = v.pick([
		`Scouts are split on ${name}: one sees ${aRole(hi.take.expected, group)}, another ${aRole(lo.take.expected, group)}.`,
		`Opinions vary wildly on ${name}. The high grade has him as ${aRole(hi.take.expected, group)}; the low one as ${aRole(lo.take.expected, group)}.`,
		`Not everyone is sold on ${name}: evaluations range from ${aRole(lo.take.expected, group)} to ${aRole(hi.take.expected, group)}.`,
	]);
	return { text, spread, high: hi.scout, low: lo.scout };
};

const aRole = (tier: number, group: ReturnType<typeof peerGroupOf>) => {
	const name = roleName(tier, group);
	return name === "out of the league"
		? "a player who won't stick"
		: `${/^[AEaeiou]/.test(name) ? "an" : "a"} ${name}`;
};

export type OpponentPlayer = {
	pid: number;
	name: string;
	pos: string;
	how: string;
	defend: string;
	keyGrades: string;
};

// How a key opponent scores, and how to defend him, from the report the user's staff would write
export const opponentNotes = (r: FullReport, pos: string): OpponentPlayer => {
	const v = new Voice(`opp|${r.pid}|${r.byline.lead.id}`);
	const g = (k: GradeKey) => r.grades.find((x) => x.key === k)!.grade;
	const how: string[] = [];
	if (g("od") >= 9) {
		how.push("pull-up jumpers off screens");
	}
	if (g("cs") >= 9) {
		how.push("spot-up threes");
	}
	if (g("fin") >= 9) {
		how.push("attacks the rim");
	}
	if (g("pm") >= 9) {
		how.push("creates for everyone else");
	}
	if (g("reb") >= 10) {
		how.push("second chances off the offensive glass");
	}
	if (how.length === 0) {
		how.push(
			g("shoot") >= g("fin")
				? "jumpers within the offense"
				: "cuts and finishes inside",
		);
	}
	const defend: string[] = [];
	if (g("od") >= 8) {
		defend.push(
			v.pick([
				"go over screens and make him a passer",
				"top-lock him off screens",
			]),
		);
	} else if (g("cs") >= 8) {
		defend.push(
			v.pick(["no help off him; stay attached", "run him off the line"]),
		);
	} else if (g("shoot") <= 5) {
		defend.push(
			v.pick([
				"go under screens and dare him to shoot",
				"sag off and clog the lane",
			]),
		);
	}
	if (g("fin") >= 8 && g("shoot") <= 6) {
		defend.push("build a wall in transition and keep him out of the paint");
	}
	if (g("bs") <= 5) {
		defend.push("pressure the ball; he'll give it up");
	}
	if (g("pm") >= 9) {
		defend.push("stay home on shooters when he drives; he will find them");
	}
	if (g("pd") <= 5 || g("id") <= 4) {
		defend.push(
			`attack him on the other end${g("pd") <= 5 ? " with our guards" : " in the post"}`,
		);
	}
	if (defend.length === 0) {
		defend.push("solid, no gambles; make him beat us over a long series");
	}
	const keys: GradeKey[] = ["shoot", "fin", "pm", "pd", "id"];
	return {
		pid: r.pid,
		name: r.name,
		pos,
		how: `Scores via ${how.slice(0, 3).join(", ")}.`,
		defend: `${capFirst(defend.slice(0, 2).join("; "))}.`,
		keyGrades: keys
			.map((k) => `${GRADE_LABELS[k]} ${gradeLetter(g(k))}`)
			.join(" · "),
	};
};

/**
 * AI GMs reading grades through their evaluation lens: analytics GMs lean on shooting, playmaking and feel, old-school GMs on size,
 * athleticism and toughness. The weights sum to zero, so a balanced prospect gets nothing and the class as a whole is neither
 * inflated nor deflated; the result is in value points and bounded to +-maxAdj.
 */
export const gmLensAdjustment = (
	analytics: number,
	gradeZ: Partial<Record<GradeKey, number>>,
	maxAdj = 0.8,
) => {
	const LENS: Partial<Record<GradeKey, number>> = {
		shoot: 1,
		pm: 0.6,
		iq: 0.7,
		bs: 0.3,
		ath: -0.9,
		size: -0.9,
		motor: -0.4,
		reb: -0.4,
	};
	let sum = 0;
	for (const [key, w] of Object.entries(LENS) as [GradeKey, number][]) {
		sum += w * (gradeZ[key] ?? 0);
	}
	return Math.max(-maxAdj, Math.min(maxAdj, 0.35 * analytics * sum));
};
