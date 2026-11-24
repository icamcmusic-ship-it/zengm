import { idb } from "../../db/index.ts";
import { g, toUI } from "../../util/index.ts";
import { player } from "../index.ts";
import { PLAYER } from "../../../common/constants.ts";
import type { Player } from "../../../common/types.ts";
import { hofBallotOn } from "../hallOfFame/index.ts";

/**
 * Whether he is in the Hall of Fame after a recompute, or undefined to leave him as he is. Inductions by the ballot or the veterans
 * committee are kept, and with the ballot on, its candidates (retired since the league started) are left to the ballot: madeHof
 * only decides where the ballot doesn't apply.
 */
export const recomputedHof = (
	p: Player,
	{ ballotOn, startingSeason }: { ballotOn: boolean; startingSeason: number },
): boolean | undefined => {
	const status = p.hofBallot?.status;
	if (status === "inducted" || status === "veterans") {
		return undefined;
	}
	if (ballotOn && p.tid === PLAYER.RETIRED && p.retiredYear >= startingSeason) {
		return undefined;
	}
	return p.tid === PLAYER.RETIRED && player.madeHof(p);
};

const recomputeHallOfFame = async () => {
	const options = {
		ballotOn: hofBallotOn(),
		startingSeason: g.get("startingSeason"),
	};
	const tx = idb.league.transaction("players", "readwrite");

	for await (const cursor of tx.store) {
		const p = cursor.value;

		const made = recomputedHof(p, options);
		if (made === undefined) {
			continue;
		}

		const prev = p.hof;
		if (made) {
			p.hof = 1;
		} else {
			delete p.hof;
		}

		if (p.hof !== prev) {
			await cursor.update(p);
		}
	}

	await tx.done;

	await idb.cache.fill();
	await toUI("realtimeUpdate", [["firstRun"]]);
	console.log("Done!");
};

export default recomputeHallOfFame;
