# College mode

Play Basketball GM as a college program instead of a pro team: you coach a school, recruit high-school prospects, lose players to graduation, the pros and the transfer portal, and play for a conference title and the national tournament.

This document is the design. The **Status** section at the end says what is built (v1), what is stubbed, and what is left for v2. Basketball only.

## Principles

- **Depth without micromanagement.** Everything runs by itself with sensible AI/defaults: lineups, recruiting (auto mode is on by default), the transfer portal, departures. The user only has to press Play. Each system has one place where the user can step in (the Recruiting page).
- **One switch.** Everything college-specific is behind the game attribute `leagueType: "college"` (default `"pro"`, absent in old leagues). It is set once, at league creation, and never changes. Worker code asks `isCollege()` (`src/worker/core/college/isCollege.ts`); the UI reads `leagueType` from the local state.
- **Rule options are ordinary settings.** The shot clock length and the one-and-one bonus are normal settings that any league can use (League Extras: _Custom Shot Clock_, _One-and-One Bonus_). College mode only presets them. With them off the game sim is byte-identical to before (`outcomeInvariance.test.ts`).
- **Pro leagues are untouched.** Every branch is `if (isCollege())` at the top of an existing function, or new code under `src/worker/core/college/`, `src/common/college/`, and new views. Other sports never see the flag (`isCollege()` is false outside basketball).
- **Reuse the engine.** A college league is a normal league as far as the engine is concerned: teams, conferences (one division each), a schedule, the real game sim, box scores, stats, standings, the playoff bracket (single games), awards, the coaching staff. College mode replaces the parts that do not exist in college (contracts, trades, free agency, the draft) rather than adding a parallel engine.

## League type and creation

- New League → **College** (`/new_league/college`). The form has one extra choice, the **level** (see Performance), then the usual team picker (teams grouped by conference) and the usual _Customize_ buttons.
- Teams come from `src/common/collegeStats/colleges.ts` (`COLLEGES`, `CONFERENCES`): `src/common/college/teams.ts` builds the team list for a level. Region = the school name ("Duke"), name = a generic generated nickname (no real mascots, logos or trademarked art), abbreviation generated from the school name (unique), three colors generated from a hash of the name, no logo image. Each conference is a conference with one division.
- **Prestige** (`getCollegePrestige`, 0-100): the program strength already used by the prospect model (conference strength + log of the school's frequency). It seeds roster talent, recruiting pull, poll reputation and expectations. It is stored on the team (`t.collegePrestige`) and drifts with results (see Offseason): each season a program gains with its win % and tournament run and loses what its prestige already expected (measured from the league's average prestige), the results part averaging zero over the league, plus a pull of 8% back toward its long-run prestige (`collegePrestigeBase`), so the league's average prestige stays where it started at every level (`prestigeDeltas` in `college/offseason.ts`; it used to be measured from a fixed 70, so a power conference league, all near 93, lost about a point a season).
- Settings preset (`src/common/college/settings.ts`, `getCollegeSettings(level)`): `leagueType: "college"`, 2 halves of 20 minutes (`numPeriods: 2`, `quarterLength: 20`), 30-second shot clock, one-and-one on the 7th team foul of a half and two shots from the 10th (`foulsUntilBonus: [10, 4, 10]`, `oneAndOne`, `oneAndOneFouls: 7`), 5 fouls to foul out, 13 scholarships (`maxRosterSize: 13`, `minRosterSize: 9`), no salary cap, no budget (`salaryCapType: "none"`, `budget: false`), no trades / draft picks / free agency, no All-Star game, no trade deadline, single-game neutral-site tournament (`numGamesPlayoffSeries` all 1, `neutralSite: "playoffs"`), play-by-play saved for the user's games only, box scores kept for the user's team and the tournament, and the sim tendency factors calibrated to college scoring (see Calibration).
- League Extras that make no sense without contracts, trades or a draft are **forced off** in a college league whatever the stored value (registry flag `college: false` in `common/nativeFeatures.ts`): trade features, contract features, GM personalities, draft board / mock draft / scouting system / class shapes / college stats for prospects, season odds, unretirements.

## Data model

No new object store and no database version bump.

| Where                                                                                 | What                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------- |
| game attribute `leagueType`                                                           | `"pro"` (default) or `"college"`                                                                                                                                                                                  |
| game attribute `collegeLevel`                                                         | `"power"`, `"major"` or `"full"`: which schools the league was made with (information only after creation)                                                                                                        |
| game attribute `collegeAutoRecruit`                                                   | bool, default true: the AI recruits for the user's school                                                                                                                                                         |
| game attributes `customShotClock` + `shotClockLength`, `oneAndOne` + `oneAndOneFouls` | rule settings, any league                                                                                                                                                                                         |
| game attribute `collegeState`                                                         | the working state of the current season: compact results log, weekly polls, conference tournament brackets, selection. Reset each preseason                                                                       |
| `awards` record of a season, key `college`                                            | the season's archive: final polls, conference tournament brackets and champions, selection (field, bubble), conference players of the year, off-screen pro draft results, departures summary                      |
| `t.collegePrestige`                                                                   | program prestige, 0-100                                                                                                                                                                                           |
| `p.classYear`                                                                         | 1-4 (Fr, So, Jr, Sr). 0 for a signed recruit who has not enrolled yet                                                                                                                                             |
| `p.recruit`                                                                           | `{ stars, rank, posRank, state, offers?: tid[], committed?: tid, userTarget?: number }` for a high-school prospect and kept afterwards as his recruiting history                                                  |
| `p.contract`                                                                          | `{ amount: minContract, exp }` where `exp` is the season his eligibility ends. Never shown as money                                                                                                               |
| `p.tid`                                                                               | on a team; `PLAYER.UNDRAFTED` = a recruit of the next class (`p.draft.year` = signing year); `PLAYER.RETIRED` = left school (graduated, turned pro, left the sport). `p.collegeExit = { season, type: "graduated" | "pro" | "left", pick? }` says how |
| `p.transactions` / events                                                             | transfers and commitments are logged as events (`type: "freeAgent"`-style news with the school)                                                                                                                   |

A recruit is a real player object (so he has a player page and ratings with the usual fog), but only **one** class exists at a time and unsigned recruits are deleted after signing day, so the database does not fill with thousands of prospects.

## Calendar

The engine's phases are kept (so the play menu, auto play and every `phase <=` comparison keep working) and renamed in a college league:

| Engine phase           | College meaning        | What happens on entering it                                                                                                                                                                                                                           |
| ---------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRESEASON`            | Preseason              | new season; players develop (native progression, which is steep at 18-22); class years advance, recruits enroll; next recruiting class is generated; prestige updated; preseason AP poll                                                              |
| `REGULAR_SEASON`       | Regular season         | schedule: non-conference games first, then conference play. Weekly AP poll                                                                                                                                                                            |
| `AFTER_TRADE_DEADLINE` | Conference tournaments | entered when the regular season schedule is empty. One bracket per conference, seeded by conference record, one round per day, neutral court. Games count in the overall record, not the conference record                                            |
| `PLAYOFFS`             | National tournament    | Selection: automatic bids (conference tournament champions) + at-large by committee score (NET-style ranking from the real results, quadrant records, SRS, record), S-curve, regions. Then the engine's own single-elimination bracket, neutral court |
| `DRAFT_LOTTERY`        | Season over            | awards (national: the engine's awards, relabelled; conference players of the year), coaching carousel, job security                                                                                                                                   |
| `DRAFT`                | Departures             | seniors graduate; the off-screen pro draft (early entrants + seniors), results page                                                                                                                                                                   |
| `AFTER_DRAFT`          | Transfer portal        | automatic: buried players leave for minutes, schools with openings take them                                                                                                                                                                          |
| `RESIGN_PLAYERS`       | Recruiting             | the signing period: the user sets targets (or leaves auto on)                                                                                                                                                                                         |
| `FREE_AGENCY`          | Signing day            | recruits commit, news; walk-ons fill what is left; unsigned recruits are removed                                                                                                                                                                      |

## Schedule

`college/schedule.ts`. Total games `numGames` (30). Conference games: double round robin when that is at most 20 games, otherwise a single round robin plus extra games up to 18/20. The rest are non-conference games, paired at random with a preference for a mix of opponents, home/away balanced. Games are laid out as rounds (every team plays at most once per day) so the season is about 32 game days.

## Results, polls, selection

- Every game of a college league is appended to a compact results log (`collegeState.results`: day, home, away, margin, site, type). It is the input of everything below, so nothing depends on box scores being kept.
- **AP Top 25**: `buildWeeklyPolls` (the prospect model's poll engine) on the real results: preseason poll from reputation (prestige + roster rating), then one poll per week (two game days), same 62 voters all year. Deterministic per league + season.
- **NET**: `computeNet` on the real results (quadrant cutoffs scaled to the number of teams).
- **Selection**: `committeeScore` (SRS, NET, record, quadrant wins and bad losses, road wins) ranks the at-large pool. The field is the conference tournament champions plus the best of the rest; the bubble (last four in, first four out) is kept for the Selection page.
- **Bracket**: the field size is the largest of 64/32/16/8 that is at most about a quarter of the league (64 for a full Division I league, 32 for the power conferences). Seeded on an S-curve into regions (16, 8, 4 or 2 seeds per region), written as the engine's playoff series, so the bracket page, box scores, "rounds won", the champion and the history pages all work unchanged.

## What replaces finances, contracts, the draft and free agency

- **Finances/contracts:** nothing. `budget: false` hides the finance pages (native). Contract columns are replaced by the class (Fr/So/Jr/Sr); negotiation, release-for-money and extension flows are unreachable. No minimum payroll penalty or luxury tax is assessed. The forced-off League Extras stay off even if switched on in the settings (contract extensions, trade requests, contract options, need-based trades and the scouting system included), and the rumor mill has no "unhappy, could ask out" rumors.
- **Trades:** none (pages hidden, AI trades off).
- **Draft:** the off-screen pro draft at the Departures phase. Pro stock = a blend of current rating and potential, discounted by age. The best prospects are taken in order until the picks run out (60 for a full league, fewer for smaller ones); seniors are always in the pool, underclassmen enter only when projected high enough (certain in the lottery, a coin flip late). Drafted players leave school; the results page lists pick, player, class, school and season stats.
- **Free agency:** none. There are never free agents in a college league. Rosters are filled by recruiting, the portal and walk-ons.

## Recruiting (v1)

- A class of high-school prospects (age 18) is generated each preseason, sized to the expected openings. Each has stars (2-5), a national rank and position rank, a home state, and real ratings (with scouting fog for the user).
- Signing day (entering Signing day phase): recruits decide from best to worst. A recruit scores every school that still has an open scholarship and wants him: prestige, playing time available at his position (need), a small random "fit", and for the user's school the priority the user gave him. He commits to the best score. Better recruits ask for more: a five-star will not look at a school far below the best that wants him.
- **User interaction:** the Recruiting page lists the class (rank, stars, position, state, ratings) and the user's open scholarships. The user stars targets in priority order (up to 3 per opening counts). Targets get an interest bonus (the staff's attention); non-targets can still commit to the user's school only in auto mode. **Auto recruit** (default on) does the targeting for the user: the best recruits it can realistically get at positions of need.
- Commitments are logged as news; the user's class is summarized in a notification.

## Eligibility and departures

- Four years (Fr-Sr), no redshirts in v1. Seniors graduate at the Departures phase.
- Early entry: see the pro draft above.
- Transfer portal (automatic): a non-senior who played little and is clearly worse than the players ahead of him, or a good player at a much weaker program, may enter. Schools with openings pick from the portal by prestige and need, before signing day. Players nobody takes return to their school.

## AI behaviour

Lineups and rotations are the engine's. AI schools recruit by prestige + need as above, take portal players the same way, never cut players. The coaching staff feature works unchanged (coaches belong to schools; the carousel and hot seat run after the season). The user's job security uses expectations: the owner mood's "wins" and "playoffs" components are measured against what the program's prestige predicts rather than against .500 and "made the playoffs", so a small school is not fired for missing the tournament and a blue blood is for a losing season.

## Performance plan

A full Division I league is 364 teams: about 5,500 games a season against 1,230 for the NBA. Three levels, chosen at creation:

| Level             | Schools                                                 | Tournament |
| ----------------- | ------------------------------------------------------- | ---------- |
| `power` (default) | the five power conferences (79)                         | 32         |
| `major`           | power + the strongest mid-major conferences (about 170) | 64         |
| `full`            | all 32 conferences (364)                                | 64         |

All games are played by the real game sim in every level (so every player has real stats and any game can be watched). The cost per game is kept down by: play-by-play stored for the user's games only; box scores kept for the user's games and the tournament only; the League Extras that scan all teams daily (season odds, hype, achievements, records checks) off by default in a college league; one recruiting class instead of several draft classes. Measured numbers are in Status. A cheaper path for games that do not involve the user (a quick sim that still produces box-score-shaped stats) is the v2 answer for making `full` as fast as `power`.

## Roadmap

**v1 (this build):** league type and creation, rules, schedule, conference tournaments, polls, NET, selection, national tournament, awards, departures and off-screen pro draft, automatic portal, recruiting v1 with targets and auto mode, expectations-based job security, hidden pro-only pages, new pages (Top 25 / Selection, Conference Tournaments, Recruiting, Departures).

**v2:** NIL budget; deeper recruiting (visits, pitches, pipelines by state, in-season commitments, decommitments); a transfer portal the user works by hand; redshirts and medical years; conference realignment; a coach career that moves between schools (job offers); a pro league running alongside so prospects feed a real draft; NIT and other postseason events; the First Four (68 teams); rivalry trophies; a quick-sim path for non-user games; real hometown geography in recruiting; in-season player of the week / bracketology; conference awards pages.

## Status

### v1: built and working end to end

- New League → College (power / major / full), schools from the college list with generated nicknames, abbreviations and colors (no logos), 13-man rosters of 18-23 year olds in four classes, talent by prestige.
- College rules preset: two 20-minute halves, 30-second shot clock (`customShotClock`), one-and-one from the 7th team foul and two shots from the 10th (`oneAndOne`), 5 fouls, sim tendencies calibrated (`COLLEGE_SIM_CALIBRATION`). The two rule settings work in any league; with them off the pro sim is byte-identical (`outcomeInvariance.test.ts`).
- Season: 30 games (non-conference, then a double or single-plus round robin in conference), weekly AP Top 25 from the real results, NET with quadrants, conference tournaments (neutral court, byes for top seeds, automatic bids), Selection (committee score, S-curve, last four in / first four out), national tournament (32 or 64) with the real sim, champion in history. Conference standings come from the engine (one division per conference).
- Awards: the engine's awards (MVP, DPOY, All-League teams, ...) run on the college season; they are not yet renamed (All-Americans) and there are no per-conference player of the year awards yet.
- Offseason: graduation, off-screen pro draft (results page), automatic transfer portal, recruiting v1 (class with stars, rank, position rank, home; Recruiting page with targets, interest and _Auto recruit_; signing day news; walk-ons), class years advance, prestige drifts with results, recruiting class for next year.
- Pro-only pages and links hidden (trades, free agency, draft, finances, contract/mood on roster and player pages, release/trade buttons); League Extras that need contracts, trades or a draft are forced off; the play menu and the phase names use the college calendar.
- Coaching staff, coach carousel and hot seat run unchanged with schools; the user's owner mood (job security) compares the season with what the program's prestige predicts.

### Speed (headless, `collegeSeasons.test.ts` with `COLLEGE_BENCH`, a 4-core container shared with other jobs)

| Level | Schools | Seconds per regular season | Game days |
| ----- | ------- | -------------------------- | --------- |
| power | 79      | 9-10                       | 42        |
| major | 145     | 22-24                      | 45        |
| full  | 364     | 96-135                     | 51        |

In the browser (production build) the power level's regular season took 8-19 s depending on machine load. Every game uses the full game sim; a cheaper path for games that do not involve the user is the main v2 item for the full level.

### Stats per team game (regular season, three seasons)

| Level | Pts       | FG%       | 3PA / FGA  | 3P%       | FTA       | TOV  | Pace (poss / 40 min) |
| ----- | --------- | --------- | ---------- | --------- | --------- | ---- | -------------------- |
| power | 72.7-73.3 | 43.7-43.8 | 41-42%     | 33.7-34.0 | 19.8      | 12.3 | 68.5                 |
| major | 70.1-70.6 | 43.0-43.5 | 37.5-38.5% | 33.9      | 18.5-18.9 | 12.2 | 67.6                 |
| full  | 66.7-67.6 | 42.1-42.6 | 32-34%     | 33.6      | 18.0      | 12.2 | 66.9                 |

NCAA Division I is about 72 points, 44% FG, 38-39% of shots from three, 34% 3P, 19 FTA, 12 TOV, 68 possessions. The full level scores a bit low because its weakest schools have low ratings.

### Not in v1 / known limits

- (v1) Awards were the pro ones and the team rating on the pro scale: fixed in v2.
- (v1) No redshirts, NIL, visits/pitches, decommitments, in-season recruiting, hand-run transfer portal, NIT, First Four: done in v2/v3. Conference realignment and coach career moves: done in v4; a pro league alongside (college → pro): v5.
- The bracket page shows "League Champions"; region names are not shown on the bracket (they are on the Selection tab).
- Imported or edited college leagues are not specially handled (a league file with players skips the college roster generation). A program's prestige (`t.collegePrestige`, `t.collegePrestigeBase`) is kept from the file.
- The full level is slow (about 2-2.5 s per game day headless).
- Account achievements are not checked in a college league (they are about running a pro team, and a college title would meet several for free).

### v2: built

- **Quick sim** (`college/quickSim.ts`, setting _College Quick Sim_ `collegeQuickSim`, on by default for major and full, optional for power). Games without the user's team in the regular season and the conference tournaments (except the finals) are played by a statistical model: margin = 1.04 × (home strength − away strength) + 2.2 home court + N(0, 12.9); total = 165.7 + 0.416 × (sum of strengths) + N(0, 15), where strength is team.ovr's predicted margin of the healthy, non-redshirted players; ties go to 5-minute overtimes. The box score is built to add up to the score: minutes by rotation slot, quality and endurance; team shots, free throws, rebounds, assists, steals, blocks, turnovers and fouls around the full sim's means, shared out to the players by minutes and composite ratings with exponents fitted to the full sim's per-minute rates; shot locations; injuries at the full sim's rate per minute. The result has the game sim's shape, so stats, standings, box scores, injuries, polls and NET are unchanged. Also: no mood snapshots in college, coaching systems skipped on days with no full-sim game, advanced stats every third regular season day with the quick sim on.
- **Calibration** (one full-size season each way, `quickSimData.script.test.ts`; bounds in `quickSim.test.ts`):

|                                                                        | Full sim                                          | Quick sim                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| margin per strength point / home court / residual sd                   | 1.04 / 2.16 / 12.9                                | 1.04 / 1.96 / 13.0                                |
| points per team, OT rate                                               | 66.7, 3.5%                                        | 66.6, 2.2%                                        |
| stronger team wins, gap 0-2 / 2-5 / 5-10 / 10-15 / 15-20 / 20-30 / 30+ | .53 / .60 / .70 / .83 / .87 / .98 / 1.00          | .56 / .62 / .72 / .84 / .91 / .96 / 1.00          |
| team FGA, 3PA, FTA, ORB, DRB, AST, TOV, STL, BLK                       | 57.0, 17.7, 17.9, 8.9, 23.7, 13.9, 12.2, 6.5, 2.9 | 56.5, 17.9, 18.2, 9.0, 24.4, 13.9, 12.2, 6.4, 2.8 |
| leaders (per game) pts top1/top10/top50                                | 24.2 / 18.2 / 14.9                                | 27.3 / 20.4 / 16.2                                |
| trb, ast, stl, blk top10                                               | 10.4, 6.4, 2.2, 1.7                               | 11.2, 5.8, 2.2, 1.7                               |
| player 2P% p10/p50/p90                                                 | .362 / .457 / .588                                | .340 / .467 / .589                                |

Known differences: team-to-team spread of 3PA and FTA is a bit narrower, the top scorers score a little more, the most extreme three-point shooters take fewer threes.

- **Awards** (`common/college/awards.ts`, award settings, so the awards, history and player pages show them): Player of the Year, Defensive Player of the Year, Freshman of the Year, Most Outstanding Player (title game), conference Players of the Year and All-Conference 1st/2nd teams (group "conf"), All-American 1st/2nd/3rd teams, All-Freshman team. Coach of the Year (coaching staff) is judged against the prestige expectation. A v1 league switches to the college awards at its next awards.
- **Team rating** on a college scale in college leagues: 88 + 0.6 × predicted margin (pro scale), so the best programs of a full league read in the high 80s and the weakest in the 40s. Player ovr stays on the usual scale.
- **Bracket:** "National Champions" (banner, history), region names on the bracket, seeds.
- **Redshirts:** _Redshirt_ button on the Roster page for the user's freshmen who have not played this season (preseason to the conference tournaments); a redshirted player does not play (full and quick sim), his eligibility runs a season longer and his class year does not advance. AI schools redshirt up to two deep-bench freshmen when the regular season starts (70% each), phased in over a new league's first four seasons (a quarter of the rate in season 1, the full rate from season 4, `aiRedshirtChance`): a new league has no fifth-year seniors, so redshirting at the full rate at once made the first redshirted class leave a year late all together, and the year it should have left the seniors, the open spots and the next recruiting class all dropped (seniors to about 900 in a full league in season 4), an echo that came back every four years.
- **League files with players** in college mode keep their rosters (class years from age) and show a notice instead of generating college rosters.

### Speed after v2 (headless, regular season)

| Level | Before (full sim) | After (quick sim)                    |
| ----- | ----------------- | ------------------------------------ |
| power | 9-16 s            | 4-5 s (quick sim on; off by default) |
| major | 22-24 s           | 9 s                                  |
| full  | 96-135 s          | 21-26 s                              |

### v3: built

- **First Four** (game attribute `collegeFirstFour`, on for new college leagues; only the 64-team bracket, i.e. the full size): Selection is made when the conference tournaments end, with 68 teams. The four lowest at-large teams and the four lowest automatic qualifiers play four play-in games (full sim, neutral court) on one more day of the conference tournament phase; the winners take their seed line. Shown on the Selection tab (an _FF_ badge on the region lists) and above the bracket. First Four games are not in the NET, polls or records shown on Selection.
- **NIT** (League Extras _College NIT_, `collegeNit`, on for new college leagues; off for older ones): the best teams not selected (committee score), 32 next to a 64-team national tournament and 16 next to a 32-team one (never bigger than the national field, so a field cut in the settings still finishes its NIT on the court), none unless at least NIT size + 8 teams are left out of the national field (68 with the First Four). Regular season conference champions (the 1 seed of the conference tournament) who lost their tournament and missed the national tournament get automatic bids. One bracket, NIT round k on the same day as national round k (so it ends first). Games without the user's team use the quick sim when it is on. Page _NIT_ (`/college_nit/:season`); the champion is in the news, the season archive, the season's League History page and the all-seasons League History table (an _NIT_ column). NIT games are kept apart from the national tournament's postseason stats: a player's NIT games go to their own stats rows (`p.nitStats`, shown in an _NIT_ table on his page), not to his postseason stats, career totals, awards or records; a team's NIT games are not in its postseason team stats (the NIT page has the results); the box scores are tagged `nit` and the Records Book skips them.
- **Recruiting v2** (`college/recruiting.ts`, model in `common/college/interest.ts`, see below): weekly recruiting points, actions (scout, contact, home visit, official visit, offer, NIL), pitches, interest that builds week by week, in-season commitments and decommitments for every school, signing day from the commitments, class rankings. A verbal commitment ends at signing: a recruit whose school has no spot left signs elsewhere, and his `recruit.commit` is cleared (his school is `recruit.committed`). Recruiting page tabs: Board (filters, actions, an interest bar against the top 3 schools, what each recruit wants), Commitments, Signing day (who signed where, class rankings, any past season). News items for commitments and decommitments (4-5 stars and the user's recruits). _Auto recruit_ still works: the AI spends the user's points.
- **User-run transfer portal**: entering the Transfer portal phase, players enter the portal (bench players without minutes, a few stars at small programs, and on the user's team players unhappy with their minutes). The play menu stops in the portal phase; the Transfer Portal page lists them (a player in the portal shows as _Transfer Portal_ on his player page, linked to that page), and for 3 weeks (_Next portal week_, or played automatically when you move on) every school recruits them with the same points; a player commits and joins at once. The user's own players can be kept with a _Retention pitch_. A player who entered the portal wants to leave: his old school's standing offer doesn't count, it is only in the running after a retention pitch (AI schools make one on players good enough to start for them), and then it has to win on interest like any other school. When the window closes the rest pick a school with a spot that recruited them, else any school where they would play, and go back to their old school only if nobody else has a place for them (or leave college). Before, the standing offer won at the close most of the time and only about 7-30% of entrants moved. Rosters never go over 13 (commitments count). **Transfer limit, kept simple:** a player who transferred once never enters the portal again (no sitting out). After the portal, 2 late recruiting weeks in the Recruiting phase.
- **Migration:** leagues from v1/v2 keep working: recruits without preferences get them at the next recruiting week, an in-progress offseason uses the v1 rules for whoever has no v2 data, the First Four and the NIT stay off unless turned on.
- The phase change into the conference tournaments now saves (a reload used to lose it), and the play menu updates after it.

### The interest model

Each recruit has preferences over six pitches (playing time, prestige, closeness to home, coach, winning, NIL), weights adding up to 1 (a flat Dirichlet). For each school he has grades 0-1: playing time from the returning players at his position better than him, prestige, distance from his hometown to the campus (see v4), the head coach's ratings, win % and NIL money promised. Fit = Σ weight × grade. An action adds effort × (0.4 + 1.2 fit) × (0.5 + 3 × weight × grade of the pitch) (contact 3, home visit 9, official visit 18, offer 8, retention pitch 14), with diminishing returns towards 400. Every week a school that did nothing loses 10%, and every school he follows gains 2 × fit. He follows at most 12 schools. He commits when the school he likes best offered him, has a spot, is past 50 and leads the next by 15% (shrinking to 3% as weeks pass); he decommits when an offering school passes his by 40% or his school withdraws. Weekly points: 40 + 0.5 prestige ± 10 for the coach (the user sees about 70-95); NIL: about 1.2 × prestige - 20 thousand a season; 5 official visits a season; two offers out per open scholarship. AI schools get the same budget, target recruits their prestige can land (and portal players who would play), offer, visit their top targets with the best pitch, and move on when they fall well behind the leader.

### Next steps

1. College award names and conference awards (All-Americans, conference POY, Final Four MOP).
2. Quick-sim path for non-user games, to make the full level about as fast as power.
3. ~~Recruiting v2 and a user-run transfer portal; redshirts~~ (done in v2/v3).
4. Rescale team rating / ovr display for college; bracket region labels and "National Champions".
5. ~~Coach career moves, conference realignment~~ (v4), ~~a pro league alongside~~ (v5, college → pro), rivalry trophies (NIL, NIT, First Four done in v3).

### v4: built

- **Real school locations** (`common/college/geography.ts`): campus coordinates for every school of the college list (364). A recruit's hometown is a point in his home state or Canadian province (his birthplace says only the state, "Ohio, USA"): spread around the state's population center within a radius that fits the state's size, fixed by his pid (no new data on the player). The _close to home_ grade is 1 within 100 km (60 miles), 0.15 + 0.85 × exp(-(km - 100) / 600) beyond (about 0.6 at 500 km, 0.35 at 1,000 km, 0.15 across the country), 0.4 for a recruit from abroad. The Recruiting and Portal boards show the miles from his hometown to your campus. The travel effect of the game sim (League Extras _Load, Fatigue & Venue_) measures road trips campus to campus in a college league (the city table of pro leagues has no schools); pro leagues are unchanged.
- **Coaching careers** (`worker/core/staff/collegeCarousel.ts`, inside the offseason coaching market of the coaching staff feature, when the season is over):
  - _Firings_: an AI school fires its head coach with a probability from his last three seasons there against the win % the program's prestige expects (latest counting most; no firing in his first two seasons; coaches with a big reputation get some patience).
  - _The carousel_: open head coaching jobs are filled best program first. A coach's _stock_ is his reputation (the coaching staff's: results against expectations, tournament runs, Coach of the Year, development) plus his last two seasons against his school's expectation. A school can hire a sitting head coach of a program at least 6 prestige points smaller who has been there two seasons and whose stock is high enough for the job (30 + 0.4 × prestige) and better than the best free agent; he says yes with a chance growing with the step up (20-85%). His old school then has an opening of its own, filled in turn. At most 8% of the league's head coaches move up in one offseason. The rest of the openings go to free agents (the usual market).
  - _The user_ is his school's head coach. A bigger school (3+ prestige points) with an opening may offer him its job (up to three offers) when his stock is high enough; the job is held for him. The offers are on the **Coaching Carousel** page (`/college_carousel`, a notification links to it) until the Departures phase: _Accept_ moves the user and his coach to the new school (a 5-year contract; his old school hires someone), _Decline_ (or letting the offers expire, also in auto play) lets the school hire someone else. The user's head coach never leaves when his contract runs out. When the owner fires the user (the usual job security, against expectations), he picks a new school on the New Team page and his coach goes with him ("fired" then "hired" in his history).
  - Shown: news items (hires, step-up moves "hired X away from Y", firings), the coach's page (career record by school and season, transactions), and the Coaching Carousel page (your job: reputation, hot seat, seasons and schools; offers; every head coaching move of a season with the school he came from; realignment).
- **Conference realignment** (`college/realignment.ts`, League Extras _College Conference Realignment_, `collegeRealignment` with _Years Between Realignments_ `collegeRealignmentYears`, default 4; on for new college leagues): when a season is over, with a chance of 1 / years (never two seasons in a row, never after the first), 1-3 schools that are above their conference's average prestige move to a conference at least 2 points stronger on average whose average they are within 3 of, the nearest such conference first (distance to its members' center). The conference left behind backfills with the best school of a weaker conference nearby (one more level of backfill at most), conferences keep 6 to 18 schools. A move changes `t.cid` / `t.did` for the next season: the schedule, standings, conference tournaments and automatic bids follow; the season just played keeps its conferences (team seasons). The school's long-run prestige (`collegePrestigeBase`) moves by half the difference in conference strength. News items (a notification when the user's school or conference is involved), the season archive (`realignment`) and the Coaching Carousel page.

### v5: a pro league with a linked college league

Run a college league and a pro league side by side in the same browser: the college league's departed players become the pro league's draft classes.

**Architecture (option a, a link between two leagues in the same IndexedDB).** The worker only ever has one league loaded (`idb.league` and its cache), but it can open a second league's database read-only for a moment, the same way exhibition games read other leagues (`connectLeague(lid)`, read, `close()`); the other league's cache was flushed when the worker switched away from it. So a pro league stores a link (game attribute `linkedCollege: { lid, auto, imports }`) and reads the college league directly, with no export file:

- `worker/core/draft/linkedCollege.ts`: `getLinkableCollegeLeagues` (the leagues in the meta database whose `leagueType` is `"college"`), `setLinkedCollege`, `importLinkedCollegeClass`, `autoImportLinkedCollegeClass`.
- The class is the college league's latest season whose Departures phase has happened (its season if it is at or past Departures, otherwise the one before): players with `collegeExit` of that season and type `pro` (the off-screen pro draft picks, in pick order) or `graduated` (seniors), then by pro stock (ovr and pot), up to the size of a generated class (rounds × teams × 7/6). Players who left the sport are not included.
- Each one becomes a draft class file entry and goes through the ordinary draft class import (`core/draft/handleUploadedDraftClass.ts`, moved out of the API so both use it): it replaces the class of the pro league's next draft (the current season's until its draft is over), keeps the same age, and is topped off with generated prospects if the college class is short. Kept: name, birth, height, weight, face, ratings, **converted to the pro scale** (a college league's ratings are ordinary ratings, but its talent is calibrated for college games, so its seniors rate 70-80 ovr, far above pro prospects: the class is mapped by rank onto a pro class generated for the same draft and not saved, the k-th best imported prospect getting the draft value of the k-th best generated one (the age-adjusted mix of ovr and pot the draft AI uses, `valueCombineOvrPot`, with the noiseless pot estimate, then one calibration pass so the top 60 match as the draft AI sees them with Monte Carlo pot) by the same scaling of every rating but height, so his profile stays. Value rather than ovr: the class averages about 1.5 years older than a generated one (the college off-screen draft takes mostly seniors), and at the same ovr an older prospect has less potential; matching ovr left the top 60 at pot 46 / value 41 against 56 / 49 for a generated class, matching value gives about 54.5 / 48.7 against 56.8 / 49.6 (older prospects get a few more points of ovr instead); then ovr, pot, position, skills, value and scouting fuzz are computed in the pro league, so the scouting system, archetypes, traits and the draft AI work on them as on any prospect), regular season college stats as pre-draft rows with the school as the team name (they are not pro stats), college honors (Player of the Year, All-American, the conference awards with the conference's name, a national title, ...) as pre-draft honors named like the generated ones (`College: Big Ten Player of the Year`, `College: 1st Team All-American`; the college league's award settings don't exist in the pro league), and the school as `p.college`. `p.linkedCollege = { lid, pid, season, school, exit, pick, classYear }` says where he came from.
- **Never twice:** a player already in the pro league (drafted, on a team, retired or a prospect of another draft) is never imported again, so importing by hand after the draft while the college league is still on the same season, or after an unlink and relink, says the class is already in the league instead of bringing the same players back. Nothing is imported while the draft is under way.
- **Automatic** (the default for a new link): when the pro league's season is over (`newPhaseBeforeDraft`), the latest college class is imported if it has not been for that draft year or that college season. **By hand**: _Import latest class now_ on Draft Scouting. A news item says what was imported.
- **UI:** Draft Scouting (pro leagues, basketball) has a _Linked college league_ card: _Link a college league…_ lists the college leagues in this browser, then _Import latest class now_, auto import on/off, _Unlink_. Prospects from the college league show a _School_ column. The player page shows his college, college stats and honors like any prospect with pre-draft stats.
- The two leagues advance on their own. The usual rhythm: play the college season through Departures, then the pro season to its end (the import happens then), then the draft. If the college league is behind (or was deleted), the import says there is no new class yet and the generated class stays; the automatic import says so in a notification.
- Tested headless (`core/draft/linkedCollege.test.ts`): a power-conference college league plays a season through Departures; a pro league made next to it is linked, plays a short season, imports the class automatically when it is over (70 prospects: names, ages, schools, college points and honors, ratings shifted to the pro scale with the best one between 40 and 62 ovr) and drafts them.

**Not built:** the other direction (pro → college, for example a pro league's undrafted or released players going back to school), and keeping the two leagues' seasons in step automatically. A college league can't link to another college league.
