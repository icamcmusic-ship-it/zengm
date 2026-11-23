// Hall of Fame ballot (League Extras "Hall of Fame Ballot", basketball): the vote model, pure and seeded, shared by the worker
// (core/hallOfFame) and the tests. See docs/native-features.md, Hall of Fame ballot.
//
// A retired player whose Hall of Fame score (core/player/madeHof.basketball.ts) reaches the screening line is on the ballot from
// the season `wait` years after he retired. His vote share comes from a smoothed score: the logistic of how far his score is
// above or below the instant-induction threshold, plus a persistent "how voters see him" lean (seeded by his pid), a small
// gain for each year on the ballot (candidates gain support over time) and a little noise each year (seeded by pid and season).
// 75% gets him in, under 5% drops him, and 10 years is the most anyone stays on.

import { makeSeededRandom } from "./random.ts";
import { saltedSeed } from "./leagueSalt.ts";

// Deterministic string hash (FNV-1a)
const hashString = (s: string) => {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
};

export const HOF_VOTERS = 400;
export const HOF_INDUCT_PCT = 75;
export const HOF_DROP_PCT = 5;
export const HOF_MAX_YEARS = 10;
export const HOF_DEFAULT_WAIT = 3;
// Below this share of the threshold the screening committee leaves him off the ballot
export const HOF_SCREEN_RATIO = 0.55;

// Smoothed score: support = logistic((ratio - 1 - CENTER) / WIDTH + lean + DRIFT * (year - 1) + noise), ratio = score / threshold.
// CENTER and DRIFT were set so the ballot (with the veterans committee) inducts about as many players per decade as instant
// induction did (docs/native-features.md has the measurements)
export const BALLOT_CENTER = 0.03;
export const BALLOT_WIDTH = 0.1;
export const BALLOT_DRIFT = 0.12;
export const BALLOT_LEAN_SD = 0.35;
export const BALLOT_YEAR_SD = 0.15;

// Veterans committee: meets in about one season of three; considers players who fell off the ballot (or ran out of years) at
// least VETERANS_GAP seasons ago, and inducts the best one (two when both are clearly worthy) with ratio of at least VETERANS_MIN
export const VETERANS_MEET_CHANCE = 1 / 3;
export const VETERANS_GAP = 5;
export const VETERANS_MIN = 1.0;
export const VETERANS_SECOND_MIN = 1.05;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));

// A normal draw from two uniform draws (Box-Muller)
const normal = (random: () => number) => {
	const u = Math.max(random(), 1e-12);
	const v = random();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

export const ballotSeed = (key: string) => saltedSeed(hashString(key));

const seeded = (key: string) => {
	const random = makeSeededRandom(ballotSeed(key));
	// Warm up the stream (nearby seeds' first values are correlated)
	random();
	return random;
};

// How voters see him, for his whole time on the ballot
export const voterLean = (pid: number) =>
	normal(seeded(`hofLean|${pid}`)) * BALLOT_LEAN_SD;

// This season's noise
export const yearNoise = (pid: number, season: number) =>
	normal(seeded(`hofYear|${pid}|${season}`)) * BALLOT_YEAR_SD;

// Vote share (0-100, a whole number of HOF_VOTERS votes) in his year-th season on the ballot (1 is the first)
export const votePct = ({
	ratio,
	year,
	lean,
	noise,
}: {
	ratio: number;
	year: number;
	lean: number;
	noise: number;
}) => {
	const x =
		(ratio - 1 - BALLOT_CENTER) / BALLOT_WIDTH +
		lean +
		BALLOT_DRIFT * (year - 1) +
		noise;
	const votes = Math.round(HOF_VOTERS * logistic(x));
	return (100 * votes) / HOF_VOTERS;
};

export type BallotResult = "inducted" | "dropped" | "expired" | undefined;

export const ballotResult = (pct: number, year: number): BallotResult => {
	if (pct >= HOF_INDUCT_PCT) {
		return "inducted";
	}
	if (pct < HOF_DROP_PCT) {
		return "dropped";
	}
	if (year >= HOF_MAX_YEARS) {
		return "expired";
	}
	return undefined;
};

// Whole ballot career of a candidate from his first ballot season, as the game would vote it (for projections and the replay)
export const ballotCareer = (
	pid: number,
	ratio: number,
	firstSeason: number,
	fromYear = 1,
) => {
	const lean = voterLean(pid);
	const votes: number[] = [];
	for (let year = fromYear; year <= HOF_MAX_YEARS; year++) {
		const season = firstSeason + year - 1;
		const pct = votePct({
			ratio,
			year,
			lean,
			noise: yearNoise(pid, season),
		});
		votes.push(pct);
		const result = ballotResult(pct, year);
		if (result) {
			return { votes, result, year };
		}
	}
	return { votes, result: "expired" as const, year: HOF_MAX_YEARS };
};

// Chance he is eventually voted in from his year-th season on (his lean known, future noise unknown), from a seeded Monte Carlo
export const ballotChance = ({
	pid,
	ratio,
	year,
	draws = 200,
	ratioSd = 0,
}: {
	pid: number;
	ratio: number;
	year: number;
	draws?: number;
	// Uncertainty of his final score (active players), as a share of the threshold
	ratioSd?: number;
}) => {
	const random = seeded(`hofChance|${pid}`);
	const knownLean = year > 1 ? voterLean(pid) : undefined;
	let made = 0;
	for (let i = 0; i < draws; i++) {
		const r = ratio + (ratioSd > 0 ? normal(random) * ratioSd : 0);
		if (r < HOF_SCREEN_RATIO) {
			continue;
		}
		const lean = knownLean ?? normal(random) * BALLOT_LEAN_SD;
		for (let y = year; y <= HOF_MAX_YEARS; y++) {
			const pct = votePct({
				ratio: r,
				year: y,
				lean,
				noise: normal(random) * BALLOT_YEAR_SD,
			});
			const result = ballotResult(pct, y);
			if (result === "inducted") {
				made += 1;
			}
			if (result) {
				break;
			}
		}
	}
	return made / draws;
};

// Chance of making it with instant induction (his final score above the threshold), for a score known up to ratioSd
export const instantChance = (ratio: number, ratioSd: number) => {
	if (ratioSd <= 0) {
		return ratio > 1 ? 1 : 0;
	}
	return normalCdf((ratio - 1) / ratioSd);
};

// Standard normal CDF (Abramowitz-Stegun 7.1.26)
export const normalCdf = (x: number) => {
	const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
	const y =
		1 -
		((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
			t +
			0.254829592) *
			t *
			Math.exp(-(x * x) / 2);
	return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};

// Does the veterans committee meet this season?
export const veteransMeet = (season: number) =>
	seeded(`hofVeterans|${season}`)() < VETERANS_MEET_CHANCE;

// The committee's picks among fell-off candidates (best ratio first)
export const veteransPicks = <T extends { ratio: number }>(
	candidates: readonly T[],
): T[] => {
	const sorted = candidates
		.filter((c) => c.ratio >= VETERANS_MIN)
		.toSorted((a, b) => b.ratio - a.ratio);
	const picks = sorted.slice(0, 1);
	if (sorted[1] && sorted[1].ratio >= VETERANS_SECOND_MIN) {
		picks.push(sorted[1]);
	}
	return picks;
};
