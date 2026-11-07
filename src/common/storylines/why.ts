// "Why this story?": the rows of data behind a storyline, built from the story's season, players and teams and from the league snapshot, never from the story's wording. Cells may carry the same link tokens as story text.

import type { LeagueIndex } from "../wrapped/league.ts";
import type { WGame } from "../wrapped/types.ts";
import {
	fmtNum,
	fmtRecord,
	fmtWinp,
	ordinal,
	rankOf,
	winPct,
} from "../wrapped/util.ts";
import {
	gLink,
	leadersBy,
	pLink,
	roundLabel,
	tLink,
	type RateKey,
	type Story,
	lineOf,
	teamsInSeason,
} from "./kit.ts";

export type WhySection = {
	id: string;
	title: string;
	note?: string;
	cols: string[];
	rows: string[][];
};

export type WhyContext = {
	// Position of the story within its kind (1 = biggest) and how many of the kind there are
	kindRank: number;
	kindCount: number;
	// Position in the overall ranking
	rank: number;
	total: number;
};

const STATS: [RateKey, string][] = [
	["ppg", "Points"],
	["rpg", "Rebounds"],
	["apg", "Assists"],
	["spg", "Steals"],
	["bpg", "Blocks"],
	["ws", "Win shares"],
	["per", "PER"],
];

const effOf = (l: WGame["teams"][number]["players"][number]) =>
	l.pts + l.trb + l.ast + l.stl + l.blk;

// One-line description of a stored game from a team's side
const gameRow = (
	X: LeagueIndex,
	g: WGame,
	tid: number,
	note: string,
): string[] => {
	const me = g.teams.find((t) => t.tid === tid) ?? g.teams[0];
	const opp = g.teams.find((t) => t !== me)!;
	const ab = X.teamAny(opp.tid, g.season)?.abbrev ?? "?";
	return [
		gLink(g, `${g.season}${g.playoffs ? " playoffs" : ""}`),
		`${me.pts > opp.pts ? "W" : "L"} ${me.pts}–${opp.pts} vs ${ab}${g.overtimes > 0 ? ` (${g.overtimes}OT)` : ""}`,
		note,
	];
};

// The stored box scores that shaped a story, with a line on why each is listed. Empty when the season has none.
export const keyGames = (X: LeagueIndex, s: Story, max = 4) => {
	const all = X.games(s.season);
	const out: { g: WGame; tid: number; note: string }[] = [];
	const add = (g: WGame | undefined, tid: number, note: string) => {
		if (g && !out.some((o) => o.g.gid === g.gid)) {
			out.push({ g, tid, note });
		}
	};
	if (all.length === 0) {
		return out;
	}
	const byGid = new Map(all.map((g) => [g.gid, g]));
	for (const gid of s.gids ?? []) {
		add(
			byGid.get(gid),
			s.tids[0] ?? byGid.get(gid)!.teams[0].tid,
			"The game itself",
		);
	}
	if (out.length > 0) {
		return out;
	}
	const ordered = [...all].sort((a, b) => a.day - b.day || a.gid - b.gid);
	const po = (a: WGame, b: WGame) => Number(b.playoffs) - Number(a.playoffs);
	if (s.pids.length === 1) {
		const pid = s.pids[0]!;
		const mine: {
			g: WGame;
			tid: number;
			l: WGame["teams"][number]["players"][number];
		}[] = [];
		for (const g of ordered) {
			for (const t of g.teams) {
				const l = t.players.find((x) => x.pid === pid);
				if (l && l.min > 0) {
					mine.push({ g, tid: t.tid, l });
				}
			}
		}
		const best = [...mine].sort(
			(a, b) =>
				(s.shape === "playoffs" ? po(a.g, b.g) : 0) ||
				effOf(b.l) - effOf(a.l) ||
				a.g.gid - b.g.gid,
		);
		for (const x of best.slice(0, 3)) {
			add(x.g, x.tid, `${x.l.pts} pts, ${x.l.trb} reb, ${x.l.ast} ast`);
		}
		const worst = mine
			.filter((x) => x.l.min >= 20)
			.sort((a, b) => effOf(a.l) - effOf(b.l) || a.g.gid - b.g.gid)[0];
		if (worst) {
			add(
				worst.g,
				worst.tid,
				`A quiet night: ${worst.l.pts} pts, ${worst.l.trb} reb, ${worst.l.ast} ast`,
			);
		}
	} else if (s.pids.length === 2) {
		const both = ordered.filter((g) =>
			s.pids.every((pid) =>
				g.teams.some((t) => t.players.some((x) => x.pid === pid && x.min > 0)),
			),
		);
		const score = (g: WGame) =>
			g.teams
				.flatMap((t) => t.players)
				.filter((x) => s.pids.includes(x.pid))
				.reduce((a, x) => a + effOf(x), 0);
		for (const g of [...both]
			.sort((a, b) => score(b) - score(a) || a.gid - b.gid)
			.slice(0, 3)) {
			add(g, g.teams[0].tid, "Both of them played");
		}
	} else if (s.tids.length === 2 && s.pids.length === 0) {
		const [a, b] = s.tids as [number, number];
		const meets = ordered.filter(
			(g) =>
				g.teams.some((t) => t.tid === a) && g.teams.some((t) => t.tid === b),
		);
		for (const g of [...meets].sort(po).slice(0, max)) {
			add(g, a, g.playoffs ? "A playoff meeting" : "A regular-season meeting");
		}
	} else if (s.tids.length === 1) {
		const tid = s.tids[0]!;
		const mine = ordered.filter((g) => g.teams.some((t) => t.tid === tid));
		const margin = (g: WGame) => {
			const me = g.teams.find((t) => t.tid === tid)!;
			return me.pts - g.teams.find((t) => t !== me)!.pts;
		};
		if (s.shape === "playoffs") {
			const playoffs = mine.filter((g) => g.playoffs);
			for (const g of playoffs.slice(-2)) {
				add(g, tid, "One of their last playoff games");
			}
		}
		const win = [...mine].sort(
			(a, b) => margin(b) - margin(a) || a.gid - b.gid,
		)[0];
		if (win && margin(win) > 0) {
			add(win, tid, "Their biggest win");
		}
		const loss = [...mine].sort(
			(a, b) => margin(a) - margin(b) || a.gid - b.gid,
		)[0];
		if (loss && margin(loss) < 0) {
			add(loss, tid, "Their worst loss");
		}
		// Longest winning streak among the stored games
		let run = 0;
		let best = { n: 0, g: undefined as WGame | undefined };
		for (const g of mine.filter((x) => !x.playoffs)) {
			run = margin(g) > 0 ? run + 1 : 0;
			if (run > best.n) {
				best = { n: run, g };
			}
		}
		if (best.n >= 4) {
			add(best.g, tid, `The ${best.n}th win of their longest streak`);
		}
	}
	return out.slice(0, max);
};

// The story's season, rank and evidence rows for every player and team it names
export const whyOf = (
	X: LeagueIndex,
	s: Story,
	ctx: WhyContext,
): WhySection[] => {
	const out: WhySection[] = [];

	out.push({
		id: "rank",
		title: "Why it ranks here",
		note: "Stories are scored from the size of the numbers behind them, then spread out so one kind does not fill the list.",
		cols: ["", ""],
		rows: [
			["Score", fmtNum(s.score, 1)],
			[
				`Among ${s.kind} stories`,
				`${ordinal(ctx.kindRank)} of ${ctx.kindCount}`,
			],
			["Overall", `${ordinal(ctx.rank)} of ${ctx.total}`],
			["Season", `${s.season}`],
		],
	});

	if (s.evidence.length > 0) {
		out.push({
			id: "evidence",
			title: "The numbers it is built on",
			cols: ["Fact", "Value"],
			rows: s.evidence.map(([a, b]) => [a, b]),
		});
	}

	const pids = s.pids.slice(0, 4);
	if (pids.length > 0) {
		const rows: string[][] = [];
		for (const pid of pids) {
			const p = X.players.get(pid);
			if (!p) {
				continue;
			}
			const l = lineOf(X, pid, s.season);
			// No games that season (a draft-year story, say): the whole career instead
			const c = l ? X.career(p, s.season) : X.career(p);
			const ws = l ? leadersBy(X, s.season, "ws").map((x) => x.ws) : [];
			rows.push([
				pLink(p),
				l ? tLink(X, l.tid, s.season) : "–",
				l ? `${l.gp}` : "–",
				l ? fmtNum(l.ppg, 1) : "–",
				l ? fmtNum(l.rpg, 1) : "–",
				l ? fmtNum(l.apg, 1) : "–",
				l ? fmtNum(l.ws, 1) : "–",
				l && X.qualified(s.season).some((q) => q.pid === pid)
					? ordinal(rankOf(ws, l.ws))
					: "–",
				fmtNum(c.pts),
				fmtNum(c.ws, 1),
			]);
		}
		out.push({
			id: "players",
			title: `The players in ${s.season}`,
			note: "Season line, then career totals through that season (the whole career if he did not play that season). WS rank is among qualified players.",
			cols: [
				"Player",
				"Team",
				"GP",
				"PTS",
				"REB",
				"AST",
				"WS",
				"WS rank",
				"Career PTS",
				"Career WS",
			],
			rows,
		});
		if (pids.length === 1) {
			const pid = pids[0]!;
			const l = lineOf(X, pid, s.season);
			if (l && X.qualified(s.season).some((q) => q.pid === pid)) {
				const n = X.qualified(s.season).length;
				out.push({
					id: "ranks",
					title: `Where he ranked in ${s.season}`,
					note: `Among ${n} qualified players.`,
					cols: ["Stat", "Value", "League rank"],
					rows: STATS.map(([k, label]) => {
						const vals = leadersBy(X, s.season, k).map((x) => x[k]);
						return [label, fmtNum(l[k], 1), ordinal(rankOf(vals, l[k]))];
					}),
				});
			}
		}
	}

	const tids = s.tids.slice(0, 3);
	if (tids.length > 0) {
		const rows: string[][] = [];
		for (const tid of tids) {
			const t = X.team(tid, s.season);
			if (!t) {
				continue;
			}
			const peers = teamsInSeason(X, s.season).map((x) =>
				winPct(x.won, x.lost, x.tied),
			);
			const n = X.numRounds(s.season);
			const result = !X.decided(s.season)
				? "In progress"
				: t.playoffRoundsWon >= n
					? "Champions"
					: t.playoffRoundsWon < 0
						? "Missed the playoffs"
						: `Lost in ${roundLabel(t.playoffRoundsWon, n)}`;
			rows.push([
				tLink(X, tid, s.season),
				fmtRecord(t.won, t.lost, t.tied, t.otl),
				fmtWinp(winPct(t.won, t.lost, t.tied)),
				ordinal(rankOf(peers, winPct(t.won, t.lost, t.tied))),
				t.seed ? `${t.seed}` : "–",
				result,
				t.gp > 0 ? fmtNum((t.pts - t.oppPts) / t.gp, 1) : "–",
			]);
		}
		if (rows.length > 0) {
			out.push({
				id: "teams",
				title: `The teams in ${s.season}`,
				cols: ["Team", "Record", "Win%", "Rank", "Seed", "Result", "Margin"],
				rows,
			});
		}
		// The playoff path of the first team, for stories about a playoff run
		const first = tids[0]!;
		const ps = X.decided(s.season) ? X.series(s.season) : undefined;
		if (ps && s.shape === "playoffs") {
			const rows2: string[][] = [];
			const nr = ps.rounds.length;
			ps.rounds.forEach((round, i) => {
				for (const m of round) {
					if (!m.away) {
						continue;
					}
					const me =
						m.home.tid === first
							? m.home
							: m.away.tid === first
								? m.away
								: undefined;
					const opp = me === m.home ? m.away : m.home;
					if (me) {
						rows2.push([
							i === nr - 1
								? "Finals"
								: i === nr - 2 && nr >= 3
									? "Semifinals"
									: `Round ${i + 1}`,
							tLink(X, opp.tid, s.season),
							`${me.won}–${opp.won}`,
							me.won > opp.won ? "Won" : "Lost",
							`${me.seed} vs ${opp.seed}`,
						]);
					}
				}
			});
			if (rows2.length > 0) {
				out.push({
					id: "path",
					title: `${X.teamName(first, s.season)}’ playoff path`,
					cols: ["Round", "Opponent", "Series", "Result", "Seeds"],
					rows: rows2,
				});
			}
		}
		// Franchise run around the story
		if (tids.length === 1) {
			const rows3 = X.teamHistory(first)
				.filter(
					(t) =>
						t.season >= s.season - 3 &&
						t.season <= s.season + 2 &&
						X.decided(t.season),
				)
				.map((t) => [
					tLink(X, first, t.season),
					`${t.season}`,
					fmtRecord(t.won, t.lost, t.tied, t.otl),
					t.playoffRoundsWon < 0
						? "–"
						: t.playoffRoundsWon >= X.numRounds(t.season)
							? "Champions"
							: `${t.playoffRoundsWon} rounds won`,
				]);
			if (rows3.length > 1) {
				out.push({
					id: "run",
					title: "The franchise around then",
					cols: ["Team", "Season", "Record", "Playoffs"],
					rows: rows3,
				});
			}
		}
	}

	const kg = keyGames(X, s);
	if (kg.length > 0) {
		out.push({
			id: "games",
			title: "Key games",
			note: "From the box scores this league still stores.",
			cols: ["Game", "Result", "Why it is here"],
			rows: kg.map((k) => gameRow(X, k.g, k.tid, k.note)),
		});
	}
	return out;
};
