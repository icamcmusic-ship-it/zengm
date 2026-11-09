import { defineView } from "../util/defineView.ts";
import { getCommon } from "./player.ts";
import {
	getTraitViewContext,
	getTraitsForView,
} from "../util/playerTraitsView.ts";
import { player } from "../core/index.ts";
import { PLAYER } from "../../common/constants.ts";
import {
	traitEffectSummary,
	type TraitKey,
} from "../../common/playerTraits/index.ts";
import type { RouteParams } from "../../ui/router/types.ts";

const processInputs = (params: RouteParams<"playerTraits">) => {
	return {
		pid: params.pid !== undefined ? Number.parseInt(params.pid) : undefined,
	};
};

// The player's Traits page: every trait with its reading (scouting estimates and hidden traits respected), what it means for him in games,
// and how his scores moved over his career. The aging curve is secret and only included once he has retired.
export default defineView({
	id: "playerTraits",
	processInputs,
	load: async ({ inputs: { pid } }) => {
		const topStuff = await getCommon(pid, undefined, "player_traits");

		if (topStuff.type === "error") {
			// https://stackoverflow.com/a/59923262/786644
			const returnValue = {
				errorMessage: topStuff.errorMessage,
			};
			return returnValue;
		}

		const playerTraits = getTraitsForView(
			topStuff.pRaw,
			await getTraitViewContext(),
		);

		// Only what the user can see: exact readings get numbers, estimates don't
		const effects: Partial<Record<TraitKey, string>> = {};
		const exactKeys: TraitKey[] = [];
		if (playerTraits) {
			for (const t of playerTraits.traits) {
				if (t.exact) {
					effects[t.key] = traitEffectSummary(t.key, t.estimate);
					exactKeys.push(t.key);
				}
			}
		}

		const history =
			playerTraits && topStuff.pRaw.tid !== PLAYER.UNDRAFTED
				? player.getTraitHistory(topStuff.pRaw as any, exactKeys)
				: [];

		// The raw player stays in the worker: it has things the user isn't supposed to see, like the seeds that give away hidden traits
		const { pRaw: _pRaw, ...topStuffForUI } = topStuff;

		return {
			...topStuffForUI,
			effects,
			history,
			historyKeys: exactKeys,
			playerTraits,
		};
	},
});
