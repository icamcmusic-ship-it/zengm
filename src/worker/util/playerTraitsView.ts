import { finances, player } from "../core/index.ts";
import { g } from "./index.ts";
import type { Player } from "../../common/types.ts";
import type { PlayerTraitsForUI } from "../core/player/traits.ts";
import { DEFAULT_LEVEL } from "../../common/budgetLevels.ts";
import type { TraitKey } from "../../common/playerTraits/index.ts";

export type TraitViewContext = {
	enabled: boolean;
	scoutingLevel: number;
	godMode: boolean;
};

// Once per view load. enabled is false for other sports and when the Player Traits setting is off.
export const getTraitViewContext = async (): Promise<TraitViewContext> => {
	const enabled = __SPORT === "basketball" && !!g.get("playerTraits");
	if (!enabled) {
		return { enabled, scoutingLevel: DEFAULT_LEVEL, godMode: false };
	}
	return {
		enabled,
		scoutingLevel: await finances.getLevelLastThree("scouting", {
			tid: g.get("userTid"),
		}),
		godMode: !!g.get("godMode"),
	};
};

// What the user can see of a player's traits right now (estimates for prospects), or undefined if traits are off
export const getTraitsForView = (
	p: Player,
	context: TraitViewContext,
	includeExact = false,
): PlayerTraitsForUI | undefined => {
	if (!context.enabled) {
		return undefined;
	}
	return player.getPlayerTraitsForUI(p as any, {
		scoutingLevel: context.scoutingLevel,
		godMode: context.godMode,
		includeExact,
	});
};

// pid -> the estimated 0-100 scores, for tables
export const getTraitScoresByPid = (
	players: Player[],
	context: TraitViewContext,
) => {
	const output = new Map<number, Record<TraitKey, number>>();
	if (!context.enabled) {
		return output;
	}
	for (const p of players) {
		const info = getTraitsForView(p, context);
		if (info) {
			output.set(p.pid, info.scores);
		}
	}
	return output;
};
