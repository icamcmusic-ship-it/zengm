// GM profile page (/gm/:gmid) and GM History's "you vs each AI GM": career, tenures, Executive of the Year wins, notable trades, and
// the user's head-to-head record and trades against the teams each AI GM ran.

import { PHASE } from "../../../common/constants.ts";
import { EXEC_OF_THE_YEAR } from "../../../common/coachExecAwards.ts";
import type {
	EventBBGM,
	Gm,
	HeadToHead,
	Team,
	TeamSeason,
} from "../../../common/types.ts";
import { idb } from "../../db/index.ts";
import { NUM_PRIOR_SEASONS_EVENTS } from "../../db/Cache.ts";
import { g, local } from "../../util/index.ts";

const allGms = (teams: Team[]) => {
	const out: Gm[] = [];
	for (const t of teams) {
		if (t.gm) {
			out.push(t.gm);
		}
		out.push(...(t.formerGms ?? []));
	}
	return out;
};

export const findGm = async (gmid: number) => {
	const teams = await idb.cache.teams.getAll();
	return allGms(teams).find((gm) => gm.gmid === gmid);
};

// The season a transaction counts for: offseason moves belong to the next season's front office (GMs are hired after the playoffs)
const effectiveSeason = (season: number, phase: number | undefined) =>
	phase !== undefined && phase > PHASE.PLAYOFFS ? season + 1 : season;

const ranTeam = (gm: Gm, tid: number, season: number) =>
	gm.tenures.some(
		(x) => x.tid === tid && x.start <= season && (x.end ?? Infinity) >= season,
	);

type TradeEvent = Extract<EventBBGM, { type: "trade" }>;

const isTrade = (event: EventBBGM): event is TradeEvent =>
	event.type === "trade";

// Trade events and head-to-head records of past seasons, as the database has them: read once per league connection, cache fill and
// season, instead of the whole event log on every load (GM History reloads after every simulated day). Only trade events are kept
type PastData = {
	key: string;
	league: unknown;
	trades: TradeEvent[];
	headToHeads: HeadToHead[];
};
let pastData: PastData | undefined;

const getPastData = async (): Promise<PastData> => {
	const season = g.get("season");
	const key = `${idb.cache.fillCount}|${season}`;
	if (pastData?.league === idb.league && pastData.key === key) {
		return pastData;
	}
	// The cache holds this season's events and NUM_PRIOR_SEASONS_EVENTS before it
	const cutoff = season - NUM_PRIOR_SEASONS_EVENTS - 1;
	const trades: TradeEvent[] = [];
	for await (const cursor of idb.league
		.transaction("events")
		.store.index("season")
		.iterate(IDBKeyRange.upperBound(cutoff))) {
		if (isTrade(cursor.value)) {
			trades.push(cursor.value);
		}
	}
	const headToHeads: HeadToHead[] = [];
	for await (const { value } of idb.league
		.transaction("headToHeads")
		.store.iterate()) {
		if (value.season < season) {
			headToHeads.push(value);
		}
	}
	pastData = { key, league: idb.league, trades, headToHeads };
	return pastData;
};

const tradeEvents = async () => {
	const byEid = new Map<number, TradeEvent>();
	for (const event of (await getPastData()).trades) {
		byEid.set(event.eid, event);
	}
	// The cache wins for an event in both (it can hold older seasons too, with auto save off)
	for (const event of await idb.cache.events.getAll()) {
		if (isTrade(event)) {
			byEid.set(event.eid, event);
		}
	}
	return [...byEid.values()];
};

const teamName = (tid: number, season: number, teamSeasons: TeamSeason[]) => {
	const ts = teamSeasons.find((x) => x.tid === tid && x.season === season);
	const info = g.get("teamInfoCache")[tid];
	return {
		abbrev: ts?.abbrev ?? info?.abbrev ?? "???",
		name: ts
			? `${ts.region} ${ts.name}`
			: info
				? `${info.region} ${info.name}`
				: "Unknown",
	};
};

// What each side got, in a few words
const tradeAssets = (event: TradeEvent, side: 0 | 1) =>
	(event.teams?.[side]?.assets ?? []).map((a) =>
		"pid" in a
			? a.name
			: `${typeof a.season === "number" ? a.season : "future"} ${a.round === 1 ? "1st" : a.round === 2 ? "2nd" : `${a.round}th`} round pick${a.swap ? " swap" : ""}`,
	);

export const getGmProfile = async (gmid: number) => {
	const gm = await findGm(gmid);
	if (!gm) {
		return undefined;
	}
	const teams = await idb.cache.teams.getAll();
	const tids = [...new Set(gm.tenures.map((x) => x.tid))];
	const teamSeasons = (
		await Promise.all(tids.map((tid) => idb.merged.teamSeasons.getAll({ tid })))
	).flat();

	const numRounds = (season: number) =>
		g.get("numGamesPlayoffSeries", season).length;
	const seasons = gm.seasons
		.toSorted((a, b) => a.season - b.season)
		.map((row) => ({
			season: row.season,
			tid: row.tid,
			abbrev: teamName(row.tid, row.season, teamSeasons).abbrev,
			won: row.won,
			lost: row.lost,
			tied: row.tied,
			otl: row.otl,
			expWon:
				row.expWon !== undefined ? Math.round(row.expWon * 10) / 10 : undefined,
			playoffRoundsWon: row.playoffRoundsWon,
			numRounds: numRounds(row.season),
			partial: row.partial,
			exec: (gm.awards ?? []).some(
				(a) => a.type === EXEC_OF_THE_YEAR && a.season === row.season,
			),
		}));

	const isTitle = (season: number, playoffRoundsWon: number) =>
		playoffRoundsWon >= 0 && playoffRoundsWon >= numRounds(season);
	// A retired GM's season rows are folded into career totals (and, since then, into each tenure's record). One retired before that
	// has neither: his tenures' records come from the team seasons
	const legacyRetired = gm.retiredYear !== undefined && gm.seasons.length === 0;
	const tenures = gm.tenures.map((x) => {
		const rows: {
			won: number;
			lost: number;
			playoffs: number;
			titles: number;
		}[] = gm.seasons
			.filter(
				(row) =>
					row.tid === x.tid &&
					row.season >= x.start &&
					row.season <= (x.end ?? Infinity),
			)
			.map((row) => ({
				won: row.won,
				lost: row.lost,
				playoffs: row.playoffRoundsWon >= 0 ? 1 : 0,
				titles: isTitle(row.season, row.playoffRoundsWon) ? 1 : 0,
			}));
		if (x.record) {
			rows.push(x.record);
		} else if (legacyRetired) {
			for (const ts of teamSeasons) {
				if (
					ts.tid === x.tid &&
					ts.season >= x.start &&
					ts.season <= (x.end ?? Infinity)
				) {
					rows.push({
						won: ts.won,
						lost: ts.lost,
						playoffs: ts.playoffRoundsWon >= 0 ? 1 : 0,
						titles: isTitle(ts.season, ts.playoffRoundsWon) ? 1 : 0,
					});
				}
			}
		}
		const info = teamName(x.tid, x.end ?? g.get("season"), teamSeasons);
		return {
			tid: x.tid,
			abbrev: info.abbrev,
			name: info.name,
			start: x.start,
			end: x.end,
			reason: x.reason,
			won: rows.reduce((sum, row) => sum + row.won, 0),
			lost: rows.reduce((sum, row) => sum + row.lost, 0),
			playoffs: rows.reduce((sum, row) => sum + row.playoffs, 0),
			titles: rows.reduce((sum, row) => sum + row.titles, 0),
		};
	});

	// Notable trades: the biggest (event score) his teams made while he ran them
	const userTidsBySeason = await userTeamsBySeason();
	const trades = (await tradeEvents())
		.map((event) => {
			const eff = effectiveSeason(event.season, event.phase);
			const side = event.tids.findIndex((tid) => ranTeam(gm, tid, eff));
			if (side < 0) {
				return undefined;
			}
			const other = event.tids[side === 0 ? 1 : 0];
			return {
				eid: event.eid,
				season: event.season,
				score: event.score ?? 0,
				tid: event.tids[side]!,
				otherTid: other,
				otherAbbrev: teamName(other, event.season, teamSeasons).abbrev,
				withUser:
					(
						userTidsBySeason.get(eff) ?? userTidsBySeason.get(event.season)
					)?.has(other) ?? false,
				got: tradeAssets(event, side as 0 | 1),
				gave: tradeAssets(event, side === 0 ? 1 : 0),
			};
		})
		.filter((x) => x !== undefined);
	const notableTrades = trades
		.toSorted((a, b) => b.score - a.score || b.season - a.season)
		.slice(0, 8);

	const tenure = gm.tenures.at(-1);
	const current = teams.find((t) => t.gm?.gmid === gmid);
	return {
		gmid: gm.gmid,
		name: `${gm.firstName} ${gm.lastName}`,
		age: g.get("season") - gm.born.year,
		born: gm.born,
		face: gm.face,
		traits: gm.traits,
		retiredYear: gm.retiredYear,
		currentTid: current?.tid,
		status: current
			? "employed"
			: gm.retiredYear !== undefined
				? "retired"
				: tenure?.end !== undefined
					? "available"
					: "unknown",
		seasons,
		// Retired GMs' season rows are folded into career totals
		career: gm.career,
		tenures,
		execAwards: (gm.awards ?? [])
			.filter((a) => a.type === EXEC_OF_THE_YEAR)
			.map((a) => a.season)
			.sort((a, b) => a - b),
		hof: gm.hof,
		numTrades: trades.length,
		notableTrades,
	};
};

// ---- You vs the AI GMs --------------------------------------------------------

// The teams the user runs now: none while the AI runs them (spectator mode, auto play)
const currentUserTids = () =>
	g.get("spectator") || local.autoPlayUntil ? [] : g.get("userTids");

// The teams the user ran in each season, like GM History: TeamSeason.userControl, else for this season before its regular season the
// teams he runs now, else the season's user team. In the offseason, next season's (which offseason moves count for) are the teams he
// runs now too
const userTeamsBySeason = async () => {
	const out = new Map<number, Set<number>>();
	const current = g.get("season");
	for (let season = g.get("startingSeason"); season <= current; season++) {
		const all = await idb.merged.teamSeasons.getAll({ season });
		let tids: number[];
		if (all.some((ts) => ts.userControl !== undefined)) {
			tids = all.filter((ts) => ts.userControl === "user").map((ts) => ts.tid);
		} else if (season === current) {
			tids = currentUserTids();
		} else {
			tids = [g.get("userTid", season)];
		}
		out.set(season, new Set(tids));
	}
	if (g.get("phase") > PHASE.PLAYOFFS) {
		out.set(current + 1, new Set(currentUserTids()));
	}
	return out;
};

// a's record against b. Rows are stored once per pair, under the lower tid, from its side (otl: its overtime losses, otw: its overtime wins)
const h2hRecord = (h2h: HeadToHead, a: number, b: number) => {
	const first = a < b;
	const reg = first ? h2h.regularSeason[a]?.[b] : h2h.regularSeason[b]?.[a];
	const po = first ? h2h.playoffs[a]?.[b] : h2h.playoffs[b]?.[a];
	if (!reg && !po) {
		return undefined;
	}
	return {
		won: reg ? (first ? reg.won : reg.lost + reg.otl) : 0,
		lost: reg ? (first ? reg.lost + reg.otl : reg.won) : 0,
		tied: reg?.tied ?? 0,
		playoffWon: po ? (first ? po.won : po.lost) : 0,
		playoffLost: po ? (first ? po.lost : po.won) : 0,
	};
};

// Every season's head-to-head records (past seasons from the database, this one from the cache)
const headToHeads = async () => {
	const out = new Map<number, HeadToHead>();
	const currentSeason = g.get("season");
	for (const value of (await getPastData()).headToHeads) {
		out.set(value.season, value);
	}
	const current = await idb.cache.headToHeads.get(currentSeason);
	if (current) {
		out.set(currentSeason, current);
	}
	return out;
};

export type UserVsGm = {
	gmid: number;
	name: string;
	current: boolean;
	abbrevs: string[];
	won: number;
	lost: number;
	tied: number;
	playoffWon: number;
	playoffLost: number;
	trades: { eid: number; season: number; got: string[]; gave: string[] }[];
};

export const getUserVsGms = async (): Promise<UserVsGm[]> => {
	const teams = await idb.cache.teams.getAll();
	const gms = allGms(teams);
	if (gms.length === 0) {
		return [];
	}
	const userBySeason = await userTeamsBySeason();
	const byGmid = new Map<number, UserVsGm>();
	const rowOf = (gm: Gm) => {
		let row = byGmid.get(gm.gmid);
		if (!row) {
			row = {
				gmid: gm.gmid,
				name: `${gm.firstName} ${gm.lastName}`,
				current: teams.some((t) => t.gm?.gmid === gm.gmid),
				abbrevs: [],
				won: 0,
				lost: 0,
				tied: 0,
				playoffWon: 0,
				playoffLost: 0,
				trades: [],
			};
			byGmid.set(gm.gmid, row);
		}
		return row;
	};
	const gmOf = (tid: number, season: number) =>
		gms.find((gm) => ranTeam(gm, tid, season));
	const addAbbrev = (row: UserVsGm, tid: number) => {
		const abbrev = g.get("teamInfoCache")[tid]?.abbrev;
		if (abbrev && !row.abbrevs.includes(abbrev)) {
			row.abbrevs.push(abbrev);
		}
	};

	const allH2h = await headToHeads();
	for (const [season, userTids] of userBySeason) {
		const h2h = allH2h.get(season);
		if (!h2h) {
			continue;
		}
		for (const u of userTids) {
			for (const t of teams) {
				if (userTids.has(t.tid)) {
					continue;
				}
				const gm = gmOf(t.tid, season);
				if (!gm) {
					continue;
				}
				const rec = h2hRecord(h2h, u, t.tid);
				if (!rec) {
					continue;
				}
				const row = rowOf(gm);
				addAbbrev(row, t.tid);
				row.won += rec.won;
				row.lost += rec.lost;
				row.tied += rec.tied;
				row.playoffWon += rec.playoffWon;
				row.playoffLost += rec.playoffLost;
			}
		}
	}

	for (const event of await tradeEvents()) {
		const eff = effectiveSeason(event.season, event.phase);
		const userTids = userBySeason.get(eff) ?? userBySeason.get(event.season);
		if (!userTids) {
			continue;
		}
		const userSide = event.tids.findIndex((tid) => userTids.has(tid));
		if (userSide < 0) {
			continue;
		}
		const other = event.tids[userSide === 0 ? 1 : 0];
		const gm = gmOf(other, eff);
		if (!gm) {
			continue;
		}
		const row = rowOf(gm);
		addAbbrev(row, other);
		row.trades.push({
			eid: event.eid,
			season: event.season,
			got: tradeAssets(event, userSide as 0 | 1),
			gave: tradeAssets(event, userSide === 0 ? 1 : 0),
		});
	}

	return [...byGmid.values()]
		.map((row) => ({
			...row,
			trades: row.trades.toSorted((a, b) => b.season - a.season),
		}))
		.sort(
			(a, b) =>
				b.won +
				b.lost +
				b.trades.length * 5 -
				(a.won + a.lost + a.trades.length * 5),
		);
};
