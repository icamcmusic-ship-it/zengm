// Extra player topics: rate boards, ratings and money, career shape, draft, and the small stories of one season.
import type { SeasonLine } from "../league.ts";
import type { Slide, WPlayer } from "../types.ts";
import { fmtNum, isNum, ordinal, plural, rankOf, rankScore } from "../util.ts";
import { gameLines, mk, type Topic } from "./helpers.ts";
import {
	careerSeasons,
	lastLike,
	lineBoard,
	money,
	nth,
	pct,
	playerTopic,
	twoWay,
	type BoardItem,
	type LineDef,
	type X,
} from "./kit.ts";

const per = (n: number | undefined, gp: number) =>
	isNum(n) && gp > 0 ? n / gp : undefined;

// ---------------------------------------------------------------------------------------------
// Rate boards: where the player's season ranks among every qualified season in the league's history
// ---------------------------------------------------------------------------------------------

const DEFS: LineDef[] = [
	{
		id: "p-plusminus",
		group: "p-impact",
		theme: "efficiency",
		kicker: "On the floor",
		val: (l) => per(l.pm, l.gp),
		show: (v) => `${v >= 0 ? "+" : ""}${fmtNum(v, 1)}`,
		unit: "plus-minus per game",
		hi: (n, v) => [
			`${n}’s team won his minutes by ${fmtNum(v, 1)} a game`,
			`${n} made his team better every night`,
			`On the floor: ${n}`,
		],
		lo: (n, v) => [
			`${n}’s minutes cost ${fmtNum(-v, 1)} points a game`,
			`${n}’s team was better with him on the bench`,
			`A tough year on the floor for ${n}`,
		],
		extra: (l) =>
			isNum(l.pm)
				? [
						`${l.pm >= 0 ? "+" : ""}${fmtNum(l.pm)} over ${plural(l.gp, "game")}`,
					]
				: [],
		w: 0.85,
	},
	{
		id: "p-ortg",
		group: "p-rtg",
		theme: "efficiency",
		kicker: "Offensive rating",
		val: (l) => (l.min / Math.max(1, l.gp) >= 20 ? l.ortg : undefined),
		show: (v) => fmtNum(v, 0),
		unit: "points per 100 possessions",
		hi: (n, v) => [
			`${n} produced ${fmtNum(v, 0)} points per 100 possessions`,
			`One of the most efficient offensive seasons: ${n}`,
			`${n}’s offensive rating: ${fmtNum(v, 0)}`,
		],
		extra: (l) =>
			isNum(l.drtg)
				? [`Defensive rating: ${fmtNum(l.drtg, 0)} (lower is better)`]
				: [],
		note: "Offensive rating: points produced per 100 possessions",
		w: 0.8,
	},
	{
		id: "p-drtg",
		group: "p-rtg",
		theme: "defense",
		kicker: "Defensive rating",
		val: (l) =>
			l.min / Math.max(1, l.gp) >= 20 && isNum(l.drtg) ? -l.drtg : undefined,
		show: (v) => fmtNum(-v, 0),
		unit: "points allowed per 100",
		hi: (n, v) => [
			`${n} held opponents to ${fmtNum(-v, 0)} per 100 possessions`,
			`A wall on defense: ${n}`,
			`${n}’s defensive rating: ${fmtNum(-v, 0)}`,
		],
		note: "Defensive rating: points allowed per 100 possessions (lower is better)",
		w: 0.75,
	},
	{
		id: "p-usage",
		group: "p-usage",
		theme: "scoring",
		kicker: "Usage",
		val: (l) => (l.min / Math.max(1, l.gp) >= 20 ? l.usgp : undefined),
		show: (v) => `${fmtNum(v, 1)}%`,
		unit: "of his team’s plays",
		hi: (n, v) => [
			`${n} finished ${fmtNum(v, 0)}% of his team’s plays`,
			`The offense ran through ${n}`,
			`${n}’s usage: ${fmtNum(v, 1)}%`,
		],
		lo: (n, v) => [
			`${n} used just ${fmtNum(v, 0)}% of his team’s plays`,
			`${n} was the ultimate role player`,
		],
		note: "Usage: the share of a team’s possessions a player ends while on the floor",
		w: 0.7,
	},
	{
		id: "p-ftpct",
		group: "p-shooting",
		theme: "efficiency",
		kicker: "At the line",
		val: (l) => (l.fta / Math.max(1, l.gp) >= 2 ? l.ft / l.fta : undefined),
		show: (v) => pct(v),
		unit: "free throws",
		hi: (n, v) => [
			`${n} hit ${pct(v, 1)} of his free throws`,
			`Money at the line: ${n}`,
			`${n}’s free-throw shooting: ${pct(v)}`,
		],
		lo: (n, v) => [
			`${n} made just ${pct(v, 1)} of his free throws`,
			`The line was not kind to ${n}`,
		],
		extra: (l) => [`${fmtNum(l.ft)} of ${fmtNum(l.fta)} from the line`],
		w: 0.75,
	},
	{
		id: "p-3pct",
		group: "p-shooting",
		theme: "scoring",
		kicker: "From deep",
		val: (l) => (l.tpa / Math.max(1, l.gp) >= 2 ? l.tp / l.tpa : undefined),
		show: (v) => pct(v),
		unit: "from three",
		hi: (n, v) => [
			`${n} shot ${pct(v, 1)} from three`,
			`Deadeye: ${n} from beyond the arc`,
			`${n}’s three-point accuracy: ${pct(v)}`,
		],
		lo: (n, v) => [
			`${n} hit only ${pct(v, 1)} of his threes`,
			`The three was a struggle for ${n}`,
		],
		extra: (l) => [`${fmtNum(l.tp)} threes on ${fmtNum(l.tpa)} attempts`],
		w: 0.8,
	},
	{
		id: "p-fgpct",
		group: "p-shooting",
		theme: "efficiency",
		kicker: "Shooting percentage",
		val: (l) => (l.fga / Math.max(1, l.gp) >= 8 ? l.fg / l.fga : undefined),
		show: (v) => pct(v),
		unit: "from the field",
		hi: (n, v) => [
			`${n} made ${pct(v, 1)} of his shots`,
			`Rarely missed: ${n} shot ${pct(v)}`,
		],
		w: 0.7,
	},
	{
		id: "p-efg",
		group: "p-shooting",
		theme: "efficiency",
		kicker: "Effective shooting",
		val: (l) =>
			l.fga / Math.max(1, l.gp) >= 8 ? (l.fg + 0.5 * l.tp) / l.fga : undefined,
		show: (v) => pct(v),
		unit: "effective FG%",
		hi: (n, v) => [
			`${n}’s shots were worth ${pct(v, 1)} when threes count extra`,
			`${n} was ruthlessly efficient`,
		],
		note: "Effective FG%: field goal percentage with threes counted as 1.5 shots",
		w: 0.65,
	},
	{
		id: "p-3rate",
		group: "p-style",
		theme: "scoring",
		kicker: "Shot diet",
		val: (l) =>
			l.fga / Math.max(1, l.gp) >= 8 && l.ppg >= 10 ? l.tpa / l.fga : undefined,
		show: (v) => pct(v, 0),
		unit: "of his shots were threes",
		hi: (n, v) => [
			`${n} took ${pct(v, 0)} of his shots from three`,
			`${n} lived behind the arc`,
		],
		lo: (n, v) => [
			`${n} took just ${pct(v, 0)} of his shots from three`,
			`${n} stayed inside the arc`,
		],
		extra: (l) => [
			`${fmtNum(l.tpa / Math.max(1, l.gp), 1)} three-point attempts a game`,
		],
		w: 0.6,
	},
	{
		id: "p-ratio",
		group: "p-playmaking",
		theme: "playmaking",
		kicker: "Taking care of it",
		val: (l) => (l.apg >= 3 && l.tov > 0 ? l.ast / l.tov : undefined),
		show: (v) => fmtNum(v, 1),
		unit: "assists per turnover",
		hi: (n, v) => [
			`${n} had ${fmtNum(v, 1)} assists for every turnover`,
			`${n} rarely gave it away`,
		],
		extra: (l) => [`${fmtNum(l.ast)} assists, ${fmtNum(l.tov)} turnovers`],
		w: 0.7,
	},
	{
		id: "p-tov",
		group: "p-playmaking",
		theme: "playmaking",
		kicker: "Giveaways",
		val: (l) => (l.mpg >= 20 ? l.tov / Math.max(1, l.gp) : undefined),
		show: (v) => fmtNum(v, 1),
		unit: "turnovers per game",
		hi: (n, v) => [
			`${n} turned it over ${fmtNum(v, 1)} times a game`,
			`${n} had the ball a lot, and lost it a lot`,
		],
		w: 0.55,
	},
	{
		id: "p-fouls",
		group: "p-style",
		theme: "defense",
		kicker: "Foul trouble",
		val: (l) => (l.mpg >= 20 ? per(l.pf, l.gp) : undefined),
		show: (v) => fmtNum(v, 1),
		unit: "fouls per game",
		hi: (n, v) => [
			`${n} picked up ${fmtNum(v, 1)} fouls a game`,
			`${n} lived on the edge of foul trouble`,
		],
		w: 0.5,
	},
	{
		id: "p-orb",
		group: "p-boards",
		theme: "inside",
		kicker: "Second chances",
		val: (l) => per(l.orb, l.gp),
		show: (v) => fmtNum(v, 1),
		unit: "offensive boards a game",
		hi: (n, v) => [
			`${n} grabbed ${fmtNum(v, 1)} offensive rebounds a game`,
			`${n} owned the offensive glass`,
		],
		w: 0.7,
	},
	{
		id: "p-stocks",
		group: "p-defense",
		theme: "defense",
		kicker: "Stocks",
		val: (l) => l.spg + l.bpg,
		ok: (l) => l.mpg >= 15,
		show: (v) => fmtNum(v, 1),
		unit: "steals plus blocks per game",
		hi: (n, v) => [
			`${n} made ${fmtNum(v, 1)} defensive plays a game`,
			`${n}: steals and blocks all night`,
		],
		extra: (l) => [
			`${fmtNum(l.spg, 1)} steals and ${fmtNum(l.bpg, 1)} blocks a game`,
		],
		w: 0.7,
	},
	{
		id: "p-fta",
		group: "p-style",
		theme: "scoring",
		kicker: "Drawing contact",
		val: (l) => l.fta / Math.max(1, l.gp),
		show: (v) => fmtNum(v, 1),
		unit: "free throws a game",
		hi: (n, v) => [
			`${n} went to the line ${fmtNum(v, 1)} times a game`,
			`${n} lived at the free-throw line`,
		],
		w: 0.65,
	},
	{
		id: "p-ws48",
		group: "p-impact",
		theme: "efficiency",
		kicker: "Wins per minute",
		val: (l) => (l.mpg >= 20 && l.min > 0 ? (l.ws / l.min) * 48 : undefined),
		show: (v) => fmtNum(v, 3).replace(/^0/, ""),
		unit: "win shares per 48 minutes",
		hi: (n, v) => [
			`${n} added wins faster than almost anyone`,
			`${n}: ${fmtNum(v, 3).replace(/^0/, "")} win shares per 48`,
		],
		lo: (n) => [`${n} gave back wins with every minute`],
		note: "Win shares per 48 minutes: wins added per 48 minutes played (.100 is average)",
		w: 0.75,
	},
	{
		id: "p-vorp",
		group: "p-impact",
		theme: "efficiency",
		kicker: "Value over replacement",
		val: (l) => l.vorp,
		show: (v) => fmtNum(v, 1),
		unit: "VORP",
		total: true,
		hi: (n, v) => [
			`${n} was worth ${fmtNum(v, 1)} points of value over a replacement player`,
			`${n}’s value over replacement: ${fmtNum(v, 1)}`,
		],
		note: "VORP: value over replacement player, a box-score estimate of a player’s contribution",
		w: 0.75,
	},
	{
		id: "p-mpg",
		group: "p-workload",
		theme: "inside",
		kicker: "The workhorse",
		val: (l) => l.mpg,
		show: (v) => fmtNum(v, 1),
		unit: "minutes a game",
		hi: (n, v) => [
			`${n} played ${fmtNum(v, 1)} minutes a night`,
			`${n} barely sat down`,
		],
		w: 0.7,
	},
	{
		id: "p-dd",
		group: "p-doubles",
		theme: "inside",
		kicker: "Double-doubles",
		val: (l) => l.dd,
		ok: (l) => (l.dd ?? 0) >= 5,
		show: (v) => fmtNum(v),
		unit: "double-doubles",
		total: true,
		hi: (n, v) => [
			`${n} recorded ${fmtNum(v)} double-doubles`,
			`${n} made double-doubles routine`,
		],
		w: 0.7,
	},
	{
		id: "p-td",
		group: "p-doubles",
		theme: "playmaking",
		kicker: "Triple-doubles",
		val: (l) => l.td,
		ok: (l) => (l.td ?? 0) >= 2,
		show: (v) => fmtNum(v),
		unit: "triple-doubles",
		total: true,
		hi: (n, v) => [
			`${n} had ${fmtNum(v)} triple-doubles`,
			`${n} filled the stat sheet ${fmtNum(v)} times`,
		],
		w: 0.8,
		minBoard: 20,
	},
	{
		id: "p-minutes-total",
		group: "p-workload",
		theme: "inside",
		kicker: "Minutes on the court",
		val: (l) => l.min,
		show: (v) => fmtNum(v),
		unit: "minutes",
		total: true,
		hi: (n, v) => [
			`${n} logged ${fmtNum(v)} minutes`,
			`Nobody was on the floor more than ${n}`,
		],
		w: 0.6,
	},
];

const RATE_TOPICS = DEFS.map(playerTopic);

// ---------------------------------------------------------------------------------------------
// Single-game highs from the season's stat rows (works when box scores are gone)
// ---------------------------------------------------------------------------------------------

const HIGHS = [
	{
		k: "ptsMax",
		noun: "points",
		one: "point",
		unit: "PTS",
		min: 35,
		tag: "pts",
	},
	{
		k: "trbMax",
		noun: "rebounds",
		one: "rebound",
		unit: "REB",
		min: 15,
		tag: "trb",
	},
	{
		k: "astMax",
		noun: "assists",
		one: "assist",
		unit: "AST",
		min: 12,
		tag: "ast",
	},
	{
		k: "stlMax",
		noun: "steals",
		one: "steal",
		unit: "STL",
		min: 5,
		tag: "stl",
	},
	{
		k: "blkMax",
		noun: "blocks",
		one: "block",
		unit: "BLK",
		min: 5,
		tag: "blk",
	},
	{
		k: "tpMax",
		noun: "three-pointers",
		one: "three-pointer",
		unit: "3PM",
		min: 7,
		tag: "tp",
	},
] as const;

const seasonHighs: Topic = ({ X, season, pid }) => {
	const l = X.line(pid!, season);
	if (!l || X.hasBoxScores(season)) {
		return null;
	}
	const out: Slide[] = [];
	for (const h of HIGHS) {
		const v = l[h.k];
		if (!isNum(v) || v < h.min) {
			continue;
		}
		const all = X.cached(`hi|${h.k}`, () =>
			X.seasons.flatMap((s) =>
				X.lines(s)
					.map((x) => x[h.k])
					.filter(isNum),
			),
		);
		const rank = rankOf(all, v);
		out.push(
			mk({
				id: `p-hi-${h.tag}`,
				group: "p-gamehigh",
				theme: "games",
				score: rankScore(rank, all.length) * 0.85,
				kicker: `His best night for ${h.noun}`,
				pid: pid!,
				tid: l.tid,
				season,
				heads: [
					`${l.name}: ${v} ${h.noun} in one game`,
					`A ${v}-${h.one} night`,
				],
				hero: { text: `${v}`, unit: h.unit },
				lines: [
					`The ${ordinal(rank)}-highest single game for ${h.noun} among ${fmtNum(all.length)} player-seasons`,
				],
				facts: [`phi|${h.tag}|${pid}|${season}`],
			}),
		);
	}
	return out;
};

// ---------------------------------------------------------------------------------------------
// Role and workload
// ---------------------------------------------------------------------------------------------

const bench: Topic = ({ X, season, pid, soFar }) => {
	const l = X.line(pid!, season);
	if (!l || l.gp < 20 || l.gs > l.gp * 0.15 || l.ppg < 8 || soFar) {
		return null;
	}
	const all = X.allQualified().filter((x) => x.gs <= x.gp * 0.15 && x.ppg >= 5);
	const rank = rankOf(
		all.map((x) => x.ppg),
		l.ppg,
	);
	const inSeason = X.qualified(season).filter((x) => x.gs <= x.gp * 0.15);
	const sr = rankOf(
		inSeason.map((x) => x.ppg),
		l.ppg,
	);
	return mk({
		id: "p-bench",
		group: "p-role",
		theme: "scoring",
		score: Math.max(rankScore(rank, all.length), sr === 1 ? 0.4 : 0) * 0.85,
		kicker: "Off the bench",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} came off the bench and scored ${fmtNum(l.ppg, 1)} a night`,
			`The bench was where ${l.name} did his damage`,
		],
		hero: { text: fmtNum(l.ppg, 1), unit: "PPG as a reserve" },
		lines: [
			`Started ${l.gs} of ${plural(l.gp, "game")}`,
			sr === 1
				? "The top-scoring reserve in the league"
				: `${nth(sr, "highest")} scoring reserve in the league`,
			`${ordinal(rank)} among ${fmtNum(all.length)} reserve seasons in league history`,
		],
	});
};

const ironman: Topic = ({ X, season, pid, soFar }) => {
	const l = X.line(pid!, season);
	const team = l ? X.team(l.tid, season) : undefined;
	if (!l || soFar || !team || l.tids.length !== 1) {
		return null;
	}
	const games = team.won + team.lost + team.tied + team.otl;
	if (games < 20 || l.gp < games) {
		return null;
	}
	const mates = X.qualified(season).filter(
		(x) => x.tids.length === 1 && x.tid === l.tid && x.pid !== l.pid,
	);
	return mk({
		id: "p-ironman",
		group: "p-health",
		theme: "people",
		score: 0.4 + Math.min(0.25, l.mpg / 150),
		kicker: "Iron man",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} never missed a game`,
			`All ${games} games, every one with ${l.name}`,
		],
		hero: { text: `${games}`, unit: `of ${games} games` },
		lines: [
			`${fmtNum(l.mpg, 1)} minutes a night over ${plural(games, "game")}`,
			mates.length > 0
				? `${plural(mates.length, "teammate")} missed time`
				: null,
		],
	});
};

const moved: Topic = ({ X, season, pid }) => {
	const l = X.line(pid!, season);
	const p = X.players.get(pid!);
	if (!l || !p || l.tids.length < 2) {
		return null;
	}
	const rows = p.stats.filter((r) => r.season === season && r.gp > 0);
	const parts = rows.map(
		(r) =>
			`${fmtNum(r.pts / r.gp, 1)} ppg in ${plural(r.gp, "game")} for the ${X.teamName(r.tid, season)}`,
	);
	return mk({
		id: "p-moved",
		group: "p-moves",
		theme: "moves",
		score: 0.45 + (l.tids.length - 2) * 0.1,
		kicker: "On the move",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} suited up for ${l.tids.length} teams`,
			`A season of moving boxes for ${l.name}`,
		],
		hero: { text: `${l.tids.length}`, unit: "teams" },
		lines: parts,
	});
};

const injured: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l) {
		return null;
	}
	const mine = p.injuries.filter((i) => i.season === season);
	const games = mine.reduce((a, i) => a + i.games, 0);
	if (games < 10) {
		return null;
	}
	const all = X.cached("injBoard", () => {
		const out: number[] = [];
		for (const q of X.L.players) {
			const by = new Map<number, number>();
			for (const i of q.injuries) {
				by.set(i.season, (by.get(i.season) ?? 0) + i.games);
			}
			out.push(...by.values());
		}
		return out;
	});
	const rank = rankOf(all, games);
	const worst = [...mine].sort((a, b) => b.games - a.games)[0]!;
	return mk({
		id: "p-injury",
		group: "p-health",
		theme: "people",
		score: Math.max(0.2, rankScore(rank, all.length)) * 0.8,
		kicker: "The injury report",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} lost ${plural(games, "game")} to injury`,
			`${l.name} spent time on the shelf`,
		],
		hero: { text: `${games}`, unit: "games out" },
		lines: [
			`The worst: ${worst.type}, ${plural(worst.games, "game")}`,
			mine.length > 1
				? `${plural(mine.length, "separate injury", "separate injuries")} in all`
				: null,
			`Still played ${plural(l.gp, "game")} and averaged ${fmtNum(l.ppg, 1)} points`,
		],
	});
};

// ---------------------------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------------------------

const ovrBoard = (X: X) =>
	X.cached("ovrBoard", () => {
		const out: BoardItem[] = [];
		for (const s of X.seasons) {
			for (const l of X.lines(s)) {
				const p = X.players.get(l.pid);
				const v = p?.ovr[s];
				if (isNum(v) && l.gp >= 10) {
					out.push({ v, season: s, pid: l.pid, name: l.name });
				}
			}
		}
		return out;
	});

const ovrTopic: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	const v = p?.ovr[season];
	if (!p || !l || !isNum(v)) {
		return null;
	}
	const board = ovrBoard(X);
	if (board.length < 80) {
		return null;
	}
	const inSeason = board.filter((x) => x.season === season);
	const sr = rankOf(
		inSeason.map((x) => x.v),
		v,
	);
	const hr = rankOf(
		board.map((x) => x.v),
		v,
	);
	return mk({
		id: "p-ovr",
		group: "p-ratings",
		theme: "ratings",
		score:
			Math.max(rankScore(sr, inSeason.length), rankScore(hr, board.length)) *
			0.8,
		kicker: "The ratings",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} was rated ${v} overall`,
			sr <= 3
				? `${l.name}: one of the highest-rated players in the league`
				: `${l.name}’s overall rating: ${v}`,
		],
		hero: { text: `${v}`, unit: "overall" },
		lines: [
			`${nth(sr, "highest")} rating in the league this season`,
			`${nth(hr, "highest")} of ${fmtNum(board.length)} player-seasons in league history`,
			isNum(p.pot?.[season]) && l.age <= 25
				? `Potential: ${p.pot![season]}`
				: null,
		],
		note: "Overall rating: the game’s single number for how good a player is right now",
	});
};

const deltaBoard = (X: X) =>
	X.cached("ovrDeltas", () => {
		const out: BoardItem[] = [];
		for (const p of X.L.players) {
			for (const s of X.seasons) {
				const a = p.ovr[s - 1];
				const b = p.ovr[s];
				if (isNum(a) && isNum(b) && X.line(p.pid, s) && X.line(p.pid, s - 1)) {
					out.push({ v: b - a, season: s, pid: p.pid, name: p.name });
				}
			}
		}
		return out;
	});

const ovrJump: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l) {
		return null;
	}
	const a = p.ovr[season - 1];
	const b = p.ovr[season];
	if (!isNum(a) || !isNum(b) || Math.abs(b - a) < 2) {
		return null;
	}
	const d = b - a;
	const board = deltaBoard(X);
	if (board.length < 100) {
		return null;
	}
	const w = twoWay(
		board.map((x) => x.v),
		d,
	);
	const last = lastLike(board, d, season, w.high, pid);
	return mk({
		id: "p-ovrjump",
		group: "p-ratings",
		theme: "ratings",
		score: w.score * 0.85,
		kicker: d > 0 ? "The leap" : "The slide",
		pid: pid!,
		tid: l.tid,
		season,
		heads:
			d > 0
				? [
						`${l.name} jumped ${plural(d, "point")} in overall rating`,
						`${l.name} took a leap`,
					]
				: [
						`${l.name} dropped ${plural(-d, "point")} in overall rating`,
						`${l.name} lost a step`,
					],
		hero: { text: `${d > 0 ? "+" : ""}${d}`, unit: "overall rating" },
		lines: [
			`From ${a} to ${b}`,
			`${nth(w.rank, w.high ? "biggest jump" : "biggest drop")} of ${fmtNum(board.length)} player-seasons`,
			last ? `Last move this big: ${last.name}, ${last.season}` : null,
		],
	});
};

const potential: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	const pot = p?.pot?.[season];
	const ovr = p?.ovr[season];
	if (!p || !l || !isNum(pot) || !isNum(ovr) || l.age > 24 || pot - ovr < 6) {
		return null;
	}
	const youngs = X.lines(season)
		.filter((x) => x.age <= 24)
		.map((x) => X.players.get(x.pid)?.pot?.[season])
		.filter(isNum);
	const rank = rankOf(youngs, pot);
	return mk({
		id: "p-pot",
		group: "p-ratings",
		theme: "ratings",
		score: Math.max(0.2, rankScore(rank, youngs.length)) * 0.75,
		kicker: "The ceiling",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} was only ${l.age} with a ${pot} ceiling`,
			`The scouts see ${pot} potential in ${l.name}`,
		],
		hero: { text: `${pot}`, unit: "potential" },
		lines: [
			`Rated ${ovr} overall at age ${l.age}`,
			`${nth(rank, "highest")} potential among ${plural(youngs.length, "player")} 24 or younger`,
		],
	});
};

const peakOvr: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	const v = p?.ovr[season];
	if (!p || !l || !isNum(v)) {
		return null;
	}
	const prior = Object.entries(p.ovr)
		.filter(([s]) => Number(s) < season)
		.map(([, o]) => o);
	if (prior.length < 4 || v <= Math.max(...prior)) {
		return null;
	}
	return mk({
		id: "p-peakovr",
		group: "p-ratings",
		theme: "ratings",
		score: 0.35 + Math.min(0.3, (v - Math.max(...prior)) * 0.05),
		kicker: "A new peak",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} reached a career-high rating of ${v}`,
			`${l.name} has never been better`,
		],
		hero: { text: `${v}`, unit: "career-high overall" },
		lines: [
			`The old best was ${Math.max(...prior)}`,
			`${plural(prior.length + 1, "season")} into his career, age ${l.age}`,
		],
	});
};

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

const paidIn = (p: WPlayer, season: number) =>
	(p.paid ?? [])
		.filter((x) => x.season === season)
		.reduce((a, x) => a + x.amount, 0);

const paidBoard = (X: X, season: number) =>
	X.cached(`paid|${season}`, () =>
		X.lines(season)
			.map((l) => ({ l, v: paidIn(X.players.get(l.pid)!, season) }))
			.filter((x) => x.v > 0),
	);

const earnings: Topic = ({ X, season, pid, soFar }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || soFar) {
		return null;
	}
	const v = paidIn(p, season);
	const board = paidBoard(X, season);
	if (v <= 0 || board.length < 20) {
		return null;
	}
	const rank = rankOf(
		board.map((x) => x.v),
		v,
	);
	const career = (p.paid ?? [])
		.filter((x) => x.season <= season)
		.reduce((a, x) => a + x.amount, 0);
	return mk({
		id: "p-earnings",
		group: "p-money",
		theme: "money",
		score: rankScore(rank, board.length) * 0.8,
		kicker: "The paycheck",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			rank === 1
				? `${l.name} was the league’s highest-paid player`
				: `${l.name} earned ${money(v)}`,
			`${money(v)} for ${l.name}`,
		],
		hero: { text: money(v), unit: "paid this season" },
		lines: [
			`${nth(rank, "highest")} salary in the league`,
			career > v * 1.2
				? `${money(career)} earned over his career so far`
				: null,
		],
	});
};

const value: Topic = ({ X, season, pid, soFar }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || soFar || !X.qualified(season).includes(l)) {
		return null;
	}
	const v = paidIn(p, season);
	if (v < 1000 || l.ws <= 0) {
		return null;
	}
	const ratio = l.ws / (v / 1000);
	const board = paidBoard(X, season)
		.filter((x) => x.v >= 1000 && X.qualified(season).includes(x.l))
		.map((x) => x.l.ws / (x.v / 1000));
	if (board.length < 15) {
		return null;
	}
	const w = twoWay(board, ratio);
	return mk({
		id: "p-value",
		group: "p-money",
		theme: "money",
		score: w.score * 0.8,
		kicker: w.high ? "Bargain of the year" : "Paid for more",
		pid: pid!,
		tid: l.tid,
		season,
		heads: w.high
			? [
					`${l.name} gave the most win shares per dollar`,
					`${fmtNum(l.ws, 1)} win shares for ${money(v)}`,
				]
			: [
					`${l.name} was paid ${money(v)} for ${fmtNum(l.ws, 1)} win shares`,
					`The price tag was heavy on ${l.name}`,
				],
		hero: { text: fmtNum(ratio, 2), unit: "win shares per $1M" },
		lines: [
			`${nth(w.rank, w.high ? "best" : "worst")} among ${plural(board.length, "qualified player")} this season`,
		],
	});
};

const raise: Topic = ({ X, season, pid, soFar }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || soFar) {
		return null;
	}
	const a = paidIn(p, season - 1);
	const b = paidIn(p, season);
	if (a <= 0 || b <= 0 || Math.abs(b - a) < 3000) {
		return null;
	}
	const deltas = X.lines(season)
		.map((x) => {
			const q = X.players.get(x.pid)!;
			const u = paidIn(q, season - 1);
			const v = paidIn(q, season);
			return u > 0 && v > 0 ? v - u : undefined;
		})
		.filter(isNum);
	if (deltas.length < 20) {
		return null;
	}
	const d = b - a;
	const w = twoWay(deltas, d);
	return mk({
		id: "p-raise",
		group: "p-money",
		theme: "money",
		score: w.score * 0.7,
		kicker: d > 0 ? "The raise" : "The pay cut",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			d > 0
				? `${l.name} got a ${money(d)} raise`
				: `${l.name} took a ${money(-d)} pay cut`,
			`${l.name}’s salary went from ${money(a)} to ${money(b)}`,
		],
		hero: {
			text: `${d > 0 ? "+" : "-"}${money(Math.abs(d))}`,
			unit: "year over year",
		},
		lines: [
			`${nth(w.rank, w.high ? "biggest raise" : "biggest cut")} in the league this season`,
		],
	});
};

// ---------------------------------------------------------------------------------------------
// Career shape
// ---------------------------------------------------------------------------------------------

const journey: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l) {
		return null;
	}
	const rows = X.careerRows(p, season);
	const tids = [...new Set(rows.map((r) => r.tid))];
	if (tids.length < 4) {
		return null;
	}
	const all = X.L.players
		.map((q) => new Set(X.careerRows(q, season).map((r) => r.tid)).size)
		.filter((n) => n > 0);
	const rank = rankOf(all, tids.length);
	return mk({
		id: "p-journey",
		group: "p-moves",
		theme: "moves",
		score: 0.3 + Math.min(0.5, rankScore(rank, all.length)),
		kicker: "The journeyman",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} has played for ${tids.length} teams`,
			`${l.name}: a different jersey every few years`,
		],
		hero: { text: `${tids.length}`, unit: "teams" },
		lines: [
			`${tids.map((t) => X.teamAny(t, season)?.abbrev ?? "?").join(" → ")}`,
			`${nth(rank, "most")} stops of any player in league history`,
		],
	});
};

const loyal: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || l.tids.length !== 1) {
		return null;
	}
	let years = 0;
	for (let s = season; s >= X.seasons[0]!; s--) {
		const x = X.line(pid!, s);
		if (x && x.tids.length === 1 && x.tid === l.tid) {
			years += 1;
		} else if (x) {
			break;
		} else if (s < season) {
			break;
		}
	}
	if (years < 5) {
		return null;
	}
	return mk({
		id: "p-loyal",
		group: "p-moves",
		theme: "moves",
		score: Math.min(0.75, 0.25 + (years - 5) * 0.07),
		kicker: "The franchise player",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${plural(years, "season")} in a row with the ${X.teamName(l.tid, season)}`,
			`${l.name} is a ${X.teamAny(l.tid, season)?.name ?? "franchise"} through and through`,
		],
		hero: { text: `${years}`, unit: "straight seasons" },
		lines: [
			`${fmtNum(
				X.careerRows(p, season)
					.filter((r) => r.tid === l.tid)
					.reduce((a, r) => a + r.gp, 0),
			)} games for the franchise`,
		],
	});
};

const honors: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l) {
		return null;
	}
	const mine = p.awards.filter(
		(a) => a.season <= season && X.decided(a.season),
	);
	const count = (f: (t: string) => boolean) =>
		mine.filter((a) => f(a.type)).length;
	const allLeague = count((t) => /Team All-League/.test(t));
	const allStar = count((t) => t === "All-Star");
	const dpoy = count((t) => t === "Defensive Player of the Year");
	const rings = count((t) => t === "Won Championship");
	const mvp = count((t) => t === "Most Valuable Player");
	const total = allLeague + allStar + dpoy + rings + mvp;
	if (total < 4) {
		return null;
	}
	return mk({
		id: "p-honors",
		group: "p-career",
		theme: "awards",
		score: Math.min(0.85, 0.3 + total * 0.04),
		kicker: "The trophy case",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name}’s résumé: ${plural(total, "major honor")}`,
			`${l.name} has a crowded trophy shelf`,
		],
		list: [
			mvp > 0 ? { name: "MVP awards", value: `${mvp}` } : null,
			rings > 0 ? { name: "Championships", value: `${rings}` } : null,
			allLeague > 0
				? { name: "All-League teams", value: `${allLeague}` }
				: null,
			allStar > 0 ? { name: "All-Star games", value: `${allStar}` } : null,
			dpoy > 0
				? { name: "Defensive Player of the Year", value: `${dpoy}` }
				: null,
		].filter((x) => x !== null),
		lines: ["Through this season"],
	});
};

const crown: Topic = ({ X, season, pid, soFar }) => {
	const q = X.qualified(season);
	const l = X.line(pid!, season);
	if (!l || q.length < 10) {
		return null;
	}
	const cats: [string, (x: SeasonLine) => number][] = [
		["scoring", (x) => x.ppg],
		["rebounding", (x) => x.rpg],
		["assists", (x) => x.apg],
		["steals", (x) => x.spg],
		["blocks", (x) => x.bpg],
		["threes", (x) => x.tpg],
		["PER", (x) => x.per],
		...(soFar
			? []
			: ([["win shares", (x: SeasonLine) => x.ws]] as [
					string,
					(x: SeasonLine) => number,
				][])),
	];
	const led = cats
		.filter(([, f]) => q.every((x) => x === l || f(x) < f(l)))
		.map(([n]) => n);
	if (!q.includes(l) || led.length < 2) {
		return null;
	}
	return mk({
		id: "p-crown",
		group: "p-leader",
		theme: "scoring",
		score: Math.min(0.95, 0.5 + 0.15 * (led.length - 2)),
		kicker: "The category king",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} led the league in ${led.length} categories`,
			`${l.name} topped the charts in ${led[0]} and ${led[1]}`,
		],
		hero: { text: `${led.length}`, unit: "league-leading stats" },
		lines: [led.join(", ")],
	});
};

const allStarStreak: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l) {
		return null;
	}
	const has = (s: number) =>
		p.awards.some((a) => a.season === s && a.type === "All-Star");
	if (!has(season)) {
		return null;
	}
	let n = 0;
	for (let s = season; s >= X.seasons[0]!; s--) {
		if (has(s)) {
			n += 1;
		} else {
			break;
		}
	}
	if (n < 3) {
		return null;
	}
	return mk({
		id: "p-asstreak",
		group: "p-career",
		theme: "awards",
		score: Math.min(0.8, 0.25 + 0.08 * (n - 3)),
		kicker: "Fixture at the All-Star Game",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${n} straight All-Star selections for ${l.name}`,
			`${l.name} keeps making the All-Star team`,
		],
		hero: { text: `${n}`, unit: "All-Star games in a row" },
		lines: [
			`${p.awards.filter((a) => a.type === "All-Star").length} in his career`,
		],
	});
};

const careerBest: Topic = ({ X, season, pid, soFar }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || soFar) {
		return null;
	}
	const prior = careerSeasons(X, p, season - 1).filter((x) => x.gp >= 20);
	if (prior.length < 3 || l.gp < 30) {
		return null;
	}
	const better = (f: (x: SeasonLine) => number) =>
		prior.every((x) => f(x) < f(l));
	if (!better((x) => x.ppg) || !better((x) => x.per) || !better((x) => x.ws)) {
		return null;
	}
	return mk({
		id: "p-careerbest",
		group: "p-career",
		theme: "scoring",
		score: 0.5,
		kicker: "Career year",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} had the best season of his career`,
			`A career year for ${l.name}`,
		],
		hero: { text: fmtNum(l.ppg, 1), unit: "PPG, a career high" },
		lines: [
			`Career highs in scoring, PER (${fmtNum(l.per, 1)}) and win shares (${fmtNum(l.ws, 1)})`,
			`His previous best: ${fmtNum(Math.max(...prior.map((x) => x.ppg)), 1)} PPG`,
		],
	});
};

const arc: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l) {
		return null;
	}
	const rows = careerSeasons(X, p, season).slice(-5);
	if (rows.length < 4) {
		return null;
	}
	const first = rows[0]!;
	const change = l.ppg - first.ppg;
	return mk({
		id: "p-arc",
		group: "p-career",
		theme: "scoring",
		score: Math.min(0.55, 0.2 + Math.abs(change) / 25),
		kicker: "The arc",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			change > 0
				? `${l.name}: from ${fmtNum(first.ppg, 1)} to ${fmtNum(l.ppg, 1)} points a game`
				: `${l.name}’s scoring has slipped from ${fmtNum(first.ppg, 1)} to ${fmtNum(l.ppg, 1)}`,
			`The last ${rows.length} seasons of ${l.name}`,
		],
		list: rows.map((x) => ({
			name: `${x.season}`,
			value: `${fmtNum(x.ppg, 1)} pts, ${fmtNum(x.rpg, 1)} reb, ${fmtNum(x.apg, 1)} ast`,
			sub: X.teamName(x.tid, x.season),
		})),
	});
};

const poGames: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	if (!p || !X.decided(season)) {
		return null;
	}
	const po = X.poLines(season);
	const me = po.find((x) => x.pid === pid);
	if (!me || me.gp < 6) {
		return null;
	}
	const rank = rankOf(
		po.map((x) => x.min),
		me.min,
	);
	const rs = X.line(pid!, season);
	return mk({
		id: "p-pogames",
		group: "p-playoff",
		theme: "playoffs",
		score: Math.max(0.25, rankScore(rank, po.length)) * 0.8,
		kicker: "Playoff minutes",
		pid: pid!,
		tid: me.tid,
		season,
		heads: [
			`${me.name} played ${plural(me.gp, "playoff game")}`,
			`${fmtNum(me.min)} playoff minutes for ${me.name}`,
		],
		hero: { text: fmtNum(me.ppg, 1), unit: "PPG in the playoffs" },
		lines: [
			`${fmtNum(me.rpg, 1)} reb, ${fmtNum(me.apg, 1)} ast in ${fmtNum(me.mpg, 1)} minutes a game`,
			rs ? `Regular season: ${fmtNum(rs.ppg, 1)} PPG` : null,
			`${nth(rank, "most")} playoff minutes of ${plural(po.length, "player")}`,
		],
	});
};

const ring: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || !X.decided(season)) {
		return null;
	}
	if (
		!p.awards.some((a) => a.season === season && a.type === "Won Championship")
	) {
		return null;
	}
	const rings = X.countAwards(p, "Won Championship", season);
	const fm = p.awards.some(
		(a) => a.season === season && a.type === "Finals MVP",
	);
	return mk({
		id: "p-ring",
		group: "p-playoff",
		theme: "playoffs",
		score: Math.min(0.9, 0.5 + rings * 0.05 + (fm ? 0.2 : 0)),
		kicker: rings === 1 ? "First ring" : "Ring collector",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			rings === 1
				? `${l.name} won his first championship`
				: `Ring No. ${rings} for ${l.name}`,
			`${l.name} is a champion`,
		],
		hero: {
			text: `${rings}`,
			unit: rings === 1 ? "championship" : "championships",
		},
		lines: [
			fm ? "Finals MVP, too" : null,
			`With the ${X.teamName(l.tid, season)}`,
		],
	});
};

// ---------------------------------------------------------------------------------------------
// Peers, draft, origins
// ---------------------------------------------------------------------------------------------

const agePeers: Topic = ({ X, season, pid, soFar }) => {
	const l = X.line(pid!, season);
	if (!l || soFar) {
		return null;
	}
	const peers = X.qualified(season).filter((x) => x.age === l.age);
	if (peers.length < 8 || !peers.includes(l)) {
		return null;
	}
	const rank = rankOf(
		peers.map((x) => x.ws),
		l.ws,
	);
	if (rank > 2) {
		return null;
	}
	return mk({
		id: "p-agepeers",
		group: "p-peers",
		theme: "people",
		score: 0.3 + rankScore(rank, peers.length) * 0.5,
		kicker: `Class of ${l.age}-year-olds`,
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			rank === 1
				? `${l.name} was the best ${l.age}-year-old in the league`
				: `${l.name} was the second-best ${l.age}-year-old`,
			`Nobody his age did more than ${l.name}`,
		],
		hero: { text: fmtNum(l.ws, 1), unit: "win shares" },
		lines: [`Among ${plural(peers.length, "qualified player")} aged ${l.age}`],
	});
};

const draftClass: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || p.draft.round < 1 || p.draft.year >= season) {
		return null;
	}
	const cls = X.cached(`class|${p.draft.year}`, () =>
		X.L.players
			.filter((q) => q.draft.year === p.draft.year && q.draft.round >= 1)
			.map((q) => ({
				q,
				ws: X.career(q, season).ws,
				gp: X.career(q, season).gp,
			})),
	);
	if (cls.length < 20) {
		return null;
	}
	const mine = cls.find((c) => c.q.pid === pid);
	if (!mine) {
		return null;
	}
	const rank = rankOf(
		cls.map((c) => c.ws),
		mine.ws,
	);
	const still = cls.filter(
		(c) => c.q.retiredYear === Infinity || c.q.retiredYear > season,
	).length;
	if (rank > 5) {
		return null;
	}
	return mk({
		id: "p-class",
		group: "p-draft",
		theme: "draft",
		score: 0.3 + rankScore(rank, cls.length) * 0.6,
		kicker: `The class of ${p.draft.year}`,
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			rank === 1
				? `${l.name} is the best player from the ${p.draft.year} draft`
				: `${l.name}: ${ordinal(rank)} in the ${p.draft.year} draft class by win shares`,
			`The ${p.draft.year} draft class, and ${l.name}`,
		],
		hero: { text: fmtNum(mine.ws, 1), unit: "career win shares" },
		lines: [
			`Drafted ${p.draft.round === 1 ? "No." : "in round 2, pick"} ${p.draft.pick}`,
			`${still} of ${cls.length} draftees are still playing`,
		],
	});
};

const draftSlot: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || p.draft.round < 1 || p.draft.year >= season - 1) {
		return null;
	}
	const bucket = (q: WPlayer) =>
		q.draft.round === 2
			? "r2"
			: q.draft.pick <= 5
				? "top5"
				: q.draft.pick <= 14
					? "lottery"
					: "late";
	const b = bucket(p);
	const mates = X.cached(`slot|${b}|${season}`, () =>
		X.L.players
			.filter(
				(q) =>
					q.draft.round >= 1 &&
					q.draft.year < season - 1 &&
					bucket(q) === b &&
					X.careerRows(q, season).length > 0,
			)
			.map((q) => ({ pid: q.pid, ws: X.career(q, season).ws })),
	);
	if (mates.length < 30) {
		return null;
	}
	const mine = X.career(p, season).ws;
	const w = twoWay(
		mates.map((m) => m.ws),
		mine,
	);
	if (w.score < 0.5) {
		return null;
	}
	const label =
		b === "r2"
			? "second-round picks"
			: b === "top5"
				? "top-5 picks"
				: b === "lottery"
					? "lottery picks"
					: "late first-rounders";
	const pickText =
		p.draft.round === 2 ? "in the second round" : `No. ${p.draft.pick}`;
	const slotText =
		p.draft.round === 2
			? "a second-round pick"
			: `the No. ${p.draft.pick} pick`;
	return mk({
		id: "p-slot",
		group: "p-draft",
		theme: "draft",
		score: w.score * 0.8,
		kicker: w.high ? "Draft steal" : "Draft disappointment",
		pid: pid!,
		tid: l.tid,
		season,
		heads: w.high
			? [
					`Drafted ${pickText}, ${l.name} outproduced almost everyone in his draft group`,
					`${l.name} was a steal as ${slotText}`,
				]
			: [
					`${l.name} has not lived up to being ${slotText}`,
					`A tough career so far for ${slotText}`,
				],
		hero: { text: fmtNum(mine, 1), unit: "career win shares" },
		lines: [
			`${nth(w.rank, w.high ? "best" : "worst")} of ${plural(mates.length, "player")} among ${label}`,
		],
	});
};

const undrafted: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || p.draft.round >= 1) {
		return null;
	}
	const all = X.L.players
		.filter((q) => q.draft.round < 1 && X.careerRows(q, season).length > 0)
		.map((q) => X.career(q, season).ws);
	if (all.length < 15 || X.line(pid!, season)!.gp < 20) {
		return null;
	}
	const mine = X.career(p, season).ws;
	const rank = rankOf(all, mine);
	return mk({
		id: "p-undrafted",
		group: "p-draft",
		theme: "draft",
		score: 0.3 + rankScore(rank, all.length) * 0.6,
		kicker: "Undrafted",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`Nobody drafted ${l.name}`,
			`${l.name} made it without hearing his name called`,
		],
		hero: { text: fmtNum(mine, 1), unit: "career win shares" },
		lines: [
			`${nth(rank, "best")} of ${plural(all.length, "undrafted player")} so far`,
		],
	});
};

const country: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || !p.bornLoc) {
		return null;
	}
	const active = X.lines(season).map((x) => X.players.get(x.pid)!);
	const freq = new Map<string, number>();
	for (const q of active) {
		freq.set(q.bornLoc, (freq.get(q.bornLoc) ?? 0) + 1);
	}
	const n = freq.get(p.bornLoc) ?? 0;
	if (n < 3 || n > active.length * 0.3 || active.length < 50) {
		return null;
	}
	const countryMates = active
		.filter((q) => q.bornLoc === p.bornLoc)
		.map((q) => ({ q, ws: X.line(q.pid, season)!.ws }))
		.sort((a, b) => b.ws - a.ws);
	const rank = countryMates.findIndex((x) => x.q.pid === pid) + 1;
	return mk({
		id: "p-country",
		group: "p-roots",
		theme: "people",
		score: 0.25 + (rank === 1 ? 0.15 : 0),
		kicker: "Where he’s from",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} is one of ${n} players from ${p.bornLoc}`,
			`Born in ${p.bornLoc}: ${l.name}`,
		],
		hero: { text: `${n}`, unit: `players from ${p.bornLoc}` },
		lines: [
			rank === 1
				? `The best of them by win shares this season`
				: `${nth(rank, "best")} of them by win shares this season`,
		],
	});
};

const family: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || p.relatives.length === 0) {
		return null;
	}
	const rel = p.relatives
		.map((r) => ({ r, q: X.players.get(r.pid) }))
		.filter((x) => x.q && X.careerRows(x.q, season).length > 0);
	if (rel.length === 0) {
		return null;
	}
	const top = rel[0]!;
	const c = X.career(top.q!, season);
	return mk({
		id: "p-family",
		group: "p-roots",
		theme: "people",
		score: 0.4 + Math.min(0.25, rel.length * 0.08),
		kicker: "Family ties",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name}’s ${top.r.type} ${top.r.type === "father" || top.r.type === "mother" ? "played too" : "is in the league’s records too"}`,
			`It runs in the family: ${l.name} and ${top.q!.name}`,
		],
		list: rel.slice(0, 4).map((x) => ({
			name: `${x.q!.name} (${x.r.type})`,
			value: `${fmtNum(X.career(x.q!, season).pts)} pts`,
			pid: x.q!.pid,
		})),
		lines: [
			`${top.q!.name}: ${fmtNum(c.gp)} games, ${fmtNum(c.pts)} career points`,
		],
	});
};

// ---------------------------------------------------------------------------------------------
// Next marks and firsts
// ---------------------------------------------------------------------------------------------

const MARKS = {
	pts: {
		noun: "points",
		marks: [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000],
		k: "pts",
	},
	trb: {
		noun: "rebounds",
		marks: [2500, 5000, 7500, 10000, 12500, 15000],
		k: "trb",
	},
	ast: { noun: "assists", marks: [2500, 5000, 7500, 10000], k: "ast" },
	stl: { noun: "steals", marks: [1000, 1500, 2000, 2500, 3000], k: "stl" },
	blk: { noun: "blocks", marks: [1000, 1500, 2000, 2500, 3000], k: "blk" },
} as const;

const chase: Topic = ({ X, season, pid, soFar }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || soFar || p.retiredYear <= season) {
		return null;
	}
	const c = X.career(p, season);
	const out: Slide[] = [];
	for (const [key, m] of Object.entries(MARKS)) {
		const have = c[m.k];
		const next = m.marks.find((x) => x > have);
		const season1 = l[m.k];
		if (next === undefined || season1 <= 0) {
			continue;
		}
		const need = next - have;
		if (need > season1 * 1.3 || need < 1) {
			continue;
		}
		out.push(
			mk({
				id: `p-chase-${key}`,
				group: "p-chase",
				theme: "history",
				score: 0.45 + Math.min(0.2, next / 100000),
				kicker: "The next milestone",
				pid: pid!,
				tid: l.tid,
				season,
				heads: [
					`${l.name} is ${fmtNum(need)} ${m.noun} from ${fmtNum(next)}`,
					`The ${fmtNum(next)}-${m.noun.replace(/s$/, "")} mark is in sight for ${l.name}`,
				],
				hero: { text: fmtNum(need), unit: `${m.noun} to go` },
				lines: [
					`${fmtNum(have)} career ${m.noun} so far`,
					`About ${plural(Math.max(1, Math.round((need / season1) * l.gp)), "game")} at this year’s pace`,
				],
				facts: [`chase|${key}|${pid}`],
			}),
		);
	}
	return out;
};

const firsts: Topic = ({ X, season, pid, soFar }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || soFar || !X.qualified(season).includes(l)) {
		return null;
	}
	const prior = careerSeasons(X, p, season - 1).filter((x) => x.gp >= 20);
	if (prior.length < 1) {
		return null;
	}
	for (const lvl of [30, 25, 20]) {
		if (l.ppg >= lvl && prior.every((x) => x.ppg < lvl)) {
			return mk({
				id: "p-first",
				group: "p-career",
				theme: "scoring",
				score: lvl === 30 ? 0.8 : lvl === 25 ? 0.6 : 0.45,
				kicker: "First time",
				pid: pid!,
				tid: l.tid,
				season,
				heads: [
					`${l.name} averaged ${lvl}+ for the first time`,
					`A first for ${l.name}: ${lvl} points a game`,
				],
				hero: { text: fmtNum(l.ppg, 1), unit: "PPG" },
				lines: [
					`His best before this: ${fmtNum(Math.max(...prior.map((x) => x.ppg)), 1)}`,
				],
			});
		}
	}
	return null;
};

const position: Topic = ({ X, season, pid, soFar }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	const pos = p?.pos?.[season];
	if (!p || !l || !pos || soFar || !X.qualified(season).includes(l)) {
		return null;
	}
	const mates = X.qualified(season).filter(
		(x) => X.players.get(x.pid)?.pos?.[season] === pos,
	);
	if (mates.length < 10) {
		return null;
	}
	const rank = rankOf(
		mates.map((x) => x.ws),
		l.ws,
	);
	if (rank > 2) {
		return null;
	}
	return mk({
		id: "p-position",
		group: "p-peers",
		theme: "people",
		score: 0.3 + (rank === 1 ? 0.25 : 0.1),
		kicker: `Best at ${pos}`,
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			rank === 1
				? `${l.name} was the best ${pos} in the league`
				: `${l.name} was the second-best ${pos}`,
			`The top ${pos}: ${l.name}`,
		],
		hero: { text: fmtNum(l.ws, 1), unit: "win shares" },
		lines: [`Among ${plural(mates.length, "qualified " + pos)} this season`],
	});
};

const rookieYear: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l || X.careerRows(p).find((r) => r.gp > 0)?.season !== season) {
		return null;
	}
	if (p.stats[0]!.season === X.L.startingSeason) {
		return null;
	}
	const rookies = X.cached("rookieLines", () =>
		X.seasons.flatMap((s) =>
			X.lines(s).filter((x) => {
				const q = X.players.get(x.pid)!;
				return (
					q.stats.find((r) => r.gp > 0)?.season === s &&
					q.stats[0]!.season !== X.L.startingSeason &&
					x.gp >= 20
				);
			}),
		),
	);
	if (rookies.length < 30 || l.gp < 20) {
		return null;
	}
	const rank = rankOf(
		rookies.map((x) => x.ppg),
		l.ppg,
	);
	return mk({
		id: "p-rookie-best",
		group: "p-draft",
		theme: "draft",
		score: rankScore(rank, rookies.length) * 0.85,
		kicker: "Rookie year",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} scored ${fmtNum(l.ppg, 1)} a game as a rookie`,
			rank === 1
				? `The best rookie scoring season in league history`
				: `A rookie year to remember`,
		],
		hero: { text: fmtNum(l.ppg, 1), unit: "PPG as a rookie" },
		lines: [
			`${nth(rank, "highest")} scoring average by a rookie of ${fmtNum(rookies.length)}`,
		],
	});
};

// ---------------------------------------------------------------------------------------------
// Box-score based, only for seasons that still have them
// ---------------------------------------------------------------------------------------------

const games20: Topic = ({ X, season, pid }) => {
	const ls = gameLines(X, season);
	if (ls.length < 300) {
		return null;
	}
	const counts = new Map<number, number>();
	for (const g of ls) {
		if (g.pts >= 20) {
			counts.set(g.pid, (counts.get(g.pid) ?? 0) + 1);
		}
	}
	const mine = counts.get(pid!) ?? 0;
	const l = X.line(pid!, season);
	if (!l || mine < 20) {
		return null;
	}
	const rank = rankOf([...counts.values()], mine);
	return mk({
		id: "p-games20",
		group: "p-gameshape",
		theme: "games",
		score: rankScore(rank, counts.size) * 0.8,
		kicker: "20-point nights",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${l.name} scored 20 or more ${mine} times`,
			`${mine} games of 20+ for ${l.name}`,
		],
		hero: { text: `${mine}`, unit: "games of 20+ points" },
		lines: [
			`${Math.round((mine / l.gp) * 100)}% of the games he played`,
			`${nth(rank, "most")} in the league this season`,
		],
	});
};

const carry: Topic = ({ X, season, pid }) => {
	const ls = gameLines(X, season).filter((l) => l.pid === pid && l.pf >= 60);
	if (ls.length < 10) {
		return null;
	}
	let best = ls[0]!;
	for (const g of ls) {
		if (g.pts / g.pf > best.pts / best.pf) {
			best = g;
		}
	}
	const share = best.pts / best.pf;
	if (share < 0.4 || best.pts < 20) {
		return null;
	}
	return mk({
		id: "p-carry",
		group: "p-gameshape",
		theme: "games",
		score: Math.min(0.85, 0.3 + (share - 0.4) * 2),
		kicker: "Carrying the team",
		pid: pid!,
		tid: best.tid,
		season,
		heads: [
			`${best.name} scored ${Math.round(share * 100)}% of his team’s points one night`,
			`The one-man show: ${best.name}`,
		],
		hero: { text: `${Math.round(share * 100)}%`, unit: "of the team’s points" },
		lines: [
			`${best.pts} of ${best.pf} points ${best.won ? "in a win" : "in a loss"} over the ${X.teamName(best.opp, season)}`,
		],
		facts: [`game:${best.gid}|${best.pid}`],
	});
};

export const X_PLAYER: Topic[] = [
	...RATE_TOPICS,
	seasonHighs,
	bench,
	ironman,
	moved,
	injured,
	ovrTopic,
	ovrJump,
	potential,
	peakOvr,
	earnings,
	value,
	raise,
	journey,
	loyal,
	honors,
	crown,
	allStarStreak,
	careerBest,
	arc,
	poGames,
	ring,
	agePeers,
	draftClass,
	draftSlot,
	undrafted,
	country,
	family,
	chase,
	firsts,
	position,
	rookieYear,
	games20,
	carry,
];

export { DEFS as PLAYER_DEFS, lineBoard };
