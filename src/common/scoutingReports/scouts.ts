// Scouting departments: every team has 2-5 scouts, made from its scouting budget. Nothing is stored: who works where in any season is
// drawn from the league seed, the team and the slot (each slot has a chain of scouts, each staying a few years), so departments change
// on their own (scouts are hired and leave) and old bylines can always be looked up again. Pure.
import { Rng } from "../ratingsBuilds/rng.ts";
import type {
	Scout,
	ScoutBias,
	ScoutBrief,
	ScoutDepartment,
	Specialty,
} from "./types.ts";

const FIRST = [
	"Al",
	"Andre",
	"Arturo",
	"Barry",
	"Ben",
	"Bill",
	"Bo",
	"Brad",
	"Carl",
	"Chet",
	"Chris",
	"Clint",
	"Curtis",
	"Dale",
	"Dan",
	"Darnell",
	"Dave",
	"Dennis",
	"Desmond",
	"Don",
	"Doug",
	"Earl",
	"Eddie",
	"Felipe",
	"Frank",
	"Gary",
	"Gene",
	"Glen",
	"Greg",
	"Hank",
	"Hector",
	"Howard",
	"Ivan",
	"Jack",
	"Jamal",
	"Jeff",
	"Jerome",
	"Jim",
	"Joe",
	"Jorge",
	"Keith",
	"Ken",
	"Kevin",
	"Lamar",
	"Larry",
	"Leon",
	"Lou",
	"Luka",
	"Marco",
	"Mark",
	"Marv",
	"Maurice",
	"Mel",
	"Mike",
	"Milo",
	"Nate",
	"Neil",
	"Nikos",
	"Omar",
	"Otis",
	"Pat",
	"Paul",
	"Pete",
	"Phil",
	"Ray",
	"Reggie",
	"Rich",
	"Rick",
	"Rod",
	"Ron",
	"Roy",
	"Russ",
	"Sal",
	"Sam",
	"Scott",
	"Stan",
	"Steve",
	"Ted",
	"Terry",
	"Tom",
	"Tony",
	"Vern",
	"Vince",
	"Walt",
	"Wes",
	"Will",
	"Yuri",
	"Zoran",
	"Ana",
	"Becky",
	"Carla",
	"Denise",
	"Jen",
	"Kim",
	"Laura",
	"Maria",
	"Nina",
	"Rachel",
	"Sue",
	"Tanya",
];

const LAST = [
	"Abbott",
	"Alvarez",
	"Baker",
	"Banks",
	"Barlow",
	"Bell",
	"Bianchi",
	"Bishop",
	"Boyd",
	"Brennan",
	"Brooks",
	"Burke",
	"Byrd",
	"Calloway",
	"Carver",
	"Castillo",
	"Chambers",
	"Cole",
	"Collins",
	"Crane",
	"Dalton",
	"Delgado",
	"Doyle",
	"Drake",
	"Dunn",
	"Ellis",
	"Ferris",
	"Fischer",
	"Fleming",
	"Ford",
	"Fowler",
	"Gaines",
	"Garza",
	"Gibbs",
	"Gordon",
	"Graves",
	"Greer",
	"Hale",
	"Harmon",
	"Hayes",
	"Hendricks",
	"Hines",
	"Holt",
	"Horvat",
	"Hughes",
	"Ivanov",
	"Jansen",
	"Jenkins",
	"Keane",
	"Kessler",
	"Kowalski",
	"Lambert",
	"Lang",
	"Larkin",
	"Lowry",
	"Lucas",
	"Maddox",
	"Malone",
	"Marsh",
	"Mayfield",
	"McBride",
	"McCoy",
	"Mercer",
	"Miles",
	"Monroe",
	"Moretti",
	"Nash",
	"Novak",
	"Oakes",
	"Ortega",
	"Owens",
	"Park",
	"Patton",
	"Petrovic",
	"Pierce",
	"Porter",
	"Quinn",
	"Ramos",
	"Reyes",
	"Rhodes",
	"Riley",
	"Rocha",
	"Russo",
	"Sawyer",
	"Schultz",
	"Shaw",
	"Sims",
	"Sloan",
	"Stokes",
	"Sutton",
	"Tate",
	"Thornton",
	"Tucker",
	"Vance",
	"Vargas",
	"Wagner",
	"Walsh",
	"Warren",
	"Weber",
	"Whitfield",
	"Wolfe",
	"Yates",
	"Young",
];

export const SPECIALTY_NAMES: Record<Specialty, string> = {
	college: "College",
	international: "International",
	pro: "Pro personnel",
	athletes: "Athletes",
	shooters: "Shooters",
};

export const SPECIALTY_TITLES: Record<Specialty, string> = {
	college: "college scout",
	international: "international scout",
	pro: "pro scout",
	athletes: "scout (athletes)",
	shooters: "scout (shooters)",
};

export const BIAS_NAMES: Record<ScoutBias, string> = {
	none: "No obvious lean",
	athletes: "Overrates athletes",
	shooters: "Falls for shooters",
	size: "Loves size",
	production: "Trusts the box score",
	tools: "Bets on tools over production",
	harsh: "Tough grader",
	generous: "Generous grader",
	youth: "Loves young upside",
};

const SPECIALTIES: Specialty[] = [
	"college",
	"international",
	"pro",
	"athletes",
	"shooters",
];

const BIASES: [ScoutBias, number][] = [
	["none", 3],
	["athletes", 1.2],
	["shooters", 1],
	["size", 0.9],
	["production", 1],
	["tools", 0.9],
	["harsh", 0.8],
	["generous", 0.8],
	["youth", 0.9],
];

export const MAX_SCOUTS = 5;

// Department size and quality from the budget level (1-100, the three-season average). 0.5 quality is an average department
export const departmentSize = (level: number) =>
	Math.max(2, Math.min(MAX_SCOUTS, 2 + Math.round((3 * (level - 1)) / 99)));

export const departmentQualityForLevel = (level: number) =>
	Math.max(0.1, Math.min(0.92, 0.18 + (0.7 * (level - 1)) / 99));

// Scout ids: (tid + 1) * 10000 + slot * 1000 + index in the slot's chain, so an id alone says where he worked
export const scoutId = (tid: number, slot: number, index: number) =>
	(tid + 1) * 10000 + slot * 1000 + index;

export const parseScoutId = (id: number) => ({
	tid: Math.floor(id / 10000) - 1,
	slot: Math.floor((id % 10000) / 1000),
	index: id % 1000,
});

const pickWeighted = <T>(rng: Rng, items: [T, number][]) => {
	const total = items.reduce((a, [, w]) => a + w, 0);
	let x = rng.random() * total;
	for (const [item, w] of items) {
		x -= w;
		if (x <= 0) {
			return item;
		}
	}
	return items.at(-1)![0];
};

// Everything about one scout but his dates, from the league seed and his id
export const scoutFromId = (
	leagueSeed: string,
	id: number,
	levelQuality: number,
	since: number,
	until: number,
): Scout => {
	const { tid, slot } = parseScoutId(id);
	const seed = `scout|${leagueSeed}|${id}`;
	const rng = new Rng(seed);
	const first = FIRST[rng.int(0, FIRST.length - 1)]!;
	const last = LAST[rng.int(0, LAST.length - 1)]!;
	// The first slot of a department is usually the college scout, the second the pro scout
	const specialty: Specialty =
		slot === 0 && rng.random() < 0.7
			? "college"
			: slot === 1 && rng.random() < 0.6
				? "pro"
				: SPECIALTIES[rng.int(0, SPECIALTIES.length - 1)]!;
	const quality = Math.max(
		0.05,
		Math.min(0.97, levelQuality + rng.normal(0, 0.12)),
	);
	const bias = pickWeighted(rng, BIASES);
	const ageAtHire = rng.int(28, 56);
	return {
		id,
		tid,
		slot,
		name: `${first} ${last}`,
		since,
		until,
		age: ageAtHire,
		specialty,
		quality,
		bias,
		seed,
	};
};

// The chain of scouts in one slot: each stays 2-10 years. The first one was hired before the league started
const slotChain = (
	leagueSeed: string,
	tid: number,
	slot: number,
	startingSeason: number,
	upTo: number,
) => {
	const out: { id: number; since: number; until: number }[] = [];
	const rng = new Rng(`scoutSlot|${leagueSeed}|${tid}|${slot}`);
	let year = startingSeason - rng.int(0, 7);
	for (let index = 0; index < 999 && year <= upTo; index++) {
		const tenure = rng.int(2, 10);
		out.push({
			id: scoutId(tid, slot, index),
			since: year,
			until: year + tenure,
		});
		year += tenure;
	}
	return out;
};

/**
 * A team's scouting department in a season. level: the team's scouting budget level that season (1-100).
 */
export const getDepartment = ({
	leagueSeed,
	tid,
	season,
	level,
	startingSeason,
}: {
	leagueSeed: string;
	tid: number;
	season: number;
	level: number;
	startingSeason: number;
}): ScoutDepartment => {
	// No budget data (budget off, a new team): an average department
	if (!Number.isFinite(level)) {
		level = 34;
	}
	const size = departmentSize(level);
	const quality = departmentQualityForLevel(level);
	const scouts: Scout[] = [];
	for (let slot = 0; slot < size; slot++) {
		const chain = slotChain(leagueSeed, tid, slot, startingSeason, season);
		const current = chain.find((c) => c.since <= season && season < c.until);
		if (current) {
			const s = scoutFromId(
				leagueSeed,
				current.id,
				quality,
				current.since,
				current.until,
			);
			s.age += season - current.since;
			scouts.push(s);
		}
	}
	return {
		tid,
		season,
		level,
		quality:
			scouts.length > 0
				? scouts.reduce((a, s) => a + s.quality, 0) / scouts.length
				: quality,
		scouts,
	};
};

// Everyone who has worked in a team's department, most recent first (for the history and "who left")
export const departmentHistory = ({
	leagueSeed,
	tid,
	season,
	level,
	startingSeason,
}: {
	leagueSeed: string;
	tid: number;
	season: number;
	level: number;
	startingSeason: number;
}) => {
	const quality = departmentQualityForLevel(
		Number.isFinite(level) ? level : 34,
	);
	const out: Scout[] = [];
	for (let slot = 0; slot < MAX_SCOUTS; slot++) {
		for (const c of slotChain(leagueSeed, tid, slot, startingSeason, season)) {
			if (c.until > startingSeason - 1 && c.since <= season) {
				out.push(scoutFromId(leagueSeed, c.id, quality, c.since, c.until));
			}
		}
	}
	return out.sort((a, b) => b.since - a.since);
};

// A scout by id, whatever team he works for (for stored bylines)
export const scoutById = (
	leagueSeed: string,
	id: number,
	startingSeason: number,
	upTo: number,
	levelQuality = 0.5,
) => {
	const { tid, slot } = parseScoutId(id);
	const c = slotChain(leagueSeed, tid, slot, startingSeason, upTo).find(
		(x) => x.id === id,
	);
	return c
		? scoutFromId(leagueSeed, id, levelQuality, c.since, c.until)
		: undefined;
};

export const briefOf = (s: Scout): ScoutBrief => ({
	id: s.id,
	name: s.name,
	specialty: s.specialty,
	quality: s.quality,
	bias: s.bias,
	title: SPECIALTY_TITLES[s.specialty],
});

export const qualityLabel = (q: number) =>
	q >= 0.75
		? "Elite"
		: q >= 0.6
			? "Sharp"
			: q >= 0.42
				? "Solid"
				: q >= 0.28
					? "Spotty"
					: "Green";

// How well a scout's specialty matches a player: 1 a match (more accurate), 0 not
export const specialtyMatch = (
	s: Pick<Scout, "specialty">,
	player: {
		kind: "prospect" | "pro" | "retired";
		level?: string;
		athletic: boolean;
		shooter: boolean;
	},
) => {
	switch (s.specialty) {
		case "college":
			return player.kind === "prospect" && player.level !== "overseas" ? 1 : 0;
		case "international":
			return player.kind === "prospect" && player.level === "overseas" ? 1 : 0;
		case "pro":
			return player.kind !== "prospect" ? 1 : 0;
		case "athletes":
			return player.athletic ? 1 : 0.3;
		case "shooters":
			return player.shooter ? 1 : 0.3;
	}
};

// Who writes the report (best match, then best scout), and who gives the second opinion
export const assignScouts = (
	dept: ScoutDepartment,
	player: Parameters<typeof specialtyMatch>[1],
	pid: number,
) => {
	const ranked = dept.scouts
		.map((s) => ({
			s,
			score:
				specialtyMatch(s, player) * 0.6 +
				s.quality +
				// A small tie-breaker per player, so the same scout doesn't write every report
				0.15 * new Rng(`assign|${s.id}|${pid}`).random(),
		}))
		.sort((a, b) => b.score - a.score);
	return { lead: ranked[0]?.s, second: ranked[1]?.s };
};
