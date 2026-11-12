import { g, helpers } from "../../util/index.ts";
import type { InjuriesSetting, PlayerInjury } from "../../../common/types.ts";
import { healthEffect } from "../../../common/budgetLevels.ts";
import { defaultInjuries } from "../../util/defaultInjuries.ts";
import { uniform } from "../../../common/random.ts";

let prevInjuries: InjuriesSetting | undefined;

let cumSums: number[] = [];

// extraFactor: Front Office Budget's Medical recovery for older players (1 when off). onNeutral gets the duration the same draws give at
// a league-average health budget, for the season review
const injury = (
	healthLevel: number,
	opts?: {
		extraFactor?: number;
		onNeutral?: (gamesRemaining: number) => void;
	},
): PlayerInjury => {
	const injuries = g.get("injuries") ?? defaultInjuries;

	if (injuries !== prevInjuries) {
		cumSums = [];

		for (const [i, injury] of injuries.entries()) {
			cumSums[i] = injury.frequency;
			if (i > 0) {
				cumSums[i] += cumSums[i - 1]!;
			}
		}

		prevInjuries = injuries;
	}

	const rand = uniform(0, cumSums.at(-1)!);
	const i = cumSums.findIndex((cs) => cs >= rand);
	const draw = uniform(0.25, 1.75);
	const gamesRemaining = Math.round(
		opts?.extraFactor !== undefined
			? (1 + healthEffect(healthLevel)) *
					opts.extraFactor *
					draw *
					injuries[i]!.games
			: (1 + healthEffect(healthLevel)) * draw * injuries[i]!.games,
	);
	opts?.onNeutral?.(
		helpers.bound(Math.round(draw * injuries[i]!.games), 0, Infinity),
	);

	return {
		type: injuries[i]!.name,
		gamesRemaining: helpers.bound(gamesRemaining, 0, Infinity),
	};
};

export default injury;
