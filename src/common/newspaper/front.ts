// Paragraphs are pushed one at a time, in reading order, which is clearer for prose than one big push
/* eslint-disable unicorn/prefer-single-call */
// Front page lead stories: champion (final edition), playoffs in progress, mid-season race, preseason preview.

import { Ctx, P } from "./ctx.ts";
import type { Rng } from "./text.ts";
import {
	aOrAn,
	andList,
	capFirst,
	fmt1,
	ordinal,
	plural,
	poss,
	record,
	signed,
	winp,
	word,
} from "./text.ts";
import type { Article, Block, NPGame, NPSeries, NPTeam, Seg } from "./types.ts";

type HeadFn = (n: string, o: string, x: ChampX) => string | null;

export type ChampX = {
	tid: number;
	ru: number;
	n: string;
	o: string;
	w: number;
	l: number;
	games: number;
	ts: NPTeam;
	ruTs: NPTeam | undefined;
	streak: number;
	nTitles: number;
	prevTitle: number | undefined;
	seasonsIn: number;
	rank: number;
	seed: number | undefined;
	path: {
		round: number;
		opp: number | undefined;
		w: number;
		l: number;
		oppSeed?: number;
	}[];
	poW: number;
	poL: number;
	keys: string[];
	finalGames: NPGame[];
	season: number;
};

const HEADS: Record<string, HeadFn[]> = {
	peat: [
		(n, _o, x) =>
			x.streak === 3
				? `Three-peat! ${n} do it again`
				: `${n} make it ${word(x.streak)} straight`,
		(n, _o, x) => `Dynasty: ${n} win ${ordinal(x.streak)} straight title`,
		(n, _o, x) => `${capFirst(word(x.streak))} in a row: ${n} still on top`,
		(n) => `Long live the ${n}: another title`,
		(n) => `The ${n} machine rolls on`,
		(n, o) => `${n} turn back ${o} to keep the run alive`,
	],
	first: [
		(n) => `${n} win first title in franchise history`,
		(n) => `At last: ${n} are champions`,
		(n, _o, x) => `After ${x.seasonsIn} seasons, the ${n} finally win it all`,
		(n) => `History made: ${n} claim first crown`,
		(n, o) => `${n} beat ${o} for first-ever title`,
		(n) => `Never before, now forever: ${n} are champions`,
	],
	drought: [
		(n, _o, x) => `${n} end ${x.season - (x.prevTitle ?? x.season)}-year wait`,
		(n, _o, x) =>
			`The wait is over: ${n} champions for first time since ${x.prevTitle}`,
		(n, _o, x) =>
			`${n} snap ${x.season - (x.prevTitle ?? x.season)}-year title drought`,
		(n) => `Banner time again for the ${n}`,
		(n, o) => `${n} beat ${o} to end the long wait`,
	],
	repeat: [
		(n) => `${n} repeat as champions`,
		(n) => `Back-to-back: ${n} defend their crown`,
		(n) => `Two in a row for the ${n}`,
		(n, o) => `${n} beat ${o}, repeat as champs`,
		(n) => `Double up: ${n} defend title`,
		(n) => `No letdown for the ${n}: champions again`,
	],
	upset: [
		(n, _o, x) =>
			x.seed
				? `Cinderella no more: No. ${x.seed} seed ${n} win it all`
				: `${n} stun the league, win it all`,
		(n) => `Nobody saw this coming: ${n} are champions`,
		(n, o) => `${n} shock ${o} to win title`,
		(n, _o, x) => `From ${ordinal(x.rank)} in the standings to champions: ${n}`,
		(n) => `The bracket said no. The ${n} said otherwise`,
	],
	game7: [
		(n) => `${n} win Game 7 to claim the crown`,
		(n, o) => `Seven games, one champion: ${n} outlast ${o}`,
		(n, o) => `${n} survive ${o} in a classic`,
		(n) => `Game 7 glory for the ${n}`,
		(n, o) => `Seventh heaven: ${n} beat ${o}`,
	],
	sweep: [
		(n, o) => `${n} sweep ${o} for the title`,
		(n, o) => `Brooms out: ${n} finish off ${o} in four`,
		(n) => `Clean sweep crowns the ${n}`,
		(n, o) => `Four and done: ${n} sweep ${o}`,
		(n, o) => `${o} swept aside as ${n} take title`,
	],
	dominant: [
		(n) => `${n} cap dominant season with title`,
		(n) => `Wire to wire: ${n} finish what they started`,
		(n) => `No doubt about it: ${n} are champions`,
		(n, _o, x) => `${n} finish ${record(x.ts)} season with the title`,
		(n) => `Best in the regular season, best in June: ${n}`,
	],
	decisive: [
		(n, o) => `${n} edge ${o} in a series that went the distance`,
		(n, o) => `${n} hold off ${o} in a tight finals`,
		(n) => `By the slimmest of margins: ${n} champions`,
		(n, o, x) => `${n} take the finals ${x.w}-${x.l} over ${o}`,
	],
	generic: [
		(n, o) => `${n} beat ${o} for the championship`,
		(n) => `The ${n} are champions`,
		(n, o, x) => `${n} top ${o} in ${word(x.games)} games for the title`,
		(n) => `Crown goes to the ${n}`,
		(n, _o, x) => `${n} win the ${x.season} title`,
		(n) => `Hoist the banner: ${n} win the title`,
	],
};

const QUOTES: Record<string, string[]> = {
	peat: [
		"At some point you stop asking who can beat them and start asking who wants to try.",
		"Everybody is building a team to beat them. So far that's just a hobby.",
		"You don't beat them. You wait for them to get old.",
	],
	first: [
		"You never forget the first one. Neither do the fans.",
		"Nobody in that locker room will ever buy a drink in that town again.",
		"The franchise finally has a banner that means something.",
	],
	drought: [
		"A whole generation of fans just found out what this feels like.",
		"They kept the banner space open for a long time. Worth it.",
		"You could hear the city exhale.",
	],
	repeat: [
		"Winning one is hard. Winning it again with a target on your back is harder.",
		"The second one tells you the first one wasn't luck.",
		"Everybody came for them this year. Nobody got there.",
	],
	upset: [
		"Nobody had them in the conversation in October. Nobody.",
		"Seeds are for gardens.",
		"Somewhere a bookmaker is very unhappy.",
	],
	game7: [
		"Game 7 is where reputations get made or buried. Theirs got made.",
		"I aged five years watching that series and I didn't even have a team in it.",
		"They should frame the tape of that one.",
	],
	sweep: [
		"Four games. I've sat through longer press conferences.",
		"That wasn't a series. That was a statement.",
		"Brooms in June. Doesn't get cleaner than that.",
	],
	dominant: [
		"The best team won. Sometimes it really is that simple.",
		"You could see this one coming from the first week.",
		"They were the best team in October and the best team in June.",
	],
	decisive: [
		"Every possession in that last game felt like a season.",
		"Margins that thin are where champions live.",
	],
	generic: [
		"Pretty or not, a title counts the same.",
		"Banners hang forever. Nobody asks how.",
		"Good teams win games. Champions win the last one.",
	],
};

export const seriesOf = (c: Ctx, tid: number) => {
	const out: { s: NPSeries; round: number }[] = [];
	for (const [round, list] of c.f.series.entries()) {
		if (round > c.f.currentRound) {
			break;
		}
		for (const s of list) {
			if (s.home.tid === tid || s.away?.tid === tid) {
				out.push({ s, round });
			}
		}
	}
	return out;
};

export const sides = (s: NPSeries, tid: number) => {
	const me = s.home.tid === tid ? s.home : s.away;
	const opp = s.home.tid === tid ? s.away : s.home;
	return { me, opp };
};

export const seriesVerb = (r: Rng, w: number, l: number) => {
	if (l === 0) {
		return r.pick(["swept", "brushed aside", "made quick work of"]);
	}
	if (w - l === 1 && l >= 2) {
		return r.pick(["survived", "edged", "outlasted", "squeezed past"]);
	}
	if (l === 1) {
		return r.pick(["dispatched", "handled", "rolled past"]);
	}
	return r.pick(["got past", "beat", "took care of"]);
};

export const inGames = (w: number, l: number) =>
	l === 0 && w === 4
		? "in four"
		: w + l <= 10
			? `in ${word(w + l)}`
			: `${w}-${l}`;

export const champFacts = (c: Ctx): ChampX | undefined => {
	const tid = c.f.champion;
	const ru = c.f.runnerUp;
	if (tid === undefined || ru === undefined) {
		return undefined;
	}
	const ts = c.team(tid);
	if (!ts) {
		return undefined;
	}
	const path = seriesOf(c, tid).map(({ s, round }) => {
		const { me, opp } = sides(s, tid);
		return {
			round,
			opp: opp?.tid,
			oppSeed: opp?.seed,
			w: me?.won ?? 0,
			l: opp?.won ?? 0,
		};
	});
	const fin = path.at(-1);
	const w = fin?.w ?? 0;
	const l = fin?.l ?? 0;
	const titles = ts.titles
		.filter((s) => s < c.season)
		.toSorted((a, b) => a - b);
	let streak = 1;
	while (titles.includes(c.season - streak)) {
		streak += 1;
	}
	const prevTitle = titles.at(-1);
	const rank = c.rank(tid);
	const ruTs = c.team(ru);
	const seed = seriesOf(c, tid)[0]
		? sides(seriesOf(c, tid)[0]!.s, tid).me?.seed
		: undefined;
	const keys: string[] = [];
	const seasonsIn = c.season - ts.firstSeason + 1;
	if (streak >= 3) {
		keys.push("peat");
	}
	if (titles.length === 0 && seasonsIn >= 4) {
		keys.push("first");
	}
	if (prevTitle !== undefined && c.season - prevTitle >= 15) {
		keys.push("drought");
	}
	if (streak === 2) {
		keys.push("repeat");
	}
	if ((seed !== undefined && seed >= 4) || rank >= 5) {
		keys.push("upset");
	}
	if (w + l === 7) {
		keys.push("game7");
	}
	if (l === 0 && w >= 3) {
		keys.push("sweep");
	}
	if (winp(ts) >= 0.72 && rank === 1) {
		keys.push("dominant");
	}
	if (!keys.includes("game7") && w - l === 1 && w + l >= 5) {
		keys.push("decisive");
	}
	keys.push("generic");
	const finSeries = seriesOf(c, tid).at(-1)?.s;
	const finalGames = finSeries
		? c.f.games
				.filter((g) => finSeries.gids.includes(g.gid))
				.toSorted(
					(a, b) =>
						finSeries.gids.indexOf(a.gid) - finSeries.gids.indexOf(b.gid),
				)
		: [];
	return {
		tid,
		ru,
		n: c.tn(tid),
		o: c.tn(ru),
		w,
		l,
		games: w + l,
		ts,
		ruTs,
		streak,
		nTitles: titles.length + 1,
		prevTitle,
		seasonsIn,
		rank,
		seed,
		path,
		poW: path.reduce((a, x) => a + x.w, 0),
		poL: path.reduce((a, x) => a + x.l, 0),
		keys,
		finalGames,
		season: c.season,
	};
};

export const champHeadline = (c: Ctx, x: ChampX) => {
	const r = c.rng("headline");
	const key = x.keys.length > 2 && r.chance(0.3) ? x.keys[1]! : x.keys[0]!;
	const fns = HEADS[key] ?? HEADS.generic!;
	const head = c.freshHead(
		r,
		fns.map((fn) => fn(x.n, x.o, x)),
	)!;
	const quote = r.pick(QUOTES[key] ?? QUOTES.generic!);
	return { key, head, quote, r };
};

const titleCount = (c: Ctx, x: ChampX): Seg[] => {
	if (x.nTitles === 1) {
		return [`It is the first championship in franchise history.`];
	}
	if (x.streak >= 2) {
		return [
			`It is the franchise's ${ordinal(x.nTitles)} title and its ${ordinal(x.streak)} in a row.`,
		];
	}
	return [
		`It is the franchise's ${ordinal(x.nTitles)} title${x.prevTitle !== undefined ? `, and the first since ${x.prevTitle}` : ""}.`,
	];
};

const road = (c: Ctx, x: ChampX, r: Rng, skipFinal: boolean): Seg[] => {
	const legs = x.path
		.filter((_s, i) => !(skipFinal && i === x.path.length - 1))
		.map((s): Seg[] =>
			s.opp === undefined
				? [`had a bye in the ${c.roundPhrase(s.round)}`]
				: [
						`${seriesVerb(r, s.w, s.l)} the `,
						s.oppSeed ? `No. ${s.oppSeed} ` : "",
						c.tl(s.opp),
						` ${inGames(s.w, s.l)} in the ${c.roundPhrase(s.round)}`,
					],
		);
	return andList(legs);
};

const finalsMvp = (c: Ctx) => {
	const a = c.award("FMVP");
	return a ? c.player(a.pid) : undefined;
};

export const leadFinal = (c: Ctx): Article | undefined => {
	const x = champFacts(c);
	if (!x) {
		return undefined;
	}
	const { head, quote, r } = champHeadline(c, x);
	const body: Block[] = [];
	const last = x.finalGames.at(-1);
	const fmvp = finalsMvp(c);

	const opener = r.pick(["straight", "moment", "season"]);
	if (opener === "moment" && last && last.won.tid === x.tid) {
		body.push(
			P(
				`Game ${x.games} of the finals ended `,
				c.gl(
					last.gid,
					x.tid,
					`${c.team(last.won.tid)?.abbrev} ${last.won.pts}, ${c.team(last.lost.tid)?.abbrev} ${last.lost.pts}`,
				),
				last.overtimes > 0
					? `, after ${last.overtimes > 1 ? `${word(last.overtimes)} overtimes` : "overtime"}`
					: "",
				", and the ",
				c.tl(x.tid, c.tfull(x.tid)),
				` were champions${x.streak >= 2 ? " again" : ""}.`,
			),
		);
		const star = last.stars.find((s) => s.tid === x.tid);
		const other = last.stars.find((s) => s.tid !== x.tid);
		if (star) {
			body.push(
				P(
					c.pl(star.pid, star.name),
					` had ${star.pts} points${star.trb >= 8 ? `, ${star.trb} rebounds` : ""}${star.ast >= 6 ? ` and ${star.ast} assists` : ""} in the clincher`,
					other
						? [
								"; ",
								c.pl(other.pid, other.name),
								` led the ${x.o} with ${other.pts}.`,
							]
						: ".",
				),
			);
		}
	} else if (opener === "season") {
		body.push(
			P(
				"The ",
				c.tl(x.tid, c.tfull(x.tid)),
				` began the season ${x.ts.prev ? `coming off ${aOrAn(record(x.ts.prev))} year` : "as a newcomer"} and ended it as champions, beating the `,
				c.tl(x.ru),
				` ${x.w}-${x.l} in the finals.`,
			),
		);
	} else {
		body.push(
			P(
				"The ",
				c.tl(x.tid, c.tfull(x.tid)),
				" beat the ",
				c.tl(x.ru, c.tfull(x.ru)),
				` ${x.w}-${x.l} in the finals to win the ${c.season} championship${x.ts ? `, capping ${aOrAn(record(x.ts))} regular season` : ""}.`,
			),
		);
	}

	const rd = road(c, x, r, true);
	if (rd.length > 0) {
		body.push(P(`To reach the finals they `, ...rd, `.`));
	}
	body.push(
		P(
			`In the regular season they ${x.rank === 1 ? "had the best record in the league" : `finished ${ordinal(x.rank)} in the league`} at ${record(x.ts)}${x.ts.pts !== undefined && x.ts.oppPts !== undefined ? `, outscoring opponents by ${fmt1(x.ts.pts - x.ts.oppPts)} points a game` : ""}. Their playoff record was ${x.poW}-${x.poL}.`,
		),
	);
	if (
		x.ts.pts !== undefined &&
		x.ts.oppPts !== undefined &&
		x.ts.pts < x.ts.oppPts
	) {
		body.pop();
		body.push(
			P(
				`They were ${record(x.ts)} in the regular season, ${ordinal(x.rank)} in the league, and were outscored by ${fmt1(x.ts.oppPts - x.ts.pts)} a game. None of that mattered in the playoffs, where they went ${x.poW}-${x.poL}.`,
			),
		);
	}
	if (fmvp && fmvp.po) {
		body.push(
			P(
				"Finals MVP ",
				c.pl(fmvp.pid),
				` averaged ${c.lineWords(fmvp.po)} across ${plural(fmvp.po.gp, "playoff game")}.`,
			),
		);
	}
	const top = c.teamPlayers(x.tid)[0];
	if (top && top.pid !== fmvp?.pid) {
		body.push(
			P(
				"Over the regular season, ",
				c.pl(top.pid),
				` led the roster with ${fmt1(top.ws)} win shares, averaging ${c.lineWords(top)}.`,
			),
		);
	}
	if (x.ruTs) {
		body.push(
			P(
				"The ",
				c.tl(x.ru),
				` (${record(x.ruTs)}) ${x.ruTs.titles.length > 0 ? `were chasing the franchise's ${ordinal(x.ruTs.titles.length + 1)} title` : "were chasing the franchise's first title"}.`,
			),
		);
	}
	body.push(P(...titleCount(c, x)));
	body.push({ type: "quote", text: quote, cite: c.quoteSource(r) });

	return {
		id: "lead",
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
		photoPid: fmvp?.pid ?? top?.pid,
		body,
	};
};

const gb = (a: NPTeam, b: NPTeam) => (a.won - b.won + (b.lost - a.lost)) / 2;
const gbTxt = (g: number) =>
	g === 0
		? "no games"
		: `${g % 1 ? g.toFixed(1) : g} ${g === 1 ? "game" : "games"}`;

export const leadMidseason = (c: Ctx): Article | undefined => {
	const rows = c.rows;
	const a = rows[0];
	if (!a) {
		return undefined;
	}
	const b = rows[1];
	const g = b ? gb(a, b) : 0;
	const close = b !== undefined && g <= 1.5;
	const worst = rows.length > 1 ? rows.at(-1) : undefined;
	const hot = rows
		.filter((t) => t.streak >= 4)
		.toSorted((p, q) => q.streak - p.streak)[0];
	const cold = rows
		.filter((t) => t.streak <= -4)
		.toSorted((p, q) => p.streak - q.streak)[0];
	const ladder = c.qual.toSorted((p, q) => q.ws - p.ws).slice(0, 5);
	const N = c.f.numGames;
	const pace = (t: NPTeam) => Math.round((t.won / Math.max(1, t.gp)) * N);
	const na = c.tn(a.tid);
	const nb = b ? c.tn(b.tid) : "";
	const r = c.rng("front-mid");
	const arcs = ["race", "notebook"];
	if (ladder.length >= 3) {
		arcs.push("mvp");
	}
	if (a.gp >= 10) {
		arcs.push("pace");
	}
	const arc = r.pick(arcs);
	const body: Block[] = [];
	let heads: (string | null)[] = [];
	const confLeaders =
		c.f.confs.length > 1
			? c.f.confs
					.map((conf) => ({ conf, top: rows.find((t) => t.cid === conf.cid) }))
					.filter(
						(x): x is { conf: (typeof x)["conf"]; top: NPTeam } =>
							x.top !== undefined,
					)
			: [];
	const scorer = c.qual.toSorted((p, q) => q.pts - p.pts)[0];

	if (arc === "race") {
		heads = [
			close && b
				? `${na} and ${nb} are ${g === 0 ? "tied" : `separated by ${gbTxt(g)}`} at the top`
				: `${na} lead the league at ${record(a)}`,
			b ? `${na} ${record(a)}, ${nb} ${record(b)} after ${c.f.gp} games` : null,
			close ? `Two-team race: ${na} and ${nb}` : `${na} lead by ${gbTxt(g)}`,
		];
		body.push(
			P(
				`Through ${c.f.gp} of ${N} games, the `,
				c.tl(a.tid, c.tfull(a.tid)),
				` hold the league's best record at ${record(a)}`,
				b
					? [
							`, ${g === 0 ? "tied with" : `${gbTxt(g)} ahead of`} the `,
							c.tl(b.tid),
							` (${record(b)}).`,
						]
					: ".",
			),
		);
		if (confLeaders.length > 1) {
			body.push(
				P(
					"By conference, ",
					...andList(
						confLeaders.map((x) => [
							"the ",
							c.tl(x.top.tid),
							` lead the ${x.conf.name} at ${record(x.top)}`,
						]),
					),
					".",
				),
			);
		}
		const mood: Seg[] = [];
		if (hot) {
			mood.push(
				"The hottest team is the ",
				c.tl(hot.tid),
				`, winners of ${hot.streak} straight. `,
			);
		}
		if (cold) {
			mood.push(
				r.pick(["Meanwhile the ", "At the other end, the "]),
				c.tl(cold.tid),
				` have dropped ${-cold.streak} in a row. `,
			);
		}
		if (worst && worst !== a) {
			mood.push("The ", c.tl(worst.tid), ` sit last at ${record(worst)}.`);
		}
		body.push(P(mood));
		if (ladder.length >= 3) {
			body.push(
				P(
					"By win shares so far, the MVP race reads: ",
					...andList(
						ladder
							.slice(0, 3)
							.map((p) => [
								c.pl(p.pid),
								` (${fmt1(p.ws)}, ${fmt1(p.pts)} ppg)`,
							]),
					),
					".",
				),
			);
		}
	} else if (arc === "mvp") {
		const [l0, l1, l2] = ladder as [
			(typeof ladder)[0],
			(typeof ladder)[0],
			(typeof ladder)[0],
		];
		heads = [
			`${l0.name} leads the MVP race at the ${c.f.gp}-game mark`,
			`MVP race: ${l0.name}, ${l1.name}, ${l2.name}`,
			`${l0.name} (${fmt1(l0.ws)} win shares) out front as the ${na} lead the league`,
		];
		body.push(
			P(
				c.pl(l0.pid),
				` has ${fmt1(l0.ws)} win shares through ${c.f.gp} games, ${fmt1(l0.ws - l1.ws)} more than `,
				c.pl(l1.pid),
				`. He is averaging ${c.lineWords(l0)} for ${aOrAn(c.rec(l0.tid))} `,
				c.tl(l0.tid),
				" team.",
			),
		);
		body.push({
			type: "table",
			head: ["", "Player", "WS", "PPG", "Team"],
			numCols: [0, 2, 3],
			rows: ladder.map((p, i) => [
				[String(i + 1)],
				[c.pl(p.pid)],
				[fmt1(p.ws)],
				[fmt1(p.pts)],
				[c.tl(p.tid, c.team(p.tid)?.abbrev), ` ${c.rec(p.tid)}`],
			]),
		});
		body.push(
			P(
				"In the standings, the ",
				c.tl(a.tid),
				` lead at ${record(a)}`,
				b
					? `, ${g === 0 ? "level with" : `${gbTxt(g)} ahead of`} the ${nb}.`
					: ".",
			),
		);
	} else if (arc === "pace") {
		const best = c.f.recordWins;
		heads = [
			`${na} on pace for ${pace(a)} wins`,
			worst
				? `At this rate: ${na} ${pace(a)}-${N - pace(a)}, ${c.tn(worst.tid)} ${pace(worst)}-${N - pace(worst)}`
				: null,
			best && pace(a) > best.won
				? `${na} on pace to break the league record of ${best.won} wins`
				: null,
		];
		body.push(
			P(
				"The ",
				c.tl(a.tid, c.tfull(a.tid)),
				` are ${record(a)} after ${a.gp} games, a pace of ${pace(a)} wins over ${N}.`,
				best
					? ` The most wins in a season in this league is ${best.won}, by the ${best.season} ${best.region} ${best.name}.`
					: "",
			),
		);
		if (b) {
			body.push(
				P("The ", c.tl(b.tid), ` are next at ${record(b)}, ${gbTxt(g)} back.`),
			);
		}
		if (worst) {
			body.push(
				P(
					"At the bottom, the ",
					c.tl(worst.tid),
					` (${record(worst)}) are on pace for ${pace(worst)} wins.`,
				),
			);
		}
	} else {
		heads = [
			`Notebook: ${na} on top${worst ? `, ${c.tn(worst.tid)} at the bottom` : ""}`,
			`${c.f.gp} games in: ${na} ${record(a)}${hot ? `, ${c.tn(hot.tid)} on ${aOrAn(String(hot.streak))}-game run` : ""}`,
			`The league at ${c.f.gp} games, in brief`,
		];
		body.push(P(`Where things stand after ${c.f.gp} of ${N} games:`));
		const items: { lead: string; segs: Seg[] }[] = [];
		items.push({
			lead: "Best record:",
			segs: [
				c.tl(a.tid),
				` ${record(a)}`,
				b
					? g === 0
						? `, tied with the ${nb}.`
						: `, ${gbTxt(g)} clear of the ${nb}.`
					: ".",
			],
		});
		for (const x of confLeaders) {
			items.push({
				lead: `${x.conf.name}:`,
				segs: [c.tl(x.top.tid), ` lead at ${record(x.top)}.`],
			});
		}
		if (hot) {
			items.push({
				lead: "Hottest:",
				segs: [c.tl(hot.tid), `, ${hot.streak} straight wins.`],
			});
		}
		if (cold) {
			items.push({
				lead: "Coldest:",
				segs: [c.tl(cold.tid), `, ${-cold.streak} straight losses.`],
			});
		}
		if (worst) {
			items.push({
				lead: "Last place:",
				segs: [c.tl(worst.tid), ` at ${record(worst)}.`],
			});
		}
		if (ladder[0]) {
			items.push({
				lead: "MVP pace:",
				segs: [c.pl(ladder[0].pid), `, ${fmt1(ladder[0].ws)} win shares.`],
			});
		}
		if (scorer) {
			items.push({
				lead: "Scoring leader:",
				segs: [c.pl(scorer.pid), ` at ${fmt1(scorer.pts)} a game.`],
			});
		}
		body.push({ type: "notebook", items });
	}
	body.push(
		P(
			`There are ${plural(Math.max(0, N - c.f.gp), "game")} left in the regular season for the busiest teams.`,
		),
	);
	return {
		id: "lead",
		size: "lead",
		kicker: `Standings · ${c.f.gp} games in`,
		head: c.freshHead(r, heads) ?? `${na} lead the league`,
		deck: ["The regular season is under way; nothing below is final."],
		byline: c.byline("front", c.city(a.tid)),
		photoPid: ladder[0]?.pid,
		body,
	};
};

export const leadPlayoffs = (c: Ctx): Article | undefined => {
	const rounds = c.f.series;
	if (rounds.length === 0) {
		return undefined;
	}
	const r = c.rng("front-po");
	// The current round is the last one with any matchups
	const ri = Math.max(0, Math.min(c.f.currentRound, rounds.length - 1));
	const cur = (rounds[ri] ?? []).filter((s) => s.away);
	const alive = cur.flatMap((s) => {
		const need = Math.ceil((s.gids.length || 1) / 2);
		void need;
		return [s.home, s.away!];
	});
	const phrase = c.roundPhrase(ri);
	const body: Block[] = [];
	body.push(
		P(
			`The ${c.season} playoffs are in the ${phrase}. ${capFirst(word(alive.length))} teams are still playing: `,
			...andList(alive.map((t) => [c.tl(t.tid), ` (No. ${t.seed})`])),
			".",
		),
	);
	const items: Seg[][] = cur.map((s) => {
		const lead = s.home.won >= s.away!.won ? s.home : s.away!;
		const trail = lead === s.home ? s.away! : s.home;
		if (lead.won === 0 && trail.won === 0) {
			return [
				`(${s.home.seed}) `,
				c.tl(s.home.tid),
				` vs. (${s.away!.seed}) `,
				c.tl(s.away!.tid),
				", yet to tip off",
			];
		}
		return lead.won === trail.won
			? [
					c.tl(s.home.tid),
					" and ",
					c.tl(s.away!.tid),
					` are tied ${lead.won}-${trail.won}`,
				]
			: [
					c.tl(lead.tid),
					` lead the `,
					c.tl(trail.tid),
					` ${lead.won}-${trail.won}`,
				];
	});
	body.push({ type: "list", items });
	// Upsets so far
	const upsets: Seg[][] = [];
	for (const [i, list] of rounds.entries()) {
		for (const s of list) {
			if (!s.away) {
				continue;
			}
			const done = Math.max(s.home.won, s.away.won);
			const winner = s.home.won > s.away.won ? s.home : s.away;
			const loser = winner === s.home ? s.away : s.home;
			if (i < ri && done > 0 && winner.seed > loser.seed) {
				upsets.push([
					`No. ${winner.seed} `,
					c.tl(winner.tid),
					` beat No. ${loser.seed} `,
					c.tl(loser.tid),
					` in the ${c.roundPhrase(i)}`,
				]);
			}
		}
	}
	if (upsets.length > 0) {
		body.push(
			P("The bracket has already been broken: ", ...andList(upsets), "."),
		);
	}
	const stars = c.f.players
		.filter((p) => p.po && p.po.gp >= 2 && alive.some((t) => t.tid === p.tid))
		.toSorted((a, b) => b.po!.pts - a.po!.pts)
		.slice(0, 3);
	if (stars.length > 0) {
		body.push(
			P(
				"The leading scorers still alive: ",
				...andList(
					stars.map((p) => [
						c.pl(p.pid),
						` (${fmt1(p.po!.pts)} ppg, `,
						c.tl(p.tid),
						")",
					]),
				),
				".",
			),
		);
	}
	const fav = alive.toSorted(
		(a, b) => winp(c.team(b.tid)!) - winp(c.team(a.tid)!),
	)[0];
	const heads = [
		`Down to ${word(alive.length)}: the ${phrase} ${phrase.endsWith("finals") ? "are" : "is"} under way`,
		fav ? `${c.tn(fav.tid)} lead the field into the ${phrase}` : null,
		`Playoffs: ${phrase}, and counting`,
		stars[0]
			? `${stars[0].name} and the ${c.tn(stars[0].tid)} press on in the ${phrase}`
			: null,
	];
	return {
		id: "lead",
		size: "lead",
		kicker: `Playoffs · ${capFirst(phrase)}`,
		head: c.freshHead(r, heads)!,
		deck: ["The regular season is over; the playoffs are under way."],
		byline: c.byline("playoffs"),
		photoPid: stars[0]?.pid,
		body,
	};
};

export const leadPreseason = (c: Ctx): Article | undefined => {
	const teams = c.f.teams;
	if (teams.length === 0) {
		return undefined;
	}
	const r = c.rng("front-pre");
	// Rate each roster by its top eight ratings
	const power = teams
		.map((t) => {
			const ovrs = c.f.players
				.filter((p) => p.tid === t.tid)
				.map((p) => p.ovr)
				.toSorted((a, b) => b - a)
				.slice(0, 8);
			const score = ovrs.length
				? ovrs.reduce((a, b) => a + b, 0) / ovrs.length
				: 0;
			return { t, score };
		})
		.toSorted((a, b) => b.score - a.score);
	const fav = power[0]!;
	const second = power[1];
	const champPrev = teams.find((t) => t.titles.includes(c.season - 1));
	const stars = c.f.players.toSorted((a, b) => b.ovr - a.ovr).slice(0, 3);
	const body: Block[] = [];
	body.push(
		P(
			`The ${c.season} season has not tipped off yet. On paper, the `,
			c.tl(fav.t.tid, c.tfull(fav.t.tid)),
			" have the deepest roster in the league",
			second ? [", ahead of the ", c.tl(second.t.tid)] : "",
			".",
		),
	);
	if (champPrev) {
		body.push(
			P(
				"The defending champion ",
				c.tl(champPrev.tid),
				` ${champPrev.prev ? `went ${record(champPrev.prev)} last season` : "won it all last season"}` +
					`${champPrev.tid === fav.t.tid ? " and start as favorites again." : `; on roster ratings they rank ${ordinal(power.findIndex((x) => x.t.tid === champPrev.tid) + 1)}.`}`,
			),
		);
	}
	if (stars.length >= 2) {
		body.push(
			P(
				"The highest-rated players entering the season: ",
				...andList(
					stars.map((p) => [c.pl(p.pid), ` (${p.ovr} ovr, `, c.tl(p.tid), ")"]),
				),
				".",
			),
		);
	}
	const moves = c.f.signings
		.toSorted((a, b) => b.amount - a.amount)
		.slice(0, 3);
	if (moves.length > 0) {
		body.push(
			P(
				"The biggest contracts of the summer: ",
				...andList(
					moves.map((m) => [
						c.pl(m.pid, m.name),
						` to the `,
						c.tl(m.tid),
						` (${m.amount >= 1000 ? `$${(m.amount / 1000).toFixed(1)}M` : `$${m.amount}k`} a year)`,
					]),
				),
				".",
			),
		);
	}
	body.push({
		type: "table",
		head: ["", "Team", "Roster rating", "Last season"],
		numCols: [0, 2],
		rows: power
			.slice(0, 8)
			.map((x, i) => [
				[String(i + 1)],
				[c.tl(x.t.tid, c.tfull(x.t.tid))],
				[x.score.toFixed(1)],
				[x.t.prev ? record(x.t.prev) : "–"],
			]),
	});
	return {
		id: "lead",
		size: "lead",
		kicker: "Season preview",
		head: c.freshHead(r, [
			`${c.tn(fav.t.tid)} enter ${c.season} as the team to beat`,
			`Preview: it's the ${poss(c.tn(fav.t.tid))} league to lose`,
			`A new season begins, and the ${c.tn(fav.t.tid)} look strongest`,
		])!,
		deck: [
			"Nothing has been played yet; the outlook comes from roster ratings.",
		],
		byline: c.byline("front"),
		photoPid: stars[0]?.pid,
		body,
	};
};

export const signedDiff = (t: NPTeam) =>
	t.pts !== undefined && t.oppPts !== undefined
		? signed(t.pts - t.oppPts)
		: undefined;
