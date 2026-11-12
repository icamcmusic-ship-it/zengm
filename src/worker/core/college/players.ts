// College mode: making college players (initial rosters, recruiting classes, walk-ons). See docs/college-mode.md.
import { PLAYER, RATINGS } from "../../../common/constants.ts";
import {
	COLLEGE_ELIGIBILITY_YEARS,
	COLLEGE_SCHOLARSHIPS,
} from "../../../common/college/constants.ts";
import type { PlayerRecruit } from "../../../common/college/types.ts";
import { getSchoolPrestige } from "../../../common/college/teams.ts";
import { realGauss, shuffle } from "../../../common/random.ts";
import type { Player, PlayerWithoutKey, Team } from "../../../common/types.ts";
import { last } from "../../../common/utils.ts";
import { g, helpers } from "../../util/index.ts";
import { player } from "../index.ts";
import { addContract, createContract } from "../contract/index.ts";
import { syncExpandedToCompat } from "../player/expandedRatings.ts";

// Share of the national recruiting class a league of this many teams draws its players from (its best part)
const NATIONAL_TEAMS = 364;
export const getTalentShare = (numTeams: number) =>
	helpers.bound((numTeams / NATIONAL_TEAMS) ** 0.75, 0.05, 1);

// Rating points (every rating but height) a recruit at national talent quantile z (standard normal) gets on top of the generator
const TALENT_BASE = -3.5;
const TALENT_PER_SD = 4.5;
// Below the median of the national class players are closer together: everyone in Division I can play
const TALENT_PER_SD_LOW = 2;

// Quantiles (share of the national class) of the star ratings
const STAR_QUANTILES = [
	{ stars: 5, q: 0.012 },
	{ stars: 4, q: 0.1 },
	{ stars: 3, q: 0.5 },
];

export const starsFromQuantile = (q: number) => {
	for (const row of STAR_QUANTILES) {
		if (q < row.q) {
			return row.stars;
		}
	}
	return 2;
};

// Inverse of the standard normal CDF (Acklam's approximation)
const invNorm = (p: number): number => {
	const a = [
		-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
		1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
	];
	const b = [
		-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
		6.680131188771972e1, -1.328068155288572e1,
	];
	const c = [
		-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
		-2.549732539343734, 4.374664141464968, 2.938163982698783,
	];
	const d = [
		7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
		3.754408661907416,
	];
	const pl = 0.02425;
	if (p < pl) {
		const q = Math.sqrt(-2 * Math.log(p));
		return (
			(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q +
				c[5]!) /
			((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
		);
	}
	if (p > 1 - pl) {
		return -invNorm(1 - p);
	}
	const q = p - 0.5;
	const r = q * q;
	return (
		((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r +
			a[5]!) *
			q) /
		(((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
	);
};

const SHIFT_KEYS = RATINGS.filter((key) => key !== "hgt");

const shiftRatings = (p: PlayerWithoutKey, amount: number) => {
	const ratings = last(p.ratings) as any;
	for (const key of SHIFT_KEYS) {
		if (typeof ratings[key] === "number") {
			ratings[key] = player.limitRating(ratings[key] + amount);
		}
	}
	syncExpandedToCompat(ratings);
};

/**
 * A college-age player: generated as an 18-year-old high school senior of the given talent (national quantile, 0 = best), then developed
 * for yearsInCollege seasons. tid is where he is now.
 */
export const genCollegePlayer = async ({
	tid,
	quantile,
	yearsInCollege,
	extraShift = 0,
}: {
	tid: number;
	quantile: number;
	yearsInCollege: number;
	extraShift?: number;
}): Promise<PlayerWithoutKey> => {
	const season = g.get("season");
	const name = await player.name();
	const p = player.generate(tid, 18, season, false, 15.5, {
		...name,
		college: "",
	});
	const z = invNorm(helpers.bound(1 - quantile, 0.0005, 0.9995));
	shiftRatings(
		p,
		Math.round(
			TALENT_BASE +
				(z > 0 ? TALENT_PER_SD : TALENT_PER_SD_LOW) * z +
				extraShift +
				realGauss(0, 1.5),
		),
	);
	await player.develop(p, yearsInCollege, true);
	return p;
};

export const recruitScore = (p: PlayerWithoutKey) => {
	const ratings = last(p.ratings);
	return 0.45 * ratings.ovr + 0.55 * ratings.pot;
};

// How long a player with this class year has left, as the last season of his "contract"
const eligibilityEnds = (classYear: number, season: number) =>
	season + Math.max(0, COLLEGE_ELIGIBILITY_YEARS - Math.max(1, classYear));

/**
 * Put a player on a school's roster: class year, the contract that stands for his eligibility, jersey number. For the initial rosters the
 * contract is made later from contractDemand (league creation does that for every player).
 */
export const setCollegeStatus = (
	p: PlayerWithoutKey,
	tid: number,
	classYear: number,
	newLeague: boolean,
) => {
	const season = g.get("season");
	p.tid = tid;
	(p as any).classYear = classYear;
	// A player "drafted" in season X is a rookie in X + 1: this makes freshmen the engine's rookies
	p.draft.year = season - Math.max(1, classYear);
	p.draft.tid = -1;
	p.draft.originalTid = -1;
	p.draft.round = 0;
	p.draft.pick = 0;
	const contract = {
		amount: g.get("minContract"),
		exp: eligibilityEnds(classYear, season),
	};
	p.contractDemand = { ...contract };
	if (!newLeague) {
		addContract(
			p as Player,
			createContract({
				contract,
				type: "freeAgent",
			}),
		);
	}
};

export const getTeamPrestige = (
	t: Pick<Team, "region"> & { collegePrestige?: number },
) => t.collegePrestige ?? getSchoolPrestige(t.region) ?? 60;

// Number of players of each class year (Fr to Sr) on a new 13-man roster
const classCounts = () => {
	const counts = [4, 3, 3, 3];
	shuffle(counts);
	return counts;
};

/**
 * Initial rosters of a new college league: 13 players per school, four classes, better players at schools with more prestige.
 */
export const createCollegePlayers = async ({
	teams,
}: {
	teams: (Pick<Team, "tid" | "region" | "disabled"> & {
		collegePrestige?: number;
	})[];
}) => {
	const activeTeams = teams.filter((t) => !t.disabled);
	const share = getTalentShare(activeTeams.length);
	const players: PlayerWithoutKey[] = [];

	const countsByTid = new Map(activeTeams.map((t) => [t.tid, classCounts()]));

	for (let classYear = 1; classYear <= COLLEGE_ELIGIBILITY_YEARS; classYear++) {
		// One slot per roster spot of this class, schools with more prestige first (with some luck)
		const slots: { tid: number; score: number }[] = [];
		for (const t of activeTeams) {
			const count = countsByTid.get(t.tid)![classYear - 1]!;
			for (let i = 0; i < count; i++) {
				slots.push({
					tid: t.tid,
					score: getTeamPrestige(t) + realGauss(0, 7),
				});
			}
		}
		slots.sort((a, b) => b.score - a.score);

		const pool: PlayerWithoutKey[] = [];
		for (let i = 0; i < slots.length; i++) {
			// The best players of older classes have left for the pros already
			const top = classYear >= 3 ? 0.02 : classYear === 2 ? 0.008 : 0;
			const quantile =
				(top + (1 - top) * ((i + Math.random()) / slots.length)) * share;
			const p = await genCollegePlayer({
				tid: PLAYER.UNDRAFTED,
				quantile,
				yearsInCollege: classYear,
			});
			pool.push(p);
		}
		pool.sort((a, b) => recruitScore(b) - recruitScore(a));

		for (const [i, p] of pool.entries()) {
			setCollegeStatus(p, slots[i]!.tid, classYear, true);
			const numNational = slots.length / share;
			const recruit: PlayerRecruit = {
				stars: starsFromQuantile((i + 0.5) / numNational),
				rank: i + 1,
				posRank: 0,
				state: p.born.loc,
				committed: slots[i]!.tid,
				season: g.get("season") - classYear,
			};
			(p as any).recruit = recruit;
			players.push(p);
		}
	}

	// Jersey numbers
	const byTid = Map.groupBy(players, (p) => p.tid);
	for (const roster of byTid.values()) {
		const used: string[] = [];
		for (const p of roster) {
			const number = await player.genJerseyNumber(p, used, []);
			player.setJerseyNumber(p, number);
			if (number !== undefined) {
				used.push(number);
			}
		}
	}

	return players;
};

export { COLLEGE_SCHOLARSHIPS };
