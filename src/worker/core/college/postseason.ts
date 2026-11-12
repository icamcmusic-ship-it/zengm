// College mode: conference tournaments, Selection and the national tournament bracket. See docs/college-mode.md.
import {
	COLLEGE_GAME,
	RESULT_SIZE,
	type CollegeConfMatchup,
	type CollegeConfTournament,
	type CollegeFieldTeam,
	type CollegeNetRow,
	type CollegeSelection,
	type CollegeState,
} from "../../../common/college/types.ts";
import { getCollegeTournamentSize } from "../../../common/college/teams.ts";
import {
	committeeScore,
	computeNet,
	type NetGame,
} from "../../../common/collegeStats/ncaaSelection.ts";
import { seedOrder } from "../../../common/collegeStats/ncaa.ts";
import { REGULAR_WEEKS } from "../../../common/collegeStats/ncaaPolls.ts";
import type {
	Conditions,
	GameResults,
	PlayoffSeries,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { recomputeLocalUITeamOvrs } from "../../util/recomputeLocalUITeamOvrs.ts";
import {
	getCollegeState,
	getRecords,
	makePolls,
	saveCollegeState,
} from "./state.ts";

const MAX_CONF_TOURNAMENT_TEAMS = 16;

const getTeamSeasons = () =>
	idb.cache.teamSeasons.indexGetAll("teamSeasonsBySeasonTid", [
		[g.get("season")],
		[g.get("season"), "Z"],
	]);

// Simple rating system (average margin adjusted for the opponents) over the games in the log
const getSrs = (state: CollegeState, numTeams: number) => {
	const margins: number[] = Array.from({ length: numTeams }, () => 0);
	const opps: number[][] = Array.from({ length: numTeams }, () => []);
	const r = state.results;
	for (let i = 0; i < r.length; i += RESULT_SIZE) {
		if (r[i + 5] === COLLEGE_GAME.NATIONAL) {
			continue;
		}
		const a = r[i + 1]!;
		const b = r[i + 2]!;
		const d = helpers.bound(r[i + 3]! - 3.5 * r[i + 4]!, -25, 25);
		margins[a]! += d;
		margins[b]! -= d;
		opps[a]!.push(b);
		opps[b]!.push(a);
	}
	const mov = margins.map((m, i) => m / Math.max(1, opps[i]!.length));
	let srs = [...mov];
	for (let iter = 0; iter < 30; iter++) {
		const next = mov.map((m, i) => {
			const list = opps[i]!;
			let sum = 0;
			for (const o of list) {
				sum += srs[o]!;
			}
			return m + (list.length > 0 ? sum / list.length : 0);
		});
		const mean = next.reduce((a, b) => a + b, 0) / Math.max(1, numTeams);
		srs = next.map((x) => x - mean);
	}
	return srs;
};

/**
 * NET-style ranking, SRS and committee score of every active team, from the results log. Best NET first.
 */
export const getNetRows = (
	state: CollegeState,
	activeTids: number[],
): CollegeNetRow[] => {
	const numTeams = g.get("numTeams");
	const games: NetGame[] = [];
	const r = state.results;
	for (let i = 0; i < r.length; i += RESULT_SIZE) {
		if (r[i + 5] === COLLEGE_GAME.NATIONAL) {
			continue;
		}
		games.push({ a: r[i + 1]!, b: r[i + 2]!, home: r[i + 4]!, d: r[i + 3]! });
	}
	// The quadrant cutoffs are for about 360 teams
	const net = computeNet(numTeams, games, activeTids.length / 360);
	const srs = getSrs(state, numTeams);
	const { w, l } = getRecords(state);
	return activeTids
		.map((tid) => {
			const row = net[tid]!;
			return {
				tid,
				rank: row.rank,
				score: row.score,
				sosRank: row.sosRank,
				quads: row.quads,
				w: w[tid]!,
				l: l[tid]!,
				srs: Math.round(srs[tid]! * 100) / 100,
				sel:
					Math.round(
						committeeScore(row, { w: w[tid]!, l: l[tid]!, srs: srs[tid]! }) *
							1000,
					) / 1000,
			};
		})
		.sort((a, b) => a.rank - b.rank);
};

// ---- Conference tournaments ----

const byeSlot = (): CollegeConfMatchup => ({ home: -1, away: -1 });

/**
 * One bracket per conference from the final conference standings: everyone (at most 16), the top seeds get byes.
 */
export const startConfTournaments = async () => {
	const state = getCollegeState();
	if (!state) {
		throw new Error("No college season state");
	}
	const teamSeasons = await getTeamSeasons();
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const seasonByTid = new Map(teamSeasons.map((ts) => [ts.tid, ts]));
	const srs = getSrs(state, g.get("numTeams"));

	const tournaments: CollegeConfTournament[] = [];
	for (const conf of g.get("confs", "current")) {
		const confTeams = teams.filter((t) => t.cid === conf.cid);
		if (confTeams.length < 2) {
			continue;
		}
		const pct = (tid: number) => {
			const ts = seasonByTid.get(tid);
			if (!ts) {
				return 0;
			}
			const gp = ts.wonConf + ts.lostConf;
			return gp > 0 ? ts.wonConf / gp : 0;
		};
		const seeds = confTeams
			.map((t) => t.tid)
			.sort(
				(a, b) =>
					pct(b) - pct(a) ||
					(seasonByTid.get(b)?.wonConf ?? 0) -
						(seasonByTid.get(a)?.wonConf ?? 0) ||
					srs[b]! - srs[a]! ||
					a - b,
			)
			.slice(0, MAX_CONF_TOURNAMENT_TEAMS);
		const n = seeds.length;
		let size = 2;
		while (size < n) {
			size *= 2;
		}
		const numRounds = Math.log2(size);
		const order = seedOrder(size);
		const rounds: CollegeConfMatchup[][] = [];
		const first: CollegeConfMatchup[] = [];
		for (let i = 0; i < size; i += 2) {
			const s1 = Math.min(order[i]!, order[i + 1]!);
			const s2 = Math.max(order[i]!, order[i + 1]!);
			if (s2 > n) {
				// Bye for the better seed
				first.push({ home: seeds[s1 - 1]!, away: -2, seedHome: s1 });
			} else {
				first.push({
					home: seeds[s1 - 1]!,
					away: seeds[s2 - 1]!,
					seedHome: s1,
					seedAway: s2,
				});
			}
		}
		rounds.push(first);
		for (let rnd = 1; rnd < numRounds; rnd++) {
			rounds.push(
				Array.from({ length: size / 2 ** (rnd + 1) }, () => byeSlot()),
			);
		}
		tournaments.push({ cid: conf.cid, seeds, rounds });
	}

	state.confTournaments = tournaments;
	advanceConfTournaments(state);
	await saveCollegeState(state);
	return scheduleConfTournamentDay(state);
};

const matchupWinner = (m: CollegeConfMatchup) => {
	if (m.away === -2) {
		return { tid: m.home, seed: m.seedHome };
	}
	if (!m.pts) {
		return undefined;
	}
	return m.pts[0] > m.pts[1]
		? { tid: m.home, seed: m.seedHome }
		: { tid: m.away, seed: m.seedAway };
};

// Move winners (and byes) into the next round, and set the champion
const advanceConfTournaments = (state: CollegeState) => {
	for (const t of state.confTournaments ?? []) {
		for (let rnd = 0; rnd < t.rounds.length; rnd++) {
			const round = t.rounds[rnd]!;
			const next = t.rounds[rnd + 1];
			for (const [i, m] of round.entries()) {
				const won = matchupWinner(m);
				if (!won) {
					continue;
				}
				if (!next) {
					t.champion = won.tid;
					continue;
				}
				const slot = next[Math.floor(i / 2)]!;
				// The better seed is the "home" team (the court is neutral)
				const other =
					i % 2 === 0
						? matchupWinner(round[i + 1]!)
						: matchupWinner(round[i - 1]!);
				if (other && slot.home === -1) {
					const [a, b] =
						(won.seed ?? 99) < (other.seed ?? 99) ? [won, other] : [other, won];
					slot.home = a.tid;
					slot.seedHome = a.seed;
					slot.away = b.tid;
					slot.seedAway = b.seed;
				}
			}
		}
	}
};

const pendingConfGames = (state: CollegeState) => {
	const games: [number, number][] = [];
	for (const t of state.confTournaments ?? []) {
		// Only the earliest round with unplayed games, so a team never plays twice in a day
		for (const round of t.rounds) {
			const pending = round.filter(
				(m) => m.home >= 0 && m.away >= 0 && !m.pts,
			);
			if (pending.length > 0) {
				for (const m of pending) {
					games.push([m.home, m.away]);
				}
				break;
			}
		}
	}
	return games;
};

const getNextDay = async () => {
	let day = 0;
	const season = g.get("season");
	for (const game of await idb.cache.games.getAll()) {
		if (game.season === season && typeof game.day === "number") {
			day = Math.max(day, game.day);
		}
	}
	return day + 1;
};

/**
 * Put the next day of conference tournament games on the schedule. Returns false when the tournaments are over.
 */
export const scheduleConfTournamentDay = async (state: CollegeState) => {
	const games = pendingConfGames(state);
	if (games.length === 0) {
		return false;
	}
	const day = await getNextDay();
	await idb.cache.schedule.clear();
	await idb.cache.schedule.addAll(
		games.map(([homeTid, awayTid]) => ({ homeTid, awayTid, day })),
	);
	await recomputeLocalUITeamOvrs();
	return true;
};

/**
 * After a day of conference tournament games: record the scores, advance the brackets, schedule the next day.
 */
export const afterConfTournamentGames = async (
	state: CollegeState,
	results: GameResults[],
) => {
	const scores = new Map<string, [number, number]>();
	for (const result of results) {
		scores.set(`${result.team[0].id}|${result.team[1].id}`, [
			result.team[0].stat.pts,
			result.team[1].stat.pts,
		]);
	}
	for (const t of state.confTournaments ?? []) {
		for (const round of t.rounds) {
			for (const m of round) {
				if (m.home >= 0 && m.away >= 0 && !m.pts) {
					const pts = scores.get(`${m.home}|${m.away}`);
					if (pts) {
						m.pts = pts;
					}
				}
			}
		}
	}
	advanceConfTournaments(state);

	// Conference tournament games count in the overall record, not in the conference (and division) record
	for (const result of results) {
		const homeWon = result.team[0].stat.pts > result.team[1].stat.pts;
		for (const i of [0, 1] as const) {
			const teamSeason = await idb.cache.teamSeasons.indexGet(
				"teamSeasonsBySeasonTid",
				[g.get("season"), result.team[i].id],
			);
			if (!teamSeason) {
				continue;
			}
			const won = (i === 0) === homeWon;
			if (won) {
				teamSeason.wonConf = Math.max(0, teamSeason.wonConf - 1);
				teamSeason.wonDiv = Math.max(0, teamSeason.wonDiv - 1);
			} else {
				teamSeason.lostConf = Math.max(0, teamSeason.lostConf - 1);
				teamSeason.lostDiv = Math.max(0, teamSeason.lostDiv - 1);
			}
			await idb.cache.teamSeasons.put(teamSeason);
		}
	}
};

// ---- Selection and the national tournament ----

const regionOfLine = (line: number, slot: number, numRegions: number) =>
	line % 2 === 0 ? slot : numRegions - 1 - slot;

/**
 * Selection: conference tournament champions get automatic bids, the best of the rest (committee score) fill the field. Seeds on an
 * S-curve into regions.
 */
export const makeSelection = (
	state: CollegeState,
	activeTids: number[],
): CollegeSelection => {
	const net = getNetRows(state, activeTids);
	const size = Math.min(
		getCollegeTournamentSize(activeTids.length),
		2 ** g.get("numGamesPlayoffSeries", "current").length,
	);
	const numRegions = size >= 16 ? 4 : size >= 4 ? 2 : 1;

	const bySel = [...net].sort((a, b) => b.sel - a.sel || a.rank - b.rank);
	const champions = new Set(
		(state.confTournaments ?? [])
			.map((t) => t.champion)
			.filter((tid): tid is number => tid !== undefined),
	);
	// More conferences than spots (should not happen): the best champions
	const autos = bySel.filter((row) => champions.has(row.tid)).slice(0, size);
	const autoTids = new Set(autos.map((row) => row.tid));
	const pool = bySel.filter((row) => !autoTids.has(row.tid));
	const atLarge = pool.slice(0, size - autos.length);
	const out = pool.slice(atLarge.length);

	const fieldRows = [...autos, ...atLarge].sort(
		(a, b) => b.sel - a.sel || a.rank - b.rank,
	);
	const field: CollegeFieldTeam[] = fieldRows.map((row, i) => {
		const line = Math.floor(i / numRegions);
		return {
			tid: row.tid,
			seed: line + 1,
			region: regionOfLine(line, i % numRegions, numRegions),
			bid: autoTids.has(row.tid) ? "auto" : "at-large",
			overall: i + 1,
		};
	});

	return {
		field,
		lastFourIn: atLarge.slice(-4).map((row) => row.tid),
		firstFourOut: out.slice(0, 4).map((row) => row.tid),
		nextFourOut: out.slice(4, 8).map((row) => row.tid),
		net,
	};
};

/**
 * The national tournament as the engine's playoff series (first round only, the engine pairs the winners). Called when the playoffs phase
 * starts.
 */
export const genNationalTournament = async (conditions: Conditions) => {
	let state = getCollegeState();
	if (!state) {
		throw new Error("No college season state");
	}
	const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
	const cidByTid = new Map(teams.map((t) => [t.tid, t.cid]));

	// The final poll, with the conference tournaments in it
	makePolls(state, REGULAR_WEEKS);

	const selection = makeSelection(
		state,
		teams.map((t) => t.tid),
	);
	state.selection = selection;
	state = await saveCollegeState(state);

	const numRounds = g.get("numGamesPlayoffSeries", "current").length;
	const series: PlayoffSeries["series"] = Array.from(
		{ length: numRounds },
		() => [],
	);
	const numRegions = Math.max(...selection.field.map((t) => t.region)) + 1;
	const perRegion = selection.field.length / numRegions;
	const order = seedOrder(perRegion);
	for (let region = 0; region < numRegions; region++) {
		const bySeed = new Map(
			selection.field
				.filter((t) => t.region === region)
				.map((t) => [t.seed, t]),
		);
		for (let i = 0; i < perRegion; i += 2) {
			const a = bySeed.get(Math.min(order[i]!, order[i + 1]!))!;
			const b = bySeed.get(Math.max(order[i]!, order[i + 1]!))!;
			series[0]!.push({
				home: { tid: a.tid, cid: cidByTid.get(a.tid)!, seed: a.seed, won: 0 },
				away: { tid: b.tid, cid: cidByTid.get(b.tid)!, seed: b.seed, won: 0 },
			});
		}
	}

	const teamInfoCache = g.get("teamInfoCache");
	const userTid = g.get("userTid");
	const bracketUrl = helpers.leagueUrl(["playoffs", g.get("season")]);
	for (const t of selection.field) {
		const info = teamInfoCache[t.tid];
		logEvent(
			{
				type: "madePlayoffs",
				text: `<a href="${helpers.leagueUrl([
					"roster",
					`${info?.abbrev}_${t.tid}`,
					g.get("season"),
				])}">${info?.region}</a> made the <a href="${bracketUrl}">national tournament</a> as a ${t.seed} seed (${
					t.bid === "auto" ? "automatic bid" : "at-large bid"
				}).`,
				showNotification: t.tid === userTid,
				tids: [t.tid],
				score: 0,
			},
			conditions,
		);
	}
	if (
		!selection.field.some((t) => t.tid === userTid) &&
		!g.get("spectator")
	) {
		const firstOut = selection.firstFourOut.includes(userTid);
		logEvent(
			{
				type: "info",
				text: firstOut
					? "Your team was one of the first four left out of the national tournament."
					: "Your team did not make the national tournament.",
				showNotification: true,
				saveToDb: false,
			},
			conditions,
		);
	}

	return {
		byConf: false as const,
		playIns: undefined,
		series,
		tidPlayIn: [] as number[],
		tidPlayoffs: selection.field.map((t) => t.tid),
	};
};
