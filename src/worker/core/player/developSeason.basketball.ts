import limitRating from "./limitRating.ts";
import { helpers } from "../../util/index.ts";
import type {
	PlayerRatings,
	RatingKey,
} from "../../../common/types.basketball.ts";
import { coachingEffect } from "../../../common/budgetLevels.ts";
import { uniform, realGauss } from "../../../common/random.ts";
import type { TraitDevelopment } from "../../../common/playerTraits/development.ts";
import { realisticAgingOn } from "./ratingsModelSwitch.ts";
import {
	REALISTIC_AGING_TARGETS,
	STOCK_UNTIL,
} from "./realisticAging.basketball.ts";
import {
	DEV_RATES,
	DEV_RATES_MAX_AGE,
	YOUNG_NOISE_MEAN,
	rateFor,
	type DevRates,
} from "../../../common/prospectVariety.ts";

type RatingFormula = {
	ageModifier: (age: number) => number;
	changeLimits: (age: number) => [number, number];
};

const shootingFormula: RatingFormula = {
	ageModifier: (age: number) => {
		// Reverse most of the age-related decline in calcBaseChange
		if (age <= 27) {
			return 0;
		}

		if (age <= 29) {
			return 0.5;
		}

		if (age <= 31) {
			return 1.5;
		}

		return 2;
	},
	changeLimits: () => [-3, 13],
};
const iqFormula: RatingFormula = {
	ageModifier: (age: number) => {
		if (age <= 21) {
			return 4;
		}

		if (age <= 23) {
			return 3;
		}

		// Reverse most of the age-related decline in calcBaseChange
		if (age <= 27) {
			return 0;
		}

		if (age <= 29) {
			return 0.5;
		}

		if (age <= 31) {
			return 1.5;
		}

		return 2;
	},
	changeLimits: (age) => {
		if (age >= 24) {
			return [-3, 9];
		}

		// For 19: [-3, 32]
		// For 23: [-3, 12]
		return [-3, 7 + 5 * (24 - age)];
	},
};
const ratingsFormulas: Record<Exclude<RatingKey, "hgt">, RatingFormula> = {
	stre: {
		ageModifier: () => 0,
		changeLimits: () => [-Infinity, Infinity],
	},
	spd: {
		ageModifier: (age: number) => {
			if (age <= 27) {
				return 0;
			}

			if (age <= 30) {
				return -2;
			}

			if (age <= 35) {
				return -3;
			}

			if (age <= 40) {
				return -4;
			}

			return -8;
		},
		changeLimits: () => [-12, 2],
	},
	jmp: {
		ageModifier: (age: number) => {
			if (age <= 26) {
				return 0;
			}

			if (age <= 30) {
				return -3;
			}

			if (age <= 35) {
				return -4;
			}

			if (age <= 40) {
				return -5;
			}

			return -10;
		},
		changeLimits: () => [-12, 2],
	},
	endu: {
		ageModifier: (age: number) => {
			if (age <= 23) {
				return uniform(0, 9);
			}

			if (age <= 30) {
				return 0;
			}

			if (age <= 35) {
				return -2;
			}

			if (age <= 40) {
				return -4;
			}

			return -8;
		},
		changeLimits: () => [-11, 19],
	},
	dnk: {
		ageModifier: (age: number) => {
			// Like shootingForumla, except for old players
			if (age <= 27) {
				return 0;
			}

			return 0.5;
		},
		changeLimits: () => [-3, 13],
	},
	ins: shootingFormula,
	ft: shootingFormula,
	fg: shootingFormula,
	tp: shootingFormula,
	oiq: iqFormula,
	diq: iqFormula,
	drb: {
		ageModifier: shootingFormula.ageModifier,
		changeLimits: () => [-2, 5],
	},
	pss: {
		ageModifier: shootingFormula.ageModifier,
		changeLimits: () => [-2, 5],
	},
	reb: {
		ageModifier: shootingFormula.ageModifier,
		changeLimits: () => [-2, 5],
	},
};

// Cached for performance, since developSeason is called a lot in monteCarloPot
const ratingsFormulasEntries = helpers.entries(ratingsFormulas);

// Realistic Aging (realisticAging setting): every rating's age modifier is its target yearly change (realisticAging.basketball.ts) minus
// the shared base change's age part, so the base change (with its noise, coaching, work ethic and the secret aging curve of Player
// Traits) still moves every rating together on top. Same random numbers as the stock formulas.
const realisticAgeModifier = (
	key: Exclude<RatingKey, "hgt">,
	formula: RatingFormula,
	age: number,
	hgt: number,
) => {
	const target = REALISTIC_AGING_TARGETS[key];
	if (age <= (target.stockUntil ?? STOCK_UNTIL)) {
		return formula.ageModifier(age);
	}
	const a = helpers.bound(Math.round(age), 19, 40);
	let mod =
		target.byAge[a - 19]! - baseChangeByAge(age) + (VETERAN_EASE[a] ?? 0);
	if (target.bigExtra !== undefined && age >= 31) {
		// Big men's athleticism declines a little faster after 30, scaled from a wing's height (55) to a center's (70)
		mod += target.bigExtra * helpers.bound((hgt - 55) / 15, 0, 1);
	}
	if (age > 40) {
		// Past the table, the decline keeps getting steeper like the stock base change's (-5 at 41-43, -6 after). This used to have the opposite
		// sign, so 41+ year olds declined 1-2 points a year less than at 40 and a few kept playing well into their mid 40s
		mod += baseChangeByAge(age) - baseChangeByAge(40);
	}
	return mod;
};

// Realistic Aging: a little less decline at 35-38 (added to every rating's target), so useful veterans stay at a role player's level a
// few seasons longer, like the NBA's 36-39 year olds
const VETERAN_EASE: Record<number, number> = {
	35: 0.8,
	36: 1,
	37: 1,
	38: 0.6,
};

// The age part of calcBaseChange (before noise, traits and coaching)
const baseChangeByAge = (age: number) => {
	if (age <= 21) {
		return 2;
	} else if (age <= 25) {
		return 1;
	} else if (age <= 27) {
		return 0;
	} else if (age <= 29) {
		return -1;
	} else if (age <= 31) {
		return -2;
	} else if (age <= 34) {
		return -3;
	} else if (age <= 40) {
		return -4;
	} else if (age <= 43) {
		return -5;
	}
	return -6;
};

// Speed (monteCarloPot runs developSeason ~200 times per young player): the parts of a rating's age modifier and change limits that only
// depend on the (whole number) age and the Realistic Aging setting, worked out once per age. The same arithmetic in the same order as
// realisticAgeModifier / the stock formulas, so the results are identical; endurance's random modifier (23 and under, stock formula) is
// still drawn live, in the same place.
type AgeRow = {
	// Modifier before the height and past-40 parts, or undefined to call the stock formula live (random)
	pre: number | undefined;
	// Realistic Aging: bigExtra (31+), added as bigExtra * height factor
	big: number | undefined;
	// Realistic Aging past 40
	post: number | undefined;
	lo: number;
	hi: number;
};
const ageRowsCache = [new Map<number, AgeRow[]>(), new Map<number, AgeRow[]>()];
const ageRowsFor = (age: number, realistic: boolean): AgeRow[] => {
	const cache = ageRowsCache[realistic ? 1 : 0]!;
	let rows = cache.get(age);
	if (rows) {
		return rows;
	}
	rows = ratingsFormulasEntries.map(([key, formula]) => {
		const [lo, hi] = formula.changeLimits(age);
		const randomStock = key === "endu" && age <= 23;
		if (!realistic) {
			return {
				pre: randomStock ? undefined : formula.ageModifier(age),
				big: undefined,
				post: undefined,
				lo,
				hi,
			};
		}
		const target = REALISTIC_AGING_TARGETS[key];
		if (age <= (target.stockUntil ?? STOCK_UNTIL)) {
			return {
				pre: randomStock ? undefined : formula.ageModifier(age),
				big: undefined,
				post: undefined,
				lo,
				hi,
			};
		}
		const a = helpers.bound(Math.round(age), 19, 40);
		return {
			pre:
				target.byAge[a - 19]! - baseChangeByAge(age) + (VETERAN_EASE[a] ?? 0),
			big:
				target.bigExtra !== undefined && age >= 31
					? target.bigExtra
					: undefined,
			post: age > 40 ? baseChangeByAge(age) - baseChangeByAge(40) : undefined,
			lo,
			hi,
		};
	});
	cache.set(age, rows);
	return rows;
};

// Prospect variety (players generated since it exists): a real bust tail. Young players' yearly noise is bounded at -4; the part of the same
// draw between -4 and -7 is added back to every rating after its limits (so it can't be clipped away), minus its mean (0.418), so the
// league's development is unchanged on average for every rating
let bustTail = 0;

const calcBaseChange = (
	age: number,
	coachingLevel: number,
	traitDev?: TraitDevelopment,
	wideYoung?: boolean,
	// Development reliability (version 2 players): young noise's deviation from its mean is scaled by this
	noiseScale?: number,
): number => {
	let val = baseChangeByAge(age);

	// Noise
	let noise;
	bustTail = 0;
	if (age <= 23) {
		const draw = realGauss(0, 5);
		noise = helpers.bound(draw, -4, 20);
		if (wideYoung) {
			bustTail =
				Math.min(0, Math.max(draw, DEV_RATES.youngNoiseMin) + 4) +
				DEV_RATES.youngNoiseRecenter;
		}
		if (noiseScale !== undefined) {
			noise =
				YOUNG_NOISE_MEAN.upTo23 +
				YOUNG_NOISE_MEAN.shift +
				noiseScale * (noise - YOUNG_NOISE_MEAN.upTo23);
		}
	} else if (age <= 25) {
		noise = helpers.bound(realGauss(0, 5), -4, 10);
		if (noiseScale !== undefined) {
			noise =
				YOUNG_NOISE_MEAN.upTo25 +
				YOUNG_NOISE_MEAN.shift +
				noiseScale * (noise - YOUNG_NOISE_MEAN.upTo25);
		}
	} else {
		noise = helpers.bound(realGauss(0, 3), -2, 4);
	}

	// Player traits (work ethic, aging curve), only in the preseason with the setting on. Same random numbers as without them
	if (traitDev) {
		if (noise < 0) {
			noise *= traitDev.dropScale;
		}
		val += traitDev.baseChangeDelta;
	}
	val += noise;

	val *= 1 + (val > 0 ? 1 : -1) * coachingEffect(coachingLevel);

	return val;
};

const developSeason = (
	ratings: PlayerRatings,
	age: number,
	coachingLevel: number,
	// Player traits development (work ethic, aging curve), see common/playerTraits/development.ts. Never passed for pot estimates
	traitDev?: TraitDevelopment,
	// Prospect variety: his development rate per rating group (common/prospectVariety.ts, devRatesOf). Pot estimates get only what scouts
	// can read (potRatesOf: the shared part of his rate), so how fast each part of his game grows stays hidden
	rates?: DevRates,
) => {
	// In young players, height can sometimes increase
	if (age <= 21) {
		const heightRand = Math.random();

		if (heightRand > 0.99 && age <= 20 && ratings.hgt <= 99) {
			ratings.hgt += 1;
		}

		if (heightRand > 0.999 && ratings.hgt <= 99) {
			ratings.hgt += 1;
		}
	}

	const baseChange = calcBaseChange(
		age,
		coachingLevel,
		traitDev,
		rates !== undefined,
		rates?.noise,
	);
	const useRates = rates !== undefined && age <= DEV_RATES_MAX_AGE;
	const bust = rates !== undefined ? bustTail : 0;
	const realistic = realisticAgingOn();
	const hgt = ratings.hgt;

	const ageRows = Number.isInteger(age)
		? ageRowsFor(age, realistic)
		: undefined;

	for (let i = 0; i < ratingsFormulasEntries.length; i++) {
		const [key, formula] = ratingsFormulasEntries[i]!;
		let ageModifier: number;
		let lo: number;
		let hi: number;
		const row = ageRows?.[i];
		if (row) {
			if (row.pre === undefined) {
				ageModifier = formula.ageModifier(age);
			} else {
				ageModifier = row.pre;
				if (row.big !== undefined) {
					ageModifier += row.big * helpers.bound((hgt - 55) / 15, 0, 1);
				}
				if (row.post !== undefined) {
					ageModifier += row.post;
				}
			}
			lo = row.lo;
			hi = row.hi;
		} else {
			ageModifier = realistic
				? realisticAgeModifier(key, formula, age, hgt)
				: formula.ageModifier(age);
			[lo, hi] = formula.changeLimits(age);
		}

		const u = uniform(0.4, 1.4);
		let change = helpers.bound((baseChange + ageModifier) * u, lo, hi);
		// Prospect variety: his group's rate scales a gain (after the limits, so a fast developer isn't clipped back), and the bust tail
		if (useRates && change > 0) {
			change *= rateFor(rates, key);
		}
		change += bust * u;
		// Coaching Staff Depth: a fixed shift of this rating's change (development plan, shooting coach, strength & conditioning)
		const delta = traitDev?.ratingDelta?.[key];
		ratings[key] = limitRating(
			ratings[key] + (delta === undefined ? change : change + delta),
		);
	}
};

export default developSeason;
