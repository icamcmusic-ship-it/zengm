// Shot Profiles & Defensive Schemes (League Extra featureShotProfiles, basketball, see docs/native-features.md): pure helpers shared by
// the worker and the UI. A coach-set shot profile per player (bounded multipliers on his shot-type weights, with a small make cost when it
// goes against his ratings) and a defensive scheme per team (bounded multipliers on the offense's shot mix and a few makes). No random draws.

export type ShotProfile = "normal" | "three" | "rim" | "noPost" | "mid";
export type DefScheme =
	| "standard"
	| "drop"
	| "ice"
	| "blitz"
	| "zone"
	| "runOff";

export const SHOT_PROFILES: ShotProfile[] = [
	"normal",
	"three",
	"rim",
	"noPost",
	"mid",
];
export const SHOT_PROFILE_NAMES: Record<ShotProfile, string> = {
	normal: "Normal",
	three: "Hunt threes",
	rim: "Attack the rim",
	noPost: "Stay out of the post",
	mid: "Mid-range green light",
};
export const SHOT_PROFILE_ABBREVS: Record<ShotProfile, string> = {
	normal: "Norm",
	three: "3PT",
	rim: "Rim",
	noPost: "NoPost",
	mid: "Mid",
};

export const DEF_SCHEMES: DefScheme[] = [
	"standard",
	"drop",
	"ice",
	"blitz",
	"zone",
	"runOff",
];
export const DEF_SCHEME_NAMES: Record<DefScheme, string> = {
	standard: "Standard",
	drop: "Drop",
	ice: "ICE",
	blitz: "Blitz / hedge",
	zone: "Zone",
	runOff: "Run them off the line",
};
export const DEF_SCHEME_DESCRIPTIONS: Record<DefScheme, string> = {
	standard: "Mixed coverages, no tilt.",
	drop: "The big sits back on pick-and-rolls: fewer drives, more pull-up mid-range jumpers. Needs a rim protector.",
	ice: "Force the ball handler away from the screen and to the sideline: fewer pull-up threes and drives off the pick-and-roll, more long twos. Needs quick guards and a mobile big.",
	blitz:
		"Trap the ball handler: the star pulls up less and gives it up, so teammates get more open threes and short rolls; more turnovers both ways. Needs athletes.",
	zone: "Protect the paint: fewer drives and post-ups, more threes allowed, and worse defensive rebounding.",
	runOff:
		"Close out hard and take away the three: fewer threes, more drives. Needs quick perimeter defenders.",
};

// Multipliers on the shot-type weights (≤ ±30%)
type Mix = { three: number; mid: number; rim: number; post: number };
export const PROFILE_MIX: Record<ShotProfile, Mix> = {
	normal: { three: 1, mid: 1, rim: 1, post: 1 },
	three: { three: 1.3, mid: 0.8, rim: 1, post: 0.8 },
	rim: { three: 0.85, mid: 0.85, rim: 1.3, post: 1 },
	noPost: { three: 1, mid: 1.1, rim: 1.05, post: 0.7 },
	mid: { three: 0.9, mid: 1.3, rim: 1, post: 0.9 },
};

// Fit cost: when a profile forces the shot type he is pushed toward and his rating for it is below ref, that shot type gets
// -slope x (ref - rating) on its make (at most about 2.5 points)
export const PROFILE_FIT = { ref: 0.5, slope: 0.06, max: 0.025 };
// Calibration: players taking more of their best shots makes offenses a little better, so every shot gets this (league scoring stays put)
export const PROFILE_LEAGUE_MAKE = -0.007;
const favored: Record<ShotProfile, keyof Mix | undefined> = {
	normal: undefined,
	three: "three",
	rim: "rim",
	noPost: "mid",
	mid: "mid",
};

type ShotRatings = {
	three: number;
	mid: number;
	rim: number;
	post: number;
};

// The make penalty for this shot type (≥ 0, subtracted)
export const profileMakePenalty = (
	profile: ShotProfile | undefined,
	type: keyof Mix,
	r: ShotRatings,
) => {
	if (!profile || favored[profile] !== type) {
		return 0;
	}
	return Math.min(
		PROFILE_FIT.max,
		PROFILE_FIT.slope * Math.max(0, PROFILE_FIT.ref - r[type]),
	);
};

// The rotation's shooting composites (mean, sd) in generated leagues: the AI coach's profile goes by how a player's shooting stands out
export const SHOT_PROFILE_NORMS = {
	three: [0.45, 0.1],
	mid: [0.54, 0.15],
	rim: [0.47, 0.11],
	post: [0.45, 0.07],
} as const;

// The AI coach's profile from a player's shooting composites (0-1)
export const aiShotProfile = (r: ShotRatings): ShotProfile => {
	const z = (k: keyof ShotRatings) =>
		(r[k] - SHOT_PROFILE_NORMS[k][0]) / SHOT_PROFILE_NORMS[k][1];
	const zt = z("three");
	const zm = z("mid");
	const zr = z("rim");
	if (zt >= 0.8 && zt >= zm && zt >= zr) {
		return "three";
	}
	if (zr >= 0.8 && zr >= zm && zt < 0.3) {
		return "rim";
	}
	if (zm >= 0.8 && zt < 0.5) {
		return "mid";
	}
	if (z("post") <= -1) {
		return "noPost";
	}
	return "normal";
};

// ---- Defensive schemes ----

type SchemeEffect = {
	// Shot mix: self-created (pull-ups, drives off the dribble) and off a pass
	self: Mix;
	other: Mix;
	// The blitz: extra multipliers on the star's self-created three and mid, on top of self
	starThree: number;
	starMid: number;
	// Make deltas for the offense
	makeThreeOther: number;
	makeThreeSelf: number;
	makeMid: number;
	makeRim: number;
	// Turnovers (offense's chance) and the offense's offensive rebounds
	tov: number;
	orb: number;
};
const ONE: Mix = { three: 1, mid: 1, rim: 1, post: 1 };
const base = (x: Partial<SchemeEffect>): SchemeEffect => ({
	self: ONE,
	other: ONE,
	starThree: 1,
	starMid: 1,
	makeThreeOther: 0,
	makeThreeSelf: 0,
	makeMid: 0,
	makeRim: 0,
	tov: 1,
	orb: 1,
	...x,
});
export const SCHEME_EFFECTS: Record<DefScheme, SchemeEffect> = {
	standard: base({}),
	drop: base({
		self: { three: 1.05, mid: 1.2, rim: 0.88, post: 1 },
		makeMid: 0.005,
		makeRim: -0.008,
	}),
	ice: base({
		self: { three: 0.82, mid: 1.25, rim: 0.88, post: 1 },
		makeThreeSelf: -0.005,
	}),
	blitz: base({
		self: { three: 1, mid: 1, rim: 1.05, post: 1 },
		other: { three: 1.1, mid: 0.95, rim: 1.1, post: 0.9 },
		starThree: 0.75,
		starMid: 0.8,
		makeThreeOther: 0.008,
		tov: 1.06,
	}),
	zone: base({
		self: { three: 1.12, mid: 1.05, rim: 0.82, post: 0.75 },
		other: { three: 1.15, mid: 1.05, rim: 0.85, post: 0.75 },

		orb: 1.04,
	}),
	runOff: base({
		self: { three: 0.85, mid: 1, rim: 1.15, post: 1 },
		other: { three: 0.8, mid: 1.05, rim: 1.15, post: 1 },
		makeThreeOther: -0.008,
		makeRim: -0.004,
	}),
};

// Matchup-aware (simple): the tilt away from the threes or the rim is scaled by how quick his defender is relative to average (0.75-1.25)
export const schemeMatchupScale = (defenderSpd: number | undefined) =>
	defenderSpd === undefined
		? 1
		: Math.min(1.25, Math.max(0.75, 1 + (defenderSpd - 0.5)));

// Applies the scale to a multiplier's distance from 1
export const scaleTilt = (m: number, scale: number) => 1 + (m - 1) * scale;

type DefRatings = {
	hgt: number;
	spd: number;
	jmp: number;
	diq: number;
	stre: number;
};

// The roster's defensive traits that steer the AI coach's scheme, from his top 8 healthy players' ratings (0-100), best first
export const defSchemeInputs = (rows: DefRatings[]) => {
	const top = rows.slice(0, 8);
	if (top.length < 5) {
		return undefined;
	}
	const avg = (f: (r: DefRatings) => number, xs = top) =>
		xs.reduce((sum, r) => sum + f(r), 0) / xs.length;
	const bigs = top.toSorted((a, b) => b.hgt - a.hgt).slice(0, 2);
	const guards = top.toSorted((a, b) => a.hgt - b.hgt).slice(0, 4);
	return {
		rimProt: Math.max(
			...bigs.map((r) => 0.5 * r.hgt + 0.25 * r.jmp + 0.25 * r.diq),
		),
		bigMobile: avg((r) => r.spd, bigs),
		guardQuick: avg((r) => 0.6 * r.spd + 0.4 * r.diq, guards),
		athletic: avg((r) => (r.spd + r.jmp + r.stre) / 3),
		iq: avg((r) => r.diq),
	};
};

// Centers and spreads of the inputs over generated leagues (so each scheme is the coach's pick for a share of teams)
export const DEF_SCHEME_NORMS = {
	rimProt: [55, 3.7],
	bigMobile: [51, 8.8],
	guardQuick: [54, 3.4],
	athletic: [57, 3.1],
	iq: [37, 2.5],
} as const;

// The AI coach's scheme: the one whose strengths the roster has most (Standard unless one stands out)
export const aiDefScheme = (rows: DefRatings[]): DefScheme => {
	const x = defSchemeInputs(rows);
	if (!x) {
		return "standard";
	}
	const z = (k: keyof typeof DEF_SCHEME_NORMS) =>
		(x[k] - DEF_SCHEME_NORMS[k][0]) / DEF_SCHEME_NORMS[k][1];
	const scores: Record<DefScheme, number> = {
		standard: 0.6,
		drop: z("rimProt") - 0.5 * z("bigMobile"),
		ice: 0.6 * z("guardQuick") + 0.6 * z("bigMobile"),
		blitz: z("athletic"),
		zone: -z("iq") - 0.3 * z("athletic"),
		runOff: z("guardQuick") - 0.3 * z("rimProt"),
	};
	let best: DefScheme = "standard";
	for (const scheme of DEF_SCHEMES) {
		if (scores[scheme] > scores[best]) {
			best = scheme;
		}
	}
	return best;
};
