// "Download players" (PDF/JSON/CSV) and "Download CSV" on custom tables. Pure helpers, shared by the worker (data) and the
// UI (files). See docs/native-features.md#downloads.

// A full table for the PDF/JSON (stats by season, ratings history, traits by category, college/overseas, awards)
export type ExportTable = {
	section: string;
	title: string;
	cols: string[];
	rows: (string | number)[][];
};

export type PlayerExport = {
	pid: number;
	name: string;
	tid: number;
	team: string;
	abbrev: string;
	pos: string;
	age: number;
	born: { year: number; loc: string };
	hgt: number;
	weight: number;
	wingspan?: number;
	college?: string;
	draft: { year: number; round: number; pick: number; abbrev?: string };
	contract?: { amount: number; exp: number };
	injury?: string;
	season: number;
	// Scouted (fuzzed) ratings; undefined under the "no visible ratings" challenge
	ratings?: Record<string, number>;
	skills: string[];
	badges: string[];
	archetype?: string;
	// The user's readings ("62" when known, "40-70?" while still a scouting range)
	traits?: { name: string; reading: string; exact: boolean }[];
	// Secret until retirement
	agingCurve?: string;
	seasonStats?: Record<string, number>;
	careerStats?: Record<string, number>;
	awards: string[];
	preDraft?: { team: string; season: number; stats: Record<string, number> };
	tables: ExportTable[];
	face?: unknown;
	imgURL?: string;
	colors?: [string, string, string];
	jersey?: string;
};

// Like the player page: the "no visible ratings" challenge hides ratings (and anything derived from them: archetype, skills,
// badges) for everyone but retired players
export const exportShowsRatings = (
	challengeNoRatings: boolean,
	tid: number,
	retiredTid: number,
) => !challengeNoRatings || tid === retiredTid;

// RFC 4180: quote a field that has a comma, quote, CR or LF (or leading/trailing space), doubling quotes. Also defuse
// spreadsheet formula injection (a cell starting with = + - @ that isn't a number).
export const csvEscape = (value: unknown): string => {
	if (value == null) {
		return "";
	}
	let s = typeof value === "number" ? String(value) : String(value);
	if (s.length > 1 && /^[+=@-]/.test(s) && Number.isNaN(Number(s))) {
		s = `'${s}`;
	}
	if (/[\n\r",]/.test(s) || s !== s.trim()) {
		return `"${s.replaceAll('"', '""')}"`;
	}
	return s;
};

export const toCSV = (rows: unknown[][]) =>
	rows.map((row) => row.map(csvEscape).join(",")).join("\n");

// Make a table (header rows + body rows, possibly ragged or with colspans already expanded) rectangular
export const rectangularize = (rows: string[][]) => {
	const width = Math.max(0, ...rows.map((row) => row.length));
	return rows.map((row) =>
		row.length < width ? [...row, ...Array(width - row.length).fill("")] : row,
	);
};

// Letters that don't decompose into a base letter and an accent
const TRANSLITERATE: Record<string, string> = {
	ł: "l",
	Ł: "L",
	ı: "i",
	þ: "th",
	Þ: "Th",
	ð: "d",
	Ð: "D",
	đ: "d",
	Đ: "D",
	ø: "o",
	Ø: "O",
	æ: "ae",
	Æ: "Ae",
	ß: "ss",
};

// ASCII only: browsers can refuse a download name with other letters (Chrome falls back to "download")
export const fileSafeName = (name: string) =>
	name
		.normalize("NFD")
		.replaceAll(/\p{M}/gu, "")
		.replaceAll(/[ÆÐØÞßæðøþĐđıŁł]/g, (c) => TRANSLITERATE[c] ?? "")
		.replaceAll(/[^\w -]+/g, "")
		.trim()
		.replaceAll(/\s+/g, "_")
		.slice(0, 80) || "table";

const feetInches = (hgt: number) => `${Math.floor(hgt / 12)}'${hgt % 12}"`;

export const formatHeight = (hgt: number) => feetInches(hgt);

// One row per player. Columns are the union over all players (ratings/stats differ by sport and settings), in a stable order.
export const playersToCSVRows = (players: PlayerExport[]): unknown[][] => {
	const ratingKeys: string[] = [];
	const seasonKeys: string[] = [];
	const careerKeys: string[] = [];
	const traitNames: string[] = [];
	const addAll = (target: string[], keys: Iterable<string>) => {
		for (const key of keys) {
			if (!target.includes(key)) {
				target.push(key);
			}
		}
	};
	for (const p of players) {
		addAll(ratingKeys, Object.keys(p.ratings ?? {}));
		addAll(seasonKeys, Object.keys(p.seasonStats ?? {}));
		addAll(careerKeys, Object.keys(p.careerStats ?? {}));
		addAll(
			traitNames,
			(p.traits ?? []).map((t) => t.name),
		);
	}

	const header = [
		"pid",
		"Name",
		"Team",
		"Pos",
		"Age",
		"Height",
		"Weight",
		...(players.some((p) => p.wingspan !== undefined) ? ["Wingspan"] : []),
		"College",
		"Draft",
		"Contract ($M)",
		"Exp",
		"Injury",
		"Season",
		...ratingKeys.map((key) => key.toUpperCase()),
		"Skills",
		"Badges",
		"Archetype",
		...traitNames,
		...seasonKeys.map((key) => `Season ${key}`),
		...careerKeys.map((key) => `Career ${key}`),
		"Awards",
		"Pre-draft",
	];
	const hasWingspan = header.includes("Wingspan");

	const body = players.map((p) => [
		p.pid,
		p.name,
		p.abbrev || p.team,
		p.pos,
		p.age,
		formatHeight(p.hgt),
		p.weight,
		...(hasWingspan ? [p.wingspan ?? ""] : []),
		p.college ?? "",
		p.draft.round > 0
			? `${p.draft.year} R${p.draft.round} #${p.draft.pick}${p.draft.abbrev ? ` ${p.draft.abbrev}` : ""}`
			: p.draft.year > 0
				? `${p.draft.year} undrafted`
				: "",
		p.contract ? p.contract.amount / 1000 : "",
		p.contract?.exp ?? "",
		p.injury ?? "",
		p.season,
		...ratingKeys.map((key) => p.ratings?.[key] ?? ""),
		p.skills.join(" "),
		p.badges.join("; "),
		p.archetype ?? "",
		...traitNames.map(
			(name) => p.traits?.find((t) => t.name === name)?.reading ?? "",
		),
		...seasonKeys.map((key) => p.seasonStats?.[key] ?? ""),
		...careerKeys.map((key) => p.careerStats?.[key] ?? ""),
		p.awards.join("; "),
		p.preDraft ? `${p.preDraft.team} ${p.preDraft.season}` : "",
	]);

	return [header, ...body];
};

// The readable JSON: everything above except the face drawing details (kept: it is what the user sees), with a header
export const playersToJSON = (
	players: PlayerExport[],
	meta: { league: string; exportedSeason: number },
) =>
	JSON.stringify(
		{
			format: "zengm-visible-players",
			version: 1,
			...meta,
			note: "Ratings and traits are as your scouts see them (not exact values).",
			players,
		},
		null,
		2,
	);
