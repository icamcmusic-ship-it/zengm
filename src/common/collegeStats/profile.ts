import { LEAGUE_ENV } from "./overseas.ts";
import { Rng, clamp, hashString } from "./rng.ts";

/**
 * Extras for a player's College/Overseas page that are not stored anywhere: high school recruiting ranking, head coaches, overseas clubs, team records for seasons without a college season model, the NBA combine and the draft stock timeline. Each is a pure function of things that do not change after the draft (pid, draft year, ratings in the draft year, measurements), seeded by the player, so it is the same every time the page is opened, for old classes too.
 */

// Standard normal CDF (Abramowitz-Stegun 7.1.26)
export const normCdf = (x: number) => {
	const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
	const y =
		1 -
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
			t +
			0.254829592) *
			t *
			Math.exp(-(x * x) / 2);
	return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};

// ---------- Recruiting ----------

export type Recruiting = {
	classOf: number;
	stars: number;
	nationalRank: number;
	posRank: number;
	pos: string;
};

const RECRUIT_POS: Record<string, string> = {
	PG: "PG",
	G: "CG",
	SG: "SG",
	GF: "Wing",
	SF: "SF",
	F: "PF",
	PF: "PF",
	FC: "C",
	C: "C",
};

// About how many seniors a recruiting service ranks
const RECRUIT_POOL = 1200;

/**
 * His ranking as a high school senior, from his potential and how good he was by the draft, with a lot of noise (recruiting rankings miss on plenty of players). A top-3 pick was nearly always a top-10 recruit, a second rounder anything from top 50 to unranked.
 */
export const getRecruiting = ({
	pid,
	pot,
	ovr,
	pos,
	firstCollegeSeason,
}: {
	pid: number;
	pot: number;
	ovr: number;
	pos: string;
	firstCollegeSeason: number;
}): Recruiting => {
	const rng = new Rng(`recruit|${pid}`);
	const z =
		0.6 * ((pot - 48) / 10) + 0.4 * ((ovr - 42) / 8) + rng.normal(0, 0.45);
	const above = RECRUIT_POOL * (1 - normCdf(1.15 * z + 0.6));
	const nationalRank = Math.max(
		1,
		Math.round(above + rng.random() * Math.min(4, above)),
	);
	const stars =
		nationalRank <= 25
			? 5
			: nationalRank <= 150
				? 4
				: nationalRank <= 500
					? 3
					: 2;
	const posRank = Math.max(
		1,
		Math.round((nationalRank / 5) * (0.75 + 0.5 * rng.random())),
	);
	return {
		classOf: firstCollegeSeason - 1,
		stars,
		nationalRank,
		posRank,
		pos: RECRUIT_POS[pos] ?? pos,
	};
};

// ---------- Coaches and clubs ----------

const COACH_FIRST = [
	"Mike",
	"Bill",
	"Tom",
	"Jim",
	"John",
	"Mark",
	"Greg",
	"Kevin",
	"Chris",
	"Scott",
	"Rick",
	"Tony",
	"Dan",
	"Matt",
	"Steve",
	"Bob",
	"Jeff",
	"Brian",
	"Eric",
	"Tim",
	"Kelvin",
	"Leon",
	"Andre",
	"Shaka",
	"Darian",
	"Travis",
	"Porter",
	"Wade",
	"Nate",
	"Rodney",
];
const COACH_LAST = [
	"Anderson",
	"Bennett",
	"Brooks",
	"Calloway",
	"Dawson",
	"Ellison",
	"Fletcher",
	"Garrison",
	"Hollins",
	"Irving",
	"Jacobs",
	"Keller",
	"Lawson",
	"Mercer",
	"Norwood",
	"Oakes",
	"Prescott",
	"Quinlan",
	"Rowe",
	"Sampson",
	"Thornton",
	"Underwood",
	"Vaughn",
	"Whitaker",
	"Yates",
	"Ziegler",
	"Hardaway",
	"McCall",
	"Pruitt",
	"Stallworth",
];
const COACH_FIRST_INTL = [
	"Željko",
	"Pablo",
	"Sarunas",
	"Ettore",
	"Dimitris",
	"Ergin",
	"Igor",
	"Luca",
	"Xavi",
	"Georgios",
	"Aleksandar",
	"Vincent",
	"Andrea",
	"Joan",
	"Brian",
	"Trevor",
	"Will",
	"Shane",
];
const COACH_LAST_INTL = [
	"Petrović",
	"Laso",
	"Jasikevičius",
	"Messina",
	"Itoudis",
	"Ataman",
	"Kokoškov",
	"Banchi",
	"Pascual",
	"Bartzokas",
	"Djordjević",
	"Collet",
	"Trinchieri",
	"Peñarroya",
	"Goorjian",
	"Gleeson",
	"Weaver",
	"Heal",
];

/**
 * A program's head coach in a season. Coaching tenures (3-22 years) are drawn from the program's own stream, starting long ago, so a coach stays at a school for a run of seasons and every player of that school and season sees the same coach.
 */
export const getHeadCoach = (team: string, season: number, intl = false) => {
	const rng = new Rng(`coach|${team}`);
	const first = intl ? COACH_FIRST_INTL : COACH_FIRST;
	const last = intl ? COACH_LAST_INTL : COACH_LAST;
	let start = 1940 - Math.floor(rng.random() * 10);
	let i = 0;
	while (true) {
		const tenure = 3 + Math.floor(rng.random() ** 1.6 * 20);
		const a = rng.random();
		const b = rng.random();
		if (season < start + tenure || i > 500) {
			return {
				name: `${first[Math.floor(a * first.length)]} ${last[Math.floor(b * last.length)]}`,
				// His first season in charge
				since: start,
			};
		}
		start += tenure;
		i += 1;
	}
};

// Clubs of the main leagues prospects play in. Other leagues get "<league> club"
const CLUBS: Record<string, string[]> = {
	EuroLeague: [
		"Madrid",
		"Barcelona",
		"Athens",
		"Piraeus",
		"Istanbul",
		"Belgrade",
		"Kaunas",
		"Milan",
		"Munich",
		"Tel Aviv",
		"Monaco",
		"Villeurbanne",
		"Vitoria",
		"Bologna",
	],
	EuroCup: [
		"Valencia",
		"Bursa",
		"Badalona",
		"Trento",
		"Hamburg",
		"Gran Canaria",
		"Ulm",
		"Cluj",
	],
	"Liga ACB": [
		"Málaga",
		"Tenerife",
		"Murcia",
		"Bilbao",
		"Zaragoza",
		"Manresa",
		"Granada",
		"Andorra",
	],
	NBL: [
		"Sydney",
		"Melbourne",
		"Perth",
		"Brisbane",
		"Adelaide",
		"Cairns",
		"Tasmania",
		"Illawarra",
		"Auckland",
	],
	"NBA G League": [
		"Ignite",
		"Santa Cruz",
		"Delaware",
		"Grand Rapids",
		"Stockton",
		"Long Island",
		"Oklahoma City",
		"Rio Grande Valley",
	],
	"LNB Pro A": [
		"Paris",
		"Le Mans",
		"Strasbourg",
		"Dijon",
		"Cholet",
		"Nanterre",
		"Bourg",
		"Limoges",
	],
	"Adriatic League": [
		"Mega",
		"Partizan",
		"Budućnost",
		"Cedevita",
		"FMP",
		"Igokea",
		"Zadar",
		"Split",
	],
	"Basketball Bundesliga": [
		"Berlin",
		"Bamberg",
		"Bonn",
		"Oldenburg",
		"Würzburg",
		"Ludwigsburg",
		"Chemnitz",
	],
	"Turkish BSL": ["Ankara", "Izmir", "Bursa", "Manisa", "Antalya", "Gaziantep"],
	"Italian LBA": [
		"Venice",
		"Sassari",
		"Brescia",
		"Trieste",
		"Pesaro",
		"Tortona",
		"Varese",
	],
	"Greek Basket League": [
		"Thessaloniki",
		"Peristeri",
		"Lavrio",
		"Kolossos",
		"Larisa",
	],
	"Chinese CBA": [
		"Guangdong",
		"Liaoning",
		"Beijing",
		"Shanghai",
		"Zhejiang",
		"Shenzhen",
	],
	"Japan B.League": [
		"Chiba",
		"Utsunomiya",
		"Ryukyu",
		"Shimane",
		"Nagoya",
		"Kawasaki",
	],
	NBL1: ["Knox", "Waverley", "Ipswich", "Sturt", "Perry Lakes", "Kilsyth"],
};

// The club he played for in a league: one club per league for his whole stay there
export const getClub = (league: string, pid: number) => {
	const clubs = CLUBS[league];
	if (!clubs) {
		return undefined;
	}
	return clubs[hashString(`club|${league}|${pid}`) % clubs.length]!;
};

export type TeamRecord = {
	w: number;
	l: number;
	confW?: number;
	confL?: number;
	// From the college season model, or estimated from program strength
	estimated: boolean;
};

/**
 * A team's record for a season with no college season model (seasons before stats were generated with it, overseas clubs, prep programs): its win share drawn around its program strength, with at least as many games as he played.
 */
export const estimateRecord = ({
	team,
	season,
	strength,
	gp,
	conference,
}: {
	team: string;
	season: number;
	strength: number;
	gp: number;
	conference: string | undefined;
}): TeamRecord => {
	const rng = new Rng(`record|${team}|${season}`);
	const env = LEAGUE_ENV[team];
	const games = Math.max(
		gp,
		env
			? env.games + Math.round(rng.normal(0, 1.5))
			: Math.round(rng.normal(32.5, 1.6)),
	);
	// Overseas the strength is the league's, not the club's: any record is possible
	const p = env
		? clamp(rng.normal(0.52, 0.17), 0.15, 0.9)
		: clamp(0.5 + 0.012 * (strength - 66) + rng.normal(0, 0.13), 0.12, 0.95);
	const w = Math.round(games * p);
	if (conference === undefined) {
		return { w, l: games - w, estimated: true };
	}
	const confGames = Math.min(games - 8, 18 + (rng.random() < 0.5 ? 2 : 0));
	const confW = clamp(
		Math.round(confGames * clamp(p + rng.normal(-0.04, 0.08), 0.05, 0.98)),
		Math.max(0, w - (games - confGames)),
		Math.min(confGames, w),
	);
	return { w, l: games - w, confW, confL: confGames - confW, estimated: true };
};

// ---------- Combine ----------

export type CombineRatings = {
	hgt: number;
	stre: number;
	spd: number;
	jmp: number;
	endu: number;
	// Wingspan rating minus height rating (expanded ratings, when the setting is on). wng is on the hgt scale (100 rating points = 27
	// inches), so 0 is a typical +3.5" ape index whatever his height.
	wingspanGap?: number;
};

export type CombineResults = {
	heightNoShoes: number;
	heightShoes: number;
	weight: number;
	wingspan: number;
	standingReach: number;
	standingVert: number;
	maxVert: number;
	laneAgility: number;
	shuttle: number;
	sprint: number;
	bench: number;
};

// Lower is better for the timed drills
export const COMBINE_LOWER_BETTER = new Set<keyof CombineResults>([
	"laneAgility",
	"shuttle",
	"sprint",
]);

const roundTo = (x: number, step: number) => Math.round(x / step) * step;

/**
 * NBA draft combine measurements and athletic testing, from his listed height and weight and his physical ratings in his draft year. Listed height includes shoes. The hgt rating is his height plus or minus an inch of length (see genRatings), which is what wingspan and reach pick up when there is no wingspan rating.
 */
export const getCombine = ({
	pid,
	heightInches,
	weight,
	ratings,
}: {
	pid: number;
	heightInches: number;
	weight: number;
	ratings: CombineRatings;
}): CombineResults => {
	const rng = new Rng(`combine|${pid}`);
	const heightShoes = roundTo(heightInches + rng.normal(0, 0.3), 0.25);
	const heightNoShoes = roundTo(heightShoes - 1.25 + rng.normal(0, 0.15), 0.25);
	// Inches of "length" in the hgt rating beyond his height (genRatings adds -1, 0 or 1 inch)
	const length = clamp((ratings.hgt * 27) / 100 + 66 - heightInches, -1.5, 1.5);
	const ape =
		ratings.wingspanGap !== undefined
			? 3.5 + (ratings.wingspanGap * 27) / 100 + rng.normal(0, 0.6)
			: 3.5 + 1.6 * length + rng.normal(0, 1.7);
	const wingspan = roundTo(heightNoShoes + ape, 0.25);
	const standingReach = roundTo(
		1.325 * heightNoShoes + 0.55 * ape + rng.normal(0, 0.8),
		0.5,
	);
	const w = weight - 210;
	const maxVert = roundTo(
		clamp(
			33.5 +
				0.22 * (ratings.jmp - 50) +
				0.04 * (ratings.spd - 50) -
				0.02 * w +
				rng.normal(0, 1.8),
			22,
			46,
		),
		0.5,
	);
	const standingVert = roundTo(
		clamp(
			maxVert - 5.5 + rng.normal(0, 1.3) + 0.02 * (ratings.stre - 50),
			18,
			maxVert - 1,
		),
		0.5,
	);
	const laneAgility =
		Math.round(
			clamp(
				11.4 - 0.022 * (ratings.spd - 50) + 0.006 * w + rng.normal(0, 0.25),
				10,
				13.5,
			) * 100,
		) / 100;
	const shuttle =
		Math.round(
			clamp(
				3.08 - 0.007 * (ratings.spd - 50) + 0.0015 * w + rng.normal(0, 0.09),
				2.6,
				3.7,
			) * 100,
		) / 100;
	const sprint =
		Math.round(
			clamp(
				3.28 - 0.006 * (ratings.spd - 50) + 0.0012 * w + rng.normal(0, 0.06),
				2.95,
				3.75,
			) * 100,
		) / 100;
	const bench = Math.max(
		0,
		Math.round(9 + 0.28 * (ratings.stre - 50) + 0.04 * w + rng.normal(0, 2.2)),
	);
	return {
		heightNoShoes,
		heightShoes,
		weight: Math.round(weight + rng.normal(0, 2.5)),
		wingspan,
		standingReach,
		standingVert,
		maxVert,
		laneAgility,
		shuttle,
		sprint,
		bench,
	};
};

/**
 * Percentile (0-100, higher is better) of each of his results among a class's results, his own included.
 */
export const combinePercentiles = (
	mine: CombineResults,
	all: CombineResults[],
) => {
	const output = {} as Record<
		keyof CombineResults,
		{ pct: number; rank: number; n: number }
	>;
	for (const key of Object.keys(mine) as (keyof CombineResults)[]) {
		const lower = COMBINE_LOWER_BETTER.has(key);
		const better = (x: number) => (lower ? x < mine[key] : x > mine[key]);
		const worse = (x: number) => (lower ? x > mine[key] : x < mine[key]);
		let numBetter = 0;
		let numWorse = 0;
		for (const r of all) {
			if (better(r[key])) {
				numBetter += 1;
			} else if (worse(r[key])) {
				numWorse += 1;
			}
		}
		const n = Math.max(1, all.length);
		const ties = n - numBetter - numWorse;
		output[key] = {
			pct: Math.round(
				(100 * (numWorse + 0.5 * Math.max(0, ties - 1))) / Math.max(1, n - 1),
			),
			rank: numBetter + 1,
			n,
		};
	}
	return output;
};

// ---------- Draft stock ----------

export type StockPoint = {
	label: string;
	season: number;
	// Projected pick, undefined for not projected to be drafted
	pick: number | undefined;
};

/**
 * Where mock drafts had him over his pre-draft career, ending at where he went (or, before the draft, where the board has him now). Built backwards from the end as a random walk in log pick space, so early projections are the least reliable, pulled toward the middle of the first round, and for a recruit started near his recruiting rank.
 */
export const getStockTimeline = ({
	pid,
	seasons,
	finalPick,
	numPicks,
	recruitRank,
	drafted,
}: {
	pid: number;
	// Pre-draft seasons, oldest first
	seasons: number[];
	// Pick he went at (or is projected at now). Above numPicks means undrafted
	finalPick: number;
	numPicks: number;
	recruitRank: number | undefined;
	// The last point is draft night rather than the current board
	drafted: boolean;
}): StockPoint[] => {
	if (seasons.length === 0) {
		return [];
	}
	const rng = new Rng(`stock|${pid}`);
	const labels: { label: string; season: number }[] = [];
	for (const season of seasons) {
		const name = `${season - 1}-${String(season).slice(-2)}`;
		labels.push(
			{ label: `${name} preseason`, season },
			{ label: `${name} midseason`, season },
			{ label: `${name} end of season`, season },
		);
	}
	const lastSeason = seasons.at(-1)!;
	labels.push(
		{ label: "Combine", season: lastSeason },
		{ label: drafted ? "Draft night" : "Now", season: lastSeason },
	);

	const cap = numPicks + 15;
	const lf = Math.log(clamp(finalPick, 1, cap));
	const center = Math.log(Math.max(1, numPicks / 2));
	const T = labels.length - 1;
	const values: number[] = new Array(labels.length);
	values[T] = lf;
	let e = 0;
	for (let t = T - 1; t >= 0; t--) {
		e += rng.normal(0, t >= T - 1 ? 0.12 : 0.2);
		const pull = 0.45 * ((T - t) / T);
		values[t] = lf + e + (center - lf) * pull;
	}
	if (recruitRank !== undefined) {
		// A freshman's first projection leans on how he was ranked coming out of high school
		values[0] = 0.5 * values[0]! + 0.5 * Math.log(1 + recruitRank * 0.6);
		values[1] = 0.75 * values[1]! + 0.25 * values[0]!;
	}
	return labels.map(({ label, season }, t) => {
		const pick =
			t === T ? finalPick : Math.max(1, Math.round(Math.exp(values[t]!)));
		return { label, season, pick: pick > numPicks ? undefined : pick };
	});
};

// ---------- Similar prospects ----------

export const SIMILARITY_RATINGS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;

/**
 * Distance between two prospects at the draft: their ratings (height counts double), age and position. 0 is identical, around 10 is quite alike.
 */
export const prospectDistance = (
	a: { ratings: Record<string, number>; age: number; pos: string; ovr: number },
	b: { ratings: Record<string, number>; age: number; pos: string; ovr: number },
) => {
	let sum = 0;
	let n = 0;
	for (const key of SIMILARITY_RATINGS) {
		const w = key === "hgt" ? 2 : 1;
		sum += w * ((a.ratings[key] ?? 0) - (b.ratings[key] ?? 0)) ** 2;
		n += w;
	}
	const posGroup = (pos: string) =>
		pos.includes("C") ? 2 : pos === "PF" || pos === "F" || pos === "SF" ? 1 : 0;
	return (
		Math.sqrt(sum / n) +
		2 * Math.abs(a.age - b.age) +
		0.3 * Math.abs(a.ovr - b.ovr) +
		3 * Math.abs(posGroup(a.pos) - posGroup(b.pos))
	);
};
