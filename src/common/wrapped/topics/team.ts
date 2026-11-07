import type { Slide } from "../types.ts";
import {
	fmtNum,
	fmtRecord,
	fmtWinp,
	ordinal,
	plural,
	rankOf,
	rankScore,
	winPct,
} from "../util.ts";
import { bestGame } from "./season.ts";
import { gameLines, lineText, mk, type Topic } from "./helpers.ts";

const roundName = (ri: number, n: number) =>
	ri === n - 1
		? "the finals"
		: ri === n - 2
			? "the semifinals"
			: ri === n - 3
				? "the quarterfinals"
				: `round ${ri + 1}`;

const intro: Topic = ({ X, season, tid }) => {
	const t = X.team(tid!, season);
	if (!t) {
		return null;
	}
	const roster = X.lines(season).filter((l) => l.tids.includes(tid!));
	return mk({
		id: "intro",
		group: "intro",
		theme: "intro",
		score: 1,
		core: true,
		kicker: `${season} Wrapped`,
		tid: tid!,
		season,
		heads: [
			`The ${t.region} ${t.name}’s ${season}, wrapped`,
			`${t.region} ${t.name}: ${season} in review`,
		],
		hero: { text: fmtRecord(t.won, t.lost, t.tied, t.otl), unit: "record" },
		lines: [`${plural(roster.length, "player")} suited up`],
	});
};

const record: Topic = ({ X, season, tid }) => {
	const t = X.team(tid!, season);
	if (!t) {
		return null;
	}
	const teams = X.teamsIn(season);
	const wp = winPct(t.won, t.lost, t.tied);
	const lr = rankOf(
		teams.map((x) => winPct(x.won, x.lost, x.tied)),
		wp,
	);
	const hist = X.teamHistory(tid!).filter((x) => x.season !== season);
	const fr = rankOf(
		hist.map((x) => winPct(x.won, x.lost, x.tied)),
		wp,
	);
	const diff = t.gp > 0 ? (t.pts - t.oppPts) / t.gp : 0;
	return mk({
		id: "record",
		group: "record",
		theme: "team",
		score: 0.9,
		core: true,
		kicker: "The record",
		tid: tid!,
		season,
		heads: [
			`${fmtRecord(t.won, t.lost, t.tied, t.otl)}, ${ordinal(lr)} in the league`,
			`A ${fmtWinp(wp)} season`,
		],
		hero: { text: fmtWinp(wp), unit: "win pct" },
		lines: [
			hist.length >= 2
				? fr === 1
					? "The best record in franchise history"
					: `The ${ordinal(fr)}-best of ${hist.length + 1} seasons in franchise history`
				: null,
			t.gp > 0
				? `Point differential: ${diff >= 0 ? "+" : "−"}${fmtNum(Math.abs(diff), 1)} per game`
				: null,
		],
	});
};

const path: Topic = ({ X, season, tid }) => {
	const t = X.team(tid!, season);
	const s = X.series(season);
	if (!t || !X.decided(season)) {
		return null;
	}
	const n = X.numRounds(season);
	if (t.playoffRoundsWon < 0) {
		const others = X.teamHistory(tid!).filter(
			(x) => x.season < season && x.playoffRoundsWon >= 0,
		);
		const last = others.at(-1);
		return mk({
			id: "path",
			group: "path",
			theme: "playoffs",
			score: 0.6,
			core: true,
			kicker: "The playoffs",
			tid: tid!,
			season,
			heads: ["No playoffs this year", "The season ended in April"],
			lines: [
				last
					? `Last playoff trip: ${last.season}`
					: "The franchise is still waiting for its first playoff trip",
			],
		});
	}
	const rows: { name: string; value: string; tid?: number }[] = [];
	s?.rounds.forEach((round, ri) => {
		for (const m of round) {
			if (!m.away) {
				continue;
			}
			const [us, them] =
				m.home.tid === tid
					? [m.home, m.away]
					: m.away.tid === tid
						? [m.away, m.home]
						: [undefined, undefined];
			if (us && them) {
				rows.push({
					name: `${roundName(ri, n).replace(/^the /, "")[0]!.toUpperCase()}${roundName(ri, n).replace(/^the /, "").slice(1)}: vs ${X.teamName(them.tid, season)}`,
					value: `${us.won > them.won ? "W" : "L"} ${us.won}-${them.won}`,
					tid: them.tid,
				});
			}
		}
	});
	const won = t.playoffRoundsWon >= n;
	return mk({
		id: "path",
		group: "path",
		theme: "playoffs",
		score: won ? 1 : 0.7,
		core: true,
		kicker: "The playoff run",
		tid: tid!,
		season,
		heads: won
			? ["Champions!", `The ${t.name} won the title`]
			: t.playoffRoundsWon === n - 1
				? ["So close: lost in the finals"]
				: [`Out in ${roundName(t.playoffRoundsWon, n)}`],
		list: rows,
		lines: [t.seed !== undefined ? `Entered as the No. ${t.seed} seed` : null],
		facts: [`champ|${season}`],
	});
};

const star: Topic = ({ X, season, tid }) => {
	const rows = X.lines(season).filter((l) => l.tid === tid && l.gp >= 10);
	if (rows.length === 0) {
		return null;
	}
	rows.sort((a, b) => b.ws - a.ws);
	const s = rows[0]!;
	const team = rows.reduce((a, l) => a + l.pts, 0);
	return mk({
		id: "star",
		group: "star",
		theme: "people",
		score: 0.85,
		core: true,
		kicker: "The best player",
		pid: s.pid,
		tid: tid!,
		season,
		heads: [`${s.name} carried the load`, `The team’s MVP: ${s.name}`],
		hero: { text: fmtNum(s.ppg, 1), unit: "PPG" },
		lines: [
			lineText(s),
			`${fmtNum(s.ws, 1)} win shares, the most on the team`,
			team > 0
				? `${fmtNum((100 * s.pts) / team, 0)}% of the team’s points`
				: null,
		],
		list: rows.slice(1, 4).map((l) => ({
			name: l.name,
			value: `${fmtNum(l.ppg, 1)} PPG`,
			pid: l.pid,
		})),
	});
};

const game: Topic = (ctx) =>
	bestGame(ctx, (l) => l.tid === ctx.tid, "game", "The game of the year");

const streaks: Topic = ({ X, season, tid }) => {
	const gs = X.games(season)
		.filter((g) => !g.playoffs && g.teams.some((t) => t.tid === tid))
		.sort((a, b) => a.day - b.day || a.gid - b.gid);
	if (gs.length < 20) {
		return null;
	}
	let w = 0;
	let l = 0;
	let bw = 0;
	let bl = 0;
	for (const g of gs) {
		const us = g.teams[0].tid === tid ? g.teams[0] : g.teams[1];
		const them = g.teams[0].tid === tid ? g.teams[1] : g.teams[0];
		if (us.pts > them.pts) {
			w += 1;
			l = 0;
		} else {
			l += 1;
			w = 0;
		}
		bw = Math.max(bw, w);
		bl = Math.max(bl, l);
	}
	const out: Slide[] = [];
	if (bw >= 5) {
		out.push(
			mk({
				id: "t-streak-win",
				group: "streak",
				theme: "games",
				score: Math.min(0.85, bw / 16),
				kicker: "On a roll",
				tid,
				season,
				heads: [`${bw} straight wins`, `A ${bw}-game winning streak`],
				hero: { text: `${bw}`, unit: "wins in a row" },
				lines: ["The longest winning streak of the season"],
			}),
		);
	}
	if (bl >= 6) {
		out.push(
			mk({
				id: "t-streak-loss",
				group: "streak",
				theme: "games",
				score: Math.min(0.7, bl / 20),
				kicker: "The skid",
				tid,
				season,
				heads: [`${bl} losses in a row`, "The rough patch"],
				hero: { text: `${bl}`, unit: "losses in a row" },
				lines: ["The longest losing streak of the season"],
			}),
		);
	}
	return out;
};

const close: Topic = ({ X, season, tid }) => {
	const gs = X.games(season).filter(
		(g) => !g.playoffs && g.teams.some((t) => t.tid === tid),
	);
	if (gs.length < 20) {
		return null;
	}
	let w = 0;
	let l = 0;
	let ot = 0;
	for (const g of gs) {
		const us = g.teams[0].tid === tid ? g.teams[0] : g.teams[1];
		const them = g.teams[0].tid === tid ? g.teams[1] : g.teams[0];
		if (g.overtimes > 0) {
			ot += 1;
		}
		if (Math.abs(us.pts - them.pts) <= 5) {
			if (us.pts > them.pts) {
				w += 1;
			} else {
				l += 1;
			}
		}
	}
	if (w + l < 5) {
		return null;
	}
	const p = w / (w + l);
	return mk({
		id: "t-close",
		group: "close",
		theme: "games",
		score: Math.min(0.75, Math.abs(p - 0.5) * 1.2 + 0.1),
		kicker: "Close games",
		tid,
		season,
		heads:
			p >= 0.5
				? ["Ice in the veins", `${w}-${l} in games decided by 5 or fewer`]
				: [
						"The close ones got away",
						`${w}-${l} in games decided by 5 or fewer`,
					],
		hero: { text: `${w}-${l}`, unit: "in close games" },
		lines: [ot > 0 ? `${plural(ot, "game")} went to overtime` : null],
	});
};

const newcomers: Topic = ({ X, season, tid }) => {
	const rows = X.lines(season).filter(
		(l) => l.tids.includes(tid!) && l.gp >= 10,
	);
	const isNew = rows.filter((l) => {
		const p = X.players.get(l.pid)!;
		return !p.stats.some((r) => r.tid === tid && r.season < season);
	});
	if (isNew.length < 2) {
		return null;
	}
	isNew.sort((a, b) => b.ws - a.ws);
	return mk({
		id: "t-newcomers",
		group: "newcomers",
		theme: "people",
		score: 0.3 + Math.min(0.35, isNew[0]!.ws / 25),
		kicker: "New faces",
		tid,
		season,
		pid: isNew[0]!.pid,
		heads: [
			`${plural(isNew.length, "new face")} on the roster`,
			`${isNew[0]!.name} led the newcomers`,
		],
		list: isNew.slice(0, 5).map((l) => ({
			name: l.name,
			value: `${fmtNum(l.ppg, 1)} PPG`,
			pid: l.pid,
		})),
	});
};

const honors: Topic = ({ X, season, tid }) => {
	const rows = X.lines(season).filter((l) => l.tid === tid);
	const list: { name: string; value: string; pid: number }[] = [];
	for (const l of rows) {
		const p = X.players.get(l.pid)!;
		for (const a of p.awards) {
			if (
				a.season === season &&
				(X.decided(season) || a.type === "All-Star") &&
				a.type !== "Won Championship"
			) {
				list.push({ name: p.name, value: a.type, pid: p.pid });
			}
		}
	}
	if (list.length === 0) {
		return null;
	}
	return mk({
		who: X.teamName(tid!, season),
		id: "t-honors",
		group: "awards",
		theme: "awards",
		score: 0.3 + Math.min(0.5, list.length * 0.08),
		kicker: "Hardware",
		tid,
		season,
		pid: list[0]!.pid,
		heads: [`${plural(list.length, "honor")} for the team`, "The trophy case"],
		list: list.slice(0, 6),
	});
};

const offense: Topic = ({ X, season, tid }) => {
	const teams = X.teamsIn(season).filter((t) => t.gp > 0);
	const t = X.team(tid!, season);
	if (!t || t.gp === 0 || teams.length < 4) {
		return null;
	}
	const off = t.pts / t.gp;
	const def = t.oppPts / t.gp;
	const ro = rankOf(
		teams.map((x) => x.pts / x.gp),
		off,
	);
	const rd = rankOf(
		teams.map((x) => -x.oppPts / x.gp),
		-def,
	);
	const good = Math.min(ro, rd);
	const isOff = ro <= rd;
	return mk({
		id: "t-identity",
		group: "identity",
		theme: "team",
		score: rankScore(good, teams.length) * 0.9,
		kicker: "Identity",
		tid,
		season,
		heads: isOff
			? [
					`The ${ordinal(ro)}-best offense in the league`,
					"This team could score",
				]
			: [`The ${ordinal(rd)}-best defense in the league`, "Defense first"],
		hero: {
			text: fmtNum(isOff ? off : def, 1),
			unit: isOff ? "points per game" : "allowed per game",
		},
		lines: [
			`Offense: ${fmtNum(off, 1)} (${ordinal(ro)}) · Defense: ${fmtNum(def, 1)} (${ordinal(rd)})`,
		],
	});
};

const highsTeam: Topic = ({ X, season, tid }) => {
	const ls = gameLines(X, season).filter((l) => l.tid === tid);
	if (ls.length < 100) {
		return null;
	}
	const out: Slide[] = [];
	for (const [k, noun, unit] of [
		["trb", "rebounds", "REB"],
		["ast", "assists", "AST"],
		["tp", "threes", "3PM"],
	] as const) {
		const best = ls.reduce((a, b) => (b[k] > a[k] ? b : a));
		const all = gameLines(X, season).map((l) => l[k]);
		out.push(
			mk({
				id: `t-high-${k}`,
				group: "game-high",
				theme: "games",
				score: rankScore(rankOf(all, best[k]), all.length) * 0.8,
				kicker: `The team’s best night for ${noun}`,
				pid: best.pid,
				tid,
				season,
				heads: [`${best.name}: ${best[k]} ${noun} in one game`],
				hero: { text: `${best[k]}`, unit },
				lines: [
					`${best.pts} points too, ${best.won ? "a win" : "a loss"} vs ${X.teamName(best.opp, season)}`,
				],
				facts: [`game:${best.gid}|${best.pid}`],
			}),
		);
	}
	return out;
};

const summary: Topic = ({ X, season, tid }) => {
	const t = X.team(tid!, season);
	if (!t) {
		return null;
	}
	const top = X.lines(season)
		.filter((l) => l.tid === tid)
		.sort((a, b) => b.ppg - a.ppg)[0];
	const chips: [string, string][] = [
		["Record", fmtRecord(t.won, t.lost, t.tied, t.otl)],
	];
	if (X.decided(season)) {
		const n = X.numRounds(season);
		chips.push([
			"Playoffs",
			t.playoffRoundsWon < 0
				? "Missed"
				: t.playoffRoundsWon >= n
					? "Champions"
					: `Out in ${roundName(t.playoffRoundsWon, n)}`,
		]);
	}
	if (top) {
		chips.push(["Top scorer", `${top.name} (${fmtNum(top.ppg, 1)})`]);
	}
	return mk({
		id: "summary",
		group: "summary",
		theme: "summary",
		score: 1,
		kicker: `${t.region} ${t.name}, ${season}`,
		tid,
		season,
		heads: [`That was ${season}`],
		chips,
	});
};

export const TEAM_TOPICS: Topic[] = [
	intro,
	record,
	path,
	star,
	game,
	streaks,
	close,
	newcomers,
	honors,
	offense,
	highsTeam,
	summary,
];
