import type { Slide } from "../types.ts";
import {
	fmtNum,
	listText,
	ordinal,
	plural,
	rankOf,
	rankScore,
} from "../util.ts";
import { bestGame } from "./season.ts";
import {
	BOX_STATS,
	METRICS,
	NOTES,
	gameLines,
	isTripleDouble,
	lineText,
	metricVal,
	mk,
	showMetric,
	type Topic,
} from "./helpers.ts";

const MARKS = {
	pts: [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000],
	trb: [5000, 7500, 10000, 12500, 15000],
	ast: [2500, 5000, 7500, 10000],
} as const;

const intro: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l) {
		return null;
	}
	const yrs = new Set(
		p.stats.filter((r) => r.season <= season && r.gp > 0).map((r) => r.season),
	).size;
	return mk({
		id: "intro",
		group: "intro",
		theme: "intro",
		score: 1,
		core: true,
		kicker: `${season} Wrapped`,
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${p.name}’s ${season}, wrapped`,
			`${p.name}: the ${season} season`,
		],
		hero: { text: `${l.age}`, unit: "years old" },
		lines: [
			yrs === 1 ? "His rookie season" : `Season ${yrs} of his career`,
			`Played for the ${l.tids.map((t) => X.teamName(t, season)).join(" and ")}`,
		],
	});
};

const line: Topic = ({ X, season, pid }) => {
	const l = X.line(pid!, season);
	if (!l) {
		return null;
	}
	return mk({
		id: "line",
		group: "line",
		theme: "scoring",
		score: 0.9,
		core: true,
		kicker: "The stat line",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [lineText(l), `${fmtNum(l.ppg, 1)} points a night`],
		hero: { text: fmtNum(l.ppg, 1), unit: "PPG" },
		chips: [
			["REB", fmtNum(l.rpg, 1)],
			["AST", fmtNum(l.apg, 1)],
			["PER", fmtNum(l.per, 1)],
			["WS", fmtNum(l.ws, 1)],
			["TS%", fmtNum(l.tsPct * 100, 1)],
		],
		lines: [`${plural(l.gp, "game")}, ${fmtNum(l.mpg, 1)} minutes a game`],
	});
};

const awards: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	if (!p) {
		return null;
	}
	const list = p.awards.filter(
		(a) => a.season === season && (X.decided(season) || a.type === "All-Star"),
	);
	if (list.length === 0) {
		return null;
	}
	const types = list.map((a) => a.type);
	const big =
		types.find((t) => t === "Most Valuable Player" || t === "Finals MVP") ??
		types[0]!;
	const n = X.countAwards(p, big, season);
	return mk({
		id: "awards",
		group: "awards",
		theme: "awards",
		score: 0.85,
		core: true,
		kicker: "Hardware",
		pid: pid!,
		season,
		heads: [
			types.length === 1
				? `${big}`
				: `${plural(types.length, "honor")} this season`,
			`${p.firstName}’s trophy shelf`,
		],
		list: list.map((a) => ({ name: a.type, value: `${a.season}` })),
		lines: [n > 1 ? `${big} No. ${n} of his career` : null],
	});
};

const rank: Topic = ({ X, season, pid }) => {
	const l = X.line(pid!, season);
	const q = X.qualified(season);
	if (!l || !q.includes(l) || q.length < 10) {
		return null;
	}
	const ranks = METRICS.map((m) => ({
		m,
		r: rankOf(
			q.map((x) => metricVal(x, m)),
			metricVal(l, m),
		),
	}))
		.filter(
			(x) =>
				Number.isFinite(metricVal(l, x.m)) &&
				(!x.m.minPpg || l.ppg >= x.m.minPpg),
		)
		.sort((a, b) => a.r - b.r);
	const best = ranks[0];
	if (!best) {
		return null;
	}
	return mk({
		id: "rank",
		group: "rank",
		theme: best.m.theme,
		score: rankScore(best.r, q.length),
		core: true,
		kicker: "Where he ranked",
		pid: pid!,
		tid: l.tid,
		season,
		heads: [
			`${ordinal(best.r)} in the league in ${best.m.label}`,
			`Among the league’s best in ${best.m.label}`,
		],
		hero: { text: showMetric(metricVal(l, best.m), best.m), unit: best.m.unit },
		list: ranks.slice(0, 5).map((x) => ({
			name: x.m.label,
			value: `${ordinal(x.r)} (${showMetric(metricVal(l, x.m), x.m)})`,
		})),
		lines: [`Out of ${q.length} qualified players`],
		note: NOTES[best.m.unit],
		facts: best.r === 1 ? [`lead|${best.m.k}|${pid}`] : [],
	});
};

const game: Topic = (ctx) =>
	bestGame(ctx, (l) => l.pid === ctx.pid, "game", "His best game");

const highs: Topic = ({ X, season, pid }) => {
	const ls = gameLines(X, season).filter((l) => l.pid === pid);
	if (ls.length < 5) {
		return null;
	}
	const all = gameLines(X, season);
	const out: Slide[] = [];
	for (const st of BOX_STATS.slice(1)) {
		const best = ls.reduce((a, b) => (b[st.k] > a[st.k] ? b : a));
		const v = best[st.k];
		if (v < (st.k === "trb" || st.k === "ast" ? 10 : 5)) {
			continue;
		}
		const r = all.filter((x) => x[st.k] >= v).length;
		out.push(
			mk({
				id: `p-high-${st.k}`,
				group: "game-high",
				theme: "games",
				score: rankScore(r, all.length) * 0.9,
				kicker: `His best night for ${st.noun}`,
				pid,
				tid: best.tid,
				season,
				heads: [`${v} ${st.noun} in one game`],
				hero: { text: `${v}`, unit: st.unit },
				lines: [
					`vs ${X.teamName(best.opp, season)}, ${best.won ? "a win" : "a loss"} ${best.pf}–${best.pa}`,
					r <= 3 ? "One of the best of the season, by anyone" : null,
				],
				facts: [`game:${best.gid}|${pid}`],
			}),
		);
	}
	const tds = ls.filter(isTripleDouble).length;
	if (tds >= 2) {
		out.push(
			mk({
				id: "p-td",
				group: "td",
				theme: "playmaking",
				score: Math.min(0.8, 0.25 + tds / 30),
				kicker: "Triple-doubles",
				pid,
				season,
				heads: [`${plural(tds, "triple-double")}`, "Filling up the box score"],
				hero: { text: `${tds}`, unit: "triple-doubles" },
			}),
		);
	}
	const g30 = ls.filter((l) => l.pts >= 30).length;
	if (g30 >= 5) {
		out.push(
			mk({
				id: "p-30",
				group: "30s",
				theme: "scoring",
				score: Math.min(0.8, 0.2 + g30 / 40),
				kicker: "30-point nights",
				pid,
				season,
				heads: [`${plural(g30, "30-point game")}`],
				hero: { text: `${g30}`, unit: "games of 30+" },
			}),
		);
	}
	return out;
};

const milestone: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	if (!p) {
		return null;
	}
	const before = X.career(p, season - 1);
	const after = X.career(p, season);
	const out: Slide[] = [];
	for (const [k, marks] of Object.entries(MARKS) as [
		keyof typeof MARKS,
		readonly number[],
	][]) {
		const m = marks.filter((x) => before[k] < x && after[k] >= x).at(-1);
		if (m === undefined) {
			continue;
		}
		const noun = k === "pts" ? "points" : k === "trb" ? "rebounds" : "assists";
		const club = X.L.players.filter((q) => X.career(q, season)[k] >= m).length;
		out.push(
			mk({
				id: `p-mark-${k}`,
				group: "milestone",
				theme: "history",
				score: Math.min(0.9, 0.35 + m / 60000 + 0.2 / club),
				kicker: "Milestone",
				pid,
				season,
				heads: [`${p.name} passed ${fmtNum(m)} career ${noun}`],
				hero: { text: fmtNum(after[k]), unit: `career ${noun}` },
				lines: [
					club === 1
						? `The only player in league history with ${fmtNum(m)}`
						: `One of ${club} players in league history with ${fmtNum(m)}+`,
				],
			}),
		);
	}
	return out;
};

const yearOver: Topic = ({ X, season, pid }) => {
	const l = X.line(pid!, season);
	const p = X.line(pid!, season - 1);
	if (!l || !p || l.gp < 10 || p.gp < 10) {
		return null;
	}
	const d = l.ppg - p.ppg;
	if (Math.abs(d) < 3) {
		return null;
	}
	return mk({
		id: "p-delta",
		group: "delta",
		theme: "people",
		score: Math.min(0.75, Math.abs(d) / 14),
		kicker: d > 0 ? "Level up" : "A step back",
		pid,
		tid: l.tid,
		season,
		heads: [
			d > 0
				? `Up ${fmtNum(d, 1)} points a game from last season`
				: `Down ${fmtNum(-d, 1)} points a game from last season`,
		],
		hero: {
			text: `${d > 0 ? "+" : "−"}${fmtNum(Math.abs(d), 1)}`,
			unit: "PPG",
		},
		lines: [`${fmtNum(p.ppg, 1)} → ${fmtNum(l.ppg, 1)}`],
	});
};

const share: Topic = ({ X, season, pid }) => {
	const l = X.line(pid!, season);
	if (!l || l.tids.length > 1) {
		return null;
	}
	const team = X.lines(season).filter((x) => x.tids.includes(l.tid));
	const tot = team.reduce((a, x) => a + x.pts, 0);
	if (tot <= 0) {
		return null;
	}
	const sh = l.pts / tot;
	const all = X.seasons.flatMap((s) => {
		const ls = X.lines(s);
		const byT = new Map<number, number>();
		for (const x of ls) {
			if (x.tids.length === 1) {
				byT.set(x.tid, (byT.get(x.tid) ?? 0) + x.pts);
			}
		}
		return ls
			.filter((x) => x.tids.length === 1 && (byT.get(x.tid) ?? 0) > 0)
			.map((x) => x.pts / byT.get(x.tid)!);
	});
	if (sh < 0.15) {
		return null;
	}
	return mk({
		id: "p-share",
		group: "share",
		theme: "scoring",
		score: rankScore(rankOf(all, sh), all.length) * 0.9,
		kicker: "Carrying the load",
		pid,
		tid: l.tid,
		season,
		heads: [`${fmtNum(sh * 100, 0)}% of his team’s points`],
		hero: { text: fmtNum(sh * 100, 1), unit: "% of team points" },
		lines: [
			`${fmtNum(l.pts)} of ${fmtNum(tot)} for the ${X.teamName(l.tid, season)}`,
		],
	});
};

const comps: Topic = ({ X, season, pid }) => {
	const l = X.line(pid!, season);
	if (!l || l.gp < 20) {
		return null;
	}
	const dist = (a: typeof l, b: typeof l) =>
		Math.hypot(
			a.ppg - b.ppg,
			a.rpg - b.rpg,
			a.apg - b.apg,
			(a.per - b.per) / 2,
		);
	const near = X.allQualified()
		.filter((x) => x.pid !== pid)
		.map((x) => ({ x, d: dist(l, x) }))
		.sort((a, b) => a.d - b.d)
		.slice(0, 3);
	if (near.length < 3) {
		return null;
	}
	return mk({
		id: "p-comps",
		group: "comps",
		theme: "history",
		score: 0.3,
		kicker: "Lookalikes",
		pid,
		season,
		heads: [
			"Seasons most like this one",
			`${listText(near.map((n) => n.x.name.split(" ").at(-1)!))}: his closest matches`,
		],
		list: near.map((n) => ({
			name: `${n.x.name}, ${n.x.season}`,
			value: lineText(n.x),
			pid: n.x.pid,
		})),
	});
};

const playoffs: Topic = ({ X, season, pid }) => {
	const l = X.poLines(season).find((x) => x.pid === pid);
	if (!l || !X.decided(season) || l.gp < 3) {
		return null;
	}
	return mk({
		id: "p-playoffs",
		group: "playoffs",
		theme: "playoffs",
		score: Math.min(0.8, 0.25 + l.ppg / 50 + l.gp / 50),
		kicker: "Playoff run",
		pid,
		tid: l.tid,
		season,
		heads: [
			`${fmtNum(l.ppg, 1)} points a game in the playoffs`,
			`${plural(l.gp, "playoff game")}`,
		],
		hero: { text: fmtNum(l.ppg, 1), unit: "playoff PPG" },
		lines: [lineText(l)],
	});
};

const summary: Topic = ({ X, season, pid }) => {
	const p = X.players.get(pid!);
	const l = X.line(pid!, season);
	if (!p || !l) {
		return null;
	}
	return mk({
		id: "summary",
		group: "summary",
		theme: "summary",
		score: 1,
		kicker: `${p.name}, ${season}`,
		pid,
		tid: l.tid,
		season,
		heads: [`That was ${season}`],
		chips: [
			["PPG", fmtNum(l.ppg, 1)],
			["RPG", fmtNum(l.rpg, 1)],
			["APG", fmtNum(l.apg, 1)],
			["WS", fmtNum(l.ws, 1)],
		],
	});
};

export const PLAYER_TOPICS: Topic[] = [
	intro,
	line,
	awards,
	rank,
	game,
	highs,
	milestone,
	yearOver,
	share,
	comps,
	playoffs,
	summary,
];
