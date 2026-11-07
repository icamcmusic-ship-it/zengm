import { idb } from "../db/index.ts";
import { g } from "./index.ts";
import { getSeasonState } from "./processInputs.ts";
import { isCurrentSeasonComplete } from "../../common/seasons.ts";
import type {
	WAward,
	WBoxLine,
	WGame,
	WLeague,
	WPlayer,
	WStat,
	WTeamSeason,
} from "../../common/wrapped/types.ts";
import { LeagueIndex } from "../../common/wrapped/league.ts";
import type { PlayerAward, UpdateEvent } from "../../common/types.ts";

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

// A stat the database may not have recorded
const opt = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : undefined;

const toStat = (r: any): WStat => ({
	season: r.season,
	tid: r.tid,
	gp: n(r.gp),
	gs: n(r.gs),
	min: n(r.min),
	pts: n(r.pts),
	trb: n(r.orb) + n(r.drb),
	ast: n(r.ast),
	stl: n(r.stl),
	blk: n(r.blk),
	tov: n(r.tov),
	tp: n(r.tp),
	tpa: n(r.tpa),
	fg: n(r.fg),
	fga: n(r.fga),
	ft: n(r.ft),
	fta: n(r.fta),
	per: n(r.per),
	ws: n(r.ows) + n(r.dws),
	bpm: n(r.obpm) + n(r.dbpm),
	vorp: n(r.vorp),
	orb: opt(r.orb),
	drb: opt(r.drb),
	pf: opt(r.pf),
	pm: opt(r.pm),
	ortg: opt(r.ortg),
	drtg: opt(r.drtg),
	usgp: opt(r.usgp),
	ows: opt(r.ows),
	dws: opt(r.dws),
	dd: opt(r.dd),
	td: opt(r.td),
	ptsMax: opt(r.ptsMax),
	trbMax: opt(r.trbMax),
	astMax: opt(r.astMax),
	stlMax: opt(r.stlMax),
	blkMax: opt(r.blkMax),
	tpMax: opt(r.tpMax),
});

const toBox = (p: any): WBoxLine => ({
	pid: p.pid,
	name: p.name,
	min: n(p.min),
	pts: n(p.pts),
	trb: n(p.orb) + n(p.drb),
	ast: n(p.ast),
	stl: n(p.stl),
	blk: n(p.blk),
	tp: n(p.tp),
	tpa: opt(p.tpa),
	fg: opt(p.fg),
	fga: opt(p.fga),
	ft: opt(p.ft),
	fta: opt(p.fta),
	tov: opt(p.tov),
	orb: opt(p.orb),
	drb: opt(p.drb),
	pf: opt(p.pf),
	pm: opt(p.pm),
});

const TEAM_ORD = ["First", "Second", "Third", "Fourth", "Fifth"];

// Awards are either simple {season, type} or built-in {season, name, rank, numTeams}. Built-in individual awards only count for the winner (rank 1); team awards become "First Team All-League" and the like.
const awardOf = (a: PlayerAward): WAward[] => {
	if (a.type !== undefined) {
		return [{ season: a.season, type: a.type }];
	}
	if (a.numTeams === undefined) {
		if (a.rank !== 1) {
			return [];
		}
		const type = a.actAs === "mvp" ? "Most Valuable Player" : a.name;
		return [{ season: a.season, type }];
	}
	const ord = TEAM_ORD[a.rank - 1];
	return [
		{
			season: a.season,
			type: a.numTeams > 1 && ord ? `${ord} Team ${a.name}` : a.name,
		},
	];
};

// Read the whole league into the plain snapshot the Wrapped and Storylines engines use
export const loadWrappedLeague = async (): Promise<WLeague> => {
	const currentSeason = g.get("season");
	const playersRaw = await idb.merged.players.getAll({
		activeAndRetired: true,
	});
	const players: WPlayer[] = playersRaw.map((p) => ({
		pid: p.pid,
		name: `${p.firstName} ${p.lastName}`.trim(),
		firstName: p.firstName,
		lastName: p.lastName,
		bornYear: p.born.year,
		bornLoc: p.born.loc,
		college: p.college,
		draft: {
			year: p.draft.year,
			round: p.draft.round,
			pick: p.draft.pick,
			tid: p.draft.tid,
		},
		tid: p.tid,
		retiredYear: p.retiredYear,
		diedYear: p.diedYear,
		hof: !!p.hof,
		awards: p.awards.flatMap(awardOf),
		stats: p.stats.filter((r) => !r.playoffs).map(toStat),
		po: p.stats.filter((r) => r.playoffs).map(toStat),
		injuries: p.injuries.map((i) => ({
			season: i.season,
			games: i.games,
			type: i.type,
		})),
		ovr: Object.fromEntries(p.ratings.map((r) => [r.season, r.ovr])),
		moves: (p.transactions ?? []).map((t) => ({
			season: t.season,
			tid: t.tid,
			type: t.type,
			fromTid: "fromTid" in t ? t.fromTid : undefined,
		})),
		relatives: p.relatives.map((r) => ({ type: r.type, pid: r.pid })),
		pot: Object.fromEntries(p.ratings.map((r) => [r.season, r.pot])),
		pos: Object.fromEntries(p.ratings.map((r) => [r.season, r.pos])),
		hgt: p.ratings.at(-1)?.hgt,
		paid: (p.contracts ?? []).flatMap((c) =>
			(c.payments ?? []).map((x) => ({
				season: x.season,
				tid: x.tid,
				amount: x.amount,
			})),
		),
		draftOvr: p.draft.ovr,
		draftPot: p.draft.pot,
		jersey: p.stats.findLast((r) => r.jerseyNumber)?.jerseyNumber,
	}));

	const teamSeasonsRaw = await idb.merged.teamSeasons.getAll();
	const tids = [...new Set(teamSeasonsRaw.map((ts) => ts.tid))];
	const statsByKey = new Map<
		string,
		{ gp: number; pts: number; oppPts: number }
	>();
	for (const tid of tids) {
		const rows = await idb.merged.teamStats.getAll({ tid });
		for (const r of rows) {
			if (r.playoffs) {
				continue;
			}
			statsByKey.set(`${tid}|${r.season}`, {
				gp: n(r.gp),
				pts: n(r.pts),
				oppPts: n(r.oppPts),
			});
		}
	}

	const series = await idb.merged.playoffSeries.getAll();
	const seedOf = new Map<string, number>();
	for (const ps of series) {
		for (const m of ps.series[0] ?? []) {
			seedOf.set(`${m.home.tid}|${ps.season}`, m.home.seed);
			if (m.away) {
				seedOf.set(`${m.away.tid}|${ps.season}`, m.away.seed);
			}
		}
	}

	const teamSeasons: WTeamSeason[] = teamSeasonsRaw
		.filter((ts) => ts.season <= currentSeason)
		.map((ts) => {
			const st = statsByKey.get(`${ts.tid}|${ts.season}`);
			return {
				tid: ts.tid,
				season: ts.season,
				abbrev: ts.abbrev,
				region: ts.region,
				name: ts.name,
				colors: ts.colors,
				imgURL: ts.imgURL,
				won: ts.won,
				lost: ts.lost,
				tied: ts.tied ?? 0,
				otl: ts.otl ?? 0,
				playoffRoundsWon: ts.playoffRoundsWon,
				seed: seedOf.get(`${ts.tid}|${ts.season}`),
				gp: st?.gp ?? 0,
				pts: st?.pts ?? 0,
				oppPts: st?.oppPts ?? 0,
				cid: ts.cid,
				did: ts.did,
				wonHome: ts.wonHome,
				lostHome: ts.lostHome,
				wonAway: ts.wonAway,
				lostAway: ts.lostAway,
				wonDiv: ts.wonDiv,
				lostDiv: ts.lostDiv,
				wonConf: ts.wonConf,
				lostConf: ts.lostConf,
				gpHome: ts.gpHome,
				att: ts.att,
				payroll: ts.payrollEndOfSeason,
				hype: ts.hype,
				pop: ts.pop,
				streak: ts.streak,
				numPlayersTradedAway: ts.numPlayersTradedAway,
			};
		});

	const numPlayoffRounds: Record<number, number> = {};
	for (const ts of teamSeasons) {
		if (numPlayoffRounds[ts.season] === undefined) {
			numPlayoffRounds[ts.season] = g.get(
				"numGamesPlayoffSeries",
				ts.season,
			).length;
		}
	}

	const gamesRaw = await idb.merged.games.getAll();
	const games: WGame[] = gamesRaw
		.filter((gm) => gm.teams.length === 2)
		.map((gm) => ({
			gid: gm.gid,
			season: gm.season,
			day: gm.day ?? 0,
			playoffs: !!gm.playoffs,
			overtimes: gm.overtimes ?? 0,
			att: opt(gm.att),
			teams: [
				{
					tid: gm.teams[0].tid,
					pts: gm.teams[0].pts,
					players: gm.teams[0].players.map(toBox),
					ptsQtrs: gm.teams[0].ptsQtrs,
				},
				{
					tid: gm.teams[1].tid,
					pts: gm.teams[1].pts,
					players: gm.teams[1].players.map(toBox),
					ptsQtrs: gm.teams[1].ptsQtrs,
				},
			],
		}));

	return {
		startingSeason: g.get("startingSeason"),
		season: currentSeason,
		currentComplete: isCurrentSeasonComplete(getSeasonState()),
		userTid: g.get("userTid"),
		numPlayoffRounds,
		teamSeasons,
		players,
		series: series.map((ps) => ({
			season: ps.season,
			rounds: ps.series.map((round) =>
				round.map((m) => ({
					home: { tid: m.home.tid, seed: m.home.seed, won: m.home.won },
					away: m.away
						? { tid: m.away.tid, seed: m.away.seed, won: m.away.won }
						: undefined,
				})),
			),
		})),
		games,
		confs: g.get("confs").map((c) => ({ cid: c.cid, name: c.name })),
		divs: g.get("divs").map((d) => ({ did: d.did, cid: d.cid, name: d.name })),
	};
};

// One snapshot at a time, rebuilt when the league changes
let cached: { key: string; X: Promise<LeagueIndex> } | undefined;

const STALE: UpdateEvent[] = [
	"firstRun",
	"gameSim",
	"playerMovement",
	"newPhase",
	"gameAttributes",
	"teamFinances",
];

export const getWrappedIndex = (updateEvents: ReadonlySet<UpdateEvent>) => {
	const key = `${g.get("lid")}|${g.get("season")}|${g.get("phase")}`;
	if (!cached || cached.key !== key || STALE.some((e) => updateEvents.has(e))) {
		cached = { key, X: loadWrappedLeague().then((L) => new LeagueIndex(L)) };
	}
	return cached.X;
};
