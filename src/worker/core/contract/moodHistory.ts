import { isCollege } from "../college/isCollege.ts";
import type {
	MoodComponents,
	MoodSnapshot,
	Player,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers } from "../../util/index.ts";
import moodInfo from "../player/moodInfo.ts";

// Enough for about 10 seasons at 3 snapshots per season
export const MAX_MOOD_SNAPSHOTS = 30;

export const sumMoodComponents = (components: MoodComponents) => {
	let sum = 0;
	for (const key of helpers.keys(components)) {
		if (key === "custom") {
			for (const row of components.custom ?? []) {
				sum += row.amount;
			}
		} else {
			sum += components[key];
		}
	}
	return sum;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

export const makeMoodSnapshot = (
	{
		components,
		probWilling,
	}: { components: MoodComponents; probWilling: number },
	tid: number,
): MoodSnapshot => {
	const { custom, ...rest } = components;
	const rounded = { ...rest };
	for (const key of helpers.keys(rounded)) {
		rounded[key] = round1(rounded[key]);
	}
	return {
		season: g.get("season"),
		phase: g.get("phase"),
		tid,
		components: rounded,
		sum: round1(sumMoodComponents(components)),
		probWilling: Math.round(probWilling * 100) / 100,
	};
};

export const addMoodSnapshot = (p: Player, snapshot: MoodSnapshot) => {
	const history = p.moodHistory ?? [];

	// One per season and phase
	const existing = history.findIndex(
		(row) => row.season === snapshot.season && row.phase === snapshot.phase,
	);
	if (existing >= 0) {
		history[existing] = snapshot;
	} else {
		history.push(snapshot);
	}
	p.moodHistory = history.slice(-MAX_MOOD_SNAPSHOTS);
};

// Snapshot the mood of every player on a team, for the mood history on the player page
export const recordMoodSnapshots = async () => {
	// College mode: no contracts, so no mood history (and thousands of players)
	if (isCollege()) {
		return;
	}
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	for (const p of players) {
		const info = await moodInfo(p, p.tid);
		addMoodSnapshot(p, makeMoodSnapshot(info, p.tid));
		await idb.cache.players.put(p);
	}
};
