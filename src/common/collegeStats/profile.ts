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
	// undefined: not ranked by the recruiting services
	nationalRank: number | undefined;
	posRank: number | undefined;
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

export const getRecruitPos = (pos: string) => RECRUIT_POS[pos] ?? pos;

// About how many seniors a recruiting service ranks
const RECRUIT_POOL = 1200;

export const starsForRank = (rank: number | undefined) =>
	rank === undefined
		? 2
		: rank <= 25
			? 5
			: rank <= 150
				? 4
				: rank <= 500
					? 3
					: 2;

/**
 * His ranking as a high school senior, from his potential and how good he was by the draft, with a lot of noise (recruiting rankings miss on plenty of players). A top-3 pick was nearly always a top-10 recruit, a second rounder anything from top 50 to unranked.
 *
 * This is what a recruiting service would say about him alone. Two players of the same high school class can come out with the same rank, so what is shown goes through resolveClassRanks, which gives every player of a class his own.
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
}): Recruiting & { nationalRank: number; posRank: number } => {
	const rng = new Rng(`recruit|${pid}`);
	const z =
		0.6 * ((pot - 48) / 10) + 0.4 * ((ovr - 42) / 8) + rng.normal(0, 0.45);
	const above = RECRUIT_POOL * (1 - normCdf(1.15 * z + 0.6));
	const nationalRank = Math.max(
		1,
		Math.round(above + rng.random() * Math.min(4, above)),
	);
	const posRank = Math.max(
		1,
		Math.round((nationalRank / 5) * (0.75 + 0.5 * rng.random())),
	);
	return {
		classOf: firstCollegeSeason - 1,
		stars: starsForRank(nationalRank),
		nationalRank,
		posRank,
		pos: getRecruitPos(pos),
	};
};

/**
 * What a recruiting service would have said about a prospect whose career has a story or a junior college start: a five-star for the bust, nothing for the player nobody ranked, further down for one who had to start at a junior college. Otherwise the plain ranking. Seeded by the player.
 */
export const adjustRecruitRank = ({
	pid,
	nationalRank,
	story,
	jucoStart,
}: {
	pid: number;
	nationalRank: number;
	story: string | undefined;
	jucoStart: boolean;
}): number | undefined => {
	const rng = new Rng(`recruit-story|${pid}`);
	if (story === "bust") {
		return 2 + Math.floor(rng.random() * 21);
	}
	if (story === "unranked") {
		return undefined;
	}
	if (story === "lateBloomer") {
		const rank = Math.round(Math.max(nationalRank, 180) * (1.2 + rng.random()));
		return rank > 650 ? undefined : rank;
	}
	if (story === "reclass") {
		return Math.max(1, Math.round(nationalRank * (0.5 + 0.4 * rng.random())));
	}
	if (jucoStart) {
		const rank = Math.round(nationalRank * 2.5 + 120 + 200 * rng.random());
		return rank > 600 ? undefined : rank;
	}
	return nationalRank;
};

export type RankEntry = {
	id: number;
	// What he would be ranked on his own. undefined: unranked
	rank: number | undefined;
	// Recruiting position, and what he would be ranked at it on his own
	pos: string;
	posRank: number | undefined;
	// 0: already set (stored), keeps his ranks. 1: shown before from the plain ranking, moves only for a set one. 2: being ranked now, fits around everyone else
	priority: 0 | 1 | 2;
};

/**
 * Rank the players of one high school class against each other, so that no two share a national rank or a rank at their position, and among players ranked together a better national rank at a position means a better position rank (a player ranked later is fitted in between when there is room). Players already ranked keep their ranks; the others take the first free rank at or after their own, in order of priority, rank and id, so adding players to a class never moves the ones ranked before.
 */
export const resolveClassRanks = (entries: RankEntry[]) => {
	const output = new Map<
		number,
		{ nationalRank: number | undefined; posRank: number | undefined }
	>();
	const ordered = entries
		.filter((e) => e.rank !== undefined)
		.sort(
			(a, b) => a.priority - b.priority || a.rank! - b.rank! || a.id - b.id,
		);
	const taken = new Set<number>();
	for (const e of ordered) {
		let rank = e.rank!;
		if (e.priority > 0) {
			while (taken.has(rank)) {
				rank += 1;
			}
		}
		taken.add(rank);
		output.set(e.id, { nationalRank: rank, posRank: undefined });
	}

	// Position ranks, best national rank first within each priority
	const posTaken = new Map<string, Map<number, number>>();
	const byNational = (a: RankEntry, b: RankEntry) =>
		output.get(a.id)!.nationalRank! - output.get(b.id)!.nationalRank! ||
		a.id - b.id;
	for (const priority of [0, 1, 2]) {
		for (const e of ordered
			.filter((x) => x.priority === priority)
			.sort(byNational)) {
			const mine = output.get(e.id)!;
			// posRank -> national rank of who has it
			const used = posTaken.get(e.pos) ?? new Map<number, number>();
			posTaken.set(e.pos, used);
			let rank = Math.max(1, e.posRank ?? Math.ceil(mine.nationalRank! / 5));
			if (priority > 0 || e.posRank === undefined) {
				rank = Math.min(rank, mine.nationalRank!);
				// After everyone at his position ranked ahead of him nationally, and before everyone ranked behind him
				let lo = 0;
				let hi = Infinity;
				for (const [posRank, national] of used) {
					if (national < mine.nationalRank!) {
						lo = Math.max(lo, posRank);
					} else {
						hi = Math.min(hi, posRank);
					}
				}
				rank = Math.max(rank, lo + 1);
				if (rank >= hi) {
					rank = lo + 1;
				}
				while (used.has(rank)) {
					rank += 1;
				}
			}
			used.set(rank, mine.nationalRank!);
			mine.posRank = rank;
		}
	}
	for (const e of entries) {
		if (e.rank === undefined) {
			output.set(e.id, { nationalRank: undefined, posRank: undefined });
		}
	}
	return output;
};

export type RecruitingExtras = {
	// Composite rating, 0.7000-1.0000, as recruiting services average their grades
	composite: number;
	// How many programs offered, and the ones worth naming (the school he signed with first)
	offerCount: number;
	offers: string[];
	finalists: string[];
	committed: string;
	signing: "early" | "late";
	// High school all-star games and honors
	allStar: string[];
};

const COMPOSITE_ANCHORS: [number, number][] = [
	[1, 1],
	[25, 0.9834],
	[150, 0.889],
	[500, 0.8],
	[1200, 0.72],
];

// A fixed function of the national rank that agrees with the star bands, so a composite and a star count never contradict each other
export const compositeForRank = (rank: number) => {
	const r = clamp(rank, 1, 1200);
	let k = 0;
	while (k < COMPOSITE_ANCHORS.length - 2 && r > COMPOSITE_ANCHORS[k + 1]![0]) {
		k += 1;
	}
	const [r0, c0] = COMPOSITE_ANCHORS[k]!;
	const [r1, c1] = COMPOSITE_ANCHORS[k + 1]!;
	const t = (Math.log(r) - Math.log(r0)) / (Math.log(r1) - Math.log(r0));
	return Math.round((c0 + t * (c1 - c0)) * 10000) / 10000;
};

export const HS_ALL_STAR_GAMES = [
	"High School All-American Game",
	"National Senior All-Star Classic",
	"Prep Hoops Summit",
];

/**
 * The rest of a recruitment, from his (class-unique) national rank and the school he signed with: composite rating, who offered, the finalists, when he signed and the all-star games he was picked for. `programs` are the schools that could have offered, with their strength. Seeded by the player, so it is the same every time.
 */
export const getRecruitingExtras = ({
	pid,
	nationalRank,
	committed,
	committedStrength,
	programs,
	jucoStart,
}: {
	pid: number;
	nationalRank: number | undefined;
	committed: string;
	// undefined: not a Division I program (a junior college)
	committedStrength: number | undefined;
	programs: { name: string; strength: number }[];
	jucoStart?: boolean;
}): RecruitingExtras => {
	const rng = new Rng(`recruit-extras|${pid}`);
	const stars = starsForRank(nationalRank);
	const composite =
		nationalRank !== undefined
			? compositeForRank(nationalRank)
			: Math.round((0.7 + 0.085 * rng.random()) * 10000) / 10000;

	// Who else was in on him: programs at the level his ranking says, or the level of the school he picked if that is higher
	const rank = nationalRank ?? 900;
	const rankLevel =
		95 - 40 * (Math.log10(1 + rank / 4) / Math.log10(1 + RECRUIT_POOL / 4));
	const centre = Math.max(committedStrength ?? 0, rankLevel);
	const near = programs.filter(
		(x) => x.name !== committed && Math.abs(x.strength - centre) <= 9,
	);
	const pool =
		near.length >= 8 ? near : programs.filter((x) => x.name !== committed);
	let want =
		stars >= 5
			? 15 + Math.floor(rng.random() * 16)
			: stars === 4
				? 8 + Math.floor(rng.random() * 13)
				: stars === 3
					? 4 + Math.floor(rng.random() * 9)
					: 1 + Math.floor(rng.random() * 5);
	if (jucoStart) {
		want = Math.min(want, 1 + Math.floor(rng.random() * 3));
	}
	want = Math.min(want, pool.length + 1);
	const others: string[] = [];
	const seen = new Set<string>();
	let guard = 0;
	while (others.length < Math.min(7, want - 1) && guard++ < 200) {
		const pick = pool[Math.floor(rng.random() * pool.length)];
		if (!pick || seen.has(pick.name)) {
			continue;
		}
		seen.add(pick.name);
		others.push(pick.name);
	}
	const offers = [committed, ...others];
	const cut = Math.min(
		offers.length,
		stars >= 4
			? 3 + Math.floor(rng.random() * 3)
			: 2 + Math.floor(rng.random() * 3),
	);
	const signing = rng.random() < (stars >= 4 ? 0.7 : 0.55) ? "early" : "late";

	// Picked by national rank, with a roll so the last spots are not automatic
	const allStar: string[] = [];
	const bar = (n: number, top: number) =>
		nationalRank !== undefined &&
		nationalRank <= n &&
		rng.random() < top * (1 - 0.5 * (nationalRank / n));
	if (bar(24, 0.95)) {
		allStar.push(HS_ALL_STAR_GAMES[0]!);
	}
	if (bar(40, 0.7)) {
		allStar.push(HS_ALL_STAR_GAMES[1]!);
	}
	if (bar(14, 0.6)) {
		allStar.push(HS_ALL_STAR_GAMES[2]!);
	}
	if (bar(90, 0.35)) {
		allStar.push("State Player of the Year");
	}

	return {
		composite,
		offerCount: want,
		offers,
		finalists: offers.slice(0, cut),
		committed,
		signing,
		allStar,
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
	story,
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
	// A career story that the timeline has to show (career.ts): where he started and how he got to where he went
	story?: string;
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
	// A story bends the path toward where it started. How far back (0 = now, 1 = his first preseason)
	const back = (t: number) => (T - t) / T;
	const undrafted = Math.log(cap);
	if (story === "bust") {
		// A lottery pick on every board when he arrived
		for (let t = 0; t < T; t++) {
			const w = back(t) ** 0.7;
			values[t] = (1 - w) * values[t]! + w * Math.log(2 + 5 * rng.random());
		}
	} else if (story === "unranked" || story === "lateBloomer") {
		// On nobody's board until late
		const exponent = story === "lateBloomer" ? 0.45 : 0.8;
		for (let t = 0; t < T; t++) {
			const w = back(t) ** exponent;
			values[t] = (1 - w) * values[t]! + w * (undrafted + 0.1);
		}
	} else if (story === "injury") {
		// Higher on boards before he got hurt in his last season
		for (let t = 0; t <= T - 4; t++) {
			values[t] = values[t]! - 0.45 - 0.25 * rng.random();
		}
	} else if (story === "project") {
		// Boards never agree on a project
		for (let t = 0; t < T; t++) {
			values[t] = values[t]! + rng.normal(0, 0.35);
		}
	}
	if (recruitRank !== undefined && story !== "unranked") {
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
