import { g, local } from "../../util/index.ts";
import type { Player } from "../../../common/types.ts";
import {
	BACK_TO_BACK_ENDURANCE,
	getInjuryRiskFactor,
	getRestrictionFactor,
	isBackToBack,
	isInjuryDepthEnabled,
	shouldRest,
} from "../player/injuryDepth.ts";

// The injuryDepth setting's effects on a team loaded for the game sim (see player/injuryDepth.ts). Mutates the processTeam output.
export const applyInjuryDepth = (
	t: {
		id: number;
		player: {
			id: number;
			injured: boolean;
			ptModifier: number;
			compositeRating: Record<string, number>;
			injuryRiskFactor?: number;
			rested?: boolean;
		}[];
	},
	teamInput: { tid: number; loadManagement?: boolean },
	teamSeason: { lastGameDay?: number },
	players: Player[],
) => {
	if (!isInjuryDepthEnabled() || t.id < 0) {
		return;
	}

	const backToBack = isBackToBack(teamSeason.lastGameDay);
	const playersByPid = new Map(players.map((p) => [p.pid, p]));

	const aiControlled =
		!g.get("userTids").includes(t.id) ||
		g.get("spectator") ||
		local.autoPlayUntil !== undefined;

	let numHealthy = t.player.filter((p2) => !p2.injured).length;
	const rankByPid = new Map(
		players
			.filter((p) => p.injury.gamesRemaining === 0)
			.sort((a, b) => b.valueNoPot - a.valueNoPot)
			.map((p, i) => [p.pid, i]),
	);

	for (const p2 of t.player) {
		const p = playersByPid.get(p2.id);
		if (!p) {
			continue;
		}

		p2.injuryRiskFactor = getInjuryRiskFactor(p, backToBack);

		if (p2.injured) {
			continue;
		}

		if (backToBack) {
			const rest = shouldRest({
				p,
				age: g.get("season") - p.born.year,
				teamLoadManagement: teamInput.loadManagement,
				aiControlled,
				numHealthy,
				rank: rankByPid.get(p.pid) ?? 99,
			});
			if (rest) {
				p2.injured = true;
				p2.rested = true;
				numHealthy -= 1;
				continue;
			}

			if (p2.compositeRating.endurance !== undefined) {
				p2.compositeRating.endurance *= BACK_TO_BACK_ENDURANCE;
			}
		}

		p2.ptModifier *= getRestrictionFactor(p.health);
	}
};
