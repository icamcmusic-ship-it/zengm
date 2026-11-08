// Extra season topics: league leaders in more stats, the league as a whole against its history, rosters and money across teams, awards and playoff shapes.
import type { SeasonLine } from "../league.ts";
import type { Slide, SlideListRow, WTeamSeason } from "../types.ts";
import { fmtNum, isNum, ordinal, plural, rankOf, rankScore } from "../util.ts";
import { mk, type Topic } from "./helpers.ts";
import {
	allTeamSeasons,
	leaderSlide,
	money,
	nth,
	pct,
	twoWay,
	wavg,
	wl,
	wpOf,
	type X,
} from "./kit.ts";
import { PLAYER_DEFS } from "./xplayer.ts";

// ---------------------------------------------------------------------------------------------
// Leaders in the newer stats
// ---------------------------------------------------------------------------------------------

const LEADS: Record<
	string,
	{ kicker: string; heads: (n: string, v: number) => string[]; low?: boolean }
> = {
	"p-plusminus": {
		kicker: "Best plus-minus",
		heads: (n, v) => [
			`${n}’s team won his minutes by ${fmtNum(v, 1)} a game`,
			`The plus-minus king: ${n}`,
		],
	},
	"p-ortg": {
		kicker: "Best offensive rating",
		heads: (n, v) => [
			`${n} had the league’s best offensive rating: ${fmtNum(v, 0)}`,
			`The most efficient offense on the floor: ${n}`,
		],
	},
	"p-drtg": {
		kicker: "Best defensive rating",
		heads: (n, v) => [
			`${n} held opponents to ${fmtNum(-v, 0)} per 100 possessions`,
			`The best defender by rating: ${n}`,
		],
	},
	"p-usage": {
		kicker: "Highest usage",
		heads: (n, v) => [
			`The offense ran through ${n}: ${fmtNum(v, 0)}% usage`,
			`${n} used the most possessions in the league`,
		],
	},
	"p-ftpct": {
		kicker: "Best free-throw shooter",
		heads: (n, v) => [
			`${n} led the league at the line: ${fmtNum(v * 100, 1)}%`,
			`The best free-throw shooter: ${n}`,
		],
	},
	"p-3pct": {
		kicker: "Best three-point shooter",
		heads: (n, v) => [
			`${n} shot ${fmtNum(v * 100, 1)}% from three`,
			`The deadliest shooter from deep: ${n}`,
		],
	},
	"p-ws48": {
		kicker: "Wins per minute",
		heads: (n) => [
			`${n} added wins faster than anyone`,
			`The most efficient winner: ${n}`,
		],
	},
	"p-stocks": {
		kicker: "Best defensive playmaker",
		heads: (n, v) => [
			`${n} made ${fmtNum(v, 1)} steals and blocks a game`,
			`Disruptor in chief: ${n}`,
		],
	},
	"p-dd": {
		kicker: "Double-double machine",
		heads: (n, v) => [
			`${n} led the league with ${fmtNum(v)} double-doubles`,
			`The double-double leader: ${n}`,
		],
	},
	"p-td": {
		kicker: "Triple-double leader",
		heads: (n, v) => [
			`${n} had ${fmtNum(v)} triple-doubles`,
			`Triple-double king: ${n}`,
		],
	},
	"p-orb": {
		kicker: "Offensive glass",
		heads: (n, v) => [
			`${n} grabbed ${fmtNum(v, 1)} offensive rebounds a game`,
			`Second chances belonged to ${n}`,
		],
	},
	"p-fta": {
		kicker: "Most free throws",
		heads: (n, v) => [
			`${n} went to the line ${fmtNum(v, 1)} times a game`,
			`The foul-drawer: ${n}`,
		],
	},
	"p-ratio": {
		kicker: "Best ball security",
		heads: (n, v) => [
			`${n} had ${fmtNum(v, 1)} assists per turnover`,
			`The safest hands: ${n}`,
		],
	},
	"p-vorp": {
		kicker: "Most value over replacement",
		heads: (n, v) => [
			`${n} led the league in VORP: ${fmtNum(v, 1)}`,
			`The most valuable by VORP: ${n}`,
		],
	},
	"p-mpg": {
		kicker: "The workhorse",
		heads: (n, v) => [
			`${n} played the most minutes a game: ${fmtNum(v, 1)}`,
			`${n} barely came off the floor`,
		],
	},
	"p-efg": {
		kicker: "Most efficient shooter",
		heads: (n, v) => [
			`${n} had the highest effective FG%: ${fmtNum(v * 100, 1)}`,
			`Ruthless efficiency: ${n}`,
		],
	},
};

const leaders: Topic = (ctx) => {
	const out: Slide[] = [];
	for (const d of PLAYER_DEFS) {
		const c = LEADS[d.id];
		if (!c) {
			continue;
		}
		const s = leaderSlide(ctx, d, c.heads, c.kicker, c.low);
		if (s) {
			out.push(s);
		}
	}
	return out;
};

// ---------------------------------------------------------------------------------------------
// The league against its own history
// ---------------------------------------------------------------------------------------------

type SeasonVal = { season: number; v: number };

const leagueBoard = (
	X: X,
	key: string,
	f: (season: number) => number | undefined,
): SeasonVal[] =>
	X.cached(`lg|${key}`, () => {
		const out: SeasonVal[] = [];
		for (const s of X.seasons) {
			const v = f(s);
			if (isNum(v)) {
				out.push({ season: s, v });
			}
		}
		return out;
	});

const leagueSlide = (
	X: X,
	season: number,
	o: {
		id: string;
		group: string;
		theme: string;
		kicker: string;
		f: (s: number) => number | undefined;
		show: (v: number) => string;
		unit: string;
		hi: (v: number, rank: number, n: number) => string[];
		lo?: (v: number, rank: number, n: number) => string[];
		w: number;
		lines?: (v: number) => (string | null)[];
	},
): Slide | null => {
	const board = leagueBoard(X, o.id, o.f);
	const me = board.find((b) => b.season === season);
	if (!me || board.length < 4) {
		return null;
	}
	const vals = board.map((b) => b.v);
	const w = o.lo
		? twoWay(vals, me.v)
		: { high: true, rank: rankOf(vals, me.v) };
	const score = rankScore(w.rank, vals.length) * o.w;
	// A short history says little, so cap the score
	const cap = Math.min(1, 0.35 + vals.length * 0.04);
	if (score * cap < 0.12) {
		return null;
	}
	const others = board
		.filter((b) => b.season !== season && (w.high ? b.v >= me.v : b.v <= me.v))
		.sort((a, b) => b.season - a.season)[0];
	return mk({
		id: o.id,
		group: o.group,
		theme: o.theme,
		score: score * cap,
		kicker: o.kicker,
		season,
		heads: w.high
			? o.hi(me.v, w.rank, vals.length)
			: o.lo!(me.v, w.rank, vals.length),
		hero: { text: o.show(me.v), unit: o.unit },
		lines: [
			w.rank === 1
				? `The ${w.high ? "highest" : "lowest"} of ${plural(vals.length, "season")} in league history`
				: `${nth(w.rank, w.high ? "highest" : "lowest")} of ${plural(vals.length, "season")}`,
			others
				? `Last season this ${w.high ? "high" : "low"}: ${others.season}`
				: null,
			...(o.lines?.(me.v) ?? []),
		],
	});
};

const teamGames = (X: X, season: number) => {
	const ts = X.teamsIn(season).filter((t) => t.gp > 0);
	return ts.reduce((a, t) => a + t.gp, 0);
};

const sumLines = (X: X, season: number, f: (l: SeasonLine) => number) =>
	X.lines(season).reduce((a, l) => a + f(l), 0);

const leagueHistory: Topic = ({ X, season }) => {
	const out: (Slide | null)[] = [];
	const perGame = (f: (l: SeasonLine) => number) => (s: number) => {
		const g = teamGames(X, s);
		return g >= 100 ? sumLines(X, s, f) / g : undefined;
	};
	out.push(
		leagueSlide(X, season, {
			id: "s-threes",
			group: "s-league",
			theme: "scoring",
			kicker: "The three-point era",
			f: perGame((l) => l.tp),
			show: (v) => fmtNum(v, 1),
			unit: "threes per team per game",
			hi: (v) => [
				`Teams made ${fmtNum(v, 1)} threes a game`,
				`The three-ball took over`,
			],
			lo: (v) => [
				`Just ${fmtNum(v, 1)} threes a game per team`,
				`Not much shooting from deep`,
			],
			w: 0.9,
		}),
		leagueSlide(X, season, {
			id: "s-ts",
			group: "s-league",
			theme: "efficiency",
			kicker: "League efficiency",
			f: (s) => {
				const pts = sumLines(X, s, (l) => l.pts);
				const tsa = sumLines(X, s, (l) => 2 * (l.fga + 0.44 * l.fta));
				return tsa > 5000 ? pts / tsa : undefined;
			},
			show: (v) => pct(v),
			unit: "league true shooting",
			hi: (v) => [
				`The league shot ${pct(v)} true shooting`,
				`Offense was never this efficient`,
			],
			lo: (v) => [
				`A league-wide shooting slump: ${pct(v)}`,
				`Buckets were hard to come by`,
			],
			w: 0.85,
		}),
		leagueSlide(X, season, {
			id: "s-ppg",
			group: "s-league",
			theme: "scoring",
			kicker: "Scoring",
			f: (s) => {
				const ts = X.teamsIn(s).filter((t) => t.gp > 0);
				const gp = ts.reduce((a, t) => a + t.gp, 0);
				return gp >= 100 ? ts.reduce((a, t) => a + t.pts, 0) / gp : undefined;
			},
			show: (v) => fmtNum(v, 1),
			unit: "points per team per game",
			hi: (v) => [
				`Teams averaged ${fmtNum(v, 1)} points a game`,
				`Points were everywhere`,
			],
			lo: (v) => [
				`Teams scored just ${fmtNum(v, 1)} a game`,
				`A defensive slog of a season`,
			],
			w: 0.85,
		}),
		leagueSlide(X, season, {
			id: "s-fta",
			group: "s-league",
			theme: "scoring",
			kicker: "Free throws",
			f: perGame((l) => l.fta),
			show: (v) => fmtNum(v, 1),
			unit: "free-throw attempts per team per game",
			hi: (v) => [
				`Teams shot ${fmtNum(v, 1)} free throws a game`,
				`The whistles were busy`,
			],
			lo: (v) => [
				`Teams got to the line just ${fmtNum(v, 1)} times a game`,
				`The whistle stayed in pockets`,
			],
			w: 0.7,
		}),
		leagueSlide(X, season, {
			id: "s-assists",
			group: "s-league",
			theme: "playmaking",
			kicker: "Ball movement",
			f: perGame((l) => l.ast),
			show: (v) => fmtNum(v, 1),
			unit: "assists per team per game",
			hi: (v) => [
				`Teams averaged ${fmtNum(v, 1)} assists a game`,
				`The ball moved more than ever`,
			],
			lo: (v) => [
				`Only ${fmtNum(v, 1)} assists per team per game`,
				`Isolation basketball ruled`,
			],
			w: 0.7,
		}),
		leagueSlide(X, season, {
			id: "s-turnovers",
			group: "s-league",
			theme: "playmaking",
			kicker: "Giveaways",
			f: perGame((l) => l.tov),
			show: (v) => fmtNum(v, 1),
			unit: "turnovers per team per game",
			hi: (v) => [
				`${fmtNum(v, 1)} turnovers per team per game`,
				`Sloppy basketball all season`,
			],
			lo: (v) => [
				`Only ${fmtNum(v, 1)} turnovers per team per game`,
				`The cleanest basketball in league history`,
			],
			w: 0.6,
		}),
		leagueSlide(X, season, {
			id: "s-homewin",
			group: "s-league",
			theme: "schedule",
			kicker: "Home-court advantage",
			f: (s) => {
				const ts = X.teamsIn(s);
				const w = ts.reduce((a, t) => a + (t.wonHome ?? 0), 0);
				const l = ts.reduce((a, t) => a + (t.lostHome ?? 0), 0);
				return w + l > 200 ? w / (w + l) : undefined;
			},
			show: (v) => pct(v, 1),
			unit: "home teams won",
			hi: (v) => [
				`Home teams won ${pct(v, 1)} of the time`,
				`Home court mattered more than ever`,
			],
			lo: (v) => [
				`Home teams won only ${pct(v, 1)}`,
				`Home court meant very little`,
			],
			w: 0.8,
		}),
		leagueSlide(X, season, {
			id: "s-attendance",
			group: "s-league",
			theme: "people",
			kicker: "The crowds",
			f: (s) => {
				const ts = X.teamsIn(s).filter((t) => (t.gpHome ?? 0) > 10);
				const gp = ts.reduce((a, t) => a + (t.gpHome ?? 0), 0);
				return gp > 100
					? ts.reduce((a, t) => a + (t.att ?? 0), 0) / gp
					: undefined;
			},
			show: (v) => fmtNum(v, 0),
			unit: "fans per game, league-wide",
			hi: (v) => [
				`The average crowd: ${fmtNum(v, 0)} fans`,
				`Arenas were filling up`,
			],
			lo: (v) => [
				`The average crowd shrank to ${fmtNum(v, 0)}`,
				`Empty seats around the league`,
			],
			w: 0.7,
		}),
		leagueSlide(X, season, {
			id: "s-payroll",
			group: "s-money",
			theme: "money",
			kicker: "The money",
			f: (s) => {
				const ts = X.teamsIn(s).filter(
					(t) => isNum(t.payroll) && t.payroll > 0,
				);
				return ts.length >= 6 && X.decided(s)
					? ts.reduce((a, t) => a + t.payroll!, 0) / ts.length
					: undefined;
			},
			show: (v) => money(v),
			unit: "average payroll",
			hi: (v) => [
				`The average team spent ${money(v)}`,
				`Payrolls hit a new level`,
			],
			lo: (v) => [
				`The average payroll was only ${money(v)}`,
				`Teams kept the checkbook closed`,
			],
			w: 0.6,
		}),
	);
	return out.filter((s): s is Slide => s !== null);
};

// ---------------------------------------------------------------------------------------------
// Teams across the league
// ---------------------------------------------------------------------------------------------

const bestOf = (
	X: X,
	season: number,
	f: (t: WTeamSeason) => number | undefined,
	low = false,
) => {
	const rows = X.teamsIn(season)
		.map((t) => ({ t, v: f(t) }))
		.filter((x): x is { t: WTeamSeason; v: number } => isNum(x.v))
		.sort((a, b) => (low ? a.v - b.v : b.v - a.v));
	return rows;
};

const homeRoad: Topic = ({ X, season }) => {
	const out: Slide[] = [];
	const all = allTeamSeasons(X);
	const home = (t: WTeamSeason) => {
		const h = wl(t.wonHome, t.lostHome);
		return h && h.w + h.l >= 10 ? h.w / (h.w + h.l) : undefined;
	};
	const road = (t: WTeamSeason) => {
		const h = wl(t.wonAway, t.lostAway);
		return h && h.w + h.l >= 10 ? h.w / (h.w + h.l) : undefined;
	};
	for (const [id, f, kicker, label] of [
		["s-fortress", home, "Best at home", "home"],
		["s-roadtrip", road, "Best on the road", "road"],
	] as const) {
		const rows = bestOf(X, season, f);
		const top = rows[0];
		if (!top || rows.length < 6) {
			continue;
		}
		const board = all.map(f).filter(isNum);
		const rank = rankOf(board, top.v);
		const rec =
			label === "home"
				? `${top.t.wonHome}-${top.t.lostHome}`
				: `${top.t.wonAway}-${top.t.lostAway}`;
		out.push(
			mk({
				id,
				group: "s-split",
				theme: "schedule",
				score: rankScore(rank, board.length) * 0.75,
				kicker,
				tid: top.t.tid,
				season,
				heads: [
					label === "home"
						? `${top.t.region} ${top.t.name}: ${rec} at home`
						: `${top.t.region} ${top.t.name} won ${rec} on the road`,
					label === "home"
						? `The toughest place to play: ${top.t.region}`
						: `The best road team: ${top.t.region} ${top.t.name}`,
				],
				hero: {
					text: rec,
					unit: label === "home" ? "home record" : "road record",
				},
				lines: [
					`${nth(rank, "best")} ${label} record of ${fmtNum(board.length)} team seasons`,
					rows[1]
						? `Next best: ${X.teamName(rows[1].t.tid, season)}, ${label === "home" ? `${rows[1].t.wonHome}-${rows[1].t.lostHome}` : `${rows[1].t.wonAway}-${rows[1].t.lostAway}`}`
						: null,
				],
			}),
		);
	}
	return out;
};

const payrollRace: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const rows = bestOf(X, season, (t) =>
		isNum(t.payroll) && t.payroll > 0 ? t.payroll : undefined,
	);
	if (rows.length < 6) {
		return null;
	}
	const top = rows[0]!;
	const bot = rows.at(-1)!;
	const topRank =
		[...X.teamsIn(season)]
			.sort((a, b) => wpOf(b) - wpOf(a))
			.findIndex((t) => t.tid === top.t.tid) + 1;
	const botRank =
		[...X.teamsIn(season)]
			.sort((a, b) => wpOf(b) - wpOf(a))
			.findIndex((t) => t.tid === bot.t.tid) + 1;
	const ratio = top.v / Math.max(1, bot.v);
	return mk({
		id: "s-paygap",
		group: "s-money",
		theme: "money",
		score: Math.min(0.7, 0.2 + (ratio - 1) * 0.5),
		kicker: "Big spenders and penny-pinchers",
		tid: top.t.tid,
		season,
		heads: [
			`${fmtNum(ratio, 1)} times more: the biggest and smallest payrolls`,
			`${X.teamName(top.t.tid, season)} outspent everyone`,
		],
		list: [
			{
				name: `${X.teamName(top.t.tid, season)} (biggest)`,
				value: money(top.v),
				sub: `${ordinal(topRank)} in the standings`,
				tid: top.t.tid,
			},
			{
				name: `${X.teamName(bot.t.tid, season)} (smallest)`,
				value: money(bot.v),
				sub: `${ordinal(botRank)} in the standings`,
				tid: bot.t.tid,
			},
		],
	});
};

const topSalaries: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const rows = X.lines(season)
		.map((l) => ({
			l,
			v: (X.players.get(l.pid)?.paid ?? [])
				.filter((x) => x.season === season)
				.reduce((a, x) => a + x.amount, 0),
		}))
		.filter((x) => x.v > 0)
		.sort((a, b) => b.v - a.v);
	if (rows.length < 20) {
		return null;
	}
	const all = X.cached("topPaidEver", () =>
		X.seasons.map((s) =>
			Math.max(
				0,
				...X.lines(s).map((l) =>
					(X.players.get(l.pid)?.paid ?? [])
						.filter((x) => x.season === s)
						.reduce((a, x) => a + x.amount, 0),
				),
			),
		),
	);
	const rank = rankOf(all, rows[0]!.v);
	return mk({
		id: "s-paid",
		group: "s-money",
		theme: "money",
		score: Math.max(0.2, rankScore(rank, all.length)) * 0.65,
		kicker: "Highest paid",
		pid: rows[0]!.l.pid,
		tid: rows[0]!.l.tid,
		season,
		heads: [
			`${rows[0]!.l.name} earned the most: ${money(rows[0]!.v)}`,
			`The highest salary of the year: ${rows[0]!.l.name}`,
		],
		list: rows
			.slice(0, 5)
			.map((x) => ({ name: x.l.name, value: money(x.v), pid: x.l.pid })),
		lines: [rank === 1 ? "The highest top salary in league history" : null],
	});
};

const ratingsTop: Topic = ({ X, season }) => {
	const rows = X.lines(season)
		.map((l) => ({ l, ovr: X.players.get(l.pid)?.ovr[season] }))
		.filter(
			(x): x is { l: SeasonLine; ovr: number } => isNum(x.ovr) && x.l.gp >= 10,
		)
		.sort((a, b) => b.ovr - a.ovr);
	if (rows.length < 20) {
		return null;
	}
	const top = rows[0]!;
	const mvp = X.awardWinner(season, "Most Valuable Player");
	return mk({
		id: "s-topovr",
		group: "s-ratings",
		theme: "ratings",
		score: 0.4,
		kicker: "The highest-rated",
		pid: top.l.pid,
		tid: top.l.tid,
		season,
		heads: [
			`${top.l.name} was the league’s highest-rated player at ${top.ovr}`,
			`The top ratings of ${season}`,
		],
		list: rows.slice(0, 5).map((x) => ({
			name: x.l.name,
			value: `${x.ovr}`,
			sub: X.teamName(x.l.tid, season),
			pid: x.l.pid,
		})),
		lines: [
			mvp && mvp.pid !== top.l.pid
				? `The MVP, ${mvp.name}, was rated ${X.players.get(mvp.pid)?.ovr[season] ?? "–"}`
				: null,
		],
	});
};

const biggestLeap: Topic = ({ X, season }) => {
	const rows = X.lines(season)
		.map((l) => {
			const p = X.players.get(l.pid)!;
			const a = p.ovr[season - 1];
			const b = p.ovr[season];
			return {
				l,
				d: isNum(a) && isNum(b) && l.gp >= 20 ? b - a : undefined,
				a,
				b,
			};
		})
		.filter((x): x is typeof x & { d: number } => isNum(x.d))
		.sort((a, b) => b.d - a.d);
	if (rows.length < 20 || rows[0]!.d < 4) {
		return null;
	}
	const top = rows[0]!;
	const down = rows.at(-1)!;
	return mk({
		id: "s-ovrjump",
		group: "s-ratings",
		theme: "ratings",
		score: Math.min(0.75, 0.2 + top.d * 0.06),
		kicker: "The biggest leaps",
		pid: top.l.pid,
		tid: top.l.tid,
		season,
		heads: [
			`${top.l.name} jumped ${top.d} points in rating`,
			`The year’s biggest rating leap: ${top.l.name}`,
		],
		list: rows.slice(0, 4).map((x) => ({
			name: x.l.name,
			value: `+${x.d}`,
			sub: `${x.a} to ${x.b}`,
			pid: x.l.pid,
		})),
		lines: [
			down.d <= -4 ? `The biggest drop: ${down.l.name}, ${down.d}` : null,
		],
	});
};

const movers: Topic = ({ X, season }) => {
	const rows = X.lines(season).filter((l) => l.tids.length >= 2 && l.gp >= 20);
	if (rows.length < 3) {
		return null;
	}
	const top = [...rows].sort((a, b) => b.ppg - a.ppg);
	return mk({
		id: "s-movers",
		group: "s-moves",
		theme: "moves",
		score: Math.min(0.55, 0.2 + rows.length * 0.02),
		kicker: "On the move",
		pid: top[0]!.pid,
		tid: top[0]!.tid,
		season,
		heads: [
			`${plural(rows.length, "player")} played for more than one team`,
			`Trades and moves reshaped the season`,
		],
		list: top.slice(0, 4).map((l) => ({
			name: l.name,
			value: `${fmtNum(l.ppg, 1)} PPG`,
			sub: l.tids.map((t) => X.teamAny(t, season)?.abbrev ?? "?").join(" → "),
			pid: l.pid,
		})),
	});
};

const worldSeason: Topic = ({ X, season }) => {
	const lines = X.lines(season);
	if (lines.length < 80) {
		return null;
	}
	const places = new Map<string, number>();
	for (const l of lines) {
		const loc = X.players.get(l.pid)?.bornLoc;
		if (loc) {
			places.set(loc, (places.get(loc) ?? 0) + 1);
		}
	}
	const n = places.size;
	if (n < 5) {
		return null;
	}
	const sorted = [...places.entries()].sort((a, b) => b[1] - a[1]);
	const foreign = lines.length - (sorted[0]?.[1] ?? 0);
	return mk({
		id: "s-world",
		group: "s-people",
		theme: "people",
		score: 0.3 + Math.min(0.2, n / 80),
		kicker: "Around the world",
		season,
		heads: [
			`Players from ${n} different places`,
			`A league of ${n} birthplaces`,
		],
		hero: { text: `${n}`, unit: "birthplaces" },
		list: sorted
			.slice(0, 5)
			.map(([k, v]) => ({ name: k, value: plural(v, "player") })),
		lines: [`${plural(foreign, "player")} came from outside ${sorted[0]![0]}`],
	});
};

const colleges: Topic = ({ X, season }) => {
	const lines = X.lines(season);
	const by = new Map<string, number>();
	for (const l of lines) {
		const c = X.players.get(l.pid)?.college;
		if (c) {
			by.set(c, (by.get(c) ?? 0) + 1);
		}
	}
	const sorted = [...by.entries()].sort((a, b) => b[1] - a[1]);
	const total = [...by.values()].reduce((a, b) => a + b, 0);
	if (total < 40 || sorted.length < 5 || sorted[0]![1] < 3) {
		return null;
	}
	return mk({
		id: "s-college",
		group: "s-people",
		theme: "people",
		score: 0.3,
		kicker: "Where they went to school",
		season,
		heads: [
			`${sorted[0]![0]} had ${sorted[0]![1]} players in the league`,
			`The college pipeline: ${sorted[0]![0]}`,
		],
		list: sorted
			.slice(0, 5)
			.map(([k, v]) => ({ name: k, value: plural(v, "player") })),
		lines: [`${plural(total, "player")} listed a college`],
	});
};

const ironmen: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const rows = X.lines(season).filter((l) => {
		const t = X.team(l.tid, season);
		return (
			t &&
			l.tids.length === 1 &&
			l.gp >= t.won + t.lost + t.tied + t.otl &&
			t.gp >= 20
		);
	});
	if (rows.length < 1) {
		return null;
	}
	const top = [...rows].sort((a, b) => b.mpg - a.mpg);
	return mk({
		id: "s-ironmen",
		group: "s-people",
		theme: "people",
		score: Math.min(0.5, 0.2 + rows.length * 0.04),
		kicker: "Never missed a game",
		pid: top[0]!.pid,
		tid: top[0]!.tid,
		season,
		heads: [
			`${plural(rows.length, "player")} played every game`,
			`${top[0]!.name} did not miss a game`,
		],
		list: top.slice(0, 4).map((l) => ({
			name: l.name,
			value: `${fmtNum(l.mpg, 1)} MPG`,
			pid: l.pid,
		})),
	});
};

const benchStar: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const rows = X.qualified(season).filter(
		(l) => l.gs <= l.gp * 0.15 && l.gp >= 30,
	);
	if (rows.length < 3) {
		return null;
	}
	const top = [...rows].sort((a, b) => b.ppg - a.ppg);
	const all = X.allQualified()
		.filter((l) => l.gs <= l.gp * 0.15 && l.gp >= 30)
		.map((l) => l.ppg);
	const rank = rankOf(all, top[0]!.ppg);
	return mk({
		id: "s-bench",
		group: "s-people",
		theme: "scoring",
		score: Math.max(0.2, rankScore(rank, all.length)) * 0.7,
		kicker: "Best off the bench",
		pid: top[0]!.pid,
		tid: top[0]!.tid,
		season,
		heads: [
			`${top[0]!.name} was the league’s top bench scorer`,
			`${fmtNum(top[0]!.ppg, 1)} a game without starting`,
		],
		hero: { text: fmtNum(top[0]!.ppg, 1), unit: "PPG off the bench" },
		list: top.slice(1, 4).map((l) => ({
			name: l.name,
			value: `${fmtNum(l.ppg, 1)} PPG`,
			pid: l.pid,
		})),
	});
};

const efficient: Topic = ({ X, season }) => {
	const rows = X.qualified(season).filter((l) => l.ppg >= 18);
	if (rows.length < 5) {
		return null;
	}
	const top = [...rows].sort((a, b) => b.tsPct - a.tsPct);
	const all = X.allQualified()
		.filter((l) => l.ppg >= 18)
		.map((l) => l.tsPct);
	const rank = rankOf(all, top[0]!.tsPct);
	return mk({
		id: "s-efficient",
		group: "s-people",
		theme: "efficiency",
		score: Math.max(0.2, rankScore(rank, all.length)) * 0.75,
		kicker: "Efficient scorers",
		pid: top[0]!.pid,
		tid: top[0]!.tid,
		season,
		heads: [
			`${top[0]!.name} scored ${fmtNum(top[0]!.ppg, 1)} a night on ${pct(top[0]!.tsPct)} true shooting`,
			`The most efficient high-volume scorer: ${top[0]!.name}`,
		],
		hero: { text: pct(top[0]!.tsPct), unit: "true shooting" },
		list: top.slice(1, 4).map((l) => ({
			name: l.name,
			value: `${pct(l.tsPct)} on ${fmtNum(l.ppg, 1)}`,
			pid: l.pid,
		})),
		lines: [`Among players averaging 18 or more points`],
		note: "TS%: true shooting, scoring efficiency counting threes and free throws",
	});
};

const scoringRace: Topic = ({ X, season }) => {
	const rows = [...X.qualified(season)].sort((a, b) => b.ppg - a.ppg);
	if (rows.length < 10) {
		return null;
	}
	const [a, b] = [rows[0]!, rows[1]!];
	const gap = a.ppg - b.ppg;
	const gaps = X.cached("scoreGaps", () =>
		X.seasons
			.map((s) => {
				const r = [...X.qualified(s)].sort((x, y) => y.ppg - x.ppg);
				return r.length >= 2 ? r[0]!.ppg - r[1]!.ppg : undefined;
			})
			.filter(isNum),
	);
	if (gaps.length < 4) {
		return null;
	}
	const w = twoWay(gaps, gap);
	if (w.score < 0.25) {
		return null;
	}
	return mk({
		id: "s-scoregap",
		group: "s-leader-race",
		theme: "scoring",
		score: w.score * 0.7,
		kicker: w.high
			? "A runaway scoring title"
			: "A photo finish for the scoring title",
		pid: a.pid,
		tid: a.tid,
		season,
		heads: w.high
			? [
					`${a.name} won the scoring title by ${fmtNum(gap, 1)} points a game`,
					`Nobody was close to ${a.name}`,
				]
			: [
					`${a.name} edged ${b.name} for the scoring title by ${fmtNum(gap, 2)}`,
					`The closest scoring race`,
				],
		list: [a, b, rows[2]!].map((l) => ({
			name: l.name,
			value: `${fmtNum(l.ppg, 1)} PPG`,
			pid: l.pid,
		})),
		lines: [
			`${nth(w.rank, w.high ? "biggest" : "smallest")} margin of ${fmtNum(gaps.length)} seasons`,
		],
	});
};

const deepRoster: Topic = ({ X, season }) => {
	const teams = X.teamsIn(season);
	if (teams.length < 6) {
		return null;
	}
	const count = (tid: number, season2: number, min: number) =>
		X.teamLines(tid, season2).filter((l) => l.gp >= 20 && l.ppg >= min).length;
	const rows = teams
		.map((t) => ({ t, n: count(t.tid, season, 10) }))
		.sort((a, b) => b.n - a.n);
	const top = rows[0]!;
	if (top.n < 5) {
		return null;
	}
	const all = X.L.teamSeasons
		.filter((t) => t.gp > 0)
		.map((t) => count(t.tid, t.season, 10));
	const rank = rankOf(all, top.n);
	return mk({
		id: "s-deep",
		group: "s-teams",
		theme: "team",
		score: Math.max(0.2, rankScore(rank, all.length)) * 0.7,
		kicker: "The deepest roster",
		tid: top.t.tid,
		season,
		heads: [
			`${plural(top.n, "player")} scored 10 or more for the ${X.teamName(top.t.tid, season)}`,
			`Depth chart: ${top.t.region} ${top.t.name}`,
		],
		hero: { text: `${top.n}`, unit: "players averaging 10+" },
		lines: [`${top.t.won}-${top.t.lost} on the year`],
	});
};

const oneMan: Topic = ({ X, season }) => {
	const teams = X.teamsIn(season);
	const share = (tid: number, s: number) => {
		const r = X.teamLines(tid, s);
		const tot = r.reduce((a, l) => a + l.pts, 0);
		return r.length >= 5 && tot > 0
			? Math.max(...r.map((l) => l.pts)) / tot
			: undefined;
	};
	const rows = teams
		.map((t) => ({ t, v: share(t.tid, season) }))
		.filter((x): x is { t: WTeamSeason; v: number } => isNum(x.v))
		.sort((a, b) => b.v - a.v);
	if (rows.length < 6 || rows[0]!.v < 0.25) {
		return null;
	}
	const all = X.L.teamSeasons
		.filter((t) => t.gp > 0)
		.map((t) => share(t.tid, t.season))
		.filter(isNum);
	const rank = rankOf(all, rows[0]!.v);
	const star = [...X.teamLines(rows[0]!.t.tid, season)].sort(
		(a, b) => b.pts - a.pts,
	)[0]!;
	return mk({
		id: "s-oneman",
		group: "s-teams",
		theme: "scoring",
		score: Math.max(0.2, rankScore(rank, all.length)) * 0.7,
		kicker: "One-man offense",
		pid: star.pid,
		tid: rows[0]!.t.tid,
		season,
		heads: [
			`${star.name} scored ${pct(rows[0]!.v, 0)} of his team’s points`,
			`The ${rows[0]!.t.name} ran everything through ${star.name}`,
		],
		hero: { text: pct(rows[0]!.v, 0), unit: "of the team’s points" },
		lines: [
			`${nth(rank, "highest")} share of ${fmtNum(all.length)} team seasons`,
		],
	});
};

const teamAges: Topic = ({ X, season }) => {
	const rows = X.teamsIn(season)
		.map((t) => ({
			t,
			v: wavg(X.teamLines(t.tid, season), (l) => l.age),
			n: X.teamLines(t.tid, season).length,
		}))
		.filter((x) => x.n >= 5)
		.sort((a, b) => a.v - b.v);
	if (rows.length < 6) {
		return null;
	}
	const young = rows[0]!;
	const old = rows.at(-1)!;
	return mk({
		id: "s-teamage",
		group: "s-teams",
		theme: "people",
		score: 0.35 + Math.min(0.2, (old.v - young.v) / 20),
		kicker: "Youngest and oldest",
		tid: young.t.tid,
		season,
		heads: [
			`The ${young.t.name} were the youngest team, the ${old.t.name} the oldest`,
			`${fmtNum(old.v - young.v, 1)} years between the youngest and oldest rosters`,
		],
		list: [
			{
				name: `${X.teamName(young.t.tid, season)} (youngest)`,
				value: `${fmtNum(young.v, 1)}`,
				sub: `${young.t.won}-${young.t.lost}`,
				tid: young.t.tid,
			},
			{
				name: `${X.teamName(old.t.tid, season)} (oldest)`,
				value: `${fmtNum(old.v, 1)}`,
				sub: `${old.t.won}-${old.t.lost}`,
				tid: old.t.tid,
			},
		],
		lines: ["Average age, weighted by minutes played"],
	});
};

const hypeTeam: Topic = ({ X, season }) => {
	const rows = bestOf(X, season, (t) => (isNum(t.hype) ? t.hype : undefined));
	if (rows.length < 6 || rows[0]!.v - rows[1]!.v < 0.01) {
		return null;
	}
	const top = rows[0]!;
	return mk({
		id: "s-hype",
		group: "s-teams",
		theme: "people",
		score: 0.3,
		kicker: "Hottest ticket",
		tid: top.t.tid,
		season,
		heads: [
			`No team had more hype than the ${X.teamName(top.t.tid, season)}`,
			`The city was buzzing: ${top.t.region}`,
		],
		hero: { text: fmtNum(top.v * 100, 0), unit: "hype out of 100" },
		lines: [
			`${top.t.won}-${top.t.lost} on the court`,
			rows[1] ? `Next: ${X.teamName(rows[1].t.tid, season)}` : null,
		],
	});
};

const luckTeam: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const rows = X.teamsIn(season)
		.filter((t) => t.gp >= 20 && t.pts > 0)
		.map((t) => {
			const e = 14;
			const exp = t.pts ** e / (t.pts ** e + t.oppPts ** e);
			return { t, d: t.won - exp * (t.won + t.lost + t.tied) };
		})
		.sort((a, b) => b.d - a.d);
	if (rows.length < 6) {
		return null;
	}
	const lucky = rows[0]!;
	const unlucky = rows.at(-1)!;
	if (lucky.d < 3) {
		return null;
	}
	return mk({
		id: "s-luck",
		group: "s-teams",
		theme: "schedule",
		score: Math.min(0.65, 0.2 + lucky.d * 0.05),
		kicker: "Lucky and unlucky",
		tid: lucky.t.tid,
		season,
		heads: [
			`${X.teamName(lucky.t.tid, season)} won ${fmtNum(lucky.d, 1)} more games than their scoring suggested`,
			`The luckiest team of ${season}`,
		],
		list: [
			{
				name: `${X.teamName(lucky.t.tid, season)} (luckiest)`,
				value: `+${fmtNum(lucky.d, 1)}`,
				tid: lucky.t.tid,
			},
			{
				name: `${X.teamName(unlucky.t.tid, season)} (unluckiest)`,
				value: `${fmtNum(unlucky.d, 1)}`,
				tid: unlucky.t.tid,
			},
		],
		note: "Expected wins come from the Pythagorean formula: points scored and allowed",
	});
};

const marginVsRecord: Topic = ({ X, season }) => {
	const ts = X.teamsIn(season).filter((t) => t.gp >= 20);
	if (ts.length < 6) {
		return null;
	}
	const byMargin = [...ts].sort(
		(a, b) => (b.pts - b.oppPts) / b.gp - (a.pts - a.oppPts) / a.gp,
	);
	const byRecord = [...ts].sort((a, b) => wpOf(b) - wpOf(a));
	const m = byMargin[0]!;
	const r = byRecord[0]!;
	if (m.tid === r.tid) {
		return null;
	}
	return mk({
		id: "s-margin",
		group: "s-teams",
		theme: "team",
		score: 0.4,
		kicker: "The best team on paper",
		tid: m.tid,
		season,
		heads: [
			`The ${X.teamName(m.tid, season)} had the best scoring margin, not the best record`,
			`Best margin: ${m.region} ${m.name}`,
		],
		list: [
			{
				name: `${X.teamName(m.tid, season)} (best margin)`,
				value: `+${fmtNum((m.pts - m.oppPts) / m.gp, 1)}`,
				sub: `${m.won}-${m.lost}`,
				tid: m.tid,
			},
			{
				name: `${X.teamName(r.tid, season)} (best record)`,
				value: `${r.won}-${r.lost}`,
				sub: `+${fmtNum((r.pts - r.oppPts) / r.gp, 1)}`,
				tid: r.tid,
			},
		],
	});
};

const bubbleRace: Topic = ({ X, season }) => {
	if (!X.decided(season)) {
		return null;
	}
	const ts = X.teamsIn(season);
	const inn = ts.filter((t) => t.playoffRoundsWon >= 0);
	const out = ts.filter((t) => t.playoffRoundsWon < 0);
	if (inn.length < 6 || out.length < 2) {
		return null;
	}
	const last = [...inn].sort((a, b) => wpOf(a) - wpOf(b))[0]!;
	const first = [...out].sort((a, b) => wpOf(b) - wpOf(a))[0]!;
	const gap = last.won - first.won;
	if (gap > 2) {
		return null;
	}
	return mk({
		id: "s-bubble",
		group: "s-playoffs-race",
		theme: "schedule",
		score: gap <= 0 ? 0.5 : 0.35,
		kicker: "The bubble",
		tid: first.tid,
		season,
		heads: [
			gap <= 0
				? `The ${first.name} missed the playoffs with a better record than ${last.name}`
				: `Just ${plural(gap, "win")} separated ${last.name} from ${first.name}`,
			`The thinnest line of the season`,
		],
		list: [
			{
				name: `${X.teamName(last.tid, season)} (last in)`,
				value: `${last.won}-${last.lost}`,
				tid: last.tid,
			},
			{
				name: `${X.teamName(first.tid, season)} (first out)`,
				value: `${first.won}-${first.lost}`,
				tid: first.tid,
			},
		],
	});
};

// ---------------------------------------------------------------------------------------------
// Awards and the playoffs
// ---------------------------------------------------------------------------------------------

const AWARD_LISTS: [string, string, string][] = [
	["All-League", "s-allleague", "All-League first team"],
	["All-Defensive", "s-alldef", "All-Defensive first team"],
	["All-Rookie", "s-allrookie", "All-Rookie first team"],
];

const teamLists: Topic = ({ X, season }) => {
	if (!X.decided(season)) {
		return null;
	}
	const out: Slide[] = [];
	for (const [name, id, label] of AWARD_LISTS) {
		const first = X.awardPids(season, `First Team ${name}`);
		const list = first.length > 0 ? first : X.awardPids(season, name);
		if (list.length < 3) {
			continue;
		}
		const rows: SlideListRow[] = list.slice(0, 5).map((pid) => {
			const p = X.players.get(pid)!;
			const l = X.line(pid, season);
			return {
				name: p.name,
				value: l ? `${fmtNum(l.ppg, 1)} PPG` : "",
				pid,
				sub: l ? X.teamName(l.tid, season) : undefined,
			};
		});
		// A team with two of the five
		const byTeam = new Map<number, number>();
		for (const pid of list) {
			const l = X.line(pid, season);
			if (l) {
				byTeam.set(l.tid, (byTeam.get(l.tid) ?? 0) + 1);
			}
		}
		const top = [...byTeam.entries()].sort((a, b) => b[1] - a[1])[0];
		out.push(
			mk({
				id,
				group: "s-honors",
				theme: "awards",
				score: 0.38,
				kicker: label,
				pid: list[0],
				season,
				heads: [`The ${season} ${label}`, `Named to the ${label}`],
				list: rows,
				lines: [
					top && top[1] >= 2
						? `${X.teamName(top[0], season)} placed ${top[1]} players`
						: null,
				],
				facts: [`teamlist|${id}|${season}`],
			}),
		);
	}
	return out;
};

const allStarTeams: Topic = ({ X, season }) => {
	const pids = X.awardPids(season, "All-Star");
	if (pids.length < 8) {
		return null;
	}
	const byTeam = new Map<number, number[]>();
	for (const pid of pids) {
		const l = X.line(pid, season);
		if (l) {
			byTeam.set(l.tid, [...(byTeam.get(l.tid) ?? []), pid]);
		}
	}
	const rows = [...byTeam.entries()].sort((a, b) => b[1].length - a[1].length);
	const top = rows[0];
	if (!top || top[1].length < 2) {
		return null;
	}
	const none = X.teamsIn(season).length - byTeam.size;
	return mk({
		id: "s-allstars",
		group: "s-honors",
		theme: "awards",
		score: 0.3 + Math.min(0.2, top[1].length * 0.05),
		kicker: "The All-Star Game",
		tid: top[0],
		season,
		heads: [
			`${X.teamName(top[0], season)} sent ${top[1].length} players to the All-Star Game`,
			`${plural(pids.length, "All-Star")} in all`,
		],
		list: rows.slice(0, 4).map(([t, ps]) => ({
			name: X.teamName(t, season),
			value: `${ps.length}`,
			tid: t,
		})),
		lines: [none > 0 ? `${plural(none, "team")} had no All-Star` : null],
	});
};

const mvpFlavor: Topic = ({ X, season }) => {
	const p = X.awardWinner(season, "Most Valuable Player");
	if (!p) {
		return null;
	}
	const l = X.line(p.pid, season);
	if (!l) {
		return null;
	}
	const q = X.qualified(season);
	const wsLeader = [...q].sort((a, b) => b.ws - a.ws)[0];
	const out: Slide[] = [];
	if (wsLeader && wsLeader.pid !== p.pid && q.length >= 10) {
		const rank = rankOf(
			q.map((x) => x.ws),
			l.ws,
		);
		out.push(
			mk({
				id: "s-mvpws",
				group: "s-mvp",
				theme: "awards",
				score: Math.min(0.7, 0.3 + (rank - 1) * 0.08),
				kicker: "MVP debate",
				pid: wsLeader.pid,
				tid: wsLeader.tid,
				season,
				heads: [
					`${wsLeader.name} led in win shares, but ${p.name} won MVP`,
					`The MVP was not the win-shares leader`,
				],
				list: [
					{
						name: `${wsLeader.name} (most win shares)`,
						value: `${fmtNum(wsLeader.ws, 1)} WS`,
						pid: wsLeader.pid,
					},
					{
						name: `${p.name} (MVP)`,
						value: `${fmtNum(l.ws, 1)} WS`,
						sub: `${ordinal(rank)} in the league`,
						pid: p.pid,
					},
				],
			}),
		);
	}
	const ages: { age: number; season: number; name: string }[] = [];
	for (const s of X.decidedSeasons()) {
		const w = X.awardWinner(s, "Most Valuable Player");
		const ln = w ? X.line(w.pid, s) : undefined;
		if (w && ln) {
			ages.push({ age: ln.age, season: s, name: w.name });
		}
	}
	if (ages.length >= 6) {
		const w = twoWay(
			ages.map((a) => a.age),
			l.age,
		);
		if (w.score > 0.3) {
			out.push(
				mk({
					id: "s-mvpage",
					group: "s-mvp",
					theme: "awards",
					score: w.score * 0.7,
					kicker: w.high ? "An older MVP" : "A young MVP",
					pid: p.pid,
					tid: l.tid,
					season,
					heads: [
						`${p.name} was ${l.age} when he won MVP`,
						w.high
							? `The oldest MVP in league history`
							: `The youngest MVP in league history`,
					].slice(0, w.rank === 1 ? 2 : 1),
					hero: { text: `${l.age}`, unit: "years old" },
					lines: [
						`${nth(w.rank, w.high ? "oldest" : "youngest")} of ${plural(ages.length, "MVP")} so far`,
					],
				}),
			);
		}
	}
	return out;
};

const champStories: Topic = ({ X, season }) => {
	const c = X.champion(season);
	if (!c) {
		return null;
	}
	const out: Slide[] = [];
	const titles = X.titlesOf(c.tid, season);
	if (
		titles.length === 1 &&
		X.seasons.length >= 5 &&
		X.seasons[0]! < season - 3
	) {
		out.push(
			mk({
				id: "s-newchamp",
				group: "s-champ",
				theme: "playoffs",
				score: 0.7,
				kicker: "A new champion",
				tid: c.tid,
				season,
				heads: [
					`First title ever for the ${X.teamName(c.tid, season)}`,
					`A new name on the trophy`,
				],
				hero: { text: "No. 1", unit: "title" },
				lines: [`${c.won}-${c.lost} in the regular season`],
				facts: [`champ|${season}`],
			}),
		);
	}
	// Repeat champions
	if (X.champion(season - 1)?.tid === c.tid) {
		let run = 1;
		for (let s = season - 1; s >= X.seasons[0]!; s--) {
			if (X.champion(s)?.tid === c.tid) {
				run += 1;
			} else {
				break;
			}
		}
		out.push(
			mk({
				id: "s-repeat",
				group: "s-champ",
				theme: "playoffs",
				score: Math.min(0.9, 0.5 + run * 0.1),
				kicker: run === 2 ? "Back to back" : "A dynasty",
				tid: c.tid,
				season,
				heads: [
					run === 2
						? `Back-to-back for the ${X.teamName(c.tid, season)}`
						: `${run} straight titles for the ${X.teamName(c.tid, season)}`,
				],
				hero: { text: `${run}`, unit: "straight titles" },
				lines: [`${c.won}-${c.lost} in the regular season`],
				facts: [`champ|${season}`],
			}),
		);
	}
	// The run: games won and lost in the playoffs
	const ser = X.seriesOf(c.tid, season);
	if (ser.length >= 2) {
		const w = ser.reduce((a, s) => a + s.won, 0);
		const l = ser.reduce((a, s) => a + s.lost, 0);
		const swept = ser.filter((s) => s.lost === 0).length;
		const pctWon = w / Math.max(1, w + l);
		const hist = X.decidedSeasons()
			.map((s) => {
				const ch = X.champion(s);
				if (!ch) {
					return undefined;
				}
				const sr = X.seriesOf(ch.tid, s);
				const ww = sr.reduce((a, x) => a + x.won, 0);
				const ll = sr.reduce((a, x) => a + x.lost, 0);
				return ww + ll > 0 ? ww / (ww + ll) : undefined;
			})
			.filter(isNum);
		const w2 = twoWay(hist, pctWon);
		if (hist.length >= 4 && w2.score > 0.2) {
			out.push(
				mk({
					id: "s-champrun",
					group: "s-champ",
					theme: "playoffs",
					score: w2.score * 0.75,
					kicker: "The title run",
					tid: c.tid,
					season,
					heads: w2.high
						? [
								`The ${X.teamName(c.tid, season)} went ${w}-${l} through the playoffs`,
								`A dominant march to the title`,
							]
						: [
								`The ${X.teamName(c.tid, season)} survived at ${w}-${l}`,
								`The narrowest path to a title`,
							],
					hero: { text: `${w}-${l}`, unit: "in playoff games" },
					lines: [
						swept > 0 ? `${plural(swept, "sweep")} on the way` : null,
						`${nth(w2.rank, w2.high ? "most dominant" : "closest")} title run of ${hist.length}`,
					],
					facts: [`champ|${season}`],
				}),
			);
		}
	}
	// Payroll and seed of the champion
	if (isNum(c.payroll) && c.payroll > 0 && X.decided(season)) {
		const teams = X.teamsIn(season).filter(
			(t) => isNum(t.payroll) && t.payroll > 0,
		);
		if (teams.length >= 6) {
			const rank = rankOf(
				teams.map((t) => t.payroll!),
				c.payroll,
			);
			if (rank <= 2 || rank >= teams.length - 2) {
				out.push(
					mk({
						id: "s-champpay",
						group: "s-champ",
						theme: "money",
						score: rank <= 2 ? 0.35 : 0.6,
						kicker: "Money and the title",
						tid: c.tid,
						season,
						heads:
							rank <= 2
								? [
										`The champions also had the ${rank === 1 ? "biggest" : "second-biggest"} payroll`,
									]
								: [
										`The champions had just the ${ordinal(rank)}-highest payroll of ${teams.length}`,
									],
						hero: { text: money(c.payroll), unit: "champion payroll" },
						lines: [`${X.teamName(c.tid, season)}`],
						facts: [`champ|${season}`],
					}),
				);
			}
		}
	}
	return out;
};

const chalk: Topic = ({ X, season }) => {
	if (!X.decided(season)) {
		return null;
	}
	const rate = (s: number) => {
		const ps = X.series(s);
		if (!ps || !X.decided(s)) {
			return undefined;
		}
		let total = 0;
		let fav = 0;
		for (const round of ps.rounds) {
			for (const m of round) {
				if (!m.away || m.home.seed === m.away.seed) {
					continue;
				}
				total += 1;
				const homeWon = m.home.won > m.away.won;
				if (m.home.seed < m.away.seed === homeWon) {
					fav += 1;
				}
			}
		}
		return total >= 4 ? fav / total : undefined;
	};
	const board = X.decidedSeasons()
		.map((s) => rate(s))
		.filter(isNum);
	const mine = rate(season);
	if (!isNum(mine) || board.length < 4) {
		return null;
	}
	const w = twoWay(board, mine);
	if (w.score < 0.25) {
		return null;
	}
	const ps = X.series(season)!;
	const total = ps.rounds
		.flat()
		.filter((m) => m.away && m.home.seed !== m.away.seed).length;
	const favWon = Math.round(mine * total);
	return mk({
		id: "s-chalk",
		group: "s-playoffs-shape",
		theme: "playoffs",
		score: w.score * 0.7,
		kicker: w.high ? "Chalk" : "Chaos",
		season,
		heads: w.high
			? [
					`The higher seed won ${favWon} of ${total} playoff series`,
					`The playoffs went to form`,
				]
			: [
					`Only ${favWon} of ${total} series went to the higher seed`,
					`Chaos in the playoffs`,
				],
		hero: { text: pct(mine, 0), unit: "series won by the higher seed" },
		lines: [
			`${nth(w.rank, w.high ? "most predictable" : "wildest")} playoffs of ${board.length}`,
		],
	});
};

const gameSevens: Topic = ({ X, season }) => {
	const ps = X.series(season);
	if (!ps || !X.decided(season)) {
		return null;
	}
	const sev: {
		round: number;
		a: number;
		b: number;
		w: number;
		l: number;
		ri: number;
	}[] = [];
	for (const [ri, round] of ps.rounds.entries()) {
		for (const m of round) {
			if (!m.away) {
				continue;
			}
			const need = Math.max(m.home.won, m.away.won);
			if (need >= 3 && m.home.won + m.away.won === 2 * need - 1) {
				const w = m.home.won > m.away.won ? m.home : m.away;
				const l = w === m.home ? m.away : m.home;
				sev.push({ round: ri, a: w.tid, b: l.tid, w: w.won, l: l.won, ri });
			}
		}
	}
	if (sev.length === 0) {
		return null;
	}
	const n = ps.rounds.length;
	const finals = sev.find((s) => s.ri === n - 1);
	return mk({
		id: "s-gameseven",
		group: "s-playoffs-shape",
		theme: "playoffs",
		score: Math.min(0.85, 0.35 + sev.length * 0.1 + (finals ? 0.25 : 0)),
		kicker: finals ? "Game 7 in the finals" : "Going the distance",
		tid: finals?.a ?? sev[0]!.a,
		season,
		heads: [
			finals
				? `The finals went the distance`
				: `${plural(sev.length, "series", "series")} went the distance`,
			`Winner take all`,
		],
		list: sev.slice(0, 4).map((s) => ({
			name: `${X.teamName(s.a, season)} over ${X.teamName(s.b, season)}`,
			value: `${s.w}-${s.l}`,
			tid: s.a,
		})),
	});
};

const reign: Topic = ({ X, season }) => {
	const cats: [string, string, (l: SeasonLine) => number][] = [
		["scoring", "points", (l) => l.ppg],
		["rebounding", "rebounds", (l) => l.rpg],
		["assists", "assists", (l) => l.apg],
	];
	const out: Slide[] = [];
	for (const [what, noun, f] of cats) {
		const lead = (s: number) =>
			[...X.qualified(s)].sort((a, b) => f(b) - f(a))[0];
		const me = lead(season);
		if (!me) {
			continue;
		}
		let run = 1;
		for (let s = season - 1; s >= X.seasons[0]!; s--) {
			const l = lead(s);
			if (l && l.pid === me.pid) {
				run += 1;
			} else {
				break;
			}
		}
		if (run >= 3) {
			out.push(
				mk({
					id: `s-reign-${what}`,
					group: "s-reign",
					theme: "history",
					score: Math.min(0.85, 0.35 + (run - 3) * 0.12),
					kicker: "A long reign",
					pid: me.pid,
					tid: me.tid,
					season,
					heads: [
						`${run} straight years leading the league in ${noun}: ${me.name}`,
						`${me.name} owns ${what}`,
					],
					hero: { text: `${run}`, unit: `straight ${what} titles` },
					lines: [`${fmtNum(f(me), 1)} per game this season`],
					facts: [`reign|${what}|${me.pid}`],
				}),
			);
		}
	}
	return out;
};

const milestones: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const marks: [string, (c: ReturnType<X["career"]>) => number, number[]][] = [
		["points", (c) => c.pts, [5000, 10000, 15000, 20000, 25000, 30000]],
		["rebounds", (c) => c.trb, [2500, 5000, 7500, 10000]],
		["assists", (c) => c.ast, [2500, 5000, 7500, 10000]],
		["steals", (c) => c.stl, [1000, 1500, 2000]],
		["blocks", (c) => c.blk, [1000, 1500, 2000]],
		["three-pointers", (c) => c.tp, [1000, 1500, 2000, 2500]],
	];
	const hits: {
		p: string;
		pid: number;
		tid: number;
		noun: string;
		mark: number;
	}[] = [];
	for (const l of X.lines(season)) {
		const p = X.players.get(l.pid)!;
		const before = X.career(p, season - 1);
		const after = X.career(p, season);
		for (const [noun, f, ms] of marks) {
			for (const m of ms) {
				if (f(before) < m && f(after) >= m) {
					hits.push({ p: l.name, pid: l.pid, tid: l.tid, noun, mark: m });
				}
			}
		}
	}
	if (hits.length === 0) {
		return null;
	}
	hits.sort((a, b) => b.mark - a.mark);
	return mk({
		id: "s-milestones",
		group: "s-history",
		theme: "history",
		score: Math.min(0.7, 0.3 + hits.length * 0.05),
		kicker: "Milestones",
		pid: hits[0]!.pid,
		tid: hits[0]!.tid,
		season,
		heads: [
			`${plural(hits.length, "career milestone")} crossed this season`,
			`${hits[0]!.p} passed ${fmtNum(hits[0]!.mark)} career ${hits[0]!.noun}`,
		],
		list: hits.slice(0, 5).map((h) => ({
			name: h.p,
			value: `${fmtNum(h.mark)} ${h.noun}`,
			pid: h.pid,
		})),
	});
};

const draftTop: Topic = ({ X, season }) => {
	if (!X.decided(season)) {
		return null;
	}
	const picks = X.L.players
		.filter((p) => p.draft.year === season && p.draft.round === 1)
		.sort((a, b) => a.draft.pick - b.draft.pick);
	if (picks.length < 10) {
		return null;
	}
	return mk({
		id: "s-draftboard",
		group: "s-draft",
		theme: "draft",
		score: 0.35,
		kicker: `The ${season} draft`,
		pid: picks[0]!.pid,
		season,
		heads: [
			`${picks[0]!.name} went No. 1 in the ${season} draft`,
			`The top of the ${season} draft`,
		],
		list: picks.slice(0, 5).map((p) => ({
			name: p.name,
			value: `No. ${p.draft.pick}`,
			sub: `${X.teamName(p.draft.tid, season)}${p.ovr[season] ? `, rated ${p.ovr[season]}` : ""}`,
			pid: p.pid,
		})),
	});
};

const absences: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	const maxGp = X.maxGp(season);
	const rows = X.lines(season)
		.map((l) => {
			const p = X.players.get(l.pid)!;
			return {
				l,
				ovr: p.ovr[season],
				games: p.injuries
					.filter((i) => i.season === season)
					.reduce((a, i) => a + i.games, 0),
			};
		})
		.filter((x) => x.games >= 30 && isNum(x.ovr))
		.sort((a, b) => b.ovr! - a.ovr!);
	if (rows.length < 2 || maxGp < 20) {
		return null;
	}
	const top = rows[0]!;
	return mk({
		id: "s-absence",
		group: "s-health",
		theme: "people",
		score: Math.min(0.65, 0.25 + (top.ovr! - 50) * 0.01),
		kicker: "Missing in action",
		pid: top.l.pid,
		tid: top.l.tid,
		season,
		heads: [
			`${top.l.name}, one of the best, lost ${top.games} games to injury`,
			`The stars who missed the most time`,
		],
		list: rows.slice(0, 4).map((x) => ({
			name: x.l.name,
			value: `${x.games} games`,
			sub: `rated ${x.ovr}`,
			pid: x.l.pid,
		})),
	});
};

const injuredPlayers: Topic = ({ X, season }) => {
	const rows = X.L.players
		.map((p) => ({
			p,
			g: p.injuries
				.filter((i) => i.season === season)
				.reduce((a, i) => a + i.games, 0),
		}))
		.filter((x) => x.g > 0)
		.sort((a, b) => b.g - a.g);
	if (rows.length < 10 || rows[0]!.g < 40) {
		return null;
	}
	const total = rows.reduce((a, x) => a + x.g, 0);
	const top = rows[0]!;
	const l = X.line(top.p.pid, season);
	return mk({
		id: "s-injuries",
		group: "s-health",
		theme: "people",
		score: 0.3,
		kicker: "The injury bug",
		pid: top.p.pid,
		tid: l?.tid,
		season,
		heads: [
			`${fmtNum(total)} games were lost to injuries`,
			`${top.p.name} missed the most time: ${plural(top.g, "game")}`,
		],
		hero: { text: fmtNum(total), unit: "player-games lost" },
		list: rows.slice(0, 4).map((x) => ({
			name: x.p.name,
			value: plural(x.g, "game"),
			sub: x.p.injuries
				.filter((i) => i.season === season)
				.sort((a, b) => b.games - a.games)[0]?.type,
			pid: x.p.pid,
		})),
	});
};

const rareLow: Topic = ({ X, season }) => {
	const teams = X.teamsIn(season).filter((t) => t.gp >= 20);
	if (teams.length < 8) {
		return null;
	}
	const wp = teams.map(wpOf);
	const spread = Math.max(...wp) - Math.min(...wp);
	const board = X.cached("spreads", () =>
		X.seasons
			.map((s) => {
				const t = X.teamsIn(s).filter((x) => x.gp >= 20);
				const w = t.map(wpOf);
				return t.length >= 8 ? Math.max(...w) - Math.min(...w) : undefined;
			})
			.filter(isNum),
	);
	if (board.length < 4) {
		return null;
	}
	const w = twoWay(board, spread);
	if (w.score < 0.3) {
		return null;
	}
	const best = [...teams].sort((a, b) => wpOf(b) - wpOf(a))[0]!;
	const worst = [...teams].sort((a, b) => wpOf(a) - wpOf(b))[0]!;
	return mk({
		id: "s-spread",
		group: "s-league",
		theme: "schedule",
		score: w.score * 0.65,
		kicker: w.high ? "Rich and poor" : "Everyone was close",
		tid: best.tid,
		season,
		heads: w.high
			? [
					`${best.won - worst.won} wins separated the best and worst teams`,
					`A league of haves and have-nots`,
				]
			: [
					`Only ${best.won - worst.won} wins between best and worst`,
					`A very tight league`,
				],
		list: [
			{
				name: `${X.teamName(best.tid, season)} (best)`,
				value: `${best.won}-${best.lost}`,
				tid: best.tid,
			},
			{
				name: `${X.teamName(worst.tid, season)} (worst)`,
				value: `${worst.won}-${worst.lost}`,
				tid: worst.tid,
			},
		],
		lines: [
			`${nth(w.rank, w.high ? "widest" : "narrowest")} spread of ${board.length} seasons`,
		],
	});
};

export const X_SEASON: Topic[] = [
	leaders,
	leagueHistory,
	homeRoad,
	payrollRace,
	topSalaries,
	ratingsTop,
	biggestLeap,
	movers,
	worldSeason,
	colleges,
	ironmen,
	benchStar,
	efficient,
	scoringRace,
	deepRoster,
	oneMan,
	teamAges,
	hypeTeam,
	luckTeam,
	marginVsRecord,
	bubbleRace,
	teamLists,
	allStarTeams,
	mvpFlavor,
	champStories,
	chalk,
	gameSevens,
	reign,
	milestones,
	draftTop,
	absences,
	injuredPlayers,
	rareLow,
];
