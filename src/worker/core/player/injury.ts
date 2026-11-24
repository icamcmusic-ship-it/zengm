import { g, helpers } from "../../util/index.ts";
import type { InjuriesSetting, PlayerInjury } from "../../../common/types.ts";
import { healthEffect } from "../../../common/budgetLevels.ts";
import { defaultInjuries } from "../../util/defaultInjuries.ts";
import { uniform } from "../../../common/random.ts";
import {
	getInjurySize,
	getInjurySlopes,
	getWeightedCumSums,
} from "./injuryBodyType.ts";
import { isInjuryDepthEnabled } from "./injuryDepth.ts";

let prevInjuries: InjuriesSetting | undefined;

// The list drawn from: the league's, or defaultInjuries when it has nothing to draw (empty, or no positive frequency, as a league file
// can have)
let drawInjuries: InjuriesSetting = defaultInjuries;
let cumSums: number[] = [];
let slopes: number[] = [];

const getCumSums = (injuries: InjuriesSetting) => {
	const sums: number[] = [];
	for (const [i, injury] of injuries.entries()) {
		sums[i] = injury.frequency;
		if (i > 0) {
			sums[i] += sums[i - 1]!;
		}
	}
	return sums;
};

// extraFactor: Front Office Budget's Medical recovery for older players (1 when off). onNeutral gets the duration the same draws give at
// a league-average health budget, for the season review. player: the injured player's height (inches), weight and position, to weight
// the injury types by his size (basketball with Injury Depth, injuryBodyType.ts)
const injury = (
	healthLevel: number,
	opts?: {
		extraFactor?: number;
		onNeutral?: (gamesRemaining: number) => void;
		player?: { hgt: number; weight: number; pos: string | undefined };
	},
): PlayerInjury => {
	const leagueInjuries = g.get("injuries") ?? defaultInjuries;

	if (leagueInjuries !== prevInjuries) {
		drawInjuries = leagueInjuries;
		cumSums = getCumSums(leagueInjuries);
		if (!((cumSums.at(-1) ?? 0) > 0)) {
			drawInjuries = defaultInjuries;
			cumSums = getCumSums(defaultInjuries);
		}

		slopes = getInjurySlopes(drawInjuries);
		prevInjuries = leagueInjuries;
	}
	const injuries = drawInjuries;

	// Same one random number either way
	const sums =
		opts?.player && __SPORT === "basketball" && isInjuryDepthEnabled()
			? getWeightedCumSums(injuries, slopes, getInjurySize(opts.player))
			: cumSums;
	const rand = uniform(0, sums.at(-1)!);
	let i = sums.findIndex((cs) => cs >= rand);
	if (i < 0) {
		// Rounding at the top end
		i = sums.length - 1;
	}
	const draw = uniform(0.25, 1.75);
	const gamesRemaining = Math.round(
		opts?.extraFactor !== undefined
			? (1 + healthEffect(healthLevel)) *
					opts.extraFactor *
					draw *
					injuries[i]!.games
			: (1 + healthEffect(healthLevel)) * draw * injuries[i]!.games,
	);
	// At least 1 game: a 0-game injury would go into his history as a 0-game record (and he's out for the rest of this game anyway)
	opts?.onNeutral?.(
		helpers.bound(Math.round(draw * injuries[i]!.games), 1, Infinity),
	);

	return {
		type: injuries[i]!.name,
		gamesRemaining: helpers.bound(gamesRemaining, 1, Infinity),
	};
};

export default injury;
