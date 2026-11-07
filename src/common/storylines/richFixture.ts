// A busier fake league for the storyline tests: the plain fixture plus awards, injuries, relatives, a Hall of Famer, a few huge box scores and odd team seasons, so most kinds have something to find.
import { makeLeague } from "../wrapped/fixture.ts";
import type { WLeague } from "../wrapped/types.ts";

export const makeRichLeague = (numSeasons = 30): WLeague => {
	const L = makeLeague(numSeasons, "rich");
	const seasons = [...new Set(L.teamSeasons.map((t) => t.season))];
	for (const s of seasons) {
		const rows = L.players
			.map((p) => ({ p, r: p.stats.find((x) => x.season === s)! }))
			.sort((a, b) => b.r.ws - a.r.ws);
		// All-Stars and a few awards from the top of the win-share list
		rows
			.slice(0, 10)
			.forEach(({ p }) => p.awards.push({ season: s, type: "All-Star" }));
		rows[1]!.p.awards.push({ season: s, type: "Defensive Player of the Year" });
		rows[2]!.p.awards.push({ season: s, type: "Rookie of the Year" });
		rows[3]!.p.awards.push({ season: s, type: "Sixth Man of the Year" });
		const champ = L.teamSeasons.find(
			(t) => t.season === s && t.playoffRoundsWon >= 2,
		)!;
		const fm = rows.find((x) => x.p.tid === champ.tid)!;
		fm.p.awards.push({ season: s, type: "Finals MVP" });
		// Playoff rows for the champion and the runner-up
		for (const { p, r } of rows) {
			if (
				p.tid === champ.tid ||
				L.teamSeasons.some(
					(t) => t.season === s && t.tid === p.tid && t.playoffRoundsWon === 1,
				)
			) {
				p.po.push({
					...r,
					gp: 12,
					gs: 12,
					min: 12 * 30,
					pts: 12 * (10 + (r.ws % 15)),
					ws: 1,
				});
			}
		}
	}
	const [a, b, c, d] = L.players;
	// A Hall of Famer, an injury-plagued star, a father and a son
	a!.hof = true;
	a!.retiredYear = L.season;
	for (const s of seasons.slice(0, 6)) {
		b!.injuries.push({ season: s, games: 60, type: "Torn ACL" });
	}
	c!.relatives.push({ type: "son", pid: d!.pid });
	d!.relatives.push({ type: "father", pid: c!.pid });
	for (const p of L.players.slice(0, 20)) {
		p.draft = { ...p.draft, round: 2, pick: 20 };
	}
	L.players[3]!.draft = { year: seasons[0]! - 3, round: 1, pick: 1, tid: 2 };
	// Stat lines nobody expects, so the shooting and rate kinds fire
	for (const p of L.players.slice(0, 6)) {
		for (const r of p.stats) {
			r.fga = r.gp * 15;
			r.fg = Math.round(r.fga * 0.52);
			r.tpa = r.gp * 6;
			r.tp = Math.round(r.tpa * 0.42);
			r.fta = r.gp * 6;
			r.ft = Math.round(r.fta * 0.92);
		}
	}
	for (const g of L.games.slice(0, 60)) {
		const t = g.teams[0];
		const l = t.players[0];
		if (l) {
			l.tp = 11;
			l.blk = 10;
			l.stl = 9;
			l.trb = 26;
			l.ast = 21;
			l.pts = 50;
			t.pts += 40;
		}
		if (g.gid % 7 === 0) {
			g.playoffs = true;
			g.overtimes = 3;
		}
	}
	return L;
};
