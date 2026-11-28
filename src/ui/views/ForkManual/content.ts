// Player-facing manual of everything this fork adds or changes compared to upstream Basketball GM.
// Written for players (what it is, where to find it, how to use it, which League Extras switch controls it),
// rewritten from docs/native-features.md and the other docs/ files. Keep it in sync when features change.

export type ManualEntry = {
	title: string;
	// Where to find it in the game
	where?: string;
	// The League Extras switch (or other setting) and its default. "Always on" means it is part of the core model.
	toggle?: string;
	body: string[];
};

export type ManualSection = {
	id: string;
	title: string;
	intro?: string;
	entries: ManualEntry[];
};

const CORE = "Always on (part of the fork's core model, no switch)";

export const MANUAL_SECTIONS: ManualSection[] = [
	{
		id: "start",
		title: "Start here",
		intro:
			"This fork of Basketball GM adds dozens of pages, a much deeper game simulation, a richer player model, coaching staffs, AI general managers, front office finances, deeper drafting and scouting, and a whole College mode. Most of it is basketball only; contracts, trades, the Draft Board and the scouting system also work in the other sports.",
		entries: [
			{
				title: "Core features vs. League Extras",
				where: "Tools → League Settings → League Extras tab",
				body: [
					"Most of the fork's changes to how the game plays (the game sim model, the player model, coaching staff, AI GMs, front office, draft and scouting systems) are the core model: every league has them and they cannot be turned off. When you load an older league, it is converted once (new ratings derived, staffs and GMs created) and plays the fork's model from then on.",
					"Everything that is still optional is a switch on the League Extras tab of League Settings. A feature that is off disappears from menus, the command palette, More links and the dashboard, its pages say it is turned off, and its background work stops.",
					'"Existing leagues" in this manual means leagues created before a setting existed: switches that change how games or the AI play default to off there, so the league keeps playing as it did; display-only features default to on everywhere. New leagues get the defaults listed with each feature.',
					"The New League screen also has every League Extra in its League extras categories at the bottom, so you can set them before the league starts.",
				],
			},
			{
				title: "Other sports",
				body: [
					'In Football, Hockey and Baseball GM, basketball-only menu items and links are hidden and their pages show a short "only available for basketball" message. Contracts (options, guarantees, extensions, trade requests, holdouts, cap exceptions), trade features (explanations, AI offers, Trade Market, 3-team trades, pick protections, rumors), the Draft Board, the scouting system, CSV/PDF downloads, the side menu extras and Power Rankings improvements work in every sport.',
				],
			},
		],
	},
	{
		id: "navigation",
		title: "Pages & navigation",
		entries: [
			{
				title: "Tabbed pages",
				body: [
					"Pages that belong with an original BBGM page are now tabs at the top of that page (the tab bar scrolls sideways on a phone). Each tab keeps its own URL, so old bookmarks and the command palette (Ctrl+K) still land on the right tab. Tabs of a turned-off feature are hidden.",
					"League Settings: League Settings, League Extras. Trading Block: Trading Block, Trade Market. Trade: 2 teams, 3 teams. Transactions: Transactions, Trade Grader (and Rumors). League Finances: Finances, Contract Value, Economics, Home Court. Draft History: Draft History, Redraft, Pick Value. Draft Scouting: Draft Scouting, Draft Board, Mock Draft, Combine, Big Boards, Scouts, Pro Scouting, Staff Report, College/Overseas. Relatives: Relatives, Family Trees. Jersey Numbers: League, By Team. Player Ratings: Player Ratings, Archetypes, Badges. League History: League History, Timeline, Coaches, Front Offices, Records Book, Eras. Player Stats: Player Stats, Milestones. Daily Schedule: Daily Schedule, Games to Watch, Best Games. Head-to-Head: Head-to-Head, Rivalries. Playoffs: Playoffs, Series Recaps, Bracket Archive, Bracket Challenge. Award Races: Award Races, Award History, Award Vote. Hall of Fame: Hall of Fame, Watch, Ballot.",
				],
			},
			{
				title: "Reorganized side menu",
				body: [
					"The side menu is split into groups: League, Newsroom (News Feed, Rumors, Newspaper, Wrapped, Storylines), History, Team, Players, Draft / College, Stats, Tools, Settings, Commissioner (God Mode and editors, collapsed until expanded), Danger (Delete Old Data, Danger Zone, Delete All Leagues) and Help. Collapsed groups are remembered in your browser.",
					"Filter menu: a box at the top of the side menu that finds any page, including tab pages and command palette entries. Arrow keys move through the results, Enter opens one, Esc clears.",
					"Now: a group with the pages that matter in the current phase (playoffs, draft lottery and draft, re-signing, free agency, and in college leagues conference tournaments, departures, transfer portal and recruiting).",
					"Favorites: hover over any menu item and click its star to pin it to Favorites (for every league in this browser).",
					"Recently visited: the last 5 menu pages you opened in this league, with the exact season or team you picked.",
					"Badges: News Feed, Trade Offers and Newspaper show a small count of what's new since you last opened them.",
				],
			},
			{
				title: "Calendar and play menu",
				where: "Play menu; God Mode schedule editor",
				body: [
					'The Play menu can play until a given day, a holiday, or your next road game, and converts "a week" or "a month" into game days correctly with the realistic schedule.',
					"League Settings have a season length and All-Star break length. The schedule editor has a Validate schedule panel (back-to-backs, 3-in-4s, home/away balance per team) and refuses to save broken schedules.",
				],
			},
		],
	},
	{
		id: "newsroom",
		title: "Newsroom & history pages",
		intro:
			"Pages written from your league's own records: results, box scores, awards and transactions. All basketball; all have their own League Extras switch, on by default unless noted.",
		entries: [
			{
				title: "Newspaper",
				where: "Newsroom → Newspaper; team pages (team edition); history pages",
				toggle: "Newspaper — on / on",
				body: [
					'A front page plus sections (Playoffs, Awards, Teams, Players, Features, Transactions, By the numbers, Opinion, Colour & letters) written from the season. During the season it reports "so far"; after the playoffs it becomes the final edition. A team edition focuses on one franchise, and back issues cover earlier seasons. Print edition gives a print-friendly layout.',
					"It includes an award race tracker with weekly movement, named columnists with their own voices, a medical desk, a rumor mill sidebar, All-Star weekend coverage and franchise history features (relocations, renames).",
				],
			},
			{
				title: "Wrapped",
				where:
					"Newsroom → Wrapped; Wrapped buttons on player, team and history pages",
				toggle: "Wrapped — on / on",
				body: [
					"A tap-through story deck (phone-shaped cards) of a season, a team's year, a player's year, or the whole league's history, plus a Compare mode for two players, teams or seasons side by side. Use arrow keys, the on-card buttons, tap or swipe. Each slide can be saved or copied as a PNG. The gear icon sets the number of slides, autoplay and quiz slides.",
				],
			},
			{
				title: "Storylines",
				where:
					"Newsroom → Storylines; Storylines buttons on player and team pages",
				toggle: "Storylines — on / on",
				body: [
					'Story cards found in your league\'s history: Cinderella runs, upsets, droughts, dynasties, big triple-doubles, ageless wonders, ring chasers, homecomings, stacked draft classes and more. Each has a "Why this story?" button with the numbers behind it. The Threads tab groups related stories. Filter by season and kind, or search.',
				],
			},
			{
				title: "Games to Watch (hype)",
				where:
					"Daily Schedule → Games to Watch; dashboard card; schedules; box scores",
				toggle:
					"Games to Watch — on / on (options: on Dashboard, on Schedules and Box Scores)",
				body: [
					"A 0–100 must-watch score for upcoming games with the reasons listed (playoff stakes, two winning teams, star matchups, rivalries, record chases, marquee dates...). After the game you get a 0–100 rating of how it played out and a verdict on whether it lived up to the hype. Record chases lists players close to league or franchise records.",
				],
			},
			{
				title: "Best Games & Top Plays",
				where: "Daily Schedule → Best Games",
				toggle: "Best Games — on / on",
				body: [
					"The season's (or all time's) best games ranked by their game rating, and the top plays: game-winners, buzzer-beaters, late go-ahead shots, defensive stops, posters, alley-oops, chase-down blocks, heaves and run-cappers. Plays come from saved play-by-play, so games without stored play-by-play have no plays.",
				],
			},
			{
				title: "Award Vote, Award History and award key stats",
				where: "Award Races → Award Vote / Award History tabs",
				toggle:
					"Award Vote — on / on; Award History and key stats always on (all sports)",
				body: [
					"Award Vote simulates a 100-member media vote for every regular-season award with real ballot points, so you see vote shares and first-place votes, not just a winner.",
					"Award Races shows each award's stat columns taken from its formula, also for past seasons. Award History lists one award's winners in every season, with top finishers. Season Summary has a Columns menu per award.",
				],
			},
			{
				title: "Coach & Executive of the Year",
				where:
					"Award Races, Award History, History, Coaches, Front Offices; formulas in Award Settings",
				toggle: CORE,
				body: [
					"Two built-in awards given after the playoffs alongside MVP: Coach of the Year (head coaches) and Executive of the Year (general managers; not in college leagues). Their formulas can be edited in Award Settings.",
				],
			},
			{
				title: "League Achievements",
				where: "History → League Achievements; dashboard card",
				toggle:
					"League Achievements — on / on (options: Notifications, on Dashboard)",
				body: [
					"Achievements unlocked by things that happen in your league, rated common, rare, legendary or impossible by how often they happen in simulated leagues. Unlocks are announced as notifications.",
				],
			},
			{
				title: "Trade Grader",
				where:
					"Transactions → Trade Grader; grades on Trade Summary and Transactions",
				toggle: "Trade Grader — on / on",
				body: [
					"Grades each side of every trade by the win shares what it received produced for it, regular season + playoffs or regular season only, and notes titles won with players acquired in the deal.",
				],
			},
			{
				title: "Contract Value",
				where: "League Finances → Contract Value; player salaries",
				toggle: "Contract Value — on / on",
				body: [
					"A value index for every contract, with the league's biggest bargains and albatrosses.",
				],
			},
			{
				title: "Timeline",
				where: "League History → Timeline",
				toggle: "Timeline — on / on",
				body: [
					"Season by season: champions, MVPs, the newspaper's lead, top storylines, achievements, records, biggest trades and comebacks, each linking to its source. Filter by season range and kind.",
				],
			},
			{
				title: "Records Book",
				where: "League History → Records Book; player pages (Rankings)",
				toggle: "Records Book — on / on",
				body: [
					"Top-10 lists for career, single-season, per-game, single-game, playoff and team records, for the league or one franchise, raw or era-adjusted. Active holders get a badge and records broken this season are flagged with the previous holder. League Leaders also has an era-adjusted toggle.",
				],
			},
			{
				title: "Milestones",
				where:
					"Player Stats → Milestones; dashboard Milestone Watch card; news",
				toggle: "Milestones — on / on",
				body: [
					"Active players close to a career mark or to passing someone on the all-time top 100, with their pace and the projected game (date and opponent). Milestones reached by your players are news.",
				],
			},
			{
				title: "Rivalries and rivalry stories",
				where: "Head-to-Head → Rivalries; Team History Rivals card",
				toggle: "Rivalries — on / on; rivalry stories always on",
				body: [
					"A rivalry score for every pair of teams, built from playoff meetings, close games, division ties and star duels, decaying over time. Tiers: Mild, Simmering, Heated, Bitter. Each pair page has a timeline and stories, which also feed the Newspaper, Storylines and Games to Watch.",
				],
			},
			{
				title: "Series Recaps, Bracket Archive, Bracket Challenge",
				where: "Playoffs tabs; Recap link on each series of the bracket",
				toggle: "Series Recaps — on / on",
				body: [
					"Series Recaps: game by game results, series leaders and MVP, turning points, upsets and comebacks for every playoff series.",
					"Bracket Archive: every past bracket in compact form. Bracket Challenge (not in college leagues): fill in your picks once the first round is set and score per round against the AI pickers; series storylines appear in the news.",
				],
			},
			{
				title: "League Eras & rule-change votes",
				where: "League History → Eras; news",
				toggle:
					"League Eras — on for new leagues / off for existing (options: rule-change votes, your vote)",
				body: [
					"The league's style (three-point tendency, pace, fouls, offensive rebounding) drifts slowly from season to season, naming eras. With votes on, rule changes are put to a vote of the teams, and you can vote yourself.",
				],
			},
			{
				title: "Hall of Fame ballot, Watch, Wing and Ring of Honor",
				where: "Hall of Fame → Watch / Ballot tabs; player pages; Team History",
				toggle:
					"Hall of Fame Ballot — on for new leagues / off for existing (options: wait years, veterans committee)",
				body: [
					"Instead of being inducted the moment they retire, players go on a yearly ballot after a waiting period (default 3 years), with first-ballot locks announced at the end of the regular season and a veterans committee for overlooked players. The Watch tab tracks active and retired candidates. The Hall adds coaches and executives, induction speeches and plaque text; Team History gets a Ring of Honor.",
					"College leagues have a separate College Hall of Fame (always on).",
				],
			},
			{
				title: "Statistical Feats: filters, rarity, team feats and streaks",
				where: "Stats → Statistical Feats",
				toggle: "Feat Rarity & Streaks — on / on",
				body: [
					"Filter feats by type and game type, switch to a Leaderboard, and see each feat's rarity, Feat Score and notes (career highs). Team feats and Streaks tabs track team performances and running streaks.",
				],
			},
			{
				title: "Season Odds and Power Rankings",
				where:
					"Standings, Power Rankings, Playoffs, Award Races, Draft Lottery",
				toggle: "Season Odds — on / on",
				body: [
					"1,000 simulations of the rest of the season give playoff and title odds on Standings and Power Rankings, series odds on the bracket, a Win% column on Award Races and a what-if simulator on the Draft Lottery.",
					"Power Rankings (all sports) now count playoff results once the playoffs start, and hovering a rank explains why a team is ranked there.",
				],
			},
			{
				title: "Unretirements",
				where: "Happens at the start of free agency; news",
				toggle:
					"Unretirements — off / off (options: chance 10%, minimum age 35, ovr boost 3–6)",
				body: [
					"Once a season a random retired veteran may come out of retirement as a free agent with a small ratings boost.",
				],
			},
			{
				title: "Extra Frivolities",
				where: "Tools → Frivolities",
				toggle: "Extra Frivolities — on / on (all sports)",
				body: [
					"Redraft, Draft Pick Value, Jersey Numbers by Team, Family Trees, League Economics and Home Court.",
				],
			},
			{
				title: "Franchise reboots",
				body: [
					"Moving, renaming or rebranding a team in God Mode creates news with a fan reaction, and the newspaper runs a history feature on the franchise.",
				],
			},
		],
	},
	{
		id: "sim",
		title: "Game simulation",
		intro:
			"The basketball game sim is heavily reworked. Nearly all of this is the core model (always on); league-wide averages stay NBA-like.",
		entries: [
			{
				title: "Play-by-play",
				where: "Live game view; box scores",
				toggle:
					"Play-by-Play Flavor, Live Play-by-Play, Box Score Play-by-Play (Always show / on button press) — on / on; Games to Save Play-by-Play For (all, my team, none)",
				body: [
					"Varied, ratings-aware wording for every play (shot types, passes, fouls with foul counts, bonus, runs, milestones, quarter summaries, starting lineups at the tip, real charges). Text only: results are identical with or without it. Box scores can show the saved play-by-play.",
				],
			},
			{
				title: "Realistic possessions",
				toggle: CORE,
				body: [
					"A 24-second shot clock (14 after an offensive rebound), fast breaks, late-clock shots and violations, holding for the last shot, 2-for-1s and intentional fouling.",
				],
			},
			{
				title: "Technical & flagrant fouls, suspensions",
				toggle: CORE,
				body: [
					"Rare technicals, flagrant fouls and ejections, shown in box scores and as TF/FF columns. Repeat offenders face league discipline (fines and suspensions), marked next to the player's name.",
				],
			},
			{
				title: "Smarter shots, spacing and defense",
				toggle: CORE,
				body: [
					"Game Sim Fixes rebalance what ratings are worth (inside and mid-range scoring now matter) and players learn the zones they make. Spacing & Shot Creation makes drives, finishing and assists depend on spacing and creators. Matchup Defense assigns defenders and hunts mismatches. Position-aware team ratings mean a center protects the rim more than a guard. Realistic play types, realistic turnovers and Game Flow (contest levels, help defense, runs, coaching adjustments) round it out.",
					"Shot zones and expected FG% are tracked for each shot (Shot Zones switch, on for new leagues) and shown on the player page.",
				],
			},
			{
				title: "Shot Share Model and breakout nights",
				where:
					"Roster (game plan: More / Normal / Fewer shots); player page Shot diet; box score",
				toggle: CORE,
				body: [
					"Who takes the shots depends on role, hot hands, mismatches and double teams. You can set each of your players to take more or fewer shots on the Roster page. Role and bench players occasionally have breakout scoring nights.",
				],
			},
			{
				title: "Shot profiles & defensive schemes",
				where: "Roster page (Shots column, Defensive scheme)",
				toggle:
					"Shot Profiles & Defensive Schemes — on for new leagues / off for existing",
				body: [
					"Pick a shot profile for each player (or let the coach choose) and a team defensive scheme that changes what shots opponents get.",
				],
			},
			{
				title: "Rotations and coach decisions",
				where:
					"Roster page (Let coach decide, Always let coach decide, lineup presets); box score coach's note",
				toggle: CORE,
				body: [
					'The coach plans minutes before tip-off, handles foul trouble, garbage time and closers, and decides starters and rotation order from his game prep and player management ratings. "Let coach decide" (formerly Auto sort roster) hands the lineup to him; your own starters and playing time settings are respected otherwise. Promised roles in negotiations affect mood. Playoff rotations tighten in elimination games.',
				],
			},
			{
				title: "Coaching systems and offensive emphasis",
				where:
					"Coaching Staff → Offense tab; team page; Coach's notes; Staff Report",
				toggle: CORE,
				body: [
					"Every head coach runs offensive and defensive systems that fit some rosters better than others and take time to install. Offensive emphasis dials (or a preset) steer what play types your team looks for.",
				],
			},
			{
				title: "End-of-game intelligence",
				toggle: CORE,
				body: [
					"Run-stopping and advance-the-ball timeouts, late-game substitutions, fouling when up three, isolations for the closer on go-ahead possessions, and smarter clock use.",
				],
			},
			{
				title: "Star & clutch calibration",
				toggle: CORE,
				body: [
					"Stars draw more defensive attention and clutch moments shift usage, so star efficiency and late-game play look realistic.",
				],
			},
			{
				title: "Load, fatigue & venue",
				toggle: CORE + " (option: Referee Crews, on)",
				body: [
					"Back-to-backs, 3-in-4s and travel from the previous city affect fatigue and injuries; home crowds and referee crews vary. Teams that clinched or are eliminated rest players late in the season.",
				],
			},
			{
				title: "Injuries",
				where: "Player page; Roster; Schedule",
				toggle: CORE,
				body: [
					"New leagues use twice the stock injury rate. After a long injury, players return on a minutes restriction with a period of re-injury risk. Injury types depend on position and body type, there are 30 more injury types, outlook estimates, game-time decisions, and surgery vs. rehab choices. Injury history is kept on the player page.",
				],
			},
			{
				title: "Advanced tracking stats",
				where: "Player Stats tabs; player page; Team Stats → Lineups",
				toggle: CORE + " (Keep Career Tracking for Retired Players: on / on)",
				body: [
					"Tracking stats (shot defense, play types, lineups and more) are recorded for every game and kept for retired players' whole careers.",
				],
			},
			{
				title: "Realistic schedule and marquee games",
				where: "Schedule, Daily Schedule",
				toggle: CORE,
				body: [
					'The season is spread over realistic dates (about 2 days per game) instead of nearly every day, with marquee dates, national TV games and rivals spaced out. Takes effect with the next regular season. Not used with "Group schedule into series".',
				],
			},
			{
				title: "All-Star weekend",
				where: "All-Star → Weekend; Settings → All-Star",
				toggle:
					"All-Star Vote, Rising Stars Game, Skills Challenge — on / on; Team Assignment adds a Tournament option",
				body: [
					"A fan vote, a Rising Stars game, a Skills Challenge and an optional All-Star tournament, covered in the newspaper and news.",
				],
			},
			{
				title: "Game rule options",
				toggle:
					"Custom Shot Clock (24) and One-and-One Bonus (7 fouls) — off / off (on in college)",
				body: [
					"Any league can use a different shot clock length or the college one-and-one free throw bonus.",
				],
			},
		],
	},
	{
		id: "players",
		title: "Players: ratings, traits, archetypes, badges",
		entries: [
			{
				title: "Expanded ratings",
				where: "Ratings tables, player pages, Customize Player",
				toggle: CORE,
				body: [
					"New ratings: Wingspan (Wng), Perimeter Defense (PDf) and Interior Defense (IDf), which replace Defensive IQ in the sim, plus more in a second step. Wingspan is fixed at generation around height.",
				],
			},
			{
				title: "Sub-ratings",
				where:
					"Player page (click ▸ next to a rating, or Show sub-ratings); ratings tables; Compare Players",
				toggle: CORE,
				body: [
					"Ten base ratings are each the average of 2–4 sub-ratings (25 in all), so two players with the same shooting rating can shoot very differently. The sim reads the sub-ratings. Editing a sub-rating in Customize Player recomputes its base.",
				],
			},
			{
				title: "Sim-calibrated ovr",
				toggle: "Sim-Calibrated Ovr — on for new leagues / off for existing",
				body: [
					"Ovr weighs every rating by how much it actually helps win games in this sim. Turning it on or off recomputes every player's ovr (pot moves by the same amount).",
				],
			},
			{
				title: "Player traits",
				where:
					"Player page Traits line and Traits sub-page; Draft Scouting; Advanced Player Search; Customize Player",
				toggle: CORE,
				body: [
					"Twenty-two 0–100 traits in four groups: Mental (clutch, late-game IQ, big-game, consistency, shot discipline, foul discipline, handle under pressure), Personality (leadership, ego, temper, work ethic, veteran savvy, loyalty, role acceptance, money vs. winning), Physical (durability, recovery, motor) and Playstyle (off-ball movement, screening, hustle...). They affect the sim, development, mood and the locker room.",
					"A secret aging curve (early bloomer, late bloomer, ages gracefully, normal) is hidden everywhere until the player retires.",
					"Scouts see trait ranges for prospects, not exact values.",
				],
			},
			{
				title: "Archetypes",
				where:
					"Player page Archetype line; League → Archetypes (Player Ratings tab); Draft Scouting; Roster; Free Agents / Trading Block / Trade",
				toggle: "Archetypes — on / on",
				body: [
					'Every player gets a build name (over 200 archetypes, mostly NBA 2K style names) describing how he plays, with a one-line description and a short "why". Prospects\' archetypes come from scouted ratings. A "Fills a need" badge and filter shows players who fit holes in your roster, and the roster shows lineup-fit hints.',
				],
			},
			{
				title: "2K Badges",
				where:
					"Player tables (up to 3 next to a name, rest behind +N); player page Badges; Player Ratings → Badges",
				toggle:
					"Badges always shown. 2K Badge Effects in Sim — on for new leagues / off for existing",
				body: [
					"68 NBA 2K-style badges in 7 categories with Bronze to Legend tiers; each player shows his best 6. Click a badge for its description, what it does in games at that tier, and the score needed. With 2K Badge Effects in Sim on, badges change how players perform in games. The stock skill letters are no longer shown in basketball.",
				],
			},
			{
				title: "Improved positions",
				toggle: CORE,
				body: [
					"Positions (PG, G, SG, GF, SF, F, PF, FC, C) are decided by size first, then role, using length (height plus wingspan) and ball skills, so strong guards stay guards.",
				],
			},
			{
				title: "Prospect variety and generation presets",
				where: "New League screen; League Settings",
				toggle:
					"Prospect variety always on; Generation Presets — on / on (Balanced, Guard-heavy, Big-man, Shooting, Athletic era)",
				body: [
					"Newly generated players have more varied builds, draft classes go through talent cycles and deep or thin eras, and a preset can tilt new players toward an era's style while keeping overall talent the same.",
				],
			},
			{
				title: "Aging and development",
				where: "Player page (hover a season's ovr for the breakdown)",
				toggle: CORE,
				body: [
					"Realistic aging gives every rating its own aging curve after 23. Career aging adds wear and tear from career minutes, affecting injuries, retirement and free agency. Young players' development depends partly on playing time. Hover a season's ovr in the Ratings table to see why it changed (age, coaching, work ethic, playing time, injuries).",
				],
			},
			{
				title: "Faces",
				where:
					"Everywhere faces appear; player page Then and Now; Tools → Face Style Gallery",
				toggle:
					CORE +
					" (Face Aging options: speed, hair loss, graying, age retired players, style events)",
				body: [
					"Many new hairstyles, beards and face parts, chosen to fit age and hair texture. Faces age every preseason (graying, hair loss, weight), players change styles over their careers, and the player page shows Then and Now. Edited faces are locked from aging.",
				],
			},
			{
				title: "Names",
				toggle: CORE,
				body: [
					"More varied and modern names, new countries, and occasional hyphenated last names. Player nicknames were removed.",
				],
			},
			{
				title: "Player pages",
				body: [
					"New on the player page: college/overseas rows, an Earlier honors box, Wrapped and Storylines buttons, Archetype and Traits lines, badges, a Contract & Mood panel, and Scouting, Traits and College/Overseas entries in the player dropdown.",
				],
			},
		],
	},
	{
		id: "contracts",
		title: "Contracts, mood & trades",
		intro: "These work in every sport.",
		entries: [
			{
				title: "Contract options and guarantees",
				where: "Negotiation window; player page",
				toggle: CORE,
				body: [
					"Contracts of 2+ years can carry a player option (cheaper) or team option (pricier), and a partial guarantee after year 1 (100/75/50/0%), priced per season it covers.",
				],
			},
			{
				title: "In-season extensions",
				where: "Player page",
				toggle: CORE,
				body: [
					"Extend your players during the season instead of waiting for re-signing.",
				],
			},
			{
				title: "Trade requests and holdouts",
				where: "Player pages; Trading Block; before the regular season",
				toggle:
					"Trade Requests — on for new / off for existing; Holdouts — on for new / off for existing (Holdout Frequency)",
				body: [
					"Unhappy players can ask to be traded and may withdraw the request if things improve. Players who think they're underpaid may hold out before the season.",
				],
			},
			{
				title: "Mood changes",
				where: "Player Contract & Mood panel",
				body: [
					"Mood traits come from the player's personality, the locker room is weighted by each player's importance (worst egos named), and coach relationships matter (see Coaching staff).",
				],
			},
			{
				title: "Salary cap exceptions",
				where: "Free agency; Free Agents; negotiation; Team Finances",
				toggle: CORE + " (options: repeater tax, stretch provision — off)",
				body: [
					"With a soft cap, over-the-cap teams can sign free agents with NBA-style exceptions (mid-level, bi-annual, room exception, disabled player exception) instead of only minimum contracts.",
				],
			},
			{
				title: "Competitive balance, league parity and AI roster balance",
				toggle:
					"Competitive Balance and AI Roster Balance always on; League Parity — on for new / off for existing",
				body: [
					"AI teams avoid paying into the luxury tax for marginal players, bad teams don't lose all their stars, AI rosters stay balanced by position, and AI teams make hardship signings when injuries pile up. Your team is never touched.",
				],
			},
			{
				title: "Trade explanations",
				where: "Trade page → Why?",
				toggle: "Trade Explanations — on / on",
				body: [
					'When the AI rejects a deal or counters, "Why?" lists how it valued each asset (talent, age, contract, injuries, pick position) and team terms (strategy, roster fit, payroll), including the AI GM\'s leanings.',
				],
			},
			{
				title: "AI trade offers and Trade Market",
				where:
					"Trade Offers (replaces Trade Proposals); Trading Block → Trade Market",
				toggle:
					"AI Trade Offers — on for new / off for existing (frequency, expiration 15 days); Trade Market — on / on",
				body: [
					"AI teams send you offers during the season that expire after a while. The Trade Market shows who is buying, who is selling and which players are available.",
				],
			},
			{
				title: "Three-team trades",
				where: "Trade → 3 teams",
				toggle: "Three-Team Trades — on / on",
				body: [
					"Build a trade with two other teams and choose where each asset goes.",
				],
			},
			{
				title: "Draft pick protections and swaps",
				where: 'Trade page: "+ protection/swap" on any pick',
				toggle: CORE,
				body: [
					"Protect first-round picks (top-N, with rolling protections in later years and what happens after) or add pick swaps. Conditions show on Draft Picks and in transactions.",
				],
			},
			{
				title: "Rumors",
				where:
					"Newsroom → Rumors (Transactions tab); dashboard Rumor Mill; newspaper",
				toggle: CORE + " (option: Rumor Notifications)",
				body: [
					"A rumor mill built only from what AI teams are really planning: sellers, salary dumps, trade requests, unhappy stars. Rumors are tracked to see how they turned out.",
				],
			},
			{
				title: "Need-based AI trades and realistic economy",
				toggle: CORE,
				body: [
					"AI-to-AI trades are driven by team needs and must be fair, and AI teams manage cash more realistically.",
				],
			},
		],
	},
	{
		id: "draft",
		title: "Draft & scouting",
		entries: [
			{
				title: "Draft Scouting additions",
				where: "Draft / College → Draft Scouting",
				toggle:
					"College & Overseas Stats — on / on (Generate Pre-Draft Stats Automatically: on for new leagues); Ratings Regenerator — on / on",
				body: [
					"Generate college or overseas stats and honors for each draft class (College stats button); they show on player pages tagged College/Overseas but never count as pro stats. Columns for traits, archetype, comps, scouts' consensus, flags and AgeProd. The ratings regenerator can reroll a class's builds.",
				],
			},
			{
				title: "College/Overseas season and March Madness",
				where:
					"Draft Scouting → College/Overseas (standings, AP poll, conferences, selection, NCAA, NIT, overseas)",
				toggle: CORE,
				body: [
					"Each draft class plays a light college season with polls and a tournament, and every prospect gets a pre-draft page with teams, stats, recruiting rank, draft stock, injuries, transfers, redshirts, overseas and pathway careers.",
				],
			},
			{
				title: "Scouting system and fog of war",
				toggle: CORE,
				body: [
					"What you see of prospects is what your scouts see: ratings, potential, archetypes and comps are fuzzed, and get sharper with scouting budget and looks.",
				],
			},
			{
				title: "Draft Board",
				where: "Draft Scouting → Draft Board; Draft page",
				toggle: "Draft Board — on / on (Auto Draft From My Board: on)",
				body: [
					"Rank prospects, give them tiers and notes. When auto drafting for you, the top available player on your board is picked. Your Scouting Director posts weekly updates you can lock out per player.",
				],
			},
			{
				title: "Mock Draft, class shapes and real comps",
				where: 'Draft Scouting → Mock Draft; prospect page "Plays like"',
				toggle: CORE,
				body: [
					"A mock draft of where AI teams will pick. Each class has a shape (typical, deep, top-heavy and more). Prospects get 3 real NBA comps from players' young seasons and what they became (not in college leagues).",
				],
			},
			{
				title: "AI drafting by need and draft-night trades",
				where: "Draft page (Pick value chart, offers)",
				toggle: CORE,
				body: [
					"AI teams draft by board and need, and trade picks on draft night. The pick value chart shows what each pick is worth. With spectator mode or auto play, the AI also picks for your teams.",
				],
			},
			{
				title: "Draft lottery night and combine",
				where: "Draft Lottery (Start lottery night); Draft Scouting → Combine",
				toggle: CORE,
				body: [
					"Reveal the lottery pick by pick. A combine measures invited prospects (chosen by the scouts' consensus) and runs medicals that reveal pre-draft injury history.",
				],
			},
			{
				title: "Draft-and-stash",
				where: "Player page; Roster (Stashed overseas); Trade",
				toggle: CORE + " (not in college leagues)",
				body: [
					"Draft a prospect playing overseas and keep his rights while he stays abroad; bring him over later.",
				],
			},
			{
				title: "Scouting reports, cones and big boards",
				where: "Player dropdown → Scouting; Draft Scouting → Big Boards; PDF",
				toggle: CORE + " (Scouting Summaries on Lists — off)",
				body: [
					"Written scouting reports for any player with comparisons, strengths, weaknesses and a projection cone (floor / median / ceiling). Big Boards shows rankings from several made-up media outlets with their own philosophies.",
				],
			},
			{
				title: "Scouts, Director & regions, consensus, track records",
				where:
					"Draft Scouting → Scouts (Scouting Department), Pro Scouting, Staff Report",
				toggle:
					"Director & regions, consensus & flags always on; Scout Specialties & Assignments — off for new / on for existing",
				body: [
					"Your scouting department has a Director, regional scouts with specialties and careers, and a Pro Scouting desk. Scouts disagree: see the consensus slot, the range and red/green flags. Three seasons after each draft, scouts' calls are graded in track records.",
				],
			},
			{
				title: "Draft History extras",
				where: "Draft History",
				body: [
					"Hall of Fame rate by draft slot, plus Redraft and Pick Value tabs (Extra Frivolities).",
				],
			},
		],
	},
	{
		id: "college",
		title: "College mode",
		entries: [
			{
				title: "Playing a college program",
				where: "New League → College",
				toggle:
					"Set at league creation (league type and level); cannot be changed later",
				body: [
					"Coach a school instead of a pro team. Choose a level (power conferences, major conferences or all of Division I). College rules: two 20-minute halves, 30-second shot clock, 5 fouls, one-and-one bonus. 13 scholarships, and no contracts, trades, free agency or finances.",
					"Recruit high-school prospects (auto recruiting is on by default), lose players to graduation, the pro draft and the transfer portal, and play for conference tournaments, the national tournament and the NIT.",
					"College pages: Top 25 & Selection, Conf. Tournaments, NIT, Recruiting, Transfer Portal, Departures & Arrivals, Coaching Carousel, and the College Hall of Fame.",
				],
			},
			{
				title: "College options",
				toggle:
					"College Quick Sim (by size), College NIT (on), College Realignment (on)",
				body: [
					"Quick sim speeds up games without your team; realignment moves schools between conferences over time.",
				],
			},
		],
	},
	{
		id: "staff",
		title: "Coaching staff",
		entries: [
			{
				title: "Coaching staff",
				where:
					"Team → Coaching Staff; League History → Coaches; a page per coach",
				toggle: CORE,
				body: [
					"Every team has a head coach and assistants with ratings (development, offense, defense, motivation, game prep, player management), a style and a contract. Hire and fire coaches; salaries are coaching expenses. Coaches drive development and the in-game decisions described in Game simulation.",
				],
			},
			{
				title: "Coaching staff depth and coaching trees",
				toggle: CORE,
				body: [
					"More staff jobs (with hiring tabs), coaching careers and coaching trees. Coaches promoted from a mentor's staff carry his systems, and a team familiar with a system installs it faster.",
				],
			},
			{
				title: "Player–coach relationships",
				where: "Player Contract & Mood panel; coach pages",
				toggle: "Player–Coach Relationships — on for new / off for existing",
				body: [
					"Bonds between players and head coaches build over seasons and affect mood, re-signing and development plans.",
				],
			},
			{
				title: "Coach market & succession",
				where: "Coaching Staff (Interest, Interview, Coach market panel)",
				toggle: "Coach Market & Succession — off for new / on for existing",
				body: [
					"Interview up to 3 coaches a season, make salary offers, name an interim or an associate head coach as heir.",
				],
			},
			{
				title: "Staff Report and delegation",
				where: "Team → Staff Report; Draft Scouting tab; dashboard",
				body: [
					"Choose Auto, Suggest or Manual for scouting assignments, development plans, staff hiring and the draft board. The report gives one recommended action per area, a season scorecard and budget recommendations.",
				],
			},
		],
	},
	{
		id: "front-office",
		title: "Front office & finances",
		entries: [
			{
				title: "AI GM personalities",
				where:
					"League History → Front Offices; GM cards on AI team pages; GM profile pages; news",
				toggle: CORE,
				body: [
					"Every AI team has a general manager with leanings (win-now vs patient, picks vs veterans...) that shape trades, signings and drafting. GMs are hired and fired, and GM History shows your record against each one. Exact leaning numbers show only in God Mode.",
				],
			},
			{
				title: "AI GM finance styles",
				toggle: CORE,
				body: [
					"Each AI GM is frugal, balanced or a spender, which drives budgets, ticket prices, tax and projects.",
				],
			},
			{
				title: "Front office budget",
				where:
					"Team → Finances (Front office budget, What your spending bought); Free Agents Proj column",
				toggle: CORE + " (needs the budget setting)",
				body: [
					"Departments (Scouting, Analytics, Medical, Travel & Sports Science, Coaching, Facilities) replace expense levels. Analytics gives projections for players you might acquire; Travel reduces fatigue.",
				],
			},
			{
				title: "Owner's Office",
				where: "Team → Finances; owner messages",
				toggle:
					"Owner's Office — on for new / off for existing (not in college)",
				body: [
					"Every preseason the owner sets goals (payroll ceiling, profit, wins) that feed his mood.",
				],
			},
			{
				title: "Commercial deals & ownership",
				where: "Team → Finances",
				toggle:
					"Commercial Deals & Ownership — on for new / off for existing (revenue sharing 10%, equal or small markets)",
				body: [
					"Sponsorship and local TV deals valued by market, success, stars and facilities, plus revenue sharing.",
				],
			},
		],
	},
	{
		id: "settings",
		title: "Settings & toggles",
		entries: [
			{
				title: "Where the switches live",
				where:
					"Tools → League Settings → League Extras tab; New League → League extras categories",
				body: [
					"Still switchable: Newspaper, Wrapped, Storylines, Games to Watch, Best Games, Award Vote, League Achievements, Trade Grader, Contract Value, Timeline, Records Book, Milestones, Rivalries, Series Recaps, League Eras, Hall of Fame Ballot, Unretirements, Feat Rarity, Season Odds, play-by-play display and storage, Shot Zones, Shot Profiles, Sim-Calibrated Ovr, 2K Badge Effects in Sim, Archetypes, Generation Presets, Trade Requests, Holdouts, League Parity, Trade Explanations, AI Trade Offers, Trade Market, Three-Team Trades, College & Overseas Stats, Ratings Regenerator, Draft Board, Player–Coach Relationships, Coach Market, Scout Specialties, Owner's Office, Commercial Deals, Extra Frivolities, Custom Shot Clock, One-and-One.",
					"Each tab of League Settings saves only its own settings.",
				],
			},
			{
				title: "Removed features",
				body: [
					"Spread Out Matchups, player nicknames and the old extended skill badges were removed (2K Badges replace them).",
				],
			},
			{
				title: "League salt",
				body: [
					'Each new league gets a hidden random salt, so two leagues with the same players no longer repeat the same "random" outcomes.',
				],
			},
			{
				title: "Dark mode",
				body: [
					"Colors used by fork pages (flags, grades, warnings) are adjusted for readable contrast in the dark theme.",
				],
			},
		],
	},
	{
		id: "god-mode",
		title: "God Mode extras",
		entries: [
			{
				title: "Customize Player",
				where: "Player page → Edit",
				body: [
					"Edit expanded ratings, sub-ratings and trait sliders. Regenerate build rerolls a player's ratings shape while keeping ovr, pot and height (preview, pin ratings, reroll). Reset to generated face undoes face edits.",
				],
			},
			{
				title: "Schedule editor",
				body: [
					"Validate schedule panel, Auto-repair 3-in-4s, and regeneration with marquee games.",
				],
			},
			{
				title: "Exact numbers",
				body: [
					"God Mode shows exact numbers where the normal game shows words or bands (AI GM leanings, some counts).",
				],
			},
			{
				title: "Injury rate",
				where: "God Mode → Injuries",
				body: [
					"New basketball leagues start at double the stock injury rate (0.00025); you can change it here.",
				],
			},
		],
	},
	{
		id: "tools",
		title: "Tools & exports",
		entries: [
			{
				title: "CSV downloads",
				where:
					"Download CSV menu at the top right of fork pages; ⋮ menu of tables",
				body: [
					"Every table on fork pages (Draft Board, Records Book, Milestones, Rivalries, Storylines...) can be downloaded as CSV. Exactly what you see is exported, scouting fuzz included.",
				],
			},
			{
				title: "Download players (PDF/JSON/CSV)",
				where:
					"⋮ menu of any player table; Download player button on a player page",
				body: [
					"Export the players a table shows as a multi-page PDF profile (face, ratings, stats, traits, college stats, awards, optional game log; optionally one PDF per player in a zip), JSON or CSV.",
				],
			},
			{
				title: "Game and season data",
				where: "Game Log → Download game data; team pages",
				body: [
					"Download a game's pregame context, team and player context and analytics as a CSV zip, a season data pack, or a team season export.",
				],
			},
			{
				title: "Face Style Gallery",
				where: "Tools → Face Style Gallery (in or out of a league)",
				body: ["See every option of each face part drawn on sample faces."],
			},
			{
				title: "Delete Old Data storage sizes",
				where: "Danger → Delete Old Data",
				body: [
					"Shows how much storage each kind of data uses; long leagues automatically slim old rivalry logs and box scores.",
				],
			},
		],
	},
];
