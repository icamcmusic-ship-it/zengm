// Home court: how much playing at home is worth, by season, era and team, and in the playoffs.
//
// Sources: the team seasons' home and road splits (a team season with no home or no road games is left out: unknown, never 0-0), the box scores still on file (teams[0] is the home team: home win% and home scoring margin; neutral site games and ties are left out) and the playoff brackets (the "home" side of a series has home court: how often it won the series, by round).

import { ratio } from "./util.ts";

export type HCTeamSeason = {
	tid: number;
	season: number;
	wonHome: number;
	lostHome: number;
	wonAway: number;
	lostAway: number;
};

export type HCGame = {
	season: number;
	playoffs: boolean;
	neutralSite: boolean;
	home: { tid: number; pts: number };
	away: { tid: number; pts: number };
};

export type HCSeries = {
	season: number;
	rounds: {
		home: { tid: number; won: number };
		away?: { tid: number; won: number };
	}[][];
};

export type HCInput = {
	teamSeasons: HCTeamSeason[];
	games: HCGame[];
	series: HCSeries[];
	// Seasons whose playoffs are over (series of other seasons may still be going on)
	completeSeasons: Set<number>;
};

export type HCBox = { g: number; hw: number; margin: number };

export type HCSeason = {
	season: number;
	hw: number;
	hl: number;
	aw: number;
	al: number;
	teams: number;
	p: number | null;
	box: HCBox | null;
	po: HCBox | null;
	series: { n: number; won: number };
};

export type HCEra = {
	decade: number;
	from: number;
	to: number;
	hw: number;
	hl: number;
	seasons: number;
	p: number | null;
};

export type HCRecord = {
	hw: number;
	hl: number;
	aw: number;
	al: number;
	homeP: number | null;
	roadP: number | null;
	// Home win% minus road win%
	gap: number | null;
};

export type HCTeam = HCRecord & { tid: number; seasons: number; last: number };
export type HCTeamSeasonRow = HCRecord & { tid: number; season: number };

export type HomeCourt = {
	seasons: HCSeason[];
	eras: HCEra[];
	teams: HCTeam[];
	teamSeasons: HCTeamSeasonRow[];
	series: {
		n: number;
		won: number;
		// back: rounds before the finals (0 = finals), so brackets of different sizes line up
		byRound: { back: number; n: number; won: number }[];
	};
	box: HCBox;
	po: HCBox;
	total: { hw: number; hl: number; p: number | null };
};

const record = (hw: number, hl: number, aw: number, al: number): HCRecord => {
	const homeP = ratio(hw, hl);
	const roadP = ratio(aw, al);
	return {
		hw,
		hl,
		aw,
		al,
		homeP,
		roadP,
		gap: homeP !== null && roadP !== null ? homeP - roadP : null,
	};
};

export const buildHomeCourt = (input: HCInput): HomeCourt => {
	const bySeason = new Map<number, HCSeason>();
	const S = (season: number) => {
		let x = bySeason.get(season);
		if (!x) {
			x = {
				season,
				hw: 0,
				hl: 0,
				aw: 0,
				al: 0,
				teams: 0,
				p: null,
				box: null,
				po: null,
				series: { n: 0, won: 0 },
			};
			bySeason.set(season, x);
		}
		return x;
	};

	const teamSeasons: HCTeamSeasonRow[] = [];
	const byTeam = new Map<
		number,
		{
			hw: number;
			hl: number;
			aw: number;
			al: number;
			seasons: number;
			last: number;
		}
	>();
	for (const r of input.teamSeasons) {
		const hg = r.wonHome + r.lostHome;
		const ag = r.wonAway + r.lostAway;
		if (!(hg > 0 && ag > 0)) {
			continue;
		}
		const x = S(r.season);
		x.hw += r.wonHome;
		x.hl += r.lostHome;
		x.aw += r.wonAway;
		x.al += r.lostAway;
		x.teams += 1;
		teamSeasons.push({
			tid: r.tid,
			season: r.season,
			...record(r.wonHome, r.lostHome, r.wonAway, r.lostAway),
		});
		let t = byTeam.get(r.tid);
		if (!t) {
			t = { hw: 0, hl: 0, aw: 0, al: 0, seasons: 0, last: r.season };
			byTeam.set(r.tid, t);
		}
		t.hw += r.wonHome;
		t.hl += r.lostHome;
		t.aw += r.wonAway;
		t.al += r.lostAway;
		t.seasons += 1;
		t.last = Math.max(t.last, r.season);
	}

	const box: HCBox = { g: 0, hw: 0, margin: 0 };
	const po: HCBox = { g: 0, hw: 0, margin: 0 };
	for (const gm of input.games) {
		if (
			gm.neutralSite ||
			gm.home.tid < 0 ||
			gm.away.tid < 0 ||
			gm.home.pts === gm.away.pts
		) {
			continue;
		}
		const x = S(gm.season);
		const key = gm.playoffs ? "po" : "box";
		x[key] ??= { g: 0, hw: 0, margin: 0 };
		const homeWon = gm.home.pts > gm.away.pts;
		for (const o of [x[key], gm.playoffs ? po : box]) {
			o.g += 1;
			if (homeWon) {
				o.hw += 1;
			}
			o.margin += gm.home.pts - gm.away.pts;
		}
	}

	const series: HomeCourt["series"] = { n: 0, won: 0, byRound: [] };
	for (const ps of input.series) {
		if (!input.completeSeasons.has(ps.season)) {
			continue;
		}
		const numRounds = ps.rounds.length;
		ps.rounds.forEach((round, i) => {
			for (const m of round) {
				if (!m.away || m.home.won === m.away.won) {
					continue;
				}
				const won = m.home.won > m.away.won ? 1 : 0;
				series.n += 1;
				series.won += won;
				const x = S(ps.season);
				x.series.n += 1;
				x.series.won += won;
				const back = numRounds - 1 - i;
				series.byRound[back] ??= { back, n: 0, won: 0 };
				series.byRound[back].n += 1;
				series.byRound[back].won += won;
			}
		});
	}
	series.byRound = series.byRound.filter((x) => x !== undefined);

	const seasons = [...bySeason.values()].sort((a, b) => a.season - b.season);
	for (const s of seasons) {
		s.p = ratio(s.hw, s.hl);
		for (const key of ["box", "po"] as const) {
			const o = s[key];
			if (o) {
				o.margin /= o.g;
			}
		}
	}
	box.margin = box.g > 0 ? box.margin / box.g : 0;
	po.margin = po.g > 0 ? po.margin / po.g : 0;

	const eras: HCEra[] = [];
	for (const s of seasons) {
		if (s.p === null) {
			continue;
		}
		const decade = Math.floor(s.season / 10) * 10;
		let e = eras.at(-1);
		if (!e || e.decade !== decade) {
			e = {
				decade,
				from: s.season,
				to: s.season,
				hw: 0,
				hl: 0,
				seasons: 0,
				p: null,
			};
			eras.push(e);
		}
		e.to = s.season;
		e.hw += s.hw;
		e.hl += s.hl;
		e.seasons += 1;
	}
	for (const e of eras) {
		e.p = ratio(e.hw, e.hl);
	}

	const teams: HCTeam[] = [...byTeam.entries()].map(([tid, t]) => ({
		tid,
		seasons: t.seasons,
		last: t.last,
		...record(t.hw, t.hl, t.aw, t.al),
	}));

	let hw = 0;
	let hl = 0;
	for (const s of seasons) {
		hw += s.hw;
		hl += s.hl;
	}

	return {
		seasons,
		eras,
		teams,
		teamSeasons,
		series,
		box,
		po,
		total: { hw, hl, p: ratio(hw, hl) },
	};
};

// Team seasons with enough games both ways to be compared, best (or worst) first by a key
export const extremes = (
	rows: HCTeamSeasonRow[],
	key: "homeP" | "roadP" | "gap",
	order: "best" | "worst",
	n = 5,
	minGames = 10,
) => {
	const ok = rows.filter(
		(r) =>
			r.hw + r.hl >= minGames && r.aw + r.al >= minGames && r[key] !== null,
	);
	const sign = order === "best" ? -1 : 1;
	// Ties: more games at that end first, then the most recent
	const games = (r: HCTeamSeasonRow) =>
		key === "roadP" ? r.aw + r.al : r.hw + r.hl;
	return ok
		.sort(
			(a, b) =>
				sign * (a[key]! - b[key]!) ||
				games(b) - games(a) ||
				b.season - a.season,
		)
		.slice(0, n);
};
