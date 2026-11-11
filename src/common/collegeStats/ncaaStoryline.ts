import { CONFERENCES } from "./colleges.ts";
import { Rng } from "./rng.ts";

/**
 * The shape of a college season (ncaa.ts). Each class's season draws one, and maybe a scoring environment, from its seed. They bend what the season is simulated with (how far apart the teams are, how much a single game swings, how many points are scored) inside realistic bounds, so seasons differ in kind and not only in names.
 */

// Version 2 seasons draw from these seven, with these weights, in this order (do not change them: a stored class replays its season from them)
const NCAA_SHAPES_V2 = {
	standard: { name: "A balanced year", weight: 22 },
	dominant: { name: "A dominant favorite", weight: 14 },
	wideOpen: { name: "A wide-open year", weight: 16 },
	cinderella: { name: "The year of the mid-major", weight: 14 },
	blueBloodDown: { name: "A down year for the blue bloods", weight: 11 },
	loadedConference: { name: "One loaded conference", weight: 12 },
	chalk: { name: "Chalk all the way", weight: 11 },
} as const;

// Version 3 seasons draw from all of these
export const NCAA_SHAPES = {
	standard: { name: "A balanced year", weight: 12 },
	dominant: { name: "A dominant favorite", weight: 7 },
	wideOpen: { name: "A wide-open year", weight: 8 },
	cinderella: { name: "The year of the mid-major", weight: 7 },
	blueBloodDown: { name: "A down year for the blue bloods", weight: 5 },
	loadedConference: { name: "One loaded conference", weight: 6 },
	chalk: { name: "Chalk all the way", weight: 6 },
	rivalry: { name: "Two juggernauts", weight: 6 },
	freshmen: { name: "The year of the freshman", weight: 5 },
	veterans: { name: "A veterans' year", weight: 5 },
	guards: { name: "A guards' game", weight: 5 },
	bigs: { name: "The year of the big man", weight: 5 },
	cinderellaRun: { name: "A Cinderella run", weight: 5 },
	upsetWeekend: { name: "A wild first weekend", weight: 5 },
	powerParity: { name: "Parity in the power conferences", weight: 5 },
	fallenPowerhouse: { name: "A fallen powerhouse", weight: 5 },
	conferenceDown: { name: "A conference down year", weight: 5 },
	transfers: { name: "The transfer carousel", weight: 5 },
	greatStumbles: { name: "A great team stumbles", weight: 4 },
	paceAndSpace: { name: "Pace and space", weight: 5 },
} as const;
export type NcaaShape = keyof typeof NCAA_SHAPES;

/**
 * Version 4: the college season of a shaped draft class (the Draft Class Shapes setting) often matches the class. A one-and-done class's college year is likely the year of the freshman, a guard-heavy class's a guards' game, and so on. The class shape is stored with the season (cs on p.collegeSeason), and whether this season matches is drawn from its own stream, so a season that does not match is drawn exactly as in version 3.
 */
export const CLASS_SHAPE_TIES: Record<
	string,
	| { shape: NcaaShape; scoring?: undefined }
	| { scoring: NcaaScoring; shape?: undefined }
> = {
	oneAndDone: { shape: "freshmen" },
	raw: { shape: "freshmen" },
	seniors: { shape: "veterans" },
	lateBloomers: { shape: "veterans" },
	readyNow: { shape: "veterans" },
	polished: { shape: "veterans" },
	guards: { shape: "guards" },
	pointGuards: { shape: "guards" },
	bigs: { shape: "bigs" },
	shooters: { shape: "paceAndSpace" },
	stretchBigs: { shape: "paceAndSpace" },
	midMajor: { shape: "cinderella" },
	generational: { shape: "dominant" },
	coHeadliners: { shape: "rivalry" },
	noClearTop: { shape: "wideOpen" },
	defenders: { scoring: "slog" },
};
export const NCAA_TIE_RATE = 0.6;

export const ncaaClassTie = (
	seed: string,
	season: number,
	classShape: string | undefined,
) => {
	const tie =
		classShape !== undefined && Object.hasOwn(CLASS_SHAPE_TIES, classShape)
			? CLASS_SHAPE_TIES[classShape]
			: undefined;
	if (!tie) {
		return undefined;
	}
	return new Rng(`${seed}|${season}|classTie`).random() < NCAA_TIE_RATE
		? tie
		: undefined;
};

// Which prospects a lean shape favors (applied in ncaa.ts, from the prospects' ages and positions)
export type NcaaLean = "young" | "old" | "guards" | "bigs";

// How much more (or less) a prospect adds to his team in a lean year
export const leanMultiplier = (
	lean: NcaaLean | undefined,
	age: number | undefined,
	pos: string | undefined,
) => {
	if (lean === "young" && age !== undefined) {
		return age <= 19 ? 1.45 : age >= 21 ? 0.85 : 1;
	}
	if (lean === "old" && age !== undefined) {
		return age >= 22 ? 1.4 : age <= 19 ? 0.8 : 1;
	}
	if ((lean === "guards" || lean === "bigs") && pos !== undefined) {
		const guard = pos === "PG" || pos === "SG" || pos === "G";
		const big = pos === "C" || pos === "FC" || pos === "PF";
		if (guard) {
			return lean === "guards" ? 1.35 : 0.85;
		}
		if (big) {
			return lean === "bigs" ? 1.35 : 0.85;
		}
	}
	return 1;
};

export const NCAA_SCORING = {
	normal: { name: "", weight: 70 },
	explosion: { name: "a scoring explosion", weight: 15 },
	slog: { name: "a defensive slog", weight: 15 },
} as const;
export type NcaaScoring = keyof typeof NCAA_SCORING;

export type NcaaStoryline = {
	shape: NcaaShape;
	scoring: NcaaScoring;
	// The conference that was loaded (loadedConference)
	conf?: string;
	// Team indexes the shape is about: the favorite (dominant), the mid-majors that got a lift (cinderella), the blue bloods that were down (blueBloodDown)
	teams: number[];
	// What the season was simulated with. Standard: 11.5 points of standard deviation in a game's margin, 141 total points a game
	marginSd: number;
	tourneySd: number;
	total: number;
	// "A wide-open year, and a defensive slog"
	headline: string;
	// A few sentences about the season, written after it was played
	summary: string[];
	// Version 3 only (left off otherwise, so older seasons stay exactly as they were)
	// Prospects of one kind add more to their teams
	lean?: NcaaLean;
	// Rating changes in the NCAA tournament from a round on (1 = Round of 64): a hot double-digit seed, a great team fading late
	tourneyAdj?: { team: number; bonus: number; fromRound: number }[];
	// More swing in a game in the First Four and the first weekend
	earlySdMult?: number;
	// The rating changes were not known before the season (the polls are surprised)
	hidden?: boolean;
	// Version 4: the draft class shape this season matched (see CLASS_SHAPE_TIES)
	classTie?: string;
};

export const STANDARD_MARGIN_SD = 11.5;
// On a neutral court in March the better team wins a little more often than the regular season's swing says (seasons from before the storylines used 11.5 everywhere)
export const STANDARD_TOURNEY_SD = 9.2;
export const STANDARD_TOTAL = 141;

export const standardStoryline = (): NcaaStoryline => ({
	shape: "standard",
	scoring: "normal",
	teams: [],
	marginSd: STANDARD_MARGIN_SD,
	tourneySd: STANDARD_MARGIN_SD,
	total: STANDARD_TOTAL,
	headline: NCAA_SHAPES.standard.name,
	summary: [],
});

const pick = <T extends string>(
	rng: Rng,
	table: Record<T, { weight: number }>,
): T => {
	const keys = Object.keys(table) as T[];
	return rng.weighted(
		keys,
		keys.map((key) => table[key].weight),
	);
};

type StoryTeam = {
	conf: string;
	rating: number;
	// Program strength, 0-100
	program: number;
};

/**
 * Draw the season's shape and bend the team ratings for it (in place).
 */
export const drawStoryline = (
	rng: Rng,
	teams: StoryTeam[],
	version = 2,
	// Version 4: the draft class shape this season matches (ncaaClassTie)
	tie?: { key: string; shape?: NcaaShape; scoring?: NcaaScoring },
): NcaaStoryline => {
	const storyline = standardStoryline();
	storyline.tourneySd = STANDARD_TOURNEY_SD;
	storyline.shape =
		version >= 3 ? pick(rng, NCAA_SHAPES) : pick(rng, NCAA_SHAPES_V2);
	storyline.scoring = pick(rng, NCAA_SCORING);
	if (version >= 4 && tie) {
		storyline.classTie = tie.key;
		if (tie.shape) {
			storyline.shape = tie.shape;
		}
		if (tie.scoring) {
			storyline.scoring = tie.scoring;
		}
	}
	const byRating = () =>
		teams
			.map((_, i) => i)
			.sort((x, y) => teams[y]!.rating - teams[x]!.rating || x - y);
	const shuffle = (list: number[]) => {
		const output = [...list];
		for (let i = output.length - 1; i > 0; i--) {
			const j = Math.floor(rng.random() * (i + 1));
			[output[i], output[j]] = [output[j]!, output[i]!];
		}
		return output;
	};

	switch (storyline.shape) {
		case "dominant": {
			// The best team pulls away from everybody
			const [best, second] = byRating() as [number, number];
			teams[best]!.rating = Math.max(
				teams[best]!.rating + 1.5,
				teams[second]!.rating + 3,
			);
			storyline.teams = [best];
			storyline.marginSd *= 0.97;
			storyline.tourneySd *= 0.97;
			break;
		}
		case "wideOpen": {
			// Nobody separates: the top of the country is squeezed together, and games swing more
			const order = byRating();
			const pivot = teams[order[30]!]!.rating;
			for (const t of teams) {
				if (t.rating > pivot) {
					t.rating = pivot + 0.7 * (t.rating - pivot);
				}
			}
			storyline.marginSd *= 1.03;
			storyline.tourneySd *= 1.06;
			break;
		}
		case "cinderella": {
			// The leagues nobody watches are better, and a handful of their best teams are for real
			for (const t of teams) {
				if (CONFERENCES[t.conf]?.tier !== "high") {
					t.rating += 1.2;
				}
			}
			const mids = byRating()
				.filter((i) => CONFERENCES[teams[i]!.conf]?.tier !== "high")
				.slice(0, 40);
			storyline.teams = shuffle(mids)
				.slice(0, 6)
				.sort((x, y) => x - y);
			for (const i of storyline.teams) {
				teams[i]!.rating += 3.5;
			}
			storyline.tourneySd *= 1.04;
			break;
		}
		case "blueBloodDown": {
			// Half of the biggest programs have nothing
			const bluebloods = teams
				.map((_, i) => i)
				.sort((x, y) => teams[y]!.program - teams[x]!.program || x - y)
				.slice(0, 14);
			storyline.teams = shuffle(bluebloods)
				.slice(0, 7)
				.sort((x, y) => x - y);
			for (const i of storyline.teams) {
				teams[i]!.rating -= 4 + 3 * rng.random();
			}
			break;
		}
		case "loadedConference": {
			const confs = Object.keys(CONFERENCES).filter(
				(name) =>
					CONFERENCES[name]!.tier === "high" &&
					teams.some((t) => t.conf === name),
			);
			if (confs.length > 0) {
				const conf = confs[Math.floor(rng.random() * confs.length)]!;
				storyline.conf = conf;
				for (const t of teams) {
					if (t.conf === conf) {
						t.rating += 2.8;
					}
				}
			}
			break;
		}
		case "chalk": {
			// The better team wins more often
			storyline.marginSd *= 0.96;
			storyline.tourneySd *= 0.9;
			break;
		}
		case "rivalry": {
			// Two teams a class above everybody else, on a collision course
			const [a, b, c] = byRating() as [number, number, number];
			const third = teams[c]!.rating;
			teams[a]!.rating = Math.max(teams[a]!.rating + 1.2, third + 3.5);
			teams[b]!.rating = Math.max(teams[b]!.rating + 1.2, third + 3);
			storyline.teams = [a, b];
			storyline.tourneySd *= 0.97;
			break;
		}
		case "freshmen": {
			storyline.lean = "young";
			break;
		}
		case "veterans": {
			storyline.lean = "old";
			storyline.marginSd *= 0.98;
			break;
		}
		case "guards": {
			storyline.lean = "guards";
			storyline.total += 3;
			break;
		}
		case "bigs": {
			storyline.lean = "bigs";
			storyline.total -= 3;
			storyline.marginSd *= 0.98;
			break;
		}
		case "cinderellaRun": {
			// A double-digit seed gets hot in March (picked once the field is set, in ncaa.ts)
			storyline.tourneyAdj = [];
			break;
		}
		case "upsetWeekend": {
			storyline.earlySdMult = 1.3;
			break;
		}
		case "powerParity": {
			// The power leagues are squeezed together: no great teams, no bad ones
			const power = teams.filter((t) => CONFERENCES[t.conf]?.tier === "high");
			if (power.length > 0) {
				const mean = power.reduce((sum, t) => sum + t.rating, 0) / power.length;
				for (const t of power) {
					t.rating = mean + 0.6 * (t.rating - mean);
				}
			}
			storyline.tourneySd *= 1.03;
			break;
		}
		case "fallenPowerhouse": {
			// One of the very biggest programs falls apart
			const giants = teams
				.map((_, i) => i)
				.sort((x, y) => teams[y]!.program - teams[x]!.program || x - y)
				.slice(0, 6);
			const fallen = giants[Math.floor(rng.random() * giants.length)]!;
			teams[fallen]!.rating -= 8 + 3 * rng.random();
			storyline.teams = [fallen];
			break;
		}
		case "conferenceDown": {
			const confs = Object.keys(CONFERENCES).filter(
				(name) =>
					CONFERENCES[name]!.tier === "high" &&
					teams.some((t) => t.conf === name),
			);
			if (confs.length > 0) {
				const conf = confs[Math.floor(rng.random() * confs.length)]!;
				storyline.conf = conf;
				for (const t of teams) {
					if (t.conf === conf) {
						t.rating -= 3;
					}
				}
			}
			break;
		}
		case "transfers": {
			// Rosters turned over everywhere, and nobody knew who was good until they played
			for (const t of teams) {
				t.rating += rng.normal(0, 2.6);
			}
			storyline.hidden = true;
			break;
		}
		case "greatStumbles": {
			// A team that looks like one of the best ever, until it is not
			const [best, second] = byRating() as [number, number];
			teams[best]!.rating = Math.max(
				teams[best]!.rating + 2,
				teams[second]!.rating + 4.5,
			);
			storyline.teams = [best];
			storyline.tourneyAdj = [{ team: best, bonus: -4.5, fromRound: 4 }];
			break;
		}
		case "paceAndSpace": {
			// Everybody shoots threes: more points, more swing
			storyline.total += 6;
			storyline.marginSd *= 1.04;
			storyline.tourneySd *= 1.04;
			if (storyline.scoring === "slog") {
				storyline.scoring = "normal";
			}
			break;
		}
		default:
	}

	if (storyline.scoring === "explosion") {
		storyline.total += 8;
	} else if (storyline.scoring === "slog") {
		storyline.total -= 8;
	}

	const scoring = NCAA_SCORING[storyline.scoring].name;
	storyline.headline = `${NCAA_SHAPES[storyline.shape].name}${scoring ? `, and ${scoring}` : ""}`;
	return storyline;
};
