import { COLLEGES, CONFERENCES } from "./collegeStats/colleges.ts";
import { hashString } from "./collegeStats/rng.ts";
import { DRAFT_CLASS_SHAPES, type DraftClassShape } from "./draftClassShape.ts";

/**
 * Flavor for a shaped draft class (the Draft Class Shapes setting): a few storylines read off the class as it is now (its top prospects, their positions, ages, countries, schools and injuries), comparisons with earlier classes where the league has them, and a headline for the news at the draft lottery. Pure: everything is written from what is passed in, so every line is true of the class it describes.
 */

export type StoryProspect = {
	pid: number;
	name: string;
	// Age in the draft year
	age: number;
	pos: string;
	// "USA", "Canada", "Serbia", ...
	country: string;
	// "" for none
	college: string;
	ovr: number;
	pot: number;
	value: number;
	// Coming off an injury (the injury-riddled class)
	injury?: boolean;
};

// What an earlier class looked like at its draft (the ratings of its draft year), to compare with
export type ClassProfile = {
	year: number;
	// Average of (ovr + pot) / 2 of the top 10
	strength: number;
	// Point guards in the top 30
	pointGuards: number;
	// Prospects from outside the US and Canada in the top 30
	intl: number;
	// Teenagers in the top 14
	teens: number;
};

const isIntl = (p: StoryProspect) =>
	p.country !== "USA" && p.country !== "Canada";
const isBig = (pos: string) => pos === "C" || pos === "FC" || pos === "PF";
const isCenter = (pos: string) => pos === "C" || pos === "FC";
const isGuard = (pos: string) => pos === "PG" || pos === "SG" || pos === "G";

// Prospects in board order (by value, best first)
export const rankProspects = <T extends StoryProspect>(prospects: T[]) =>
	[...prospects].sort((a, b) => b.value - a.value || a.pid - b.pid);

export const getClassProfile = (
	year: number,
	ranked: StoryProspect[],
): ClassProfile => {
	const top10 = ranked.slice(0, 10);
	return {
		year,
		strength:
			top10.reduce((sum, p) => sum + (p.ovr + p.pot) / 2, 0) /
			Math.max(1, top10.length),
		pointGuards: ranked.slice(0, 30).filter((p) => p.pos === "PG").length,
		intl: ranked.slice(0, 30).filter(isIntl).length,
		teens: ranked.slice(0, 14).filter((p) => p.age <= 19).length,
	};
};

const NUMBER_WORDS = [
	"zero",
	"one",
	"two",
	"three",
	"four",
	"five",
	"six",
	"seven",
	"eight",
	"nine",
	"ten",
	"eleven",
	"twelve",
];
const numberWord = (n: number, capital = false) => {
	const word = NUMBER_WORDS[n] ?? String(n);
	return capital ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word;
};

const POSITION_NAMES: Record<string, string> = {
	PG: "point guard",
	SG: "shooting guard",
	G: "guard",
	GF: "wing",
	SF: "small forward",
	F: "forward",
	PF: "power forward",
	FC: "big man",
	C: "center",
};
const positionName = (pos: string) => POSITION_NAMES[pos] ?? pos;

const isMidMajor = (college: string) => {
	const info = COLLEGES[college];
	return !!info && CONFERENCES[info[1]]?.tier !== "high";
};

// Where he comes from, for a sentence: his school, else his country
const fromWhere = (p: StoryProspect) =>
	isIntl(p) || p.college === "" ? p.country : p.college;

/**
 * How a value compares with the earlier classes (history, any order): "since 2031" when it is the most in the classes since then (at least 4 of them), "in at least 9 years" when it is the most of all of them (at least 5). undefined if neither.
 */
export const compareWithHistory = (
	value: number,
	history: { year: number; value: number }[],
	direction: "most" | "least" = "most",
): string | undefined => {
	const sorted = [...history].sort((a, b) => b.year - a.year);
	let streak = 0;
	for (const h of sorted) {
		if (direction === "most" ? value > h.value : value < h.value) {
			streak += 1;
		} else {
			break;
		}
	}
	if (streak === sorted.length) {
		return streak >= 5 ? `in at least ${streak} years` : undefined;
	}
	return streak >= 4 ? `since ${sorted[streak]!.year}` : undefined;
};

type Line = { text: string; salience: number };

export type ClassStoryInput = {
	draftYear: number;
	shape: DraftClassShape;
	// The class, any order
	prospects: StoryProspect[];
	// Earlier classes at their drafts, only when this class is at its draft too (else the comparison would not be fair)
	history?: ClassProfile[];
	// The college season of the class's draft year matched the class (both settings on): its name, like "The year of the freshman"
	ncaaTie?: string;
};

// A choice of wording that is the same every time for the same class
const pickWording = (seed: string, options: string[]) =>
	options[hashString(seed) % options.length]!;

const describeNo1 = (draftYear: number, p: StoryProspect) => {
	const who = `${p.age}-year-old ${positionName(p.pos)}`;
	const from = fromWhere(p);
	return pickWording(`${draftYear}|${p.pid}|no1`, [
		`The consensus No. 1, ${p.name}, is a ${who} from ${from}.`,
		`${p.name}, a ${who} from ${from}, tops most boards.`,
		`Most boards start with ${p.name}, a ${who} from ${from}.`,
	]);
};

/**
 * 2-4 storylines about a class, the most interesting first after the one about its top prospect.
 */
export const writeClassStorylines = ({
	draftYear,
	prospects,
	history,
	ncaaTie,
}: ClassStoryInput): string[] => {
	const ranked = rankProspects(prospects);
	const no1 = ranked[0];
	if (!no1) {
		return [];
	}
	const top10 = ranked.slice(0, 10);
	const top14 = ranked.slice(0, 14);
	const top30 = ranked.slice(0, 30);
	const profile = getClassProfile(draftYear, ranked);
	const lines: Line[] = [];
	const add = (text: string, salience: number) => {
		lines.push({ text, salience });
	};
	const since = (
		key: keyof Omit<ClassProfile, "year">,
		direction: "most" | "least" = "most",
	) =>
		history && history.length > 0
			? compareWithHistory(
					profile[key],
					history.map((h) => ({ year: h.year, value: h[key] })),
					direction,
				)
			: undefined;

	// Against earlier classes
	const best = since("strength");
	const worst = best ? undefined : since("strength", "least");
	if (best) {
		add(`The best class at the top ${best}, by the scouts' ratings.`, 9);
	} else if (worst) {
		add(`The weakest top of a class ${worst}, by the scouts' ratings.`, 8);
	}

	// The top of the board
	const values = ranked.slice(0, 3).map((p) => p.value);
	if (values.length >= 3) {
		const [v1, v2, v3] = values as [number, number, number];
		if (v1 - v2 <= 1.5 && v2 - v3 >= 4) {
			add(
				`Two names stand above everybody else: ${no1.name} and ${ranked[1]!.name}.`,
				7,
			);
		} else if (v1 - v2 >= 6) {
			add(`A clear No. 1: nobody else is close to ${no1.name}.`, 6);
		} else if (v1 - v3 <= 1.5) {
			add("The top three are separated by a hair.", 6);
		}
	}

	// Positions
	const centers = top10.filter((p) => isCenter(p.pos)).length;
	const bigs = top10.filter((p) => isBig(p.pos)).length;
	const guards = top10.filter((p) => isGuard(p.pos)).length;
	if (centers >= 3) {
		add(`${numberWord(centers, true)} centers in the top 10.`, 6);
	} else if (top10.length === 10 && bigs === 0) {
		add("Not one big man in the top 10.", 6);
	}
	if (guards >= 6) {
		add(`${numberWord(guards, true)} guards in the top 10.`, 5);
	}
	const pgSince = profile.pointGuards >= 5 ? since("pointGuards") : undefined;
	if (pgSince) {
		add(
			`The deepest point guard class ${pgSince}: ${profile.pointGuards} in the top 30.`,
			7,
		);
	} else if (profile.pointGuards >= 8) {
		add(
			`${numberWord(profile.pointGuards, true)} point guards in the top 30.`,
			5,
		);
	}

	// Ages
	const teensSince = profile.teens >= 6 ? since("teens") : undefined;
	if (teensSince) {
		add(
			`The youngest lottery ${teensSince}: ${profile.teens} of the top 14 are teenagers.`,
			7,
		);
	} else if (profile.teens >= 11) {
		add(
			`${numberWord(profile.teens, true)} teenagers among the top 14 prospects.`,
			6,
		);
	}
	const old = top14.filter((p) => p.age >= 22).length;
	if (old >= 6) {
		add(`${numberWord(old, true)} of the top 14 prospects are 22 or older.`, 5);
	}

	// Where they come from
	const countries = new Map<string, number>();
	for (const p of top30) {
		if (p.country !== "USA") {
			countries.set(p.country, (countries.get(p.country) ?? 0) + 1);
		}
	}
	const topCountry = [...countries].sort(
		(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
	)[0];
	if (topCountry && topCountry[1] >= 3) {
		add(
			`${numberWord(topCountry[1], true)} of the top 30 prospects are from ${topCountry[0]}.`,
			7,
		);
	}
	const intlSince = profile.intl >= 8 ? since("intl") : undefined;
	if (intlSince) {
		add(
			`The most international top 30 ${intlSince}: ${profile.intl} prospects from outside North America.`,
			7,
		);
	} else if (profile.intl >= 9) {
		add(
			`${numberWord(profile.intl, true)} prospects from outside North America in the top 30.`,
			6,
		);
	}
	const schools = new Map<string, number>();
	for (const p of top10) {
		if (p.college !== "" && !isIntl(p)) {
			schools.set(p.college, (schools.get(p.college) ?? 0) + 1);
		}
	}
	const topSchool = [...schools].sort(
		(a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
	)[0];
	if (topSchool && topSchool[1] >= 2) {
		add(
			`${topSchool[0]} has ${numberWord(topSchool[1])} of the top 10 prospects.`,
			5,
		);
	}
	const mids = top30.filter((p) => !isIntl(p) && isMidMajor(p.college)).length;
	if (mids >= 18) {
		add(
			`${numberWord(mids, true)} of the top 30 prospects come from schools outside the power conferences.`,
			6,
		);
	}

	// Injuries
	const hurt = top30.filter((p) => p.injury);
	if (hurt.length >= 3) {
		const topHurt = ranked.findIndex((p) => p.injury);
		add(
			`${numberWord(hurt.length, true)} of the top 30 prospects are coming back from injuries${
				topHurt >= 0 && topHurt < 10
					? `, ${ranked[topHurt]!.name} (No. ${topHurt + 1}) among them`
					: ""
			}.`,
			7,
		);
	}

	if (ncaaTie) {
		add(
			`College basketball saw it coming: the season was ${ncaaTie[0]!.toLowerCase()}${ncaaTie.slice(1)}.`,
			8,
		);
	}

	const chosen = lines
		.map((line, i) => ({ ...line, i }))
		.sort((a, b) => b.salience - a.salience || a.i - b.i)
		.slice(0, 3)
		.map((line) => line.text);
	if (chosen.length === 0 && ranked[1]) {
		const p = ranked[1];
		chosen.push(
			`Next on most boards: ${p.name}, a ${p.age}-year-old ${positionName(p.pos)} from ${fromWhere(p)}.`,
		);
	}
	return [describeNo1(draftYear, no1), ...chosen];
};

// For the shapes whose name does not read as "a ... class"
const HEADLINE_PHRASES: Partial<Record<DraftClassShape, string>> = {
	generational: "a class with a generational talent at the top",
	noClearTop: "a class with no clear No. 1",
	athletes: "a class of athletic freaks",
	intlBigs: "a class of international big men",
	midMajor: "a class of mid-major gems",
	polished: "a polished class with low ceilings",
	coHeadliners: "a class with two franchise prospects at the top",
	countrySpike: "a class with a home-country spike",
};

/**
 * One line for the news when the class is on the clock (the draft lottery): the class, how it compares, and its No. 1.
 */
export const writeClassHeadline = (
	input: ClassStoryInput,
	storylines = writeClassStorylines(input),
): string => {
	const { draftYear, shape } = input;
	const name = DRAFT_CLASS_SHAPES[shape].name;
	const lower =
		HEADLINE_PHRASES[shape] ?? `${name[0]!.toLowerCase()}${name.slice(1)}`;
	const ranked = rankProspects(input.prospects);
	const profile = getClassProfile(draftYear, ranked);
	const history = input.history ?? [];
	const best = compareWithHistory(
		profile.strength,
		history.map((h) => ({ year: h.year, value: h.strength })),
	);
	const worst = best
		? undefined
		: compareWithHistory(
				profile.strength,
				history.map((h) => ({ year: h.year, value: h.strength })),
				"least",
			);
	const compare = best
		? ` (the best ${best})`
		: worst
			? ` (the weakest ${worst})`
			: "";
	const lead = pickWording(`${draftYear}|${shape}|headline`, [
		`Scouts call the ${draftYear} draft class ${lower}${compare}.`,
		`The verdict on the ${draftYear} draft class: ${lower}${compare}.`,
		`The ${draftYear} draft class is on the clock, and it is ${lower}${compare}.`,
	]);
	return [lead, ...storylines.slice(0, 2)].join(" ");
};
