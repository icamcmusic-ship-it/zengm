# Player traits (basketball)

Thirteen 0-100 traits per player that the pure game sim can read directly. Nothing here depends on play-by-play: the sim computes with the numbers, the play-by-play only describes the results. The traits are wired into the game sim (see "How the sim uses the traits"). Basketball only, behind the league setting **Player Traits** (`playerTraits`; off for existing leagues, on for new ones).

Code: `src/common/playerTraits/` (pure, no worker/DB/`g` access) and `src/worker/core/player/traits.ts` (reads `g` and the player). Calibration test: `src/worker/core/player/playerTraits.test.ts`. Pure tests: `src/common/playerTraits/*.test.ts`.

## Data model

- `p.traits` holds one small random component per trait (`clutchSeed`, `consistencySeed`, `durabilitySeed`, `shotDisciplineSeed`, `offBallSeed`, `screenSeed`, `hustleSeed`, `foulDisciplineSeed`, `recoverySeed`, `handleSeed`, `lateGameIqSeed`, `leadershipSeed`, `veteranSavvySeed`): roughly standard normal, two decimals, within +-3 when generated (+-8 allowed from the God Mode editor).
- The 0-100 score is **derived, never stored**: `score = 50 + calibration offset + rating part + age/experience part + 12 * seed`, rounded and clamped. The rating part is `0.9 * sum(weight * (rating - league rotation average))`. So ratings changes flow through, and existing leagues need no migration: a missing `p.traits` (or a missing key) is derived on the fly from league seed + pid and written the first time the player is touched (`ensureTraits`).
- League seed: game attribute `playerTraitsSeed` (set once at league creation, 0 for older leagues). Seeds are `hash(leagueSeed, pid, trait)`, so deterministic and independent per trait. New draft prospects get them in `genPlayers`, league creation players in `finalizeActivePlayers`, God Mode created players on save.
- League export/import carries `p.traits` and the `playerTraits`/`playerTraitsSeed` game attributes with no extra code (whole player rows are exported). Junk in a hand-edited file is repaired by `ensureTraits`.
- Slow change: scores depend on age and experience (clutch, late-game IQ, leadership, shot/foul discipline rise with experience; durability, recovery and late-career hustle fall with age). Each preseason `developTraits` also moves every seed by a deterministic mean-reverting step (rho 0.95, about 4 points a year, population stays standard normal). Hooked in `newPhasePreseason` right after `player.develop`.

## Traits

| Key              | Name                  | Visibility | Rating inputs                                                 |
| ---------------- | --------------------- | ---------- | ------------------------------------------------------------- |
| `clutch`         | Clutch                | hidden     | oiq, tp, ft, fg, pss; grows with experience                   |
| `consistency`    | Consistency           | hidden     | oiq, diq, ft, endu, drb; older = steadier                     |
| `durability`     | Durability            | hidden     | endu, stre, -hgt; falls with age                              |
| `shotDiscipline` | Shot discipline       | visible    | oiq, ft, fg, pss; grows with experience                       |
| `offBall`        | Off-ball movement     | visible    | oiq, spd, tp, jmp, endu                                       |
| `screen`         | Screens and roll/pop  | visible    | stre, hgt, oiq, ins, reb                                      |
| `hustle`         | Hustle                | visible    | endu, spd, diq, stre, jmp, reb; falls after 31                |
| `foulDiscipline` | Foul discipline       | visible    | diq, oiq, stre, endu; grows with experience                   |
| `recovery`       | Recovery              | hidden     | endu, stre; falls with age                                    |
| `handle`         | Handle under pressure | visible    | drb, pss, oiq, spd                                            |
| `lateGameIq`     | Late-game IQ          | hidden     | oiq, diq, pss; grows with experience                          |
| `leadership`     | Leadership            | hidden     | oiq, diq, pss, endu, stre, drb; grows with experience and age |
| `veteranSavvy`   | Veteran savvy         | visible    | oiq, diq, pss; grows with pro seasons played, plateau at 9    |
| `workEthic`      | Work ethic            | hidden     | none (personality)                                            |
| `bigGame`        | Big-game              | hidden     | none (personality)                                            |
| `ego`            | Ego (locker room)     | hidden     | none (personality)                                            |
| `temper`         | Temper                | visible    | none (personality); calms 0.4/year after 27                   |

Plus one secret, non-key "trait": the **aging curve** (below), never shown until retirement.

Visibility only matters for scouting (below). The sim always uses the true scores.

## Veteran savvy (13th trait)

Code: `src/common/playerTraits/veteran.ts` (pure), `getTraitProSeasons` / `getMentorBonuses` in `src/worker/core/player/traits.ts`, the `mentor` argument of `player.develop`. Tests: `src/common/playerTraits/veteran.test.ts`.

- **Score:** `50 - 4.5 + 0.9 * (0.4 oiq + 0.4 diq + 0.2 pss vs reference) + curve(proSeasons) - curve(4) + 12 * seed`. `curve(n) = 30 * (1 - (1 - min(n, 9) / 9)^2)`: 0 for a rookie, ~16 after 3 seasons, ~27 after 6, flat at 30 from 9. Pro seasons = completed regular seasons with gp > 0 from `getProStats` (pre-draft/college rows excluded, current season excluded); seasons between the draft year and the league's `startingSeason` with no stats row count as played (random-players leagues have no stats before the league starts). Prospects 0.
- **Sim effects** (added on top of the existing hooks, so `GameSim` needed no change; z as usual): late-game decision quality `+0.04 z`, clutch shot `+0.012 z` and clutch FT `+0.015 z` (times the clutch weight), clutch turnovers `-0.05 z` (times clutch weight), pressure turnovers `-0.05 z` (times pressure), foul proneness `-0.06 z` (so `foulProneness` is now within 0.69-1.31), chemistry contribution `+0.35 z` (clamped to +-1). Amplitudes `veteran*` in `EFFECT_AMPLITUDES`.
- **Mentoring:** at each preseason (`newPhasePreseason`, not in repeat-season mode), every team's raw mentoring is `0.5 * min(1, (s1 + 0.5 s2) / 0.75)` where s1, s2 are the two best `max(0, z - 0.25)` among its players over 23 (scores of the season just finished). Each young player (age <= 23 in the new season, on a team) gets his team's raw value minus the mean over all such players in the league, so the bonus averages exactly 0 over mentees and is within +-0.5. `player.develop(p, 1, false, coaching, false, {bonus, seed})` applies it after the normal development: with probability |bonus| (seeded by `mentor|leagueSeed|pid|season`, no Math.random) every rating but height moves one point in its direction, about one ovr point. So the expected ovr change is the bonus, deterministic, and nothing at all happens with the setting off.
- **Scouting:** visible trait: prospects have the visible-trait uncertainty, exact (sd 0) from the rookie season on.
- **Badges:** `veteranSavvyBadgeScore(score)` (0 below 60, 1 at 90) is exported for the skill badge system; no badge is added here.

## Work ethic, aging curve, big-game, ego, temper

Personality traits: no ratings part, calibration offset 0 (so the minutes-weighted average is 50), seeds like the others (`workEthicSeed`, `bigGameSeed`, `egoSeed`, `temperSeed`; generated deterministically from league seed + pid, backfilled by `completeTraitSeeds` in existing leagues without moving the other seeds, drifting yearly). Code: `common/playerTraits/development.ts`, `ego.ts`, `effects.ts`; `getTraitDevelopment`, `getLockerRoomMood`, `getEgoTradeRequestInfo`, `getRevealedAgingCurve` in `worker/core/player/traits.ts`. Tests: `worker/core/player/traitsFive.test.ts`, `worker/core/GameSim.basketball/traitsFive.test.ts`.

- **Work ethic** (development, preseason only): adds `z` (24 and under) or `0.5 z` (older) rating points to the yearly base change in `developSeason.basketball.ts`, and multiplies the negative part of the year's random noise by `1 - 0.35 z` (smaller bad-roll drops for gym rats, bigger for lazy players). z is centered on the players developing that preseason (`centerDevelopment`), so the league's average development is unchanged (no rating inflation; checked by `ratingInflation.test.ts`, whose population model now applies it, and by a same-random-numbers with/without test). Same random numbers as without traits. Pot and pro projections never use it.
- **Aging curve (secret):** early bloomer (20%), late bloomer (20%), aged gracefully (15%), normal (45%). Adds an age-dependent amount to the yearly base change (early: +2 at 21 and under, -1 at 26-30; late: -1.5 young, +1.5 at 26-29; graceful: +1 to +1.75 from 30), centered at every age over the shares and again over the league each preseason. **Never stored on the player** (derived from `agingCurve|leagueSeed|pid`), so it is not in `p.traits`, exports, pRaw, Customize Player or any view; pot/projections ignore it; the AI does not value it (weight 0, not a trait key); no badge. `getPlayerTraitsForUI` includes it only for a retired player (also not in God Mode): the Traits page shows it with "Revealed on retirement".
- **Big-game:** in every playoff game (the whole game, `GameSim.bigGame`, not the all-star game): shot make probability `+0.025 z`, free throws `+0.025 z`, his turnovers `x (1 - 0.1 z)`. Nothing in the regular season.
- **Ego:** on-court chemistry contribution `+0.4 z`; a new mood component **Locker room** (`MoodComponents.lockerRoom`) for every player = sum over his would-be teammates (not himself) of `0.6 z`, bounded to -2.5..1.5, 0 with the setting off; trade requests: a star asks at mood `<= -5 - 1.5 z` and with chance `0.25 x (1 - 0.6 z)`.
- **Temper** (visible): technical foul rate `x` the mean `1 - 0.6 z` of all players on the court, his share of technicals and flagrants (on top of the foul weight) `x (1 - 0.6 z)`, flagrant rate `x` the defense's mean `1 - 0.5 z` (only with the Technical Fouls setting); late-game composure added to the clutch hooks: shot `+0.015 z`, FT `+0.02 z`, turnovers `-0.06 z` (times clutch weight).
- **Trash talk (play-by-play text only):** hotheads (temper below 45; more the lower) sometimes talk after a dunk, and-one, three or block, jaw with an opponent after a foul (both hotheads: "words exchanged", refs separating them), and a technical on a player who has been talking (or a real hothead) gets a lead-in ("... has been chirping all night..."). More in the playoffs, a rivalry (when the caller passes it), a close game late, during a big run and once a game is heated; at most 3 lines per player, 8 events apart, no line repeated by a player. `common/pbpFlavor/trashTalk.ts`, one hook in `session.ts`; it uses its own seeded flavor generator stream (never Math.random), so games and the rest of the wording are unchanged. The temper score goes to the text as `pbpRatings.temper` (only with traits on) and is kept in stored play-by-play (store format version 2; version 1 still decodes). Tests: `GameSim.basketball/trashTalk.test.ts`.
- **AI value weights:** work ethic 0.07 (x1.5 at 24 and under, x0.4 at 30+), big-game 0.04 (x1.5 for contenders), ego 0.035, temper 0.025; the others scaled down so the weights still sum to 1.
- **Badges:** Gr gym rat (work ethic >= 70), Bi big-game player (>= 68), Tf team-first (ego >= 70), Ck cool head (temper >= 70); hidden traits only once known exactly.

## API for the sim

```ts
import { player } from "../core/index.ts"; // worker side
const effects = player.getSimTraitEffects(p); // TraitEffects | undefined
```

- `getSimTraitEffects(p, season?)` returns `undefined` when the setting is off. **When undefined the sim must not draw any extra random number and must use the old formulas**, so it is byte-for-byte today's behaviour. Call it once per player per game when building the game's players (e.g. in `loadTeams`), keep the result on the sim player (`p.traitEffects`).
- `traitEffects(scores)` (common) builds the same object from scores; `NEUTRAL_EFFECTS` is the all-neutral object. For code that wants "always an object", use `effects ?? NEUTRAL_EFFECTS`; every hook returns exactly its neutral value for it.
- `player.getTraitInjuryRateMultiplier(p)` is the injury multiplier alone, `1` with the setting off (the sim reads it from `traitEffects.injuryRateMultiplier`).

Every hook is linear in `z = clamp((score - 50) / 40, -1, 1)`, so 50 is exactly neutral and positive z is the good end. Situation objects are `{ scoreDiff, timeLeft, period, numPeriods? }`: `scoreDiff` is points for the team in question minus points against, `timeLeft` is seconds left in the period, `period` is 1-based (5+ is overtime).

| Hook                             | Where to apply                                                                                                                         | Neutral  | Range                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| `clutchShotModifier(sit)`        | add to a field goal's make probability                                                                                                 | 0        | +-0.04                                                     |
| `clutchFtModifier(sit)`          | add to a free throw's make probability                                                                                                 | 0        | +-0.05                                                     |
| `clutchTurnoverMult(sit)`        | multiply turnover probability                                                                                                          | 1        | 0.85-1.15                                                  |
| `gameFormShotDelta(gameZ)`       | add to his shot make probability; `gameZ` is one standard normal draw per player per game                                              | 0        | +-0.03 _ varianceScale _ gameZ                             |
| `varianceScale`                  | already inside `gameFormShotDelta`; use for any other per-game noise                                                                   | 1        | 0.6-1.4                                                    |
| `shotSelectionBias(usage)`       | `usage` = composite usage 0-1. Multiply his shot-attempt weight by `attemptWeightMult`, add `shotQualityDelta` to his make probability | `{1, 0}` | weight 0.6-1.4, quality +-0.06 at usage 1                  |
| `spacingContribution`            | add to the team's `synergy.off` for each such player on the court (before `synergyFactor`)                                             | 0        | +-0.06                                                     |
| `screenContribution`             | add to the team's `synergy.off` per player on the court                                                                                | 0        | +-0.06                                                     |
| `screenShotDelta`                | add to make probability of his own shots that come off a screen/roll/pop                                                               | 0        | +-0.02                                                     |
| `looseBallBonus`                 | multiply his weight in loose-ball, deflection, off-ball steal and charge-drawn events                                                  | 1        | 0.8-1.2                                                    |
| `foulProneness`                  | multiply his personal foul probability                                                                                                 | 1        | 0.69-1.31 (incl. veteran savvy)                            |
| `gambleStealMultiplier`          | multiply his steal probability (gamblers steal more, stay-at-home players less)                                                        | 1        | 0.88-1.12                                                  |
| `energyRecoveryRate`             | multiply the energy he regains per minute on the bench (the `min * 0.094` term)                                                        | 1        | 0.85-1.15                                                  |
| `pressureTurnoverMult(pressure)` | `pressure` 0-1 (defence's pressure on the ball handler); multiply his turnover probability                                             | 1        | 0.8-1.2 at pressure 1                                      |
| `lateGameDecisionQuality(sit)`   | add to the probability that the correct end-of-game decision is made (foul when behind, hold for the last shot, two-for-one)           | 0        | +-0.12, 0 outside the last four minutes of the last period |
| `chemistryContribution`          | feed the on-court values to `teamChemistryBonus(list)`; add the result to every team composite rating (`1 + bonus`)                    | 0        | bonus +-0.015                                              |
| `injuryRateMultiplier`           | via `getTraitInjuryRateMultiplier`                                                                                                     | 1        | 0.7-1.3                                                    |

Team helpers: `teamChemistryBonus(contributions)` (bounded, tanh, symmetric), `teamLateGameDecisionQuality(effects, sit)` (ball handler first, weights 0.4/0.2/0.15/0.15/0.1), `sumHook(effects, hook)`. Situation weights (`clutchSituationWeight`, `lateGameSituationWeight`) are exported if the sim wants them directly.

Amplitudes live in `EFFECT_AMPLITUDES` (single place to tune).

### Notes

- `gameFormShotDelta` needs a per-player per-game normal draw. Draw it only when `effects` is defined, so traits-off consumes exactly the same random numbers as before. Neutral players have `varianceScale` 1, so with traits on every player gets game-to-game noise of sd 0.03; this adds variance but no bias.
- Make probabilities should be clamped after adding the deltas.
- The sim should read effects only; `PlayByPlay` may mention them in flavor text but must not change any result (`outcomeInvariance.test.ts` guards this).

## How the sim uses the traits (GameSim.basketball, part 2)

`loadTeams` sets `p.traitEffects = player.getSimTraitEffects(p)` once per game for every player (undefined with the setting off). `GameSim` has `traitsOn` (true when any player has effects), and everything below is behind it, so **with the setting off the sim uses its old formulas, draws no extra random numbers and is byte-for-byte what it was** (`outcomeInvariance.test.ts`). With it on, the only new random draw is one standard normal per player per game (`gameZ`, drawn in the GameSim constructor, for game form). Nothing here touches `PlayByPlayLogger`, `pbpFlavor` or `game.pbp`: the sim computes with its own numbers (score, clock, ratings, energy), and `playerTraitsSim.test.ts` checks that a seeded game gives the identical box score with play-by-play logging off (`storePlayByPlay` false, `doPlayByPlay` false), stored and live, with the possession model, technical fouls and injury depth on or off. The effect objects are removed from the result at the end of `run()`.

| Hook                                                       | Where it is applied                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `clutchShotModifier(situation)`                            | `getShotInfo`: added to the shooter's make probability (`traitShotDelta`)                                                                                                                                                                                                                                                 |
| `clutchFtModifier(situation)`                              | `freeThrowProb` (used by `doFt` and the technical/flagrant free throws)                                                                                                                                                                                                                                                   |
| `clutchTurnoverMult(situation)`, `pressureTurnoverMult(p)` | `probTov`: the offense's turnover probability times the mean of both over its players on the court; also the weight of each player in the "who turned it over" draw. Pressure is the defense's perimeter defense mapped to 0-1 (`traitPressure`)                                                                          |
| `gameFormShotDelta(gameZ)`, `varianceScale`                | `getShotInfo`: added to his make probability. `gameZ` is his draw for this game, so volatile players (low consistency) swing more; steady ones less. Mean zero                                                                                                                                                            |
| `shotSelectionBias(usage)`                                 | Weight multiplier in the "who shoots" draw (`pickPlayer("usage")`, `ratingArray`) and make probability delta in `getShotInfo`: gunners (low shot discipline) take more shots at a lower make probability                                                                                                                  |
| `screenShotDelta`                                          | `getShotInfo`: assisted jumpers and finishes (the plays that come off a screen, roll or pop)                                                                                                                                                                                                                              |
| `spacingContribution`, `screenContribution`                | `updateSynergy`: added to the team's `synergy.off` for every player on the court (so it flows through `synergyFactor` into shot quality, dribbling and passing composites)                                                                                                                                                |
| `looseBallBonus`                                           | Weight in the rebounding and stealing draws (who gets the loose ball or the deflection), team totals unchanged                                                                                                                                                                                                            |
| `foulProneness`                                            | Weight in the fouling draw (who fouls), and the defense's foul probabilities (`probNonShootingFoul`, the shooting foul factor in `getShotInfo`) times the mean over its players on the court                                                                                                                              |
| `gambleStealMultiplier`                                    | `probStl` times the mean over the defenders; also the weight in the stealing draw                                                                                                                                                                                                                                         |
| `energyRecoveryRate`                                       | `updatePlayingTime`: the energy regained per minute on the bench                                                                                                                                                                                                                                                          |
| `lateGameDecisionQuality(situation)`                       | `applyLateGameDecision`: when the sim decides to foul when behind, hold for the last shot or play for a 2-for-1, the team (ball handler weighted most) makes the right call with probability `1 - 0.06 * lateGameSituationWeight + quality`; else it plays the possession normally. Nothing outside the last four minutes |
| `chemistryContribution`                                    | `updateTeamCompositeRatings`: `teamChemistryBonus` of the players on the court multiplies every team composite rating                                                                                                                                                                                                     |
| `injuryRateMultiplier`                                     | `injuries()`: times the injury depth factor (`injuryRiskFactor`) and the base rate                                                                                                                                                                                                                                        |

Possession model: the realistic possession model's `Traits` (possessionModel.ts) are now derived from the real traits of the players on the court (`deriveTraits`): `shotDiscipline` scales the chance that a late-clock crisis ends in a violation (violationTendency), `consistency` (the team's mean `varianceScale`) scales how spread out half-court search times are. The old multiplicative clutch hook is the real `clutchShotModifier` now, which also works without the possession model.

The situation passed to the hooks is built from the sim's own state: `scoreDiff` = the team's points minus the other team's, `timeLeft` = `this.t`, `period` = the number of quarter scores so far (5+ is overtime).

Calibration of the sim-level averages is in `playerTraitsSim.test.ts` (smoke test, 250 games) and `traitsMetrics.ts`; the table for ~1000 or more games: `TRAITS_METRICS=1 TRAITS_METRICS_GAMES=1000 TRAITS_METRICS_OUT=table.txt vitest --run --project basketball src/worker/core/GameSim.basketball/playerTraitsSim.test.ts -t "prints league"`.

## Calibration (neutrality)

The goal: with traits mean-zero distributed, league-wide averages of points, FG%, turnovers, fouls, injuries do not move. Because every hook is linear in z, this reduces to the average z being 0 over the players who actually play (weighted by what the hook affects: minutes on the court, shots taken). Per-trait `CALIBRATION_OFFSETS` in `scores.ts` shift scores so the minutes-weighted average player is 50. That is 1-2 points below the equal-weighted rotation average (top 300 by ovr in a generated 30 team league), because the players who get the minutes are better than the rotation average and the traits correlate with ratings: an earlier calibration to the rotation average showed in the sim as about +0.6% FG%, -0.8% FTA and -0.6% fouls with traits on. `playerTraits.test.ts` regenerates leagues and asserts:

- mean score of every trait within 2 points of 50, mean z within 0.06;
- mean of every hook at its neutral value (injury 1 +-0.02, foul 1 +-0.02, loose ball 1 +-0.012, clutch shot 0 +-0.002, ...);
- usage-weighted mean `shotQualityDelta` within 0.002 of 0 and mean attempt weight 1 +-0.025 (shot selection is weighted by usage squared);

and `src/common/playerTraits/playerTraits.test.ts` does the same Monte Carlo on the pure functions (20,000 players), plus exact neutrality at score 50 / traits off, bounds for every score 0-100 and every situation, determinism, seed distribution, drift stationarity.

The sim level check is `playerTraitsSim.test.ts` / `traitsMetrics.ts`: the same 30-team league and matchups simulated with the setting off and on. 10,000 games each (realisticPossessions off; the run with it on is the same within noise):

| metric            | off    | on     | diff   |
| ----------------- | ------ | ------ | ------ |
| points per team   | 105.45 | 105.56 | +0.10% |
| FG%               | 0.4393 | 0.4405 | +0.27% |
| 3PA / FGA         | 0.3501 | 0.3486 | -0.41% |
| TOV%              | 0.1412 | 0.1415 | +0.19% |
| FT%               | 0.7571 | 0.7553 | -0.25% |
| FTA per team      | 22.83  | 22.82  | -0.05% |
| fouls per team    | 19.32  | 19.30  | -0.13% |
| injuries per game | 0.3037 | 0.3118 | +2.7%  |

(Standard error of a difference at 10,000 games: about 0.15% for points, 0.17% for FG%, 0.2% for the 3PA rate, 0.33% for TOV%, 0.4% for FTA, 2.6% for injuries.) The effects themselves, same run: top-third clutch players' make probability in clutch time +1.9 points, bottom third -0.9 (designed: +-0.04 times z times the situation weight); gunners (bottom third of shot discipline) take 12.2 -> 12.7 shots per 36 minutes at 44.5% -> 43.8%, disciplined players 14.3 -> 13.8 at 43.5% -> 44.3%; the sd of per-game FG% grows by 0.0043 for volatile players and 0.0032 for steady ones.

Veteran savvy check (5,000 games off vs on, 13 traits, offset -4.5): minutes-weighted mean veteran savvy score 49.8 (other traits 49.5-50.6); points 105.39 -> 105.36 (-0.03%), FG% 0.4388 -> 0.4402 (+0.33%), 3PA rate -0.7%, TOV% 0.1409 -> 0.1421 (+0.9%), FT% -0.08%, FTA +0.2%, fouls 19.28 -> 19.31 (+0.17%), injuries -3.1% (standard errors about 1.4x the 10,000-game ones above). Mentoring, 3 generated leagues x 12 preseasons of development (same random streams with mentoring off and on): league mean ovr difference after 12 seasons +0.003, +0.051, +0.018 (mean +0.02), i.e. no inflation.

If the ratings generator or the league's age mix changes a lot, rerun the calibration (temporary test printing mean scores, minutes-weighted over the sim's players) and update `CALIBRATION_OFFSETS` and `REFERENCE_RATINGS`.

## Scouting uncertainty

Prospects' traits are partly hidden. `traitUncertainty` gives an sd in score points: prospects 16 (hidden traits) or 7 (visible traits), scaled 0.6x (best scouting budget) to 1.4x (worst) by the user's scouting level; rookies' hidden traits 8, shrinking to 0 over three seasons; visible traits are exact once drafted. The reading is `trueScore + fixedUnit * sd` (the unit is seeded by league seed, pid and trait, within +-2, so it never flickers), shown as an 80% range. A trait that isn't exactly known is only ever shown as that range with a `?` (`formatTraitReading`, e.g. `48-69?`), never as a single number: the player page bar shows just the range, and the Draft Scouting and Advanced Player Search columns show the range text (sorted and filtered by the hidden estimate). Once known (visible traits after the draft, hidden ones after three seasons, or God Mode) the exact score is shown. Same logic feeds the player page, Draft Scouting and Advanced Player Search. The worker never sends the stored seeds (which give away the true scores) to the UI outside God Mode: the player page view drops the raw player object, and Customize Player leaves out `p.traits` and the trait editor (saving keeps the stored seeds).

## UI

- Player page: a short **Traits** line on the Overview (badges and a link), and its own **Traits** sub-page (`/l/:lid/player_traits/:pid`, in the player page dropdown next to Overview and Game Log): badges, bars with scouting range, descriptions, what each exactly known trait means for him in numbers (`traitEffectSummary`), a trait history table (his current personality with each season's ratings, age and experience; exactly known traits only) and "How traits affect games". The aging curve appears there only once he has retired.
- Draft Scouting: a **Traits** column with badges (`?` for estimates) and an optional single trait column.
- Advanced Player Search: a **Traits** category for filters (`trait:<key>` columns, 0-100) and for "show" columns.
- Customize Player (God Mode): sliders for all seventeen scores; they move the stored seeds so the score lands on the chosen value.
- Table columns `trait:<key>` exist in `getCols` for any table that wants them.
- Settings: Game Simulation > **Player Traits**.
