// Monte Carlo season projections: play out the rest of the regular season game by game from team strength, seed the playoffs with the
// game's own playoff code (genPlayoffSeriesFromTeams, tiebreakers skipped with a random tie-break), then play the play-in and the
// bracket. Pure apart from the playoff seeding, so it is easy to test.

import type { ByConf, PlayoffSeries } from "../../../common/types.ts";
import { genPlayoffSeriesFromTeams } from "../season/genPlayoffSeries.ts";
import {
	getHypotheticalTeam,
	type TeamSeasonRecord,
} from "../team/getHypotheticalTeam.ts";

export type OddsTeam = {
	tid: number;
	// Expected point margin against an average team on a neutral court
	rating: number;
	record: TeamSeasonRecord;
};

export type TeamOdds = {
	tid: number;
	projWon: number;
	projLost: number;
	playoffs: number;
	playIn: number;
	// seeds[i] is the probability of finishing as seed i + 1 (after the play-in)
	seeds: number[];
	// roundsWon[i] is the probability of winning at least i + 1 playoff rounds; the last one is the title
	roundsWon: number[];
	title: number;
};

export type SeasonOddsResult = {
	numSims: number;
	numRounds: number;
	teams: TeamOdds[];
};

// Point spread to win probability. A logistic with scale 6.5 is about a normal with SD 11, roughly the spread of NBA game margins.
export const winProb = (ratingDiff: number) =>
	1 / (1 + Math.exp(-ratingDiff / 6.5));

type SeriesTeam = { tid: number; seed: number; won?: number };

const simSeries = (
	home: SeriesTeam,
	away: SeriesTeam,
	numGames: number,
	ratings: Map<number, number>,
	hca: number,
	random: () => number,
) => {
	const numGamesToWin = Math.ceil(numGames / 2);
	let homeWon = home.won ?? 0;
	let awayWon = away.won ?? 0;
	const diff = ratings.get(home.tid)! - ratings.get(away.tid)!;
	// 2-2-1-1-1
	const homeCourtPattern = [1, 1, -1, -1, 1, -1, 1];
	let game = homeWon + awayWon;
	while (homeWon < numGamesToWin && awayWon < numGamesToWin) {
		const sign = homeCourtPattern[game % 7]!;
		if (random() < winProb(diff + sign * hca)) {
			homeWon += 1;
		} else {
			awayWon += 1;
		}
		game += 1;
	}
	return homeWon >= numGamesToWin ? home : away;
};

const simGame = (
	home: SeriesTeam,
	away: SeriesTeam,
	ratings: Map<number, number>,
	hca: number,
	random: () => number,
) => {
	const diff = ratings.get(home.tid)! - ratings.get(away.tid)!;
	return random() < winProb(diff + hca)
		? { winner: home, loser: away }
		: { winner: away, loser: home };
};

// Play-in (NBA style, as in genPlayoffSeries/newSchedulePlayoffsDay): game 1 winner gets the first spot, game 2 loser is out, then
// game 1 loser vs game 2 winner for the second spot. Returns tid -> tid replacements for the bracket slots.
const simPlayIn = (
	playIn: NonNullable<PlayoffSeries["playIns"]>[number],
	ratings: Map<number, number>,
	hca: number,
	random: () => number,
) => {
	const replacements = new Map<number, number>();
	const getResult = (
		matchup: (typeof playIn)[number],
	): { winner: SeriesTeam; loser: SeriesTeam } | undefined => {
		if (matchup.home.won > 0) {
			return { winner: matchup.home, loser: matchup.away };
		}
		if (matchup.away.won > 0) {
			return { winner: matchup.away, loser: matchup.home };
		}
	};

	const game1 =
		getResult(playIn[0]) ??
		simGame(playIn[0].home, playIn[0].away, ratings, hca, random);
	const game2 =
		getResult(playIn[1]) ??
		simGame(playIn[1].home, playIn[1].away, ratings, hca, random);
	const game3 =
		(playIn[2] ? getResult(playIn[2]) : undefined) ??
		simGame(game1.loser, game2.winner, ratings, hca, random);

	replacements.set(playIn[0].home.tid, game1.winner.tid);
	replacements.set(playIn[0].away.tid, game3.winner.tid);
	return replacements;
};

// Plays out the bracket from a given round. Returns the tids eliminated in each round and the champion, in callback form.
const simBracket = ({
	series,
	startRound,
	numGamesPlayoffSeries,
	ratings,
	hca,
	random,
	onRoundWon,
}: {
	series: PlayoffSeries["series"];
	startRound: number;
	numGamesPlayoffSeries: number[];
	ratings: Map<number, number>;
	hca: number;
	random: () => number;
	onRoundWon: (tid: number, round: number) => void;
}) => {
	let matchups: { home: SeriesTeam; away?: SeriesTeam }[] = series[
		startRound
	]!.map(({ home, away }) => ({ home, away }));

	for (let rnd = startRound; rnd < numGamesPlayoffSeries.length; rnd++) {
		const winners: SeriesTeam[] = [];
		for (const { home, away } of matchups) {
			let winner;
			if (!away) {
				winner = home;
			} else {
				winner = simSeries(
					home,
					away,
					numGamesPlayoffSeries[rnd]!,
					ratings,
					hca,
					random,
				);
			}
			onRoundWon(winner.tid, rnd);
			winners.push({ tid: winner.tid, seed: winner.seed });
		}

		matchups = [];
		for (let i = 0; i < winners.length; i += 2) {
			const a = winners[i]!;
			const b = winners[i + 1];
			if (!b) {
				matchups.push({ home: a });
			} else if (a.seed <= b.seed) {
				matchups.push({ home: a, away: b });
			} else {
				matchups.push({ home: b, away: a });
			}
		}
	}
};

export const simSeasonOdds = async ({
	teams,
	schedule,
	playoffSeries,
	numGamesPlayoffSeries,
	hca,
	numSims,
	byConf,
	random = Math.random,
}: {
	// From getPlayoffsByConf, looked up once rather than in every simulation
	byConf: ByConf;
	teams: OddsTeam[];
	// Remaining regular season games
	schedule: { homeTid: number; awayTid: number }[];
	// During the playoffs, the current state of the playoffs
	playoffSeries?: PlayoffSeries;
	numGamesPlayoffSeries: number[];
	// Home court advantage in points
	hca: number;
	numSims: number;
	random?: () => number;
}): Promise<SeasonOddsResult> => {
	const numRounds = numGamesPlayoffSeries.length;
	const ratings = new Map(teams.map((t) => [t.tid, t.rating]));
	const indexByTid = new Map(teams.map((t, i) => [t.tid, i]));

	const counts = teams.map((t) => ({
		tid: t.tid,
		won: 0,
		lost: 0,
		playoffs: 0,
		playIn: 0,
		seeds: [] as number[],
		roundsWon: new Array<number>(numRounds).fill(0),
	}));

	const games = schedule
		.filter(
			({ homeTid, awayTid }) =>
				indexByTid.has(homeTid) && indexByTid.has(awayTid),
		)
		.map(({ homeTid, awayTid }) => ({
			home: indexByTid.get(homeTid)!,
			away: indexByTid.get(awayTid)!,
			p: winProb(ratings.get(homeTid)! - ratings.get(awayTid)! + hca),
		}));

	const onRoundWon = (tid: number, rnd: number) => {
		const row = counts[indexByTid.get(tid)!];
		if (row) {
			row.roundsWon[rnd]! += 1;
		}
	};

	const addSeed = (tid: number, seed: number) => {
		const row = counts[indexByTid.get(tid)!];
		if (row) {
			row.seeds[seed - 1] = (row.seeds[seed - 1] ?? 0) + 1;
			row.playoffs += 1;
		}
	};

	const won = new Array<number>(teams.length);
	const lost = new Array<number>(teams.length);

	for (let sim = 0; sim < numSims; sim++) {
		if (playoffSeries && playoffSeries.currentRound >= 0) {
			// Playoffs already seeded and past the play-in
			for (const matchup of playoffSeries.series[0] ?? []) {
				for (const t of [matchup.home, matchup.away]) {
					if (t) {
						addSeed(t.tid, t.seed);
					}
				}
			}
			for (let rnd = 0; rnd < playoffSeries.currentRound; rnd++) {
				for (const { home, away } of playoffSeries.series[rnd]!) {
					const numGamesToWin = Math.ceil(numGamesPlayoffSeries[rnd]! / 2);
					const winner = !away || home.won >= numGamesToWin ? home : away;
					onRoundWon(winner.tid, rnd);
				}
			}

			simBracket({
				series: playoffSeries.series,
				startRound: playoffSeries.currentRound,
				numGamesPlayoffSeries,
				ratings,
				hca,
				random,
				onRoundWon,
			});
			continue;
		}

		let result: {
			series: PlayoffSeries["series"];
			playIns?: PlayoffSeries["playIns"];
		};
		if (playoffSeries) {
			// Play-in in progress
			result = playoffSeries;
		} else {
			for (let i = 0; i < teams.length; i++) {
				won[i] = 0;
				lost[i] = 0;
			}
			for (const game of games) {
				if (random() < game.p) {
					won[game.home]! += 1;
					lost[game.away]! += 1;
				} else {
					won[game.away]! += 1;
					lost[game.home]! += 1;
				}
			}

			const hypothetical = teams.map((t, i) => {
				counts[i]!.won += won[i]!;
				counts[i]!.lost += lost[i]!;
				return getHypotheticalTeam({
					teamSeason: t.record,
					// A tiny random amount breaks ties randomly, since tiebreakers are skipped for speed
					won: won[i]! + random() * 0.001,
					lost: lost[i]!,
					usePts: false,
				});
			});

			if (numRounds === 0) {
				continue;
			}

			result = await genPlayoffSeriesFromTeams(hypothetical, {
				byConf,
				skipTiebreakers: true,
			});
		}

		const replacements = new Map<number, number>();
		for (const playIn of result.playIns ?? []) {
			for (const matchup of [playIn[0], playIn[1]]) {
				for (const t of [matchup.home, matchup.away]) {
					const row = counts[indexByTid.get(t.tid)!];
					if (row) {
						row.playIn += 1;
					}
				}
			}
			for (const [from, to] of simPlayIn(playIn, ratings, hca, random)) {
				replacements.set(from, to);
			}
		}

		const series0 = result.series[0]!.map(({ home, away }) => {
			const fix = (t: SeriesTeam) => ({
				tid: replacements.get(t.tid) ?? t.tid,
				seed: t.seed,
			});
			return { home: fix(home), away: away ? fix(away) : undefined };
		});
		for (const { home, away } of series0) {
			addSeed(home.tid, home.seed);
			if (away) {
				addSeed(away.tid, away.seed);
			}
		}

		simBracket({
			series: [series0 as any],
			startRound: 0,
			numGamesPlayoffSeries,
			ratings,
			hca,
			random,
			onRoundWon,
		});
	}

	return {
		numSims,
		numRounds,
		teams: counts.map((row, i) => {
			const t = teams[i]!;
			const seeds = [];
			for (let j = 0; j < row.seeds.length; j++) {
				seeds.push((row.seeds[j] ?? 0) / numSims);
			}
			const roundsWon = row.roundsWon.map((x) => x / numSims);
			return {
				tid: row.tid,
				projWon: t.record.won + row.won / numSims,
				projLost: t.record.lost + row.lost / numSims,
				playoffs: row.playoffs / numSims,
				playIn: row.playIn / numSims,
				seeds,
				roundsWon,
				title: roundsWon.at(-1) ?? 0,
			};
		}),
	};
};
