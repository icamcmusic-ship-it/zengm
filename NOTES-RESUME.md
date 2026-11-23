# Scoring drift (2026 preset, League Eras off): resume notes

## Done

- Harness: `src/worker/core/league/scoringDrift.script.test.ts` (gated by `SCORING_DRIFT=1`). Creates a new league with the
  new-league defaults + `gameSimPresets[2026]` + `featureLeagueEras: false` (as a new user would: Settings preset, Eras off), spectator,
  plays full seasons. Each season it writes one JSON line: league averages (pts, pace, ORtg, FG%, 3P%, FT%, 3PA rate, FTA rate, TOV, ORB,
  ORB%, rim/mid/post shares), rostered ratings (mean ovr, 60+ share, mean of every rating and sub-rating, top-8-per-team means), 2K badge
  tier counts, coach rating means by role, zone tendency (zt) means, trait seed means, talent cycle value. At probe seasons
  (`SCORING_DRIFT_PROBES`, default 1,10,20,30) it plays fixed preview games (no DB writes) with: base; zone tendencies removed; badges
  removed; coach ratings shifted back to season-1 means by role; player ratings shifted back to season-1 means; all of them. That
  decomposes any drift.
  - Options: `SCORING_DRIFT_SEASONS`, `_SEED`, `_OUT`, `_PROBE_GAMES`, `_GAMES`, `_TEAMS` (<30: one conf/div, 8-team playoffs),
    `_SETTINGS` (JSON on top).
  - Memory: box scores are cleared every season (`saveOldBoxScores` 0 + `idb.cache.games.clear()`).
- `node_modules` symlinked into the worktree (gitignored, not committed).

## Measurements so far

None usable yet. The 30-team runs (seeds 1-2) were OOM-killed (SIGKILL by the shared memory cgroup, ~1.1-1.6 GB RSS, while other agents
were running) during season 1-2. One timing run: season 1 of a 30-team 82-game league took ~107 s wall (contended machine); season 1
(seed 1): 118.2 PPG, pace 102.4, ORtg 115.1, FG% .480, 3P% .363, 3PA rate .419, FTA rate .277, 14.1 TOV, 11.3 ORB.

## Next

1. Run the baseline with fewer teams to fit memory, e.g.
   `NODE_OPTIONS=--max-old-space-size=900 SCORING_DRIFT=1 SCORING_DRIFT_TEAMS=16 SCORING_DRIFT_SEASONS=30 SCORING_DRIFT_SEED=1 SCORING_DRIFT_PROBE_GAMES=160 SCORING_DRIFT_OUT=<scratch>/b16_1.jsonl npx vitest run --project basketball src/worker/core/league/scoringDrift.script.test.ts`
   for seeds 1-3 (one or two at a time). Then confirm PPG drift and read the probes.
2. Suspects reviewed in code (not yet measured):
   - Already league-centered: staff dev score (`getLeagueStaffDevScoreRef`), dev plans (`prepareDevelopment` centers deltas and tilts),
     shooting/S&C coach z (centered), badge cutoffs (recomputed from this season's rotation each preseason).
   - Not centered: coach `off`/`def` strengths in the sim (`common/coachSystems.ts` `z(x) = (x-50)/15`, fixed 50) — creep in head/coordinator
     off vs def ratings would shift makes (offense and defense sides are symmetric, so only an off/def imbalance matters); coach
     progression `staff/index.ts progress` (+1.2/yr under 45) and associate head coach growth (`staff/market.ts`, +0-2/yr to 78).
   - Badge hysteresis/one-tier floor (`common/tieredBadges/compute.ts`) raises steady-state tiers vs a new league, while `BADGE_CAL` was
     measured on new leagues: a level shift within ~5 seasons, not a slow 20-year drift.
   - Zone tendencies (`player/zoneTendencies.ts`): bounded 0.85-1.18, keep 0.7, centered on each player's mix; probe will show.
   - Population composition: the initial random league vs the development process' steady state (skills hold with age under
     realistic aging, athletic ratings decline) may shift offense vs defense ratings over the ~15-20 years the first cohort takes to turn over.
3. Previous agent's ideas (worktree agent-a600d59274d8cd11b, read-only): `recenterHeldTiers` (badge tier counts capped at fresh
   percentile counts +10%), floor within the badge cap, `coachAgeOffset`/`coachRatingDrift` (age curve + 3%/yr reversion to a job's
   generated rating). Borrow if the probes implicate badges/coaches.
4. Then fix, run checks (tsc, eslint, oxfmt, build, vitest basketball on related dirs, stationarity, outcomeInvariance), update
   docs/native-features.md, commit.
