// "Export team season" (Roster page): the team version of the player's Export profile. One team-season as a JSON file and/or a zip of
// CSVs: roster (as the user's scouts see it), lineups and on/off, shot profile, splits, staff and front office, results. Pure helpers
// and types, shared by the worker (data, worker/util/teamExport/) and the UI (files, ui/components/TeamSeasonExport.tsx). See
// docs/native-features.md#downloads.
import { csvEscape, toCSV, type ExportTable } from "./playerExport.ts";

export const TEAM_EXPORT_FORMAT = "zengm-team-season";
// Bump when a field changes meaning or moves (adding a field is fine)
export const TEAM_EXPORT_SCHEMA_VERSION = 1;

// In file order (the CSV files are numbered like this)
export const TEAM_SECTIONS = [
	{ key: "overview", label: "Overview", file: "overview", basketball: false },
	{ key: "roster", label: "Roster", file: "roster", basketball: false },
	{
		key: "lineups",
		label: "Lineups and on/off",
		file: "lineups",
		basketball: true,
	},
	{
		key: "shotProfile",
		label: "Shot profile",
		file: "shot_profile",
		basketball: true,
	},
	{ key: "splits", label: "Splits", file: "splits", basketball: false },
	{
		key: "staff",
		label: "Staff and front office",
		file: "staff",
		basketball: false,
	},
	{ key: "results", label: "Results", file: "results", basketball: false },
] as const;

export type TeamSectionKey = (typeof TEAM_SECTIONS)[number]["key"];
export const TEAM_SECTION_KEYS: TeamSectionKey[] = TEAM_SECTIONS.map(
	(s) => s.key,
);

export type TeamFact = { label: string; value: string };

export type TeamSection = {
	key: TeamSectionKey;
	title: string;
	// Why a part is missing ("Lineups aren't stored ...")
	notes: string[];
	facts: TeamFact[];
	tables: ExportTable[];
	data?: unknown;
};

export type TeamSeasonExport = {
	format: typeof TEAM_EXPORT_FORMAT;
	schemaVersion: typeof TEAM_EXPORT_SCHEMA_VERSION;
	exportedAt: string;
	generator: string;
	league: {
		lid: number;
		name: string;
		sport: string;
		currentSeason: number;
		phase: number;
		phaseName: string;
		college: boolean;
		userTids: number[];
	};
	visibility: {
		ratingsShown: boolean;
		challengeNoRatings: boolean;
		godMode: boolean;
		userTeam: boolean;
		note: string;
	};
	team: {
		tid: number;
		season: number;
		abbrev: string;
		region: string;
		name: string;
		conf: string;
		div: string;
	};
	// Requested sections that don't apply (another sport, a setting off), with the reason
	skipped: { key: TeamSectionKey; reason: string }[];
	sections: Partial<Record<TeamSectionKey, TeamSection>>;
	// Every table column of every section, explained: section → column → description
	dataDictionary: Partial<Record<TeamSectionKey, Record<string, string>>>;
};

// ---------- Splits (pure, from the team's games) ----------

export type SplitGame = {
	gid: number;
	day: number | null;
	playoffs: boolean;
	home: boolean;
	neutral: boolean;
	pts: number;
	oppPts: number;
	result: "W" | "L" | "T";
	overtimes: number;
	oppTid: number;
	// Opponent's win% that season (so far, for the current season)
	oppWinp: number;
};

export type SplitRow = {
	group: string;
	split: string;
	gp: number;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	winp: number;
	ptsPerGame: number;
	oppPtsPerGame: number;
	margin: number;
};

const r1 = (x: number) => Math.round(x * 10) / 10;

const splitRow = (
	group: string,
	split: string,
	games: SplitGame[],
	otl: boolean,
): SplitRow => {
	let won = 0;
	let lost = 0;
	let tied = 0;
	let otls = 0;
	let pts = 0;
	let oppPts = 0;
	for (const gm of games) {
		pts += gm.pts;
		oppPts += gm.oppPts;
		if (gm.result === "W") {
			won += 1;
		} else if (gm.result === "T") {
			tied += 1;
		} else if (otl && gm.overtimes > 0 && !gm.playoffs) {
			otls += 1;
		} else {
			lost += 1;
		}
	}
	const gp = games.length;
	return {
		group,
		split,
		gp,
		won,
		lost,
		tied,
		otl: otls,
		winp: gp > 0 ? Math.round((1000 * (won + 0.5 * tied)) / gp) / 1000 : 0,
		ptsPerGame: gp > 0 ? r1(pts / gp) : 0,
		oppPtsPerGame: gp > 0 ? r1(oppPts / gp) : 0,
		margin: gp > 0 ? r1((pts - oppPts) / gp) : 0,
	};
};

// Home/road, rest (days between the team's games; a back-to-back is games on consecutive days), opponents at .500 or better vs
// below, and "months" of the season (blocks of 30 days, 4 weeks in football: games have days, not dates), plus the playoffs.
// Football has no rest split (a day is a week).
export const computeSplits = (
	games: SplitGame[],
	{ otl = false, football = false }: { otl?: boolean; football?: boolean } = {},
): SplitRow[] => {
	const regular = games
		.filter((gm) => !gm.playoffs)
		.sort((a, b) => (a.day ?? 0) - (b.day ?? 0) || a.gid - b.gid);
	const rows: SplitRow[] = [
		splitRow("Overall", "Regular season", regular, otl),
	];
	const add = (group: string, split: string, xs: SplitGame[]) => {
		if (xs.length > 0) {
			rows.push(splitRow(group, split, xs, otl));
		}
	};

	add(
		"Site",
		"Home",
		regular.filter((gm) => gm.home && !gm.neutral),
	);
	add(
		"Site",
		"Road",
		regular.filter((gm) => !gm.home && !gm.neutral),
	);
	add(
		"Site",
		"Neutral site",
		regular.filter((gm) => gm.neutral),
	);

	if (!football) {
		const rest = new Map<number, number>();
		const b2bFirst = new Set<number>();
		for (const [i, gm] of regular.entries()) {
			const prev = regular[i - 1];
			if (prev && gm.day !== null && prev.day !== null) {
				const days = gm.day - prev.day - 1;
				rest.set(gm.gid, days);
				if (days === 0) {
					b2bFirst.add(prev.gid);
				}
			}
		}
		const withRest = (f: (days: number) => boolean) =>
			regular.filter((gm) => {
				const days = rest.get(gm.gid);
				return days !== undefined && f(days);
			});
		add(
			"Rest",
			"Back-to-back, 2nd game (no rest)",
			withRest((d) => d === 0),
		);
		add(
			"Rest",
			"Back-to-back, 1st game",
			regular.filter((gm) => b2bFirst.has(gm.gid)),
		);
		add(
			"Rest",
			"1 day of rest",
			withRest((d) => d === 1),
		);
		add(
			"Rest",
			"2 days of rest",
			withRest((d) => d === 2),
		);
		add(
			"Rest",
			"3+ days of rest",
			withRest((d) => d >= 3),
		);
	}

	add(
		"Opponent",
		"vs .500 or better",
		regular.filter((gm) => gm.oppWinp >= 0.5),
	);
	add(
		"Opponent",
		"vs below .500",
		regular.filter((gm) => gm.oppWinp < 0.5),
	);

	const block = football ? 4 : 30;
	const unit = football ? "weeks" : "days";
	const byBlock = Map.groupBy(
		regular.filter((gm) => gm.day !== null),
		(gm) => Math.floor((gm.day! - 1) / block),
	);
	for (const b of [...byBlock.keys()].sort((x, y) => x - y)) {
		add(
			"Month",
			`Month ${b + 1} (${unit} ${b * block + 1}-${(b + 1) * block})`,
			byBlock.get(b)!,
		);
	}

	add(
		"Playoffs",
		"Playoffs",
		games.filter((gm) => gm.playoffs),
	);
	return rows;
};

// ---------- Data dictionary ----------

// Column descriptions by column title (the same title means the same thing in every section). Rating and stat columns are added
// by the worker from the game's own column descriptions.
export const TEAM_COLUMN_DESCRIPTIONS: Record<string, string> = {
	// Roster
	Name: "Player name",
	Pos: "Position (that season's ratings row)",
	Age: "Age",
	Jersey: "Jersey number",
	"Yrs w/ team": "Seasons with the team",
	"Contract ($K/yr)": "Contract amount, thousands of dollars per year",
	"Contract exp": "Last season of the contract",
	Injury: "Current injury and games remaining",
	Ovr: "Overall rating, as the user's scouts see it",
	Pot: "Potential rating, as the user's scouts see it",
	Archetype: "Archetype label (from scouted ratings)",
	Badges: "2K badges shown for him (at most 6, best first)",
	Skills: "Skill labels (from scouted ratings)",
	Awards: "Awards that season",
	// Lineups
	Lineup: "The players on the floor together",
	MIN: "Minutes",
	"+/-": "Point differential while on the floor",
	"Poss for": "Offensive possessions",
	"Poss against": "Defensive possessions",
	ORtg: "Points scored per 100 possessions",
	DRtg: "Points allowed per 100 possessions",
	Net: "ORtg minus DRtg",
	GP: "Games played",
	"On ORtg": "Team ORtg with him on the floor",
	"On DRtg": "Team DRtg with him on the floor",
	"On Net": "Team net rating with him on the floor",
	"Off Net": "Team net rating with him off the floor",
	"On-Off": "On Net minus Off Net",
	Type: "Regular season or playoffs",
	// Shot profile
	Zone: "Shot zone",
	Group: "Coarse area of the floor",
	FGA: "Field goal attempts",
	FGM: "Field goals made",
	"FG%": "Field goal percentage",
	"Share of FGA": "Share of the team's located field goal attempts",
	"Pts/shot": "Points per attempt from the zone",
	"Shot profile": "His shot profile (game plan setting)",
	// Splits
	Split: "The games in the split",
	W: "Wins",
	L: "Losses",
	T: "Ties",
	OTL: "Overtime losses",
	"Win%": "Win% (a tie counts half)",
	"PTS/G": "Points scored per game",
	"OPP PTS/G": "Points allowed per game",
	MOV: "Average margin of victory",
	// Staff
	Role: "Coaching staff role",
	"Coach ovr": "Coach's overall rating for the role (Coaching Staff page)",
	Leaning: "GM leaning, in words (bands, like the GM pages)",
	Trait: "GM leaning",
	Value: "Value as the page shows it",
	Item: "Revenue or expense item",
	"Amount ($K)": "Thousands of dollars",
	Component: "Owner mood component",
	"This season": "Change this season",
	Cumulative: "Running total (what the owner judges)",
	// Results
	Round: "Playoff round",
	Opponent: "Opponent",
	Seed: "The team's seed",
	"Opp seed": "Opponent's seed",
	Result: "Result",
	Player: "Player",
	Award: "Award",
	Category: "Why the game is notable",
	Day: "Day of the season",
	Site: "Home, road or neutral",
	Score: "Final score (team first)",
	OT: "Overtime periods",
	"Game id": "Game id (box score)",
	Stats: "His line in the game",
};

// The UI asks the worker for one section at a time (a progress bar, the worker never busy for long): the parts, merged into one
// export in file order
export const mergeTeamExports = (
	parts: TeamSeasonExport[],
): TeamSeasonExport | undefined => {
	const [first] = parts;
	if (!first) {
		return undefined;
	}
	const out: TeamSeasonExport = {
		...first,
		skipped: [],
		sections: {},
		dataDictionary: {},
	};
	for (const info of TEAM_SECTIONS) {
		for (const part of parts) {
			const s = part.sections[info.key];
			if (s) {
				out.sections[info.key] = s;
				out.dataDictionary[info.key] = part.dataDictionary[info.key];
			}
			for (const skip of part.skipped) {
				if (skip.key === info.key && !out.skipped.includes(skip)) {
					out.skipped.push(skip);
				}
			}
		}
	}
	return out;
};

// ---------- Files ----------

export const teamExportBaseName = (t: {
	abbrev: string;
	season: number;
	tid: number;
}) =>
	`${t.season}_${t.abbrev.replaceAll(/[^\w-]+/g, "_")}_${t.tid}_team_season`;

export const teamExportToJSON = (x: TeamSeasonExport) =>
	JSON.stringify(x, null, 2);

const slug = (s: string) =>
	s
		.toLowerCase()
		.replaceAll(/[^\da-z]+/g, "_")
		.replaceAll(/^_+|_+$/g, "")
		.slice(0, 40);

// One CSV per table, a facts CSV per section, and the data dictionary
export const teamExportCSVFiles = (x: TeamSeasonExport) => {
	const files: { name: string; text: string }[] = [];
	for (const [i, info] of TEAM_SECTIONS.entries()) {
		const s = x.sections[info.key];
		if (!s) {
			continue;
		}
		const prefix = `${String(i + 1).padStart(2, "0")}_${info.file}`;
		if (s.facts.length > 0 || s.notes.length > 0) {
			files.push({
				name: `${prefix}_facts.csv`,
				text: toCSV([
					["label", "value"],
					...s.facts.map((f) => [f.label, f.value]),
					...s.notes.map((n) => ["Note", n]),
				]),
			});
		}
		const used = new Set<string>();
		for (const table of s.tables) {
			let name = `${prefix}_${slug(table.title)}`;
			for (let n = 2; used.has(name); n++) {
				name = `${prefix}_${slug(table.title)}_${n}`;
			}
			used.add(name);
			files.push({
				name: `${name}.csv`,
				text: toCSV([table.cols, ...table.rows]),
			});
		}
	}
	files.push({
		name: "data_dictionary.csv",
		text: [
			["section", "column", "description"].join(","),
			...Object.entries(x.dataDictionary).flatMap(([section, cols]) =>
				Object.entries(cols ?? {}).map(([col, desc]) =>
					[section, col, desc].map(csvEscape).join(","),
				),
			),
		].join("\n"),
	});
	return files;
};
