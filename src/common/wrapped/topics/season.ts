import type { SeasonLine } from "../league.ts";
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
import {
	BOX_STATS,
	METRICS,
	NOTES,
	gameLines,
	allGameLines,
	isTripleDouble,
	lineText,
	metricVal,
	mk,
	showMetric,
	vsText,
	type Topic,
	type TopicCtx,
} from "./helpers.ts";

const AWARDS: [string, string, string, string][] = [
	["Rookie of the Year", "roy", "The best newcomer", "people"],
	["Defensive Player of the Year", "dpoy", "The stopper", "defense"],
	["Sixth Man of the Year", "smoy", "Off the bench", "people"],
	["Most Improved Player", "mip", "The big leap", "people"],
];

const intro: Topic = ({ X, season, soFar }) => {
	const teams = X.teamsIn(season);
	const lines = X.lines(season);
	if (teams.length === 0) {
		return null;
	}
	const gp = teams.reduce((a, t) => a + t.won + t.lost + t.tied, 0) / 2;
	const pts = lines.reduce((a, l) => a + l.pts, 0);
	return mk({
		id: "intro",
		group: "intro",
		theme: "intro",
		score: 1,
		core: true,
		kicker: soFar ? `${season} so far` : `${season} Wrapped`,
		heads: [
			`The ${season} season, wrapped`,
			`${season}: the year in review`,
			`Here’s how ${season} went`,
		],
		hero: { text: fmtNum(Math.round(gp)), unit: "games" },
		lines: [
			`${plural(teams.length, "team")}, ${plural(lines.length, "player")}`,
			`${fmtNum(pts)} points scored in the regular season`,
		],
	});
};

const champ: Topic = ({ X, season }) => {
	const c = X.champion(season);
	if (!c) {
		return null;
	}
	const ru = X.runnerUp(season);
	const titles = X.titlesOf(c.tid, season);
	const fmvp = X.awardWinner(season, "Finals MVP");
	const prev = titles.at(-2);
	return mk({
		id: "champ",
		group: "champ",
		theme: "playoffs",
		score: 1,
		core: true,
		kicker: "Champions",
		tid: c.tid,
		season,
		heads: [
			`The ${c.region} ${c.name} won it all`,
			`${c.region} ${c.name}: champions`,
			`A title for the ${c.region} ${c.name}`,
		],
		hero: {
			text: fmtRecord(c.won, c.lost, c.tied, c.otl),
			unit: "regular season",
		},
		lines: [
			ru ? `Beat the ${X.teamName(ru.tid, season)} in the finals` : null,
			titles.length === 1
				? "The franchise’s first title"
				: `Title No. ${titles.length}${prev === undefined ? "" : prev === season - 1 ? ", back-to-back" : `, the first since ${prev}`}`,
			fmvp ? `Finals MVP: ${fmvp.name}` : null,
			c.seed !== undefined
				? `Entered the playoffs as the No. ${c.seed} seed`
				: null,
		],
		facts: [`champ|${season}`],
	});
};

const mvp: Topic = ({ X, season }) => {
	const p = X.awardWinner(season, "Most Valuable Player");
	if (!p) {
		return null;
	}
	const l = X.line(p.pid, season);
	const n = X.countAwards(p, "Most Valuable Player", season);
	return mk({
		id: "mvp",
		group: "awards",
		theme: "awards",
		score: 1,
		core: true,
		kicker: "Most Valuable Player",
		pid: p.pid,
		tid: l?.tid,
		season,
		heads: [
			`${p.name} was the MVP`,
			`MVP: ${p.name}`,
			`The league’s best: ${p.name}`,
		],
		hero: l ? { text: fmtNum(l.ppg, 1), unit: "PPG" } : undefined,
		lines: [
			l ? `${lineText(l)} for the ${X.teamName(l.tid, season)}` : null,
			n > 1 ? `His ${ordinal(n)} MVP award` : "His first MVP award",
			l ? `${fmtNum(l.ws, 1)} win shares, ${fmtNum(l.per, 1)} PER` : null,
		],
		facts: [`award|mvp|${season}`],
	});
};

const standings: Topic = ({ X, season }) => {
	const teams = [...X.teamsIn(season)].sort(
		(a, b) => winPct(b.won, b.lost, b.tied) - winPct(a.won, a.lost, a.tied),
	);
	if (teams.length < 4) {
		return null;
	}
	const best = teams[0]!;
	const worst = teams.at(-1)!;
	return mk({
		id: "standings",
		group: "standings",
		theme: "team",
		score: 0.9,
		core: true,
		kicker: "The standings",
		tid: best.tid,
		season,
		heads: [
			`The ${best.region} ${best.name} had the best record`,
			`Top of the table: ${best.region} ${best.name}`,
		],
		list: teams.slice(0, 5).map((t, i) => ({
			name: `${i + 1}. ${t.region} ${t.name}`,
			value: fmtRecord(t.won, t.lost, t.tied, t.otl),
			tid: t.tid,
		})),
		lines: [
			`Worst: ${worst.region} ${worst.name}, ${fmtRecord(worst.won, worst.lost, worst.tied, worst.otl)}`,
		],
	});
};

const bestGame = (
	ctx: TopicCtx,
	filter: (l: ReturnType<typeof gameLines>[number]) => boolean,
	id: string,
	kicker: string,
) => {
	const { X, season } = ctx;
	const lines = gameLines(X, season).filter(filter);
	if (lines.length === 0) {
		return null;
	}
	const gs = (l: (typeof lines)[number]) =>
		l.pts + 0.7 * l.trb + 0.7 * l.ast + l.stl + l.blk;
	let best = lines[0]!;
	for (const l of lines) {
		if (gs(l) > gs(best)) {
			best = l;
		}
	}
	return mk({
		id,
		group: "game",
		theme: "games",
		score: 0.8,
		core: true,
		kicker,
		pid: best.pid,
		tid: best.tid,
		season,
		heads: [
			`${best.name}’s ${best.pts}-point night`,
			`The game of the year: ${best.name}`,
			`${best.name} put up ${best.pts}, ${best.trb} and ${best.ast}`,
		],
		hero: { text: `${best.pts}`, unit: "PTS" },
		chips: [
			["REB", `${best.trb}`],
			["AST", `${best.ast}`],
			["3PM", `${best.tp}`],
			["BLK", `${best.blk}`],
		],
		lines: [vsText(X, best)],
		facts: [`game:${best.gid}|${best.pid}`],
	});
};

const game: Topic = (ctx) =>
	bestGame(ctx, () => true, "game", "Performance of the year");

// League leader in each metric, scored against every other season's leader and every qualified season
const leaders: Topic = ({ X, season, soFar }) => {
	const out: Slide[] = [];
	const qual = X.qualified(season);
	if (qual.length < 10) {
		return null;
	}
	for (const m of METRICS) {
		if (m.total && soFar) {
			continue;
		}
		const rows = qual
			.filter((l) => !m.minPpg || l.ppg >= m.minPpg)
			.filter((l) => Number.isFinite(metricVal(l, m)))
			.sort((a, b) => metricVal(b, m) - metricVal(a, m));
		const r = rows[0];
		if (!r) {
			continue;
		}
		const v = metricVal(r, m);
		const all = X.allQualified()
			.filter((l) => !m.minPpg || l.ppg >= m.minPpg)
			.map((l) => metricVal(l, m));
		const rank = rankOf(all, v);
		const prevLeaders: { v: number; season: number; name: string }[] = [];
		for (const s of X.seasons) {
			if (s >= season) {
				continue;
			}
			let b: SeasonLine | undefined;
			for (const l of X.qualified(s)) {
				if (
					(!m.minPpg || l.ppg >= m.minPpg) &&
					(!b || metricVal(l, m) > metricVal(b, m))
				) {
					b = l;
				}
			}
			if (b) {
				prevLeaders.push({ v: metricVal(b, m), season: s, name: b.name });
			}
		}
		const last = prevLeaders.filter((x) => x.v >= v).at(-1);
		const second = rows[1];
		out.push(
			mk({
				id: `s-leader-${m.k}`,
				group: "leader",
				theme: m.theme,
				score: Math.max(rankScore(rank, all.length), 0.25),
				kicker: `League leader: ${m.what}`,
				pid: r.pid,
				tid: r.tid,
				season,
				heads: [
					`${r.name} led the league in ${m.label}`,
					`The ${m.what} leader: ${r.name}`,
				],
				hero: { text: showMetric(v, m), unit: m.unit },
				lines: [
					`No. ${fmtNum(rank)} of ${fmtNum(all.length)} qualified seasons in league history`,
					prevLeaders.length >= 2
						? last
							? `Last leader this high: ${last.name}, ${last.season} (${showMetric(last.v, m)})`
							: `The highest ${m.what} leader in league history`
						: null,
					second
						? `Runner-up: ${second.name}, ${showMetric(metricVal(second, m), m)}`
						: null,
				],
				note: NOTES[m.unit],
				facts: [`lead|${m.k}|${r.pid}`],
			}),
		);
	}
	return out;
};

const highs: Topic = ({ X, season }) => {
	const lines = gameLines(X, season);
	if (lines.length < 200) {
		return null;
	}
	const all = allGameLines(X);
	const out: Slide[] = [];
	for (const st of BOX_STATS) {
		let best = lines[0]!;
		for (const l of lines) {
			if (l[st.k] > best[st.k]) {
				best = l;
			}
		}
		const v = best[st.k];
		if (v <= 0) {
			continue;
		}
		const cnt = all.filter((l) => l[st.k] >= v).length;
		const ties = lines.filter((l) => l[st.k] === v).length;
		out.push(
			mk({
				id: `s-high-${st.k}`,
				group: "game-high",
				theme: "games",
				score: rankScore(cnt, all.length),
				kicker: `The season’s best night for ${st.noun}`,
				pid: best.pid,
				tid: best.tid,
				season,
				heads: [
					`${best.name}: ${v} ${st.noun} in one game`,
					`${v} ${st.noun} in a single game`,
				],
				hero: { text: `${v}`, unit: st.unit },
				lines: [
					vsText(X, best),
					cnt === 1
						? `The only ${v}-${st.noun} game in ${fmtNum(all.length)} box-score lines on record`
						: `${plural(cnt, "game")} of ${v}+ ${st.noun} in ${fmtNum(all.length)} box-score lines on record`,
					ties > 1 ? `${ties} players reached ${v} that year` : null,
				],
				facts: [`game:${best.gid}|${best.pid}`],
			}),
		);
	}
	return out;
};

const tripleDoubles: Topic = ({ X, season }) => {
	const lines = gameLines(X, season);
	if (lines.length < 200) {
		return null;
	}
	const by = new Map<number, { n: number; name: string; tid: number }>();
	let total = 0;
	for (const l of lines) {
		if (isTripleDouble(l)) {
			total += 1;
			const e = by.get(l.pid) ?? { n: 0, name: l.name, tid: l.tid };
			e.n += 1;
			by.set(l.pid, e);
		}
	}
	if (total === 0) {
		return null;
	}
	const top = [...by.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 4);
	const perSeason = X.seasons
		.filter((s) => X.hasBoxScores(s))
		.map((s) => gameLines(X, s).filter(isTripleDouble).length);
	return mk({
		id: "s-triple-doubles",
		group: "td",
		theme: "playmaking",
		score: Math.max(0.3, rankScore(rankOf(perSeason, total), perSeason.length)),
		kicker: "Triple-doubles",
		pid: top[0]![0],
		season,
		heads: [
			`${plural(total, "triple-double")} this season`,
			"The triple-double watch",
		],
		hero: { text: fmtNum(total), unit: "triple-doubles" },
		list: top.map(([pid, e]) => ({
			name: e.name,
			value: `${e.n}`,
			pid,
			tid: e.tid,
		})),
	});
};

const otherAwards: Topic = ({ X, season }) => {
	const out: Slide[] = [];
	for (const [type, key, kicker, theme] of AWARDS) {
		const p = X.awardWinner(season, type);
		if (!p) {
			continue;
		}
		const l = X.line(p.pid, season);
		out.push(
			mk({
				id: `s-award-${key}`,
				group: "awards",
				theme,
				score: 0.45,
				kicker: `${kicker}: ${type}`,
				pid: p.pid,
				tid: l?.tid,
				season,
				heads: [`${p.name} won ${type}`, `${type}: ${p.name}`],
				hero: l ? { text: fmtNum(l.ppg, 1), unit: "PPG" } : undefined,
				lines: [
					l ? `${lineText(l)}, ${plural(l.gp, "game")}` : null,
					l ? `Age ${l.age}, ${X.teamName(l.tid, season)}` : null,
				],
				facts: [`award|${key}|${season}`],
			}),
		);
	}
	return out;
};

// Biggest win-total jump from last season
const turnaround: Topic = ({ X, season }) => {
	let best: { tid: number; d: number; a: number; b: number } | undefined;
	let worst: typeof best;
	const diffs: number[] = [];
	for (const t of X.teamsIn(season)) {
		const p = X.team(t.tid, season - 1);
		if (!p) {
			continue;
		}
		const a = winPct(p.won, p.lost, p.tied);
		const b = winPct(t.won, t.lost, t.tied);
		const d = b - a;
		diffs.push(d);
		if (!best || d > best.d) {
			best = { tid: t.tid, d, a, b };
		}
		if (!worst || d < worst.d) {
			worst = { tid: t.tid, d, a, b };
		}
	}
	if (!best || !worst || diffs.length < 4) {
		return null;
	}
	const allD: number[] = [];
	for (const ts of X.L.teamSeasons) {
		const p = X.team(ts.tid, ts.season - 1);
		if (p) {
			allD.push(
				winPct(ts.won, ts.lost, ts.tied) - winPct(p.won, p.lost, p.tied),
			);
		}
	}
	const out: Slide[] = [];
	for (const [x, up] of [
		[best, true],
		[worst, false],
	] as const) {
		if ((up && x.d <= 0.1) || (!up && x.d >= -0.1)) {
			continue;
		}
		const t = X.team(x.tid, season)!;
		const p = X.team(x.tid, season - 1)!;
		const r = up
			? rankOf(allD, x.d)
			: rankOf(
					allD.map((v) => -v),
					-x.d,
				);
		out.push(
			mk({
				id: up ? "s-turnaround" : "s-collapse",
				group: "turnaround",
				theme: "team",
				score: rankScore(r, allD.length),
				kicker: up ? "The turnaround" : "The fall",
				tid: x.tid,
				season,
				heads: up
					? [
							`The ${t.region} ${t.name} turned it around`,
							`From ${fmtRecord(p.won, p.lost, p.tied)} to ${fmtRecord(t.won, t.lost, t.tied)}`,
						]
					: [
							`A hard year for the ${t.region} ${t.name}`,
							`From ${fmtRecord(p.won, p.lost, p.tied)} to ${fmtRecord(t.won, t.lost, t.tied)}`,
						],
				hero: {
					text: `${up ? "+" : "−"}${Math.abs(t.won - p.won)}`,
					unit: "wins",
				},
				lines: [
					`${fmtWinp(x.a)} last season, ${fmtWinp(x.b)} this season`,
					`The ${ordinal(r)}-biggest ${up ? "jump" : "drop"} of ${fmtNum(allD.length)} in league history`,
				],
				facts: [`team-delta|${x.tid}|${season}`],
			}),
		);
	}
	return out;
};

const breakout: Topic = ({ X, season, soFar }) => {
	if (soFar) {
		return null;
	}
	let best: { l: SeasonLine; prev: number } | undefined;
	for (const l of X.qualified(season)) {
		const p = X.line(l.pid, season - 1);
		if (!p) {
			continue;
		}
		if (!best || l.ws - p.ws > best.l.ws - best.prev) {
			best = { l, prev: p.ws };
		}
	}
	if (!best || best.l.ws - best.prev < 3) {
		return null;
	}
	const { l, prev } = best;
	const prevLine = X.line(l.pid, season - 1)!;
	return mk({
		id: "s-breakout",
		group: "breakout",
		theme: "people",
		score: Math.min(0.85, 0.3 + (l.ws - prev) / 15),
		kicker: "Breakout",
		pid: l.pid,
		tid: l.tid,
		season,
		heads: [`${l.name} broke out`, `Nobody improved more than ${l.name}`],
		hero: { text: `+${fmtNum(l.ws - prev, 1)}`, unit: "win shares" },
		lines: [
			`${fmtNum(prevLine.ppg, 1)} PPG last season, ${fmtNum(l.ppg, 1)} PPG this season`,
			`Age ${l.age}, ${X.teamName(l.tid, season)}`,
		],
		facts: [`breakout|${l.pid}`],
	});
};

const ages: Topic = ({ X, season }) => {
	const q = X.qualified(season).filter((l) => l.mpg >= 20);
	if (q.length < 10) {
		return null;
	}
	const old = [...q].sort((a, b) => b.age - a.age)[0]!;
	const young = [...q].sort((a, b) => a.age - b.age || b.ppg - a.ppg)[0]!;
	const out: Slide[] = [];
	if (old.age >= 36) {
		out.push(
			mk({
				id: "s-oldest",
				group: "age",
				theme: "people",
				score: 0.25 + (old.age - 36) * 0.08,
				kicker: "Ageless",
				pid: old.pid,
				tid: old.tid,
				season,
				heads: [
					`${old.name}, still going at ${old.age}`,
					`The oldest regular: ${old.name}`,
				],
				hero: { text: `${old.age}`, unit: "years old" },
				lines: [`${lineText(old)} in ${fmtNum(old.mpg, 1)} minutes a game`],
			}),
		);
	}
	if (young.age <= 20) {
		out.push(
			mk({
				id: "s-youngest",
				group: "age",
				theme: "people",
				score: 0.25 + (20 - young.age) * 0.1,
				kicker: "Too young to know better",
				pid: young.pid,
				tid: young.tid,
				season,
				heads: [
					`${young.name} played big minutes at ${young.age}`,
					`The youngest regular: ${young.name}`,
				],
				hero: { text: `${young.age}`, unit: "years old" },
				lines: [`${lineText(young)} in ${fmtNum(young.mpg, 1)} minutes a game`],
			}),
		);
	}
	return out;
};

const games: Topic = ({ X, season }) => {
	const gs = X.games(season);
	if (gs.length < 50) {
		return null;
	}
	const out: Slide[] = [];
	const margin = (g: (typeof gs)[number]) =>
		Math.abs(g.teams[0].pts - g.teams[1].pts);
	const total = (g: (typeof gs)[number]) => g.teams[0].pts + g.teams[1].pts;
	const allGames = X.seasons.flatMap((s) => X.games(s));
	const desc = (g: (typeof gs)[number]) => {
		const [a, b] =
			g.teams[0].pts > g.teams[1].pts
				? [g.teams[0], g.teams[1]]
				: [g.teams[1], g.teams[0]];
		return `${X.teamName(a.tid, season)} ${a.pts}, ${X.teamName(b.tid, season)} ${b.pts}${g.overtimes > 0 ? ` (${g.overtimes > 1 ? `${g.overtimes}OT` : "OT"})` : ""}${g.playoffs ? ", playoffs" : ""}`;
	};
	const blow = [...gs].sort((a, b) => margin(b) - margin(a))[0]!;
	const bm = margin(blow);
	const brank = allGames.filter((g) => margin(g) >= bm).length;
	const win =
		blow.teams[0].pts > blow.teams[1].pts ? blow.teams[0] : blow.teams[1];
	out.push(
		mk({
			id: "s-blowout",
			group: "game-margin",
			theme: "games",
			score: rankScore(brank, allGames.length),
			kicker: "The blowout",
			tid: win.tid,
			season,
			heads: [
				`A ${bm}-point blowout`,
				`The most lopsided game of the year: ${bm} points`,
			],
			hero: { text: `${bm}`, unit: "point margin" },
			lines: [
				desc(blow),
				`${plural(brank, "game")} on record won by ${bm} or more`,
			],
		}),
	);
	const shoot = [...gs].sort((a, b) => total(b) - total(a))[0]!;
	const tr = allGames.filter((g) => total(g) >= total(shoot)).length;
	out.push(
		mk({
			id: "s-shootout",
			group: "game-total",
			theme: "games",
			score: rankScore(tr, allGames.length) * 0.9,
			kicker: "The shootout",
			season,
			tid: shoot.teams[0].tid,
			heads: [
				`${total(shoot)} points in one game`,
				"Nobody played defense that night",
			],
			hero: { text: `${total(shoot)}`, unit: "combined points" },
			lines: [desc(shoot)],
		}),
	);
	const ot = [...gs].sort((a, b) => b.overtimes - a.overtimes)[0]!;
	if (ot.overtimes >= 2) {
		out.push(
			mk({
				id: "s-overtime",
				group: "ot",
				theme: "games",
				score: 0.2 + ot.overtimes * 0.12,
				kicker: "Bonus basketball",
				season,
				tid: ot.teams[0].tid,
				heads: [
					`A ${ot.overtimes}-overtime marathon`,
					`${ot.overtimes} overtimes in one game`,
				],
				hero: { text: `${ot.overtimes}`, unit: "overtimes" },
				lines: [desc(ot)],
			}),
		);
	}
	return out;
};

// Longest winning streak, from box scores in day order
const streak: Topic = ({ X, season }) => {
	const gs = X.games(season)
		.filter((g) => !g.playoffs)
		.sort((a, b) => a.day - b.day || a.gid - b.gid);
	if (gs.length < 50) {
		return null;
	}
	const cur = new Map<number, number>();
	let best = { tid: -1, n: 0 };
	for (const g of gs) {
		for (let i = 0; i < 2; i++) {
			const t = g.teams[i]!;
			const won = t.pts > g.teams[1 - i]!.pts;
			const n = won ? (cur.get(t.tid) ?? 0) + 1 : 0;
			cur.set(t.tid, n);
			if (n > best.n) {
				best = { tid: t.tid, n };
			}
		}
	}
	if (best.n < 7) {
		return null;
	}
	return mk({
		id: "s-streak",
		group: "streak",
		theme: "team",
		score: Math.min(0.9, 0.2 + best.n / 25),
		kicker: "Hot streak",
		tid: best.tid,
		season,
		heads: [
			`The ${X.teamName(best.tid, season)} won ${best.n} straight`,
			`${best.n} wins in a row`,
		],
		hero: { text: `${best.n}`, unit: "straight wins" },
		lines: ["The longest winning streak of the regular season"],
	});
};

const cinderella: Topic = ({ X, season }) => {
	const s = X.series(season);
	if (!s || !X.decided(season)) {
		return null;
	}
	let best: { tid: number; seed: number; round: number } | undefined;
	s.rounds.forEach((round, ri) => {
		for (const m of round) {
			for (const side of [m.home, m.away]) {
				if (
					side &&
					side.seed >= 5 &&
					(!best ||
						ri > best.round ||
						(ri === best.round && side.seed > best.seed))
				) {
					best = { tid: side.tid, seed: side.seed, round: ri };
				}
			}
		}
	});
	if (!best || best.round < 2) {
		return null;
	}
	const b = best;
	const n = X.numRounds(season);
	const ts = X.team(b.tid, season);
	const won = ts ? ts.playoffRoundsWon : b.round;
	return mk({
		id: "s-cinderella",
		group: "cinderella",
		theme: "playoffs",
		score: 0.4 + b.seed * 0.04 + (won >= n ? 0.2 : 0),
		kicker: "Cinderella",
		tid: b.tid,
		season,
		heads: [
			`The No. ${b.seed} seed ${X.teamName(b.tid, season)} made a run`,
			`A No. ${b.seed} seed nobody saw coming`,
		],
		hero: { text: `${b.seed}`, unit: "seed" },
		lines: [
			won >= n
				? "And won the title"
				: won === n - 1
					? "Reached the finals"
					: `Won ${plural(won, "playoff round")}`,
		],
	});
};

const sweeps: Topic = ({ X, season }) => {
	const s = X.series(season);
	if (!s || !X.decided(season)) {
		return null;
	}
	const list: string[] = [];
	let upsets = 0;
	for (const round of s.rounds) {
		for (const m of round) {
			if (!m.away) {
				continue;
			}
			const [w, l] =
				m.home.won > m.away.won ? [m.home, m.away] : [m.away, m.home];
			if (l.won === 0 && w.won >= 3) {
				list.push(
					`${X.teamName(w.tid, season)} over ${X.teamName(l.tid, season)}`,
				);
			}
			if (w.seed > l.seed) {
				upsets += 1;
			}
		}
	}
	const out: Slide[] = [];
	if (list.length > 0) {
		out.push(
			mk({
				id: "s-sweeps",
				group: "sweeps",
				theme: "playoffs",
				score: 0.2 + list.length * 0.08,
				kicker: "Brooms",
				season,
				heads: [
					`${plural(list.length, "sweep")} in the playoffs`,
					"Clean sweeps",
				],
				hero: {
					text: `${list.length}`,
					unit: list.length === 1 ? "sweep" : "sweeps",
				},
				lines: list.slice(0, 3),
			}),
		);
	}
	if (upsets >= 3) {
		out.push(
			mk({
				id: "s-upsets",
				group: "upsets",
				theme: "playoffs",
				score: 0.2 + upsets * 0.07,
				kicker: "Chalk? No",
				season,
				heads: [
					`${plural(upsets, "upset")} in the playoffs`,
					"The lower seed kept winning",
				],
				hero: { text: `${upsets}`, unit: "series upsets" },
				lines: ["Series won by the lower seed"],
			}),
		);
	}
	return out;
};

const rookies: Topic = ({ X, season }) => {
	const rk = X.lines(season).filter((l) => {
		const p = X.players.get(l.pid);
		return (
			p &&
			season > X.L.startingSeason &&
			p.stats.every((r) => r.season >= season) &&
			l.gp >= 20
		);
	});
	if (rk.length < 5) {
		return null;
	}
	rk.sort((a, b) => b.ppg - a.ppg);
	return mk({
		id: "s-rookies",
		group: "rookies",
		theme: "people",
		score: 0.3 + Math.min(0.4, Math.max(0, rk[0]!.ppg - 12) / 25),
		kicker: "The rookie class",
		pid: rk[0]!.pid,
		season,
		heads: ["The new kids", `${rk[0]!.name} led the rookies in scoring`],
		list: rk.slice(0, 5).map((l) => ({
			name: l.name,
			value: `${fmtNum(l.ppg, 1)} PPG`,
			pid: l.pid,
			tid: l.tid,
		})),
	});
};

const retirements: Topic = ({ X, season }) => {
	const r = X.L.players
		.filter((p) => p.retiredYear === season && p.stats.length > 0)
		.map((p) => ({ p, c: X.career(p) }))
		.filter((x) => x.c.gp >= 300)
		.sort((a, b) => b.c.ws - a.c.ws);
	if (r.length === 0) {
		return null;
	}
	const top = r[0]!;
	return mk({
		id: "s-retire",
		group: "retire",
		theme: "history",
		score: Math.min(0.85, 0.2 + top.c.ws / 200),
		kicker: "Farewells",
		pid: top.p.pid,
		season,
		heads: [`${top.p.name} called it a career`, "Saying goodbye"],
		list: r.slice(0, 4).map((x) => ({
			name: x.p.name,
			value: `${fmtNum(x.c.pts)} pts`,
			sub: `${plural(x.c.gp, "game")}, ${fmtNum(x.c.ws, 1)} WS`,
			pid: x.p.pid,
		})),
	});
};

const summary: Topic = ({ X, season }) => {
	const c = X.champion(season);
	const mvpP = X.awardWinner(season, "Most Valuable Player");
	const q = [...X.qualified(season)].sort((a, b) => b.ppg - a.ppg)[0];
	const chips: [string, string][] = [];
	if (c) {
		chips.push(["Champion", `${c.region} ${c.name}`]);
	}
	if (mvpP) {
		chips.push(["MVP", mvpP.name]);
	}
	if (q) {
		chips.push(["Scoring leader", `${q.name} (${fmtNum(q.ppg, 1)})`]);
	}
	return mk({
		id: "summary",
		group: "summary",
		theme: "summary",
		score: 1,
		kicker: `${season} in one card`,
		season,
		heads: [`That was ${season}`],
		chips,
	});
};

export const SEASON_TOPICS: Topic[] = [
	intro,
	champ,
	mvp,
	standings,
	game,
	leaders,
	highs,
	tripleDoubles,
	otherAwards,
	turnaround,
	breakout,
	ages,
	games,
	streak,
	cinderella,
	sweeps,
	rookies,
	retirements,
	summary,
];

export { bestGame };
