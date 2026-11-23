# Breakout nights: resume notes (WIP, delete before the final commit)

## Done (uncalibrated, tsc not yet run)
- `src/worker/core/GameSim.basketball/breakout.ts` (constants `BREAKOUT`, pure helpers) + `breakout.test.ts` (passes).
- index.ts hooks (all behind `this.breakout` = shotShareModel on and not an All-Star game; outcomeInvariance passes):
  `breakoutSetup()` (role factor by usage rank, usage form sharing gameZ via a seeded `Rng("breakout|gid|pid")` draw, career night,
  injury and matchup openings folded into `ss.fixed`, role hot hand boost/length), `ssMiss()` (role players' hot hand ends after 2
  straight misses), heater trigger in `doFg`, `nightMake` + `makeCal` in `ssMakeDelta`, bench hot minutes in `adjustMinutes` (benchK
  from `coachAdjust`), `pickHotClosers()` in `getClosers` (non-od path).
- pbpFlavor: `benchHotLine`/`feedHotLine` (calls.ts), session tracks `reserves` (first entry by sub); `benchHot.test.ts`, templates test.
- checkStatisticalFeat.ts: news item for a bench career high of 25+ points (from featLedger's career-high note) when not a feat.
- docs: one sentence in "Coaching adjustments"; the "Breakout nights" section (anchor #breakout-nights) is NOT written yet.
- Measurement script `breakoutNights.script.test.ts` (BREAKOUT=1 ...).

## Left
1. Calibrate: league 3P%/FG% go up (+.003-.005 3P%, +.0015-.003 FG%). Check FLOW means `brkPerim`/`brkInt` (printed at the end of a
   run) vs `perimRef`/`intRef` 0.5 (likely off-center → shooters always boosted); then tune `makeCal`.
2. Rerun 3 seeds x 2 seasons: `scratchpad/brk/run.sh TAG <worktree> 1 2 3`, aggregate `python3 scratchpad/brk/agg.py scratchpad/brk/TAG.s*.jsonl`.
   (scratchpad = /tmp/claude-0/-home-user-zengm/62bff2f9-4ef2-5452-93fa-ec11a08bf280/scratchpad). Runs get OOM-killed under load.
3. tsc (OOM-killed so far), eslint, oxfmt, `node tools/build/cli.ts`, vitest on GameSim.basketball, game, pbpFlavor, playerTraits.
4. Write the docs section, delete this file, final commit.
5. Report: I accidentally deleted a pre-existing `scratchpad/base` directory and `scratchpad/base.jsonl` (another agent's?) early on.

## Measurements so far (2026 preset; per league-season, regular season)
Baseline (brk/base.jsonl, seeds 1-3 x 2 seasons):
- bench (gs 0) 20/25/30+ games: 246/64/14; outside top-3 usage: 939/276/74; outside top-3 scorers: 930/271/69
- pts SD stars 7.89 (CV .381), role 5.00 (CV .564)
- league pts 116.33, FG% .4785, 3P% .3622, AST 27.54, TOV 14.10; leader 32.7 PPG, 25+ PPG 22.3
- MPG by rank 37.3/34.4/31.5/28.5/25.4/21.9/19.2/16.2/12.8/7.9/3.1; bench 20+ pt games avg 24.0 min
v1 (no makeCal, seed 1 season 1 only): bench 374/124/28 (base 258/64/21), role SD 5.65 CV .615, FG% .482 (.479), 3P% .366 (.360).
v2 (makeCal .003, season 1): seed 2 bench 384/122/37, FG% .4811 (.4786), 3P% .3678 (.3631), leader 35.4 (33.7);
  seed 3 bench 375/124/41, FG% .4782 (.4775), 3P% .3629 (.3610).
