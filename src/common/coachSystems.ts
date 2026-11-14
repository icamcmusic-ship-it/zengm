// Coaching systems (the coachSystems setting, basketball, see docs/native-features.md "Coaching systems"): pure helpers shared by the worker
// and the UI. A head coach runs an offense system and a defense system, has dials (crash the glass, fouls, closing, timeouts, youth, rest),
// a philosophy, a personality, a background, game management and adaptability. Rosters fit systems better or worse (scheme fit). The game
// sim gets a small set of multipliers (CoachSim) that change how a team plays, normalized over the league so league averages stay put.
import { makeSeededRandom } from "./random.ts";
import type {
	CoachBackground,
	CoachProfile,
	CoachRatings,
	CoachStyle,
	DefenseSystem,
	OffenseSystem,
} from "./types.staff.ts";

export const OFFENSE_SYSTEMS: OffenseSystem[] = [
	"motion",
	"paceSpace",
	"heliocentric",
	"post",
	"iso",
	"princeton",
	"sevenSeconds",
];
export const DEFENSE_SYSTEMS: DefenseSystem[] = [
	"switch",
	"drop",
	"blitz",
	"packPaint",
	"zone",
	"press",
];

export const OFFENSE_NAMES: Record<OffenseSystem, string> = {
	motion: "Motion / Read & React",
	paceSpace: "Pace & Space",
	heliocentric: "Heliocentric PnR",
	post: "Post / Inside-Out",
	iso: "Isolation",
	princeton: "Princeton",
	sevenSeconds: "Seven Seconds or Less",
};
export const DEFENSE_NAMES: Record<DefenseSystem, string> = {
	switch: "Switch Everything",
	drop: "Drop Coverage",
	blitz: "Aggressive Blitz",
	packPaint: "Pack the Paint",
	zone: "Zone",
	press: "Full-Court Press",
};
export const BACKGROUND_NAMES: Record<CoachBackground, string> = {
	guard: "Former guard",
	big: "Former big man",
	analytics: "Analytics",
	defense: "Defensive coordinator",
};

export const OFFENSE_DESCRIPTIONS: Record<OffenseSystem, string> = {
	motion:
		"Constant ball and player movement, the ball finds the open man: more assists, the shots spread across the lineup, a few more turnovers.",
	paceSpace:
		"Five out, push the ball and launch threes: more threes and shots at the rim, far fewer mid-range jumpers and post-ups. Needs shooters.",
	heliocentric:
		"Everything runs through one star in the pick-and-roll: his usage goes way up, fewer assists, fewer turnovers. Needs a star handler.",
	post: "Play inside out through the bigs: post-ups and the offensive glass, fewer threes, a slower pace. Needs skilled bigs.",
	iso: "Clear out and let the scorers go one-on-one: mid-range pull-ups, the best scorers shoot more, fewer assists and turnovers.",
	princeton:
		"Backdoor cuts and passing bigs, patient possessions: lots of assists and layups off cuts, a slow pace. Needs smart passers.",
	sevenSeconds:
		"Shoot early, before the defense sets: lots of transition, threes and a fast pace, a few more turnovers. Needs athletes.",
};
export const DEFENSE_DESCRIPTIONS: Record<DefenseSystem, string> = {
	switch:
		"Switch every screen: takes away threes, but opponents hunt mismatches in the post. Needs versatile defenders.",
	drop: "Bigs sit back at the rim: protects the paint and fouls little, concedes mid-range jumpers. Needs a rim protector.",
	blitz:
		"Trap the ball handler: forces turnovers and steals, but the rotations give up some threes and fouls.",
	packPaint:
		"Wall off the paint: few shots at the rim or in the post and fewer offensive rebounds, concedes threes.",
	zone: "Zone defense: protects the paint and slows the game, concedes threes and offensive rebounds.",
	press:
		"Pressure the length of the court: lots of turnovers and a faster game, but fouls and easy baskets when it's broken. Needs athletes.",
};

// Each system's tendencies: multipliers on the existing sim draws (1 = no change). See CoachSim for what each one applies to.
type OffenseTable = {
	three: number;
	mid: number;
	rim: number;
	post: number;
	pace: number;
	transition: number;
	usage: number;
	ast: number;
	tov: number;
	orb: number;
};
type DefenseTable = {
	three: number;
	mid: number;
	rim: number;
	post: number;
	pace: number;
	forceTov: number;
	stl: number;
	foul: number;
	orbAllowed: number;
	oppTransition: number;
};

export const OFFENSE_TABLE: Record<OffenseSystem, OffenseTable> = {
	motion: {
		three: 1.016,
		mid: 1,
		rim: 1.03,
		post: 0.95,
		pace: 1,
		transition: 1,
		usage: 0.85,
		ast: 1.12,
		tov: 1.04,
		orb: 1,
	},
	paceSpace: {
		three: 1.16,
		mid: 0.75,
		rim: 1.1,
		post: 0.8,
		pace: 1.0052,
		transition: 1.07,
		usage: 1,
		ast: 1.02,
		tov: 1,
		orb: 0.994,
	},
	heliocentric: {
		three: 1.064,
		mid: 0.95,
		rim: 1.05,
		post: 0.85,
		pace: 0.9979,
		transition: 0.979,
		usage: 1.45,
		ast: 0.9,
		tov: 0.95,
		orb: 1,
	},
	post: {
		three: 0.824,
		mid: 1.05,
		rim: 1.05,
		post: 1.5,
		pace: 0.9918,
		transition: 0.93,
		usage: 1.05,
		ast: 0.97,
		tov: 1.02,
		orb: 0.994,
	},
	iso: {
		three: 0.944,
		mid: 1.35,
		rim: 0.95,
		post: 1.05,
		pace: 0.9948,
		transition: 0.951,
		usage: 1.35,
		ast: 0.8,
		tov: 0.92,
		orb: 1,
	},
	princeton: {
		three: 0.976,
		mid: 0.95,
		rim: 1.18,
		post: 1.05,
		pace: 0.9918,
		transition: 0.93,
		usage: 0.85,
		ast: 1.15,
		tov: 1.03,
		orb: 0.994,
	},
	sevenSeconds: {
		three: 1.12,
		mid: 0.8,
		rim: 1.05,
		post: 0.8,
		pace: 1.0103,
		transition: 1.175,
		usage: 1.05,
		ast: 1.04,
		tov: 1.06,
		orb: 0.988,
	},
};

// For the defense: what the opponent gets (three/mid/rim/post shot mix), turnovers forced, steals, fouls, offensive rebounds allowed and
// the opponent's transition chances
export const DEFENSE_TABLE: Record<DefenseSystem, DefenseTable> = {
	switch: {
		three: 0.92,
		mid: 1.08,
		rim: 0.98,
		post: 1.2,
		pace: 1,
		forceTov: 1.02,
		stl: 1,
		foul: 1,
		orbAllowed: 1.01,
		oppTransition: 1,
	},
	drop: {
		three: 1.04,
		mid: 1.25,
		rim: 0.9,
		post: 0.95,
		pace: 1,
		forceTov: 0.95,
		stl: 0.95,
		foul: 0.95,
		orbAllowed: 0.99,
		oppTransition: 0.98,
	},
	blitz: {
		three: 1.056,
		mid: 0.95,
		rim: 1.02,
		post: 1,
		pace: 1.0021,
		forceTov: 1.07,
		stl: 1.07,
		foul: 1.04,
		orbAllowed: 1.005,
		oppTransition: 1.02,
	},
	packPaint: {
		three: 1.12,
		mid: 1.05,
		rim: 0.85,
		post: 0.85,
		pace: 0.9979,
		forceTov: 0.98,
		stl: 0.97,
		foul: 0.97,
		orbAllowed: 0.975,
		oppTransition: 0.98,
	},
	zone: {
		three: 1.12,
		mid: 1,
		rim: 0.88,
		post: 0.9,
		pace: 0.9948,
		forceTov: 1.03,
		stl: 1.03,
		foul: 0.95,
		orbAllowed: 1.03,
		oppTransition: 1,
	},
	press: {
		three: 1.016,
		mid: 0.98,
		rim: 1.06,
		post: 1,
		pace: 1.0082,
		forceTov: 1.1,
		stl: 1.1,
		foul: 1.07,
		orbAllowed: 1.005,
		oppTransition: 1.08,
	},
};

// Average efficiency of each system, so systems change how a team scores, not how much (calibrated with coachSystems.script.test.ts: the
// make probability change that brings each system's average net rating back to 0). Scheme fit and coaching are what make teams better
const OFFENSE_MAKE_ADJ: Record<OffenseSystem, number> = {
	motion: 0.0025,
	paceSpace: -0.0145,
	heliocentric: -0.0128,
	post: 0.019,
	iso: 0.026,
	princeton: 0.0015,
	sevenSeconds: 0.001,
};
// (for the opponent's shots: positive makes them easier)
const DEFENSE_MAKE_ADJ: Record<DefenseSystem, number> = {
	switch: -0.0024,
	drop: 0.0064,
	blitz: -0.0143,
	packPaint: 0.012,
	zone: -0.0085,
	press: -0.0053,
};

// What the game sim reads, for one team (t.coachSim). Multipliers: 1 = no change. Defense keys apply while this team is on defense.
export type CoachSim = {
	// labels for the box score and the play-by-play
	off: OffenseSystem;
	def: DefenseSystem;
	// offense
	three: number;
	mid: number;
	rim: number;
	post: number;
	pace: number;
	transition: number;
	// power on the usage composite when picking the shooter, relative to the stock 1.25
	usage: number;
	ast: number;
	tov: number;
	orb: number;
	// additive change to the make probability of this team's shots (scheme fit, coaching, installation)
	make: number;
	// defense
	dThree: number;
	dMid: number;
	dRim: number;
	dPost: number;
	forceTov: number;
	stl: number;
	foul: number;
	orbAllowed: number;
	oppTransition: number;
	// additive change to the make probability of the opponent's shots
	dMake: number;
	// late game (final period, last 5 minutes, within 8): additive make change (game management) and how much more the best player shoots
	clutchMake: number;
	clutchUsage: number;
	// quick-trigger coaches have spent a timeout before the final period
	burnTimeout: boolean;
	// game management: how late a trailing team starts fouling (seconds; stock 27) and how readily it calls a timeout to advance the ball
	foulWindow: number;
	// disciplinarians keep tempers in check (technical and flagrant fouls)
	temper: number;
};

export const NEUTRAL_COACH_SIM: Omit<CoachSim, "off" | "def"> = {
	three: 1,
	mid: 1,
	rim: 1,
	post: 1,
	pace: 1,
	transition: 1,
	usage: 1,
	ast: 1,
	tov: 1,
	orb: 1,
	make: 0,
	dThree: 1,
	dMid: 1,
	dRim: 1,
	dPost: 1,
	forceTov: 1,
	stl: 1,
	foul: 1,
	orbAllowed: 1,
	oppTransition: 1,
	dMake: 0,
	clutchMake: 0,
	clutchUsage: 1,
	burnTimeout: false,
	foulWindow: 27,
	temper: 1,
};

// Keys normalized multiplicatively (mean over the league = 1) and additively (mean 0)
export const COACH_SIM_MULT_KEYS = [
	"three",
	"mid",
	"rim",
	"post",
	"pace",
	"transition",
	"usage",
	"ast",
	"tov",
	"orb",
	"dThree",
	"dMid",
	"dRim",
	"dPost",
	"forceTov",
	"stl",
	"foul",
	"orbAllowed",
	"oppTransition",
	"clutchUsage",
	"temper",
] as const;
export const COACH_SIM_ADD_KEYS = ["make", "dMake", "clutchMake"] as const;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const round2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------------------------------------------------------------------
// Profiles

// Deterministic string hash (FNV-1a)
export const hashString = (s: string) => {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
};

type ProfileSource = {
	firstName: string;
	lastName: string;
	born: { year: number; loc: string };
	ratings: CoachRatings;
	style: CoachStyle;
};

// Style affinities for picking a system: weight = base * exp(2 * (affinity . style)) * background bias * trend
const OFFENSE_PICK: Record<
	OffenseSystem,
	{
		base: number;
		pace: number;
		threes: number;
		rotation: number;
		bg: Partial<Record<CoachBackground, number>>;
	}
> = {
	motion: {
		base: 1.2,
		pace: 0,
		threes: 0.1,
		rotation: 0.4,
		bg: { analytics: 1.2 },
	},
	paceSpace: {
		base: 1.1,
		pace: 0.5,
		threes: 1.1,
		rotation: 0,
		bg: { analytics: 1.6, guard: 1.2 },
	},
	heliocentric: {
		base: 0.9,
		pace: 0,
		threes: 0.5,
		rotation: -0.6,
		bg: { guard: 1.8, analytics: 1.3 },
	},
	post: {
		base: 0.7,
		pace: -0.5,
		threes: -1.3,
		rotation: 0,
		bg: { big: 2.2, guard: 0.6 },
	},
	iso: {
		base: 0.6,
		pace: -0.3,
		threes: -0.4,
		rotation: -0.5,
		bg: { guard: 1.6, analytics: 0.5 },
	},
	princeton: {
		base: 0.5,
		pace: -1,
		threes: 0,
		rotation: 0.4,
		bg: { big: 1.6 },
	},
	sevenSeconds: {
		base: 0.6,
		pace: 1.4,
		threes: 0.7,
		rotation: 0.3,
		bg: { guard: 1.3, analytics: 1.2 },
	},
};
const DEFENSE_PICK: Record<
	DefenseSystem,
	{
		base: number;
		defense: number;
		pace: number;
		bg: Partial<Record<CoachBackground, number>>;
	}
> = {
	switch: {
		base: 1.1,
		defense: 0.3,
		pace: 0.2,
		bg: { analytics: 1.5, defense: 1.3 },
	},
	drop: { base: 1.2, defense: -0.8, pace: -0.2, bg: { big: 1.8 } },
	blitz: { base: 0.8, defense: 1, pace: 0, bg: { defense: 1.5, guard: 1.2 } },
	packPaint: {
		base: 1,
		defense: -0.6,
		pace: -0.2,
		bg: { big: 1.5, defense: 1.2 },
	},
	zone: { base: 0.5, defense: -0.4, pace: -0.4, bg: { big: 1.2 } },
	press: {
		base: 0.5,
		defense: 1.4,
		pace: 0.6,
		bg: { guard: 1.4, defense: 1.2 },
	},
};

const weightedPick = <T extends string>(
	weights: [T, number][],
	r: number,
): T => {
	let total = 0;
	for (const [, w] of weights) {
		total += w;
	}
	let x = r * total;
	for (const [key, w] of weights) {
		x -= w;
		if (x < 0) {
			return key;
		}
	}
	return weights.at(-1)![0];
};

// Popularity of each system across the league (from systemTrends), > 1 for systems that are winning lately. Only new coaches use it.
export type SystemTrends = {
	off: Partial<Record<OffenseSystem, number>>;
	def: Partial<Record<DefenseSystem, number>>;
};

export const pickOffenseSystem = (
	style: CoachStyle,
	background: CoachBackground,
	r: number,
	trends?: SystemTrends,
) =>
	weightedPick(
		OFFENSE_SYSTEMS.map((s) => {
			const x = OFFENSE_PICK[s];
			return [
				s,
				x.base *
					Math.exp(
						2 *
							(x.pace * style.pace +
								x.threes * style.threes +
								x.rotation * style.rotation),
					) *
					(x.bg[background] ?? 1) *
					(trends?.off[s] ?? 1),
			];
		}),
		r,
	);

export const pickDefenseSystem = (
	style: CoachStyle,
	background: CoachBackground,
	r: number,
	trends?: SystemTrends,
) =>
	weightedPick(
		DEFENSE_SYSTEMS.map((s) => {
			const x = DEFENSE_PICK[s];
			return [
				s,
				x.base *
					Math.exp(2 * (x.defense * style.defense + x.pace * style.pace)) *
					(x.bg[background] ?? 1) *
					(trends?.def[s] ?? 1),
			];
		}),
		r,
	);

// A normal draw from a seeded uniform stream
const seededGauss = (random: () => number) => {
	const u = Math.max(1e-9, random());
	const v = random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/**
 * A coach's profile from his style, ratings and name, with no random draws (a seeded stream from the coach's identity). Used for coaches
 * generated before the setting existed (migration) and for new coaches (with the league's current system trends).
 */
export const deriveCoachProfile = (
	c: ProfileSource,
	trends?: SystemTrends,
): CoachProfile => {
	const random = makeSeededRandom(
		hashString(
			`coach|${c.firstName}|${c.lastName}|${c.born.year}|${c.born.loc}|${c.style.pace}|${c.style.threes}|${c.style.defense}|${c.style.rotation}`,
		),
	);
	const noise = (sd: number) => sd * seededGauss(random);
	const { ratings, style } = c;

	// Background: offense-minded coaches were guards or analytics hires, defense-minded ones bigs or defensive coordinators
	const lean = ratings.off - ratings.def + noise(8);
	const r0 = random();
	const background: CoachBackground =
		lean > 0
			? r0 < 0.55
				? "guard"
				: "analytics"
			: r0 < 0.5
				? "defense"
				: "big";

	const off = pickOffenseSystem(style, background, random(), trends);
	const def = pickDefenseSystem(style, background, random(), trends);

	const dial = (bias: number, sd = 0.4) =>
		round2(clamp(bias + noise(sd), -1, 1));
	const philosophy = dial(0);
	return {
		off,
		def,
		crash: dial(
			(off === "post" ? 0.35 : 0) +
				(off === "sevenSeconds" || off === "paceSpace" ? -0.3 : 0) +
				(background === "big" ? 0.2 : 0),
		),
		fouls: dial(
			(def === "press" || def === "blitz" ? 0.3 : 0) +
				(def === "drop" || def === "zone" ? -0.25 : 0),
		),
		closing: dial(
			(off === "heliocentric" || off === "iso" ? 0.45 : 0) +
				(off === "motion" || off === "princeton" ? -0.45 : 0),
		),
		timeouts: dial(0, 0.45),
		youth: dial(0.55 * philosophy, 0.3),
		rest: dial(background === "analytics" ? 0.35 : 0, 0.4),
		philosophy,
		personality: dial(
			(ratings.mot - 45) / 60 + (background === "defense" ? -0.2 : 0),
			0.4,
		),
		background,
		mgmt: Math.round(
			clamp(
				0.4 * ratings.mot +
					0.3 * ratings.off +
					0.3 * ratings.def +
					4 +
					noise(9),
				5,
				95,
			),
		),
		adapt: Math.round(clamp(52 + noise(20), 3, 97)),
	};
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// Scheme fit

// The ratings a player brings to a system (0-1 each). ratings are the stock 0-100 ratings, plus pdef/idef/wng with expanded ratings, and
// versatility is his Defensive Versatility trait score (0-100) when traits are on
export type FitRatings = {
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
	pdef?: number;
	idef?: number;
	wng?: number;
	versatility?: number;
};

const attributes = (r: FitRatings) => {
	const shoot = (0.7 * r.tp + 0.3 * r.fg) / 100;
	const inside = (0.5 * r.ins + 0.2 * r.dnk + 0.3 * r.hgt) / 100;
	const handle = (0.5 * r.drb + 0.3 * r.pss + 0.2 * r.oiq) / 100;
	const pass = (0.7 * r.pss + 0.3 * r.oiq) / 100;
	const athletic = (0.5 * r.spd + 0.3 * r.jmp + 0.2 * r.endu) / 100;
	const versBase =
		r.versatility ?? 0.3 * r.spd + 0.35 * r.diq + 0.2 * r.stre + 0.15 * r.jmp;
	const versatile =
		r.pdef !== undefined && r.idef !== undefined
			? (0.5 * versBase + 0.5 * Math.min(r.pdef, r.idef)) / 100
			: versBase / 100;
	const rimProtect =
		r.idef !== undefined
			? (0.6 * r.idef + 0.4 * r.hgt) / 100
			: (0.5 * r.hgt + 0.2 * r.jmp + 0.3 * r.diq) / 100;
	const perimD =
		r.pdef !== undefined
			? r.pdef / 100
			: (0.4 * r.spd + 0.4 * r.diq + 0.2 * r.jmp) / 100;
	const reb = (0.6 * r.reb + 0.4 * r.hgt) / 100;
	const iq = (r.oiq + r.diq) / 200;
	const length =
		r.wng !== undefined ? (0.5 * r.wng + 0.5 * r.hgt) / 100 : r.hgt / 100;
	const midShot = (0.7 * r.fg + 0.3 * r.oiq) / 100;
	return {
		shoot,
		inside,
		handle,
		pass,
		athletic,
		versatile,
		rimProtect,
		perimD,
		reb,
		iq,
		length,
		midShot,
		endu: r.endu / 100,
	};
};
type Attributes = ReturnType<typeof attributes>;

const OFFENSE_NEEDS: Record<OffenseSystem, Partial<Attributes>> = {
	motion: { pass: 0.35, shoot: 0.3, iq: 0.35 },
	paceSpace: { shoot: 0.65, athletic: 0.15, handle: 0.2 },
	heliocentric: { shoot: 0.5, handle: 0.5 },
	post: { inside: 0.6, reb: 0.2, pass: 0.2 },
	iso: { handle: 0.4, midShot: 0.4, athletic: 0.2 },
	princeton: { pass: 0.45, iq: 0.35, inside: 0.2 },
	sevenSeconds: { athletic: 0.45, shoot: 0.35, handle: 0.2 },
};
const DEFENSE_NEEDS: Record<DefenseSystem, Partial<Attributes>> = {
	switch: { versatile: 0.75, athletic: 0.25 },
	drop: { rimProtect: 0.6, perimD: 0.4 },
	blitz: { athletic: 0.4, perimD: 0.4, iq: 0.2 },
	packPaint: { rimProtect: 0.5, reb: 0.3, iq: 0.2 },
	zone: { iq: 0.4, length: 0.4, rimProtect: 0.2 },
	press: { athletic: 0.5, endu: 0.2, perimD: 0.3 },
};

// (perf2: each needs table's entries listed once, in the same order, instead of Object.entries on every call)
const needsEntries = new WeakMap<object, [string, number][]>();
const weighted = (a: Attributes, needs: Partial<Attributes>) => {
	let entries = needsEntries.get(needs);
	if (!entries) {
		entries = Object.entries(needs) as [string, number][];
		needsEntries.set(needs, entries);
	}
	let x = 0;
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i]!;
		x += (a as any)[entry[0]] * entry[1];
	}
	return x;
};

// Average raw fit of league players for each system, so a player's or team's fit is relative to what's typical for that system (measured
// on random leagues' rotation players, coachSystems.test.ts)
const OFFENSE_BASELINE: Record<OffenseSystem, number> = {
	motion: 0.4757,
	paceSpace: 0.4781,
	heliocentric: 0.4859,
	post: 0.4615,
	iso: 0.4875,
	princeton: 0.4741,
	sevenSeconds: 0.4873,
};
const DEFENSE_BASELINE: Record<DefenseSystem, number> = {
	switch: 0.5114,
	drop: 0.5033,
	blitz: 0.5148,
	packPaint: 0.5007,
	zone: 0.4909,
	press: 0.5088,
};

// Spread of the fits (raw, before standardizing) among rotation players and teams of generated leagues, so fits come out in standard
// deviations (coachSystems.script.test.ts "scheme fit baselines")
const OFFENSE_PLAYER_SD: Record<OffenseSystem, number> = {
	motion: 0.0247,
	paceSpace: 0.0465,
	heliocentric: 0.0347,
	post: 0.0927,
	iso: 0.0301,
	princeton: 0.0477,
	sevenSeconds: 0.0576,
};
const DEFENSE_PLAYER_SD: Record<DefenseSystem, number> = {
	switch: 0.0481,
	drop: 0.0391,
	blitz: 0.0553,
	packPaint: 0.0701,
	zone: 0.0742,
	press: 0.0741,
};
const OFFENSE_TEAM_SD: Record<OffenseSystem, number> = {
	motion: 0.0074,
	paceSpace: 0.0171,
	heliocentric: 0.0201,
	post: 0.0398,
	iso: 0.0116,
	princeton: 0.016,
	sevenSeconds: 0.0181,
};
const DEFENSE_TEAM_SD: Record<DefenseSystem, number> = {
	switch: 0.0181,
	drop: 0.014,
	blitz: 0.0187,
	packPaint: 0.0225,
	zone: 0.0276,
	press: 0.0236,
};
const OFFENSE_TEAM_MEAN: Record<OffenseSystem, number> = {
	motion: -0.5565,
	paceSpace: -0.2292,
	heliocentric: 0.5133,
	post: 0.2682,
	iso: -0.3673,
	princeton: -0.3102,
	sevenSeconds: -0.2059,
};
const DEFENSE_TEAM_MEAN: Record<DefenseSystem, number> = {
	switch: 0.0671,
	drop: 0.1043,
	blitz: 0.0821,
	packPaint: -0.125,
	zone: -0.107,
	press: 0.066,
};
// Average of the team-level terms (heliocentric star, post big, switching weak link, drop rim protector)
const TEAM_TERM_MEAN = {
	heliocentric: 0.031,
	post: 0.04,
	switch: -0.021,
	drop: 0.028,
};

// Raw fit, relative to how the player fits systems in general (so it measures what kind of player he is, not how good he is)
const playerRawFit = (r: FitRatings) => {
	const a = attributes(r);
	const off = {} as Record<OffenseSystem, number>;
	const def = {} as Record<DefenseSystem, number>;
	let offMean = 0;
	let defMean = 0;
	for (const s of OFFENSE_SYSTEMS) {
		off[s] = weighted(a, OFFENSE_NEEDS[s]) - OFFENSE_BASELINE[s];
		offMean += off[s] / OFFENSE_SYSTEMS.length;
	}
	for (const s of DEFENSE_SYSTEMS) {
		def[s] = weighted(a, DEFENSE_NEEDS[s]) - DEFENSE_BASELINE[s];
		defMean += def[s] / DEFENSE_SYSTEMS.length;
	}
	for (const s of OFFENSE_SYSTEMS) {
		off[s] -= offMean;
	}
	for (const s of DEFENSE_SYSTEMS) {
		def[s] -= defMean;
	}
	return { off, def };
};

// How well one player fits each system, in standard deviations among rotation players (0 typical, positive a good fit). It measures what kind
// of player he is, not how good he is
export const playerSchemeFit = (r: FitRatings) => {
	const raw = playerRawFit(r);
	for (const s of OFFENSE_SYSTEMS) {
		raw.off[s] /= OFFENSE_PLAYER_SD[s];
	}
	for (const s of DEFENSE_SYSTEMS) {
		raw.def[s] /= DEFENSE_PLAYER_SD[s];
	}
	return raw;
};

// Weights of a roster's players by rank in value (rotation players count most)
const ROTATION_WEIGHTS = [1, 1, 1, 1, 1, 0.75, 0.6, 0.45, 0.3];

// A roster's fit to every system: rotation-weighted player fits, plus the team-level needs (heliocentric needs one star handler, post needs
// a skilled big, switching needs no weak link, drop needs one rim protector). players sorted by value, best first
export const rosterSchemeFit = (players: FitRatings[]) => {
	const top = players.slice(0, ROTATION_WEIGHTS.length);
	const off = Object.fromEntries(OFFENSE_SYSTEMS.map((s) => [s, 0])) as Record<
		OffenseSystem,
		number
	>;
	const def = Object.fromEntries(DEFENSE_SYSTEMS.map((s) => [s, 0])) as Record<
		DefenseSystem,
		number
	>;
	if (top.length === 0) {
		return { off, def };
	}
	let wSum = 0;
	const fits = top.map((r) => playerRawFit(r));
	const attrs = top.map((r) => attributes(r));
	for (const [i, f] of fits.entries()) {
		const w = ROTATION_WEIGHTS[i]!;
		wSum += w;
		for (const s of OFFENSE_SYSTEMS) {
			off[s] += w * f.off[s];
		}
		for (const s of DEFENSE_SYSTEMS) {
			def[s] += w * f.def[s];
		}
	}
	for (const s of OFFENSE_SYSTEMS) {
		off[s] /= wSum;
	}
	for (const s of DEFENSE_SYSTEMS) {
		def[s] /= wSum;
	}

	const top5 = attrs.slice(0, 5);
	const max = (f: (a: Attributes) => number) => Math.max(...top5.map(f));
	const min = (f: (a: Attributes) => number) => Math.min(...top5.map(f));
	const mean = (f: (a: Attributes) => number) =>
		top5.reduce((x, a) => x + f(a), 0) / top5.length;
	const star = (a: Attributes) => 0.5 * a.handle + 0.5 * a.shoot;
	off.heliocentric +=
		0.5 * (max(star) - mean(star)) - TEAM_TERM_MEAN.heliocentric;
	off.post +=
		0.5 * (max((a) => a.inside) - mean((a) => a.inside)) - TEAM_TERM_MEAN.post;
	def.switch +=
		0.4 * (min((a) => a.versatile) - mean((a) => a.versatile)) -
		TEAM_TERM_MEAN.switch;
	def.drop +=
		0.4 * (max((a) => a.rimProtect) - mean((a) => a.rimProtect)) -
		TEAM_TERM_MEAN.drop;

	// Relative to the roster's average fit, like playerSchemeFit (the team-level terms add a little on average, so recenter)
	const center = <T extends string>(x: Record<T, number>, keys: T[]) => {
		let m = 0;
		for (const k of keys) {
			m += x[k] / keys.length;
		}
		for (const k of keys) {
			x[k] -= m;
		}
	};
	center(off, OFFENSE_SYSTEMS);
	center(def, DEFENSE_SYSTEMS);
	// In standard deviations among teams, 0 for a typical team
	for (const s of OFFENSE_SYSTEMS) {
		off[s] = off[s] / OFFENSE_TEAM_SD[s] - OFFENSE_TEAM_MEAN[s];
	}
	for (const s of DEFENSE_SYSTEMS) {
		def[s] = def[s] / DEFENSE_TEAM_SD[s] - DEFENSE_TEAM_MEAN[s];
	}
	return { off, def };
};

type RosterFit = ReturnType<typeof rosterSchemeFit>;

// Fits relative to the league: for each system, in standard deviations among the league's teams (so "a good Pace & Space roster" means
// good compared with the other rosters in this league, whatever the era's players look like)
export const leagueRelativeFits = (fits: RosterFit[]): RosterFit[] => {
	const out = fits.map((f) => ({ off: { ...f.off }, def: { ...f.def } }));
	if (fits.length < 4) {
		return out;
	}
	const norm = <T extends string>(
		keys: T[],
		get: (f: RosterFit) => Record<T, number>,
	) => {
		for (const k of keys) {
			const xs = fits.map((f) => get(f)[k]);
			const m = xs.reduce((a, b) => a + b, 0) / xs.length;
			const sd =
				Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1;
			for (const o of out) {
				get(o)[k] = (get(o)[k] - m) / sd;
			}
		}
	};
	norm(OFFENSE_SYSTEMS, (f) => f.off);
	norm(DEFENSE_SYSTEMS, (f) => f.def);
	return out;
};

// Fit (in standard deviations) as a 0-100 score for display (50 = typical, 65 = 1 SD better)
export const fitToScore = (fit: number) =>
	Math.round(clamp(50 + 15 * fit, 0, 100));

export const fitLabel = (score: number) =>
	score >= 70
		? "Great fit"
		: score >= 57
			? "Good fit"
			: score >= 43
				? "Average fit"
				: score >= 30
					? "Poor fit"
					: "Bad fit";

// The systems a roster fits best
export const bestSystems = (fit: ReturnType<typeof rosterSchemeFit>) => {
	const off = OFFENSE_SYSTEMS.toSorted((a, b) => fit.off[b] - fit.off[a]);
	const def = DEFENSE_SYSTEMS.toSorted((a, b) => fit.def[b] - fit.def[a]);
	return { off, def };
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// Game sim effects

// Effects of scheme fit and coaching on the make probability: a team 1 SD better in fit makes this much more of its shots (and holds the
// other team to this much less, for the defense system)
export const FIT_MAKE_FACTOR = 0.004;
// Strengths: offense/defense ratings of the head coach and coordinator ((x - 50) / 15, bounded +-2): make probability per unit
export const STRENGTH_MAKE_FACTOR = 0.0015;
// A new system not yet installed costs this much (make probability, both ends) at the start
export const INSTALL_MAKE_PENALTY = 0.005;
// How far tendencies go in the first game with a new system (then ramp up to full)
export const INSTALL_START = 0.35;

const z = (x: number) => clamp((x - 50) / 15, -2, 2);

export type CoachSimInput = {
	profile: CoachProfile;
	head: CoachRatings;
	offCoord?: CoachRatings;
	defCoord?: CoachRatings;
	// 0-1, how far the system is installed
	install: number;
	// The roster's fit to the coach's systems (rosterSchemeFit, before league centering)
	offFit: number;
	defFit: number;
	style: CoachStyle;
};

// Blend a multiplier toward 1 (in log space)
const toward = (m: number, f: number) => m ** f;

export const coachSimEffects = ({
	profile,
	head,
	offCoord,
	defCoord,
	install,
	offFit,
	defFit,
	style,
}: CoachSimInput): CoachSim => {
	const o = OFFENSE_TABLE[profile.off];
	const d = DEFENSE_TABLE[profile.def];
	const k = clamp(install, 0, 1);
	const offStrength = z(0.6 * head.off + 0.4 * (offCoord?.off ?? 30));
	const defStrength = z(0.6 * head.def + 0.4 * (defCoord?.def ?? 30));
	const crash = profile.crash;
	const fouls = profile.fouls;
	// The old style dials still steer a little within the system
	const paceDial = 1 + 0.01 * style.pace;
	const threeDial = 1 + 0.04 * style.threes;
	return {
		off: profile.off,
		def: profile.def,
		three: toward(o.three * threeDial, k),
		mid: toward(o.mid, k),
		rim: toward(o.rim, k),
		post: toward(o.post, k),
		pace: toward(o.pace * d.pace * paceDial, k),
		transition: toward(o.transition * (1 - 0.1 * crash), k),
		usage: toward(o.usage, k),
		ast: toward(o.ast, k),
		tov: toward(o.tov, k),
		orb: toward(o.orb * (1 + 0.04 * crash), k),
		make:
			OFFENSE_MAKE_ADJ[profile.off] * k +
			FIT_MAKE_FACTOR * offFit * k +
			STRENGTH_MAKE_FACTOR * offStrength -
			INSTALL_MAKE_PENALTY * (1 - k),
		dThree: toward(d.three, k),
		dMid: toward(d.mid, k),
		dRim: toward(d.rim, k),
		dPost: toward(d.post, k),
		forceTov: toward(d.forceTov * (1 + 0.03 * fouls), k),
		stl: toward(d.stl * (1 + 0.03 * fouls), k),
		foul: toward(d.foul * (1 + 0.08 * fouls), k),
		orbAllowed: toward(d.orbAllowed, k),
		// Crashing the glass leaves the floor open the other way
		oppTransition: toward(d.oppTransition * (1 + 0.15 * crash), k),
		dMake:
			DEFENSE_MAKE_ADJ[profile.def] * k -
			FIT_MAKE_FACTOR * defFit * k -
			STRENGTH_MAKE_FACTOR * defStrength -
			0.004 * fouls +
			INSTALL_MAKE_PENALTY * (1 - k),
		clutchMake: 0.006 * z(profile.mgmt) + 0.003 * z(head.mot),
		clutchUsage: 1 + 0.35 * profile.closing,
		burnTimeout: profile.timeouts > 0.4,
		foulWindow: 27 + 6 * clamp((profile.mgmt - 50) / 30, -1, 1),
		temper: 1 + 0.25 * profile.personality,
	};
};

// League normalization: multiplicative keys divided by their mean over the league's teams, additive keys centered, so the league as
// a whole plays like it would without coaching systems while teams differ
export const normalizeCoachSims = (sims: CoachSim[]) => {
	if (sims.length === 0) {
		return sims;
	}
	const out = sims.map((s) => ({ ...s }));
	for (const key of COACH_SIM_MULT_KEYS) {
		let g;
		if (key === "foul") {
			// (free throws grow faster than linearly with fouls, through the bonus: a quadratic mean keeps league free throws the same)
			let sumSq = 0;
			for (const s of sims) {
				sumSq += s[key] ** 2;
			}
			g = Math.sqrt(sumSq / sims.length);
		} else {
			// (the probabilities they multiply are about linear in them, so an arithmetic mean)
			let sum = 0;
			for (const s of sims) {
				sum += s[key];
			}
			g = sum / sims.length;
		}
		for (const s of out) {
			s[key] /= g;
		}
	}
	// (game management: how late teams start fouling, centered on the stock 27 seconds)
	{
		let sum = 0;
		for (const s of sims) {
			sum += s.foulWindow;
		}
		const m = sum / sims.length;
		for (const s of out) {
			s.foulWindow += 27 - m;
		}
	}
	for (const key of COACH_SIM_ADD_KEYS) {
		let sum = 0;
		for (const s of sims) {
			sum += s[key];
		}
		const m = sum / sims.length;
		for (const s of out) {
			s[key] -= m;
		}
	}
	return out;
};

// Playoff adjustments: a coach trailing in a series shifts his shot mix toward what the other defense concedes and his defense toward taking
// away what the other offense likes, more so the more adaptable he is and the further behind
export const seriesAdjustment = (
	own: CoachSim,
	opp: CoachSim,
	adapt: number,
	gamesBehind: number,
): CoachSim => {
	if (gamesBehind <= 0) {
		return own;
	}
	const a = clamp(adapt / 100, 0, 1) * Math.min(1, gamesBehind / 2);
	const toward2 = (mine: number, theirs: number, f: number) =>
		mine * theirs ** f;
	return {
		...own,
		three: toward2(own.three, opp.dThree, 0.6 * a),
		mid: toward2(own.mid, opp.dMid, 0.6 * a),
		rim: toward2(own.rim, opp.dRim, 0.6 * a),
		post: toward2(own.post, opp.dPost, 0.6 * a),
		dThree: toward2(own.dThree, 1 / opp.three, 0.4 * a),
		dMid: toward2(own.dMid, 1 / opp.mid, 0.4 * a),
		dRim: toward2(own.dRim, 1 / opp.rim, 0.4 * a),
		dPost: toward2(own.dPost, 1 / opp.post, 0.4 * a),
		// (a small bump from the adjustments working)
		make: own.make + 0.003 * a,
	};
};

// ---------------------------------------------------------------------------------------------------------------------------------------
// Descriptions

export const dialText = (
	value: number,
	low: string,
	high: string,
	mid = "Balanced",
) => (value >= 0.35 ? high : value <= -0.35 ? low : mid);

export const describeProfile = (p: CoachProfile) => ({
	offense: OFFENSE_NAMES[p.off],
	defense: DEFENSE_NAMES[p.def],
	background: BACKGROUND_NAMES[p.background],
	glass: dialText(p.crash, "Gets back in transition", "Crashes the glass"),
	fouls: dialText(p.fouls, "Disciplined, few fouls", "Physical, lots of fouls"),
	closing: dialText(
		p.closing,
		"Closes with the system",
		"Gives the ball to the star late",
	),
	timeouts: dialText(p.timeouts, "Saves timeouts", "Quick timeout trigger"),
	youth: dialText(p.youth, "Trusts veterans", "Trusts young players"),
	rest: dialText(
		p.rest,
		"Rides his starters",
		"Rests players on back-to-backs",
	),
	philosophy: dialText(
		p.philosophy,
		"Win now",
		"Player development",
		"Balances winning and development",
	),
	personality: dialText(
		p.personality,
		"Disciplinarian",
		"Players' coach",
		"Even-keeled",
	),
});

export const strengthNames = {
	off: "Offense",
	def: "Defense",
	dev: "Development",
	mgmt: "Game management",
	mot: "Motivation",
};

export const systemLabel = (off: OffenseSystem, def: DefenseSystem) =>
	`${OFFENSE_NAMES[off]} / ${DEFENSE_NAMES[def]}`;
