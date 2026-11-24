// "Fills a need" (basketball, the Archetypes feature): which of the user's roster composition warnings a player from
// another team or free agency would answer (common/archetypeFit.ts). Labels are read the same way as everywhere else
// (archetypeFor: no ratings are shown, only which warning he answers).
import { featureOn } from "../../util/nativeFeatures.ts";
import { g } from "../../util/index.ts";
import { idb } from "../../db/index.ts";
import { last } from "../../../common/utils.ts";
import type { Player } from "../../../common/types.ts";
import type { Rated } from "../../../common/archetypes/index.ts";
import {
	fillableWarnings,
	needsFilled,
	type Need,
} from "../../../common/archetypeFit.ts";
import { archetypeFor, getLeagueNorms } from "./archetype.ts";

// A function giving the needs a player fills for the user's team, or undefined when the feature is off or the user's
// rotation has no warning a player could answer
export const getNeedsFinder = async (
	tid: number = g.get("userTid"),
): Promise<((p: Player) => Need[]) | undefined> => {
	if (__SPORT !== "basketball" || !featureOn("archetypes")) {
		return undefined;
	}
	const norms = await getLeagueNorms();
	const ratedOf = (p: Player): Rated => {
		const row = last(p.ratings) as any;
		return {
			pid: p.pid,
			ovr: row.ovr,
			archetypeId: archetypeFor(p, norms)?.view.id,
			pos: row.pos,
		};
	};
	const rows = (await idb.cache.players.indexGetAll("playersByTid", tid)).map(
		ratedOf,
	);
	const warnings = fillableWarnings(rows);
	if (warnings.length === 0) {
		return undefined;
	}
	return (p) => (p.tid === tid ? [] : needsFilled(rows, ratedOf(p), warnings));
};

// The needs for each of `players` that fills any, by pid
export const needsByPid = async (players: Player[]) => {
	const find = await getNeedsFinder();
	const out: Record<number, Need[]> = {};
	if (find) {
		for (const p of players) {
			const needs = find(p);
			if (needs.length > 0) {
				out[p.pid] = needs;
			}
		}
	}
	return out;
};
