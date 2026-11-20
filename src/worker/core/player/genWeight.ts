import { randInt } from "../../../common/random.ts";
import { probit } from "../../../common/archetypes/norms.ts";
import { g, helpers } from "../../util/index.ts";

// Basketball: weight from height (about 5.5 lb an inch around 218 lb at 6'7"), build (the player type his ratings were drawn for) and
// strength, plus normal noise (one random number, like the uniform noise it replaced). Like NBA listings: sd about 24 lb, height
// correlates about 0.8 with it.
export const BASKETBALL_WEIGHT = {
	intercept: 218,
	refHeight: 78.7,
	perInch: 5.5,
	perStre: 0.3,
	refStre: 40,
	noise: 13,
	build: { big: 6, wing: 0, scorer: -2, point: -4 } as Record<string, number>,
	min: 160,
	max: 330,
};

const genWeight = (
	hgt: number,
	stre?: number,
	pos?: string,
	// Basketball, at generation: his height in inches (before heightFactor) and build. Without them, the old formula
	body?: { heightInInches: number; build?: string },
) => {
	let MIN_WEIGHT = 155;
	let MAX_WEIGHT = 305;

	if (stre === undefined) {
		stre = hgt;
	}

	const female = g.get("gender") === "female";

	let weight;
	if (__SPORT === "football") {
		if (pos === "OL") {
			if (!female) {
				MIN_WEIGHT = 280;
				MAX_WEIGHT = 350;
			}
			weight =
				randInt(-20, 20) +
				((hgt + 0.5 * stre) * (MAX_WEIGHT - MIN_WEIGHT)) / 150 +
				MIN_WEIGHT;
		} else {
			weight =
				randInt(-20, 20) +
				((hgt + 0.5 * stre) * (MAX_WEIGHT - MIN_WEIGHT)) / 150 +
				MIN_WEIGHT;
		}
	} else if (__SPORT === "basketball" && body) {
		const W = BASKETBALL_WEIGHT;
		weight = helpers.bound(
			W.intercept +
				W.perInch * (body.heightInInches - W.refHeight) +
				W.perStre * ((stre ?? W.refStre) - W.refStre) +
				(W.build[body.build ?? ""] ?? 0) +
				W.noise * probit(Math.random()),
			W.min,
			W.max,
		);
	} else {
		weight =
			randInt(-20, 20) +
			((hgt + 0.5 * stre) * (MAX_WEIGHT - MIN_WEIGHT)) / 150 +
			MIN_WEIGHT;
	}

	weight *= g.get("weightFactor");

	if (female) {
		// Ratio comes from average USA stats, adjusted a bit down because they still seem to high
		return Math.round(0.75 * weight);
	}

	return Math.round(weight);
};

export default genWeight;
