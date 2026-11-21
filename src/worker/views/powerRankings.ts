import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
import { bySport } from "../../common/sportFunctions.ts";
import type { TeamFiltered } from "../../common/types.ts";
import { defineView } from "../util/defineView.ts";
import { player, team } from "../core/index.ts";
import {
	NOT_REAL_POSITIONS,
	POSITIONS,
	RATINGS,
} from "../../common/constants.ts";
import hasTies from "../core/season/hasTies.ts";
import { getActualPlayThroughInjuries } from "../core/game/loadTeams.ts";
import { PHASE } from "../../common/constants.ts";
import type { RouteParams } from "../../ui/router/types.ts";
import { getSeasonOdds } from "../core/seasonOdds/index.ts";
import { validatePlayoffs, validateSeason } from "../util/processInputs.ts";

const processInputs = (params: RouteParams<"powerRankings">) => {
	return {
		playoffs: validatePlayoffs(
			params.playoffs,
			g.get("phase") === PHASE.PLAYOFFS ? "playoffs" : "regularSeason",
		),
		season: validateSeason(params.season),
	};
};

const otherToRanks = (
	teams: {
		powerRankings: {
			other: Record<string, number>;
			otherCurrent: Record<string, number>;
		};
	}[],
) => {
	if (!teams[0]) {
		return;
	}

	for (const field of ["other", "otherCurrent"] as const) {
		for (const key of Object.keys(teams[0].powerRankings[field])) {
			const values = teams.map((t) => t.powerRankings[field][key]!);
			const sorted = values.toSorted((a, b) => b - a);
			const ranks = values.map((value) => sorted.indexOf(value) + 1);
			for (const [t, rank] of Iterator.zip([teams, ranks], {
				mode: "strict",
			})) {
				t.powerRankings[field][key] = rank;
			}
		}
	}
};

// How much a point (goal, run) of margin of victory is worth next to the rating term. Basketball is the reference (1, so its
// rankings are unchanged); in low scoring sports a goal or run is worth much more, otherwise MOV barely counts there
export const MOV_SCALE = bySport({
	baseball: 7,
	basketball: 1,
	football: 1,
	hockey: 10,
});

// Wins and games played in a "last ten" string (W-L, W-L-OTL, W-L-T or W-L-OTL-T)
export const parseLastTen = (lastTen: string) => {
	const parts = lastTen.split("-").map((x) => Number.parseInt(x));
	if (parts.length === 0 || parts.some((x) => Number.isNaN(x))) {
		return { won: 0, played: 0 };
	}
	return {
		won: parts[0]!,
		played: parts.reduce((a, b) => a + b, 0),
	};
};

// Playoff results, once the season's playoffs have started: what a team has done there moves it next to its regular season
export type PowerRankingsPlayoffs = {
	// Playoff rounds won (teamSeason.playoffRoundsWon, -1 if it missed the playoffs)
	roundsWon: number;
	// Playoff games won and lost (play-in excluded)
	won: number;
	lost: number;
	// Playoff point margin per game
	mov: number;
};

// Each round won is worth about as much as going 10-0 in the last 10, so a champion ends up near the top unless it was far behind
export const PLAYOFF_ROUND_WEIGHT = 4;
// Winning (or losing) every playoff game is worth up to this much, shrunk towards 0 over the first few games
export const PLAYOFF_RECORD_WEIGHT = 6;
// Playoff margin counts half as much as regular season margin per game, and only fully after 10 games
export const PLAYOFF_MOV_WEIGHT = 0.5;

export const playoffScore = ({
	roundsWon,
	won,
	lost,
	mov,
}: PowerRankingsPlayoffs) => {
	if (roundsWon < 0) {
		return 0;
	}
	const gp = won + lost;
	let score = PLAYOFF_ROUND_WEIGHT * roundsWon;
	if (gp > 0) {
		score += (PLAYOFF_RECORD_WEIGHT * (won - lost)) / Math.max(gp, 4);
		score += PLAYOFF_MOV_WEIGHT * MOV_SCALE * mov * Math.min(1, gp / 10);
	}
	return score;
};

export const getPowerRankingsScore = ({
	mov,
	gp,
	numGames,
	ovr,
	lastTen,
	playoffs,
}: {
	mov: number;
	gp: number;
	numGames: number;
	ovr: number;
	lastTen: string;
	playoffs?: PowerRankingsPlayoffs;
}) => {
	// Start with MOV, scaled for games played (and per sport)
	let score = numGames > 0 ? (MOV_SCALE * mov * gp) / numGames : 0;

	// Add estimated MOV from ovr (0/100 to -30/30)
	score += ovr * 0.6 - 30;

	// Modulate by recent record: +10 for winning all of the last 10 and -10 for losing all of them, by the games actually played (a
	// team 3-0 in its first 3 games gets +10, not -4)
	const { won, played } = parseLastTen(lastTen);
	if (played > 0) {
		score += 10 * ((2 * won) / played - 1);
	}

	if (playoffs) {
		score += playoffScore(playoffs);
	}

	return score;
};

// Whether a season's playoffs have started, so its power rankings include playoff results
const playoffsStarted = (season: number) =>
	season < g.get("season") ||
	(season === g.get("season") && g.get("phase") >= PHASE.PLAYOFFS);

const getPlayoffResults = async (season: number) => {
	const byTid = new Map<number, PowerRankingsPlayoffs>();
	if (!playoffsStarted(season)) {
		return byTid;
	}
	const playoffSeries = await idb.merged.playoffSeries.get(season);
	if (!playoffSeries) {
		return byTid;
	}
	const teams = await team.getFormattedAll({
		attrs: ["tid"],
		seasonAttrs: ["playoffRoundsWon"],
		stats: ["gp", "mov"],
		season,
		playoffs: true,
		regularSeason: false,
		showNoStats: true,
	});
	const record = new Map<number, { won: number; lost: number }>();
	for (const round of playoffSeries.series) {
		for (const { home, away } of round) {
			if (!away) {
				continue;
			}
			for (const [t, opp] of [
				[home, away],
				[away, home],
			] as const) {
				const row = record.get(t.tid) ?? { won: 0, lost: 0 };
				row.won += t.won;
				row.lost += opp.won;
				record.set(t.tid, row);
			}
		}
	}
	for (const t of teams) {
		const roundsWon = t.seasonAttrs.playoffRoundsWon ?? -1;
		if (roundsWon < 0) {
			continue;
		}
		const { won, lost } = record.get(t.tid) ?? { won: 0, lost: 0 };
		byTid.set(t.tid, {
			roundsWon,
			won,
			lost,
			mov: won + lost > 0 && t.stats.gp > 0 ? t.stats.mov : 0,
		});
	}
	return byTid;
};

export const addPowerRankingsStuffToTeams = async <
	T extends TeamFiltered<
		["playThroughInjuries", "tid"],
		["lastTen"],
		["gp", "mov"],
		number
	>,
>(
	teams: T[],
	season: number,
	playoffs: "regularSeason" | "playoffs",
) => {
	const currentSeason = g.get("season") === season;

	const formatOptions = {
		attrs: ["tid", "injury", "value", "age", "pid"],
		ratings: [
			"ovr",
			"pos",
			"ovrs",
			...(__SPORT === "basketball" ? RATINGS : []),
		],
		stats: ["season", "tid", "gp", "min"],
		season,
		showNoStats: currentSeason,
		showRookies: currentSeason,
		fuzz: true,
	} as const;
	const abbrevs = await player.loadAbbrevs(formatOptions);
	const formattersByTid = new Map(
		teams.map((t) => [
			t.tid,
			player.createFormatter({ ...formatOptions, tid: t.tid }, abbrevs),
		]),
	);

	// Read each player once and format them for every team they were on, rather than reading players separately for each team. In the current season, that's their current team. In past seasons, it's every team they have stats for that season.
	const rows = (
		await idb.merged.players.getAll(
			currentSeason ? { tid: [0, Infinity] } : { activeSeason: season },
			{
				map: (pRaw) => {
					const tids = currentSeason
						? [pRaw.tid]
						: new Set(
								pRaw.stats
									.filter((row) => row.season === season)
									.map((row) => row.tid),
							);

					const playerRows = [];
					for (const tid of tids) {
						const p = formattersByTid.get(tid)?.(pRaw);
						if (p) {
							playerRows.push({ tid, p });
						}
					}
					return playerRows;
				},
			},
		)
	).flat();
	const rowsByTid = Map.groupBy(rows, (row) => row.tid);

	const playoffResults = await getPlayoffResults(season);

	// Calculate team ovr ratings
	const teamsWithRankings = teams.map((t) => {
		// Sorted by pid so ties in team.ovr are broken the same way regardless of which index the players were read from
		const teamPlayers = (rowsByTid.get(t.tid) ?? [])
			.map((row) => row.p)
			.sort((a, b) => a.pid - b.pid);

		const playThroughInjuries = getActualPlayThroughInjuries(t);

		const ovr = team.ovr(teamPlayers, {
			playoffs: playoffs === "playoffs",
		});
		const ovrCurrent = team.ovr(teamPlayers, {
			accountForInjuredPlayers: {
				numDaysInFuture: 0,
				playThroughInjuries,
			},
			playoffs: playoffs === "playoffs",
		});

		// Injury-aware rating in the current season (who can actually play now), healthy rating for past seasons
		const score = getPowerRankingsScore({
			mov: t.stats.mov,
			gp: t.stats.gp,
			numGames: g.get("numGames", season),
			ovr: currentSeason ? ovrCurrent : ovr,
			lastTen: t.seasonAttrs.lastTen,
			playoffs: playoffResults.get(t.tid),
		});

		const other: Record<string, number> = {};
		const otherCurrent: Record<string, number> = {};
		if (__SPORT === "basketball") {
			for (const rating of RATINGS) {
				other[rating] = team.ovr(teamPlayers, {
					playoffs: playoffs === "playoffs",
					rating,
				});
				otherCurrent[rating] = team.ovr(teamPlayers, {
					accountForInjuredPlayers: {
						numDaysInFuture: 0,
						playThroughInjuries,
					},
					playoffs: playoffs === "playoffs",
					rating,
				});
			}
		} else {
			for (const pos of POSITIONS) {
				if (NOT_REAL_POSITIONS.has(pos)) {
					continue;
				}
				other[pos] = team.ovr(teamPlayers, {
					playoffs: playoffs === "playoffs",
					onlyPos: pos,
				});
				otherCurrent[pos] = team.ovr(teamPlayers, {
					accountForInjuredPlayers: {
						numDaysInFuture: 0,
						playThroughInjuries,
					},
					playoffs: playoffs === "playoffs",
					onlyPos: pos,
				});
			}
		}

		return {
			...t,
			powerRankings: {
				score,
				ovr,
				ovrCurrent,
				other,
				otherCurrent,
				avgAge: team.avgAge(teamPlayers),

				// Placeholder
				rank: -1,
			},
		};
	});

	otherToRanks(teamsWithRankings);

	teamsWithRankings.sort(
		(a, b) => b.powerRankings.score - a.powerRankings.score,
	);

	for (const [i, t] of teamsWithRankings.entries()) {
		t.powerRankings.rank = i + 1;
	}

	return teamsWithRankings;
};

const SNAPSHOT_INTERVAL_DAYS = __SPORT === "football" ? 1 : 7;

// Store each team's power rank in its teamSeason about once every SNAPSHOT_INTERVAL_DAYS days of games, through the regular season and
// the playoffs (playoff snapshots use the playoff rotation ratings and include playoff results, and are marked as such)
export const snapshotPowerRankings = async () => {
	const season = g.get("season");
	const teamSeasons = (
		await idb.cache.teamSeasons.indexGetAll("teamSeasonsBySeasonTid", [
			[season],
			[season, "Z"],
		])
	).filter((ts) => !g.get("teamInfoCache")[ts.tid]?.disabled);
	if (teamSeasons.length === 0) {
		return;
	}

	const day = Math.max(...teamSeasons.map((ts) => ts.lastGameDay ?? 0));
	const lastDay = Math.max(
		-Infinity,
		...teamSeasons.map((ts) => ts.powerRankHistory?.at(-1)?.day ?? -Infinity),
	);
	if (day <= 0 || day - lastDay < SNAPSHOT_INTERVAL_DAYS) {
		return;
	}

	const teams = await team.getFormattedAll({
		attrs: ["tid", "playThroughInjuries"],
		seasonAttrs: ["lastTen"],
		stats: ["gp", "mov"],
		season,
		showNoStats: true,
	});
	const playoffs = g.get("phase") === PHASE.PLAYOFFS;
	const ranked = await addPowerRankingsStuffToTeams(
		teams,
		season,
		playoffs ? "playoffs" : "regularSeason",
	);
	const rankByTid = new Map(ranked.map((t) => [t.tid, t.powerRankings.rank]));

	for (const ts of teamSeasons) {
		const rank = rankByTid.get(ts.tid);
		if (rank === undefined) {
			continue;
		}
		ts.powerRankHistory = [
			...(ts.powerRankHistory ?? []),
			playoffs ? { day, rank, playoffs: true as const } : { day, rank },
		];
		await idb.cache.teamSeasons.put(ts);
	}
};

export default defineView({
	id: "powerRankings",
	processInputs,
	load: async ({ inputs: { playoffs, season }, updateEvents, prevInputs }) => {
		if (
			(season === g.get("season") && updateEvents.has("gameSim")) ||
			season !== prevInputs?.season ||
			playoffs !== prevInputs?.playoffs
		) {
			const teams = await team.getFormattedAll({
				attrs: ["tid", "depth", "playThroughInjuries"],
				seasonAttrs: [
					"won",
					"lost",
					"tied",
					"otl",
					"lastTen",
					"abbrev",
					"region",
					"name",
					"cid",
					"did",
					"imgURL",
					"imgURLSmall",
					"powerRankHistory",
					"lastGameDay",
				],
				stats: ["gp", "mov", "pts", "oppPts"],
				season,
				showNoStats: true,
			});

			const teamsWithRankings = (
				await addPowerRankingsStuffToTeams(teams, season, playoffs)
			).map((t) => {
				// Movement since the previous weekly snapshot. If a snapshot was taken on the latest game day, compare to the one before it
				const history = t.seasonAttrs.powerRankHistory ?? [];
				const latestDay = t.seasonAttrs.lastGameDay;
				// Only against a snapshot ranked the same way (regular season or playoff ratings)
				const prev = history.findLast(
					(row) =>
						row.day < (latestDay ?? Infinity) &&
						!!row.playoffs === (playoffs === "playoffs"),
				);
				return {
					...t,
					powerRankHistory: history,
					rankChange: prev ? prev.rank - t.powerRankings.rank : undefined,
				};
			});

			// No Visible Ratings challenge: the rating/position ranks are hidden, so don't send them either
			if (g.get("challengeNoRatings")) {
				for (const t of teamsWithRankings) {
					t.powerRankings.other = {};
					t.powerRankings.otherCurrent = {};
				}
			}

			let ties = false;
			let otl = false;
			for (const t of teams) {
				if (t.seasonAttrs.tied > 0) {
					ties = true;
				}
				if (t.seasonAttrs.otl > 0) {
					otl = true;
				}
				if (ties && otl) {
					break;
				}
			}

			// Monte Carlo playoff and title odds (basketball, current season)
			let seasonOdds:
				| Record<number, { playoffs: number; title: number }>
				| undefined;
			if (season === g.get("season")) {
				const odds = await getSeasonOdds();
				if (odds) {
					seasonOdds = {};
					for (const t of odds.teams) {
						seasonOdds[t.tid] = { playoffs: t.playoffs, title: t.title };
					}
				}
			}

			return {
				seasonOdds,
				confs: g.get("confs", season),
				divs: g.get("divs", season),
				playoffs,
				season,
				teams: teamsWithRankings,
				ties: hasTies(season) || ties,
				otl: g.get("otl", season) || otl,
			};
		}
	},
});
