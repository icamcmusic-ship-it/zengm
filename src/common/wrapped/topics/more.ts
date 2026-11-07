// More topics, beyond the first set in season.ts, team.ts, player.ts and all.ts
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
import { gameLines, lineText, mk, type Topic } from "./helpers.ts";

const CLUBS = [
	{
		id: "30ppg",
		label: "30+ points a game",
		ok: (l: { ppg: number; rpg: number; apg: number }) => l.ppg >= 30,
	},
	{
		id: "25-10",
		label: "25 points and 10 rebounds a game",
		ok: (l: { ppg: number; rpg: number; apg: number }) =>
			l.ppg >= 25 && l.rpg >= 10,
	},
	{
		id: "20-10-5",
		label: "20 points, 10 rebounds and 5 assists a game",
		ok: (l: { ppg: number; rpg: number; apg: number }) =>
			l.ppg >= 20 && l.rpg >= 10 && l.apg >= 5,
	},
	{
		id: "25-5-5",
		label: "25 points, 5 rebounds and 5 assists a game",
		ok: (l: { ppg: number; rpg: number; apg: number }) =>
			l.ppg >= 25 && l.rpg >= 5 && l.apg >= 5,
	},
	{
		id: "20-10apg",
		label: "20 points and 10 assists a game",
		ok: (l: { ppg: number; rpg: number; apg: number }) =>
			l.ppg >= 20 && l.apg >= 10,
	},
];

// Season mode: stat-line clubs the league seldom sees
const clubs: Topic = ({ X, season }) => {
	const out: Slide[] = [];
	const all = X.allQualified();
	for (const c of CLUBS) {
		const members = X.qualified(season).filter(c.ok);
		if (members.length === 0) {
			continue;
		}
		const ever = all.filter(c.ok).length;
		out.push(
			mk({
				id: `s-club-${c.id}`,
				group: "club",
				theme: "scoring",
				score: Math.min(0.85, rankScore(ever, all.length) * 1.1),
				kicker: "The club",
				pid: members[0]!.pid,
				season,
				heads: [
					members.length === 1
						? `${members[0]!.name} averaged ${c.label}`
						: `${members.length} players averaged ${c.label}`,
					`The ${c.label} club`,
				],
				list: members
					.slice(0, 5)
					.map((l) => ({ name: l.name, value: lineText(l), pid: l.pid })),
				lines: [
					ever === members.length
						? "The first time in league history"
						: `${plural(ever, "season")} like it in league history`,
				],
			}),
		);
	}
	return out;
};

const teamExtremes: Topic = ({ X, season }) => {
	const teams = X.teamsIn(season).filter((t) => t.gp > 0);
	if (teams.length < 4) {
		return null;
	}
	const all = X.L.teamSeasons.filter((t) => t.gp > 0);
	const off = [...teams].sort((a, b) => b.pts / b.gp - a.pts / a.gp)[0]!;
	const def = [...teams].sort((a, b) => a.oppPts / a.gp - b.oppPts / b.gp)[0]!;
	const offV = off.pts / off.gp;
	const defV = def.oppPts / def.gp;
	return [
		mk({
			id: "s-best-offense",
			group: "team-stat",
			theme: "team",
			score:
				rankScore(
					rankOf(
						all.map((t) => t.pts / t.gp),
						offV,
					),
					all.length,
				) * 0.8,
			kicker: "Best offense",
			tid: off.tid,
			season,
			heads: [
				`The ${off.region} ${off.name} scored the most`,
				`${fmtNum(offV, 1)} points a game`,
			],
			hero: { text: fmtNum(offV, 1), unit: "points per game" },
			lines: [`${fmtRecord(off.won, off.lost, off.tied, off.otl)} record`],
		}),
		mk({
			id: "s-best-defense",
			group: "team-stat",
			theme: "defense",
			score:
				rankScore(
					rankOf(
						all.map((t) => -t.oppPts / t.gp),
						-defV,
					),
					all.length,
				) * 0.8,
			kicker: "Best defense",
			tid: def.tid,
			season,
			heads: [
				`The ${def.region} ${def.name} allowed the fewest points`,
				"Lockdown",
			],
			hero: { text: fmtNum(defV, 1), unit: "allowed per game" },
			lines: [`${fmtRecord(def.won, def.lost, def.tied, def.otl)} record`],
		}),
	];
};

const parity: Topic = ({ X, season }) => {
	const wp = X.teamsIn(season).map((t) => winPct(t.won, t.lost, t.tied));
	if (wp.length < 6) {
		return null;
	}
	const sd = (xs: number[]) => {
		const m = xs.reduce((a, b) => a + b, 0) / xs.length;
		return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
	};
	const v = sd(wp);
	const hist = X.seasons
		.filter((s) => s !== season)
		.map((s) => sd(X.teamsIn(s).map((t) => winPct(t.won, t.lost, t.tied))))
		.filter((x) => x > 0);
	if (hist.length < 3) {
		return null;
	}
	const lo = rankOf(
		hist.map((x) => -x),
		-v,
	);
	const hi = rankOf(hist, v);
	const even = lo <= hi;
	const r = even ? lo : hi;
	return mk({
		id: "s-parity",
		group: "parity",
		theme: "team",
		score: rankScore(r, hist.length + 1) * 0.8,
		kicker: even ? "Parity" : "Haves and have-nots",
		season,
		heads: even
			? [
					"Anyone could beat anyone",
					r === 1
						? "The most balanced season on record"
						: `The ${ordinal(r)}-most balanced season on record`,
				]
			: [
					"A league of haves and have-nots",
					r === 1
						? "The most lopsided season on record"
						: `The ${ordinal(r)}-most lopsided season on record`,
				],
		hero: { text: fmtWinp(v), unit: "spread of win pct" },
		lines: [`Compared with ${plural(hist.length, "other season")}`],
	});
};

const fmvpTopic: Topic = ({ X, season }) => {
	const p = X.awardWinner(season, "Finals MVP");
	if (!p) {
		return null;
	}
	const l = X.poLines(season).find((x) => x.pid === p.pid);
	return mk({
		id: "s-fmvp",
		group: "fmvp",
		theme: "playoffs",
		score: 0.55,
		kicker: "Finals MVP",
		pid: p.pid,
		tid: l?.tid,
		season,
		heads: [`${p.name} was Finals MVP`, `When it mattered most: ${p.name}`],
		hero: l ? { text: fmtNum(l.ppg, 1), unit: "playoff PPG" } : undefined,
		lines: [l ? `${lineText(l)} in ${plural(l.gp, "playoff game")}` : null],
		facts: [`fmvp|${season}`],
	});
};

const firstAllStars: Topic = ({ X, season }) => {
	const list = X.L.players.filter(
		(p) =>
			p.awards.some((a) => a.season === season && a.type === "All-Star") &&
			!p.awards.some((a) => a.season < season && a.type === "All-Star"),
	);
	if (list.length < 2 || season === X.L.startingSeason) {
		return null;
	}
	return mk({
		id: "s-first-as",
		group: "allstar",
		theme: "people",
		score: 0.35,
		kicker: "First-time All-Stars",
		season,
		pid: list[0]!.pid,
		heads: [`${plural(list.length, "first-time All-Star")}`, "New stars"],
		list: list.slice(0, 6).map((p) => {
			const l = X.line(p.pid, season);
			return {
				name: p.name,
				value: l ? `${fmtNum(l.ppg, 1)} PPG` : "",
				pid: p.pid,
			};
		}),
	});
};

// Team mode
const scorers: Topic = ({ X, season, tid }) => {
	const rows = X.lines(season)
		.filter((l) => l.tid === tid && l.gp >= 10)
		.sort((a, b) => b.ppg - a.ppg);
	if (rows.length < 3) {
		return null;
	}
	return mk({
		id: "t-scorers",
		group: "scorers",
		theme: "scoring",
		score: 0.4,
		kicker: "Who scored",
		tid,
		season,
		pid: rows[0]!.pid,
		who: X.teamName(tid!, season),
		heads: ["The scoring leaders", `${rows[0]!.name} led the team in scoring`],
		list: rows.slice(0, 5).map((l) => ({
			name: l.name,
			value: `${fmtNum(l.ppg, 1)} PPG`,
			pid: l.pid,
		})),
	});
};

const lastYear: Topic = ({ X, season, tid }) => {
	const t = X.team(tid!, season);
	const p = X.team(tid!, season - 1);
	if (!t || !p) {
		return null;
	}
	const d = t.won - p.won;
	if (Math.abs(d) < 8) {
		return null;
	}
	return mk({
		id: "t-delta",
		group: "delta",
		theme: "team",
		score: Math.min(0.85, Math.abs(d) / 30),
		kicker: d > 0 ? "Glow-up" : "Step back",
		tid,
		season,
		heads: [
			d > 0
				? `${plural(d, "more win")} than last season`
				: `${plural(-d, "fewer win")} than last season`,
		],
		hero: { text: `${d > 0 ? "+" : "−"}${Math.abs(d)}`, unit: "wins" },
		lines: [
			`${fmtRecord(p.won, p.lost, p.tied, p.otl)} in ${season - 1}, ${fmtRecord(t.won, t.lost, t.tied, t.otl)} in ${season}`,
		],
	});
};

const franchise: Topic = ({ X, season, tid }) => {
	const hist = X.teamHistory(tid!).filter((t) => t.season <= season);
	if (hist.length < 3) {
		return null;
	}
	const po = hist.filter(
		(t) => t.playoffRoundsWon >= 0 && X.decided(t.season),
	).length;
	const titles = X.titlesOf(tid!, season);
	const won = hist.reduce((a, t) => a + t.won, 0);
	const lost = hist.reduce((a, t) => a + t.lost, 0);
	return mk({
		id: "t-franchise",
		group: "franchise",
		theme: "history",
		score: 0.3 + Math.min(0.3, titles.length * 0.1),
		kicker: "Franchise history",
		tid,
		season,
		who: X.teamName(tid!, season),
		heads: [
			"The franchise so far",
			`${plural(hist.length, "season")} of history`,
		],
		chips: [
			["All-time", fmtRecord(won, lost)],
			["Playoffs", `${po}`],
			["Titles", `${titles.length}`],
		],
		lines: [titles.length > 0 ? `Titles: ${titles.join(", ")}` : null],
	});
};

// Player mode
const careerSoFar: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	if (!p) {
		return null;
	}
	const c = X.career(p, season);
	const all = X.L.players.map((q) => X.career(q, season).pts);
	const r = rankOf(all, c.pts);
	if (c.gp < 82) {
		return null;
	}
	return mk({
		id: "p-career",
		group: "career",
		theme: "history",
		score: rankScore(r, all.length) * 0.8,
		kicker: "Career so far",
		pid,
		season,
		heads: [
			`${fmtNum(c.pts)} career points`,
			`${ordinal(r)} in league history in points`,
		],
		hero: { text: fmtNum(c.pts), unit: "career points" },
		chips: [
			["Games", fmtNum(c.gp)],
			["REB", fmtNum(c.trb)],
			["AST", fmtNum(c.ast)],
			["WS", fmtNum(c.ws, 1)],
		],
		lines: [r <= 20 ? `${ordinal(r)} on the all-time list` : null],
	});
};

const bestMate: Topic = ({ X, season, pid }) => {
	const l = X.line(pid!, season);
	if (!l) {
		return null;
	}
	const mates = X.lines(season)
		.filter((m) => m.pid !== pid && m.tid === l.tid && m.gp >= 20)
		.sort((a, b) => b.ws - a.ws);
	const m = mates[0];
	if (!m) {
		return null;
	}
	return mk({
		id: "p-mate",
		group: "mate",
		theme: "people",
		score: 0.3,
		kicker: "Partner in crime",
		pid: m.pid,
		tid: l.tid,
		season,
		heads: [`His best teammate: ${m.name}`, `Running mate: ${m.name}`],
		hero: { text: fmtNum(m.ppg, 1), unit: "PPG" },
		lines: [lineText(m), `${fmtNum(m.ws, 1)} win shares`],
	});
};

const games3: Topic = ({ X, season, pid }) => {
	const ls = gameLines(X, season)
		.filter((g) => g.pid === pid && !g.playoffs)
		.sort((a, b) => a.day - b.day);
	if (ls.length < 20) {
		return null;
	}
	let run = 0;
	let best = 0;
	for (const g of ls) {
		run = g.pts >= 20 ? run + 1 : 0;
		best = Math.max(best, run);
	}
	if (best < 8) {
		return null;
	}
	return mk({
		id: "p-streak-20",
		group: "streak",
		theme: "scoring",
		score: Math.min(0.8, best / 40),
		kicker: "Consistency",
		pid,
		season,
		heads: [`${best} straight games with 20+ points`],
		hero: { text: `${best}`, unit: "straight 20-point games" },
	});
};

// All-time
const worstTeam: Topic = ({ X }) => {
	const ts = X.L.teamSeasons
		.filter((t) => X.decided(t.season) && t.won + t.lost > 10)
		.sort(
			(a, b) => winPct(a.won, a.lost, a.tied) - winPct(b.won, b.lost, b.tied),
		);
	const w = ts[0];
	if (!w) {
		return null;
	}
	return mk({
		id: "a-worst-team",
		group: "worst-team",
		theme: "team",
		score: 0.5,
		kicker: "Worst team ever",
		tid: w.tid,
		season: w.season,
		heads: [`The ${w.season} ${w.region} ${w.name}`, "Rock bottom"],
		hero: { text: fmtRecord(w.won, w.lost, w.tied, w.otl), unit: "record" },
	});
};

const playoffStreak: Topic = ({ X }) => {
	let best = { tid: -1, n: 0, to: 0 };
	for (const tid of new Set(X.L.teamSeasons.map((t) => t.tid))) {
		let run = 0;
		for (const t of X.teamHistory(tid)) {
			if (!X.decided(t.season)) {
				continue;
			}
			run = t.playoffRoundsWon >= 0 ? run + 1 : 0;
			if (run > best.n) {
				best = { tid, n: run, to: t.season };
			}
		}
	}
	if (best.n < 4) {
		return null;
	}
	return mk({
		id: "a-po-streak",
		group: "po-streak",
		theme: "playoffs",
		score: Math.min(0.75, 0.2 + best.n / 20),
		kicker: "Always there",
		tid: best.tid,
		season: best.to,
		heads: [
			`${best.n} straight playoff trips`,
			`The ${X.teamName(best.tid, best.to)} never missed`,
		],
		hero: { text: `${best.n}`, unit: "straight playoff trips" },
		lines: [`${best.to - best.n + 1}–${best.to}`],
	});
};

const mostSeasons: Topic = ({ X }) => {
	const list = X.L.players
		.map((p) => ({
			p,
			n: new Set(p.stats.filter((r) => r.gp > 0).map((r) => r.season)).size,
		}))
		.sort((a, b) => b.n - a.n);
	const t = list[0];
	if (!t || t.n < 5) {
		return null;
	}
	return mk({
		id: "a-longevity",
		group: "longevity",
		theme: "people",
		score: 0.4,
		kicker: "Longevity",
		pid: t.p.pid,
		heads: [`${t.p.name}: ${plural(t.n, "season")}`, "The long haul"],
		hero: { text: `${t.n}`, unit: "seasons" },
		list: list.slice(1, 5).map((x) => ({
			name: x.p.name,
			value: plural(x.n, "season"),
			pid: x.p.pid,
		})),
	});
};

export const MORE_SEASON: Topic[] = [
	clubs,
	teamExtremes,
	parity,
	fmvpTopic,
	firstAllStars,
];
export const MORE_TEAM: Topic[] = [scorers, lastYear, franchise];
export const MORE_PLAYER: Topic[] = [careerSoFar, bestMate, games3];
export const MORE_ALL: Topic[] = [worstTeam, playoffStreak, mostSeasons];
