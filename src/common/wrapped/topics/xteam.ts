// Extra team topics: home and road, money, roster makeup, team stat boards, playoff stories and box-score extras.
import type { SeasonLine } from "../league.ts";
import type { Slide, WTeamSeason } from "../types.ts";
import { fmtNum, isNum, ordinal, plural, rankOf, rankScore } from "../util.ts";
import { mk, type Topic, type TopicCtx } from "./helpers.ts";
import {
	allTeamSeasons,
	money,
	nth,
	pct,
	pctOf,
	rosterByMin,
	twoWay,
	wavg,
	wl,
	wpOf,
	type X,
} from "./kit.ts";

type TeamDef = {
	id: string;
	group: string;
	theme: string;
	kicker: string;
	val: (t: WTeamSeason, X: X) => number | undefined;
	show: (v: number) => string;
	unit: string;
	hi: (name: string, v: number, rank: number) => string[];
	lo?: (name: string, v: number, rank: number) => string[];
	extra?: (t: WTeamSeason, X: X, v: number) => (string | null)[];
	total?: boolean;
	w: number;
	minBoard?: number;
	note?: string;
};

type TItem = { v: number; tid: number; season: number };

const teamBoard = (X: X, d: TeamDef): TItem[] =>
	X.cached(`tb|${d.id}`, () => {
		const out: TItem[] = [];
		for (const t of allTeamSeasons(X)) {
			if (d.total && !X.decided(t.season)) {
				continue;
			}
			const v = d.val(t, X);
			if (isNum(v)) {
				out.push({ v, tid: t.tid, season: t.season });
			}
		}
		return out;
	});

const teamSlide = (ctx: TopicCtx, d: TeamDef): Slide | null => {
	const { X, season, tid, soFar } = ctx;
	const t = X.team(tid!, season);
	if (!t || (d.total && soFar) || t.gp <= 0) {
		return null;
	}
	const v = d.val(t, X);
	if (!isNum(v)) {
		return null;
	}
	const board = teamBoard(X, d);
	if (board.length < (d.minBoard ?? 24)) {
		return null;
	}
	const vals = board.map((x) => x.v);
	const w = d.lo ? twoWay(vals, v) : { high: true, rank: rankOf(vals, v) };
	const score = rankScore(w.rank, vals.length) * d.w;
	if (score < 0.1) {
		return null;
	}
	// How the team ranks among this season's teams
	const inSeason = board.filter((x) => x.season === season);
	const sr = w.high
		? rankOf(
				inSeason.map((x) => x.v),
				v,
			)
		: inSeason.filter((x) => x.v < v).length + 1;
	const last = board
		.filter(
			(x) =>
				x.season < season && (w.high ? x.v >= v : x.v <= v) && x.tid !== tid,
		)
		.sort((a, b) => b.season - a.season)[0];
	const name = X.teamName(tid!, season);
	return mk({
		id: d.id,
		group: d.group,
		theme: d.theme,
		score,
		kicker: d.kicker,
		tid,
		season,
		heads: w.high ? d.hi(name, v, w.rank) : d.lo!(name, v, w.rank),
		hero: { text: d.show(v), unit: d.unit },
		lines: [
			`${nth(sr, w.high ? "highest" : "lowest")} in the league this season`,
			`${nth(w.rank, w.high ? "highest" : "lowest")} of ${fmtNum(vals.length)} team seasons in league history`,
			last
				? `Last team this ${w.high ? "high" : "low"}: ${X.teamName(last.tid, last.season)}, ${last.season}`
				: null,
			...(d.extra?.(t, X, v) ?? []),
		],
		note: d.note,
		facts: [`tb|${d.id}|${tid}|${season}`],
	});
};

const teamTopic =
	(d: TeamDef): Topic =>
	(ctx) =>
		teamSlide(ctx, d);

const games = (t: WTeamSeason) => t.gp || t.won + t.lost + t.tied + t.otl;

// Per-game team totals, summed over the players who played for the team
const sumRoster = (X: X, t: WTeamSeason, f: (l: SeasonLine) => number) => {
	const rows = X.teamLines(t.tid, t.season);
	if (rows.length === 0) {
		return undefined;
	}
	return rows.reduce((a, l) => a + f(l), 0);
};

const rate = (f: (l: SeasonLine) => number) => (t: WTeamSeason, X: X) => {
	const s = sumRoster(X, t, f);
	const g = games(t);
	return s !== undefined && g >= 10 ? s / g : undefined;
};

const TEAM_DEFS: TeamDef[] = [
	{
		id: "t-home",
		group: "t-split",
		theme: "schedule",
		kicker: "Home court",
		val: (t) => {
			const h = wl(t.wonHome, t.lostHome);
			return h && h.w + h.l >= 10 ? pctOf(h) : undefined;
		},
		show: (v) => fmtNumWinp(v),
		unit: "home win pct",
		hi: (n, v) => [
			`${n} were nearly unbeatable at home`,
			`A fortress: ${n} at home`,
		],
		lo: (n) => [`${n} struggled at home`, `Home was no advantage for ${n}`],
		extra: (t) => [
			`Home record: ${t.wonHome}-${t.lostHome}`,
			`Road record: ${t.wonAway}-${t.lostAway}`,
		],
		w: 0.8,
	},
	{
		id: "t-road",
		group: "t-split",
		theme: "schedule",
		kicker: "Road warriors",
		val: (t) => {
			const h = wl(t.wonAway, t.lostAway);
			return h && h.w + h.l >= 10 ? pctOf(h) : undefined;
		},
		show: (v) => fmtNumWinp(v),
		unit: "road win pct",
		hi: (n) => [`${n} won on the road, too`, `Road warriors: ${n}`],
		lo: (n) => [
			`${n} were lost away from home`,
			`${n} could not win on the road`,
		],
		extra: (t) => [`Road record: ${t.wonAway}-${t.lostAway}`],
		w: 0.8,
	},
	{
		id: "t-homegap",
		group: "t-split",
		theme: "schedule",
		kicker: "Two different teams",
		val: (t) => {
			const h = wl(t.wonHome, t.lostHome);
			const r = wl(t.wonAway, t.lostAway);
			return h && r && h.w + h.l >= 10 && r.w + r.l >= 10
				? pctOf(h) - pctOf(r)
				: undefined;
		},
		show: (v) => `${v >= 0 ? "+" : "-"}${fmtNum(Math.abs(v) * 100, 0)}`,
		unit: "points of win pct, home minus road",
		hi: (n) => [
			`${n} were a different team at home`,
			`Home and away: two different seasons for ${n}`,
		],
		lo: (n) => [
			`${n} won more on the road than at home`,
			`Better away than home: ${n}`,
		],
		extra: (t) => [
			`${t.wonHome}-${t.lostHome} at home, ${t.wonAway}-${t.lostAway} away`,
		],
		w: 0.7,
	},
	{
		id: "t-div",
		group: "t-schedule",
		theme: "schedule",
		kicker: "In the division",
		val: (t) => {
			const h = wl(t.wonDiv, t.lostDiv);
			return h && h.w + h.l >= 6 ? pctOf(h) : undefined;
		},
		show: (v) => fmtNumWinp(v),
		unit: "division win pct",
		hi: (n) => [`${n} ruled their division`, `Division dominance: ${n}`],
		lo: (n) => [`${n} could not beat their division rivals`],
		extra: (t) => [`${t.wonDiv}-${t.lostDiv} against division rivals`],
		w: 0.7,
	},
	{
		id: "t-conf",
		group: "t-schedule",
		theme: "schedule",
		kicker: "In the conference",
		val: (t) => {
			const h = wl(t.wonConf, t.lostConf);
			return h && h.w + h.l >= 10 ? pctOf(h) : undefined;
		},
		show: (v) => fmtNumWinp(v),
		unit: "conference win pct",
		hi: (n) => [`${n} dominated their conference`],
		lo: (n) => [`${n} were beaten up inside the conference`],
		extra: (t) => [`${t.wonConf}-${t.lostConf} against the conference`],
		w: 0.65,
	},
	{
		id: "t-attendance",
		group: "t-crowd",
		theme: "people",
		kicker: "The crowd",
		val: (t) =>
			isNum(t.att) && isNum(t.gpHome) && t.gpHome >= 10
				? t.att / t.gpHome
				: undefined,
		show: (v) => fmtNum(v, 0),
		unit: "fans a game",
		hi: (n, v) => [
			`${n} drew ${fmtNum(v, 0)} fans a night`,
			`Packed houses for ${n}`,
		],
		lo: (n, v) => [
			`Only ${fmtNum(v, 0)} fans a night showed up for ${n}`,
			`Plenty of empty seats for ${n}`,
		],
		w: 0.7,
	},
	{
		id: "t-payroll",
		group: "t-money",
		theme: "money",
		kicker: "The payroll",
		val: (t) => (isNum(t.payroll) && t.payroll > 0 ? t.payroll : undefined),
		show: (v) => money(v),
		unit: "payroll",
		hi: (n, v) => [
			`${n} spent ${money(v)} on salaries`,
			`Money was no object for ${n}`,
		],
		lo: (n, v) => [
			`${n} ran the cheapest payroll: ${money(v)}`,
			`${n} did it on a shoestring`,
		],
		extra: (t) => [`${t.won}-${t.lost} on the court`],
		w: 0.7,
		total: true,
	},
	{
		id: "t-bargain",
		group: "t-money",
		theme: "money",
		kicker: "Wins per dollar",
		val: (t) =>
			isNum(t.payroll) && t.payroll > 5000 && t.won + t.lost > 20
				? t.won / games(t) / (t.payroll / 100000)
				: undefined,
		show: (v) => fmtNum(v, 2),
		unit: "win pct per $100M",
		hi: (n) => [
			`${n} got the most out of every dollar`,
			`The bargain team of the year: ${n}`,
		],
		lo: (n) => [`${n} paid a lot for a little`, `Wins were expensive for ${n}`],
		extra: (t) => [`${money(t.payroll ?? 0)} payroll, ${t.won}-${t.lost}`],
		w: 0.75,
		total: true,
	},
	{
		id: "t-hype",
		group: "t-fans",
		theme: "people",
		kicker: "Hype",
		val: (t) => (isNum(t.hype) ? t.hype : undefined),
		show: (v) => fmtNum(v * 100, 0),
		unit: "hype (out of 100)",
		hi: (n) => [
			`The city was buzzing about ${n}`,
			`${n} had the hottest ticket in the league`,
		],
		lo: (n) => [`Nobody was talking about ${n}`],
		w: 0.55,
	},
	{
		id: "t-margin",
		group: "t-style",
		theme: "team",
		kicker: "Scoring margin",
		val: (t) => (t.gp > 10 ? (t.pts - t.oppPts) / t.gp : undefined),
		show: (v) => `${v >= 0 ? "+" : ""}${fmtNum(v, 1)}`,
		unit: "points per game",
		hi: (n, v) => [
			`${n} outscored opponents by ${fmtNum(v, 1)} a game`,
			`A dominant margin for ${n}`,
		],
		lo: (n, v) => [
			`${n} were outscored by ${fmtNum(-v, 1)} a night`,
			`The wrong side of the scoreboard: ${n}`,
		],
		w: 0.8,
	},
	{
		id: "t-luck",
		group: "t-style",
		theme: "schedule",
		kicker: "Lucky or unlucky",
		val: (t) => {
			if (t.gp < 20 || t.pts <= 0 || t.oppPts <= 0) {
				return undefined;
			}
			const e = 14;
			const exp = t.pts ** e / (t.pts ** e + t.oppPts ** e);
			return t.won - exp * (t.won + t.lost + t.tied);
		},
		show: (v) => `${v >= 0 ? "+" : "-"}${fmtNum(Math.abs(v), 1)}`,
		unit: "wins over expected",
		hi: (n, v) => [
			`${n} won ${fmtNum(v, 1)} more games than their scoring said they should`,
			`Fortune smiled on ${n}`,
		],
		lo: (n, v) => [
			`${n} should have won ${fmtNum(-v, 1)} more games`,
			`Hard luck for ${n}`,
		],
		extra: (t) => [
			`Points scored ${fmtNum(t.pts / t.gp, 1)}, allowed ${fmtNum(t.oppPts / t.gp, 1)} per game`,
		],
		note: "Expected wins come from the Pythagorean formula: points scored and allowed",
		w: 0.7,
		total: true,
	},
	{
		id: "t-age",
		group: "t-roster",
		theme: "people",
		kicker: "Roster age",
		val: (t, X) => {
			const rows = X.teamLines(t.tid, t.season);
			return rows.length >= 5 ? wavg(rows, (l) => l.age) : undefined;
		},
		show: (v) => fmtNum(v, 1),
		unit: "average age by minutes",
		hi: (n, v) => [
			`${n} were the veterans, averaging ${fmtNum(v, 1)} years old`,
			`An old roster: ${n}`,
		],
		lo: (n, v) => [
			`${n} were young: ${fmtNum(v, 1)} years old on average`,
			`A youth movement in ${n.split(" ").at(-1)}`,
		],
		w: 0.7,
	},
	{
		id: "t-balance",
		group: "t-roster",
		theme: "scoring",
		kicker: "Who scores",
		val: (t, X) => {
			const rows = X.teamLines(t.tid, t.season);
			const tot = rows.reduce((a, l) => a + l.pts, 0);
			return rows.length >= 5 && tot > 0
				? Math.max(...rows.map((l) => l.pts)) / tot
				: undefined;
		},
		show: (v) => pct(v, 0),
		unit: "of points from the top scorer",
		hi: (n, v) => [
			`One man did ${pct(v, 0)} of ${n}’s scoring`,
			`${n} lived and died with one scorer`,
		],
		lo: (n, v) => [
			`${n} shared the scoring: no one took more than ${pct(v, 0)}`,
			`The most balanced attack: ${n}`,
		],
		w: 0.7,
	},
	{
		id: "t-homegrown",
		group: "t-roster",
		theme: "moves",
		kicker: "Homegrown",
		val: (t, X) => {
			const rows = X.teamLines(t.tid, t.season);
			const tot = rows.reduce((a, l) => a + l.min, 0);
			if (rows.length < 5 || tot <= 0) {
				return undefined;
			}
			const mine = rows
				.filter(
					(l) =>
						X.players.get(l.pid)?.draft.tid === t.tid &&
						(X.players.get(l.pid)?.draft.round ?? 0) > 0,
				)
				.reduce((a, l) => a + l.min, 0);
			return mine / tot;
		},
		show: (v) => pct(v, 0),
		unit: "of minutes from their own draftees",
		hi: (n, v) => [
			`${pct(v, 0)} of ${n}’s minutes went to players they drafted`,
			`Built through the draft: ${n}`,
		],
		lo: (n) => [`${n} had almost nobody they drafted themselves`],
		w: 0.7,
	},
	{
		id: "t-rookies",
		group: "t-roster",
		theme: "draft",
		kicker: "Rookies",
		val: (t, X) => {
			const rows = X.teamLines(t.tid, t.season);
			const tot = rows.reduce((a, l) => a + l.min, 0);
			if (rows.length < 5 || tot <= 0) {
				return undefined;
			}
			const mine = rows
				.filter(
					(l) =>
						!X.line(l.pid, t.season - 1) &&
						X.players.get(l.pid)!.stats[0]!.season === t.season &&
						t.season > X.L.startingSeason,
				)
				.reduce((a, l) => a + l.min, 0);
			return mine / tot;
		},
		show: (v) => pct(v, 0),
		unit: "of minutes to rookies",
		hi: (n, v) => [
			`Rookies played ${pct(v, 0)} of ${n}’s minutes`,
			`${n} gave the kids the keys`,
		],
		w: 0.7,
		minBoard: 40,
	},
	{
		id: "t-continuity",
		group: "t-roster",
		theme: "moves",
		kicker: "Continuity",
		val: (t, X) => {
			const rows = X.teamLines(t.tid, t.season);
			const prev = new Set(X.teamLines(t.tid, t.season - 1).map((l) => l.pid));
			const tot = rows.reduce((a, l) => a + l.min, 0);
			if (rows.length < 5 || prev.size < 5 || tot <= 0) {
				return undefined;
			}
			return (
				rows.filter((l) => prev.has(l.pid)).reduce((a, l) => a + l.min, 0) / tot
			);
		},
		show: (v) => pct(v, 0),
		unit: "of minutes from last year’s roster",
		hi: (n, v) => [
			`${n} brought back ${pct(v, 0)} of their minutes`,
			`The same group, one more year: ${n}`,
		],
		lo: (n, v) => [
			`Only ${pct(v, 0)} of ${n}’s minutes came from last year’s roster`,
			`A new look for ${n}`,
		],
		w: 0.7,
	},
	{
		id: "t-churn",
		group: "t-roster",
		theme: "moves",
		kicker: "Revolving door",
		val: (t, X) => {
			const n = X.teamLines(t.tid, t.season).length;
			return n >= 5 ? n : undefined;
		},
		show: (v) => fmtNum(v),
		unit: "players used",
		total: true,
		hi: (n, v) => [
			`${n} used ${fmtNum(v)} different players`,
			`The revolving door never stopped for ${n}`,
		],
		w: 0.65,
	},
	{
		id: "t-allstars",
		group: "t-honors",
		theme: "awards",
		kicker: "All-Stars",
		val: (t, X) => {
			const n = X.teamLines(t.tid, t.season).filter((l) =>
				X.players
					.get(l.pid)
					?.awards.some((a) => a.season === t.season && a.type === "All-Star"),
			).length;
			return n > 0 ? n : undefined;
		},
		show: (v) => fmtNum(v),
		unit: "All-Stars",
		hi: (n, v) => [
			`${plural(v, "All-Star")} on ${n}`,
			`${n} sent ${plural(v, "player")} to the All-Star Game`,
		],
		w: 0.75,
		minBoard: 10,
	},
	{
		id: "t-stl",
		group: "t-boxstats",
		theme: "defense",
		kicker: "Steals",
		val: rate((l) => l.stl),
		show: (v) => fmtNum(v, 1),
		unit: "steals a game",
		hi: (n, v) => [
			`${n} swiped ${fmtNum(v, 1)} steals a game`,
			`Pickpockets: ${n}`,
		],
		w: 0.7,
	},
	{
		id: "t-blk",
		group: "t-boxstats",
		theme: "defense",
		kicker: "Blocks",
		val: rate((l) => l.blk),
		show: (v) => fmtNum(v, 1),
		unit: "blocks a game",
		hi: (n, v) => [
			`${n} blocked ${fmtNum(v, 1)} shots a game`,
			`No layups allowed: ${n}`,
		],
		w: 0.7,
	},
	{
		id: "t-ast",
		group: "t-boxstats",
		theme: "playmaking",
		kicker: "Ball movement",
		val: rate((l) => l.ast),
		show: (v) => fmtNum(v, 1),
		unit: "assists a game",
		hi: (n, v) => [
			`${n} dished ${fmtNum(v, 1)} assists a game`,
			`The ball moved for ${n}`,
		],
		lo: (n, v) => [
			`${n} managed just ${fmtNum(v, 1)} assists a game`,
			`One-on-one basketball in ${n.split(" ").at(-1)}`,
		],
		w: 0.7,
	},
	{
		id: "t-trb",
		group: "t-boxstats",
		theme: "inside",
		kicker: "On the glass",
		val: rate((l) => l.trb),
		show: (v) => fmtNum(v, 1),
		unit: "rebounds a game",
		hi: (n, v) => [
			`${n} grabbed ${fmtNum(v, 1)} rebounds a game`,
			`Owners of the glass: ${n}`,
		],
		lo: (n, v) => [`${n} got only ${fmtNum(v, 1)} rebounds a game`],
		w: 0.7,
	},
	{
		id: "t-tp",
		group: "t-boxstats",
		theme: "scoring",
		kicker: "Raining threes",
		val: rate((l) => l.tp),
		show: (v) => fmtNum(v, 1),
		unit: "threes a game",
		hi: (n, v) => [
			`${n} made ${fmtNum(v, 1)} threes a game`,
			`Splash: ${n} lived from deep`,
		],
		w: 0.75,
	},
	{
		id: "t-tov",
		group: "t-boxstats",
		theme: "playmaking",
		kicker: "Turnovers",
		val: rate((l) => l.tov),
		show: (v) => fmtNum(v, 1),
		unit: "turnovers a game",
		hi: (n, v) => [`${n} gave it away ${fmtNum(v, 1)} times a game`],
		lo: (n, v) => [
			`${n} turned it over just ${fmtNum(v, 1)} times a game`,
			`Careful with the ball: ${n}`,
		],
		w: 0.65,
	},
	{
		id: "t-ftrate",
		group: "t-boxstats",
		theme: "efficiency",
		kicker: "At the line",
		val: (t, X) => {
			const rows = X.teamLines(t.tid, t.season);
			const fta = rows.reduce((a, l) => a + l.fta, 0);
			const ft = rows.reduce((a, l) => a + l.ft, 0);
			return fta > 200 ? ft / fta : undefined;
		},
		show: (v) => pct(v),
		unit: "from the line",
		hi: (n, v) => [`${n} hit ${pct(v)} of their free throws`],
		lo: (n, v) => [
			`${n} made only ${pct(v)} of their free throws`,
			`The line was a problem for ${n}`,
		],
		w: 0.65,
	},
	{
		id: "t-ovr",
		group: "t-roster",
		theme: "ratings",
		kicker: "Talent",
		val: (t, X) => {
			const rows = rosterByMin(X, t.tid, t.season).slice(0, 8);
			const vals = rows
				.map((l) => X.players.get(l.pid)?.ovr[t.season])
				.filter(isNum);
			return vals.length >= 6
				? vals.reduce((a, b) => a + b, 0) / vals.length
				: undefined;
		},
		show: (v) => fmtNum(v, 1),
		unit: "average rating of the top 8",
		hi: (n, v) => [
			`${n} had the most talent: ${fmtNum(v, 1)} average rating`,
			`A rotation full of high ratings: ${n}`,
		],
		lo: (n, v) => [`${n}’s rotation was rated just ${fmtNum(v, 1)} on average`],
		w: 0.65,
	},
];

function fmtNumWinp(x: number) {
	return x.toFixed(3).replace(/^0/, "");
}

const TEAM_RATE = TEAM_DEFS.map(teamTopic);

// ---------------------------------------------------------------------------------------------
// Bespoke team stories
// ---------------------------------------------------------------------------------------------

const drought: Topic = ({ X, season, tid }) => {
	const hist = X.teamHistory(tid!).filter(
		(t) => t.season <= season && X.decided(t.season),
	);
	const me = hist.find((t) => t.season === season);
	if (!me || hist.length < 5) {
		return null;
	}
	const prior = hist.filter((t) => t.season < season);
	let gap = 0;
	for (let i = prior.length - 1; i >= 0; i--) {
		if (prior[i]!.playoffRoundsWon < 0) {
			gap += 1;
		} else {
			break;
		}
	}
	if (me.playoffRoundsWon >= 0 && gap >= 3) {
		return mk({
			id: "t-drought",
			group: "t-history",
			theme: "history",
			score: Math.min(0.85, 0.35 + gap * 0.08),
			kicker: "Back in the playoffs",
			tid,
			season,
			heads: [
				`The ${X.teamName(tid!, season)} ended a ${gap}-year playoff drought`,
				`First playoffs in ${gap + 1} seasons`,
			],
			hero: { text: `${gap}`, unit: "years away" },
			lines: [`Last playoff trip: ${prior[prior.length - 1 - gap]!.season}`],
		});
	}
	if (me.playoffRoundsWon < 0 && gap >= 3) {
		return mk({
			id: "t-drought",
			group: "t-history",
			theme: "history",
			score: Math.min(0.7, 0.25 + gap * 0.06),
			kicker: "Waiting",
			tid,
			season,
			heads: [
				`${gap + 1} seasons without the playoffs for the ${X.teamName(tid!, season)}`,
				`The drought goes on`,
			],
			hero: { text: `${gap + 1}`, unit: "years out" },
			lines: [],
		});
	}
	return null;
};

const frRecord: Topic = ({ X, season, tid }) => {
	const hist = X.teamHistory(tid!).filter(
		(t) => t.season <= season && X.decided(t.season),
	);
	if (hist.length < 4) {
		return null;
	}
	const won = hist.reduce((a, t) => a + t.won, 0);
	const lost = hist.reduce((a, t) => a + t.lost, 0);
	const pctAll = won / Math.max(1, won + lost);
	const others = [...new Set(X.L.teamSeasons.map((t) => t.tid))].map((id) => {
		const h = X.teamHistory(id).filter(
			(t) => t.season <= season && X.decided(t.season),
		);
		const w = h.reduce((a, t) => a + t.won, 0);
		const l = h.reduce((a, t) => a + t.lost, 0);
		return w / Math.max(1, w + l);
	});
	const rank = rankOf(others, pctAll);
	return mk({
		id: "t-frrecord",
		group: "t-history",
		theme: "history",
		score: rankScore(rank, others.length) * 0.7,
		kicker: "All-time record",
		tid,
		season,
		heads: [
			rank === 1
				? `Nobody has a better all-time record than the ${X.teamName(tid!, season)}`
				: `${ordinal(rank)} in all-time winning percentage`,
			`${fmtNum(won)} wins and counting`,
		],
		hero: { text: fmtNumWinp(pctAll), unit: "all-time win pct" },
		lines: [
			`${fmtNum(won)}-${fmtNum(lost)} over ${plural(hist.length, "season")}`,
		],
	});
};

const bubble: Topic = ({ X, season, tid }) => {
	const me = X.team(tid!, season);
	if (!me || !X.decided(season) || me.seed === undefined) {
		return null;
	}
	const inTeams = X.teamsIn(season).filter((t) => t.seed !== undefined);
	const worst = Math.max(...inTeams.map((t) => t.seed!));
	if (inTeams.length < 6 || me.seed !== worst) {
		return null;
	}
	const wp = wpOf(me);
	const others = X.teamsIn(season).filter((t) => t.seed === undefined);
	const bestOut = [...others].sort((a, b) => wpOf(b) - wpOf(a))[0];
	return mk({
		id: "t-bubble",
		group: "t-playoffs",
		theme: "schedule",
		score: 0.35 + (bestOut && wpOf(bestOut) >= wp ? 0.15 : 0),
		kicker: "Last team in",
		tid,
		season,
		heads: [
			`The ${X.teamName(tid!, season)} squeezed in as the last seed`,
			`Barely made it: the ${me.region} ${me.name}`,
		],
		hero: { text: `${me.won}-${me.lost}`, unit: "record" },
		lines: [
			bestOut
				? `First team out: ${X.teamName(bestOut.tid, season)}, ${bestOut.won}-${bestOut.lost}`
				: null,
		],
	});
};

const upset: Topic = ({ X, season, tid }) => {
	const ser = X.seriesOf(tid!, season);
	const out: Slide[] = [];
	for (const s of ser) {
		const gap = s.oppSeed - s.seed;
		if (s.win && gap <= -3) {
			out.push(
				mk({
					id: "t-upset",
					group: "t-playoffs",
					theme: "playoffs",
					score: Math.min(0.9, 0.4 + -gap * 0.08),
					kicker: "The upset",
					tid,
					season,
					heads: [
						`The No. ${s.seed} seed ${X.teamName(tid!, season)} knocked off the No. ${s.oppSeed}`,
						`${X.teamName(tid!, season)} stunned ${X.teamName(s.oppTid, season)}`,
					],
					hero: { text: `${s.won}-${s.lost}`, unit: "series" },
					lines: [
						`Eliminated the No. ${s.oppSeed} seed, ${X.teamName(s.oppTid, season)}`,
					],
					facts: [`ups|${tid}|${season}|${s.round}`],
				}),
			);
		} else if (!s.win && gap <= -3) {
			continue;
		} else if (!s.win && gap >= 3) {
			out.push(
				mk({
					id: "t-upset-lost",
					group: "t-playoffs",
					theme: "playoffs",
					score: Math.min(0.75, 0.3 + gap * 0.06),
					kicker: "Upset victims",
					tid,
					season,
					heads: [
						`The No. ${s.seed} seed ${X.teamName(tid!, season)} fell to the No. ${s.oppSeed}`,
						`${X.teamName(s.oppTid, season)} shocked the ${X.teamAny(tid!, season)?.name}`,
					],
					hero: { text: `${s.won}-${s.lost}`, unit: "series" },
					lines: [`Lost to ${X.teamName(s.oppTid, season)}`],
				}),
			);
		}
	}
	return out;
};

const rival: Topic = ({ X, season, tid }) => {
	const ser = X.seriesOf(tid!, season);
	const last = ser.at(-1);
	if (!last) {
		return null;
	}
	let w = 0;
	let l = 0;
	let met = 0;
	for (const s of X.seasons) {
		if (s >= season) {
			break;
		}
		for (const x of X.seriesOf(tid!, s)) {
			if (x.oppTid === last.oppTid) {
				met += 1;
				if (x.win) {
					w += 1;
				} else {
					l += 1;
				}
			}
		}
	}
	if (met < 2) {
		return null;
	}
	return mk({
		id: "t-rival",
		group: "t-playoffs",
		theme: "history",
		score: Math.min(0.75, 0.3 + met * 0.1),
		kicker: "Old rivals",
		tid,
		season,
		heads: [
			`The ${X.teamName(tid!, season)} and ${X.teamName(last.oppTid, season)}: a playoff rivalry`,
			`Not the first time against the ${X.teamAny(last.oppTid, season)?.name}`,
		],
		hero: { text: `${met + 1}`, unit: "playoff series" },
		lines: [
			`Before this year: ${w}-${l} in series against them`,
			`${last.win ? "Won" : "Lost"} this year’s series ${last.won}-${last.lost}`,
		],
	});
};

const draftPicks: Topic = ({ X, season, tid }) => {
	if (!X.decided(season)) {
		return null;
	}
	const picks = X.L.players
		.filter(
			(p) =>
				p.draft.year === season && p.draft.tid === tid && p.draft.round >= 1,
		)
		.sort(
			(a, b) => a.draft.round - b.draft.round || a.draft.pick - b.draft.pick,
		);
	if (picks.length === 0) {
		return null;
	}
	const top = picks[0]!;
	return mk({
		id: "t-draftclass",
		group: "t-draft",
		theme: "draft",
		score: 0.3 + (top.draft.round === 1 && top.draft.pick <= 5 ? 0.3 : 0),
		kicker: "The draft",
		tid,
		season,
		pid: top.pid,
		who: X.teamName(tid!, season),
		heads: [
			top.draft.round === 1
				? `With the No. ${top.draft.pick} pick, ${top.name}`
				: `${top.name} headed the draft class`,
			`The ${season} draft haul`,
		],
		list: picks.slice(0, 5).map((p) => ({
			name: p.name,
			value:
				p.draft.round === 1
					? `No. ${p.draft.pick}`
					: `Rd ${p.draft.round}, ${p.draft.pick}`,
			pid: p.pid,
		})),
		lines: [`${plural(picks.length, "pick")} in all`],
	});
};

const tradeActivity: Topic = ({ X, season, tid }) => {
	const t = X.team(tid!, season);
	if (!t) {
		return null;
	}
	const acquired = X.teamLines(tid!, season).filter((l) => {
		const p = X.players.get(l.pid)!;
		return p.moves.some(
			(m) => m.season === season && m.tid === tid && m.type === "trade",
		);
	});
	if (acquired.length < 2) {
		return null;
	}
	const best = [...acquired].sort((a, b) => b.ws - a.ws)[0]!;
	return mk({
		id: "t-trades",
		group: "t-moves",
		theme: "moves",
		score: Math.min(0.7, 0.25 + acquired.length * 0.08),
		kicker: "The trade market",
		tid,
		season,
		pid: best.pid,
		who: X.teamName(tid!, season),
		heads: [
			`${plural(acquired.length, "player")} came in by trade`,
			`The ${X.teamAny(tid!, season)?.name} were busy on the trade market`,
		],
		list: acquired
			.sort((a, b) => b.ws - a.ws)
			.slice(0, 4)
			.map((l) => ({
				name: l.name,
				value: `${fmtNum(l.ppg, 1)} PPG`,
				pid: l.pid,
			})),
		lines: [
			typeof t.numPlayersTradedAway === "number" && t.numPlayersTradedAway > 0
				? `${plural(t.numPlayersTradedAway, "player")} went the other way`
				: null,
		],
	});
};

const injuryToll: Topic = ({ X, season, tid }) => {
	const t = X.team(tid!, season);
	if (!t) {
		return null;
	}
	const toll = (id: number) =>
		X.teamLines(id, season).reduce(
			(a, l) =>
				a +
				(X.players
					.get(l.pid)
					?.injuries.filter((i) => i.season === season)
					.reduce((b, i) => b + i.games, 0) ?? 0),
			0,
		);
	const all = X.teamsIn(season).map((x) => toll(x.tid));
	const mine = toll(tid!);
	if (mine < 40 || all.length < 6) {
		return null;
	}
	const rank = rankOf(all, mine);
	const worst = [...X.teamLines(tid!, season)]
		.map((l) => ({
			l,
			g: X.players
				.get(l.pid)!
				.injuries.filter((i) => i.season === season)
				.reduce((b, i) => b + i.games, 0),
		}))
		.sort((a, b) => b.g - a.g)[0]!;
	return mk({
		id: "t-injuries",
		group: "t-health",
		theme: "people",
		score: rankScore(rank, all.length) * 0.75,
		kicker: "The injury bug",
		tid,
		season,
		pid: worst.l.pid,
		who: X.teamName(tid!, season),
		heads: [
			`${fmtNum(mine)} player-games lost to injury`,
			`The training room stayed busy`,
		],
		hero: { text: fmtNum(mine), unit: "player-games missed" },
		lines: [
			`${nth(rank, "most")} in the league`,
			`Most affected: ${worst.l.name}, ${plural(worst.g, "game")}`,
		],
	});
};

const world: Topic = ({ X, season, tid }) => {
	const rows = X.teamLines(tid!, season);
	if (rows.length < 6) {
		return null;
	}
	const places = new Map<string, number>();
	for (const l of rows) {
		const loc = X.players.get(l.pid)?.bornLoc;
		if (loc) {
			places.set(loc, (places.get(loc) ?? 0) + 1);
		}
	}
	const all = X.teamsIn(season).map(
		(t) =>
			new Set(
				X.teamLines(t.tid, season)
					.map((l) => X.players.get(l.pid)?.bornLoc)
					.filter(Boolean),
			).size,
	);
	const n = places.size;
	if (n < 4) {
		return null;
	}
	const rank = rankOf(all, n);
	return mk({
		id: "t-world",
		group: "t-roster",
		theme: "people",
		score: Math.max(0.2, rankScore(rank, all.length)) * 0.7,
		kicker: "Around the world",
		tid,
		season,
		who: X.teamName(tid!, season),
		heads: [
			`Players from ${n} different places`,
			`A roster with roots in ${n} places`,
		],
		hero: { text: `${n}`, unit: "birthplaces" },
		lines: [
			[...places.entries()]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 4)
				.map(([k, v]) => `${k} (${v})`)
				.join(", "),
		],
	});
};

const tenure: Topic = ({ X, season, tid }) => {
	const rows = X.teamLines(tid!, season).filter((l) => l.gp >= 20);
	let best: { l: SeasonLine; years: number } | undefined;
	for (const l of rows) {
		let years = 0;
		for (let s = season; s >= X.seasons[0]!; s--) {
			if (X.teamLines(tid!, s).some((x) => x.pid === l.pid)) {
				years += 1;
			} else {
				break;
			}
		}
		if (!best || years > best.years) {
			best = { l, years };
		}
	}
	if (!best || best.years < 5) {
		return null;
	}
	return mk({
		id: "t-tenure",
		group: "t-roster",
		theme: "moves",
		score: Math.min(0.7, 0.25 + (best.years - 5) * 0.07),
		kicker: "The longest tenure",
		tid,
		season,
		pid: best.l.pid,
		heads: [
			`${best.l.name} has been here ${best.years} seasons`,
			`The face of the franchise: ${best.l.name}`,
		],
		hero: { text: `${best.years}`, unit: "seasons with the team" },
		lines: [`${fmtNum(best.l.ppg, 1)} points a game this season`],
	});
};

const duo: Topic = ({ X, season, tid }) => {
	const rows = X.teamLines(tid!, season)
		.filter((l) => l.gp >= 10)
		.sort((a, b) => b.ws - a.ws);
	if (rows.length < 3) {
		return null;
	}
	const [a, b] = [rows[0]!, rows[1]!];
	const sum = a.ws + b.ws;
	const all = X.cached("duos", () =>
		allTeamSeasons(X).map((t) => {
			const r = X.teamLines(t.tid, t.season)
				.filter((l) => l.gp >= 10)
				.sort((x, y) => y.ws - x.ws);
			return r.length >= 2 ? r[0]!.ws + r[1]!.ws : 0;
		}),
	);
	if (all.length < 20) {
		return null;
	}
	const rank = rankOf(all, sum);
	return mk({
		id: "t-duo",
		group: "t-roster",
		theme: "people",
		score: rankScore(rank, all.length) * 0.8,
		kicker: "The duo",
		tid,
		season,
		pid: a.pid,
		who: X.teamName(tid!, season),
		heads: [
			`${a.name} and ${b.name}: ${fmtNum(sum, 1)} win shares between them`,
			`A two-man show`,
		],
		hero: { text: fmtNum(sum, 1), unit: "combined win shares" },
		list: [a, b].map((l) => ({
			name: l.name,
			value: `${fmtNum(l.ws, 1)} WS`,
			pid: l.pid,
		})),
		lines: [
			`${nth(rank, "best")} duo of ${fmtNum(all.length)} team seasons in history`,
		],
	});
};

const benchShare: Topic = ({ X, season, tid }) => {
	const rows = X.teamLines(tid!, season);
	const tot = rows.reduce((a, l) => a + l.pts, 0);
	if (rows.length < 6 || tot <= 0) {
		return null;
	}
	const share = (id: number) => {
		const r = X.teamLines(id, season);
		const t = r.reduce((a, l) => a + l.pts, 0);
		return t > 0
			? r.filter((l) => l.gs < l.gp * 0.5).reduce((a, l) => a + l.pts, 0) / t
			: undefined;
	};
	const all = X.teamsIn(season)
		.map((t) => share(t.tid))
		.filter(isNum);
	const mine = share(tid!)!;
	if (all.length < 6 || new Set(all).size < 4 || mine <= 0) {
		return null;
	}
	const w = twoWay(all, mine);
	return mk({
		id: "t-bench",
		group: "t-roster",
		theme: "scoring",
		score: w.score * 0.6,
		kicker: "The bench",
		tid,
		season,
		who: X.teamName(tid!, season),
		heads: w.high
			? [
					`${pct(mine, 0)} of the points came off the bench`,
					`The reserves carried the scoring`,
				]
			: [
					`Starters did ${pct(1 - mine, 0)} of the scoring`,
					`The bench barely scored`,
				],
		hero: { text: pct(mine, 0), unit: "of points from reserves" },
		lines: [
			`${nth(w.rank, w.high ? "most" : "least")} bench scoring in the league`,
		],
	});
};

const ringed: Topic = ({ X, season, tid }) => {
	const rows = X.teamLines(tid!, season).filter((l) => l.gp >= 10);
	const champs = rows.filter((l) =>
		X.players
			.get(l.pid)!
			.awards.some(
				(a) =>
					a.type === "Won Championship" &&
					a.season < season &&
					X.decided(a.season),
			),
	);
	if (champs.length < 2) {
		return null;
	}
	return mk({
		id: "t-ringed",
		group: "t-roster",
		theme: "history",
		score: Math.min(0.75, 0.3 + champs.length * 0.1),
		kicker: "Champions in the locker room",
		tid,
		season,
		who: X.teamName(tid!, season),
		heads: [
			`${plural(champs.length, "past champion")} on the roster`,
			`Rings in the room`,
		],
		list: champs.slice(0, 4).map((l) => ({
			name: l.name,
			value: plural(
				X.countAwards(X.players.get(l.pid)!, "Won Championship", season - 1),
				"ring",
			),
			pid: l.pid,
		})),
	});
};

const leagueLeaders: Topic = ({ X, season, tid, soFar }) => {
	const q = X.qualified(season);
	if (q.length < 10) {
		return null;
	}
	const cats: [string, (l: SeasonLine) => number][] = [
		["scoring", (l) => l.ppg],
		["rebounds", (l) => l.rpg],
		["assists", (l) => l.apg],
		["steals", (l) => l.spg],
		["blocks", (l) => l.bpg],
		["PER", (l) => l.per],
		...(soFar
			? []
			: ([["win shares", (l: SeasonLine) => l.ws]] as [
					string,
					(l: SeasonLine) => number,
				][])),
	];
	const led: { cat: string; l: SeasonLine }[] = [];
	for (const [cat, f] of cats) {
		const top = [...q].sort((a, b) => f(b) - f(a))[0]!;
		if (top.tid === tid) {
			led.push({ cat, l: top });
		}
	}
	if (led.length < 2) {
		return null;
	}
	return mk({
		id: "t-leaders",
		group: "t-honors",
		theme: "scoring",
		score: Math.min(0.85, 0.4 + led.length * 0.12),
		kicker: "League leaders",
		tid,
		season,
		pid: led[0]!.l.pid,
		who: X.teamName(tid!, season),
		heads: [
			`${led.length} league leaders wore their jersey`,
			`Topping the charts: ${led.map((x) => x.cat).join(" and ")}`,
		],
		list: led.map((x) => ({
			name: x.l.name,
			value: `Led in ${x.cat}`,
			pid: x.l.pid,
		})),
	});
};

const topSalary: Topic = ({ X, season, tid, soFar }) => {
	if (soFar) {
		return null;
	}
	const rows = X.teamLines(tid!, season)
		.map((l) => ({
			l,
			paid: (X.players.get(l.pid)?.paid ?? [])
				.filter((x) => x.season === season && x.tid === tid)
				.reduce((a, x) => a + x.amount, 0),
		}))
		.filter((x) => x.paid > 0)
		.sort((a, b) => b.paid - a.paid);
	const top = rows[0];
	if (!top || rows.length < 5) {
		return null;
	}
	const teamRows = [...X.teamLines(tid!, season)].sort((a, b) => b.ws - a.ws);
	const wsRank = teamRows.findIndex((x) => x.pid === top.l.pid) + 1;
	const good = wsRank <= 2;
	return mk({
		id: "t-topsalary",
		group: "t-money",
		theme: "money",
		score: good ? 0.4 : wsRank >= 5 ? 0.55 : 0.3,
		kicker: "The big contract",
		tid,
		season,
		pid: top.l.pid,
		heads: good
			? [
					`${top.l.name}: the highest-paid and the best on the team`,
					`The money went to the right player`,
				]
			: [
					`${top.l.name} was the highest-paid, but ranked ${ordinal(wsRank)} on the team in win shares`,
					`${money(top.paid)} for ${top.l.name}`,
				],
		hero: { text: money(top.paid), unit: "salary" },
		lines: [
			`${fmtNum(top.l.ppg, 1)} points, ${fmtNum(top.l.ws, 1)} win shares`,
			`${nth(wsRank, "most")} win shares on the roster`,
		],
	});
};

const endStreak: Topic = ({ X, season, tid }) => {
	const t = X.team(tid!, season);
	if (!t || !X.decided(season) || !isNum(t.streak) || Math.abs(t.streak) < 6) {
		return null;
	}
	return mk({
		id: "t-endstreak",
		group: "t-streaks",
		theme: "games",
		score: Math.min(0.55, 0.2 + (Math.abs(t.streak) - 6) * 0.04),
		kicker: "How it ended",
		tid,
		season,
		heads: [
			t.streak > 0
				? `The regular season ended on a ${t.streak}-game winning streak`
				: `The regular season ended on a ${-t.streak}-game skid`,
		],
		hero: {
			text: `${Math.abs(t.streak)}`,
			unit:
				t.streak > 0 ? "straight wins to finish" : "straight losses to finish",
		},
		lines: [`Final record: ${t.won}-${t.lost}`],
	});
};

const confRank: Topic = ({ X, season, tid }) => {
	const t = X.team(tid!, season);
	if (!t || t.cid === undefined || !X.L.confs || X.L.confs.length < 2) {
		return null;
	}
	const mates = X.teamsIn(season)
		.filter((x) => x.cid === t.cid)
		.sort((a, b) => wpOf(b) - wpOf(a));
	const rank = mates.findIndex((x) => x.tid === tid) + 1;
	const conf = X.L.confs.find((c) => c.cid === t.cid)?.name;
	if (!conf || mates.length < 4 || (rank > 2 && rank < mates.length - 1)) {
		return null;
	}
	const gamesBack = mates[0]!.won - t.won;
	return mk({
		id: "t-confrank",
		group: "t-schedule",
		theme: "schedule",
		score: rank === 1 ? 0.5 : rank === mates.length ? 0.35 : 0.3,
		kicker: `The ${conf}`,
		tid,
		season,
		heads: [
			rank === 1
				? `Best record in the ${conf}`
				: rank === mates.length
					? `Last place in the ${conf}`
					: `${ordinal(rank)} in the ${conf}`,
		],
		hero: { text: ordinal(rank), unit: `of ${mates.length} in the ${conf}` },
		lines: [
			rank > 1
				? `${gamesBack} wins behind the leader, ${X.teamName(mates[0]!.tid, season)}`
				: `${t.won - mates[1]!.won} wins clear of ${X.teamName(mates[1]!.tid, season)}`,
		],
	});
};

// ---------------------------------------------------------------------------------------------
// Box-score extras
// ---------------------------------------------------------------------------------------------

const teamGames = (X: X, season: number, tid: number) =>
	X.games(season).filter((g) => g.teams.some((t) => t.tid === tid));

const overtime: Topic = ({ X, season, tid }) => {
	const gs = teamGames(X, season, tid!).filter(
		(g) => g.overtimes > 0 && !g.playoffs,
	);
	if (gs.length < 3) {
		return null;
	}
	const w = gs.filter((g) => {
		const me = g.teams.find((t) => t.tid === tid)!;
		const o = g.teams.find((t) => t.tid !== tid)!;
		return me.pts > o.pts;
	}).length;
	return mk({
		id: "t-ot",
		group: "t-games",
		theme: "games",
		score: Math.min(0.6, 0.25 + gs.length * 0.04),
		kicker: "Extra time",
		tid,
		season,
		who: X.teamName(tid!, season),
		heads: [
			`${w}-${gs.length - w} in overtime games`,
			`${plural(gs.length, "game")} went to overtime`,
		],
		hero: { text: `${w}-${gs.length - w}`, unit: "in overtime" },
		lines: [],
	});
};

const routs: Topic = ({ X, season, tid }) => {
	const gs = teamGames(X, season, tid!).filter((g) => !g.playoffs);
	if (gs.length < 30) {
		return null;
	}
	const margin = (g: (typeof gs)[number]) => {
		const me = g.teams.find((t) => t.tid === tid)!;
		const o = g.teams.find((t) => t.tid !== tid)!;
		return me.pts - o.pts;
	};
	const big = gs.filter((g) => margin(g) >= 20).length;
	const lost = gs.filter((g) => margin(g) <= -20).length;
	if (big < 3 && lost < 3) {
		return null;
	}
	const wins = big >= lost;
	const n = wins ? big : lost;
	return mk({
		id: "t-routs",
		group: "t-games",
		theme: "games",
		score: Math.min(0.65, 0.2 + n * 0.04),
		kicker: wins ? "Blowouts" : "Rough nights",
		tid,
		season,
		who: X.teamName(tid!, season),
		heads: wins
			? [`${plural(n, "win")} by 20 or more`]
			: [`${plural(n, "loss", "losses")} by 20 or more`],
		hero: { text: `${n}`, unit: wins ? "wins by 20+" : "losses by 20+" },
		lines: [
			wins
				? `Also lost by 20+ ${plural(lost, "time")}`
				: `Also won by 20+ ${plural(big, "time")}`,
		],
	});
};

const quarters: Topic = ({ X, season, tid }) => {
	const gs = teamGames(X, season, tid!).filter(
		(g) => !g.playoffs && g.teams.every((t) => (t.ptsQtrs?.length ?? 0) >= 4),
	);
	if (gs.length < 30) {
		return null;
	}
	const diff = [0, 0, 0, 0];
	for (const g of gs) {
		const me = g.teams.find((t) => t.tid === tid)!;
		const o = g.teams.find((t) => t.tid !== tid)!;
		for (let q = 0; q < 4; q++) {
			diff[q]! += me.ptsQtrs![q]! - o.ptsQtrs![q]!;
		}
	}
	const per = diff.map((d) => d / gs.length);
	const bi = per.indexOf(Math.max(...per));
	const wi = per.indexOf(Math.min(...per));
	if (per[bi]! < 0.8) {
		return null;
	}
	return mk({
		id: "t-quarters",
		group: "t-games",
		theme: "games",
		score: Math.min(0.6, 0.2 + per[bi]! / 6),
		kicker: "Quarter by quarter",
		tid,
		season,
		who: X.teamName(tid!, season),
		heads: [
			`The ${ordinal(bi + 1)} quarter was their best`,
			`Winning the ${ordinal(bi + 1)} quarter, game after game`,
		],
		list: per.map((d, i) => ({
			name: `${ordinal(i + 1)} quarter`,
			value: `${d >= 0 ? "+" : ""}${fmtNum(d, 1)}`,
		})),
		lines: [
			`Worst quarter: the ${ordinal(wi + 1)}, ${per[wi]! >= 0 ? "+" : ""}${fmtNum(per[wi]!, 1)}`,
		],
	});
};

const vsChamps: Topic = ({ X, season, tid }) => {
	const c = X.champion(season);
	if (!c || c.tid === tid) {
		return null;
	}
	const gs = teamGames(X, season, tid!).filter((g) =>
		g.teams.some((t) => t.tid === c.tid),
	);
	if (gs.length < 2) {
		return null;
	}
	const w = gs.filter((g) => {
		const me = g.teams.find((t) => t.tid === tid)!;
		const o = g.teams.find((t) => t.tid !== tid)!;
		return me.pts > o.pts;
	}).length;
	return mk({
		id: "t-vschamp",
		group: "t-games",
		theme: "games",
		score: w === gs.length ? 0.6 : w === 0 ? 0.3 : 0.35,
		kicker: "Against the champions",
		tid,
		season,
		who: X.teamName(tid!, season),
		heads: [
			`${w}-${gs.length - w} against the eventual champions`,
			`Games with the ${c.name}`,
		],
		hero: { text: `${w}-${gs.length - w}`, unit: `vs ${c.region} ${c.name}` },
		lines: [],
	});
};

export const X_TEAM: Topic[] = [
	...TEAM_RATE,
	drought,
	frRecord,
	bubble,
	upset,
	rival,
	draftPicks,
	tradeActivity,
	injuryToll,
	world,
	tenure,
	duo,
	benchShare,
	ringed,
	leagueLeaders,
	topSalary,
	endStreak,
	confRank,
	overtime,
	routs,
	quarters,
	vsChamps,
];
