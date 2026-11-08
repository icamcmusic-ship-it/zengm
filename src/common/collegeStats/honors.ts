import { COLLEGE_AWARD_PREFIX } from "../preDraft.ts";
import { CONFERENCES } from "./colleges.ts";
import { PRO_BARS, getProHonorTypes, isProLeague } from "./overseas.ts";
import { clamp, type Rng } from "./rng.ts";
import type { CollegeHonor, CollegeSeason } from "./types.ts";

/**
 * Honors for college seasons. The Workshop ranks every prospect against every returning player in Division I and hands out about a hundred honors. Here a prospect's season is judged against fixed bars (what it takes to make an all-conference team, an All-America team, and so on) that were set so a typical 70 prospect class gets about what the Workshop's does: a dozen or so conference players of the year, one or two consensus first team All-Americans, and an all-conference season for about a quarter of the non-freshmen. The same bars apply to earlier seasons, so a sophomore season that would have made the first team is an all-conference season on his record.
 *
 * Ported, in a simplified form: the six national player of the year awards (each with its own electorate noise), consensus All-America teams, AP honorable mention, finalists, national defensive players of the year, position awards, and per conference: player, defensive player and freshman of the year, all-conference first and second teams, all-freshman and all-defensive teams. Not ported: team trophies (national and tournament champions), tournament teams, sixth man and most improved awards, coach awards, academic honors. Pro clubs abroad (and the G League) get league honors from overseas.ts: MVP, All-League teams, Best Young Player / Rising Star, All-Defensive.
 */

type Entry = {
	key: string;
	pos: string;
	season: CollegeSeason;
	// Strength-adjusted game score per game
	adj: number;
	def: number;
};

const NATIONAL_POY = [
	"Naismith Player of the Year",
	"Wooden Award",
	"Associated Press Player of the Year",
	"NABC Player of the Year",
	"Oscar Robertson Trophy",
	"Sporting News Player of the Year",
];

const NATIONAL_DPOY = [
	"Naismith Defensive Player of the Year",
	"NABC Defensive Player of the Year",
];

const POSITION_AWARDS: Record<string, string> = {
	PG: "Bob Cousy Award",
	G: "Bob Cousy Award",
	SG: "Jerry West Award",
	GF: "Jerry West Award",
	SF: "Julius Erving Award",
	F: "Julius Erving Award",
	PF: "Karl Malone Award",
	FC: "Karl Malone Award",
	C: "Kareem Abdul-Jabbar Award",
};

// Bars on strength-adjusted game score per game
export const BARS = {
	consensusFirst: 18.5,
	consensusSecond: 17,
	honorableMention: 15,
	finalist: 19,
	top20: 17.5,
	nationalPoy: 21,
	positionAward: 17.5,
	defNationalPoy: 6.1,
	confPoy: { high: 16.5, mid: 14.8, low: 13.2 },
	confFirst: { high: 14.2, mid: 12.6, low: 11 },
	confSecond: { high: 12.2, mid: 10.6, low: 9.2 },
	// Freshman bars sit below the matching conference bars
	freshmanOfYear: 1.5,
	allFreshman: 3.5,
	confDpoy: 5.5,
	allDefensive: 5,
	minGp: 14,
	minMpg: 16,
};

const add = (honors: CollegeHonor[], season: number, type: string) => {
	honors.push({ season, type: `${COLLEGE_AWARD_PREFIX}${type}` });
};

export const getHonors = (
	entries: {
		key: string;
		pos: string;
		seasons: CollegeSeason[];
	}[],
	rng: Rng,
): Map<string, CollegeHonor[]> => {
	const output = new Map<string, CollegeHonor[]>();
	for (const entry of entries) {
		output.set(entry.key, []);
	}

	const bySeason = new Map<number, Entry[]>();
	for (const entry of entries) {
		for (const season of entry.seasons) {
			const gp = season.stats.gp ?? 0;
			const mpg = gp > 0 ? (season.stats.min ?? 0) / gp : 0;
			// Pro clubs (overseas and G League): league honors against the league's own bars
			if (season.conference === undefined && isProLeague(season.school)) {
				if (
					gp >= Math.min(PRO_BARS.minGp, season.teamGames / 2) &&
					mpg >= PRO_BARS.minMpg * (season.gameMinutes / 40)
				) {
					const adj = season.score * (1 + 0.006 * (season.strength - 80));
					for (const type of getProHonorTypes(
						season.school,
						adj,
						season.defScore,
						season.age ?? 20,
						rng.normal(0, 0.6),
					)) {
						add(output.get(entry.key)!, season.season, type);
					}
				}
				continue;
			}
			// Honors are for players who played, and only for colleges
			if (
				season.conference === undefined ||
				gp < BARS.minGp ||
				mpg < BARS.minMpg * (season.gameMinutes / 40)
			) {
				continue;
			}
			const e: Entry = {
				key: entry.key,
				pos: entry.pos,
				season,
				adj: season.score * (1 + 0.0045 * (season.strength - 70)),
				def: season.defScore,
			};
			const list = bySeason.get(season.season) ?? [];
			list.push(e);
			bySeason.set(season.season, list);
		}
	}

	for (const [year, list] of bySeason) {
		const give = (e: Entry, type: string) => {
			add(output.get(e.key)!, year, type);
		};
		const sorted = [...list].sort((a, b) => b.adj - a.adj);

		// National honors
		for (const e of sorted) {
			if (e.adj >= BARS.consensusFirst) {
				give(e, "Consensus First Team All-American");
			} else if (e.adj >= BARS.consensusSecond) {
				give(e, "Consensus Second Team All-American");
			} else if (e.adj >= BARS.honorableMention) {
				give(e, "Associated Press honorable mention");
			}
		}
		for (const e of sorted.slice(0, 5)) {
			if (e.adj >= BARS.finalist) {
				give(e, "Naismith Trophy finalist");
			}
		}
		for (const e of sorted.slice(0, 4)) {
			if (e.adj >= BARS.top20) {
				give(e, "Wooden Award Late Season Top 20");
			}
		}
		for (const award of NATIONAL_POY) {
			// Each electorate sees a slightly different player
			let best: Entry | undefined;
			let bestScore = -Infinity;
			for (const e of sorted.slice(0, 6)) {
				const score = e.adj + rng.normal(0, 1.1);
				if (e.adj >= BARS.nationalPoy && score > bestScore) {
					bestScore = score;
					best = e;
				}
			}
			if (best) {
				give(best, award);
			}
		}
		const byDef = [...list].sort((a, b) => b.def - a.def);
		for (const award of NATIONAL_DPOY) {
			const e = byDef[0];
			const e2 = byDef[1];
			// A close race splits between the two awards
			const pick =
				e2 && Math.abs(e!.def - e2.def) < 0.5 && rng.random() < 0.4 ? e2 : e;
			if (pick && pick.def >= BARS.defNationalPoy) {
				give(pick, award);
			}
		}
		const positionWinners = new Map<string, Entry>();
		for (const e of sorted) {
			const award = POSITION_AWARDS[e.pos];
			if (award && e.adj >= BARS.positionAward && !positionWinners.has(award)) {
				positionWinners.set(award, e);
			}
		}
		for (const [award, e] of positionWinners) {
			give(e, award);
		}

		// Conference honors
		const byConf = Map.groupBy(list, (e) => e.season.conference!);
		for (const [conf, members] of byConf) {
			const tier = (CONFERENCES[conf]?.tier ?? "mid") as "high" | "mid" | "low";
			const confSorted = [...members].sort((a, b) => b.adj - a.adj);
			const poy = confSorted[0];
			if (poy && poy.adj >= BARS.confPoy[tier]) {
				give(poy, `${conf} Player of the Year`);
			}
			for (const e of confSorted) {
				if (e.adj >= BARS.confFirst[tier]) {
					give(e, `All-${conf} First Team`);
				} else if (e.adj >= BARS.confSecond[tier]) {
					give(e, `All-${conf} Second Team`);
				}
			}

			const freshmen = confSorted.filter((e) => e.season.classIndex === 0);
			const fresh = freshmen[0];
			if (fresh && fresh.adj >= BARS.confFirst[tier] - BARS.freshmanOfYear) {
				give(fresh, `${conf} Freshman of the Year`);
			}
			for (const e of freshmen) {
				if (e.adj >= BARS.confFirst[tier] - BARS.allFreshman) {
					give(e, `All-${conf} Freshman Team`);
				}
			}

			const confDef = [...members].sort((a, b) => b.def - a.def);
			const dpoy = confDef[0];
			if (dpoy && dpoy.def >= BARS.confDpoy) {
				give(dpoy, `${conf} Defensive Player of the Year`);
			}
			for (const e of confDef) {
				if (e.def >= BARS.allDefensive) {
					give(e, `All-${conf} Defensive Team`);
				}
			}
		}
	}

	// Stable order: by season, then in the order given above
	for (const honors of output.values()) {
		honors.sort((a, b) => a.season - b.season);
	}

	return output;
};

export const clampZ = (z: number) => clamp(z, -2.5, 2.5);
