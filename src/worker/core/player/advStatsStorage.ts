// Advanced Tracking Stats (League extras, see docs/native-features.md, common/advStats.ts): keeping the stored records small, and the
// play-type profile helper for other features (archetypes)
import {
	careerAdv,
	foldAdvRows,
	LINEUPS_FINAL,
	playTypeProfile,
	pruneLineups,
	sumAdv,
} from "../../../common/advStats.ts";
import { PLAYER } from "../../../common/constants.ts";
import { isPreDraftStatsRow } from "../../../common/preDraft.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import { league } from "../index.ts";

// Setting off ("Keep Career Tracking for Retired Players"): a retired player keeps his tracking records for his last few seasons only
// (like the sub-ratings history)
export const ADV_RETIRED_SEASONS = 3;

export const trimAdvOnRetire = (p: Pick<Player, "stats">) => {
	const seasons = [
		...new Set(p.stats.filter((row) => row.adv).map((row) => row.season)),
	].sort((a, b) => b - a);
	if (seasons.length <= ADV_RETIRED_SEASONS) {
		return;
	}
	const keepFrom = seasons[ADV_RETIRED_SEASONS - 1]!;
	for (const row of p.stats) {
		if (row.adv && row.season < keepFrom) {
			delete row.adv;
		}
	}
};

// Setting on: every pro stats row's adv (regular season and playoffs, every team, partial seasons too) is added into p.advCareer and
// deleted from the row. Idempotent: a folded row has no adv left, so folding again (a comeback's re-retirement, the fold pass) only
// adds the rows played since. Returns whether anything was folded.
export const foldAdvCareer = (
	p: Pick<Player, "stats" | "advCareer" | "draft">,
) => {
	if (!p.stats.some((row) => row.adv)) {
		return false;
	}
	const draftYear = p.draft?.year;
	const career = foldAdvRows(
		p.advCareer,
		p.stats,
		(row) =>
			!isPreDraftStatsRow(row as { tid?: number; season: number }, draftYear),
	);
	if (career) {
		p.advCareer = career;
	}
	return true;
};

const foldOn = () => __SPORT === "basketball" && featureOn("advCareer");

// At retirement (player.retire, which deaths and Hall of Fame inductions go through too): fold with the setting on, today's trim off
export const advOnRetire = async (
	p: Pick<Player, "stats" | "advCareer" | "draft">,
) => {
	if (__SPORT !== "basketball") {
		return;
	}
	if (foldOn()) {
		foldAdvCareer(p);
		return;
	}
	trimAdvOnRetire(p);
	// Some retired player still has season rows to fold if the setting is turned on later
	if (g.get("advCareerFolded") && p.stats.some((row) => row.adv)) {
		await league.setGameAttributes({ advCareerFolded: false });
	}
};

// With the setting on, once per league and again after retirements with it off: folds every retired player who still has tracking on
// his rows (players who retired with the trim keep only their last 3 seasons, which are what gets folded). Runs at each phase change
// and when League Extras are saved, until done; a no-op after that. Returns the number of players folded.
export const foldRetiredAdvCareers = async () => {
	if (!foldOn() || g.get("advCareerFolded")) {
		return 0;
	}
	// The ones in the cache (retired this session, or still owed money) and the ones in the database, read through the cache
	const pids = new Set<number>();
	for (const p of await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.RETIRED,
		PLAYER.RETIRED,
	])) {
		if (p.stats.some((row) => row.adv)) {
			pids.add(p.pid);
		}
	}
	for await (const cursor of idb.league
		.transaction("players")
		.store.index("tid")
		.iterate(PLAYER.RETIRED)) {
		if (cursor.value.stats.some((row) => row.adv)) {
			pids.add(cursor.value.pid);
		}
	}
	let count = 0;
	for (const pid of pids) {
		const p = await idb.merged.players.get(pid);
		if (p && p.tid === PLAYER.RETIRED && foldAdvCareer(p)) {
			await idb.cache.players.put(p);
			count += 1;
		}
	}
	await league.setGameAttributes({ advCareerFolded: true });
	return count;
};

// After the playoffs: each team-season keeps its LINEUPS_FINAL most used lineups
export const pruneSeasonLineups = async (season: number = g.get("season")) => {
	const numPlayers = g.get("numPlayersOnCourt");
	const rows = await idb.cache.teamStats.getAll();
	for (const row of rows) {
		if (row.season === season && row.adv && row.adv.lu.length > LINEUPS_FINAL) {
			row.adv.lu = pruneLineups(row.adv.lu, numPlayers, LINEUPS_FINAL);
			await idb.cache.teamStats.put(row);
		}
	}
};

// A player's play-type profile (each play type's possessions, frequency, points per possession, FG%, TOV%) for one regular season (all
// his teams), or over every regular season with tracking stats. Undefined without tracking stats. For archetypes (step 4) and others.
// The career profile includes his folded career total (a retired player, or one who came back).
export const getPlayTypeProfile = (
	p: Pick<Player, "stats" | "advCareer">,
	season?: number,
) => {
	const rows = p.stats.filter(
		(row) => !row.playoffs && (season === undefined || row.season === season),
	);
	return playTypeProfile(
		season === undefined
			? careerAdv(p.advCareer, rows, "regularSeason")
			: sumAdv(rows),
	);
};
