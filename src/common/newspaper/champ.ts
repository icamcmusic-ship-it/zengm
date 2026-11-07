/* eslint-disable unicorn/prefer-single-call */
// The champion story in more shapes: the classic game-by-game story, the road (timeline), the numbers, the tale of the tape, the turning point and what the title means. Which shape runs is picked by stepping through the shapes that fit, one place a season, so neighbouring seasons never tell it the same way.

import { Ctx, P } from "./ctx.ts";
import {
	type ChampX,
	champFacts,
	finalsMvp,
	inGames,
	leadFinal,
	seriesVerb,
	titleCount,
} from "./front.ts";
import { champHeadline } from "./front.ts";
import type { Rng } from "./text.ts";
import { andList, capFirst, fmt1, ordinal, plural, poss, record, signed, word } from "./text.ts";
import type { Article, Block, NPGame, NPSeries, Seg } from "./types.ts";

type ChampArc = {
	id: string;
	fit: (x: Ctx2) => boolean;
	heads: (x: Ctx2) => (string | null | false)[];
	build: (x: Ctx2, r: Rng) => Block[];
	deck?: (x: Ctx2) => Seg[];
};

type Ctx2 = ChampX & {
	c: Ctx;
	pd?: number;
	pfRank?: number;
	paRank?: number;
	engine?: ReturnType<Ctx["teamPlayers"]>[number];
	second?: ReturnType<Ctx["teamPlayers"]>[number];
	ruSeed?: number;
	hard?: { s: NPSeries; round: number; w: number; l: number; opp: number; oppSeed?: number };
	finalsGames: NPGame[];
	earlier: number[];
};

const prep = (c: Ctx, x: ChampX): Ctx2 => {
	const ts = x.ts;
	const pd = ts.pts !== undefined && ts.oppPts !== undefined ? ts.pts - ts.oppPts : undefined;
	const withPts = c.f.teams.filter((t) => t.pts !== undefined && t.oppPts !== undefined);
	const pfRank =
		ts.pts !== undefined ? withPts.filter((t) => t.pts! > ts.pts!).length + 1 : undefined;
	const paRank =
		ts.oppPts !== undefined ? withPts.filter((t) => t.oppPts! < ts.oppPts!).length + 1 : undefined;
	const players = c.teamPlayers(x.tid);
	const fin = x.path.at(-1);
	const finSeries = c.f.series[c.f.numRounds - 1]?.[0];
	const ruSeed = finSeries
		? finSeries.home.tid === x.ru
			? finSeries.home.seed
			: finSeries.away?.tid === x.ru
				? finSeries.away.seed
				: undefined
		: undefined;
	// The series that tested them most: the most games lost, ties broken by length
	const hardest = x.path
		.filter((p) => p.opp !== undefined)
		.toSorted((a, b) => b.l - a.l || b.w + b.l - (a.w + a.l))[0];
	const hardSeries = hardest
		? c.f.series[hardest.round]?.find(
				(s) => s.home.tid === x.tid || s.away?.tid === x.tid,
			)
		: undefined;
	void fin;
	return {
		...x,
		c,
		pd,
		pfRank,
		paRank,
		engine: players[0],
		second: players[1],
		ruSeed,
		hard:
			hardest && hardSeries && hardest.l > 0
				? {
						s: hardSeries,
						round: hardest.round,
						w: hardest.w,
						l: hardest.l,
						opp: hardest.opp!,
						oppSeed: hardest.oppSeed,
					}
				: undefined,
		finalsGames: x.finalGames,
		earlier: x.ts.titles.toSorted((a, b) => a - b),
	};
};

const flow = (c: Ctx, s: NPSeries, tid: number) => {
	const games = s.gids
		.map((gid) => c.f.games.find((g) => g.gid === gid))
		.filter((g): g is NPGame => g !== undefined);
	if (games.length < 3 || games.length < s.gids.length * 0.8) {
		return undefined;
	}
	let a = 0;
	let b = 0;
	let worst = 0;
	let worstAt = 0;
	const steps: { k: number; g: NPGame; won: boolean; a: number; b: number; margin: number }[] = [];
	for (const [i, g] of games.entries()) {
		const won = g.won.tid === tid;
		if (won) {
			a += 1;
		} else {
			b += 1;
		}
		steps.push({ k: i + 1, g, won, a, b, margin: g.won.pts - g.lost.pts });
		if (b - a > worst) {
			worst = b - a;
			worstAt = i + 1;
		}
	}
	return { steps, worst, worstAt };
};

const scoreLink = (c: Ctx, g: NPGame, tid: number): Seg =>
	c.gl(
		g.gid,
		tid,
		`${c.team(g.won.tid)?.abbrev} ${g.won.pts}, ${c.team(g.lost.tid)?.abbrev} ${g.lost.pts}`,
	);

const ARCS: ChampArc[] = [
	{
		id: "timeline",
		fit: (x) => x.path.length >= 2,
		heads: (x) => [
			x.ts.prev ? `From ${record(x.ts.prev)} to champions: the ${x.n}` : null,
			`${x.n} go ${x.poW}-${x.poL} through the playoffs to win the title`,
			`A ${record(x.ts)} season ends with a title for the ${x.n}`,
			`${x.n} win ${word(x.path.length)} rounds and the ${x.season} championship`,
			`${x.n} beat ${x.o} ${x.w}-${x.l}, completing a ${x.poW}-${x.poL} playoff run`,
		],
		build: (x) => {
			const c = x.c;
			const items: { label: string; segs: Seg[] }[] = [
				{
					label: "Regular season",
					segs: [
						`${record(x.ts)}, ${x.rank === 1 ? "best in the league" : `${ordinal(x.rank)} in the league`}${x.pd !== undefined ? `, ${signed(x.pd)} per game` : ""}${x.seed ? `; No. ${x.seed} seed` : ""}`,
					],
				},
			];
			for (const s of x.path) {
				items.push({
					label: capFirst(c.roundPhrase(s.round)),
					segs:
						s.opp === undefined
							? ["Bye"]
							: [
									"Beat ",
									s.oppSeed ? `No. ${s.oppSeed} ` : "",
									c.tl(s.opp),
									` ${s.w}-${s.l}`,
								],
				});
			}
			const fm = finalsMvp(c);
			if (fm?.po) {
				items.push({
					label: "Finals MVP",
					segs: [c.pl(fm.pid), `: ${c.lineWords(fm.po)} per playoff game`],
				});
			}
			return [
				P(
					"The ",
					c.tl(x.tid, c.tfull(x.tid)),
					` won the ${x.season} title by beating the `,
					c.tl(x.ru),
					` ${x.w}-${x.l}. ${x.ts.prev ? `A year earlier they had gone ${record(x.ts.prev)}.` : ""}`,
				),
				{ type: "timeline", items },
				P(...titleCount(c, x)),
			];
		},
	},
	{
		id: "numbers",
		fit: (x) => x.pd !== undefined || x.engine !== undefined,
		heads: (x) => [
			x.pd !== undefined && x.pd > 0
				? `${x.n} win the title after outscoring opponents by ${fmt1(x.pd)} a game`
				: null,
			x.engine ? `${poss(x.engine.name)} ${fmt1(x.engine.ws)} win shares carry the ${x.n} to the title` : null,
			`${poss(x.n)} ${record(x.ts)} season ends in a championship`,
			x.pfRank === 1
				? `League's top offense wins it all: the ${x.n}`
				: x.paRank === 1
					? `League's stingiest defense wins it all: the ${x.n}`
					: null,
			`${x.n} are champions; the numbers explain why`,
		],
		build: (x) => {
			const c = x.c;
			const out: Block[] = [
				P(
					"The ",
					c.tl(x.tid, c.tfull(x.tid)),
					" beat the ",
					c.tl(x.ru, c.tfull(x.ru)),
					` ${x.w}-${x.l} to win the ${x.season} championship. The case for them was built over the regular season.`,
				),
				{
					type: "nums",
					items: [
						{ value: record(x.ts), label: `regular-season record, ${x.rank === 1 ? "best in the league" : `${ordinal(x.rank)} best`}` },
						...(x.pd !== undefined ? [{ value: signed(x.pd), label: "point differential per game" }] : []),
						...(x.ts.pts !== undefined && x.pfRank ? [{ value: fmt1(x.ts.pts), label: `points per game (${ordinal(x.pfRank)})` }] : []),
						...(x.ts.oppPts !== undefined && x.paRank ? [{ value: fmt1(x.ts.oppPts), label: `allowed per game (${ordinal(x.paRank)})` }] : []),
						{ value: `${x.poW}-${x.poL}`, label: "playoff record" },
					],
				},
			];
			if (x.engine) {
				const k = c.statRank(x.engine.pid, "ws");
				out.push(
					P(
						c.pl(x.engine.pid),
						` led the roster with ${fmt1(x.engine.ws)} win shares${k ? ` (${ordinal(k)} in the league)` : ""}, averaging ${c.lineWords(x.engine)}. `,
						x.second && x.second.ws > 0 ? "Next was " : "",
						x.second && x.second.ws > 0 ? c.pl(x.second.pid) : "",
						x.second && x.second.ws > 0 ? ` at ${fmt1(x.second.ws)}.` : "",
					),
				);
			}
			const fm = finalsMvp(c);
			if (fm?.po) {
				out.push(
					P(
						"In the playoffs, Finals MVP ",
						c.pl(fm.pid),
						` averaged ${c.lineWords(fm.po)}${fm.po.fgp ? ` on ${fmt1(fm.po.fgp)}% shooting` : ""}.`,
					),
				);
			}
			out.push(P(...titleCount(c, x)));
			return out;
		},
	},
	{
		id: "tape",
		fit: (x) => x.ruTs !== undefined,
		heads: (x) => [
			x.seed && x.ruSeed
				? `${x.n} beat ${x.o} ${x.w}-${x.l} in a finals of No. ${x.seed} against No. ${x.ruSeed}`
				: null,
			`${x.o} fall ${x.w}-${x.l} to the ${x.n} in the finals`,
			`${x.n} ${x.w}-${x.l} over ${x.o}: how the finalists measured up`,
			`${record(x.ts)} against ${record(x.ruTs!)}: ${x.n} beat ${x.o} for the title`,
		],
		build: (x) => {
			const c = x.c;
			const ru = x.ruTs!;
			const ruPd = ru.pts !== undefined && ru.oppPts !== undefined ? ru.pts - ru.oppPts : undefined;
			const ruPlayers = c.teamPlayers(x.ru);
			const before = (tid: number) => {
				const legs = c.f.series
					.slice(0, c.f.numRounds - 1)
					.flat()
					.filter((s) => s.home.tid === tid || s.away?.tid === tid && s.away !== undefined);
				let w = 0;
				let l = 0;
				for (const s of legs) {
					const mine = s.home.tid === tid ? s.home : s.away!;
					const other = s.home.tid === tid ? s.away : s.home;
					w += mine.won;
					l += other?.won ?? 0;
				}
				return `${w}-${l}`;
			};
			const rows = [
				{ label: "Record", a: record(x.ts), b: record(ru) },
				...(x.seed && x.ruSeed ? [{ label: "Seed", a: String(x.seed), b: String(x.ruSeed) }] : []),
				...(x.pd !== undefined && ruPd !== undefined ? [{ label: "Point diff.", a: signed(x.pd), b: signed(ruPd) }] : []),
				...(x.engine && ruPlayers[0]
					? [{ label: "Top win shares", a: `${x.engine.name} ${fmt1(x.engine.ws)}`, b: `${ruPlayers[0].name} ${fmt1(ruPlayers[0].ws)}` }]
					: []),
				{ label: "Playoffs before the finals", a: before(x.tid), b: before(x.ru) },
				{ label: "Titles before", a: String(x.earlier.length), b: String(ru.titles.length) },
			];
			const out: Block[] = [
				P(
					"The finals put the ",
					c.tl(x.tid, c.tfull(x.tid)),
					` (${record(x.ts)}) against the `,
					c.tl(x.ru, c.tfull(x.ru)),
					` (${record(ru)}). The ${x.n} won it ${x.w}-${x.l}.`,
				),
				{ type: "tape", a: x.n, b: x.o, rows },
			];
			const fm = finalsMvp(c);
			const star = c.f.players
				.filter((p) => p.tid === x.ru && p.po && p.po.gp >= 3)
				.toSorted((a, b) => b.po!.pts - a.po!.pts)[0];
			out.push(
				P(
					fm?.po ? ["The Finals MVP was ", c.pl(fm.pid), ` (${fmt1(fm.po.pts)} points a game over the playoffs). `] : "",
					star?.po ? [`The ${x.o} got ${fmt1(star.po.pts)} a game from `, c.pl(star.pid), ". "] : "",
					`For the ${x.o}, it ${ru.titles.length === 0 ? "was a first finals loss without a title" : `was another finals without a title after ${plural(ru.titles.length, "championship")}`}. `,
					...titleCount(c, x),
				),
			);
			return out;
		},
	},
	{
		id: "turn",
		fit: (x) => x.hard !== undefined,
		heads: (x) => {
			const f = x.hard ? flow(x.c, x.hard.s, x.tid) : undefined;
			const on = x.hard ? x.c.tn(x.hard.opp) : "";
			return [
				f && f.worst > 0 ? `${x.n} recover from a ${f.steps[f.worstAt - 1]!.b}-${f.steps[f.worstAt - 1]!.a} deficit against the ${on}, then win the title` : null,
				`The ${x.c.roundPhrase(x.hard!.round)} nearly ended it: how the ${x.n} got past the ${on}`,
				`${x.n} needed ${word(x.hard!.w + x.hard!.l)} games against the ${on}. Then they won the title`,
				`Champions ${x.n} were tested most by the ${on}`,
			];
		},
		build: (x, r) => {
			const c = x.c;
			const h = x.hard!;
			const on = c.tn(h.opp);
			const ph = c.roundPhrase(h.round);
			const f = flow(c, h.s, x.tid);
			const body: Block[] = [];
			if (f && f.worst > 0) {
				const low = f.steps[f.worstAt - 1]!;
				const swing = f.steps.slice(f.worstAt).find((st) => st.won);
				const top = swing?.g.stars.find((s) => s.tid === x.tid);
				body.push(
					P(
						"The ",
						c.tl(x.tid, c.tfull(x.tid)),
						` trailed the ${on} ${low.b}-${low.a} in the ${ph}. The season turned in Game ${swing ? swing.k : f.worstAt + 1}`,
						swing ? [`, a ${swing.margin}-point win (`, scoreLink(c, swing.g, x.tid), ")"] : ".",
						swing && top ? [" in which ", c.pl(top.pid, top.name), ` had ${top.pts} points.`] : swing ? "." : "",
					),
				);
				body.push({
					type: "timeline",
					items: f.steps.map((st) => ({
						label: `Game ${st.k}`,
						segs: [scoreLink(c, st.g, x.tid), ` · series ${st.a}-${st.b}`],
					})),
				});
			} else {
				body.push(
					P(
						`No series tested the `,
						c.tl(x.tid),
						` like the ${ph} against the `,
						h.oppSeed ? `No. ${h.oppSeed} ` : "",
						c.tl(h.opp),
						`, which went ${h.w}-${h.l}.`,
					),
				);
			}
			const others = x.path.filter((y) => y.round !== h.round && y.opp !== undefined);
			if (others.length > 0) {
				body.push(
					P(
						`Elsewhere in the bracket the ${x.n} lost ${plural(others.reduce((a, y) => a + y.l, 0), "game")}: they `,
						...andList(
							others.map((y) => [
								seriesVerb(r, y.w, y.l),
								" the ",
								c.tl(y.opp!),
								` ${inGames(y.w, y.l)}`,
							]),
						),
						".",
					),
				);
			}
			body.push(P(...titleCount(c, x)));
			return body;
		},
	},
	{
		id: "meaning",
		fit: (x) => x.nTitles >= 2 || x.keys.includes("first") || x.keys.includes("drought"),
		heads: (x) => [
			x.nTitles >= 2
				? `Title No. ${x.nTitles} for the ${x.n}${x.prevTitle ? `, the first since ${x.prevTitle}` : ""}`
				: `The ${x.n} win the first title in franchise history`,
			x.nTitles >= 2 ? `${x.n} add ${x.nTitles >= 2 ? `a ${ordinal(x.nTitles)}` : "a"} banner` : `A first banner for the ${x.n} after ${x.season - x.ts.firstSeason} seasons`,
			`What the ${x.season} title means for the ${x.n}`,
			x.prevTitle && x.season - x.prevTitle >= 8 ? `${x.season - x.prevTitle} years later: the ${x.n} are champions again` : null,
		],
		build: (x) => {
			const c = x.c;
			const out: Block[] = [
				P(
					"The ",
					c.tl(x.tid, c.tfull(x.tid)),
					" beat the ",
					c.tl(x.ru, c.tfull(x.ru)),
					` ${x.w}-${x.l} for the ${x.season} championship. `,
					...titleCount(c, x),
				),
			];
			if (x.earlier.length >= 1) {
				const gaps = [...x.earlier, x.season].slice(1).map((y, i) => y - [...x.earlier, x.season][i]!);
				const cur = x.prevTitle !== undefined ? x.season - x.prevTitle : 0;
				out.push(
					P(
						`Their earlier titles: ${x.earlier.length > 6 ? `${x.earlier.slice(0, 3).join(", ")} … ${x.earlier.slice(-3).join(", ")}` : x.earlier.join(", ")}.`,
						x.streak >= 2
							? ` This is ${word(x.streak)} in a row.`
							: cur >= 5 && cur === Math.max(...gaps) && gaps.length > 1
								? ` The ${cur} seasons since ${x.prevTitle} were the longest wait between titles in franchise history.`
								: cur >= 5
									? ` The wait since ${x.prevTitle} was ${cur} seasons.`
									: "",
					),
				);
			} else {
				const made = (x.ts.hist ?? []).filter((h) => h.playoffRoundsWon >= 0).length;
				out.push(
					P(
						`The franchise has been playing since ${x.ts.firstSeason}${made > 0 ? ` and had reached the playoffs ${plural(made, "time")} without winning it all` : ""}.`,
					),
				);
			}
			const champs = (c.f.champions ?? []).filter((y) => y.season >= c.season - 9);
			if (champs.length >= 6) {
				const distinct = new Set(champs.map((y) => y.tid)).size + (champs.some((y) => y.tid === x.tid) ? 0 : 1);
				out.push(
					P(
						`Across the last ${champs.length + 1} seasons the title has gone to ${plural(distinct, "different franchise")}.`,
					),
				);
			}
			out.push(
				P(
					`For the `,
					c.tl(x.ru),
					`, ${x.ruTs && x.ruTs.titles.length > 0 ? `it is another finals without the title, after ${plural(x.ruTs.titles.length, "championship")}` : "it was a first trip to the finals without a ring"}.`,
				),
			);
			return out;
		},
	},
];

export const leadChampion = (c: Ctx): Article | undefined => {
	const x0 = champFacts(c);
	if (!x0) {
		return undefined;
	}
	const x = prep(c, x0);
	const fit = ARCS.filter((a) => a.fit(x));
	// The classic story takes every second season so it keeps its place
	const options: (ChampArc | "classic")[] = ["classic", ...fit];
	const choice = c.cycle("champ-arc", options);
	if (choice === "classic") {
		return leadFinal(c);
	}
	const r = c.rng("champ", choice.id);
	const headBase = champHeadline(c, x0);
	const heads = choice.heads(x).filter((h): h is string => typeof h === "string" && h.length > 0);
	const head = heads.length > 0 ? c.cycle(`champ-head|${choice.id}`, heads) : headBase.head;
	c.claim(`head|${head}`);
	const body = choice.build(x, r);
	const quote = c.quote(headBase.quote, c.quoteSource(r));
	const fm = finalsMvp(c);
	const top = c.teamPlayers(x.tid)[0];
	return {
		id: "lead",
		type: `champion-${choice.id}`,
		size: "lead",
		kicker: `Championship${x.games === 7 ? " · Game 7" : ""}`,
		head,
		deck: [
			"The ",
			c.tl(x.tid),
			x.seed ? ` (No. ${x.seed} seed)` : "",
			" beat the ",
			c.tl(x.ru),
			` ${x.w}-${x.l} in the finals.`,
		],
		byline: c.byline("front", c.city(x.tid)),
		photoPid: fm?.pid ?? top?.pid,
		body: [...body, quote],
	};
};
