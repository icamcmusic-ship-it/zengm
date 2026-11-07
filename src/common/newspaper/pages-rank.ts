// Ranked-list pages: each is one list of players or teams told as a leader story, a table, a podium, the two ends or a chase. Every number comes from the facts; a list that the data cannot support is not printed.

import type { Ctx } from "./ctx.ts";
import {
	ALL_EDS,
	addPage,
	type Item,
	PLAYED,
	PRE_ONLY,
	rankPage,
	type RankSpec,
	SEASON_EDS,
} from "./kit.ts";
import { fmt1, money, signed } from "./text.ts";
import type { NPPlayer, NPTeam } from "./types.ts";

const int = (v: number) => String(Math.round(v));
const pct = (v: number) => `${fmt1(v)}%`;
const sgn = (v: number) => signed(v, 1);

const desc = (items: Item[]) => items.toSorted((a, b) => b.v - a.v || a.id - b.id);
const asc = (items: Item[]) => items.toSorted((a, b) => a.v - b.v || a.id - b.id);

const players = (
	list: NPPlayer[],
	v: (p: NPPlayer) => number | undefined,
	note?: (p: NPPlayer) => string | undefined,
): Item[] => {
	const out: Item[] = [];
	for (const p of list) {
		const x = v(p);
		if (x !== undefined && Number.isFinite(x)) {
			out.push({ kind: "p", id: p.pid, v: x, note: note?.(p) });
		}
	}
	return out;
};

const teams = (
	c: Ctx,
	v: (t: NPTeam) => number | undefined,
	need = 1,
): Item[] => {
	const out: Item[] = [];
	for (const t of c.f.teams) {
		if (t.gp < need && !c.pre) {
			continue;
		}
		const x = v(t);
		if (x !== undefined && Number.isFinite(x)) {
			out.push({ kind: "t", id: t.tid, v: x });
		}
	}
	return out;
};

// Fraction of the games on the schedule the box scores cover for this player
const boxed = (p: NPPlayer) =>
	p.boxGp !== undefined && p.gp > 0 && p.boxGp >= p.gp * 0.8;

const winPct = (w: number, l: number) => (w + l > 0 ? (100 * w) / (w + l) : undefined);

const lastN = (t: NPTeam) => t.hist?.toSorted((a, b) => b.season - a.season) ?? [];

const specs: RankSpec[] = [
	// ---- Players ----
	{
		id: "r-doubledoubles",
		section: "players",
		kicker: "Double-double watch",
		eds: PLAYED,
		beat: "numbers",
		topic: "double-doubles",
		unit: "double-doubles",
		col: "DD",
		fmt: int,
		minTop: 3,
		items: (c) =>
			desc(players(c.f.players, (p) => (boxed(p) ? p.dd : undefined))).filter(
				(x) => x.v > 0,
			),
	},
	{
		id: "r-thirty",
		section: "players",
		kicker: "The 30-point club",
		eds: PLAYED,
		beat: "numbers",
		topic: "30-point games",
		unit: "games of 30 or more points",
		col: "30+",
		fmt: int,
		minTop: 2,
		items: (c) =>
			desc(players(c.f.players, (p) => (boxed(p) ? p.g30 : undefined))).filter(
				(x) => x.v > 0,
			),
	},
	{
		id: "r-threes",
		section: "players",
		kicker: "Downtown",
		eds: PLAYED,
		beat: "numbers",
		topic: "three-pointers made",
		unit: "threes a game",
		col: "3PM",
		fmt: fmt1,
		items: (c) => desc(players(c.qual, (p) => p.tp)),
	},
	{
		id: "r-threepct",
		section: "players",
		kicker: "Sharpshooters",
		eds: PLAYED,
		beat: "numbers",
		topic: "three-point accuracy",
		unit: "from three",
		col: "3P%",
		fmt: pct,
		ends: true,
		endWord: "coldest",
		items: (c) =>
			desc(
				players(
					c.qual.filter((p) => p.tp * p.gp >= 30),
					(p) => p.tpp,
				),
			),
	},
	{
		id: "r-ft",
		section: "players",
		kicker: "At the line",
		eds: PLAYED,
		beat: "numbers",
		topic: "free-throw shooting",
		unit: "from the line",
		col: "FT%",
		fmt: pct,
		ends: true,
		endWord: "shakiest",
		items: (c) => desc(players(c.qual, (p) => p.ftp)),
	},
	{
		id: "r-per",
		section: "players",
		kicker: "Efficiency",
		eds: PLAYED,
		beat: "numbers",
		topic: "player efficiency",
		unit: "PER",
		col: "PER",
		fmt: fmt1,
		items: (c) => desc(players(c.qual, (p) => (p.per > 0 ? p.per : undefined))),
	},
	{
		id: "r-minutes",
		section: "players",
		kicker: "Heavy legs",
		eds: PLAYED,
		beat: "numbers",
		topic: "minutes per game",
		unit: "minutes a game",
		col: "MPG",
		fmt: fmt1,
		items: (c) => desc(players(c.qual, (p) => p.min)),
		note: (c, items) =>
			`The league average among qualified players ${c.T("is", "was")} ${fmt1(
				items.reduce((a, x) => a + x.v, 0) / items.length,
			)} minutes.`,
	},
	{
		id: "r-ironmen",
		section: "players",
		kicker: "Iron men",
		eds: PLAYED,
		beat: "numbers",
		topic: "total minutes",
		unit: "minutes",
		col: "Min",
		fmt: (v) => Math.round(v).toLocaleString("en-US"),
		items: (c) => desc(players(c.qual, (p) => p.min * p.gp)),
	},
	{
		id: "r-stocks",
		section: "players",
		kicker: "Defensive desk",
		eds: PLAYED,
		beat: "numbers",
		topic: "steals plus blocks",
		unit: "steals plus blocks a game",
		col: "STL+BLK",
		fmt: fmt1,
		items: (c) => desc(players(c.qual, (p) => p.stl + p.blk)),
	},
	{
		id: "r-bench",
		section: "players",
		kicker: "From the bench",
		eds: PLAYED,
		beat: "numbers",
		topic: "bench scoring",
		unit: "points a game off the bench",
		col: "PPG",
		fmt: fmt1,
		items: (c) =>
			desc(
				players(
					c.qual.filter((p) => p.gs !== undefined && p.gs <= 0.25),
					(p) => p.pts,
				),
			),
	},
	{
		id: "r-astto",
		section: "players",
		kicker: "Ball security",
		eds: PLAYED,
		beat: "numbers",
		topic: "assist-to-turnover ratio",
		unit: "assists per turnover",
		col: "AST/TO",
		fmt: (v) => v.toFixed(2),
		ends: true,
		endWord: "loosest",
		items: (c) =>
			desc(
				players(
					c.qual.filter((p) => (p.tov ?? 0) >= 1 && p.ast >= 3),
					(p) => p.ast / p.tov!,
				),
			),
	},
	{
		id: "r-orb",
		section: "players",
		kicker: "Glass cleaners",
		eds: PLAYED,
		beat: "numbers",
		topic: "offensive rebounding",
		unit: "offensive rebounds a game",
		col: "ORB",
		fmt: fmt1,
		items: (c) => desc(players(c.qual, (p) => p.orb)),
	},
	{
		id: "r-pm",
		section: "players",
		kicker: "Plus-minus",
		eds: PLAYED,
		beat: "numbers",
		topic: "plus-minus",
		unit: "per game on the floor",
		col: "+/-",
		fmt: sgn,
		ends: true,
		endWord: "lowest",
		items: (c) => desc(players(c.qual, (p) => p.pm)),
	},
	{
		id: "r-fouls",
		section: "players",
		kicker: "The whistle",
		eds: PLAYED,
		beat: "numbers",
		topic: "personal fouls",
		unit: "fouls a game",
		col: "PF",
		fmt: (v) => v.toFixed(2),
		items: (c) => desc(players(c.qual, (p) => p.pf)),
	},
	{
		id: "r-veterans",
		section: "players",
		kicker: "The veterans",
		eds: PLAYED,
		beat: "features",
		topic: "age among rotation players",
		unit: "years old",
		col: "Age",
		fmt: int,
		items: (c) =>
			desc(
				players(
					c.qual.filter((p) => p.min >= 15),
					(p) => p.age,
				),
			),
		note: (c, items) => {
			const old = items.filter((x) => x.v >= 33).length;
			return old > 0
				? `${old} rotation ${old === 1 ? "player is" : "players are"} 33 or older.`
				: undefined;
		},
	},
	{
		id: "r-young",
		section: "players",
		kicker: "Young guns",
		eds: PLAYED,
		beat: "features",
		topic: "youth among rotation players",
		unit: "years old",
		col: "Age",
		fmt: int,
		items: (c) =>
			asc(
				players(
					c.qual.filter((p) => p.min >= 15),
					(p) => p.age,
				),
			),
	},
	{
		id: "r-gain",
		section: "players",
		kicker: "Ratings watch",
		eds: PLAYED,
		beat: "features",
		topic: "rating gains",
		unit: "rating points",
		col: "Change",
		fmt: (v) => signed(v, 0),
		minTop: 3,
		items: (c) =>
			desc(
				players(
					c.f.players.filter((p) => p.gp >= 10),
					(p) => (p.prevOvr !== undefined ? p.ovr - p.prevOvr : undefined),
					(p) => `(${p.prevOvr} to ${p.ovr})`,
				),
			),
	},
	{
		id: "r-drop",
		section: "players",
		kicker: "Ratings slide",
		eds: PLAYED,
		beat: "features",
		topic: "rating losses",
		unit: "rating points",
		col: "Change",
		fmt: (v) => signed(v, 0),
		items: (c) =>
			asc(
				players(
					c.f.players.filter((p) => p.gp >= 10),
					(p) => (p.prevOvr !== undefined ? p.ovr - p.prevOvr : undefined),
					(p) => `(${p.prevOvr} to ${p.ovr})`,
				),
			).filter((x) => x.v < 0),
	},
	{
		id: "r-ceiling",
		section: "players",
		kicker: "High ceilings",
		eds: ALL_EDS,
		beat: "draft",
		topic: "potential among players 22 and under",
		unit: "potential",
		col: "Pot",
		fmt: int,
		items: (c) =>
			desc(
				players(
					c.f.players.filter((p) => p.age <= 22),
					(p) => p.pot,
					(p) => `(age ${p.age}, ${p.ovr} now)`,
				),
			),
	},
	{
		id: "r-po-scorers",
		section: "players",
		kicker: "Playoff scoring",
		eds: ["playoffs", "final"],
		beat: "playoffs",
		topic: "playoff scoring",
		unit: "points a game in the playoffs",
		col: "PPG",
		fmt: fmt1,
		items: (c) =>
			desc(
				players(
					c.f.players.filter((p) => p.po && p.po.gp >= 3),
					(p) => p.po!.pts,
					(p) => `(${p.po!.gp} G)`,
				),
			),
	},
	{
		id: "r-po-risers",
		section: "players",
		kicker: "Playoff risers",
		eds: ["playoffs", "final"],
		beat: "playoffs",
		topic: "playoff scoring jumps",
		unit: "points a game over the regular season",
		col: "Change",
		fmt: sgn,
		minTop: 1,
		items: (c) =>
			desc(
				players(
					c.f.players.filter((p) => p.po && p.po.gp >= 4 && p.gp >= 20),
					(p) => p.po!.pts - p.pts,
					(p) => `(${fmt1(p.pts)} to ${fmt1(p.po!.pts)})`,
				),
			),
	},
	{
		id: "r-career",
		section: "history",
		kicker: "All-time scoring",
		eds: ALL_EDS,
		beat: "numbers",
		topic: "career points",
		unit: "career points",
		col: "Points",
		fmt: (v) => Math.round(v).toLocaleString("en-US"),
		items: (c) =>
			(c.f.careerBoard ?? []).map((r) => ({
				kind: "p" as const,
				id: r.pid,
				v: r.pts,
				note: r.active ? "(active)" : "(retired)",
			})),
		note: (c) =>
			`Totals run through the end of the ${c.season - 1} season${c.f.firstSeason > 0 ? `, counted from ${c.f.firstSeason}, when this league's records begin` : ""}.`,
	},
	// ---- Teams ----
	{
		id: "r-offense",
		section: "teams",
		kicker: "Offense",
		eds: PLAYED,
		beat: "numbers",
		topic: "team scoring",
		unit: "points a game",
		col: "PPG",
		fmt: fmt1,
		ends: true,
		endWord: "lowest-scoring",
		items: (c) => desc(teams(c, (t) => t.pts, 5)),
	},
	{
		id: "r-defense",
		section: "teams",
		kicker: "Defense",
		eds: PLAYED,
		beat: "numbers",
		topic: "points allowed",
		unit: "points allowed a game",
		col: "Opp PPG",
		fmt: fmt1,
		ends: true,
		endWord: "leakiest",
		items: (c) => asc(teams(c, (t) => t.oppPts, 5)),
	},
	{
		id: "r-home",
		section: "teams",
		kicker: "Home cooking",
		eds: PLAYED,
		beat: "numbers",
		topic: "winning at home",
		unit: "at home",
		col: "Home %",
		fmt: pct,
		ends: true,
		endWord: "weakest at home",
		items: (c) => desc(teams(c, (t) => winPct(t.wonHome, t.lostHome), 8)),
	},
	{
		id: "r-road",
		section: "teams",
		kicker: "Road warriors",
		eds: PLAYED,
		beat: "numbers",
		topic: "winning on the road",
		unit: "on the road",
		col: "Road %",
		fmt: pct,
		ends: true,
		endWord: "weakest on the road",
		items: (c) => desc(teams(c, (t) => winPct(t.wonAway, t.lostAway), 8)),
	},
	{
		id: "r-close",
		section: "teams",
		kicker: "Clutch time",
		eds: PLAYED,
		beat: "numbers",
		topic: "close games",
		unit: "in games decided by five or fewer",
		col: "Close %",
		fmt: pct,
		ends: true,
		endWord: "worst in close games",
		items: (c) =>
			desc(
				teams(c, (t) =>
					t.close && t.close.w + t.close.l >= 6
						? winPct(t.close.w, t.close.l)
						: undefined,
				),
			),
		note: (c, items) => {
			const top = items[0]!;
			const t = c.team(top.id);
			return t?.close
				? `The ${t.name} ${c.T("are", "were")} ${t.close.w}-${t.close.l} in games decided by five points or fewer.`
				: undefined;
		},
	},
	{
		id: "r-overtime",
		section: "teams",
		kicker: "Extra minutes",
		eds: PLAYED,
		beat: "numbers",
		topic: "overtime",
		unit: "overtime wins",
		col: "OT wins",
		fmt: int,
		minTop: 2,
		items: (c) => desc(teams(c, (t) => (t.ot ? t.ot.w : undefined), 5)),
	},
	{
		id: "r-streak-best",
		section: "teams",
		kicker: "Hot streaks",
		eds: PLAYED,
		beat: "numbers",
		topic: "winning streaks",
		unit: "straight wins",
		col: "Streak",
		fmt: int,
		minTop: 4,
		items: (c) => desc(teams(c, (t) => t.bestStreak, 5)),
	},
	{
		id: "r-streak-worst",
		section: "teams",
		kicker: "Cold streaks",
		eds: PLAYED,
		beat: "numbers",
		topic: "losing streaks",
		unit: "straight losses",
		col: "Skid",
		fmt: int,
		minTop: 4,
		items: (c) => desc(teams(c, (t) => t.worstStreak, 5)),
	},
	{
		id: "r-lucky",
		section: "teams",
		kicker: "Luck of the draw",
		eds: PLAYED,
		beat: "numbers",
		topic: "winning more than the scores say",
		unit: "wins against the scoring margins",
		col: "Wins vs. expected",
		fmt: (v) => signed(v, 1),
		ends: true,
		endWord: "unluckiest",
		items: (c) =>
			desc(
				teams(c, (t) => {
					const e = c.pyth(t);
					return e === undefined ? undefined : t.won - e;
				}, 10),
			),
		note: (c) =>
			"Expected wins come from points scored and allowed (the Pythagorean method); the gap is the part of the record the margins do not explain.",
	},
	{
		id: "r-roster-age",
		section: "teams",
		kicker: "The age of rosters",
		eds: ALL_EDS,
		beat: "features",
		topic: "roster age",
		unit: "years old on average",
		col: "Avg age",
		fmt: fmt1,
		ends: true,
		endWord: "youngest",
		items: (c) =>
			desc(
				teams(c, (t) => {
					const ps = c.f.players
						.filter((p) => p.tid === t.tid)
						.toSorted((a, b) => b.ovr - a.ovr)
						.slice(0, 8);
					return ps.length >= 6
						? ps.reduce((a, p) => a + p.age, 0) / ps.length
						: undefined;
				}),
			),
	},
	{
		id: "r-roster-rating",
		section: "teams",
		kicker: "Roster ratings",
		eds: ALL_EDS,
		beat: "numbers",
		topic: "roster rating",
		unit: "rating",
		col: "Rating",
		fmt: fmt1,
		ends: true,
		endWord: "lowest",
		items: (c) => desc(teams(c, (t) => c.teamOvr(t.tid))),
	},
	{
		id: "r-progress",
		section: "teams",
		kicker: "Summer school",
		eds: [...PRE_ONLY, "midseason"],
		beat: "features",
		topic: "development over the summer",
		unit: "rating points per player",
		col: "Change",
		fmt: sgn,
		ends: true,
		endWord: "biggest decline",
		items: (c) =>
			desc(
				teams(c, (t) => {
					const ps = c.f.players
						.filter((p) => p.tid === t.tid && p.prevOvr !== undefined)
						.toSorted((a, b) => b.ovr - a.ovr)
						.slice(0, 8);
					return ps.length >= 5
						? ps.reduce((a, p) => a + (p.ovr - p.prevOvr!), 0) / ps.length
						: undefined;
				}),
			),
	},
	{
		id: "r-fiveyears",
		section: "history",
		kicker: "Five-year swings",
		eds: SEASON_EDS,
		beat: "league",
		topic: "change in winning percentage over five seasons",
		unit: "points of winning percentage",
		col: "Change",
		fmt: (v) => signed(v, 0),
		ends: true,
		endWord: "biggest slide",
		items: (c) =>
			desc(
				teams(
					c,
					(t) => {
						const then = t.hist?.find((h) => h.season === c.season - 5);
						if (!then || then.won + then.lost === 0 || t.gp === 0) {
							return undefined;
						}
						return (
							100 *
							(t.won / (t.won + t.lost) - then.won / (then.won + then.lost))
						);
					},
					10,
				),
			),
	},
	{
		id: "r-franchise-wins",
		section: "history",
		kicker: "The win column",
		eds: ALL_EDS,
		beat: "numbers",
		topic: "franchise wins",
		unit: "wins",
		col: "Wins",
		fmt: (v) => Math.round(v).toLocaleString("en-US"),
		items: (c) =>
			desc(
				teams(
					c,
					(t) => (t.hist?.length ?? 0) >= 3 ? (t.hist ?? []).reduce((a, h) => a + h.won, 0) + (c.pre ? 0 : t.won) : undefined,
					0,
				),
			),
		note: (c, items) =>
			`Wins are counted from ${c.f.firstSeason}${c.pre ? ", through last season" : c.done ? ", through this season" : ", through the games played so far"}; the league's total so far is ${Math.round(items.reduce((a, x) => a + x.v, 0)).toLocaleString("en-US")}.`,
	},
	{
		id: "r-titles",
		section: "history",
		kicker: "Banners",
		eds: ALL_EDS,
		beat: "league",
		topic: "championships",
		unit: "titles",
		col: "Titles",
		fmt: int,
		minTop: 2,
		items: (c) =>
			desc(
				teams(
					c,
					(t) => t.titles.length + (c.done && c.f.champion === t.tid ? 1 : 0),
					0,
				),
			),
	},
	{
		id: "r-playoff-streak",
		section: "history",
		kicker: "Playoff regulars",
		eds: ALL_EDS,
		beat: "league",
		topic: "consecutive playoff trips",
		unit: "straight playoff trips",
		col: "Seasons",
		fmt: int,
		minTop: 3,
		items: (c) =>
			desc(
				teams(
					c,
					(t) => {
						let n = c.done && t.playoffRoundsWon >= 0 ? 1 : 0;
						if (!c.done || t.playoffRoundsWon >= 0) {
							for (const h of lastN(t)) {
								if (h.playoffRoundsWon < 0) {
									break;
								}
								n += 1;
							}
						}
						return n;
					},
					0,
				),
			),
	},
	{
		id: "r-drought",
		section: "history",
		kicker: "The waiting list",
		eds: ALL_EDS,
		beat: "league",
		topic: "playoff droughts",
		unit: "seasons without the playoffs",
		col: "Seasons",
		fmt: int,
		minTop: 3,
		items: (c) =>
			desc(
				teams(
					c,
					(t) => {
						if (c.done && t.playoffRoundsWon >= 0) {
							return 0;
						}
						let n = c.done ? 1 : 0;
						for (const h of lastN(t)) {
							if (h.playoffRoundsWon >= 0) {
								break;
							}
							n += 1;
						}
						return n;
					},
					0,
				),
			),
	},
	{
		id: "r-winning-habit",
		section: "history",
		kicker: "Winning habits",
		eds: ALL_EDS,
		beat: "league",
		topic: "consecutive winning seasons",
		unit: "straight winning seasons",
		col: "Seasons",
		fmt: int,
		minTop: 3,
		items: (c) =>
			desc(
				teams(
					c,
					(t) => {
						let n = 0;
						for (const h of lastN(t)) {
							if (h.won <= h.lost) {
								break;
							}
							n += 1;
						}
						return n;
					},
					0,
				),
			),
	},
	{
		id: "r-bridesmaids",
		section: "history",
		kicker: "Always the bridesmaid",
		eds: ALL_EDS,
		beat: "league",
		topic: "finals losses",
		unit: "finals losses",
		col: "Finals losses",
		fmt: int,
		minTop: 2,
		items: (c) =>
			desc(
				teams(
					c,
					(t) =>
						(t.hist ?? []).filter((h) => h.playoffRoundsWon === c.f.numRounds - 1)
							.length +
						(c.done && t.playoffRoundsWon === c.f.numRounds - 1 ? 1 : 0),
					0,
				),
			),
	},
	// ---- Money ----
	{
		id: "r-payroll",
		section: "money",
		kicker: "The payroll",
		eds: ALL_EDS,
		beat: "moves",
		topic: "payroll",
		unit: "in contracts",
		col: "Payroll",
		fmt: (v) => money(v),
		ends: true,
		endWord: "smallest",
		items: (c) => desc(teams(c, (t) => t.payroll, 0)),
		note: (c, items) =>
			c.f.salaryCap
				? `The salary cap ${c.T("is", "was")} ${money(c.f.salaryCap)}${c.f.luxuryPayroll ? ` and the luxury tax line ${money(c.f.luxuryPayroll)}` : ""}; the average payroll ${c.T("is", "was")} ${money(items.reduce((a, x) => a + x.v, 0) / items.length)}.`
				: undefined,
	},
	{
		id: "r-bigcontracts",
		section: "money",
		kicker: "Big contracts",
		eds: ALL_EDS,
		beat: "moves",
		topic: "salary",
		unit: "a year",
		col: "Salary",
		fmt: (v) => money(v),
		items: (c) => desc(players(c.f.players, (p) => p.contractAmount, (p) => p.contractExp !== undefined ? `(through ${p.contractExp})` : undefined)),
	},
	{
		id: "r-expiring",
		section: "money",
		kicker: "Contract year",
		eds: ALL_EDS,
		beat: "moves",
		topic: "expiring contracts",
		unit: "rating",
		col: "Rating",
		fmt: int,
		items: (c) =>
			desc(
				players(
					c.f.players.filter(
						(p) => p.contractExp !== undefined && p.contractExp <= c.season,
					),
					(p) => p.ovr,
					(p) => (p.contractAmount ? `(${money(p.contractAmount)})` : undefined),
				),
			),
	},
	{
		id: "r-dollar-wins",
		section: "money",
		kicker: "Dollars and wins",
		eds: PLAYED,
		beat: "numbers",
		topic: "wins per dollar",
		unit: "wins per $10M",
		col: "Wins per $10M",
		fmt: fmt1,
		ends: true,
		endWord: "least efficient",
		items: (c) =>
			desc(
				teams(c, (t) =>
					t.payroll && t.payroll > 1000
						? t.won / (t.payroll / 10000)
						: undefined,
				),
			),
	},
];

for (const spec of specs) {
	addPage(rankPage({ ...spec, eds: spec.eds ?? SEASON_EDS }));
}

export const RANK_PAGE_COUNT = specs.length;
