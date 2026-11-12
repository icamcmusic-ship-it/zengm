// One-line explanations for each grade, in several phrasings per level, plus the evidence from production that backs them up. Pure.
import { pct } from "./text.ts";
import type { GradeKey, ScoutInput, ScoutProduction } from "./types.ts";

type Level = "high" | "good" | "mid" | "low";

const LINES: Record<GradeKey, Record<Level, string[]>> = {
	shoot: {
		high: [
			"A real shooter from anywhere on the floor",
			"The jumper is a weapon, on the catch and off the bounce",
			"Defenses have to respect his shot everywhere",
		],
		good: [
			"A reliable shooter who makes the open ones",
			"Shot is a plus; consistent mechanics",
			"Shoots it well enough to keep defenses honest",
		],
		mid: [
			"An average shooter; streaky from range",
			"Shot comes and goes",
			"Serviceable jumper, nothing more yet",
		],
		low: [
			"The jumper is a long way off",
			"Defenses will play off him until the shot comes around",
			"Shooting is the swing skill, and right now it's a problem",
		],
	},
	cs: {
		high: [
			"Knockdown spot-up shooter; quick, compact release",
			"Lethal on the catch, especially from the corners",
			"Feet are always set; punishes closeouts late",
		],
		good: [
			"Makes open catch-and-shoot threes",
			"Comfortable spotting up off the ball",
			"Spot-up shot is dependable",
		],
		mid: [
			"Inconsistent spot-up shooter",
			"Hits open threes some nights, not others",
			"Catch-and-shoot numbers sit around the middle",
		],
		low: [
			"Teams will leave him open on the catch",
			"Slow, loopy release when spotting up",
			"Not a threat to space the floor yet",
		],
	},
	od: {
		high: [
			"Creates his own jumper at will: pull-ups, step-backs, side-steps",
			"Dangerous pull-up shooter coming off screens",
			"Shot-maker off the bounce, the kind you can run offense through",
		],
		good: [
			"Can get to a pull-up when the defense goes under",
			"Respectable off-the-dribble jumper",
			"Hits enough pull-ups to punish drop coverage",
		],
		mid: [
			"Off-the-dribble shot is a work in progress",
			"Will take pull-ups but makes an average share",
			"Shot gets flat when he's on the move",
		],
		low: [
			"Can't create a good look for himself off the dribble",
			"Pull-up jumper isn't there",
			"Needs to be set to shoot; off the bounce it falls apart",
		],
	},
	ft: {
		high: [
			"Automatic at the line",
			"Pure stroke at the free throw line",
			"Elite free throw shooter, a good sign for the rest of his shot",
		],
		good: [
			"Solid free throw shooter",
			"Steady at the line",
			"Free throw stroke is sound",
		],
		mid: [
			"Average from the line",
			"Free throws come and go",
			"Middle-of-the-pack at the line",
		],
		low: [
			"Shaky at the line; can be hacked late",
			"Free throw mechanics need a rebuild",
			"A liability at the line in close games",
		],
	},
	fin: {
		high: [
			"Finishes through contact and above the rim",
			"Elite at the basket with either hand",
			"Converts at the rim at a rate few at his position can match",
		],
		good: [
			"A capable finisher in traffic",
			"Gets to the rim and usually finishes",
			"Good touch around the basket",
		],
		mid: [
			"An ordinary finisher; needs angles",
			"Finishes the easy ones, struggles against length",
			"Middling around the rim",
		],
		low: [
			"Struggles to finish against size",
			"Gets to the rim but can't convert",
			"Finishing is a real hole in his game",
		],
	},
	pm: {
		high: [
			"Elite vision; makes every read in the pick-and-roll",
			"Throws teammates open and sees plays before they happen",
			"A true table-setter who bends the defense",
		],
		good: [
			"Willing, smart passer who keeps the ball moving",
			"Makes the simple read and the occasional great one",
			"Can run some offense",
		],
		mid: [
			"Makes the obvious pass, not much more",
			"Adequate passer for his role",
			"Ball tends to stick a beat too long",
		],
		low: [
			"Tunnel vision once he puts it on the floor",
			"Rarely creates for teammates",
			"Not a playmaker",
		],
	},
	bs: {
		high: [
			"Takes care of the ball under pressure",
			"Rarely turns it over for how much he has it",
			"Ball security is a strength; low-mistake player",
		],
		good: [
			"Generally sure-handed",
			"Turnovers are under control",
			"Doesn't beat himself",
		],
		mid: [
			"An average number of giveaways",
			"Can get loose with the ball against pressure",
			"Turnovers aren't a problem, aren't a strength",
		],
		low: [
			"Turnover prone; loose handle in traffic",
			"Gives it away too often",
			"Careless with the ball against length",
		],
	},
	reb: {
		high: [
			"Dominant rebounder; ends possessions",
			"Goes and gets it out of his area",
			"Elite on the glass at both ends",
		],
		good: [
			"Good rebounder for his position",
			"Boxes out and pursues the ball",
			"Holds his own on the glass",
		],
		mid: [
			"An average rebounder for his position",
			"Gets the ones that come to him",
			"Neither helps nor hurts on the glass",
		],
		low: [
			"Doesn't rebound his position",
			"Gets pushed off the glass",
			"Poor positioning and pursuit on the boards",
		],
	},
	pd: {
		high: [
			"Lockdown perimeter defender; slides with anybody",
			"Disruptive on the ball, quick hands and feet",
			"Can take the other team's best guard",
		],
		good: [
			"Solid on the perimeter; stays in front",
			"Competes on the ball and fights over screens",
			"Plus defender on the wing",
		],
		mid: [
			"Adequate on the perimeter",
			"Holds up against most matchups, not the best ones",
			"Average point-of-attack defender",
		],
		low: [
			"Gets beat off the dribble",
			"Will be targeted on the perimeter",
			"Feet are too slow for quick guards",
		],
	},
	id: {
		high: [
			"Rim protector who changes shots",
			"Owns the paint; erases mistakes at the rim",
			"Elite shot blocker with timing and length",
		],
		good: [
			"Solid interior defender",
			"Holds position in the post and contests well",
			"Some rim protection",
		],
		mid: [
			"Average around the basket",
			"Contests at the rim without changing many shots",
			"Holds his own inside",
		],
		low: [
			"Little resistance at the rim",
			"Gets bullied in the post",
			"Can't protect the paint",
		],
	},
	ath: {
		high: [
			"Explosive athlete: first step, lift and speed",
			"Plays above the rim and in the open floor",
			"Rare burst and bounce",
		],
		good: [
			"Good athlete with real quickness",
			"Plus burst; moves well",
			"Above-average lift and speed",
		],
		mid: [
			"Average athlete",
			"Adequate quickness, average lift",
			"Neither a plus nor a minus athletically",
		],
		low: [
			"Below-average athlete; struggles to create separation",
			"Lacks burst against pro athletes",
			"Heavy-footed; plays below the rim",
		],
	},
	size: {
		high: [
			"Excellent size and length for his position",
			"Huge frame; long arms",
			"Size you can't teach",
		],
		good: [
			"Good size for the position",
			"Long and well built",
			"Has the frame for the job",
		],
		mid: [
			"Standard size for his position",
			"Average length",
			"Neither big nor small for his spot",
		],
		low: [
			"Undersized for his position",
			"Short arms and a slight frame",
			"Gives up size every night",
		],
	},
	iq: {
		high: [
			"Plays with a high IQ at both ends",
			"Always in the right spot; a coach on the floor",
			"Processes the game a step ahead of everyone else",
		],
		good: [
			"Smart, team-oriented player",
			"Good feel for the game",
			"Makes good decisions",
		],
		mid: [
			"Average feel; some lapses",
			"Decisions are fine, rarely special",
			"Feel for the game is middle of the road",
		],
		low: [
			"Raw feel; decisions come late",
			"Frequently out of position",
			"Still learning how to play",
		],
	},
	motor: {
		high: [
			"Relentless motor; plays hard every possession",
			"Conditioning and effort are elite",
			"Never takes a play off",
		],
		good: [
			"Good motor and conditioning",
			"Brings energy every night",
			"Plays hard",
		],
		mid: [
			"Effort is fine, not a selling point",
			"Average motor",
			"Conditioning is adequate",
		],
		low: [
			"Effort comes and goes",
			"Fades late in games",
			"Conditioning and motor are questions",
		],
	},
};

const levelOf = (grade: number): Level =>
	grade >= 10 ? "high" : grade >= 7 ? "good" : grade >= 4 ? "mid" : "low";

const per = (s: ScoutProduction, x: number) => x.toFixed(1);

// The number that backs up a grade, if the sample is real and the number agrees with the grade
const evidence = (
	key: GradeKey,
	grade: number,
	input: ScoutInput,
): string | undefined => {
	const s = input.production;
	const good = grade >= 7;
	const bad = grade <= 4;
	if (!good && !bad) {
		return undefined;
	}
	if (s && s.gp >= 8 && s.min >= 10) {
		switch (key) {
			case "shoot":
			case "cs":
				if (s.tpa >= 1 && (good ? s.tpPct >= 36 : s.tpPct < 32)) {
					return `${pct(s.tpPct)} from three on ${per(s, s.tpa)} attempts a game`;
				}
				break;
			case "od":
				if (
					s.midA !== undefined &&
					s.midPct !== undefined &&
					s.midA >= 1 &&
					(good ? s.midPct >= 43 : s.midPct < 37)
				) {
					return `${pct(s.midPct)} on mid-range jumpers`;
				}
				break;
			case "ft":
				if (s.fta >= 1 && (good ? s.ftPct >= 80 : s.ftPct < 68)) {
					return `${pct(s.ftPct)} at the line`;
				}
				break;
			case "fin":
				if (
					s.rimA !== undefined &&
					s.rimPct !== undefined &&
					s.rimA >= 1 &&
					(good ? s.rimPct >= 65 : s.rimPct < 57)
				) {
					return `${pct(s.rimPct)} at the rim`;
				}
				if (s.rimA === undefined && good && s.fgPct >= 52) {
					return `${pct(s.fgPct)} from the field`;
				}
				break;
			case "pm":
				if (good ? s.ast >= 4 : s.ast < 1.5 && s.min >= 20) {
					return `${per(s, s.ast)} assists a game`;
				}
				break;
			case "bs":
				if (good ? s.tov <= 1.5 && s.ast >= 2 : s.tov >= 2.8) {
					return `${per(s, s.tov)} turnovers a game`;
				}
				break;
			case "reb":
				if (good ? s.trb >= 7 : s.trb < 3.5 && s.min >= 20) {
					return `${per(s, s.trb)} rebounds a game`;
				}
				break;
			case "pd":
				if (good && s.stl >= 1.3) {
					return `${per(s, s.stl)} steals a game`;
				}
				break;
			case "id":
				if (good && s.blk >= 1.2) {
					return `${per(s, s.blk)} blocks a game`;
				}
				break;
			case "iq":
				if (s.level === "pro" && s.per !== undefined && (good ? s.per >= 18 : s.per < 11)) {
					return `${s.per.toFixed(1)} PER`;
				}
				break;
		}
	}
	if (key === "ath" && input.combine) {
		const vert = input.combine.find((c) => c.label === "Max vert");
		if (vert && (good ? vert.pct >= 70 : vert.pct <= 30)) {
			return `${vert.value} max vert at the combine`;
		}
	}
	if (key === "size" && input.combine) {
		const span = input.combine.find((c) => c.label === "Wingspan");
		if (span && (good ? span.pct >= 70 : span.pct <= 30)) {
			return `${span.value} wingspan`;
		}
	}
	if (key === "motor" && input.traits) {
		const t = input.traits.find((x) => x.key === "hustle" && !x.hidden);
		if (t && (good ? t.estimate >= 65 : t.estimate <= 35)) {
			return t.exact
				? `hustle reads ${t.estimate}`
				: `hustle reads ${t.low}-${t.high}`;
		}
	}
	return undefined;
};

export const gradeLine = (
	key: GradeKey,
	grade: number,
	input: ScoutInput,
	pick: <T>(options: readonly T[]) => T,
) => {
	const text = pick(LINES[key][levelOf(grade)]);
	const ev = evidence(key, grade, input);
	return ev ? `${text} (${ev}).` : `${text}.`;
};
