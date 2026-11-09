# Rating inflation audit

Do the fork's features make player ratings drift up (inflation) or down (deflation) over a long league? This is an audit of every feature that can touch ratings, with multi-season simulations, the one drift that was found (coaching staff), its fix, and how to re-run everything.

**Result:** with every rating-related feature on, league ratings after 25-30 seasons are the same as an existing league's (upstream behaviour), within seed noise: mean ovr 50.16 ± 0.42 vs 50.03 ± 0.47, pot 56.68 vs 56.70, top-50 ovr 65.4 vs 64.9. One feature had a real, systematic drift: the **coaching staff**'s development effect started 2% below neutral in a new league and climbed to 2% above neutral after ~15 seasons, as the coach pool's ratings drifted. Its effect on league ratings was still inside the noise after 30 seasons (about -0.3 ovr), but it was a structural bias, so it is now normalized to the league's average staff and stays centered for good.

## What can change ratings

| Feature (setting)                                                                | How it can touch ratings                                                                                                                                                         | Verdict                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coaching staff (`coachingStaff`)                                                 | Staff development score → equivalent coaching budget level → `player.develop`                                                                                                    | **Drift found and fixed** (below)                                                                                                                 |
| Player traits (`playerTraits`)                                                   | Trait seeds drift each preseason (`developTraits`), no rating changes. Traits change injury rates in games                                                                       | No ratings effect beyond injuries; none measurable                                                                                                |
| Injury depth (`injuryDepth`)                                                     | Re-injuries, prone players, back-to-backs change injury counts and lengths; long injuries can cost athleticism (upstream rule: >25 games, chance games/82, -1..-20 spd/jmp/endu) | ~4 ratings-loss injuries per season among ~400 players in every config. Even +30% injuries is < 0.05 ovr of league mean. No drift                 |
| College/overseas stats (`generateCollegeStats`)                                  | Pre-draft stat rows and honors only. `player.value`, retirement and rookie checks read pro stats only (`getProStats`)                                                            | No ratings effect (measured: within noise)                                                                                                        |
| Ratings regenerator, "re-randomize new classes" (`rerandomizeDraftClassRatings`) | Rebuilds every rating of new prospects                                                                                                                                           | ovr and pot preserved exactly; the rebuilt prospects develop like the originals (+0.2 ovr after 5-10 seasons, 280 prospects × 5 development runs) |
| Unretirements (`featureUnretire`)                                                | One retiree comes back with +3-6 ovr, 10% chance per season                                                                                                                      | ≤ 0.002 ovr per season of league mean. No drift                                                                                                   |
| Scouting system, AI draft by need, draft board                                   | Who is drafted where, not ratings                                                                                                                                                | None                                                                                                                                              |
| Archetypes, skill badges                                                         | Display only                                                                                                                                                                     | None                                                                                                                                              |
| Realistic possessions, technical fouls, traits in the sim                        | Stats only                                                                                                                                                                       | None on ratings; stats shift is a one-time level change (below)                                                                                   |
| Contracts, holdouts, trades                                                      | No ratings code                                                                                                                                                                  | None                                                                                                                                              |

## Method

Two simulators, both in `src/test/ratingInflation/` (outputs, charts and the analysis script in `tools/ratingInflation/`), both using the real game code with `Math.random` replaced by a seeded generator:

- **Population model** (`popModel.ts`, `pop.script.test.ts`), for the long runs. Real league creation (random players), real draft classes (`draft.genPlayers`, so the regenerator, college stats and trait seeds run as in a league), real `player.develop` with each team's 3-season coaching level, the real coaching staff market (`staff.runOffseason` / `onPreseason`), real retirement (`player.shouldRetire`), unretirements and the upstream injury ratings-loss rule. Games are not played: injuries are drawn per player-season (calibrated to the full engine, ~1 per rostered player; traits and injury depth change the rate through their real multipliers), team records come from roster strength, the top 60 prospects are drafted, and teams keep their 13 most valuable players and fill from free agency. 30 seasons per run, ~1 minute without the regenerator.
- **Full engine** (`harness.ts`, `run.script.test.ts`): the whole game (game sim, phases, draft, free agency, every League extras hook) in memory on the test cache, driven by auto play. Used to calibrate the population model and to compare stats, but too slow on the shared test machine for long runs (minutes per season).

Configs: `off` (every new feature at its existing-league default, i.e. upstream), `allOn` (new-league defaults, plus the regenerator and unretirements, which are opt-in even for new leagues), and one switch at a time. `*FixedRef` configs measure the coaching staff before the fix. Seeds 1-3 (2 for some single toggles). Metrics are recorded at the end of every regular season.

## Results

Late = mean of seasons 25-29, ± standard error of the seed means (seeds in brackets). Year 0 of every config is the same league (ovr 50.4-50.7).

| metric                         | off (upstream)   | allOn            | allOn before fix | staff            | staff before fix | regen            | college          | injuryDepth      | traits           | unretire         |
| ------------------------------ | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- |
| mean ovr                       | 50.03 ± 0.47 [3] | 50.16 ± 0.42 [3] | 49.68 ± 0.05 [2] | 49.46 ± 0.09 [3] | 49.75 ± 0.10 [3] | 49.11 ± 0.27 [2] | 49.62 ± 0.59 [3] | 50.10 ± 0.62 [3] | 49.63 ± 0.34 [2] | 49.63 ± 0.11 [2] |
| ovr SD                         | 9.90             | 10.13            | 10.27            | 10.43            | 10.32            | 10.05            | 10.46            | 10.11            | 10.29            | 10.30            |
| mean pot                       | 56.70 ± 0.48     | 56.68 ± 0.38     | 56.48            | 56.30            | 56.54            | 55.93            | 56.29            | 56.69            | 56.25            | 56.31            |
| top-10 ovr                     | 70.5 ± 0.7       | 71.5 ± 0.4       | 71.6 ± 1.6       | 72.0 ± 1.5       | 72.7 ± 0.7       | 71.0             | 72.8 ± 0.5       | 71.3 ± 1.2       | 71.5             | 72.3             |
| top-50 ovr                     | 64.9 ± 0.6       | 65.4 ± 0.2       | 65.3             | 65.4             | 66.0             | 64.6             | 65.7             | 65.5             | 65.3             | 65.5             |
| players 70+                    | 6.5 ± 1.5        | 6.4 ± 0.6        | 6.3              | 7.5 ± 2.3        | 9.1 ± 1.1        | 6.7              | 8.6 ± 1.3        | 6.5              | 6.6              | 8.6              |
| players 75+                    | 0.9              | 1.8              | 2.2              | 2.9              | 2.4              | 1.4              | 2.7              | 1.7              | 1.6              | 1.5              |
| players 80+                    | 0.0              | 0.5              | 0.6              | 0.2              | 0.7              | 0.1              | 0.5              | 0.7              | 0.3              | 0.9              |
| 2nd-year class ovr             | 38.96            | 38.58            | 38.86            | 38.46            | 38.58            | 38.19            | 38.52            | 38.75            | 38.67            | 38.82            |
| 2nd-year class pot             | 58.55            | 58.00            | 58.50            | 58.02            | 58.15            | 57.94            | 58.43            | 58.45            | 58.13            | 58.52            |
| next class, top-30 ovr         | 38.38            | 37.90            | 38.60            | 38.10            | 38.42            | 38.24            | 38.13            | 38.61            | 37.94            | 38.61            |
| ovr, ages 19-22                | 41.80            | 41.65            | 41.08            | 40.79            | 41.06            | 40.71            | 40.97            | 41.59            | 41.02            | 41.00            |
| ovr, ages 23-26                | 52.03            | 52.00            | 51.86            | 51.71            | 51.87            | 50.93            | 51.75            | 52.41            | 51.74            | 51.77            |
| ovr, ages 27-30                | 54.70            | 54.87            | 54.88            | 54.15            | 54.68            | 53.77            | 54.22            | 54.94            | 54.43            | 54.33            |
| ovr, ages 31-34                | 51.98            | 52.81            | 52.04            | 52.45            | 52.84            | 52.10            | 52.38            | 51.73            | 51.82            | 51.78            |
| coaching effect, league mean   | 0.000            | 0.000            | +0.020           | 0.000            | +0.020           | 0.000            | 0.000            | 0.000            | 0.000            | 0.000            |
| ratings-loss injuries / season | 3.4              | 3.8              | 4.2              | 2.9              | 3.9              | 3.1              | 4.3              | 3.9              | 3.1              | 4.2              |

How big is noise? The three `off` seeds alone end 1.4 ovr apart (the league mean wanders by ±1 over decades in upstream too), and top-10 / 70+ counts swing by 2-3 between seasons. Every difference above is within about 2 standard errors of `off`, with no consistent sign across metrics, except the coaching effect row.

Charts (`tools/ratingInflation/output/inflation.png`): league mean ovr and pot, top-10, players 70+, second-year class ovr, the league-mean coaching development effect, ages 23-26 ovr and team ovr SD, per season, mean over seeds. Team ovr SD grows in every config including `off`: that's the population model's simple free agency (teams fill in a fixed order), not a feature effect.

All data: `tools/ratingInflation/output/seasons.csv` (every config/seed/season), `summary.csv` / `summary.md` (early vs late, vs off).

### Coaching staff: the drift and the fix

The staff's development score was turned into a coaching budget level against a fixed reference score (`STAFF_DEV_SCORE_REF = 57`, the calibrated average of the initial hires). But the coach pool isn't stationary: young coaches improve (+1.2 a year until 45), the market sorts the best coaches onto teams, and the pool is replenished with new (60% young, slightly weaker) coaches. Measured with the real staff market (`staffDrift.script.test.ts`, 5 seeds × 40 offseasons, `output/staffDrift-fixedRef.csv`):

| offseasons                                      | 0      | 5     | 10     | 15     | 20     | 25     | 30     | 40     |
| ----------------------------------------------- | ------ | ----- | ------ | ------ | ------ | ------ | ------ | ------ |
| league mean level (default 34), fixed reference | 27.7   | 34.9  | 41.5   | 43.7   | 45.3   | 42.8   | 38.5   | 41.3   |
| league mean `coachingEffect`, fixed reference   | -0.019 | 0.000 | +0.014 | +0.016 | +0.019 | +0.015 | +0.006 | +0.011 |
| league mean level, normalized (now)             | 34.4   | 35.1  | 35.4   | 35.8   | 35.8   | 36.2   | 35.7   | 35.6   |
| league mean `coachingEffect`, normalized (now)  | 0.000  | 0.000 | -0.001 | -0.001 | 0.000  | -0.002 | -0.001 | -0.001 |

`coachingEffect` scales every player's yearly rating changes (×(1 ± effect)), so a new league with a staff had every team's progs ~2% worse than an existing league's (deflation of young players: ages 19-22 ovr -0.7 to -1.0 in the table), and from about season 8 on every team's were ~2% better (inflation), for good. Upstream AI coaching budgets are centered on neutral by construction.

**Fix** (`src/common/staff.ts`, `src/worker/core/staff/index.ts`): the reference is now the league's average staff dev score at the time levels are synced (`getLeagueStaffDevScoreRef`), so the average staff has effect 0 and only the spread across teams matters, like budgets. Spread across teams is unchanged (level SD ~20). The fixed constant stays as the fallback without teams. It only applies with `coachingStaff` on (it's how that setting computes levels); with it off nothing changes. Re-measured above: league mean effect 0.000 every season, and ratings in the `staff` / `allOn` runs match `off`.

### Stats (full engine)

Ratings feed the game sim, so a ratings drift would show up as a stats drift; with no ratings drift there is none to measure over decades. What the features do change is the stats level, from the first game, not over time (full engine, seed 1, same league):

| season | config | mean ovr | pts/g  | FG%   | 3P%   | 3PA/g | possessions/g | injuries |
| ------ | ------ | -------- | ------ | ----- | ----- | ----- | ------------- | -------- |
| 1      | off    | 50.29    | 104.45 | 43.86 | 34.39 | 29.21 | 102.84        | 430      |
| 1      | allOn  | 50.16    | 102.77 | 43.33 | 33.80 | 28.95 | 102.53        | 472      |
| 2      | allOn  | 49.25    | 102.78 | 43.40 | 33.88 | 28.69 | 102.59        | 461      |

The -1.7 pts/g and -0.5 FG% are the realistic possession model and the traits in the sim (documented with those features), stable from season to season. Injuries are ~10% higher with injury depth + traits in the full engine; at ~4 ratings-loss injuries a season that's < 0.05 ovr of league mean.

## Regression tests

- `src/test/ratingInflation/ratingInflation.test.ts` (runs with the normal suite, ~15 s): a league with every rating-related feature on, 4 seasons of the population model: mean ovr stays in 48-52.5, pot in 54.5-59.5, and the league mean `coachingEffect` stays within ±0.005 every season (it was -0.02 in a new league with the fixed reference).
- `src/worker/core/staff/staff.test.ts`, "league-average development effect doesn't drift over decades": 30 offseasons of the real staff market, league mean `levelToEffect` within ±0.08 every season (it was -0.2 → +0.2 with the fixed reference).

## Re-running

Population model (the main audit), configs from `src/test/ratingInflation/toggles.ts`:

```sh
RUN_RATING_INFLATION=1 RI_CONFIGS=off,allOn,staff,staffFixedRef RI_SEEDS=1,2,3 RI_SEASONS=30 RI_OUT=/tmp/ri \
  node_modules/.bin/vitest run --project basketball src/test/ratingInflation/pop.script.test.ts
python3 tools/ratingInflation/analyze.py /tmp/ri tools/ratingInflation/output   # needs matplotlib
```

Full engine (slow): same variables with `run.script.test.ts`. Staff level drift: `staffDrift.script.test.ts` (`RI_STAFF_OUT`). Regenerated prospects' development: `regenDev.script.test.ts` (`RI_REGEN_OUT`, output in `output/regenDev.csv`).

## Limits

- The population model doesn't play games: injuries, records, the draft order and free agency are simplified. Every rating-changing code path is the real one, and its baseline is flat over 30 seasons (it was checked against the full engine for the first seasons: same ovr, class strength and injury counts), but effects that only act through game results (minutes, awards) are outside it.
- Injury depth's re-injury and back-to-back factors are not in the population model's injury draw (only its normalization and prone players), so it shows ~10% fewer injuries where the full engine shows ~10% more. Either way the ratings impact is far below noise.
- Three seeds can rule out drifts of about ±1 ovr in the league mean (and ±1.5 in top-10), not smaller ones. Smaller biases need a mechanism to be found, as with the coaching staff, which was found from its development effect, not from the ratings.
