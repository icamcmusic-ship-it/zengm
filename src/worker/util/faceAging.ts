// Worker side of League Extras "Face Aging" (common/faceAging.ts): when faces are aged, and which ones.
// Faces are aged once a season at the preseason (and caught up when a league is created or a draft class is generated),
// seeded from pid and season. Nothing here uses Math.random or the game's random stream.
import { PLAYER } from "../../common/constants.ts";
import {
	ageFaceForSeason,
	agedFields,
	applyAgingFields,
	faceHistory,
	faceAgingAfterEdit,
	type FaceAging,
	type FaceAgingOptions,
} from "../../common/faceAging.ts";
import type { Player } from "../../common/types.ts";
import { idb } from "../db/index.ts";
import g from "./g.ts";
import { featureOn, featureOption } from "./nativeFeatures.ts";

type AgingPlayer = Pick<
	Player,
	"pid" | "born" | "face" | "imgURL" | "stats" | "weight"
> & {
	faceAging?: FaceAging;
};

export const faceAgingOptions = (): FaceAgingOptions => ({
	speed: featureOption<FaceAgingOptions["speed"]>("faceAgingSpeed"),
	hairLoss: featureOption<boolean>("faceAgingHairLoss"),
	graying: featureOption<boolean>("faceAgingGraying"),
});

const careerMinutes = (p: AgingPlayer) => {
	let min = 0;
	for (const row of p.stats ?? []) {
		if (!row.playoffs && typeof row.min === "number") {
			min += row.min;
		}
	}
	return min;
};

// Ages one player's face to a season, in place. Returns true if anything changed (the caller saves the player).
export const agePlayerFace = (
	p: AgingPlayer,
	season: number,
	options: FaceAgingOptions = faceAgingOptions(),
) => {
	// Real players' photos are untouched, and so is a player without a generated face
	if (p.imgURL || !p.face?.hair || p.pid === undefined) {
		return false;
	}
	const result = ageFaceForSeason(
		p.face,
		p.faceAging,
		{
			seed: p.pid,
			born: p.born.year,
			season,
			minutes: careerMinutes(p),
			weight: p.weight,
		},
		options,
	);
	if (!result) {
		return false;
	}
	p.face = result.face;
	p.faceAging = result.aging;
	return true;
};

// Preseason: active players and free agents (already being saved by the caller), draft prospects and, with the option,
// retired players
export const ageFacesForPreseason = async (
	players: AgingPlayer[],
	season: number,
) => {
	if (!featureOn("faceAging")) {
		return;
	}
	const options = faceAgingOptions();
	for (const p of players) {
		agePlayerFace(p, season, options);
	}

	for (const p of await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.UNDRAFTED,
		PLAYER.UNDRAFTED,
	])) {
		if (agePlayerFace(p, season, options)) {
			await idb.cache.players.put(p);
		}
	}

	if (featureOption<boolean>("faceAgingRetired")) {
		const pids = await idb.league
			.transaction("players")
			.store.index("tid")
			.getAllKeys(PLAYER.RETIRED);
		for (const pid of pids) {
			const p = await idb.merged.players.get(pid);
			if (
				p &&
				p.tid === PLAYER.RETIRED &&
				p.diedYear === undefined &&
				agePlayerFace(p, season, options)
			) {
				await idb.cache.players.put(p);
			}
		}
	}
};

// New players with pids (a new league, a new draft class): their faces are aged to now, which gives prospects their young look
export const ageNewPlayerFaces = async (players: AgingPlayer[]) => {
	if (!featureOn("faceAging")) {
		return;
	}
	const season = g.get("season");
	const options = faceAgingOptions();
	for (const p of players) {
		if (agePlayerFace(p, season, options)) {
			await idb.cache.players.put(p as Player);
		}
	}
};

export const ageAllFacesNewLeague = async () => {
	if (!featureOn("faceAging")) {
		return;
	}
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.UNDRAFTED,
		Infinity,
	]);
	await ageNewPlayerFaces(players);
};

// Customize Player save: a face the user changed is locked from aging (unless "Allow aging" is ticked), and ages on from
// the edited face if allowed. The UI sends p.faceAging with its "a" flag set from the checkbox.
export const faceAgingOnCustomize = (
	p: AgingPlayer,
	prev: AgingPlayer | undefined,
	season: number,
) => {
	const allow = p.faceAging?.a === 1;
	const age = season - p.born.year;
	const changed =
		!prev ||
		JSON.stringify(stripExtra(prev.face)) !==
			JSON.stringify(stripExtra(p.face));
	if (changed) {
		p.faceAging = faceAgingAfterEdit(prev?.faceAging, p.face, age, allow);
	} else if (prev?.faceAging) {
		p.faceAging = { ...prev.faceAging };
		if (allow) {
			p.faceAging.a = 1;
		} else {
			delete p.faceAging.a;
		}
	} else {
		delete p.faceAging;
	}
};

// Team colours and jersey are set for drawing, not chosen by the user
const stripExtra = (face: AgingPlayer["face"] | undefined) => {
	if (!face) {
		return face;
	}
	const { teamColors: _t, jersey: _j, ...rest } = face;
	return rest;
};

// The player page's face history: the stored seasons, led by his rookie face when that was before the league's records of
// him (a veteran in a new league), worked out from his generated face (no user edit since)
export const withRookieFace = (
	p: AgingPlayer & { draft: { year: number } },
) => {
	const history: {
		season: number;
		face: AgingPlayer["face"];
		rookie?: true;
	}[] = faceHistory(p.face, p.faceAging);
	const aging = p.faceAging;
	if (
		!aging ||
		aging.ba !== undefined ||
		history.length === 0 ||
		p.pid === undefined
	) {
		return history;
	}
	const rookieSeason = Math.max(p.draft.year + 1, p.born.year + 19);
	if (rookieSeason >= history[0]!.season) {
		history[0]!.rookie = true;
		return history;
	}
	const fields = agedFields(
		aging.b,
		{
			seed: p.pid,
			age: rookieSeason - p.born.year,
			born: p.born.year,
			weight: p.weight,
		},
		faceAgingOptions(),
	);
	return [
		{
			season: rookieSeason,
			face: applyAgingFields(p.face, fields),
			rookie: true as const,
		},
		...history,
	];
};
