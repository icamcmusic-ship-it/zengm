import { COLLEGES } from "./colleges.ts";
import { Rng } from "./rng.ts";
import { RATING_KEYS, type CollegeProspect } from "./types.ts";

// A draft class like the game's: ages 19-22, most at an NCAA school by BBGM frequency, some with no college, some born abroad
export const makeClass = (n: number, seed: string): CollegeProspect[] => {
	const rng = new Rng(seed);
	const names = Object.keys(COLLEGES);
	const weights = names.map((x) => COLLEGES[x]![0]);
	return Array.from({ length: n }, (_, i) => {
		const talent = rng.normal(0, 1);
		const hgt = Math.max(0, Math.min(100, 46 + 15 * rng.normal(0, 1)));
		const ratings: any = {};
		for (const key of RATING_KEYS) {
			ratings[key] = Math.max(
				5,
				Math.min(95, 38 + 8 * talent + 9 * rng.normal(0, 1)),
			);
		}
		ratings.hgt = hgt;
		const u = rng.random();
		const age =
			u < 0.3 ? 19 : u < 0.55 ? 20 : u < 0.78 ? 21 : u < 0.97 ? 22 : 23;
		const intl = rng.random() < 0.15;
		return {
			key: `${seed}-${i}`,
			age,
			ovr: Math.round(42 + 8 * talent),
			pot: Math.round(55 + 8 * talent),
			pos: hgt > 65 ? "C" : hgt > 45 ? "SF" : "PG",
			ratings,
			college: rng.random() < 0.25 ? "" : rng.weighted(names, weights),
			bornLoc: intl ? "Belgrade, Serbia" : "Chicago, IL, USA",
		};
	});
};
