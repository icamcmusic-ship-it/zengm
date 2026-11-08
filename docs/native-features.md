# Native features (ported from BBGM League Explorer)

This fork adds a set of pages and tools to Basketball GM that used to live in the separate League Explorer app. Everything is built from the league's own records, runs locally in the game's worker, and is **basketball only**: in Football, Hockey and Baseball GM the menu items and links are hidden, and the routes show a short "only available for basketball" message.

`:lid` below is the league id, as in `/l/1/...`.

## League extras (feature toggles)

- **Where:** Tools → _League Extras_ (`/l/:lid/league_extras`), and the _League extras_ category at the bottom of League Settings. Same settings in both places.
- **What:** an on/off switch for every native feature, plus a few key options. A feature that is off disappears from the menus, the command palette, _More_ links, history/team/player page links and the dashboard, its pages show "turned off" if opened directly, and its background work stops:

| Switch                         | Off means                                                                                            | Options                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Newspaper                      | no newspaper pages or links                                                                          |                                                            |
| Wrapped                        | no Wrapped pages, buttons or links                                                                   |                                                            |
| Storylines                     | no Storylines pages, buttons or links; not on the timeline                                           |                                                            |
| Games to Watch                 | no hype computed anywhere (page, dashboard, schedules, box scores)                                   | _on Dashboard_, _on Schedules and Box Scores_              |
| League Achievements            | no achievement checks after games/phases, no page, no dashboard card                                 | _Notifications_ (toasts), _on Dashboard_                   |
| Trade Grader                   | no grades on transactions / trade summaries, no page                                                 |                                                            |
| Contract Value                 | no value index on player pages, no page                                                              |                                                            |
| Play-by-Play Flavor            | the live game uses BBGM's original wording                                                           |                                                            |
| Save Play-by-Play              | box scores don't store play-by-play (existing `storePlayByPlay` setting)                             |                                                            |
| Technical & Flagrant Fouls     | none in the sim (existing `technicalFouls` setting)                                                  |                                                            |
| College Stats                  | no _College stats_ button in Draft Scouting                                                          | _Generate automatically_ (existing `generateCollegeStats`) |
| Ratings Regenerator            | no _Regenerate ratings_ (Draft Scouting) or _Regenerate build_ (Customize Player)                    |                                                            |
| Extra Frivolities              | Redraft, Draft Pick Value, Jersey Numbers by Team, Family Trees, League Economics, Home Court hidden |                                                            |
| League Timeline                | no timeline page or links                                                                            |                                                            |
| Unretirements (off by default) | see below                                                                                            | chance, min retirement age, min/max ovr boost              |

- **Defaults:** every switch is on (so existing leagues keep what they had), except Unretirements. Technical fouls keep their old defaults (off for existing leagues, on for new ones).
- **Sports:** basketball-only switches are hidden in the other sports (Extra Frivolities shows there, for the pages that exist in that sport).

### Adding a toggle (for developers)

The registry is `common/nativeFeatures.ts` (root `common/`, so the build tools can use it for the league file schema); game code imports it through `src/common/nativeFeatures.ts`. Add **one entry** to `NATIVE_FEATURES`:

```ts
{
	id: "myFeature", // used in code
	key: "featureMyFeature", // game attribute holding the switch
	name: "My Feature",
	description: "One line for the settings form.",
	default: true, // existing leagues (missing attribute) and new leagues
	// defaultNewLeague: false, // optional, if new leagues should differ
	sports: BBGM, // omit for every sport
	// existing: true, // the key is already a game attribute declared elsewhere
	options: [ // optional
		{ key: "myFeatureSomething", name: "…", description: "…", type: "bool" | "int" | "float", default: …, min?, max?, decoration?: "percent" },
	],
},
```

That entry alone gives: the `GameAttributesLeague` types, `defaultGameAttributes`, the new league defaults, the league file JSON schema, the settings form entries (League extras category and page), the settings view values, the UI sync (local state) and the sport filtering. Then gate the feature's code with:

- Worker: `featureOn("myFeature")`, `featureOption("myFeatureSomething")`, and for a page's view `const off = featureOffError("myFeature"); if (off) return off;` (`src/worker/util/nativeFeatures.ts`).
- UI: `useFeatureOn("myFeature")` / `useFeatureOption(...)` in components, `isFeatureOn(...)` in plain functions (`src/ui/util/nativeFeatures.ts`); menu items take `feature: "myFeature"`; for links to the feature's pages add the URL to `featureForUrl` so `MoreLinks` and `FeatureLinks` drop them automatically.

Tests in `src/common/nativeFeatures.test.ts` check that every key has a default and is synced to the UI.

## Unretirements

- **Where:** League Extras → _Unretirements_ (off by default).
- **What:** the old console script `tools/console-scripts/unretire.js`, built in. Once a season, when free agency starts, with the chosen chance (default 10%), one random retired player who retired at the minimum age or older (default 35) comes back as a free agent with a fresh ratings row for the season, boosted by a random 3-6 ovr (settings) by raising his non-height ratings one point at a time, favouring his strengths. Dead players, and anyone who already came back (including through the script), are skipped. A news event ("… has come out of retirement and is now a free agent") is logged and shown, and the comeback appears on the timeline.
- **Code:** `src/worker/core/phase/unretire.ts`, called from `phase/finalize.ts`.

## League Timeline

- **Where:** League menu → _Timeline_, `/l/:lid/timeline[/:from[/:to]]`; linked from the dashboard ("From the records") and from each season row of League → History.
- **What:** season by season (newest first): champions (with the finals result), MVPs and Finals MVPs, the newspaper's front page lead, the top 3 storylines, league achievements unlocked, records (best/worst regular season record in league history so far, single-game scoring records), the 3 biggest trades (by the trade event's importance) and comebacks. Every entry links to its source page (playoffs, player, newspaper edition, storylines season, achievement, box score, trade summary). Filters: season range (navigates), kinds (remembered per browser), team and a text search.
- **Settings:** _League Timeline_ switch. Entries from Newspaper, Storylines and League Achievements are left out while those features are off (the page says which).
- **Known limits:** headlines are computed for at most the 25 latest seasons of the range (finished seasons are cached in memory). Storylines need the Wrapped snapshot: on a first visit they appear when it's ready. Achievements come from the saved unlock log, so ones unlocked before achievements were tracked in the league don't show.

## Newspaper

- **Where:** League menu → _Newspaper_, `/l/:lid/newspaper`, `/l/:lid/newspaper/:team/:season` (`all` or a team like `ATL_0`). Also linked from the dashboard ("From the records"), the team pages' _More_ links (team edition), League → History and each season row of Team History.
- **What:** a front page plus sections (Playoffs, Awards, Teams, Players, Features, Transactions, By the numbers, Opinion, Colour & letters) written from the season's results, awards, transactions and box scores. During a season it reports "so far"; after the playoffs it becomes the final edition. A team edition focuses on one franchise. Back issues link to earlier seasons. _Print edition_ gives a print-friendly layout.
- **Settings:** _Newspaper_ switch in League Extras.
- **Known limits:** pull quotes and letters marked _Colour_ are invented voices (the numbers are real). Player photos load lazily as you scroll. Very old seasons with deleted box scores get fewer game stories.

## Wrapped

- **Where:** League menu → _Wrapped_, `/l/:lid/wrapped` (chooser), `/l/:lid/wrapped/season/:season`, `/l/:lid/wrapped/team/:season/:team`, `/l/:lid/wrapped/player/:season/:pid`, `/l/:lid/wrapped/all`, and `/l/:lid/wrapped/compare` (two players, teams or seasons side by side). Linked from team, player and history pages.
- **What:** a tap-through story deck (9:16 cards) of a season, a team's year, a player's year or the whole league's history. Arrow keys, the on-card buttons, tapping the left/right of the card or swiping move between slides. Each slide can be saved or copied as a 1080×1920 PNG.
- **Deck settings** (gear icon on the card, remembered per browser): number of slides, autoplay, **quiz** (a few "who led the league in…" questions mixed into the deck, with a score slide; on by default) and **no spoilers** (hides results that would give away the season's outcome).
- **Compare:** a scoreboard of the main numbers (the better value is bold with ▸), the topics both have with a winner per topic, and the slides only one side has.
- **Known limits:** the first visit to a big league builds a snapshot of the whole history, which can take a while (a progress placeholder shows; later visits use a cache, see _Performance_). Autoplay waits on an unanswered quiz question. A season that isn't over yet gets a "so far" deck without awards or playoffs.

## Storylines

- **Where:** League menu → _Storylines_, `/l/:lid/storylines`, `/l/:lid/storylines/team/:team[/:season]`, `/l/:lid/storylines/player/:pid`, `/l/:lid/storylines/all/all/:season`. _Wrapped_ and _Storylines_ buttons are on each player page; team pages and history pages link here too.
- **What:** story cards found in the league's history (Cinderella runs, upsets, droughts, dynasties, big triple-doubles, ageless wonders, ring chasers, homecomings, stacked draft classes and more), each with a _Why this story?_ button that shows the numbers behind it. The _Threads_ tab groups stories that belong together. Filter by season, kind and order, or search.
- **Settings:** _Storylines_ switch in League Extras.
- **Known limits:** shares the Wrapped snapshot, so the first visit to a big league can take a while. Stories need history: a new league has only a handful.

## Games to Watch (hype)

- **Where:** League menu → _Games to Watch_, `/l/:lid/hype`; a _Games to Watch_ card on the league dashboard; a hype badge and reasons under games on Schedule and Daily Schedule; a hype card above box scores.
- **What:** a 0–100 must-watch score for upcoming games from what's known before tip-off (standings and playoff races, series stakes, rivalries, star power, milestones, streaks, record chases, revenge games, rookie duels). Finished games show whether they lived up to it ("Did it live up to it?"). _Record chases_ lists players close to league or franchise records.
- **Settings:** _Games to Watch_ switch in League Extras, with options for the dashboard card and the schedule/box score badges.
- **Known limits:** record chases need a few seasons of history. Schedule badges are only computed for the next 8 games.

## Play-by-play flavor

- **Where:** the live game view (_Play → … → Watch game_, or _Watch game_ on the schedule).
- **What:** varied, ratings-aware wording for every play (shot types, passes, fouls with personal and team foul counts, bonus situations, runs, milestones, quarter summaries). It only changes the text: game results are identical with or without it (covered by `outcomeInvariance.test.ts`).
- **Known limits:** the wording assumes 12-minute quarters for clock-based phrases. Elam ending and shootout events keep the original wording.

## Draft Scouting: College stats and Regenerate ratings

- **Where:** _Players → Draft → Draft Scouting_ (`/l/:lid/draft_scouting`).
- **College stats:** the _College stats_ button above each draft class generates college (or international league) stats and honors for its prospects from a seed (same seed, same result), or regenerates/removes them. They show on the player page with a _College_ tag in the stats tables and an _Earlier honors_ box, and are **not** pro stats: they don't count toward experience, career totals, awards, Hall of Fame or player value.
  - Setting: **League Extras → College Stats → Generate College Stats Automatically** (formerly League Settings → Events) does this automatically for every new draft class.
- **Regenerate ratings:** rebuilds prospects into specialized builds (Floor General, Stretch Big, Rim Protector, …) without changing overall, potential or height. Scope: whole class, selected prospects or one prospect. Settings include seed, variation, class flavor and strength, builds per class, archetype diversity, specialization and rookie caps, each lockable; per-player reroll and rating locks; preview with diffs; _Apply_, _Undo last apply_ (until reload) and _Restore originals_ (survives reloads).

## Customize Player: Regenerate build

- **Where:** a player page → _Edit_ (`/l/:lid/customize_player/:pid`), _Regenerate build_ button (opens a dialog).
- **What:** the same build engine for one existing player: preview, pin ratings, reroll; keeps ovr, pot and height.

## Player, team and history pages

- Player pages: college rows (tagged _College_) in the stats tables, an _Earlier honors_ box, and _Wrapped_ and _Storylines_ buttons.
- Team pages (_More_ links), League → History, History (all seasons) and Team History rows link to the Newspaper, Wrapped and Storylines for that team/season.

## Performance

Wrapped and Storylines read the whole league into a snapshot. Converted pieces that can't change any more (retired players, finished seasons' box scores and team seasons) are cached in a separate IndexedDB database (`wrapped-cache`), versioned by the converter code and invalidated through the league's change log, so later sessions only read what changed. Idle snapshots are evicted from memory. `tools/perf/wrapped/` holds the Playwright benchmark scripts (see the header of `bench.cjs`).

## Testing

- Unit tests: `node_modules/.bin/vitest --run --project basketball` (plus `football` and `baseball`, which must stay green since the features are gated).
- Lint: `node_modules/.bin/eslint .` and `node_modules/.bin/tsc --build`.
