// Award race tracker: the leaders of the season's main individual award races (the Award Races scoring), with weekly snapshots
// (gameAttributes.awardRaceHistory) so the Newspaper can show who moved up or down since the last one.

import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { getAwardCandidates } from "./getAwardCandidates.ts";
import league from "../league/index.ts";
import type { AwardRaceHistory } from "../../../common/types.ts";

// The races the tracker follows, in this order, when the league has them
export const TRACKED_AWARDS = ["MVP", "DPOY", "ROY", "SMOY", "MIP"];
const NUM_KEPT = 5;
const MAX_SNAPSHOTS = 6;

export type AwardRace = {
	key: string;
	name: string;
	rows: { pid: number; name: string; tid: number; score: number }[];
};

export const getAwardRaces = async (season: number): Promise<AwardRace[]> => {
	const candidates = (await getAwardCandidates(season)).awardCandidates.flat();
	const out: AwardRace[] = [];
	for (const key of TRACKED_AWARDS) {
		const award = candidates.find(
			(a) =>
				a.shortName === key &&
				a.numTeams === undefined &&
				a.group === undefined &&
				a.statRange === undefined,
		);
		if (!award || award.players.length === 0) {
			continue;
		}
		out.push({
			key,
			name: award.name,
			rows: award.players.slice(0, NUM_KEPT).map((p) => ({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				tid: p.tid,
				score: p.currentStats.score ?? 0,
			})),
		});
	}
	return out;
};

const maxGp = async (season: number) => {
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[season], [season, "Z"]],
	);
	return Math.max(
		0,
		...teamSeasons.map(
			(ts) => ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0),
		),
	);
};

export const getAwardRaceHistory = (): AwardRaceHistory | undefined => {
	try {
		return g.get("awardRaceHistory");
	} catch {
		return undefined;
	}
};

// Called with the weekly power rankings snapshot during the regular season
export const snapshotAwardRaces = async () => {
	if (__SPORT !== "basketball") {
		return;
	}
	const season = g.get("season");
	const gp = await maxGp(season);
	if (gp === 0) {
		return;
	}
	const races = await getAwardRaces(season);
	if (races.length === 0) {
		return;
	}
	const prev = getAwardRaceHistory();
	const snapshots = prev?.season === season ? prev.snapshots : [];
	if (snapshots.at(-1)?.gp === gp) {
		return;
	}
	const awardRaceHistory: AwardRaceHistory = {
		season,
		snapshots: [
			...snapshots,
			{
				gp,
				races: Object.fromEntries(
					races.map((race) => [race.key, race.rows.map((row) => row.pid)]),
				),
			},
		].slice(-MAX_SNAPSHOTS),
	};
	await league.setGameAttributes({ awardRaceHistory });
};

// Previous rank (1-based) of each player in the snapshot before the current standings, at least minGap games earlier. undefined
// for players outside the previous top 5; no map at all when there is no earlier snapshot
export const previousRanks = (
	history: AwardRaceHistory | undefined,
	season: number,
	gp: number,
	key: string,
	minGap = 3,
): { ranks: Map<number, number>; gp: number } | undefined => {
	if (history?.season !== season) {
		return undefined;
	}
	const snapshot = history.snapshots.findLast(
		(s) => s.gp <= gp - minGap && s.races[key],
	);
	if (!snapshot) {
		return undefined;
	}
	return {
		ranks: new Map(snapshot.races[key]!.map((pid, i) => [pid, i + 1])),
		gp: snapshot.gp,
	};
};
