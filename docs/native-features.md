# Native features (ported from BBGM League Explorer)

This fork adds a set of pages and tools to Basketball GM that used to live in the separate League Explorer app. Everything is built from the league's own records, runs locally in the game's worker, and is **basketball only**: in Football, Hockey and Baseball GM the menu items and links are hidden, and the routes show a short "only available for basketball" message.

`:lid` below is the league id, as in `/l/1/...`.

## Newspaper

- **Where:** League menu → _Newspaper_, `/l/:lid/newspaper`, `/l/:lid/newspaper/:team/:season` (`all` or a team like `ATL_0`). Also linked from the dashboard ("From the records"), the team pages' _More_ links (team edition), League → History and each season row of Team History.
- **What:** a front page plus sections (Playoffs, Awards, Teams, Players, Features, Transactions, By the numbers, Opinion, Colour & letters) written from the season's results, awards, transactions and box scores. During a season it reports "so far"; after the playoffs it becomes the final edition. A team edition focuses on one franchise. Back issues link to earlier seasons. _Print edition_ gives a print-friendly layout.
- **Settings:** none.
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
- **Settings:** none.
- **Known limits:** shares the Wrapped snapshot, so the first visit to a big league can take a while. Stories need history: a new league has only a handful.

## Games to Watch (hype)

- **Where:** League menu → _Games to Watch_, `/l/:lid/hype`; a _Games to Watch_ card on the league dashboard; a hype badge and reasons under games on Schedule and Daily Schedule; a hype card above box scores.
- **What:** a 0–100 must-watch score for upcoming games from what's known before tip-off (standings and playoff races, series stakes, rivalries, star power, milestones, streaks, record chases, revenge games, rookie duels). Finished games show whether they lived up to it ("Did it live up to it?"). _Record chases_ lists players close to league or franchise records.
- **Settings:** none.
- **Known limits:** record chases need a few seasons of history. Schedule badges are only computed for the next 8 games.

## Play-by-play flavor

- **Where:** the live game view (_Play → … → Watch game_, or _Watch game_ on the schedule).
- **What:** varied, ratings-aware wording for every play (shot types, passes, fouls with personal and team foul counts, bonus situations, runs, milestones, quarter summaries). It only changes the text: game results are identical with or without it (covered by `outcomeInvariance.test.ts`).
- **Known limits:** Elam ending events keep the original wording. Clock phrases follow the league's quarter length and number of periods; shootout lines are seeded like the rest, so a replay reads the same.

## League achievements

- **Where:** League menu → _League achievements_, `/l/:lid/league_achievements`; a _Recent achievements_ card on the dashboard; unlocks are announced as notifications.
- **Rarity:** measured on simulated random-players BBGM leagues, not on real NBA history (BBGM sims are far more generous): common more than 0.6 times a season, rare 0.15–0.6, legendary 0.025–0.15, impossible rarer. No tier that any calibration league unlocked in its first 5 seasons is impossible. The data is `src/common/leagueAchievements/calibration.generated.ts`; regenerate it with `tools/leagueAchievementsCalibration/` (`sim.cjs` sims leagues in a headless browser against the dev server and records the tally every season, `calibrate.ts` turns the outputs into bands; see the file headers).
- **Saved state:** which tiers were already announced, and the log, are kept in the league (the `leagueAchievements` game attribute), so exporting and importing a league carries them. Older versions kept them in a separate `league-achievements` database: it is read once per league and moved in.

## Trade grader

- **Where:** League menu → _Trade Grader_, `/l/:lid/trade_grader[/:tab/:team/:season/:ws]`; grades also show on Trade Summary and the transactions list.
- **What:** each side of every trade graded by the win shares what it received produced for it. A toggle counts **regular season + playoffs** (default, `ws` = `all`) or **regular season only** (`rs`); Trade Summary follows the last choice made on the grader (per browser). Each side notes the titles its team won with a player it received playing for it in those playoffs.

## Draft Scouting: College stats and Regenerate ratings

- **Where:** _Players → Draft → Draft Scouting_ (`/l/:lid/draft_scouting`).
- **College stats:** the _College stats_ button above each draft class generates college (or international league) stats and honors for its prospects from a seed (same seed, same result), or regenerates/removes them. They show on the player page with a _College_ tag in the stats tables and an _Earlier honors_ box, and are **not** pro stats: they don't count toward experience, career totals, awards, Hall of Fame or player value.
  - Setting: **League Settings → Events → Generate College Stats** does this automatically for every new draft class.
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
