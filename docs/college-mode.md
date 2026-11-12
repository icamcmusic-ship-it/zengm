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
- **Prestige** (`getCollegePrestige`, 0-100): the program strength already used by the prospect model (conference strength + log of the school's frequency). It seeds roster talent, recruiting pull, poll reputation and expectations. It is stored on the team (`t.collegePrestige`) and drifts with results (see Offseason).
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

- Awards are the pro ones (no All-American / conference POY naming, no conference awards). Team rating ("x/100") and ovr are on the pro scale, so college teams read low (team rating can be negative).
- No redshirts, NIL, visits/pitches, decommitments, in-season recruiting, hand-run transfer portal, conference realignment, coach career moves, NIT, First Four, pro league alongside.
- The bracket page shows "League Champions"; region names are not shown on the bracket (they are on the Selection tab).
- Imported or edited college leagues are not specially handled (a league file with players skips the college roster generation).
- The full level is slow (about 2-2.5 s per game day headless).
- Account achievements are not checked in a college league (they are about running a pro team, and a college title would meet several for free).

### Next steps

1. College award names and conference awards (All-Americans, conference POY, Final Four MOP).
2. Quick-sim path for non-user games, to make the full level about as fast as power.
3. Recruiting v2 (visits, pitches, pipelines, in-season commitments) and a user-run transfer portal; redshirts.
4. Rescale team rating / ovr display for college; bracket region labels and "National Champions".
5. The v2 list above (NIL, coach career, realignment, NIT, pro league alongside).
