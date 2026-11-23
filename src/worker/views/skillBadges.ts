// The Badges page (Frivolities, /frivolities/skill_badges[/:badge]): every 2K badge with its holders by tier this season (the tiers
// shown everywhere, from the ratings as scouted), by category. Basketball only; always on.
import {
	CATEGORY_NAMES,
	TIERED_BADGES,
	TIERED_BADGES_BY_KEY,
	TIER_NAMES,
	displayTiersOf,
	entryForSeason,
	tieredBadgeScore,
} from "../../common/tieredBadges/index.ts";
import {
	badgeRowOf,
	ensureTieredBadges,
	getTieredBadgeCutoffs,
	inputName,
} from "../core/player/tieredBadges.ts";
import { fuzzedSkillRow } from "../core/player/skills.ts";
import { idb } from "../db/index.ts";
import { player } from "../core/index.ts";
import { g } from "../util/index.ts";
import { defineView } from "../util/defineView.ts";
import { PLAYER } from "../../common/constants.ts";
import type { RouteParams } from "../../ui/router/types.ts";

const processInputs = (params: RouteParams<"skillBadges">) => {
	const label =
		params.badge !== undefined &&
		TIERED_BADGES_BY_KEY[params.badge] !== undefined
			? params.badge
			: undefined;
	return { label };
};

// Holders listed per badge on the overview (all of them on a badge's own page)
const OVERVIEW_HOLDERS = 12;

// No Visible Ratings: holders in a neutral order within a tier (team, then name) and no cutoffs, scores or ovr sent, so the page
// never ranks hidden ratings. Otherwise within a tier by the score as scouted (never the true one)
const loadTiered = async (label: string | undefined) => {
	await ensureTieredBadges();
	const hideRatings = !!g.get("challengeNoRatings");
	const season = g.get("season");
	const players = await idb.cache.players.indexGetAll("playersByTid", [
		PLAYER.FREE_AGENT,
		Infinity,
	]);
	const cutoffs = getTieredBadgeCutoffs(season);
	const teamAbbrevs = g.get("teamInfoCache").map((t) => t.abbrev);
	type Holder = {
		pid: number;
		name: string;
		pos: string;
		abbrev: string;
		tid: number;
		age: number;
		tier: number;
		ovr: number | undefined;
		// For ordering only (never sent)
		score: number;
	};
	const holdersByKey: Record<string, Holder[]> = {};
	for (const p of players) {
		const entry = entryForSeason(p.badges2k, season);
		if (!entry) {
			continue;
		}
		const t = displayTiersOf(entry);
		const r = p.ratings.at(-1) as any;
		// As scouted: fuzzed ratings, known traits only
		const shown: Record<string, any> = {
			...badgeRowOf(p),
			...fuzzedSkillRow(r, false, p),
		};
		for (const [key, tier] of Object.entries(t)) {
			const def = TIERED_BADGES_BY_KEY[key];
			if (!def || !tier) {
				continue;
			}
			(holdersByKey[key] ??= []).push({
				pid: p.pid,
				name: `${p.firstName} ${p.lastName}`,
				pos: r.pos,
				abbrev: p.tid >= 0 ? (teamAbbrevs[p.tid] ?? "") : "FA",
				tid: p.tid,
				age: season - p.born.year,
				tier,
				ovr: hideRatings ? undefined : player.fuzzRating(r.ovr, r.fuzz),
				score: hideRatings ? 0 : tieredBadgeScore(shown, def),
			});
		}
	}
	const neutral = (a: Holder, b: Holder) =>
		a.abbrev.localeCompare(b.abbrev) ||
		a.name.localeCompare(b.name) ||
		a.pid - b.pid;
	const tiered = TIERED_BADGES.map((def) => {
		const holders = (holdersByKey[def.key] ?? []).sort(
			(a, b) =>
				b.tier - a.tier || (hideRatings ? neutral(a, b) : b.score - a.score),
		);
		const counts = [1, 2, 3, 4, 5].map(
			(tier) => holders.filter((h) => h.tier === tier).length,
		);
		const strip = ({ score: _score, ...h }: Holder) => h;
		return {
			key: def.key,
			short: def.short,
			name: def.name,
			categoryKey: def.category,
			category: CATEGORY_NAMES[def.category],
			meaning: def.meaning,
			drivers: def.score
				.toSorted((a, b) => b[1] - a[1])
				.map(([k]) => inputName(k))
				.join(", "),
			gates: (def.gates ?? [])
				.map((gate) => {
					const name = inputName(gate.key);
					if (hideRatings) {
						return `${name} required`;
					}
					return [
						gate.min === "median"
							? `${name} at or above the league median`
							: gate.min !== undefined
								? `${name} >= ${gate.min}`
								: undefined,
						gate.max !== undefined ? `${name} <= ${gate.max}` : undefined,
					]
						.filter((x) => x !== undefined)
						.join(", ");
				})
				.join(", "),
			cutoffs:
				hideRatings || !cutoffs
					? undefined
					: cutoffs.c[def.key]?.map((x) => Math.round(x * 10) / 10),
			counts,
			holders: (label === def.key
				? holders
				: holders.slice(0, OVERVIEW_HOLDERS)
			).map(strip),
			numHolders: holders.length,
		};
	});
	return {
		tiered: {
			badges: tiered,
			tierNames: TIER_NAMES.slice(1),
			numRotation: cutoffs?.n,
		},
		label,
		numPlayers: players.length,
		numTeams: g.get("numActiveTeams"),
		userTid: g.get("userTid"),
	};
};

export default defineView({
	id: "skillBadges",
	processInputs,
	load: async ({ inputs, updateEvents, prevInputs }) => {
		if (__SPORT !== "basketball") {
			return {
				errorMessage: "Badges are only available for basketball.",
			};
		}
		if (
			!updateEvents.has("firstRun") &&
			!updateEvents.has("playerMovement") &&
			!updateEvents.has("newPhase") &&
			!updateEvents.has("gameAttributes") &&
			prevInputs?.label === inputs.label
		) {
			return;
		}
		return await loadTiered(inputs.label);
	},
});
