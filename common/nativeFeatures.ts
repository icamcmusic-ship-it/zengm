// Central registry of the fork's native features ("League extras"). Each entry is one feature with its on/off switch and
// any key options. Everything else is derived from this list: the game attribute types and defaults, the league file
// JSON schema, the settings form (the "League extras" category), the settings view, the UI sync and the helpers that
// gate menu items, links, dashboard cards and background work. Adding a feature toggle = adding one entry here, then
// gating the feature's code with nativeFeatureEnabled (worker) / useNativeFeature (UI). See docs/native-features.md.
//
// The data lives here (root common/, shared with the build tools for the JSON schema); src/common/nativeFeatures.ts
// re-exports it with helpers bound to the current sport. Import from there in game code.

export type NativeFeatureSport =
	| "basketball"
	| "football"
	| "hockey"
	| "baseball";

type NativeOptionDef = {
	// Game attribute key
	key: string;
	name: string;
	description: string;
	type: "bool" | "int" | "float";
	default: boolean | number;
	// Shown with a % sign, the value is stored as a percentage (10 means 10%)
	decoration?: "percent";
	min?: number;
	max?: number;
	// The key is already a game attribute declared elsewhere (types, defaults, schema), so only its settings form entry
	// comes from here
	existing?: true;
};

export type NativeFeatureDef = {
	id: string;
	// Game attribute key of the on/off switch
	key: string;
	name: string;
	description: string;
	// Default for existing leagues (missing game attribute) and for new leagues unless defaultNewLeague is set
	default: boolean;
	defaultNewLeague?: boolean;
	// Only available in these sports. Omit for all sports.
	sports?: readonly NativeFeatureSport[];
	existing?: true;
	options?: readonly NativeOptionDef[];
};

const BBGM = ["basketball"] as const;

export const NATIVE_FEATURES = [
	{
		id: "newspaper",
		key: "featureNewspaper",
		name: "Newspaper",
		description:
			"Season newspaper with a front page, sections and team editions (League menu, dashboard and history links).",
		default: true,
		sports: BBGM,
	},
	{
		id: "wrapped",
		key: "featureWrapped",
		name: "Wrapped",
		description:
			"Tap-through story decks of a season, a team's year or a player's year, and Compare.",
		default: true,
		sports: BBGM,
	},
	{
		id: "storylines",
		key: "featureStorylines",
		name: "Storylines",
		description:
			"Story cards found in the league's history (upsets, droughts, dynasties, ...).",
		default: true,
		sports: BBGM,
	},
	{
		id: "hype",
		key: "featureHype",
		name: "Games to Watch",
		description:
			"Must-watch score of upcoming games and record chases. When off, no hype is computed anywhere.",
		default: true,
		sports: BBGM,
		options: [
			{
				key: "featureHypeDashboard",
				name: "Games to Watch on Dashboard",
				description: "Show the Games to Watch card on the league dashboard.",
				type: "bool",
				default: true,
			},
			{
				key: "featureHypeSchedule",
				name: "Hype on Schedules and Box Scores",
				description:
					"Hype badges under games on the schedules and the hype card above box scores.",
				type: "bool",
				default: true,
			},
		],
	},
	{
		id: "leagueAchievements",
		key: "featureLeagueAchievements",
		name: "League Achievements",
		description:
			"Achievements unlocked by the league itself. When off, no achievement checks run after games.",
		default: true,
		sports: BBGM,
		options: [
			{
				key: "featureAchievementToasts",
				name: "Achievement Notifications",
				description: "Pop up a notification when an achievement is unlocked.",
				type: "bool",
				default: true,
			},
			{
				key: "featureAchievementsDashboard",
				name: "Achievements on Dashboard",
				description: "Show recently unlocked achievements on the dashboard.",
				type: "bool",
				default: true,
			},
		],
	},
	{
		id: "tradeGrader",
		key: "featureTradeGrader",
		name: "Trade Grader",
		description:
			"Grades for past trades, the Trade Grader page and grade badges on trade summaries and transactions.",
		default: true,
		sports: BBGM,
	},
	{
		id: "contractValue",
		key: "featureContractValue",
		name: "Contract Value",
		description:
			"Contract value index, bargains and albatrosses, and the value index on player salaries.",
		default: true,
		sports: BBGM,
	},
	{
		id: "pbpFlavor",
		key: "featurePbpFlavor",
		name: "Play-by-Play Flavor",
		description:
			"Varied, ratings-aware wording in the live game view. Only changes the text, never results.",
		default: true,
		sports: BBGM,
	},
	{
		id: "storePlayByPlay",
		key: "storePlayByPlay",
		name: "Save Play-by-Play",
		description:
			"Keep each game's play-by-play with its box score, to read or replay later. Uses about 7 KB of storage per game, and it is deleted along with the box score.",
		default: true,
		sports: BBGM,
		existing: true,
	},
	{
		id: "technicalFouls",
		key: "technicalFouls",
		name: "Technical & Flagrant Fouls",
		description:
			"Rare technical fouls (1 FT, possession unchanged), flagrant fouls (2 FTs and the ball) and ejections in the game simulation.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
		existing: true,
	},
	{
		id: "collegeStats",
		key: "featureCollegeStats",
		name: "College Stats",
		description:
			"College stats and honors for draft prospects (College stats button in Draft Scouting).",
		default: true,
		sports: BBGM,
		options: [
			{
				key: "generateCollegeStats",
				name: "Generate College Stats Automatically",
				description:
					"Generate college (or international league) stats and honors for every new draft class. They show on player pages and never count as pro stats.",
				type: "bool",
				default: false,
				existing: true,
			},
		],
	},
	{
		id: "ratingsRegenerator",
		key: "featureRatingsRegenerator",
		name: "Ratings Regenerator",
		description:
			"Regenerate ratings in Draft Scouting and Regenerate build in Customize Player.",
		default: true,
		sports: BBGM,
	},
	{
		id: "frivolities",
		key: "featureFrivolities",
		name: "Extra Frivolities",
		description:
			"Redraft, Draft Pick Value, Jersey Numbers by Team, Family Trees, League Economics and Home Court pages (the ones available in this sport).",
		default: true,
	},
	{
		id: "timeline",
		key: "featureTimeline",
		name: "League Timeline",
		description:
			"A season-by-season timeline of champions, MVPs, headlines, storylines, achievements, records and trades.",
		default: true,
		sports: BBGM,
	},
	{
		id: "unretire",
		key: "featureUnretire",
		name: "Unretirements",
		description:
			"Once a season at the start of free agency, a retired veteran may come back with a ratings boost and become a free agent.",
		default: false,
		sports: BBGM,
		options: [
			{
				key: "unretireChance",
				name: "Unretirement Chance",
				description: "Chance per season that one retired player comes back.",
				type: "float",
				decoration: "percent",
				default: 10,
				min: 0,
				max: 100,
			},
			{
				key: "unretireMinAge",
				name: "Unretirement Min Retirement Age",
				description:
					"Only players who retired at this age or older can come back.",
				type: "int",
				default: 35,
				min: 0,
			},
			{
				key: "unretireBoostMin",
				name: "Unretirement Min Ovr Boost",
				description: "Overall points added to his last rating, lower end.",
				type: "int",
				default: 3,
				min: 0,
				max: 100,
			},
			{
				key: "unretireBoostMax",
				name: "Unretirement Max Ovr Boost",
				description: "Overall points added to his last rating, upper end.",
				type: "int",
				default: 6,
				min: 0,
				max: 100,
			},
		],
	},
] as const satisfies readonly NativeFeatureDef[];

type Defs = (typeof NATIVE_FEATURES)[number];
type OptionDefs = Extract<Defs, { options: any }>["options"][number];
type NewDefs = Exclude<Defs, { existing: true }>;
type NewOptionDefs = Exclude<OptionDefs, { existing: true }>;

export type NativeFeatureId = Defs["id"];
export type NativeFeatureEnableKey = Defs["key"];
export type NativeFeatureOptionKey = OptionDefs["key"];
export type NativeFeatureSettingKey =
	| NativeFeatureEnableKey
	| NativeFeatureOptionKey;

type ValueOf<T> = T extends boolean ? boolean : number;

// Game attributes added by the registry (existing ones are declared in GameAttributesLeague already)
export type NativeFeatureGameAttributes = {
	[D in NewDefs as D["key"]]: boolean;
} & {
	[O in NewOptionDefs as O["key"]]: ValueOf<O["default"]>;
};

const allDefs: readonly NativeFeatureDef[] = NATIVE_FEATURES;

export const getNativeFeature = (id: NativeFeatureId) =>
	allDefs.find((f) => f.id === id)!;

export const nativeFeatureAvailableInSport = (
	feature: NativeFeatureDef,
	sport: string,
) => !feature.sports || (feature.sports as readonly string[]).includes(sport);

// Every setting key of the registry (switches then options), including existing ones
export const NATIVE_FEATURE_SETTING_KEYS = allDefs.flatMap((f) => [
	f.key,
	...(f.options ?? []).map((o) => o.key),
]) as NativeFeatureSettingKey[];

// Keys of features (and their options) not available in this sport, so they can be hidden like other sport-specific
// settings
export const nativeFeatureKeysOtherSportsFor = (sport: string) =>
	allDefs
		.filter((f) => !nativeFeatureAvailableInSport(f, sport))
		.flatMap((f) => [f.key, ...(f.options ?? []).map((o) => o.key)]);

const buildDefaults = (newLeague: boolean, includeExisting: boolean) => {
	const out: Record<string, boolean | number> = {};
	for (const f of allDefs) {
		if (includeExisting || !f.existing) {
			out[f.key] =
				newLeague && f.defaultNewLeague !== undefined
					? f.defaultNewLeague
					: f.default;
		}
		for (const o of f.options ?? []) {
			if (includeExisting || !o.existing) {
				out[o.key] = o.default;
			}
		}
	}
	return out;
};

// For defaultGameAttributes: values used when a league has no such attribute (existing leagues get the features they
// already had)
export const nativeFeatureDefaults = buildDefaults(
	false,
	false,
) as NativeFeatureGameAttributes;

// For the UI local state before the worker syncs the league's values
export const nativeFeatureLocalDefaults = buildDefaults(false, true) as Record<
	NativeFeatureSettingKey,
	boolean | number
>;

// For the new league form
export const nativeFeatureNewLeagueDefaults = () =>
	buildDefaults(true, false) as NativeFeatureGameAttributes;

// For the league file JSON schema
export const nativeFeatureJsonSchemaProperties = () => {
	const out: Record<string, Record<string, unknown>> = {};
	for (const f of allDefs) {
		if (!f.existing) {
			out[f.key] = { type: "boolean" };
		}
		for (const o of f.options ?? []) {
			if (o.existing) {
				continue;
			}
			if (o.type === "bool") {
				out[o.key] = { type: "boolean" };
			} else {
				out[o.key] = {
					type: o.type === "int" ? "integer" : "number",
					...(o.min !== undefined ? { minimum: o.min } : {}),
					...(o.max !== undefined ? { maximum: o.max } : {}),
				};
			}
		}
	}
	return out;
};

// Is a feature on? get reads a game attribute (g.get in the worker, the local state in the UI). Missing values count
// as the default, so a league from before the toggles existed keeps its features.
export const nativeFeatureEnabledForSport = (
	id: NativeFeatureId,
	get: (key: string) => unknown,
	sport: string,
) => {
	const f = getNativeFeature(id);
	if (!nativeFeatureAvailableInSport(f, sport)) {
		return false;
	}
	const value = get(f.key);
	return typeof value === "boolean" ? value : f.default;
};

// A feature option, falling back to its default. Bool options of a feature that is off read as false.
export const nativeFeatureOptionForSport = <T extends boolean | number>(
	key: NativeFeatureOptionKey,
	get: (key: string) => unknown,
	sport: string,
): T => {
	for (const f of allDefs) {
		const o = f.options?.find((o) => o.key === key);
		if (o) {
			const value = get(key);
			const out =
				typeof value === typeof o.default ? (value as T) : (o.default as T);
			if (
				o.type === "bool" &&
				!nativeFeatureEnabledForSport(f.id as NativeFeatureId, get, sport)
			) {
				return false as T;
			}
			return out;
		}
	}
	throw new Error(`Unknown native feature option ${key}`);
};
