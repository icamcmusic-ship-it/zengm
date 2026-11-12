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
	// false: the feature needs contracts, trades or a draft, so it is always off in a college league (leagueType "college")
	college?: false;
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
		id: "bestGames",
		key: "featureBestGames",
		name: "Best Games & Top Plays",
		description:
			"The season's and all-time best games ranked by the post-game rating, with the reasons, and the top plays (game-winners, buzzer-beaters, big blocks, runs) from saved play-by-play, or from the clutch plays when no play-by-play is saved.",
		default: true,
		sports: BBGM,
	},
	{
		id: "awardVote",
		college: false,
		key: "featureAwardVote",
		name: "Award Vote",
		description:
			"A simulated media vote (100 voters, NBA ballot points, voter noise and narratives) for MVP, DPOY, ROY, 6MOY, MIP and the All-League teams: a projected vote during the season and the full breakdown for past seasons. Does not change who wins unless the option below is on.",
		default: true,
		sports: BBGM,
		options: [
			{
				key: "featureAwardVoteStore",
				name: "Save Award Votes",
				description:
					"When awards are given, save the simulated vote with them so past seasons show the same breakdown.",
				type: "bool",
				default: true,
			},
			{
				key: "featureAwardVoteDecides",
				name: "Simulated Vote Decides Awards",
				description:
					"Give MVP, DPOY, ROY, 6MOY, MIP and other league-wide player awards to the winner of the simulated vote instead of the best formula score.",
				type: "bool",
				default: false,
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
		college: false,
		key: "featureTradeGrader",
		name: "Trade Grader",
		description:
			"Grades for past trades, the Trade Grader page and grade badges on trade summaries and transactions.",
		default: true,
		sports: BBGM,
	},
	{
		id: "contractValue",
		college: false,
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
		id: "customShotClock",
		key: "customShotClock",
		name: "Custom Shot Clock",
		description:
			"Use a shot clock of another length than 24 seconds in the game simulation (30 in college basketball). After an offensive rebound it resets to 10 seconds less than the full clock. Possessions only get longer with a slower Pace setting too.",
		default: false,
		sports: BBGM,
		options: [
			{
				key: "shotClockLength",
				name: "Shot Clock Length",
				description: "Seconds on the shot clock.",
				type: "int",
				default: 24,
				min: 10,
				max: 60,
			},
		],
	},
	{
		id: "oneAndOne",
		key: "oneAndOne",
		name: "One-and-One Bonus",
		description:
			"Before the two-shot bonus (# Fouls Until Bonus), a non-shooting foul gives a one-and-one: the second free throw is only taken if the first is made. College rules: one-and-one from the 7th team foul of a half, two shots from the 10th.",
		default: false,
		sports: BBGM,
		options: [
			{
				key: "oneAndOneFouls",
				name: "Team Fouls Until One-and-One",
				description:
					"The team foul of a period from which non-shooting fouls give a one-and-one.",
				type: "int",
				default: 7,
				min: 1,
				max: 50,
			},
		],
	},
	{
		id: "collegeQuickSim",
		key: "collegeQuickSim",
		name: "College Quick Sim",
		description:
			"College leagues only: games that do not involve your team are played by a fast statistical model calibrated to the full game simulation (scores from the teams' ratings and home court, box scores shared out by minutes and roles), so a league of hundreds of schools sims several times faster. Your team's games, conference tournament finals and the national tournament always use the full simulation. On by default for the major and full levels.",
		default: false,
		sports: BBGM,
	},
	{
		id: "collegeNit",
		key: "collegeNit",
		name: "College NIT",
		description:
			"College leagues only: the NIT, a second postseason tournament for the best teams not selected for the national tournament (32 teams next to a 64-team national tournament, 16 next to a 32-team one, none when the league is too small). Regular season conference champions who lost their conference tournament get automatic bids. It is played alongside the national tournament and its champion is recorded in history. On by default for new college leagues.",
		default: false,
		sports: BBGM,
	},
	{
		id: "collegeRealignment",
		key: "collegeRealignment",
		name: "College Conference Realignment",
		description:
			"College leagues only: every few years (a chance each offseason), programs that have outgrown their conference move to a stronger one nearby, and the conferences they leave fill the spot with the best school of a weaker conference. The new conferences are used from the next season on: schedules, standings, conference tournaments and automatic bids. Moves are in the news and on the Coaching Carousel page. On by default for new college leagues.",
		default: false,
		sports: BBGM,
		options: [
			{
				key: "collegeRealignmentYears",
				name: "Years Between Realignments",
				description:
					"On average, one realignment every this many seasons (never two seasons in a row).",
				type: "int",
				default: 4,
				min: 1,
				max: 50,
			},
		],
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
		id: "realisticSchedule",
		// College mode builds its own schedule (non-conference, then conference play)
		college: false,
		key: "realisticSchedule",
		name: "Realistic Schedule Length",
		description:
			"The regular season is spread over about 2 days per game (82 games in about 172 days) instead of most teams playing almost every day: each team plays about every other day, with about 14 back-to-backs and at most about one 3-in-4 per 82 games, never 3 days in a row, and an All-Star break. Scales with the number of games. Daily things (injuries healing, free agents' asking prices, AI signings and trades, rumors, ...) keep their pace per season. Takes effect with the next schedule (the next regular season).",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "marqueeGames",
		college: false,
		key: "marqueeGames",
		name: "Marquee Games",
		description:
			"With Realistic Schedule Length: holiday games on fixed days of the season (an opening night doubleheader with the defending champion, a Christmas slate of 5 games with the best and most hyped teams and rivals, an MLK Day slate), 2-4 national TV games a week picked from the best matchups, and rivalry games spread over the season instead of bunched. The schedule pages, game previews and box scores show them, and marquee and rivalry games get a slightly louder home crowd (with Load, Fatigue & Venue). Takes effect with the next schedule (the next regular season).",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
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
		id: "expandedRatings",
		key: "expandedRatings",
		name: "Expanded Ratings",
		description:
			"Three more player ratings: wingspan (length) and perimeter and interior defense, which replace the single defensive IQ in the game sim (defensive IQ stays as their average). Length helps blocks, steals, rebounds, contesting shots and finishing over defenders; perimeter defense guards ball handlers and shooters, interior defense protects the rim. League averages stay the same. Turning it on in an existing league derives the new ratings from each player's current ratings.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "ovrV2",
		key: "ovrV2",
		name: "Sim-Calibrated Ovr",
		description:
			"Player ovr weighs each rating by how much it actually helps a team win in the game sim (measured, with separate weights when Expanded Ratings is on), instead of the old formula that overrated basketball IQ, strength and endurance and underrated height, speed, ball handling and three-point shooting. The league's ovr scale stays the same; bigs gain a little and small guards lose a little. Player value leans a little less on PER. Turning it on or off recomputes every player's ovr.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "realisticAging",
		key: "realisticAging",
		name: "Realistic Aging",
		description:
			"Players age more like in the NBA: basketball IQ and free throw shooting keep improving into the late 20s, shooting holds into the early 30s, speed and jumping decline gently from about 28 and faster after 32 (a little faster for big men), and strength holds until about 30. With Expanded Ratings, old guards no longer turn into interior defenders. Secret aging curves (Player Traits) still apply on top.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "perimeterDefense",
		key: "perimeterDefense",
		name: "Perimeter Defense",
		description:
			"Credit for perimeter defenders: steals go more to quick on-ball defenders (league steal totals unchanged), and the default DPOY and All-Defensive formulas weigh steals more and defensive win shares (inflated by defensive rebounding) less. Awards with an edited formula are not changed.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
		options: [
			{
				key: "perimeterDefenseAllDefensive",
				name: "All-Defensive Teams by Position",
				description:
					"How the All-Defensive teams are filled. Positionless: the best scores (like the NBA since 2024). One guard: at least one guard (PG, SG or G) on every team. Guards, forwards, center: 2 guards, 2 forwards and a center on every team, like the NBA before 2024 (a GF can be a guard or a forward, an FC a forward or a center).",
				type: "string",
				default: "oneGuard",
				values: [
					{ key: "none", value: "Positionless" },
					{ key: "oneGuard", value: "One guard" },
					{ key: "gfc", value: "Guards, forwards, center" },
				],
			},
		],
	},
	{
		id: "simFixes",
		key: "simFixes",
		name: "Game Sim Fixes",
		description:
			"Small fixes to how ratings work in the game simulation: offensive IQ steers players away from mid-range jumpers instead of making them miss more, better post scorers and mid-range shooters are more efficient instead of just shooting more, strong and durable players get hurt a little less, the trailing team's comeback boost is smaller, and with Expanded Ratings perimeter and interior defense (not defensive IQ) decide who fouls and the synergy skill cutoffs match the expanded ratings. League averages stay about the same.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "positionalComposites",
		key: "positionalComposites",
		name: "Position-Aware Team Ratings",
		description:
			"In the game simulation, each player on the court counts by his role for the team's ratings: the biggest players for rim protection, blocks and rebounding, the ball handlers for ball handling, the smaller players for perimeter defense (instead of a plain 5-man average, where a guard's height protected the rim as much as a center's). League averages stay about the same.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "realisticRotations",
		key: "realisticRotations",
		name: "Realistic Rotations",
		description:
			"Coaches plan each player's minutes at tip-off (by his value, minutes restrictions, back-to-backs; a tighter 8-man rotation with stars playing 38-42 minutes in the playoffs) and sub to stay on plan, sit players in foul trouble by NBA rules of thumb (2 fouls in the 1st quarter, 3 in the first half, 4 in the 3rd quarter, 5 until the closing minutes), close tight games with their best five, and empty the bench by value in blowouts. League minutes stay the same.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "coachSystems",
		key: "coachSystems",
		name: "Coaching Systems",
		description:
			"Head coaches run an offense system (Motion, Pace & Space, Heliocentric PnR, Post, Isolation, Princeton, Seven Seconds or Less) and a defense system (Switch Everything, Drop Coverage, Blitz, Pack the Paint, Zone, Full-Court Press) that change how their team plays: shot mix, pace, transition, usage, turnovers forced, fouls, the offensive glass, rotations and late-game management. Rosters fit systems better or worse, new systems take part of a season to install, coaches adapt, and reputation, hot seats and coaching trees drive the coaching market. League averages stay the same. Needs Coaching Staff.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "spacingCreation",
		key: "spacingCreation",
		name: "Spacing & Shot Creation",
		description:
			"Floor spacing and who creates the shot. The three-point threat of the four teammates around a driver makes drives more likely and easier to finish, and two or more non-shooters on the floor cramp the paint. Each shot has a creator (a ball handler, by dribbling, passing and offensive IQ) picked before the shooter: three-pointers are mostly assisted, shots at the rim about 60% and post-ups and mid-range jumpers about 40%, and better passers set up easier shots. League averages stay about the same.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "matchupDefense",
		key: "matchupDefense",
		name: "Matchup Defense",
		description:
			"At each substitution, defenders are matched to the opponents by threat and fit (perimeter defenders on guards and wings, interior defenders on bigs). A shot is defended partly by the player guarding the shooter and partly by the team (help defense), so weak defenders get attacked, and size and speed mismatches lead to more post-ups and drives. Switching coaches and versatile defenders limit mismatches, drop coverage gives up pull-up jumpers. League averages stay about the same.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "smartEndgame",
		key: "smartEndgame",
		name: "End-of-Game Intelligence",
		description:
			"Coaches manage the end of games: a timeout to stop an opponent's 10-0 run (each team has five extra timeouts for that, quick-trigger coaches use them sooner), offense and defense substitutions in the last minute of a close game, intentional fouls on the worst free throw shooter on the floor, a foul when up 3 with a few seconds left, holding for the last shot and 2-for-1s in every possession model, and the last timeout saved for when it matters. With Coaching Systems, better game managers do these more reliably.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "scheduleLoad",
		key: "scheduleLoad",
		name: "Load, Fatigue & Venue",
		description:
			"Tired players fade faster (the fatigue penalty steepens as energy runs low) and get hurt more often (the league injury rate stays the same), the third game in four nights wears teams down like a back-to-back, and home court is split into a base part, the crowd (bigger with a hyped team and in the playoffs) and a small referee lean (the home team gets about 3% more free throws), plus travel for the visitors. The league home win percentage stays the same on average.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
		options: [
			{
				key: "scheduleLoadRefVariance",
				name: "Referee Crews",
				description:
					"Each game's referees call it a little tighter or looser than average (about ±7% fouls).",
				type: "bool",
				default: true,
			},
		],
	},
	{
		id: "realisticTurnovers",
		key: "realisticTurnovers",
		name: "Realistic Turnovers",
		description:
			"Fewer turnovers, closer to the modern NBA (about 14.5 per team game instead of about 16.5 with the other new-league settings): live-ball and dead-ball turnovers both go down, the share of them that are steals goes up so steals stay the same, and the extra possessions end in shots. Points go up by about 2 per team game, pace and the other averages stay about the same.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "seasonOdds",
		college: false,
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
		id: "improvedPositions",
		key: "improvedPositions",
		name: "Improved positions",
		description:
			"Positions (PG, G, SG, GF, SF, F, PF, FC, C) from two axes, size and ball skills, instead of one line: tall playmakers become F, GF or FC rather than C, small bigs PF or F. A player keeps his position unless his ratings clearly move him to another one, and positions change only when players develop (preseason) or are created. Overall shares stay about the same. Off: the original formula.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "forkFaces",
		key: "featureForkFaces",
		name: "Fork Face Parts",
		description:
			"New male players can get the fork's own face parts (heads, eyes, hair, beards, glasses, ...) mixed in with the usual ones. See Tools → Face Style Gallery.",
		default: false,
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
		college: false,
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
		college: false,
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
		college: false,
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
		college: false,
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
		id: "capExceptions",
		key: "featureCapExceptions",
		name: "Salary Cap Exceptions",
		description:
			"With a soft cap, a team over the cap can sign one free agent a season with each salary cap exception it has: the mid-level exception (9.1% of the cap, up to 4 years; a smaller taxpayer one, 3.7% and 2 years, near the luxury tax), the bi-annual exception (3.3%, 2 years, every other season) and, for teams that used cap space, the room exception (5.7%, 3 years). They are used automatically when a signing only fits that way, by AI teams too. Off: over the cap, only minimum contracts. No effect with a hard cap or no cap.",
		default: false,
		defaultNewLeague: true,
		options: [
			{
				key: "capExceptionsRepeaterTax",
				name: "Repeater Luxury Tax",
				description:
					"A team that paid the luxury tax in at least 3 of the previous 4 seasons pays it at 5/3 of the normal rate (2.5 instead of 1.5 per dollar over the line).",
				type: "bool",
				default: false,
			},
			{
				key: "capExceptionsStretch",
				name: "Stretch Provision",
				description:
					"When releasing a player, what is owed after the current season can be spread evenly over twice the remaining seasons plus one. AI teams over the luxury tax do it too.",
				type: "bool",
				default: false,
			},
		],
	},
	{
		id: "tradeExplain",
		college: false,
		key: "featureTradeExplain",
		name: "Trade Explanations",
		description:
			'The "Why?" link on the Trade page that lists the terms behind the AI\'s answer.',
		default: true,
	},
	{
		id: "aiNeedTrades",
		college: false,
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
		college: false,
		key: "featureAiTradeOffers",
		name: "AI Trade Offers To You",
		description:
			"AI teams send you trade offers during the season (until the trade deadline) and the offseason, for players on your trading block or any players/picks that fit their needs. They replace Trade Proposals with a Trade Offers inbox (accept, negotiate, decline, request offers), with an notification for each new offer.",
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
			{
				key: "aiTradeOffersExpiration",
				name: "AI Trade Offers Expiration",
				description:
					"Offers expire after this many days (your games in the regular season, days of free agency). They also expire when the phase changes, when the AI team loses a player or when a player/pick in the offer moves.",
				type: "int",
				default: 15,
				min: 1,
			},
		],
	},
	{
		id: "tradeMarket",
		college: false,
		key: "featureTradeMarket",
		name: "Trade Market",
		description:
			"Which players each AI team is willing to move, with an asking-price hint (Trade Market page and links).",
		default: true,
	},
	{
		id: "rumors",
		key: "featureRumors",
		name: "Rumors",
		description:
			"A rumor mill built from what AI teams are actually planning: who is on the block, which teams are calling about whom, unhappy players, extension talks, where free agents are leaning, coaches and GMs on the hot seat, draft targets. Each rumor has a confidence and is later marked confirmed or didn't happen (Rumors tab of Transactions, dashboard card, newspaper). It never changes what AI teams do.",
		default: false,
		defaultNewLeague: true,
		options: [
			{
				key: "rumorsNotify",
				name: "Rumor Notifications",
				description:
					"Show a notification when a new rumor involves your team or one of your players.",
				type: "bool",
				default: true,
			},
		],
	},
	{
		id: "threeTeamTrades",
		college: false,
		key: "featureThreeTeamTrades",
		name: "Three-Team Trades",
		description: "The 3-team trade page and the link from the Trade page.",
		default: true,
	},
	{
		id: "draftPickConditions",
		college: false,
		key: "featureDraftPickConditions",
		name: "Draft Pick Protections & Swaps",
		description:
			"NBA-style conditions on traded draft picks: top-N protections that roll over to the next year (or convert to a 2nd round pick, or vanish), and pick swap rights. Resolved when the draft order is set. The AI values them and may offer protections in counter offers.",
		default: false,
		defaultNewLeague: true,
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
		id: "gmPersonalities",
		college: false,
		key: "featureGmPersonalities",
		name: "AI GM Personalities",
		description:
			"Every AI team has a general manager with a name, a face and fixed leanings (win-now or patient, analytics or old-school, risk, luxury tax, draft picks, how often he trades, loyalty, free agency and draft approach) that shift its trades, signings, re-signings, draft picks, team strategy and coach hires a little. GMs are fired after sustained failure against expectations and replaced through a GM carousel (Front Offices tab of League History, team pages, news). Your team has no GM unless you're in spectator mode or auto play.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "collegeStats",
		college: false,
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
		id: "collegeSeason",
		college: false,
		key: "featureCollegeSeason",
		name: "College Season & March Madness",
		description:
			"With college stats, a light college season for each draft class's draft year: conference standings, AP Top 25, conference tournaments and the 68-team NCAA tournament, with prospects' teams, tournament games and honors on their pre-draft record (Draft Scouting → College/Overseas tab).",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "draftClassShapes",
		college: false,
		key: "featureDraftClassShapes",
		name: "Draft Class Shapes",
		description:
			"Every draft class the game generates gets a shape (a deep class, a top-heavy one, a weak one, a generational talent, a guard-heavy or big man class, an international class, a high-upside class...) that reshapes its talent, positions, ages and origins within realistic bounds, shown on Draft Scouting. Balanced so the average class is as good as before. Imported and uploaded classes are never reshaped.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "ratingsRegenerator",
		college: false,
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
		college: false,
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
		college: false,
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
		college: false,
		key: "featureAiDraftNeeds",
		name: "AI Drafts by Need",
		description:
			"AI teams add a small need (guard, wing, big) and strategy (contenders want players who are ready, rebuilding teams want ceiling) adjustment to their draft picks.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "mockDraft",
		college: false,
		key: "featureMockDraft",
		name: "Mock Draft",
		description:
			"A two-round mock draft of the current class on Draft Scouting (each team picks by its own needs and strategy, in its real pick order), and simulated pro careers for prospects (peak ovr, star/starter/bust odds), also on the prospect's player page.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "scoutingReports",
		key: "featureScoutingReports",
		name: "Scouting Reports",
		description:
			"Full scouting reports for every player, written by your scouting department (2-5 scouts made from your scouting budget, with specialties and biases): letter grades with ranges, comparisons, floor and ceiling, offense/defense breakdowns, flags, development plan, team fit and a bottom line, only from what your scouts can see. A Scouting page on every player, a printable scouting card, stock up/down history, a track record per scout, playoff opponent scouting, blurbs in trades and free agency, hover cards in the Mock Draft and Draft Board, and a draft preview in the Newspaper. Off: the short report on the College/Overseas page stays as it was.",
		default: false,
		defaultNewLeague: true,
		sports: BBGM,
	},
	{
		id: "frontOffice",
		college: false,
		key: "featureFrontOffice",
		name: "Front Office Budget",
		description:
			"Six front office departments on Team Finances (Scouting, Analytics, Medical, Travel & Sports Science, Coaching, Facilities) funded from an owner-set envelope that grows with market size: more in one means less elsewhere, and spending over the envelope costs owner mood. Analytics narrows your projection ranges in trades and free agency, sharpens the head coach's game management (with Coaching Systems) and makes AI GMs who spend on it lean analytics; Medical lowers injury rates and speeds older players' recovery on top of the health budget's shorter injuries; Travel & Sports Science softens travel, back-to-back and 3-in-4 fatigue (with Load, Fatigue & Venue or Injury Depth). Bounded, with diminishing returns, neutral at average spending. AI teams allocate by GM leanings and market size. A season review shows what your spending bought.",
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
		id: "recordsBook",
		key: "featureRecordsBook",
		name: "Records Book",
		description:
			"League and franchise records (career, season, single game, playoffs, team seasons and streaks) on a League History tab, kept as games are played.",
		default: true,
		sports: BBGM,
		options: [
			{
				key: "featureRecordsNews",
				name: "Record News",
				description:
					"A news item and notification when a league record (career, season, single game, wins, winning streak) is broken.",
				type: "bool",
				default: true,
			},
		],
	},
	{
		id: "milestones",
		key: "featureMilestones",
		name: "Milestones",
		description:
			"Career milestones and all-time rank passes within reach, with the projected game, on a Player Stats tab and a dashboard card.",
		default: true,
		sports: BBGM,
		options: [
			{
				key: "featureMilestonesDashboard",
				name: "Milestones on Dashboard",
				description: "Show your players' upcoming milestones on the dashboard.",
				type: "bool",
				default: true,
			},
			{
				key: "featureMilestoneNotifications",
				name: "Milestone Notifications",
				description:
					"Pop up a notification when one of your players reaches a career milestone.",
				type: "bool",
				default: true,
			},
		],
	},
	{
		id: "rivalries",
		key: "featureRivalries",
		name: "Rivalries",
		description:
			"A rivalry score for every pair of teams (playoff meetings by round, close games, division, star duels, recent history), the Rivalries tab of Head-to-Head with Finals matchups and a rivalry timeline, and a rivals card on team history pages.",
		default: true,
		sports: BBGM,
	},
	{
		id: "seriesRecaps",
		college: false,
		key: "featureSeriesRecaps",
		name: "Series Recaps",
		description:
			"A generated recap of every playoff series (game by game, leaders, series MVP, turning points, upsets and comebacks), the Series Recaps tab of Playoffs, recap links in the bracket and a news item when a series ends.",
		default: true,
		sports: BBGM,
	},
	{
		id: "hyphenatedNames",
		key: "featureHyphenatedNames",
		name: "Hyphenated Last Names",
		description:
			"Some new American players get a hyphenated last name made of two common surnames, like Smith-Jones. Only affects players generated while it is on.",
		default: false,
		defaultNewLeague: true,
		options: [
			{
				key: "hyphenatedNamesRate",
				name: "Hyphenated Last Name Rate",
				description:
					"Percentage of new American players with a hyphenated last name.",
				type: "float",
				decoration: "percent",
				default: 1,
				min: 0,
				max: 100,
			},
		],
	},
	{
		id: "unretire",
		college: false,
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
	if (f.college === false && get("leagueType") === "college") {
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
