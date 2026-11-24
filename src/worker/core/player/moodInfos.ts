import { g } from "../../util/index.ts";
import moodInfo from "./moodInfo.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { finances } from "../index.ts";
import {
	getLockerRoomWorstEgos,
	isEgoKnownToUser,
	traitsEnabled,
} from "./traits.ts";

type MoodInfoWithEgos = Awaited<ReturnType<typeof moodInfo>> & {
	// Player traits: the teammates whose egos pull his "Locker room" mood down the most (at most 2), only those the user knows the ego of
	lockerRoomEgos?: string[];
};

// Below this (it shows as -1 or less) the mood panel names the worst egos
const NAME_EGOS_BELOW = -0.5;

const addLockerRoomEgos = async (
	p: Player,
	tid: number,
	mood: MoodInfoWithEgos,
	getScoutingLevel: () => Promise<number>,
) => {
	if (mood.components.lockerRoom >= NAME_EGOS_BELOW) {
		return;
	}
	const teammates = await idb.cache.players.indexGetAll("playersByTid", tid);
	const scoutingLevel = await getScoutingLevel();
	const egos = getLockerRoomWorstEgos(p, teammates as any, tid, (p2: any) =>
		isEgoKnownToUser(p2, scoutingLevel),
	) as unknown as Player[];
	if (egos.length > 0) {
		mood.lockerRoomEgos = egos.map((p2) => `${p2.firstName} ${p2.lastName}`);
	}
};

// Computes moodInfo for both userTid and current team
const moodInfos = async (
	p: Player,
	overrides: {
		contractAmount?: number;
	} = {},
) => {
	const userTid = g.get("userTid");

	const user: MoodInfoWithEgos = await moodInfo(p, userTid, overrides);

	let current: MoodInfoWithEgos | undefined;
	if (p.tid === userTid) {
		current = user;
	} else if (p.tid >= 0) {
		current = await moodInfo(p, p.tid, overrides);
	}

	if (traitsEnabled()) {
		let scoutingLevel: number | undefined;
		const getScoutingLevel = async () => {
			scoutingLevel ??= await finances.getLevelLastThree("scouting", {
				tid: userTid,
			});
			return scoutingLevel;
		};
		await addLockerRoomEgos(p, userTid, user, getScoutingLevel);
		if (current && current !== user) {
			await addLockerRoomEgos(p, p.tid, current, getScoutingLevel);
		}
	}

	return {
		user,
		current,
	};
};

export default moodInfos;
