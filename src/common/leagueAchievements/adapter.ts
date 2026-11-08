import type {
	WGame,
	WLeague,
	WPlayer,
	WStat,
	WTeamSeason,
} from "../wrapped/types.ts";

// The League achievements engine (engine.generated.ts) was written for the League Explorer, which reads a BBGM league export and slims it (the Explorer's model.js). This builds the same shape from BBGM's live data: the Wrapped/Storylines snapshot (WLeague, which is cached and kept up to date incrementally) plus a few small stores the snapshot doesn't hold (AExtras). Only what the engine reads is kept.
//
// A value the database doesn't have stays undefined (the engine then treats it as unknown), never 0.

// Same order as RATING_SKILLS in worker/util/wrappedData.ts
const RATING_SKILLS = [
	"hgt",
	"stre",
	"spd",
	"jmp",
	"endu",
	"ins",
	"dnk",
	"ft",
	"fg",
	"tp",
	"oiq",
	"diq",
	"drb",
	"pss",
	"reb",
] as const;

const num = (x: unknown) =>
	typeof x === "number" && Number.isFinite(x) ? x : 0;

// A stat row: the stat keys are numbers, missing when not recorded
export type AStat = {
	season: number;
	tid: number;
	playoffs: boolean;
	jersey?: string;
	[key: string]: number | boolean | string | undefined;
};

export type ARating = {
	season: number;
	ovr: number;
	pot: number;
	pos: string;
} & Partial<Record<(typeof RATING_SKILLS)[number], number>>;

export type APlayer = {
	pid: number;
	name: string;
	fn: string;
	ln: string;
	tid: number;
	born: { year: number; loc: string };
	country: string;
	college: string;
	// Inches and pounds
	hgt?: number;
	weight?: number;
	pos: string;
	draft: {
		year: number;
		round: number;
		pick: number;
		tid: number;
		ovr: number;
		pot: number;
	};
	retiredYear: number | null;
	diedYear: number | null;
	hof: boolean;
	relatives: { type: string; pid: number }[];
	injuries: { season: number; games: number; type: string }[];
	ratings: ARating[];
	stats: AStat[];
	salaries: { season: number; amount: number }[];
};

export type ATeamSeason = {
	season: number;
	won: number;
	lost: number;
	tied: number;
	otl: number;
	gp: number;
	winp: number;
	playoffRoundsWon: number;
	region: string;
	name: string;
	abbrev: string;
	cid?: number;
	did?: number;
	wonHome: number;
	lostHome: number;
	tiedHome: number;
	wonAway: number;
	lostAway: number;
	tiedAway: number;
	wonConf: number;
	lostConf: number;
	wonDiv: number;
	lostDiv: number;
	att: number;
	gpHome: number;
	pop: number;
	hype: number;
	streak: number;
	payroll: number;
	luxuryTax: number;
};

export type ATeam = {
	tid: number;
	abbrev: string;
	region: string;
	name: string;
	retiredJerseys: {
		number: string;
		seasonRetired: number;
		pid: number | null;
	}[];
	seasons: ATeamSeason[];
};

export type ABoxLine = {
	pid: number;
	name: string;
	min: number;
	pts: number;
	trb: number;
	ast: number;
	stl: number;
	blk: number;
	tov: number;
	fg: number;
	fga: number;
	tp: number;
	tpa: number;
	ft: number;
	fta: number;
	pm: number;
	gs: number;
	orb: number | null;
	drb: number | null;
	pf: number | null;
};

export type AGame = {
	gid: number;
	season: number;
	day: number;
	att: number;
	ot: number;
	playoffs: boolean;
	won: { tid: number; pts: number };
	lost: { tid: number; pts: number };
	teams: {
		tid: number;
		pts: number;
		ptsQtrs: number[];
		players: ABoxLine[];
	}[];
};

type SeriesTeam = { tid: number; seed: number; won: number };

export type AData = {
	meta: {
		season: number;
		phase: number;
		numGames: number;
		startingSeason: number;
		// The league's own seasons start here (the engine's ownFrom reads it)
		filled: { own: number };
	};
	teams: ATeam[];
	players: APlayer[];
	games: AGame[];
	feats: any[];
	events: any[];
	playoffSeries: {
		season: number;
		series: {
			home: SeriesTeam | null;
			away: SeriesTeam | null;
			gids: number[];
		}[][];
	}[];
	champions: Record<
		number,
		{
			tid: number;
			runnerUp: number;
			result: string;
			seed: number;
			runnerUpSeed: number;
		}
	>;
	awards: any[];
	allStars: any[];
	h2h: any[];
	lottery: any[];
	coverage: never[];
};

// Raw rows of the stores the Wrapped snapshot doesn't hold, read by the worker (see worker/util/leagueAchievements.ts)
export type AExtras = {
	phase: number;
	numGames: number;
	// Wins needed to take a series in each round of the current season, so a series still being played isn't read as decided (a 3-0 lead is not a sweep)
	seriesWinsNeeded?: number[];
	// Only trades and free agent signings are read
	events: any[];
	awards: any[];
	allStars: any[];
	lottery: any[];
	h2h: any[];
	feats: any[];
	teams: {
		tid: number;
		retiredJerseyNumbers?: {
			number: string;
			seasonRetired: number;
			pid?: number;
		}[];
	}[];
};

const US_STATES = new Set(
	"AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(
		" ",
	),
);
const US_STATE_NAMES = new Set(
	[
		"Alabama",
		"Alaska",
		"Arizona",
		"Arkansas",
		"California",
		"Colorado",
		"Connecticut",
		"Delaware",
		"Florida",
		"Georgia",
		"Hawaii",
		"Idaho",
		"Illinois",
		"Indiana",
		"Iowa",
		"Kansas",
		"Kentucky",
		"Louisiana",
		"Maine",
		"Maryland",
		"Massachusetts",
		"Michigan",
		"Minnesota",
		"Mississippi",
		"Missouri",
		"Montana",
		"Nebraska",
		"Nevada",
		"New Hampshire",
		"New Jersey",
		"New Mexico",
		"New York",
		"North Carolina",
		"North Dakota",
		"Ohio",
		"Oklahoma",
		"Oregon",
		"Pennsylvania",
		"Rhode Island",
		"South Carolina",
		"South Dakota",
		"Tennessee",
		"Texas",
		"Utah",
		"Vermont",
		"Virginia",
		"Washington",
		"West Virginia",
		"Wisconsin",
		"Wyoming",
		"District of Columbia",
	].map((x) => x.toLowerCase()),
);

// The country of a birth place: "Boston, MA" and "Paris, France" give USA and France, "IL - Country: Lithuania" gives Lithuania (the Explorer's countryOf)
export const countryOf = (loc: string | undefined) => {
	if (!loc || typeof loc !== "string") {
		return "";
	}
	const tag = /\bcountry:\s*([^,]+?)\s*$/i.exec(loc);
	if (tag) {
		loc = tag[1]!;
	}
	const parts = loc.split(",");
	const last = parts.at(-1)!.trim();
	if (
		US_STATES.has(last) ||
		US_STATE_NAMES.has(last.toLowerCase().replace(/\s+/g, " ")) ||
		/^(united states( of america)?|u\.?s\.?a?\.?)$/i.test(last)
	) {
		return "USA";
	}
	return last;
};

const toAStat = (r: WStat, playoffs: boolean): AStat => {
	const o: AStat = {
		season: r.season,
		tid: r.tid,
		playoffs,
		gp: r.gp,
		gs: r.gs,
		min: r.min,
		pts: r.pts,
		orb: r.orb,
		drb: r.drb,
		ast: r.ast,
		stl: r.stl,
		blk: r.blk,
		tov: r.tov,
		pf: r.pf,
		fg: r.fg,
		fga: r.fga,
		tp: r.tp,
		tpa: r.tpa,
		ft: r.ft,
		fta: r.fta,
		per: r.per,
		ows: r.ows,
		dws: r.dws,
		vorp: r.vorp,
		obpm: r.obpm,
		dbpm: r.dbpm,
		usgp: r.usgp,
		ortg: r.ortg,
		drtg: r.drtg,
		pm: r.pm,
		dd: r.dd,
		td: r.td,
		trb: r.trb,
		ws: Math.round(r.ws * 10) / 10,
		bpm: Math.round(r.bpm * 10) / 10,
	};
	if (r.jersey !== undefined) {
		o.jersey = r.jersey;
	}
	return o;
};

const toAPlayer = (p: WPlayer): APlayer => {
	const seasons = Object.keys(p.ovr)
		.map(Number)
		.sort((a, b) => a - b);
	const ratings = seasons.map((season) => {
		const r: ARating = {
			season,
			ovr: num(p.ovr[season]),
			pot: num(p.pot?.[season]),
			pos: p.pos?.[season] ?? "",
		};
		const rat = p.rat?.[season];
		if (rat) {
			RATING_SKILLS.forEach((k, i) => {
				r[k] = rat[i];
			});
		}
		return r;
	});
	const retiredYear =
		Number.isFinite(p.retiredYear) && p.retiredYear < 9999
			? p.retiredYear
			: null;
	const salaryBy = new Map<number, number>();
	for (const x of p.paid ?? []) {
		if (retiredYear === null || x.season <= retiredYear) {
			salaryBy.set(x.season, (salaryBy.get(x.season) ?? 0) + num(x.amount));
		}
	}
	return {
		pid: p.pid,
		name: p.name,
		fn: p.firstName ?? "",
		ln: p.lastName ?? "",
		tid: p.tid,
		born: { year: p.bornYear, loc: p.bornLoc ?? "" },
		country: countryOf(p.bornLoc),
		college: p.college ?? "",
		hgt: p.hgtIn,
		weight: p.weight,
		pos: ratings.at(-1)?.pos ?? "",
		draft: {
			year: p.draft.year,
			round: num(p.draft.round),
			pick: num(p.draft.pick),
			tid: p.draft.tid,
			ovr: num(p.draftOvr),
			pot: num(p.draftPot),
		},
		retiredYear,
		diedYear: typeof p.diedYear === "number" ? p.diedYear : null,
		hof: p.hof,
		relatives: p.relatives.map((r) => ({ type: r.type, pid: r.pid })),
		injuries: p.injuries.map((i) => ({
			season: i.season,
			games: num(i.games),
			type: i.type,
		})),
		ratings,
		stats: [
			...p.stats.map((r) => toAStat(r, false)),
			...p.po.map((r) => toAStat(r, true)),
		],
		salaries: [...salaryBy]
			.sort((a, b) => a[0] - b[0])
			.map(([season, amount]) => ({ season, amount })),
	};
};

const toATeamSeason = (s: WTeamSeason): ATeamSeason => {
	const won = num(s.won);
	const lost = num(s.lost);
	const tied = num(s.tied);
	const otl = num(s.otl);
	const gp = won + lost + tied + otl;
	return {
		season: s.season,
		won,
		lost,
		tied,
		otl,
		gp,
		winp: gp ? (won + 0.5 * tied) / gp : 0,
		playoffRoundsWon:
			typeof s.playoffRoundsWon === "number" ? s.playoffRoundsWon : -1,
		region: s.region,
		name: s.name,
		abbrev: s.abbrev,
		cid: s.cid,
		did: s.did,
		wonHome: num(s.wonHome),
		lostHome: num(s.lostHome),
		tiedHome: num(s.tiedHome),
		wonAway: num(s.wonAway),
		lostAway: num(s.lostAway),
		tiedAway: num(s.tiedAway),
		wonConf: num(s.wonConf),
		lostConf: num(s.lostConf),
		wonDiv: num(s.wonDiv),
		lostDiv: num(s.lostDiv),
		att: num(s.att),
		gpHome: num(s.gpHome),
		pop: num(s.pop),
		hype: num(s.hype),
		streak: num(s.streak),
		payroll: Math.round(num(s.payroll)),
		luxuryTax: Math.round(num(s.luxuryTax)),
	};
};

const toAGame = (gm: WGame): AGame => {
	const [a, b] = gm.teams;
	// A tie (rare in basketball) counts for the first team, like BBGM's own won/lost
	const aWon = a.pts >= b.pts;
	return {
		gid: gm.gid,
		season: gm.season,
		day: gm.day,
		att: num(gm.att),
		ot: num(gm.overtimes),
		playoffs: gm.playoffs,
		won: aWon ? { tid: a.tid, pts: a.pts } : { tid: b.tid, pts: b.pts },
		lost: aWon ? { tid: b.tid, pts: b.pts } : { tid: a.tid, pts: a.pts },
		teams: gm.teams.map((t) => ({
			tid: t.tid,
			pts: num(t.pts),
			ptsQtrs: Array.isArray(t.ptsQtrs) ? t.ptsQtrs.slice() : [],
			players: t.players
				.filter((l) => num(l.min) > 0)
				.map((l) => ({
					pid: l.pid,
					name: l.name,
					min: Math.round(num(l.min) * 10) / 10,
					pts: num(l.pts),
					trb: num(l.trb),
					ast: num(l.ast),
					stl: num(l.stl),
					blk: num(l.blk),
					tov: num(l.tov),
					fg: num(l.fg),
					fga: num(l.fga),
					tp: num(l.tp),
					tpa: num(l.tpa),
					ft: num(l.ft),
					fta: num(l.fta),
					pm: num(l.pm),
					gs: num(l.gs),
					orb: l.orb === undefined ? null : num(l.orb),
					drb: l.drb === undefined ? null : num(l.drb),
					pf: l.pf === undefined ? null : num(l.pf),
				})),
		})),
	};
};

const winnerOf = (w: any) => {
	const o: { pid: number; tid: number; name?: string } = {
		pid: w?.pid,
		tid: w?.tid,
	};
	if (typeof w?.name === "string" && w.name) {
		o.name = w.name;
	}
	return o;
};

const contestWinner = (c: any) => {
	if (!c || !Array.isArray(c.players) || typeof c.winner !== "number") {
		return null;
	}
	const w = c.players[c.winner];
	return w && typeof w.pid === "number"
		? { pid: w.pid, tid: w.tid, name: w.name ?? "" }
		: null;
};

const slimEvent = (e: any) => {
	const o: any = { eid: e.eid, type: e.type, season: e.season };
	if (e.phase !== undefined) {
		o.phase = e.phase;
	}
	if (Array.isArray(e.pids) && e.pids.length > 0) {
		o.pids = e.pids.slice();
	}
	if (Array.isArray(e.tids) && e.tids.length > 0) {
		o.tids = e.tids.slice();
	}
	if (Array.isArray(e.dpids) && e.dpids.length > 0) {
		o.dpids = e.dpids.slice();
	}
	if (e.contract) {
		o.contract = { amount: num(e.contract.amount), exp: e.contract.exp };
	}
	if (e.type === "trade" && Array.isArray(e.teams)) {
		o.teams = e.teams.map((t: any) => ({
			assets: (t?.assets ?? []).map((a: any) =>
				a.dpid === undefined
					? {
							pid: a.pid,
							name: a.name ?? "",
							contract: a.contract
								? { amount: num(a.contract.amount), exp: a.contract.exp }
								: null,
						}
					: {
							dpid: a.dpid,
							season: a.season,
							round: a.round,
							originalTid: a.originalTid,
						},
			),
		}));
	}
	return o;
};

const slimFeat = (f: any) => {
	const s = f.stats ?? {};
	return {
		fid: f.fid,
		pid: f.pid,
		name: f.name ?? "",
		pos: f.pos ?? "",
		season: f.season,
		tid: f.tid,
		oppTid: f.oppTid,
		playoffs: !!f.playoffs,
		gid: f.gid,
		ot: num(f.overtimes),
		s: {
			min: Math.round(num(s.min) * 10) / 10,
			pts: num(s.pts),
			trb: num(s.orb) + num(s.drb),
			ast: num(s.ast),
			stl: num(s.stl),
			blk: num(s.blk),
			tov: num(s.tov),
			fg: num(s.fg),
			fga: num(s.fga),
			tp: num(s.tp),
			tpa: num(s.tpa),
			ft: num(s.ft),
			fta: num(s.fta),
			dd: num(s.dd),
			td: num(s.td),
			qd: num(s.qd),
			fxf: num(s.fxf),
		},
	};
};

const slimAwards = (a: any) => {
	const raw: any[] = Array.isArray(a.awards) ? a.awards : [];
	// The same award listed twice with the same winners is one award
	const list = raw.filter(
		(x, i) =>
			x &&
			raw.findIndex(
				(y) =>
					y &&
					y.shortName === x.shortName &&
					y.name === x.name &&
					JSON.stringify(y.winner) === JSON.stringify(x.winner),
			) === i,
	);
	return {
		season: a.season,
		bestRecord: a.bestRecord,
		list: list.map((x) => ({
			short: x.shortName || x.name,
			name: x.name,
			numTeams: x.numTeams || 0,
			...(x.actAs ? { actAs: x.actAs } : {}),
			...(x.rookie ? { rookie: true } : {}),
			...(x.bench ? { bench: true } : {}),
			...(x.mip ? { mip: true } : {}),
			winners: Array.isArray(x.winner)
				? x.winner
						.map((w: any) =>
							Array.isArray(w)
								? w.filter((y) => typeof y?.pid === "number").map(winnerOf)
								: winnerOf(w),
						)
						.filter((w: any) => Array.isArray(w) || typeof w.pid === "number")
				: [],
		})),
	};
};

export const toAData = (L: WLeague, x: AExtras): AData => {
	const bySeason = new Map<number, WTeamSeason[]>();
	const byTid = new Map<number, WTeamSeason[]>();
	for (const ts of L.teamSeasons) {
		let a = byTid.get(ts.tid);
		if (!a) {
			a = [];
			byTid.set(ts.tid, a);
		}
		a.push(ts);
		let b = bySeason.get(ts.season);
		if (!b) {
			b = [];
			bySeason.set(ts.season, b);
		}
		b.push(ts);
	}
	const jerseysBy = new Map(
		x.teams.map((t) => [t.tid, t.retiredJerseyNumbers]),
	);
	const tids = new Set([...byTid.keys(), ...x.teams.map((t) => t.tid)]);
	const teams: ATeam[] = [...tids]
		.sort((a, b) => a - b)
		.map((tid) => {
			const rows = (byTid.get(tid) ?? []).sort((a, b) => a.season - b.season);
			const last = rows.at(-1);
			return {
				tid,
				abbrev: last?.abbrev ?? "",
				region: last?.region ?? "",
				name: last?.name ?? "",
				retiredJerseys: (jerseysBy.get(tid) ?? []).map((j) => ({
					number: String(j.number),
					seasonRetired: j.seasonRetired,
					pid: typeof j.pid === "number" ? j.pid : null,
				})),
				seasons: rows.map(toATeamSeason),
			};
		});

	const inProgress = (season: number) =>
		season === L.season && !L.currentComplete && x.seriesWinsNeeded;
	const playoffSeries = L.series
		.map((ps) => ({
			season: ps.season,
			series: ps.rounds.map((round, ri) =>
				round
					.filter((m) => {
						const need = inProgress(ps.season)
							? x.seriesWinsNeeded![ri]
							: undefined;
						return (
							need === undefined ||
							!m.away ||
							Math.max(num(m.home.won), num(m.away.won)) >= need
						);
					})
					.map((m) => ({
						home: m.home
							? { tid: m.home.tid, seed: m.home.seed, won: num(m.home.won) }
							: null,
						away: m.away
							? { tid: m.away.tid, seed: m.away.seed, won: num(m.away.won) }
							: null,
						gids: Array.isArray(m.gids) ? m.gids.slice() : [],
					})),
			),
		}))
		.sort((a, b) => a.season - b.season);

	// A champion once the final is decided: the season is over, or the winner has won every round
	const champions: AData["champions"] = {};
	for (const ps of playoffSeries) {
		const final = ps.series.at(-1);
		const s = final?.[0];
		if (!s || !s.home || !s.away || final.length !== 1) {
			continue;
		}
		const homeWon = s.home.won > s.away.won;
		const w = homeWon ? s.home : s.away;
		const l = homeWon ? s.away : s.home;
		const done =
			ps.season < L.season ||
			L.currentComplete ||
			(bySeason.get(ps.season) ?? []).some(
				(ts) => ts.tid === w.tid && ts.playoffRoundsWon >= ps.series.length,
			);
		if (!done || w.won === l.won) {
			continue;
		}
		champions[ps.season] = {
			tid: w.tid,
			runnerUp: l.tid,
			result: `${w.won}-${l.won}`,
			seed: w.seed,
			runnerUpSeed: l.seed,
		};
	}

	const games = L.games
		.filter((gm) => gm.teams.length === 2)
		.map(toAGame)
		.sort((a, b) => a.season - b.season || a.gid - b.gid);

	return {
		meta: {
			season: L.season,
			phase: x.phase,
			numGames: x.numGames,
			startingSeason: L.startingSeason,
			filled: { own: L.startingSeason },
		},
		teams,
		players: L.players.map(toAPlayer).sort((a, b) => a.pid - b.pid),
		games,
		feats: x.feats.map(slimFeat).sort((a, b) => a.fid - b.fid),
		events: x.events
			.filter((e) => e && (e.type === "trade" || e.type === "freeAgent"))
			.map(slimEvent)
			.sort((a, b) => a.eid - b.eid),
		playoffSeries,
		champions,
		awards: x.awards.map(slimAwards).sort((a, b) => a.season - b.season),
		allStars: x.allStars
			.map((a) => ({
				season: a.season,
				teamNames: a.teamNames ?? [],
				teams: (a.teams ?? []).map((t: any[]) =>
					(t ?? []).map((y) => ({ pid: y.pid, tid: y.tid, name: y.name })),
				),
				mvp: a.mvp
					? { pid: a.mvp.pid, tid: a.mvp.tid, name: a.mvp.name }
					: null,
				dunk: contestWinner(a.dunk),
				three: contestWinner(a.three),
				score: a.score ?? null,
			}))
			.sort((a, b) => a.season - b.season),
		h2h: x.h2h
			.map((h) => ({
				season: h.season,
				regularSeason: h.regularSeason ?? {},
				playoffs: h.playoffs ?? {},
			}))
			.sort((a, b) => a.season - b.season),
		lottery: x.lottery
			.map((l) => ({
				season: l.season,
				draftType: l.draftType ?? "",
				result: (l.result ?? []).map((r: any) => ({
					tid: r.tid,
					originalTid: r.originalTid,
					chances: num(r.chances),
					pick: r.pick,
					dpid: r.dpid,
					won: r.won,
					lost: r.lost,
				})),
			}))
			.sort((a, b) => a.season - b.season),
		coverage: [],
	};
};
