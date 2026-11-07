// Paragraphs are pushed one at a time, in reading order, which is clearer for prose than one big push
/* eslint-disable unicorn/prefer-single-call */
// Articles and sidebars for the inside sections of the league paper.

import { Ctx, P } from "./ctx.ts";
import { inGames, seriesVerb } from "./front.ts";
import {
	aOrAn,
	andList,
	capFirst,
	fmt1,
	money,
	ordinal,
	plural,
	poss,
	record,
	winp,
	word,
} from "./text.ts";
import type {
	Article,
	Block,
	NPPlayer,
	NPTeam,
	NPTradeAsset,
	Seg,
	Sidebar,
} from "./types.ts";

const AWARD_BEATS: Record<string, { label: string; what: string }> = {
	MVP: {
		label: "Most Valuable Player",
		what: "the league's Most Valuable Player",
	},
	DPOY: {
		label: "Defensive Player of the Year",
		what: "Defensive Player of the Year",
	},
	ROY: { label: "Rookie of the Year", what: "Rookie of the Year" },
	SMOY: { label: "Sixth Man of the Year", what: "Sixth Man of the Year" },
	MIP: { label: "Most Improved Player", what: "Most Improved Player" },
};

const shortLine = (p: Pick<NPPlayer, "pts" | "trb" | "ast">) =>
	`${fmt1(p.pts)}/${fmt1(p.trb)}/${fmt1(p.ast)}`;

// ---- Awards ----------------------------------------------------------------

export const awardStory = (c: Ctx, key: string): Article | undefined => {
	const a = c.award(key);
	const info = AWARD_BEATS[key];
	if (!a || !info) {
		return undefined;
	}
	const p = c.player(a.pid);
	if (!p) {
		return undefined;
	}
	const r = c.rng("award", key);
	const body: Block[] = [];
	const t = c.team(p.tid);
	const runner = a.order[1] !== undefined ? c.player(a.order[1]) : undefined;
	body.push(
		P(
			c.pl(p.pid),
			` of the `,
			c.tl(a.tid),
			` is ${info.what} for ${c.season}. The ${p.age}-year-old ${p.pos} averaged ${c.lineWords(p)} in ${plural(p.gp, "game")}.`,
		),
	);
	if (key === "DPOY") {
		body.push(
			P(`He added ${fmt1(p.stl)} steals and ${fmt1(p.blk)} blocks a night.`),
		);
	} else if (key === "MIP" && p.prevLine) {
		body.push(
			P(
				`A year ago he averaged ${fmt1(p.prevLine.pts)} points in ${plural(p.prevLine.gp, "game")}; this season it was ${fmt1(p.pts)}${p.prevOvr !== undefined ? `, and his rating climbed from ${p.prevOvr} to ${p.ovr}` : ""}.`,
			),
		);
	} else if (key === "ROY") {
		body.push(
			P(
				p.draftRound > 0
					? `He was the No. ${p.draftPick + (p.draftRound - 1) * 30} pick in the ${p.draftYear} draft${p.draftTid !== p.tid ? ", taken by another team before landing here" : ""}.`
					: `He went undrafted in ${p.draftYear}.`,
			),
		);
	} else {
		const k = c.statRank(p.pid, "ws");
		body.push(
			P(
				`His ${fmt1(p.ws)} win shares ${k === 1 ? "led the league" : k ? `ranked ${ordinal(k)} in the league` : "were a team high"}${p.per ? `, with a PER of ${fmt1(p.per)}` : ""}.`,
			),
		);
	}
	if (t) {
		body.push(
			P(
				`The `,
				c.tl(t.tid),
				` went ${record(t)} and ${c.fate(t.playoffRoundsWon)}.`,
			),
		);
	}
	if (runner) {
		body.push(
			P(
				c.pl(runner.pid),
				` (${shortLine(runner)}, `,
				c.tl(runner.tid, c.team(runner.tid)?.abbrev),
				`) finished second in the voting.`,
			),
		);
	}
	const heads = [
		`${p.name} named ${info.label}`,
		`${info.label}: ${p.name}`,
		`${p.name} wins ${key === "MVP" ? "MVP" : info.label} honors`,
		key === "MVP" ? `${p.name} is the ${c.season} MVP` : null,
		key === "MVP" && t ? `${p.name} carries the ${t.name} to MVP honors` : null,
	];
	return {
		id: `award-${key}`,
		size: key === "MVP" ? "feature" : "brief",
		kicker: info.label,
		head: c.freshHead(r, heads)!,
		byline: c.byline("awards"),
		photoPid: p.pid,
		body,
	};
};

export const allLeagueBlock = (c: Ctx): Article | undefined => {
	const blocks: Block[] = [];
	for (const ta of c.f.teamAwards) {
		blocks.push({ type: "sub", text: ta.name });
		blocks.push({
			type: "list",
			items: ta.teams.map((team) => [
				`${team.title}: `,
				...andList(team.pids.map((pid) => [c.pl(pid)])),
			]),
		});
	}
	if (blocks.length === 0) {
		return undefined;
	}
	return {
		id: "all-league",
		size: "brief",
		kicker: "Honors",
		head: "The All-League teams",
		body: blocks,
	};
};

export const awardRace = (c: Ctx): Article | undefined => {
	if (c.done) {
		return undefined;
	}
	const r = c.rng("race");
	const mvp = c.qual
		.toSorted(
			(a, b) =>
				b.ws +
				winp(c.team(b.tid) ?? { won: 0, lost: 0 }) * 4 -
				(a.ws + winp(c.team(a.tid) ?? { won: 0, lost: 0 }) * 4),
		)
		.slice(0, 5);
	const rookies = c.qual
		.filter((p) => p.rookie)
		.toSorted((a, b) => b.ws - a.ws)
		.slice(0, 3);
	const dpoy = c.qual
		.toSorted(
			(a, b) => b.stl + b.blk + b.trb * 0.2 - (a.stl + a.blk + a.trb * 0.2),
		)
		.slice(0, 3);
	if (mvp.length < 2) {
		return undefined;
	}
	const body: Block[] = [
		P(
			`Ballots are not due until the season ends, but here is how the races look through ${c.f.gp} games, by the numbers alone.`,
		),
		{ type: "sub", text: "MVP" },
		{
			type: "table",
			head: ["", "Player", "Team", "PTS/REB/AST", "WS"],
			numCols: [0, 4],
			rows: mvp.map((p, i) => [
				[String(i + 1)],
				[c.pl(p.pid)],
				[c.tl(p.tid, c.team(p.tid)?.abbrev), ` ${c.rec(p.tid)}`],
				[shortLine(p)],
				[fmt1(p.ws)],
			]),
		},
	];
	if (rookies.length > 0) {
		body.push({ type: "sub", text: "Rookie of the Year" });
		body.push({
			type: "list",
			items: rookies.map((p) => [
				c.pl(p.pid),
				", ",
				c.tl(p.tid),
				`: ${shortLine(p)}, ${fmt1(p.ws)} WS`,
			]),
		});
	}
	if (dpoy.length > 0) {
		body.push({ type: "sub", text: "Defense" });
		body.push({
			type: "list",
			items: dpoy.map((p) => [
				c.pl(p.pid),
				", ",
				c.tl(p.tid),
				`: ${fmt1(p.stl)} steals, ${fmt1(p.blk)} blocks, ${fmt1(p.trb)} rebounds`,
			]),
		});
	}
	return {
		id: "award-race",
		size: "feature",
		kicker: "Award watch",
		head: c.freshHead(r, [
			`${mvp[0]!.name} leads the MVP race`,
			`The MVP race: ${mvp[0]!.name} ahead of ${mvp[1]!.name}`,
			`Award watch: ${mvp[0]!.name}, ${mvp[1]!.name} and the rest`,
		])!,
		byline: c.byline("awards"),
		photoPid: mvp[0]!.pid,
		body,
	};
};

// ---- Playoffs --------------------------------------------------------------

export const seriesRecaps = (c: Ctx): Article[] => {
	const out: Article[] = [];
	const r = c.rng("series");
	for (let i = Math.min(c.f.currentRound, c.f.series.length - 1); i >= 0; i--) {
		const list = c.f.series[i]!;
		const items: Seg[][] = [];
		for (const s of list) {
			if (!s.away) {
				items.push([c.tl(s.home.tid), " had a bye"]);
				continue;
			}
			const winner = s.home.won >= s.away.won ? s.home : s.away;
			const loser = winner === s.home ? s.away : s.home;
			const finished = c.done || i < c.f.currentRound;
			if (!finished || winner.won === loser.won) {
				items.push([
					`(${s.home.seed}) `,
					c.tl(s.home.tid),
					` ${s.home.won}, (${s.away.seed}) `,
					c.tl(s.away.tid),
					` ${s.away.won}`,
				]);
				continue;
			}
			const games = c.f.games.filter((g) => s.gids.includes(g.gid));
			const stars = games
				.flatMap((g) => g.stars)
				.filter((b) => b.tid === winner.tid);
			const best = stars.toSorted((a, b) => b.pts - a.pts)[0];
			items.push([
				`(${winner.seed}) `,
				c.tl(winner.tid),
				` ${seriesVerb(r, winner.won, loser.won)} (${loser.seed}) `,
				c.tl(loser.tid),
				` ${inGames(winner.won, loser.won)}`,
				winner.seed > loser.seed ? " — an upset" : "",
				...(best
					? ["; ", c.pl(best.pid, best.name), ` scored ${best.pts} in one game`]
					: []),
				".",
			]);
		}
		if (items.length === 0) {
			continue;
		}
		const phrase = c.roundPhrase(i);
		const started = list.some((s) => s.home.won + (s.away?.won ?? 0) > 0);
		out.push({
			id: `round-${i}`,
			size: i === c.f.series.length - 1 ? "feature" : "brief",
			kicker: capFirst(phrase),
			head: c.freshHead(
				r,
				!started
					? [`${capFirst(phrase)} matchups`, `The ${phrase} is set`]
					: [
							`${capFirst(phrase)}: ${plural(list.length, "series", "series")}, the results`,
							`How the ${phrase} went`,
							`${capFirst(phrase)} roundup`,
						],
			)!,
			byline: c.byline("playoffs"),
			body: [{ type: "list", items }],
		});
	}
	return out;
};

export const finalsMvpStory = (c: Ctx): Article | undefined => {
	const a = c.award("FMVP");
	if (!a) {
		return undefined;
	}
	const p = c.player(a.pid);
	if (!p?.po) {
		return undefined;
	}
	const r = c.rng("fmvp");
	return {
		id: "fmvp",
		size: "feature",
		kicker: "Finals MVP",
		head: c.freshHead(r, [
			`${p.name} is Finals MVP`,
			`Finals MVP ${p.name} saved his best for last`,
			`${poss(p.name)} playoff run ends with Finals MVP`,
		])!,
		byline: c.byline("playoffs"),
		photoPid: p.pid,
		body: [
			P(
				c.pl(p.pid),
				" of the ",
				c.tl(a.tid),
				` was named Finals MVP after averaging ${c.lineWords(p.po)} in ${plural(p.po.gp, "playoff game")}${p.po.fgp ? ` on ${fmt1(p.po.fgp)}% shooting` : ""}.`,
			),
			P(`In the regular season he had averaged ${c.lineWords(p)}.`),
		],
	};
};

export const bracketSidebar = (c: Ctx): Sidebar | undefined => {
	if (c.f.series.length === 0) {
		return undefined;
	}
	const items: Seg[][] = [];
	for (const [i, list] of c.f.series.entries()) {
		for (const s of list) {
			if (!s.away || i > c.f.currentRound) {
				continue;
			}
			items.push([
				`${capFirst(c.roundPhrase(i))}: `,
				c.tl(s.home.tid, c.team(s.home.tid)?.abbrev),
				` ${s.home.won}-${s.away.won} `,
				c.tl(s.away.tid, c.team(s.away.tid)?.abbrev),
			]);
		}
	}
	return {
		id: "bracket",
		title: "Series results",
		body: [{ type: "list", items }],
	};
};

// ---- Features --------------------------------------------------------------

export const breakoutStory = (c: Ctx): Article | undefined => {
	const ups = c.qual
		.filter((p) => p.prevOvr !== undefined && p.ovr - p.prevOvr! >= 4)
		.toSorted((a, b) => b.ovr - b.prevOvr! - (a.ovr - a.prevOvr!))
		.slice(0, 4);
	if (ups.length === 0) {
		return undefined;
	}
	const r = c.rng("breakout");
	const top = ups[0]!;
	const body: Block[] = [
		P(
			c.pl(top.pid),
			` came into the season rated ${top.prevOvr} and ${c.T("is now", "finished at")} ${top.ovr}, the biggest jump among regulars. The ${top.age}-year-old ${c.T("is averaging", "averaged")} ${c.lineWords(top)} for the `,
			c.tl(top.tid),
			top.prevLine
				? `, up from ${fmt1(top.prevLine.pts)} points a year ago.`
				: ".",
		),
	];
	if (ups.length > 1) {
		body.push(
			P(
				"Others on the rise: ",
				...andList(
					ups
						.slice(1)
						.map((p) => [
							c.pl(p.pid),
							` (`,
							c.tl(p.tid, c.team(p.tid)?.abbrev),
							`, ${p.prevOvr} to ${p.ovr})`,
						]),
				),
				".",
			),
		);
	}
	return {
		id: "breakout",
		size: "feature",
		kicker: "Breakouts",
		head: c.freshHead(r, [
			`${top.name} takes the leap`,
			`From ${top.prevOvr} to ${top.ovr}: ${poss(top.name)} breakout`,
			`${top.name} and the season's risers`,
		])!,
		byline: c.byline("features"),
		photoPid: top.pid,
		body,
	};
};

export const declineStory = (c: Ctx): Article | undefined => {
	const downs = c.f.players
		.filter(
			(p) =>
				p.prevOvr !== undefined &&
				p.age >= 29 &&
				p.prevOvr >= 50 &&
				p.prevOvr - p.ovr >= 3 &&
				p.gp > 0,
		)
		.toSorted((a, b) => b.prevOvr! - b.ovr - (a.prevOvr! - a.ovr))
		.slice(0, 3);
	if (downs.length === 0) {
		return undefined;
	}
	const top = downs[0]!;
	const r = c.rng("decline");
	return {
		id: "decline",
		size: "brief",
		kicker: "Father Time",
		head: c.freshHead(r, [
			`${top.name} shows his age`,
			`The slide: ${top.name} drops from ${top.prevOvr} to ${top.ovr}`,
			`Not what they were: ${top.name} and other fading stars`,
		])!,
		byline: c.byline("features"),
		body: [
			P(
				c.pl(top.pid),
				`, ${top.age}, ${c.T("has dropped", "dropped")} from a ${top.prevOvr} rating to ${top.ovr}`,
				top.prevLine && top.prevLine.pts > top.pts
					? `, and his scoring from ${fmt1(top.prevLine.pts)} to ${fmt1(top.pts)} points a game.`
					: ".",
			),
			downs.length > 1
				? P(
						"Also heading the wrong way: ",
						...andList(
							downs
								.slice(1)
								.map((p) => [
									c.pl(p.pid),
									` (${p.age}, ${p.prevOvr} to ${p.ovr})`,
								]),
						),
						".",
					)
				: P(""),
		],
	};
};

export const surpriseStory = (c: Ctx): Article | undefined => {
	const withPrev = c.rows.filter((t) => t.prev && t.gp >= 10);
	if (withPrev.length < 4) {
		return undefined;
	}
	const delta = (t: NPTeam) => winp(t) - winp(t.prev!);
	const best = withPrev.toSorted((a, b) => delta(b) - delta(a))[0]!;
	const worst = withPrev.toSorted((a, b) => delta(a) - delta(b))[0]!;
	if (delta(best) < 0.1) {
		return undefined;
	}
	const r = c.rng("surprise");
	const star = c.teamPlayers(best.tid)[0];
	const body: Block[] = [
		P(
			"Last season the ",
			c.tl(best.tid, c.tfull(best.tid)),
			` went ${record(best.prev!)}. This season they ${c.T("are", "went")} ${record(best)}, ${c.T("the biggest improvement in the league", "the league's biggest improvement")}.`,
		),
	];
	if (star) {
		body.push(
			P(
				c.pl(star.pid),
				` ${c.T("leads", "led")} them with ${fmt1(star.ws)} win shares and ${fmt1(star.pts)} points a game.`,
			),
		);
	}
	if (delta(worst) <= -0.1) {
		body.push(
			P(
				"Going the other way: the ",
				c.tl(worst.tid),
				`, from ${record(worst.prev!)} to ${record(worst)}.`,
			),
		);
	}
	return {
		id: "surprise",
		size: "feature",
		kicker: "Turnarounds",
		head: c.freshHead(r, [
			`From ${record(best.prev!)} to ${record(best)}: the ${best.name} turnaround`,
			`The ${best.name} are the season's surprise`,
			`How the ${best.name} turned it around`,
		])!,
		byline: c.byline("league", best.region),
		photoPid: star?.pid,
		body,
	};
};

export const rookieStory = (c: Ctx): Article | undefined => {
	const rookies = c.f.players
		.filter((p) => p.rookie && p.gp >= 5)
		.toSorted((a, b) => b.pts - a.pts)
		.slice(0, 5);
	if (rookies.length < 2) {
		return undefined;
	}
	const r = c.rng("rookies");
	const top = rookies[0]!;
	return {
		id: "rookies",
		size: "brief",
		kicker: "Rookie watch",
		head: c.freshHead(r, [
			`${top.name} leads the rookie class`,
			`First-year report: ${top.name} out front`,
			`The rookies: ${top.name}, ${rookies[1]!.name} and the rest`,
		])!,
		byline: c.byline("draft"),
		body: [
			P(
				`Among first-year players, `,
				c.pl(top.pid),
				` of the `,
				c.tl(top.tid),
				` ${c.T("leads", "led")} in scoring at ${fmt1(top.pts)} points a game.`,
			),
			{
				type: "table",
				head: ["Rookie", "Team", "Pick", "PTS/REB/AST"],
				rows: rookies.map((p) => [
					[c.pl(p.pid)],
					[c.tl(p.tid, c.team(p.tid)?.abbrev)],
					[p.draftRound > 0 ? `${p.draftRound}-${p.draftPick}` : "UDFA"],
					[shortLine(p)],
				]),
			},
		],
	};
};

export const injuryStory = (c: Ctx): Article | undefined => {
	const list = c.f.injuries
		.filter((i) => i.gamesRemaining > 0)
		.toSorted((a, b) => b.gamesRemaining - a.gamesRemaining);
	if (list.length === 0 || c.done) {
		return undefined;
	}
	const top = list.slice(0, 6);
	const r = c.rng("injuries");
	return {
		id: "injuries",
		size: "brief",
		kicker: "Injury report",
		head: c.freshHead(r, [
			`${top[0]!.name} out ${plural(top[0]!.gamesRemaining, "more game")}`,
			"The injury report",
			`Sidelined: ${top[0]!.name} and others`,
		])!,
		byline: c.byline("league"),
		body: [
			{
				type: "list",
				items: top.map((i) => [
					c.pl(i.pid, i.name),
					" (",
					c.tl(i.tid, c.team(i.tid)?.abbrev),
					`): ${i.type.toLowerCase()}, out ${plural(i.gamesRemaining, "more game")}`,
				]),
			},
		],
	};
};

export const bestGamesStory = (c: Ctx): Article | undefined => {
	const feats = c.f.feats
		.toSorted((a, b) => b.pts + b.trb + b.ast - (a.pts + a.trb + a.ast))
		.slice(0, 5);
	if (feats.length === 0) {
		return undefined;
	}
	const top = feats[0]!;
	const r = c.rng("feats");
	const statText = (f: (typeof feats)[number]) =>
		[
			`${f.pts} points`,
			f.trb >= 10 ? `${f.trb} rebounds` : null,
			f.ast >= 10 ? `${f.ast} assists` : null,
			f.blk >= 5 ? `${f.blk} blocks` : null,
			f.stl >= 5 ? `${f.stl} steals` : null,
		]
			.filter(Boolean)
			.join(", ");
	return {
		id: "feats",
		size: "brief",
		kicker: "Big nights",
		head: c.freshHead(r, [
			`${top.name} goes for ${top.pts}`,
			`${poss(top.name)} ${top.pts}-point night tops the season's big games`,
			`The season's best games, led by ${top.name}`,
		])!,
		byline: c.byline("numbers"),
		photoPid: top.pid,
		body: [
			P(
				c.pl(top.pid, top.name),
				` had the ${c.T("best individual game of the season so far", "best individual game of the season")}: `,
				c.gl(top.gid, top.tid, statText(top)),
				` against the `,
				c.tl(top.oppTid),
				`${top.playoffs ? " in the playoffs" : ""}, a ${top.score} ${top.result === "W" ? "win" : top.result === "L" ? "loss" : "tie"}.`,
			),
			feats.length > 1
				? {
						type: "list",
						items: feats
							.slice(1)
							.map((f) => [
								c.pl(f.pid, f.name),
								" (",
								c.tl(f.tid, c.team(f.tid)?.abbrev),
								"): ",
								c.gl(f.gid, f.tid, statText(f)),
								` vs. ${c.team(f.oppTid)?.abbrev ?? "opponent"}`,
							]),
					}
				: P(""),
		],
	};
};

export const closeGamesStory = (c: Ctx): Article | undefined => {
	const games = c.f.games.filter((g) => !g.playoffs);
	const ot = games.toSorted((a, b) => b.overtimes - a.overtimes)[0];
	const blowout = games.toSorted(
		(a, b) => b.won.pts - b.lost.pts - (a.won.pts - a.lost.pts),
	)[0];
	if (!ot && !blowout) {
		return undefined;
	}
	const items: { lead: string; segs: Seg[] }[] = [];
	const sl = (g: NonNullable<typeof ot>) =>
		`${c.team(g.won.tid)?.abbrev} ${g.won.pts}, ${c.team(g.lost.tid)?.abbrev} ${g.lost.pts}`;
	if (ot && ot.overtimes >= 2) {
		items.push({
			lead: "Longest game:",
			segs: [
				c.gl(ot.gid, ot.won.tid, sl(ot)),
				` in ${word(ot.overtimes)} overtimes.`,
			],
		});
	}
	if (blowout) {
		items.push({
			lead: "Biggest rout:",
			segs: [
				c.gl(blowout.gid, blowout.won.tid, sl(blowout)),
				`, a ${blowout.won.pts - blowout.lost.pts}-point margin.`,
			],
		});
	}
	const high = games.toSorted(
		(a, b) => b.won.pts + b.lost.pts - (a.won.pts + a.lost.pts),
	)[0];
	if (high) {
		items.push({
			lead: "Highest scoring:",
			segs: [
				c.gl(high.gid, high.won.tid, sl(high)),
				`, ${high.won.pts + high.lost.pts} points in all.`,
			],
		});
	}
	if (items.length === 0) {
		return undefined;
	}
	return {
		id: "games",
		size: "brief",
		kicker: "Scoreboard",
		head: "Games to remember",
		byline: c.byline("numbers"),
		body: [{ type: "notebook", items }],
	};
};

// ---- Moves ----------------------------------------------------------------

const assetText = (c: Ctx, a: NPTradeAsset): Seg[] =>
	a.kind === "player"
		? [c.pl(a.pid, a.name)]
		: [
				`${typeof a.season === "number" ? a.season : "a"} ${ordinal(a.round)}-round pick${a.originalTid >= 0 && c.team(a.originalTid) ? ` (${c.team(a.originalTid)!.abbrev})` : ""}`,
			];

export const tradeStories = (c: Ctx, tid?: number): Article[] => {
	const trades = c.f.trades
		.filter((t) => tid === undefined || t.tids.includes(tid))
		.toSorted((a, b) => b.score - a.score)
		.slice(0, tid === undefined ? 3 : 4);
	const r = c.rng("trades", tid ?? "");
	return trades.map((tr, i) => {
		const [a, b] = tr.tids;
		const aGot = tr.got[0];
		const bGot = tr.got[1];
		const star = [...aGot, ...bGot].find(
			(x): x is Extract<NPTradeAsset, { kind: "player" }> =>
				x.kind === "player",
		);
		const when =
			tr.phase <= 2
				? tr.phase <= 0
					? "before the season"
					: "during the season"
				: "after the season";
		return {
			id: `trade-${i}`,
			size: i === 0 ? "feature" : "brief",
			kicker: "Trade",
			head: c.freshHead(r, [
				star ? `${star.name} on the move` : null,
				`${c.tn(a)} and ${c.tn(b)} make a deal`,
				star ? `${c.tn(a)}, ${c.tn(b)} swap in ${star.name} deal` : null,
			])!,
			byline: c.byline("moves"),
			photoPid: star?.pid,
			body: [
				P(
					`The `,
					c.tl(a, c.tfull(a)),
					` and the `,
					c.tl(b, c.tfull(b)),
					` completed a trade ${when}.`,
				),
				{
					type: "list",
					items: [
						[
							c.tl(a),
							" get ",
							...(aGot.length
								? andList(aGot.map((x) => assetText(c, x)))
								: ["nothing"]),
						],
						[
							c.tl(b),
							" get ",
							...(bGot.length
								? andList(bGot.map((x) => assetText(c, x)))
								: ["nothing"]),
						],
					],
				},
			],
		};
	});
};

export const signingsStory = (c: Ctx, tid?: number): Article | undefined => {
	const list = c.f.signings
		.filter((s) => tid === undefined || s.tid === tid)
		.toSorted((a, b) => b.amount - a.amount)
		.slice(0, 8);
	if (list.length === 0) {
		return undefined;
	}
	const top = list[0]!;
	const r = c.rng("signings", tid ?? "");
	return {
		id: "signings",
		size: "brief",
		kicker: "Contracts",
		head: c.freshHead(r, [
			`${top.name} ${top.kind === "reSigned" ? "re-signs with" : "signs with"} the ${c.tn(top.tid)}`,
			`Money moves: ${top.name} gets ${money(top.amount)} a year`,
			"The ledger: this season's signings",
		])!,
		byline: c.byline("moves"),
		body: [
			{
				type: "list",
				items: list.map((s) => [
					c.pl(s.pid, s.name),
					s.kind === "reSigned" ? " re-signed with the " : " signed with the ",
					c.tl(s.tid),
					`: ${money(s.amount)} a year through ${s.exp}`,
				]),
			},
		],
	};
};

// ---- Draft ----------------------------------------------------------------

export const draftStory = (c: Ctx, tid?: number): Article | undefined => {
	const picks = c.f.draft
		.filter((d) => tid === undefined || d.tid === tid)
		.toSorted((a, b) => a.round - b.round || a.pick - b.pick);
	if (picks.length === 0) {
		return undefined;
	}
	const top = picks[0]!;
	const r = c.rng("draft", tid ?? "");
	const ageWord = top.age <= 19 ? "teenager" : `${top.age}-year-old`;
	const body: Block[] = [
		P(
			"With the ",
			top.round === 1 && top.pick === 1
				? "first overall pick"
				: `No. ${top.pick} pick in round ${top.round}`,
			", the ",
			c.tl(top.tid, c.tfull(top.tid)),
			` took `,
			c.pl(top.pid, top.name),
			`, a ${ageWord} ${top.pos}${top.college ? ` out of ${top.college}` : ""} rated ${top.ovr} now with ${top.pot} potential.`,
		),
	];
	const highPot = picks.slice(1).toSorted((a, b) => b.pot - a.pot)[0];
	if (highPot && highPot.pot > top.pot) {
		body.push(
			P(
				`The scouts' favorite by potential, though, was `,
				c.pl(highPot.pid, highPot.name),
				` (${highPot.pot}), who went No. ${highPot.pick} in round ${highPot.round} to the `,
				c.tl(highPot.tid),
				".",
			),
		);
	}
	body.push({
		type: "table",
		head: ["Pick", "Player", "Pos", "Team", "Age", "Ovr/Pot"],
		numCols: [4],
		rows: picks
			.slice(0, tid === undefined ? 14 : 6)
			.map((d) => [
				[`${d.round}-${d.pick}`],
				[c.pl(d.pid, d.name)],
				[d.pos],
				[c.tl(d.tid, c.team(d.tid)?.abbrev)],
				[String(d.age)],
				[`${d.ovr}/${d.pot}`],
			]),
	});
	return {
		id: "draft",
		size: "feature",
		kicker: `${c.season} draft`,
		head: c.freshHead(r, [
			`${c.tn(top.tid)} take ${top.name} ${top.pick === 1 && top.round === 1 ? "first overall" : `at No. ${top.pick}`}`,
			`Draft night: ${top.name} goes ${top.pick === 1 && top.round === 1 ? "No. 1" : `No. ${top.pick}`}`,
			`${top.name} heads the ${c.season} draft class`,
		])!,
		byline: c.byline("draft"),
		body,
	};
};

// ---- Retirements ----------------------------------------------------------

export const retireStories = (c: Ctx): Article[] => {
	const list = c.f.retirees.toSorted((a, b) => b.ws - a.ws).slice(0, 6);
	if (list.length === 0) {
		return [];
	}
	const r = c.rng("retired");
	const [top, ...rest] = list as [(typeof list)[0], ...typeof list];
	const honors: string[] = [];
	if (top.mvps > 0) {
		honors.push(plural(top.mvps, "MVP award"));
	}
	if (top.titles > 0) {
		honors.push(plural(top.titles, "championship"));
	}
	if (top.allStars > 0) {
		honors.push(plural(top.allStars, "All-Star selection"));
	}
	const out: Article[] = [
		{
			id: "retired",
			size: "feature",
			kicker: "Farewell",
			head: c.freshHead(r, [
				`${top.name} calls it a career`,
				`${top.name} retires after ${plural(top.seasons, "season")}`,
				`So long, ${top.name}`,
			])!,
			byline: c.byline("obits"),
			body: [
				P(
					c.pl(top.pid, top.name),
					` has retired at ${top.age} after ${plural(top.seasons, "season")}, the last of them with the `,
					top.tid >= 0 && c.team(top.tid) ? c.tl(top.tid) : "league",
					`. He finishes with ${top.pts.toLocaleString("en-US")} points, ${top.trb.toLocaleString("en-US")} rebounds and ${top.ast.toLocaleString("en-US")} assists in ${plural(top.gp, "game")}${top.gp > 0 ? ` (${fmt1(top.pts / top.gp)} a game)` : ""}.`,
				),
				honors.length
					? P(`His résumé: ${honors.join(", ")}.`)
					: P(`He piled up ${fmt1(top.ws)} career win shares.`),
				top.hof ? P("He has already been voted into the Hall of Fame.") : P(""),
			],
		},
	];
	if (rest.length > 0) {
		out.push({
			id: "retired-more",
			size: "brief",
			kicker: "Also retiring",
			head: "Other retirements",
			body: [
				{
					type: "list",
					items: rest.map((x) => [
						c.pl(x.pid, x.name),
						`, ${x.age}: ${plural(x.seasons, "season")}, ${x.pts.toLocaleString("en-US")} points, ${fmt1(x.ws)} WS`,
					]),
				},
			],
		});
	}
	return out;
};

// ---- Opinion --------------------------------------------------------------

const COLUMN_NAMES = [
	"Full Court Press",
	"The Long Two",
	"Off the Glass",
	"Garbage Time",
	"The Fourth Quarter",
	"Above the Break",
	"From the Rafters",
	"Box Out",
	"Shot Clock",
	"Corner Three",
];

export const opinionColumn = (c: Ctx): Article | undefined => {
	const r = c.rng("opinion");
	const era = Math.floor((c.season - c.f.firstSeason) / 7);
	const colName = c.rng("column", era).pick(COLUMN_NAMES);
	const topics: (() => { head: string; body: Block[] } | undefined)[] = [
		() => {
			// The MVP debate: winner vs. runner-up, or two leaders mid-season
			const mvp = c.award("MVP");
			const cand = mvp
				? mvp.order
						.map((pid) => c.player(pid))
						.filter((p): p is NPPlayer => p !== undefined)
				: c.qual.toSorted((a, b) => b.ws - a.ws);
			const [a, b] = cand;
			if (!a || !b) {
				return undefined;
			}
			return {
				head: mvp
					? `The voters got it ${b.ws > a.ws ? "wrong" : "right"}`
					: `${a.name} or ${b.name}? It isn't close yet`,
				body: [
					P(
						mvp
							? "The MVP ballots are counted, and "
							: "Everybody wants an MVP pick at this point in the season, so here is mine: ",
						c.pl(a.pid),
						mvp ? " won it. " : ". ",
						`He ${c.T("is averaging", "averaged")} ${c.lineWords(a)} with ${fmt1(a.ws)} win shares.`,
					),
					P(
						"The case for ",
						c.pl(b.pid),
						` is ${b.ws > a.ws ? "better than people think" : "real but thinner"}: ${fmt1(b.ws)} win shares and ${fmt1(b.pts)} points a game for a ${c.rec(b.tid)} team.`,
						b.ws > a.ws
							? " By the most complete single number we have, he was the more valuable player."
							: " The numbers back the winner.",
					),
					P(
						r.pick([
							"Argue with me in the letters page.",
							"That's the column. Fight about it at the water cooler.",
							"Write in if you disagree. Many of you will.",
						]),
					),
				],
			};
		},
		() => {
			// The team that should blow it up: bad record, old best players
			const bad = c.rows.slice(-Math.max(3, Math.floor(c.rows.length / 4)));
			const old = bad
				.map((t) => ({ t, stars: c.teamPlayers(t.tid).slice(0, 3) }))
				.filter((x) => x.stars.length >= 2)
				.toSorted(
					(a, b) =>
						b.stars.reduce((s, p) => s + p.age, 0) -
						a.stars.reduce((s, p) => s + p.age, 0),
				)[0];
			if (!old) {
				return undefined;
			}
			const avg = old.stars.reduce((s, p) => s + p.age, 0) / old.stars.length;
			return {
				head: `It's time for the ${old.t.name} to start over`,
				body: [
					P(
						"The ",
						c.tl(old.t.tid, c.tfull(old.t.tid)),
						` ${c.T("are", "finished")} ${record(old.t)}. Their three most productive players average ${avg.toFixed(1)} years old: `,
						...andList(old.stars.map((p) => [c.pl(p.pid), ` (${p.age})`])),
						".",
					),
					P(
						avg >= 28
							? "That is not a core that is about to get better. Sell while the names still mean something."
							: "The good news is that the core is young. The bad news is that young cores are supposed to show signs of life by now.",
					),
				],
			};
		},
		() => {
			const t = c.rows[0];
			if (!t || c.pre) {
				return undefined;
			}
			const pd =
				t.pts !== undefined && t.oppPts !== undefined
					? t.pts - t.oppPts
					: undefined;
			return {
				head: `Believe in the ${t.name}${c.done ? " — or should you have?" : ""}`,
				body: [
					P(
						"The ",
						c.tl(t.tid, c.tfull(t.tid)),
						` ${c.T("have", "had")} the best record in the league at ${record(t)}${pd !== undefined ? `, with a point differential of ${pd >= 0 ? "+" : ""}${fmt1(pd)} a game` : ""}.`,
					),
					P(
						pd !== undefined && pd < 4
							? "That margin is thinner than the record suggests. Close games even out."
							: "That is not luck. Teams that win by that much are usually exactly as good as they look.",
					),
					c.done ? P(`They ${c.fate(t.playoffRoundsWon)}.`) : P(""),
				],
			};
		},
	];
	const order = r.shuffle(topics);
	for (const topic of order) {
		const x = topic();
		if (x) {
			return {
				id: "column",
				size: "feature",
				kicker: colName,
				head: x.head,
				byline: c.byline("opinion"),
				body: x.body,
			};
		}
	}
	return undefined;
};

// ---- Sidebars --------------------------------------------------------------

export const standingsSidebar = (c: Ctx, tid?: number): Sidebar | undefined => {
	if (c.rows.length === 0) {
		return undefined;
	}
	const me = tid !== undefined ? c.team(tid) : undefined;
	let list =
		me && c.f.confs.length > 1
			? c.rows.filter((t) => t.cid === me.cid)
			: c.rows;
	const confName =
		me && c.f.confs.length > 1
			? c.f.confs.find((x) => x.cid === me.cid)?.name
			: undefined;
	const lead = list[0]!;
	if (tid === undefined) {
		list = list.slice(0, 10);
	}
	const gbOf = (t: NPTeam) => {
		const g = (lead.won - t.won + (t.lost - lead.lost)) / 2;
		return g === 0 ? "–" : String(g);
	};
	return {
		id: "standings",
		title: `${confName ?? "League"} standings${c.done ? "" : " so far"}`,
		body: [
			{
				type: "table",
				head: ["", "Team", "W-L", "GB"],
				numCols: [0, 2, 3],
				hl:
					tid !== undefined ? list.findIndex((t) => t.tid === tid) : undefined,
				rows: list.map((t, i) => [
					[String(i + 1)],
					[c.tl(t.tid, t.abbrev)],
					[record(t)],
					[gbOf(t)],
				]),
			},
		],
	};
};

export const leadersSidebar = (c: Ctx): Sidebar | undefined => {
	const cats = [
		["pts", "Points"],
		["trb", "Rebounds"],
		["ast", "Assists"],
		["blk", "Blocks"],
	] as const;
	const rows: Seg[][][] = [];
	for (const [key, label] of cats) {
		const best = c.qual.toSorted((a, b) => b[key] - a[key])[0];
		if (best) {
			rows.push([[label], [c.pl(best.pid)], [fmt1(best[key])]]);
		}
	}
	if (rows.length === 0) {
		return undefined;
	}
	return {
		id: "leaders",
		title: "League leaders (per game)",
		body: [{ type: "table", head: ["", "Player", ""], numCols: [2], rows }],
	};
};

export const numbersSidebar = (c: Ctx): Sidebar | undefined => {
	const items: { value: string; label: string }[] = [];
	const games = c.f.teams.reduce((a, t) => a + t.gp, 0) / 2;
	if (games > 0) {
		items.push({ value: String(Math.round(games)), label: "games played" });
	}
	const ppg = c.f.teams.filter((t) => t.pts !== undefined);
	if (ppg.length > 0) {
		items.push({
			value: fmt1(ppg.reduce((a, t) => a + t.pts!, 0) / ppg.length),
			label: "points per team per game",
		});
	}
	const best = c.rows[0];
	if (best && best.gp > 0) {
		items.push({ value: record(best), label: `best record (${best.abbrev})` });
	}
	const trades = c.f.trades.length;
	items.push({
		value: String(trades),
		label: trades === 1 ? "trade" : "trades",
	});
	if (c.f.feats.length > 0) {
		items.push({
			value: String(c.f.feats.length),
			label: c.f.feats.length === 1 ? "statistical feat" : "statistical feats",
		});
	}
	return {
		id: "numbers",
		title: "By the numbers",
		body: [{ type: "nums", items }],
	};
};

export const teamStatsTable = (c: Ctx): Article | undefined => {
	const ts = c.f.teams.filter(
		(t) => t.pts !== undefined && t.oppPts !== undefined && t.gp > 0,
	);
	if (ts.length === 0) {
		return undefined;
	}
	const sorted = ts.toSorted(
		(a, b) => b.pts! - b.oppPts! - (a.pts! - a.oppPts!),
	);
	const off = ts.toSorted((a, b) => b.pts! - a.pts!)[0]!;
	const def = ts.toSorted((a, b) => a.oppPts! - b.oppPts!)[0]!;
	return {
		id: "team-numbers",
		size: "feature",
		kicker: "Team numbers",
		head: `Point differential: ${sorted[0]!.name} ${c.T("lead", "led")} the league`,
		byline: c.byline("numbers"),
		body: [
			P(
				"The highest-scoring team ",
				c.T("is", "was"),
				" the ",
				c.tl(off.tid),
				` at ${fmt1(off.pts!)} a game; the stingiest defense `,
				c.T("belongs", "belonged"),
				" to the ",
				c.tl(def.tid),
				`, allowing ${fmt1(def.oppPts!)}.`,
			),
			{
				type: "table",
				head: ["Team", "W-L", "PF", "PA", "Diff"],
				numCols: [2, 3, 4],
				rows: sorted.map((t) => [
					[c.tl(t.tid, c.tfull(t.tid))],
					[record(t)],
					[fmt1(t.pts!)],
					[fmt1(t.oppPts!)],
					[`${t.pts! - t.oppPts! >= 0 ? "+" : ""}${fmt1(t.pts! - t.oppPts!)}`],
				]),
			},
		],
	};
};

export const leaderTables = (c: Ctx): Article | undefined => {
	if (c.qual.length === 0) {
		return undefined;
	}
	const cats = [
		["pts", "Points"],
		["trb", "Rebounds"],
		["ast", "Assists"],
		["stl", "Steals"],
		["blk", "Blocks"],
		["ws", "Win shares"],
	] as const;
	const body: Block[] = [];
	for (const [key, label] of cats) {
		const top = c.qual.toSorted((a, b) => b[key] - a[key]).slice(0, 5);
		body.push({ type: "sub", text: label });
		body.push({
			type: "table",
			head: ["", "Player", "Team", key === "ws" ? "Total" : "Per game"],
			numCols: [0, 3],
			rows: top.map((p, i) => [
				[String(i + 1)],
				[c.pl(p.pid)],
				[c.tl(p.tid, c.team(p.tid)?.abbrev)],
				[fmt1(p[key])],
			]),
		});
	}
	return {
		id: "leaders",
		size: "feature",
		kicker: "Leaders",
		head: c.T("The leaderboards so far", "The final leaderboards"),
		byline: c.byline("numbers"),
		body,
	};
};

export { aOrAn };
