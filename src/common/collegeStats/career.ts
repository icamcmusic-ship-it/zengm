import { COLLEGES, CONFERENCES } from "./colleges.ts";
import { getRegion, getSchool, type School } from "./colleges.helpers.ts";
import { isOverseasLeague } from "./overseas.ts";
import { Rng, clamp } from "./rng.ts";
import type { CollegeProspect } from "./types.ts";

/**
 * The career model: where a prospect spent each year before the draft, and the handful of prospects per class with a story. Everything here is biography built around the ratings he already has: it decides schools, redshirt years, minutes and how raw he was early on, never his ratings, age or anything else the pro game reads.
 *
 * A plan is drawn from the prospect's own stream (seed, draft year, key), separate from the stream his stats come from, so a prospect with a plain career (one school, no story: most of them) gets exactly the seasons he got before this model existed.
 *
 * - Transfers: a move between two seasons, never during one. Up-transfers (a breakout at a smaller school, then a bigger program), down-transfers (off a big program's bench to play) and lateral ones. The school of the draft year is always the prospect's own, which is the one tied to the simulated college season.
 * - Redshirt: a year at the school with no games. It takes the place of what would have been his first season (his age is fixed), so a redshirt junior is 22, as old as a senior.
 * - Medical redshirt: a season that ended after a few games and did not count against his eligibility.
 * - JUCO: one or two junior college seasons before Division I.
 */

export type CareerStatus = "redshirt" | "medical" | "injury";
export type CareerMove = "up" | "down" | "lateral" | "juco";
export type CareerLevel = "ncaa" | "juco" | "other";

export type CareerYear = {
	season: number;
	school: string;
	level: CareerLevel;
	// Class year label of a college or JUCO year, like "Fr." or "RS So."
	cls?: string;
	status?: CareerStatus;
	// He changed schools before this season, and how
	move?: CareerMove;
};

export const STORY_KINDS = [
	"bust",
	"unranked",
	"lateBloomer",
	"project",
	"smallSchoolScorer",
	"olderIntl",
	"reclass",
	"injury",
] as const;
export type StoryKind = (typeof STORY_KINDS)[number];

export type PreDraftCareer = {
	// Every year from his first one after high school to the draft year, oldest first, redshirt years included
	years: CareerYear[];
	story?: StoryKind;
	// The high school class he was recruited in, for a prospect with a US high school path (an NCAA or JUCO first stop)
	hsClass?: number;
};

// What generation needs for one year
export type PlannedYear = CareerYear & {
	yearsBack: number;
	played: boolean;
	// Eligibility year, 0 = freshman ... 3 = senior
	classIndex: number;
	strength: number;
	conference: string | undefined;
	gameMinutes: number;
	mpgShift: number;
	usageShift: number;
	zShift: number;
	// Rating points he was further behind than a typical player his age (a late bloomer's early years)
	lag: number;
	gamesCap?: number;
	teamGames?: number;
};

// What is kept on the player (p.preDraftCareer): his years, his story and, once it has been set against the rest of his high school class, his recruiting ranking (null: unranked)
export type StoredPreDraftCareer = PreDraftCareer & {
	recruit?: { rank: number | null; posRank: number | null };
};

export type CareerPlan = {
	years: PlannedYear[];
	story?: StoryKind;
	hsClass?: number;
};

// Junior colleges (NJCAA Division I programs). None is a name in COLLEGES
export const JUCOS = [
	"Chipola College",
	"John A. Logan",
	"Indian Hills CC",
	"South Plains College",
	"Salt Lake CC",
	"Northwest Florida State",
	"Trinity Valley CC",
	"Odessa College",
	"Hutchinson CC",
	"Casper College",
	"Cowley College",
	"Eastern Florida State",
	"Moberly Area CC",
	"Northeastern JC",
	"Ranger College",
	"Coffeyville CC",
	"Western Nebraska CC",
	"Mineral Area College",
	"Iowa Western CC",
	"Panola College",
	"Wabash Valley College",
	"Cochise College",
	"Barton CC",
	"Snow College",
	"College of Southern Idaho",
	"Gillette College",
	"Florida SouthWestern",
	"Kilgore College",
	"Navarro College",
	"Tyler JC",
	"Jones College",
	"Pensacola State",
	"State Fair CC",
	"Three Rivers College",
	"Midland College",
	"Shelton State",
	"Wallace State",
	"Gulf Coast State",
	"Butler CC",
	"Seward County CC",
	"Dodge City CC",
	"New Mexico JC",
	"College of Central Florida",
	"Sheridan College",
	"Kirkwood CC",
].filter((name) => !COLLEGES[name]);

const JUCO_SET = new Set(JUCOS);
export const isJuco = (name: string | undefined) =>
	name !== undefined && JUCO_SET.has(name);
export const JUCO_STRENGTH = 40;
export const JUCO_LEAGUE = "NJCAA";

const CLASS_NAMES = ["Fr.", "So.", "Jr.", "Sr.", "Gr."];
const classLabel = (elig: number, redshirted: boolean) =>
	`${redshirted ? "RS " : ""}${CLASS_NAMES[clamp(elig, 0, 4)]}`;

type Tier = "high" | "mid" | "low";
const tierOf = (school: string): Tier | undefined =>
	COLLEGES[school]
		? ((CONFERENCES[COLLEGES[school][1]]?.tier ?? "mid") as Tier)
		: undefined;

let schoolsByTier: Record<Tier, { names: string[]; weights: number[] }>;
const getSchoolsByTier = () => {
	if (!schoolsByTier) {
		schoolsByTier = {
			high: { names: [], weights: [] },
			mid: { names: [], weights: [] },
			low: { names: [], weights: [] },
		};
		for (const name of Object.keys(COLLEGES)) {
			const t = schoolsByTier[tierOf(name)!];
			t.names.push(name);
			// Bigger programs lose (and send on) more players, but not in proportion to how many pros they produce
			t.weights.push((COLLEGES[name]![0] + 0.5) ** 0.5);
		}
	}
	return schoolsByTier;
};

const pickSchoolOfTier = (tier: Tier, rng: Rng, exclude: Set<string>) => {
	const { names, weights } = getSchoolsByTier()[tier];
	for (let i = 0; i < 20; i++) {
		const name = rng.weighted(names, weights);
		if (!exclude.has(name)) {
			return name;
		}
	}
	return names.find((name) => !exclude.has(name))!;
};

// Where a player who ends up at a school of this tier transferred from: [tier he came from, weight]
const TRANSFER_FROM: Record<Tier, [Tier, CareerMove, number][]> = {
	high: [
		["mid", "up", 0.38],
		["low", "up", 0.2],
		["high", "lateral", 0.42],
	],
	mid: [
		["low", "up", 0.3],
		["high", "down", 0.45],
		["mid", "lateral", 0.25],
	],
	low: [
		["high", "down", 0.25],
		["mid", "down", 0.4],
		["low", "lateral", 0.35],
	],
};

// Chance a player transferred at least once, by how many years he has been in Division I
const P_TRANSFER = [0, 0, 0.13, 0.25, 0.34, 0.38];

// Height in inches for a hgt rating (genRatings), when his listed height is not known
export const heightFromRating = (hgt: number) => Math.round(66 + 0.27 * hgt);

// Share of prospects who roll for one of the general stories, and for one their build or path makes them the rare candidate for
const STORY_RATE = 0.12;
const RARE_STORY_RATE = 0.55;

// How often a prospect the injury-riddled class marked has the injury story
const SHAPE_INJURY_RATE = 0.85;

type StoryContext = {
	z: number;
	classIndex: number;
	isNcaa: boolean;
	school: School | undefined;
};

/**
 * The story a prospect has, if any. A prospect is a candidate with a fixed chance from his own stream; which story fits depends on what he already is (his talent in his class, class year, height, school, where he was born), so nothing about him has to change for it to be true.
 */
export const pickStory = (
	p: CollegeProspect,
	ctx: StoryContext,
	seedBase: string,
): StoryKind | undefined => {
	const { z, classIndex: c, isNcaa, school } = ctx;
	if (!school || school.idle) {
		return undefined;
	}
	// Marked by his draft class's shape: usually the story, from a stream of its own so nobody else's story changes
	if (
		p.injuryHistory &&
		new Rng(`${seedBase}|shapeInjury`).random() < SHAPE_INJURY_RATE
	) {
		return "injury";
	}
	const rng = new Rng(`${seedBase}|story`);
	const u = rng.random();
	const height = p.heightInches ?? heightFromRating(p.ratings.hgt);
	const region = getRegion(p.bornLoc);
	const tier = tierOf(school.name);

	// Stories only a few prospects could have: when one fits, it is likely his
	const rare: StoryKind[] = [];
	if (height >= 87 && (p.ratings.oiq < 50 || z < 1)) {
		rare.push("project");
	}
	if (height <= 73 && isNcaa && tier === "low" && z >= -0.6) {
		rare.push("smallSchoolScorer");
	}
	if (
		!isNcaa &&
		isOverseasLeague(school.name) &&
		region !== "usa" &&
		region !== "canada" &&
		p.age >= 22
	) {
		rare.push("olderIntl");
	}
	if (rare.length > 0 && u < RARE_STORY_RATE) {
		return rare[Math.floor(rng.random() * rare.length)];
	}
	if (rng.random() >= STORY_RATE) {
		return undefined;
	}

	// Not every candidate has a story that fits: the fewer that do, the more often he has none
	const kinds: (StoryKind | undefined)[] = [undefined];
	const weights: number[] = [1.2];
	const add = (kind: StoryKind, w: number) => {
		kinds.push(kind);
		weights.push(w);
	};
	if (isNcaa && c >= 1 && z <= -0.2) {
		add("bust", 2.2);
	}
	if (isNcaa && c >= 1 && z >= 0.7) {
		add("unranked", 3);
	}
	if (isNcaa && c === 3 && z >= -0.3) {
		add("lateBloomer", 2.4);
	}
	// Reclassified up a year: a young freshman, not an older one
	if (isNcaa && c === 0 && p.age <= 19) {
		add("reclass", 1.6);
	}
	add("injury", 0.6);
	return rng.weighted(kinds, weights);
};

/**
 * Plan a prospect's years before the draft. `school` is where he plays in his draft year (undefined or idle: no years).
 */
export const planCareer = (
	p: CollegeProspect,
	school: School | undefined,
	{
		seed,
		draftYear,
		priorSeasons,
		z,
		classIndex,
	}: {
		seed: string;
		draftYear: number;
		priorSeasons: boolean;
		// Class-relative talent, clamped
		z: number;
		classIndex: number;
	},
): CareerPlan => {
	if (!school || school.idle) {
		return { years: [] };
	}
	const seedBase = `${seed}|${draftYear}|${p.key}`;
	const rng = new Rng(`${seedBase}|career`);
	const isNcaa = !school.nonCollege && !!COLLEGES[school.name];
	const c = classIndex;
	const story = priorSeasons
		? pickStory(p, { z, classIndex: c, isNcaa, school }, seedBase)
		: undefined;

	let n = priorSeasons ? c + 1 : 1;
	// An older international pro has been at it since he was 17 or 18 (the pre-draft window is six seasons)
	if (story === "olderIntl") {
		n = clamp(p.age - (rng.random() < 0.5 ? 16 : 17), n, 6);
	}

	const base = (yearsBack: number): PlannedYear => ({
		season: draftYear - yearsBack,
		school: school.name,
		level: isNcaa ? "ncaa" : "other",
		yearsBack,
		played: true,
		classIndex: c - yearsBack,
		strength: school.strength,
		conference: school.conference,
		gameMinutes: school.gameMinutes,
		mpgShift: 0,
		usageShift: 0,
		zShift: 0,
		lag: 0,
	});
	// Oldest first
	const years: PlannedYear[] = [];
	for (let k = n - 1; k >= 0; k--) {
		years.push(base(k));
	}

	if (isNcaa && priorSeasons) {
		// An old senior spent a fifth year somewhere: usually a redshirt year
		let redshirt = false;
		if (p.age >= 23 && n >= 4 && rng.random() < 0.6) {
			years.unshift(base(n));
			n += 1;
			redshirt = true;
		}

		// Junior college start
		let numJuco = 0;
		if (
			n >= 3 &&
			!redshirt &&
			story !== "bust" &&
			story !== "lateBloomer" &&
			story !== "reclass" &&
			story !== "smallSchoolScorer"
		) {
			const pJuco =
				story === "unranked"
					? 0.3
					: (n === 3 ? 0.05 : 0.065) * (z < 0 ? 1.4 : 0.7);
			if (rng.random() < pJuco) {
				numJuco =
					n === 3 ? (rng.random() < 0.5 ? 1 : 2) : rng.random() < 0.7 ? 2 : 1;
				const juco = JUCOS[Math.floor(rng.random() * JUCOS.length)]!;
				for (let i = 0; i < numJuco; i++) {
					const year = years[i]!;
					year.school = juco;
					year.level = "juco";
					year.strength = JUCO_STRENGTH + rng.normal(0, 2);
					year.conference = undefined;
					year.zShift += 1.3;
					year.mpgShift += 2;
					year.teamGames = 28 + Math.floor(rng.random() * 6);
				}
				years[numJuco]!.move = "juco";
			}
		}

		// Redshirt year: his first year on campus, no games
		if (!redshirt && n >= 2 && numJuco === 0 && story !== "bust") {
			const pRedshirt =
				story === "lateBloomer" ? 0.3 : story ? 0.03 : z < 0 ? 0.11 : 0.06;
			if (rng.random() < pRedshirt) {
				redshirt = true;
			}
		}
		if (redshirt) {
			years[0]!.played = false;
			years[0]!.status = "redshirt";
		}

		// Medical redshirt: a Division I season before the draft year that ended after a few games
		if (!redshirt && n - numJuco >= 3 && !story && rng.random() < 0.04) {
			const i = numJuco + Math.floor(rng.random() * (n - numJuco - 1));
			years[i]!.status = "medical";
			years[i]!.gamesCap = 3 + Math.floor(rng.random() * 7);
		}

		// Transfers between Division I schools
		const first = numJuco;
		const d1 = n - first;
		const pTransfer =
			story === "unranked"
				? numJuco > 0
					? 0
					: 0.6
				: story === "bust"
					? // A five-star signs with a big program: one who is at a smaller school now left one
						tierOf(school.name) === "high"
						? 0.3
						: 0.85
					: story === "smallSchoolScorer" || story === "reclass"
						? 0
						: (P_TRANSFER[clamp(d1, 0, 5)] ?? 0) * (numJuco > 0 ? 0.5 : 1);
		if (d1 >= 2 && rng.random() < pTransfer) {
			const used = new Set([school.name]);
			// He changes schools before the year at index `boundary`. Later is more likely: most transfers are upperclassmen
			const pickBoundary = (hi: number) => {
				const options = [];
				const weights = [];
				for (let i = first + 1; i <= hi; i++) {
					// Not straight after a redshirt year at the school
					if (years[i - 1]!.status === "redshirt" && i - 1 === first) {
						continue;
					}
					options.push(i);
					weights.push(i - first);
				}
				return options.length > 0 ? rng.weighted(options, weights) : undefined;
			};
			const move = (boundary: number, toTier: Tier, forced?: CareerMove) => {
				// A story wants one kind of move. Where the school he ends up at rules it out (nobody transfers down to a high-major), a lateral one
				const all = TRANSFER_FROM[toTier];
				const wanted = all.filter((row) => row[1] === forced);
				const table =
					forced === undefined
						? all
						: wanted.length > 0
							? wanted
							: all.filter((row) => row[1] === "lateral");
				const [fromTier, kind] = rng.weighted(
					table,
					table.map((row) => row[2]),
				);
				const from = getSchool(pickSchoolOfTier(fromTier, rng, used))!;
				used.add(from.name);
				for (let i = first; i < boundary; i++) {
					const year = years[i]!;
					// A second (earlier) transfer only rewrites the years before it
					if (year.school !== years[boundary]!.school) {
						continue;
					}
					year.school = from.name;
					year.strength = from.strength;
					year.conference = from.conference;
					if (kind === "down") {
						year.mpgShift -= 6.5;
						year.usageShift -= 0.4;
					} else if (kind === "up") {
						year.mpgShift += 2.5;
					} else {
						year.mpgShift -= 2.5;
					}
				}
				if (kind === "up" && years[boundary - 1]!.played) {
					// The breakout that got him noticed
					years[boundary - 1]!.zShift += 0.3;
					years[boundary - 1]!.usageShift += 0.3;
				}
				years[boundary]!.move = kind;
				return fromTier;
			};
			const boundary = pickBoundary(n - 1);
			if (boundary !== undefined) {
				const fromTier = move(
					boundary,
					tierOf(school.name) ?? "mid",
					story === "unranked" ? "up" : story === "bust" ? "down" : undefined,
				);
				if (d1 >= 4 && boundary - first >= 2 && rng.random() < 0.18) {
					const earlier = pickBoundary(boundary - 1);
					if (earlier !== undefined) {
						// Temporarily, the years before the first transfer are at the school he left
						move(earlier, fromTier);
					}
				}
			}
		}

		// Class year labels
		let elig = 0;
		let redshirted = false;
		for (const year of years) {
			year.classIndex = clamp(elig, 0, 3);
			year.cls = classLabel(elig, redshirted);
			if (year.status === "redshirt" || year.status === "medical") {
				redshirted = true;
			} else {
				elig += 1;
			}
		}
	}

	// Stories
	const last = years.at(-1)!;
	const played = years.filter((year) => year.played);
	if (story === "bust") {
		// Handed the keys as a freshman, less every year since
		for (const [i, year] of played.entries()) {
			// Whatever else happened to him
			year.mpgShift = i === 0 ? 4 : -2 - 1.5 * i;
			year.zShift = Math.min(year.zShift, 0);
		}
	} else if (story === "unranked") {
		for (const year of played) {
			if (year.yearsBack >= 1) {
				year.mpgShift -= 1.5 + 2 * year.yearsBack;
				year.lag += 1.5 * year.yearsBack;
			}
		}
		last.zShift += 0.15;
	} else if (story === "lateBloomer") {
		for (const year of played) {
			if (year.yearsBack >= 1) {
				// Whatever else happened to him, he was at the end of the bench
				year.mpgShift = -(11 + 3 * year.yearsBack);
				year.zShift = Math.min(year.zShift, 0) - 0.8;
				year.usageShift -= 0.6;
				year.lag += 2 * year.yearsBack;
			}
		}
		last.mpgShift += 1.5;
		last.zShift += 0.2;
	} else if (story === "project") {
		for (const year of played) {
			year.mpgShift -= 7.5;
			year.usageShift -= 0.4;
		}
	} else if (story === "smallSchoolScorer") {
		for (const year of played) {
			year.mpgShift += 2;
			year.usageShift += 1;
		}
	} else if (story === "reclass") {
		last.mpgShift -= 1.5;
	} else if (story === "injury") {
		last.status = "injury";
		last.gamesCap = 5 + Math.floor(rng.random() * 11);
	}

	const firstYear = years[0]!;
	return {
		years,
		...(story ? { story } : {}),
		...(firstYear.level !== "other" ? { hsClass: firstYear.season - 1 } : {}),
	};
};

export const toCareer = (plan: CareerPlan): PreDraftCareer => ({
	years: plan.years.map((year) => ({
		season: year.season,
		school: year.school,
		level: year.level,
		...(year.cls !== undefined ? { cls: year.cls } : {}),
		...(year.status ? { status: year.status } : {}),
		...(year.move ? { move: year.move } : {}),
	})),
	...(plan.story ? { story: plan.story } : {}),
	...(plan.hsClass !== undefined ? { hsClass: plan.hsClass } : {}),
});

// Skill ratings a few points lower (physical ratings less), for a year he was further behind than his age says
export const lagRatings = <T extends Record<string, number | undefined>>(
	ratings: T,
	points: number,
): T => {
	if (points <= 0) {
		return ratings;
	}
	const out: Record<string, number | undefined> = { ...ratings };
	for (const key of Object.keys(out)) {
		if (key === "hgt" || key === "wng" || out[key] === undefined) {
			continue;
		}
		const factor =
			key === "spd" || key === "jmp" || key === "stre" || key === "endu"
				? 0.4
				: 1;
		out[key] = Math.max(0, out[key] - points * factor);
	}
	return out as T;
};

const feetInches = (inches: number) =>
	`${Math.floor(inches / 12)}'${Math.round(inches % 12)}"`;

/**
 * His story in a line, for the player page. `facts` are things that are public about him.
 */
export const getStoryText = (
	kind: StoryKind,
	facts: {
		hsClass?: number;
		recruitRank?: number;
		heightInches: number;
		ageAtDraft: number;
		school: string;
		conference?: string;
		firstSeason: number;
		firstAge: number;
		// Games in his draft year season
		lastGp: number;
		lastSeason: number;
	},
): { title: string; text: string } => {
	switch (kind) {
		case "bust":
			return {
				title: "Five-star recruit who never arrived",
				text: `${facts.recruitRank !== undefined ? `The No. ${facts.recruitRank} recruit` : "A five-star recruit"} in the high school class of ${facts.hsClass} and a projected lottery pick when he got to campus. The production never matched the billing, and his role and his draft stock have slipped ever since.`,
			};
		case "unranked":
			return {
				title: "Unranked recruit turned top prospect",
				text: `Not ranked by any recruiting service coming out of high school in ${facts.hsClass}. He played his way from off the radar onto every draft board.`,
			};
		case "lateBloomer":
			return {
				title: "Late bloomer",
				text: `Barely played for most of his college career, then broke out as a ${facts.ageAtDraft}-year-old in his last season, ${facts.lastSeason}. Scouts only started showing up in his last season.`,
			};
		case "project":
			return {
				title: `${feetInches(facts.heightInches)} project`,
				text: `At ${feetInches(facts.heightInches)} he is one of the tallest prospects in years, and still raw: limited minutes and a small role before the draft. Whoever takes him is betting on size that cannot be taught.`,
			};
		case "smallSchoolScorer":
			return {
				title: "Undersized scorer from a small school",
				text: `Only ${feetInches(facts.heightInches)}, and at ${facts.school}${facts.conference ? ` of the ${facts.conference}` : ""} he rarely saw high-major competition, but he carried his team's offense and put up numbers that were hard to ignore.`,
			};
		case "olderIntl":
			return {
				title: "Older international prospect",
				text: `${facts.ageAtDraft} at the draft and a professional since he was ${facts.firstAge}: ${facts.lastSeason - facts.firstSeason + 1} seasons against grown men before entering the draft.`,
			};
		case "reclass":
			return {
				title: "Reclassified to enroll a year early",
				text: `Originally in the high school class of ${(facts.hsClass ?? facts.firstSeason - 1) + 1}, he reclassified to ${facts.hsClass ?? facts.firstSeason - 1} and played his freshman season as one of the youngest players in college basketball.`,
			};
		case "injury":
			return {
				title: "Injury-shortened season",
				text: `His ${facts.lastSeason} season ended after ${facts.lastGp} ${facts.lastGp === 1 ? "game" : "games"} because of an injury, and he missed the postseason. Teams had to judge him on what he showed before it.`,
			};
	}
};
