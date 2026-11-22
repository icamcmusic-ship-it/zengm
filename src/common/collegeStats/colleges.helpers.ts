import { getLeagueEnv } from "./overseas.ts";
import {
	COLLEGES,
	CONFERENCES,
	NON_NCAA,
	OVERSEAS_EXTRA,
	PATHWAY_STRENGTH,
	PATHWAY_TEAM,
	getLeagueHome,
	type Region,
} from "./colleges.ts";
import type { Rng } from "./rng.ts";

const EUROPE = new Set([
	"Albania",
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
	"Estonia",
	"Finland",
	"France",
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
	"Montenegro",
	"Netherlands",
	"North Macedonia",
	"Norway",
	"Poland",
	"Portugal",
	"Romania",
	"Russia",
	"Serbia",
	"Slovakia",
	"Slovenia",
	"Spain",
	"Sweden",
	"Switzerland",
	"Turkey",
	"Ukraine",
	"United Kingdom",
	"England",
	"Scotland",
	"Wales",
	"Israel",
	"Georgia",
	"Moldova",
	"Azerbaijan",
	"Armenia",
	"Andorra",
	"Monaco",
	"Malta",
	"Bosnia",
	"Macedonia",
]);
const OCEANIA = new Set(["Australia", "New Zealand", "Fiji", "Samoa", "Tonga"]);
const ASIA = new Set([
	"China",
	"Japan",
	"South Korea",
	"Korea",
	"Philippines",
	"India",
	"Taiwan",
	"Iran",
	"Lebanon",
	"Jordan",
	"Kazakhstan",
	"Uzbekistan",
	"Thailand",
	"Indonesia",
	"Vietnam",
	"Malaysia",
	"Mongolia",
	"Syria",
	"Iraq",
	"North Korea",
	"Macau",
	"Singapore",
	"Qatar",
	"Saudi Arabia",
]);
const LATAM = new Set([
	"Brazil",
	"Argentina",
	"Mexico",
	"Dominican Republic",
	"Puerto Rico",
	"Venezuela",
	"Colombia",
	"Chile",
	"Uruguay",
	"Cuba",
	"Panama",
	"Bahamas",
	"Haiti",
	"Jamaica",
	"Virgin Islands",
	"Peru",
	"Ecuador",
	"Trinidad and Tobago",
	"Barbados",
	"Belize",
	"Bermuda",
	"Guyana",
	"Costa Rica",
	"El Salvador",
	"Guatemala",
	"Honduras",
	"Nicaragua",
	"Bolivia",
	"Paraguay",
	"Curaçao",
	"Guadeloupe",
	"Martinique",
	"French Guiana",
]);
const AFRICA = new Set([
	"Nigeria",
	"Senegal",
	"Cameroon",
	"Ghana",
	"South Sudan",
	"Sudan",
	"Mali",
	"Egypt",
	"Angola",
	"Democratic Republic of the Congo",
	"DR Congo",
	"Congo",
	"Ivory Coast",
	"Cote d'Ivoire",
	"Kenya",
	"Tanzania",
	"Uganda",
	"Morocco",
	"Tunisia",
	"Algeria",
	"Guinea",
	"Gabon",
	"Ethiopia",
	"Liberia",
	"Sierra Leone",
	"Zimbabwe",
	"South Africa",
	"Mozambique",
	"Rwanda",
	"Benin",
	"Togo",
	"Chad",
	"Central African Republic",
	"Burkina Faso",
	"Cape Verde",
	"Somalia",
	"Libya",
	"Guinea-Bissau",
	"Niger",
	"Zambia",
	"Botswana",
	"Namibia",
]);

export const getRegion = (bornLoc: string): Region => {
	const parts = bornLoc.split(",").map((part) => part.trim());
	const country = parts.at(-1) ?? "";
	if (
		country === "" ||
		country === "USA" ||
		country === "United States" ||
		// "Chicago, IL"
		(parts.length === 2 && /^[A-Z]{2}$/.test(country))
	) {
		return "usa";
	}
	if (country === "Canada") {
		return "canada";
	}
	if (EUROPE.has(country)) {
		return "europe";
	}
	if (OCEANIA.has(country)) {
		return "oceania";
	}
	if (ASIA.has(country)) {
		return "asia";
	}
	if (LATAM.has(country)) {
		return "latam";
	}
	if (AFRICA.has(country)) {
		return "africa";
	}
	return "other";
};

export type School = {
	name: string;
	conference: string | undefined;
	// 0-100
	strength: number;
	// Pro club or youth program rather than a college
	nonCollege: boolean;
	idle: boolean;
	gameMinutes: number;
};

export const getSchool = (name: string): School | undefined => {
	const college = COLLEGES[name];
	if (college) {
		const conference = college[1];
		const conf = CONFERENCES[conference];
		// Program strength varies within a conference with the program's prestige (frequency in BBGM)
		const prestige = Math.log10(1 + college[0]) * 4 - 3;
		return {
			name,
			conference,
			strength: (conf?.strength ?? 60) + prestige,
			nonCollege: false,
			idle: false,
			gameMinutes: 40,
		};
	}
	if (name === PATHWAY_TEAM) {
		return {
			name,
			conference: undefined,
			strength: PATHWAY_STRENGTH,
			nonCollege: true,
			idle: false,
			gameMinutes: getLeagueEnv(name)!.gameMinutes,
		};
	}
	const extra = OVERSEAS_EXTRA[name];
	const other: (typeof NON_NCAA)[string] | undefined =
		NON_NCAA[name] ?? (extra ? { ...extra, pro: true } : undefined);
	if (other) {
		return {
			name,
			conference: undefined,
			strength: other.strength,
			nonCollege: true,
			idle: !!other.idle,
			gameMinutes: getLeagueEnv(name)?.gameMinutes ?? other.gameMinutes ?? 40,
		};
	}
};

// Chance a prospect with a blank college played at an NCAA school, by where he was born. Random players leagues have no colleges at all, so most Americans need one
const P_COLLEGE: Record<Region, number> = {
	usa: 0.88,
	canada: 0.65,
	europe: 0.08,
	oceania: 0.25,
	asia: 0.08,
	latam: 0.25,
	africa: 0.35,
	other: 0.2,
};

// The country of a birthplace ("Belgrade, Serbia" -> "Serbia"), "USA" for an American one ("Chicago, IL")
export const getCountry = (bornLoc: string) => {
	const parts = bornLoc.split(",").map((part) => part.trim());
	const country = parts.at(-1) ?? "";
	if (
		country === "" ||
		country === "United States" ||
		(parts.length === 2 && /^[A-Z]{2}$/.test(country))
	) {
		return "USA";
	}
	return country;
};

// More pre-draft paths: how much a prospect leans to the domestic league of his own country, and away from the domestic league of
// another country of his part of the world (a Spaniard plays in Spain much more often than in Poland)
const HOME_LEAGUE_BOOST = 5;
// ...less for a league that is home to a whole continent (the Basketball Africa League)
const CONTINENTAL_HOME_BOOST = 2;
const AWAY_LEAGUE_FACTOR = 0.55;

/**
 * How much more (or less) likely a prospect born in `country` is to play in a league than its regional weight says (preDraftPaths): its domestic league is the most likely, other countries' domestic leagues less likely, leagues that draw from everywhere (the EuroLeague, the G League...) unchanged.
 */
export const homeLeagueFactor = (league: string, country: string) => {
	const home = getLeagueHome(league);
	if (home.length === 0) {
		return 1;
	}
	if (!home.includes(country)) {
		return AWAY_LEAGUE_FACTOR;
	}
	return home.length > 8 ? CONTINENTAL_HOME_BOOST : HOME_LEAGUE_BOOST;
};

const INTL_G_LEAGUE_FACTOR = 0.5;

// The draft year destinations of a blank college with the paths on: the ones of NON_NCAA and the overseas leagues with a `dest` weight
let moreDestinations: {
	name: string;
	w: number;
	strength: number;
	pro: boolean;
}[];
const getMoreDestinations = () => {
	moreDestinations ??= [
		...Object.entries(NON_NCAA).map(([name, info]) => ({
			name,
			w: info.w,
			strength: info.strength,
			pro: info.pro && !info.youth,
		})),
		...Object.entries(OVERSEAS_EXTRA)
			.filter(([, info]) => info.dest !== undefined)
			.map(([name, info]) => ({
				name,
				w: info.dest!,
				strength: info.strength,
				pro: true,
			})),
	];
	return moreDestinations;
};

/**
 * Where a prospect with a blank (or unknown) college played: mostly an NCAA school for players born in North America, otherwise a pro club or program weighted by where he was born. Better prospects lean toward bigger programs.
 *
 * With `more` (preDraftPaths) the same one draw picks from more leagues (second divisions and the domestic leagues of more countries), leaning to the domestic league of his own country (homeLeagueFactor), and better prospects lean toward stronger leagues as they do toward bigger programs. Who goes to college and which college are the same as without it.
 */
export const pickBlankDestination = (
	bornLoc: string,
	rng: Rng,
	talentZ: number,
	more = false,
) => {
	const region = getRegion(bornLoc);
	if (rng.random() < P_COLLEGE[region]) {
		const names = Object.keys(COLLEGES);
		const exponent = Math.max(0.2, Math.min(1.2, 0.55 + 0.3 * talentZ));
		const weights = names.map((name) => (COLLEGES[name]![0] + 0.5) ** exponent);
		return rng.weighted(names, weights);
	}

	if (more) {
		const country = getCountry(bornLoc);
		const list = getMoreDestinations();
		const regionOf = (name: string) =>
			(NON_NCAA[name] ?? OVERSEAS_EXTRA[name])!.regions[region] ?? 1;
		const weights = list.map(
			({ name, w, strength, pro }) =>
				w *
				regionOf(name) *
				homeLeagueFactor(name, country) *
				// An international prospect is in the G League less often than its regional weight says once the leagues of his own country
				// are on the list (a teenager abroad signs at home first)
				(name === "NBA G League" && region !== "usa" && region !== "canada"
					? INTL_G_LEAGUE_FACTOR
					: 1) *
				// A top prospect is at a top club, a raw one where he plays (pro leagues only: a prep year or a small college is not a
				// level of pro competition)
				(pro ? Math.exp(0.5 * talentZ * ((strength - 66) / 14)) : 1),
		);
		return rng.weighted(list, weights).name;
	}

	const names = Object.keys(NON_NCAA);
	const weights = names.map((name) => {
		const info = NON_NCAA[name]!;
		return info.w * (info.regions[region] ?? 1);
	});
	return rng.weighted(names, weights);
};

// For a prospect whose college is not one we know (a modded league file), the closest thing to a typical mid-major
export const unknownSchool = (name: string): School => ({
	name,
	conference: undefined,
	strength: 62,
	nonCollege: false,
	idle: false,
	gameMinutes: 40,
});
