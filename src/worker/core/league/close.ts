import { idb } from "../../db/index.ts";
import { flushAdvBatch } from "../game/advBatch.ts";
import { g, local, lock, updateStatus } from "../../util/index.ts";
import { cleanupAutoPlay } from "../league/autoPlay.ts";
import { cancelLeagueAchievementsCheck } from "../../util/leagueAchievements.ts";

// Flush cache, disconnect from league database, and unset g.get("lid")
const close = async (disconnect?: boolean) => {
	const gameSim = lock.get("gameSim");
	cleanupAutoPlay();
	cancelLeagueAchievementsCheck();
	await lock.set("stopGameSim", true);
	await lock.set("gameSim", false);

	// Wait in case stuff is still happening (ugh)
	if (gameSim) {
		await new Promise<void>((resolve) => {
			setTimeout(() => {
				resolve();
			}, 1000);
		});
	}

	if (g.get("lid") !== undefined && idb.league !== undefined) {
		// perf3: tracking stats still waiting to be added (game/advBatch.ts)
		if (local.leagueLoaded) {
			await flushAdvBatch();
		}
		// _dirty check is to prevent UI flicker if there is nothing to flush
		if (local.leagueLoaded && idb.cache._dirty) {
			await updateStatus("Saving...");
			await idb.cache.flush();
			await updateStatus();
		}

		if (disconnect) {
			idb.cache.stopAutoFlush();

			// Should probably "close" cache here too, but no way to do that now
			idb.league.close();
		}
	}

	if (disconnect) {
		lock.reset();
		local.reset();

		// Probably this should delete all other properties on g and reset it to GameAttributesNonLeague by calling helpers.resetG, but I don't want to mess with it now and maybe break stuff.
		// @ts-expect-error
		g.setWithoutSavingToDB("lid", undefined);
	}
};

export default close;
