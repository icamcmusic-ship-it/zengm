import { Rng } from "../ratingsBuilds/rng.ts";
import { TRAIT_DEFINITIONS } from "./definitions.ts";
import type { TraitKey } from "./types.ts";

// Draft prospects' traits are only partly known. The reading is the true score plus a fixed per-player error (the same every time you look, so it does not flicker), scaled by an uncertainty that shrinks with scouting and then disappears as the player plays.

export const PROSPECT_SD_HIDDEN = 16;
export const PROSPECT_SD_VISIBLE = 7;
export const ROOKIE_SD_HIDDEN = 8;
// Seasons in the pros after which hidden traits are fully known
export const SEASONS_TO_REVEAL = 3;

export const traitUncertainty = ({
	key,
	isProspect,
	experience,
	scoutingRank,
	numTeams,
	godMode,
}: {
	key: TraitKey;
	isProspect: boolean;
	experience: number;
	// 1 is the best scouting budget in the league
	scoutingRank?: number;
	numTeams?: number;
	godMode?: boolean;
}) => {
	if (godMode) {
		return 0;
	}
	const hidden = TRAIT_DEFINITIONS[key].visibility === "hidden";
	if (isProspect) {
		const teams = Math.max(2, numTeams ?? 30);
		const rank = Math.min(Math.max(scoutingRank ?? (teams + 1) / 2, 1), teams);
		// Best scouting 0.6x, worst 1.4x
		const mult = 0.6 + (0.8 * (rank - 1)) / (teams - 1);
		return (hidden ? PROSPECT_SD_HIDDEN : PROSPECT_SD_VISIBLE) * mult;
	}
	if (!hidden) {
		return 0;
	}
	return Math.max(0, ROOKIE_SD_HIDDEN * (1 - experience / SEASONS_TO_REVEAL));
};

export type ScoutedTrait = {
	key: TraitKey;
	// What to show
	estimate: number;
	// 0 when exactly known
	sd: number;
	// A rough 80% band, clamped to 0-100
	low: number;
	high: number;
	exact: boolean;
};

const clamp100 = (x: number) => Math.max(0, Math.min(100, Math.round(x)));

export const scoutTrait = ({
	key,
	trueScore,
	sd,
	leagueSeed,
	pid,
}: {
	key: TraitKey;
	trueScore: number;
	sd: number;
	leagueSeed: number | string;
	pid: number;
}): ScoutedTrait => {
	if (sd < 0.5) {
		return {
			key,
			estimate: trueScore,
			sd: 0,
			low: trueScore,
			high: trueScore,
			exact: true,
		};
	}
	// Error unit is fixed per (league, player, trait), limited to +-2 sd
	const unit = Math.max(
		-2,
		Math.min(2, new Rng(`traitScout|${leagueSeed}|${pid}|${key}`).normal(0, 1)),
	);
	const estimate = clamp100(trueScore + unit * sd);
	return {
		key,
		estimate,
		sd,
		low: clamp100(estimate - 1.28 * sd),
		high: clamp100(estimate + 1.28 * sd),
		exact: false,
	};
};
