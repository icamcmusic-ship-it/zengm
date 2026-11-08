# Player traits (basketball)

Twelve 0-100 traits per player that the pure game sim can read directly. Nothing here depends on play-by-play: the sim computes with the numbers, the play-by-play only describes the results. Basketball only, behind the league setting **Player Traits** (`playerTraits`; off for existing leagues, on for new ones).

Code: `src/common/playerTraits/` (pure, no worker/DB/`g` access) and `src/worker/core/player/traits.ts` (reads `g` and the player). Calibration test: `src/worker/core/player/playerTraits.test.ts`. Pure tests: `src/common/playerTraits/*.test.ts`.

## Data model

- `p.traits` holds one small random component per trait (`clutchSeed`, `consistencySeed`, `durabilitySeed`, `shotDisciplineSeed`, `offBallSeed`, `screenSeed`, `hustleSeed`, `foulDisciplineSeed`, `recoverySeed`, `handleSeed`, `lateGameIqSeed`, `leadershipSeed`): roughly standard normal, two decimals, within +-3 when generated (+-8 allowed from the God Mode editor).
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

Visibility only matters for scouting (below). The sim always uses the true scores.

## API for the sim (what part 2 wires into GameSim)

```ts
import { player } from "../core/index.ts"; // worker side
const effects = player.getSimTraitEffects(p); // TraitEffects | undefined
```

- `getSimTraitEffects(p, season?)` returns `undefined` when the setting is off. **When undefined the sim must not draw any extra random number and must use the old formulas**, so it is byte-for-byte today's behaviour. Call it once per player per game when building the game's players (e.g. in `loadTeams`), keep the result on the sim player (`p.traitEffects`).
- `traitEffects(scores)` (common) builds the same object from scores; `NEUTRAL_EFFECTS` is the all-neutral object. For code that wants "always an object", use `effects ?? NEUTRAL_EFFECTS`; every hook returns exactly its neutral value for it.
- `player.getTraitInjuryRateMultiplier(p)` is the only thing the injury code needs: multiply the per-possession injury rate by it. It is `1` with the setting off.

Every hook is linear in `z = clamp((score - 50) / 40, -1, 1)`, so 50 is exactly neutral and positive z is the good end. Situation objects are `{ scoreDiff, timeLeft, period, numPeriods? }`: `scoreDiff` is points for the team in question minus points against, `timeLeft` is seconds left in the period, `period` is 1-based (5+ is overtime).

| Hook                             | Where to apply                                                                                                                         | Neutral  | Range                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------- |
| `clutchShotModifier(sit)`        | add to a field goal's make probability                                                                                                 | 0        | +-0.04                                                     |
| `clutchFtModifier(sit)`          | add to a free throw's make probability                                                                                                 | 0        | +-0.05                                                     |
| `clutchTurnoverMult(sit)`        | multiply turnover probability                                                                                                          | 1        | 0.85-1.15                                                  |
| `gameFormShotDelta(gameZ)`       | add to his shot make probability; `gameZ` is one standard normal draw per player per game                                              | 0        | +-0.03 * varianceScale * gameZ                             |
| `varianceScale`                  | already inside `gameFormShotDelta`; use for any other per-game noise                                                                   | 1        | 0.6-1.4                                                    |
| `shotSelectionBias(usage)`       | `usage` = composite usage 0-1. Multiply his shot-attempt weight by `attemptWeightMult`, add `shotQualityDelta` to his make probability | `{1, 0}` | weight 0.6-1.4, quality +-0.06 at usage 1                  |
| `spacingContribution`            | add to the team's `synergy.off` for each such player on the court (before `synergyFactor`)                                             | 0        | +-0.06                                                     |
| `screenContribution`             | add to the team's `synergy.off` per player on the court                                                                                | 0        | +-0.06                                                     |
| `screenShotDelta`                | add to make probability of his own shots that come off a screen/roll/pop                                                               | 0        | +-0.02                                                     |
| `looseBallBonus`                 | multiply his weight in loose-ball, deflection, off-ball steal and charge-drawn events                                                  | 1        | 0.8-1.2                                                    |
| `foulProneness`                  | multiply his personal foul probability                                                                                                 | 1        | 0.75-1.25                                                  |
| `gambleStealMultiplier`          | multiply his steal probability (gamblers steal more, stay-at-home players less)                                                        | 1        | 0.88-1.12                                                  |
| `energyRecoveryRate`             | multiply the energy he regains per minute on the bench (the `min * 0.094` term)                                                        | 1        | 0.85-1.15                                                  |
| `pressureTurnoverMult(pressure)` | `pressure` 0-1 (defence's pressure on the ball handler); multiply his turnover probability                                             | 1        | 0.8-1.2 at pressure 1                                      |
| `lateGameDecisionQuality(sit)`   | add to the probability that the correct end-of-game decision is made (foul when behind, hold for the last shot, two-for-one)           | 0        | +-0.12, 0 outside the last four minutes of the last period |
| `chemistryContribution`          | feed the on-court values to `teamChemistryBonus(list)`; add the result to every team composite rating (`1 + bonus`)                    | 0        | bonus +-0.015                                              |
| `injuryRateMultiplier`           | via `getTraitInjuryRateMultiplier`                                                                                                     | 1        | 0.7-1.3                                                    |

Team helpers: `teamChemistryBonus(contributions)` (bounded, tanh, symmetric), `teamLateGameDecisionQuality(effects, sit)` (ball handler first, weights 0.4/0.2/0.15/0.15/0.1), `sumHook(effects, hook)`. Situation weights (`clutchSituationWeight`, `lateGameSituationWeight`) are exported if the sim wants them directly.

Amplitudes live in `EFFECT_AMPLITUDES` (single place to tune).

### Notes for part 2

- `gameFormShotDelta` needs a per-player per-game normal draw. Draw it only when `effects` is defined, so traits-off consumes exactly the same random numbers as before. Neutral players have `varianceScale` 1, so with traits on every player gets game-to-game noise of sd 0.03; this adds variance but no bias.
- Make probabilities should be clamped after adding the deltas.
- The sim should read effects only; `PlayByPlay` may mention them in flavor text but must not change any result (`outcomeInvariance.test.ts` guards this).

## Calibration (neutrality)

The goal: with traits mean-zero distributed, league-wide averages of points, FG%, turnovers, fouls, injuries do not move. Because every hook is linear in z, this reduces to the average z being 0 over the players who actually play. Per-trait `CALIBRATION_OFFSETS` in `scores.ts` shift scores so the average rotation player (top 300 by ovr in a generated 30 team league, with the league's age/experience mix) is 50. `playerTraits.test.ts` regenerates leagues and asserts:

- mean score of every trait within 2 points of 50, mean z within 0.06;
- mean of every hook at its neutral value (injury 1 +-0.02, foul 1 +-0.02, loose ball 1 +-0.012, clutch shot 0 +-0.002, ...);
- usage-weighted mean `shotQualityDelta` within 0.002 of 0 and mean attempt weight 1 +-0.025 (shot selection is weighted by usage squared);

and `src/common/playerTraits/playerTraits.test.ts` does the same Monte Carlo on the pure functions (20,000 players), plus exact neutrality at score 50 / traits off, bounds for every score 0-100 and every situation, determinism, seed distribution, drift stationarity.

If the ratings generator or the league's age mix changes a lot, rerun the calibration (temporary test printing mean scores) and update `CALIBRATION_OFFSETS` and `REFERENCE_RATINGS`.

## Scouting uncertainty

Prospects' traits are partly hidden. `traitUncertainty` gives an sd in score points: prospects 16 (hidden traits) or 7 (visible traits), scaled 0.6x (best scouting budget) to 1.4x (worst) by the user's scouting level; rookies' hidden traits 8, shrinking to 0 over three seasons; visible traits are exact once drafted. The reading is `trueScore + fixedUnit * sd` (the unit is seeded by league seed, pid and trait, within +-2, so it never flickers), shown with an 80% band. God Mode shows the truth. Same logic feeds the player page, Draft Scouting and Advanced Player Search.

## UI

- Player page: **Traits** section (badges, bars with scouting range, plain-language descriptions, "How traits affect games").
- Draft Scouting: a **Traits** column with badges (`?` for estimates) and an optional single trait column.
- Advanced Player Search: a **Traits** category for filters (`trait:<key>` columns, 0-100) and for "show" columns.
- Customize Player (God Mode): sliders for all twelve scores; they move the stored seeds so the score lands on the chosen value.
- Table columns `trait:<key>` exist in `getCols` for any table that wants them.
- Settings: Game Simulation > **Player Traits**.
