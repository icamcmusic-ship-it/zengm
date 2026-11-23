import { Rng } from "./ratingsBuilds/rng.ts";

/**
 * Prospect variety (basketball, a default part of how new players are generated; no setting). Pure tables and draws, no worker/DB/`g`.
 * The worker side is core/player/genRatings.basketball.ts (rating draw), core/player/prospectVariety.ts (ovr-neutral reshaping) and
 * core/draft/genPlayersWithoutSaving.ts (class-level steps). See docs/native-features.md, Prospect variety.
 *
 * Every new random number comes from a seeded stream of the prospect's own (Rng), derived from numbers the stock generator already drew,
 * so the game's Math.random stream draws exactly as many numbers as before. Players generated before this existed have no `genVar` and are
 * never touched.
 */

// 2: development reliability (DEV_RELIABILITY), for players generated since it exists. Version 1 players develop exactly as before.
export const PROSPECT_VARIETY_VERSION = 2;

// What a generated player stores (p.genVar): the version, his variety seed (development group rates are drawn from it), and, until his
// class is saved, the ages at which he developed before the draft (the hidden trajectory is applied to them once he has a pid)
export type GenVariety = {
	v: number;
	s: number;
	// Growth multiplier on all his development rates (polished seniors: a lower ceiling)
	c?: number;
	pre?: number[];
};

export type RatingGroup = "ath" | "shoot" | "skill" | "ins";

// --- 1. Group factors: a soft cap and per-rating shares -----------------------------------------------------------------------------

// The stock generator draws one factor per group, N(1, 0.2) clamped to [0.2, 1.2]: about 16% of players sat exactly on the 1.2 cap (+1 sd),
// which clipped the top end (best three-point rating of 20,000 prospects: 75). Above 1 the factor is now squashed softly toward 1.45 instead.
export const GROUP_FACTOR = {
	sd: 0.2,
	min: 0.2,
	softMax: 1.45,
};
const SOFT = GROUP_FACTOR.softMax - 1;
export const squashFactor = (x: number) =>
	x <= 1 ? Math.max(GROUP_FACTOR.min, x) : 1 + SOFT * Math.tanh((x - 1) / SOFT);

// Mean of a factor with the stock hard cap, and with the soft one at a factor's spread: factors are scaled by their ratio so mean ratings (and
// ovr) don't move
const normalPdf = (z: number) =>
	Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
const expectation = (f: (x: number) => number, zSd = 1) => {
	let sum = 0;
	let w = 0;
	for (let z = -6; z <= 6; z += 0.002) {
		const p = normalPdf(z);
		sum += p * f(1 + GROUP_FACTOR.sd * zSd * z);
		w += p;
	}
	return sum / w;
};
const STOCK_FACTOR_MEAN = expectation((x) => Math.min(1.2, Math.max(0.2, x)));

// Each rating's factor: the group's shared draw (the stock one), a subgroup's and its own, mixed with these loadings (w: shared, subgroup,
// own; scaled back toward unit variance by FACTOR_NORM), so ratings inside a group are related but no longer move in lockstep (raw ratings of
// new prospects: free throws and threes r 0.90 -> 0.64, speed and leaping 0.91 -> 0.62, handle and passing 0.83 -> 0.58, as in real players)
export const RATING_GROUP: Record<
	string,
	{ group: RatingGroup; sub?: string; w: [number, number, number] }
> = {
	// Athleticism: speed and leaping apart from strength
	spd: { group: "ath", sub: "mobility", w: [0.5, 0.35, 0.6] },
	jmp: { group: "ath", sub: "mobility", w: [0.5, 0.35, 0.6] },
	dnk: { group: "ath", sub: "mobility", w: [0.55, 0.35, 0.55] },
	stre: { group: "ath", sub: "power", w: [0.55, 0.45, 0.45] },
	endu: { group: "ath", w: [0.55, 0, 0.7] },
	// Shooting: one shared part and one own part each (r about 0.6 between them, from 0.9)
	ft: { group: "shoot", w: [0.6, 0, 0.65] },
	fg: { group: "shoot", w: [0.6, 0, 0.65] },
	tp: { group: "shoot", w: [0.6, 0, 0.65] },
	// Skill: handle/passing, IQ, rebounding
	drb: { group: "skill", sub: "handle", w: [0.5, 0.45, 0.55] },
	pss: { group: "skill", sub: "handle", w: [0.5, 0.45, 0.55] },
	oiq: { group: "skill", sub: "iq", w: [0.7, 0.35, 0.3] },
	diq: { group: "skill", sub: "iq", w: [0.7, 0.35, 0.3] },
	reb: { group: "skill", sub: "glass", w: [0.5, 0.45, 0.55] },
	ins: { group: "ins", w: [1, 0, 0] },
};

export const GROUP_KEYS: Record<RatingGroup, string[]> = {
	ath: ["stre", "spd", "jmp", "endu", "dnk"],
	shoot: ["ft", "fg", "tp"],
	skill: ["oiq", "diq", "drb", "pss", "reb"],
	ins: ["ins"],
};

// How much of the subgroup and own parts is taken back out of the shared part (1: every rating's factor has exactly the stock spread).
// Lower values spread ratings wider (a new player's ovr then spreads as before), but made more extreme shooters and non-shooters, which
// the spacing model turned into scoring: spacing on vs off +4.4 points a game at 0.85, +1.7 stock, +2.3 at 1
export const FACTOR_NORM = 1;

// Spread of a rating's z (1 with FACTOR_NORM 1), and the recentering of its factor
const zSdOf = (w: readonly number[]) =>
	Math.sqrt(
		(w[0]! ** 2 + w[1]! ** 2 + w[2]! ** 2) /
			(w[0]! ** 2 + FACTOR_NORM * (w[1]! ** 2 + w[2]! ** 2)),
	);
const recenterCache = new Map<string, number>();
const recenterOf = (key: string) => {
	let r = recenterCache.get(key);
	if (r === undefined) {
		r =
			STOCK_FACTOR_MEAN /
			expectation(squashFactor, zSdOf(RATING_GROUP[key]!.w));
		recenterCache.set(key, r);
	}
	return r;
};

// A rating's factor from its z: soft cap, recentered so its mean is the stock factor's
export const ratingFactor = (key: string, z: number) =>
	recenterOf(key) * squashFactor(1 + GROUP_FACTOR.sd * z);

// z of every rating's factor from the groups' shared z (the stock draws) and the prospect's stream
export const ratingZs = (groupZ: Record<RatingGroup, number>, rng: Rng) => {
	const subZ = new Map<string, number>();
	const out: Record<string, number> = {};
	for (const [key, def] of Object.entries(RATING_GROUP)) {
		const [wg, ws, wo] = def.w;
		let sz = 0;
		if (def.sub !== undefined && ws > 0) {
			if (!subZ.has(def.sub)) {
				subZ.set(def.sub, rng.normal(0, 1));
			}
			sz = subZ.get(def.sub)!;
		}
		const own = wo > 0 ? rng.normal(0, 1) : 0;
		out[key] =
			(wg * groupZ[def.group] + ws * sz + wo * own) /
			Math.sqrt(wg * wg + FACTOR_NORM * (ws * ws + wo * wo));
	}
	return out;
};

// --- 5. Sub-builds within each player type, and the outlier slot ---------------------------------------------------------------------

export type PlayerType = "point" | "scorer" | "wing" | "big";

// Multipliers on single ratings' factors (before his ovr is put back where it was, so a build is a shape, not talent). Shares of each type;
// the rest keep the type's plain shape.
export const SUB_BUILDS: Record<
	PlayerType,
	{ key: string; share: number; mult: Record<string, number> }[]
> = {
	big: [
		{
			key: "stretchBig",
			share: 0.16,
			mult: { tp: 1.65, ft: 1.3, fg: 1.25, ins: 0.85, reb: 0.92, stre: 0.9 },
		},
		{
			key: "rimProtector",
			share: 0.2,
			mult: { diq: 1.25, jmp: 1.12, reb: 1.1, tp: 0.8, ft: 0.9, drb: 0.88 },
		},
		{
			key: "playmakingBig",
			share: 0.12,
			mult: { pss: 1.35, oiq: 1.2, drb: 1.15, ins: 0.92, jmp: 0.9, dnk: 0.92 },
		},
	],
	wing: [
		{
			key: "threeAndD",
			share: 0.22,
			mult: { tp: 1.25, diq: 1.2, drb: 0.88, pss: 0.88, ins: 0.85, dnk: 0.92 },
		},
		{
			key: "slasher",
			share: 0.2,
			mult: { dnk: 1.2, spd: 1.1, jmp: 1.1, drb: 1.1, tp: 0.82, ft: 0.92 },
		},
	],
	point: [
		{
			key: "passFirst",
			share: 0.25,
			mult: { pss: 1.25, oiq: 1.15, drb: 1.05, tp: 0.85, fg: 0.9, dnk: 0.9 },
		},
		{
			key: "scoringPoint",
			share: 0.25,
			mult: { fg: 1.18, tp: 1.15, ft: 1.1, pss: 0.82, diq: 0.9, reb: 0.9 },
		},
	],
	scorer: [
		{
			key: "shotMaker",
			share: 0.2,
			mult: { fg: 1.2, tp: 1.15, oiq: 1.08, pss: 0.85, diq: 0.88, reb: 0.9 },
		},
		{
			key: "twoGuardDefender",
			share: 0.15,
			mult: { diq: 1.25, spd: 1.08, tp: 0.88, fg: 0.88, oiq: 0.92 },
		},
	],
};

// About 2% get one group far above its usual level and another far below (a small rim protector, a shooting 7-footer)
export const OUTLIER = { share: 0.02, up: 1.5, down: 0.7 };
const OUTLIER_GROUPS: RatingGroup[] = ["ath", "shoot", "skill", "ins"];

// The average build multiplier of each rating in a type (shares of its builds): every player of the type has his multipliers divided by it,
// so the builds move players around inside the type without moving the type's mean ratings (a build leans one way more often than the
// other: rim protectors and 3-and-D wings add defense)
const typeMeanMult = new Map<PlayerType, Record<string, number>>();
const meanMultOf = (type: PlayerType) => {
	let out = typeMeanMult.get(type);
	if (!out) {
		out = {};
		for (const b of SUB_BUILDS[type]) {
			for (const [key, m] of Object.entries(b.mult)) {
				out[key] = (out[key] ?? 1) + b.share * (m - 1);
			}
		}
		typeMeanMult.set(type, out);
	}
	return out;
};

// His build's multiplier per rating (undefined: none), recentered within his type
export const drawSubBuild = (
	type: PlayerType,
	rng: Rng,
): { key: string; mult: Record<string, number> } => {
	const u = rng.random();
	let acc = 0;
	let build: (typeof SUB_BUILDS)[PlayerType][number] | undefined;
	for (const b of SUB_BUILDS[type]) {
		acc += b.share;
		if (u < acc) {
			build = b;
			break;
		}
	}
	const mean = meanMultOf(type);
	const mult: Record<string, number> = {};
	for (const [key, m] of Object.entries(mean)) {
		mult[key] = (build?.mult[key] ?? 1) / m;
	}
	return { key: build?.key ?? "plain", mult };
};

export const drawOutlier = (
	type: PlayerType,
	rng: Rng,
): { up: RatingGroup; down: RatingGroup } | undefined => {
	if (!rng.chance(OUTLIER.share)) {
		return undefined;
	}
	// Bigs mostly go up in shooting or skill, small players mostly in the inside game
	const ups: RatingGroup[] =
		type === "big"
			? ["shoot", "shoot", "skill", "ath"]
			: type === "point"
				? ["ins", "ins", "ath", "shoot"]
				: ["ins", "shoot", "skill", "ath"];
	const up = rng.pick(ups);
	const down = rng.pick(OUTLIER_GROUPS.filter((g2) => g2 !== up));
	return { up, down };
};

// --- 4. Specialist spikes ------------------------------------------------------------------------------------------------------------

export const SPIKE = {
	share: 0.08,
	// A second spiked rating
	secondShare: 0.35,
	min: 12,
	max: 20,
};
// Which ratings a specialist is special at (weights)
const SPIKE_KEYS: [string, number][] = [
	["tp", 4],
	["ft", 1],
	["fg", 2],
	["drb", 3],
	["pss", 3],
	["oiq", 2],
	["diq", 3],
	["reb", 3],
	["ins", 2],
	["dnk", 2],
	["spd", 2],
	["jmp", 2],
	["stre", 1.5],
	["endu", 1],
];
export const drawSpikes = (rng: Rng): Record<string, number> | undefined => {
	if (!rng.chance(SPIKE.share)) {
		return undefined;
	}
	const out: Record<string, number> = {};
	const n = rng.chance(SPIKE.secondShare) ? 2 : 1;
	const keys = [...SPIKE_KEYS];
	for (let i = 0; i < n; i++) {
		const total = keys.reduce((s, [, w]) => s + w, 0);
		let x = rng.random() * total;
		let idx = 0;
		for (; idx < keys.length - 1; idx++) {
			x -= keys[idx]![1];
			if (x < 0) {
				break;
			}
		}
		const [key] = keys.splice(idx, 1)[0]!;
		out[key] = rng.int(SPIKE.min, SPIKE.max);
	}
	return out;
};

// --- 7. Regional tilts and path-based polish ------------------------------------------------------------------------------------------

export type Region = "europe" | "africa" | "oceania";

const EUROPE = new Set([
	"Albania",
	"Andorra",
	"Austria",
	"Belarus",
	"Belgium",
	"Bosnia and Herzegovina",
	"Bulgaria",
	"Croatia",
	"Cyprus",
	"Czech Republic",
	"Czechia",
	"Denmark",
	"England",
	"Estonia",
	"Finland",
	"France",
	"Georgia",
	"Germany",
	"Greece",
	"Hungary",
	"Iceland",
	"Ireland",
	"Italy",
	"Kosovo",
	"Latvia",
	"Lithuania",
	"Luxembourg",
	"Malta",
	"Moldova",
	"Montenegro",
	"Netherlands",
	"North Macedonia",
	"Macedonia",
	"Norway",
	"Poland",
	"Portugal",
	"Romania",
	"Russia",
	"Scotland",
	"Serbia",
	"Slovakia",
	"Slovenia",
	"Spain",
	"Sweden",
	"Switzerland",
	"Turkey",
	"Ukraine",
	"United Kingdom",
	"Wales",
]);
const AFRICA = new Set([
	"Algeria",
	"Angola",
	"Benin",
	"Botswana",
	"Burkina Faso",
	"Burundi",
	"Cameroon",
	"Cape Verde",
	"Central African Republic",
	"Chad",
	"Congo",
	"DR Congo",
	"Democratic Republic of the Congo",
	"Republic of the Congo",
	"Egypt",
	"Equatorial Guinea",
	"Eritrea",
	"Ethiopia",
	"Gabon",
	"Gambia",
	"Ghana",
	"Guinea",
	"Guinea-Bissau",
	"Ivory Coast",
	"Kenya",
	"Liberia",
	"Libya",
	"Madagascar",
	"Mali",
	"Mauritania",
	"Morocco",
	"Mozambique",
	"Namibia",
	"Niger",
	"Nigeria",
	"Rwanda",
	"Senegal",
	"Sierra Leone",
	"Somalia",
	"South Africa",
	"South Sudan",
	"Sudan",
	"Tanzania",
	"Togo",
	"Tunisia",
	"Uganda",
	"Zambia",
	"Zimbabwe",
]);
const OCEANIA = new Set(["Australia", "New Zealand"]);

export const regionOf = (country: string): Region | undefined =>
	EUROPE.has(country)
		? "europe"
		: AFRICA.has(country)
			? "africa"
			: OCEANIA.has(country)
				? "oceania"
				: undefined;

// Rating points (before his ovr is put back, so a tilt is a style, not talent: mean zero over the ratings that matter) and inches of ape
// index. Scaled per prospect by a draw in [0.5, 1.5].
export const REGION_TILTS: Record<
	Region,
	{ ratings: Record<string, number>; ape: number }
> = {
	europe: {
		ratings: {
			tp: 3,
			ft: 3,
			fg: 2,
			pss: 3,
			oiq: 3,
			diq: 1,
			spd: -2,
			jmp: -3,
			dnk: -2,
			stre: -1,
		},
		ape: 0,
	},
	africa: {
		ratings: {
			spd: 2,
			jmp: 3,
			dnk: 2,
			stre: 1,
			endu: 1,
			oiq: -3,
			pss: -2,
			ft: -2,
			tp: -2,
		},
		ape: 1.5,
	},
	oceania: {
		ratings: {
			oiq: 3,
			diq: 2,
			pss: 2,
			jmp: -2,
			spd: -1,
			dnk: -1,
		},
		ape: 0,
	},
};

// Seniors (stayed to the last draft age in college): more polished, with less room to grow
export const SENIOR_POLISH = {
	ratings: { oiq: 4, diq: 3, pss: 1, ft: 1 } as Record<string, number>,
	// Multiplies his development rates (a lower ceiling)
	ceiling: 0.88,
};

// --- 3. Declaring --------------------------------------------------------------------------------------------------------------------

// The random part of who declares each year, on top of pot (stock: +/-50, which swamps the spread in pot, so who declared early was close to
// random; now the best prospects tend to come out young)
export const DECLARE_FUDGE = 15;
// Share of the prospects still in school at the last draft age who stay one more (fifth-year seniors, medical redshirts): a few 23-year-olds
export const FIFTH_YEAR_SHARE = 0.06;

// --- 6. Class-level talent draw ------------------------------------------------------------------------------------------------------

export const CLASS_TALENT = {
	top: 15,
	sd: 1.5,
	max: 3.5,
};
export const classTalentShift = (seed: string) => {
	const rng = new Rng(`classTalent|${seed}`);
	const x = rng.normal(0, CLASS_TALENT.sd);
	return Math.max(-CLASS_TALENT.max, Math.min(CLASS_TALENT.max, x));
};

// Talent cycles: on top of each class's own draw, a slow league-level cycle of deep and thin eras. Two waves with periods and phases drawn
// once per league (seeded: the same league always has the same eras), in ovr points (raw), applied to the top `top` prospects of each class
// (deeper than the class draw's top 15, so a deep era has more good players, not just better stars), bounded by max. Averages 0 over the
// long run, so the league's talent level doesn't drift.
export const TALENT_CYCLE = {
	amp: 1.2,
	periodMin: 12,
	periodMax: 20,
	amp2: 0.6,
	period2Min: 26,
	period2Max: 40,
	max: 1.8,
	top: 30,
};
export const talentCycle = (leagueSeed: string, draftYear: number) => {
	const c = TALENT_CYCLE;
	const rng = new Rng(`talentCycle|${leagueSeed}`);
	const p1 = rng.uniform(c.periodMin, c.periodMax);
	const ph1 = rng.uniform(0, 2 * Math.PI);
	const p2 = rng.uniform(c.period2Min, c.period2Max);
	const ph2 = rng.uniform(0, 2 * Math.PI);
	const x =
		c.amp * Math.sin((2 * Math.PI * draftYear) / p1 + ph1) +
		c.amp2 * Math.sin((2 * Math.PI * draftYear) / p2 + ph2);
	return Math.max(-c.max, Math.min(c.max, x));
};

// --- 8. Development: group rates -----------------------------------------------------------------------------------------------------

export const DEV_RATES = {
	// A persistent rate shared by every group (boom/bust that carries over seasons), and each group's own
	sharedSd: 0.07,
	groupSd: 0.14,
	min: 0.35,
	max: 1.65,
	// Young players' yearly development noise: its downside bound (stock -4), and the amount added so its mean is unchanged
	youngNoiseMin: -7,
	youngNoiseRecenter: 0.418,
	// The rates' center: a little under 1, because more spread in how players develop raises the ovr of the ones who make rosters (teams keep
	// the best): on full-engine leagues, 1 put rostered ovr about 0.2 above before and 0.98 about 0.6 below
	center: 0.99,
};

// Development reliability (version 2 players). Most of the spread in what a prospect becomes used to be each season's development noise,
// which no one can see coming: the No. 1 pick by value became a star (peak 65+) about 45% of the time, his class's best player came from
// outside its top 10 about 38% of the time, and picks 4-5 did little better than 6-10. Part of that spread now sits in his growth rate
// instead (shared by every rating group: a persistent trait, like a motor or a frame that fills out), which his potential reads
// (potRatesOf), while young players' yearly noise is narrowed around its mean. More of where a prospect is headed shows before the draft,
// so the best ones go first more often. The per-group rates, the yearly noise and the bust tail (not narrowed) stay hidden, so there are
// still busts at the top and stars from late picks. Nothing here reads where he was drafted. Measured in docs/native-features.md
// (Prospect variety, 8b).
export const DEV_RELIABILITY = {
	// Spread of the rate shared by every group (version 1: DEV_RATES.sharedSd)
	sharedSd: 0.38,
	// Young players' (25 and under) yearly noise: its deviation from its mean is scaled by this (not the bust tail)
	noiseScale: 0.7,
};

// Means of the stock young noise draws (normal, sd 5), bounded at [-4, 20] (23 and under) and [-4, 10] (24-25): the center the noise is
// narrowed around, so the league's development is unchanged on average
export const YOUNG_NOISE_MEAN = {
	upTo23: 0.601,
	upTo25: 0.5586,
	// Narrowing alone raised young players' gains (fewer of them hit the ratings' limits): six seasons at 20-25 gained 0.54 ovr more. This
	// puts it back (the same ratings at the same rates: 9.52 vs 9.53 stock; prospectVariety.test.ts)
	shift: -0.13,
};

// Per rating group, plus the scale of his young yearly noise (version 2 players; undefined: stock)
export type DevRates = Record<RatingGroup, number> & { noise?: number };

// His development rate per rating group (multiplies each rating's yearly gain while young). Symmetric around DEV_RATES.center, so the
// league's rostered players develop about as much as before on average.
export const devRatesOf = (gv: GenVariety): DevRates => {
	const v2 = gv.v >= 2;
	const rng = new Rng(`devRates|${gv.s}`);
	const shared = rng.normal(
		0,
		v2 ? DEV_RELIABILITY.sharedSd : DEV_RATES.sharedSd,
	);
	const c = gv.c ?? 1;
	const rate = () =>
		c *
		Math.max(
			DEV_RATES.min,
			Math.min(
				DEV_RATES.max,
				DEV_RATES.center + shared + rng.normal(0, DEV_RATES.groupSd),
			),
		);
	const rates: DevRates = {
		ath: rate(),
		shoot: rate(),
		skill: rate(),
		ins: rate(),
	};
	if (v2) {
		rates.noise = DEV_RELIABILITY.noiseScale;
	}
	return rates;
};

// What his potential develops with (version 2 players): the part of his rate scouts can read, the one shared by every group (a frame, a
// motor), the same for every group, so which part of his game grows fastest stays hidden. Undefined for version 1 players (the stock
// development, as before)
export const potRatesOf = (gv: GenVariety): DevRates | undefined => {
	if (gv.v < 2) {
		return undefined;
	}
	const rng = new Rng(`devRates|${gv.s}`);
	const shared = rng.normal(0, DEV_RELIABILITY.sharedSd);
	const rate =
		(gv.c ?? 1) *
		Math.max(DEV_RATES.min, Math.min(DEV_RATES.max, DEV_RATES.center + shared));
	return {
		ath: rate,
		shoot: rate,
		skill: rate,
		ins: rate,
		noise: DEV_RELIABILITY.noiseScale,
	};
};

export const RATING_TO_GROUP: Record<string, RatingGroup> = Object.fromEntries(
	Object.entries(RATING_GROUP).map(([k, v]) => [k, v.group]),
);

// A rating's rate. IQ grows mostly with age and experience, so offensive and defensive IQ take half of the skill group's (with full rates,
// the players who grew most at IQ, the rating ovr weighs most, filled the rotations: the IQ-based player traits of a generated league's
// rotation rose by about a point)
const HALF_RATE = new Set(["oiq", "diq"]);
export const rateFor = (rates: DevRates, key: string) => {
	const rate = rates[RATING_TO_GROUP[key]!]!;
	return HALF_RATE.has(key) ? 1 + 0.5 * (rate - 1) : rate;
};

// The age up to which group rates act (later development is mostly decline, which they leave alone)
export const DEV_RATES_MAX_AGE = 27;

// --- Extras: near-duplicates in a class ----------------------------------------------------------------------------------------------

// Two prospects whose centered profiles are this similar (cosine), at the same position and within this many ovr, are near-identical
export const NEAR_DUPLICATE = {
	cosine: 0.985,
	ovr: 2,
	// Points moved between two ratings of the second one (ovr kept)
	nudge: 5,
};

export const profileCosine = (
	a: Record<string, number>,
	b: Record<string, number>,
	keys: readonly string[],
) => {
	const va = keys.map((k) => a[k]!);
	const vb = keys.map((k) => b[k]!);
	const ma = va.reduce((s, x) => s + x, 0) / va.length;
	const mb = vb.reduce((s, x) => s + x, 0) / vb.length;
	let d = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < keys.length; i++) {
		const x = va[i]! - ma;
		const y = vb[i]! - mb;
		d += x * y;
		na += x * x;
		nb += y * y;
	}
	return na === 0 || nb === 0 ? 1 : d / Math.sqrt(na * nb);
};

// --- Extras: archetype mix steering --------------------------------------------------------------------------------------------------

export const ARCHETYPE_STEER = {
	// Lead skills (the archetype engine's nouns) in the drafted part of a class
	pool: 60,
	// A lead skill held by more than this share of the pool is crowded
	maxShare: 0.2,
	// At most this many prospects are steered per class, each by this many points toward his second-best skill (ovr kept)
	maxSteered: 6,
	points: 4,
};

// Label steering (stronger, after the light steer): the archetype engine's full label (read-only, true ratings) of each prospect in the drafted
// part of the class; a label held by more than `cap` of them is crowded, and some of its holders get a bounded, ovr-neutral nudge toward
// their second or third best skill, kept only if the engine then gives them a label that isn't crowded. Bounded per class.
export const LABEL_STEER = {
	pool: 60,
	// A label held by more than this many prospects of the pool is crowded (3 of 60: 5%)
	cap: 3,
	// At most this many prospects steered per class, each tried with at most `tries` nudges of `points` (ovr kept)
	maxSteered: 18,
	points: [4, 6],
	tries: 6,
	// At most this many prospects looked at per class (bounds the engine's work)
	maxLooked: 45,
};

// --- Extras: heredity of shooting and skill ------------------------------------------------------------------------------------------

export const HEREDITY_SKILL = {
	// Correlation with the relative's shooting and skill (a little under athleticism's)
	h: 0.25,
	maxShift: 6,
};

// --- Extras: generation presets (League Extras → Generation Presets, generationPreset) -------------------------------------------------

export type GenerationPreset =
	| "balanced"
	| "guard"
	| "big"
	| "shooting"
	| "athletic";

export const GENERATION_PRESET_NAMES: Record<GenerationPreset, string> = {
	balanced: "Balanced",
	guard: "Guard-heavy era",
	big: "Big-man era",
	shooting: "Shooting era",
	athletic: "Athletic era",
};

/**
 * An era's tilt of new players' builds: weights on the player type picked within each height band (renormalized, so heights are drawn as
 * before) and a rating shift put back to his ovr (like the regional tilts), so the league's talent is unchanged and only what it looks like
 * moves (an era of guards or bigs is also a little shorter or taller, at the same ovr). Balanced: no tilt (the generator runs exactly as without presets).
 */
export const GENERATION_PRESETS: Record<
	Exclude<GenerationPreset, "balanced">,
	{
		types: Partial<Record<PlayerType, number>>;
		ratings: Record<string, number>;
		// Inches added to his drawn height (his ovr is put back to what it was at his drawn height)
		height?: number;
		// Raw ovr added to the ovr he is put back to: the era's type mix changes talent a little (point guards' type factors give more
		// ovr than bigs'), which this takes back so the era's mean ovr is the balanced one (generationPresets.test.ts)
		ovr?: number;
	}
> = {
	guard: {
		types: { point: 1.8, scorer: 1.5, big: 0.5 },
		height: -0.8,
		ovr: -0.7,
		ratings: {
			drb: 4,
			pss: 4,
			spd: 2,
			tp: 1,
			oiq: 1,
			ins: -3,
			reb: -4,
			stre: -2,
		},
	},
	big: {
		types: { point: 0.6, scorer: 0.7, big: 1.8 },
		height: 0.8,
		ovr: 0.6,
		ratings: {
			ins: 5,
			reb: 4,
			stre: 3,
			dnk: 1,
			diq: 1,
			tp: -4,
			drb: -3,
			pss: -2,
		},
	},
	shooting: {
		types: { scorer: 1.4, wing: 1.1, big: 0.85 },
		ratings: {
			tp: 6,
			ft: 4,
			fg: 3,
			oiq: 1,
			ins: -3,
			dnk: -3,
			stre: -2,
			jmp: -1,
			reb: -2,
		},
	},
	athletic: {
		types: { wing: 1.25, point: 0.9 },
		ratings: {
			spd: 4,
			jmp: 5,
			dnk: 4,
			endu: 2,
			oiq: -3,
			ft: -3,
			tp: -3,
			pss: -2,
			fg: -1,
		},
	},
};

export const presetOf = (value: unknown): GenerationPreset =>
	typeof value === "string" && Object.hasOwn(GENERATION_PRESET_NAMES, value)
		? (value as GenerationPreset)
		: "balanced";

// A height band's type shares (point, scorer, big, wing) under a preset's weights, renormalized
export const presetTypeShares = (
	shares: Record<PlayerType, number>,
	preset: GenerationPreset,
): Record<PlayerType, number> => {
	if (preset === "balanced") {
		return shares;
	}
	const w = GENERATION_PRESETS[preset].types;
	const out = { ...shares };
	let sum = 0;
	for (const key of Object.keys(out) as PlayerType[]) {
		out[key] *= w[key] ?? 1;
		sum += out[key];
	}
	for (const key of Object.keys(out) as PlayerType[]) {
		out[key] /= sum;
	}
	return out;
};
