// "Export profile" on the player pages: everything his profile pages show, as one JSON file and/or a set of PDFs (one per page,
// in a zip). Pure helpers and types, shared by the worker (data, worker/util/playerProfileExport.ts) and the UI (files,
// ui/components/ExportProfile.tsx, ui/util/profilePdf.ts). See docs/native-features.md#export-profile.
import type {
	ExportTable,
	PlayerExport,
	ScoutingExportPage,
} from "./playerExport.ts";

export const PROFILE_EXPORT_FORMAT = "zengm-player-profile";
// Bump when a field changes meaning or moves (adding a field is fine)
export const PROFILE_EXPORT_SCHEMA_VERSION = 1;

// In file order (the PDF set numbers its files like this)
export const PROFILE_SECTIONS = [
	{ key: "overview", label: "Overview", file: "overview" },
	{ key: "ratings", label: "Ratings", file: "ratings" },
	{ key: "stats", label: "Stats", file: "stats" },
	{ key: "gameLog", label: "Game Log", file: "game_log" },
	{ key: "preDraft", label: "College/Overseas", file: "college_overseas" },
	{ key: "traits", label: "Traits", file: "traits" },
	{ key: "scouting", label: "Scouting", file: "scouting" },
	{ key: "awards", label: "Awards and honors", file: "awards" },
	{ key: "contract", label: "Contract and mood", file: "contract_mood" },
	{ key: "transactions", label: "Transactions", file: "transactions" },
	{ key: "injuries", label: "Injuries", file: "injuries" },
] as const;

export type ProfileSectionKey = (typeof PROFILE_SECTIONS)[number]["key"];

export const PROFILE_SECTION_KEYS: ProfileSectionKey[] = PROFILE_SECTIONS.map(
	(s) => s.key,
);

export type ProfileFact = { label: string; value: string };

// One profile page (or part of the Overview). facts, lines and tables are what the PDF draws; data is the structured version
// for programs (section specific, see the worker).
export type ProfileSection = {
	key: ProfileSectionKey;
	title: string;
	// Why there is little or nothing here ("Hidden (no visible ratings challenge)", "No games this season")
	note?: string;
	facts: ProfileFact[];
	lines: string[];
	tables: ExportTable[];
	data?: unknown;
};

export type PlayerStatus =
	| "active"
	| "freeAgent"
	| "prospect"
	| "retired"
	| "other";

export type PlayerProfileExport = {
	format: typeof PROFILE_EXPORT_FORMAT;
	schemaVersion: typeof PROFILE_EXPORT_SCHEMA_VERSION;
	exportedAt: string;
	generator: string;
	league: {
		lid: number;
		name: string;
		sport: string;
		season: number;
		phase: number;
		phaseName: string;
		college: boolean;
		startingSeason: number;
		userTeam?: { tid: number; abbrev: string; name: string };
	};
	// What the export may show: the same rules as the player pages
	visibility: {
		ratingsShown: boolean;
		challengeNoRatings: boolean;
		playerTraits: boolean;
		scoutingReports: boolean;
		note: string;
	};
	player: {
		pid: number;
		name: string;
		status: PlayerStatus;
		tid: number;
		team: string;
		abbrev: string;
		pos: string;
		age: number;
		born: { year: number; loc: string };
		diedYear?: number;
		hgt: number;
		height: string;
		weight: number;
		college?: string;
		// Pro draft (year 0 in college leagues, which have none)
		draft: PlayerExport["draft"];
		// College leagues: "Freshman" ...
		classYear?: string;
		jerseyNumber?: string;
		experience?: number;
	};
	// Requested sections that don't apply to him (no game log for a prospect, no contract when retired, setting off)
	skipped: { key: ProfileSectionKey; reason: string }[];
	sections: Partial<Record<ProfileSectionKey, ProfileSection>>;
	// For the PDF's Overview page (face, colors, current ratings); not part of the JSON file
	card?: PlayerExport;
	// For the PDF's Scouting page; not part of the JSON file
	scoutingPage?: ScoutingExportPage;
};

export const playerStatus = (
	tid: number,
	PLAYER: { FREE_AGENT: number; UNDRAFTED: number; RETIRED: number },
): PlayerStatus =>
	tid >= 0
		? "active"
		: tid === PLAYER.FREE_AGENT
			? "freeAgent"
			: tid === PLAYER.UNDRAFTED
				? "prospect"
				: tid === PLAYER.RETIRED
					? "retired"
					: "other";

// Event texts are HTML with links to other pages
export const stripHtml = (html: string) =>
	html
		.replaceAll(/<[^>]*>/g, "")
		.replaceAll("&amp;", "&")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&nbsp;", " ")
		.replaceAll(/\s+/g, " ")
		.trim();

// Keys that carry ratings (or come from them). Under the "no visible ratings" challenge they are removed from anything the
// export takes from a page, like the player pages hide them.
const RATING_DERIVED_KEYS = new Set([
	"ovr",
	"pot",
	"ovrs",
	"pots",
	"ovrAtDraft",
	"potAtDraft",
	"peakOvr",
	"ratings",
	"skills",
	"badges",
	"archetype",
	"fuzz",
	"valueFuzz",
	"valueNoPot",
]);

export const scrubRatings = <T>(value: T): T => {
	if (Array.isArray(value)) {
		return value.map((x) => scrubRatings(x)) as T;
	}
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, v] of Object.entries(value)) {
			if (!RATING_DERIVED_KEYS.has(key)) {
				out[key] = scrubRatings(v);
			}
		}
		return out as T;
	}
	return value;
};

// The JSON file: the card and the scouting page drawing data are left out (the sections have the same information)
export const profileToJSON = (profile: PlayerProfileExport) => {
	const { card: _card, scoutingPage: _scoutingPage, ...rest } = profile;
	return JSON.stringify(rest, null, 2);
};

export const profileFileName = (
	index: number,
	key: ProfileSectionKey,
	ext: string,
) => {
	const info = PROFILE_SECTIONS.find((s) => s.key === key)!;
	return `${String(index + 1).padStart(2, "0")}_${info.file}.${ext}`;
};
