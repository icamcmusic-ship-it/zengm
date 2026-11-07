import { COLLEGES, CONFERENCES, NON_NCAA, type Region } from "./colleges.ts";
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
	"Thailand",
	"Indonesia",
	"Vietnam",
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
	const other = NON_NCAA[name];
	if (other) {
		return {
			name,
			conference: undefined,
			strength: other.strength,
			nonCollege: true,
			idle: !!other.idle,
			gameMinutes: name === "NBA G League" ? 48 : 40,
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

/**
 * Where a prospect with a blank (or unknown) college played: mostly an NCAA school for players born in North America, otherwise a pro club or program weighted by where he was born. Better prospects lean toward bigger programs.
 */
export const pickBlankDestination = (
	bornLoc: string,
	rng: Rng,
	talentZ: number,
) => {
	const region = getRegion(bornLoc);
	if (rng.random() < P_COLLEGE[region]) {
		const names = Object.keys(COLLEGES);
		const exponent = Math.max(0.2, Math.min(1.2, 0.55 + 0.3 * talentZ));
		const weights = names.map((name) => (COLLEGES[name]![0] + 0.5) ** exponent);
		return rng.weighted(names, weights);
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
