# Native features

This fork adds a set of pages, tools and game-sim options to Basketball GM. The first group (Newspaper, Wrapped, Storylines, Games to Watch, achievements, Trade Grader, Timeline) used to live in the separate League Explorer app: they are built from the league's own records and run locally in the game's worker. The rest are game features (play-by-play options, a realistic possession model, player traits, injury depth, contracts, trades, drafting, coaching staff, ...).

Most of it is **basketball only**: in Football, Hockey and Baseball GM the menu items and links are hidden and the routes show a short "only available for basketball" message. The exceptions, which work in every sport, are the contract features and the trade features (the code is shared), the Draft Board and the Scouting System.

`:lid` below is the league id, as in `/l/1/...`.

## Feature index

| Feature                                                            | Where                                                            | Sports | Switch (League Extras)      | Default new / existing league |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ------ | --------------------------- | ----------------------------- |
| [Newspaper](#newspaper)                                            | League → Newspaper                                               | bball  | `featureNewspaper`          | on / on                       |
| [Wrapped](#wrapped)                                                | League → Wrapped                                                 | bball  | `featureWrapped`            | on / on                       |
| [Storylines](#storylines)                                          | League → Storylines                                              | bball  | `featureStorylines`         | on / on                       |
| [Games to Watch](#games-to-watch-hype)                             | League → Games to Watch, dashboard, schedules                    | bball  | `featureHype`               | on / on                       |
| [League achievements](#league-achievements)                        | League → League achievements, dashboard                          | bball  | `featureLeagueAchievements` | on / on                       |
| [Trade grader](#trade-grader)                                      | League → Trade Grader, trade summaries                           | bball  | `featureTradeGrader`        | on / on                       |
| [Contract value](#contract-value)                                  | League → Contract Value, player pages                            | bball  | `featureContractValue`      | on / on                       |
| [League timeline](#league-timeline)                                | League → Timeline                                                | bball  | `featureTimeline`           | on / on                       |
| [Unretirements](#unretirements)                                    | background, at the start of free agency                          | bball  | `featureUnretire`           | off / off                     |
| [Play-by-play flavor](#play-by-play)                               | live game                                                        | bball  | `featurePbpFlavor`          | on / on                       |
| [Live play-by-play](#play-by-play)                                 | live game                                                        | bball  | `pbpLiveGame`               | on / on                       |
| [Box score play-by-play](#play-by-play)                            | box scores                                                       | bball  | `featurePbpBoxScore`        | on / on                       |
| [Save play-by-play](#play-by-play)                                 | box scores                                                       | bball  | `storePlayByPlay`           | on / on                       |
| [Technical & flagrant fouls](#game-simulation-options)             | game sim                                                         | bball  | `technicalFouls`            | on / off                      |
| [Realistic possession model](#realistic-possession-model)          | game sim                                                         | bball  | `realisticPossessions`      | on / off                      |
| [Player traits](#player-traits)                                    | player page, Draft Scouting, Advanced Player Search, game sim    | bball  | `playerTraits`              | on / off                      |
| [Injury depth](#injury-depth)                                      | game sim, player page, Roster, Schedule                          | bball  | `injuryDepth`               | on / off                      |
| [Season odds](#season-odds)                                        | Standings, Power Rankings, Award Races, Draft Lottery            | bball  | `featureSeasonOdds`         | on / on                       |
| [Archetypes](#archetypes)                                          | player page, Draft Scouting, search, Roster, League → Archetypes | bball  | `featureArchetypes`         | on / on                       |
| [Extended skill badges](#extended-skill-badges)                    | player tables, player page, Frivolities → Skill Badges           | bball  | `featureSkillBadges`        | on / on                       |
| [Contract options & guarantees](#contracts-mood-and-player-unrest) | negotiation, player page                                         | all    | `contractOptions`           | on / off                      |
| [In-season extensions](#contracts-mood-and-player-unrest)          | player page                                                      | all    | `contractExtensions`        | on / off                      |
| [Trade requests](#contracts-mood-and-player-unrest)                | player pages, trading block                                      | all    | `tradeRequests`             | on / off                      |
| [Holdouts](#contracts-mood-and-player-unrest)                      | before the regular season                                        | all    | `featureHoldouts`           | on / off                      |
| [Trade explanations](#trades)                                      | Trade page ("Why?")                                              | all    | `featureTradeExplain`       | on / on                       |
| [Need-based AI trades](#trades)                                    | AI-to-AI trades                                                  | all    | `aiTradesNeedBased`         | on / off                      |
| [AI trade offers](#trades)                                         | inbox, Trade Proposals                                           | all    | `featureAiTradeOffers`      | on / off                      |
| [Trade market](#trades)                                            | Players → Trade Market                                           | all    | `featureTradeMarket`        | on / on                       |
| [Three-team trades](#trades)                                       | Trade → 3-team trade                                             | all    | `featureThreeTeamTrades`    | on / on                       |
| [Coaching staff](#coaching-staff)                                  | Team → Coaching Staff, League → Coaches                          | bball  | `coachingStaff`             | on / off (existing leagues)   |
| [College & overseas stats](#draft-scouting)                        | Draft Scouting                                                   | bball  | `featureCollegeStats`       | on / on (automatic: on / off) |
| [Ratings regenerator](#draft-scouting)                             | Draft Scouting, Customize Player                                 | bball  | `featureRatingsRegenerator` | on / on                       |
| [Scouting system](#draft-scouting)                                 | Draft Scouting                                                   | all    | `scoutingSystem`            | on / off                      |
| [Draft board](#draft-board-and-ai-drafting)                        | Draft Board, Draft page                                          | all    | `featureDraftBoard`         | on / on                       |
| [AI drafts by need](#draft-board-and-ai-drafting)                  | AI draft picks                                                   | bball  | `featureAiDraftNeeds`       | on / off                      |
| [Extra frivolities](#extra-frivolities)                            | Frivolities                                                      | all    | `featureFrivolities`        | on / on                       |

"Existing leagues" means leagues created before the setting existed (or league files without it): the switches that change how games or AI teams play are off there, so those leagues play exactly as before, and on for new leagues. The display-only features are on everywhere.

## League extras (feature toggles)

- **Where:** Tools → _League Extras_ (`/l/:lid/league_extras`), and the _League extras_ category at the bottom of League Settings (and of the New League form). Same settings in both places.
- **What:** an on/off switch for every feature above, plus the options of some. A feature that is off disappears from the menus, the command palette, _More_ links, history/team/player page links and the dashboard, its pages show "turned off" if opened directly, and its background work stops (no hype computed, no achievement checks, no season odds simulations, no AI offers, no archetype updates, ...).
- **Options** (shown with their feature): hype _on Dashboard_ / _on Schedules and Box Scores_; achievement _Notifications_ / _on Dashboard_; box score play-by-play _Always show_ or _Show on button press_; _Games to Save Play-by-Play For_ (all games, my team's games, none); _Holdout Frequency_; _AI Trade Offers Frequency_; _Generate Pre-Draft Stats Automatically_; _Re-randomize New Draft Classes_; _Auto Draft From My Board_; unretirement chance, minimum age and ovr boost.
- **Sports:** basketball-only switches are hidden in the other sports (Extra Frivolities, the contract features and the trade features show there).

### Settings table

Every setting the features add. "New / existing" is the value for a new league and for a league made before the setting existed. All of these are in League Extras (and League Settings → League extras) unless a row says otherwise.

| Key                                                                                                       | New / existing                                                  | Notes                                                                                                        |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `feature*` (see the index)                                                                                | on / on, except below                                           | one switch per feature                                                                                       |
| `featureUnretire`                                                                                         | off / off                                                       | options `unretireChance` 10%, `unretireMinAge` 35, `unretireBoostMin` 3, `unretireBoostMax` 6                |
| `featureAchievementToasts`, `featureAchievementsDashboard`, `featureHypeDashboard`, `featureHypeSchedule` | on / on                                                         | options of Achievements and Games to Watch                                                                   |
| `pbpLiveGame`                                                                                             | on / on                                                         | live feed in the live game view                                                                              |
| `featurePbpBoxScore` + `pbpBoxScore`                                                                      | on / on; `always` / `always`                                    | box score play-by-play tab or button                                                                         |
| `storePlayByPlay` + `pbpStore`                                                                            | on / on; `all` / `all`                                          | `storePlayByPlay` off means no game keeps its play-by-play (old leagues); `pbpStore` is the scope            |
| `technicalFouls`                                                                                          | on / off                                                        |                                                                                                              |
| `realisticPossessions`                                                                                    | on / off                                                        |                                                                                                              |
| `playerTraits`, `playerTraitsSeed`                                                                        | on / off; seed random / 0                                       | the seed is set once at league creation                                                                      |
| `injuryDepth`                                                                                             | on / off                                                        |                                                                                                              |
| `contractOptions`, `contractExtensions`, `tradeRequests`                                                  | on / off                                                        |                                                                                                              |
| `featureHoldouts` + `holdoutFrequency`                                                                    | on / off; 1 / 1                                                 | frequency scales how often holdouts happen                                                                   |
| `aiTradesNeedBased`                                                                                       | on / off                                                        | the classic random AI-to-AI trades stay on in every league (_AI-to-AI Trades Factor_ in the Events category) |
| `featureAiTradeOffers` + `aiTradeOffersFrequency`                                                         | on / off; 1 / 1                                                 | offers per 10 games, 0 means none                                                                            |
| `coachingStaff`                                                                                           | on / off (existing leagues were migrated to off, DB version 76) | turning it on in an existing league generates staffs                                                         |
| `generateCollegeStats`                                                                                    | on / off                                                        | option of College & Overseas Stats                                                                           |
| `rerandomizeDraftClassRatings`                                                                            | off / off                                                       | option of the Ratings Regenerator                                                                            |
| `scoutingSystem`                                                                                          | on / off                                                        |                                                                                                              |
| `draftBoardAutoDraft`                                                                                     | on / on                                                         | option of the Draft Board                                                                                    |
| `featureAiDraftNeeds`                                                                                     | on / off                                                        |                                                                                                              |

### Adding a toggle (for developers)

The registry is `common/nativeFeatures.ts` (root `common/`, so the build tools can use it for the league file schema); game code imports it through `src/common/nativeFeatures.ts`. Add **one entry** to `NATIVE_FEATURES`:

```ts
{
	id: "myFeature", // used in code
	key: "featureMyFeature", // game attribute holding the switch
	name: "My Feature",
	description: "One line for the settings form.",
	default: true, // existing leagues (missing attribute)
	defaultNewLeague: true, // optional, if new leagues should differ from existing ones
	sports: BBGM, // omit for every sport
	existing: true, // optional: the key is a game attribute declared elsewhere (type, default, schema), so only its form entry comes from here
	options: [ // optional
		{ key: "myFeatureSomething", name: "…", description: "…", type: "bool" | "int" | "float" | "string", default: …, min?, max?, values?: [{ key, value }] /* for string */, decoration?: "percent", existing?: true },
	],
},
```

That entry alone gives: the `GameAttributesLeague` types, `defaultGameAttributes`, the new league defaults, the league file JSON schema, the settings form entries (League extras category and page), the settings view values, the UI sync (local state) and the sport filtering. For an `existing` key you still declare it in `types.ts`/`defaultGameAttributes.ts`, and add its explicit new league default in `worker/views/newLeague.ts` (`getDefaultSettings`). Then gate the feature's code with:

- Worker: `featureOn("myFeature")`, `featureOption("myFeatureSomething")`, and for a page's view `const off = featureOffError("myFeature"); if (off) return off;` (`src/worker/util/nativeFeatures.ts`).
- UI: `useFeatureOn("myFeature")` / `useFeatureOption(...)` in components, `isFeatureOn(...)` in plain functions (`src/ui/util/nativeFeatures.ts`); menu items take `feature: "myFeature"`; for links to the feature's pages add the URL to `featureForUrl` so `MoreLinks` and `FeatureLinks` drop them automatically.

Tests in `src/common/nativeFeatures.test.ts` check that every key has a default and is synced to the UI.

## Pages built from the league's records

### Newspaper

- **Where:** League menu → _Newspaper_, `/l/:lid/newspaper`, `/l/:lid/newspaper/:team/:season` (`all` or a team like `ATL_0`). Also linked from the dashboard ("From the records"), the team pages' _More_ links (team edition), League → History and each season row of Team History.
- **What:** a front page plus sections (Playoffs, Awards, Teams, Players, Features, Transactions, By the numbers, Opinion, Colour & letters) written from the season's results, awards, transactions and box scores. During a season it reports "so far"; after the playoffs it becomes the final edition. A team edition focuses on one franchise. Back issues link to earlier seasons. _Print edition_ gives a print-friendly layout.
- **Known limits:** pull quotes and letters marked _Colour_ are invented voices (the numbers are real). Player photos load lazily as you scroll. Very old seasons with deleted box scores get fewer game stories.

### Wrapped

- **Where:** League menu → _Wrapped_, `/l/:lid/wrapped` (chooser), `/l/:lid/wrapped/season/:season`, `/l/:lid/wrapped/team/:season/:team`, `/l/:lid/wrapped/player/:season/:pid`, `/l/:lid/wrapped/all`, and `/l/:lid/wrapped/compare` (two players, teams or seasons side by side). Linked from team, player and history pages.
- **What:** a tap-through story deck (9:16 cards) of a season, a team's year, a player's year or the whole league's history. Arrow keys, the on-card buttons, tapping the left/right of the card or swiping move between slides. Each slide can be saved or copied as a 1080×1920 PNG.
- **Deck settings** (gear icon on the card, remembered per browser): number of slides, autoplay, **quiz** (a few "who led the league in…" questions mixed into the deck, with a score slide; on by default) and **no spoilers** (hides results that would give away the season's outcome).
- **Compare:** a scoreboard of the main numbers (the better value is bold with ▸), the topics both have with a winner per topic, and the slides only one side has.
- **Known limits:** the first visit to a big league builds a snapshot of the whole history, which can take a while (a progress placeholder shows; later visits use a cache, see _Performance_). Autoplay waits on an unanswered quiz question. A season that isn't over yet gets a "so far" deck without awards or playoffs.

### Storylines

- **Where:** League menu → _Storylines_, `/l/:lid/storylines`, `/l/:lid/storylines/team/:team[/:season]`, `/l/:lid/storylines/player/:pid`, `/l/:lid/storylines/all/all/:season`. _Wrapped_ and _Storylines_ buttons are on each player page; team pages and history pages link here too.
- **What:** story cards found in the league's history (Cinderella runs, upsets, droughts, dynasties, big triple-doubles, ageless wonders, ring chasers, homecomings, stacked draft classes and more), each with a _Why this story?_ button that shows the numbers behind it. The _Threads_ tab groups stories that belong together. Filter by season, kind and order, or search.
- **Known limits:** shares the Wrapped snapshot, so the first visit to a big league can take a while. Stories need history: a new league has only a handful.

### Games to Watch (hype)

- **Where:** League menu → _Games to Watch_, `/l/:lid/hype`; a _Games to Watch_ card on the league dashboard; a hype badge and reasons under games on Schedule and Daily Schedule; a hype card above box scores.
- **What:** a 0–100 must-watch score for upcoming games from what's known before tip-off (standings and playoff races, series stakes, rivalries, star power, milestones, streaks, record chases, revenge games, rookie duels). Finished games show whether they lived up to it ("Did it live up to it?"). _Record chases_ lists players close to league or franchise records.
- **Known limits:** record chases need a few seasons of history. Schedule badges are only computed for the next 8 games.

### League achievements

- **Where:** League menu → _League achievements_, `/l/:lid/league_achievements`; a _Recent achievements_ card on the dashboard; unlocks are announced as notifications.
- **Rarity:** measured on simulated random-players BBGM leagues, not on real NBA history (BBGM sims are far more generous): common more than 0.6 times a season, rare 0.15–0.6, legendary 0.025–0.15, impossible rarer. No tier that any calibration league unlocked in its first 5 seasons is impossible. The data is `src/common/leagueAchievements/calibration.generated.ts`; regenerate it with `tools/leagueAchievementsCalibration/` (`sim.cjs` sims leagues in a headless browser against the dev server and records the tally every season, `calibrate.ts` turns the outputs into bands; see the file headers).
- **Saved state:** which tiers were already announced, and the log, are kept in the league (the `leagueAchievements` game attribute), so exporting and importing a league carries them. Older versions kept them in a separate `league-achievements` database: it is read once per league and moved in.

### Trade grader

- **Where:** League menu → _Trade Grader_, `/l/:lid/trade_grader[/:tab/:team/:season/:ws]`; grades also show on Trade Summary and the transactions list.
- **What:** each side of every trade graded by the win shares what it received produced for it. A toggle counts **regular season + playoffs** (default, `ws` = `all`) or **regular season only** (`rs`); Trade Summary follows the last choice made on the grader (per browser). Each side notes the titles its team won with a player it received playing for it in those playoffs.

### Contract value

League menu → _Contract Value_: a value index, bargains and albatrosses, and the value index shown on player salaries.

### League timeline

- **Where:** League menu → _Timeline_, `/l/:lid/timeline[/:from[/:to]]`; linked from the dashboard ("From the records") and from each season row of League → History.
- **What:** season by season (newest first): champions (with the finals result), MVPs and Finals MVPs, the newspaper's front page lead, the top 3 storylines, league achievements unlocked, records (best/worst regular season record in league history so far, single-game scoring records), the 3 biggest trades (by the trade event's importance) and comebacks. Every entry links to its source page (playoffs, player, newspaper edition, storylines season, achievement, box score, trade summary). Filters: season range (navigates), kinds (remembered per browser), team and a text search.
- **Known limits:** headlines are computed for at most the 25 latest seasons of the range (finished seasons are cached in memory). Entries from Newspaper, Storylines and League Achievements are left out while those features are off (the page says which). Storylines need the Wrapped snapshot: on a first visit they appear when it's ready. Achievements come from the saved unlock log, so ones unlocked before achievements were tracked in the league don't show.

### Unretirements

- **What:** the old console script `tools/console-scripts/unretire.js`, built in (off by default). Once a season, when free agency starts, with the chosen chance (default 10%), one random retired player who retired at the minimum age or older (default 35) comes back as a free agent with a fresh ratings row for the season, boosted by a random 3-6 ovr (settings) by raising his non-height ratings one point at a time, favouring his strengths. Dead players, and anyone who already came back (including through the script), are skipped. A news event ("… has come out of retirement and is now a free agent") is logged and shown, and the comeback appears on the timeline.
- **Code:** `src/worker/core/phase/unretire.ts`, called from `phase/finalize.ts`.

### Extra frivolities

Redraft, Draft Pick Value, Jersey Numbers by Team, Family Trees, League Economics and Home Court (the ones available in the sport). One switch hides the lot.

## Game simulation

### Play-by-play

- **Flavor (live game view):** varied, ratings-aware wording for every play (shot types, passes, fouls with personal and team foul counts, bonus situations, runs, milestones, quarter summaries). It only changes the text: game results are identical with or without it (covered by `outcomeInvariance.test.ts`). Elam ending events and shootout lines keep the original wording; clock phrases follow the league's quarter length and number of periods, and shootout lines are seeded like the rest, so a replay reads the same.
- **Live play-by-play** (`pbpLiveGame`): show the feed when watching a game live. When off, the score, clock and box score still update.
- **Box score play-by-play** (`featurePbpBoxScore`, option `pbpBoxScore`): _Always show_ the play-by-play as a box score tab, or _Show on button press_ (the text is only made after pressing _Show play-by-play_, remembered per game for the browser session). When the switch is off, box scores have no play-by-play at all.
- **Save play-by-play** (`storePlayByPlay`, option `pbpStore`): which games keep their play-by-play with the box score: _All games_, _My team's games only_, _None_. About 7 KB per game, deleted with the box score. `storePlayByPlay` off (the old on/off setting) still means _None_ and is kept in step with the scope by `setGameAttributes`. Helpers and tests: `src/common/pbpSettings.ts`.
- **The sim never depends on any of it:** the same seeded game gives the same box score with logging off, stored and live (tests in `outcomeInvariance.test.ts` and `playerTraitsSim.test.ts`).
- **Known limits:** the wording assumes 12-minute quarters for some clock-based phrases.

### Game simulation options

- **Technical & flagrant fouls** (`technicalFouls`): rare technical fouls (1 FT, possession unchanged), flagrant fouls (2 FTs and the ball) and ejections.

### Realistic possession model

`realisticPossessions`. Possessions play out like in the NBA: a 24-second shot clock (14 after an offensive rebound), fast breaks and half-court possessions, late-clock shots and shot-clock violations, holding for the last shot, 2-for-1s, and intentional fouling late in games. Box score averages stay about the same (`possessionMetrics.ts` prints a before/after table: `POSS_METRICS=1`). Code: `src/worker/core/GameSim.basketball/possessionModel.ts`. Every random number it draws is drawn only when the setting is on. Player traits feed its shot discipline and consistency hooks (see below).

### Player traits

- **Where:** player pages (Traits section), Draft Scouting (Traits column), Advanced Player Search (Traits filters and columns), Customize Player in God Mode (trait sliders), and the game sim.
- **What:** twelve 0-100 traits (clutch, consistency, durability, shot discipline, off-ball movement, screens, hustle, foul discipline, recovery, handle under pressure, late-game IQ, leadership) derived from ratings, age, experience and a stored per-player random component. Prospects' traits are estimates that sharpen with scouting and with seasons played. In the game sim they nudge shots, turnovers, fouls, steals, free throws, fatigue recovery, team synergy, end-of-game decisions and injuries by small amounts that average out league-wide (10,000-game table in `docs/player-traits.md`). With the setting off the sim is byte-for-byte what it was.
- **Details:** `docs/player-traits.md` (data model, hook table, how the sim applies each hook, calibration).

### Injury depth

- **Setting:** `injuryDepth`. On for new leagues, off for existing leagues (they play exactly as before).
- **What:**
  - **Minutes restriction on return:** after an injury of 5+ games, a player comes back on a restriction for about a third as many days (2–10), starting at ~55% of his normal playing-time weight and easing back to 100%. It goes through the same knob as the roster page's playing time setting, so the rotation code respects it.
  - **Re-injury risk:** for 15 days after any injury of 2+ games the injury risk is higher (up to 1.8×, fading), and a new injury has a 45% chance to be to the same body part.
  - **Injury-prone players:** about 7% of players (fixed per player), plus anyone with 5+ injuries of 3+ games in the last three seasons, get hurt 1.4× as often. Shown as a badge on the player page.
  - **Back-to-backs:** the second night of a back-to-back (regular season) has 1.15× injury risk and slightly lower endurance (more fatigue in the game). Marked **B2B** on Schedule and Daily Schedule.
  - **Load management:** on the second night of a back-to-back, AI teams rest veterans in their top 8 (34+, or 31+ and injury prone) when they have at least 10 healthy players. For your team, turn it on for the whole team on the Roster page (below Play Through Injuries) or for single players on their player pages.
  - Everyone's base rate is scaled by 0.9 so league-wide totals stay about the same.
- **Player page:** the Injuries section adds a body-part history (injuries, games missed, last season) and, with the setting on, the restriction / recently returned / injury-prone status and the load management checkbox.
- **Known limits:** the countdowns are per day (like BBGM's injury countdown), not per game played. Resting is decided when the teams are loaded, so a rested player shows as not playing in the box score. With player traits on, a player's durability trait multiplies his injury rate on top of this.

### Season odds

- **Where:** _Standings_ (a _Season odds_ section below the tables), _Power Rankings_ (Playoffs and Title columns), _Award Races_ (a Win% column), _Draft Lottery_ (a _What-if simulator_ below the lottery table).
- **What:** 1,000 Monte Carlo simulations of the rest of the season in the worker: each remaining game is decided from team strength (team rating from the current roster, ignoring injuries of 10 days or less, blended with point margin as games are played) plus home court, playoffs are seeded with the game's own playoff code, then the play-in and the bracket are played out. Gives projected record, playoff and play-in odds, seed distribution, reaching the semifinals/finals and title odds. During the playoffs it plays out the remaining series from the current state. Results are cached and refreshed after each day of games, trades, signings or injuries (about 0.2 s per refresh), and only when a page that shows them asks.
- **Award races:** each candidate's award score (BBGM's award scoring) is projected to the end of the regular season with noise that shrinks as the season goes on, and the winner drawn 5,000 times.
- **Lottery what-if:** move teams up or down the lottery order (chances stay with the slot) or pick another lottery format, then _Run lottery_ for exact odds (where fast enough), a 20,000-lottery simulation (hover a cell) and one sample draw.
- **Known limits:** current season only. Tiebreakers are approximated (random among tied teams) and playoff reseeding is ignored. Award odds only consider the top 10 candidates shown and don't model team record changes. The what-if ignores nba2027 restrictions and COLA when switching formats; in the other sports (no Season Odds there) it goes with the _Extra frivolities_ switch.

## Players

### Archetypes

- **What:** a 2K-style archetype for every basketball player (119 of them: Floor General, Sharpshooter, 3-and-D Wing, Stretch Four, Rim Protector, Point Center, ... plus rare "unicorn" types), **derived from his actual ratings**, with an optional hybrid partner ("Slasher / Playmaker"), a tier by overall within the league, a confidence and a "why" (the three ratings groups that fit best). Engine: `src/common/archetypes/` (profile scoring over BBGM's composite ratings, height gates, signature skills, league percentiles).
- **Stored per preseason:** the label is saved on the player (`p.archetypes`, one entry per season) when the preseason phase begins, after development, so it holds all season and his history of changes is kept (it travels in league files). New leagues get a first entry for everyone; older leagues and players without an entry fall back to a live reading (stored the first time the player page is opened). Prospects are always read live, since their ratings can be regenerated. With the switch off nothing is stored or computed.
- **Where:** the player page (_Archetype_ line with a why popover and career history, replacing _Build_), Draft Scouting (_Archetype_ column), Advanced Player Search (_Archetype_ filter), the roster page (_Roster composition_ panel with balance warnings) and League → _Archetypes_ (`/l/:lid/archetypes`: counts, best players, trends).
- **Regenerate ratings:** prospects can be aimed at an archetype (per prospect, or a class pool). It uses the same solver, so overall, potential and height stay exact; the preview shows the archetype the new ratings actually derive to (a check mark when it is the one asked for). The 447 builds are still available under _Advanced: build_.
- **Known limits:** archetypes use scouting-fuzzed ratings (like skills and positions), so they can differ slightly from the true ones; aiming at a very specific archetype succeeds about four times in five at a given overall.

### Extended skill badges

- **Where:** badges after the original skills in player tables (roster, player ratings, player stats, free agents, draft, draft scouting, trade, trading block, watch list, upcoming free agents, advanced search), the player page header and ratings table. Legend and leaders: Frivolities, Player Rankings, _Skill Badges_ (`/l/:lid/frivolities/skill_badges[/:badge]`).
- **What:** 25 extra badges computed from current (fuzzed) ratings: 20 positive (Cs catch-and-shoot, Pu off-dribble, Mr mid-range, FT free-throw ace, Fn rim finisher, Dk dunker, Tr transition, FG floor general, Cn connector, Sf ball-secure, Fd foul drawer, St pickpocket, Bk shot blocker, Sw switchable, Pa point-of-attack, Or offensive glass, Ph physical, Af athletic freak, Fit iron lungs, Hi high IQ) and 5 dashed warning flags (Ld liability defender, Pb poor-shooting big, To turnover-prone, Fp foul-prone, Hk hack-a target). Hover for the meaning and threshold. Each is roughly 15-40 players per 30-team league.
- **Display-only:** not stored in `ratings.skills`, never used by the sim. The pure code is in `src/common/skillBadges/` (definitions, `getSkillBadges`, `badgeScore`).
- **Settings:** _Extended skill badges_ (Off / Compact: up to 3 then +N / All) on the Skill Badges page, stored in this browser; default Compact. Advanced Player Search: Bio field _Badges_ with "contains" (e.g. `Bk`).
- **Known limits:** cutoffs were calibrated on generated leagues. Clutch and injury-proneness are skipped (not derivable from ratings; the player traits cover them).

### Player, team and history pages

- Player pages: college rows (tagged _College_) in the stats tables, an _Earlier honors_ box, _Wrapped_ and _Storylines_ buttons, the _Archetype_ line, the _Traits_ section, badges and the _Contract & Mood_ panel.
- Team pages (_More_ links), League → History, History (all seasons) and Team History rows link to the Newspaper, Wrapped and Storylines for that team/season.

## Contracts, mood and player unrest

Unlike most of the pages above, these work in every sport. Switches are in League Extras; on for new leagues, off for existing leagues until turned on.

- **Options and partial guarantees** (_Contract Options & Guarantees_): the negotiation window has _Option_ (player option −5%, team option +10%) and _Guaranteed after year 1_ (100/75/50/0%, up to +20%) pickers for contracts of 2+ years. AI teams put terms in some of their deals too. Options are decided at the start of the re-signing phase: players opt out when the market pays more (or they're unhappy and wouldn't lose much), teams keep a team option if the player is worth about what he'd be paid. A declined option makes the contract expire then, so the player can be re-signed like any expiring contract. You can exercise or decline your own team option early from the player page. Releasing a player only owes the guaranteed part of seasons after the current one, and not an undecided team option. Contracts show a _PO_/_TO_/_%G_ badge next to the expiration year.
- **Extensions** (_In-Season Contract Extensions_): players in the last 2 seasons of their contracts can be extended in the preseason and regular season, from _Negotiate extension_ on the player page. The new seasons are added after the current ones, so this season's payroll doesn't change. Willingness comes from mood. AI teams extend some good players in their final season. Extensions can be undone like signings.
- **Mood transparency** (always on): the player page _Contract & Mood_ panel shows contract seasons with guaranteed amounts and options, release cost, a _What would make him re-sign?_ table (projected willingness if the team wins, after a deep playoff run, with a bigger role, with no more trades, or all of these), and mood history with sparklines. Mood is snapshotted at the trade deadline, at the end of the regular season and after the playoffs (up to 30 per player, in `p.moodHistory`).
- **Free agent market** (always on): the Free Agents page _Market_ column shows how many AI teams are interested and the chance he signs elsewhere on the next day; click it for each team's interest (top target, next in line, fallback), the per-day chance and the most likely team. This mirrors how AI teams sign free agents (each day, a team that doesn't skip signs the best player it can fit).
- **Trade requests** (_Trade Requests_): very unhappy stars (top 15% by value) can ask to be traded, checked about weekly in the regular season. It's in the news, AI teams value him 15% lower when trading him away, and the trading block shows a _Trade request_ badge. Requests end when he's traded, extended, or happy again.
- **Holdouts** (_Holdouts_, option _Holdout Frequency_, 0 for none): before the regular season, unhappy players paid well under their market value with 2+ seasons left may hold out, missing a few games (scaled to season length). An extension or a trade ends it early; holdouts also end with the regular season.
- **Data:** contracts gain optional `option`, `guaranteed` and `extensions`; players gain optional `moodHistory`, `tradeRequest` and `holdout`. Nothing needs migrating.
- **Known limits:** what-if projections hold everything else fixed. Market odds are for the next day only and assume teams keep their current needs. Holdout players sit out like injured players.

## Trades

Unlike most of the pages above, these work in **all sports** (the trade code is shared).

- **Why the AI said no** (_Trade Explanations_): on the Trade page, when the AI rejects a proposal or answers _What would make this deal work?_ with a counter, a _Why?_ link under the GM's message lists, per asset, the terms the AI used: talent level, age and strategy (rebuilding teams value youth and picks more, contenders discount potential), contract (overpaid/bargain/expiring; rebuilding teams weigh contracts more), injuries, projected pick position, plus team-level terms: strategy, roster fit (team ovr before → after) and payroll/cap space. Built from `ValueChangeCalculator.explain()`, the same math the AI decides with.
- **Need-driven AI-to-AI trades** (_Need-Based AI-to-AI Trades_): contenders buy veterans in the run-up to the trade deadline, rebuilding teams sell veterans for picks and young players, and teams paying luxury tax dump contracts into teams with cap space (with draft picks as sweeteners). Over-the-cap buyers send back salary filler. The reason is shown in the trade's transaction text. Off gives the classic random trades only; _AI-to-AI Trades Factor_ still sets the overall number of attempts.
- **AI offers to you** (_AI Trade Offers To You_, option _AI Trade Offers Frequency_): during the regular season AI teams send offers for players on your trading block, or players that fit their strategy. They arrive as an inbox message and a notification and are listed at the top of _Trade Proposals_ (_Negotiate_ loads one into the Trade page, _×_ dismisses it). Offers expire after 15 of your games or when an asset moves. No offers when AI trades are off (factor 0), in spectator mode, auto play or the no-trades challenge.
- **Trade Market** (_Trade Market_): _Players → Trade Market_, `/l/:lid/trade_market`, linked from the Trade page, Trade Proposals and the "trade deadline is coming" notification (a week before the deadline). Lists players each AI team is willing to move (0–100, from strategy, age, contract and role on the team, with reasons) and an asking-price hint relative to the team's own next first round pick.
- **Three-team trades** (_Three-Team Trades_): `/l/:lid/trade_three/:tid1-:tid2`, linked from the Trade page (_3-team trade_). Send any player or pick from any team to any other team. Each AI team must like what it gets (with the same _Why?_ explanations) and the salary cap rules apply to each team's total incoming and outgoing salary; during the season rosters can't go over the maximum. An accepted trade is recorded as one regular trade event per pair of teams that exchanged something, each noting it was part of a three-team trade, so trade summaries and transactions work as usual. Undo is supported. The regular 2-team Trade page is unchanged.

## Draft and scouting

### Draft Scouting

- **Where:** _Players → Draft → Draft Scouting_ (`/l/:lid/draft_scouting`).
- **College and overseas stats** (_College & Overseas Stats_): the _College stats_ button above each draft class generates college (or overseas pro club) stats and honors for its prospects from a seed (same seed, same result), or regenerates/removes them. They show on the player page with a _College_ or _Overseas_ tag in the stats tables and an _Earlier honors_ box, and are **not** pro stats: they don't count toward experience, career totals, awards, Hall of Fame or player value. The option _Generate Pre-Draft Stats Automatically_ does it for every new draft class (all classes at league creation, each season's new class, fantasy/expansion/custom classes, and imported prospects who have none). _All draft classes_ panel: the same for every upcoming class at once (seed, only prospects without stats or replace everyone's).
- **Regenerate ratings** (_Ratings Regenerator_): rebuilds prospects into specialized builds or archetypes (Floor General, Stretch Big, Rim Protector, …) without changing overall, potential or height. Scope: whole class, selected prospects, one prospect, or all classes at once (a preview summary per class, one _Undo last apply_ for all of them, and _Restore originals_). Settings include seed, variation, class flavor and strength, builds per class, archetype diversity, specialization and rookie caps, each lockable; per-player reroll and rating locks; preview with diffs; _Apply_, _Undo last apply_ (until reload) and _Restore originals_ (survives reloads). _Save as league default_ keeps the settings for _Re-randomize New Draft Classes_ (option; ratings first, then pre-draft stats; seeded from the league and class year; drafted players are never touched).
- **Scouting system** (_Scouting System_): your scouting budget gives you scouting points every season to spend on individual prospects: assign a scout (1 point) or attend a workout (3 points) in the _Scout report_ column. Each narrows how far off your view of that prospect's ratings can be and gives a scout report with ovr and pot ranges, a confidence and notes. Prospects you don't scout keep the normal rating fuzz.
- **Columns:** _Archetype_ (with the Archetypes switch), _Traits_ (with player traits), badges.

### Draft board and AI drafting

- **Draft Board** (_Draft Board_): `/l/:lid/draft_board[/:season]`, linked from Draft Scouting and the Draft page. Rank your prospects, give them tiers and notes next to their pre-draft stats, builds and scout reports. Option _Auto Draft From My Board_: when auto drafting for you, the top-ranked available prospect on your board is picked. The Draft page also has a _Draft-day trades & team boards_ window (trades through the trade API, each AI team's needs and board).
- **AI drafts by need** (_AI Drafts by Need_, basketball): AI picks get a small need (guard, wing, big) and strategy (contenders want players who are ready, rebuilding teams want ceiling) adjustment on top of value, at most about 2 value points (`draftNeeds.ts`; value still decides most picks). Off: the old pure-value drafting.

### Customize Player: Regenerate build

- **Where:** a player page → _Edit_ (`/l/:lid/customize_player/:pid`), _Regenerate build_ button (opens a dialog).
- **What:** the same build engine for one existing player: preview, pin ratings, reroll; keeps ovr, pot and height.

## Coaching staff

- **Where:** Team menu → _Coaching Staff_ (`/l/:lid/staff`, `/l/:lid/staff/:team`), League menu → _Coaches_ (`/l/:lid/coaches[/:season]`: head coaches, the season's coaching carousel, Coach of the Year history), and a page per coach (`/l/:lid/coach/:cid`). Team Finances links to the staff instead of offering the coaching slider.
- **What:** every team has a head coach and three assistants (player development, offense, defense) with ratings (development, offense, defense, motivation), a style (pace, threes, defense, rotation, each -1 to 1), age and a contract. Salaries are paid as coaching expenses (not against the salary cap). The staff's development score is turned into an equivalent coaching budget level, so it replaces the coaching budget's effect on progs, calibrated so the league average matches the default budget (see `staff.test.ts`). After the playoffs each season: records are written to each coach, Coach of the Year is awarded, coaches age/improve/retire, contracts expire, AI teams fire (losing head coaches especially) and hire from the pool (bigger markets pay more). Your expiring coaches leave unless you _Extend_ them; firing pays half the remaining contract as a buyout. Any vacancy still open in the preseason is filled automatically.
- **Setting:** `coachingStaff` (basketball only). On by default for new leagues; existing leagues (DB version 76 migration) and league files from before version 76 keep the slider until it's turned on, which generates staffs.
- **Storage:** `coaches` object store (key `cid`, index `tid`), included in league export under _All team data_.
- **For other features:** `src/worker/core/staff/data.ts` has `getTeamCoachStyle(tid)` (for team strategy / game sim later), `getCoachingCarousel(season)`, `getHeadCoachForSeason(tid, season)` and `getCoachAwards(type)`.
- **Known limits:** no in-game effects yet (style is exposed only). Scouts and trainers are not modeled. With the budget disabled, every team gets the average development effect, as with the slider. Mid-season hires get the whole season's record.

## Known limits (all features)

- Basketball only unless a section says otherwise; the other sports hide the menu items and links.
- The Wrapped, Storylines and Timeline pages share a whole-history snapshot that takes a while the first time in a big league.
- The league-wide averages with player traits, the possession model or injury depth on stay about the same as with them off, but individual games and seasons are of course different; use the switches (off) to replay the old behaviour.
- Existing leagues keep playing as before until the game-affecting switches (possession model, traits, injury depth, contracts, trades, drafting, coaching staff) are turned on in League Extras. Games already played replay unchanged.
- Draft board and scouting need prospects: the Draft Board is empty in a league without upcoming classes.

## Performance

Wrapped and Storylines read the whole league into a snapshot. Converted pieces that can't change any more (retired players, finished seasons' box scores and team seasons) are cached in a separate IndexedDB database (`wrapped-cache`), versioned by the converter code and invalidated through the league's change log, so later sessions only read what changed. Idle snapshots are evicted from memory. `tools/perf/wrapped/` holds the Playwright benchmark scripts (see the header of `bench.cjs`).

## Testing

- Unit tests: `node_modules/.bin/vitest --run --project basketball` (plus `football` and `baseball`, which must stay green since the features are gated).
- Sim calibration tables (not part of the normal run): possession model `POSS_METRICS=1`, player traits `TRAITS_METRICS=1` (see the test files' headers).
- Lint: `node_modules/.bin/eslint .` and `node_modules/.bin/tsc --build`.
