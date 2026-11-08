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
	type: "bool" | "int" | "float" | "string";
	default: boolean | number | string;
	// For type "string": the allowed values, as in a settings form select
	values?: readonly { key: string; value: string }[];
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
		id: "pbpLiveGame",
		key: "pbpLiveGame",
		name: "Play-by-Play in Live Games",
		description:
			"Show the play-by-play feed when watching a game live. When off, the score, clock and box score still update live.",
		default: true,
		sports: BBGM,
		existing: true,
	},
	{
		id: "pbpBoxScore",
		key: "featurePbpBoxScore",
		name: "Play-by-Play in Box Scores",
		description:
			"Show a saved game's play-by-play in its box score. When off, box scores have no play-by-play tab or button.",
		default: true,
		sports: BBGM,
		options: [
			{
				key: "pbpBoxScore",
				name: "Box Score Play-by-Play",
				description:
					"Show the play-by-play as a box score tab, or only after pressing a button.",
				type: "string",
				values: [
					{ key: "always", value: "Always show" },
					{ key: "button", value: "Show on button press" },
				],
				default: "always",
				existing: true,
			},
		],
	},
	{
		id: "storePlayByPlay",
		key: "storePlayByPlay",
		name: "Save Play-by-Play",
		description:
			"Keep each game's play-by-play with its box score, to read or replay later. Uses about 7 KB of storage per game, and it is deleted along with the box score. Live games always show their play-by-play while you watch. When off, no game keeps its play-by-play.",
		default: true,
		sports: BBGM,
		existing: true,
		options: [
			{
				key: "pbpStore",
				name: "Games to Save Play-by-Play For",
				description: "Which games keep their play-by-play.",
				type: "string",
				values: [
					{ key: "all", value: "All games" },
					{ key: "user", value: "My team's games only" },
					{ key: "none", value: "None" },
				],
				default: "all",
				existing: true,
			},
		],
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
		id: "realisticPossessions",
		key: "realisticPossessions",
		name: "Realistic Possession Model",
		description:
			"Possessions play out like in the NBA: a 24-second shot clock (14 after an offensive rebound), fast breaks and half-court possessions, late-clock shots and shot-clock violations, holding for the last shot, 2-for-1s, and intentional fouling late in games. Box score averages stay about the same.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
		existing: true,
	},
	{
		id: "playerTraits",
		key: "playerTraits",
		name: "Player Traits",
		description:
			"Twelve traits (clutch, consistency, durability, shot discipline, off-ball movement, screening, hustle, foul discipline, recovery, handling under pressure, late-game IQ, leadership) that nudge how players perform in games. Derived from ratings plus a stored random component, they average out league-wide. Shown on player pages, Draft Scouting and Advanced Player Search.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
		existing: true,
	},
	{
		id: "injuryDepth",
		key: "injuryDepth",
		name: "Injury Depth",
		description:
			"Players returning from injury play under a minutes restriction and have a higher re-injury risk (often the same body part) for a while, some players are injury prone, the second night of a back-to-back is a little riskier and tiring, and teams can rest players on back-to-backs (load management). League-wide injury totals stay about the same.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
		existing: true,
	},
	{
		id: "seasonOdds",
		key: "featureSeasonOdds",
		name: "Season Odds",
		description:
			"Monte Carlo playoff, seed and title odds (Standings, Power Rankings), award race odds and the draft lottery what-if simulator. When off, none of it is computed.",
		default: true,
		sports: BBGM,
	},
	{
		id: "archetypes",
		key: "featureArchetypes",
		name: "Archetypes",
		description:
			"A 2K-style archetype for every player, derived from his ratings and saved each preseason: player page, Draft Scouting, Advanced Player Search, Roster composition, the Archetypes page and archetype targets in the ratings regenerator.",
		default: true,
		sports: BBGM,
	},
	{
		id: "skillBadges",
		key: "featureSkillBadges",
		name: "Extended Skill Badges",
		description:
			"25 extra skill badges (Cs, Pu, Bk, Sw, ...) next to the original skills in player tables and on player pages, plus the Skill Badges page.",
		default: true,
		sports: BBGM,
	},
	{
		id: "contractOptions",
		key: "contractOptions",
		name: "Contract Options & Guarantees",
		description:
			"Contracts can have a player or team option on their final season, and later seasons can be partially guaranteed, which lowers what a team owes if it releases the player. Players decide on their options based on mood and market value, and teams decide on team options, at the start of the re-signing phase.",
		default: false,
		defaultNewLeague: true,
		existing: true,
	},
	{
		id: "contractExtensions",
		key: "contractExtensions",
		name: "In-Season Contract Extensions",
		description:
			"Players in the last two seasons of their contracts can be extended during the preseason and regular season. AI teams extend some of their own players too.",
		default: false,
		defaultNewLeague: true,
		existing: true,
	},
	{
		id: "tradeRequests",
		key: "tradeRequests",
		name: "Trade Requests",
		description:
			"Very unhappy good players on AI-controlled or user teams can publicly ask to be traded, which lowers their trade value until they are traded or their mood improves.",
		default: false,
		defaultNewLeague: true,
		existing: true,
	},
	{
		id: "holdouts",
		key: "featureHoldouts",
		name: "Holdouts",
		description:
			"Very unhappy players paid well under their market value can hold out before the regular season and miss a few games.",
		default: false,
		defaultNewLeague: true,
		options: [
			{
				key: "holdoutFrequency",
				name: "Holdout Frequency",
				description:
					"How often unhappy players hold out, relative to the default (1).",
				type: "float",
				default: 1,
				min: 0,
				existing: true,
			},
		],
	},
	{
		id: "tradeExplain",
		key: "featureTradeExplain",
		name: "Trade Explanations",
		description:
			'The "Why?" link on the Trade page that lists the terms behind the AI\'s answer.',
		default: true,
	},
	{
		id: "aiNeedTrades",
		key: "aiTradesNeedBased",
		name: "Need-Based AI-to-AI Trades",
		description:
			"Many AI-to-AI trades are driven by team needs: contenders buy veterans before the trade deadline, rebuilding teams sell veterans for picks and young players, and teams over the tax dump salary into cap space. The reason is written into the trade's transaction text. When off, AI teams only make the classic random value-for-value trades.",
		default: false,
		defaultNewLeague: true,
		existing: true,
	},
	{
		id: "aiTradeOffers",
		key: "featureAiTradeOffers",
		name: "AI Trade Offers To You",
		description:
			"AI teams send you trade offers during the season, for players on your trading block or that fit their needs (inbox message, notification and the Trade Proposals page).",
		default: false,
		defaultNewLeague: true,
		options: [
			{
				key: "aiTradeOffersFrequency",
				name: "AI Trade Offers Frequency",
				description:
					"Roughly the number of offers per 10 games (default 1, 0 means none).",
				type: "float",
				default: 1,
				min: 0,
				existing: true,
			},
		],
	},
	{
		id: "tradeMarket",
		key: "featureTradeMarket",
		name: "Trade Market",
		description:
			"Which players each AI team is willing to move, with an asking-price hint (Trade Market page and links).",
		default: true,
	},
	{
		id: "threeTeamTrades",
		key: "featureThreeTeamTrades",
		name: "Three-Team Trades",
		description: "The 3-team trade page and the link from the Trade page.",
		default: true,
	},
	{
		id: "coachingStaff",
		key: "coachingStaff",
		name: "Coaching Staff",
		description:
			"Every team has a real coaching staff (head coach plus player development, offense and defense assistants) with ratings, styles and contracts, instead of the coaching budget slider. Their salaries are paid as coaching expenses, and the staff's development ability replaces the coaching budget's effect on player progression. Turning it on in an existing league generates staffs for every team.",
		default: true,
		sports: BBGM,
		existing: true,
	},
	{
		id: "collegeStats",
		key: "featureCollegeStats",
		name: "College & Overseas Stats",
		description:
			"College and overseas stats and honors for draft prospects (College stats button and the all-classes button in Draft Scouting).",
		default: true,
		sports: BBGM,
		options: [
			{
				key: "generateCollegeStats",
				name: "Generate Pre-Draft Stats Automatically",
				description:
					"Generate college (or overseas) stats and honors for every new draft class, at league creation and each season, and for imported prospects who have none. They show on player pages and never count as pro stats.",
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
			"Regenerate ratings in Draft Scouting (one class or all classes) and Regenerate build in Customize Player.",
		default: true,
		sports: BBGM,
		options: [
			{
				key: "rerandomizeDraftClassRatings",
				name: "Re-randomize New Draft Classes",
				description:
					'Run every newly created draft class through Regenerate ratings (with the settings saved with "Save as league default"). Seeded from the league and the class year; drafted players are never touched.',
				type: "bool",
				default: false,
				existing: true,
			},
		],
	},
	{
		id: "scoutingSystem",
		key: "scoutingSystem",
		name: "Scouting System",
		description:
			"Your scouting budget gives you scouting points every season to spend on individual draft prospects (assign a scout or attend a workout) on the Draft Scouting page. Each one narrows how far off your view of that prospect's ratings can be and gives a scout report with confidence ranges.",
		default: false,
		defaultNewLeague: true,
		existing: true,
	},
	{
		id: "draftBoard",
		key: "featureDraftBoard",
		name: "Draft Board",
		description:
			"Your own prospect ranking with tiers and notes (Draft Board page), and the draft-day trade window on the Draft page.",
		default: true,
		options: [
			{
				key: "draftBoardAutoDraft",
				name: "Auto Draft From My Board",
				description:
					"When auto drafting for you, pick the top-ranked available prospect on your board.",
				type: "bool",
				default: true,
				existing: true,
			},
		],
	},
	{
		id: "aiDraftNeeds",
		key: "featureAiDraftNeeds",
		name: "AI Drafts by Need",
		description:
			"AI teams add a small need (guard, wing, big) and strategy (contenders want players who are ready, rebuilding teams want ceiling) adjustment to their draft picks.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "frivolities",
		key: "featureFrivolities",
		name: "Extra Frivolities",
		description:
			"Redraft, Draft Pick Value, Jersey Numbers by Team, Family Trees, League Economics and Home Court pages (the ones available in this sport), and the Draft Lottery what-if simulator outside basketball.",
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

type ValueOf<T> = T extends boolean
	? boolean
	: T extends number
		? number
		: string;

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
	const out: Record<string, boolean | number | string> = {};
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
	boolean | number | string
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
			} else if (o.type === "string") {
				out[o.key] = {
					type: "string",
					...(o.values ? { enum: o.values.map((v) => v.key) } : {}),
				};
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
export const nativeFeatureOptionForSport = <
	T extends boolean | number | string,
>(
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
