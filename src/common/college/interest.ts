// College mode: the recruiting interest model (recruiting v2, docs/college-mode.md). Pure functions, shared by the worker (weekly
// recruiting, the transfer portal) and the tests.

// What a recruit can be sold on
export const PITCHES = [
	"pt",
	"prestige",
	"proximity",
	"coach",
	"winning",
	"nil",
] as const;
export type Pitch = (typeof PITCHES)[number];

export const PITCH_NAMES: Record<Pitch, string> = {
	pt: "Playing time",
	prestige: "Program prestige",
	proximity: "Close to home",
	coach: "Coach quality",
	winning: "Winning",
	nil: "NIL",
};

// How much a recruit cares about each pitch: weights that add up to 1
export type Prefs = Record<Pitch, number>;
// How good a school is at each pitch, for one recruit: 0 to 1
export type Grades = Record<Pitch, number>;

export type RecruitAction =
	| "scout"
	| "contact"
	| "homeVisit"
	| "officialVisit"
	| "offer"
	| "retain";

export const ACTIONS: Record<
	RecruitAction,
	{ name: string; cost: number; effort: number; pitch: boolean }
> = {
	scout: { name: "Scout", cost: 4, effort: 0, pitch: false },
	contact: { name: "Contact", cost: 3, effort: 3, pitch: true },
	homeVisit: { name: "Home visit", cost: 10, effort: 9, pitch: true },
	officialVisit: { name: "Official visit", cost: 18, effort: 18, pitch: true },
	offer: { name: "Offer", cost: 0, effort: 8, pitch: false },
	// The user's own players in the transfer portal
	retain: { name: "Retention pitch", cost: 8, effort: 14, pitch: true },
};

// Interest at which a recruit commits to the school he likes best (if it offered him a scholarship and has a spot)
export const COMMIT_THRESHOLD = 50;
// He commits only when that school leads the next one by this factor
export const COMMIT_LEAD = 1.15;
// A committed recruit reopens his recruitment when another school passes his school by this factor
export const DECOMMIT_FACTOR = 1.4;
// Weekly decay of a school's interest when it did nothing for him that week
export const WEEKLY_DECAY = 0.9;
// Interest a school gains every week from its fit alone (word of mouth), if he is already following it
export const PASSIVE_GAIN = 2;
export const MAX_INTEREST = 400;
// NIL money (in thousands) that maxes out the NIL grade
export const NIL_FULL = 25;

/**
 * Random preferences: a flat Dirichlet, so most recruits care about two or three things a lot.
 */
export const genPrefs = (random: () => number = Math.random): Prefs => {
	const raw = PITCHES.map(() => -Math.log(1 - random() * 0.999999));
	const sum = raw.reduce((a, b) => a + b, 0);
	const prefs = {} as Prefs;
	for (const [i, key] of PITCHES.entries()) {
		prefs[key] = Math.round((raw[i]! / sum) * 1000) / 1000;
	}
	return prefs;
};

/**
 * How well a school matches what a recruit wants, 0 to 1.
 */
export const fit = (prefs: Prefs, grades: Grades) => {
	let total = 0;
	for (const key of PITCHES) {
		total += prefs[key] * grades[key];
	}
	return total;
};

/**
 * The pitch that works best on this recruit for this school.
 */
export const bestPitch = (prefs: Prefs, grades: Grades): Pitch => {
	let best: Pitch = "prestige";
	let bestValue = -1;
	for (const key of PITCHES) {
		const value = prefs[key] * grades[key];
		if (value > bestValue) {
			best = key;
			bestValue = value;
		}
	}
	return best;
};

/**
 * Interest gained from one action: the effort of the action, more for schools he likes, and much more with a pitch on something he cares
 * about that the school is good at.
 */
export const actionGain = (
	action: RecruitAction,
	prefs: Prefs,
	grades: Grades,
	pitch?: Pitch,
) => {
	const info = ACTIONS[action];
	if (info.effort === 0) {
		return 0;
	}
	const base = info.effort * (0.4 + 1.2 * fit(prefs, grades));
	if (!info.pitch || !pitch) {
		return base;
	}
	// An average pitch (weight 1/6, grade 0.5) is worth x0.75, the perfect one up to x3.5
	return base * (0.5 + 3 * prefs[pitch] * grades[pitch]);
};

/**
 * A week passes: interest decays for the schools that did nothing, every school he follows gains a little from its fit.
 */
export const weeklyUpdate = (
	interest: number,
	{ active, fitValue }: { active: boolean; fitValue: number },
) =>
	addInterest(
		active ? interest : interest * WEEKLY_DECAY,
		PASSIVE_GAIN * fitValue,
	);

/**
 * Add a gain to an interest: the closer to the maximum, the less it adds.
 */
export const addInterest = (interest: number, gain: number) =>
	Math.min(
		MAX_INTEREST,
		interest + gain * Math.max(0, 1 - interest / MAX_INTEREST),
	);

export type SchoolInterest = {
	tid: number;
	// Interest, 0 to MAX_INTEREST
	i: number;
	// Offered a scholarship
	o?: boolean;
	// Official visit used
	v?: boolean;
	// Did something for him this week
	a?: boolean;
	// NIL money promised (thousands)
	nil?: number;
};

/**
 * Who he commits to this week, if anyone: the school he likes best, if it offered, has a spot, is past the threshold and leads enough.
 */
// The lead he needs shrinks as the weeks go by (he wants to settle before signing day)
export const commitLead = (week: number) =>
	Math.max(1.03, COMMIT_LEAD - 0.008 * week);

export const pickCommit = (
	schools: SchoolInterest[],
	hasSpot: (tid: number) => boolean,
	week = 0,
): number | undefined => {
	const sorted = [...schools].sort((a, b) => b.i - a.i);
	const first = sorted[0];
	if (!first || !first.o || first.i < COMMIT_THRESHOLD) {
		return undefined;
	}
	const second = sorted[1]?.i ?? 0;
	if (first.i < commitLead(week) * second) {
		return undefined;
	}
	return hasSpot(first.tid) ? first.tid : undefined;
};

/**
 * Does a committed recruit reopen his recruitment? When his school pulled the offer, or another school has passed it by far.
 */
export const shouldDecommit = (
	schools: SchoolInterest[],
	commitTid: number,
) => {
	const committed = schools.find((s) => s.tid === commitTid);
	if (!committed || !committed.o) {
		return true;
	}
	return schools.some(
		(s) =>
			s.tid !== commitTid &&
			s.o &&
			s.i >= COMMIT_THRESHOLD &&
			s.i > DECOMMIT_FACTOR * committed.i,
	);
};

/**
 * Weekly recruiting points: more at programs with more prestige and a better coach.
 */
export const weeklyBudget = (prestige: number, coachQuality = 0.5) =>
	Math.round(40 + 0.5 * prestige + 20 * (coachQuality - 0.5));

/**
 * NIL money for a season (thousands): a small budget, bigger at bigger programs.
 */
export const nilBudget = (prestige: number) =>
	Math.round(Math.max(20, prestige * 1.2 - 20) / 5) * 5;

// Proximity grade from the school's state and the recruit's
export const proximityGrade = (
	schoolState: string | undefined,
	recruitState: string,
	sameRegion: boolean,
	foreign: boolean,
) => {
	if (foreign) {
		return 0.4;
	}
	if (schoolState !== undefined && schoolState === recruitState) {
		return 1;
	}
	return sameRegion ? 0.6 : 0.2;
};

// Playing time grade from the number of returning players at his position who are better than him
export const playingTimeGrade = (better: number) =>
	Math.max(0, Math.min(1, 1 - better / 4));
