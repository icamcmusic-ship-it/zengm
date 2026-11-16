// arch2kfix: NBA 2K's own archetype for the real players in the user's 2K list (user2k.data.ts, the data; nothing here is
// hardcoded per player), for the "Archetype Label Source" setting (League Extras -> Archetypes). A player matches by his
// real-player id (srID, the data's slug) and his last name, in the season the entry was matched to: an all-time entry only
// in that season (his best season with that franchise, as archuser2k matched it); a current entry (2K26, read at the
// 2026-27 preseason with the 2025-26 stats) in that season and the one before. Random and fictional players have no srID,
// so they never match.
import { USER_2K } from "../user2k.data.ts";

// A current entry also applies this many seasons before the one it was matched to
export const CURRENT_SEASONS_BEFORE = 1;

const normName = (s: string) =>
	s
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "")
		.replace(/[^a-z]/g, "");

let index: Map<string, { arch: string; last: string }> | undefined;

const keyOf = (srID: string, season: number) => `${srID}|${season}`;

const buildIndex = () => {
	const out = new Map<string, { arch: string; last: string }>();
	for (const r of USER_2K) {
		if (!r.slug || r.season === undefined) {
			continue;
		}
		const parts = r.name.split(" ");
		// (the last word that is not a suffix: "Michael Porter Jr." -> porter)
		const last =
			parts
				.map(normName)
				.filter((x) => x.length > 0)
				.at(-1) ?? "";
		const seasons = r.allTime
			? [r.season]
			: Array.from(
					{ length: CURRENT_SEASONS_BEFORE + 1 },
					(_, i) => r.season! - i,
				);
		for (const season of seasons) {
			const k = keyOf(r.slug, season);
			// (an exact-season entry wins over a current entry carried back a season)
			if (!out.has(k) || season === r.season) {
				out.set(k, { arch: r.arch, last });
			}
		}
	}
	return out;
};

// 2K's archetype for him in that season, or undefined (not in the list, not that season, or not a real player)
export const user2kLabel = (
	p: { srID?: string; lastName?: string },
	season: number,
): string | undefined => {
	if (!p.srID) {
		return undefined;
	}
	index ??= buildIndex();
	const hit = index.get(keyOf(p.srID, season));
	if (!hit) {
		return undefined;
	}
	// (his name must still be his: a renamed player keeps the game's label)
	if (p.lastName !== undefined) {
		const ln = normName(p.lastName);
		if (
			ln.length > 0 &&
			hit.last.length > 0 &&
			!hit.last.endsWith(ln) &&
			!ln.endsWith(hit.last)
		) {
			return undefined;
		}
	}
	return hit.arch;
};

export type ArchetypeLabelSource = "game" | "twoK" | "both";

export const labelSourceOf = (x: unknown): ArchetypeLabelSource =>
	x === "twoK" || x === "both" ? x : "game";
