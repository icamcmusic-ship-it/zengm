// Injury depth (the injuryDepth setting, basketball only): re-injury risk after returning from an injury (often the same body part), a
// minutes restriction on return that decays over the following games, injury-prone players, back-to-backs (a bit more injury risk and
// fatigue on the second night) and load management (resting players on the second night of back-to-backs).
//
// Everything here runs outside the possession code: the risk multiplier is read by the game sim's injury check, the minutes restriction
// is applied through ptModifier (the same knob as the playing time setting on the roster page), and rested players are marked as not
// available when the teams are loaded.

import { g, helpers } from "../../util/index.ts";
import { defaultInjuries } from "../../util/defaultInjuries.ts";
import { injuryBodyPart } from "../../../common/injuryBodyPart.ts";
import type {
	Player,
	PlayerHealth,
	PlayerInjury,
} from "../../../common/types.ts";
import { PHASE } from "../../../common/constants.ts";

export const isInjuryDepthEnabled = () =>
	__SPORT === "basketball" && !!g.get("injuryDepth");

// Re-injury window after returning, in days (the injury countdown is per day, like the rest of the injury code)
export const RETURN_GAMES = 15;

// Extra risk right after returning, fading to nothing over RETURN_GAMES
export const RETURN_RISK = 0.8;

export const PRONE_RISK = 1.4;
export const BACK_TO_BACK_RISK = 1.15;

// How much a fresh minutes restriction cuts ptModifier
export const RESTRICTION_STRENGTH = 0.45;

// Chance that an injury to a recently returned player is to the same body part
export const SAME_BODY_PART_PROB = 0.45;

// Endurance multiplier on the second night of a back-to-back
export const BACK_TO_BACK_ENDURANCE = 0.94;

// Multiplier applied to everyone, so that the extra risk above (prone players, re-injuries, back-to-backs) doesn't raise league-wide
// injury totals. Calibrated with the season model in injuryDepth.test.ts: roughly 1 / the average
// of the other factors over a season.
export const NORMALIZATION = 0.9;

// Deterministic per player, so it needs no storage and is the same in every session
const hashPid = (pid: number) => {
	let x = (pid + 1) * 2654435761;
	x = (x ^ (x >>> 16)) >>> 0;
	x = Math.imul(x, 2246822507) >>> 0;
	x = (x ^ (x >>> 13)) >>> 0;
	return x / 4294967296;
};

export const PRONE_FRACTION = 0.07;

export const isInjuryProne = (
	p: Pick<Player, "pid" | "injuries">,
	season: number = g.get("season"),
) => {
	if (hashPid(p.pid) < PRONE_FRACTION) {
		return true;
	}

	// Or a long history of injuries recently
	let count = 0;
	for (const injury of p.injuries ?? []) {
		if (injury.season >= season - 2 && injury.games >= 3) {
			count += 1;
		}
	}
	return count >= 5;
};

export const isRecentlyReturned = (health: PlayerHealth | undefined) =>
	health !== undefined && health.returnGames > 0;

export const getInjuryRiskFactor = (
	p: Pick<Player, "pid" | "injuries" | "health">,
	backToBack: boolean,
) => {
	let factor = NORMALIZATION;
	if (isInjuryProne(p)) {
		factor *= PRONE_RISK;
	}
	if (p.health && p.health.returnGames > 0) {
		factor *= 1 + (RETURN_RISK * p.health.returnGames) / RETURN_GAMES;
	}
	if (backToBack) {
		factor *= BACK_TO_BACK_RISK;
	}
	return factor;
};

// Multiplier for ptModifier, 1 when there is no restriction
export const getRestrictionFactor = (health: PlayerHealth | undefined) => {
	if (!health || health.restrict <= 0 || health.restrictTotal <= 0) {
		return 1;
	}
	return 1 - (RESTRICTION_STRENGTH * health.restrict) / health.restrictTotal;
};

export const getRestrictionGames = (injuryGames: number) => {
	if (injuryGames < 5) {
		return 0;
	}
	return helpers.bound(Math.round(injuryGames / 3), 2, 10);
};

// Called when a player's injury is over
export const onHealed = (p: Player) => {
	const lastInjury = p.injuries?.at(-1);
	const games = lastInjury?.games ?? 0;
	const type = lastInjury?.type ?? p.injury.type;
	const restrict = getRestrictionGames(games);
	if (games < 2) {
		return;
	}
	p.health = {
		restrict,
		restrictTotal: restrict,
		returnGames: RETURN_GAMES,
		bodyPart: injuryBodyPart(type),
	};
};

// Called once per day for every player on a team, alongside the injury countdown. Returns true if the player changed.
export const dailyTick = (p: Player) => {
	if (!p.health) {
		return false;
	}

	// Still injured (re-injured): the countdown starts again once healthy
	if (p.injury.gamesRemaining > 0) {
		return false;
	}

	if (p.health.restrict > 0) {
		p.health.restrict -= 1;
	}
	if (p.health.returnGames > 0) {
		p.health.returnGames -= 1;
	}
	if (p.health.restrict <= 0 && p.health.returnGames <= 0) {
		delete p.health;
	}
	return true;
};

// For a recently returned player, sometimes make a new injury hit the same body part as before
export const maybeSameBodyPart = (
	p: Pick<Player, "health">,
	injury: PlayerInjury,
	random: () => number = Math.random,
): PlayerInjury => {
	const health = p.health;
	if (!health || health.returnGames <= 0 || health.bodyPart === "Other") {
		return injury;
	}
	if (injuryBodyPart(injury.type) === health.bodyPart) {
		return injury;
	}
	if (random() >= SAME_BODY_PART_PROB) {
		return injury;
	}

	const injuries = g.get("injuries") ?? defaultInjuries;
	const candidates = injuries.filter(
		(row) => injuryBodyPart(row.name) === health.bodyPart,
	);
	if (candidates.length === 0) {
		return injury;
	}

	let total = 0;
	for (const row of candidates) {
		total += row.frequency;
	}
	let r = random() * total;
	let chosen = candidates.at(-1)!;
	for (const row of candidates) {
		r -= row.frequency;
		if (r <= 0) {
			chosen = row;
			break;
		}
	}

	// Keep the length of the original roll, scaled by how the two injuries compare on average
	const origRow = injuries.find((row) => row.name === injury.type);
	const scale = origRow && origRow.games > 0 ? chosen.games / origRow.games : 1;
	return {
		...injury,
		type: chosen.name,
		gamesRemaining: Math.max(
			injury.gamesRemaining > 0 ? 1 : 0,
			Math.round(injury.gamesRemaining * scale),
		),
	};
};

// The day being simulated, set by game.play before loading teams, so processTeam can spot back-to-backs
let simDay: number | undefined;
export const setSimDay = (day: number | undefined) => {
	simDay = day;
};
export const getSimDay = () => simDay;

export const isBackToBack = (lastGameDay: number | undefined) =>
	simDay !== undefined &&
	lastGameDay !== undefined &&
	lastGameDay === simDay - 1 &&
	g.get("phase") !== PHASE.PLAYOFFS;

// Should this player sit out the second night of a back-to-back?
export const shouldRest = ({
	p,
	age,
	teamLoadManagement,
	aiControlled,
	numHealthy,
	rank,
}: {
	p: Pick<Player, "pid" | "injuries" | "loadManagement">;
	age: number;
	teamLoadManagement: boolean | undefined;
	aiControlled: boolean;
	// Healthy players on the roster
	numHealthy: number;
	// 0 for the best player on the team by value
	rank: number;
}) => {
	if (g.get("phase") !== PHASE.REGULAR_SEASON) {
		return false;
	}

	// Need enough bodies left to play
	if (numHealthy < 10) {
		return false;
	}

	if (p.loadManagement) {
		return true;
	}

	if (!aiControlled && !teamLoadManagement) {
		return false;
	}

	// The policy: veterans in the rotation, and injury-prone players who matter
	if (rank >= 8) {
		return false;
	}
	return age >= 34 || (age >= 31 && isInjuryProne(p));
};
