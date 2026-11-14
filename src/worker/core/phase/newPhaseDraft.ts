import { PLAYER } from "../../../common/constants.ts";
import { draft, league } from "../index.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import type { Conditions, PhaseReturn } from "../../../common/types.ts";
import { NotEnoughTeamsError } from "../draft/genOrder.ts";
import * as college from "../college/index.ts";

// The retired players the old scan of the "draft.year, retiredYear" index (drafted in the last 110 years) would reach, in
// that index's order (so the random draws for deaths are the same). perf2: one getAll of the retired players instead of a
// cursor over every player ever drafted, active ones included, which got slow as the history grew.
export const getKillCandidates = async (currentSeason: number) => {
	const retired = await idb.league
		.transaction("players")
		.store.index("tid")
		.getAll(PLAYER.RETIRED);
	const lower = [currentSeason - 110];
	const upper = [""];
	const keyed: { p: (typeof retired)[number]; key: unknown[] }[] = [];
	for (const p of retired) {
		const key = [p.draft?.year, p.retiredYear];
		try {
			// (a record whose key isn't a valid key isn't in the index; cmp throws for those)
			if (indexedDB.cmp(key, lower) >= 0 && indexedDB.cmp(key, upper) <= 0) {
				keyed.push({ p, key });
			}
		} catch {}
	}
	// Index order: the key, then the primary key (getAll already returned them by pid, and the sort is stable)
	keyed.sort((a, b) => indexedDB.cmp(a.key, b.key));
	return keyed.map((row) => row.p);
};

const newPhaseDraft = async (conditions: Conditions): Promise<PhaseReturn> => {
	// College mode: this phase is the departures (graduation and the off-screen pro draft)
	if (college.isCollege()) {
		return college.newPhaseDepartures(conditions);
	}

	// In case some weird situation results in games still in the schedule, clear them
	await idb.cache.schedule.clear();

	// Kill off old retired players (done here since not much else happens in this phase change, so making it a little
	// slower is fine). This assumes all killable players have no changes in the cache, which is almost certainly true,
	// but under certain rare cases could cause a minor problem. For performance reasons, this also assumes that any
	// player drafted more than 110 years ago is dead already. If that's not true, congrats on immortality!
	const promises: Promise<unknown>[] = [];

	const currentSeason = g.get("season");
	for (const p of await getKillCandidates(currentSeason)) {
		// Skip dead players
		if (typeof p.diedYear === "number") {
			continue;
		}

		// Skip real players dying young
		if (p.real && currentSeason - p.born.year < 70) {
			continue;
		}

		// Formula badly fit to http://www.ssa.gov/oact/STATS/table4c6.html
		const probDeath =
			0.0001165111 * Math.exp(0.0761889274 * (currentSeason - p.born.year));

		if (Math.random() < probDeath) {
			p.diedYear = currentSeason;
			promises.push(idb.cache.players.put(p));
		}
	}

	await Promise.all(promises);

	await draft.genPlayers(currentSeason);

	if (g.get("draftType") !== "freeAgents") {
		// Run lottery only if it hasn't been done yet
		const draftLotteryResult =
			await idb.merged.draftLotteryResults.get(currentSeason);

		if (!draftLotteryResult) {
			try {
				await draft.genOrder(false, conditions);
			} catch (error) {
				if (!(error instanceof NotEnoughTeamsError)) {
					throw error;
				}

				// If not enough teams, do no lottery
				await draft.genOrder(false, conditions, "noLottery");
			}
		}

		// This is a hack to handle weird cases where already-drafted players have draft.year set to the current season, which fucks up the draft UI
		const players = (await idb.cache.players.getAll()).filter(
			(p) => p.draft.year === currentSeason && p.tid >= 0,
		);
		if (players.length > 0) {
			for (const p of players) {
				p.draft.year -= 1;
			}
			await idb.cache.players.putAll(players);
		}
	}

	await league.setGameAttributes({
		otherTeamsWantToHire: false,
	});

	let redirect;
	if (g.get("draftType") !== "freeAgents") {
		redirect = {
			url: helpers.leagueUrl(["draft"]),
			text: "View the draft",
		};
	}

	return {
		redirect,
	};
};

export default newPhaseDraft;
