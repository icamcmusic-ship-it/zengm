// Hall of Fame Watch (basketball): a player's Hall of Fame score against the threshold, his projected final score (active players:
// the rest of his career from his recent seasons and his age) and the chance he gets in (the ballot's chance with the Hall of Fame
// Ballot on, else the chance his final score clears the threshold). Deterministic: the ballot chance is a seeded Monte Carlo.
import { PHASE, PLAYER } from "../../../common/constants.ts";
import {
	HOF_MAX_YEARS,
	HOF_SCREEN_RATIO,
	ballotChance,
	instantChance,
} from "../../../common/hofBallot.ts";
import type { Player } from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g } from "../../util/index.ts";
import {
	hofScoreBasketball,
	hofScoreFromSeasons,
} from "../player/madeHof.basketball.ts";
import type { HofSeason } from "../player/hofSeasons.ts";
import { hofBallotOn, hofBallotWait } from "./index.ts";

// Year-to-year change of a player's value at each age (a typical career arc, gentle at the edges)
export const agingFactor = (age: number) => {
	if (age <= 22) {
		return 1.15;
	}
	if (age <= 24) {
		return 1.08;
	}
	if (age <= 26) {
		return 1.03;
	}
	if (age <= 28) {
		return 1;
	}
	if (age <= 30) {
		return 0.94;
	}
	if (age <= 32) {
		return 0.87;
	}
	if (age <= 34) {
		return 0.8;
	}
	return 0.7;
};

const MAX_AGE = 38;
// Below this value per season (82 games) a veteran is assumed to retire
const RETIRE_VALUE = 1.5;

export type HofProjection = {
	score: number;
	threshold: number;
	projected: number;
	yearsLeft: number;
	ratioSd: number;
};

/**
 * Projection of an active player's final Hall of Fame score. frac is how much of the current regular season his team has played
 * (0 before it starts, 1 once it is over); the current season's value is scaled up to a full season.
 */
export const projectHofScore = ({
	seasons,
	fudgeSeasons,
	score,
	threshold,
	age,
	season,
	frac,
}: {
	seasons: readonly HofSeason[];
	fudgeSeasons: number;
	score: number;
	threshold: number;
	age: number;
	season: number;
	frac: number;
}): HofProjection => {
	const all = seasons.map((s) => ({ ...s }));
	const regular = all.filter((s) => !s.playoffs);
	const playoffSum = all
		.filter((s) => s.playoffs)
		.reduce((sum, s) => sum + Math.max(0, s.value), 0);
	const regularSum = regular.reduce((sum, s) => sum + Math.max(0, s.value), 0);
	const playoffShare =
		regularSum > 0 ? Math.min(0.25, playoffSum / regularSum) : 0;

	// The current season as a full one
	const current = regular.find((s) => s.season === season);
	if (current && frac > 0 && frac < 1) {
		current.value /= Math.max(frac, 0.15);
	}

	// Level: the last three seasons, the most recent counting most (the current one by how much of it is played)
	const recent = regular
		.filter((s) => s.season <= season)
		.sort((a, b) => b.season - a.season)
		.slice(0, 3);
	let weightSum = 0;
	let level = 0;
	for (const [i, s] of recent.entries()) {
		let weight = 3 - i;
		if (s.season === season) {
			weight *= Math.min(1, Math.max(frac, 0.15));
		}
		weightSum += weight;
		level += weight * s.value;
	}
	level = weightSum > 0 ? level / weightSum : 0;

	// The rest of his career
	let yearsLeft = 0;
	let value = level;
	// Before the regular season starts (frac 0) the current season itself is still to come
	const firstFuture = frac === 0 ? season : season + 1;
	for (
		let s = firstFuture, a = age + (firstFuture - season);
		a <= MAX_AGE;
		s++, a++
	) {
		value *= agingFactor(a);
		if (value < RETIRE_VALUE && a >= 30) {
			break;
		}
		if (value <= 0) {
			break;
		}
		all.push({ season: s, playoffs: false, value });
		if (playoffShare > 0) {
			all.push({ season: s, playoffs: true, value: value * playoffShare });
		}
		yearsLeft += 1;
	}

	const projected = Math.max(score, hofScoreFromSeasons(all, fudgeSeasons));
	const gain = Math.max(0, projected - score);
	const ratioSd =
		threshold > 0
			? 0.04 + (0.3 * gain) / threshold + 0.03 * Math.sqrt(yearsLeft)
			: 0;
	return { score, threshold, projected, yearsLeft, ratioSd };
};

export type HofWatch = {
	score: number;
	threshold: number;
	projected: number;
	// 0-1
	chance: number;
	status:
		| "active"
		| "inducted"
		| "waiting"
		| "ballot"
		| "fellOff"
		| "notWorthy";
	// Ballot: his latest share and years on the ballot, the season he is first eligible
	lastPct?: number;
	years?: number;
	eligible?: number;
	inducted?: number;
	ballotLine?: string;
};

// How much of this regular season each team has played
export const seasonFracs = async () => {
	const season = g.get("season");
	const phase = g.get("phase");
	const fracs = new Map<number, number>();
	if (phase < PHASE.REGULAR_SEASON) {
		return { fracs, default: 0 };
	}
	if (phase > PHASE.REGULAR_SEASON) {
		return { fracs, default: 1 };
	}
	const teamSeasons = await idb.cache.teamSeasons.indexGetAll(
		"teamSeasonsBySeasonTid",
		[[season], [season, "Z"]],
	);
	for (const ts of teamSeasons) {
		const gp = ts.won + ts.lost + (ts.tied ?? 0) + (ts.otl ?? 0);
		const numGames = g.get("numGames");
		fracs.set(ts.tid, numGames > 0 ? Math.min(1, gp / numGames) : 1);
	}
	return { fracs, default: 0.5 };
};

export const hofWatchFor = (
	p: Player,
	fracs: { fracs: Map<number, number>; default: number },
): HofWatch | undefined => {
	if (__SPORT !== "basketball") {
		return;
	}
	const ballotOn = hofBallotOn();
	const inducted = p.awards.find(
		(a) => a.type === "Inducted into the Hall of Fame",
	)?.season;
	const { score, threshold, seasons, fudgeSeasons } = hofScoreBasketball(p);
	if (!(threshold > 0)) {
		return;
	}
	const ratio = score / threshold;
	const season = g.get("season");

	if (p.hof) {
		return {
			score,
			threshold,
			projected: score,
			chance: 1,
			status: "inducted",
			inducted,
			lastPct: p.hofBallot?.votes.at(-1),
			years: p.hofBallot?.votes.length,
		};
	}

	if (p.tid === PLAYER.RETIRED) {
		if (!ballotOn) {
			return {
				score,
				threshold,
				projected: score,
				chance: 0,
				status: "notWorthy",
			};
		}
		const ballot = p.hofBallot;
		if (ballot?.status) {
			return {
				score,
				threshold,
				projected: score,
				chance: 0,
				status: "fellOff",
				lastPct: ballot.votes.at(-1),
				years: ballot.votes.length,
			};
		}
		if (ballot) {
			const year = ballot.votes.length + 1;
			return {
				score,
				threshold,
				projected: score,
				chance:
					ballot.first + HOF_MAX_YEARS <= season
						? 0
						: ballotChance({
								pid: p.pid,
								ratio: ballot.score / ballot.threshold,
								year,
							}),
				status: "ballot",
				lastPct: ballot.votes.at(-1),
				years: ballot.votes.length,
			};
		}
		const eligible = p.retiredYear + hofBallotWait();
		if (ratio < HOF_SCREEN_RATIO || eligible < season - HOF_MAX_YEARS) {
			return {
				score,
				threshold,
				projected: score,
				chance: 0,
				status: "notWorthy",
			};
		}
		return {
			score,
			threshold,
			projected: score,
			chance: ballotChance({ pid: p.pid, ratio, year: 1 }),
			status: "waiting",
			eligible: Math.max(eligible, season + 1),
		};
	}

	// Active (or a draft prospect, who has nothing yet)
	const frac =
		p.tid >= 0 ? (fracs.fracs.get(p.tid) ?? fracs.default) : fracs.default;
	const projection = projectHofScore({
		seasons,
		fudgeSeasons,
		score,
		threshold,
		age: season - p.born.year,
		season,
		frac,
	});
	const projRatio = projection.projected / threshold;
	const chance = ballotOn
		? ballotChance({
				pid: p.pid,
				ratio: projRatio,
				year: 1,
				ratioSd: projection.ratioSd,
			})
		: instantChance(projRatio, projection.ratioSd);
	return {
		score,
		threshold,
		projected: projection.projected,
		chance,
		status: "active",
	};
};
