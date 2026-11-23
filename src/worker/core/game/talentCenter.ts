// Game Sim Fixes (basketball): league talent centering. The sim's scoring depends on how good the league's players are as a whole, not
// only on how they compare: when every rotation player is a few points better at the skills (a deep era from the talent cycles and class
// draws, or the rotations filling up with skilled veterans), both teams' shooting composites rise more than their defense ones, so the
// league scores more. The era presets (Settings > Tendencies) are fit to a new league's level, so a league with the 2026 preset and League
// Eras off drifted from about 118 points a team game to 124 within 20 seasons in some leagues, and back down later, with its talent level
// (scoringDrift.script.test.ts, docs/native-features.md).
//
// Now each season (preseason, after development; and at the first regular season of a league) the mean of every developed rating over
// the league's rotation players (each team's top ROTATION by ovr) is recorded, and the league's first such record is kept as its anchor.
// The sim reads every player's ratings shifted by (anchor - this season's mean) for each rating, so the rotation players as a whole play
// at the league's first-season level while every difference between players stays the same. Deterministic (no random numbers); with Game
// Sim Fixes off nothing is recorded or shifted. Stored in the game attribute simTalentCenter.
import type { Player, SimTalentCenter } from "../../../common/types.ts";
import { PLAYER } from "../../../common/constants.ts";
import { SUB_DEFS, isValidSubArray } from "../../../common/subRatings.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import { featureOn } from "../../util/nativeFeatures.ts";
import setGameAttributes from "../league/setGameAttributes.ts";

export type { SimTalentCenter };

// Each team's top players by ovr counted as its rotation
export const ROTATION = 8;
// Largest shift of one rating (rating points)
export const MAX_SHIFT = 8;

// The developed ratings (height doesn't develop) and the expanded ones (when the league has them)
export const CENTER_KEYS = [
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
	"wng",
	"pdef",
	"idef",
	"oreb",
	"dreb",
	"csh",
	"dsh",
	"bsc",
] as const;

// Only for measuring the old behaviour (scoringDrift.script.test.ts)
export const talentCenterOptions = { off: false };

export const talentCenterOn = () =>
	__SPORT === "basketball" && !talentCenterOptions.off && featureOn("simFixes");

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Mean of each rating over each team's top ROTATION players by ovr (the latest ratings row). */
export const rotationMeans = (
	players: readonly Pick<Player, "tid" | "ratings">[],
) => {
	const byTid = new Map<number, Record<string, any>[]>();
	for (const p of players) {
		if (p.tid < 0) {
			continue;
		}
		const r = p.ratings.at(-1);
		if (!r) {
			continue;
		}
		let list = byTid.get(p.tid);
		if (!list) {
			list = [];
			byTid.set(p.tid, list);
		}
		list.push(r);
	}
	const sums: Record<string, number> = {};
	const counts: Record<string, number> = {};
	for (const list of byTid.values()) {
		const top = list
			.toSorted((a, b) => (b.ovr ?? 0) - (a.ovr ?? 0))
			.slice(0, ROTATION);
		for (const r of top) {
			for (const key of CENTER_KEYS) {
				const v = r[key];
				if (typeof v === "number" && Number.isFinite(v)) {
					sums[key] = (sums[key] ?? 0) + v;
					counts[key] = (counts[key] ?? 0) + 1;
				}
			}
		}
	}
	const out: Record<string, number> = {};
	for (const key of Object.keys(sums)) {
		out[key] = round3(sums[key]! / counts[key]!);
	}
	return out;
};

/** The next record from the last one and this season's means: the first one anchors the league. */
export const nextTalentCenter = (
	prev: SimTalentCenter | undefined,
	season: number,
	cur: Record<string, number>,
): SimTalentCenter => ({
	ref: { ...cur, ...prev?.ref },
	season,
	cur,
});

/** Shift of each rating for the sim this season (undefined when there is none). */
export const talentShift = (
	center: SimTalentCenter | undefined,
	season: number,
): Record<string, number> | undefined => {
	if (!center || center.season !== season) {
		return undefined;
	}
	const out: Record<string, number> = {};
	let any = false;
	for (const [key, cur] of Object.entries(center.cur)) {
		const ref = center.ref[key];
		if (ref === undefined) {
			continue;
		}
		const d = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, ref - cur));
		if (Math.abs(d) >= 0.001) {
			out[key] = d;
			any = true;
		}
	}
	return any ? out : undefined;
};

const clamp100 = (x: number) => Math.max(0, Math.min(100, x));

/** A ratings row as the sim sees it: shifted by the league's talent center (sub-ratings by their base's shift). */
export const shiftRatingsForSim = <T extends Record<string, any>>(
	r: T,
	shift: Record<string, number> | undefined,
): T => {
	if (!shift) {
		return r;
	}
	const out: Record<string, any> = { ...r };
	for (const [key, d] of Object.entries(shift)) {
		const v = out[key];
		if (typeof v === "number") {
			out[key] = clamp100(v + d);
		}
	}
	if (isValidSubArray(out.sub)) {
		out.sub = out.sub.map((v: number, i: number) => {
			const d = shift[SUB_DEFS[i]!.base];
			return d === undefined ? v : clamp100(v + d);
		});
	}
	return out as T;
};

/** The sim's shift this season, from the stored record (undefined with Game Sim Fixes off or no record for this season). */
export const getTalentShift = () => {
	if (!talentCenterOn()) {
		return undefined;
	}
	return talentShift(g.get("simTalentCenter"), g.get("season"));
};

/** Record this season's rotation means (and the anchor, the first time). Preseason after development, and the regular season's start. */
export const updateTalentCenter = async ({
	onlyIfMissing = false,
}: { onlyIfMissing?: boolean } = {}) => {
	if (!talentCenterOn()) {
		return;
	}
	const season = g.get("season");
	const prev = g.get("simTalentCenter");
	if (onlyIfMissing && prev?.season === season) {
		return;
	}
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		0,
		Infinity,
	]);
	const cur = rotationMeans(players.filter((p) => p.tid > PLAYER.FREE_AGENT));
	if (Object.keys(cur).length === 0) {
		return;
	}
	await setGameAttributes({
		simTalentCenter: nextTalentCenter(prev, season, cur),
	});
};
