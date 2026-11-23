# Under-the-radar prospects: resume notes (WIP, delete before the final commit)

## Done
- `src/common/collegeStats/radar.ts`: weak production test, low pedigree (rank > 300 / unranked), `getRadarReason` (injury, juco,
  transfer, lateBloomer, youngPro, workouts, combine, tools), `isOffRadar`, `getHsRank` / `hsRankMedian` (recruit rank follows class
  draft stock zStock, late bloomers lower, own stream `|hsRank`), `fitHsRank` (zStock >= -0.9, low pedigree, weak production, no reason ->
  ranked at his median, capped 260; fires ~22 times in 1680 prospects).
- `generate.ts`: stores `career.hsRank` (option `radar`, default paths && context). `career.ts` type `hsRank?: number | null`.
- `worker/core/draft/recruiting.ts`: ranking path uses `career.hsRank` when present (old careers unchanged).
- `worker/core/draft/radar.ts`: `radarInputFor`, `getProspectRadar`, `classCombineAthletic`, `combineAthleticFor`.
- Outlets: `OutletProspect.offRadar` -> every outlet -0.35 sd (`OFF_RADAR_PENALTY`); worker outlet inputs set it.
- Views/UI: `playerPreDraft` `radar` (deduped against story) + alert in `ui/views/PlayerPreDraft/index.tsx`; Big Boards badge + tooltip.
- Tests: new `common/collegeStats/radar.test.ts` (passes); career.test compares careers without hsRank.
- Measurement: `worker/core/draft/underRadar.script.test.ts` (RUN_UNDER_RADAR=1 UNDER_RADAR_LEAGUES=6 UNDER_RADAR_OUT=file),
  analysis script in scratchpad `ur_analyze.mjs`; data `ur_before.json`, `ur_after4.json`.

## Measurements (24 classes, 1680 prospects; weak production AND rank > 300/unranked)
- Before: stock 1-14: 3, 15-30: 22, 31-60: 185 (210 of 1440 top-60 = 14.6%), 61+: 90; none had a reason.
- After: 1-14: 0, 15-30: 0, 31-60: 9 (4 without reason, all at picks 55-60), 61+: 68 (65 off radar).
- By path before (top 60 both): College 209, Overseas 1; after: College 9.
- Reasons (all / top 60): youngPro 73/62, lateBloomer 25/14, tools 20/12, juco 16/10, injury 6/3, transfer 6/1, workouts 3/3.
- Off radar: 92 prospects, 6 in top 60 by stock/consensus.
- HS recruit rank median by stock: picks 1-5: 37 -> 15; 6-14: 100 -> 39; 15-30: 211 -> 76; 31-45: 387 -> 135; 46-60: 558 -> 190.

## Left
- Fix: `tools` text says "production isn't there yet" even when not weak production (e.g. 15 ppg junior, rank 680): give tools/combine
  only when production is weak, or word it differently.
- Run checks: tsc (was OOM-killed under load), eslint, oxfmt, `node tools/build/cli.ts`, vitest on collegeStats, draft, draftOutlets,
  views (draftOutlets.test.ts timed out under load at 138 s; recheck), outcomeInvariance.
- Docs: docs/native-features.md section (Prospect careers / recruiting, Big boards: offRadar penalty).
- Remove this file, final commit (no push).
