// College mode: conference tournaments, Selection and the national tournament bracket. See docs/college-mode.md.
import {
	isPostseasonGameType,
	RESULT_SIZE,
	type CollegeConfMatchup,
	type CollegeConfTournament,
	type CollegeFieldTeam,
	type CollegeFirstFourGame,
	type CollegeNit,
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
import { recruitingWeek } from "./recruiting.ts";
import { nativeFeatureEnabled } from "../../../common/nativeFeatures.ts";
import { g, helpers, logEvent } from "../../util/index.ts";
import { recomputeLocalUITeamOvrs } from "../../util/recomputeLocalUITeamOvrs.ts";
import {
	findPending,
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
		if (isPostseasonGameType(r[i + 5]!)) {
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
		if (isPostseasonGameType(r[i + 5]!)) {
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
export const advanceBracket = (t: CollegeConfTournament) => {
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
			// The better seed is the "home" team
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
};

const advanceConfTournaments = (state: CollegeState) => {
	for (const t of state.confTournaments ?? []) {
		advanceBracket(t);
	}
};

// Record the scores of a day's games on the matchups they belong to
const setScores = (
	matchups: Iterable<CollegeConfMatchup | CollegeFirstFourGame>,
	results: GameResults[],
) => {
	const scores = new Map<string, [number, number]>();
	for (const result of results) {
		scores.set(`${result.team[0].id}|${result.team[1].id}`, [
			result.team[0].stat.pts,
			result.team[1].stat.pts,
		]);
	}
	for (const m of matchups) {
		if (m.home >= 0 && m.away >= 0 && !m.pts) {
			const pts = scores.get(`${m.home}|${m.away}`);
			const reversed = scores.get(`${m.away}|${m.home}`);
			if (pts) {
				m.pts = pts;
			} else if (reversed) {
				m.pts = [reversed[1], reversed[0]];
			}
		}
	}
};

const pendingConfGames = (state: CollegeState) => {
	const games: [number, number][] = [];
	for (const t of state.confTournaments ?? []) {
		// Only the earliest round with unplayed games, so a team never plays twice in a day
		for (const round of t.rounds) {
			const pending = round.filter((m) => m.home >= 0 && m.away >= 0 && !m.pts);
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
	let games = pendingConfGames(state);
	if (games.length === 0) {
		// The conference tournaments are over: with a 68-team field, Selection now and the First Four next
		if (!state.firstFour && useFirstFour()) {
			const teams = (await idb.cache.teams.getAll()).filter((t) => !t.disabled);
			makePolls(state, REGULAR_WEEKS);
			state.selection = makeSelection(
				state,
				teams.map((t) => t.tid),
				true,
			);
			state.firstFour = makeFirstFour(state.selection);
			await saveCollegeState(state);
			await logFirstFour(state.firstFour);
		}
		games = (state.firstFour ?? [])
			.filter((m) => !m.pts)
			.map((m) => [m.home, m.away]);
	}
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
	const firstFour = state.firstFour ?? [];
	const isFirstFour = (result: GameResults) =>
		!!findPending(firstFour, result.team[0].id, result.team[1].id);
	const ffResults = results.filter(isFirstFour);
	const confResults = results.filter((result) => !isFirstFour(result));
	setScores(firstFour, ffResults);
	setScores(
		(state.confTournaments ?? []).flatMap((t) => t.rounds.flat()),
		confResults,
	);
	advanceConfTournaments(state);

	// Conference tournament games count in the overall record, not in the conference (and division) record. So do First Four games
	// between teams of the same conference
	for (const result of results) {
		if (
			ffResults.includes(result) &&
			result.team[0].cid !== result.team[1].cid
		) {
			continue;
		}
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
	firstFour = false,
): CollegeSelection => {
	const net = getNetRows(state, activeTids);
	const size = Math.min(
		getCollegeTournamentSize(activeTids.length),
		2 ** g.get("numGamesPlayoffSeries", "current").length,
	);
	const numRegions = size >= 16 ? 4 : size >= 4 ? 2 : 1;
	// The First Four: four more teams, so 68 for a 64-team bracket
	const numPlayIn = firstFour && size === 64 ? FIRST_FOUR_GAMES : 0;
	const fieldSize = size + numPlayIn;

	const bySel = [...net].sort((a, b) => b.sel - a.sel || a.rank - b.rank);
	const champions = new Set(
		(state.confTournaments ?? [])
			.map((t) => t.champion)
			.filter((tid): tid is number => tid !== undefined),
	);
	// More conferences than spots (should not happen): the best champions
	const autos = bySel
		.filter((row) => champions.has(row.tid))
		.slice(0, fieldSize);
	const autoTids = new Set(autos.map((row) => row.tid));
	const pool = bySel.filter((row) => !autoTids.has(row.tid));
	const atLarge = pool.slice(0, fieldSize - autos.length);
	const out = pool.slice(atLarge.length);

	// Bracket entries: a team, or a First Four pair (seeded as its better team). The play-in pairs are the four lowest at-large teams
	// and the four lowest automatic qualifiers
	type Entry = { rows: CollegeNetRow[]; sel: number; rank: number };
	const playInAuto =
		numPlayIn > 0 && autos.length >= 4 && atLarge.length >= 4
			? autos.slice(-4)
			: [];
	const playInAtLarge = playInAuto.length > 0 ? atLarge.slice(-4) : [];
	const playIn = new Set([...playInAuto, ...playInAtLarge].map((r) => r.tid));
	const entries: Entry[] = [...autos, ...atLarge]
		.filter((row) => !playIn.has(row.tid))
		.map((row) => ({ rows: [row], sel: row.sel, rank: row.rank }));
	for (const group of [playInAtLarge, playInAuto]) {
		for (let i = 0; i + 1 < group.length; i += 2) {
			const rows = [group[i]!, group[i + 1]!];
			entries.push({ rows, sel: rows[0]!.sel, rank: rows[0]!.rank });
		}
	}
	// A field that is still too big (play-in impossible): cut the worst
	entries.sort((a, b) => b.sel - a.sel || a.rank - b.rank);
	entries.length = Math.min(entries.length, size);

	const field: CollegeFieldTeam[] = [];
	let numPairs = 0;
	for (const [i, entry] of entries.entries()) {
		const line = Math.floor(i / numRegions);
		const pair = entry.rows.length > 1 ? numPairs++ : undefined;
		for (const row of entry.rows) {
			field.push({
				tid: row.tid,
				seed: line + 1,
				region: regionOfLine(line, i % numRegions, numRegions),
				bid: autoTids.has(row.tid) ? "auto" : "at-large",
				overall: 0,
				...(pair !== undefined ? { firstFour: pair } : {}),
			});
		}
	}
	for (const [i, t] of field.entries()) {
		t.overall = i + 1;
	}

	return {
		field,
		lastFourIn: atLarge.slice(-4).map((row) => row.tid),
		firstFourOut: out.slice(0, 4).map((row) => row.tid),
		nextFourOut: out.slice(4, 8).map((row) => row.tid),
		net,
	};
};

export const FIRST_FOUR_GAMES = 4;

export const useFirstFour = () => !!g.get("collegeFirstFour");

// The First Four games of a selection (better committee score is the home team, on a neutral court)
export const makeFirstFour = (
	selection: CollegeSelection,
): CollegeFirstFourGame[] => {
	const games: CollegeFirstFourGame[] = [];
	for (const t of selection.field) {
		if (t.firstFour === undefined) {
			continue;
		}
		const game = games[t.firstFour];
		if (!game) {
			games[t.firstFour] = {
				home: t.tid,
				away: -1,
				seed: t.seed,
				region: t.region,
				bid: t.bid,
			};
		} else {
			game.away = t.tid;
		}
	}
	return games.filter((game) => game.away >= 0);
};

const logFirstFour = async (games: CollegeFirstFourGame[]) => {
	const userTid = g.get("userTid");
	const teamInfoCache = g.get("teamInfoCache");
	for (const game of games) {
		if (game.home === userTid || game.away === userTid) {
			const other = game.home === userTid ? game.away : game.home;
			await logEvent({
				type: "info",
				text: `Your team is in the First Four: a play-in game against ${teamInfoCache[other]?.region} for a ${game.seed} seed. <a href="${helpers.leagueUrl(["college_polls"])}">Selection</a>`,
				showNotification: true,
				saveToDb: false,
			});
		}
	}
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

	// With the First Four, Selection was made when the conference tournaments ended
	const selection =
		state.firstFour && state.selection
			? state.selection
			: makeSelection(
					state,
					teams.map((t) => t.tid),
				);
	state.selection = selection;
	// First Four losers are out of the bracket
	const ffLosers = new Set<number>();
	for (const game of state.firstFour ?? []) {
		if (!game.pts) {
			// Not played (should not happen): the better seed goes through
			game.pts = [1, 0];
		}
		ffLosers.add(game.pts[0] > game.pts[1] ? game.away : game.home);
	}
	const bracketField = selection.field.filter((t) => !ffLosers.has(t.tid));
	state.nit = makeNit(state, teams, selection);
	state = await saveCollegeState(state);

	const numRounds = g.get("numGamesPlayoffSeries", "current").length;
	const series: PlayoffSeries["series"] = Array.from(
		{ length: numRounds },
		() => [],
	);
	const numRegions = Math.max(...bracketField.map((t) => t.region)) + 1;
	const perRegion = bracketField.length / numRegions;
	const order = seedOrder(perRegion);
	for (let region = 0; region < numRegions; region++) {
		const bySeed = new Map(
			bracketField.filter((t) => t.region === region).map((t) => [t.seed, t]),
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
	for (const t of bracketField) {
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
	if (state.nit) {
		const nitUrl = helpers.leagueUrl(["college_nit"]);
		for (const tid of state.nit.seeds) {
			if (tid === userTid && !g.get("spectator")) {
				logEvent(
					{
						type: "info",
						text: `Your team was invited to the <a href="${nitUrl}">NIT</a> as the No. ${state.nit.seeds.indexOf(tid) + 1} seed${state.nit.autoBids.includes(tid) ? " (automatic bid as regular season conference champion)" : ""}.`,
						showNotification: true,
						saveToDb: false,
					},
					conditions,
				);
			}
		}
	}
	if (ffLosers.has(userTid) && !g.get("spectator")) {
		logEvent(
			{
				type: "info",
				text: "Your team lost in the First Four.",
				showNotification: true,
				saveToDb: false,
			},
			conditions,
		);
	} else if (
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

	await recruitingWeek(conditions);

	return {
		byConf: false as const,
		playIns: undefined,
		series,
		tidPlayIn: [] as number[],
		tidPlayoffs: bracketField.map((t) => t.tid),
	};
};

// ---- NIT ----

export const useNit = () =>
	nativeFeatureEnabled("collegeNit", (key) => g.get(key as any));

// Size of the NIT next to a national tournament of this size: half of it, as long as there are enough teams left
export const getNitSize = (numTeams: number, nationalSize: number) => {
	const size = nationalSize >= 64 ? 32 : 16;
	return numTeams - nationalSize - 4 >= size + 8 ? size : 0;
};

/**
 * The NIT field, when the national tournament starts: regular season conference champions who lost their tournament and were not
 * selected get automatic bids, the best of the rest (committee score) fill it. One bracket, better seed at home.
 */
export const makeNit = (
	state: CollegeState,
	teams: { tid: number }[],
	selection: CollegeSelection,
): CollegeNit | undefined => {
	if (!useNit()) {
		return undefined;
	}
	const nationalSize = 2 ** g.get("numGamesPlayoffSeries", "current").length;
	const size = getNitSize(teams.length, nationalSize);
	if (size < 4) {
		return undefined;
	}
	const inField = new Set(selection.field.map((t) => t.tid));
	const bySel = [...selection.net]
		.filter((row) => !inField.has(row.tid))
		.sort((a, b) => b.sel - a.sel || a.rank - b.rank);
	// Regular season champion: the 1 seed of the conference tournament (seeded by conference record)
	const regChamps = new Set(
		(state.confTournaments ?? [])
			.filter((t) => t.seeds[0] !== undefined && t.champion !== t.seeds[0])
			.map((t) => t.seeds[0]!),
	);
	const autos = bySel.filter((row) => regChamps.has(row.tid)).slice(0, size);
	const autoTids = new Set(autos.map((row) => row.tid));
	const rest = bySel
		.filter((row) => !autoTids.has(row.tid))
		.slice(0, size - autos.length);
	const seeds = [...autos, ...rest]
		.sort((a, b) => b.sel - a.sel || a.rank - b.rank)
		.map((row) => row.tid);

	const order = seedOrder(size);
	const first: CollegeConfMatchup[] = [];
	for (let i = 0; i < size; i += 2) {
		const s1 = Math.min(order[i]!, order[i + 1]!);
		const s2 = Math.max(order[i]!, order[i + 1]!);
		first.push({
			home: seeds[s1 - 1]!,
			away: seeds[s2 - 1]!,
			seedHome: s1,
			seedAway: s2,
		});
	}
	const rounds: CollegeConfMatchup[][] = [first];
	for (let rnd = 1; rnd < Math.log2(size); rnd++) {
		rounds.push(Array.from({ length: size / 2 ** (rnd + 1) }, () => byeSlot()));
	}
	return { cid: -1, seeds, rounds, autoBids: [...autoTids] };
};

/**
 * NIT games to play with round rnd of the national tournament (round k of the NIT goes with round k of the national tournament, so it
 * ends before it).
 */
export const getNitGames = (rnd: number): [number, number][] => {
	const state = getCollegeState();
	const round = state?.nit?.rounds[rnd];
	if (!round) {
		return [];
	}
	return round
		.filter((m) => m.home >= 0 && m.away >= 0 && !m.pts)
		.map((m) => [m.home, m.away]);
};

/**
 * After a day of the national tournament: NIT scores, the bracket, the champion.
 */
export const afterNitGames = async (
	state: CollegeState,
	results: GameResults[],
) => {
	const nit = state.nit;
	if (!nit || nit.champion !== undefined) {
		return;
	}
	setScores(nit.rounds.flat(), results);
	advanceBracket(nit);
	if (nit.champion !== undefined) {
		const info = g.get("teamInfoCache")[nit.champion];
		await logEvent({
			type: "playoffs",
			text: `<a href="${helpers.leagueUrl([
				"roster",
				`${info?.abbrev}_${nit.champion}`,
				g.get("season"),
			])}">${info?.region}</a> won the <a href="${helpers.leagueUrl(["college_nit", g.get("season")])}">NIT</a>.`,
			showNotification: nit.champion === g.get("userTid"),
			tids: [nit.champion],
			score: 10,
		});
	}
};

/**
 * Finish an NIT that is somehow still going when the national tournament ends: the better seed wins.
 */
export const finishNit = (state: CollegeState) => {
	const nit = state.nit;
	if (!nit) {
		return;
	}
	for (let i = 0; i < nit.rounds.length && nit.champion === undefined; i++) {
		for (const m of nit.rounds[i]!) {
			if (m.home >= 0 && m.away >= 0 && !m.pts) {
				m.pts = [1, 0];
			}
		}
		advanceBracket(nit);
	}
};
