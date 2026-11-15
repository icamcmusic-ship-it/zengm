import { g, local, lock } from "./index.ts";
import { featureOn } from "./nativeFeatures.ts";
import { hasPage } from "./pagePersist.ts";
import { storedGameSeasons, warmGameSums } from "./gameSummaries.ts";
import { warmSeasonBest } from "./bestGamesData.ts";
import { getLeagueAchievements } from "./leagueAchievements.ts";
import { getWrappedStatus } from "./wrappedData.ts";

// Background warm-up of the pages that read whole seasons of box scores (Best Games, Home Court, Rivalries, Team
// History's rivals card) and of League Achievements, so that opening them doesn't wait for that. A past season's box
// scores are read once and what the pages need from them kept across sessions (gameSummaries.ts, bestGamesData.ts,
// pagePersist.ts); League Achievements' engine result is kept for the session. Asked for when a league is loaded and after
// phase changes; it waits until things are quiet (no games being simmed, no auto play), does one season at a time and
// stops when the league changes.

let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;
let token = 0;

const busy = () =>
	lock.get("gameSim") ||
	lock.get("newPhase") ||
	local.autoPlayUntil !== undefined;

const pause = () => new Promise((resolve) => setTimeout(resolve, 50));

const warm = async (myToken: number) => {
	const lid = g.get("lid");
	const stale = () => myToken !== token || g.get("lid") !== lid || busy();
	const current = g.get("season");
	const seasons = (await storedGameSeasons())
		.filter((s) => s < current)
		.reverse();
	const sums = featureOn("frivolities") || featureOn("rivalries");
	const best = __SPORT === "basketball" && featureOn("bestGames");
	for (const season of seasons) {
		if (sums && !(await hasPage(lid, "sums", season))) {
			if (stale()) {
				return false;
			}
			await warmGameSums(season);
			await pause();
		}
		if (best && !(await hasPage(lid, "best", season))) {
			if (stale()) {
				return false;
			}
			await warmSeasonBest(season);
			await pause();
		}
	}
	// The current season's (kept for the session; after more games, only theirs are new)
	if (best && !stale()) {
		await warmSeasonBest(current);
		await pause();
	}
	if (__SPORT === "basketball" && featureOn("leagueAchievements") && !stale()) {
		// Starts the snapshot (persisted, see wrappedData.ts) if it isn't ready, then the engine (memoized)
		if (getWrappedStatus(false).status !== "error") {
			await getLeagueAchievements();
		}
	}
	return true;
};

export const schedulePageWarm = (delay = 2000) => {
	clearTimeout(timer);
	timer = setTimeout(async () => {
		timer = undefined;
		if (!local.leagueLoaded || !Object.hasOwn(g, "lid")) {
			return;
		}
		if (busy()) {
			schedulePageWarm(5000);
			return;
		}
		if (running) {
			again = true;
			return;
		}
		running = true;
		const myToken = token;
		let done = true;
		try {
			done = await warm(myToken);
		} catch (error) {
			console.error("Page warm-up failed", error);
		} finally {
			running = false;
			if (again || (!done && myToken === token)) {
				again = false;
				schedulePageWarm(5000);
			}
		}
	}, delay);
	(timer as { unref?: () => void }).unref?.();
};

// League close: drop a pending warm-up, it belongs to the league being closed
export const cancelPageWarm = () => {
	clearTimeout(timer);
	timer = undefined;
	again = false;
	token += 1;
};
