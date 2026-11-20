import type { AllStarPlayer, Conditions } from "../../../common/types.ts";
import { orderBy } from "../../../common/utils.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { updatePlayerAwards } from "../awards/awardsByPlayer.ts";
import { getAllStarCandidates, isEligible } from "./create.ts";
import draftAll from "./draftAll.ts";
import * as dunkContest from "./dunkContest.ts";
import * as threeContest from "./threeContest.ts";

// Before the game: anyone on an All-Star team who got hurt, was released or retired since being picked is out, and the
// commissioner names the next best eligible player (same conference for East vs West style teams) in his place. Players
// traded since being picked still play, under their new team's label. Returns the replacements' pids.
export const replaceUnavailable = async (conditions: Conditions) => {
	const allStars = await idb.cache.allStars.get(g.get("season"));
	if (!allStars) {
		return [];
	}

	const pidsUsed = new Set(
		[...allStars.teams[0], ...allStars.teams[1], ...allStars.remaining].map(
			(p) => p.pid,
		),
	);

	const numOut: [number, number] = [0, 0];
	let changed = false;
	for (const i of [0, 1] as const) {
		const kept: AllStarPlayer[] = [];
		for (const entry of allStars.teams[i]) {
			const p = await idb.cache.players.get(entry.pid);
			if (p && isEligible(p) && p.injury.gamesRemaining === 0) {
				if (p.tid !== entry.tid) {
					// Traded: same All-Star, new team label
					entry.tid = p.tid;
					changed = true;
				}
				kept.push(entry);
			} else {
				numOut[i] += 1;
				changed = true;
				if (p) {
					// Still an All-Star, listed with the ones who can't play
					allStars.remaining.push({
						...entry,
						injured: true,
					});
				}
			}
		}
		allStars.teams[i] = kept;
	}

	const replacements: AllStarPlayer[] = [];
	if (numOut[0] + numOut[1] > 0) {
		let cidsByTid: Record<number, number> | undefined;
		let teamCids: (number | undefined)[] = [undefined, undefined];
		if (allStars.type === "byConf") {
			cidsByTid = {};
			for (const t of await idb.cache.teams.getAll()) {
				cidsByTid[t.tid] = t.cid;
			}
			// Same order as in create: the lower cid is team 0
			const confs = orderBy(g.get("confs"), "cid", "asc");
			teamCids = [confs[0]?.cid, confs[1]?.cid];
		}

		const candidates = (await getAllStarCandidates()).filter(
			(p) => !pidsUsed.has(p.pid) && p.injury.gamesRemaining === 0,
		);

		for (const i of [0, 1] as const) {
			for (let j = 0; j < numOut[i]; j++) {
				const ind = candidates.findIndex(
					(p) => cidsByTid === undefined || cidsByTid[p.tid] === teamCids[i],
				);
				if (ind < 0) {
					break;
				}
				const p = candidates[ind]!;
				candidates.splice(ind, 1);
				const obj: AllStarPlayer = {
					pid: p.pid,
					tid: p.tid,
					name: p.name,
				};
				allStars.teams[i].push(obj);
				replacements.push(obj);
			}
		}

		if (replacements.length > 0) {
			await updatePlayerAwards({
				awardsToDelete: [],
				awardsToSave: replacements.map((p) => ({
					...p,
					award: { type: "All-Star" },
				})),
				logEventInfo: {
					conditions,
				},
				season: g.get("season"),
			});
		}
	}

	if (changed) {
		await idb.cache.allStars.put(allStars);
	}

	return replacements.map((p) => p.pid);
};

export const simContests = async (conditions: Conditions) => {
	const allStars = await idb.cache.allStars.get(g.get("season"));
	if (allStars?.dunk && allStars.dunk.winner === undefined) {
		while (true) {
			const type = await dunkContest.simNextDunkEvent(conditions);
			if (type === "all") {
				break;
			}
		}
	}
	if (allStars?.three && allStars.three.winner === undefined) {
		while (true) {
			const type = await threeContest.simNextThreeEvent(conditions);
			if (type === "all") {
				break;
			}
		}
	}
};

// Everything before the All-Star Game is played: finish the draft and name injury replacements. Returns false if the two
// sides can't both field a full lineup (numPlayersOnCourt), in which case the game should be skipped.
const prepareGame = async (conditions: Conditions) => {
	const allStars = await idb.cache.allStars.get(g.get("season"));
	if (!allStars) {
		return false;
	}
	if (!allStars.finalized) {
		await draftAll();
	}

	await replaceUnavailable(conditions);

	const allStars2 = await idb.cache.allStars.get(g.get("season"));
	const numPlayersOnCourt = g.get("numPlayersOnCourt");
	return (
		allStars2 !== undefined &&
		allStars2.teams.every((t) => t.length >= numPlayersOnCourt)
	);
};

// Not enough healthy All-Stars for a game: the contests still happen, the game comes off the schedule, with a news note
export const skipGame = async (conditions: Conditions) => {
	await simContests(conditions);

	const numPlayersOnCourt = g.get("numPlayersOnCourt");
	logEvent(
		{
			type: "info",
			text: `The All-Star Game was canceled: there weren't enough healthy All-Stars to field two teams of ${numPlayersOnCourt} ${helpers.plural("player", numPlayersOnCourt)}.`,
			tids: [],
			showNotification: true,
			score: 20,
		},
		conditions,
	);
};

export default prepareGame;
