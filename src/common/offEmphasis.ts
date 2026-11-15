// Offensive Emphasis (League Extras: featureOffEmphasis, basketball, needs Realistic Play Types; see docs/native-features.md). Each
// team leans its offense toward some play types: six dials from -1 to 1 (pick-and-roll, isolation, post-ups, spot-up and movement
// shooting, transition/pace, inside vs outside). The dials scale the realistic play-type decisions in the game sim (bounded: no play
// type's share moves more than about 30%, pace about 3%), and how well they fit the roster's play-type strengths moves the make
// probability a little (a strong fit about +1.5 net rating, a clear mismatch about as much below). Auto: the head coach picks them from
// his offense system (Coaching Systems) and the roster. Pure functions, used by the worker, the UI and the tests.

export type EmphasisKey = "pnr" | "iso" | "post" | "spot" | "pace" | "inside";

export type Emphasis = Record<EmphasisKey, number>;

export const EMPHASIS_KEYS: EmphasisKey[] = [
	"pnr",
	"iso",
	"post",
	"spot",
	"pace",
	"inside",
];

export const EMPHASIS_NAMES: Record<EmphasisKey, string> = {
	pnr: "Pick-and-roll",
	iso: "Isolation",
	post: "Post-ups",
	spot: "Spot-up & movement shooting",
	pace: "Transition & pace",
	inside: "Inside vs outside",
};

export const EMPHASIS_HINTS: Record<EmphasisKey, [string, string]> = {
	pnr: ["Fewer ball screens", "More ball screens"],
	iso: ["Move the ball", "Clear out for scorers"],
	post: ["Stay out of the post", "Feed the post"],
	spot: ["Fewer catch-and-shoot looks", "More spot-ups and off-screen threes"],
	pace: ["Walk it up", "Push every miss"],
	inside: ["Live outside", "Attack the paint"],
};

export type EmphasisPreset =
	| "balanced"
	| "fiveOut"
	| "paceSpace"
	| "postCentric"
	| "heliocentric"
	| "motion";

export const PRESET_NAMES: Record<EmphasisPreset, string> = {
	balanced: "Balanced",
	fiveOut: "Five-out",
	paceSpace: "Pace and space",
	postCentric: "Post-centric",
	heliocentric: "Heliocentric star",
	motion: "Motion",
};

export const PRESETS: Record<EmphasisPreset, Emphasis> = {
	balanced: { pnr: 0, iso: 0, post: 0, spot: 0, pace: 0, inside: 0 },
	fiveOut: { pnr: 0.3, iso: 0, post: -1, spot: 0.9, pace: 0.2, inside: -0.6 },
	paceSpace: {
		pnr: 0.4,
		iso: -0.2,
		post: -0.6,
		spot: 0.5,
		pace: 1,
		inside: -0.3,
	},
	postCentric: {
		pnr: -0.4,
		iso: 0,
		post: 1,
		spot: -0.3,
		pace: -0.5,
		inside: 0.8,
	},
	heliocentric: {
		pnr: 0.9,
		iso: 0.7,
		post: -0.4,
		spot: 0.3,
		pace: -0.2,
		inside: 0,
	},
	motion: {
		pnr: -0.5,
		iso: -0.8,
		post: 0.2,
		spot: 0.6,
		pace: 0.2,
		inside: 0.3,
	},
};

export const PRESET_KEYS = Object.keys(PRESETS) as EmphasisPreset[];

export const NEUTRAL_EMPHASIS: Emphasis = PRESETS.balanced;

export type EmphasisMode = "auto" | "suggest" | "manual";

// Stored on the team (t.offEmphasis)
export type OffEmphasisTeam = {
	mode: EmphasisMode;
	// The dials the team plays with (auto: the coach's, refreshed weekly; manual: the user's)
	e: Emphasis;
	// Suggest: the coach's latest proposal, waiting for the user
	suggested?: Emphasis;
	// When the coach last set it (season, day), for auto refreshes
	set?: { season: number; day: number };
};

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export const clampEmphasis = (e: Partial<Emphasis>): Emphasis => {
	const out = { ...NEUTRAL_EMPHASIS };
	for (const key of EMPHASIS_KEYS) {
		const v = Number(e[key]);
		out[key] = Number.isFinite(v) ? Math.round(clamp(v, -1, 1) * 100) / 100 : 0;
	}
	return out;
};

// The preset closest to a set of dials (for labels)
export const nearestPreset = (e: Emphasis): EmphasisPreset => {
	const norm = (x: Emphasis) =>
		Math.sqrt(EMPHASIS_KEYS.reduce((acc, k) => acc + x[k] ** 2, 0));
	const n = norm(e);
	// Small dials are a balanced offense; otherwise the preset pointing the most the same way
	if (n < 0.35) {
		return "balanced";
	}
	let best: EmphasisPreset = "balanced";
	let bestCos = 0.3;
	for (const key of PRESET_KEYS) {
		if (key === "balanced") {
			continue;
		}
		const p = PRESETS[key];
		const cos =
			EMPHASIS_KEYS.reduce((acc, k) => acc + p[k] * e[k], 0) / (norm(p) * n);
		if (cos > bestCos) {
			bestCos = cos;
			best = key;
		}
	}
	return best;
};

// ---- Roster strengths ----

// Raw ratings of a rotation player (the GameSim's pbpRatings or a ratings row)
export type EmphasisRatings = {
	hgt: number;
	stre: number;
	spd: number;
	jmp: number;
	ins: number;
	dnk: number;
	fg: number;
	tp: number;
	oiq: number;
	drb: number;
	pss: number;
};

// Rotation weights of the top players (by value)
const ROTATION_W = [1, 1, 1, 1, 1, 0.8, 0.6, 0.45, 0.3];

// League norms of the raw strengths (means and SDs over 120 generated rosters, `OE_NORMS=1 offEmphasis.script.test.ts` prints them)
export const STRENGTH_NORMS: Record<EmphasisKey, [number, number]> = {
	pnr: [58.6, 3.3],
	iso: [57.7, 3.8],
	post: [58.7, 4.1],
	spot: [46.8, 3.9],
	pace: [59.0, 4.6],
	inside: [-1.2, 5.4],
};

const top2 = (xs: number[]) => {
	const s = xs.toSorted((a, b) => b - a);
	return ((s[0] ?? 50) + (s[1] ?? s[0] ?? 50)) / 2;
};

// Raw play-type strengths of a rotation (players sorted best first)
export const rawStrengths = (players: EmphasisRatings[]) => {
	const rot = players.slice(0, ROTATION_W.length);
	let wSum = 0;
	let spot = 0;
	let pace = 0;
	let inside = 0;
	for (const [i, r] of rot.entries()) {
		const w = ROTATION_W[i]!;
		wSum += w;
		spot += w * r.tp;
		pace += (w * (r.spd + r.jmp)) / 2;
		inside += w * ((r.ins + r.dnk) / 2 - r.tp);
	}
	wSum = Math.max(wSum, 1e-9);
	const handler = top2(rot.map((r) => (r.drb + r.pss + r.oiq) / 3));
	const roller = Math.max(
		50,
		...rot.map((r) => (r.hgt + r.dnk + r.jmp) / 3 + (r.hgt >= 55 ? 3 : -3)),
	);
	return {
		pnr: 0.65 * handler + 0.35 * roller,
		iso: top2(rot.map((r) => (r.drb + r.fg + r.spd + r.oiq) / 4)),
		post: top2(rot.map((r) => (r.ins + r.hgt + r.stre) / 3)),
		spot: spot / wSum,
		pace: pace / wSum,
		inside: inside / wSum,
	} satisfies Emphasis;
};

// Play-type strengths of a rotation in league standard deviations (each about -2 ... 2)
export type StrengthNorms = Record<EmphasisKey, [number, number]>;

// Norms from the league's own rosters (each team's raw strengths), so a strength means the same in any league or era; the built-in norms
// when there are too few teams
export const leagueNorms = (raws: Emphasis[]): StrengthNorms => {
	if (raws.length < 6) {
		return STRENGTH_NORMS;
	}
	const out = { ...STRENGTH_NORMS };
	for (const key of EMPHASIS_KEYS) {
		const xs = raws.map((r) => r[key]);
		const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
		const sd = Math.sqrt(
			xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length,
		);
		out[key] = [mean, Math.max(sd, 0.5 * STRENGTH_NORMS[key][1])];
	}
	return out;
};

export const rosterStrengths = (
	players: EmphasisRatings[],
	norms: StrengthNorms = STRENGTH_NORMS,
): Emphasis => {
	const raw = rawStrengths(players);
	const out = { ...NEUTRAL_EMPHASIS };
	for (const key of EMPHASIS_KEYS) {
		const [m, sd] = norms[key];
		out[key] = clamp((raw[key] - m) / sd, -2.5, 2.5);
	}
	return out;
};

// ---- Fit ----

// How well the dials fit the strengths: the emphasis-weighted average strength (SDs). Leaning into strengths is positive, leaning into
// weaknesses negative; a neutral emphasis is 0. Bounded to +-1.5
export const emphasisFit = (e: Emphasis, z: Emphasis) => {
	let num = 0;
	let den = 0;
	for (const key of EMPHASIS_KEYS) {
		num += e[key] * z[key];
		den += Math.abs(e[key]);
	}
	return clamp(num / Math.max(1.5, den), -1.5, 1.5);
};

// Make probability per unit of fit, and the league's average fit with every team on auto (subtracted, so league totals stay put)
export const FIT_MAKE = 0.008;
export const AUTO_FIT_MEAN = 0.76;
// What a league of coaches matching their dials to their rosters gains from the play-type mix alone (more threes for good shooting
// teams, more post-ups for good post teams ...), measured in long runs and taken back from every team with an emphasis
export const MIX_GAIN = 0.004;

export const fitLabel = (fit: number) =>
	fit >= 0.8
		? "Strong fit"
		: fit >= 0.35
			? "Good fit"
			: fit > -0.2
				? "Neutral"
				: fit > -0.6
					? "Poor fit"
					: "Mismatch";

// ---- Auto: the coach's choice ----

// The dials each Coaching Systems offense leans to (a coach without a profile: balanced)
export const OFFENSE_SYSTEM_EMPHASIS: Record<string, Emphasis> = {
	motion: PRESETS.motion,
	paceSpace: PRESETS.paceSpace,
	heliocentric: PRESETS.heliocentric,
	post: PRESETS.postCentric,
	iso: { pnr: 0.2, iso: 1, post: 0, spot: 0, pace: -0.3, inside: 0.1 },
	princeton: {
		pnr: -0.6,
		iso: -0.6,
		post: 0.5,
		spot: 0.4,
		pace: -0.4,
		inside: 0.4,
	},
	sevenSeconds: {
		pnr: 0.5,
		iso: -0.2,
		post: -0.6,
		spot: 0.4,
		pace: 1,
		inside: -0.2,
	},
};

// The systems' average leaning, taken out so that a league of coaches on auto is centered (league totals stay put)
const SYSTEM_MEAN: Emphasis = (() => {
	const out = { ...NEUTRAL_EMPHASIS };
	const systems = Object.values(OFFENSE_SYSTEM_EMPHASIS);
	for (const key of EMPHASIS_KEYS) {
		out[key] = systems.reduce((a, e) => a + e[key], 0) / systems.length;
	}
	return out;
})();

// The coach's dials: his system's leanings (centered over the systems) and the roster's strengths (centered over the league by the norms)
export const autoEmphasis = (
	z: Emphasis,
	offenseSystem: string | undefined,
): Emphasis => {
	const sys =
		(offenseSystem !== undefined
			? OFFENSE_SYSTEM_EMPHASIS[offenseSystem]
			: undefined) ?? NEUTRAL_EMPHASIS;
	const w = offenseSystem !== undefined ? 0.45 : 0;
	const out = { ...NEUTRAL_EMPHASIS };
	for (const key of EMPHASIS_KEYS) {
		out[key] =
			Math.round(
				clamp(
					w *
						(sys[key] - (offenseSystem !== undefined ? SYSTEM_MEAN[key] : 0)) +
						(1 - w) * 0.55 * z[key],
					-1,
					1,
				) * 100,
			) / 100;
	}
	return out;
};

// ---- In the sim ----

export type EmphasisSim = {
	// Realistic Play Types decisions
	selfCreate: number; // chance a non-creator shooter creates for himself (P&R ball handler / isolation)
	post: number; // post draw of the two-point shot selection
	rim: number; // at-rim draw (drives, cuts, rolls)
	mid: number; // mid-range draw
	three: number; // three-point draw of shots created by someone else (catch-and-shoot)
	selfThree: number; // three-point draw of self-created shots (pull-ups)
	transition: number; // transition chance
	halfCourt: number; // half-court search time (pace)
	// The classifier's reading of the same plays (Advanced Tracking Stats): handler isolation vs pick-and-roll, movement shooters
	iso: number;
	prb: number;
	move: number;
	// Fit: additive make probability
	make: number;
	fit: number;
};

export const NEUTRAL_EMPHASIS_SIM: EmphasisSim = {
	selfCreate: 1,
	post: 1,
	rim: 1,
	mid: 1,
	three: 1,
	selfThree: 1,
	transition: 1,
	halfCourt: 1,
	iso: 1,
	prb: 1,
	move: 1,
	make: 0,
	fit: 0,
};

// Bounds on every multiplier (a play type's share moves at most about 30%)
export const SIM_BOUND = 0.3;

const m = (x: number) => clamp(1 + x, 1 - SIM_BOUND, 1 + SIM_BOUND);

// autoFitMean: the league's average fit with every team on its coach's dials (the worker measures it; AUTO_FIT_MEAN without a league)
export const emphasisSim = (
	e: Emphasis,
	fit: number,
	autoFitMean = AUTO_FIT_MEAN,
): EmphasisSim => ({
	selfCreate: m(0.22 * e.pnr + 0.14 * e.iso - 0.08 * e.spot),
	post: m(0.13 * e.post + 0.03 * e.inside),
	rim: m(0.14 * e.inside - 0.04 * e.post),
	mid: m(-0.08 * e.inside - 0.06 * e.spot + 0.06 * e.iso),
	three: m(0.12 * e.spot - 0.12 * e.inside),
	selfThree: m(0.06 * e.pnr + 0.04 * e.iso - 0.12 * e.inside),
	transition: m(0.22 * e.pace),
	halfCourt: clamp(1 - 0.02 * e.pace, 0.96, 1.04),
	iso: m(0.3 * e.iso - 0.12 * e.pnr),
	prb: m(0.12 * e.pnr - 0.12 * e.iso),
	move: m(0.3 * e.spot),
	make: FIT_MAKE * (fit - autoFitMean) - MIX_GAIN,
	fit,
});

// ---- Staff Report ----

export type PlayTypePpp = Partial<
	Record<
		"prb" | "iso" | "post" | "spot" | "tr" | "offs" | "prr",
		{ freq: number; ppp: number; poss: number }
	>
>;

// The emphasis dial that drives each play type the report talks about
const PT_FOR_KEY: { key: EmphasisKey; pt: keyof PlayTypePpp; name: string }[] =
	[
		{ key: "pnr", pt: "prb", name: "PnR" },
		{ key: "iso", pt: "iso", name: "isolation" },
		{ key: "post", pt: "post", name: "post-ups" },
		{ key: "spot", pt: "spot", name: "spot-ups" },
		{ key: "pace", pt: "tr", name: "transition" },
	];

// One recommendation: the play type the roster scores best (or worst) on relative to the league and how much it runs it
export const emphasisRecommendation = (
	team: PlayTypePpp,
	league: PlayTypePpp,
	e: Emphasis,
	z: Emphasis,
): { key: EmphasisKey; dir: 1 | -1; text: string } | undefined => {
	let best:
		| { key: EmphasisKey; dir: 1 | -1; score: number; text: string }
		| undefined;
	for (const { key, pt, name } of PT_FOR_KEY) {
		const t = team[pt];
		const l = league[pt];
		if (!t || !l || t.poss < 150) {
			continue;
		}
		// (shrunk toward the league on small samples)
		const pppEdge = ((t.ppp - l.ppp) * t.poss) / (t.poss + 300);
		// What the stats and the ratings say together
		const edge = pppEdge / 0.08 + 0.5 * z[key];
		const share = t.freq / Math.max(l.freq, 0.1);
		if (edge > 0.6 && e[key] < 0.6 && share < 1.15) {
			const score = edge - e[key];
			if (!best || score > best.score) {
				best = {
					key,
					dir: 1,
					score,
					text: `Your roster scores ${t.ppp.toFixed(2)} PPP in ${name} (league ${l.ppp.toFixed(2)}) but runs it ${t.freq.toFixed(0)}% of the time; suggest more ${name}.`,
				};
			}
		} else if (edge < -0.6 && e[key] > -0.6 && share > 0.85) {
			const score = -edge + e[key];
			if (!best || score > best.score) {
				best = {
					key,
					dir: -1,
					score,
					text: `Your roster scores only ${t.ppp.toFixed(2)} PPP in ${name} (league ${l.ppp.toFixed(2)}) yet runs it ${t.freq.toFixed(0)}% of the time; suggest less ${name}.`,
				};
			}
		}
	}
	return best ? { key: best.key, dir: best.dir, text: best.text } : undefined;
};
