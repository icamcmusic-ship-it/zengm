// The athleticism a player generated for a new random-players league has lost to injuries in the seasons he "played" before the league
// started. A league's players lose speed, jumping and endurance (and with Career Aging a little dunking) to long and major injuries every
// season (writePlayerStats), but the players of a new league were developed straight from their draft ratings (createRandomPlayers), so they
// came in more athletic than the same league's players a few seasons later: about 1.5 points of speed and jumping in the rotation, which
// was worth about 1 possession and 1.3 free throw attempts per team game, so a new league's first season scored ~1.5 points more than its
// later ones. This draws the injuries of those seasons with the league's own injury model (types and lengths, about one injury per season at the stock injury rate, scaled by the league's)
// and the same loss rules, from a seeded stream (never Math.random, so the league's random stream is unchanged).
import { Rng } from "../../../common/ratingsBuilds/rng.ts";
import { DEFAULT_LEVEL } from "../../../common/budgetLevels.ts";
import { withRandom } from "../../../common/random.ts";
import { careerAgingOn, injuryAthleticLoss } from "./careerAging.ts";
import injury from "./injury.ts";
import { defaultGameAttributes } from "../../../common/defaultGameAttributes.ts";
import { g } from "../../util/index.ts";

// Injuries per season of a player in the league (every injury, most are a few games: the loss rules below only act on long ones), at
// the stock injury rate (defaultGameAttributes.injuryRate)
export const PAST_INJURIES_PER_SEASON = 1;

// ... scaled by the league's injury rate (new leagues' NEW_LEAGUE_INJURY_RATE is twice the stock one, so its players get hurt twice as often)
export const pastInjuriesPerSeason = () =>
	(PAST_INJURIES_PER_SEASON *
		(g.get("injuryRate") ?? defaultGameAttributes.injuryRate)) /
	defaultGameAttributes.injuryRate;

/**
 * Rating points (positive) lost to injuries over these ages' seasons. seedKey makes the draws unique to the player.
 */
export const pastInjuryLoss = (
	seedKey: string,
	ages: number[],
	season: number,
): Record<string, number> => {
	const rng = new Rng(`pastInjuries|${seedKey}`);
	const random = () => rng.random();
	const total: Record<string, number> = {};
	const add = (key: string, x: number) => {
		total[key] = (total[key] ?? 0) + x;
	};
	const career = careerAgingOn();
	let n = 0;
	const perSeason = pastInjuriesPerSeason();
	for (const [i, age] of ages.entries()) {
		// Poisson number of injuries this season
		let count = 0;
		let p = Math.exp(-perSeason);
		let cum = p;
		const u = random();
		while (u > cum && count < 6) {
			count += 1;
			p *= perSeason / count;
			cum += p;
		}
		for (let j = 0; j < count; j++) {
			const inj = withRandom(random, () => injury(DEFAULT_LEVEL));
			if (career) {
				const loss = injuryAthleticLoss({
					pid: 0,
					type: inj.type,
					games: inj.gamesRemaining,
					age,
					season: season - ages.length + i,
					n,
					seed: seedKey,
				});
				for (const [key, x] of Object.entries(loss?.loss ?? {})) {
					add(key, x);
				}
			} else if (
				inj.gamesRemaining > 25 &&
				random() < inj.gamesRemaining / 82
			) {
				// The stock rule (writePlayerStats)
				for (const key of ["spd", "endu", "jmp"]) {
					add(key, 1 + Math.floor(20 * random()));
				}
			}
			n += 1;
		}
	}
	return total;
};
