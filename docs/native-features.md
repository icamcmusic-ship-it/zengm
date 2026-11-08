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
- **Settings (Game Simulation):** _Show Play-by-Play in Live Games_ (on; off hides the live feed, score/clock/box score still update), _Box Score Play-by-Play_ (_Always show_ as a tab, or _Show on button press_: text is only made after pressing _Show play-by-play_, remembered per game for the browser session) and _Save Play-by-Play_ (_All games_, _My team's games only_, _None_; replaces the old on/off `storePlayByPlay`, which is kept in step and still means _None_ when off). Helpers and tests: `src/common/pbpSettings.ts`.
- **Known limits:** the wording assumes 12-minute quarters for clock-based phrases. Elam ending and shootout events keep the original wording.

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

## Injury depth

- **Setting:** **League Settings → Injuries → Injury Depth** (`injuryDepth`). On for new leagues, off for existing leagues (they play exactly as before).
- **What:**
  - **Minutes restriction on return:** after an injury of 5+ games, a player comes back on a restriction for about a third as many days (2–10), starting at ~55% of his normal playing-time weight and easing back to 100%. It goes through the same knob as the roster page's playing time setting, so the rotation code respects it.
  - **Re-injury risk:** for 15 days after any injury of 2+ games the injury risk is higher (up to 1.8×, fading), and a new injury has a 45% chance to be to the same body part.
  - **Injury-prone players:** about 7% of players (fixed per player), plus anyone with 5+ injuries of 3+ games in the last three seasons, get hurt 1.4× as often. Shown as a badge on the player page.
  - **Back-to-backs:** the second night of a back-to-back (regular season) has 1.15× injury risk and slightly lower endurance (more fatigue in the game). Marked **B2B** on Schedule and Daily Schedule.
  - **Load management:** on the second night of a back-to-back, AI teams rest veterans in their top 8 (34+, or 31+ and injury prone) when they have at least 10 healthy players. For your team, turn it on for the whole team on the Roster page (below Play Through Injuries) or for single players on their player pages.
  - Everyone's base rate is scaled by 0.9 so league-wide totals stay about the same.
- **Player page:** the Injuries section adds a body-part history (injuries, games missed, last season) and, with the setting on, the restriction / recently returned / injury-prone status and the load management checkbox.
- **Known limits:** basketball only. The countdowns are per day (like BBGM's injury countdown), not per game played. Resting is decided when the teams are loaded, so a rested player shows as not playing in the box score.

## Season odds

- **Where:** _Standings_ (a _Season odds_ section below the tables), _Power Rankings_ (Playoffs and Title columns), _Award Races_ (a Win% column), _Draft Lottery_ (a _What-if simulator_ below the lottery table).
- **What:** 1,000 Monte Carlo simulations of the rest of the season in the worker: each remaining game is decided from team strength (team rating from the current roster, ignoring injuries of 10 days or less, blended with point margin as games are played) plus home court, playoffs are seeded with the game's own playoff code, then the play-in and the bracket are played out. Gives projected record, playoff and play-in odds, seed distribution, reaching the semifinals/finals and title odds. During the playoffs it plays out the remaining series from the current state. Results are cached and refreshed after each day of games, trades, signings or injuries (about 0.2 s per refresh).
- **Award races:** each candidate's award score (BBGM's award scoring) is projected to the end of the regular season with noise that shrinks as the season goes on, and the winner drawn 5,000 times.
- **Lottery what-if:** move teams up or down the lottery order (chances stay with the slot) or pick another lottery format, then _Run lottery_ for exact odds (where fast enough), a 20,000-lottery simulation (hover a cell) and one sample draw.
- **Settings:** none.
- **Known limits:** basketball only, current season only. Tiebreakers are approximated (random among tied teams) and playoff reseeding is ignored. Award odds only consider the top 10 candidates shown and don't model team record changes. The what-if ignores nba2027 restrictions and COLA when switching formats.
## Contracts, mood and player unrest

Unlike the pages above, these work in every sport. Settings are in **League Settings → Contracts**; they are on for new leagues and off for existing leagues until turned on.

- **Options and partial guarantees** (setting _Contract Options & Guarantees_): the negotiation window has _Option_ (player option −5%, team option +10%) and _Guaranteed after year 1_ (100/75/50/0%, up to +20%) pickers for contracts of 2+ years. AI teams put terms in some of their deals too. Options are decided at the start of the re-signing phase: players opt out when the market pays more (or they're unhappy and wouldn't lose much), teams keep a team option if the player is worth about what he'd be paid. A declined option makes the contract expire then, so the player can be re-signed like any expiring contract. You can exercise or decline your own team option early from the player page. Releasing a player only owes the guaranteed part of seasons after the current one, and not an undecided team option. Contracts show a _PO_/_TO_/_%G_ badge next to the expiration year.
- **Extensions** (setting _In-Season Contract Extensions_): players in the last 2 seasons of their contracts can be extended in the preseason and regular season, from _Negotiate extension_ on the player page. The new seasons are added after the current ones, so this season's payroll doesn't change. Willingness comes from mood. AI teams extend some good players in their final season. Extensions can be undone like signings.
- **Mood transparency:** the player page _Contract & Mood_ panel shows contract seasons with guaranteed amounts and options, release cost, a _What would make him re-sign?_ table (projected willingness if the team wins, after a deep playoff run, with a bigger role, with no more trades, or all of these), and mood history with sparklines. Mood is snapshotted at the trade deadline, at the end of the regular season and after the playoffs (up to 30 per player, in `p.moodHistory`).
- **Free agent market:** the Free Agents page _Market_ column shows how many AI teams are interested and the chance he signs elsewhere on the next day; click it for each team's interest (top target, next in line, fallback), the per-day chance and the most likely team. This mirrors how AI teams sign free agents (each day, a team that doesn't skip signs the best player it can fit).
- **Trade requests** (setting _Trade Requests_): very unhappy stars (top 15% by value) can ask to be traded, checked about weekly in the regular season. It's in the news, AI teams value him 15% lower when trading him away, and the trading block shows a _Trade request_ badge. Requests end when he's traded, extended, or happy again.
- **Holdouts** (setting _Holdout Frequency_, 0 to turn off): before the regular season, unhappy players paid well under their market value with 2+ seasons left may hold out, missing a few games (scaled to season length). An extension or a trade ends it early; holdouts also end with the regular season.
- **Data:** contracts gain optional `option`, `guaranteed` and `extensions`; players gain optional `moodHistory`, `tradeRequest` and `holdout`. Nothing needs migrating.
- **Known limits:** what-if projections hold everything else fixed. Market odds are for the next day only and assume teams keep their current needs. Holdout players sit out like injured players.
## Trades: AI explanations, smarter AI trades, offers, market, three-team trades

Unlike the pages above, these work in **all sports** (the trade code is shared).

- **Why the AI said no:** on the Trade page, when the AI rejects a proposal or answers _What would make this deal work?_ with a counter, a _Why?_ link under the GM's message lists, per asset, the terms the AI used: talent level, age and strategy (rebuilding teams value youth and picks more, contenders discount potential), contract (overpaid/bargain/expiring; rebuilding teams weigh contracts more), injuries, projected pick position, plus team-level terms: strategy, roster fit (team ovr before → after) and payroll/cap space. Built from `ValueChangeCalculator.explain()`, the same math the AI decides with.
- **Need-driven AI-to-AI trades:** contenders buy veterans in the run-up to the trade deadline, rebuilding teams sell veterans for picks and young players, and teams paying luxury tax dump contracts into teams with cap space (with draft picks as sweeteners). Over-the-cap buyers send back salary filler. The reason is shown in the trade's transaction text. Setting: **League Settings → Events → Need-Based AI-to-AI Trades** (on by default; off gives the classic random trades only). _AI-to-AI Trades Factor_ still sets the overall number of attempts.
- **AI offers to you:** during the regular season AI teams send offers for players on your trading block, or players that fit their strategy. They arrive as an inbox message and a notification and are listed at the top of _Trade Proposals_ (_Negotiate_ loads one into the Trade page, _×_ dismisses it). Offers expire after 15 of your games or when an asset moves. Setting: **League Settings → Events → AI Trade Offers To You** (about this many offers per 10 games, default 1, 0 disables). No offers when AI trades are off (factor 0), in spectator mode, auto play or the no-trades challenge.
- **Trade Market:** _Players → Trade Market_, `/l/:lid/trade_market`, linked from the Trade page, Trade Proposals and the "trade deadline is coming" notification (a week before the deadline). Lists players each AI team is willing to move (0–100, from strategy, age, contract and role on the team, with reasons) and an asking-price hint relative to the team's own next first round pick.
- **Three-team trades:** `/l/:lid/trade_three/:tid1-:tid2`, linked from the Trade page (_3-team trade_). Send any player or pick from any team to any other team. Each AI team must like what it gets (with the same _Why?_ explanations) and the salary cap rules apply to each team's total incoming and outgoing salary; during the season rosters can't go over the maximum. An accepted trade is recorded as one regular trade event per pair of teams that exchanged something, each noting it was part of a three-team trade, so trade summaries and transactions work as usual. Undo is supported. The regular 2-team Trade page is unchanged.

## Performance

Wrapped and Storylines read the whole league into a snapshot. Converted pieces that can't change any more (retired players, finished seasons' box scores and team seasons) are cached in a separate IndexedDB database (`wrapped-cache`), versioned by the converter code and invalidated through the league's change log, so later sessions only read what changed. Idle snapshots are evicted from memory. `tools/perf/wrapped/` holds the Playwright benchmark scripts (see the header of `bench.cjs`).

## Testing

- Unit tests: `node_modules/.bin/vitest --run --project basketball` (plus `football` and `baseball`, which must stay green since the features are gated).
- Lint: `node_modules/.bin/eslint .` and `node_modules/.bin/tsc --build`.
