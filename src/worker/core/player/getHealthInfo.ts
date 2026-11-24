import { g } from "../../util/index.ts";
import { injuryBodyPart } from "../../../common/injuryBodyPart.ts";
import type { InjuryTreatment, Player } from "../../../common/types.ts";
import { injuryRecordGames } from "./injuryRecovery.ts";
import {
	getRestrictionFactor,
	isInjuryDepthEnabled,
	isInjuryProne,
	RETURN_GAMES,
} from "./injuryDepth.ts";

export type HealthInfo = {
	byBodyPart: {
		bodyPart: string;
		count: number;
		games: number;
		lastSeason: number;
		types: string[];
	}[];
	enabled: boolean;
	injuryProne: boolean;
	// Fraction of normal playing time, 1 if no restriction
	restrictionFactor: number;
	restrictGames: number;
	returnGames: number;
	recentBodyPart: string | undefined;
	// Days since he came back from his last injury, while the return window lasts (for the nose bandage, common/faceRender.ts)
	daysBack: number | undefined;
	loadManagement: boolean;
	canEditLoadManagement: boolean;
	// Surgery or rehab for his current major injury, and whether the user can still choose (player/injuryRecovery.ts)
	treatment: InjuryTreatment | undefined;
	canChooseTreatment: boolean;
	// Games his team has played without him since his current injury
	gamesMissed: number | undefined;
};

export const getHealthInfo = (p: Player): HealthInfo => {
	const parts = new Map<string, HealthInfo["byBodyPart"][number]>();
	for (const injury of p.injuries ?? []) {
		const bodyPart = injuryBodyPart(injury.type);
		let row = parts.get(bodyPart);
		if (!row) {
			row = { bodyPart, count: 0, games: 0, lastSeason: 0, types: [] };
			parts.set(bodyPart, row);
		}
		row.count += 1;
		// Games he missed (the recorded count once it's over)
		row.games += injuryRecordGames(injury);
		row.lastSeason = Math.max(row.lastSeason, injury.season);
		if (!row.types.includes(injury.type)) {
			row.types.push(injury.type);
		}
	}

	const enabled = isInjuryDepthEnabled();
	return {
		byBodyPart: [...parts.values()].sort(
			(a, b) => b.games - a.games || b.count - a.count,
		),
		enabled,
		injuryProne: enabled && p.tid >= 0 && isInjuryProne(p),
		restrictionFactor: enabled ? getRestrictionFactor(p.health) : 1,
		restrictGames: enabled ? (p.health?.restrict ?? 0) : 0,
		returnGames: enabled ? (p.health?.returnGames ?? 0) : 0,
		recentBodyPart: enabled ? p.health?.bodyPart : undefined,
		daysBack:
			enabled && p.health && p.health.returnGames > 0
				? RETURN_GAMES - p.health.returnGames
				: undefined,
		loadManagement: !!p.loadManagement,
		canEditLoadManagement: enabled && g.get("userTids").includes(p.tid),
		treatment: p.injury.gamesRemaining > 0 ? p.injury.treatment : undefined,
		canChooseTreatment:
			!!p.injury.treatmentOpen &&
			p.injury.gamesRemaining > 0 &&
			g.get("userTids").includes(p.tid) &&
			!g.get("spectator"),
		gamesMissed: p.injury.gamesRemaining > 0 ? p.injury.gamesMissed : undefined,
	};
};
