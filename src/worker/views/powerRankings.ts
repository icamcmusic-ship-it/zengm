import { idb } from "../db/index.ts";
import { g } from "../util/index.ts";
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
import {
	getSeasonOdds,
	MOV_SCALE,
	teamStrength,
} from "../core/seasonOdds/index.ts";
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

// Shared with Season Odds (core/seasonOdds/strength.ts)
export { MOV_SCALE };

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

// The parts of a power ranking score, in score points. Strength is the measure shared with Season Odds (an expected point margin), counted
// double so it outweighs form; the roster part is split into the healthy roster and what injuries take off it
export type PowerRankingsParts = {
	roster: number;
	injuries: number;
	results: number;
	form: number;
	playoffs: number;
};

// Score points per point of strength
export const STRENGTH_WEIGHT = 2;

export const getPowerRankingsParts = ({
	mov,
	gp,
	ovr,
	ovrHealthy,
	lastTen,
	playoffs,
	playoffOvr,
}: {
	mov: number;
	gp: number;
	ovr: number;
	// The healthy rating, when ovr accounts for injuries
	ovrHealthy?: number;
	lastTen: string;
	playoffs?: PowerRankingsPlayoffs;
	// ovr is the playoff rotation rating
	playoffOvr?: boolean;
}): PowerRankingsParts & { strength: number } => {
	const strength = teamStrength({ ovr, mov, gp, playoffOvr });
	const healthy =
		ovrHealthy === undefined
			? strength
			: teamStrength({ ovr: ovrHealthy, mov, gp, playoffOvr });

	// Recent record: +10 for winning all of the last 10 and -10 for losing all of them, by the games actually played (a team 3-0 in its first
	// 3 games gets +10, not -4)
	let form = 0;
	const { won, played } = parseLastTen(lastTen);
	if (played > 0) {
		form = 10 * ((2 * won) / played - 1);
	}

	const roster = STRENGTH_WEIGHT * (1 - healthy.w) * healthy.roster;
	return {
		strength: strength.strength,
		roster,
		injuries: STRENGTH_WEIGHT * (1 - strength.w) * strength.roster - roster,
		results: STRENGTH_WEIGHT * strength.w * strength.results,
		form,
		playoffs: playoffs ? playoffScore(playoffs) : 0,
	};
};

export const sumPowerRankingsParts = (parts: PowerRankingsParts) =>
	parts.roster + parts.injuries + parts.results + parts.form + parts.playoffs;

export const getPowerRankingsScore = (
	info: Parameters<typeof getPowerRankingsParts>[0],
) => sumPowerRankingsParts(getPowerRankingsParts(info));

const PART_LABELS: Record<keyof PowerRankingsParts, string> = {
	roster: "roster",
	injuries: "injuries",
	results: "point margin",
	form: "recent form",
	playoffs: "playoff run",
};

export type PowerRankingsWhy = {
	// Each part compared to the league average, biggest first
	parts: { key: keyof PowerRankingsParts; label: string; value: number }[];
	text: string;
};

// What drives each team's rank: each part of its score next to the league average. Under No Visible Ratings the roster and injury parts
// are left out (they are the team rating).
export const explainPowerRankings = (
	teams: { parts: PowerRankingsParts }[],
	noRatings: boolean,
): PowerRankingsWhy[] => {
	const keys = (
		Object.keys(PART_LABELS) as (keyof PowerRankingsParts)[]
	).filter((key) => !noRatings || (key !== "roster" && key !== "injuries"));
	const avg = {} as Record<keyof PowerRankingsParts, number>;
	for (const key of keys) {
		avg[key] =
			teams.length > 0
				? teams.reduce((sum, t) => sum + t.parts[key], 0) / teams.length
				: 0;
	}
	return teams.map((t) => {
		const parts = keys
			.map((key) => ({
				key,
				label: PART_LABELS[key],
				value: t.parts[key] - avg[key],
			}))
			.filter((part) => Math.abs(part.value) >= 0.05)
			.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
		const up = parts.filter((part) => part.value >= 1).slice(0, 2);
		const down = parts.filter((part) => part.value <= -1).slice(0, 2);
		const list = (rows: typeof parts) =>
			rows.map((part) => part.label).join(" and ");
		let text;
		if (up.length > 0 && down.length > 0) {
			text = `Lifted by ${list(up)}, held back by ${list(down)}.`;
		} else if (up.length > 0) {
			text = `Lifted by ${list(up)}.`;
		} else if (down.length > 0) {
			text = `Held back by ${list(down)}.`;
		} else {
			text = "Close to league average across the board.";
		}
		return { parts, text };
	});
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
		const { strength, ...parts } = getPowerRankingsParts({
			mov: t.stats.mov,
			gp: t.stats.gp,
			ovr: currentSeason ? ovrCurrent : ovr,
			ovrHealthy: currentSeason ? ovr : undefined,
			lastTen: t.seasonAttrs.lastTen,
			playoffs: playoffResults.get(t.tid),
			playoffOvr: playoffs === "playoffs",
		});
		const score = sumPowerRankingsParts(parts);

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
				strength,
				parts,
				why: undefined as PowerRankingsWhy | undefined,
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

	const whys = explainPowerRankings(
		teamsWithRankings.map((t) => t.powerRankings),
		g.get("challengeNoRatings"),
	);
	for (const [t, why] of Iterator.zip([teamsWithRankings, whys], {
		mode: "strict",
	})) {
		t.powerRankings.why = why;
	}

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
					// The "why" already leaves the roster out; the strength blend and roster parts would give the team rating away
					t.powerRankings.strength = 0;
					t.powerRankings.parts.roster = 0;
					t.powerRankings.parts.injuries = 0;
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
