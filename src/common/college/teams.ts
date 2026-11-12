// College mode: the teams of a college league, built from the school list of the prospect model (collegeStats/colleges.ts).
// See docs/college-mode.md.
import { COLLEGES, CONFERENCES } from "../collegeStats/colleges.ts";
import { hashString } from "../collegeStats/rng.ts";

export const COLLEGE_LEVELS = ["power", "major", "full"] as const;
export type CollegeLevel = (typeof COLLEGE_LEVELS)[number];

export const COLLEGE_LEVEL_INFO: Record<
	CollegeLevel,
	{ name: string; description: string }
> = {
	power: {
		name: "Power conferences",
		description:
			"The five strongest conferences (79 schools, 32-team national tournament). Fastest.",
	},
	major: {
		name: "Major conferences",
		description:
			"The power conferences and the best mid-major conferences (145 schools, 32-team national tournament).",
	},
	full: {
		name: "All of Division I",
		description:
			"All 32 conferences (364 schools, 64-team national tournament). About 4-5 times slower than the power conferences.",
	},
};

// Conference strength from which a conference is part of the "major" level
const MAJOR_MIN_STRENGTH = 69;

export const getCollegeConferenceNames = (level: CollegeLevel) => {
	const used = new Set(Object.values(COLLEGES).map((row) => row[1]));
	return Object.entries(CONFERENCES)
		.filter(([name, info]) => {
			if (!used.has(name)) {
				return false;
			}
			if (level === "full") {
				return true;
			}
			if (level === "major") {
				return info.strength >= MAJOR_MIN_STRENGTH;
			}
			return info.tier === "high";
		})
		.sort((a, b) => b[1].strength - a[1].strength || (a[0] < b[0] ? -1 : 1))
		.map(([name]) => name);
};

// Program prestige, 0-100: conference strength plus the program's own weight (same formula as getSchool in the prospect model)
export const getSchoolPrestige = (school: string) => {
	const row = COLLEGES[school];
	if (!row) {
		return undefined;
	}
	const conf = CONFERENCES[row[1]];
	return (
		Math.round(((conf?.strength ?? 60) + Math.log10(1 + row[0]) * 4 - 3) * 10) /
		10
	);
};

// Generic nicknames, so no real mascot is used. Picked by a hash of the school name
const NICKNAMES = [
	"Aces",
	"Archers",
	"Arrows",
	"Barons",
	"Bisons",
	"Blazers",
	"Captains",
	"Chargers",
	"Comets",
	"Condors",
	"Cyclones",
	"Dragons",
	"Dukes",
	"Falcons",
	"Foxes",
	"Generals",
	"Giants",
	"Griffins",
	"Harriers",
	"Hawks",
	"Herons",
	"Hornets",
	"Kings",
	"Knights",
	"Lancers",
	"Lynx",
	"Mariners",
	"Monarchs",
	"Mustangs",
	"Otters",
	"Owls",
	"Pilots",
	"Pioneers",
	"Rams",
	"Rangers",
	"Ravens",
	"Rockets",
	"Royals",
	"Sabers",
	"Scouts",
	"Stags",
	"Stars",
	"Storm",
	"Titans",
	"Vipers",
	"Voyagers",
	"Wolves",
];

const hsl = (h: number, s: number, l: number) => {
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(255 * c)
			.toString(16)
			.padStart(2, "0");
	};
	return `#${f(0)}${f(8)}${f(4)}`;
};

const getColors = (school: string): [string, string, string] => {
	const h = hashString(`${school}|colors`);
	const hue = h % 360;
	const dark = ((h >>> 9) % 100) / 100;
	const primary = hsl(hue, 0.55 + 0.35 * dark, 0.24 + 0.16 * dark);
	const kind = (h >>> 17) % 4;
	const secondary =
		kind === 0
			? "#ffffff"
			: kind === 1
				? hsl((hue + 40 + ((h >>> 20) % 60)) % 360, 0.75, 0.55)
				: kind === 2
					? "#c9a227"
					: "#b0b7bc";
	const tertiary = kind === 0 ? "#b0b7bc" : "#ffffff";
	return [primary, secondary, tertiary];
};

const SKIP_WORDS = new Set(["of", "the", "at", "and", "&"]);

const abbrevCandidates = (school: string) => {
	const clean = school
		.replaceAll(/[^ &A-Za-z-]/g, "")
		.replaceAll("-", " ")
		.trim();
	const words = clean.split(/\s+/).filter((w) => !SKIP_WORDS.has(w));
	const candidates: string[] = [];
	const up = (s: string) => s.toUpperCase();
	if (words.length === 1) {
		const w = words[0]!;
		if (w.length <= 4) {
			candidates.push(up(w));
		}
		candidates.push(up(w.slice(0, 4)), up(w.slice(0, 3)), up(w.slice(0, 5)));
	} else {
		const initials = words.map((w) => w[0]).join("");
		const first = words[0]!;
		const lastWord = words.at(-1)!;
		if (first === up(first) && first.length <= 4 && words.length === 2) {
			// "UC Davis", "LSU ..."
			candidates.push(up(first + lastWord.slice(0, 4 - first.length || 1)));
		}
		if (lastWord === "State" && words.length === 2) {
			candidates.push(
				up(first.slice(0, 3)) + "S",
				up(first.slice(0, 2)) + "ST",
			);
		}
		if (initials.length >= 3) {
			candidates.push(up(initials.slice(0, 4)));
		}
		candidates.push(
			up(first.slice(0, 2) + lastWord.slice(0, 2)),
			up(first.slice(0, 3) + lastWord[0]),
			up(first[0] + lastWord.slice(0, 3)),
			up(initials + lastWord.slice(1, 3)),
			up(first.slice(0, 4) + lastWord[0]),
		);
	}
	return candidates.filter((c) => c.length >= 2 && c.length <= 5);
};

export type CollegeTeamInfo = {
	tid: number;
	cid: number;
	did: number;
	region: string;
	name: string;
	abbrev: string;
	pop: number;
	colors: [string, string, string];
	// Not part of the engine's team: where the school is from
	conference: string;
	prestige: number;
};

/**
 * Teams, conferences and divisions (one per conference) of a college league. Deterministic.
 */
export const getCollegeLeagueTeams = (level: CollegeLevel) => {
	const conferenceNames = getCollegeConferenceNames(level);
	const cidByName = new Map(conferenceNames.map((name, i) => [name, i]));

	const schools = Object.keys(COLLEGES)
		.filter((school) => cidByName.has(COLLEGES[school]![1]))
		.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));

	const usedAbbrevs = new Set<string>();
	const teams: CollegeTeamInfo[] = schools.map((school, tid) => {
		const conference = COLLEGES[school]![1];
		const cid = cidByName.get(conference)!;
		let abbrev = abbrevCandidates(school).find((c) => !usedAbbrevs.has(c));
		if (!abbrev) {
			const base = school.replaceAll(/[^A-Za-z]/g, "").toUpperCase();
			for (let i = 2; i < 100 && !abbrev; i++) {
				const candidate = `${base.slice(0, 3)}${i}`;
				if (!usedAbbrevs.has(candidate)) {
					abbrev = candidate;
				}
			}
		}
		usedAbbrevs.add(abbrev!);
		const prestige = getSchoolPrestige(school)!;
		return {
			tid,
			cid,
			did: cid,
			region: school,
			name: NICKNAMES[hashString(`${school}|nickname`) % NICKNAMES.length]!,
			abbrev: abbrev!,
			// Bigger programs are bigger "markets" (only matters for things like attendance and the difficulty of the job)
			pop: Math.round((0.3 + ((prestige - 40) / 60) ** 2 * 6) * 10) / 10,
			colors: getColors(school),
			conference,
			prestige,
		};
	});

	const confs = conferenceNames.map((name, cid) => ({ cid, name }));
	const divs = conferenceNames.map((name, cid) => ({ did: cid, cid, name }));

	return { teams, confs, divs };
};

// Size of the national tournament for a league of numTeams teams
export const getCollegeTournamentSize = (numTeams: number) => {
	if (numTeams >= 200) {
		return 64;
	}
	if (numTeams >= 64) {
		return 32;
	}
	if (numTeams >= 32) {
		return 16;
	}
	if (numTeams >= 16) {
		return 8;
	}
	return 4;
};
