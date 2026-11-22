// Pre-draft injuries (Pre-Draft Injuries & Combine Medicals, a core League Extra). Part of a prospect's career plan (career.ts): which of
// his seasons before the draft had an injury, what it was and how many games it cost him. Drawn from a stream of its own (seed, draft
// year, pid), so a prospect with a clean history gets exactly the seasons he got before this existed, and nothing else about him changes.
//
// Rates per season played, for a prospect of average durability: 9% a minor injury (2-8 games), 2% a longer one (8-20 games) and 0.6%
// a season-ending one (a knee reconstruction or the like, earlier seasons only). Over generated classes about 75% of prospects are
// clean, 16% have only minor injuries and 8% a major one (counting the medical redshirts and the injury story, which already existed and
// now get an injury type). Low durability (Player Traits) raises the rates (durability 30: 63% clean, 12% major), high durability
// lowers them (70: 85% clean, 6% major).
import { Rng, clamp } from "./rng.ts";

export type PreDraftInjury = {
	// An injury name from the game's injury list
	type: string;
	// Games missed that season. 0 for a season-ending injury: the rest of the season (his stats row has the games he played)
	games: number;
	// A major injury (a long absence, surgery or the end of the season)
	major?: true;
	// It ended his season
	ended?: true;
};

type InjuryDef = [type: string, weight: number];

// Each list uses names from the game's basketball injury list (worker/util/defaultInjuries.ts)
const MINOR: InjuryDef[] = [
	["Sprained Ankle", 30],
	["Sore Knee", 10],
	["Strained Hamstring", 9],
	["Strained Calf", 7],
	["Sore Back", 7],
	["Concussion", 6],
	["Strained Groin", 6],
	["Sprained Wrist", 4],
	["Bruised Knee", 5],
	["Sore Foot", 5],
	["Sprained Thumb", 3],
	["Patellar Tendinitis", 4],
	["Back Spasms", 3],
	["Sprained Knee", 4],
	["Fractured Nose", 2],
];
const MAJOR: InjuryDef[] = [
	["Fractured Foot", 20],
	["Fractured Hand", 16],
	["Torn Meniscus", 14],
	["Sprained Knee", 14],
	["Fractured Ankle", 12],
	["Herniated Disc", 8],
	["Fractured Finger", 8],
	["Fractured Rib", 8],
];
const SEASON_ENDING: InjuryDef[] = [
	["Torn ACL", 40],
	["Torn Meniscus", 16],
	["Fractured Foot", 18],
	["Fractured Ankle", 8],
	["Torn Achilles Tendon", 6],
	["Herniated Disc", 10],
];

// Every injury name used here
export const PRE_DRAFT_INJURY_TYPES = [
	...new Set([...MINOR, ...MAJOR, ...SEASON_ENDING].map((d) => d[0])),
];

// Knee and lower-leg reconstructions: the injuries teams worry about most
export const RECONSTRUCTIONS = new Set([
	"Torn ACL",
	"Torn Achilles Tendon",
	"Torn Meniscus",
]);

export const PRE_DRAFT_INJURY_RATES = {
	minor: 0.09,
	major: 0.02,
	seasonEnding: 0.006,
};

/**
 * How much more (or less) often a prospect gets hurt than an average one, from his durability trait score (0-100, 50 average). 1 when
 * it's not known (Player Traits off). Durability 30: about 1.8x; 70: about 0.55x.
 */
export const injuryRateMultiplier = (durability: number | undefined) =>
	durability === undefined
		? 1
		: clamp(Math.exp(-0.03 * (durability - 50)), 0.4, 2.5);

const pick = (rng: Rng, defs: InjuryDef[]) =>
	rng.weighted(
		defs.map((d) => d[0]),
		defs.map((d) => d[1]),
	);

// What the career plan needs to know about each year
type PlanYear = {
	yearsBack: number;
	played: boolean;
	status?: "redshirt" | "medical" | "injury" | "gap";
	gamesCap?: number;
	injury?: PreDraftInjury;
	// Games missed in the middle of a season (the season simulation takes them out of his games played)
	injuryGames?: number;
};

/**
 * Give a career plan's years their injuries. Years whose season already ended early (a medical redshirt, the injury story) get an injury
 * type; the rest can get a new injury. Mutates the years.
 */
export const planInjuries = (
	years: PlanYear[],
	{
		seedBase,
		durability,
		// Games in a season at his level, about
		seasonGames,
	}: { seedBase: string; durability?: number; seasonGames: number },
) => {
	const rng = new Rng(`${seedBase}|injuries`);
	const mult = injuryRateMultiplier(durability);
	for (const year of years) {
		// Every draw is made for every year, so one year's injury never moves another's
		const uMinor = rng.random();
		const uMajor = rng.random();
		const uEnded = rng.random();
		const typeMinor = pick(rng, MINOR);
		const typeMajor = pick(rng, MAJOR);
		const typeEnded = pick(rng, SEASON_ENDING);
		const gamesMinor = 2 + Math.floor(rng.random() * 7);
		const gamesMajor = 8 + Math.floor(rng.random() * 13);
		// A season-ending injury after this many games (past the medical redshirt window)
		const playedBefore = 12 + Math.floor(rng.random() * 10);
		if (!year.played) {
			continue;
		}
		if (year.status === "medical" || year.status === "injury") {
			// Already cut short by the career model: the injury that did it
			year.injury = { type: typeEnded, games: 0, major: true, ended: true };
			continue;
		}
		if (
			year.yearsBack > 0 &&
			uEnded < PRE_DRAFT_INJURY_RATES.seasonEnding * mult
		) {
			year.status = "injury";
			year.gamesCap = Math.min(playedBefore, Math.round(0.7 * seasonGames));
			year.injury = { type: typeEnded, games: 0, major: true, ended: true };
		} else if (uMajor < PRE_DRAFT_INJURY_RATES.major * mult) {
			const games = Math.min(gamesMajor, Math.round(0.5 * seasonGames));
			year.injuryGames = games;
			year.injury = { type: typeMajor, games, major: true };
		} else if (uMinor < PRE_DRAFT_INJURY_RATES.minor * mult) {
			year.injuryGames = gamesMinor;
			year.injury = { type: typeMinor, games: gamesMinor };
		}
	}
};

export type CareerInjury = PreDraftInjury & { season: number };

// The injuries of a stored career, oldest first. A season cut short in a career from before injuries were recorded is listed without a
// type
export const careerInjuries = (
	career:
		| {
				years: {
					season: number;
					status?: string;
					injury?: PreDraftInjury;
				}[];
		  }
		| undefined,
): CareerInjury[] => {
	const out: CareerInjury[] = [];
	for (const year of career?.years ?? []) {
		if (year.injury) {
			out.push({ season: year.season, ...year.injury });
		} else if (year.status === "medical" || year.status === "injury") {
			out.push({
				season: year.season,
				type: "Undisclosed injury",
				games: 0,
				major: true,
				ended: true,
			});
		}
	}
	return out;
};

export const hasMajorPreDraftInjury = (
	career: Parameters<typeof careerInjuries>[0],
) => careerInjuries(career).some((inj) => inj.major);

// One line for an injury, like "Fractured Hand, missed 12 games" or "Torn ACL, season-ending"
export const injuryText = (inj: PreDraftInjury, gp?: number) =>
	inj.ended
		? `${inj.type}, season-ending${gp !== undefined ? ` after ${gp} ${gp === 1 ? "game" : "games"}` : ""}`
		: `${inj.type}, missed ${inj.games} ${inj.games === 1 ? "game" : "games"}`;
