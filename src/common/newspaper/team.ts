// The local team edition: one team's own front page.

import { Ctx, P } from "./ctx.ts";
import { champFacts, seriesOf, sides } from "./front.ts";
import {
	aOrAn,
	andList,
	fmt1,
	ordinal,
	plural,
	poss,
	record,
	winp,
} from "./text.ts";
import type { Article, Block, NPPlayer } from "./types.ts";

export const teamLead = (c: Ctx, tid: number): Article | undefined => {
	const t = c.team(tid);
	if (!t) {
		return undefined;
	}
	const r = c.rng("team-lead");
	const tn = t.name;
	const rk = c.rank(tid);
	const nT = c.rows.length;
	const champ = c.done && c.f.champion === tid;
	const body: Block[] = [];
	let heads: string[];

	if (c.pre || t.gp === 0) {
		heads = [
			`${tn} open the ${c.season} season`,
			`The ${c.season} ${tn}: a season preview`,
			`A new season for the ${tn}`,
		];
		if (t.prev) {
			body.push(
				P(
					`Last season the `,
					c.tl(tid, c.tfull(tid)),
					` went ${record(t.prev)} and ${c.fate(t.prev.playoffRoundsWon)}.`,
				),
			);
		}
		const roster = c.f.players
			.filter((p) => p.tid === tid)
			.toSorted((a, b) => b.ovr - a.ovr)
			.slice(0, 4);
		if (roster.length >= 2) {
			body.push(
				P(
					"The highest-rated players on the roster: ",
					...andList(
						roster.map((p) => [c.pl(p.pid), ` (${p.ovr}, age ${p.age})`]),
					),
					".",
				),
			);
		}
	} else {
		if (champ) {
			heads = [
				`${tn} are champions`,
				`Champions: the ${c.season} ${tn}`,
				`The ${tn} win the ${c.season} title`,
			];
		} else if (c.done) {
			const fate = c.fate(t.playoffRoundsWon);
			heads = [
				`${tn} go ${record(t)} and ${fate}`,
				`A ${record(t)} year for the ${tn}, who ${fate}`,
			];
		} else if (c.inPlayoffs) {
			heads =
				t.playoffRoundsWon >= 0
					? [
							`${tn} (${record(t)}) in the playoffs`,
							`Playoff time for the ${record(t)} ${tn}`,
						]
					: [
							`${tn} finish ${record(t)}, out of the playoffs`,
							`No playoffs for the ${record(t)} ${tn}`,
						];
		} else {
			heads = [
				`${tn} are ${record(t)} after ${plural(t.gp, "game")}`,
				`The ${tn} sit ${ordinal(rk)} of ${nT} at ${record(t)}`,
				`The ${tn} so far: ${record(t)}`,
			];
		}
		body.push(
			P(
				"The ",
				c.tl(tid, c.tfull(tid)),
				` ${c.T("are", "went")} ${record(t)}${c.done ? "" : ` through ${plural(t.gp, "game")}`}, ${ordinal(rk)} of ${nT} in the league`,
				t.pts !== undefined && t.oppPts !== undefined
					? `, ${c.T("scoring", "scoring")} ${fmt1(t.pts)} and allowing ${fmt1(t.oppPts)} a game.`
					: ".",
			),
		);
		const home = `${t.wonHome}-${t.lostHome}`;
		const away = `${t.wonAway}-${t.lostAway}`;
		body.push(
			P(
				`At home they ${c.T("are", "were")} ${home}; on the road, ${away}.`,
				t.streak >= 3
					? ` They ${c.T("have won", "closed on")} ${t.streak} straight.`
					: t.streak <= -3
						? ` They ${c.T("have lost", "closed on a run of")} ${-t.streak} ${c.T("straight", "losses")}.`
						: "",
			),
		);
		if (t.prev) {
			const d = winp(t) - winp(t.prev);
			body.push(
				P(
					`A year ago they went ${record(t.prev)}${Math.abs(d) >= 0.08 ? `; this is ${d > 0 ? "a clear step forward" : "a step back"}` : ", much the same"}.`,
				),
			);
		}
		const path = seriesOf(c, tid);
		if (path.length > 0) {
			const legs = path.map(({ s, round }) => {
				const { me, opp } = sides(s, tid);
				if (!opp) {
					return [`a bye in the ${c.roundPhrase(round)}`];
				}
				const won = (me?.won ?? 0) > opp.won;
				return [
					`${won ? "beat" : (me?.won ?? 0) === opp.won ? "were level with" : "lost to"} the `,
					c.tl(opp.tid),
					` ${me?.won ?? 0}-${opp.won} in the ${c.roundPhrase(round)}`,
				];
			});
			body.push(
				P(
					`In the playoffs, as the No. ${sides(path[0]!.s, tid).me?.seed} seed, they `,
					...andList(legs),
					".",
				),
			);
		}
		if (champ) {
			const x = champFacts(c);
			if (x) {
				body.push(
					P(
						x.nTitles === 1
							? "It is the first title in franchise history."
							: `It is the franchise's ${ordinal(x.nTitles)} title.`,
					),
				);
			}
		}
	}
	const top = c.teamPlayers(tid)[0];
	return {
		id: "lead",
		size: "lead",
		kicker: `Local edition · ${c.tfull(tid)}`,
		head: c.freshHead(r, heads)!,
		deck: c.pre
			? ["Nothing has been played yet."]
			: c.mid
				? [`${plural(t.gp, "game")} played, the rest still to come.`]
				: undefined,
		byline: c.byline("local", t.region),
		photoPid: top?.pid,
		body,
	};
};

export const teamPlayerFeatures = (c: Ctx, tid: number): Article[] => {
	if (c.pre) {
		return [];
	}
	const tn = c.tn(tid);
	return c
		.teamPlayers(tid)
		.filter((p) => p.gp >= 5)
		.slice(0, 3)
		.map((p: NPPlayer, i) => {
			const r = c.rng("team-player", p.pid);
			const aw = c.awardsOf(p.pid).filter((a) => !a.group);
			const body: Block[] = [
				P(
					c.pl(p.pid),
					`, ${p.age}, ${c.T("is averaging", "averaged")} ${c.lineWords(p)} in ${plural(p.gp, "game")} for the `,
					c.tl(tid),
					`, with ${fmt1(p.ws)} win shares.`,
				),
			];
			const k = c.statRank(p.pid, "pts");
			if (k && k <= 10) {
				body.push(
					P(
						`That ${c.T("ranks", "ranked")} ${ordinal(k)} in the league in scoring.`,
					),
				);
			}
			if (p.prevOvr !== undefined && p.ovr !== p.prevOvr) {
				body.push(
					P(
						`His rating ${p.ovr > p.prevOvr ? "rose" : "fell"} from ${p.prevOvr} to ${p.ovr} over the year.`,
					),
				);
			}
			if (aw.length > 0) {
				body.push(P(`Honors: ${aw.map((a) => a.name).join(", ")}.`));
			}
			if (
				p.contractExp !== undefined &&
				p.contractAmount !== undefined &&
				p.contractExp <= c.season + 1
			) {
				body.push(P(`His contract runs through ${p.contractExp}.`));
			}
			return {
				id: `team-player-${p.pid}`,
				size: i === 0 ? "feature" : "brief",
				kicker: i === 0 ? "Player of the year" : "Profile",
				head: c.freshHead(r, [
					`${p.name}: ${fmt1(p.pts)} points a game for the ${tn}`,
					i === 0
						? `${p.name} ${c.T("leads", "led")} the ${tn} with ${fmt1(p.ws)} win shares`
						: `${poss(p.name)} season in numbers`,
					`${aOrAn(String(p.age))}-year-old ${p.pos} ${p.name} ${c.T("keeps", "kept")} producing`,
				])!,
				byline: c.byline("local"),
				photoPid: p.pid,
				body,
			};
		});
};

export const teamGames = (c: Ctx, tid: number): Article | undefined => {
	const mine = c.f.games.filter((g) => g.won.tid === tid || g.lost.tid === tid);
	if (mine.length === 0) {
		return undefined;
	}
	const wins = mine
		.filter((g) => g.won.tid === tid)
		.toSorted((a, b) => b.won.pts - b.lost.pts - (a.won.pts - a.lost.pts));
	const losses = mine
		.filter((g) => g.lost.tid === tid)
		.toSorted((a, b) => b.won.pts - b.lost.pts - (a.won.pts - a.lost.pts));
	const items: { lead: string; segs: (string | ReturnType<Ctx["pl"]>)[] }[] =
		[];
	const sl = (g: (typeof mine)[number]) =>
		`${c.team(g.won.tid)?.abbrev} ${g.won.pts}, ${c.team(g.lost.tid)?.abbrev} ${g.lost.pts}`;
	const star = (g: (typeof mine)[number]) => g.stars.find((s) => s.tid === tid);
	for (const [lead, g] of [
		["Best win:", wins[0]],
		["Worst loss:", losses[0]],
	] as const) {
		if (g) {
			const s = star(g);
			items.push({
				lead,
				segs: [
					c.gl(g.gid, tid, sl(g)),
					g.playoffs ? " (playoffs)" : "",
					s ? [`; `, c.pl(s.pid, s.name), ` had ${s.pts} points`].flat() : [],
					".",
				].flat(),
			});
		}
	}
	const ot = mine.filter((g) => g.overtimes > 0);
	if (ot.length > 0) {
		items.push({
			lead: "Overtime:",
			segs: [
				`${plural(ot.length, "game")} went to overtime; they won ${ot.filter((g) => g.won.tid === tid).length}.`,
			],
		});
	}
	const topNight = mine
		.flatMap((g) => g.stars.filter((s) => s.tid === tid).map((s) => ({ s, g })))
		.toSorted((a, b) => b.s.pts - a.s.pts)[0];
	if (topNight) {
		items.push({
			lead: "Top scoring night:",
			segs: [
				c.pl(topNight.s.pid, topNight.s.name),
				`, ${topNight.s.pts} points in `,
				c.gl(topNight.g.gid, tid, sl(topNight.g)),
				".",
			],
		});
	}
	return {
		id: "team-games",
		size: "brief",
		kicker: "Scoreboard",
		head: `The ${c.tn(tid)} games to remember`,
		byline: c.byline("local"),
		body: [{ type: "notebook", items }],
	};
};
