// Hall of Fame Watch: active and recently retired players' Hall of Fame cases (core/hallOfFame/watch.ts)
import { PLAYER } from "../../common/constants.ts";
import { HOF_MAX_YEARS } from "../../common/hofBallot.ts";
import { idb } from "../db/index.ts";
import { defineView } from "../util/defineView.ts";
import { g } from "../util/index.ts";
import {
	hofBallotOn,
	hofBallotWait,
	legacyTidOf,
} from "../core/hallOfFame/index.ts";
import { hofWatchFor, seasonFracs } from "../core/hallOfFame/watch.ts";
import { getBestPos } from "../core/player/checkJerseyNumberRetirement.ts";
import type { Player } from "../../common/types.ts";

// Active players below this chance (and retired ones below this share of the threshold) are left off
const MIN_CHANCE = 0.01;
const MIN_RATIO = 0.5;
const MAX_ACTIVE = 150;

export default defineView({
	id: "hallOfFameWatch",
	load: async ({ updateEvents }) => {
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "Hall of Fame Watch is only available for basketball.",
			};
		}
		if (
			!(
				updateEvents.has("firstRun") ||
				updateEvents.has("newPhase") ||
				updateEvents.has("playerMovement") ||
				updateEvents.has("gameSim") ||
				updateEvents.has("gameAttributes")
			)
		) {
			return;
		}

		const season = g.get("season");
		const ballotOn = hofBallotOn();
		const fracs = await seasonFracs();
		const teamInfoCache = g.get("teamInfoCache");

		const toRow = (p: Player) => {
			const watch = hofWatchFor(p, fracs);
			if (!watch) {
				return;
			}
			const tid = p.tid >= 0 ? p.tid : legacyTidOf(p);
			return {
				pid: p.pid,
				firstName: p.firstName,
				lastName: p.lastName,
				age: season - p.born.year,
				pos: getBestPos(p, undefined),
				tid,
				abbrev: tid >= 0 ? (teamInfoCache[tid]?.abbrev ?? "") : "",
				retiredYear: p.tid === PLAYER.RETIRED ? p.retiredYear : undefined,
				ratio: watch.score / watch.threshold,
				projRatio: watch.projected / watch.threshold,
				...watch,
			};
		};

		const active = (
			await idb.cache.players.indexGetAll("playersByTid", [
				PLAYER.FREE_AGENT,
				Infinity,
			])
		)
			.map(toRow)
			.filter((row) => row !== undefined && row.chance >= MIN_CHANCE)
			.sort((a, b) => b!.chance - a!.chance || b!.projected - a!.projected)
			.slice(0, MAX_ACTIVE) as NonNullable<ReturnType<typeof toRow>>[];

		// Retired players still to be decided (waiting or on the ballot), and the latest ones decided
		const lookBack = ballotOn ? hofBallotWait() + 2 * HOF_MAX_YEARS : 10;
		const retired: NonNullable<ReturnType<typeof toRow>>[] = [];
		for (
			let year = season;
			year >= Math.max(g.get("startingSeason"), season - lookBack);
			year--
		) {
			for (const p of await idb.merged.players.getAll({ retiredYear: year })) {
				if (p.tid !== PLAYER.RETIRED) {
					continue;
				}
				const row = toRow(p);
				if (
					row &&
					(row.status === "inducted"
						? (row.inducted ?? 0) >= season - 10
						: row.ratio >= MIN_RATIO) &&
					// Long decided: only the last 10 seasons' retirees
					(row.status === "waiting" ||
						row.status === "ballot" ||
						year >= season - 10)
				) {
					retired.push(row);
				}
			}
		}
		retired.sort((a, b) => b.chance - a.chance || b.score - a.score);

		return {
			active,
			ballotOn,
			retired,
			season,
			wait: hofBallotWait(),
		};
	},
});
