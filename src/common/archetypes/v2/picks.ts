// archv3: the user's own archetype picks as labeled players for the reading's neighbours (knn.ts). A pick ("Doesn't fit?",
// or a confirmation of the label shown) carries the reading inputs he was read from (tuning.ts PickInput: ratings with
// sub-ratings, play types, stats, traits); his features are read from them as the 2K list's are, and his label is the
// build the user picked, at his position. Picks count above the 2K list (knn.ts SOURCE_W). A player never votes for
// himself: a league's picks are keyed by league and player id (pickKey), the shipped picks (userPicks.data.ts) by their
// uid, and a league's copy of a shipped pick replaces it.
import { archetypeById, defaultNormsFor, scoreAll } from "../classify.ts";
import { mergedId } from "../merges.data.ts";
import { isPos } from "../position.ts";
import { nameAt } from "../posNames.ts";
import type { PickInput } from "../tuning.ts";
import type { Pos } from "../types.ts";
import {
	BUCKET_OF,
	FEAT_FROM_FAMX,
	bucketIndex,
	labelRow,
	standardize,
	type RefRow,
} from "./knn.ts";

export type ShippedPick = {
	uid: string;
	name?: string;
	season: number;
	pos: Pos;
	shown?: string;
	picked: string | null;
	// archv5: the user's own words for the label, and his reason (the archcmp sample's labels)
	label?: string;
	why?: string;
	at?: number;
	input?: PickInput;
};

// The key a league player's picks go by (a reading of player `pid` in league `lid` leaves them out)
export const pickKey = (lid: unknown, pid: unknown) => `pick:${lid}:${pid}`;
// (a uid is "<lid>-<pid>-<stamp>")
const keyOfUid = (uid: string) => {
	const [lid, pid] = uid.split("-");
	return pickKey(lid, pid);
};

const rowCache = new Map<string, RefRow | null>();

const refOf = (p: ShippedPick, key: string): RefRow | undefined => {
	const ck = `${p.uid}|${p.picked}|${key}`;
	const hit = rowCache.get(ck);
	if (hit !== undefined) {
		return hit ?? undefined;
	}
	let row: RefRow | null = null;
	const input = p.input;
	const a = p.picked ? archetypeById(mergedId(p.picked)) : undefined;
	const pos = isPos(input?.pos) ? input.pos : isPos(p.pos) ? p.pos : undefined;
	if (input?.ratings && a && pos) {
		const s = scoreAll(
			input.ratings,
			defaultNormsFor(input.ratings),
			undefined,
			pos,
			input.traits,
			{
				age: input.age,
				prospect: input.prospect,
				stats: input.stats,
				pt: input.pt,
			},
		);
		const bucket = BUCKET_OF[s.pos];
		row = {
			...labelRow({
				key,
				name: nameAt(a, s.pos),
				pos: s.pos,
				bucket: bucketIndex(bucket),
				src: "pick",
				split: "tune",
				x: standardize(FEAT_FROM_FAMX(s.famX), bucket),
			}),
			uid: p.uid,
		};
	}
	if (rowCache.size > 2000) {
		rowCache.clear();
	}
	rowCache.set(ck, row);
	return row ?? undefined;
};

// The labeled rows from picks: the latest pick per player and season, with a build picked (a "None of these" pick is no
// label). `shipped`: keyed by uid (never left out by a league's player id).
export const refsFromPicks = (
	picks: readonly ShippedPick[],
	shipped = false,
): RefRow[] => {
	const latest = new Map<string, ShippedPick>();
	for (const p of [...picks].sort((x, y) => (x.at ?? 0) - (y.at ?? 0))) {
		const pid = p.uid.split("-")[1];
		latest.set(`${p.uid.split("-")[0]}:${pid}:${p.season}`, p);
	}
	const out: RefRow[] = [];
	for (const p of latest.values()) {
		if (!p.picked) {
			continue;
		}
		const r = refOf(p, shipped ? `upick:${p.uid}` : keyOfUid(p.uid));
		if (r) {
			out.push(r);
		}
	}
	return out;
};
