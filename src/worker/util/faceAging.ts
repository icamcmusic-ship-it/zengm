// Worker side of League Extras "Face Aging" (common/faceAging.ts): when faces are aged, and which ones.
// Faces are aged once a season at the preseason (and caught up when a league is created or a draft class is generated),
// seeded from pid and season. Nothing here uses Math.random or the game's random stream.
import { DEFAULT_JERSEY, PLAYER } from "../../common/constants.ts";
import {
	ageFaceForSeason,
	agedFields,
	applyAgingFields,
	extractAgingFields,
	faceAgingAfterEdit,
	faceForSeason,
	generatedBase,
	type FaceAging,
	type FaceAgingOptions,
} from "../../common/faceAging.ts";
import {
	EYE_INJURIES,
	offCourtFace,
	textureOf,
} from "../../common/faceEvents.ts";
import {
	firstProSeason,
	firstSeasonLabel,
	NEUTRAL_JERSEY_COLORS,
	primeSeason,
	seasonTeam,
	type FaceHistoryEntry,
	type FaceHistoryLabel,
} from "../../common/faceHistory.ts";
import type { Player } from "../../common/types.ts";
import { isCollege } from "../core/college/isCollege.ts";
import { idb } from "../db/index.ts";
import g from "./g.ts";
import { getTeamInfoBySeason } from "./getTeamInfoBySeason.ts";
import { featureOn, featureOption } from "./nativeFeatures.ts";

type AgingPlayer = Pick<
	Player,
	"pid" | "born" | "face" | "imgURL" | "stats" | "weight"
> &
	Partial<Pick<Player, "tid" | "retiredYear" | "injuries">> & {
		faceAging?: FaceAging;
	};

export const faceAgingOptions = (): FaceAgingOptions => ({
	speed: featureOption<FaceAgingOptions["speed"]>("faceAgingSpeed"),
	hairLoss: featureOption<boolean>("faceAgingHairLoss"),
	graying: featureOption<boolean>("faceAgingGraying"),
	styleEvents: featureOption<boolean>("faceAgingStyleEvents"),
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

// What aging needs to know about him besides his age (seeded by pid)
const agingContext = (p: AgingPlayer) => {
	const base = p.faceAging?.b;
	return {
		seed: p.pid,
		born: p.born.year,
		minutes: careerMinutes(p),
		weight: p.weight,
		texture: textureOf(
			p.face.body?.color,
			base?.hi ?? p.face.hair.id,
			base?.hb ?? p.face.hairBg?.id,
		),
		retiredYear: p.tid === PLAYER.RETIRED ? p.retiredYear : undefined,
		eyeInjurySeasons: (p.injuries ?? [])
			.filter((row) => EYE_INJURIES.has(row.type))
			.map((row) => row.season),
	};
};

// Retired players' snapshots: a visible change (style, lines, glasses, fatness by SPARSE_FATNESS) any season; the slow
// greying and filling out only the first season after he retired and every RETIRED_SNAPSHOT_EVERY seasons. Seasons in
// between show the last snapshot's face (a few years of greying behind, at most)
export const RETIRED_SNAPSHOT_EVERY = 5;
export const retiredSnapshotSeason = (season: number, retiredYear: number) => {
	const years = season - retiredYear;
	return years <= 1 || years % RETIRED_SNAPSHOT_EVERY === 0;
};

// Ages one player's face to a season, in place. Returns true if his face or its stored aging state (generated fields,
// snapshots) changed, so the caller saves the player. Only the season marker moving isn't worth a write: without it the same
// (pure, cheap) aging is just worked out again next time.
export const agePlayerFace = (
	p: AgingPlayer,
	season: number,
	options: FaceAgingOptions = faceAgingOptions(),
) => {
	// Real players' photos are untouched, and so is a player without a generated face
	if (p.imgURL || !p.face?.hair || p.pid === undefined) {
		return false;
	}
	const retired = p.tid === PLAYER.RETIRED && p.retiredYear !== undefined;
	const result = ageFaceForSeason(
		p.face,
		p.faceAging,
		{
			...agingContext(p),
			season,
			// No snapshot of a draft prospect's face: face history starts at his first pro season. Retired players (who age
			// a little every year) keep a sparse one, so it doesn't grow every season for the rest of the league
			record: p.tid !== PLAYER.UNDRAFTED,
			sparse: retired
				? { force: retiredSnapshotSeason(season, p.retiredYear!) }
				: undefined,
		},
		options,
	);
	if (!result) {
		return false;
	}
	const changed =
		!p.faceAging ||
		JSON.stringify(result.aging.b) !== JSON.stringify(p.faceAging.b) ||
		JSON.stringify(result.aging.h) !== JSON.stringify(p.faceAging.h) ||
		JSON.stringify(extractAgingFields(result.face)) !==
			JSON.stringify(extractAgingFields(p.face));
	p.face = result.face;
	p.faceAging = result.aging;
	return changed;
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

// A generated face that hasn't been aged or edited yet: what Customize Player starts a new player with, and what "Randomize"
// gives (the form sends the face with this state). Aging only ever touches the aging fields, so a face whose aging fields are
// still the generated ones has nothing of the user's for aging to overwrite.
export const freshFaceAging = (face: AgingPlayer["face"]): FaceAging => ({
	b: extractAgingFields(face),
	h: {},
});

const isFreshFace = (p: AgingPlayer) => {
	const aging = p.faceAging;
	return (
		!!aging &&
		aging.e === undefined &&
		aging.s === undefined &&
		Object.keys(aging.h ?? {}).length === 0 &&
		JSON.stringify(aging.b) === JSON.stringify(extractAgingFields(p.face))
	);
};

// Customize Player save: a face the user changed is locked from aging (unless "Allow aging" is ticked), and ages on from
// the edited face if allowed. The UI sends p.faceAging with its "a" flag set from the checkbox. A generated face nobody edited
// (a new player's, or a "Randomize" one) isn't locked: it gets a clean aging state, and true is returned so the caller ages
// it to his age once he has a pid.
export const faceAgingOnCustomize = (
	p: AgingPlayer,
	prev: AgingPlayer | undefined,
	season: number,
) => {
	if (!p.imgURL && p.face?.hair && isFreshFace(p)) {
		p.faceAging = freshFaceAging(p.face);
		return true;
	}
	// "Reset to generated face": his generated fields back, unlocked, his history kept, and aged back to now on save (unless
	// the face was edited again after the reset)
	const reset = p.faceAging?.r === 1;
	if (reset) {
		delete p.faceAging!.r;
		const generated = generatedBase(prev?.faceAging);
		if (
			!p.imgURL &&
			p.face?.hair &&
			generated &&
			JSON.stringify(extractAgingFields(p.face)) ===
				JSON.stringify(extractAgingFields(applyAgingFields(p.face, generated)))
		) {
			// This season's snapshot is recorded again when he's aged
			const h = { ...prev?.faceAging?.h };
			for (const key of Object.keys(h)) {
				if (Number(key) >= season) {
					delete h[Number(key)];
				}
			}
			p.faceAging = { b: generated, h };
			return true;
		}
	}
	const allow = p.faceAging?.a === 1;
	const age = season - p.born.year;
	// Only what aging works on counts as an edit: the external facesjs editor's round trip can reorder or drop things aging
	// never touches (team colours, jersey, the fork's other extras)
	const changed =
		!prev ||
		reset ||
		JSON.stringify(extractAgingFields(prev.face)) !==
			JSON.stringify(extractAgingFields(p.face));
	if (changed) {
		p.faceAging = faceAgingAfterEdit(
			prev?.faceAging,
			p.face,
			age,
			allow,
			season,
		);
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
	return false;
};

// His face in any season: rebuilt from the snapshots, or worked out from his generated face for a season before them (a
// veteran when the league or face aging began; not after a user edit, then the earliest snapshot stands in)
export const faceAtSeason = (p: AgingPlayer, season: number) => {
	const aging = p.faceAging;
	if (!aging) {
		return p.face;
	}
	const first = Math.min(...Object.keys(aging.h).map(Number));
	if (season >= first || aging.ba !== undefined) {
		return faceForSeason(p.face, aging, season);
	}
	const fields = agedFields(
		aging.b,
		{ ...agingContext(p), age: season - p.born.year },
		faceAgingOptions(),
	);
	return applyAgingFields(p.face, fields);
};

// The jersey of the team he played the most games for that season, in that season's colours; a plain one without a team
const jerseyGetter = (p: HistoryAgingPlayer) => {
	const cache = new Map<
		string,
		{ colors: [string, string, string]; jersey: string }
	>();
	const currentSeason = g.get("season");
	return async (season: number) => {
		const tid = seasonTeam(p, season, currentSeason);
		const key = `${tid}|${season}`;
		let out = cache.get(key);
		if (!out) {
			const info =
				tid === undefined ? undefined : await getTeamInfoBySeason(tid, season);
			out = info
				? { colors: info.colors, jersey: info.jersey ?? DEFAULT_JERSEY }
				: { colors: NEUTRAL_JERSEY_COLORS, jersey: DEFAULT_JERSEY };
			cache.set(key, out);
		}
		return out;
	};
};

type HistoryAgingPlayer = AgingPlayer &
	Pick<Player, "draft" | "tid" | "ratings">;

// The player page's "Then and Now": from his first pro season (never a draft prospect's face), every season his face changed
// after it, and his prime for a retired player. Each face wears that season's jersey.
export const playerFaceHistory = async (
	p: HistoryAgingPlayer,
): Promise<{ entries: FaceHistoryEntry[]; prime?: FaceHistoryEntry }> => {
	const aging = p.faceAging;
	const empty = { entries: [] };
	if (!aging || p.pid === undefined) {
		return empty;
	}
	const college = isCollege();
	const currentSeason = g.get("season");
	const proStart = firstProSeason(p, currentSeason, college);
	const seasons = Object.keys(aging.h)
		.map(Number)
		.sort((a, b) => a - b);
	if (proStart === undefined || seasons.length === 0) {
		return empty;
	}
	const jersey = jerseyGetter(p);
	const entry = async (
		season: number,
		face: Player["face"],
		label?: FaceHistoryLabel,
	): Promise<FaceHistoryEntry> => ({
		season,
		face,
		...(await jersey(season)),
		...(label ? { label } : {}),
	});

	const label = firstSeasonLabel(p, proStart, g.get("startingSeason"), college);
	const entries: FaceHistoryEntry[] = [];
	if (proStart >= seasons[0]! || aging.ba === undefined) {
		entries.push(await entry(proStart, faceAtSeason(p, proStart), label));
	} else {
		// Edited before his records began: the earliest snapshot, unlabelled
		entries.push(
			await entry(seasons[0]!, faceForSeason(p.face, aging, seasons[0]!)),
		);
	}
	for (const season of seasons) {
		if (season > entries[0]!.season) {
			entries.push(await entry(season, faceForSeason(p.face, aging, season)));
		}
	}

	// A retired player's "Now": his face today, not his last playing season's: retirement aging up to this season (with
	// "Age Retired Players"; else his face as of retirement), off-court (no headband or goggles), in a plain jersey
	if (p.tid === PLAYER.RETIRED) {
		const now: FaceHistoryEntry = {
			season: currentSeason,
			face: retiredFaceNow(p, currentSeason),
			colors: NEUTRAL_JERSEY_COLORS,
			jersey: DEFAULT_JERSEY,
		};
		while (entries.length > 1 && entries.at(-1)!.season >= currentSeason) {
			entries.pop();
		}
		entries.push(now);
	}

	let prime: FaceHistoryEntry | undefined;
	if (p.tid === PLAYER.RETIRED) {
		const season = primeSeason(p, proStart);
		if (
			season !== undefined &&
			season !== entries[0]!.season &&
			season !== entries.at(-1)!.season
		) {
			prime = await entry(season, faceAtSeason(p, season));
		}
	}
	return prime ? { entries, prime } : { entries };
};

export const retiredFaceNow = (p: AgingPlayer, season: number) => {
	const aging = p.faceAging;
	let face = p.face;
	if (
		aging &&
		aging.ba === undefined &&
		featureOption<boolean>("faceAgingRetired") &&
		p.retiredYear !== undefined
	) {
		face = applyAgingFields(
			p.face,
			agedFields(
				aging.b,
				{ ...agingContext(p), age: season - p.born.year },
				faceAgingOptions(),
			),
		);
	}
	return offCourtFace(face);
};

// HoF plaques: his face in his prime (common/faceHistory.ts primeSeason), in that season's jersey
export const primeFace = async (p: HistoryAgingPlayer) => {
	const proStart = firstProSeason(p, g.get("season"), isCollege());
	const season = proStart === undefined ? undefined : primeSeason(p, proStart);
	if (season === undefined) {
		return undefined;
	}
	return {
		season,
		face: p.faceAging && !p.imgURL ? faceAtSeason(p, season) : p.face,
		...(await jerseyGetter(p)(season)),
	};
};
