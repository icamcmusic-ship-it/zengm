import type { Slide, WPlayer } from "../types.ts";
import { fmtNum, fmtRecord, fmtWinp, plural, span, winPct } from "../util.ts";
import { allGameLines, lineText, mk, type Topic } from "./helpers.ts";

const careers = (X: Parameters<Topic>[0]["X"]) =>
	X.cached("careers", () =>
		X.L.players
			.filter((p) => p.stats.some((r) => r.gp > 0))
			.map((p) => ({ p, c: X.career(p) })),
	);

const intro: Topic = ({ X }) => {
	const s = X.seasons;
	if (s.length === 0) {
		return null;
	}
	return mk({
		id: "intro",
		group: "intro",
		theme: "intro",
		score: 1,
		core: true,
		kicker: "All-time Wrapped",
		heads: [
			"The whole history, wrapped",
			`${span(s[0]!, s.at(-1)!)}: the story so far`,
		],
		hero: { text: `${s.length}`, unit: s.length === 1 ? "season" : "seasons" },
		lines: [`${plural(careers(X).length, "player")} have played in the league`],
	});
};

const awardCount = (X: Parameters<Topic>[0]["X"], p: WPlayer, type: string) =>
	X.countAwards(p, type);

const goat: Topic = ({ X }) => {
	const list = careers(X)
		.map((x) => ({
			...x,
			v:
				x.c.ws +
				awardCount(X, x.p, "Most Valuable Player") * 10 +
				X.L.teamSeasons.length * 0,
		}))
		.sort((a, b) => b.v - a.v);
	const g = list[0];
	if (!g || g.c.gp < 50) {
		return null;
	}
	const mvps = awardCount(X, g.p, "Most Valuable Player");
	const rings = awardCount(X, g.p, "Won Championship");
	return mk({
		id: "goat",
		group: "goat",
		theme: "history",
		score: 1,
		core: true,
		kicker: "The greatest",
		pid: g.p.pid,
		heads: [`${g.p.name}: the GOAT (so far)`, `The best ever: ${g.p.name}`],
		hero: { text: fmtNum(g.c.ws, 1), unit: "career win shares" },
		chips: [
			["MVPs", `${mvps}`],
			["Titles", `${rings}`],
			["Points", fmtNum(g.c.pts)],
		],
		list: list.slice(1, 4).map((x) => ({
			name: x.p.name,
			value: `${fmtNum(x.c.ws, 1)} WS`,
			pid: x.p.pid,
		})),
		lines: ["Ranked by win shares plus MVP awards"],
	});
};

const dynasty: Topic = ({ X }) => {
	const champs = X.decidedSeasons()
		.map((s) => ({ s, t: X.champion(s) }))
		.filter((x) => x.t);
	if (champs.length === 0) {
		return null;
	}
	const by = new Map<number, number[]>();
	for (const c of champs) {
		by.set(c.t!.tid, [...(by.get(c.t!.tid) ?? []), c.s]);
	}
	const [tid, seasons] = [...by.entries()].sort(
		(a, b) => b[1].length - a[1].length || a[1][0]! - b[1][0]!,
	)[0]!;
	const last = seasons.at(-1)!;
	return mk({
		id: "dynasty",
		group: "dynasty",
		theme: "playoffs",
		score: 0.95,
		core: true,
		kicker: "The dynasty",
		tid,
		season: last,
		heads: [
			`The ${X.teamName(tid, last)} have the most titles`,
			`${plural(seasons.length, "title")} for the ${X.teamName(tid, last)}`,
		],
		hero: {
			text: `${seasons.length}`,
			unit: seasons.length === 1 ? "title" : "titles",
		},
		lines: [seasons.join(", ")],
		list: [...by.entries()]
			.filter(([t]) => t !== tid)
			.sort((a, b) => b[1].length - a[1].length)
			.slice(0, 3)
			.map(([t, s]) => ({
				name: X.teamName(t, s.at(-1)!),
				value: plural(s.length, "title"),
				tid: t,
			})),
	});
};

const team: Topic = ({ X }) => {
	const ts = X.L.teamSeasons
		.filter((t) => X.decided(t.season) && t.won + t.lost > 10)
		.sort(
			(a, b) => winPct(b.won, b.lost, b.tied) - winPct(a.won, a.lost, a.tied),
		);
	const b = ts[0];
	if (!b) {
		return null;
	}
	return mk({
		id: "team",
		group: "best-team",
		theme: "team",
		score: 0.9,
		core: true,
		kicker: "Best team ever",
		tid: b.tid,
		season: b.season,
		heads: [
			`The ${b.season} ${b.region} ${b.name}`,
			`${fmtRecord(b.won, b.lost, b.tied, b.otl)}: the best record ever`,
		],
		hero: { text: fmtWinp(winPct(b.won, b.lost, b.tied)), unit: "win pct" },
		lines: [
			b.playoffRoundsWon >= X.numRounds(b.season)
				? "And they won the title"
				: "But they didn’t win the title",
		],
		list: ts.slice(1, 4).map((t) => ({
			name: `${t.season} ${t.region} ${t.name}`,
			value: fmtRecord(t.won, t.lost, t.tied, t.otl),
			tid: t.tid,
		})),
	});
};

const titles: Topic = ({ X }) => {
	const list = X.decidedSeasons()
		.map((s) => ({ s, t: X.champion(s), m: X.awardWinner(s, "Finals MVP") }))
		.filter((x) => x.t)
		.reverse();
	if (list.length === 0) {
		return null;
	}
	return mk({
		id: "titles",
		group: "titles",
		theme: "playoffs",
		score: 0.8,
		core: true,
		kicker: "Every champion",
		heads: ["The champions", "Roll call of champions"],
		list: list.slice(0, 8).map((x) => ({
			name: `${x.s}`,
			value: `${x.t!.region} ${x.t!.name}`,
			sub: x.m ? `Finals MVP: ${x.m.name}` : undefined,
			tid: x.t!.tid,
		})),
		lines: [
			list.length > 8 ? `…and ${plural(list.length - 8, "more season")}` : null,
		],
	});
};

const leaders: Topic = ({ X }) => {
	const out: Slide[] = [];
	for (const [k, noun, theme] of [
		["pts", "points", "scoring"],
		["trb", "rebounds", "inside"],
		["ast", "assists", "playmaking"],
		["blk", "blocks", "defense"],
		["stl", "steals", "defense"],
		["tp", "three-pointers", "scoring"],
	] as const) {
		const list = careers(X).sort((a, b) => b.c[k] - a.c[k]);
		const top = list[0];
		if (!top || top.c[k] <= 0) {
			continue;
		}
		const gap = list[1] ? top.c[k] - list[1].c[k] : 0;
		out.push(
			mk({
				id: `a-car-${k}`,
				group: "career",
				theme,
				score: k === "pts" ? 0.8 : 0.55,
				kicker: `All-time ${noun} leader`,
				pid: top.p.pid,
				heads: [
					`${top.p.name} has the most ${noun} ever`,
					`The ${noun} king: ${top.p.name}`,
				],
				hero: { text: fmtNum(top.c[k]), unit: noun },
				list: list.slice(1, 5).map((x) => ({
					name: x.p.name,
					value: fmtNum(x.c[k]),
					pid: x.p.pid,
				})),
				lines: [
					list[1] ? `${fmtNum(gap)} ahead of ${list[1].p.name}` : null,
					top.p.retiredYear < Infinity
						? `Retired in ${top.p.retiredYear}`
						: "Still active",
				],
			}),
		);
	}
	return out;
};

const awardKings: Topic = ({ X }) => {
	const out: Slide[] = [];
	for (const [type, key, score] of [
		["Most Valuable Player", "mvp", 0.75],
		["All-Star", "as", 0.5],
		["Won Championship", "rings", 0.6],
		["Defensive Player of the Year", "dpoy", 0.4],
	] as const) {
		const list = X.L.players
			.map((p) => ({ p, n: awardCount(X, p, type) }))
			.filter((x) => x.n > 0)
			.sort((a, b) => b.n - a.n);
		const t = list[0];
		if (!t || (type !== "Most Valuable Player" && t.n < 2)) {
			continue;
		}
		const label =
			key === "rings"
				? "titles"
				: key === "as"
					? "All-Star selections"
					: `${type} awards`;
		out.push(
			mk({
				id: `a-most-${key}`,
				group: "award-kings",
				theme: "awards",
				score,
				kicker:
					key === "rings"
						? "Ring collector"
						: `Most ${key === "as" ? "All-Star" : type} awards`,
				pid: t.p.pid,
				heads: [
					`${t.p.name}: ${plural(t.n, key === "rings" ? "title" : key === "as" ? "All-Star selection" : type)}`,
				],
				hero: { text: `${t.n}`, unit: label },
				list: list
					.slice(1, 5)
					.map((x) => ({ name: x.p.name, value: `${x.n}`, pid: x.p.pid })),
			}),
		);
	}
	return out;
};

const season: Topic = ({ X }) => {
	const q = X.allQualified().filter((l) => X.decided(l.season));
	if (q.length < 20) {
		return null;
	}
	const b = [...q].sort((a, b) => b.ws - a.ws)[0]!;
	const sc = [...q].sort((a, b) => b.ppg - a.ppg)[0]!;
	return [
		mk({
			id: "a-best-season",
			group: "season",
			theme: "efficiency",
			score: 0.7,
			kicker: "Best season ever",
			pid: b.pid,
			tid: b.tid,
			season: b.season,
			heads: [`${b.name} in ${b.season}`, "The single greatest season"],
			hero: { text: fmtNum(b.ws, 1), unit: "win shares" },
			lines: [lineText(b), `Out of ${fmtNum(q.length)} qualified seasons`],
		}),
		mk({
			id: "a-best-scoring",
			group: "season",
			theme: "scoring",
			score: 0.65,
			kicker: "Scoring season of all time",
			pid: sc.pid,
			tid: sc.tid,
			season: sc.season,
			heads: [`${sc.name} averaged ${fmtNum(sc.ppg, 1)} in ${sc.season}`],
			hero: { text: fmtNum(sc.ppg, 1), unit: "PPG" },
			lines: [lineText(sc)],
		}),
	];
};

const bestGameEver: Topic = ({ X }) => {
	const ls = allGameLines(X);
	if (ls.length < 500) {
		return null;
	}
	const b = ls.reduce((a, c) => (c.pts > a.pts ? c : a));
	return mk({
		id: "a-game",
		group: "game",
		theme: "games",
		score: 0.7,
		kicker: "Biggest scoring game on record",
		pid: b.pid,
		tid: b.tid,
		season: b.season,
		heads: [`${b.name} scored ${b.pts} in ${b.season}`],
		hero: { text: `${b.pts}`, unit: "PTS" },
		lines: [
			`vs ${X.teamName(b.opp, b.season)}`,
			`Box scores on record: ${span(
				X.seasons.find((s) => X.hasBoxScores(s))!,
				X.seasons.findLast((s) => X.hasBoxScores(s))!,
			)}`,
		],
	});
};

const drought: Topic = ({ X }) => {
	const seasons = X.decidedSeasons();
	if (seasons.length < 3) {
		return null;
	}
	const lastS = seasons.at(-1)!;
	let best: { tid: number; n: number; last?: number } | undefined;
	for (const t of X.teamsIn(lastS)) {
		const won = X.titlesOf(t.tid);
		const from = won.at(-1) ?? X.teamHistory(t.tid)[0]!.season - 1;
		const n = lastS - from;
		if (!best || n > best.n) {
			best = { tid: t.tid, n, last: won.at(-1) };
		}
	}
	if (!best || best.n < 3) {
		return null;
	}
	return mk({
		id: "a-drought",
		group: "drought",
		theme: "team",
		score: 0.35 + Math.min(0.4, best.n / 60),
		kicker: "Still waiting",
		tid: best.tid,
		heads: [`The ${X.teamName(best.tid, lastS)} are still waiting`],
		hero: { text: `${best.n}`, unit: "seasons without a title" },
		lines: [best.last ? `Last title: ${best.last}` : "Never won a title"],
	});
};

const steal: Topic = ({ X }) => {
	const list = careers(X)
		.filter(
			(x) =>
				x.p.draft.round >= 2 || x.p.draft.round === 0 || x.p.draft.pick > 20,
		)
		.sort((a, b) => b.c.ws - a.c.ws);
	const s = list[0];
	if (!s || s.c.ws < 10) {
		return null;
	}
	const d = s.p.draft;
	return mk({
		id: "a-steal",
		group: "draft",
		theme: "people",
		score: 0.5,
		kicker: "Draft steal",
		pid: s.p.pid,
		heads: [`${s.p.name}: the steal of the draft`],
		hero: { text: fmtNum(s.c.ws, 1), unit: "career win shares" },
		lines: [
			d.round > 0
				? `Picked No. ${d.pick} in round ${d.round}, ${d.year}`
				: `Undrafted in ${d.year}`,
			`${fmtNum(s.c.pts)} career points`,
		],
	});
};

const hof: Topic = ({ X }) => {
	const list = X.L.players.filter((p) => p.hof);
	if (list.length === 0) {
		return null;
	}
	return mk({
		id: "a-hof",
		group: "hof",
		theme: "history",
		score: 0.35,
		kicker: "Hall of Fame",
		heads: [`${plural(list.length, "Hall of Famer")}`],
		hero: { text: `${list.length}`, unit: "inducted" },
		list: list
			.map((p) => ({ p, c: X.career(p) }))
			.sort((a, b) => b.c.ws - a.c.ws)
			.slice(0, 5)
			.map((x) => ({
				name: x.p.name,
				value: `${fmtNum(x.c.pts)} pts`,
				pid: x.p.pid,
			})),
	});
};

const summary: Topic = ({ X }) => {
	const s = X.seasons;
	return mk({
		id: "summary",
		group: "summary",
		theme: "summary",
		score: 1,
		kicker: "All-time",
		heads: ["And the story continues"],
		chips: [
			["Seasons", `${s.length}`],
			["Players", fmtNum(careers(X).length)],
			[
				"Champions",
				`${
					new Set(
						X.decidedSeasons()
							.map((x) => X.champion(x)?.tid)
							.filter((x) => x !== undefined),
					).size
				} franchises`,
			],
		],
	});
};

export const ALL_TOPICS: Topic[] = [
	intro,
	goat,
	dynasty,
	team,
	titles,
	leaders,
	awardKings,
	season,
	bestGameEver,
	drought,
	steal,
	hof,
	summary,
];
