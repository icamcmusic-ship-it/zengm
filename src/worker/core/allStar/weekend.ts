// Shared pieces of the All-Star weekend (basketball): seeded random streams, backcourt/frontcourt, and what a player's
// ratings, sub-ratings, badges and traits say about him for the contests. Everything that reads ratings here only orders
// players internally (invitations), nothing is shown.
import { makeSeededRandom } from "../../../common/random.ts";
import { saltedSeed } from "../../../common/leagueSalt.ts";
import { SUB_INDEX } from "../../../common/subRatings.ts";
import { getPlayerTraitScores, traitsEnabled } from "../player/traits.ts";
import type { PlayerRatings } from "../../../common/types.basketball.ts";
import type { Player } from "../../../common/types.ts";
import { entryForSeason } from "../../../common/tieredBadges/compute.ts";

const hashString = (s: string) => {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};

// Each event of the weekend draws from its own stream, seeded by the season (and the league salt), so it never moves the game's
// Math.random stream and the same league always gets the same weekend
export const weekendRandom = (season: number, key: string) =>
	makeSeededRandom(saltedSeed(hashString(`allStarWeekend|${season}|${key}`)));

// Guards are backcourt, everyone else (wings, forwards, centers) frontcourt, like the NBA's ballot
export const courtOf = (pos: string): "backcourt" | "frontcourt" =>
	pos === "PG" || pos === "SG" || pos === "G" ? "backcourt" : "frontcourt";

// A sub-rating by key, or undefined without the setting's data
export const subOf = (r: PlayerRatings, key: string) => {
	const i = SUB_INDEX[key];
	if (i === undefined || !Array.isArray(r.sub)) {
		return undefined;
	}
	const v = r.sub[i];
	return typeof v === "number" ? v : undefined;
};

// His 2K badges this season (keys, from the stored sim tiers: his true ratings, like everything else here, never shown)
export const badgesOf = (
	r: PlayerRatings,
	p?: Pick<Player, "badges2k">,
): string[] => {
	const t = p ? entryForSeason(p.badges2k, r.season)?.t : undefined;
	return t ? Object.keys(t).filter((key) => t[key]) : [];
};

// Player traits (0-100) when the Player Traits setting is on (missing seeds filled in from the league seed and pid, like
// everywhere else), else undefined
export const traitsOf = (p: Player, r: PlayerRatings) => {
	if (!traitsEnabled()) {
		return undefined;
	}
	return getPlayerTraitScores(p, r.season);
};

const mean = (xs: (number | undefined)[], fallback: number) => {
	const known = xs.filter((x): x is number => typeof x === "number");
	return known.length > 0
		? known.reduce((a, b) => a + b, 0) / known.length
		: fallback;
};

// Above-the-rim talent for the dunk contest: dunk and jumping, with max vertical, contact finishing and wingspan when there,
// the Posterizer / Pogo Stick badges and a showman's ego
export const dunkTalent = (p: Player) => {
	const r = p.ratings.at(-1) as PlayerRatings;
	let score = (r.dnk + 2 * r.jmp) / 3;
	const mxv = subOf(r, "mxv");
	const con = subOf(r, "con");
	if (mxv !== undefined || con !== undefined) {
		score = 0.6 * score + 0.4 * mean([mxv, con], score);
	}
	if (typeof r.wng === "number") {
		score += 0.1 * (r.wng - 50);
	}
	const badges = badgesOf(r, p);
	if (badges.includes("posterizer")) {
		score += 4;
	}
	if (badges.includes("pogoStick")) {
		score += 2;
	}
	const traits = traitsOf(p, r);
	if (traits) {
		// The showman's ego: divas (low ego score) want the spotlight
		score += 0.05 * (50 - traits.ego);
	}
	return score;
};

// Three-point shooting from a standstill for the three-point contest: the three-point rating, catch-and-shoot when there
// (expanded ratings, or the Catch & Shoot 3 / Spot-Up / Range sub-ratings), the Catch & Shoot / Limitless Range / Agent 3 badges
export const threeTalent = (p: Player) => {
	const r = p.ratings.at(-1) as PlayerRatings;
	let score = r.tp;
	if (typeof r.csh === "number") {
		score = 0.5 * score + 0.5 * r.csh;
	}
	const subs = [subOf(r, "tcs"), subOf(r, "spu"), subOf(r, "rng")];
	if (subs.some((x) => x !== undefined)) {
		score = 0.6 * score + 0.4 * mean(subs, score);
	}
	const badges = badgesOf(r, p);
	if (
		badges.includes("catchShoot") ||
		badges.includes("limitlessRange") ||
		badges.includes("agent3")
	) {
		score += 3;
	}
	return score;
};

// The skills challenge's four stations, each 0-100ish: handle (dribbling), passing accuracy, shooting off the move, speed
export const skillsTalent = (p: Player) => {
	const r = p.ratings.at(-1) as PlayerRatings;
	const traits = traitsOf(p, r);
	const handle = mean(
		[r.drb, subOf(r, "hnd"), traits ? traits.handle : undefined],
		r.drb,
	);
	const pass = mean([r.pss, subOf(r, "acc"), subOf(r, "vis")], r.pss);
	const shoot = mean(
		[
			r.tp,
			r.fg,
			typeof r.dsh === "number" ? r.dsh : undefined,
			subOf(r, "pul"),
		],
		(r.tp + r.fg) / 2,
	);
	const speed = mean([r.spd, subOf(r, "sls")], r.spd);
	return { handle, pass, shoot, speed };
};
