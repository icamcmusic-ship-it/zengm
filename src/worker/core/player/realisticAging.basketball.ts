import type { RatingKey } from "../../../common/types.basketball.ts";

// Realistic Aging (realisticAging setting): target yearly change of every rating by age, before the shared base change's noise,
// coaching and traits and before each rating's random scale (uniform 0.4-1.4). See developSeason.basketball.ts and
// docs/native-features.md (peak ages and long-run stability are measured by src/test/ovrFit/aging.script.test.ts and the rating
// inflation population model).
//
// Shape, from NBA aging research: basketball IQ and free throws keep improving into the late 20s (peak ~28-31), shooting holds into the
// early 30s, speed and jumping start a gentle decline around 28 that gets steeper after 32 (a little steeper for big men), strength
// holds until ~30, endurance until ~30.

type Target = {
	// Ages 19 to 40
	byAge: readonly number[];
	// Up to this age the stock formula's modifier is used (default STOCK_UNTIL)
	stockUntil?: number;
	// Extra yearly change after 30 for a center's height, scaled from 0 at a wing's
	bigExtra?: number;
};

// Young players develop like before (draft prospects and random players are generated with this too, so draft classes don't change)
export const STOCK_UNTIL = 22;

// [last age, value] steps from 19 to 40
const steps = (...pieces: [number, number][]) => {
	const out: number[] = [];
	for (let age = 19; age <= 40; age++) {
		out.push(
			pieces.find(([maxAge]) => age <= maxAge)?.[1] ?? pieces.at(-1)![1],
		);
	}
	return out;
};

const shooting = steps(
	[25, 0.5],
	[28, 0.1],
	[31, -0.2],
	[33, -1.5],
	[35, -2],
	[40, -3],
);
const iq = steps(
	[22, 4],
	[23, 3],
	[25, 0.2],
	[29, 0.35],
	[31, -0.6],
	[33, -1.5],
	[35, -2],
	[40, -3],
);
const skill = steps([25, 0.5], [28, 0], [31, -0.6], [34, -1.5], [40, -2.4]);

export const REALISTIC_AGING_TARGETS: Record<
	Exclude<RatingKey, "hgt">,
	Target
> = {
	stre: {
		byAge: steps([25, 0.6], [27, 0], [30, -0.6], [32, -2], [34, -3], [40, -4]),
	},
	spd: {
		byAge: steps(
			[25, 1.3],
			[27, -0.2],
			[29, -2],
			[31, -3.3],
			[33, -4.5],
			[40, -5.5],
		),
		bigExtra: -0.7,
	},
	jmp: {
		byAge: steps(
			[25, 1.3],
			[26, -0.2],
			[27, -0.9],
			[29, -2.2],
			[31, -3.5],
			[33, -4.7],
			[40, -5.8],
		),
		bigExtra: -0.7,
	},
	endu: {
		byAge: steps(
			[25, 0.2],
			[29, 0],
			[30, -0.7],
			[33, -2.5],
			[35, -3.4],
			[40, -4.4],
		),
		// Endurance's random young growth
		stockUntil: 23,
	},
	ins: { byAge: shooting },
	dnk: {
		byAge: steps(
			[25, 0.6],
			[27, -0.1],
			[29, -0.8],
			[31, -1.9],
			[33, -2.8],
			[40, -3.5],
		),
	},
	ft: {
		byAge: steps([25, 0.4], [29, 0.3], [31, -0.4], [34, -1.2], [40, -1.9]),
	},
	fg: { byAge: shooting },
	tp: { byAge: shooting },
	oiq: { byAge: iq },
	diq: { byAge: iq },
	drb: { byAge: skill },
	pss: { byAge: skill },
	reb: { byAge: steps([25, 0.6], [29, 0], [31, -0.5], [34, -1.2], [40, -1.9]) },
};
